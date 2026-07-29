/* Professor Ratings for Pitt — content script.
 *
 * Detection is deliberately layered. PeopleSoft renders the instructor field
 * differently in the search list, the class detail view, and inside iframes,
 * so a single selector would break constantly. We try four strategies and
 * union the results; the element picker adds a fifth that always wins.
 */

(() => {
  'use strict';

  const NS = 'prb';
  const DEBOUNCE_MS = 250;
  const MAX_ELEMENTS_SCANNED = 6000;

  let settings = null;
  let openPanel = null;
  let processed = new WeakSet(); // reassigned on rescan; WeakSet has no clear()

  const log = (...args) => settings?.debug && console.log(`[${NS}]`, ...args);

  /* ---------------------------------------------------------------- */
  /* Messaging                                                         */
  /* ---------------------------------------------------------------- */

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: 'no response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Candidate discovery                                               */
  /* ---------------------------------------------------------------- */

  const LABEL_RE = /^\s*instructors?\s*:?\s*$/i;
  const INLINE_LABEL_RE = /^\s*instructors?\s*:\s*(.+)$/i;
  const HEADER_RE = /instructor|professor|faculty|taught\s*by/i;
  const VALUE_TAGS = 'th,td,dt,dd,label,span,div,strong,b,p,li,a,h4,h5,h6';

  function ownText(el) {
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
    }
    return out.trim();
  }

  // Column headers and field labels that sit next to instructor fields and
  // would otherwise get badged.
  const NON_NAME = new Set([
    'room', 'days', 'day', 'time', 'times', 'class', 'section', 'status',
    'seats', 'credits', 'units', 'location', 'building', 'dates', 'date',
    'career', 'topic', 'component', 'meeting', 'session', 'term', 'subject',
    'catalog', 'number', 'title', 'course', 'enrolled', 'capacity', 'waitlist',
    'mode', 'campus', 'department', 'notes', 'description', 'attributes',
    'requirements', 'availability', 'open', 'closed', 'wait list', 'tba',
    'start', 'end', 'instructors', 'actions', 'enroll', 'add', 'details',
  ]);

  function plausible(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 2 || t.length > 160) return false;
    if (!/[a-z]/i.test(t)) return false;
    if (LABEL_RE.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (NON_NAME.has(t.toLowerCase().replace(/[:*]/g, '').trim())) return false;
    // Reject things that are obviously a whole row of data.
    if ((t.match(/\d/g) || []).length > 6) return false;
    return true;
  }

  function addCandidate(map, el, text) {
    if (!el || !(el instanceof Element)) return;
    if (el.closest(`.${NS}-badge, .${NS}-panel`)) return;
    // Already badged, or an ancestor of something we badged -- its textContent
    // would include our own score text and corrupt the name.
    if (el.querySelector(`.${NS}-badge`)) return;
    if (!plausible(text)) return;
    if (map.has(el)) return;
    map.set(el, text.trim());
  }

  // 1. Selectors captured by the element picker. Highest priority.
  function byCustomSelector(root, map) {
    for (const sel of settings.customSelectors || []) {
      let nodes;
      try {
        nodes = root.querySelectorAll(sel);
      } catch {
        log('bad custom selector', sel);
        continue;
      }
      nodes.forEach((el) => addCandidate(map, el, el.textContent));
    }
  }

  // 2. Tables with an "Instructor" column header.
  function byTableColumn(root, map) {
    root.querySelectorAll('table').forEach((table) => {
      const headerRow =
        table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) return;

      const headers = Array.from(headerRow.children);
      const idx = headers.findIndex((h) => HEADER_RE.test(h.textContent || ''));
      if (idx < 0) return;

      table.querySelectorAll('tr').forEach((row) => {
        if (row === headerRow) return;
        const cell = row.children[idx];
        if (cell) addCandidate(map, cell, cell.textContent);
      });
    });
  }

  // 3. A label element followed by the value. Covers PeopleSoft's
  //    label/value div pairs and definition lists.
  function byLabel(root, map) {
    const nodes = root.querySelectorAll(VALUE_TAGS);
    let scanned = 0;

    for (const el of nodes) {
      if (++scanned > MAX_ELEMENTS_SCANNED) break;

      // A <th> saying "Instructor" is a column header, not a label whose value
      // is the next sibling. byTableColumn handles that case correctly.
      if (el.tagName === 'TH' || el.closest('thead')) continue;

      const text = ownText(el);
      if (!text || text.length > 200) continue;

      // "Instructor: Smith, John" all in one element.
      const inline = text.match(INLINE_LABEL_RE);
      if (inline) {
        addCandidate(map, el, inline[1]);
        continue;
      }

      if (!LABEL_RE.test(text)) continue;

      // Label sits alone; the value is nearby.
      const sibling = el.nextElementSibling;
      if (sibling && plausible(sibling.textContent)) {
        addCandidate(map, sibling, sibling.textContent);
        continue;
      }

      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c !== el);
        if (siblings.length === 1 && plausible(siblings[0].textContent)) {
          addCandidate(map, siblings[0], siblings[0].textContent);
          continue;
        }
        // Label in its own wrapper: check the wrapper's next sibling.
        const uncle = parent.nextElementSibling;
        if (uncle && plausible(uncle.textContent) && uncle.children.length <= 2) {
          addCandidate(map, uncle, uncle.textContent);
        }
      }
    }
  }

  // 4. Elements that name themselves.
  function byAttribute(root, map) {
    const sel = [
      '[class*="instructor" i]',
      '[id*="instructor" i]',
      '[data-instructor]',
      '[aria-label*="instructor" i]',
    ].join(',');

    let nodes;
    try {
      nodes = root.querySelectorAll(sel);
    } catch {
      return;
    }

    nodes.forEach((el) => {
      // A container whose class merely mentions "instructor" (an Angular
      // row wrapper, say) must not get every leaf inside it badged. Expand
      // to leaves, but bounded and pre-filtered.
      if (el.querySelector(VALUE_TAGS.split(',').slice(0, 6).join(','))) {
        const leaves = el.querySelectorAll(VALUE_TAGS);
        const limit = Math.min(leaves.length, 40);
        for (let i = 0; i < limit; i += 1) {
          const leaf = leaves[i];
          if (leaf.children.length !== 0) continue;
          const text = (leaf.textContent || '').trim();
          // Cheap pre-filter; the authoritative check runs in PARSE_BATCH.
          if (!text || /\d/.test(text)) continue;
          addCandidate(map, leaf, text);
        }
        return;
      }
      addCandidate(map, el, el.textContent);
    });
  }

  // 5. ARIA grid / div-based table (Angular Material and friends).
  function byAriaGrid(root, map) {
    const grids = root.querySelectorAll('[role="table"],[role="grid"],[role="treegrid"]');
    const scopes = grids.length ? Array.from(grids) : [root];

    for (const grid of scopes) {
      const headers = Array.from(grid.querySelectorAll('[role="columnheader"]'));
      if (!headers.length) continue;
      const idx = headers.findIndex((h) => HEADER_RE.test(h.textContent || ''));
      if (idx < 0) continue;

      grid.querySelectorAll('[role="row"]').forEach((row) => {
        const cells = Array.from(row.querySelectorAll('[role="cell"],[role="gridcell"]'));
        if (cells.length > idx) addCandidate(map, cells[idx], cells[idx].textContent);
      });
    }
  }

  // 6. Geometric fallback: find the element that reads "Instructor" and treat
  //    anything horizontally aligned beneath it as that column. Works on div
  //    grids with no table semantics at all, which is the case a selector-based
  //    approach cannot reach.
  function byColumnGeometry(root, map) {
    const headers = [];
    root.querySelectorAll('div,span,th,p,strong,b,label').forEach((el) => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (t.length > 24 || !HEADER_RE.test(t)) return;
      if (!/^\s*instructors?\s*:?\s*$/i.test(t)) return;
      headers.push(el);
    });

    for (const header of headers) {
      const hr = header.getBoundingClientRect();
      // jsdom and display:none elements report zeroes -- nothing to align to.
      if (!hr.width || !hr.height) continue;

      const container = header.closest('table,[role="table"],[role="grid"],section,div');
      if (!container) continue;

      const tolerance = Math.max(hr.width * 0.75, 40);
      const centerX = hr.left + hr.width / 2;

      const pool = container.querySelectorAll('div,span,td,a,p');
      const limit = Math.min(pool.length, 4000);
      for (let i = 0; i < limit; i += 1) {
        const el = pool[i];
        if (el === header || el.children.length) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.top <= hr.bottom) continue;
        if (Math.abs(r.left + r.width / 2 - centerX) > tolerance) continue;
        addCandidate(map, el, el.textContent);
      }
    }
  }

  /**
   * Several strategies legitimately match the same instructor at different
   * depths -- the grid cell and the span inside it. Keep only the innermost,
   * so the badge lands inline next to the text instead of wrapping below it.
   */
  function collapseNested(map) {
    // Keep only the innermost candidates. Walking each node's ancestors and
    // testing set membership is O(n x depth); the previous pairwise
    // contains() comparison was O(n^2) and got expensive on long result
    // pages where every row contributes candidates.
    const els = new Set(map.keys());
    const hasDescendant = new Set();

    for (const el of els) {
      let p = el.parentElement;
      while (p) {
        if (els.has(p)) hasDescendant.add(p);
        p = p.parentElement;
      }
    }

    const out = new Map();
    for (const [el, text] of map) {
      if (!hasDescendant.has(el)) out.set(el, text);
    }
    return out;
  }

  function findCandidates(root = document) {
    const map = new Map();
    const cheap = [byCustomSelector, byTableColumn, byAriaGrid, byLabel, byAttribute];
    for (const strategy of cheap) {
      try {
        strategy(root, map);
      } catch (err) {
        log('strategy failed', strategy.name, err);
      }
    }

    // byColumnGeometry calls getBoundingClientRect on hundreds of elements per
    // header, forcing synchronous layout each time. With dozens of course
    // headers per page and a scan on every mutation, that was the page lag.
    // It exists for layouts nothing else catches, so it only runs when
    // nothing else caught anything.
    if (map.size === 0) {
      try {
        byColumnGeometry(root, map);
      } catch (err) {
        log('strategy failed byColumnGeometry', err);
      }
    }

    return collapseNested(map);
  }

  /* ---------------------------------------------------------------- */
  /* Badges                                                            */
  /* ---------------------------------------------------------------- */

  function ratingClass(rating) {
    if (rating === null || rating === undefined) return 'unknown';
    if (rating >= 4.0) return 'good';
    if (rating >= 3.0) return 'mid';
    return 'poor';
  }

  function makeBadge(name) {
    const badge = document.createElement('span');
    badge.className = `${NS}-badge`;
    badge.dataset.state = 'loading';
    badge.dataset.name = name;
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('aria-label', `Ratings for ${name}, loading`);
    badge.innerHTML = `<span class="${NS}-dot"></span><span class="${NS}-score">…</span>`;

    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const state = badge.dataset.state;
      if (state === 'notfound') {
        window.open(
          `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent(name)}`,
          '_blank',
          'noopener'
        );
        return;
      }
      if (state === 'error') {
        badge.dataset.state = 'loading';
        badge.querySelector(`.${NS}-score`).textContent = '…';
        lookupCache.delete(name.toLowerCase());
        lookup(name, badge, campusForBadge(badge.parentElement || badge));
        return;
      }
      togglePanel(badge);
    };
    badge.addEventListener('click', activate);
    badge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate(e);
    });

    // A badge must never sit on "…" forever; after 60s something upstream is
    // wedged, so surface a retry instead.
    badge.__prbTimeout = setTimeout(() => {
      if (badge.isConnected && badge.dataset.state === 'loading') {
        paintBadge(badge, { status: 'error', message: 'Lookup timed out' });
      }
    }, 60000);

    return badge;
  }

  function paintBadge(badge, result) {
    badge.__prbResult = result;
    clearTimeout(badge.__prbTimeout);
    queueRankRefresh();

    if (result.status === 'ok') {
      const t = result.teacher;
      const cls = ratingClass(t.avgRating);
      badge.dataset.state = 'ok';
      badge.dataset.rating = cls;
      badge.dataset.confidence = result.confidence;
      const score = t.avgRating ? t.avgRating.toFixed(1) : '–';
      badge.querySelector(`.${NS}-score`).textContent = score;
      badge.setAttribute(
        'aria-label',
        `${t.firstName} ${t.lastName}: ${score} out of 5 from ${t.numRatings} ratings`
      );
      badge.title = `${t.firstName} ${t.lastName} — ${score}/5 (${t.numRatings} ratings)${
        result.confidence === 'low' ? ' — uncertain match' : ''
      }\nClick for summary and comments`;
      return;
    }

    if (result.status === 'notfound') {
      if (settings.hideWhenNotFound) {
        badge.remove();
        return;
      }
      badge.dataset.state = 'notfound';
      badge.querySelector(`.${NS}-score`).textContent = 'no RMP';
      badge.title = `No RateMyProfessors page found for ${badge.dataset.name} at any campus.\nClick to search RMP yourself.`;
      badge.setAttribute('aria-label', `No ratings found for ${badge.dataset.name}; click to search RateMyProfessors`);
      return;
    }

    if (result.status === 'placeholder' || result.status === 'unparseable') {
      badge.remove();
      return;
    }

    badge.dataset.state = 'error';
    badge.querySelector(`.${NS}-score`).textContent = 'retry';
    badge.title = `${result.message || 'Lookup failed'}\nClick to try again.`;
  }

  /* ---------------------------------------------------------------- */
  /* Detail panel                                                      */
  /* ---------------------------------------------------------------- */

  function closePanel() {
    if (openPanel) {
      try { openPanel.__prbResizeObserver?.disconnect(); } catch { /* ok */ }
      openPanel.remove();
      openPanel = null;
    }
  }

  function stat(label, value, suffix = '') {
    return `
      <div class="${NS}-stat">
        <div class="${NS}-stat-value">${value === null || value === undefined ? '–' : value}${
      value === null || value === undefined ? '' : suffix
    }</div>
        <div class="${NS}-stat-label">${label}</div>
      </div>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function togglePanel(badge) {
    if (openPanel && openPanel.__owner === badge) {
      closePanel();
      return;
    }
    closePanel();

    const result = badge.__prbResult;
    if (!result || result.status !== 'ok') return;

    const t = result.teacher;
    const panel = document.createElement('div');
    panel.className = `${NS}-panel`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Ratings for ${t.firstName} ${t.lastName}`);
    panel.__owner = badge;

    panel.innerHTML = `
      <div class="${NS}-panel-head">
        <div>
          <div class="${NS}-panel-name">${esc(t.firstName)} ${esc(t.lastName)}</div>
          <div class="${NS}-panel-dept">${esc(t.department || 'Department not listed')}${
            t.campus ? ` · ${esc(t.campus)}` : ''
          }</div>
        </div>
        <button class="${NS}-close" aria-label="Close">×</button>
      </div>

      ${
        result.confidence === 'low'
          ? `<div class="${NS}-warn">Uncertain match — several professors share this name. Check the RMP page before trusting this.</div>`
          : ''
      }

      <div class="${NS}-stats">
        ${stat('Overall', t.avgRating ? t.avgRating.toFixed(1) : null, '/5')}
        ${stat('Difficulty', t.avgDifficulty ? t.avgDifficulty.toFixed(1) : null, '/5')}
        ${stat('Would retake', t.wouldTakeAgainPercent, '%')}
        ${stat('Ratings', t.numRatings)}
      </div>

      <div class="${NS}-tags" hidden></div>

      <div class="${NS}-section">
        <div class="${NS}-section-title">What students say</div>
        <div class="${NS}-summary" data-state="loading">Loading reviews…</div>
      </div>

      <div class="${NS}-section">
        <div class="${NS}-section-title ${NS}-comments-title">Recent comments</div>
        <div class="${NS}-comments"><div class="${NS}-empty">Loading…</div></div>
      </div>

      <a class="${NS}-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">
        Open on RateMyProfessors →
      </a>
    `;

    document.body.appendChild(panel);
    openPanel = panel;
    position(panel, badge);

    // Content streams in after open; keep the panel inside the viewport as it
    // grows rather than positioning once against its empty loading state.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => position(panel, badge));
      ro.observe(panel);
      panel.__prbResizeObserver = ro;
    }

    panel.querySelector(`.${NS}-close`).addEventListener('click', closePanel);
    panel.addEventListener('click', (e) => e.stopPropagation());

    loadDetailThenSummary(panel, t);
  }

  const PANEL_MARGIN = 12;
  const PANEL_GAP = 8;

  /**
   * Place the panel and bound its height to whichever side of the badge has
   * more room. Called on open AND whenever the panel resizes: the summary and
   * comments arrive asynchronously, so a panel sized for its loading state
   * grows afterwards and used to run off the bottom of the screen.
   */
  function position(panel, badge) {
    if (!panel.isConnected || !badge.isConnected) return;

    const r = badge.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const spaceBelow = vh - r.bottom - PANEL_GAP - PANEL_MARGIN;
    const spaceAbove = r.top - PANEL_GAP - PANEL_MARGIN;
    const below = spaceBelow >= spaceAbove;
    const available = Math.max(below ? spaceBelow : spaceAbove, 160);

    // Cap height to the room actually available, so the panel scrolls
    // internally instead of overflowing the viewport.
    panel.style.setProperty('max-height', `${Math.floor(available)}px`, 'important');

    const h = Math.min(panel.offsetHeight || 300, available);
    const w = panel.offsetWidth || 340;

    let left = r.left;
    if (left + w > vw - PANEL_MARGIN) left = vw - w - PANEL_MARGIN;
    if (left < PANEL_MARGIN) left = PANEL_MARGIN;

    let top = below ? r.bottom + PANEL_GAP : r.top - h - PANEL_GAP;
    top = Math.max(PANEL_MARGIN, Math.min(top, vh - h - PANEL_MARGIN));

    panel.style.setProperty('left', `${left}px`, 'important');
    panel.style.setProperty('top', `${top}px`, 'important');
  }

  function renderHeuristicSummary(s, prose, source) {
    const parts = [];

    if (prose) {
      parts.push(`<div class="${NS}-prose">${esc(prose)}</div>`);
    } else {
      parts.push(`<div class="${NS}-headline">${esc(s.headline)}</div>`);
    }

    if (s.aspects && s.aspects.length) {
      parts.push(
        `<div class="${NS}-aspects">` +
          s.aspects
            .map(
              (a) => `
              <div class="${NS}-aspect" data-sentiment="${esc(a.sentiment)}">
                <div class="${NS}-aspect-head">
                  <span class="${NS}-aspect-label">${esc(a.label)}</span>
                  <span class="${NS}-aspect-meta">${esc(a.sentiment)} · ${a.mentions} mention${
                a.mentions === 1 ? '' : 's'
              }</span>
                </div>
                ${a.quote ? `<div class="${NS}-aspect-quote">${esc(a.quote)}</div>` : ''}
              </div>`
            )
            .join('') +
          `</div>`
      );
    }

    if (s.trend) parts.push(`<div class="${NS}-trend">${esc(s.trend)}</div>`);

    if (s.courses && s.courses.length) {
      parts.push(
        `<div class="${NS}-courses">
           <div class="${NS}-courses-title">Varies by course</div>` +
          s.courses
            .map(
              (c) => `<div class="${NS}-course">
                  <span class="${NS}-course-code">${esc(c.code)}</span>
                  <span class="${NS}-course-stat">${c.avg !== null ? `${c.avg}/5` : '—'} · ${
                c.count
              } review${c.count === 1 ? '' : 's'}</span>
                </div>`
            )
            .join('') +
          `</div>`
      );
    }

    return parts.join('');
  }

  async function loadDetailThenSummary(panel, light) {
    const res = await send({ type: 'TEACHER_DETAIL', teacherId: light.id });
    if (!openPanel || !panel.isConnected) return;

    const detail = res?.ok && res.result?.status === 'ok' ? res.result.teacher : null;
    if (!detail) {
      panel.querySelector(`.${NS}-summary`).dataset.state = 'off';
      panel.querySelector(`.${NS}-summary`).textContent = 'Could not load reviews.';
      panel.querySelector(`.${NS}-comments`).innerHTML =
        `<div class="${NS}-empty">Reviews unavailable right now.</div>`;
      return;
    }

    // Merge: figures came from search, comments and tags from detail.
    const teacher = { ...detail, campus: light.campus, url: light.url || detail.url };

    const tagsEl = panel.querySelector(`.${NS}-tags`);
    if (teacher.tags && teacher.tags.length) {
      tagsEl.innerHTML = teacher.tags
        .map((tag) => `<span class="${NS}-tag">${esc(tag.name)}</span>`)
        .join('');
      tagsEl.hidden = false;
    }

    const commentsEl = panel.querySelector(`.${NS}-comments`);
    commentsEl.innerHTML = teacher.ratings && teacher.ratings.length
      ? teacher.ratings
          .slice(0, 3)
          .map(
            (r) => `
            <div class="${NS}-comment">
              ${r.class ? `<span class="${NS}-comment-class">${esc(r.class)}</span>` : ''}
              <span>${esc(String(r.comment).slice(0, 340))}</span>
            </div>`
          )
          .join('')
      : `<div class="${NS}-empty">No written reviews yet.</div>`;

    await loadSummary(panel, teacher);
  }

  async function loadSummary(panel, teacher) {
    const box = panel.querySelector(`.${NS}-summary`);
    const res = await send({ type: 'SUMMARIZE_TEACHER', teacher });

    if (!openPanel || !panel.isConnected) return;

    const data = res?.ok ? res.result : null;

    if (data?.status === 'ok' && data.summary) {
      const body = renderHeuristicSummary(data.summary, data.prose, data.source);

      if (body) {
        box.dataset.state = 'ok';
        const engineLabel =
          data.source === 'local' ? 'Written by Qwen2.5-0.5B on your machine' : null;
        const foot = engineLabel
          ? `${engineLabel} · figures computed from ${data.summary.reviewsAnalyzed} reviews`
          : `Computed from ${data.summary.reviewsAnalyzed} reviews — quotes are verbatim`;
        box.innerHTML = `${body}<div class="${NS}-sum-foot">${foot}</div>`;

        // Swap the recent comments for the most representative ones, skipping
        // anything already quoted above.
        if (data.summary.quotes?.length) {
          const used = new Set((data.summary.aspects || []).map((a) => a.quote).filter(Boolean));
          const picks = data.summary.quotes.filter((q) => !used.has(q));
          if (picks.length) {
            const section = panel.querySelector(`.${NS}-comments`);
            const title = panel.querySelector(`.${NS}-comments-title`);
            if (title) title.textContent = 'Most representative comments';
            if (section) {
              section.innerHTML = picks
                .map((q) => `<div class="${NS}-comment"><span>${esc(q)}</span></div>`)
                .join('');
            }
          }
        }
        return;
      }
    }

    box.dataset.state = 'off';
    if (data?.status === 'insufficient') {
      box.textContent = `Only ${data.count} written review${
        data.count === 1 ? '' : 's'
      } — read it below rather than trusting a summary.`;
    } else {
      box.textContent = 'Could not build a summary. The raw comments are below.';
    }
  }

  document.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });
  window.addEventListener('resize', closePanel, { passive: true });
  window.addEventListener(
    'scroll',
    (e) => {
      if (!openPanel) return; // nothing to close; keep scrolling free
      // The panel scrolls internally; only close on scrolls outside it.
      const t = e.target;
      if (t instanceof Element && t.closest(`.${NS}-panel`)) return;
      if (t instanceof Node && openPanel && openPanel.contains(t)) return;
      closePanel();
    },
    { passive: true, capture: true }
  );


  /* ---------------------------------------------------------------- */
  /* Rank tab -- persistent button hanging from the top of the page    */
  /* ---------------------------------------------------------------- */

  let rankExpanded = false;

  function badgeCounts() {
    let loading = 0;
    const ok = new Set();
    document.querySelectorAll(`.${NS}-badge`).forEach((b) => {
      if (!b.isConnected) return;
      if (b.dataset.state === 'loading') loading += 1;
      else if (b.dataset.state === 'ok' && b.__prbResult?.teacher?.id) {
        ok.add(b.__prbResult.teacher.id);
      }
    });
    return { loading, ok: ok.size };
  }

  function collectRanked() {
    const seen = new Map();
    document.querySelectorAll(`.${NS}-badge[data-state="ok"]`).forEach((badge) => {
      const r = badge.__prbResult;
      if (!r || r.status !== 'ok' || !badge.isConnected) return;
      const t = r.teacher;
      if (!seen.has(t.id)) seen.set(t.id, { t, badges: [], confidence: r.confidence });
      seen.get(t.id).badges.push(badge);
    });
    return Array.from(seen.values()).sort((a, b) => {
      const ar = a.t.avgRating ?? -1;
      const br = b.t.avgRating ?? -1;
      if (br !== ar) return br - ar;
      return (b.t.numRatings || 0) - (a.t.numRatings || 0);
    });
  }

  // Referenced nodes can be silently detached when the SPA re-renders, so
  // removal always goes through selectors, never through saved references.
  function removeAll(selector) {
    document.querySelectorAll(selector).forEach((el) => el.remove());
  }

  function collapseRank() {
    rankExpanded = false;
    removeAll(`.${NS}-rank`);
    const tab = document.querySelector(`.${NS}-rank-tab`);
    if (tab) tab.setAttribute('aria-expanded', 'false');
  }

  function ensureRankTab() {
    // Only the frame that actually has badges owns a tab. This is also what
    // prevents empty sibling frames from drawing panels over the real one.
    const hasBadges = !!document.querySelector(`.${NS}-badge`);
    let tab = document.querySelector(`.${NS}-rank-tab`);

    if (!hasBadges) {
      if (tab) { tab.remove(); collapseRank(); }
      return;
    }

    if (!tab || !tab.isConnected) {
      removeAll(`.${NS}-rank-tab`); // clear any detached strays first
      tab = document.createElement('button');
      tab.className = `${NS}-rank-tab`;
      tab.type = 'button';
      tab.setAttribute('aria-expanded', 'false');
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tab.dataset.ready !== '1') return;
        if (rankExpanded) collapseRank();
        else expandRank();
      });
      document.documentElement.appendChild(tab);
    }

    refreshRankTab();
  }

  function refreshRankTab() {
    const tab = document.querySelector(`.${NS}-rank-tab`);
    if (!tab) return;

    const { loading, ok } = badgeCounts();

    if (loading > 0) {
      tab.dataset.ready = '0';
      tab.disabled = true;
      tab.innerHTML = `<span class="${NS}-tab-spin"></span> Looking up professors… ${loading} left`;
      tab.title = 'Ranking unlocks once every professor on the page has resolved.';
      // Deliberately do NOT collapse an open panel here: expanding a section
      // row adds badges, and yanking the panel shut mid-read is hostile.
      // It stays open and refreshes as results arrive.
      if (rankExpanded) renderRankList();
      return;
    }

    if (ok === 0) {
      tab.dataset.ready = '0';
      tab.disabled = true;
      tab.textContent = 'No rated professors on this page';
      tab.title = 'None of the instructors here have a RateMyProfessors page.';
      return;
    }

    tab.dataset.ready = '1';
    tab.disabled = false;
    tab.innerHTML = `Rank ${ok} professor${ok === 1 ? '' : 's'} <span class="${NS}-tab-arrow">${
      rankExpanded ? '▴' : '▾'
    }</span>`;
    tab.title = 'Show every professor on this page, best rating first.';

    // Live-refresh the open list when the badge set changes underneath it.
    if (rankExpanded) renderRankList();
  }

  function expandRank() {
    rankExpanded = true;
    const tab = document.querySelector(`.${NS}-rank-tab`);
    if (tab) tab.setAttribute('aria-expanded', 'true');
    renderRankList();
    refreshRankTab();
  }

  let rankPos = null;      // {left, top} in px, persisted across pages
  let rankDragging = false; // true while a pointer drag is in progress

  function loadRankPos() {
    try {
      chrome.storage?.local?.get('prbRankPos', (bag) => {
        if (bag && bag.prbRankPos) rankPos = bag.prbRankPos;
      });
    } catch { /* storage unavailable (tests) */ }
  }

  function saveRankPos() {
    try {
      chrome.storage?.local?.set({ prbRankPos: rankPos });
    } catch { /* ignore */ }
  }

  function applyRankPos(panel) {
    if (!rankPos) return;
    const w = panel.offsetWidth || 360;
    const left = Math.min(Math.max(rankPos.left, 4), window.innerWidth - w - 4);
    const top = Math.min(Math.max(rankPos.top, 4), window.innerHeight - 60);
    // The stylesheet positions the panel with !important (to defeat host page
    // CSS), and plain inline styles lose to that. These must be !important too
    // or dragging computes positions the panel never adopts.
    panel.style.setProperty('left', `${left}px`, 'important');
    panel.style.setProperty('top', `${top}px`, 'important');
    panel.style.setProperty('transform', 'none', 'important');
  }

  function makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let origin = null;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      origin = { left: rect.left, top: rect.top };
      startX = e.clientX;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      rankDragging = true;
      panel.classList.add(`${NS}-dragging`);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!origin) return;
      const left = origin.left + (e.clientX - startX);
      const top = origin.top + (e.clientY - startY);
      rankPos = {
        left: Math.min(Math.max(left, 4), window.innerWidth - panel.offsetWidth - 4),
        top: Math.min(Math.max(top, 4), window.innerHeight - 60),
      };
      applyRankPos(panel);
    });

    const finish = (e) => {
      if (!origin) return;
      origin = null;
      rankDragging = false;
      panel.classList.remove(`${NS}-dragging`);
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      saveRankPos();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function jumpToBadge(badge) {
    if (!badge?.isConnected) return;
    badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
    badge.classList.add(`${NS}-flash`);
    setTimeout(() => badge.classList.remove(`${NS}-flash`), 1600);
  }

  function renderRankList() {
    // Rebuilding mid-drag would destroy the element holding pointer capture.
    if (rankDragging) return;

    const prev = document.querySelector(`.${NS}-rank`);
    const prevScroll = prev ? prev.scrollTop : 0;
    removeAll(`.${NS}-rank`);

    const ranked = collectRanked();
    const panel = document.createElement('div');
    panel.className = `${NS}-rank`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Professors on this page ranked by rating');

    const rows = ranked
      .map((x, i) => {
        const t = x.t;
        const score = t.avgRating ? t.avgRating.toFixed(1) : '–';
        const cls = ratingClass(t.avgRating);
        return `
        <div class="${NS}-rank-row" data-idx="${i}" role="button" tabindex="0"
             title="Click to jump to this professor on the page">
          <span class="${NS}-rank-pos">${i + 1}</span>
          <span class="${NS}-rank-name">${esc(t.firstName)} ${esc(t.lastName)}${
          x.confidence === 'low' ? ` <span class="${NS}-rank-unsure" title="Uncertain match">?</span>` : ''
        }<span class="${NS}-rank-sub">${esc(t.department || '')}${
          t.campus ? ` · ${esc(t.campus)}` : ''
        }</span></span>
          <span class="${NS}-rank-stats">${
          t.avgDifficulty ? `diff ${t.avgDifficulty.toFixed(1)}` : ''
        } · ${t.numRatings} ratings</span>
          <span class="${NS}-rank-score" data-rating="${cls}">${score}</span>
        </div>`;
      })
      .join('');

    panel.innerHTML = `
      <div class="${NS}-rank-drag" title="Drag to move">
        <span class="${NS}-rank-grip">⋮⋮</span>
        <span>Professors on this page — best first</span>
      </div>
      ${rows}`;

    document.documentElement.appendChild(panel);
    applyRankPos(panel);
    if (prevScroll) panel.scrollTop = prevScroll;
    makeDraggable(panel, panel.querySelector(`.${NS}-rank-drag`));
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.querySelectorAll(`.${NS}-rank-row`).forEach((row) => {
      const go = () => jumpToBadge(ranked[Number(row.dataset.idx)].badges[0]);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') collapseRank();
  });

  let rankRefreshTimer = null;
  function queueRankRefresh() {
    clearTimeout(rankRefreshTimer);
    rankRefreshTimer = setTimeout(ensureRankTab, 200);
  }

  /* ---------------------------------------------------------------- */
  /* Scan + inject                                                     */
  /* ---------------------------------------------------------------- */

  async function scan() {
    if (!settings) return false;

    const candidates = findCandidates(document);
    const fresh = [];

    for (const [el, text] of candidates) {
      if (processed.has(el) || el.dataset[`${NS}Done`]) continue;
      fresh.push([el, text]);
    }

    log('candidates', candidates.size, 'fresh', fresh.length);
    if (!fresh.length) return false;

    // Claim before awaiting. A mutation during the round trip can start a
    // second scan, and if these were still unmarked it would badge the same
    // cells twice. Claims are released below if the request fails.
    for (const [el] of fresh) {
      processed.add(el);
      el.dataset[`${NS}Done`] = '1';
    }

    const res = await send({ type: 'PARSE_BATCH', texts: fresh.map(([, t]) => t) });
    if (!res?.ok) {
      log('parse batch failed', res?.error);
      for (const [el] of fresh) delete el.dataset[`${NS}Done`];
      return false;
    }

    const parsedList = res.result;
    let made = 0;

    fresh.forEach(([el], i) => {
      const namesForEl = parsedList[i] || [];
      if (!namesForEl.length) return;

      for (const name of namesForEl) {
        made += 1;
        const badge = makeBadge(name);
        el.appendChild(document.createTextNode(' '));
        el.appendChild(badge);
        unclip(el);
        lookup(name, badge, campusForBadge(el));
      }
    });

    if (made > 0) queueRankRefresh();
    return made > 0;
  }

  const CAMPUS_RE = /\b(Bradford|Greensburg|Johnstown|Titusville|Pittsburgh)\b/i;

  /**
   * The class-search grid carries a CAMPUS column. Reading it lets the lookup
   * query one RMP school instead of fanning out across all five, which is the
   * difference between one request per professor and five.
   */
  function campusForBadge(el) {
    let node = el;
    for (let depth = 0; depth < 6 && node; depth += 1) {
      const text = (node.textContent || '');
      if (text.length < 4000) {
        const m = text.match(CAMPUS_RE);
        if (m) return m[1];
      }
      node = node.parentElement;
    }
    return null;
  }

  const lookupCache = new Map();

  /**
   * PeopleSoft clips the instructor column with text-overflow: ellipsis. Adding
   * a badge pushes the name past that limit, so the name itself gets truncated.
   * Relax the clipping on the badged element only.
   */
  function unclip(el) {
    try {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('text-overflow', 'clip', 'important');
      }
      if (cs.whiteSpace === 'nowrap') {
        el.style.setProperty('white-space', 'normal', 'important');
      }
    } catch {
      /* getComputedStyle can throw on detached nodes */
    }
  }

  function lookup(name, badge, campusHint) {
    const key = name.toLowerCase();
    if (!lookupCache.has(key)) {
      lookupCache.set(
        key,
        send({ type: 'LOOKUP', name, campusHint }).then((res) =>
          res?.ok ? res.result : { status: 'error', message: res?.error }
        )
      );
    }
    lookupCache.get(key).then((result) => paintBadge(badge, result));
  }

  /* ---------------------------------------------------------------- */
  /* Observe                                                           */
  /* ---------------------------------------------------------------- */

  let timer = null;
  let idleStreak = 0;
  let firstScan = true;

  // On pages with no instructor content, repeated full scans are pure waste.
  // Each empty scan stretches the debounce: 250ms -> 1s -> 2.5s -> 5s cap.
  // Backoff only ever applies to pages that keep coming up empty. Anything
  // that looks like real results resets it (see resetBackoffFor), so the
  // moment search results render we are back to the fast path.
  function currentDebounce() {
    if (firstScan) return 0;          // first look costs nothing; do it now
    if (idleStreak >= 6) return 2000; // capped: an idle page should be cheap,
    if (idleStreak >= 4) return 1200; // not unresponsive when content lands
    if (idleStreak >= 2) return 600;
    return DEBOUNCE_MS;
  }

  // A results grid appearing is the signal that the page just became
  // interesting. Without this the backoff built up while you pick term,
  // campus and subject -- every dropdown mutation is an empty scan -- and
  // then delayed the scan of the results you actually asked for.
  const RESULTS_SELECTOR = 'table,tbody,tr,[role="row"],[role="table"],[role="grid"],[role="gridcell"]';

  function looksLikeResults(node) {
    if (!(node instanceof Element)) return false;
    if (node.childElementCount > 3) return true;
    try {
      return node.matches(RESULTS_SELECTOR) || !!node.querySelector(RESULTS_SELECTOR);
    } catch {
      return false;
    }
  }

  function queueScan() {
    if (document.hidden) return; // rescan on visibilitychange instead
    clearTimeout(timer);
    timer = setTimeout(async () => {
      firstScan = false;
      try {
        const found = await scan();
        idleStreak = found ? 0 : idleStreak + 1;
      } catch (e) {
        log('scan error', e);
      }
    }, currentDebounce());
  }

  function startObserver() {
    const isOurs = (node) =>
      node instanceof Element &&
      (node.classList?.contains(`${NS}-badge`) || node.classList?.contains(`${NS}-panel`));

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const target = m.target;
        if (target instanceof Element && target.closest(`.${NS}-badge, .${NS}-panel`)) continue;
        // Ignore mutations that are purely our own badge insertions.
        const added = Array.from(m.addedNodes);
        if (added.length && added.every((n) => isOurs(n) || n.nodeType === Node.TEXT_NODE)) continue;
        if (added.some(looksLikeResults)) idleStreak = 0; // results just landed
        queueScan();
        return;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'PRB_RESCAN') {
      processed = new WeakSet();
      document.querySelectorAll(`[data-${NS}-done]`).forEach((el) => {
        delete el.dataset[`${NS}Done`];
      });
      document.querySelectorAll(`.${NS}-badge`).forEach((b) => b.remove());
      collapseRank();
      removeAll(`.${NS}-rank-tab`);
      lookupCache.clear();
      scan().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg?.type === 'PRB_RANK') {
      const tab = document.querySelector(`.${NS}-rank-tab`);
      if (tab && tab.dataset.ready === '1') expandRank();
      sendResponse({ ok: true, ready: tab?.dataset.ready === '1' });
      return false;
    }
    if (msg?.type === 'PRB_COUNT') {
      sendResponse({ ok: true, count: document.querySelectorAll(`.${NS}-badge`).length });
      return false;
    }
    return false;
  });

  (async () => {
    // Optimistic defaults so the first scan does not wait on a service worker
    // cold start. Real settings arrive below and only affect custom selectors
    // and display preferences, neither of which changes what gets detected.
    settings = { customSelectors: [], debug: false, hideWhenNotFound: false };
    startObserver();
    queueScan();

    const res = await send({ type: 'GET_SETTINGS' });
    if (res?.ok && res.result) {
      const hadCustom = (res.result.customSelectors || []).length > 0;
      settings = res.result;
      // A saved picker selector can reach elements the defaults missed.
      if (hadCustom) queueScan();
    } else {
      console.warn(`[${NS}] could not load settings; using defaults`);
    }

    log('booted', location.href);
    loadRankPos();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) queueScan();
    });
    queueScan();
  })();
})();
