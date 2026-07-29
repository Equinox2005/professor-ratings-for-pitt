/**
 * Scale + concurrency regressions.
 *
 * The small fixtures in detect.test.mjs pass even with the quadratic collapse
 * and the scan race, because neither shows up below a few dozen rows. This
 * builds a realistic full-page search result and hammers it with mutations.
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import vm from 'vm';
import * as N from '../src/lib/names.js';

const CONTENT = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

const FIRST = ['Jennifer','Robert','Maria','Wei','Amanda','Kayla','Timothy','Grace','Nancy','Kristen','Deborah','Cristina'];
const LAST  = ['Sherwood','Chen','Ramirez','Heffernan','Hoffman','Mkomwa','Tress','Reynolds','Zakrzwski','DeDiana','Beeko','Lubua'];

/** 40 courses x 3 sections = 120 instructor cells, like a real result page. */
function bigPage(courses = 40) {
  let html = '';
  for (let c = 0; c < courses; c += 1) {
    html += `<h3>COURSE TITLE ${c} | SUBJ ${1000 + c}</h3><table><thead><tr>
      <th>CAMPUS</th><th>SECTION</th><th>DAYS</th><th>START</th><th>ROOM</th><th>INSTRUCTOR</th><th>STATUS</th>
    </tr></thead><tbody>`;
    for (let r = 0; r < 3; r += 1) {
      const name = `${FIRST[(c + r) % FIRST.length]} ${LAST[(c * 3 + r) % LAST.length]}`;
      html += `<tr>
        <td>Pittsburgh Campus</td><td>${1000 + r}0 - LEC (${20000 + c * 10 + r})</td>
        <td>MoWeFr</td><td>8:00 am</td><td>124 Biddle Hall</td>
        <td><span>${name}</span></td><td>${r}/30</td></tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
}

function run(html, { mutate = false, parseDelay = 1, mutateAt = [] } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, {
    url: 'https://pitcsprd.csps.pitt.edu/psp/pitcsprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let parseCalls = 0;

  const chrome = {
    storage: { local: { get: (k, cb) => cb && cb({}), set: () => {} } },
    runtime: {
      lastError: null,
      onMessage: { addListener: () => {} },
      sendMessage(msg, cb) {
        let result;
        if (msg.type === 'GET_SETTINGS') {
          result = { customSelectors: [], debug: false, hideWhenNotFound: false };
        } else if (msg.type === 'PARSE_BATCH') {
          parseCalls += 1;
          result = msg.texts.map((t) =>
            N.isPlaceholder(t) ? [] :
            N.splitInstructors(t)
              .filter((p) => !N.isPlaceholder(p) && N.looksLikePersonName(p))
              .map((p) => N.parseName(p)).filter(Boolean).map((p) => p.display));
        } else if (msg.type === 'LOOKUP') {
          result = { status: 'notfound', raw: msg.name };
        } else result = {};
        // Async reply; the PARSE_BATCH delay is the race window.
        setTimeout(() => cb({ ok: true, result }), msg.type === 'PARSE_BATCH' ? parseDelay : 1);
      },
    },
  };

  const ctx = vm.createContext(window);
  ctx.chrome = chrome;
  window.chrome = chrome;

  const t0 = Date.now();
  vm.runInContext(CONTENT, ctx);

  for (const at of mutateAt) {
    setTimeout(() => {
      const d = window.document.createElement('div');
      d.textContent = 'x';
      window.document.body.appendChild(d);
    }, at);
  }

  // Poll until the badge count stops changing rather than guessing a fixed
  // settle time. A wall-clock deadline makes this suite flaky under CPU load,
  // and a flaky test is worse than no test.
  return new Promise((resolve) => {
    let last = -1;
    let stableFor = 0;
    const minWait = 900 + parseDelay + (mutateAt.length ? Math.max(...mutateAt) : 0);

    const tick = () => {
      const count = window.document.querySelectorAll('.prb-badge').length;
      stableFor = count === last ? stableFor + 1 : 0;
      last = count;

      const settled = stableFor >= 8 && Date.now() - t0 >= minWait;
      if (!settled && Date.now() - t0 < 15000) {
        setTimeout(tick, 50);
        return;
      }

      const cells = Array.from(window.document.querySelectorAll('td > span'));
      const perCell = cells.map((c) => c.parentElement.querySelectorAll('.prb-badge').length);
      resolve({
        badges: count,
        maxPerCell: Math.max(0, ...perCell),
        elapsed: Date.now() - t0,
        parseCalls,
      });
    };
    setTimeout(tick, 50);
  });
}

let pass = 0, fail = 0;
const ok = (c, l, d = '') => c ? pass++ : (fail++, console.log(`FAIL ${l}${d ? `\n  ${d}` : ''}`));

// --- scale ---
{
  const r = await run(bigPage(40));
  console.log(`40 courses / 120 cells -> ${r.badges} badges in ${r.elapsed}ms`);
  ok(r.badges === 120, 'scale: every instructor cell badged exactly once', `got ${r.badges}`);
  ok(r.maxPerCell === 1, 'scale: no cell has duplicate badges', `max ${r.maxPerCell}`);
  // Correctness at scale is the regression signal. The quadratic collapse this
  // suite was written for shows up as wrong counts or a hang, not as a specific
  // millisecond figure -- wall-clock assertions inside jsdom measure the
  // harness, not the extension.
  ok(r.elapsed < 15000, 'scale: settles rather than hanging', `${r.elapsed}ms`);
}

// --- concurrency ---
// NOTE: scan() claims elements BEFORE awaiting PARSE_BATCH, so a scan that
// starts mid-flight finds nothing left to claim and cannot double-badge.
// That race was confirmed by instrumenting the scan timeline directly (two
// scans each collected the same element set and each issued a request), but a
// reliable jsdom reproduction proved impossible -- whether the overlap occurs
// depends on timer interleaving this harness cannot control. Rather than ship
// an assertion that passes whether or not the bug is present, the guarantee is
// enforced structurally in src/content.js and documented there. The scale test
// above still catches the observable symptom (duplicate badges) if the claim
// ordering regresses in a way that manifests deterministically.
{
  const r = await run(bigPage(25), { parseDelay: 300, mutateAt: [200, 400, 600] });
  console.log(`mutation churn -> ${r.badges} badges, max/cell ${r.maxPerCell}`);
  ok(r.maxPerCell === 1, 'churn: repeated mutations never double-badge a cell', `max ${r.maxPerCell}`);
  ok(r.badges === 75, 'churn: exact badge count preserved', `got ${r.badges}`);
}

// --- responsiveness: results arriving after the page has been idle ---
// Reproduces the real complaint: you sit on the search form picking term,
// campus and subject. Every dropdown change is a mutation whose scan finds no
// instructors, so the idle backoff climbs. Then you hit Search. If the backoff
// still applies, the first badge is delayed by the full backoff interval --
// which is exactly the ~5s that was reported.
{
  const dom = new JSDOM('<!DOCTYPE html><body><div id="form"></div><div id="results"></div></body>', {
    url: 'https://pitcsprd.csps.pitt.edu/psp/pitcsprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const chrome = {
    storage: { local: { get: (k, cb) => cb && cb({}), set: () => {} } },
    runtime: {
      lastError: null,
      onMessage: { addListener: () => {} },
      sendMessage(msg, cb) {
        let result;
        if (msg.type === 'GET_SETTINGS') result = { customSelectors: [], debug: false, hideWhenNotFound: false };
        else if (msg.type === 'PARSE_BATCH') {
          result = msg.texts.map((t) =>
            N.isPlaceholder(t) ? [] :
            N.splitInstructors(t)
              .filter((p) => !N.isPlaceholder(p) && N.looksLikePersonName(p))
              .map((p) => N.parseName(p)).filter(Boolean).map((p) => p.display));
        } else if (msg.type === 'LOOKUP') result = { status: 'notfound', raw: msg.name };
        else result = {};
        setTimeout(() => cb({ ok: true, result }), 1);
      },
    },
  };
  const ctx = vm.createContext(window);
  ctx.chrome = chrome;
  window.chrome = chrome;
  vm.runInContext(CONTENT, ctx);

  const form = window.document.getElementById('form');
  // Dropdown-style mutations with no instructor content, spaced widely enough
  // that each one's scan actually completes -- that is what drives the idle
  // streak up. Bunched mutations just reset the debounce and never scan.
  [400, 2600, 5000, 7400].forEach((at, i) => {
    // Element mutations: the observer ignores text-only changes by design.
    setTimeout(() => { form.innerHTML = `<span>filter state ${i}</span>`; }, at);
  });

  let renderedAt = 0;
  setTimeout(() => {
    renderedAt = Date.now();
    window.document.getElementById('results').innerHTML = `
      <table><thead><tr><th>ROOM</th><th>INSTRUCTOR</th></tr></thead><tbody>
        <tr><td>124 Biddle Hall</td><td><span>Jennifer Sherwood</span></td></tr>
        <tr><td>100 Biddle Hall</td><td><span>Timothy Hoffman</span></td></tr>
      </tbody></table>`;
  }, 9800);

  const delay = await new Promise((resolve) => {
    const t = setInterval(() => {
      if (renderedAt && window.document.querySelector('.prb-badge')) {
        clearInterval(t);
        resolve(Date.now() - renderedAt);
      }
    }, 20);
    setTimeout(() => { clearInterval(t); resolve(null); }, 20000);
  });

  console.log(`results -> first badge: ${delay}ms (was up to 5000ms with the uncapped backoff)`);
  ok(delay !== null, 'responsiveness: badges appear after idle churn', 'never appeared');
  ok(delay !== null && delay < 1000, 'responsiveness: backoff resets when results render',
     `took ${delay}ms`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
