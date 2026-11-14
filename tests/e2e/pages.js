// A stand-in class-search page with the markup the real one has today, and
// canned answers for the three RateMyProfessors queries the extension sends.
// The real page is a HighPoint CX app: one table with role=treegrid, MUI class
// names, and each cell's text five elements below its td. Every name here is
// invented.

export const CLASS_SEARCH_URL =
  'https://pitcsprd.csps.pitt.edu/psc/pitcsprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main';

// [campus, section, days, start, end, instructor, seats]
const ROWS = [
  ['Pittsburgh Campus', '1010 - LEC (20101)', 'MoWe', '9:00 am', '10:15 am', 'Maria Okafor', '12/40'],
  ['Pittsburgh Campus', '1020 - LEC (20102)', 'TuTh', '11:00 am', '12:15 pm', 'Daniel Whitcombe', '3/40'],
  ['Pittsburgh Campus', '1030 - LEC (20103)', 'MoWeFr', '1:00 pm', '1:50 pm', 'Rebecca Hollis', '0/35'],
  ['Pittsburgh Campus', '1040 - LEC (20104)', 'TuTh', '2:30 pm', '3:45 pm', 'Robert Hollis', '9/35'],
  ['Greensburg Campus', '2010 - LEC (20105)', 'MoWe', '3:00 pm', '4:15 pm', 'Priya Raman', '20/30'],
  ['Pittsburgh Campus', '1050 - REC (20106)', 'Fr', '10:00 am', '10:50 am', 'To Be Announced', '5/25'],
  ['Pittsburgh Campus', '1055 - REC (20108)', 'Fr', '11:00 am', '11:50 am', 'Staff', '2/25'],
  ['Pittsburgh Campus', '1060 - LEC (20107)', 'Th', '6:00 pm', '8:30 pm', 'Quentin Zarbalas', '1/25'],
];

// What each row's badge should read once every lookup has settled.
export const EXPECTED_BADGES = {
  'Maria Okafor': '4.6',
  'Daniel Whitcombe': '2.4',
  'Rebecca Hollis': '4.1',
  'Robert Hollis': '3.9',
  'Priya Raman': '3.4',
  'To Be Announced': null,
  Staff: null,
  'Quentin Zarbalas': 'no RMP',
};

const GRID_ID = '5f0c2a9e-7b41-4d38-9a66-0d1e2f3a4b5c';
const TEXT = 'cx-MuiTypography-root cx-MuiTypography-body1 cx-MuiTypography-noWrap';
const CELL = 'cx-MuiTableCell-root cx-MuiTableCell-body';
// [heading, the key in the ids of its cells]. Only the keys seen on the real page are given.
const HEADS = [['Campus', 'CAMPUS'], ['Section', 'CLASS_SECTION'], ['Topic'], ['Days'], ['Start'], ['End'], ['Instructor', 'INSTRUCTOR'], ['Dates'], ['Session'], ['Status']];

const text = (value) => `<span title="${value}" class=""><div class="${TEXT}" aria-hidden="false">${value}</div></span>`;

// The campus cell holds its text three elements down. Every other cell wraps
// it in a grid container and a grid item first, which makes five.
const nested = (value) =>
  `<div class="${TEXT}"><div class="cx-MuiGrid-root cx-MuiGrid-container cx-MuiGrid-spacing-xs-1 cx-MuiGrid-align-items-xs-center cx-MuiGrid-justify-content-xs-space-between"><div class="cx-MuiGrid-root cx-MuiGrid-item cx-MuiGrid-grid-xs-12">${text(value)}</div></div></div>`;

function sectionRow([campus, section, days, start, end, instructor, seats], i, all) {
  const id = `${GRID_ID}-${i}`;
  const cell = (value, key) => `<td class="${CELL}" role="gridcell"${key ? ` id="${id}_${key}"` : ''} tabindex="-1">${nested(value)}</td>`;
  return `<tr class="cx-MuiTableRow-root" id="${id}" data-row-id="${i}" aria-level="1" aria-posinset="${i + 1}" aria-setsize="${all.length}" aria-expanded="false" tabindex="-1">
        <td class="${CELL}" role="gridcell" id="${id}-expand" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.29 6.71a.996.996 0 0 0 0 1.41L13.17 12l-3.88 3.88a.996.996 0 1 0 1.41 1.41l4.59-4.59a.996.996 0 0 0 0-1.41L10.7 6.7c-.38-.38-1.02-.38-1.41.01z"></path></svg></td>
        <td class="${CELL}" role="rowheader" id="${id}_CAMPUS" tabindex="-1"><div class="${TEXT}">${text(campus)}</div></td>
        ${cell(section, 'CLASS_SECTION')}${cell('-')}${cell(days)}${cell(start)}${cell(end)}
        ${cell(instructor, 'INSTRUCTOR')}
        ${cell('01/11 - 04/23')}${cell('AT')}${cell(seats)}
        <td class="${CELL}" role="gridcell"><span class="sr-only">Actions for section ${section}</span></td>
      </tr>`;
}

// `rows` defaults to the invented ones. The demo's live mode passes its own.
export function classSearchPage(rows = ROWS) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Class Search</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { font: 15px/24px "Segoe UI", Arial, Helvetica, sans-serif; color: #1f2430; background: #f4f5f9; overflow: hidden; }
  /* The real page scrolls inside div#app, not the window. */
  #app { height: 100%; overflow: auto; }
  .bar { background: #fff; border-bottom: 1px solid #dfe2ea; padding: 20px 16px; font-size: 20px; }
  main { padding: 8px 16px 24px; }
  h2 { font-size: 20px; font-weight: 400; margin: 0; }
  .py-3 { padding: 16px 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* What the page's own stylesheet does for these class names: equal columns
     that do not grow with their text, every cell on one line with an ellipsis. */
  .cx-MuiTable-root { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0 8px; }
  .cx-MuiTableCell-root { padding: 0; text-align: left; }
  .cx-MuiTableCell-root:first-child { width: 40px; }
  .cx-MuiTableCell-head { padding: 10px 0 2px; }
  .cx-MuiTableCell-head button { all: unset; cursor: pointer; }
  .cx-MuiTypography-h4 { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #4b5162; }
  /* A row is 63 px with one line of text and about 71 px with two, as on the page. */
  tbody .cx-MuiTableRow-root { height: 63px; }
  .cx-MuiTableCell-body { padding: 11px 0 12px; background: #fff; vertical-align: middle; }
  .cx-MuiTableCell-body svg { display: block; width: 24px; height: 24px; margin: 0 auto; color: #5a6079; }
  .cx-MuiTypography-body1 { font-size: 15px; line-height: 24px; }
  .cx-MuiTypography-noWrap { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cx-MuiGrid-container { box-sizing: border-box; display: flex; flex-wrap: wrap; width: 100%; }
  .cx-MuiGrid-item { box-sizing: border-box; margin: 0; }
  .cx-MuiGrid-spacing-xs-1 { width: calc(100% + 8px); margin: -4px; }
  .cx-MuiGrid-spacing-xs-1 > .cx-MuiGrid-item { padding: 4px; }
  .cx-MuiGrid-grid-xs-12 { flex-grow: 0; max-width: 100%; flex-basis: 100%; }
  .cx-MuiGrid-wrap-xs-nowrap { flex-wrap: nowrap; }
  .cx-MuiGrid-align-items-xs-center { align-items: center; }
  .cx-MuiGrid-justify-content-xs-space-between { justify-content: space-between; }
</style></head><body>
<div id="app">
  <div class="bar">Class Search</div>
  <main>
    <h2 class="cx-MuiTypography-root py-3 cx-MuiTypography-h2">INTERMEDIATE PROGRAMMING | CS 0445</h2>
    <table class="cx-MuiTable-root" role="treegrid">
      <thead><tr class="cx-MuiTableRow-root cx-MuiTableRow-head">
        <th class="cx-MuiTableCell-root cx-MuiTableCell-head"><span class="sr-only">Expand/Collapse</span></th>
        ${HEADS.map(([head, key]) => `<th class="cx-MuiTableCell-root cx-MuiTableCell-head" aria-sort="none" role="columnheader" scope="col"${key ? ` id="${GRID_ID}-${key}"` : ''} tabindex="-1"><div class="cx-MuiGrid-root cx-MuiGrid-container cx-MuiGrid-wrap-xs-nowrap cx-MuiGrid-align-items-xs-center"><div class="cx-MuiGrid-root cx-MuiGrid-item"><button class="cx-MuiButtonBase-root cx-MuiButton-root cx-MuiButton-text" tabindex="0" type="button"><span class="cx-MuiButton-label"><span class="cx-MuiTypography-root cx-MuiTypography-h4">${head}</span></span></button></div></div></th>`).join('\n        ')}
        <th class="cx-MuiTableCell-root cx-MuiTableCell-head" role="columnheader" scope="col"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>
      ${rows.map(sectionRow).join('\n      ')}
      </tbody>
    </table>
  </main>
</div></body></html>`;
}

// The six listings RateMyProfessors has for Pitt today. The last one is a
// second listing of the main campus, trailing space included.
const SCHOOLS = [
  { id: 'U2Nob29sLTEyNDc=', name: 'University of Pittsburgh', city: 'Pittsburgh', state: 'PA', numRatings: 90000 },
  { id: 'U2Nob29sLTEyNDk=', name: 'University of Pittsburgh at Johnstown', city: 'Johnstown', state: 'PA', numRatings: 4500 },
  { id: 'U2Nob29sLTEyNDg=', name: 'University of Pittsburgh at Greensburg', city: 'Greensburg', state: 'PA', numRatings: 4000 },
  { id: 'U2Nob29sLTEyNTA=', name: 'University of Pittsburgh at Bradford', city: 'Bradford', state: 'PA', numRatings: 2500 },
  { id: 'U2Nob29sLTEyNTE=', name: 'University of Pittsburgh at Titusville', city: 'Titusville', state: 'PA', numRatings: 600 },
  { id: 'U2Nob29sLTEyNTI=', name: 'University of Pittsburgh at Oakland ', city: 'Pittsburgh', state: 'PA', numRatings: 40 },
];

export const GREENSBURG_ID = SCHOOLS[2].id;

// [firstName, lastName, department, avgRating, avgDifficulty, numRatings, wouldTakeAgain, school index]
const TEACHERS = [
  ['Maria', 'Okafor', 'Computer Science', 4.6, 3.1, 48, 91.3, 0],
  ['Daniel', 'Whitcombe', 'Computer Science', 2.4, 4.3, 37, 28, 0],
  ['Rebecca', 'Hollis', 'Computer Science', 4.1, 2.8, 12, 80, 0],
  ['Robert', 'Hollis', 'Computer Science', 3.9, 3.0, 15, 70, 0],
  ['Priya', 'Raman', 'Mathematics', 3.4, 3.6, 21, 55, 2],
].map(([firstName, lastName, department, avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent, school], i) => ({
  id: `VGVhY2hlci0${i + 1}`,
  legacyId: 100001 + i,
  firstName,
  lastName,
  department,
  avgRating,
  avgDifficulty,
  numRatings,
  wouldTakeAgainPercent,
  school,
}));

// [class, comment, clarity, helpful, difficulty, ratingTags], keyed by teacher
// index. ratingTags is the review's own tags as RateMyProfessors sends them:
// one string, joined with "--".
const COMMENTS = [
  [
    ['CS0445', 'Her lectures are clear and organized, and she explains every step.', 5, 5, 3, 'Amazing lectures--Clear grading criteria'],
    ['CS0445', 'Exams are fair if you do the homework. Great professor.', 5, 5, 3, 'Clear grading criteria--Caring'],
    ['CS0445', 'Very helpful in office hours and responsive over email.', 5, 5, 3, 'Accessible outside class--Caring'],
    ['CS1501', 'The projects are interesting and the workload is reasonable.', 4, 5, 4, 'Clear grading criteria'],
    ['CS1501', 'Clear lectures, tough exams. I would recommend her to anyone.', 4, 4, 4, 'Amazing lectures--Test heavy'],
    ['CS0445', 'Homework takes time but the lectures make it easy to follow.', 5, 5, 3, 'Amazing lectures'],
    ['CS1501', 'Best professor I have had. Approachable and kind.', 5, 5, 3, 'Caring--Accessible outside class'],
    ['CS0445', 'Attendance is not mandatory but you should go, the lectures are engaging.', 5, 4, 3, ''],
  ],
  [
    ['CS0447', 'His lectures aren’t clear and he doesn’t explain anything.', 1, 2, 5],
    ['CS0447', 'The exams are brutal and the grading is unfair.', 2, 1, 5],
    ['CS0447', 'Lectures are confusing and disorganized. Avoid if you can.', 1, 1, 5],
    ['CS0447', 'I wouldn’t recommend his lectures to anyone.', 2, 2, 4],
    ['CS0447', 'Homework is tedious and the projects are overwhelming.', 2, 2, 5],
  ],
  [
    ['CS0445', 'Clear and helpful, exams were fair.', 5, 4, 3],
    ['CS0445', 'Good lectures and fair grading.', 4, 4, 3],
    ['CS0445', 'Explains well, homework is reasonable.', 4, 4, 2],
  ],
  [
    ['CS0445', 'Lectures were fine, exams were hard.', 4, 3, 4],
    ['CS0445', 'He is approachable in office hours.', 4, 4, 3],
  ],
  [
    ['MATH0220', 'Fair exams and clear lectures.', 4, 3, 3],
    ['MATH0220', 'The homework is long.', 3, 3, 4],
    ['MATH0220', 'Helpful and kind.', 4, 4, 3],
  ],
];

const json = (data) => ({ status: 200, type: 'application/json', body: JSON.stringify({ data }) });
const withoutSchool = ({ school, ...t }) => t;

/** Answers one POST to https://www.ratemyprofessors.com/graphql. */
export function answerGraphql(postData) {
  const { query = '', variables = {} } = JSON.parse(postData || '{}');

  if (query.includes('SearchSchool')) {
    return json({ newSearch: { schools: { edges: SCHOOLS.map((node) => ({ node })) } } });
  }

  if (query.includes('SearchTeacher')) {
    const school = SCHOOLS.findIndex((s) => s.id === variables.schoolID);
    const words = String(variables.text).toLowerCase().split(/\s+/);
    const nodes = TEACHERS.filter((t) => t.school === school && words.includes(t.lastName.toLowerCase())).map((t) => ({
      ...withoutSchool(t),
      school: { id: SCHOOLS[school].id, name: SCHOOLS[school].name },
    }));
    return json({ newSearch: { teachers: { edges: nodes.map((node) => ({ node })) } } });
  }

  if (query.includes('GetTeacher')) {
    const i = TEACHERS.findIndex((t) => t.id === variables.id);
    if (i === -1) return json({ node: null });
    const ratings = COMMENTS[i].map(([cls, comment, clarityRating, helpfulRating, difficultyRating, ratingTags = ''], n) => ({
      class: cls,
      date: `2025-0${n + 1}-15 12:00:00 +0000 UTC`,
      comment,
      clarityRating,
      helpfulRating,
      difficultyRating,
      wouldTakeAgain: 1,
      grade: 'A',
      isForOnlineClass: false,
      ratingTags,
    }));
    return json({
      node: {
        ...withoutSchool(TEACHERS[i]),
        // The first professor answers the way the real site has been seen to:
        // no tags on the teacher, only on the reviews.
        teacherRatingTags: i === 0 ? [] : [
          { tagName: 'Clear grading criteria', tagCount: 9 },
          { tagName: 'Lecture heavy', tagCount: 6 },
        ],
        ratings: { edges: ratings.map((node) => ({ node })) },
      },
    });
  }

  return json({});
}
