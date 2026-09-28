/* theme.js — A289 · the light / dark theme, on every page.
 *
 * The FIRST child of <body> on every page: the body element exists, nothing has been laid out, and
 * data-theme lands on <html> and <body> before first paint — so there is no flash. It is a
 * <script src>, which keeps the "exactly one inline <script>" contracts intact.
 *
 * The stored value is validated (the test harness's localStorage returns the session JSON for
 * any key). Default is light; the person's own choice wins once made. The storage key is the one
 * the director pages used first (A288), so that choice carries across. Every element with the
 * class .theme-toggle flips the theme — wired by delegation, because the navbar renders its
 * toggle after this script runs. Dispatches dh:theme (director-pulse.js listens) and hx:theme. */
(function () {
  var KEY = 'dh_theme';
  function stored() {
    try { var v = localStorage.getItem(KEY); return (v === 'dark' || v === 'light') ? v : null; } catch (e) { return null; }
  }
  function setAttr(el, t) { if (el && typeof el.setAttribute === 'function') el.setAttribute('data-theme', t); }
  function apply(t, persist) {
    setAttr(document.documentElement, t);
    setAttr(document.body, t);
    if (persist) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    if (typeof CustomEvent === 'function' && document && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent('dh:theme', { detail: { theme: t } }));
      document.dispatchEvent(new CustomEvent('hx:theme', { detail: { theme: t } }));
    }
  }
  function current() {
    var h = document.documentElement;
    return (h && typeof h.getAttribute === 'function' && h.getAttribute('data-theme')) || 'light';
  }
  apply(stored() || 'light', false);
  window.hxTheme = {
    get: current,
    set: function (t) { apply(t === 'dark' ? 'dark' : 'light', true); },
    toggle: function () { this.set(current() === 'dark' ? 'light' : 'dark'); }
  };
  window.dhTheme = window.hxTheme;

  var reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  function crossfade() {
    if (reduced) return;
    var h = document.documentElement, b = document.body;
    if (h && h.classList) { h.classList.add('hx-theming'); setTimeout(function () { h.classList.remove('hx-theming'); }, 320); }
    if (b && b.classList) { b.classList.add('dh-theming'); setTimeout(function () { b.classList.remove('dh-theming'); }, 320); }
  }
  function toggles() {
    var list = [];
    if (typeof document.querySelectorAll === 'function') list = Array.prototype.slice.call(document.querySelectorAll('.theme-toggle'));
    var byId = document.getElementById('themeToggle');
    if (byId && list.indexOf(byId) === -1) list.push(byId);
    return list;
  }
  function reflect() {
    var t = current();
    toggles().forEach(function (btn) {
      if (typeof btn.setAttribute === 'function') { btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false'); btn.setAttribute('aria-label', t === 'dark' ? 'Light theme' : 'Dark theme'); }
      var label = typeof btn.querySelector === 'function' ? btn.querySelector('span') : null;
      if (label) label.textContent = t === 'dark' ? 'Light' : 'Dark';
    });
  }
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var t = e && e.target, btn = null;
      if (t && typeof t.closest === 'function') btn = t.closest('.theme-toggle');
      if (!btn) return;
      crossfade();
      window.hxTheme.toggle();
    });
    document.addEventListener('dh:theme', reflect);
    document.addEventListener('DOMContentLoaded', function () { reflect(); setTimeout(reflect, 400); });
  }
})();
