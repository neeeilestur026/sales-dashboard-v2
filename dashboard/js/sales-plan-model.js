/* sales-plan-model.js — A403 · the Sales plan's arithmetic (sales-plan.html and the home card).
 *
 * Neil, 23 Nov 2026: his 2027 Individual Sales Strategy Workbook in the portal. FlowAPI 202's getSalesPlan sends the
 * accounts, the sales, the pipeline, the year's quotations and the months, already filled in; this file turns them into
 * what the workbook's KPI Dashboard, tier table, Monthly Targets and filters show. PURE: everything arrives as arguments,
 * nothing is fetched or drawn, so tests/flow/sales-plan.js runs it in node. Money is pesos, before VAT (a sales order
 * counts as recorded; its lines are before VAT).
 */
const SP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SP_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SP_TIERS = ['A', 'B', 'C'];
const SP_OPEN_STAGES = ['Lead', 'Qualified', 'Technical Review', 'Quotation', 'Negotiation'];
const SP_ACTIVITY_TYPES = ['Customer visit', 'Phone call', 'Email', 'Online meeting', 'Technical meeting', 'Site survey', 'Quotation follow-up', 'Collection follow-up', 'Sales order', 'Other task'];

function _spS(v) { return String(v == null ? '' : v).trim(); }
function _spN(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function _spR2(n) { return Math.round(_spN(n) * 100) / 100; }

/** ₱25,000,000 · ₱1,234.50 (cents only when there are any). */
function spMoney(v) {
  const n = _spN(v), neg = n < 0, a = Math.abs(n), cents = Math.round(a * 100) % 100 !== 0;
  return (neg ? '−' : '') + '₱' + a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
/** ₱25M · ₱2.08M · ₱600k · ₱950 — for tiles and bars. */
function spShort(v) {
  const n = _spN(v), neg = n < 0, a = Math.abs(n);
  const t = a >= 1e6 ? (Math.round(a / 1e4) / 100).toString().replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1') + 'M'
    : a >= 1e3 ? (Math.round(a / 100) / 10).toString().replace(/\.0$/, '') + 'k' : String(Math.round(a));
  return (neg ? '−' : '') + '₱' + t;
}
/** 0.4321 → '43%'; under 10% one decimal ('4.5%'); null → '—'. */
function spPct(x) {
  if (x === null || x === undefined || !isFinite(x)) return '—';
  const p = x * 100;
  return (Math.abs(p) < 10 && Math.round(p * 10) % 10 !== 0 ? (Math.round(p * 10) / 10).toFixed(1) : String(Math.round(p))) + '%';
}
function spRatio(a, b) { return _spN(b) > 0 ? _spN(a) / _spN(b) : null; }
/** '2026-11-23' → '23 Nov'; with the year when it is not `thisYear`. */
function spDay(ymd, thisYear) {
  const s = _spS(ymd);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return '';
  const y = s.slice(0, 4), m = parseInt(s.slice(5, 7), 10), d = parseInt(s.slice(8, 10), 10);
  return d + ' ' + SP_MONTHS[m - 1] + (thisYear && String(thisYear) !== y ? ' ' + y : '');
}
function spDaysBetween(a, b) {
  const pa = _spS(a), pb = _spS(b);
  if (!/^\d{4}-\d{2}-\d{2}/.test(pa) || !/^\d{4}-\d{2}-\d{2}/.test(pb)) return null;
  return Math.round((Date.UTC(+pb.slice(0, 4), +pb.slice(5, 7) - 1, +pb.slice(8, 10)) - Date.UTC(+pa.slice(0, 4), +pa.slice(5, 7) - 1, +pa.slice(8, 10))) / 86400000);
}

/* ── the KPI dashboard ──────────────────────────────────────────────────────────────────────────── */

/** The workbook's KPI Dashboard, from one getSalesPlan reply. Pipeline counts only open, unarchived rows. */
function spKpis(r) {
  const plan = (r && r.plan) || {}, sales = (r && r.sales) || [], pipe = (r && r.pipeline) || [], quotes = (r && r.quotes) || [], accounts = (r && r.accounts) || [];
  const annual = _spN(plan.annual), ytd = _spR2(sales.reduce((t, s) => t + _spN(s.amount), 0));
  const open = pipe.filter(o => SP_OPEN_STAGES.indexOf(o.stage) >= 0 && !o.archived);
  const openValue = _spR2(open.reduce((t, o) => t + _spN(o.value), 0)), weighted = _spR2(open.reduce((t, o) => t + _spN(o.weighted), 0));
  const withCost = sales.filter(s => s.cost !== undefined);
  const costed = sales.filter(s => s.gp !== null && s.gp !== undefined);
  const gp = withCost.length ? _spR2(costed.reduce((t, s) => t + _spN(s.gp), 0)) : null;
  const costedSales = _spR2(costed.reduce((t, s) => t + _spN(s.amount), 0));
  const submitted = quotes.filter(q => q.state !== 'Draft'), won = quotes.filter(q => q.state === 'Won').length, lost = quotes.filter(q => q.state === 'Lost').length;
  return {
    annual, ytd, achievement: spRatio(ytd, annual), remaining: _spR2(annual - ytd),
    weighted, openValue, openCount: open.length, coverage: spRatio(openValue, annual),
    gp, gm: gp === null ? null : spRatio(gp, costedSales), costedOrders: costed.length, orders: sales.length,
    quotesSubmitted: submitted.length, quoteValue: _spR2(submitted.reduce((t, q) => t + _spN(q.value), 0)),
    decided: won + lost, won, lost, winRate: spRatio(won, won + lost),
    activeAccounts: accounts.filter(a => a.status === 'Active').length, accountsWithSales: accounts.filter(a => _spN(a.actual) > 0).length, accounts: accounts.length
  };
}
/** Sales target by account tier: A, B, C, then the accounts with no tier. */
function spTierRows(accounts) {
  const rows = SP_TIERS.concat(['']).map(t => {
    const list = (accounts || []).filter(a => (a.tier || '') === t), target = _spR2(list.reduce((s, a) => s + _spN(a.target), 0)), actual = _spR2(list.reduce((s, a) => s + _spN(a.actual), 0));
    return { tier: t, label: t ? 'Tier ' + t : 'No tier', accounts: list.length, target, actual, achievement: spRatio(actual, target) };
  });
  return rows.filter(r => r.tier || r.accounts);
}
/** What the accounts' own targets add up to, against the year target. */
function spAccountsTotal(accounts, annual) {
  const t = _spR2((accounts || []).reduce((s, a) => s + _spN(a.target), 0));
  return { total: t, annual: _spN(annual), gap: _spR2(_spN(annual) - t), match: Math.abs(_spN(annual) - t) < 1 };
}

/* ── the months ─────────────────────────────────────────────────────────────────────────────────── */

/** Monthly Targets: each month's share, target, actual, variance, achievement; `cur` marks this month, `past` the done ones.
 *  `asOf` is today (yyyy-mm-dd); `year` the plan's year. Totals in .total. */
function spMonthRows(months, year, asOf) {
  const y = String(year), ty = _spS(asOf).slice(0, 4), tm = parseInt(_spS(asOf).slice(5, 7), 10);
  const rows = (months || []).map((m, i) => {
    const target = _spN(m.target), actual = _spN(m.actual);
    const cur = y === ty && i + 1 === tm, past = y < ty || (y === ty && i + 1 < tm);
    return { month: i + 1, label: SP_MONTHS[i], long: SP_MONTHS_LONG[i], share: _spN(m.share), target, actual, variance: _spR2(actual - target),
             achievement: spRatio(actual, target), cur, past, future: !cur && !past };
  });
  const tt = _spR2(rows.reduce((s, r) => s + r.target, 0)), ta = _spR2(rows.reduce((s, r) => s + r.actual, 0));
  const toDate = rows.filter(r => r.past || r.cur), td = _spR2(toDate.reduce((s, r) => s + r.target, 0));
  return { rows, total: { share: _spR2(rows.reduce((s, r) => s + r.share, 0)), target: tt, actual: ta, variance: _spR2(ta - tt), achievement: spRatio(ta, tt) },
           toDate: { target: td, actual: ta, achievement: spRatio(ta, td), months: toDate.length } };
}
/** Twelve shares that add up to 100: even, with the rounding left in December. */
function spEvenSplit() {
  const a = []; for (let i = 0; i < 11; i++) a.push(Math.round(10000 / 12) / 100);
  a.push(_spR2(100 - a.reduce((s, x) => s + x, 0)));
  return a;
}
/** Checks a month split as typed: { ok, total, shares[12], error }. Blank counts as 0. */
function spSplitCheck(values) {
  const v = (values || []).map(x => { const s = _spS(x).replace('%', ''); return s === '' ? 0 : Number(s); });
  if (v.length !== 12) return { ok: false, total: 0, shares: v, error: 'Twelve months are needed.' };
  if (v.some(x => !isFinite(x) || x < 0)) return { ok: false, total: 0, shares: v, error: 'Each month is a share from 0 to 100%.' };
  const total = _spR2(v.reduce((s, x) => s + x, 0));
  return { ok: Math.abs(total - 100) <= 0.05, total, shares: v, error: Math.abs(total - 100) <= 0.05 ? '' : 'The months add up to ' + total + '%, not 100%.' };
}
/** Shares from pesos typed per month (the other way to fill the split): each month / the year. */
function spSharesFromAmounts(amounts, annual) {
  const a = _spN(annual);
  if (!(a > 0)) return null;
  const s = (amounts || []).map(x => _spR2(_spN(_spS(x).replace(/,/g, '')) / a * 100));
  const d = _spR2(100 - s.reduce((t, x) => t + x, 0));
  if (s.length === 12 && Math.abs(d) <= 0.12) s[11] = _spR2(s[11] + d);   // the cents of rounding land in December
  return s;
}

/* ── accounts ───────────────────────────────────────────────────────────────────────────────────── */

const SP_ACCOUNT_SEGS = [['all', 'All'], ['A', 'Tier A'], ['B', 'Tier B'], ['C', 'Tier C'], ['none', 'No tier'], ['Active', 'Active'], ['Prospect', 'Prospect'], ['Dormant', 'Dormant'], ['On Hold', 'On hold']];
function spAccountMatch(a, seg) {
  if (!seg || seg === 'all') return true;
  if (SP_TIERS.indexOf(seg) >= 0) return a.tier === seg;
  if (seg === 'none') return !a.tier;
  return a.status === seg;
}
function spAccountsFilter(list, f) {
  const q = _spS(f && f.q).toLowerCase(), seg = (f && f.seg) || 'all';
  return (list || []).filter(a => spAccountMatch(a, seg) && (!q || [a.company, a.sector, a.focus, a.contact && a.contact.name, a.nextStep].some(x => _spS(x).toLowerCase().indexOf(q) >= 0)));
}
function spAccountCounts(list) {
  const out = {};
  SP_ACCOUNT_SEGS.forEach(([k]) => { out[k] = (list || []).filter(a => spAccountMatch(a, k)).length; });
  return out;
}
/** The visit line of an account: "Last 3 Nov · next 27 Nov", or the gap since the last one. */
function spVisitText(a, today) {
  const last = _spS(a.lastVisit), next = _spS(a.nextVisit), y = _spS(today).slice(0, 4);
  if (!last && !next) return 'No visit yet';
  return [last ? 'Last ' + spDay(last, y) : 'No visit yet', next ? 'next ' + spDay(next, y) : ''].filter(Boolean).join(' · ');
}

/* ── the pipeline ───────────────────────────────────────────────────────────────────────────────── */

const SP_PIPE_SEGS = [['open', 'Open'], ['Lead', 'Leads'], ['Qualified', 'Qualified'], ['Technical Review', 'Technical review'], ['Quotation', 'Quotation'], ['Negotiation', 'Negotiation'],
                      ['due', 'Next action due'], ['old', 'Older than 90 days'], ['won', 'Closed won'], ['lost', 'Closed lost']];
function spPipeMatch(o, seg, today) {
  const open = SP_OPEN_STAGES.indexOf(o.stage) >= 0 && !o.archived;
  if (!seg || seg === 'open') return open;
  if (seg === 'won') return o.stage === 'Closed Won';
  if (seg === 'lost') return o.stage === 'Closed Lost';
  if (seg === 'old') return open && _spN(o.age) > 90;
  if (seg === 'due') return open && !!o.nextActionDate && o.nextActionDate <= today;
  return open && o.stage === seg;
}
function spPipeFilter(list, f, today) {
  const q = _spS(f && f.q).toLowerCase(), seg = (f && f.seg) || 'open';
  return (list || []).filter(o => spPipeMatch(o, seg, today) && (!q || [o.recordNo, o.company, o.project, o.decisionMaker, o.nextAction].some(x => _spS(x).toLowerCase().indexOf(q) >= 0)));
}
function spPipeCounts(list, today) {
  const out = {};
  SP_PIPE_SEGS.forEach(([k]) => { out[k] = (list || []).filter(o => spPipeMatch(o, k, today)).length; });
  return out;
}
/** The open stages left to right: how many, the value, the weighted value. Value-less rows (PRs, leads) count but add 0. */
function spStageSummary(list) {
  return SP_OPEN_STAGES.map(s => {
    const rows = (list || []).filter(o => o.stage === s && !o.archived);
    return { stage: s, count: rows.length, value: _spR2(rows.reduce((t, o) => t + _spN(o.value), 0)), weighted: _spR2(rows.reduce((t, o) => t + _spN(o.weighted), 0)),
             unpriced: rows.filter(o => o.value === null || o.value === undefined).length };
  });
}
/** Where an opportunity's expected close stands: overdue (past and still open), soon (within 14 days) or ''. */
function spCloseState(o, today) {
  if (SP_OPEN_STAGES.indexOf(o.stage) < 0 || !o.expectedClose) return '';
  const d = spDaysBetween(today, o.expectedClose);
  return d === null ? '' : d < 0 ? 'overdue' : d <= 14 ? 'soon' : '';
}

/* ── activity ───────────────────────────────────────────────────────────────────────────────────── */

/** How many of each kind; an Email row counts its emails. */
function spActivityCounts(rows) {
  const out = {};
  SP_ACTIVITY_TYPES.forEach(t => { out[t] = 0; });
  (rows || []).forEach(r => { const k = SP_ACTIVITY_TYPES.indexOf(r.type) >= 0 ? r.type : 'Other task'; out[k] += r.type === 'Email' ? (_spN(r.count) || 1) : 1; });
  return out;
}
/** A period for the Activity tab: this week (Mon–today), this month, last month, or the last 30 days. */
function spActivityRange(kind, today) {
  const t = _spS(today), y = +t.slice(0, 4), m = +t.slice(5, 7), d = +t.slice(8, 10);
  const fmt = (dt) => dt.toISOString().slice(0, 10), utc = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd));
  if (kind === 'week') { const dow = (utc(y, m, d).getUTCDay() + 6) % 7; return { from: fmt(utc(y, m, d - dow)), to: t }; }
  if (kind === 'month') return { from: fmt(utc(y, m, 1)), to: t };
  if (kind === 'last') return { from: fmt(utc(y, m - 1, 1)), to: fmt(utc(y, m, 0)) };
  if (kind === 'quarter') return { from: fmt(utc(y, m, d - 89)), to: t };
  return { from: fmt(utc(y, m, d - 29)), to: t };
}

/* ── the rep's home card ────────────────────────────────────────────────────────────────────────── */

/** "November: ₱1.2M of ₱2.08M (58%)" and the year — from the summary read. */
function spHomeLines(r, today) {
  if (!r || !r.success || !r.plan) return null;
  const mi = parseInt(_spS(today).slice(5, 7), 10) - 1, inYear = String(r.year) === _spS(today).slice(0, 4);
  const m = inYear && r.months ? r.months[mi] : null;
  const ytd = _spN(r.ytd), annual = _spN(r.plan.annual);
  const toDateTarget = inYear && r.months ? r.months.slice(0, mi + 1).reduce((s, x) => s + _spN(x.target), 0) : annual;
  return { month: m ? { label: SP_MONTHS_LONG[mi], actual: _spN(m.actual), target: _spN(m.target), share: spRatio(m.actual, m.target) } : null,
           year: { label: String(r.year), actual: ytd, target: annual, share: spRatio(ytd, annual) },
           pace: { target: _spR2(toDateTarget), share: spRatio(ytd, toDateTarget) }, orders: _spN(r.orders), set: !!r.plan.set };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spMoney, spShort, spPct, spDay, spKpis, spTierRows, spAccountsTotal, spMonthRows, spEvenSplit, spSplitCheck, spSharesFromAmounts, spAccountsFilter,
                     spAccountCounts, spVisitText, spPipeFilter, spPipeCounts, spStageSummary, spCloseState, spActivityCounts, spActivityRange, spHomeLines, spDaysBetween };
}
