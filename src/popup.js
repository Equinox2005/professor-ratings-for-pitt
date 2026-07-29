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

const LOCAL_COPY = {
  ready: ['Qwen 0.5B ready', 'ok'],
  downloading: ['downloading…', 'warn'],
  loading: ['loading…', 'warn'],
  idle: ['not downloaded', 'warn'],
  'no-webgpu': ['no WebGPU — stats only', 'bad'],
  error: ['failed — stats only', 'bad'],
};

const NANO_COPY = {
  available: ['Gemini Nano ready', 'ok'],
  downloadable: ['Nano needs download', 'warn'],
  downloading: ['Nano downloading…', 'warn'],
  unavailable: ['not on this device', 'bad'],
  unsupported: ['Chrome too old', 'bad'],
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

  const isPitt = /^https:\/\/([^/]*\.)?pitt\.edu\//i.test(url);
  setPill($('site'), isPitt ? 'covered' : 'not covered', isPitt ? 'ok' : 'bad');

  const cs = tab?.id ? await pingContentScript(tab.id) : { alive: false, error: 'no tab' };
  setPill($('cs'), cs.alive ? 'running' : 'not running', cs.alive ? 'ok' : 'bad');
  $('count').textContent = cs.alive ? cs.count : '–';

  note('');
  if (url && !isPitt) {
    note('This page is outside *.pitt.edu, so nothing can run here.', 'err');
  } else if (isPitt && !cs.alive) {
    note('Page is covered but the content script is not running. Reload the tab.', 'err');
  } else if (cs.alive && cs.count === 0) {
    note('Running, but no instructors detected. Use the picker below.', 'warn');
  }

  const settingsRes = await send({ type: 'GET_SETTINGS' });
  $('school').textContent = settingsRes.ok
    ? settingsRes.result.schoolLabel || settingsRes.result.schoolName
    : 'service worker not responding';

  send({ type: 'RESOLVE_SCHOOL' }).then((res) => {
    if (res.ok && res.result.schoolLabel) $('school').textContent = res.result.schoolLabel;
    else if (!res.ok) $('school').textContent = 'school lookup failed';
  });

  const engine = settingsRes.ok ? settingsRes.result.engine : 'local';
  const ai = await send({ type: 'AI_STATUS' });

  if (!ai.ok) {
    setPill($('ai'), 'unavailable', 'bad');
  } else if (engine === 'off') {
    setPill($('ai'), 'statistics only', 'ok');
  } else if (engine === 'nano') {
    const [text, kind] = NANO_COPY[ai.result.nano?.availability] || ['unknown', 'warn'];
    setPill($('ai'), text, kind);
  } else {
    const l = ai.result.local || {};
    const [text, kind] = LOCAL_COPY[l.status] || ['unknown', 'warn'];
    setPill($('ai'), text, kind);

    $('modelRow').style.display = 'flex';
    if (l.status === 'downloading') {
      $('modelState').textContent = `${l.pct || 0}%`;
    } else if (l.status === 'ready') {
      $('modelState').textContent = 'cached, offline';
    } else if (!l.webgpu) {
      $('modelState').textContent = 'WebGPU not available';
    } else {
      $('modelState').textContent = 'not downloaded yet';
    }

    const needsDownload = l.webgpu && l.status !== 'ready' && l.status !== 'downloading';
    $('download').style.display = needsDownload ? 'block' : 'none';
  }

  const stats = await send({ type: 'CACHE_STATS' });
  $('cache').textContent = stats.ok ? stats.result.entries : '–';
}

$('pick').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return note('No active tab.', 'err');

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
    else if (res && res.ready === false) note('Still looking professors up — the top-of-page button unlocks when done.', 'warn');
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
  note('Cache cleared.');
  refresh();
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
    `ai: ${ai.ok ? `${ai.result.supported} / ${ai.result.availability}` : 'error'}`,
    `selectors: ${settings.ok ? JSON.stringify(settings.result.customSelectors) : '?'}`,
    `ua: ${navigator.userAgent}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(report);
    note('Diagnostics copied. Paste them to me.');
  } catch {
    note(report, 'err');
  }
});

$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  $('download').textContent = 'Starting download…';
  note('Downloading Qwen2.5-0.5B. Keep this tab open; progress shows above.');
  const res = await send({ type: 'DOWNLOAD_MODEL' });
  if (!res.ok || res.result?.status === 'error') {
    note(`Download failed: ${res.result?.message || res.error}`, 'err');
    $('download').disabled = false;
    $('download').textContent = 'Retry download';
  } else {
    note('Model ready. Summaries are now written locally.');
    refresh();
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
