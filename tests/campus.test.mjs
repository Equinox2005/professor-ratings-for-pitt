/**
 * Reproduces the Greensburg bug end to end: a professor whose RMP page lives
 * under a regional campus must be found even though the main-campus search
 * misses, and request counts must stay sane for the common cases.
 *
 * background.js registers chrome listeners at module scope, so it is imported
 * behind a stub `chrome` and a stub `fetch` that plays RateMyProfessors. Every
 * lookup below goes through the real message handler.
 */

let pass = 0;
let fail = 0;
function ok(cond, label, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}${detail ? `\n  ${detail}` : ''}`); }
}

/* ---- mock RMP ---- */

const SCHOOLS = [
  { id: 'S-MAIN', name: 'University of Pittsburgh', numRatings: 90000 },
  { id: 'S-GBG', name: 'University of Pittsburgh - Greensburg', numRatings: 4000 },
  { id: 'S-BRD', name: 'University of Pittsburgh-Bradford', numRatings: 2500 },
  { id: 'S-JT', name: 'University of Pittsburgh - Johnstown', numRatings: 3000 },
  { id: 'S-CMU', name: 'Carnegie Mellon University', numRatings: 60000 },
];

const TEACHERS = {
  'S-MAIN': [
    { id: 'T-1', firstName: 'Robert', lastName: 'Chen', numRatings: 40 },
    { id: 'T-2', firstName: 'Amanda', lastName: 'Boston', numRatings: 12 },
    { id: 'T-5', firstName: 'Rebecca', lastName: 'Hollis', avgRating: 4.1, numRatings: 12 },
    { id: 'T-6', firstName: 'Robert', lastName: 'Hollis', avgRating: 3.9, numRatings: 15 },
    { id: 'T-7', firstName: 'Nadia', lastName: 'Quill', numRatings: '<img src=x onerror=alert(1)>' },
  ],
  'S-GBG': [
    { id: 'T-3', firstName: 'Kayla', lastName: 'Heffernan', numRatings: 9 },
  ],
  'S-BRD': [
    { id: 'T-4', firstName: 'Jennifer', lastName: 'Sherwood', numRatings: 6 },
  ],
  'S-JT': [],
  'S-CMU': [
    { id: 'T-X', firstName: 'Kayla', lastName: 'Heffernan', numRatings: 50 }, // decoy at another school
  ],
};

// GetTeacher answers. A review's ratingTags is one string joined with "--",
// which is how the real site sends it.
const DETAILS = {
  'T-1': {
    teacherRatingTags: [],
    reviews: [
      ['Clear lectures.', 'Tough grader--Test heavy'],
      ['Hard exams.', 'Tough grader--Lecture heavy'],
      ['Fair enough.', 'Tough grader'],
      ['No tags picked.', ''],
      ['', 'Test heavy--EXTRA CREDIT'], // no comment, but its tags still count
    ],
  },
  'T-2': {
    teacherRatingTags: [{ tagName: 'Caring', tagCount: 4 }, { tagName: 'Respected', tagCount: 7 }],
    reviews: [['Kind and patient.', 'Tough grader']],
  },
};

let requestLog = [];
let rmpDown = false;

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return Object.fromEntries(store);
        return Object.fromEntries([].concat(keys).filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
      },
      async set(items) { for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v)); },
      async remove(keys) { for (const k of [].concat(keys)) store.delete(k); },
    },
  },
  runtime: {
    onMessage: { addListener(fn) { globalThis.chrome.__onMessage = fn; } },
    onInstalled: { addListener() {} },
  },
};

globalThis.fetch = async (url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const reply = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  if (query.includes('SearchSchool')) {
    return reply({ newSearch: { schools: { edges: SCHOOLS.map((node) => ({ node })) } } });
  }
  if (query.includes('GetTeacher')) {
    const detail = DETAILS[variables.id];
    return reply({
      node: detail && {
        id: variables.id, legacyId: 1, firstName: 'A', lastName: 'B', numRatings: detail.reviews.length,
        teacherRatingTags: detail.teacherRatingTags,
        ratings: { edges: detail.reviews.map(([comment, ratingTags]) => ({ node: { class: 'CS1', date: '2025-01-01', comment, ratingTags } })) },
      },
    });
  }
  requestLog.push({ term: variables.text, schoolId: variables.schoolID });
  if (rmpDown) return { ok: false, status: 503, json: async () => ({}) };
  const last = variables.text.split(/\s+/).pop().toLowerCase();
  const school = SCHOOLS.find((s) => s.id === variables.schoolID);
  const nodes = (TEACHERS[variables.schoolID] || [])
    .filter((t) => t.lastName.toLowerCase().includes(last))
    .map((t) => ({ ...t, school: { id: school.id, name: school.name } }));
  return reply({ newSearch: { teachers: { edges: nodes.map((node) => ({ node })) } } });
};

console.error = () => {}; // a failed lookup logs; the outage case below expects one

await import('../src/background.js');

function ask(msg) {
  return new Promise((resolve) => globalThis.chrome.__onMessage(msg, {}, resolve));
}
async function lookup(name, campusHint) {
  requestLog = [];
  const res = await ask({ type: 'LOOKUP', name, campusHint });
  return res.result;
}

/* ---- tests ---- */

const family = (await ask({ type: 'RESOLVE_SCHOOL' })).result.schools;

ok(family.length === 4, 'family: all four Pitt campuses resolved', JSON.stringify(family.map((f) => f.name)));
ok(family[0].id === 'S-MAIN', 'family: main campus ordered first');
ok(!family.some((f) => f.id === 'S-CMU'), 'family: CMU excluded');

// On the real site one of the family's other entries is a second listing of
// the main campus, so the popup's line names the regional campuses uncounted.
{
  const want = 'University of Pittsburgh + regional campuses';
  const label = (await ask({ type: 'RESOLVE_SCHOOL' })).result.schoolLabel;
  ok(label === want, 'label: regional campuses, without a count', label);
  store.set('settings', { ...store.get('settings'), schoolLabel: 'University of Pittsburgh + 3 regional campuses' });
  const again = (await ask({ type: 'RESOLVE_SCHOOL' })).result.schoolLabel;
  ok(again === want && store.get('settings').schoolLabel === want, 'label: a saved label with the old count is rewritten', again);
}

// The Greensburg bug itself.
{
  const r = await lookup('Kayla Heffernan');
  ok(r.status === 'ok' && r.teacher.id === 'T-3', 'greensburg: Kayla Heffernan found under regional campus',
     r.teacher ? r.teacher.id : r.status);
  ok(r.teacher && r.teacher.campus.includes('Greensburg'), 'greensburg: campus attribution correct');
  ok(!requestLog.some((q) => q.schoolId === 'S-CMU'), 'greensburg: never searched outside the family');
}

// The Bradford case from the second screenshot.
{
  const r = await lookup('Jennifer Sherwood');
  ok(r.status === 'ok' && r.teacher.id === 'T-4', 'bradford: found under Pitt-Bradford');
}

// Main-campus professors must not regress, and must stay cheap.
{
  const r = await lookup('Chen, Robert');
  ok(r.status === 'ok' && r.teacher.id === 'T-1', 'main: still found');
  ok(requestLog.length === 1, 'main: exactly one request for the common case',
     `made ${requestLog.length}`);
}

// A genuinely unrated professor: bounded requests, no match.
{
  const r = await lookup('Zorbleflax, Quintus');
  ok(r.status === 'notfound', 'miss: no match invented');
  ok(requestLog.length <= family.length * 2, 'miss: request count bounded',
     `made ${requestLog.length}`);
}

/* ---- campus hint: the request-count optimization ---- */
store.clear(); // drop the cached lookups above; the hint only matters on a cold lookup
await ask({ type: 'RESOLVE_SCHOOL' });
{
  const r = await lookup('Kayla Heffernan', 'Greensburg Campus');
  ok(r.status === 'ok' && r.teacher.id === 'T-3', 'hint: Greensburg professor still found');
  ok(requestLog.length === 1, 'hint: one request when the page names the campus',
     `made ${requestLog.length}`);
  ok(requestLog[0].schoolId === 'S-GBG', 'hint: queried the hinted campus first',
     requestLog[0].schoolId);
}

{
  const r = await lookup('Chen, Robert', 'Pittsburgh Campus');
  ok(r.status === 'ok' && r.teacher.id === 'T-1', 'hint: main-campus professor found');
  ok(requestLog.length === 1, 'hint: still one request for main campus',
     `made ${requestLog.length}`);
}

// A professor whose RMP page is under a different campus than the section:
// the hint must not prevent the fallback from finding them.
{
  const r = await lookup('Jennifer Sherwood', 'Greensburg Campus');
  ok(r.status === 'ok' && r.teacher.id === 'T-4', 'hint: wrong hint still falls back to other campuses',
     r.teacher ? r.teacher.id : r.status);
}

store.clear();
await ask({ type: 'RESOLVE_SCHOOL' });
{
  await lookup('Kayla Heffernan', 'Nonexistent Campus');
  ok(requestLog.length > 1, 'hint: unknown campus falls back to full search');
}

/* ---- two people who share a surname and a first initial ---- */
{
  const a = await lookup('Rebecca Hollis');
  const b = await lookup('Robert Hollis');
  ok(a.teacher?.id === 'T-5' && b.teacher?.id === 'T-6', 'cache: same surname and initial stay two people',
     `${a.teacher?.id} / ${b.teacher?.id}`);
  const again = await lookup('Hollis, Robert');
  ok(again.teacher?.id === 'T-6' && requestLog.length === 0, 'cache: Last, First reuses the First Last entry',
     `${again.teacher?.id}, made ${requestLog.length}`);
}

/* ---- an RMP outage is not a "not found" ---- */
{
  rmpDown = true;
  const during = await lookup('Boston, Amanda');
  ok(during.status === 'error', 'outage: a failed search reports an error', during.status);
  rmpDown = false;
  const after = await lookup('Boston, Amanda');
  ok(after.status === 'ok' && after.teacher.id === 'T-2', 'outage: nothing was cached, the next lookup succeeds',
     after.status);
}

/* ---- numRatings goes into the panel's markup, so it must be a number ---- */
{
  const r = await lookup('Nadia Quill');
  ok(r.status === 'ok' && typeof r.teacher.numRatings === 'number', 'wire: numRatings comes back as a number',
     `${r.status}, ${typeof r.teacher?.numRatings}`);
}

/* ---- tag chips: the teacher's own list when it has one, else counted from the reviews ---- */
{
  const tags = async (teacherId) =>
    ((await ask({ type: 'TEACHER_DETAIL', teacherId })).result.teacher?.tags || []).map((t) => `${t.name} ${t.count}`).join(', ');
  const counted = await tags('T-1');
  ok(counted === 'Tough grader 3, Test heavy 2, Lecture heavy 1, EXTRA CREDIT 1', 'tags: counted from the reviews when the teacher has none',
     counted);
  const own = await tags('T-2');
  ok(own === 'Respected 7, Caring 4', 'tags: the teacher-level list still wins when it is there', own);
}

/* ---- at most 16 comments are cached, so a higher minimum must not block summaries ---- */
{
  store.set('settings', { minRatingsForSummary: 20, aiSummaries: false });
  const teacher = {
    id: 'T-8', firstName: 'Lena', lastName: 'Marsh', avgRating: 4, numRatings: 16,
    ratings: Array.from({ length: 16 }, (_, i) => ({
      class: 'CS0445', date: '2025-01-01', clarityRating: 4, helpfulRating: 4, difficultyRating: 3,
      comment: `Clear lectures and fair exams, review ${i + 1}.`,
    })),
  };
  const r = (await ask({ type: 'SUMMARIZE_TEACHER', teacher })).result;
  ok(r.status === 'ok', 'summary: a saved minimum above 16 is capped at 16', r.status);
  store.delete('settings');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
