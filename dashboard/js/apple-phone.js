/* apple-phone.js — A378 · the phone app for the Apple look (css/apple-phone.css), every office role.
 *
 * Loaded by js/theme.js beside js/apple.js whenever the look is on. Two jobs:
 *
 * 1 · Empty states, at every width: an empty list and a list still loading read differently. The common empty
 *     boxes (and a table whose only row is one wide cell) are marked ap-none / ap-wait / ap-fail from their words,
 *     once per frame, so css/apple-phone.css can draw each.
 * 2 · The phone shell, only at 640 px or less and only while html[data-phone="on"] (theme.js; ?phone=off is the
 *     way out for one person): an iOS tab bar (four sections and More, from LEDGER_NAV), section sheets, a More
 *     sheet with a search over every page, a + button for the role's create actions, a back chevron and a title
 *     that takes over from the page's large title, and short home screens whose long sections open as screens of
 *     their own. The sidebar, every page and every control stay as they are: the shell adds elements, and moves a
 *     home's long section into its screen while it is open, so each page's own scripts keep working on the same
 *     nodes and ids.
 *
 * Motion follows the apple-design skill: sheets and screens follow the finger 1:1, rubber-band past rest (0.55),
 * project the release (d = 0.998) to pick where they land, and settle on hxApple's spring (damping 1.0 / response
 * 0.4, or 0.8 / 0.3 after a flick), grabbed mid-flight from their live position. Android's back button closes the
 * top layer first (history.pushState / popstate). "Motion off" or reduced motion: everything lands without moving.
 */
(function () {
  var h = document.documentElement;
  if (!h || h.getAttribute('data-look') !== 'apple') return;
  var still = function () { return h.getAttribute('data-motion') === 'off'; };
  var raf = window.requestAnimationFrame ? function (f) { return requestAnimationFrame(f); } : function (f) { return setTimeout(f, 16); };
  var esc = function (s) { return hxEsc(s); };   // api.js, on every page the shell draws on (ledger-nav.js uses it too)
  var ready = function (f) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); };

  /* ── 1 · empty states ────────────────────────────────────────────────────────────────────── */
  /* every page's own empty box (about forty *-empty names, .empty-state from showEmpty, .flow-empty from flowEmpty) */
  var EMPTY = '.empty-state, .flow-empty, .is-empty, [class*="-empty"]', NOT = /(^|\s)(notif-empty|l-cmdk-empty|cmdk-empty)(\s|$)/;
  var OUTSIDE = '.hx-slab, .dh-slab, .notif-dropdown, .l-menu, .l-cmdk, .cmdk, .ap-sheet';
  var WAIT = /^(loading|reading|fetching|checking|counting|working|searching|opening|getting|preparing|please wait)\b|(…|\.\.\.)\s*$/i;
  var FAIL = /^(could not|couldn't|can't|cannot|error|failed|unable|not configured)\b|\b(failed|error)\b/i;
  function kindOf(text, failed) {   // an empty box's words → how it is drawn ('' = leave it alone)
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return !t || t.length > 220 ? '' : (failed || FAIL.test(t)) ? 'ap-fail' : WAIT.test(t) ? 'ap-wait' : 'ap-none';
  }
  function sort(el) {
    var kind = kindOf(el.textContent, el.classList.contains('dh-error'));
    ['ap-none', 'ap-wait', 'ap-fail'].forEach(function (k) { if (k !== kind && el.classList.contains(k)) el.classList.remove(k); });
    if (kind && !el.classList.contains(kind)) el.classList.add(kind);
    var w = kind ? el.offsetWidth : 0;   // a small card's box: the words without the tile (0 = not on screen yet, decide later)
    if (w) el.classList.toggle('ap-small', w < 240);
  }
  function sortAll() {
    var list = document.querySelectorAll(EMPTY);
    for (var i = 0; i < list.length; i++) if (!NOT.test(String(list[i].className)) && !list[i].closest(OUTSIDE)) sort(list[i]);
    var cells = document.querySelectorAll('tbody > tr:only-child > td[colspan]:only-child');
    for (var j = 0; j < cells.length; j++) { if (!cells[j].querySelector('table, form, input, select')) sort(cells[j]); }
  }
  var sortQueued = false;
  function sortSoon() { if (sortQueued) return; sortQueued = true; raf(function () { sortQueued = false; sortAll(); }); }
  ready(function () {
    sortAll();
    if (typeof MutationObserver === 'function') new MutationObserver(sortSoon).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  window.hxPhone = { kindOf: kindOf };

  /* ── 2 · the phone shell ─────────────────────────────────────────────────────────────────── */
  if (h.getAttribute('data-phone') !== 'on') return;
  var mq = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
  var phone = function () { return !!(mq && mq.matches); };
  var here = (location.pathname.split('/').pop() || '').toLowerCase();
  var pageKey = h.getAttribute('data-page') || here.replace(/\.html$/, '');

  /* the four sections on the bar, per role: [the LEDGER_NAV section, the tab's own label] (Neil, 27 Oct 2026) */
  var TABS = {
    sales: [['Quote', 'Quotes'], ['Clients'], ['Reports', 'Report']],
    admin: [['Sell'], ['Buy & pay'], ['Stock']],
    accounting: [['Collect'], ['Pay'], ['Books']],
    management: [['Approvals'], ['Sell'], ['Money']],
    director: [['Quotes'], ['Payables'], ['Team']],
    leadgen: [['Report'], ['Quotes']],
    hr: [['People'], ['Work']],
    marketing: [['Report']]
  };
  /* the + button: [the page and its ?new= form, the label, the icon]; an action shows only where the role has that page */
  var CREATE = {
    sales: [['flow-pricing-request.html?new=1', 'New purchase request', 'file'], ['my-daily-report.html?new=call', 'Log a call', 'clip'], ['client-visits.html?new=1', 'Plan a visit', 'pin'], ['director-client-book.html?new=1', 'Add a client', 'users']],
    admin: [['flow-purchase-orders.html?new=1', 'New purchase order', 'cart'], ['flow-payment-requests.html?new=1', 'Payment request', 'card'], ['flow-receiving.html?new=1', 'Receive goods', 'box'], ['website-requests.html', 'Website requests', 'inbox']],
    accounting: [['flow-invoices.html?new=1', 'New invoice', 'file'], ['flow-ar-aging.html', 'Record a collection', 'inbox'], ['flow-expenses.html?new=1', 'New expense', 'book'], ['flow-payment-requests.html?new=1', 'Payment request', 'card']],
    director: [['director-pricing-engine.html', 'Price a quotation', 'tag'], ['collect.html', 'Collect a payment', 'inbox'], ['director-home.html#inbox', 'Approvals', 'check']],
    management: [['management-home.html#inbox', 'Approvals', 'check'], ['leave-request.html', 'Request leave', 'cal']],
    leadgen: [['leadgen-home.html?new=log', 'Log activity', 'clip']],
    hr: [['hr-employees.html?new=1', 'Add an employee', 'users'], ['hr-memos.html?new=1', 'New memo', 'pen']],
    marketing: [['marketing-home.html?new=leads', 'New lead', 'users']]
  };
  /* a home's long sections, each a row that opens its own screen: [selector, title, icon] */
  var FOLD = {
    admin: [['#queues', 'Queues', 'inbox'], ['#activity', 'Recent activity', 'trend'], ['#inventory', 'Inventory', 'box'], ['#profit', 'Revenue and net profit', 'chart']],
    'accounting-home': [['#modules', 'Process flow modules', 'sliders'], ['#revenue', 'Revenue this year', 'trend'], ['#recent', 'Recent shipments', 'box'], ['#profit', 'Revenue and net profit', 'chart'], ['#shipments', 'Shipment monitoring', 'box']],
    'management-home': [['#pulse', 'Income statement', 'chart'], ['#teamDailyReports', 'New daily reports', 'clip'], ['#team', 'Daily reports', 'users'], ['#operations', 'Operations', 'box'], ['#hr', 'HR', 'users']],
    'director-home': [['#acctReport', 'Accounting report', 'clip'], ['#lgReport', 'Lead generation report', 'clip'], ['#adminReport', 'Admin report', 'clip'], ['#clientBook', 'Client Book', 'book'], ['#proof', 'Sales daily report', 'file'], ['#pulse', 'Pulse', 'trend'], ['#team', 'Team', 'users'], ['#payroll', 'Payroll workspace', 'card']],
    'hr-home': [['#hrmods', 'HR modules', 'users'], ['#mkmods', 'Marketing modules', 'pen'], ['#newsec-daily-reports', 'Daily reports', 'clip']],
    'marketing-home': [['#trackers', 'Trackers', 'clip'], ['#newsec-daily-reports', 'Daily reports', 'users']],
    'leadgen-home': [['#trackers', 'Trackers', 'clip'], ['#newsec-daily-reports', 'Daily reports', 'users']],
    dashboard: [['#today', 'Your tools', 'tool'], ['.sl-pair', 'Target and overdue follow-ups', 'trend']]
  };
  var CHEV = '<svg class="ap-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var TICK = '<svg class="ap-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function session() { try { var s = JSON.parse(localStorage.getItem('session')); return s && s.role ? s : null; } catch (e) { return null; } }
  function icon(name) { return typeof _lgIcon === 'function' ? _lgIcon(name).replace('<svg ', '<svg class="ap-i" ') : ''; }
  function Spring(fn) {
    if (window.hxApple && window.hxApple.Spring) return new window.hxApple.Spring(fn);
    return { x: 0, v: 0, raf: 0, onUpdate: fn, stop: function () {}, set: function (x) { this.x = x; fn(x); }, to: function (x, o) { this.x = x; fn(x); if (o && o.done) o.done(); } };   // apple.js not there: land
  }
  var rubber = function (over, dim) { return window.hxApple ? window.hxApple.rubber(over, dim) : over * 0.3; };
  var project = function (x, v) { return window.hxApple ? window.hxApple.project(x, v) : x; };
  function tracker() {
    var hist = [];
    return {
      push: function (x) { hist.push([Date.now(), x]); if (hist.length > 6) hist.shift(); },
      velocity: function () { if (hist.length < 2) return 0; var a = hist[0], b = hist[hist.length - 1]; return (b[1] - a[1]) / Math.max(1, b[0] - a[0]) * 1000; }
    };
  }
  function pressable(root) {   // press feedback the moment a finger lands (.97 over 100 ms, css), not on release
    root.addEventListener('pointerdown', function (e) { var t = e.target.closest && e.target.closest('.ap-press'); if (t) t.classList.add('ap-down'); });
    var up = function () { var list = root.querySelectorAll('.ap-down'); for (var i = 0; i < list.length; i++) list[i].classList.remove('ap-down'); };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { root.addEventListener(ev, up); });
  }

  var S = null, role = '', pages = [], homeHref = 'index.html', built = false;
  window.hxPhone = { kindOf: kindOf, TABS: TABS, CREATE: CREATE, FOLD: FOLD, tabsFor: tabsFor, restFor: restFor, actionsFor: actionsFor };

  /* ── layers: sheets and pushed screens; Android's back button closes the top one ──────────── */
  var stack = [], leaving = null, doc = String(Date.now()) + Math.random().toString(36).slice(2, 6);   // entries from an earlier load of this page count as none
  var depthOf = function (st) { return st && st.apDoc === doc ? st.apLayer || 0 : 0; };
  function pushLayer(layer, reuse) {   // reuse: a sheet taking the place of another keeps its history entry
    stack.push(layer);
    h.classList.add('ap-locked');
    try {
      if (!(reuse && depthOf(history.state) === stack.length)) history.pushState({ apLayer: stack.length, apDoc: doc }, '');
      layer.pushed = true;
    } catch (e) { layer.pushed = false; }
  }
  function closeTop(instant) {
    var l = stack.pop();
    if (!stack.length) h.classList.remove('ap-locked');
    if (l) l.close(!!instant);
  }
  function popLayer() {   // a close from the screen: let history do it, so the back button and this stay in step
    var top = stack[stack.length - 1];
    if (top && top.pushed && depthOf(history.state) === stack.length) history.back();
    else closeTop(false);
  }
  window.addEventListener('popstate', function (e) {
    var depth = depthOf(e.state);
    while (stack.length > depth) closeTop(!!leaving);
    if (leaving && !stack.length) { var to = leaving; leaving = null; location.href = to; }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) while (stack.length) closeTop(true); });
  function leaveTo(href) {   // a link inside a sheet: close the sheets in history first, so Back from the next page lands here
    var n = stack.filter(function (l) { return l.pushed; }).length;
    if (!n || !depthOf(history.state)) { location.href = href; return; }
    leaving = href;
    history.go(-n);
    setTimeout(function () { if (leaving) { var to = leaving; leaving = null; location.href = to; } }, 400);
  }
  document.addEventListener('keydown', function (e) {
    if (!stack.length) return;
    if (e.key === 'Escape') { e.preventDefault(); popLayer(); return; }
    if (e.key !== 'Tab') return;
    var top = stack[stack.length - 1].el, items = Array.prototype.filter.call(top.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ── a sheet: rises from the bottom, dragged down to dismiss ──────────────────────────────── */
  function openSheet(title, html, opener, wire, tall) {
    var reuse = false;
    while (stack.length && stack[stack.length - 1].kind === 'sheet') { reuse = reuse || stack[stack.length - 1].pushed; closeTop(true); }
    var scrim = document.createElement('div');
    scrim.className = 'ap-scrim';
    var sh = document.createElement('div');
    sh.className = 'ap-sheet' + (tall ? ' ap-tall' : '');   // tall: one height while its list changes (More's search)
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'apSheetT');
    sh.innerHTML = '<div class="ap-grab" aria-hidden="true"></div><div class="ap-sheet-h"><h2 id="apSheetT">' + esc(title) + '</h2>' +
      '<button type="button" class="ap-x ap-press" aria-label="Close">' + X + '</button></div><div class="ap-sheet-b">' + html + '</div>';
    document.body.appendChild(scrim);
    document.body.appendChild(sh);
    if (opener) opener.setAttribute('aria-expanded', 'true');
    var body = sh.querySelector('.ap-sheet-b'), H = function () { return sh.offsetHeight || 400; };
    var spring = Spring(function (y) { sh.style.transform = 'translate3d(0,' + y + 'px,0)'; scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - y / H()))); });
    spring.set(H()); spring.to(0, { damping: 1, response: 0.4 });
    var layer = { kind: 'sheet', el: sh, close: function (instant) {
      if (opener) { opener.setAttribute('aria-expanded', 'false'); try { opener.focus({ preventScroll: true }); } catch (e) {} }
      var gone = function () { if (sh.parentNode) sh.parentNode.removeChild(sh); if (scrim.parentNode) scrim.parentNode.removeChild(scrim); };
      if (instant) { spring.stop(); gone(); return; }
      if (still()) { sh.classList.add('ap-fading'); scrim.classList.add('ap-fading'); setTimeout(gone, 200); return; }   // reduced motion: a cross-fade
      spring.to(H() + 24, { damping: 1, response: 0.3, done: gone });
    } };
    pushLayer(layer, reuse);
    pressable(sh);
    scrim.addEventListener('click', popLayer);
    sh.querySelector('.ap-x').addEventListener('click', popLayer);
    sh.addEventListener('click', function (e) {   // a page link in a sheet: close it in history, then go
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || a.target === '_blank') return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '?') return;   // the look switch reloads this page itself
      e.preventDefault();
      if (!fabSamePage(href)) leaveTo(href);
    });
    var drag = null;
    sh.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || (e.target.closest && e.target.closest('input, select, textarea'))) return;
      var inBody = body.contains(e.target);
      if (inBody && body.scrollTop > 0) return;   // inside scrolled content: a scroll, not a drag
      drag = { id: e.pointerId, y0: e.clientY, from: spring.raf ? spring.x : 0, moved: false, t: tracker() };
    });
    sh.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dy) < 10) return;
        if (dy < 0 && drag.from === 0) { drag = null; return; }   // upward from rest: the list scrolls
        drag.moved = true; spring.stop();
        try { sh.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var y = drag.from + dy;
      if (y < 0) y = rubber(y, H());
      spring.x = y; spring.v = 0; spring.onUpdate(y); drag.t.push(y);
      e.preventDefault();
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag; drag = null;
      if (!was.moved) return;
      var v = was.t.velocity();
      if (project(spring.x, v) > H() * 0.4) { spring.v = v; popLayer(); }
      else spring.to(0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v });
    };
    sh.addEventListener('pointerup', end);
    sh.addEventListener('pointercancel', end);
    if (wire) wire(sh);
    var first = sh.querySelector('input[type="search"]') || sh.querySelector('[aria-current], .ap-sheet-b a, .ap-sheet-b button') || sh.querySelector('.ap-x');
    setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) {} }, 30);
    return sh;
  }

  function row(href, label, o) {
    o = o || {};
    var cur = href === here, ic = o.icon ? '<span class="ap-ri">' + icon(o.icon) + '</span>' : '';
    var sub = o.sub ? '<small>' + esc(o.sub) + '</small>' : '';
    var tail = cur ? TICK : CHEV;
    var lab = typeof _lgLabel === 'function' && !o.raw ? _lgLabel(href, label, role) : esc(label);
    return '<a class="ap-row ap-press" href="' + esc(href) + '"' + (cur ? ' aria-current="page"' : '') + '>' + ic + '<span class="ap-rt">' + lab + sub + '</span>' + tail + '</a>';
  }
  function group(title, rows) { return (title ? '<h3 class="ap-gh">' + esc(title) + '</h3>' : '') + '<div class="ap-group">' + rows + '</div>'; }
  function secRows(t) { return typeof t === 'string' ? row(t, '') : t.map(function (p) { return row(p[0], p[1]); }).join(''); }

  /* ── the tab bar ──────────────────────────────────────────────────────────────────────────── */
  function tabsFor(r) {   // Home, then the role's four sections: {label, icon, t (a page or a section's list), sec}
    var secs = LEDGER_NAV[r] || [], out = [{ label: secs[0][0], icon: secs[0][1], t: secs[0][2], home: true }];
    (TABS[r] || []).forEach(function (p) {
      var s = secs.filter(function (x) { return x[0] === p[0]; })[0];
      if (s) out.push({ label: p[1] || s[0], icon: s[1], t: s[2], sec: s[0] });
    });
    return out;
  }
  function restFor(r) {   // the sections More lists: every one not on the bar
    var onBar = tabsFor(r).map(function (t) { return t.sec || ''; });
    return (LEDGER_NAV[r] || []).slice(1).filter(function (s) { return onBar.indexOf(s[0]) < 0; });
  }
  function actionsFor(r, list) {   // the + button's actions the role has the pages for
    var mine = (list || []).map(function (p) { return p.href; });
    return (CREATE[r] || []).filter(function (a) { return mine.indexOf(a[0].split(/[?#]/)[0]) >= 0; });
  }
  var tabs = function () { return tabsFor(role); };
  function holds(t) { return typeof t === 'string' ? t === here : t.some(function (p) { return p[0] === here; }); }
  function buildTabbar() {
    var list = tabs(), on = -1;
    list.forEach(function (t, i) { if (on < 0 && holds(t.t)) on = i; });
    var bar = document.createElement('nav');
    bar.className = 'a-tabbar';
    bar.setAttribute('aria-label', 'Sections');
    bar.innerHTML = list.map(function (t, i) {
      var cur = i === on, badge = t.home ? '<i class="ap-badge" hidden></i>' : '';
      var inner = '<span class="ap-ti">' + icon(t.icon) + badge + '</span><span class="ap-tl">' + esc(t.label) + '</span>';
      return typeof t.t === 'string'
        ? '<a class="ap-tab ap-press" href="' + esc(t.t) + '"' + (cur ? ' aria-current="page"' : '') + (t.home ? ' data-ap-home' : '') + '>' + inner + '</a>'
        : '<button type="button" class="ap-tab ap-press" data-ap-tab="' + i + '" aria-haspopup="dialog" aria-expanded="false"' + (cur ? ' aria-current="true"' : '') + '>' + inner + '</button>';
    }).join('') + '<button type="button" class="ap-tab ap-press" data-ap-more aria-haspopup="dialog" aria-expanded="false"' + (on < 0 ? ' aria-current="true"' : '') + '><span class="ap-ti">' + icon('more') + '</span><span class="ap-tl">More</span></button>';
    document.body.appendChild(bar);
    pressable(bar);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.ap-tab');
      if (!b) return;
      if (b.hasAttribute('data-ap-home') && b.getAttribute('href') === here) {   // the home tab on home: back to the top, any screen closed
        e.preventDefault();
        if (stack.length) { while (stack.length > 1) closeTop(true); popLayer(); } else window.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' });
        return;
      }
      if (b.tagName === 'A') { if (stack.length) { e.preventDefault(); leaveTo(b.getAttribute('href')); } return; }
      if (b.getAttribute('aria-expanded') === 'true') { popLayer(); return; }
      if (b.hasAttribute('data-ap-more')) return openMore(b);
      var t = list[+b.getAttribute('data-ap-tab')];
      openSheet(t.sec, group('', secRows(t.t)), b);
    });
    var bell = function () {   // the home tab carries the bell's count
      var src = document.getElementById('notifBadge'), dot = bar.querySelector('.ap-badge');
      if (!src || !dot) return;
      var n = (src.textContent || '').trim(), show = src.style.display !== 'none' && !!n && n !== '0';
      dot.hidden = !show; dot.textContent = show ? n : '';
      var home = bar.querySelector('[data-ap-home]');
      if (home) home.setAttribute('aria-label', list[0].label + (show ? ', ' + n + ' new' : ''));
    };
    whenEl('notifBadge', function (src) { bell(); if (typeof MutationObserver === 'function') new MutationObserver(bell).observe(src, { attributes: true, childList: true, characterData: true, subtree: true }); });
  }
  function whenEl(id, fn) {
    var el = document.getElementById(id);
    if (el) return fn(el);
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(function () { var x = document.getElementById(id); if (x) { mo.disconnect(); fn(x); } });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ── More: a search over every page, the sections not on the bar, the account ─────────────── */
  function openMore(btn) {
    var rest = restFor(role);
    var html = '<label class="ap-search"><span class="ap-search-i">' + icon('search') + '</span><input type="search" placeholder="Search pages" aria-label="Search pages" autocomplete="off" enterkeyhint="go"></label>' +
      '<div class="ap-found" hidden></div><div class="ap-all">' +
      rest.map(function (s) { return group(s[0], typeof s[2] === 'string' ? row(s[2], s[0], { icon: s[1] }) : secRows(s[2])); }).join('') +
      group('Account', (LEDGER_ME[role] || []).map(function (p) { return row(p[0], p[1], { raw: true }); }).join('') +
        '<button type="button" class="ap-row ap-press" role="switch" data-ap-dark aria-checked="false"><span class="ap-rt">Dark appearance</span><span class="ap-switch" aria-hidden="true"></span></button>' +
        row('?look=classic', 'Classic look', { raw: true }) +
        '<button type="button" class="ap-row ap-press ap-out" data-ap-out><span class="ap-rt">Log out</span></button>') +
      '</div>';
    openSheet('More', html, btn, function (sh) {
      var input = sh.querySelector('input'), found = sh.querySelector('.ap-found'), all = sh.querySelector('.ap-all'), dark = sh.querySelector('[data-ap-dark]');
      var setDark = function () { var on = window.hxTheme && window.hxTheme.get() === 'dark'; dark.setAttribute('aria-checked', on ? 'true' : 'false'); };
      setDark();
      dark.addEventListener('click', function () { if (window.hxTheme) window.hxTheme.toggle(); setDark(); });
      sh.querySelector('[data-ap-out]').addEventListener('click', function () { if (typeof logout === 'function') logout(); });
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        all.hidden = !!q; found.hidden = !q;
        if (!q) { found.innerHTML = ''; return; }
        var hits = pages.map(function (p) {
          var l = String(p.label).toLowerCase(), g = String(p.group).toLowerCase();
          var score = l.indexOf(q) === 0 ? 0 : (' ' + l).indexOf(' ' + q) >= 0 ? 1 : l.indexOf(q) >= 0 ? 2 : g.indexOf(q) >= 0 ? 3 : -1;
          return { p: p, score: score };
        }).filter(function (x) { return x.score >= 0; }).sort(function (a, b) { return a.score - b.score; }).slice(0, 30);
        found.innerHTML = hits.length ? group('', hits.map(function (x) { return row(x.p.href, x.p.label, { sub: x.p.group === x.p.label ? '' : x.p.group }); }).join(''))
          : '<p class="ap-none-found">No page called “' + esc(input.value.trim()) + '”.</p>';
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var a = found.querySelector('a[href]'); if (a) { e.preventDefault(); leaveTo(a.getAttribute('href')); } } });
    }, true);
  }

  /* ── the + button ─────────────────────────────────────────────────────────────────────────── */
  var fab = null;
  function fabSamePage(href) {   // this page's own form or section: open it here, no reload
    var path = href.split(/[?#]/)[0];
    if (path !== here) return false;
    var hash = href.indexOf('#') >= 0 ? href.slice(href.indexOf('#') + 1) : '', m = href.match(/[?&]new=([a-z0-9-]+)/i);
    var go = function () {
      if (m && window.hxDeepLinkReady) document.dispatchEvent(new CustomEvent('hx:new', { detail: m[1] }));
      else if (m) { location.href = href; return; }
      if (hash) { var t = document.getElementById(hash); if (t) t.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' }); }
    };
    if (stack.length) { while (stack.length > 1) closeTop(true); popLayer(); setTimeout(go, 260); } else go();
    return true;
  }
  function buildFab() {
    var acts = actionsFor(role, pages);
    if (!acts.length) return;
    var one = acts.length === 1 ? acts[0] : null;
    fab = document.createElement(one ? 'a' : 'button');
    fab.className = 'ap-fab ap-press';
    if (one) { fab.href = one[0]; fab.setAttribute('aria-label', one[1]); fab.title = one[1]; }
    else { fab.type = 'button'; fab.setAttribute('aria-label', 'Create'); fab.title = 'Create'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false'); }
    fab.innerHTML = PLUS;
    document.body.appendChild(fab);
    h.classList.add('ap-fab-on');
    pressable(fab);
    fab.addEventListener('click', function (e) {
      if (one) { if (fabSamePage(one[0])) e.preventDefault(); return; }
      if (fab.getAttribute('aria-expanded') === 'true') return popLayer();
      openSheet('Create', group('', acts.map(function (a) { return row(a[0], a[1], { icon: a[2], raw: true }); }).join('')), fab);
    });
    var lastY = window.scrollY || 0, q = false;
    window.addEventListener('scroll', function () {   // out of the way while reading down, back on the way up
      if (q) return; q = true;
      raf(function () {
        q = false;
        var y = window.scrollY || 0;
        if (Math.abs(y - lastY) < 8) return;
        fab.classList.toggle('ap-away', y > lastY && y > 80);
        lastY = y;
      });
    }, { passive: true });
  }
  function watchDock() {   // the toasts and the snackbar sit above the bar; the + button rides above them
    var set = function (dock) {
      var hgt = dock && dock.children.length ? dock.getBoundingClientRect().height : 0;
      h.style.setProperty('--ap-dock', (hgt ? Math.round(hgt) + 10 : 0) + 'px');
    };
    var hook = function (dock) {
      set(dock);
      if (typeof ResizeObserver === 'function') new ResizeObserver(function () { set(dock); }).observe(dock);
      if (typeof MutationObserver === 'function') new MutationObserver(function () { set(dock); }).observe(dock, { childList: true });
    };
    var d = document.querySelector('.hx-toasts');
    if (d) return hook(d);
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(function () { var x = document.querySelector('.hx-toasts'); if (x) { mo.disconnect(); hook(x); } });
    mo.observe(document.body, { childList: true });
  }

  /* ── the navigation bar: a back chevron off the home screen, the title once the large one has gone by ── */
  function goBack() {
    if (stack.length) return popLayer();
    var same = false;
    try { same = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch (e) {}
    if (same) history.back(); else location.href = homeHref;
  }
  function decorateNav(nav) {
    if (here !== homeHref && !nav.querySelector('.ap-back')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ap-back ap-press'; b.setAttribute('aria-label', 'Back');
      b.innerHTML = BACK;
      b.addEventListener('click', goBack);
      nav.insertBefore(b, nav.firstChild);
    }
    var big = document.querySelector('main h1, .main-content h1');
    if (!big || typeof IntersectionObserver !== 'function') return;
    var bar = nav.offsetHeight || 52;
    nav.classList.add('ap-big');
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { nav.classList.toggle('ap-big', e.isIntersecting || e.boundingClientRect.top >= bar); });
    }, { rootMargin: '-' + bar + 'px 0px 0px 0px', threshold: 0 }).observe(big);
  }
  function whenNav(fn) {
    var nav = document.getElementById('navbar');
    if (!nav) return;
    if (nav.querySelector('.l-tools')) return fn(nav);
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(function () { if (nav.querySelector('.l-tools')) { mo.disconnect(); fn(nav); } });
    mo.observe(nav, { childList: true });
  }

  /* the greeting on a home: the time of day and a first name ("Welcome to Hi-Escorp, …" is the computer's) */
  function greet() {
    var g = document.getElementById('greeting');
    if (!g || g.tagName !== 'H1') return;
    var first = String((S && (S.fullName || S.name)) || '').trim().split(/\s+/)[0];
    var fix = function () {
      if (!phone() || !/^Welcome to Hi-Escorp/i.test((g.textContent || '').trim())) return;
      var hr = new Date().getHours();
      g.textContent = (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
    };
    fix();
    if (typeof MutationObserver === 'function') new MutationObserver(fix).observe(g, { childList: true, characterData: true, subtree: true });
  }

  /* ── a home's long sections: one row each; the row opens the section as its own screen ────── */
  var folds = [], hold = null, moreBox = null, foldOn = false;
  function prepFolds() {
    var list = FOLD[pageKey];
    if (!list) return;
    var col = document.querySelector('.hx-col, .dh-col') || document.querySelector('main');
    if (!col) return;
    hold = document.createElement('div'); hold.className = 'ap-hold'; hold.hidden = true;
    moreBox = document.createElement('section'); moreBox.className = 'ap-morehere'; moreBox.setAttribute('aria-label', 'More on this page');
    moreBox.innerHTML = '<h2 class="ap-gh">More on this page</h2><div class="ap-group"></div>';
    var grp = moreBox.querySelector('.ap-group');
    list.forEach(function (it) {
      var el = document.querySelector(it[0]);
      if (!el || el.closest('.ap-hold')) return;
      var r = document.createElement('button');
      r.type = 'button'; r.className = 'ap-row ap-press';
      r.innerHTML = '<span class="ap-ri">' + icon(it[2]) + '</span><span class="ap-rt">' + esc(it[1]) + '<small></small></span>' + CHEV;
      grp.appendChild(r);
      var f = { el: el, row: r, title: it[1], mark: document.createComment('ap-fold') };
      r.addEventListener('click', function () { openPush(f); });
      folds.push(f);
    });
    if (!folds.length) return;
    col.appendChild(moreBox);
    col.appendChild(hold);
    if (typeof MutationObserver === 'function') {
      var q = false, mo = new MutationObserver(function () { if (q) return; q = true; raf(function () { q = false; refreshRows(); }); });
      folds.forEach(function (f) { mo.observe(f.el, { attributes: true, attributeFilter: ['style', 'hidden', 'class'], childList: true, subtree: true, characterData: true }); });
    }
  }
  function summary(el) {
    var m = el.querySelector('.hx-head .hx-meta, .dh-head .dh-meta, .lg-sect .lg-meta, .hx-meta, .dh-meta');
    var t = m ? (m.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return t.length > 90 ? t.slice(0, 88).replace(/\s+\S*$/, '') + '…' : t;
  }
  function refreshRows() {
    var any = false;
    folds.forEach(function (f) {
      var gone = f.el.style.display === 'none' || f.el.hidden;
      f.row.hidden = gone; any = any || !gone;
      var sm = f.row.querySelector('small'), t = summary(f.el);
      if (sm.textContent !== t) sm.textContent = t;
    });
    if (moreBox) moreBox.hidden = !any;
  }
  function fold(on) {
    if (!folds.length || on === foldOn) return;
    foldOn = on;
    folds.forEach(function (f) {
      if (on) { if (f.el.parentNode && f.el.parentNode !== hold) { f.el.parentNode.insertBefore(f.mark, f.el); hold.appendChild(f.el); } }
      else if (f.mark.parentNode) { f.mark.parentNode.insertBefore(f.el, f.mark); f.mark.parentNode.removeChild(f.mark); }
    });
    moreBox.hidden = !on;
    if (on) refreshRows();
  }
  function openPush(f) {
    var scr = document.createElement('div');
    scr.className = 'ap-push';
    scr.setAttribute('role', 'dialog'); scr.setAttribute('aria-modal', 'true'); scr.setAttribute('aria-label', f.title);
    scr.innerHTML = '<div class="ap-push-bar"><button type="button" class="ap-back ap-press" aria-label="Back to ' + esc(tabs()[0].label) + '">' + BACK + '<span>' + esc(tabs()[0].label) + '</span></button><b>' + esc(f.title) + '</b></div><div class="ap-push-body"></div>';
    scr.querySelector('.ap-push-body').appendChild(f.el);
    document.body.appendChild(scr);
    var W = function () { return scr.offsetWidth || window.innerWidth || 375; };
    var spring = Spring(function (x) { scr.style.transform = x ? 'translate3d(' + x + 'px,0,0)' : ''; });
    spring.set(W()); spring.to(0, { damping: 1, response: 0.4 });
    pushLayer({ kind: 'push', el: scr, close: function (instant) {
      var back = function () { if (foldOn) hold.appendChild(f.el); else if (f.mark.parentNode) f.mark.parentNode.insertBefore(f.el, f.mark); if (scr.parentNode) scr.parentNode.removeChild(scr); try { f.row.focus({ preventScroll: true }); } catch (e) {} };
      if (instant) { spring.stop(); back(); return; }
      if (still()) { scr.classList.add('ap-fading'); setTimeout(back, 200); return; }
      spring.to(W(), { damping: 1, response: 0.3, done: back });
    } });
    pressable(scr);
    scr.querySelector('.ap-back').addEventListener('click', popLayer);
    var drag = null;   // swipe from the left edge to go back, 1:1, the release velocity handed to the spring
    scr.addEventListener('pointerdown', function (e) { if (e.button > 0 || e.clientX > 24) return; drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, t: tracker() }; });
    scr.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dx) < 10 || Math.abs(dy) > Math.abs(dx)) { if (Math.abs(dy) > 10) drag = null; return; }
        drag.moved = true; spring.stop();
        try { scr.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var x = dx < 0 ? rubber(dx, W()) : dx;
      spring.x = x; spring.v = 0; spring.onUpdate(x); drag.t.push(x);
      e.preventDefault();
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag; drag = null;
      if (!was.moved) return;
      var v = was.t.velocity();
      if (project(spring.x, v) > W() / 2) { spring.v = v; popLayer(); }
      else spring.to(0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v });
    };
    scr.addEventListener('pointerup', end);
    scr.addEventListener('pointercancel', end);
    setTimeout(function () { try { scr.querySelector('.ap-back').focus({ preventScroll: true }); } catch (e) {} }, 30);
  }

  /* ── the keyboard: the bar steps aside while a field has focus, so it never covers a form ──── */
  function keyboard() {
    var field = function (el) { return el && el.matches && el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="file"]), textarea, select, [contenteditable="true"]'); };
    document.addEventListener('focusin', function (e) { if (field(e.target)) h.classList.add('ap-kb'); });
    document.addEventListener('focusout', function () { setTimeout(function () { if (!field(document.activeElement)) h.classList.remove('ap-kb'); }, 60); });
  }

  /* ── mount: once, on a phone; the home's long sections follow the width ───────────────────── */
  function build() {
    if (built) return;
    S = session();
    if (!S || typeof LEDGER_NAV === 'undefined' || !LEDGER_NAV[S.role] || typeof ledgerPages !== 'function') return;
    built = true;
    role = S.role; pages = ledgerPages(role);
    var first = LEDGER_NAV[role][0];
    homeHref = typeof first[2] === 'string' ? first[2] : 'index.html';
    h.classList.add('ap-shell');
    buildTabbar(); buildFab(); watchDock(); keyboard(); greet(); prepFolds();
    whenNav(decorateNav);
  }
  function apply() {
    if (phone()) { build(); fold(true); }
    else { while (stack.length) closeTop(true); fold(false); }
  }
  ready(function () {
    apply();
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  });
})();
