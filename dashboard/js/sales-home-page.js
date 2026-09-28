/* sales-home-page.js — A290 · the sales home's own glue, loaded last by dashboard.html.
 *
 * dashboard.js writes the figures by id; this file only DERIVES from what it wrote: the date in
 * the rail, the action strip's mount and its count, the report tag's tone, the target ring drawn
 * from the bars, the rail links that follow the sections that show themselves, the quiet card
 * that steps aside, the pending-items count, the rail jumps, and the one load moment. It defines
 * no globals. Every browser API is feature-checked so the script also runs inside the test
 * harness's bare DOM (no observers, no matchMedia, no setInterval). */
(function () {
  'use strict';
  if (document.body && document.body.classList) document.body.classList.add('sl-js');
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var on = function (target, ev, fn) { if (target && typeof target.addEventListener === 'function') target.addEventListener(ev, fn); };
  var later = function (fn, ms) { return setTimeout(fn, ms); };
  var observe = function (el, fn, opts) {
    if (!el || typeof MutationObserver !== 'function') return null;
    var mo = new MutationObserver(fn); mo.observe(el, opts); return mo;
  };
  var shown = function (el) { return !!(el && el.style && el.style.display !== 'none'); };
  var setHidden = function (el, h) { if (el) el.hidden = !!h; };
  var pop = function (el) { if (el && el.classList) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } };
  // ONE DOMContentLoaded listener for the whole file (the test harness keeps only the last one registered).
  var READY = []; var ready = function (fn) { READY.push(fn); };

  // ── Date and the day line ──
  (function () {
    var d = new Date();
    var dd = $('dateDay'); if (dd) dd.textContent = String(d.getDate()).padStart(2, '0');
    var dm = $('dateMon'); if (dm) dm.textContent = d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleDateString('en-US', { month: 'long' });
    var tl = $('todayLabel'); if (tl) tl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  })();

  // ── The action strip (A146), mounted after the page's own loads have started ──
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

  // ── The report tag's tone follows the text dashboard.js writes ──
  (function () {
    var st = $('reportStatus'), pill = $('reportPill');
    if (!st || !pill) return;
    function tone() {
      var s = (st.textContent || '').toLowerCase(), t = '';
      if (s.indexOf('not') !== -1) t = 'warn'; else if (s.indexOf('submitted') !== -1) t = 'ok';
      if (t) pill.setAttribute('data-tone', t); else if (typeof pill.removeAttribute === 'function') pill.removeAttribute('data-tone');
    }
    observe(st, tone, { childList: true, characterData: true, subtree: true });
    tone();
  })();

  // ── The ring = the REAL target progress dashboard.js renders into #targetBars.
  //    No target set → the ring stays empty and the figure stays "—" (never a placeholder number). ──
  (function () {
    var bars = $('targetBars'), ring = $('targetDonutRing'), pct = $('targetDonutPct'), note = $('targetDonutNote');
    if (!bars || !ring || !pct) return;
    var C = 326.7;
    function draw() {
      var found = (bars.textContent || '').match(/\((\d+)%\)/g) || [];
      if (!found.length) return;
      var nums = found.map(function (s) { return parseInt(s.replace(/\D/g, ''), 10) || 0; });
      var avg = Math.round(nums.reduce(function (a, b) { return a + b; }, 0) / nums.length);
      ring.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(avg, 100) / 100)));
      pct.textContent = avg + '%';
      if (note) note.textContent = nums.length > 1 ? 'Average of ' + nums.length + ' targets' : 'This month';
    }
    observe(bars, draw, { childList: true, characterData: true, subtree: true });
    draw();
  })();

  // ── Sections that show themselves: the rail follows them, the quiet card steps aside ──
  (function () {
    var quiet = $('quietState'), overdue = $('overdueSection'), target = $('targetSection'), leads = $('leadsForYou');
    var navT = $('navTargets'), navO = $('navOverdue'), navL = $('navLeads'), navOC = $('navOverdueCount'), oc = $('overdueCount');
    function sync() {
      var o = shown(overdue), t = shown(target), l = shown(leads);
      setHidden(navT, !t); setHidden(navO, !o); setHidden(navL, !l);
      if (navOC && oc) navOC.textContent = oc.textContent || '0';
      if (quiet) quiet.style.display = (o || t) ? 'none' : '';
    }
    [overdue, target, leads].forEach(function (el) { observe(el, sync, { attributes: true, attributeFilter: ['style'] }); });
    observe(oc, sync, { childList: true, characterData: true, subtree: true });
    sync();
    // A short poll as well: the loaders write in their own time, and a DOM without observers still syncs.
    if (typeof setInterval === 'function') { var n = 0; var t = setInterval(function () { sync(); if (++n > 24) clearInterval(t); }, 250); }
  })();

  // ── Pending items — best effort, silent on failure. Same request pending-items.html makes. ──
  (function () {
    var el = $('pendingCount');
    if (!el) return;
    ready(function () {
      var session = null;
      try { session = JSON.parse(sessionStorage.getItem('session') || 'null') || JSON.parse(localStorage.getItem('session') || 'null'); } catch (e) {}
      if (!session || typeof apiGetPendingItems !== 'function') return;
      var p;
      try {
        p = apiGetPendingItems({ role: 'sales', agentName: session.name, prSheetId: session.prSheetId || '', quotationSheetId: session.quotationSheetId || '' });
      } catch (e) { return; }
      if (!p || typeof p.then !== 'function') return;
      p.then(function (r) {
        var d = r && r.success && r.data;
        if (!d) return;
        el.textContent = String(((d.prs || []).length) + ((d.quotations || []).length));
        if (el.classList) { el.classList.remove('sl-tick'); void el.offsetWidth; el.classList.add('sl-tick'); }
      }).catch(function () {});
    });
  })();

  // ── Rail jumps and the active section link ──
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
    ['inbox', 'leadsForYou', 'today', 'targetSection', 'overdueSection'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The one load moment: when the month's figure lands, or after 1.5 s ──
  (function () {
    var armed = false, timer = null;
    function moment() {
      if (armed || REDUCED || !document.body || !document.body.classList) return;
      armed = true;
      document.body.classList.add('sl-load');
      later(function () { document.body.classList.remove('sl-load'); }, 2400);
    }
    var mq = $('monthQuotations');
    observe(mq, function () { if (/\d/.test(mq.textContent || '')) { clearTimeout(timer); moment(); } }, { childList: true, characterData: true, subtree: true });
    ready(function () { timer = later(moment, 1500); });
  })();

  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
