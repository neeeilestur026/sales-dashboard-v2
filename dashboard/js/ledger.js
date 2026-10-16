/* ledger.js — A336 · what the "Ledger" look adds beyond CSS.
 * js/theme.js loads this only while the Ledger look is on. Display only: it never changes what a
 * page wrote or what a request carries.
 *   - search: Ctrl/⌘+K, "/" outside a field, or the bar's search button, over every page of the
 *     person's rail and avatar menu (ledger-nav.js fills window.hxSkinPages)
 *   - the loading line: a passthrough around window.fetch that only counts requests in flight
 *   - Chart.js, as it arrives (api.js loadLib): Geist, the theme's ink and grid, and no animation
 *     when motion is off */
(function () {
  var h = document.documentElement;
  if (h.getAttribute('data-skin') !== 'ledger') return;
  var still = h.getAttribute('data-motion') === 'off';
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function tok(name, fb) { try { return getComputedStyle(h).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }

  /* ── the loading line: count fetches in flight; show the line only past 150 ms ── */
  var busy = 0, showT = 0;
  function load(d) {
    busy = Math.max(0, busy + d);
    if (busy && !showT) showT = setTimeout(function () { h.classList.add('l-busy'); }, 150);
    if (!busy) { clearTimeout(showT); showT = 0; h.classList.remove('l-busy'); }
  }
  if (typeof window.fetch === 'function' && typeof Promise === 'function') {
    var realFetch = window.fetch;
    window.fetch = function () {
      load(1);
      var p;
      try { p = realFetch.apply(window, arguments); } catch (e) { load(-1); throw e; }
      return Promise.resolve(p).then(function (r) { load(-1); return r; }, function (e) { load(-1); throw e; });
    };
  }

  /* ── Chart.js: the Ledger type and colours, set as it lands ── */
  function tune(C) {
    try {
      if (!C || !C.defaults) return;
      C.defaults.font = Object.assign({}, C.defaults.font, { family: tok('--l-sans', 'Geist, system-ui, sans-serif') });
      C.defaults.color = tok('--l-ink-2', C.defaults.color);
      C.defaults.borderColor = tok('--l-p-grid', C.defaults.borderColor);
      C.defaults.animation = still ? false : Object.assign({}, C.defaults.animation, { duration: 600, easing: 'easeOutQuart' });
    } catch (e) {}
  }
  if (window.Chart) tune(window.Chart);
  else {
    try {
      var chartLib;
      Object.defineProperty(window, 'Chart', { configurable: true, enumerable: true, get: function () { return chartLib; }, set: function (v) { chartLib = v; tune(v); } });
    } catch (e) {}
  }

  /* ── search: every page of the rail and the avatar menu, by name or section ── */
  var box = null, input = null, list = null, items = [], sel = 0, back = null;
  function pages() { return (window.hxSkinPages || []).slice(); }
  function esc(s) { return typeof hxEsc === 'function' ? hxEsc(s) : String(s); }
  function filter(q) {
    q = q.trim().toLowerCase();
    var all = pages();
    if (!q) return all;
    var scored = [];
    all.forEach(function (p, i) {
      var l = p.label.toLowerCase(), g = p.group.toLowerCase(), s = l.indexOf(q) === 0 ? 0 : l.indexOf(' ' + q) >= 0 ? 1 : l.indexOf(q) >= 0 ? 2 : g.indexOf(q) >= 0 ? 3 : -1;
      if (s >= 0) scored.push([s, i, p]);
    });
    return scored.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; });
  }
  function draw() {
    items = filter(input.value);
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    if (!items.length) {
      var groups = [];
      pages().forEach(function (p) { if (groups.indexOf(p.group) < 0) groups.push(p.group); });
      list.innerHTML = '<li class="l-cmdk-empty" role="presentation">No page is called “' + esc(input.value.trim()) + '”. Try a section: ' + esc(groups.join(', ')) + '.</li>';
      input.removeAttribute('aria-activedescendant');
      return;
    }
    list.innerHTML = items.map(function (p, i) {
      return '<li id="l-opt-' + i + '" role="option" aria-selected="' + (i === sel) + '" data-i="' + i + '">' + esc(p.label) + '<small>' + esc(p.group) + '</small></li>';
    }).join('');
    input.setAttribute('aria-activedescendant', 'l-opt-' + sel);
    var on = list.children[sel];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function go(i) { var p = items[i]; if (p) { close(); location.href = p.href; } }
  function build() {
    box = document.createElement('div');
    box.className = 'l-cmdk';
    box.hidden = true;
    box.innerHTML = '<div class="l-cmdk-panel" role="dialog" aria-modal="true" aria-label="Go to a page">'
      + '<div class="l-cmdk-input"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      + '<input type="text" role="combobox" aria-expanded="true" aria-controls="l-cmdk-list" aria-autocomplete="list" placeholder="Go to a page" autocomplete="off" spellcheck="false"></div>'
      + '<ul class="l-cmdk-list" id="l-cmdk-list" role="listbox" aria-label="Pages"></ul>'
      + '<div class="l-cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
    document.body.appendChild(box);
    input = box.querySelector('input');
    list = box.querySelector('ul');
    input.addEventListener('input', function () { sel = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); } }
      else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') e.preventDefault();   // focus stays in the search while it is open
    });
    list.addEventListener('mousemove', function (e) { var li = e.target.closest && e.target.closest('li[data-i]'); if (li && +li.getAttribute('data-i') !== sel) { sel = +li.getAttribute('data-i'); draw(); } });
    list.addEventListener('click', function (e) { var li = e.target.closest && e.target.closest('li[data-i]'); if (li) go(+li.getAttribute('data-i')); });
    box.addEventListener('mousedown', function (e) { if (e.target === box) close(); });
  }
  function open() {
    if (!document.body) return;
    if (!box) build();
    if (!box.hidden) return;
    back = document.activeElement; sel = 0; input.value = ''; box.hidden = false; draw(); input.focus();
  }
  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    if (back && typeof back.focus === 'function') { try { back.focus(); } catch (e) {} }
    back = null;
  }
  function typing(t) { return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (box && !box.hidden) close(); else open(); return; }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && (!box || box.hidden)) { e.preventDefault(); open(); }
  });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-l-search]'); if (b) open(); });
  var mac = /Mac|iPhone|iPad/.test((navigator && (navigator.platform || navigator.userAgent)) || '');
  ready(function () {
    if (mac) { var k = document.querySelector('.l-search kbd'); if (k) k.textContent = '⌘K'; }
  });
  window.hxSkinSearch = { open: open, close: close };
})();
