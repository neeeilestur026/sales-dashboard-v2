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
  var reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  /* A336 — the new look, for every office role (never the warehouse phones), on a page that links
     css/ledger.css. It is ON by default (Neil, 2026-10-16). The director's FlowSettings can change that:
     portalSkin 'off' turns it off for everyone, 'optin' offers it only to those who choose it, and 'on'
     or no row at all gives it to everyone who has not chosen classic; portalSkinRoles, when set, limits
     it to those roles.
     Both are cached (hx_lg_mode, hx_lg_roles; the key was hx_lg_sw until the default became on, so an
     'off' cached under the old default is ignored) and refreshed at most every 10 minutes.
     A345 — the new look IS the Apple look (Neil, 2026-10-21: always the Apple design; the Ledger look is
     retired). Whenever the skin is on, html[data-look="apple"] is set: css/apple.css styles the page over
     ledger.css, auth.js draws the Apple sidebar, js/ledger.js and js/apple.js load. No FlowSettings row needed.
     The personal choices moved to fresh keys, so a "classic" or ?skin=off picked in the Ledger period does
     not stick: hx_look ('classic', or 'apple' = opted in under 'optin'; ?look=classic|new|apple) and
     hx_skin_pv (?skin=on previews on localhost, ?skin=off|reset anywhere). ?motion=on|off as before.
     Off = nothing set at all, the classic pages. The login page, which links css/apple-login.css and has
     nobody signed in yet, gets data-look="apple" too unless the director has turned the skin off. */
  var LG_ROLES = ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'];
  function get(k, ok) { try { var v = localStorage.getItem(k); return ok.indexOf(v) >= 0 ? v : null; } catch (e) { return null; } }
  function put(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  function sw() { return get('hx_lg_mode', ['off', 'optin', 'on']) || 'on'; }   // no row (or nothing cached yet) = on
  function roleList() {
    try { var v = localStorage.getItem('hx_lg_roles'); return typeof v === 'string' && /^[a-z,]{1,120}$/.test(v) ? v.split(',') : null; } catch (e) { return null; }
  }
  function role() {
    try { var s = JSON.parse(localStorage.getItem('session')); return s && LG_ROLES.indexOf(s.role) >= 0 ? s.role : null; } catch (e) { return null; }
  }
  function linked() { try { return !!document.querySelector('link[href="css/ledger.css"]'); } catch (e) { return false; } }
  function loginPage() { try { return !!document.querySelector('link[href="css/apple-login.css"]'); } catch (e) { return false; } }
  function ok() { return !!role() && linked(); }
  function allowed() { var l = roleList(); return !l || l.indexOf(role()) >= 0; }
  var local = false, skin = false, still = false;
  try {
    local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    var q = new URLSearchParams(location.search), look = q.get('look'), sk = q.get('skin'), mo = q.get('motion');
    if (look === 'classic') put('hx_look', 'classic'); else if (look === 'new' || look === 'apple') put('hx_look', 'apple');
    if (mo === 'on' || mo === 'off') put('hx_lg_motion', mo);
    var ph = q.get('phone'); if (ph === 'off') put('hx_phone', 'off'); else if (ph === 'on') put('hx_phone', null);   // A378 — the phone layout, off for one person
    if (sk === 'off') put('hx_skin_pv', 'off'); else if ((sk === 'on' || sk === 'ledger') && local) put('hx_skin_pv', 'on'); else if (sk === 'reset') put('hx_skin_pv', null);
    put('hx_lg_me', null); put('hx_lg_pv', null); put('hx_lg_look', null);   // A345 — the Ledger-period keys, forgotten
  } catch (e) {}
  if (ok()) {
    var pv = get('hx_skin_pv', ['on', 'off']), me = get('hx_look', ['classic', 'apple']);
    skin = pv === 'off' ? false : (pv === 'on' && local) || (allowed() && (sw() === 'on' ? me !== 'classic' : sw() === 'optin' && me === 'apple'));
  }
  if (skin || (loginPage() && sw() !== 'off')) still = reduced || get('hx_lg_motion', ['off']) === 'off';
  if (skin) {
    window.hxSkinOn = true;
    try {
      var h = document.documentElement, hd = document.head;
      h.setAttribute('data-skin', 'ledger');
      h.setAttribute('data-look', 'apple');
      h.setAttribute('data-page', (location.pathname.split('/').pop() || 'index').replace(/\.html$/, ''));
      if (still) h.setAttribute('data-motion', 'off');
      else { var vt = document.createElement('style'); vt.textContent = '@view-transition{navigation:auto}'; hd.appendChild(vt); }
      var js = document.createElement('script'); js.src = 'js/ledger.js'; hd.appendChild(js);
      var aj = document.createElement('script'); aj.src = 'js/apple.js'; hd.appendChild(aj);
      /* A378 — the phone app (a tab bar, sheets, the + button, short homes) and the empty states: css/apple-phone.css,
         js/apple-phone.js. The stylesheet holds the first paint, so a phone never shows the desktop order first. */
      if (get('hx_phone', ['off']) !== 'off') h.setAttribute('data-phone', 'on');
      var pc = document.createElement('link'); pc.rel = 'stylesheet'; pc.href = 'css/apple-phone.css'; pc.setAttribute('blocking', 'render'); hd.appendChild(pc);
      var pj = document.createElement('script'); pj.src = 'js/apple-phone.js'; hd.appendChild(pj);
    } catch (e) {}
  } else if (loginPage() && sw() !== 'off') {
    try { document.documentElement.setAttribute('data-look', 'apple'); if (still) document.documentElement.setAttribute('data-motion', 'off'); } catch (e) {}
  }
  /* the way in from the classic navbar (only while the director offers it), and the way back out */
  window.hxSkinNavItem = function () {
    if (!ok() || skin || !allowed() || ['optin', 'on'].indexOf(sw()) < 0) return '';
    return '<a class="lg-try" href="?look=new">Try the new look</a>';
  };
  window.hxSkinLookItems = function () {
    if (!skin) return '';
    return '<a href="?look=classic">Classic look</a>' + (get('hx_lg_motion', ['off']) === 'off' ? '<a href="?motion=on">Motion on</a>' : '<a href="?motion=off">Motion off</a>');
  };
  /* refresh the cached switch at most every 10 minutes; it applies on the next page load */
  if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', function () {
    try {
      if (!ok() || typeof fetchFlow !== 'function' || Date.now() - (parseInt(localStorage.getItem('hx_lg_mode_at'), 10) || 0) < 600000) return;
      fetchFlow('getFlowSettings', {}, { fresh: true }).then(function (r) {
        if (!r || !r.success || !r.data) return;
        var v = String(r.data.portalSkin || '').toLowerCase(), rl = String(r.data.portalSkinRoles || '').toLowerCase().replace(/[^a-z,]/g, '');
        put('hx_lg_mode', v === 'off' || v === 'optin' ? v : 'on');   // only an explicit 'off' turns it off
        put('hx_lg_roles', rl.split(',').filter(function (x) { return LG_ROLES.indexOf(x) >= 0; }).join(',') || null);
        put('hx_lg_mode_at', String(Date.now()));
      }).catch(function () {});
    } catch (e) {}
  });

  apply(stored() || 'light', false);
  window.hxTheme = {
    get: current,
    set: function (t) { apply(t === 'dark' ? 'dark' : 'light', true); },
    toggle: function () { this.set(current() === 'dark' ? 'light' : 'dark'); }
  };
  window.dhTheme = window.hxTheme;

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
  /* A375 — toasts, the snackbar and alert() as a toast, on every page and in both looks (js/hx-feedback.js). */
  try {
    var fh = document.head;
    if (fh && typeof document.createElement === 'function' && !window.hxToast) {
      var fl = document.createElement('link'); fl.rel = 'stylesheet'; fl.href = 'css/hx-feedback.css'; fh.appendChild(fl);
      var fj = document.createElement('script'); fj.src = 'js/hx-feedback.js'; fh.appendChild(fj);
    }
  } catch (e) {}
})();
