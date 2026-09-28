/* accounting-home-page.js — A292 · the accounting home's own glue, loaded last by accounting-home.html.
 *
 * accounting-home.js fills the shipments list and the timeline by id, accounting-profit.js the
 * revenue table and the profit report; this file carries what the page's inline scripts used to:
 * the date in the rail, the action strip's mount and its count, the KPI snapshot the slab shows
 * (four reads from the process flow), the document viewer the timeline opens by name, the
 * monitoring section's collapse, the rail links, the slab tag's tone and the one load moment.
 * The globals it defines on purpose are the three the markup calls by name: acctOpenDocViewer,
 * acctCloseDocViewer, acctSmToggleSection. Every browser API is feature-checked so the script
 * also runs inside the test harness's bare DOM. */
(function () {
  'use strict';
  if (document.body && document.body.classList) document.body.classList.add('ac-js');
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
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
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

  // ── The KPI snapshot (read-only, from the flow backend) ──
  function loadAcctKpis() {
    var state = $('kpiState');
    var set = function (id, v) { var el = $(id); if (el) { el.textContent = v; if (el.classList) { el.classList.remove('ac-tick'); void el.offsetWidth; el.classList.add('ac-tick'); } } };
    var tone = function (t) { if (!state) return; if (t) state.setAttribute('data-tone', t); else if (typeof state.removeAttribute === 'function') state.removeAttribute('data-tone'); };
    if (typeof _flowConfigured !== 'function' || !_flowConfigured()) {
      if (state) state.textContent = 'Flow backend not configured';
      tone('bad');
      return;
    }
    Promise.all([
      fetchFlow('getInvoices').catch(function () { return { data: [] }; }),
      fetchFlow('getAPAging').catch(function () { return { data: [] }; }),
      fetchFlow('getInventory').catch(function () { return { data: [] }; }),
      fetchFlow('getExpenses').catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      var invoices = (r[0] && r[0].data) || [], aps = (r[1] && r[1].data) || [];
      var items = (r[2] && r[2].data) || [], exps = (r[3] && r[3].data) || [];
      var sales = invoices.reduce(function (s, v) { return s + flowNum(v.totalSales); }, 0);
      var cogs = invoices.reduce(function (s, v) { return s + flowNum(v.totalCOGS); }, 0);
      var gp = sales - cogs;
      var apOut = aps.filter(function (a) { return (a.status || '').toLowerCase() !== 'paid'; })
        .reduce(function (s, a) { return s + (flowNum(a.amountPHP) - flowNum(a.paidPHP)); }, 0);
      var invVal = flowStockItems(items).reduce(function (s, i) { return s + flowNum(i.totalLanded); }, 0);   // real stocks only
      var expTot = exps.reduce(function (s, e) { return s + flowNum(e.amount); }, 0);
      var netProfit = gp - expTot;
      set('kpiSales', flowMoney(sales, 'PHP'));
      set('kpiCogs', flowMoney(cogs, 'PHP'));
      set('kpiGp', flowMoney(gp, 'PHP'));
      set('kpiGpMargin', sales > 0 ? (gp / sales * 100).toFixed(0) + '% margin on sales' : 'No sales invoiced yet');
      set('kpiAp', flowMoney(apOut, 'PHP'));
      set('kpiInv', flowMoney(invVal, 'PHP'));
      set('kpiNet', flowMoney(netProfit, 'PHP'));
      if (state) state.textContent = 'Live from the process flow';
      tone('ok');
    }).catch(function () { if (state) state.textContent = 'Unavailable'; tone('bad'); });
  }
  ready(loadAcctKpis);

  // ── The document viewer the timeline opens by name ──
  function extractDriveFileId(url) {
    if (!url) return null;
    var m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }
  window.acctOpenDocViewer = function (title, url) {
    var t = $('acctDocViewerTitle'), a = $('acctDocViewerOpenBtn'), body = $('acctDocViewerBody'), ov = $('acctDocViewerOverlay');
    if (t) t.textContent = title;
    if (a) a.href = url;
    var fileId = extractDriveFileId(url);
    if (body) {
      body.innerHTML = fileId
        ? '<iframe class="ac-docframe" src="https://drive.google.com/file/d/' + fileId + '/preview" allowfullscreen title="' + esc(title) + '"></iframe>'
        : '<div class="ac-docfallback"><p>Stored in the Drive folder</p><a href="' + esc(url) + '" target="_blank" class="btn btn-primary btn-sm">Open in Drive</a></div>';
    }
    if (ov) ov.style.display = 'flex';
  };
  window.acctCloseDocViewer = function () {
    var ov = $('acctDocViewerOverlay'), body = $('acctDocViewerBody');
    if (ov) ov.style.display = 'none';
    if (body) body.innerHTML = '';
  };

  // ── The monitoring section collapses under its header button ──
  window.acctSmToggleSection = function (btn) {
    var body = $('acctSmBody'); if (!body) return;
    var hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    var b = btn || $('acctSmToggle');
    if (b && typeof b.setAttribute === 'function') b.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  };

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
    ['inbox', 'modules', 'revenue', 'profit', 'shipments'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The one load moment: when gross profit lands, or after 1.5 s ──
  (function () {
    var armed = false, timer = null;
    function moment() {
      if (armed || REDUCED || !document.body || !document.body.classList) return;
      armed = true;
      document.body.classList.add('ac-load');
      later(function () { document.body.classList.remove('ac-load'); }, 2400);
    }
    var k = $('kpiGp');
    observe(k, function () { if (/\d/.test(k.textContent || '')) { clearTimeout(timer); moment(); } }, { childList: true, characterData: true, subtree: true });
    ready(function () { timer = later(moment, 1500); });
  })();

  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
