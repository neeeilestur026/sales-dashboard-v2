/* financial-reports.js — A297 · the accounting Financial Reports page, loaded last by
 * financial-reports.html.
 *
 * Read-only. Four reads (getInvoices, getExpenses, getARAging, getCollections) land once; every
 * figure on the page is derived from those arrays in memory. The year picker re-renders the
 * year-bound sections, the refresh button re-reads with the cache bypassed, and nothing writes.
 *
 * Sales are INVOICED sales by invoice date (totalSales / totalCOGS, voided rows never arrive).
 * The rolling views (last 30 days, last 12 Monday-to-Sunday weeks, the top-expense day / week /
 * month windows, the open receivables) ignore the picker. Overdue follows flow-ar-aging.js: an
 * open row is one whose status is not Paid; days late are whole days past its due date; a row
 * with no due date is listed on its own and counted as not yet due in the aging tiles.
 *
 * Charts read their colours from the tokens at draw time and are rebuilt on hx:theme, so they
 * follow the theme. Every browser API is feature-checked so the script also runs inside the
 * test harness's bare DOM (no Chart, no canvas, no querySelectorAll). No globals. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var on = function (t, ev, fn) { if (t && typeof t.addEventListener === 'function') t.addEventListener(ev, fn); };
  var esc = hxEsc;
  var num = function (v) { return typeof flowNum === 'function' ? flowNum(v) : (parseFloat(v) || 0); };
  var money = function (v) { return typeof flowMoney === 'function' ? flowMoney(v, 'PHP') : String(v); };
  var ymd = function (d) { return typeof flowDate === 'function' ? flowDate(d) : String(d || ''); };
  var isYmd = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); };
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  var READY = []; var ready = function (fn) { READY.push(fn); };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The guard runs at load like accounting-home.js does; a missing guard (the harness) is a no-op.
  if (typeof requireAccounting === 'function' && !requireAccounting()) return;

  // ── Small helpers ──
  var today = function () { return typeof flowToday === 'function' ? flowToday() : hxToday(); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var fmtLocal = function (dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); };
  var shiftDays = function (s, n) { var dt = new Date(s + 'T00:00:00'); dt.setDate(dt.getDate() + n); return fmtLocal(dt); };
  var dayLabel = function (s) { return MONTHS[parseInt(s.slice(5, 7), 10) - 1] + ' ' + parseInt(s.slice(8, 10), 10); };
  var monthLabel = function (ym) { return MONTHS[parseInt(ym.slice(5, 7), 10) - 1] + ' ' + ym.slice(0, 4); };
  var daysBetween = function (from, to) {
    if (typeof flowDaysBetween === 'function') return flowDaysBetween(from, to);
    return Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000);
  };
  var pct = function (part, whole) { return whole > 0 ? (part / whole * 100).toFixed(1) + '%' : '—'; };
  var signed = function (v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var short = function (v) {
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return s + '₱' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '₱' + (a / 1e3).toFixed(0) + 'k';
    return s + '₱' + a.toFixed(0);
  };
  var sum = function (arr, f) { var t = 0; (arr || []).forEach(function (r) { t += f(r); }); return t; };
  var setText = function (id, v) { var el = $(id); if (el) el.textContent = v; };
  var setTable = function (id, head, rows, foot, empty, cols) {
    var t = $(id); if (!t) return;
    var body = rows.length ? rows.join('') : '<tr><td colspan="' + cols + '" class="hx-empty">' + esc(empty) + '</td></tr>';
    t.innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + (rows.length && foot ? '<tfoot><tr>' + foot + '</tr></tfoot>' : '');
  };
  var th = function (label, n) { return '<th' + (n ? ' class="num"' : '') + '>' + label + '</th>'; };
  var td = function (v, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>'; };
  var tone = function (v) { return v < 0 ? 'num hx-neg' : 'num'; };
  var sign = function (v) { return v > 0 ? 'num hx-pos' : v < 0 ? 'num hx-neg' : 'num'; };

  // ── State ──
  var DATA = null;          // { inv, exp, ar, col, undated }
  var YEAR = today().slice(0, 4);
  var EXP_TAB = 'Daily', TOP_TAB = 'Day';

  // ── Date and the theme toggle live in the rail ──
  if (typeof hxDatePill === 'function') hxDatePill();   // A302: the shared date pill

  // ── Charts: built from tokens at draw time, rebuilt on the theme event ──
  var CHARTS = {};   // id -> { build, chart, dirty }
  function hx(name, fallback) { return hxToken(name, fallback); }
  function visible(el) { return !!el && (typeof el.offsetParent === 'undefined' || el.offsetParent !== null); }
  function paint(id) {
    var c = CHARTS[id], canvas = $(id);
    if (!c || !canvas || typeof canvas.getContext !== 'function' || typeof Chart !== 'function') return;
    if (!visible(canvas)) { c.dirty = true; return; }
    if (c.chart) { try { c.chart.destroy(); } catch (e) {} c.chart = null; }
    var cfg = c.build();
    var host = canvas.parentNode;
    if (host && host.classList) { host.classList.toggle('is-empty', !cfg); if (!cfg && typeof host.setAttribute === 'function') host.setAttribute('data-empty', 'Nothing to chart yet'); }
    if (!cfg) { c.dirty = false; return; }
    if (REDUCED) cfg.options.animation = false;
    c.chart = new Chart(canvas.getContext('2d'), cfg);
    c.dirty = false;
  }
  function chart(id, build) {
    CHARTS[id] = { build: build, chart: (CHARTS[id] && CHARTS[id].chart) || null, dirty: true };
    if (typeof loadLib !== 'function' || typeof CHART_JS_CDN !== 'string') return;   // no api.js (the test harness) → no charts
    loadLib(CHART_JS_CDN).then(function () { paint(id); }).catch(function () {});
  }
  function paintDirty() { Object.keys(CHARTS).forEach(function (id) { if (CHARTS[id].dirty) paint(id); }); }
  on(document, 'hx:theme', function () { Object.keys(CHARTS).forEach(function (id) { CHARTS[id].dirty = true; }); paintDirty(); });

  function baseOptions(moneyAxis) {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: hx('--hx-ink-2', '#465067'), usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 11 } } },
        tooltip: { backgroundColor: hx('--hx-card', '#fff'), titleColor: hx('--hx-ink', '#0F1730'), bodyColor: hx('--hx-ink-2', '#465067'), borderColor: hx('--hx-hair', '#C6CEDA'), borderWidth: 1, cornerRadius: 8, padding: 10,
          callbacks: { label: function (c) { return c.dataset.label + ': ' + money(c.raw); } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: hx('--hx-ink-3', '#8E98AC'), font: { family: 'Inter', size: 10 }, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: hx('--hx-chart-grid', '#DCE2EA') }, ticks: { color: hx('--hx-ink-3', '#8E98AC'), font: { family: 'Inter', size: 10 }, callback: moneyAxis ? function (v) { return short(v); } : undefined } }
      }
    };
  }
  function barChart(labels, series, opts) {
    return {
      type: 'bar',
      data: { labels: labels, datasets: series.map(function (s) { return { label: s.label, data: s.data, backgroundColor: hx(s.token, s.fallback), borderRadius: 4, maxBarThickness: 34 }; }) },
      options: Object.assign(baseOptions(true), opts || {})
    };
  }

  // ── Load: the four reads, normalised once ──
  function normalise(inv, exp, ar, col) {
    var undated = 0;
    var dated = function (rows, f) {
      var out = [];
      (rows || []).forEach(function (r) { var d = ymd(r.date); if (!isYmd(d)) { undated++; return; } out.push(f(r, d)); });
      return out;
    };
    var d = {
      inv: dated(inv, function (r, d) { return { date: d, ym: d.slice(0, 7), y: d.slice(0, 4), invNo: r.invNo || '', soNo: r.soNo || '', customer: r.customer || '', sales: num(r.totalSales), cogs: num(r.totalCOGS) }; }),
      exp: dated(exp, function (r, d) { return { date: d, ym: d.slice(0, 7), y: d.slice(0, 4), category: r.category || r.type || 'Uncategorised', description: r.description || '', client: r.client || '', amount: num(r.amount) }; }),
      col: dated(col, function (r, d) { return { date: d, ym: d.slice(0, 7), y: d.slice(0, 4), amount: num(r.amount) }; }),
      ar: (ar || []).filter(function (r) { return String(r.status || '').toLowerCase() !== 'paid'; }).map(function (r) {
        var due = ymd(r.dueDate);
        return { invNo: r.invNo || r.arNo || '', customer: r.customer || '', amount: num(r.amountPHP), collected: num(r.collectedPHP), outstanding: num(r.outstanding), due: isYmd(due) ? due : '', invDate: ymd(r.createdAt) };
      })
    };
    d.undated = undated;
    return d;
  }

  function load(fresh) {
    var tag = $('frSlabYear');
    var fail = function (msg) { if (tag) { tag.textContent = msg; tag.setAttribute('data-tone', 'bad'); } setText('frExpMeta', msg); setText('frSalesMeta', msg); setText('frCogsMeta', msg); setText('frCollMeta', msg); setText('frArMeta', msg); };
    if (typeof _flowConfigured !== 'function' || !_flowConfigured() || typeof fetchFlow !== 'function') { fail('Flow backend not configured'); return Promise.resolve(); }
    if (tag) { tag.textContent = fresh ? 'Refreshing…' : 'Loading…'; if (typeof tag.removeAttribute === 'function') tag.removeAttribute('data-tone'); }
    var opts = fresh ? { fresh: true } : undefined;
    return Promise.all([
      fetchFlow('getInvoices', {}, opts), fetchFlow('getExpenses', {}, opts), fetchFlow('getARAging', {}, opts), fetchFlow('getCollections', {}, opts)
    ]).then(function (r) {
      var pick = function (x) { return (x && x.success && Array.isArray(x.data)) ? x.data : []; };
      DATA = normalise(pick(r[0]), pick(r[1]), pick(r[2]), pick(r[3]));
      fillYears();
      renderAll();
      if (tag) { tag.textContent = YEAR; tag.setAttribute('data-tone', 'ok'); }
    }).catch(function () { fail('Unavailable'); });
  }

  // ── The year picker ──
  function fillYears() {
    var sel = $('frYear'); if (!DATA) return;
    var set = {};
    DATA.inv.forEach(function (r) { set[r.y] = 1; }); DATA.exp.forEach(function (r) { set[r.y] = 1; }); DATA.col.forEach(function (r) { set[r.y] = 1; });
    var years = Object.keys(set).sort().reverse();
    var cur = today().slice(0, 4);
    if (!years.length) years = [cur];
    YEAR = years.indexOf(YEAR) >= 0 ? YEAR : (years.indexOf(cur) >= 0 ? cur : years[0]);
    if (sel) {
      sel.innerHTML = years.map(function (y) { return '<option value="' + y + '"' + (y === YEAR ? ' selected' : '') + '>' + y + '</option>'; }).join('');
      sel.value = YEAR;
    }
  }
  on($('frYear'), 'change', function (ev) { YEAR = String(ev.target.value || YEAR); renderAll(); setText('frSlabYear', YEAR); });
  on($('frRefresh'), 'click', function () { load(true); });

  // ── Render everything that depends on the data or the year ──
  function renderAll() {
    if (!DATA) return;
    var un = $('frUndated');
    if (un) { un.textContent = DATA.undated ? DATA.undated + ' record' + (DATA.undated === 1 ? '' : 's') + ' without a date left out.' : ''; un.style.display = DATA.undated ? '' : 'none'; }
    renderSlab(); renderExpenses(); renderTop(); renderSales(); renderYearly(); renderCogs(); renderCollections(); renderReceivables();
  }

  function yearInv() { return DATA.inv.filter(function (r) { return r.y === YEAR; }); }
  function yearExp() { return DATA.exp.filter(function (r) { return r.y === YEAR; }); }
  function yearCol() { return DATA.col.filter(function (r) { return r.y === YEAR; }); }
  function byMonth(rows, f) { var m = []; for (var i = 0; i < 12; i++) m.push(0); rows.forEach(function (r) { m[parseInt(r.ym.slice(5, 7), 10) - 1] += f(r); }); return m; }

  // ── The slab ──
  function renderSlab() {
    var inv = yearInv(), sales = sum(inv, function (r) { return r.sales; }), cogs = sum(inv, function (r) { return r.cogs; }), gp = sales - cogs;
    var exp = sum(yearExp(), function (r) { return r.amount; }), net = gp - exp;
    var t = today(), overdue = DATA.ar.filter(function (r) { return r.due && daysBetween(r.due, t) > 0; });
    var v = $('frSlabNet');
    if (v) { v.textContent = inv.length || exp ? money(net) : '—'; if (v.classList) v.classList.toggle('is-neg', net < 0); }
    setText('frSlabSub', inv.length ? 'Gross profit ' + money(gp) + ' on sales of ' + money(sales) + ' (' + pct(gp, sales) + ' margin), less expenses' : 'No invoices in ' + YEAR);
    setText('frSlabSales', money(sales)); setText('frSlabCogs', money(cogs)); setText('frSlabGp', money(gp)); setText('frSlabExp', money(exp));
    setText('frSlabCollected', money(sum(yearCol(), function (r) { return r.amount; })));
    setText('frSlabOverdue', money(sum(overdue, function (r) { return r.outstanding; })));
    setText('frSlabOpenAr', money(sum(DATA.ar, function (r) { return r.outstanding; })));
    setText('frSlabYear', YEAR);
  }

  // ── 1 · Expenses ──
  function renderExpenses() {
    var t = today();
    // Daily: the last 30 calendar days ending today.
    var days = [], dayMap = {};
    for (var i = 29; i >= 0; i--) { var d = shiftDays(t, -i); days.push(d); dayMap[d] = 0; }
    DATA.exp.forEach(function (r) { if (dayMap.hasOwnProperty(r.date)) dayMap[r.date] += r.amount; });
    var daily = days.map(function (d) { return dayMap[d]; });
    setText('frExpDailyTotal', money(sum(daily, function (v) { return v; })));
    chart('frExpDailyChart', function () {
      return barChart(days.map(dayLabel), [{ label: 'Expenses', data: daily, token: '--hx-cyan-ink', fallback: '#0B7FAF' }], { plugins: Object.assign(baseOptions(true).plugins, { legend: { display: false } }) });
    });
    // Weekly: the last 12 Monday-to-Sunday weeks, the current one to date.
    var weeks = [];
    for (var k = 11; k >= 0; k--) {
      var wd = typeof flowWeekDates === 'function' ? flowWeekDates(t, -k) : [];
      if (!wd.length) continue;
      var set = {}; wd.forEach(function (d) { set[d] = 1; });
      weeks.push({ label: dayLabel(wd[0]) + '–' + parseInt(wd[6].slice(8, 10), 10), total: sum(DATA.exp, function (r) { return set[r.date] ? r.amount : 0; }) });
    }
    setText('frExpWeeklyTotal', money(sum(weeks, function (w) { return w.total; })));
    chart('frExpWeeklyChart', function () {
      if (!weeks.length) return null;
      return barChart(weeks.map(function (w) { return w.label; }), [{ label: 'Expenses', data: weeks.map(function (w) { return w.total; }), token: '--hx-cyan-ink', fallback: '#0B7FAF' }], { plugins: Object.assign(baseOptions(true).plugins, { legend: { display: false } }) });
    });
    // Monthly: the picked year.
    var monthly = byMonth(yearExp(), function (r) { return r.amount; });
    setText('frExpMonthlyTotal', money(sum(monthly, function (v) { return v; })));
    chart('frExpMonthlyChart', function () {
      return barChart(MONTHS, [{ label: 'Expenses ' + YEAR, data: monthly, token: '--hx-cyan-ink', fallback: '#0B7FAF' }], { plugins: Object.assign(baseOptions(true).plugins, { legend: { display: false } }) });
    });
    var n = DATA.exp.length;
    setText('frExpMeta', n ? n + ' expense record' + (n === 1 ? '' : 's') + ', ' + money(sum(monthly, function (v) { return v; })) + ' in ' + YEAR : 'No expense records');
  }

  // ── Top expenses: the window's ten largest records and its five largest categories ──
  function renderTop() {
    var t = today(), rows, title;
    if (TOP_TAB === 'Day') { rows = DATA.exp.filter(function (r) { return r.date === t; }); title = 'today'; }
    else if (TOP_TAB === 'Week') { var wd = typeof flowWeekDates === 'function' ? flowWeekDates(t, 0) : [t]; var set = {}; wd.forEach(function (d) { set[d] = 1; }); rows = DATA.exp.filter(function (r) { return !!set[r.date]; }); title = 'this week'; }
    else if (TOP_TAB === 'Month') { var ym = t.slice(0, 7); rows = DATA.exp.filter(function (r) { return r.ym === ym; }); title = 'this month'; }
    else { rows = yearExp(); title = 'in ' + YEAR; }
    var total = sum(rows, function (r) { return r.amount; });
    var top = rows.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 10);
    var topTotal = sum(top, function (r) { return r.amount; });
    setTable('frTopTable',
      th('Date') + th('Category') + th('Description') + th('Amount', 1),
      top.map(function (r) { return '<tr>' + td(esc(dayLabel(r.date)), 'nowrap dim') + td(esc(r.category)) + td(esc(r.description || r.client || '—'), 'desc') + td(money(r.amount), 'num') + '</tr>'; }),
      '<td colspan="3" class="dim">Top ' + top.length + ' of ' + rows.length + ', ' + pct(topTotal, total) + ' of ' + money(total) + '</td>' + td(money(topTotal), 'num'),
      'No expenses ' + title + '.', 4);
    var cats = {};
    rows.forEach(function (r) { cats[r.category] = (cats[r.category] || 0) + r.amount; });
    var host = $('frTopCats');
    if (host) host.innerHTML = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 5)
      .map(function (c) { return '<span class="hx-chip">' + esc(c) + ' <span class="n">' + esc(short(cats[c])) + '</span></span>'; }).join('');
  }

  // ── 2 · Sales by month against the year before ──
  function renderSales() {
    var prev = String(parseInt(YEAR, 10) - 1);
    var cur = yearInv(), last = DATA.inv.filter(function (r) { return r.y === prev; });
    var s = byMonth(cur, function (r) { return r.sales; }), c = byMonth(cur, function (r) { return r.cogs; }), l = byMonth(last, function (r) { return r.sales; });
    var lastMonth = -1; s.forEach(function (v, i) { if (v) lastMonth = i; });
    var nowYm = today().slice(0, 7);
    var rows = MONTHS.map(function (m, i) {
      var future = YEAR + '-' + pad(i + 1) > nowYm;   // a month that has not happened yet compares to nothing
      var gp = s[i] - c[i], chg = !future && l[i] > 0 ? (s[i] - l[i]) / l[i] * 100 : null;
      return '<tr>' + td(m + ' ' + YEAR, 'nowrap') + td(money(s[i]), 'num') + td(money(c[i]), 'num') + td(money(gp), tone(gp)) + td(pct(gp, s[i]), 'num') + td(money(l[i]), 'num dim') + td(chg === null ? '—' : signed(chg), chg === null ? 'num dim' : sign(chg)) + '</tr>';
    });
    var S = sum(s, function (v) { return v; }), C = sum(c, function (v) { return v; }), L = sum(l, function (v) { return v; });
    var ytdL = 0; for (var i = 0; i <= lastMonth; i++) ytdL += l[i];
    var ytdChg = ytdL > 0 ? (S - ytdL) / ytdL * 100 : null;
    setTable('frSalesTable',
      th('Month') + th('Sales', 1) + th('Cost of goods', 1) + th('Gross profit', 1) + th('Margin', 1) + th(prev + ' same month', 1) + th('Change', 1),
      cur.length || last.length ? rows : [],
      td(YEAR) + td(money(S), 'num') + td(money(C), 'num') + td(money(S - C), 'num') + td(pct(S - C, S), 'num') + td(money(L), 'num dim') + td(ytdChg === null ? '—' : signed(ytdChg) + (lastMonth >= 0 && lastMonth < 11 ? ' to ' + MONTHS[lastMonth] : ''), ytdChg === null ? 'num dim' : sign(ytdChg)),
      'No invoices in ' + YEAR + ' or ' + prev + '.', 7);
    setText('frSalesMeta', cur.length ? cur.length + ' invoice' + (cur.length === 1 ? '' : 's') + ' in ' + YEAR + ', ' + money(S) + (ytdChg === null ? '' : ', ' + signed(ytdChg) + ' against the same months of ' + prev) : 'No invoices in ' + YEAR);
    chart('frSalesChart', function () {
      if (!cur.length && !last.length) return null;
      return barChart(MONTHS, [
        { label: YEAR, data: s, token: '--hx-navy', fallback: '#2E3192' },
        { label: prev, data: l, token: '--hx-navy-line', fallback: '#B9BCE3' }
      ]);
    });
  }

  // ── Every year ──
  function renderYearly() {
    var set = {};
    DATA.inv.forEach(function (r) { set[r.y] = 1; }); DATA.exp.forEach(function (r) { set[r.y] = 1; });
    var years = Object.keys(set).sort().reverse();
    var rows = years.map(function (y) {
      var inv = DATA.inv.filter(function (r) { return r.y === y; });
      var S = sum(inv, function (r) { return r.sales; }), C = sum(inv, function (r) { return r.cogs; }), E = sum(DATA.exp, function (r) { return r.y === y ? r.amount : 0; });
      return '<tr>' + td(y) + td(String(inv.length), 'num') + td(money(S), 'num') + td(money(C), 'num') + td(money(S - C), tone(S - C)) + td(pct(S - C, S), 'num') + td(money(E), 'num') + td(money(S - C - E), tone(S - C - E)) + '</tr>';
    });
    setTable('frYearlyTable', th('Year') + th('Invoices', 1) + th('Sales', 1) + th('Cost of goods', 1) + th('Gross profit', 1) + th('Margin', 1) + th('Expenses', 1) + th('Net', 1), rows, null, 'No records yet.', 8);
  }

  // ── 3 · Cost of goods per sale ──
  function renderCogs() {
    var inv = yearInv().slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var S = sum(inv, function (r) { return r.sales; }), C = sum(inv, function (r) { return r.cogs; });
    setTable('frCogsTable',
      th('Date') + th('Invoice') + th('Customer') + th('Sales', 1) + th('Cost of goods', 1) + th('Gross profit', 1) + th('Margin', 1),
      inv.map(function (r) { var gp = r.sales - r.cogs; return '<tr>' + td(esc(r.date), 'nowrap dim') + td(esc(r.invNo) + (r.soNo ? ' <span class="dim">' + esc(r.soNo) + '</span>' : ''), 'nowrap') + td(esc(r.customer), 'desc') + td(money(r.sales), 'num') + td(money(r.cogs), 'num') + td(money(gp), tone(gp)) + td(pct(gp, r.sales), tone(gp)) + '</tr>'; }),
      td(inv.length + ' invoices', 'dim') + td('') + td('') + td(money(S), 'num') + td(money(C), 'num') + td(money(S - C), 'num') + td(pct(S - C, S), 'num'),
      'No invoices in ' + YEAR + '.', 7);
    setText('frCogsMeta', inv.length ? inv.length + ' invoice' + (inv.length === 1 ? '' : 's') + ' in ' + YEAR + ', ' + pct(S - C, S) + ' blended margin' : 'No invoices in ' + YEAR);
    chart('frCogsChart', function () {
      if (!inv.length || S <= 0) return null;
      return {
        type: 'doughnut',
        data: { labels: ['Cost of goods', 'Gross profit'], datasets: [{ data: [C, Math.max(S - C, 0)], backgroundColor: [hx('--hx-navy', '#2E3192'), hx('--hx-cyan', '#00AEEF')], borderColor: hx('--hx-card', '#fff'), borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: Object.assign(baseOptions().plugins.legend, { position: 'right' }), tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: { label: function (c) { return c.label + ': ' + money(c.raw) + ' (' + pct(c.raw, S) + ')'; } } }) } }
      };
    });
  }

  // ── 4 · Sales against collected ──
  function renderCollections() {
    var s = byMonth(yearInv(), function (r) { return r.sales; }), c = byMonth(yearCol(), function (r) { return r.amount; });
    var S = sum(s, function (v) { return v; }), C = sum(c, function (v) { return v; });
    var any = S > 0 || C > 0;
    setTable('frCollTable',
      th('Month') + th('Invoiced', 1) + th('Collected', 1) + th('Collection rate', 1) + th('Difference', 1),
      any ? MONTHS.map(function (m, i) { var d = s[i] - c[i]; return '<tr>' + td(m + ' ' + YEAR, 'nowrap') + td(money(s[i]), 'num') + td(money(c[i]), 'num') + td(pct(c[i], s[i]), 'num') + td(money(d), d < 0 ? 'num hx-pos' : 'num') + '</tr>'; }) : [],
      td(YEAR) + td(money(S), 'num') + td(money(C), 'num') + td(pct(C, S), 'num') + td(money(S - C), 'num'),
      'No invoices or collections in ' + YEAR + '.', 5);
    setText('frCollMeta', any ? money(C) + ' collected against ' + money(S) + ' invoiced in ' + YEAR + ', ' + pct(C, S) : 'No invoices or collections in ' + YEAR);
    chart('frCollChart', function () {
      if (!any) return null;
      var cfg = barChart(MONTHS, [{ label: 'Invoiced', data: s, token: '--hx-navy-line', fallback: '#B9BCE3' }]);
      cfg.data.datasets.push({ label: 'Collected', data: c, type: 'line', borderColor: hx('--hx-cyan', '#00AEEF'), backgroundColor: hx('--hx-cyan-soft', '#E0F5FD'), pointBackgroundColor: hx('--hx-cyan', '#00AEEF'), tension: 0.3, fill: false, borderWidth: 2 });
      return cfg;
    });
  }

  // ── 5 · Receivables due and overdue ──
  function renderReceivables() {
    var t = today(), b = { cur: 0, b30: 0, b60: 0, b60p: 0 }, due = [], late = [], none = [];
    DATA.ar.forEach(function (r) {
      var days = r.due ? daysBetween(r.due, t) : 0;   // positive = past due
      if (days <= 0) b.cur += r.outstanding; else if (days <= 30) b.b30 += r.outstanding; else if (days <= 60) b.b60 += r.outstanding; else b.b60p += r.outstanding;
      if (!r.due) none.push(r);
      else if (days > 0) late.push(Object.assign({ days: days }, r));
      else if (-days <= 30) due.push(Object.assign({ inDays: -days }, r));
    });
    setText('frAgeCur', money(b.cur)); setText('frAge30', money(b.b30)); setText('frAge60', money(b.b60)); setText('frAge60p', money(b.b60p));
    var out = sum(DATA.ar, function (r) { return r.outstanding; });
    setText('frArMeta', DATA.ar.length ? DATA.ar.length + ' open invoice' + (DATA.ar.length === 1 ? '' : 's') + ', ' + money(out) + ' outstanding' : 'No open invoices');

    due.sort(function (a, b) { return a.inDays - b.inDays; });
    setTable('frDueTable',
      th('Due') + th('In', 1) + th('Invoice') + th('Customer') + th('Outstanding', 1),
      due.map(function (r) { return '<tr>' + td(esc(r.due) + (r.inDays <= 7 ? ' <span class="badge badge-warning">Due soon</span>' : ''), 'nowrap') + td(r.inDays === 0 ? 'today' : r.inDays + ' d', 'num') + td(esc(r.invNo), 'nowrap') + td(esc(r.customer), 'desc') + td(money(r.outstanding), 'num') + '</tr>'; }),
      td(due.length + ' due', 'dim') + td('') + td('') + td('') + td(money(sum(due, function (r) { return r.outstanding; })), 'num'),
      'Nothing falls due in the next 30 days.', 5);
    setText('frDueMeta', due.length ? money(sum(due, function (r) { return r.outstanding; })) : '');

    late.sort(function (a, b) { return b.days - a.days; });
    setTable('frOverdueTable',
      th('Due') + th('Days late', 1) + th('Invoice') + th('Customer') + th('Outstanding', 1),
      late.map(function (r) { return '<tr>' + td(esc(r.due), 'nowrap dim') + td('<span class="badge ' + (r.days <= 30 ? 'badge-warning' : 'badge-danger') + '">' + r.days + '</span>', 'num') + td(esc(r.invNo), 'nowrap') + td(esc(r.customer), 'desc') + td(money(r.outstanding), 'num hx-neg') + '</tr>'; }),
      td(late.length + ' overdue', 'dim') + td('') + td('') + td('') + td(money(sum(late, function (r) { return r.outstanding; })), 'num'),
      'Nothing is past due.', 5);
    setText('frOverdueMeta', late.length ? money(sum(late, function (r) { return r.outstanding; })) : '');

    var wrap = $('frNoDueWrap');
    if (wrap) wrap.style.display = none.length ? '' : 'none';
    setTable('frNoDueTable',
      th('Invoice') + th('Customer') + th('Invoiced') + th('Outstanding', 1),
      none.map(function (r) { return '<tr>' + td(esc(r.invNo), 'nowrap') + td(esc(r.customer), 'desc') + td(esc(r.invDate || '—'), 'nowrap dim') + td(money(r.outstanding), 'num') + '</tr>'; }),
      null, '', 4);
  }

  // ── The tabs ──
  function bindTabs(prefix, names, panels, onPick) {
    names.forEach(function (n) {
      on($(prefix + n), 'click', function () {
        names.forEach(function (m) {
          var b = $(prefix + m); if (b) { if (b.classList) b.classList.toggle('active', m === n); b.setAttribute('aria-selected', m === n ? 'true' : 'false'); }
          if (panels) { var p = $(panels + m); if (p && p.classList) p.classList.toggle('active', m === n); }
        });
        onPick(n);
      });
    });
  }
  bindTabs('frExpTab', ['Daily', 'Weekly', 'Monthly'], 'frExp', function (n) { EXP_TAB = n; paintDirty(); });
  bindTabs('frTopTab', ['Day', 'Week', 'Month', 'Year'], null, function (n) { TOP_TAB = n; if (DATA) renderTop(); });

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
    ['expenses', 'sales', 'cogs', 'collections', 'receivables'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  ready(function () { if (typeof renderNavbar === 'function') renderNavbar('financial-reports'); });
  ready(function () { load(false); });
  on(document, 'DOMContentLoaded', function () { READY.forEach(function (f) { f(); }); });
})();
