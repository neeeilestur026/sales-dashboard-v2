/* director-pulse.js — A288 · the Pulse band on the director's home.
 *
 * Four pictures from data the page already has or can ask for cheaply:
 *   - payroll cost per cutoff, from the payroll-approvals ledger (apiGetPayrollApprovals): the
 *     submitted totals of the last ten cutoffs, drawn with Chart.js when it loads and as a CSS bar
 *     list when it does not (offline, CSP, an old browser);
 *   - the 13th-month accrual as a ring (months elapsed of twelve, and the pesos accrued so far);
 *   - the headcount as a dot row (active / inactive, fixed pay marked);
 *   - salary deductions as one collected-versus-remaining bar across the active agreements.
 * It also sizes a hairline bar under each rep in the two shared team panels, from the numbers they
 * already print, without touching those scripts.
 *
 * The transforms are pure and exposed on window.dhPulse.t for tests. Colours are read from the
 * page's custom properties at draw time (never literals here), so the dark theme re-themes the
 * chart on the dh:theme event. _updateKpis (director-home.js) stays the only writer of the rail's
 * numbers; this module listens to dh:kpis and never writes those ids. Every browser API is
 * feature-checked so mount() also runs in the test harness's bare DOM. */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js';

  /* ── transforms ──────────────────────────────────────────────────────────────────────────── */
  var T = {};
  T.parsePeriod = function (period) {
    var m = /^(\d{4})-(\d{2})-([AB])$/.exec(String(period || '').trim());
    return m ? { year: Number(m[1]), month: Number(m[2]), half: m[3] } : null;
  };
  T.cutoffKey = function (period) {
    var p = T.parsePeriod(period);
    return p ? p.year * 100 + p.month + (p.half === 'B' ? 0.5 : 0) : NaN;
  };
  T.cutoffLabel = function (period) {
    var p = T.parsePeriod(period);
    return p ? (MONTHS[p.month - 1] || '') + ' ' + (p.half === 'A' ? '1st' : '2nd') : String(period || '');
  };
  var rank = function (status) { status = String(status || ''); return status === 'Approved' ? 2 : status === 'For Approval' ? 1 : 0; };
  T.latestPerPeriod = function (rows) {
    var best = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.period) return;
      var cur = best[r.period];
      if (!cur || rank(r.status) > rank(cur.status) ||
          (rank(r.status) === rank(cur.status) && String(r.submittedAt || '') > String(cur.submittedAt || ''))) best[r.period] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; });
  };
  T.lastN = function (rows, n) {
    n = n || 10;
    return (rows || []).filter(function (r) { return r && !isNaN(T.cutoffKey(r.period)); })
      .sort(function (a, b) { return T.cutoffKey(a.period) - T.cutoffKey(b.period); })
      .slice(-n);
  };
  var num = function (v) { var n = Number(v); return isNaN(n) ? 0 : n; };
  T.costSeries = function (rows, currentPeriod) {
    var out = { labels: [], values: [], detail: [], currentIndex: -1 };
    (rows || []).forEach(function (r, i) {
      var t = r.totals || {};
      var gross = num(t.grossPay), share = num(t.employerShare), ded = num(t.totalDeductions);
      var net = t.netPay != null ? num(t.netPay) : gross - ded;
      var total = t.totalPayrollCost != null && num(t.totalPayrollCost) > 0 ? num(t.totalPayrollCost) : gross + share;
      out.labels.push(T.cutoffLabel(r.period));
      out.values.push(total);
      out.detail.push({ period: r.period, label: T.cutoffLabel(r.period), gross: gross, ded: ded, net: net, share: share, status: String(r.status || ''), live: false });
      if (r.period === currentPeriod) out.currentIndex = i;
    });
    return out;
  };
  T.liveFallbackSeries = function (cutoffs) {
    var out = { labels: [], values: [], detail: [], currentIndex: -1 };
    (cutoffs || []).forEach(function (c) {
      var gross = num(c.gross), ded = num(c.ded), share = num(c.share);
      out.labels.push(T.cutoffLabel(c.period));
      out.values.push(gross + share);
      out.detail.push({ period: c.period, label: T.cutoffLabel(c.period), gross: gross, ded: ded, net: gross - ded, share: share, status: 'On screen', live: true });
    });
    out.currentIndex = out.values.length - 1;
    return out;
  };
  T.accrual = function (year, rows13, today) {
    today = today || new Date();
    year = Number(year) || today.getFullYear();
    var y = today.getFullYear();
    var monthsElapsed = year < y ? 12 : year > y ? 0 : today.getMonth() + 1;
    var total = (rows13 || []).reduce(function (s, r) { return s + num(r && r.thirteenthMonth); }, 0);
    return { year: year, monthsElapsed: monthsElapsed, pct: monthsElapsed / 12, total: total, count: (rows13 || []).length };
  };
  T.headcount = function (employees) {
    var h = { active: 0, inactive: 0, hourly: 0, fixed: 0, total: 0, list: [] };
    (employees || []).forEach(function (e) {
      if (!e) return;
      var active = String(e.status || '') === 'Active';
      var fixed = String(e.payType || '') === 'Fixed';
      h.total++;
      if (active) h.active++; else h.inactive++;
      if (fixed) h.fixed++; else h.hourly++;
      h.list.push({ active: active, fixed: fixed });
    });
    return h;
  };
  T.deductions = function (rows) {
    var d = { paid: 0, remaining: 0, total: 0, count: 0, pct: 0 };
    (rows || []).forEach(function (r) {
      if (!r || String(r.status || '') !== 'Active') return;
      var total = num(r.totalAmount), paid = num(r.paid);
      var remaining = r.remaining != null ? num(r.remaining) : Math.max(0, total - paid);
      d.count++; d.total += total; d.paid += paid; d.remaining += remaining;
    });
    d.pct = d.total > 0 ? Math.max(0, Math.min(1, d.paid / d.total)) : 0;
    return d;
  };
  T.teamBars = function (values) {
    var max = 0;
    (values || []).forEach(function (v) { if (num(v) > max) max = num(v); });
    return (values || []).map(function (v) { return max > 0 ? Math.max(0, Math.min(1, num(v) / max)) : 0; });
  };
  T.money = function (n) { return '₱' + num(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  T.esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  /* ── state and DOM ───────────────────────────────────────────────────────────────────────── */
  var S = { chart: null, series: null, approvals: null, rows13: null, deds: null, reduced: false, mounted: false };
  var $ = function (id) { return (typeof document !== 'undefined' && document.getElementById) ? document.getElementById(id) : null; };
  var setVar = function (el, name, v) { if (el && el.style && typeof el.style.setProperty === 'function') el.style.setProperty(name, String(v)); };
  var on = function (target, ev, fn) { if (target && typeof target.addEventListener === 'function') target.addEventListener(ev, fn); };
  /* director-home.js declares its state with top-level let, which is NOT a window property; a bare
     identifier inside try/catch reads it (ReferenceError when the script is absent). */
  var G = function (fn) { try { return fn(); } catch (e) { return undefined; } };

  function tokens() {
    var read = function (n, fallback) {
      try {
        if (typeof getComputedStyle !== 'function' || !document.body) return fallback;
        var v = getComputedStyle(document.body).getPropertyValue(n);
        return (v && v.trim()) || fallback;
      } catch (e) { return fallback; }
    };
    return {
      navy: read('--dh-navy', 'rgb(46,49,146)'), cyan: read('--dh-cyan', 'rgb(0,174,239)'),
      ink: read('--dh-ink', 'rgb(15,23,48)'), ink2: read('--dh-ink-2', 'rgb(70,80,103)'), ink3: read('--dh-ink-3', 'rgb(142,152,172)'),
      hair: read('--dh-hair', 'rgb(198,206,218)'), grid: read('--dh-chart-grid', 'rgba(27,36,97,.1)'),
      tipBg: read('--dh-glass-solid', 'rgb(255,255,255)'), text: read('--dh-text', 'Inter, system-ui, sans-serif')
    };
  }

  function chartConfig(series, k) {
    var colors = series.values.map(function (_, i) { return i === series.currentIndex ? k.cyan : k.navy; });
    return {
      type: 'bar',
      data: { labels: series.labels, datasets: [{ data: series.values, backgroundColor: colors, hoverBackgroundColor: colors, borderRadius: 6, borderSkipped: false, maxBarThickness: 34, categoryPercentage: .7 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: S.reduced ? false : { duration: 900, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: k.tipBg, titleColor: k.ink, bodyColor: k.ink2, borderColor: k.hair, borderWidth: 1, padding: 10, displayColors: false,
            callbacks: {
              title: function (items) { var d = series.detail[items[0].dataIndex]; return d.label + (d.status ? ' (' + d.status + ')' : ''); },
              label: function (item) {
                var d = series.detail[item.dataIndex];
                return ['Total ' + T.money(item.raw), 'Gross ' + T.money(d.gross), 'Deductions ' + T.money(d.ded), 'Net ' + T.money(d.net), 'Employer share ' + T.money(d.share)];
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: k.ink3, font: { family: k.text, size: 10.5 } } },
          y: { beginAtZero: true, grid: { color: k.grid }, border: { display: false },
               ticks: { color: k.ink3, font: { family: k.text, size: 10.5 }, maxTicksLimit: 5, callback: function (v) { return '₱' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } } }
        }
      }
    };
  }

  function drawCostFallback(series) {
    var fb = $('pulseCostFallback'), host = $('pulseCost') && $('pulseCost').parentNode;
    if (!fb) return;
    if (host) host.hidden = true;
    fb.hidden = false;
    if (!series || !series.values.length) { fb.innerHTML = '<div class="dh-empty">The trend fills as cutoffs are submitted for approval.</div>'; return; }
    var max = 0; series.values.forEach(function (v) { if (v > max) max = v; });
    fb.innerHTML = series.values.map(function (v, i) {
      return '<div class="dh-barrow"><span>' + T.esc(series.labels[i]) + '</span><i class="' + (i === series.currentIndex ? 'cur' : '') + '" data-w="' + (max > 0 ? v / max : 0) + '"></i><b>' + T.money(v) + '</b></div>';
    }).join('');
    if (typeof fb.querySelectorAll === 'function') fb.querySelectorAll('i[data-w]').forEach(function (i) { setVar(i, '--dh-w', i.getAttribute('data-w')); });
  }

  function drawCost(series) {
    S.series = series;
    var canvas = $('pulseCost');
    var lib = G(function () { return loadLib; });
    if (!series || !series.values.length || !canvas || typeof canvas.getContext !== 'function' || typeof lib !== 'function') { drawCostFallback(series); return; }
    lib(CHART_URL).then(function () {
      var ChartCtor = G(function () { return Chart; });
      if (typeof ChartCtor !== 'function') throw new Error('no Chart');
      if (S.chart && typeof S.chart.destroy === 'function') S.chart.destroy();
      S.chart = new ChartCtor(canvas.getContext('2d'), chartConfig(series, tokens()));
      var fb = $('pulseCostFallback'); if (fb) fb.hidden = true;
      if (canvas.parentNode) canvas.parentNode.hidden = false;
    }).catch(function () { S.chart = null; drawCostFallback(series); });
  }

  function drawRing(a) {
    var el = $('pulseAccrual'); if (!el) return;
    el.innerHTML = '<div class="l">13th month</div>' +
      '<div class="dh-ring-wrap"><div class="dh-ring-face"><b>' + a.monthsElapsed + '</b><small>of 12 months</small></div></div>' +
      '<div class="dh-ring-cap"><span class="v">' + T.money(a.total) + '</span><span>accrued for ' + a.count + ' employee' + (a.count === 1 ? '' : 's') + ' in ' + a.year + '</span></div>';
    var wrap = typeof el.querySelector === 'function' ? el.querySelector('.dh-ring-wrap') : null;
    var arm = function () { setVar(wrap, '--dh-p', a.pct); };
    if (typeof requestAnimationFrame === 'function' && !S.reduced) requestAnimationFrame(function () { requestAnimationFrame(arm); }); else arm();
  }

  function drawHeads(h) {
    var el = $('pulseHeads'); if (!el) return;
    if (!h.total) { el.innerHTML = '<div class="l">Headcount</div><div class="dh-empty">No employees on the master list yet.</div>'; return; }
    var dots = h.list.slice(0, 60).map(function (e) { return '<i class="' + (e.active ? (e.fixed ? 'fixed' : 'on') : 'off') + '"></i>'; }).join('');
    el.innerHTML = '<div class="l">Headcount</div><div class="dh-dots-row">' + dots + '</div>' +
      '<div class="dh-dots-cap"><span><b>' + h.active + '</b> active</span><span><b>' + h.inactive + '</b> inactive</span><span><b>' + h.fixed + '</b> fixed pay</span></div>';
  }

  function drawDed(d) {
    var el = $('pulseDed'); if (!el) return;
    if (!d.count) { el.innerHTML = '<div class="l">Salary deductions</div><div class="dh-empty">No active deduction agreements.</div>'; return; }
    el.innerHTML = '<div class="l">Salary deductions being collected</div><div class="dh-ded-bar"><i></i></div>' +
      '<div class="dh-ded-cap"><span><b>' + T.money(d.paid) + '</b> collected</span><span><b>' + T.money(d.remaining) + '</b> remaining</span><span>' + d.count + ' active agreement' + (d.count === 1 ? '' : 's') + '</span></div>';
    var bar = typeof el.querySelector === 'function' ? el.querySelector('.dh-ded-bar > i') : null;
    setVar(bar, '--dh-w', d.pct);
  }

  var parseMoney = function (s) { return parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0; };
  function teamBarsFromPanel(panelId, rowSel, valSel) {
    var panel = $(panelId); if (!panel || typeof panel.querySelectorAll !== 'function') return;
    var rows = Array.prototype.slice.call(panel.querySelectorAll(rowSel));
    var vals = rows.map(function (r) { var v = r.querySelector(valSel); return v ? parseMoney(v.textContent) : 0; });
    T.teamBars(vals).forEach(function (pct, i) { setVar(rows[i], '--dh-w', pct); });
  }
  function watchTeam() {
    if (typeof MutationObserver !== 'function') return;
    var pending = null;
    var run = function () { pending = null; teamBarsFromPanel('qtwPanel', '.qtw-rep', '.qtw-rephead .val'); teamBarsFromPanel('iwpPanel', '.iwp-row', '.n'); };
    var mo = new MutationObserver(function () { if (pending) clearTimeout(pending); pending = setTimeout(run, 60); });
    ['qtwPanel', 'iwpPanel'].forEach(function (id) { var el = $(id); if (el) mo.observe(el, { childList: true, subtree: true }); });
  }

  function currentPeriod() {
    var y = G(function () { return _currentYear; }), m = G(function () { return _currentMonth; }), c = G(function () { return _kpiCutoff; }) || 'B';
    return (y && m) ? y + '-' + m + '-' + c : '';
  }
  function liveCutoffs() {
    var y = G(function () { return _currentYear; }), m = G(function () { return _currentMonth; }), emps = G(function () { return _employees; });
    var earn = G(function () { return _payEarnings; }), dedF = G(function () { return _payDeductions; });
    if (!y || !m || !Array.isArray(emps) || !emps.length || typeof earn !== 'function' || typeof dedF !== 'function') return null;
    return ['A', 'B'].map(function (c) {
      var gross = 0, ded = 0;
      emps.forEach(function (e) { try { gross += num(earn(e, c).grossPay); ded += num(dedF(e, c).totalDed); } catch (err) {} });
      var shareEl = $('employerShare' + c);
      return { period: y + '-' + m + '-' + c, gross: gross, ded: ded, share: shareEl ? parseFloat(shareEl.value) || 0 : 0 };
    });
  }

  function onKpis(ev) {
    var d = (ev && ev.detail) || {};
    var emps = G(function () { return _employees; }); if (Array.isArray(emps)) drawHeads(T.headcount(emps));
    if (S.chart && S.series && S.series.detail.length && S.series.detail[S.series.detail.length - 1].live && d.cutoff) {
      var i = -1; S.series.detail.forEach(function (x, j) { if (x.period === (currentPeriod())) i = j; });
      if (i >= 0) { S.series.values[i] = num(d.gross) + num(d.share); S.chart.data.datasets[0].data[i] = S.series.values[i]; if (typeof S.chart.update === 'function') S.chart.update(); }
    }
  }
  function onTheme() {
    if (!S.chart || !S.series) return;
    var k = tokens();
    var colors = S.series.values.map(function (_, i) { return i === S.series.currentIndex ? k.cyan : k.navy; });
    try {
      S.chart.data.datasets[0].backgroundColor = colors; S.chart.data.datasets[0].hoverBackgroundColor = colors;
      var o = S.chart.options;
      o.scales.x.ticks.color = k.ink3; o.scales.y.ticks.color = k.ink3; o.scales.y.grid.color = k.grid;
      o.plugins.tooltip.backgroundColor = k.tipBg; o.plugins.tooltip.titleColor = k.ink; o.plugins.tooltip.bodyColor = k.ink2; o.plugins.tooltip.borderColor = k.hair;
      if (typeof S.chart.update === 'function') S.chart.update('none');
    } catch (e) {}
  }

  function loadCost() {
    var api = G(function () { return apiGetPayrollApprovals; });
    var meta = $('pulseMeta');
    var showLive = function (note) {
      var live = liveCutoffs();
      if (live) { drawCost(T.liveFallbackSeries(live)); if (meta && note) meta.textContent = note; }
      else drawCostFallback({ labels: [], values: [], detail: [], currentIndex: -1 });
    };
    if (typeof api !== 'function') { showLive('Showing the loaded period.'); return Promise.resolve(); }
    return Promise.resolve().then(function () { return api(); }).then(function (r) {
      var rows = (r && r.data) || [];
      S.approvals = T.latestPerPeriod(rows);
      if (!S.approvals.length) { showLive('No submitted cutoffs yet; showing the loaded period.'); return; }
      drawCost(T.costSeries(T.lastN(S.approvals, 10), currentPeriod()));
    }).catch(function () { showLive('The approvals ledger did not load; showing the loaded period.'); });
  }
  function loadRing() {
    var fetchApi = G(function () { return fetchFromAPI; });
    var year = new Date().getFullYear();
    if (typeof fetchApi !== 'function') { drawRing(T.accrual(year, [], new Date())); return Promise.resolve(); }
    return Promise.resolve().then(function () { return fetchApi({ action: 'get13thMonthPay', year: year }, { noCache: true }); }).then(function (r) {
      S.rows13 = (r && r.data) || [];
      drawRing(T.accrual(year, S.rows13, new Date()));
      // fill #kpi13 on load instead of waiting for the tab; the tab's own load overwrites it exactly as before
      var td = G(function () { return _thirteenthData; });
      if (Array.isArray(td) && !td.length && S.rows13.length) {
        try { _thirteenthData = S.rows13; } catch (e) {}
        try { _thirteenthYear = year; } catch (e) {}
        try { if (typeof _updateKpis === 'function') _updateKpis(); } catch (e) {}
      }
    }).catch(function () { drawRing(T.accrual(year, [], new Date())); });
  }
  function loadDed() {
    var api = G(function () { return apiGetSalaryDeductions; });
    if (typeof api !== 'function') { drawDed(T.deductions([])); return Promise.resolve(); }
    return Promise.resolve().then(function () { return api(''); }).then(function (r) { S.deds = (r && r.data) || []; drawDed(T.deductions(S.deds)); })
      .catch(function () { drawDed(T.deductions([])); });
  }

  function mount() {
    if (S.mounted || !$('pulse')) return;
    S.mounted = true;
    try { S.reduced = !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    on(document, 'dh:kpis', onKpis);
    on(document, 'dh:theme', onTheme);
    watchTeam();
    var emps = G(function () { return _employees; }); drawHeads(T.headcount(Array.isArray(emps) ? emps : []));
    // after the payroll's own eight calls have gone out
    setTimeout(function () { loadCost(); loadRing(); loadDed(); }, 900);
  }

  window.dhPulse = { t: T, mount: mount, redraw: onKpis, retheme: onTheme, state: S };
  on(document, 'DOMContentLoaded', mount);
})();
