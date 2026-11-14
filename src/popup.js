function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false });
    });
  });
}

const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setPill(el, text, kind) {
  el.textContent = text;
  el.className = `pill ${kind}`;
}

function note(text, kind = '') {
  const el = $('note');
  el.textContent = text || '';
  el.className = text ? `note ${kind}` : 'note hidden';
}

// The manifest's own match pattern, so "covered" means what the browser enforces.
const CLASS_SEARCH = new RegExp(
  '^' +
    chrome.runtime.getManifest().content_scripts[0].matches[0]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
);

const LOCAL_COPY = {
  ready: ['AI ready', 'ok'],
  downloading: ['downloading…', 'warn'],
  loading: ['loading…', 'warn'],
  idle: ['not downloaded', 'warn'],
  'no-webgpu': ['no WebGPU, stats only', 'bad'],
  error: ['failed, stats only', 'bad'],
};

/** Ask the page whether the content script is alive. */
function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'PRB_COUNT' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ alive: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ alive: true, count: res?.count ?? 0 });
      }
    });
  });
}

async function refresh() {
  const tab = await activeTab();
  const url = tab?.url || '';

  $('url').textContent = url ? url.replace(/^https:\/\//, '').slice(0, 46) + (url.length > 54 ? '…' : '') : 'unknown';
  $('url').title = url;

  const cs = tab?.id ? await pingContentScript(tab.id) : { alive: false, error: 'no tab' };
  // The portal can show the class search in a frame under another address.
  // The content script only runs in class-search frames, so an answer counts.
  const onClassSearch = CLASS_SEARCH.test(url) || cs.alive;
  setPill($('site'), onClassSearch ? 'covered' : 'not covered', onClassSearch ? 'ok' : 'bad');
  setPill($('cs'), cs.alive ? 'running' : 'not running', cs.alive ? 'ok' : 'bad');
  $('count').textContent = cs.alive ? cs.count : '–';

  note('');
  if (url && !onClassSearch) {
    note("This only runs on Pitt's class search, so nothing can run here.", 'err');
  } else if (onClassSearch && !cs.alive) {
    note('Page is covered but the content script is not running. Reload the tab.', 'err');
  } else if (cs.alive && cs.count === 0) {
    note('No instructors on this page yet. Run a search first; if results are showing without badges, use the picker below.', 'warn');
  }

  const settingsRes = await send({ type: 'GET_SETTINGS' });
  $('school').textContent = settingsRes.ok
    ? settingsRes.result.schoolLabel || settingsRes.result.schoolName
    : 'service worker not responding';

  send({ type: 'RESOLVE_SCHOOL' }).then((res) => {
    if (res.ok && res.result.schoolLabel) $('school').textContent = res.result.schoolLabel;
    else if (!res.ok) $('school').textContent = 'school lookup failed';
  });

  const aiOn = settingsRes.ok ? settingsRes.result.aiSummaries !== false : true;
  const ai = await send({ type: 'AI_STATUS' });

  if (!ai.ok) {
    setPill($('ai'), 'unavailable', 'bad');
  } else if (!aiOn) {
    setPill($('ai'), 'statistics only', 'ok');
  } else if (ai.result.error) {
    // The model host did not answer; say so instead of blaming WebGPU.
    setPill($('ai'), 'unavailable', 'bad');
  } else {
    const l = ai.result.local || {};
    // The model host unloads after three idle minutes and comes back as
    // 'idle'. Once the download has been asked for, that means not loaded,
    // which is also true when the download never finished.
    const standby = l.status === 'idle' && settingsRes.ok && settingsRes.result.autoDownloadModel;
    const [text, kind] = !l.webgpu
      ? LOCAL_COPY['no-webgpu']
      : standby
        ? ['loads when needed', 'ok']
        : LOCAL_COPY[l.status] || ['unknown', 'warn'];
    setPill($('ai'), text, kind);

    $('modelRow').style.display = 'flex';
    if (l.status === 'downloading') $('modelState').textContent = `${l.pct || 0}%`;
    else if (l.status === 'ready') $('modelState').textContent = 'cached, offline';
    else if (!l.webgpu) $('modelState').textContent = 'WebGPU not available';
    else if (standby) $('modelState').textContent = 'not loaded';
    else $('modelState').textContent = 'not downloaded yet';

    const needsDownload = l.webgpu && !standby && l.status !== 'ready' && l.status !== 'downloading';
    $('download').style.display = needsDownload ? 'block' : 'none';
  }

  const stats = await send({ type: 'CACHE_STATS' });
  $('cache').textContent = stats.ok ? stats.result.entries : '–';
}

$('pick').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return note('No active tab.', 'err');
  if (!CLASS_SEARCH.test(tab.url || '') && !(await pingContentScript(tab.id)).alive) return note("The picker only works on Pitt's class search.", 'err');

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/picker.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/picker.js'],
    });
    window.close();
  } catch (err) {
    note(`Could not inject the picker: ${err.message}`, 'err');
  }
});

$('rank').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'PRB_RANK' }, (res) => {
    if (chrome.runtime.lastError) note('Not on a class search page.', 'err');
    else if (res && res.ready === false && !res.loading) note('No rated professors on this page.', 'warn');
    else if (res && res.ready === false) note('Still looking professors up. The button at the top of the page turns on when they are done.', 'warn');
    else window.close();
  });
});

$('rescan').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'PRB_RESCAN' }, () => {
    if (chrome.runtime.lastError) note(`Rescan failed: ${chrome.runtime.lastError.message}`, 'err');
    else window.close();
  });
});

$('clear').addEventListener('click', async () => {
  await send({ type: 'CLEAR_CACHE' });
  await refresh();
  note('Cache cleared.');
});

$('copy').addEventListener('click', async () => {
  const tab = await activeTab();
  const cs = tab?.id ? await pingContentScript(tab.id) : {};
  const ai = await send({ type: 'AI_STATUS' });
  const settings = await send({ type: 'GET_SETTINGS' });

  const report = [
    `url: ${tab?.url || 'unknown'}`,
    `contentScript: ${cs.alive ? `running, ${cs.count} badges` : `NOT running (${cs.error})`}`,
    `serviceWorker: ${settings.ok ? 'responding' : `not responding (${settings.error})`}`,
    `school: ${settings.ok ? settings.result.schoolLabel || settings.result.schoolName : '?'}`,
    `schools: ${settings.ok ? JSON.stringify((settings.result.schools || []).map((x) => x.name)) : '?'}`,
    `ai: ${ai.ok ? ai.result.error || `${ai.result.local?.status}, webgpu ${ai.result.local?.webgpu}` : 'error'}`,
    `selectors: ${settings.ok ? JSON.stringify(settings.result.customSelectors) : '?'}`,
    `ua: ${navigator.userAgent}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(report);
    note('Diagnostics copied. Paste them into a GitHub issue.');
  } catch {
    note(report, 'err');
  }
});

$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  $('download').textContent = 'Starting download…';
  note('Downloading Qwen2.5-0.5B. Progress shows above.');
  const res = await send({ type: 'DOWNLOAD_MODEL' });
  if (!res.ok || res.result?.status === 'error') {
    note(`Download failed: ${res.result?.message || res.error}`, 'err');
    $('download').disabled = false;
    $('download').textContent = 'Retry download';
  } else {
    await refresh();
    note('Model ready. Summaries are now written locally.');
  }
});

// The offscreen document broadcasts progress while the model downloads.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'MODEL_PROGRESS' && msg.progress) {
    const row = $('modelRow');
    if (row) row.style.display = 'flex';
    const st = $('modelState');
    if (st) st.textContent = msg.progress.status === 'downloading'
      ? `${msg.progress.pct}%`
      : msg.progress.status;
  }
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
