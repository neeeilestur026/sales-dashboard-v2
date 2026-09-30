/* management-home-page.js — A293 · the management home's own glue, loaded last by management-home.html.
 *
 * management-flow.js fills the slab, the approvals, the daily reports, the lifecycle, inventory
 * and pricing blocks; management-income.js the income statement; management-home.js the HR cards,
 * the payroll approvals and the shipment monitoring. This file carries what the page's inline
 * scripts used to, minus the workspace sidebar, the density toggle and the section accordion the
 * rail replaced: the date, the action strip's mount, the approval strip (management is the final
 * approver tier), the slab's composition bar and derived counts, the rail, the document viewer
 * the timeline opens by name, the section summaries management-home.js writes, the Cmd/Ctrl+K
 * palette and the KPI detail card with its sparkline. The globals it defines on purpose are the
 * ones the markup or management-home.js call by name: openDocViewer, closeDocViewer,
 * _extractDriveFileId, setSectionSummary, _cmdkOpen/_cmdkClose/_cmdkRender/_cmdkSet/_cmdkRun/
 * _cmdkKey, _kpiDetailOpen/_kpiDetailClose. Every browser API is feature-checked so the script
 * also runs inside the test harness's bare DOM. */
(function () {
  'use strict';
  if (document.body && document.body.classList) document.body.classList.add('mg-js');
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
  var tick = function (el) { if (el && el.classList) { el.classList.remove('mg-tick'); void el.offsetWidth; el.classList.add('mg-tick'); } };
  var esc = hxEsc;
  var num = function (s) { var n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  var scrollTo = function (el) { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); };
  // ONE DOMContentLoaded listener for the whole file (the test harness keeps only the last one registered).
  var READY = []; var ready = function (fn) { READY.push(fn); };

  // ── Date and the day line ──
  if (typeof hxDatePill === 'function') hxDatePill();   // A302: the shared date pill

  // ── The action strip (A146) ──
  ready(function () {
    if (typeof flowActionsStrip === 'function') later(function () { flowActionsStrip('flowActionCenter'); }, 300);
  });

  // ── The approval strip: quotations and purchase orders at the final tier ──
  function loadApprovalStrip() {
    var el = $('flowApprovalStrip');
    if (!el || typeof _flowConfigured !== 'function' || !_flowConfigured()) return;
    Promise.all([
      fetchFlow('getQuotations').catch(function () { return { data: [] }; }),
      fetchFlow('getPurchaseOrders').catch(function () { return { data: [] }; })
    ]).then(function (r) {
      var qn = ((r[0] && r[0].data) || []).filter(function (x) { return x.status === 'Pending Management'; }).length;
      var pn = ((r[1] && r[1].data) || []).filter(function (x) { return x.status === 'Pending Management'; }).length;
      if (qn + pn === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
      var chip = function (n, label, href) { return '<a class="hx-po-chip" href="' + href + '"><span class="n">' + n + '</span>' + label + '</a>'; };
      var chips = '';
      if (qn) chips += chip(qn, 'Quotations awaiting your approval', 'flow-quotations.html');
      if (pn) chips += chip(pn, 'Purchase orders awaiting your approval', 'flow-purchase-orders.html');
      el.innerHTML = '<div class="hx-po-chips">' + chips + '</div>';
      el.style.display = '';
    }).catch(function () {});
  }
  ready(loadApprovalStrip);

  // ── The inbox count and the slab's derived facts ──
  (function () {
    var box = $('flowActionCenter'), strip = $('flowApprovalStrip'), appr = $('mgmtApprovals'), inbox = $('inbox');
    var count = $('inboxCount'), apprCount = $('approvalsCount'), pay = $('payrollApprovalsContainer'), payCount = $('payrollCount');
    var q = function (el, sel) { return el && typeof el.querySelectorAll === 'function' ? el.querySelectorAll(sel).length : 0; };
    var last = null;
    function recount() {
      var chips = 0;
      if (strip && strip.style.display !== 'none' && typeof strip.querySelectorAll === 'function') strip.querySelectorAll('.hx-po-chip .n').forEach(function (x) { chips += parseInt(x.textContent, 10) || 0; });
      var acts = q(box, 'a.fa-row'), rows = q(appr, 'tbody tr');
      var tot = chips + acts + rows;
      if (count) { count.textContent = String(tot); if (count.classList) count.classList.toggle('zero', tot === 0); if (last !== null && last !== tot) pop(count); }
      if (inbox && inbox.classList) inbox.classList.toggle('zero', tot === 0);
      if (apprCount) { var t = String(chips + rows); if (apprCount.textContent !== t) { apprCount.textContent = t; tick(apprCount); } }
      last = tot;
    }
    function recountPayroll() {
      if (!payCount) return;
      var active = document.querySelector('.payappr-tab.active');
      var pending = !active || active.id === 'payapprTabPending';
      var n = pending ? q(pay, '.payappr-row') : (payCount.getAttribute('data-n') ? parseInt(payCount.getAttribute('data-n'), 10) : 0);
      if (pending && typeof payCount.setAttribute === 'function') payCount.setAttribute('data-n', String(n));
      payCount.textContent = String(n);
      if (payCount.classList) payCount.classList.toggle('zero', n === 0);
    }
    [box, strip, appr].forEach(function (el) { observe(el, recount, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }); });
    observe(pay, recountPayroll, { childList: true, subtree: true });
    recount(); recountPayroll();
  })();

  // ── The composition bar: cost of goods against gross profit, from the figures management-flow.js writes ──
  (function () {
    var cogs = $('mgmtKpiCogs'), gp = $('mgmtKpiGp'), comp = document.querySelector('.hx-comp');
    if (!cogs || !gp || !comp) return;
    function paint() {
      var c = num(cogs.textContent), g = num(gp.textContent);
      if (c == null || g == null) return;
      var tot = Math.max(0, c) + Math.max(0, g); if (tot <= 0) return;
      var bars = comp.querySelectorAll('i');
      var set = function (i, v) { if (i && i.style && typeof i.style.setProperty === 'function') i.style.setProperty('--hx-w', String(Math.max(0, Math.min(1, v / tot)))); };
      set(bars[0], Math.max(0, c)); set(bars[1], Math.max(0, g));
    }
    observe(cogs, paint, { childList: true, characterData: true, subtree: true });
    observe(gp, paint, { childList: true, characterData: true, subtree: true });
    paint();
  })();

  // ── The document viewer the timeline opens by name ──
  window._extractDriveFileId = function (url) {
    if (!url) return null;
    var m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  };
  window.openDocViewer = function (title, url) {
    var t = $('docViewerTitle'), a = $('docViewerOpenBtn'), body = $('docViewerBody'), ov = $('docViewerOverlay');
    if (t) t.textContent = title;
    if (a) a.href = url;
    var fileId = window._extractDriveFileId(url);
    if (body) {
      body.innerHTML = fileId
        ? '<iframe class="ac-docframe" src="https://drive.google.com/file/d/' + fileId + '/preview" allowfullscreen title="' + esc(title) + '"></iframe>'
        : '<div class="ac-docfallback"><p>Stored in the Drive folder</p><a href="' + esc(url) + '" target="_blank" class="btn btn-primary btn-sm">Open the folder in Drive</a></div>';
    }
    if (ov) ov.style.display = 'flex';
  };
  window.closeDocViewer = function () {
    var ov = $('docViewerOverlay'), body = $('docViewerBody');
    if (ov) ov.style.display = 'none';
    if (body) body.innerHTML = '';
  };

  // ── Section summaries management-home.js writes (shipments, payroll) ──
  window.setSectionSummary = function (sectionId, text) {
    var el = $('summary-' + String(sectionId).replace('section-', ''));
    if (el) el.textContent = text;
  };

  // ── Escape closes whatever is open ──
  on(document, 'keydown', function (e) {
    if (e.key !== 'Escape') return;
    window.closeDocViewer();
    if (typeof closeMgmtSm === 'function') closeMgmtSm();
    window._kpiDetailClose();
  });

  // ── Rail links, the jump chips and the active section ──
  (function () {
    var links = Array.prototype.slice.call(document.querySelectorAll('.hx-rail-nav a[href^="#"]'));
    links.forEach(function (a) {
      on(a, 'click', function (ev) {
        var t = $(a.getAttribute('href').slice(1));
        if (!t) return;
        ev.preventDefault(); scrollTo(t);
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', a.getAttribute('href'));
      });
    });
    document.querySelectorAll('.hx-jump[data-target]').forEach(function (b) {
      on(b, 'click', function () { scrollTo($(b.getAttribute('data-target'))); });
    });
    if (typeof IntersectionObserver !== 'function' || !links.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    ['inbox', 'pulse', 'team', 'operations', 'hr'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The one load moment: when revenue lands, or after 1.5 s ──
  (function () {
    var armed = false, timer = null;
    function moment() {
      if (armed || REDUCED || !document.body || !document.body.classList) return;
      armed = true;
      document.body.classList.add('mg-load');
      later(function () { document.body.classList.remove('mg-load'); }, 2400);
    }
    var k = $('mgmtKpiRevenue');
    observe(k, function () { if (/\d/.test(k.textContent || '')) { clearTimeout(timer); moment(); } }, { childList: true, characterData: true, subtree: true });
    ready(function () { timer = later(moment, 1500); });
  })();

  // ── Cmd/Ctrl+K: jump to a section, open a page, switch the theme ──
  (function () {
    var jump = function (id) { return function () { later(function () { scrollTo($(id)); }, 50); }; };
    var COMMANDS = [
      { group: 'Section', label: 'Needs you', keywords: 'inbox approvals pending follow-ups', run: jump('inbox') },
      { group: 'Section', label: 'Income statement', keywords: 'pulse revenue profit income', run: jump('pulse') },
      { group: 'Section', label: 'Daily reports', keywords: 'team daily reports weekly', run: jump('team') },
      { group: 'Section', label: 'Lifecycle health', keywords: 'operations lifecycle orders', run: jump('newsec-lifecycle') },
      { group: 'Section', label: 'Inventory', keywords: 'operations inventory stock', run: jump('newsec-inventory') },
      { group: 'Section', label: 'Pricing history', keywords: 'operations pricing requests', run: jump('newsec-pricing') },
      { group: 'Section', label: 'Shipment monitoring', keywords: 'operations shipment shipping', run: jump('section-shipments') },
      { group: 'Section', label: 'HR insights', keywords: 'hr people leave reviews recruitment', run: jump('section-hr-insights') },
      { group: 'Section', label: 'Payroll approvals', keywords: 'hr payroll cutoff approve', run: jump('section-payroll-approvals') },
      { group: 'Page', label: 'Sales orders', keywords: 'orders so page', run: function () { location.href = 'management-sales-orders.html'; } },
      { group: 'Page', label: 'Itineraries', keywords: 'itinerary travel field page', run: function () { location.href = 'management-itinerary.html'; } },
      { group: 'Page', label: 'Leave requests', keywords: 'leave page', run: function () { location.href = 'management-leave.html'; } },
      { group: 'Action', label: 'Switch the theme', keywords: 'dark light theme', run: function () { if (window.hxTheme) window.hxTheme.toggle(); } }
    ];
    var activeIdx = 0, filtered = COMMANDS;
    window._cmdkOpen = function () {
      var ov = $('cmdkOverlay'), inp = $('cmdkInput');
      if (ov && ov.classList) ov.classList.add('open');
      if (inp) inp.value = '';
      activeIdx = 0;
      window._cmdkRender();
      if (inp && typeof inp.focus === 'function') later(function () { inp.focus(); }, 50);
    };
    window._cmdkClose = function () { var ov = $('cmdkOverlay'); if (ov && ov.classList) ov.classList.remove('open'); };
    window._cmdkRender = function () {
      var inp = $('cmdkInput'), list = $('cmdkList');
      var q = ((inp && inp.value) || '').trim().toLowerCase();
      filtered = q ? COMMANDS.filter(function (c) { return (c.label + ' ' + (c.keywords || '')).toLowerCase().indexOf(q) !== -1; }) : COMMANDS.slice();
      if (activeIdx >= filtered.length) activeIdx = 0;
      if (!list) return;
      if (!filtered.length) { list.innerHTML = '<div class="cmdk-empty">No matches</div>'; return; }
      var html = '', lastGroup = '';
      filtered.forEach(function (c, i) {
        if (c.group !== lastGroup) { html += '<div class="cmdk-group-label">' + c.group + '</div>'; lastGroup = c.group; }
        html += '<div class="cmdk-item' + (i === activeIdx ? ' active' : '') + '" onclick="_cmdkRun(' + i + ')" onmouseenter="_cmdkSet(' + i + ')">' +
                '<span>' + c.label + '</span><span class="cmdk-item-meta">' + c.group + '</span></div>';
      });
      list.innerHTML = html;
    };
    window._cmdkSet = function (i) { activeIdx = i; window._cmdkRender(); };
    window._cmdkRun = function (i) {
      var c = filtered[i]; if (!c) return;
      try { c.run(); } catch (e) { console.error(e); }
      window._cmdkClose();
    };
    window._cmdkKey = function (e) {
      if (e.key === 'Escape') { window._cmdkClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); window._cmdkRender(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); window._cmdkRender(); return; }
      if (e.key === 'Enter') { e.preventDefault(); window._cmdkRun(activeIdx); }
    };
    on(document, 'keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        var ov = $('cmdkOverlay');
        if (ov && ov.classList && ov.classList.contains('open')) window._cmdkClose(); else window._cmdkOpen();
      }
    });
  })();

  // ── KPI cards: a detail card with a sparkline of the daily snapshots (Mgmt item 5) ──
  (function () {
    var HISTORY_KEY = 'mgmt_kpi_history_v1', MAX_DAYS = 60;
    var today = function () { return new Date().toISOString().slice(0, 10); };
    var loadHistory = function () { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; } catch (e) { return {}; } };
    var saveHistory = function (h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {} };
    var kpiId = function (card) {
      var v = card.querySelector('.kpi-value'), l = card.querySelector('.kpi-label');
      return (v && v.id) || ((l && l.textContent) || '').trim() || null;
    };
    function captureSnapshot() {
      var hist = loadHistory(), d = today();
      document.querySelectorAll('.kpi-card').forEach(function (card) {
        var id = kpiId(card); if (!id) return;
        var v = card.querySelector('.kpi-value'); var val = num(v && v.textContent);
        if (val == null) return;
        if (!hist[id]) hist[id] = [];
        var last = hist[id][hist[id].length - 1];
        if (last && last.d === d) last.v = val; else hist[id].push({ d: d, v: val });
        if (hist[id].length > MAX_DAYS) hist[id] = hist[id].slice(-MAX_DAYS);
      });
      saveHistory(hist);
    }
    function renderSpark(svg, points) {
      if (!points || points.length < 2) { svg.innerHTML = ''; return false; }
      var w = 200, h = 60, pad = 4;
      var xs = points.map(function (_, i) { return pad + (i * (w - 2 * pad)) / (points.length - 1); });
      var vals = points.map(function (p) { return p.v; });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
      var ys = vals.map(function (v) { return h - pad - ((v - min) / span) * (h - 2 * pad); });
      var d = xs.map(function (x, i) { return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + ys[i].toFixed(1); }).join(' ');
      var area = d + ' L' + xs[xs.length - 1].toFixed(1) + ',' + (h - pad) + ' L' + xs[0].toFixed(1) + ',' + (h - pad) + ' Z';
      // Classed paths; css/management-home.css paints them so the theme follows.
      svg.innerHTML = '<path class="area" d="' + area + '"/><path class="line" d="' + d + '"/>' +
        '<circle class="dot" cx="' + xs[xs.length - 1] + '" cy="' + ys[ys.length - 1] + '" r="3"/>';
      return true;
    }
    window._kpiDetailOpen = function (card) {
      var l = card.querySelector('.kpi-label'), v = card.querySelector('.kpi-value');
      var label = ((l && l.textContent) || 'KPI').trim(), valueText = ((v && v.textContent) || '—').trim();
      var id = kpiId(card);
      var lab = $('kpiDetailLabel'), val = $('kpiDetailValue'), trendEl = $('kpiDetailTrend'), emptyEl = $('kpiDetailEmpty'), svg = $('kpiSpark'), ov = $('kpiDetailOverlay');
      if (lab) lab.textContent = label;
      if (val) val.textContent = valueText;
      var points = (loadHistory()[id] || []).slice(-30);
      var ok = svg ? renderSpark(svg, points) : false;
      if (ok) {
        if (emptyEl) emptyEl.style.display = 'none';
        if (svg) svg.style.display = '';
        var first = points[0].v, last = points[points.length - 1].v, delta = last - first;
        var pct = first ? ((delta / first) * 100).toFixed(1) : '—';
        var sign = delta > 0 ? '▲' : (delta < 0 ? '▼' : '·');
        if (trendEl) trendEl.textContent = points.length + '-day trend: ' + sign + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(0) + ' (' + pct + '%)';
      } else {
        if (svg) svg.style.display = 'none';
        if (emptyEl) emptyEl.style.display = '';
        if (trendEl) trendEl.textContent = points.length === 1 ? 'Snapshot captured today. The trend appears after another day.' : 'No history yet.';
      }
      if (ov && ov.classList) ov.classList.add('open');
    };
    window._kpiDetailClose = function () { var ov = $('kpiDetailOverlay'); if (ov && ov.classList) ov.classList.remove('open'); };
    function wire(card) {
      if (card.__kpiWired) return; card.__kpiWired = true;
      on(card, 'click', function () { window._kpiDetailOpen(card); });
    }
    function scan() { document.querySelectorAll('.kpi-card').forEach(wire); }
    scan();
    if (typeof MutationObserver === 'function' && document.body) { var mo = new MutationObserver(scan); mo.observe(document.body, { childList: true, subtree: true }); }
    ready(function () {
      later(captureSnapshot, 5000);
      if (typeof setInterval === 'function') setInterval(captureSnapshot, 60000);
    });
  })();

  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
