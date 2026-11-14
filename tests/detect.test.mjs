import { JSDOM } from 'jsdom';
import fs from 'fs';
import vm from 'vm';
import * as N from '../src/lib/names.js';

const CONTENT = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

/* The results table as the class search renders it today: a HighPoint CX grid
   in MUI class names, with each cell's text five elements below its td (three
   in the campus cell) and the page's own one-line clipping. Without
   `campusId` the campus cell has no id and has to be found under its heading. */
function realGrid({ campusId = true } = {}) {
  const T = 'cx-MuiTypography-root cx-MuiTypography-body1 cx-MuiTypography-noWrap';
  const text = (v) => `<span title="${v}" class=""><div class="${T}" aria-hidden="false">${v}</div></span>`;
  const deep = (v) =>
    `<div class="${T}"><div class="cx-MuiGrid-root cx-MuiGrid-container"><div class="cx-MuiGrid-root cx-MuiGrid-item">${text(v)}</div></div></div>`;
  const row = (i, campus, section, name) => `
        <tr class="cx-MuiTableRow-root" id="g-${i}" aria-level="1" aria-expanded="false">
          <td role="gridcell" id="g-${i}-expand" aria-hidden="true"></td>
          <td role="rowheader"${campusId ? ` id="g-${i}_CAMPUS"` : ''}><div class="${T}">${text(campus)}</div></td>
          <td role="gridcell" id="g-${i}_CLASS_SECTION">${deep(section)}</td>
          <td role="gridcell" id="g-${i}_INSTRUCTOR">${deep(name)}</td>
          <td role="gridcell">${deep('27/75')}</td>
        </tr>`;
  return `
    <style>.cx-MuiTypography-noWrap { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }</style>
    <h2>INTRODUCTION TO PSYCHOLOGY | PSY 0010</h2>
    <table class="cx-MuiTable-root" role="treegrid">
      <thead><tr>
        <th>Expand/Collapse</th><th role="columnheader">Campus</th><th role="columnheader">Section</th>
        <th role="columnheader" id="g-INSTRUCTOR">Instructor</th><th role="columnheader">Status</th>
      </tr></thead>
      <tbody>${row(0, 'Pittsburgh Campus', '1010 - LEC (28834)', 'Eric Beeko')}${row(1, 'Greensburg Campus', '3010 - LEC (24039)', 'Kayla Heffernan')}${row(2, 'Pittsburgh Campus', '1011 - REC (28835)', 'To Be Announced')}
      </tbody>
    </table>`;
}

/* The four markup shapes PeopleSoft class search plausibly produces. */
const FIXTURES = {
  'pitt grid (real nesting)': realGrid(),
  'pitt grid (real nesting, campus cell without an id)': realGrid({ campusId: false }),

  'table with Instructor column': `
    <table class="ps_grid">
      <thead><tr><th>Class</th><th>Days</th><th>Instructor</th><th>Room</th></tr></thead>
      <tbody>
        <tr><td>CS 1501</td><td>MWF 10:00</td><td>Ramirez, Nicholas</td><td>SENSQ 5502</td></tr>
        <tr><td>CS 1502</td><td>TuTh 13:00</td><td>Chen, Wei</td><td>SENSQ 5129</td></tr>
        <tr><td>CS 0007</td><td>MW 09:00</td><td>Staff</td><td>TBA</td></tr>
      </tbody>
    </table>`,

  'label/value div pair': `
    <div class="section">
      <div class="row"><div class="pull-left strong">Instructor</div><div class="pull-left">Garrison, Mark A</div></div>
      <div class="row"><div class="pull-left strong">Room</div><div class="pull-left">CL 249</div></div>
    </div>
    <div class="section">
      <div class="row"><div class="pull-left strong">Instructor</div><div class="pull-left">Okonkwo, Adaeze; Lin, Robert</div></div>
    </div>`,

  'inline label with colon': `
    <ul>
      <li class="meeting">Instructor: Van Der Berg, Anna</li>
      <li class="meeting">Instructor: To Be Announced</li>
    </ul>`,

  'class-named element': `
    <div class="result">
      <span class="course-title">MATH 0220</span>
      <span class="instructorName">Sofia Delgado-Ruiz</span>
    </div>
    <div class="result">
      <span class="course-title">MATH 0230</span>
      <span class="instructorName">Dr. James O'Connell PhD</span>
    </div>`,

  'definition list': `
    <dl><dt>Instructor</dt><dd>Whitfield, Gregory T</dd>
        <dt>Credits</dt><dd>3</dd></dl>`,

  // Modelled directly on the real Pitt class search grid.
  'course catalog page (zero badges expected)': `
    <div class="course-list-with-instructor-info">
      <table>
        <thead><tr><th>COURSE</th><th>DESCRIPTION</th><th>TYPICALLY OFFERED</th></tr></thead>
        <tbody>
          <tr><td>ACCT 0112</td><td>MANAGERIAL ACCOUNTING</td><td>Fall, Spring, Summer</td></tr>
          <tr><td>ACCT 0115</td><td>ACCOUNTING PRINCIPLES 1</td><td>Fall, Spring</td></tr>
          <tr><td>ACCT 0197</td><td>DIRECTED STUDY</td><td>Fall</td></tr>
        </tbody>
      </table>
    </div>`,

  'full grid incl. junk columns (only instructors badged)': `
    <table>
      <thead><tr>
        <th>CAMPUS</th><th>SECTION</th><th>DAYS</th><th>START</th><th>ROOM</th><th>INSTRUCTOR</th><th>STATUS</th>
      </tr></thead>
      <tbody>
        <tr><td>Titusville Campus</td><td>5010 - LEC (22269)</td><td>TuTh</td><td>2:00 pm</td>
            <td>111 Broadhurst Science Center</td><td>Nancy Tress</td><td>19/40</td></tr>
        <tr><td>Titusville Campus</td><td>5010 - CLB (22270)</td><td>Tu</td><td>9:00 am</td>
            <td>G8 Broadhurst Science Center</td><td>Kristen Reynolds</td><td>4/25</td></tr>
      </tbody>
    </table>`,

  'pitt grid (table)': `
    <h3>SWAHILI 3 | AFRCNA 0525</h3>
    <table>
      <thead><tr>
        <th>CAMPUS</th><th>SECTION</th><th>TOPIC</th><th>DAYS</th><th>START</th>
        <th>END</th><th>ROOM</th><th>INSTRUCTOR</th><th>DATES</th><th>SESSION</th><th>STATUS</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>Pittsburgh Campus</td><td>1040 - LEC (26589)</td><td>-</td><td>Th</td>
          <td>1:00 pm</td><td>2:15 pm</td><td>WEB Based Class</td><td>-</td>
          <td>08/24 - 12/04</td><td>AT</td><td>3/3</td>
        </tr>
        <tr>
          <td>Pittsburgh Campus</td><td></td><td>-</td><td>Mo</td>
          <td>9:00 am</td><td>10:15 am</td><td>WEB Based Class</td><td>Grace Mkomwa</td>
          <td>08/24 - 12/04</td><td>AT</td><td></td>
        </tr>
        <tr>
          <td>Pittsburgh Campus</td><td>1000 - LEC (34366)</td><td>-</td><td>MoWe</td>
          <td>2:00 pm</td><td>3:15 pm</td><td>627 Thackeray Hall</td><td>Filipo Lubua</td>
          <td>08/24 - 12/04</td><td>AT</td><td>9/10</td>
        </tr>
      </tbody>
    </table>`,

  'nested cell + span (duplicate repro)': `
    <div role="table">
      <div role="row">
        <div role="columnheader">ROOM</div>
        <div role="columnheader">INSTRUCTOR</div>
      </div>
      <div role="row">
        <div role="cell">229 Victoria Building</div>
        <div role="cell" class="instructorCell"><span>Eric Beeko</span></div>
      </div>
      <div role="row">
        <div role="cell">627 Thackeray Hall</div>
        <div role="cell" class="instructorCell"><span>Filipo Lubua</span></div>
      </div>
    </div>`,

  'pitt grid (aria divs)': `
    <div role="table" class="class-results">
      <div role="row" class="hdr">
        <div role="columnheader">CAMPUS</div>
        <div role="columnheader">SECTION</div>
        <div role="columnheader">DAYS</div>
        <div role="columnheader">ROOM</div>
        <div role="columnheader">INSTRUCTOR</div>
        <div role="columnheader">STATUS</div>
      </div>
      <div role="row">
        <div role="cell">Pittsburgh Campus</div>
        <div role="cell">1020 - LEC (19023)</div>
        <div role="cell">TuTh</div>
        <div role="cell">229 Victoria Building</div>
        <div role="cell">Eric Beeko</div>
        <div role="cell">2/40</div>
      </div>
      <div role="row">
        <div role="cell">Pittsburgh Campus</div>
        <div role="cell">1000 - LEC (34366)</div>
        <div role="cell">MoWe</div>
        <div role="cell">627 Thackeray Hall</div>
        <div role="cell">Filipo Lubua</div>
        <div role="cell">9/10</div>
      </div>
    </div>`,
};

/* --------------------------------------------------------------- */

function runFixture(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, {
    url: 'https://pitcsprd.csps.pitt.edu/psp/pitcsprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });

  const { window } = dom;
  const lookups = [];
  const hints = {}; // name -> the campus that went out with its lookup
  let onMessage = null;

  // Minimal chrome mock. PARSE_BATCH is answered by the real names module so
  // this exercises the same code path the service worker runs.
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (fn) => { onMessage = fn; } },
      sendMessage(msg, cb) {
        let result;
        if (msg.type === 'GET_SETTINGS') {
          result = { customSelectors: [], debug: false, hideWhenNotFound: false };
        } else if (msg.type === 'PARSE_BATCH') {
          result = msg.texts.map((text) => {
            if (N.isPlaceholder(text)) return [];
            return N.splitInstructors(text)
              .filter((p) => !N.isPlaceholder(p) && N.looksLikePersonName(p))
              .map((p) => N.parseName(p))
              .filter((p) => p && p.last.length >= 2)
              .map((p) => p.display);
          });
        } else if (msg.type === 'LOOKUP') {
          lookups.push(msg.name);
          hints[msg.name] = msg.campusHint;
          result = { status: 'notfound', raw: msg.name };
        } else {
          result = {};
        }
        setTimeout(() => cb({ ok: true, result }), 0);
      },
    },
  };

  const ctx = dom.getInternalVMContext();
  ctx.chrome = chrome;
  window.chrome = chrome;

  vm.runInContext(CONTENT, ctx);

  return new Promise((resolve) => {
    setTimeout(() => {
      const badges = Array.from(window.document.querySelectorAll('.prb-badge'));
      resolve({
        badgeNames: badges.map((b) => b.dataset.name),
        lookups,
        hints,
        window,
        // What the popup's "Rescan page" button sends.
        rescan: () => new Promise((done) => onMessage({ type: 'PRB_RESCAN' }, {}, done)),
      });
    }, 700);
  });
}

/* --------------------------------------------------------------- */

const EXPECTED = {
  'pitt grid (real nesting)': ['Eric Beeko', 'Kayla Heffernan'],
  'pitt grid (real nesting, campus cell without an id)': ['Eric Beeko', 'Kayla Heffernan'],
  'table with Instructor column': ['Ramirez, Nicholas', 'Chen, Wei'],
  'label/value div pair': ['Garrison, Mark A', 'Okonkwo, Adaeze', 'Lin, Robert'],
  'inline label with colon': ['Van Der Berg, Anna'],
  'class-named element': ['Sofia Delgado-Ruiz', "Dr. James O'Connell PhD"],
  'definition list': ['Whitfield, Gregory T'],
  'course catalog page (zero badges expected)': [],
  'full grid incl. junk columns (only instructors badged)': ['Nancy Tress', 'Kristen Reynolds'],
  'pitt grid (table)': ['Grace Mkomwa', 'Filipo Lubua'],
  'pitt grid (aria divs)': ['Eric Beeko', 'Filipo Lubua'],
  'nested cell + span (duplicate repro)': ['Eric Beeko', 'Filipo Lubua'],
};

let pass = 0;
let fail = 0;
const RUNS = {};

for (const [label, html] of Object.entries(FIXTURES)) {
  RUNS[label] = await runFixture(html);
  const { badgeNames } = RUNS[label];
  const got = [...badgeNames].sort();
  const want = [...EXPECTED[label]].sort();

  const dupes = got.filter((n, i) => got.indexOf(n) !== i);

  if (JSON.stringify(got) === JSON.stringify(want) && !dupes.length) {
    pass++;
    console.log(`PASS  ${label}  ->  ${got.join(' | ')}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
    console.log(`      want: ${JSON.stringify(want)}`);
    console.log(`      got:  ${JSON.stringify(got)}`);
    if (dupes.length) console.log(`      DUPLICATE BADGES: ${JSON.stringify(dupes)}`);
  }
}

/* ---- the real nesting: the campus that goes out, and what the page keeps ---- */

let checksPassed = 0;
let checksFailed = 0;
function check(cond, label, detail = '') {
  if (cond) { checksPassed++; console.log(`PASS  ${label}`); }
  else { checksFailed++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
}

for (const label of ['pitt grid (real nesting)', 'pitt grid (real nesting, campus cell without an id)']) {
  const { hints } = RUNS[label];
  check(hints['Eric Beeko'] === 'Pittsburgh' && hints['Kayla Heffernan'] === 'Greensburg',
        `${label}: each lookup carries its own row's campus`, JSON.stringify(hints));
}

{
  const { window, rescan } = RUNS['pitt grid (real nesting)'];
  const hosts = () => Array.from(window.document.querySelectorAll('.prb-badge')).map((b) => b.parentElement);
  const inPlace = () => hosts().length === 2 && hosts().every((h) => h.matches('span[title] > div') && h.firstChild.nodeType === 3);

  check(inPlace() && hosts()[0].firstChild.nodeValue === 'Eric Beeko',
        'real nesting: the badge follows the name inside the element that holds it');
  // The page clips each cell to one line with an ellipsis, and it is a React
  // app: its elements keep their own styles and its text node stays put.
  check(hosts().every((h) => !h.hasAttribute('style') && window.getComputedStyle(h).whiteSpace === 'nowrap'),
        "real nesting: the page's element keeps its own nowrap and ellipsis",
        hosts().map((h) => h.getAttribute('style')).join(' | '));
  check(hosts().every((h) => h.lastChild.previousSibling.className === 'prb-gap'),
        'real nesting: a space that may wrap sits between the name and the badge');

  await rescan();
  await new Promise((r) => setTimeout(r, 100));
  const gaps = window.document.querySelectorAll('.prb-gap').length;
  check(inPlace() && gaps === 2, 'real nesting: a rescan puts each badge back in the same place',
        `${hosts().length} badges, ${gaps} gaps`);
}

console.log(`\n${pass} fixtures passed, ${fail} failed`);
console.log(`${checksPassed} checks passed, ${checksFailed} failed`);
process.exit(fail || checksFailed ? 1 : 0);
