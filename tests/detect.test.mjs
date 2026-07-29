import { JSDOM } from 'jsdom';
import fs from 'fs';
import vm from 'vm';
import * as N from '../src/lib/names.js';

const CONTENT = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

/* The four markup shapes PeopleSoft class search plausibly produces. */
const FIXTURES = {
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
  });

  const { window } = dom;
  const lookups = [];

  // Minimal chrome mock. PARSE_BATCH is answered by the real names module so
  // this exercises the same code path the service worker runs.
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: () => {} },
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
          result = { status: 'notfound', raw: msg.name };
        } else {
          result = {};
        }
        setTimeout(() => cb({ ok: true, result }), 0);
      },
    },
  };

  const ctx = vm.createContext(window);
  ctx.chrome = chrome;
  window.chrome = chrome;

  vm.runInContext(CONTENT, ctx);

  return new Promise((resolve) => {
    setTimeout(() => {
      const badges = Array.from(window.document.querySelectorAll('.prb-badge'));
      resolve({
        badgeNames: badges.map((b) => b.dataset.name),
        lookups,
        window,
      });
    }, 700);
  });
}

/* --------------------------------------------------------------- */

const EXPECTED = {
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

for (const [label, html] of Object.entries(FIXTURES)) {
  const { badgeNames } = await runFixture(html);
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

console.log(`\n${pass} fixtures passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
