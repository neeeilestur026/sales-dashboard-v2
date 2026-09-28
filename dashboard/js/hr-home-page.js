/* hr-home-page.js — A294 · the HR home's own glue, loaded last by hr-home.html.
 *
 * hr-home.js writes every figure by id and renders the overview, the birthdays and the report
 * banner; management-flow.js and report-render.js fill the daily-reports block. This file only
 * derives from what they wrote: the date and the day line, the rail links, and the one load
 * moment when the headcount lands. It defines no globals. Every browser API is feature-checked
 * so the script also runs inside the test harness's bare DOM. */
(function () {
  'use strict';
  if (document.body && document.body.classList) document.body.classList.add('hr-js');
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var on = function (target, ev, fn) { if (target && typeof target.addEventListener === 'function') target.addEventListener(ev, fn); };
  var later = function (fn, ms) { return setTimeout(fn, ms); };
  var observe = function (el, fn, opts) {
    if (!el || typeof MutationObserver !== 'function') return null;
    var mo = new MutationObserver(fn); mo.observe(el, opts); return mo;
  };
  var READY = []; var ready = function (fn) { READY.push(fn); };

  // ── Date and the day line ──
  (function () {
    var d = new Date();
    var dd = $('hbDay'); if (dd) dd.textContent = String(d.getDate()).padStart(2, '0');
    var dm = $('hbMon'); if (dm) dm.textContent = d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleDateString('en-US', { month: 'long' });
    var tl = $('todayLabel'); if (tl) tl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  })();

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
    ['today', 'hrmods', 'mkmods', 'newsec-daily-reports'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The one load moment: when the headcount lands, or after 1.5 s ──
  (function () {
    var armed = false, timer = null;
    function moment() {
      if (armed || REDUCED || !document.body || !document.body.classList) return;
      armed = true;
      document.body.classList.add('hr-load');
      later(function () { document.body.classList.remove('hr-load'); }, 2400);
    }
    var k = $('statEmployees');
    observe(k, function () { if (/\d/.test(k.textContent || '')) { clearTimeout(timer); moment(); } }, { childList: true, characterData: true, subtree: true });
    ready(function () { timer = later(moment, 1500); });
  })();

  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
