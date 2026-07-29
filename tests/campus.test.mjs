/**
 * Reproduces the Greensburg bug end to end: a professor whose RMP page lives
 * under a regional campus must be found even though the main-campus search
 * misses, and request counts must stay sane for the common cases.
 *
 * background.js can't be imported directly (it registers chrome listeners at
 * module scope), so this drives a faithful re-implementation of the cascade
 * against the real names module. If the cascade in background.js changes,
 * update `cascade` here to match -- it is intentionally a copy of that logic.
 */
import * as N from '../src/lib/names.js';

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

let requestLog = [];

function mockSearchTeachers(term, schoolId) {
  requestLog.push({ term, schoolId });
  const last = term.split(/\s+/).pop().toLowerCase();
  return (TEACHERS[schoolId] || []).filter((t) => t.lastName.toLowerCase().includes(last))
    .map((t) => ({ ...t, school: { id: schoolId, name: SCHOOLS.find((s) => s.id === schoolId).name } }));
}

/* ---- family resolution, as background.js does it ---- */

function resolveFamily(schoolName) {
  const base = N.familyBase(schoolName);
  const family = SCHOOLS.filter((r) => N.familyBase(r.name) === base);
  family.sort((a, b) => {
    const aMain = N.normalize(a.name) === base ? 1 : 0;
    const bMain = N.normalize(b.name) === base ? 1 : 0;
    if (aMain !== bMain) return bMain - aMain;
    return (b.numRatings || 0) - (a.numRatings || 0);
  });
  return family.slice(0, 8).map((r) => ({ id: r.id, name: r.name }));
}

/* ---- the lookup cascade, mirroring background.js ---- */

function orderByCampus(schools, hint) {
  if (!hint || schools.length < 2) return schools;
  const needle = N.normalize(String(hint).replace(/\bcampus\b/i, '')).trim();
  if (!needle) return schools;
  const idx = schools.findIndex((sc) => N.normalize(sc.name).includes(needle));
  if (idx <= 0) return schools;
  const copy = schools.slice();
  const [picked] = copy.splice(idx, 1);
  return [picked, ...copy];
}

async function cascade(rawName, schools, campusHint) {
  const parsed = N.parseName(rawName);
  const term = N.searchTerm(parsed);
  const ordered = orderByCampus(schools, campusHint);

  let match = N.pickBest(parsed, mockSearchTeachers(term, ordered[0].id));

  if (!match && ordered.length > 1) {
    const rest = ordered.slice(1).map((sc) => mockSearchTeachers(term, sc.id));
    match = N.pickBest(parsed, rest.flat());
  }

  if (!match && parsed.first) {
    const wide = ordered.map((sc) => mockSearchTeachers(parsed.last, sc.id));
    match = N.pickBest(parsed, wide.flat());
  }

  return match;
}

/* ---- tests ---- */

const family = resolveFamily('University of Pittsburgh');

ok(family.length === 4, 'family: all four Pitt campuses resolved', JSON.stringify(family.map((f) => f.name)));
ok(family[0].id === 'S-MAIN', 'family: main campus ordered first');
ok(!family.some((f) => f.id === 'S-CMU'), 'family: CMU excluded');

// The Greensburg bug itself.
{
  requestLog = [];
  const m = await cascade('Kayla Heffernan', family);
  ok(m && m.node.id === 'T-3', 'greensburg: Kayla Heffernan found under regional campus',
     m ? m.node.id : 'no match');
  ok(m && m.node.school.name.includes('Greensburg'), 'greensburg: campus attribution correct');
  ok(!requestLog.some((r) => r.schoolId === 'S-CMU'), 'greensburg: never searched outside the family');
}

// The Bradford case from the second screenshot.
{
  const m = await cascade('Jennifer Sherwood', family);
  ok(m && m.node.id === 'T-4', 'bradford: found under Pitt-Bradford');
}

// Main-campus professors must not regress, and must stay cheap.
{
  requestLog = [];
  const m = await cascade('Chen, Robert', family);
  ok(m && m.node.id === 'T-1', 'main: still found');
  ok(requestLog.length === 1, 'main: exactly one request for the common case',
     `made ${requestLog.length}`);
}

// A genuinely unrated professor: bounded requests, no match.
{
  requestLog = [];
  const m = await cascade('Zorbleflax, Quintus', family);
  ok(m === null, 'miss: no match invented');
  ok(requestLog.length <= family.length * 2, 'miss: request count bounded',
     `made ${requestLog.length}`);
}

/* ---- campus hint: the request-count optimization ---- */
{
  requestLog = [];
  const m = await cascade('Kayla Heffernan', family, 'Greensburg Campus');
  ok(m && m.node.id === 'T-3', 'hint: Greensburg professor still found');
  ok(requestLog.length === 1, 'hint: one request when the page names the campus',
     `made ${requestLog.length}`);
  ok(requestLog[0].schoolId === 'S-GBG', 'hint: queried the hinted campus first',
     requestLog[0].schoolId);
}

{
  requestLog = [];
  const m = await cascade('Chen, Robert', family, 'Pittsburgh Campus');
  ok(m && m.node.id === 'T-1', 'hint: main-campus professor found');
  ok(requestLog.length === 1, 'hint: still one request for main campus',
     `made ${requestLog.length}`);
}

// A professor whose RMP page is under a different campus than the section:
// the hint must not prevent the fallback from finding them.
{
  requestLog = [];
  const m = await cascade('Jennifer Sherwood', family, 'Greensburg Campus');
  ok(m && m.node.id === 'T-4', 'hint: wrong hint still falls back to other campuses',
     m ? m.node.id : 'no match');
}

{
  requestLog = [];
  await cascade('Kayla Heffernan', family, 'Nonexistent Campus');
  ok(requestLog.length > 1, 'hint: unknown campus falls back to full search');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
