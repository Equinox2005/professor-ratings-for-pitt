function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false });
    });
  });
}

const $ = (id) => document.getElementById(id);

function status(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'status err' : 'status';
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3500);
}

let settings = null;

function render() {
  $('aiSummaries').checked = settings.aiSummaries !== false;
  $('minRatings').value = settings.minRatingsForSummary ?? 3;
  $('hideWhenNotFound').checked = !!settings.hideWhenNotFound;
  $('debug').checked = !!settings.debug;
}

$('save').addEventListener('click', async () => {
  const patch = {
    aiSummaries: $('aiSummaries').checked,
    minRatingsForSummary: Math.max(1, Number($('minRatings').value) || 3),
    hideWhenNotFound: $('hideWhenNotFound').checked,
    debug: $('debug').checked,
  };
  const res = await send({ type: 'SET_SETTINGS', patch });
  if (!res.ok) return status(res.error || 'Could not save.', true);
  settings = res.result;
  render();
  status('Saved.');
});

$('clearCache').addEventListener('click', async () => {
  await send({ type: 'CLEAR_CACHE' });
  status('Cache cleared.');
});

$('reset').addEventListener('click', async () => {
  const res = await send({ type: 'RESET_SETTINGS' });
  if (res.ok) {
    settings = res.result;
    render();
    status('Settings reset.');
  }
});

(async () => {
  const res = await send({ type: 'GET_SETTINGS' });
  settings = res.ok ? res.result : {};
  render();
})();
