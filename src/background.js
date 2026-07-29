import * as rmp from './lib/rmp.js';
import * as names from './lib/names.js';
import * as cache from './lib/cache.js';
import { getSettings, setSettings, DEFAULTS } from './lib/settings.js';
import { heuristicSummary } from './lib/summarize.js';

/* ------------------------------------------------------------------ */
/* Request queue -- be a polite client                                 */
/* ------------------------------------------------------------------ */

const MAX_CONCURRENT = 6;
const MIN_GAP_MS = 60;

let active = 0;
let lastStart = 0;
const queue = [];

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
}

function drain() {
  if (active >= MAX_CONCURRENT || !queue.length) return;
  const gap = Date.now() - lastStart;
  if (gap < MIN_GAP_MS) {
    setTimeout(drain, MIN_GAP_MS - gap);
    return;
  }
  const job = queue.shift();
  active += 1;
  lastStart = Date.now();
  Promise.resolve()
    .then(job.fn)
    .then(job.resolve, job.reject)
    .finally(() => {
      active -= 1;
      drain();
    });
  drain();
}

/* ------------------------------------------------------------------ */
/* In-flight dedup -- 40 rows for one professor should be one fetch    */
/* ------------------------------------------------------------------ */

const inflight = new Map();

function dedup(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ */
/* School resolution                                                   */
/* ------------------------------------------------------------------ */

async function resolveSchools(force = false) {
  const settings = await getSettings();
  if (Array.isArray(settings.schools) && settings.schools.length && !force) return settings;

  const base = names.familyBase(settings.schoolName);
  const cached = await cache.get(`schools:${base}`);
  if (cached && !force) {
    return setSettings({ schools: cached.schools, schoolLabel: cached.label });
  }

  const results = await schedule(() => rmp.searchSchools(settings.schoolName));
  if (!results.length) {
    throw new Error(`No RateMyProfessors school found for "${settings.schoolName}"`);
  }

  // Keep every campus in the family: same base name, campus suffix or not.
  // "University of Pittsburgh" and "University of Pittsburgh - Greensburg"
  // are separate RMP schools; professors live under whichever campus they
  // teach at, so lookups must span all of them.
  const family = results.filter((r) => names.familyBase(r.name) === base);
  const pool = family.length ? family : [results[0]];

  // Main campus (exact base name, else most-rated) goes first so it wins ties.
  pool.sort((a, b) => {
    const aMain = names.normalize(a.name) === base ? 1 : 0;
    const bMain = names.normalize(b.name) === base ? 1 : 0;
    if (aMain !== bMain) return bMain - aMain;
    return (b.numRatings || 0) - (a.numRatings || 0);
  });

  const schools = pool.slice(0, 8).map((r) => ({ id: r.id, name: r.name }));
  const label =
    schools.length > 1
      ? `${schools[0].name} + ${schools.length - 1} regional campus${schools.length > 2 ? 'es' : ''}`
      : schools[0].name;

  await cache.set(`schools:${base}`, { schools, label }, cache.TTL.SCHOOL);
  return setSettings({ schools, schoolLabel: label });
}

/* ------------------------------------------------------------------ */
/* Core lookup                                                         */
/* ------------------------------------------------------------------ */

async function lookupInstructor(rawName, campusHint) {
  if (names.isPlaceholder(rawName)) {
    return { status: 'placeholder' };
  }

  const parsed = names.parseName(rawName);
  if (!parsed) return { status: 'unparseable', raw: rawName };

  const settings = await resolveSchools();
  const schools = settings.schools;
  const familyKey = names.familyBase(settings.schoolName);
  const key = names.cacheKey(parsed, familyKey);

  const cached = await cache.get(`prof:${key}`);
  if (cached) return cached;

  return dedup(`prof:${key}`, async () => {
    let result;
    try {
      const term = names.searchTerm(parsed);

      // The page tells us which campus the section belongs to, so try that
      // school alone first. That is one request instead of five for the
      // overwhelming majority of lookups; the fan-out below is the fallback
      // for faculty who teach across campuses or whose page lives elsewhere.
      const ordered = orderByCampus(schools, campusHint);

      let match = names.pickBest(parsed, await searchAt(ordered[0], term));

      if (!match && ordered.length > 1) {
        const rest = await Promise.all(ordered.slice(1).map((sc) => searchAt(sc, term)));
        match = names.pickBest(parsed, rest.flat());
      }

      // Pass 3: last name only across all campuses. RMP's search is finicky
      // about first names ("Bill" registered as "William" etc).
      if (!match && parsed.first) {
        const wide = await Promise.all(schools.map((sc) => searchAt(sc, parsed.last)));
        match = names.pickBest(parsed, wide.flat());
      }

      if (!match) {
        result = { status: 'notfound', raw: rawName, parsed };
        await cache.set(`prof:${key}`, result, cache.TTL.MISS);
        return result;
      }

      // The search hit already carries every figure the badge and panel header
      // show. Comments and tags need a second request, but you only see those
      // if you open a panel -- so that request is deferred to TEACHER_DETAIL.
      // This halves requests per professor and, more importantly, paints the
      // badge after one round trip instead of two serial ones.
      const n = match.node;
      const campus = n.__campus || n.school?.name || null;
      const campusLabel =
        campus && schools.length > 1 && campus !== schools[0].name ? campus : null;

      result = {
        status: 'ok',
        confidence: match.confidence,
        raw: rawName,
        parsed,
        teacher: {
          id: n.id,
          legacyId: n.legacyId,
          firstName: n.firstName,
          lastName: n.lastName,
          department: n.department,
          avgRating: normalizeNum(n.avgRating),
          avgDifficulty: normalizeNum(n.avgDifficulty),
          numRatings: n.numRatings ?? 0,
          wouldTakeAgainPercent: normalizeWta(n.wouldTakeAgainPercent),
          url: `https://www.ratemyprofessors.com/professor/${n.legacyId}`,
          campus: campusLabel,
        },
      };
      await cache.set(`prof:${key}`, result, cache.TTL.HIT);
      return result;
    } catch (err) {
      console.error('[PRB] lookup failed', rawName, err);
      return { status: 'error', raw: rawName, message: String(err.message || err) };
    }
  });
}

// RMP reports -1 for "no data" on several numeric fields.
function normalizeNum(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}
function normalizeWta(v) {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.round(x) : null;
}

/** Put the campus the page named at the front of the search order. */
function orderByCampus(schools, hint) {
  if (!hint || schools.length < 2) return schools;
  // The page says "Greensburg Campus"; RMP says "University of Pittsburgh -
  // Greensburg". Strip the trailing noun so the substring test lines up.
  const needle = names.normalize(String(hint).replace(/\bcampus\b/i, '')).trim();
  if (!needle) return schools;
  const idx = schools.findIndex((sc) => names.normalize(sc.name).includes(needle));
  if (idx <= 0) return schools; // absent, or already first
  const copy = schools.slice();
  const [picked] = copy.splice(idx, 1);
  return [picked, ...copy];
}

/** One campus search, with each candidate tagged by the school it came from. */
async function searchAt(school, term) {
  try {
    const nodes = await schedule(() => rmp.searchTeachers(term, school.id));
    return nodes.map((n) => ({ ...n, __campus: n.school?.name || school.name }));
  } catch (err) {
    console.warn('[PRB] campus search failed', school.name, err.message);
    return [];
  }
}

/** Full detail (tags + comments). Fetched only when a panel opens. */
async function teacherDetail(teacherId) {
  const key = `detail:${teacherId}`;
  const cached = await cache.get(key);
  if (cached) return cached;

  return dedup(key, async () => {
    try {
      const detail = await schedule(() => rmp.getTeacher(teacherId, 20));
      if (!detail) return { status: 'notfound' };
      const out = { status: 'ok', teacher: trimForCache(detail) };
      await cache.set(key, out, cache.TTL.HIT);
      return out;
    } catch (err) {
      console.error('[PRB] detail fetch failed', teacherId, err);
      return { status: 'error', message: String(err.message || err) };
    }
  });
}

/* ------------------------------------------------------------------ */
/* On-device summarization                                             */
/* ------------------------------------------------------------------ */

const OFFSCREEN_PATH = 'src/offscreen.html';

// Set once a model has answered successfully, so later calls skip the gate.
let modelReady = false;

async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return false;
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return ctxs.length > 0;
}

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (await hasOffscreen()) return true;
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS'],
      justification:
        'Hosts a persistent on-device language model session so review summaries survive service worker termination.',
    })
    .then(() => true)
    .catch((err) => {
      console.warn('[PRB] offscreen creation failed', err);
      return false;
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  return creatingOffscreen;
}

async function askOffscreen(payload) {
  const ok = await ensureOffscreen();
  if (!ok) throw new Error('offscreen unavailable');

  // The offscreen document's module script loads asynchronously, so the first
  // message after creation can race the listener registration. Retry briefly.
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage({ ...payload, __target: 'offscreen' });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (!/receiving end|could not establish/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function aiStatus() {
  try {
    const res = await askOffscreen({ type: 'AI_STATUS' });
    return res || { nano: { supported: false }, local: { status: 'idle' } };
  } catch (err) {
    return { error: String(err.message || err), nano: { supported: false }, local: { status: 'idle' } };
  }
}

/** Explicit user action from the popup: pull the model down now. */
async function downloadModel() {
  await setSettings({ autoDownloadModel: true });
  const res = await askOffscreen({ type: 'WARMUP' });
  if (res?.status === 'ok') modelReady = true;
  return res;
}

async function summarize(teacher) {
  const settings = await getSettings();

  const comments = (teacher.ratings || []).filter((r) => r.comment && r.comment.trim());
  if (comments.length < settings.minRatingsForSummary) {
    return { status: 'insufficient', count: comments.length };
  }

  // The statistics are computed locally and are always exact. A model, if one
  // is available, only rewrites them as prose -- it never supplies facts.
  const analysis = heuristicSummary(teacher);
  const base = { status: 'ok', source: 'heuristic', summary: analysis };

  if (!settings.aiSummaries) return base;

  const key = `prose:qwen:${teacher.id}:${teacher.numRatings}`;
  const cached = await cache.get(key);
  if (cached) return { ...base, source: cached.engine, prose: cached.text };

  // Never trigger a 300 MB download implicitly; the user opts in from the
  // popup. autoDownloadModel is set once the user has consented, and persists;
  // modelReady is only an in-memory fast path (the offscreen document unloads
  // itself when idle, so it can go stale in either direction).
  if (!settings.autoDownloadModel) {
    return base;
  }

  return dedup(key, async () => {
    try {
      const res = await askOffscreen({
        type: 'SUMMARIZE',
        teacher: slimTeacher(teacher),
        analysis,
      });
      if (res?.status === 'ok' && res.text) {
        modelReady = true;
        await cache.set(key, { engine: res.engine, text: res.text }, cache.TTL.SUMMARY);
        return { ...base, source: res.engine, prose: res.text };
      }
    } catch (err) {
      console.warn('[PRB] model summary unavailable, using statistics only:', err.message);
    }
    return base;
  });
}


/* A full teacher record with 20 untrimmed comments runs 8-10 KB. Cached at
 * scale that overflows storage, so bound what we persist: 16 comments,
 * 700 chars each, which is more than the summarizer or panel ever uses. */
function trimForCache(detail) {
  return {
    ...detail,
    ratings: (detail.ratings || []).slice(0, 16).map((r) => ({
      class: r.class,
      date: r.date,
      comment: String(r.comment || '').slice(0, 700),
      clarityRating: r.clarityRating,
      helpfulRating: r.helpfulRating,
      difficultyRating: r.difficultyRating,
    })),
  };
}

// Keep the message payload small -- 16 full rating objects is a lot of noise.
function slimTeacher(teacher) {
  return {
    id: teacher.id,
    department: teacher.department,
    avgRating: teacher.avgRating,
    avgDifficulty: teacher.avgDifficulty,
    numRatings: teacher.numRatings,
    tags: teacher.tags,
    ratings: (teacher.ratings || []).slice(0, 16).map((r) => ({
      class: r.class,
      comment: String(r.comment || '').slice(0, 600),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Message router                                                      */
/* ------------------------------------------------------------------ */

const HANDLERS = {
  // Content script ships raw cell text here so all name logic stays in one
  // place. Returns, per input, the list of individual instructor names found.
  PARSE_BATCH: ({ texts }) =>
    (texts || []).map((text) => {
      if (names.isPlaceholder(text)) return [];
      const parts = names.splitInstructors(text);
      const out = [];
      for (const part of parts) {
        if (names.isPlaceholder(part)) continue;
        // The gate that keeps "MoWeFr", "AT", and "124 Biddle Hall" from
        // becoming badges and RMP lookups.
        if (!names.looksLikePersonName(part)) continue;
        const parsed = names.parseName(part);
        if (!parsed) continue;
        if (parsed.last.length < 2) continue;
        out.push(parsed.display);
      }
      return out;
    }),

  LOOKUP: ({ name, campusHint }) => lookupInstructor(name, campusHint),
  SUMMARIZE_TEACHER: ({ teacher }) => summarize(teacher),
  TEACHER_DETAIL: ({ teacherId }) => teacherDetail(teacherId),
  AI_STATUS: () => aiStatus(),
  DOWNLOAD_MODEL: () => downloadModel(),
  GET_SETTINGS: () => getSettings(),
  SET_SETTINGS: ({ patch }) => setSettings(patch),
  RESET_SETTINGS: async () => {
    await chrome.storage.local.set({ settings: { ...DEFAULTS } });
    return DEFAULTS;
  },
  RESOLVE_SCHOOL: ({ force }) => resolveSchools(force),
  CACHE_STATS: () => cache.stats(),
  CLEAR_CACHE: async () => {
    await cache.clear();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages aimed at the offscreen document pass straight through.
  if (msg?.__target === 'offscreen') return false;

  const handler = HANDLERS[msg?.type];
  if (!handler) return false;

  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      console.error('[PRB]', msg.type, err);
      sendResponse({ ok: false, error: String(err.message || err) });
    });

  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  resolveSchools().catch((err) => console.warn('[PRB] school resolve deferred:', err.message));
});
