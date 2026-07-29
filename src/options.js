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

function renderSelectors() {
  const list = $('selectorList');
  const sels = settings.customSelectors || [];
  if (!sels.length) {
    list.innerHTML = '<li class="empty">None saved yet.</li>';
    return;
  }
  list.innerHTML = '';
  sels.forEach((sel, i) => {
    const li = document.createElement('li');
    const code = document.createElement('span');
    code.textContent = sel;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      const next = sels.filter((_, j) => j !== i);
      const res = await send({ type: 'SET_SETTINGS', patch: { customSelectors: next } });
      if (res.ok) {
        settings = res.result;
        renderSelectors();
        status('Selector removed.');
      }
    });
    li.append(code, btn);
    list.appendChild(li);
  });
}

function render() {
  $('schoolName').value = settings.schoolName || '';
  $('resolved').textContent = settings.schoolLabel || 'not yet resolved';
  const engine = settings.engine || 'local';
  const radio = document.querySelector(`input[name="engine"][value="${engine}"]`);
  if (radio) radio.checked = true;
  $('minRatings').value = settings.minRatingsForSummary ?? 3;
  $('hideWhenNotFound').checked = !!settings.hideWhenNotFound;
  $('debug').checked = !!settings.debug;
  renderSelectors();
}

$('save').addEventListener('click', async () => {
  const patch = {
    schoolName: $('schoolName').value.trim(),
    engine: document.querySelector('input[name="engine"]:checked')?.value || 'local',
    minRatingsForSummary: Math.max(1, Number($('minRatings').value) || 3),
    hideWhenNotFound: $('hideWhenNotFound').checked,
    debug: $('debug').checked,
  };
  if (patch.schoolName !== settings.schoolName) {
    patch.schools = [];
    patch.schoolLabel = '';
  }
  const res = await send({ type: 'SET_SETTINGS', patch });
  if (!res.ok) return status(res.error || 'Could not save.', true);
  settings = res.result;
  render();
  status('Saved.');
});

$('findSchool').addEventListener('click', async () => {
  const text = $('schoolName').value.trim();
  if (!text) return status('Type a school name first.', true);

  status('Searching RateMyProfessors…');
  const res = await send({ type: 'SEARCH_SCHOOLS', text });
  const box = $('schoolResults');
  box.innerHTML = '';

  if (!res.ok) return status(res.error || 'Search failed.', true);
  if (!res.result.length) return status('No matching school found.', true);

  status('');
  res.result.slice(0, 6).forEach((school) => {
    const btn = document.createElement('button');
    btn.textContent = `${school.name}${school.city ? ` — ${school.city}, ${school.state}` : ''}`;
    btn.addEventListener('click', async () => {
      const label = btn.textContent;
      // Store the picked school's name and clear the family; the resolver
      // will rebuild it including sibling campuses of the same institution.
      const saved = await send({
        type: 'SET_SETTINGS',
        patch: { schools: [], schoolLabel: '', schoolName: school.name },
      });
      if (saved.ok) {
        settings = saved.result;
        render();
        box.innerHTML = '';
        status('School set. Clearing cached ratings…');
        await send({ type: 'CLEAR_CACHE' });
        status('School set.');
      }
    });
    box.appendChild(btn);
  });
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
  send({ type: 'RESOLVE_SCHOOL' }).then((r) => {
    if (r.ok) {
      settings = { ...settings, ...r.result };
      $('resolved').textContent = settings.schoolLabel || 'not yet resolved';
    }
  });
})();
