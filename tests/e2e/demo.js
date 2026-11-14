// Opens a normal Chrome window with the extension loaded and a stand-in class
// search served at the real address. The real class search is public, so this
// is not a way past a login. It is here because it needs no network and every
// name on the page is invented. The Chrome profile is kept between runs, so a
// model downloaded here is still there next time.
//
//   npm run demo
//   npm run demo -- --live     RateMyProfessors requests go to the real site
//   npm run demo -- --fresh    wipes the kept profile first
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, waitFor } from './cdp.js';
import { CLASS_SEARCH_URL, answerGraphql, classSearchPage } from './pages.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const RMP_URL = 'https://www.ratemyprofessors.com/graphql';

export const PROFILE_DIR = join(tmpdir(), 'professor-ratings-demo');

// With --live the page lists instructors the unit tests already name, so the
// real ratings have someone to land on. The invented names would mostly read
// "no RMP".
const LIVE_ROWS = [
  ['Pittsburgh Campus', 'Eric Beeko'],
  ['Pittsburgh Campus', 'Grace Mkomwa'],
  ['Pittsburgh Campus', 'Filipo Lubua'],
  ['Pittsburgh Campus', 'Gamby Camara'],
  ['Titusville Campus', 'Nancy Tress'],
  ['Titusville Campus', 'Kristen Reynolds'],
  ['Greensburg Campus', 'Kayla Heffernan'],
  ['Bradford Campus', 'Jennifer Sherwood'],
].map(([campus, name], i) => [campus, `10${i}0 - LEC`, 'MoWe', '9:00 am', '10:15 am', name, '1/30']);

// `position` and `page` are for a script that drives the demo: where the window
// goes, and the HTML served as the class search. Left alone, Chrome picks the
// spot and the page is the one the e2e run uses, with the live rows when live.
export async function startDemo({
  live = false,
  fresh = false,
  profileDir = PROFILE_DIR,
  position = process.env.DEMO_WINDOW_POSITION,
  page = classSearchPage(live ? LIVE_ROWS : undefined),
} = {}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
  if (fresh) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  mkdirSync(profileDir, { recursive: true });

  const chrome = await launchChrome({ chromePath, profileDir, width: 1280, height: 860, headless: false, offline: false, position });

  // Only the class-search host and, unless live, RateMyProfessors are held.
  // Everything else goes out as normal, the model download included.
  const patterns = [{ urlPattern: `${new URL(CLASS_SEARCH_URL).origin}/*` }, ...(live ? [] : [{ urlPattern: RMP_URL }])];
  const sessions = new Map(); // sessionId -> targetInfo

  // The lookups are made by the service worker, and Chrome restarts it when it
  // has been idle, so every target is attached as it appears.
  chrome.events.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
    sessions.set(sessionId, targetInfo);
    const send = (method, params) => chrome.send(method, params, sessionId).catch(() => {});
    await send('Fetch.enable', { patterns });
    if (waitingForDebugger) await send('Runtime.runIfWaitingForDebugger');
  });
  chrome.events.on('Target.detachedFromTarget', ({ sessionId }) => sessions.delete(sessionId));
  chrome.events.on('Fetch.requestPaused', async ({ requestId, request }, sessionId) => {
    let reply = null;
    if (request.url.split('?')[0] === CLASS_SEARCH_URL) reply = { status: 200, type: 'text/html; charset=utf-8', body: page };
    else if (request.url === RMP_URL && request.method === 'POST') reply = answerGraphql(request.postData);
    // Anything else on the class-search host is refused, so the demo never
    // touches the university's server.
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

  await chrome.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { id: extensionId } = await chrome.send('Extensions.loadUnpacked', { path: root });

  const tab = await waitFor(() => [...sessions].find(([, t]) => t.type === 'page')?.[0], { label: 'the first tab' });
  const evaluate = async (expression) => {
    const r = await chrome.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, tab);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async (url) => {
    await chrome.send('Page.navigate', { url }, tab);
    await waitFor(async () => (await evaluate('document.readyState').catch(() => '')) === 'complete', { label: url });
  };

  // The kept profile also keeps the extension's cached ratings and its list of
  // campuses. Both are dropped on every start, so canned and live answers from
  // different runs never mix.
  await open(`chrome-extension://${extensionId}/src/options.html`);
  await evaluate(`chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' })
    .then(() => chrome.runtime.sendMessage({ type: 'RESOLVE_SCHOOL', force: true }))`);
  await open(CLASS_SEARCH_URL);

  return { chrome, extensionId, profileDir, closed: chrome.exited, stop: chrome.close };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  let demo;
  try {
    demo = await startDemo({ live, fresh: args.includes('--fresh') });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(
    [
      'Chrome is open with the extension loaded from this folder.',
      'The tab is a stand-in class search served at the real address. Nothing is sent to Pitt.',
      live
        ? "RateMyProfessors requests go to the real site. The names on the page are instructors from this project's tests."
        : 'RateMyProfessors answers are canned. Run with --live to ask the real site.',
      '',
      'Things to try:',
      '  Click the gold star in the toolbar to open the popup. If it is not there, look under the puzzle piece.',
      "  Click a badge to open that professor's panel.",
      '  Click the ranking tab at the top of the page.',
      '  "Download model" in the popup fetches about 790 MB from Hugging Face.',
      `  It is kept in ${demo.profileDir} until you run with --fresh.`,
      '',
      'Close the window or press Ctrl+C to stop.',
    ].join('\n'),
  );
  process.once('SIGINT', demo.stop);
  await demo.closed;
}
