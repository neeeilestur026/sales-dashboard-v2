/* A288 — the Pulse band's transforms and its mount, under a Chart.js stub.
 *
 * Run:  node tests/flow/director-pulse.js
 *
 * The transforms are pure (window.dhPulse.t). mount() is exercised three ways: with a Chart stub
 * (config shape, the current bar in cyan, animation off under reduced motion, a re-theme that
 * re-reads the tokens), with no Chart at all (the CSS bar list), and with an empty ledger and no
 * on-screen period (the empty copy). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/director-pulse.js'), 'utf8');

const TOKENS = { '--dh-navy': 'rgb(46,49,146)', '--dh-cyan': 'rgb(0,174,239)', '--dh-ink': 'rgb(15,23,48)', '--dh-ink-2': 'rgb(70,80,103)', '--dh-ink-3': 'rgb(142,152,172)', '--dh-hair': 'rgb(198,206,218)', '--dh-chart-grid': 'rgba(27,36,97,.1)', '--dh-glass-solid': 'rgb(255,255,255)', '--dh-text': 'Inter' };

function boot(opts) {
  opts = opts || {};
  const els = {}, listeners = {};
  const el = (id) => (els[id] = els[id] || {
    id, innerHTML: '', textContent: '', value: '', hidden: false, vars: {},
    style: { setProperty(n, v) { this._v = this._v || {}; this._v[n] = v; } },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => ({ style: { setProperty(n, v) { els[id].vars[n] = v; } } }), querySelectorAll: () => [], addEventListener() {}, getAttribute: () => null, setAttribute() {},
    getContext: id === 'pulseCost' && !opts.noCanvas ? () => ({}) : undefined,
    parentNode: id === 'pulseCost' ? { hidden: false } : undefined,
  });
  const charts = [];
  function ChartStub(ctx, config) { this.config = config; this.data = config.data; this.options = config.options; this.updates = []; charts.push(this); }
  ChartStub.prototype.update = function (mode) { this.updates.push(mode || 'default'); };
  ChartStub.prototype.destroy = function () { this.destroyed = true; };
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, parseFloat, parseInt, isNaN, RegExp, Promise, Error,
    setTimeout: (f) => { f(); return 0; }, clearTimeout() {},
    document: { getElementById: el, addEventListener: (e, f) => { (listeners[e] = listeners[e] || []).push(f); }, dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach(f => f(ev)); return true; }, body: {} },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    getComputedStyle: () => ({ getPropertyValue: (n) => (opts.tokens || TOKENS)[n] || '' }),
    matchMedia: () => ({ matches: !!opts.reduced }),
    loadLib: async () => {},
    apiGetPayrollApprovals: async () => ({ success: true, data: opts.approvals || [] }),
    fetchFromAPI: async () => ({ success: true, data: opts.rows13 || [] }),
    apiGetSalaryDeductions: async () => ({ success: true, data: opts.deds || [] }),
    _employees: opts.employees || [], _currentYear: opts.year, _currentMonth: opts.month, _kpiCutoff: 'B', _thirteenthData: [], _thirteenthYear: null,
    _payEarnings: (e, c) => ({ grossPay: e.gross || 0 }), _payDeductions: (e, c) => ({ totalDed: e.ded || 0 }),
    _updateKpis() { ctx.__kpiCalls = (ctx.__kpiCalls || 0) + 1; },
  };
  if (!opts.noChart) ctx.Chart = ChartStub;
  ctx.window = ctx;
  vm.createContext(ctx);
  require('./hxutil').load(ctx);   // A302: the page script delegates to api.js's helpers
  vm.runInContext(SRC, ctx);
  return { ctx, els, charts, T: ctx.dhPulse.t, mount: () => ctx.dhPulse.mount(), tick: () => new Promise(r => setImmediate(r)).then(() => new Promise(r => setImmediate(r))) };
}

const ROW = (period, status, share, gross, at) => ({ period, cutoffLabel: period.endsWith('A') ? '1st Cutoff' : '2nd Cutoff', status, submittedAt: at || period, totals: { grossPay: gross, employerShare: share, totalDeductions: 1000, netPay: gross - 1000, totalPayrollCost: gross + share } });

{
  sec('1 · the transforms');
  const { T } = boot();
  ok('cutoffKey orders A before B before the next month', T.cutoffKey('2026-09-A') < T.cutoffKey('2026-09-B') && T.cutoffKey('2026-09-B') < T.cutoffKey('2026-10-A'));
  ok('  malformed → NaN, and lastN drops it', isNaN(T.cutoffKey('sept')) && T.lastN([{ period: 'sept' }, { period: '2026-09-A' }], 10).length === 1);
  eq('cutoffLabel', T.cutoffLabel('2026-09-B'), 'Sep 2nd');
  {
    const latest = T.latestPerPeriod([ROW('2026-09-A', 'For Approval', 1, 10, '2026-09-11'), ROW('2026-09-A', 'Approved', 2, 10, '2026-09-10'), ROW('2026-09-B', 'For Approval', 3, 10, '2026-09-26'), ROW('2026-09-B', 'For Approval', 4, 10, '2026-09-27')]);
    eq('latestPerPeriod: Approved beats For Approval', latest.find(r => r.period === '2026-09-A').totals.employerShare, 2);
    eq('  two For Approval: the newest submission', latest.find(r => r.period === '2026-09-B').totals.employerShare, 4);
  }
  {
    const rows = []; for (let m = 1; m <= 7; m++) ['A', 'B'].forEach(h => rows.push(ROW('2026-' + String(m).padStart(2, '0') + '-' + h, 'Approved', 100, 1000 * m)));
    const last = T.lastN(rows, 10);
    eq('lastN keeps ten of fourteen, ascending', last.length, 10);
    eq('  starting at March 1st', T.cutoffLabel(last[0].period), 'Mar 1st');
    const s = T.costSeries(last, '2026-07-B');
    eq('costSeries uses totalPayrollCost', s.values[9], 7100);
    eq('  currentIndex finds the current period', s.currentIndex, 9);
    eq('  and −1 when it is not there', T.costSeries(last, '2026-12-A').currentIndex, -1);
    const noTotal = T.costSeries([{ period: '2026-01-A', status: 'Approved', totals: { grossPay: 500, employerShare: 50 } }], '');
    eq('  falls back to gross + share', noTotal.values[0], 550);
  }
  {
    const a = T.accrual(2026, [{ thirteenthMonth: 1000 }, { thirteenthMonth: 250.5 }], new Date('2026-09-28T12:00:00'));
    eq('accrual: months elapsed', a.monthsElapsed, 9); eq('  pct', a.pct, 0.75); eq('  total', a.total, 1250.5); eq('  count', a.count, 2);
    eq('  a past year is complete', T.accrual(2025, [], new Date('2026-01-05T00:00:00')).monthsElapsed, 12);
  }
  {
    const h = T.headcount([{ status: 'Active' }, { status: 'Active', payType: 'Fixed' }, { status: 'Inactive' }]);
    eq('headcount active', h.active, 2); eq('  inactive', h.inactive, 1); eq('  fixed', h.fixed, 1); eq('  hourly', h.hourly, 2);
  }
  {
    const d = T.deductions([{ status: 'Active', totalAmount: 6000, paid: 1500, remaining: 4500 }, { status: 'Settled', totalAmount: 1000, paid: 1000, remaining: 0 }, { status: 'Active', totalAmount: 2000, paid: 0 }]);
    eq('deductions ignores settled', d.count, 2); eq('  paid', d.paid, 1500); eq('  remaining (computed when absent)', d.remaining, 6500); eq('  pct', d.pct, 1500 / 8000);
  }
  eq('teamBars normalises to the max', JSON.stringify(T.teamBars([50, 100, 0])), '[0.5,1,0]');
  eq('  all zero → all zero', JSON.stringify(T.teamBars([0, 0])), '[0,0]');
  eq('money', T.money(1234.5), '₱1,234.50');
}

(async () => {
  {
    sec('2 · mount with a Chart stub');
    const rows = []; for (let m = 6; m <= 9; m++) ['A', 'B'].forEach(h => rows.push(ROW('2026-' + String(m).padStart(2, '0') + '-' + h, 'Approved', 800, 20000)));
    const b = boot({ approvals: rows, year: 2026, month: '09', employees: [{ status: 'Active', gross: 100 }], rows13: [{ thirteenthMonth: 500 }], deds: [{ status: 'Active', totalAmount: 100, paid: 40 }] });
    b.mount(); await b.tick();
    eq('one chart drawn', b.charts.length, 1);
    const c = b.charts[0];
    ok('legend off, one dataset, eight bars', c.config.options.plugins.legend.display === false && c.data.datasets.length === 1 && c.data.datasets[0].data.length === 8);
    eq('the current period (Sep 2nd) is cyan', c.data.datasets[0].backgroundColor[7], TOKENS['--dh-cyan']);
    eq('  the others navy', c.data.datasets[0].backgroundColor[0], TOKENS['--dh-navy']);
    ok('animation is on', typeof c.config.options.animation === 'object');
    ok('the fallback stays hidden', b.els.pulseCostFallback.hidden === true);
    b.ctx.__tok = Object.assign({}, TOKENS, { '--dh-navy': 'rgb(1,2,3)' });
    b.ctx.getComputedStyle = () => ({ getPropertyValue: (n) => b.ctx.__tok[n] || '' });
    b.ctx.document.dispatchEvent(new b.ctx.CustomEvent('dh:theme', { detail: { theme: 'dark' } }));
    ok('dh:theme re-reads the tokens and updates without animation', c.data.datasets[0].backgroundColor[0] === 'rgb(1,2,3)' && c.updates[c.updates.length - 1] === 'none', c.updates);
    ok('the ring, the dots and the deductions bar rendered', /of 12 months/.test(b.els.pulseAccrual.innerHTML) && /1<\/b> active/.test(b.els.pulseHeads.innerHTML) && /collected/.test(b.els.pulseDed.innerHTML));
    ok('  the ring is 9 of 12 for 2026 today', /<b>9<\/b>/.test(b.els.pulseAccrual.innerHTML) || new Date().getFullYear() !== 2026, b.els.pulseAccrual.innerHTML);
    ok('  #kpi13 gets filled through _updateKpis when the tab has not loaded yet', b.ctx.__kpiCalls >= 1 && Array.isArray(b.ctx._thirteenthData) && b.ctx._thirteenthData.length === 1);
  }
  {
    sec('3 · reduced motion');
    const b = boot({ approvals: [ROW('2026-09-A', 'Approved', 1, 10)], reduced: true });
    b.mount(); await b.tick();
    ok('animation is off', b.charts[0] && b.charts[0].config.options.animation === false);
  }
  {
    sec('4 · no Chart.js: the CSS bar list');
    const b = boot({ approvals: [ROW('2026-09-A', 'Approved', 1, 10), ROW('2026-09-B', 'Approved', 1, 20)], noChart: true, year: 2026, month: '09' });
    b.mount(); await b.tick();
    ok('the fallback is shown with one row per cutoff', b.els.pulseCostFallback.hidden === false && (b.els.pulseCostFallback.innerHTML.match(/class="dh-barrow"/g) || []).length === 2, b.els.pulseCostFallback.innerHTML);
    ok('  the current bar is marked', /<i class="cur"/.test(b.els.pulseCostFallback.innerHTML));
  }
  {
    sec('5 · an empty ledger');
    const b = boot({ approvals: [], year: 2026, month: '09', employees: [{ status: 'Active', gross: 1000, ded: 100 }] });
    b.mount(); await b.tick();
    ok('falls back to the loaded period, on screen', b.charts.length === 1 && b.charts[0].data.datasets[0].data.length === 2 && /loaded period/.test(b.els.pulseMeta.textContent), b.els.pulseMeta.textContent);
    const b2 = boot({ approvals: [] });
    b2.mount(); await b2.tick();
    ok('  and with nothing on screen either, the empty copy', /submitted/.test(b2.els.pulseCostFallback.innerHTML), b2.els.pulseCostFallback.innerHTML);
  }
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
})();
