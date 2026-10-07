/* A326 — the daily reports' reads, fast and still exact.
 *
 * Run:  node tests/flow/daily-activity.js
 *
 * getActivityLog formatted the date of every row of the whole log (a timezone lookup and a formatDate
 * per row) before looking at whose row it was: 10-25 s a call, and a rep's report fires eight at once,
 * so the day's tasks never appeared. Pinned here:
 *   1. The timezone is asked once per execution, not once per row.
 *   2. By person and day it returns exactly the rows the old per-row formatting returned — Date cells
 *      at midnight or later in the day, and text cells — and nobody else's.
 *   3. from/to returns a run of days in one read (the week view); getSalesCalls the same.
 *   4. getClientVisits and getDailyReports (date, start/end) keep their answers.
 *   5. The pages: the report and the week view read the week in one call, and narrow it themselves
 *      (an older FlowAPI ignores from/to and returns the person's whole history).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n' + t);

// Dates are made with the SCRIPT's own Date: a Date from this file's realm fails `instanceof Date` in
// the vm and would read as text, which is not what a sheet hands back.
function world() {
  const store = {};
  const ctx = load(undefined, store);
  const VD = vm.runInContext('Date', ctx);
  const D = (y, m, d, h, mi) => new VD(y, m - 1, d, h || 0, mi || 0);
  Object.assign(store, {
    ActivityLog: [
      { Timestamp: D(2026, 10, 5, 9), Date: D(2026, 10, 5), User: 'Gerald Lucena', Module: 'Quotation', Action: 'Created', 'Ref No': 'Q-1' },
      { Timestamp: D(2026, 10, 6, 8), Date: D(2026, 10, 6), User: 'Gerald Lucena', Module: 'Inventory', Action: 'Added', 'Ref No': 'TW-1' },
      { Timestamp: D(2026, 10, 6, 23, 50), Date: D(2026, 10, 6, 23, 50), User: 'Gerald Lucena', Module: 'Pricing Request', Action: 'Created', 'Ref No': 'PR-1' },
      { Timestamp: D(2026, 10, 6, 10), Date: '2026-10-06', User: 'Gerald Lucena', Module: 'Client', Action: 'Saved', 'Ref No': 'ACME' },
      { Timestamp: D(2026, 10, 6, 11), Date: D(2026, 10, 6), User: 'Kimberlyn Blones', Module: 'Quotation', Action: 'Sent', 'Ref No': 'Q-2' },
      { Timestamp: D(2026, 10, 7, 0, 0), Date: D(2026, 10, 7), User: 'Gerald Lucena', Module: 'Inventory', Action: 'Added', 'Ref No': 'TW-2' },
      { Timestamp: D(2026, 10, 12, 9), Date: D(2026, 10, 12), User: 'Gerald Lucena', Module: 'Quotation', Action: 'Sent', 'Ref No': 'Q-3' },
    ],
    SalesCalls: [
      { 'Call No': 'CALL-1', Date: D(2026, 10, 5), User: 'Gerald Lucena', Contact: 'Jo', 'Created At': D(2026, 10, 5, 9) },
      { 'Call No': 'CALL-2', Date: D(2026, 10, 6), User: 'Gerald Lucena', Contact: 'Al', 'Created At': D(2026, 10, 6, 9) },
      { 'Call No': 'CALL-3', Date: D(2026, 10, 6), User: 'Kimberlyn Blones', Contact: 'Bo', 'Created At': D(2026, 10, 6, 9) },
      { 'Call No': 'CALL-4', Date: D(2026, 10, 9), User: 'Gerald Lucena', Contact: 'Cy', 'Created At': D(2026, 10, 9, 9) },
    ],
    ClientVisits: [
      { 'Visit No': 'V-1', Date: D(2026, 10, 6), User: 'Gerald Lucena', Company: 'ACME', 'Created At': D(2026, 10, 6, 9) },
      { 'Visit No': 'V-2', Date: D(2026, 10, 7), User: 'Gerald Lucena', Company: 'BETA', 'Created At': D(2026, 10, 7, 9) },
    ],
    DailyReports: [
      { 'Report No': 'DR-1', Date: D(2026, 10, 5), User: 'Gerald Lucena', Role: 'sales', Status: 'Submitted' },
      { 'Report No': 'DR-2', Date: D(2026, 10, 6), User: 'Gerald Lucena', Role: 'sales', Status: 'Submitted' },
      { 'Report No': 'DR-3', Date: D(2026, 10, 6), User: 'Kimberlyn Blones', Role: 'sales', Status: 'Submitted' },
    ],
  });
  return { ctx, store };
}
const refs = (r) => (r.data || []).map(x => x.refNo || x.callNo || x.visitNo || x.reportNo).sort();

sec('1 · the timezone is asked once, not once per row');
{
  const { ctx } = world();
  let n = 0;
  const real = ctx.Session.getScriptTimeZone;
  ctx.Session.getScriptTimeZone = () => { n++; return real(); };
  call(ctx, 'getActivityLog', { date: '2026-10-06', user: 'Gerald Lucena' });
  ok('one dated read asks for the timezone at most once', n <= 1, n);
}

sec('2 · one person, one day: the same rows as before, and only theirs');
{
  const { ctx, store } = world();
  const r = call(ctx, 'getActivityLog', { date: '2026-10-06', user: 'Gerald Lucena' });
  ok('the read succeeds', r.success, r);
  eq('  Gerald on the 6th: midnight, 23:50 and a text-dated row', refs(r), ['ACME', 'PR-1', 'TW-1']);
  ok('  every row says the 6th', r.data.every(x => x.date === '2026-10-06'), r.data.map(x => x.date));
  // the old rule, row by row: _dateStr(Date) === day && user matches
  const old = store.ActivityLog.filter(x => ctx._dateStr(x.Date) === '2026-10-06' && x.User === 'Gerald Lucena').map(x => x['Ref No']).sort();
  eq('  exactly what per-row formatting picked', refs(r), old);
  const all = call(ctx, 'getActivityLog', { date: '2026-10-06' });
  eq('everyone on the 6th (the oversight view)', refs(all), ['ACME', 'PR-1', 'Q-2', 'TW-1']);
  eq('a day with nothing', refs(call(ctx, 'getActivityLog', { date: '2026-10-08', user: 'Gerald Lucena' })), []);
  ok('newest first', (() => { const t = r.data.map(x => new Date(x.timestamp).getTime()); return t.every((v, i) => i === 0 || t[i - 1] >= v); })(), r.data.map(x => x.timestamp));
}

sec('3 · a run of days in one read');
{
  const { ctx } = world();
  eq('Gerald 5–7 Oct', refs(call(ctx, 'getActivityLog', { user: 'Gerald Lucena', from: '2026-10-05', to: '2026-10-07' })), ['ACME', 'PR-1', 'Q-1', 'TW-1', 'TW-2']);
  eq('  the 12th stays out', refs(call(ctx, 'getActivityLog', { user: 'Gerald Lucena', from: '2026-10-05', to: '2026-10-11' })).includes('Q-3'), false);
  eq('calls 5–9 Oct', refs(call(ctx, 'getSalesCalls', { user: 'Gerald Lucena', from: '2026-10-05', to: '2026-10-09' })), ['CALL-1', 'CALL-2', 'CALL-4']);
  eq('calls on the 6th', refs(call(ctx, 'getSalesCalls', { user: 'Gerald Lucena', date: '2026-10-06' })), ['CALL-2']);
  eq('a person with no date: their whole history, as before', refs(call(ctx, 'getActivityLog', { user: 'Kimberlyn Blones' })), ['Q-2']);
  eq('a malformed day matches nothing', refs(call(ctx, 'getActivityLog', { user: 'Gerald Lucena', date: '6/10/2026' })), []);
}

sec('4 · visits and submitted reports keep their answers');
{
  const { ctx } = world();
  eq('visits on the 7th', refs(call(ctx, 'getClientVisits', { user: 'Gerald Lucena', date: '2026-10-07' })), ['V-2']);
  const dr = (p) => (call(ctx, 'getDailyReports', p).data || []).map(x => x.reportNo || x.no).sort();
  eq('reports on the 6th', dr({ date: '2026-10-06' }).length, 2);
  eq('Gerald 5–6 Oct', dr({ user: 'Gerald Lucena', start: '2026-10-05', end: '2026-10-06' }).length, 2);
  eq('from the 6th on', dr({ start: '2026-10-06' }).length, 2);
}

sec('5 · the pages read the week once and narrow it themselves');
{
  const js = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'js', f), 'utf8');
  const week = js('report-week.js');
  ok('the week view makes one activity read and one call read', /flowUserActivity\(user, days\[0\], lastDay\)/.test(week) && /flowUserCalls\(user, days\[0\], lastDay\)/.test(week)
     && !/fetchFlow\('getActivityLog', \{ date: d/.test(week), week.slice(0, 0));
  ['report.js', 'accounting-daily-report.js', 'admin-daily-report.js', 'leadgen-daily-report.js', 'marketing-daily-report.js'].forEach(f => {
    ok(f + ' reads its own activity through flowUserActivity', /flowUserActivity\(/.test(js(f)) && !/fetchFlow\('getActivityLog', \{ date[^}]*user/.test(js(f)));
  });
  ok('the name lists are primed alongside the activity, not before it', !/await flowPrimeRefNames\(\)/.test(js('report.js')));
  // a slow answer for a date no longer on the picker is dropped (today's first load used to paint over
  // the day the rep had switched to, notes box included)
  const rep = js('report.js');
  ['loadNotes', 'loadCalls', 'loadVisits', 'loadEmails'].forEach(fn => {
    const body = rep.slice(rep.indexOf('async function ' + fn + '('), rep.indexOf('async function ' + fn + '(') + 700);
    ok('report.js ' + fn + ' drops an answer for another date', /if \(_stale\(date\)\) return;/.test(body));
  });
  ok('report.js load() drops an answer for another date', /flowUserActivity\(drSession\.name, date, date\), primed\]\);[^\n]*\n\s*if \(_stale\(date\)\) return;/.test(rep));
  ['accounting-daily-report.js', 'admin-daily-report.js', 'marketing-daily-report.js', 'leadgen-daily-report.js'].forEach(f => {
    ok(f + ' never puts another day\'s notes in the box', /getDailyNote', \{ date, user[^}]*\}\);\s*if \(date !== _date\(\)\) return;/.test(js(f)));
  });
  ok('the submission card drops a stale lookup', /if \(_rsOpts !== opts\) return;\s*_rsRecord = rec;/.test(js('report-submit.js')));
  // the helper narrows to the asked days even when the server ignores from/to (FlowAPI before 167)
  const api = js('flow-api.js');
  const helper = api.slice(api.indexOf('async function _flowUserDays'), api.indexOf("// Today's date in PH local time"));
  const flowDate = (d) => String(d).slice(0, 10);
  const fetchFlow = async () => ({ success: true, data: [{ date: '2026-10-04' }, { date: '2026-10-05' }, { date: '2026-10-06' }, { date: '2026-10-08' }] });
  const mk = new Function('fetchFlow', 'flowDate', helper + '; return flowUserActivity;');
  const fua = mk(fetchFlow, flowDate);
  return fua('Gerald Lucena', '2026-10-05', '2026-10-06').then(r => {
    eq('an old server\'s whole history is narrowed to the asked days', r.data.map(x => x.date), ['2026-10-05', '2026-10-06']);
    console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
    process.exit(FAIL ? 1 : 0);
  });
}
