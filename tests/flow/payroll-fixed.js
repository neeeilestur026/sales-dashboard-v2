/* A260 — fixed-salary employees: a set amount per cutoff, no statutory deductions.
 *
 * Run:  node tests/flow/payroll-fixed.js
 *
 * WHY THIS FILE EXISTS. Three managers are paid a set amount every cutoff whatever their hours and
 * take no statutory contribution. Payroll had no way to express that: basicPay came from
 * regHrs x dailyRate/8 for everyone, and SSS / PhilHealth / Pag-IBIG were computed for everyone.
 *
 * The rules pinned here:
 *   1. Gross = fixed amount + other income + incentive. Hours change nothing.
 *   2. HOLIDAYS change nothing either — every holiday figure is forced to zero, because a fixed
 *      salary already covers the day and the grid and approval document print holidayPay directly.
 *   3. Pag-IBIG, SSS and PhilHealth are zero, and a STORED override for them is ignored — a figure
 *      saved while the employee was hourly must not survive the switch.
 *   4. Withholding tax and advances still apply. An advance is a loan being repaid; tax is a legal
 *      obligation. Neither is a benefit.
 *   5. All four surfaces (payslip, pay grid, register save, approval document) read ONE
 *      _payDeductions, so the waiver cannot be half-applied.
 *   6. A blank pay type is Hourly, so no existing row needs migrating.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want), { got, want });

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/director-home.js'), 'utf8');
const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  setAttribute() {}, getAttribute: () => null });
const ctx = { console,
  document: { addEventListener() {}, getElementById: () => el(), querySelectorAll: () => [],
              createElement: () => el(), body: el() },
  localStorage: { getItem: () => null, setItem() {} },
  location: { origin: 'http://localhost' }, window: {} };
vm.createContext(ctx);
vm.runInContext(SRC + `
this.__t = {
  set(emps, hours, hols, reg, y, m) { _employees = emps; _hoursA = hours; _hoursB = hours;
    _holidaysA = hols; _holidaysB = hols; _registerA = reg; _registerB = reg;
    _currentYear = y; _currentMonth = m; },
  earnings: _payEarnings, deductions: _payDeductions, slip: _computePaySlip,
  slipHtml: _payslipHtml, cutoffHtml: _buildCutoffHtml, isFixed: _isFixedPay
};`, ctx);
const T = ctx.__t;

const NEIL  = { firstName: 'Neil',       lastName: 'Estur',   payType: 'Fixed', fixedAmount: 9000,  dailyRate: 0, otherIncome: 0, hdmfAmount: 100 };
const DAISY = { firstName: 'Daisy',      lastName: 'Estur',   payType: 'Fixed', fixedAmount: 10000, dailyRate: 0, otherIncome: 0, hdmfAmount: 100 };
const STEVE = { firstName: 'John Steve', lastName: 'Jepollo', payType: 'Fixed', fixedAmount: 12000, dailyRate: 0, otherIncome: 0, hdmfAmount: 100 };
const HOURLY = { firstName: 'Juan', lastName: 'Cruz', dailyRate: 1000, otherIncome: 0, hdmfAmount: 100 };
const H = (who, d, hrs) => ({ [who + '|2026-01-' + d]: { employee: who, date: '2026-01-' + d, dayType: 'Regular', hours: hrs } });

console.log('\n1 · the three managers, per cutoff');
[[NEIL, 9000], [DAISY, 10000], [STEVE, 12000]].forEach(([emp, amt]) => {
  T.set([emp], {}, {}, {}, 2026, '01');
  const e = T.earnings(emp, 'B'), d = T.deductions(emp, 'B');
  eq('  ' + emp.lastName + ', ' + emp.firstName + ' basic', e.basicPay, amt);
  eq('    gross', e.grossPay, amt);
  eq('    Pag-IBIG / SSS / PhilHealth', d.pagibig + d.sss + d.philhealth, 0);
  eq('    net', e.grossPay - d.totalDed, amt);
});

console.log('\n2 · hours make NO difference — the whole point');
const variants = [
  ['no hours at all', {}],
  ['8h every weekday', Object.assign({}, H('Estur, Neil', '12', 8), H('Estur, Neil', '13', 8), H('Estur, Neil', '14', 8))],
  ['a 12-hour day (would be OT)', H('Estur, Neil', '12', 12)],
];
variants.forEach(([label, hours]) => {
  T.set([NEIL], hours, {}, {}, 2026, '01');
  const e = T.earnings(NEIL, 'B');
  eq('  ' + label, e.grossPay, 9000);
  eq('    no overtime pay', e.otPay, 0);
});

console.log('\n3 · holidays make NO difference either');
[['regular holiday worked', H('Estur, Neil', '13', 8), { '2026-01-13': 'Regular Holiday' }],
 ['regular holiday unworked', {}, { '2026-01-13': 'Regular Holiday' }],
 ['special non-working worked', H('Estur, Neil', '13', 8), { '2026-01-13': 'Special Non-Working' }]
].forEach(([label, hours, hols]) => {
  T.set([NEIL], hours, hols, {}, 2026, '01');
  const e = T.earnings(NEIL, 'B');
  eq('  ' + label, e.grossPay, 9000);
  eq('    holidayPay forced to zero', e.holidayPay, 0);
  eq('    holidayHrs forced to zero', e.holidayHrs, 0);
  eq('    unworked days forced to zero', e.unworkedHolDays, 0);
});

console.log('\n4 · a stored override cannot revive a waived deduction');
T.set([NEIL], {}, {}, { 'Estur, Neil': { pagibig: 100, sss: 675, philhealth: 250, advances: 500, wtax: 200 } }, 2026, '01');
const dOv = T.deductions(NEIL, 'B');
eq('  Pag-IBIG ignored', dOv.pagibig, 0);
eq('  SSS ignored', dOv.sss, 0);
eq('  PhilHealth ignored', dOv.philhealth, 0);
eq('  advances STILL deducted', dOv.advances, 500);
eq('  withholding tax STILL deducted', dOv.wtax, 200);
eq('  total deductions', dOv.totalDed, 700);
eq('  net = 9000 - 700', T.earnings(NEIL, 'B').grossPay - dOv.totalDed, 8300);

console.log('\n5 · incentives and other income still reach them');
const NEIL2 = Object.assign({}, NEIL, { otherIncome: 1500 });
T.set([NEIL2], {}, {}, {}, 2026, '01');
eq('  other income added on the 2nd cutoff', T.earnings(NEIL2, 'B').grossPay, 10500);
eq('  and NOT on the 1st (unchanged rule)', T.earnings(NEIL2, 'A').grossPay, 9000);

console.log('\n6 · hourly employees are untouched');
T.set([HOURLY], Object.assign({}, H('Cruz, Juan', '12', 8), H('Cruz, Juan', '13', 10)), {}, {}, 2026, '01');
const eh = T.earnings(HOURLY, 'B'), dh = T.deductions(HOURLY, 'B');
eq('  basic', eh.basicPay, 2000);
eq('  OT at 1.25', eh.otPay, 312.5);
eq('  Pag-IBIG still charged', dh.pagibig, 100);
ok('  SSS still computed', dh.sss > 0, dh);
ok('  PhilHealth still computed', dh.philhealth > 0, dh);
/* A259's holiday arithmetic must survive untouched. */
T.set([HOURLY], H('Cruz, Juan', '13', 8), { '2026-01-13': 'Regular Holiday' }, {}, 2026, '01');
eq('  an hourly regular holiday still pays x2', T.earnings(HOURLY, 'B').holidayPay, 2000);

console.log('\n7 · a blank pay type is Hourly — no migration needed');
const LEGACY = { firstName: 'Old', lastName: 'Row', dailyRate: 800, otherIncome: 0, hdmfAmount: 100 };
ok('  undefined payType is not fixed', !T.isFixed(LEGACY));
ok('  empty string is not fixed', !T.isFixed(Object.assign({}, LEGACY, { payType: '' })));
ok('  "hourly" lowercase is not fixed', !T.isFixed(Object.assign({}, LEGACY, { payType: 'hourly' })));
ok('  only exact "Fixed" is fixed', T.isFixed(Object.assign({}, LEGACY, { payType: 'Fixed' })));

console.log('\n8 · the four surfaces read ONE definition');
ok('_payDeductions exists', /function _payDeductions\(emp, cutoff\)/.test(SRC));
/* Count CALLS, not the declaration — `function _payDeductions(emp, cutoff)` matches the same text.
   The four are the payslip, the pay grid, the register save and the approval snapshot. */
const calls = (SRC.match(/[^n] _payDeductions\(emp, cutoff\)|= _payDeductions\(emp, cutoff\)/g) || []).length;
eq('  and is called at four sites', calls, 4);
ok('  the old duplicated default survives ONLY inside it',
   (SRC.match(/emp\.hdmfAmount \|\| 100/g) || []).length === 1);
const slipD = T.deductions.bind(null);
T.set([NEIL], {}, {}, { 'Estur, Neil': { advances: 300 } }, 2026, '01');
const sl = T.slip(NEIL, 'B'), dd = T.deductions(NEIL, 'B');
eq('  payslip and _payDeductions agree on total', sl.totalDed, dd.totalDed);
eq('  payslip net', sl.netPay, 8700);

console.log('\n9 · the documents say so');
T.set([NEIL, HOURLY], Object.assign({}, H('Cruz, Juan', '12', 8)), {}, {}, 2026, '01');
const html = T.slipHtml(NEIL, 'B');
ok('  the payslip is marked FIXED SALARY', /FIXED SALARY/.test(html));
ok('  and shows a Fixed Salary earnings line', /<td class="l">Fixed Salary<\/td>/.test(html));
ok('  and does NOT print an hours qualifier on it', !/Basic Pay \(0\.0 hrs\)/.test(html));
/* Attendance is still recorded, so the payslip must report the hours actually worked rather than
   claim zero — but label them as not being the basis of pay. */
T.set([NEIL], H('Estur, Neil', '12', 8), {}, {}, 2026, '01');
const worked = T.slipHtml(NEIL, 'B');
ok('  recorded hours are reported, not zeroed', /Hours Recorded/.test(worked));
ok('  and show the real figure', /8\.0 hrs/.test(worked));
eq('  while pay is still the fixed amount', T.earnings(NEIL, 'B').grossPay, 9000);
const labels = [...html.matchAll(/<td class="l">([^<]*)<\/td>/g)].map(m => m[1]);
ok('  every label still fits the receipt column (<=26 chars)',
   labels.filter(l => l.length > 26).length === 0, labels.filter(l => l.length > 26));
const cut = T.cutoffHtml('B');
ok('  the approval timesheet marks the fixed employee', /FIXED<\/span>/.test(cut.html));

console.log('\n10 · the positional trap in the employee sheet');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/Code.gs'), 'utf8');
ok('the new columns are appended AFTER Status',
   /'Last Name', 'First Name', 'Daily Rate', 'Other Income', 'HDMF Amount', 'Status',\s*\n\s*'Pay Type', 'Fixed Amount'/.test(GS));
ok('handleGetPayrollEmployees still reads Status at index 5', /status: String\(row\[5\]\|\|'Active'\)/.test(GS));
ok('handleGet13thMonthPay still reads Status at index 5', /status: String\(er\[5\]\|\|'Active'\)/.test(GS));
ok('pay type is read from index 6', /String\(row\[6\]\|\|''\) === 'Fixed'/.test(GS));
ok('fixed amount is read from index 7', /fixedAmount: parseFloat\(row\[7\]\)\|\|0/.test(GS));
ok('only an exact "Fixed" flips the pay type', /String\(params\.payType\|\|''\) === 'Fixed'/.test(GS));

console.log('\n11 · a fixed-salary raise lands in the salary history');
ok('the fixed amount is diffed', /newFixed !== oldFixed/.test(GS));
ok('  and logged like a daily-rate change', /_logPayrollRateChange\(empName, 'Fixed Amount', oldFixed, newFixed/.test(GS));
ok('  a new hire\'s starting fixed amount is logged as initial',
   /_logPayrollRateChange\(empName, 'Fixed Amount', 0, newFixed, params, true\)/.test(GS));
ok('the modal names it', /fixed salary \$\{peso\(_eeOrig\.fixed\)\}/.test(SRC));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
