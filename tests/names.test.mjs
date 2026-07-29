import * as N from '../src/lib/names.js';

let pass = 0;
let fail = 0;

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); }
}

function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}`); }
}

/* ---- placeholders ---- */
for (const p of ['Staff', 'STAFF', 'TBA', 'To Be Announced', 'Staff, Staff', ' tbd ', 'TBA - TBA']) {
  ok(N.isPlaceholder(p), `placeholder: ${p}`);
}
ok(!N.isPlaceholder('Smith, John'), 'not placeholder: Smith, John');
ok(!N.isPlaceholder('Stafford, Amy'), 'not placeholder: Stafford (contains staff)');

/* ---- splitting ---- */
eq(N.splitInstructors('Smith, John'), ['Smith, John'], 'split: single Last, First');
eq(N.splitInstructors('John Smith'), ['John Smith'], 'split: single First Last');
eq(N.splitInstructors('Smith, John; Doe, Jane'), ['Smith, John', 'Doe, Jane'], 'split: semicolon');
eq(N.splitInstructors('John Smith and Jane Doe'), ['John Smith', 'Jane Doe'], 'split: and');
eq(N.splitInstructors('John Smith & Jane Doe'), ['John Smith', 'Jane Doe'], 'split: ampersand');
eq(N.splitInstructors('Smith,John/Doe,Jane'), ['Smith,John', 'Doe,Jane'], 'split: slash');
eq(N.splitInstructors('Smith, John, Doe, Jane'), ['Smith, John', 'Doe, Jane'], 'split: paired commas');
eq(N.splitInstructors('Smith, John A'), ['Smith, John A'], 'split: middle initial stays together');

/* ---- parsing ---- */
eq(N.parseName('Smith, John')?.last, 'smith', 'parse: last from Last, First');
eq(N.parseName('Smith, John')?.first, 'john', 'parse: first from Last, First');
eq(N.parseName('John Smith')?.last, 'smith', 'parse: last from First Last');
eq(N.parseName('SMITH,JOHN')?.first, 'john', 'parse: no space after comma');
eq(N.parseName('Smith, John A.')?.middle, 'a', 'parse: middle initial');
eq(N.parseName('Dr. John Smith PhD')?.last, 'smith', 'parse: titles stripped');
eq(N.parseName('van der Berg, Anna')?.last, 'van der berg', 'parse: particle surname (comma form)');
eq(N.parseName('Anna van der Berg')?.last, 'van der berg', 'parse: particle surname (natural form)');
eq(N.parseName('José Muñoz')?.last, 'munoz', 'parse: diacritics stripped');
eq(N.parseName('  Ramirez-Lopez,  Maria  ')?.last, 'ramirez-lopez', 'parse: hyphenated surname');
ok(N.parseName('Staff') === null, 'parse: placeholder rejected');
eq(N.parseName('Chen')?.last, 'chen', 'parse: surname only');

/* ---- matching ---- */
const teacher = (firstName, lastName, numRatings = 20) => ({
  id: `T-${lastName}-${firstName}`, firstName, lastName, numRatings,
});

function best(raw, candidates) {
  const parsed = N.parseName(raw);
  const r = N.pickBest(parsed, candidates);
  return r ? `${r.node.firstName} ${r.node.lastName}:${r.confidence}` : null;
}

eq(best('Smith, John', [teacher('John', 'Smith')]), 'John Smith:high', 'match: exact');
eq(best('Smith, J', [teacher('John', 'Smith')]), 'John Smith:high', 'match: first initial');
eq(best('Smith, Christopher', [teacher('Chris', 'Smith')]), 'Chris Smith:high', 'match: prefix nickname');
eq(best('Smith, Robert', [teacher('Bob', 'Smith')]), 'Bob Smith:high', 'match: nickname table');
eq(best('Smyth, John', [teacher('John', 'Smith')]), 'John Smith:high', 'match: surname typo distance 1');
eq(best('Smith, John', [teacher('Jane', 'Smith')]), null, 'match: wrong first name rejected');
eq(best('Smith, John', [teacher('John', 'Jones')]), null, 'match: wrong surname rejected');

// Two identical John Smiths genuinely is ambiguous -- expect low confidence,
// not a confident pick.
eq(
  best('Smith, John', [teacher('John', 'Smith', 30), teacher('John', 'Smith', 28)]),
  'John Smith:low',
  'match: identical duplicates flagged low'
);
const dupParsed = N.parseName('Smith, John');
const dupResult = N.pickBest(dupParsed, [teacher('John', 'Smith', 30), teacher('John', 'Smith', 29)]);
ok(dupResult.confidence === 'low', 'match: near-tie flagged low confidence');

// Correct person picked out of a crowd of same-surname professors.
eq(
  best('Chen, Wei', [teacher('Ming', 'Chen', 50), teacher('Wei', 'Chen', 4), teacher('Li', 'Chen', 90)]),
  'Wei Chen:high',
  'match: first name beats rating volume'
);

// Initial-only should not confidently pick between two different first names.
const initParsed = N.parseName('Chen, W');
const initResult = N.pickBest(initParsed, [teacher('Wei', 'Chen', 20), teacher('Wendy', 'Chen', 18)]);
ok(initResult && initResult.confidence === 'low', 'match: shared initial flagged low confidence');

/* ---- end to end on realistic cell text ---- */
const cells = [
  'Smith, John A',
  'STAFF',
  'Ramirez-Lopez, Maria; Chen, Wei',
  'To Be Announced',
  'van der Berg, Anna',
  'Doe, Jane and Roe, Richard',
];
const expanded = cells.flatMap((c) =>
  N.isPlaceholder(c) ? [] : N.splitInstructors(c).map(N.parseName).filter(Boolean)
);
eq(expanded.length, 6, 'e2e: correct number of instructors extracted');
eq(
  expanded.map((p) => p.last),
  ['smith', 'ramirez-lopez', 'chen', 'van der berg', 'doe', 'roe'],
  'e2e: surnames'
);
eq(
  expanded.map((p) => p.first),
  ['john', 'maria', 'wei', 'anna', 'jane', 'richard'],
  'e2e: given names'
);


/* ---- school family base ---- */
eq(N.familyBase('University of Pittsburgh'), 'university of pittsburgh', 'family: main campus');
eq(N.familyBase('University of Pittsburgh - Greensburg'), 'university of pittsburgh', 'family: spaced hyphen suffix');
eq(N.familyBase('University of Pittsburgh-Bradford'), 'university of pittsburgh', 'family: tight hyphen suffix');
eq(N.familyBase('University of Pittsburgh – Johnstown'), 'university of pittsburgh', 'family: en dash');
eq(N.familyBase('Indiana University at Bloomington'), 'indiana university', 'family: "at" campus form');
ok(N.familyBase('Carnegie Mellon University') !== N.familyBase('University of Pittsburgh'), 'family: different schools stay distinct');


/* ---- person-name validation: every string from the bug screenshots ---- */
const MUST_REJECT = [
  'AT', 'MoWeFr', 'TuTh', 'Mo', 'Th',
  '8:00 am', '2:00 pm', '08/24 - 12/04',
  '124 Biddle Hall', '100 Biddle Hall', '111 Broadhurst',
  'Broadhurst Science Center', 'WEB Based Class',
  'Titusville Campus', 'Pittsburgh Campus', 'Greensburg Campus',
  'MANAGERIAL ACCOUNTING', 'ACCOUNTING PRINCIPLES 1', 'DIRECTED STUDY',
  'Fall, Spring', 'Fall Term 2026-2027', 'Fall, Spring, Summer',
  'View Sections', 'Typically Offered', '3010 - LEC (15437)',
  '7/20', '32/40', 'Course Catalog', 'Undergraduate',
];
for (const t of MUST_REJECT) {
  ok(!N.looksLikePersonName(t), `reject non-name: "${t}"`);
}

const MUST_ACCEPT = [
  'Kayla Heffernan', 'Jennifer Sherwood', 'Deborah Zakrzwski',
  'Cristina DeDiana', 'Nancy Tress', 'Kristen Reynolds',
  'Eric Beeko', 'Grace Mkomwa', 'Filipo Lubua', 'Gamby Camara',
  'Smith, John', 'van der Berg, Anna', "O'Connell, James",
  'Ramirez-Lopez, Maria', 'McDonald, Sarah', 'Desmond Tutu',
  'Chen', 'DiCaprio',
];
for (const t of MUST_ACCEPT) {
  ok(N.looksLikePersonName(t), `accept real name: "${t}"`);
}


/* ---- comma-joined full names (the AFROTC screenshot) ---- */
eq(N.splitInstructors('Jamie Torres Rivera, Kendon Freeman'),
   ['Jamie Torres Rivera', 'Kendon Freeman'], 'split: two full names joined by comma');
eq(N.splitInstructors('Eric Beeko, Grace Mkomwa'),
   ['Eric Beeko', 'Grace Mkomwa'], 'split: two 2-word names joined by comma');
eq(N.splitInstructors('Torres Rivera, Kendon'),
   ['Torres Rivera, Kendon'], 'split: multi-word surname Last-First stays one person');
eq(N.splitInstructors('van der Berg, Anna'),
   ['van der Berg, Anna'], 'split: particle surname Last-First stays one person');
eq(N.splitInstructors('Smith, John A'),
   ['Smith, John A'], 'split: Last, First Middle still one person');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);



