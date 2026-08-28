/* A259 — holiday pay: the toggle, the three rules, and the three surfaces agreeing.
 *
 * Run:  node tests/flow/payroll-holiday.js
 *
 * WHY THIS FILE EXISTS. The holiday path existed end to end — _payEarnings computed it, the payslip
 * printed it, the pay grid and approval document had columns for it, the register stored it — and
 * nothing could ever set dayType, so all of it was dead code. Wiring it up exposed a defect that had
 * been latent in THREE places: renderHoursGrid, _recomputeEmpTotals and _buildCutoffHtml each split
 * hours with Math.min(hrs, 8) regardless of the day type, while _payEarnings diverted holiday hours
 * away entirely. The grid and the approval document — the page an approver signs — would have shown
 * Basic Pay for hours the payslip pays as Holiday.
 *
 * The rules pinned here:
 *   1. Regular holiday WORKED      = hrs x hourly x 2.00
 *   2. Regular holiday NOT worked  = one day's pay. This is the rule with no hours row behind it,
 *      and the reason the calendar is keyed by date rather than by employee.
 *   3. Special non-working WORKED  = hrs x hourly x 1.30
 *   4. Special non-working NOT worked = nothing. No work, no pay.
 *   5. The grid, the payslip and the approval snapshot all read ONE _payEarnings.
 *   6. A period with no holidays is byte-identical to the old behaviour.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want), { got, want });

// ── load the module with just enough DOM to survive its top-level listener ───────────
const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/director-home.js'), 'utf8');
/* A fake element for every lookup: the toggle re-renders the grid, which writes innerHTML and
   queries inputs. Returning null instead would make the test fail on the DOM rather than on the
   arithmetic it is actually checking. */
const el = () => ({
  innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  setAttribute() {}, getAttribute: () => null,
});
const ctx = {
  console,
  document: { addEventListener() {}, getElementById: () => el(), querySelectorAll: () => [],
              createElement: () => el(), body: el() },
  localStorage: { getItem: () => null, setItem() {} },
  location: { origin: 'http://localhost' },   // the payslip embeds the logo by absolute URL
  window: {},
};
vm.createContext(ctx);
/* The module's state is top-level `let`, which in a vm script lives in LEXICAL scope and never
   reaches the context object — so it cannot be set from out here. The epilogue runs INSIDE the same
   script, where those bindings are visible, and hands out a setter. */
const EPILOGUE = `
this.__t = {
  set(emps, hours, hols, y, m) { _employees = emps; _hoursA = hours; _hoursB = hours;
                                 _holidaysA = hols; _holidaysB = hols;
                                 _currentYear = y; _currentMonth = m; },
  earnings: _payEarnings, slip: _computePaySlip, slipHtml: _payslipHtml,
  cutoffHtml: _buildCutoffHtml,
  dates: _buildDateRange, dayType: _dayTypeFor, toggle: toggleHoliday,
  holMap: (c) => _holidayMap(c)
};`;
vm.runInContext(SRC + EPILOGUE, ctx);
const T = ctx.__t;

const EMP = { firstName: 'Juan', lastName: 'Cruz', dailyRate: 1000, otherIncome: 0, hdmfAmount: 100 };
const NAME = 'Cruz, Juan';
const H = (d, hrs) => ({ [NAME + '|2026-01-' + d]: { employee: NAME, date: '2026-01-' + d, dayType: 'Regular', hours: hrs } });

console.log('\n1 · the worked example — PHP 1,000/day, PHP 125/hr, 2nd cutoff Jan 2026');
T.set([EMP], Object.assign({},
  H('12', 8),   // ordinary day
  H('13', 8),   // regular holiday, worked
  H('15', 8)    // special non-working, worked
  // 14 deliberately has NO hours row — regular holiday, not worked
), { '2026-01-13': 'Regular Holiday', '2026-01-14': 'Regular Holiday', '2026-01-15': 'Special Non-Working' },
   2026, '01');
const e = T.earnings(EMP, 'B');
eq('  ordinary basic pay (8h x 125)', e.basicPay, 1000);
eq('  regular holiday worked (8h x 125 x 2)', e.regHolPay, 2000);
eq('  regular holiday NOT worked (one day)', e.unworkedHolPay, 1000);
eq('  ...counted as 1 day', e.unworkedHolDays, 1);
eq('  special non-working worked (8h x 125 x 1.3)', e.speHolPay, 1300);
eq('  combined holiday pay', e.holidayPay, 4300);
eq('  no overtime', e.otPay, 0);
eq('  GROSS', e.grossPay, 5300);
eq('  statutory base excludes incentive, includes holiday', e.statBase, 5300);
eq('  holiday HOURS are worked hours only (8 + 8)', e.holidayHrs, 16);
eq('  ordinary hours exclude the holidays', e.regHrs, 8);

console.log('\n2 · special non-working, NOT worked -> nothing');
T.set([EMP], {}, { '2026-01-14': 'Special Non-Working' }, 2026, '01');
const sp = T.earnings(EMP, 'B');
eq('  no pay at all', sp.grossPay, 0);
eq('  and no unworked-holiday day counted', sp.unworkedHolDays, 0);

console.log('\n3 · regular holiday, nobody worked -> still one day');
T.set([EMP], {}, { '2026-01-14': 'Regular Holiday' }, 2026, '01');
const rh = T.earnings(EMP, 'B');
eq('  paid a full day', rh.grossPay, 1000);
eq('  with zero holiday HOURS', rh.holidayHrs, 0);

console.log('\n4 · a period with NO holidays is unchanged');
T.set([EMP], Object.assign({}, H('12', 8), H('13', 10)), {}, 2026, '01');
const pl = T.earnings(EMP, 'B');
eq('  regular hours', pl.regHrs, 16);
eq('  overtime hours', pl.otHrs, 2);
eq('  basic', pl.basicPay, 2000);
eq('  OT at 1.25', pl.otPay, 312.5);
eq('  holiday pay is zero', pl.holidayPay, 0);
eq('  gross', pl.grossPay, 2312.5);

console.log('\n5 · overtime on a holiday is paid flat, not split');
T.set([EMP], H('13', 10), { '2026-01-13': 'Regular Holiday' }, 2026, '01');
const hot = T.earnings(EMP, 'B');
eq('  all 10 hours at x2', hot.regHolPay, 2500);
eq('  none diverted to OT', hot.otHrs, 0);

console.log('\n6 · a holiday on a SUNDAY still pays when unworked');
// 2026-01-18 is a Sunday
const sun = new Date(2026, 0, 18).getDay();
eq('  (2026-01-18 really is a Sunday)', sun, 0);
T.set([EMP], {}, { '2026-01-18': 'Regular Holiday' }, 2026, '01');
eq('  paid a full day', T.earnings(EMP, 'B').grossPay, 1000);

console.log('\n7 · legacy dayType "Holiday" keeps its x2 meaning');
T.set([EMP], { [NAME + '|2026-01-13']: { employee: NAME, date: '2026-01-13', dayType: 'Holiday', hours: 8 } },
      {}, 2026, '01');
eq('  still paid at x2', T.earnings(EMP, 'B').holidayPay, 2000);

console.log('\n8 · the toggle cycles ordinary -> special -> regular -> ordinary');
T.set([EMP], {}, {}, 2026, '01');
const cal = T.holMap('B');
T.toggle('B', '2026-01-20'); eq('  first click', cal['2026-01-20'], 'Special Non-Working');
T.toggle('B', '2026-01-20'); eq('  second click', cal['2026-01-20'], 'Regular Holiday');
T.toggle('B', '2026-01-20'); eq('  third click clears it', cal['2026-01-20'], undefined);

console.log('\n9 · the payslip names the rate it applied');
T.set([EMP], Object.assign({}, H('13', 8), H('15', 8)),
  { '2026-01-13': 'Regular Holiday', '2026-01-14': 'Regular Holiday', '2026-01-15': 'Special Non-Working' },
  2026, '01');
const html = T.slipHtml(EMP, 'B');
ok('  prints the regular-holiday line at x2', /Reg Holiday \(8\.0h x2\)/.test(html));
ok('  prints the special line at x1.3', /Spcl Holiday \(8\.0h x1\.3\)/.test(html));
ok('  prints the unworked day', /Unworked Holiday \(1 day\)/.test(html));
ok('  and NOT the old hard-coded x2 label', !/Holiday \(16\.0 hrs x2\)/.test(html));
/* The receipt truncates its label column at ~26 chars, so a label longer than that hides the rate
   it exists to state. Assert the LENGTH, not just the text. */
const labels = [...html.matchAll(/<td class="l">([^<]*)<\/td>/g)].map(m => m[1]);
const tooLong = labels.filter(l => l.length > 26);
ok('  every payslip label fits the column (<=26 chars)', tooLong.length === 0, tooLong);
const plain = T.slipHtml(EMP, 'B');
T.set([EMP], H('12', 8), {}, 2026, '01');
ok('  an ordinary payslip still shows a single Holiday line', /<td class="l">Holiday<\/td>/.test(T.slipHtml(EMP, 'B')));

console.log('\n10 · the APPROVAL document — the page management signs');
T.set([EMP], Object.assign({}, H('12', 8), H('13', 8), H('15', 8)),
  { '2026-01-13': 'Regular Holiday', '2026-01-14': 'Regular Holiday', '2026-01-15': 'Special Non-Working' },
  2026, '01');
const built = T.cutoffHtml('B');
ok('  it builds', !!(built && built.html), built && Object.keys(built));
const A = built.html;
ok('  the timesheet marks the regular holiday columns', /REG 200%/.test(A));
ok('  and the special ones', /SPE 130%/.test(A));
ok('  it has a Holiday Pay column', /<th>Holiday Pay<\/th>/.test(A));
ok('  it has a Hol Hrs column', /<th>Hol Hrs<\/th>/.test(A));
/* The figure an approver would sign: basic 1,000 + holiday 4,300 = 5,300 gross. Assert the holiday
   figure appears, not merely that a column exists — an empty column is the failure mode. */
ok('  the holiday figure is printed', A.indexOf('4,300') > -1, A.match(/4,3\d\d[^<]*/g));
ok('  the basic figure is printed', A.indexOf('1,000') > -1);
eq('  the totals block agrees on gross', Math.round(built.totals.grossPay || 0), 5300);
eq('  and carries the holiday pay it is made of', Math.round(built.totals.totalHolidayPay || 0), 4300);
eq('  and the holiday hours', built.totals.totalHolidayHours, 16);

console.log('\n11 · the three surfaces read ONE definition');
const S = SRC;
ok('renderHoursGrid money cells come from _payEarnings',
   /const e = _payEarnings\(emp, cutoff\);\s+\/\/ A259/.test(S));
ok('_recomputeEmpTotals comes from _payEarnings',
   /const e = _payEarnings\(emp, cutoff\);\s*\n\s*const set =/.test(S));
ok('the approval snapshot comes from _payEarnings', /const te = _payEarnings\(emp, cutoff\);/.test(S));
ok('the grid no longer splits holiday hours into reg/OT',
   /if \(!_dayTypeFor\(cutoff, dt\.dateStr, stored\)\) \{/.test(S));
ok('the calendar is saved with the hours', /apiSavePayrollHolidays\(period, holRows\)/.test(S));
ok('a backend without the action degrades to no holidays',
   /apiGetPayrollHolidays\(periodA\)\.catch\(\(\) => \(\{ data: \[\] \}\)\)/.test(S));

console.log('\n12 · the backend stores only the two recognised types');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/Code.gs'), 'utf8');
const sv = GS.slice(GS.indexOf('function handleSavePayrollHolidays'), GS.indexOf('function handleGetPayrollRegister'));
ok('unknown types are skipped', /t !== 'Regular Holiday' && t !== 'Special Non-Working'/.test(sv));
ok('the period is replaced wholesale so un-toggling removes it', /sheet\.deleteRow\(i\)/.test(sv));
ok('the sheet exists with three columns', /'Period', 'Date', 'Type'/.test(GS));
ok('both dispatch tables know the save action',
   (GS.match(/case 'savePayrollHolidays'/g) || []).length === 2);
ok('the read action is dispatched', /case 'getPayrollHolidays'/.test(GS));
ok('handleSavePayrollHours is untouched — zero-hour rows still dropped',
   /var hrs = parseFloat\(r\.hours\)\|\|0;\s*\n\s*if \(!hrs\) continue;/.test(GS));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
