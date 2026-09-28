/* director-theme.js — A288 · the director's light / dark theme.
 *
 * The FIRST child of <body> on every director page: the body element exists, nothing has been laid
 * out, and data-theme lands before first paint — so there is no flash. It is a <script src>, which
 * keeps the home page's "exactly one inline <script>" contract intact.
 *
 * The stored value is validated: the test harness's localStorage returns the session JSON for any
 * key, and a real browser could hold anything. Default is light (the rest of the app is light-only);
 * the director's own choice wins once made. Exposes window.dhTheme and dispatches dh:theme. */
(function () {
  var KEY = 'dh_theme';
  function stored() {
    try { var v = localStorage.getItem(KEY); return (v === 'dark' || v === 'light') ? v : null; } catch (e) { return null; }
  }
  function apply(t, persist) {
    var b = document.body;
    if (b && typeof b.setAttribute === 'function') b.setAttribute('data-theme', t);
    if (persist) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    if (typeof CustomEvent === 'function' && document && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent('dh:theme', { detail: { theme: t } }));
    }
  }
  apply(stored() || 'light', false);
  window.dhTheme = {
    get: function () { var b = document.body; return (b && typeof b.getAttribute === 'function' && b.getAttribute('data-theme')) || 'light'; },
    set: function (t) { apply(t === 'dark' ? 'dark' : 'light', true); },
    toggle: function () { this.set(this.get() === 'dark' ? 'light' : 'dark'); }
  };

  /* The toggle button (#themeToggle) on whichever page carries one: a click crossfades the theme
     (body.dh-theming lets director.css transition colours for 320ms, never at load), and the
     button's label and aria state follow the theme. Wired here, once, so no page script has to. */
  function wire() {
    var btn = document.getElementById('themeToggle'); if (!btn) return;
    var label = typeof btn.querySelector === 'function' ? btn.querySelector('span') : null;
    var reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    function reflect() {
      var t = window.dhTheme.get();
      if (typeof btn.setAttribute === 'function') { btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false'); btn.setAttribute('aria-label', t === 'dark' ? 'Light theme' : 'Dark theme'); }
      if (label) label.textContent = t === 'dark' ? 'Light' : 'Dark';
    }
    if (typeof btn.addEventListener === 'function') btn.addEventListener('click', function () {
      var b = document.body;
      if (!reduced && b && b.classList) { b.classList.add('dh-theming'); setTimeout(function () { b.classList.remove('dh-theming'); }, 320); }
      window.dhTheme.toggle();
    });
    if (typeof document.addEventListener === 'function') document.addEventListener('dh:theme', reflect);
    reflect();
  }
  if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', wire);
})();
