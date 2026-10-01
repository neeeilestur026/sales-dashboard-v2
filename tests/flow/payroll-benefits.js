/* A309 — the statutory schedule is a rule, not a table.
 *
 * Run:  node tests/flow/payroll-benefits.js
 *
 * WHY THIS FILE EXISTS. Pag-IBIG, SSS and PhilHealth used to be filled from an SSS bracket table and a
 * PhilHealth percentage on every cutoff, and the director typed the real figures over them by hand
 * twice a month. The company's practice is fixed: Pag-IBIG on the 1st cutoff only, SSS + PhilHealth
 * on the 2nd only, at per-employee amounts kept on the employee record, and nothing at all in the
 * month somebody was hired.
 *
 * The rules pinned here:
 *   1. Cutoff A: Pag-IBIG (hdmfAmount, default 200); SSS and PhilHealth 0.
 *   2. Cutoff B: SSS (sssAmount, default 600) and PhilHealth (philhealthAmount, default 200); Pag-IBIG 0.
 *   3. A fixed-salary employee still takes none of the three, whatever the record says.
 *   4. A saved register row wins over the rule, including a saved 0 — nothing saved or approved moves.
 *   5. A hire takes nothing in the month of hiring and starts the following month; no date, an
 *      unparseable date, or a page with no period loaded means eligible now.
 *   6. Net pay and the payslip read the same figures.
 *   7. The old tables are gone and every surface reads the one _payDeductions.
 *   8. Code.gs stores the three new fields at the END of the Payroll Employees sheet, widens an
 *      existing header, round-trips a Date cell as YYYY-MM-DD, and logs an SSS/PhilHealth change.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCtx } = require('./gasload-code');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want), { got, want });
const three = (d) => [d.pagibig, d.sss, d.philhealth].join('/');

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
require('./hxutil').load(ctx);
vm.runInContext(SRC + `
this.__t = {
  set(emps, hours, reg, y, m) { _employees = emps; _hoursA = hours; _hoursB = hours;
    _holidaysA = {}; _holidaysB = {}; _registerA = reg; _registerB = reg;
    _currentYear = y; _currentMonth = m; },
  setReg(a, b) { _registerA = a; _registerB = b; },
  deductions: _payDeductions, slip: _computePaySlip, elig: _statutoryEligible
};`, ctx);
const T = ctx.__t;

const HOURLY  = { firstName: 'Juan',          lastName: 'Cruz',    dailyRate: 1000, otherIncome: 0 };
const DANDAN  = { firstName: 'Crystal Gayle', lastName: 'Dandan',  dailyRate: 725,  otherIncome: 0, sssAmount: 825 };
const SIMEON  = { firstName: 'Angelica',      lastName: 'Simeon',  dailyRate: 675,  otherIncome: 0, sssAmount: 400 };
const LIMPOCO = { firstName: 'Aira',          lastName: 'Limpoco', dailyRate: 550,  otherIncome: 0, dateHired: '2026-09-14' };
const OCTHIRE = { firstName: 'New',           lastName: 'Hire',    dailyRate: 600,  otherIncome: 0, dateHired: '2026-10-05' };
const FIXED   = { firstName: 'Neil', lastName: 'Estur', payType: 'Fixed', fixedAmount: 9000, dailyRate: 0, otherIncome: 0, sssAmount: 825, hdmfAmount: 500 };
const H = (who, d, hrs) => ({ [who + '|2026-10-' + d]: { employee: who, date: '2026-10-' + d, dayType: 'Regular', hours: hrs } });

console.log('\n1 · 1st cutoff: Pag-IBIG only');
T.set([HOURLY, DANDAN, SIMEON], {}, {}, 2026, '10');
eq('  default employee', three(T.deductions(HOURLY, 'A')), '200/0/0');
eq('  Dandan (SSS 825 on record) still only Pag-IBIG here', three(T.deductions(DANDAN, 'A')), '200/0/0');
eq('  a recorded Pag-IBIG amount is used', T.deductions(Object.assign({}, HOURLY, { hdmfAmount: 150 }), 'A').pagibig, 150);
eq('  a recorded 0 means the default', T.deductions(Object.assign({}, HOURLY, { hdmfAmount: 0 }), 'A').pagibig, 200);

console.log('\n2 · 2nd cutoff: SSS and PhilHealth only');
eq('  default employee', three(T.deductions(HOURLY, 'B')), '0/600/200');
eq('  Dandan', three(T.deductions(DANDAN, 'B')), '0/825/200');
eq('  Simeon', three(T.deductions(SIMEON, 'B')), '0/400/200');
eq('  a recorded PhilHealth amount is used', T.deductions(Object.assign({}, HOURLY, { philhealthAmount: 300 }), 'B').philhealth, 300);
ok('  the amounts do not depend on the hours', (() => {
  T.set([HOURLY], Object.assign({}, H('Cruz, Juan', '12', 8), H('Cruz, Juan', '13', 12)), {}, 2026, '10');
  const d = T.deductions(HOURLY, 'B'); T.set([HOURLY], {}, {}, 2026, '10');
  return three(d) === '0/600/200';
})());

console.log('\n3 · a fixed salary takes none of the three');
T.set([FIXED], {}, {}, 2026, '10');
eq('  cutoff A', three(T.deductions(FIXED, 'A')), '0/0/0');
eq('  cutoff B', three(T.deductions(FIXED, 'B')), '0/0/0');

console.log('\n4 · a saved register row wins');
T.set([HOURLY], {}, {}, 2026, '10');
T.setReg({ 'Cruz, Juan': { pagibig: 0 } }, { 'Cruz, Juan': { sss: 700 } });
eq('  saved SSS 700 on B', T.deductions(HOURLY, 'B').sss, 700);
eq('  saved Pag-IBIG 0 on A stays 0', T.deductions(HOURLY, 'A').pagibig, 0);
T.setReg({}, { 'Cruz, Juan': { sss: 0, philhealth: 0 } });
eq('  a saved 0 is an answer, not a blank', three(T.deductions(HOURLY, 'B')), '0/0/0');
T.setReg({ 'Cruz, Juan': { sss: 300 } }, {});
eq('  a saved SSS on cutoff A is honoured too (the cell was typed)', T.deductions(HOURLY, 'A').sss, 300);

console.log('\n5 · a new hire starts the month after hiring');
T.set([OCTHIRE, LIMPOCO], {}, {}, 2026, '10');
eq('  hired 2026-10-05, October A', three(T.deductions(OCTHIRE, 'A')), '0/0/0');
eq('  hired 2026-10-05, October B', three(T.deductions(OCTHIRE, 'B')), '0/0/0');
eq('  Limpoco (hired 2026-09-14) is eligible in October A', three(T.deductions(LIMPOCO, 'A')), '200/0/0');
eq('  and October B', three(T.deductions(LIMPOCO, 'B')), '0/600/200');
T.set([OCTHIRE], {}, {}, 2026, '11');
eq('  the October hire in November A', three(T.deductions(OCTHIRE, 'A')), '200/0/0');
eq('  and November B', three(T.deductions(OCTHIRE, 'B')), '0/600/200');
T.set([OCTHIRE], {}, {}, 2026, 10);
ok('  _currentMonth as a number works', T.elig(OCTHIRE) === false && T.elig(LIMPOCO) === true);
T.set([OCTHIRE], {}, {}, 2026, '10');
ok('  a full ISO date is gated by its month', T.elig({ dateHired: '2026-10-05T00:00:00' }) === false);
ok('  blank / missing / garbage dates mean eligible now',
   T.elig({ dateHired: '' }) && T.elig({}) && T.elig({ dateHired: '14/09/2026' }) && T.elig(null));
ok('  September 30 hire is eligible in October', T.elig({ dateHired: '2026-09-30' }) === true);
T.set([OCTHIRE], {}, {}, null, null);
ok('  no period loaded → eligible (nothing to compare against)', T.elig(OCTHIRE) === true);

console.log('\n6 · totals and the payslip agree');
T.set([HOURLY], Object.assign({}, H('Cruz, Juan', '12', 8), H('Cruz, Juan', '13', 8)), {}, 2026, '10');
T.setReg({}, { 'Cruz, Juan': { advances: 100, wtax: 50 } });
const dB = T.deductions(HOURLY, 'B');
eq('  B total = 600 + 200 + advances + wtax', dB.totalDed, 950);
const slip = T.slip(HOURLY, 'B');
eq('  payslip net = gross − the same total', slip.netPay, slip.grossPay - 950);
eq('  payslip SSS', slip.sss, 600);
eq('  payslip PhilHealth', slip.philhealth, 200);
eq('  payslip Pag-IBIG on B', slip.pagibig, 0);

console.log('\n7 · the tables are gone and every surface reads the one function');
ok('_calcSSS is gone', !/_calcSSS/.test(SRC));
ok('_calcPHIC is gone', !/_calcPHIC/.test(SRC));
ok('the Pag-IBIG default appears exactly once, inside _payDeductions', (SRC.match(/emp\.hdmfAmount \|\| 200/g) || []).length === 1);
ok('the SSS default appears exactly once', (SRC.match(/emp\.sssAmount \|\| 600/g) || []).length === 1);
ok('the PhilHealth default appears exactly once', (SRC.match(/emp\.philhealthAmount \|\| 200/g) || []).length === 1);
ok('_statutoryEligible is consulted inside _payDeductions',
   /function _payDeductions\(emp, cutoff\) \{[\s\S]*?_statutoryEligible\(emp\)[\s\S]*?\n\}/.test(SRC));
ok('the form sends the three fields', /sssAmount:\s+document\.getElementById\('eeSss'\)\.value/.test(SRC)
   && /philhealthAmount:\s+document\.getElementById\('eePhilhealth'\)\.value/.test(SRC)
   && /dateHired:\s+document\.getElementById\('eeDateHired'\)\.value/.test(SRC));

console.log('\n8 · Code.gs: three columns appended at the END of Payroll Employees');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/Code.gs'), 'utf8');
ok("'Fixed Amount' and 'SSS Amount' are adjacent in the header array",
   /'Pay Type', 'Fixed Amount', 'SSS Amount', 'PhilHealth Amount', 'Date Hired'/.test(GS));
const OLD_HEADER = ['Last Name', 'First Name', 'Daily Rate', 'Other Income', 'HDMF Amount', 'Status', 'Pay Type', 'Fixed Amount'];
const store = { 'Payroll Employees': [OLD_HEADER.slice(), ['Lucena', 'Gerald', 1000, 0, 100, 'Active', 'Hourly', 0]] };
const gs = makeCtx(store);
let r = gs.handleGetPayrollEmployees();
ok('an old 8-column row reads as 0 / 0 / blank', r.success && r.data[0].sssAmount === 0 && r.data[0].philhealthAmount === 0 && r.data[0].dateHired === '', r);
eq('  the live header was widened on first touch', store['Payroll Employees'][0].slice(8, 11).join('|'), 'SSS Amount|PhilHealth Amount|Date Hired');
const base = { id: 1, lastName: 'Lucena', firstName: 'Gerald', dailyRate: 1000, otherIncome: 0, hdmfAmount: 100, status: 'Active', payType: 'Hourly' };
r = gs.handleSavePayrollEmployee(Object.assign({}, base, { sssAmount: 825, philhealthAmount: 200, dateHired: '2026-09-14', actorName: 'Neil' }));
ok('a save with the three fields succeeds', r.success === true, r);
eq('  the row now has 12 cells (A312 added Username)', store['Payroll Employees'][1].length, 12);
eq('  stored at indexes 8–10', store['Payroll Employees'][1].slice(8, 11).join('|'), '825|200|2026-09-14');
r = gs.handleGetPayrollEmployees();
eq('  and read back', [r.data[0].sssAmount, r.data[0].philhealthAmount, r.data[0].dateHired].join('|'), '825|200|2026-09-14');
const hist = (store['Payroll Rate History'] || []).slice(1);
ok('  the SSS change is in the rate history', hist.some(h => h[2] === 'SSS Amount' && h[4] === 825), hist);
ok('  Date Hired is NOT logged as a pay change', !hist.some(h => /Date/i.test(String(h[2]))), hist);
store['Payroll Employees'][1][10] = new Date(2026, 8, 14);
eq('a Date cell (what Sheets stores a typed date as) comes back as YYYY-MM-DD', gs.handleGetPayrollEmployees().data[0].dateHired, '2026-09-14');
r = gs.handleSavePayrollEmployee(Object.assign({}, base, { sssAmount: 825, philhealthAmount: 200, dateHired: '14/09/2026' }));
eq('a date in another format is dropped rather than stored', store['Payroll Employees'][1][10], '');
r = gs.handleSavePayrollEmployee(base);
ok('a save with none of the new params (older callers) still succeeds', r.success === true, r);
r = gs.handleSavePayrollEmployee({ lastName: 'New', firstName: 'Hire', dailyRate: 600, otherIncome: 0, hdmfAmount: 0, status: 'Active', payType: 'Hourly', dateHired: '2026-10-05' });
eq('a new employee appends 12 cells', store['Payroll Employees'][2].length, 12);
eq('  with the hire date', store['Payroll Employees'][2][10], '2026-10-05');
ok('handleGet13thMonthPay still reads Status at index 5', /status: String\(er\[5\]\|\|'Active'\)/.test(GS));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
