// Loads the unpacked extension into a throwaway headless Chrome, answers the
// class search and RateMyProfessors with the stand-ins in pages.js, fails every
// other request, and checks the badges, the panel, the ranking tab and the
// model host. Nothing reaches a real host.
//
//   npm run e2e
//   npm run e2e -- --screenshots docs    also writes the README screenshots
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, sleep, waitFor } from './cdp.js';
import { CLASS_SEARCH_URL, EXPECTED_BADGES, GREENSBURG_ID, answerGraphql, classSearchPage } from './pages.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const screenshotDir = args.includes('--screenshots') ? args[args.indexOf('--screenshots') + 1] : null;

const chromePath = findChrome();
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'professor-ratings-e2e-'));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

const chrome = await launchChrome({ chromePath, profileDir: join(workDir, 'profile'), width: 1280, height: 800 });
const problems = [];
const targets = new Map(); // sessionId -> targetInfo
const teacherSearches = []; // { text, schoolID }, in the order the worker sent them

function answer(request) {
  if (request.url.split('?')[0] === CLASS_SEARCH_URL) {
    return { status: 200, type: 'text/html; charset=utf-8', body: classSearchPage() };
  }
  if (request.url === 'https://www.ratemyprofessors.com/graphql' && request.method === 'POST') {
    const { query = '', variables } = JSON.parse(request.postData || '{}');
    if (query.includes('SearchTeacher')) teacherSearches.push(variables);
    return answerGraphql(request.postData);
  }
  return null;
}

// The lookups are made by the service worker and the model host lives in an
// offscreen document, so every target is attached and intercepted.
chrome.events.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
  targets.set(sessionId, targetInfo);
  const send = (method, params) => chrome.send(method, params, sessionId).catch(() => {});
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
  await send('Runtime.enable');
  if (waitingForDebugger) await send('Runtime.runIfWaitingForDebugger');
});
chrome.events.on('Target.detachedFromTarget', ({ sessionId }) => targets.delete(sessionId));
chrome.events.on('Runtime.exceptionThrown', (p, sessionId) => {
  const where = targets.get(sessionId)?.url ?? 'unknown target';
  problems.push(`${where}: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
});
chrome.events.on('Fetch.requestPaused', async ({ requestId, request }, sessionId) => {
  const reply = answer(request);
  if (!reply) {
    await chrome.send('Fetch.failRequest', { requestId, errorReason: 'NameNotResolved' }, sessionId).catch(() => {});
    return;
  }
  await chrome.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: reply.status,
    responseHeaders: [
      { name: 'Content-Type', value: reply.type },
      { name: 'Access-Control-Allow-Origin', value: '*' },
    ],
    body: Buffer.from(reply.body).toString('base64'),
  }, sessionId).catch(() => {});
});

try {
  await chrome.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { id: extensionId } = await chrome.send('Extensions.loadUnpacked', { path: root });
  check('extension loads unpacked', Boolean(extensionId));

  const newPage = async () => {
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
    const sessionId = await waitFor(() => [...targets].find(([, t]) => t.targetId === targetId)?.[0], { label: 'page session' });
    const send = (method, params) => chrome.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const open = async (url) => {
      await send('Page.navigate', { url });
      await waitFor(async () => (await evaluate('document.readyState').catch(() => '')) === 'complete', { label: url });
    };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    return { send, evaluate, open };
  };
  const shoot = async (page, file) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, screenshotDir, file), Buffer.from(data, 'base64'));
  };

  // The model host has to load and answer. A wrong import path shows up here.
  const ext = await newPage();
  await ext.open(`chrome-extension://${extensionId}/src/options.html`);
  const status = await ext.evaluate(`new Promise((r) => chrome.runtime.sendMessage({ type: 'AI_STATUS' }, r))`);
  check('model host answers AI_STATUS', status?.ok && !status.result.error && typeof status.result.local?.webgpu === 'boolean', JSON.stringify(status));

  // Chrome caps a toolbar popup at 600 px and scrolls the rest. The tallest
  // state is a fresh install: model row, Download button and a three-line note.
  const popup = await newPage();
  await popup.send('Emulation.setDeviceMetricsOverride', { width: 318, height: 600, deviceScaleFactor: 1, mobile: false });
  await popup.open(`chrome-extension://${extensionId}/src/popup.html`);
  await sleep(1000);
  const popupHeight = await popup.evaluate(`(() => {
    document.getElementById('url').textContent = 'pitcsprd.csps.pitt.edu/psc/pitcsprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H…';
    document.getElementById('modelRow').style.display = 'flex';
    document.getElementById('download').style.display = 'block';
    const note = document.getElementById('note');
    note.textContent = 'No instructors on this page yet. Run a search first; if results are showing without badges, use the picker below.';
    note.className = 'note warn';
    return document.documentElement.scrollHeight;
  })()`);
  check('popup fits in 600 px with the Download button and a note', popupHeight <= 600, `${popupHeight} px`);

  const page = await newPage();
  await page.open(CLASS_SEARCH_URL);
  await waitFor(async () => (await page.evaluate(`document.querySelectorAll('.prb-badge').length`)) >= 6, { label: 'badges', timeout: 15000 }).catch(() => {});
  await waitFor(async () => (await page.evaluate(`document.querySelectorAll('.prb-badge[data-state="loading"]').length`)) === 0, { label: 'lookups', timeout: 20000 }).catch(() => {});

  const badges = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('td[id$="_INSTRUCTOR"]')].map((cell) => {
    const badge = cell.querySelector('.prb-badge');
    return [cell.querySelector('span[title]').title, badge ? badge.querySelector('.prb-score').textContent : null];
  }))`);
  for (const [name, expected] of Object.entries(EXPECTED_BADGES)) {
    check(`${name}: ${expected === null ? 'no badge' : `badge reads ${expected}`}`, badges[name] === expected, `got ${JSON.stringify(badges[name])}`);
  }
  check('same surname and initial get their own scores', badges['Rebecca Hollis'] !== badges['Robert Hollis'], JSON.stringify(badges));

  // The row's campus has to reach the worker. Without it the main campus is
  // asked first and the other five listings after that.
  const raman = teacherSearches.filter((q) => /raman/i.test(q.text));
  check('the Greensburg row is looked up at Greensburg, in one request', raman.length === 1 && raman[0].schoolID === GREENSBURG_ID, JSON.stringify(raman));

  // The page draws every cell on one line and clips it with an ellipsis. At
  // this width a column is about 107 px, as on the real page.
  const layout = async () => Object.fromEntries(await page.evaluate(`[...document.querySelectorAll('td[id$="_INSTRUCTOR"] .prb-badge')].map((badge) => {
    const host = badge.parentElement;
    const range = document.createRange();
    range.selectNodeContents(host.firstChild);
    const name = range.getBoundingClientRect();
    const box = badge.getBoundingClientRect();
    const edge = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    return [badge.dataset.name, {
      lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
      clipped: style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis',
      beside: box.top < name.bottom && box.bottom > name.top,
      inView: box.left >= edge.left && box.right <= edge.right + 1 && box.bottom <= edge.bottom + 1,
    }];
  })`));
  const narrow = await layout();
  check('in a narrow column each name stays on one line with the page\'s ellipsis',
    Object.values(narrow).every((b) => b.lines === 1 && b.clipped), JSON.stringify(narrow));
  check('a badge that does not fit beside its name goes under it, in view',
    !narrow['Daniel Whitcombe'].beside && Object.values(narrow).every((b) => b.inView), JSON.stringify(narrow));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 800, deviceScaleFactor: 1, mobile: false });
  const wide = await layout();
  check('with room the badge sits on the name\'s line', wide['Priya Raman'].beside && wide['Priya Raman'].lines === 1 && wide['Priya Raman'].inView, JSON.stringify(wide));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  await waitFor(async () => (await page.evaluate(`document.querySelector('.prb-rank-tab')?.dataset.ready`)) === '1', { label: 'ranking tab', timeout: 10000 }).catch(() => {});
  const tab = await page.evaluate(`document.querySelector('.prb-rank-tab')?.textContent.trim()`);
  check('ranking tab counts the rated professors', /^Rank 5 professors/.test(tab ?? ''), tab);
  if (screenshotDir) await shoot(page, 'grid.png');

  await page.evaluate(`document.querySelector('.prb-badge[data-name="Maria Okafor"]').click()`);
  await waitFor(async () => (await page.evaluate(`document.querySelector('.prb-summary')?.dataset.state`)) === 'ok', { label: 'summary', timeout: 15000 }).catch(() => {});
  const summary = await page.evaluate(`({
    headline: document.querySelector('.prb-panel .prb-headline')?.textContent ?? null,
    aspects: document.querySelectorAll('.prb-panel .prb-aspect').length,
  })`);
  check('panel shows a headline and at least one topic', Boolean(summary.headline) && summary.aspects > 0, JSON.stringify(summary));

  // Her canned answer has no tags on the teacher, only on the reviews.
  const tags = await page.evaluate(`[...document.querySelectorAll('.prb-panel .prb-tag')].map((t) => t.textContent).join(', ')`);
  check('panel shows the tags counted from the reviews', tags === 'Amazing lectures, Clear grading criteria, Caring, Accessible outside class, Test heavy', tags);

  // The panel is taller than the room under the badge, so it scrolls inside
  // itself and the scrollbar takes width from the four figures.
  const stats = await page.evaluate(`(() => {
    const panel = document.querySelector('.prb-panel');
    return {
      scrolls: panel.scrollHeight > panel.clientHeight,
      heights: [...panel.querySelectorAll('.prb-stat-label')].map((l) => Math.round(l.getBoundingClientRect().height)),
    };
  })()`);
  check('the four labels stay on one line in a panel that scrolls', stats.scrolls && new Set(stats.heights).size === 1, JSON.stringify(stats));
  if (screenshotDir) {
    await sleep(300);
    await shoot(page, 'panel.png');
  }

  const rankTab = () => page.evaluate(`({
    text: document.querySelector('.prb-rank-tab')?.textContent.trim(),
    open: Boolean(document.querySelector('.prb-rank')),
  })`);
  await page.evaluate(`document.querySelector('.prb-rank-tab').click()`);
  const opened = await rankTab();
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  const closed = await rankTab();
  check('Esc closes the ranking and the tab\'s arrow points down again',
    opened.open && opened.text.endsWith('▴') && !closed.open && closed.text.endsWith('▾'), JSON.stringify({ opened, closed }));

  await sleep(500);
  check('no exceptions in any page, worker or offscreen document', problems.length === 0, problems.join('\n     '));
} catch (error) {
  check('run finished', false, error.stack);
} finally {
  await chrome.close();
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
