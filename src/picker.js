/* Injected on demand. Lets you point at the instructor field so the extension
 * can derive a selector instead of guessing at PeopleSoft's markup. */

(() => {
  if (window.__prbPickerActive) return;
  // Injected into every frame; ignore the tiny hidden ones PeopleSoft uses.
  if (!document.body) return;
  if (window.innerWidth < 200 || window.innerHeight < 200) return;
  window.__prbPickerActive = true;

  const overlay = document.createElement('div');
  overlay.className = 'prb-pick-overlay';
  document.body.appendChild(overlay);

  // The overlay can't take pointer events, so set the cursor globally instead.
  const cursorStyle = document.createElement('style');
  cursorStyle.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
  document.head.appendChild(cursorStyle);

  const hud = document.createElement('div');
  hud.className = 'prb-pick-hud';
  hud.textContent = 'Click the instructor name. Press Esc to cancel.';
  document.body.appendChild(hud);

  let current = null;

  /* --------------------------------------------------------------- */
  /* Selector generation                                              */
  /* --------------------------------------------------------------- */

  // Classes that look machine-generated are useless across page loads.
  function stableClasses(el) {
    return Array.from(el.classList).filter(
      (c) =>
        c &&
        c.length < 40 &&
        !c.startsWith('prb-') &&
        !/\d{3,}/.test(c) &&
        !/^(ng|css|jsx|sc)-/.test(c) &&
        !/^[a-f0-9]{6,}$/i.test(c)
    );
  }

  function simpleSelector(el) {
    const tag = el.tagName.toLowerCase();
    const classes = stableClasses(el);
    if (classes.length) return tag + '.' + classes.slice(0, 3).map(CSS.escape).join('.');
    if (el.id && !/\d{3,}/.test(el.id)) return `${tag}#${CSS.escape(el.id)}`;
    return tag;
  }

  function nthSelector(el) {
    const parent = el.parentElement;
    if (!parent) return simpleSelector(el);
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (sameTag.length === 1) return simpleSelector(el);
    return `${simpleSelector(el)}:nth-of-type(${sameTag.indexOf(el) + 1})`;
  }

  /**
   * Build a list of candidate selectors, cheapest and most general first.
   * We want one that matches the instructor cell in *every* result row, so
   * matching many elements is a feature, not a bug.
   */
  function candidates(el) {
    const out = [];
    const self = simpleSelector(el);
    if (self.includes('.') || self.includes('#')) out.push(self);

    let node = el;
    let path = nthSelector(el);
    for (let depth = 0; depth < 4 && node.parentElement; depth += 1) {
      node = node.parentElement;
      if (node === document.body) break;

      const parentSel = simpleSelector(node);
      if (parentSel.includes('.') || parentSel.includes('#')) {
        out.push(`${parentSel} ${self}`);
        out.push(`${parentSel} ${path}`);
      }
      path = `${nthSelector(node)} > ${path}`;
    }

    out.push(path);
    return [...new Set(out)];
  }

  function textLooksLikeName(s) {
    const t = String(s || '').trim();
    if (t.length < 3 || t.length > 160) return false;
    return /[a-z]/i.test(t) && !/^\s*instructors?\s*:?\s*$/i.test(t);
  }

  function chooseSelector(el) {
    for (const sel of candidates(el)) {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(sel));
      } catch {
        continue;
      }
      if (!matches.includes(el)) continue;
      if (matches.length > 300) continue;
      // Every match should look like a name, otherwise the selector is too broad.
      const good = matches.filter((m) => textLooksLikeName(m.textContent));
      if (good.length / matches.length >= 0.7) {
        return { selector: sel, matches: matches.length };
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- */
  /* Interaction                                                      */
  /* --------------------------------------------------------------- */

  function highlight(el) {
    if (current) current.classList.remove('prb-pick-target');
    current = el;
    if (current) current.classList.add('prb-pick-target');
  }

  function onMove(e) {
    // With pointer-events:none on the overlay, the event target is the real
    // element under the cursor. Ignore our own chrome.
    const el = e.target;
    if (!el || !(el instanceof Element)) return;
    if (el === overlay || el === hud || el.closest('.prb-pick-hud')) return;
    if (el.classList.contains('prb-badge') || el.closest('.prb-badge')) return;
    highlight(el);
  }

  function teardown() {
    if (current) current.classList.remove('prb-pick-target');
    overlay.remove();
    hud.remove();
    cursorStyle.remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.__prbPickerActive = false;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      teardown();
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const el = current;
    if (!el) return;

    const chosen = chooseSelector(el);
    if (!chosen) {
      hud.textContent = 'Could not build a stable selector there. Try the element that holds just the name.';
      hud.classList.add('prb-pick-error');
      return;
    }

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
      const existing = res?.ok ? res.result.customSelectors || [] : [];
      if (existing.includes(chosen.selector)) {
        hud.textContent = 'Already saved that one.';
        setTimeout(teardown, 1200);
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'SET_SETTINGS', patch: { customSelectors: [...existing, chosen.selector] } },
        () => {
          hud.textContent = `Saved. Matches ${chosen.matches} element${
            chosen.matches === 1 ? '' : 's'
          } on this page. Reloading…`;
          setTimeout(() => {
            teardown();
            location.reload();
          }, 1100);
        }
      );
    });
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
})();
