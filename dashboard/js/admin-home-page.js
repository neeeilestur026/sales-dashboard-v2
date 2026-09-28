/* admin-home-page.js — A291 · the admin home's own glue, loaded last by admin.html.
 *
 * admin.js fills the slab, the queue counts, the queues, the feed and the inventory by id, and
 * accounting-profit.js the profit report; this file only DERIVES from what they wrote: the date
 * in the rail, the action strip's mount and its count, the queue and activity totals in the
 * slab, the rail jumps that switch a queue tab, the active rail link, the tab indicator, the
 * one load moment, and the shipment dialog's Payment sub-tab on top of admin.js's base switcher.
 * The only global it touches on purpose is _smModalSwitchTab, which it wraps. Every browser
 * API is feature-checked so the script also runs inside the test harness's bare DOM. */
(function () {
  'use strict';
  if (document.body && document.body.classList) document.body.classList.add('ad-js');
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var on = function (target, ev, fn) { if (target && typeof target.addEventListener === 'function') target.addEventListener(ev, fn); };
  var later = function (fn, ms) { return setTimeout(fn, ms); };
  var observe = function (el, fn, opts) {
    if (!el || typeof MutationObserver !== 'function') return null;
    var mo = new MutationObserver(fn); mo.observe(el, opts); return mo;
  };
  var pop = function (el) { if (el && el.classList) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } };
  var tick = function (el) { if (el && el.classList) { el.classList.remove('ad-tick'); void el.offsetWidth; el.classList.add('ad-tick'); } };
  // ONE DOMContentLoaded listener for the whole file (the test harness keeps only the last one registered).
  var READY = []; var ready = function (fn) { READY.push(fn); };

  // ── Date and the day line ──
  (function () {
    var d = new Date();
    var dd = $('hbDay'); if (dd) dd.textContent = String(d.getDate()).padStart(2, '0');
    var dm = $('hbMon'); if (dm) dm.textContent = d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleDateString('en-US', { month: 'long' });
    var tl = $('todayLabel'); if (tl) tl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  })();

  // ── The action strip (A146) ──
  ready(function () {
    if (typeof flowActionsStrip === 'function') later(function () { flowActionsStrip('flowActionCenter'); }, 300);
  });

  // ── The inbox count follows whatever the strip renders ──
  (function () {
    var box = $('flowActionCenter'), count = $('inboxCount'), inbox = $('inbox');
    if (!box) return;
    var last = null;
    function recount() {
      var n = typeof box.querySelectorAll === 'function' ? box.querySelectorAll('a.fa-row').length : 0;
      if (count) {
        count.textContent = String(n);
        if (count.classList) count.classList.toggle('zero', n === 0);
        if (last !== null && last !== n) pop(count);
      }
      if (inbox && inbox.classList) inbox.classList.toggle('zero', n === 0);
      last = n;
    }
    observe(box, recount, { childList: true, subtree: true });
    recount();
  })();

  // ── The slab's derived facts: records in the queues (the eight .ct counts) and activity today ──
  (function () {
    var TC = ['tcQt', 'tcSo', 'tcPo', 'tcAp', 'tcRc', 'tcIv', 'tcPr', 'tcSm'];
    var total = $('queueTotal'), act = $('activityCount'), feed = $('activityFeed');
    function sumQueues() {
      var any = false, s = 0;
      TC.forEach(function (id) { var e = $(id); var n = e ? parseInt(e.textContent, 10) : NaN; if (!isNaN(n)) { any = true; s += n; } });
      if (total && any) { var t = String(s); if (total.textContent !== t) { total.textContent = t; tick(total); } }
    }
    function countFeed() {
      if (!act || !feed || typeof feed.querySelectorAll !== 'function') return;
      var rows = feed.querySelectorAll('.feedrow').length;
      var empty = feed.querySelectorAll('.ad-empty').length;
      if (rows || empty) { var t = String(rows); if (act.textContent !== t) { act.textContent = t; tick(act); } }
    }
    TC.forEach(function (id) { observe($(id), sumQueues, { childList: true, characterData: true, subtree: true }); });
    observe(feed, countFeed, { childList: true, subtree: true });
    sumQueues(); countFeed();
  })();

  // ── Rail jumps switch a queue tab and scroll to the queues ──
  (function () {
    var scrollTo = function (el) { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); };
    var jumps = Array.prototype.slice.call(document.querySelectorAll('.hx-jump[data-tab]'));
    jumps.forEach(function (b) {
      on(b, 'click', function () {
        if (typeof switchTaskTab === 'function') switchTaskTab(b.getAttribute('data-tab'));
        scrollTo($('queues'));
      });
    });
    // the jump chips follow the active tab
    var seg = document.querySelector('#queues .hx-seg');
    function reflect() {
      var a = seg && seg.querySelector('.hx-tab.active'); if (!a) return;
      var key = (a.getAttribute('onclick') || '').replace(/.*switchTaskTab\('(\w+)'\).*/, '$1');
      jumps.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === key); });
    }
    if (seg && typeof MutationObserver === 'function') {
      var mo = new MutationObserver(reflect);
      seg.querySelectorAll('.hx-tab').forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ['class'] }); });
    }
    reflect();

    var links = Array.prototype.slice.call(document.querySelectorAll('.hx-rail-nav a[href^="#"]'));
    links.forEach(function (a) {
      on(a, 'click', function (ev) {
        var t = $(a.getAttribute('href').slice(1));
        if (!t) return;
        ev.preventDefault(); scrollTo(t);
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', a.getAttribute('href'));
      });
    });
    if (typeof IntersectionObserver !== 'function' || !links.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    ['inbox', 'queues', 'activity', 'inventory', 'profit'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The tab indicator slides under whichever .hx-tab is active ──
  (function () {
    var seg = document.querySelector('#queues .hx-seg'); var ind = seg && seg.querySelector('.hx-seg-ind');
    if (!seg || !ind) return;
    var tabs = Array.prototype.slice.call(seg.querySelectorAll('.hx-tab'));
    function place() {
      var a = seg.querySelector('.hx-tab.active'); if (!a || typeof seg.getBoundingClientRect !== 'function') return;
      var sr = seg.getBoundingClientRect(), ar = a.getBoundingClientRect();
      ind.style.width = ar.width + 'px';
      ind.style.transform = 'translateX(' + (ar.left - sr.left - seg.clientLeft + seg.scrollLeft) + 'px)';
      if (!seg.classList.contains('has-ind')) seg.classList.add('has-ind');
    }
    if (REDUCED) return;   // the CSS fallback paints the active tab itself
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(place);
      tabs.forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ['class'] }); });
    } else {
      on(seg, 'click', function () { later(place, 0); });
    }
    var timer = null;
    on(window, 'resize', function () { clearTimeout(timer); timer = later(place, 80); });
    on(seg, 'scroll', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    on(window, 'load', place);
    place();
  })();

  // ── The one load moment: when the team's figure lands, or after 1.5 s ──
  (function () {
    var armed = false, timer = null;
    function moment() {
      if (armed || REDUCED || !document.body || !document.body.classList) return;
      armed = true;
      document.body.classList.add('ad-load');
      later(function () { document.body.classList.remove('ad-load'); }, 2400);
    }
    var k = $('kpiQt');
    observe(k, function () { if (/\d/.test(k.textContent || '')) { clearTimeout(timer); moment(); } }, { childList: true, characterData: true, subtree: true });
    ready(function () { timer = later(moment, 1500); });
  })();

  // ── The shipment dialog's Payment sub-tab, on top of admin.js's details/history switcher ──
  (function () {
    var orig = window._smModalSwitchTab;
    window._smModalSwitchTab = function (tab) {
      var ship = $('smShipmentBlock'), pay = $('smPaymentBlock');
      var btnD = $('smEditTabBtnDetails'), btnP = $('smEditTabBtnPayment'), btnH = $('smEditTabBtnHistory');
      if (tab === 'payment') {
        if (typeof orig === 'function') orig('details');
        if (ship) ship.style.display = 'none';
        if (pay) pay.style.display = '';
        if (btnD) btnD.classList.remove('active');
        if (btnP) btnP.classList.add('active');
        if (btnH) btnH.classList.remove('active');
        return;
      }
      if (tab === 'details') {
        if (ship) ship.style.display = '';
        if (pay) pay.style.display = 'none';
        if (btnP) btnP.classList.remove('active');
      } else if (tab === 'history') {
        if (btnP) btnP.classList.remove('active');
      }
      if (typeof orig === 'function') return orig(tab);
    };
  })();

  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
