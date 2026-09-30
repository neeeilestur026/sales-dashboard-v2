/* marketing-home-page.js — A294 · the marketing home's own glue, loaded last by marketing-home.html.
 *
 * marketing-home.js renders the scorecard into #kpis, the tabs into #tabs and the panel into
 * #panels; management-flow.js and report-render.js fill the daily-reports block. This file only
 * derives from what they wrote: the date in the rail, the tab indicator that slides under the
 * active tracker tab, the rail links, and the one load moment when the scorecard lands. It defines
 * no globals. Every browser API is feature-checked so the script also runs inside the test
 * harness's bare DOM. */
(function () {
  'use strict';
  if (document.body && document.body.classList) document.body.classList.add('mk-js');
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var on = function (target, ev, fn) { if (target && typeof target.addEventListener === 'function') target.addEventListener(ev, fn); };
  var later = function (fn, ms) { return setTimeout(fn, ms); };
  var observe = function (el, fn, opts) {
    if (!el || typeof MutationObserver !== 'function') return null;
    var mo = new MutationObserver(fn); mo.observe(el, opts); return mo;
  };
  // ONE DOMContentLoaded listener for the whole file (the test harness keeps only the last one registered).
  var READY = []; var ready = function (fn) { READY.push(fn); };

  // ── Date ──
  if (typeof hxDatePill === 'function') hxDatePill();   // A302: the shared date pill

  // ── Rail links and the active section ──
  (function () {
    var scrollTo = function (el) { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); };
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
    ['trackers', 'newsec-daily-reports'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The tab indicator slides under whichever .mkt-tab is active (marketing-home.js rebuilds #tabs on every render) ──
  (function () {
    var seg = $('tabsSeg'), track = $('tabs'); var ind = seg && seg.querySelector && seg.querySelector('.hx-seg-ind');
    if (!seg || !track || !ind) return;
    function place() {
      var a = track.querySelector('.mkt-tab.active'); if (!a || typeof seg.getBoundingClientRect !== 'function') return;
      var sr = seg.getBoundingClientRect(), ar = a.getBoundingClientRect();
      ind.style.width = ar.width + 'px';
      ind.style.transform = 'translateX(' + (ar.left - sr.left - seg.clientLeft + seg.scrollLeft) + 'px)';
      if (!seg.classList.contains('has-ind')) seg.classList.add('has-ind');
    }
    if (REDUCED) return;   // the CSS fallback paints the active tab itself
    observe(track, place, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    var timer = null;
    on(window, 'resize', function () { clearTimeout(timer); timer = later(place, 80); });
    on(seg, 'scroll', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    on(window, 'load', place);
    place();
  })();

  // ── The one load moment: when the scorecard lands, or after 1.5 s ──
  (function () {
    var armed = false, timer = null;
    function moment() {
      if (armed || REDUCED || !document.body || !document.body.classList) return;
      armed = true;
      document.body.classList.add('mk-load');
      later(function () { document.body.classList.remove('mk-load'); }, 2400);
    }
    var k = $('kpis');
    observe(k, function () { if (typeof k.querySelector === 'function' && k.querySelector('.kpi')) { clearTimeout(timer); moment(); } }, { childList: true });
    ready(function () { timer = later(moment, 1500); });
  })();

  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
