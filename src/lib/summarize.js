/**
 * Non-model summarizer.
 *
 * The previous version described the reviews ("reviewers often mention exams")
 * without characterizing them. This one does four things that carry real
 * information and still cannot hallucinate, because every claim is either a
 * counted statistic or a verbatim quote:
 *
 *   1. Aspect sentiment  -- for each topic, is the sentiment positive or
 *                           negative, how many reviewers said so, and one
 *                           representative sentence in their own words.
 *   2. Per-course stats  -- a professor can be great in one course and awful
 *                           in another, which matters when you are registering
 *                           for a specific course.
 *   3. Recency trend     -- teaching changes; old reviews can be misleading.
 *   4. Extractive picks  -- the most representative sentences across the
 *                           corpus, chosen for coverage and non-redundancy.
 */

/* ------------------------------------------------------------------ */
/* Lexicons                                                            */
/* ------------------------------------------------------------------ */

const ASPECTS = [
  { key: 'exams', label: 'Exams', words: ['exam', 'midterm', 'final', 'quiz', 'quizzes', 'test', 'tests', 'testing'] },
  { key: 'grading', label: 'Grading', words: ['grade', 'grades', 'grading', 'grader', 'curve', 'curved', 'rubric', 'points'] },
  { key: 'lectures', label: 'Lectures', words: ['lecture', 'lecturing', 'slide', 'teach', 'explain', 'presentation'] },
  { key: 'workload', label: 'Workload', words: ['homework', 'assignment', 'assignments', 'workload', 'reading', 'readings', 'paper', 'papers', 'essay', 'essays', 'project', 'projects', 'lab', 'labs'] },
  { key: 'support', label: 'Availability', words: ['officehours', 'email', 'emails', 'responsive', 'available', 'approachable', 'accessible', 'answers'] },
  { key: 'clarity', label: 'Clarity', words: ['clear', 'unclear', 'confusing', 'organized', 'disorganized', 'understand', 'understandable', 'follow'] },
  { key: 'attendance', label: 'Attendance', words: ['attendance', 'mandatory', 'participation', 'attend', 'skip'] },
];

const POSITIVE = new Map(Object.entries({
  great: 2, amazing: 2, excellent: 2, best: 2, love: 2, loved: 2, fantastic: 2,
  wonderful: 2, awesome: 2, brilliant: 2, incredible: 2,
  good: 1, helpful: 1.5, clear: 1.5, fair: 1.5, engaging: 1.5, funny: 1,
  kind: 1.5, caring: 1.5, passionate: 1.5, nice: 1, easy: 1, organized: 1.5,
  interesting: 1.5, recommend: 2, enjoyable: 1.5, approachable: 1.5,
  knowledgeable: 1.5, responsive: 1.5, reasonable: 1, straightforward: 1,
  generous: 1.5, lenient: 1, understanding: 1.5, enthusiastic: 1.5,
}));

const NEGATIVE = new Map(Object.entries({
  terrible: 2, awful: 2, worst: 2, horrible: 2, hate: 2, hated: 2, avoid: 2,
  useless: 2, nightmare: 2, disaster: 2,
  boring: 1.5, confusing: 1.5, unclear: 1.5, rude: 2, harsh: 1.5, unfair: 2,
  disorganized: 1.5, monotone: 1.5, rambles: 1.5, rambling: 1.5, dry: 1,
  difficult: 1, hard: 1, tough: 1, brutal: 2, impossible: 2, pointless: 1.5,
  unhelpful: 2, unresponsive: 1.5, condescending: 2, rushed: 1, dull: 1.5,
  frustrating: 1.5, overwhelming: 1.5, tedious: 1.5, arrogant: 2,
}));

const NEGATORS = new Set(["not", "no", "never", "isn't", "isnt", "wasn't", "wasnt",
  "doesn't", "doesnt", "didn't", "didnt", "won't", "wont", "can't", "cant",
  "cannot", "hardly", "barely", "rarely", "without", "lacks", "lacked"]);

const STOPWORDS = new Set(['the','a','an','and','or','but','if','then','than','so','because',
  'is','are','was','were','be','been','being','to','of','in','on','at','for','with','about',
  'as','by','from','up','down','out','over','under','it','its','this','that','these','those',
  'i','you','he','she','they','we','me','him','her','them','us','my','your','his','their','our',
  'do','does','did','have','has','had','will','would','can','could','should','shall','may','might',
  'very','really','just','also','too','more','most','much','many','some','any','all','no','not',
  'he/she','class','professor','prof','teacher','course','take','took','taking','get','got','make']);

// Multiword phrases collapsed to single tokens before scoring.
const PHRASES = [
  [/office\s+hours?/gi, 'officehours'],
  [/easy\s+a\b/gi, 'easy'],
  [/pop\s+quiz(zes)?/gi, 'quiz'],
  [/extra\s+credit/gi, 'generous'],
  [/problem\s+sets?/gi, 'homework'],
  [/group\s+projects?/gi, 'project'],
  [/waste\s+of\s+time/gi, 'useless'],
  [/hard\s+to\s+follow/gi, 'confusing'],
  [/all\s+over\s+the\s+place/gi, 'disorganized'],
];

/* ------------------------------------------------------------------ */
/* Text utilities                                                      */
/* ------------------------------------------------------------------ */

function normalizeText(s) {
  let t = String(s || '');
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  return t;
}

function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+|(?<=\w)\s*;\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 18 && s.length <= 260 && /[a-z]/i.test(s));
}

/** Crude suffix stripper so 'exams' matches 'exam' and 'lectures' matches 'lecture'. */
function stem(w) {
  return w
    .replace(/ies$/, 'y')
    .replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2))
    .replace(/([^s])s$/, '$1')
    .replace(/(ing|ed)$/, '');
}

/** Tokens for ANALYSIS only. Quoting always uses the untouched sentence. */
function tokens(s) {
  const raw = normalizeText(String(s)).toLowerCase().match(/[a-z']+/g) || [];
  return raw.map(stem);
}

// Lexicons are stemmed once at load so both sides of every comparison match.
const STEMMED_ASPECTS = ASPECTS.map((a) => ({ ...a, stems: new Set(a.words.map(stem)) }));
const POS_STEM = new Map([...POSITIVE].map(([k, v]) => [stem(k), v]));
const NEG_STEM = new Map([...NEGATIVE].map(([k, v]) => [stem(k), v]));
const NEGATOR_STEM = new Set([...NEGATORS].map(stem));

/** Sentiment of one sentence, with a negation window. */
function polarity(sentence) {
  const toks = tokens(sentence);
  let score = 0;
  let hits = 0;

  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    let val = 0;
    if (POS_STEM.has(w)) val = POS_STEM.get(w);
    else if (NEG_STEM.has(w)) val = -NEG_STEM.get(w);
    if (!val) continue;

    const back = toks.slice(Math.max(0, i - 3), i);
    if (back.some((t) => NEGATOR_STEM.has(t))) val = -val * 0.85;

    score += val;
    hits += 1;
  }
  return { score, hits };
}

function aspectsIn(sentence) {
  const toks = new Set(tokens(sentence));
  return STEMMED_ASPECTS.filter((a) => [...a.stems].some((w) => toks.has(w)));
}

/* ------------------------------------------------------------------ */
/* Aspect analysis                                                     */
/* ------------------------------------------------------------------ */

function analyzeAspects(allSentences) {
  const buckets = new Map();

  for (const s of allSentences) {
    const p = polarity(s);
    for (const aspect of aspectsIn(s)) {
      if (!buckets.has(aspect.key)) {
        buckets.set(aspect.key, { label: aspect.label, mentions: 0, score: 0, pos: [], neg: [] });
      }
      const b = buckets.get(aspect.key);
      b.mentions += 1;
      b.score += p.score;
      if (p.score >= 1.5) b.pos.push({ text: s, score: p.score });
      else if (p.score <= -1.5) b.neg.push({ text: s, score: p.score });
    }
  }

  const out = [];
  const usedQuotes = new Set();

  for (const [, b] of buckets) {
    if (b.mentions < 2) continue;

    const avg = b.score / b.mentions;
    let sentiment;
    if (avg >= 0.6) sentiment = 'positive';
    else if (avg <= -0.6) sentiment = 'negative';
    else if (b.pos.length && b.neg.length) sentiment = 'mixed';
    else sentiment = 'neutral';

    // Quote the strongest sentence on the dominant side.
    const pool = sentiment === 'negative' ? b.neg : sentiment === 'positive' ? b.pos : [...b.neg, ...b.pos];
    pool.sort((x, y) => Math.abs(y.score) - Math.abs(x.score));

    // One sentence often matches several aspects; don't print it repeatedly.
    const fresh = pool.find((p) => !usedQuotes.has(p.text));
    if (fresh) usedQuotes.add(fresh.text);

    out.push({
      label: b.label,
      sentiment,
      mentions: b.mentions,
      quote: fresh ? trimQuote(fresh.text) : null,
    });
  }

  return out.sort((a, b) => b.mentions - a.mentions).slice(0, 5);
}

function trimQuote(s) {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 180 ? `${t.slice(0, 177)}…` : t;
}

/* ------------------------------------------------------------------ */
/* Extractive picks (maximal marginal relevance)                       */
/* ------------------------------------------------------------------ */

function representative(allSentences, count = 2) {
  if (allSentences.length <= count) return allSentences.map(trimQuote);

  const df = new Map();
  const bags = allSentences.map((s) => {
    const set = new Set(tokens(s).filter((t) => t.length > 2 && !STOPWORDS.has(t)));
    for (const t of set) df.set(t, (df.get(t) || 0) + 1);
    return set;
  });

  // Prefer sentences built from terms that many other reviewers also used.
  const scores = bags.map((bag) => {
    let s = 0;
    for (const t of bag) s += df.get(t) || 0;
    return bag.size ? s / Math.sqrt(bag.size) : 0;
  });

  const picked = [];
  const used = new Set();

  while (picked.length < count) {
    let bestIdx = -1;
    let bestVal = -Infinity;

    for (let i = 0; i < bags.length; i++) {
      if (used.has(i)) continue;
      let redundancy = 0;
      for (const j of used) {
        redundancy = Math.max(redundancy, jaccard(bags[i], bags[j]));
      }
      const val = scores[i] * (1 - redundancy);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    used.add(bestIdx);
    picked.push(trimQuote(allSentences[bestIdx]));
  }

  return picked;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/* ------------------------------------------------------------------ */
/* Per-course and trend                                                */
/* ------------------------------------------------------------------ */

function ratingQuality(r) {
  const vals = [r.clarityRating, r.helpfulRating].filter((v) => typeof v === 'number' && v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function byCourse(ratings) {
  const groups = new Map();
  for (const r of ratings) {
    const code = String(r.class || '').trim().toUpperCase();
    if (!code || code === '-') continue;
    if (!groups.has(code)) groups.set(code, { code, n: 0, sum: 0, scored: 0, diffSum: 0, diffN: 0 });
    const g = groups.get(code);
    g.n += 1;
    const q = ratingQuality(r);
    if (q !== null) { g.sum += q; g.scored += 1; }
    if (typeof r.difficultyRating === 'number' && r.difficultyRating > 0) {
      g.diffSum += r.difficultyRating;
      g.diffN += 1;
    }
  }

  return Array.from(groups.values())
    .filter((g) => g.n >= 2)
    .map((g) => ({
      code: g.code,
      count: g.n,
      avg: g.scored ? Number((g.sum / g.scored).toFixed(1)) : null,
      difficulty: g.diffN ? Number((g.diffSum / g.diffN).toFixed(1)) : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function trend(ratings) {
  const dated = ratings
    .map((r) => ({ t: Date.parse(r.date), q: ratingQuality(r) }))
    .filter((x) => Number.isFinite(x.t) && x.q !== null)
    .sort((a, b) => a.t - b.t);

  if (dated.length < 8) return null;

  const mid = Math.floor(dated.length / 2);
  const older = dated.slice(0, mid);
  const newer = dated.slice(mid);
  const mean = (arr) => arr.reduce((s, x) => s + x.q, 0) / arr.length;

  const delta = mean(newer) - mean(older);
  if (Math.abs(delta) < 0.5) return null;

  const spanYears = (dated[dated.length - 1].t - dated[0].t) / (365.25 * 24 * 3600 * 1000);
  if (spanYears < 0.75) return null;

  return delta > 0
    ? `Recent reviews are notably better than older ones (+${delta.toFixed(1)} over about ${Math.round(spanYears)} year${Math.round(spanYears) === 1 ? '' : 's'}).`
    : `Recent reviews are notably worse than older ones (${delta.toFixed(1)} over about ${Math.round(spanYears)} year${Math.round(spanYears) === 1 ? '' : 's'}).`;
}

/* ------------------------------------------------------------------ */
/* Headline                                                            */
/* ------------------------------------------------------------------ */

function headline(teacher, aspects) {
  const r = teacher.avgRating;
  const wta = teacher.wouldTakeAgainPercent;
  const n = teacher.numRatings || 0;

  if (r === null || r === undefined) {
    return `Too few ratings (${n}) to draw a conclusion.`;
  }

  const worst = aspects.find((a) => a.sentiment === 'negative');
  const best = aspects.find((a) => a.sentiment === 'positive');

  let base;
  if (r >= 4.2) base = `Strongly rated at ${r.toFixed(1)}/5`;
  else if (r >= 3.5) base = `Well rated at ${r.toFixed(1)}/5`;
  else if (r >= 2.5) base = `Mixed at ${r.toFixed(1)}/5`;
  else base = `Poorly rated at ${r.toFixed(1)}/5`;

  if (wta !== null && wta !== undefined) base += `, ${wta}% would retake`;
  base += '.';

  if (best && worst) base += ` ${best.label} draw praise, ${worst.label.toLowerCase()} draw complaints.`;
  else if (worst) base += ` Main complaint is ${worst.label.toLowerCase()}.`;
  else if (best) base += ` Most praised: ${best.label.toLowerCase()}.`;

  if (n < 5) base += ` Only ${n} rating${n === 1 ? '' : 's'}, so treat as anecdotal.`;

  return base;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function heuristicSummary(teacher) {
  const ratings = (teacher.ratings || []).filter((r) => r && r.comment);
  const allSentences = ratings.flatMap((r) => sentences(r.comment));

  const aspects = analyzeAspects(allSentences);
  const courses = byCourse(ratings);
  const movement = trend(ratings);
  const quotes = representative(allSentences, 2);

  const tags = (teacher.tags || []).slice(0, 4).map((t) => t.name);

  return {
    headline: headline(teacher, aspects),
    aspects,
    courses: courses.length > 1 ? courses : [],
    trend: movement,
    quotes,
    tags,
    reviewsAnalyzed: ratings.length,
  };
}
