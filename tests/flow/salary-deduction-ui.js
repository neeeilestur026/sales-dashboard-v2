/* A275 — what the salary-deduction screens actually render.
 *
 * Run:  node tests/flow/salary-deduction-ui.js
 *
 * The money engine is pinned in salary-deduction.js against the real Code.gs. This pins the OTHER
 * half: that the figures reach the page, that the payslip names what the money went to, and that the
 * projection shown while the form is being typed agrees with what the server will actually do.
 *
 * Loaded the same way tests/flow/payroll-fixed.js loads it — the real director-home.js in a vm with
 * the smallest DOM that lets it run, so the assertions are against the shipped markup and not a
 * paraphrase of it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want,
  { got, want });
const has = (l, hay, needle) => ok(l, String(hay).indexOf(needle) !== -1, { needle, near: String(hay).slice(0, 200) });
const section = (t) => console.log('\n' + t);

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/director-home.js'), 'utf8');

function boot() {
  const nodes = {};
  const el = (id) => (nodes[id] = nodes[id] || {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
    setAttribute() {}, getAttribute: () => null
  });
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, parseInt, parseFloat, isNaN, RegExp,
    setTimeout, Promise,
    document: { addEventListener() {}, getElementById: (id) => el(id), querySelectorAll: () => [],
                querySelector: () => null, createElement: () => el('tmp'), body: el('body') },
    localStorage: { getItem: () => null, setItem() {} },
    location: { origin: 'http://localhost' }, window: {}, alert() {}, prompt: () => null
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + `
this.__t = {
  el: (id) => this.document.getElementById(id),
  setRegister: (cutoff, map) => { if (cutoff === 'A') _registerA = map; else _registerB = map; },
  setEmployees: (list) => { _employees = list; },
  setDeductions: (list) => { _deductions = list; },
  setPeriod: (y, m) => { _currentYear = y; _currentMonth = m; },
  payslip: (emp, cutoff) => _payslipHtml(emp, cutoff),
  deductions: (emp, cutoff) => _payDeductions(emp, cutoff),
  render: () => renderSalaryDeductions(),
  project: () => _sdProject(),
  label: (p) => _sdLabel(p),
  nextCutoff: (p) => _sdNextCutoff(p)
};`, ctx);
  return ctx;
}

const EMP = { lastName: 'Lucena', firstName: 'Gerald', dailyRate: 1000, otherIncome: 0,
  hdmfAmount: 100, status: 'Active', payType: 'Hourly', fixedAmount: 0 };

// ─────────────────────────────────────────────────────────────
section('1 · the cutoff a person reads, not the key a machine reads');
{
  const t = boot().__t;
  eq('a 1st cutoff', t.label('2026-09-A'), '1st Cutoff · September 2026');
  eq('a 2nd cutoff', t.label('2027-01-B'), '2nd Cutoff · January 2027');
  eq('a malformed key is passed through, not mangled', t.label('nonsense'), 'nonsense');
  eq('A is followed by B in the same month', t.nextCutoff('2026-09-A'), '2026-09-B');
  eq('B rolls into the next month', t.nextCutoff('2026-09-B'), '2026-10-A');
  eq('and December rolls the year', t.nextCutoff('2026-12-B'), '2027-01-A');
}

// ─────────────────────────────────────────────────────────────
section('2 · the deduction reaches the pay grid and the totals');
{
  const ctx = boot(); const t = ctx.__t;
  t.setEmployees([EMP]);
  t.setRegister('A', { 'Lucena, Gerald': { employee: 'Lucena, Gerald', pagibig: 100, sss: 450,
    philhealth: 250, advances: 0, wtax: 0, salaryDeduction: 2916.25,
    salaryDeductionLines: [{ deductionNo: 'DED-202609-001', item: 'Lenovo laptop',
      amount: 2916.25, remainingBefore: 34995, totalAmount: 34995 }] } });
  const d = t.deductions(EMP, 'A');
  eq('the figure is read back, not recomputed', d.salaryDeduction, 2916.25);
  eq('and it is inside Total Deductions', d.totalDed, 100 + 450 + 250 + 2916.25);

  const fixed = Object.assign({}, EMP, { payType: 'Fixed', fixedAmount: 30000 });
  const fd = t.deductions(fixed, 'A');
  eq('a fixed-salary employee still repays', fd.salaryDeduction, 2916.25);
  eq('  with no statutory contribution beside it', fd.totalDed, 2916.25);
  eq('  and Pag-IBIG stays waived', fd.pagibig, 0);

  t.setRegister('B', {});
  eq('an unsaved cutoff is legitimately zero, not undefined', t.deductions(EMP, 'B').salaryDeduction, 0);
}

// ─────────────────────────────────────────────────────────────
section('3 · the payslip names what the money went to');
{
  const ctx = boot(); const t = ctx.__t;
  t.setPeriod(2026, '09');
  t.setEmployees([EMP]);
  t.setRegister('A', { 'Lucena, Gerald': { pagibig: 100, sss: 450, philhealth: 250,
    advances: 0, wtax: 0, salaryDeduction: 2916.25,
    salaryDeductionLines: [{ deductionNo: 'DED-202609-001', item: 'Lenovo laptop',
      amount: 2916.25, remainingBefore: 34995, totalAmount: 34995 }] } });
  const html = t.payslip(EMP, 'A');
  has('the deduction has its own line', html, 'Salary Deduction');
  has('  naming the item', html, 'Lenovo laptop');
  has('  with what is left after this payment', html, '32,078.75');
  has('  out of the agreed total', html, 'left of ₱34,995.00');
  ok('it sits inside the Deductions block, not Earnings',
     html.indexOf('Salary Deduction') > html.indexOf('>Deductions<'));
  ok('  and above Withholding Tax, beside Advances',
     html.indexOf('Salary Deduction') < html.indexOf('Withholding Tax'));

  t.setRegister('A', { 'Lucena, Gerald': { pagibig: 0, sss: 0, philhealth: 0, advances: 0, wtax: 0,
    salaryDeduction: 3416.25, salaryDeductionLines: [
      { deductionNo: 'D1', item: 'Lenovo laptop', amount: 2916.25, remainingBefore: 34995, totalAmount: 34995 },
      { deductionNo: 'D2', item: 'Company phone', amount: 500, remainingBefore: 6000, totalAmount: 6000 }] } });
  const two = t.payslip(EMP, 'A');
  eq('two agreements print as two lines', (two.match(/Salary Deduction/g) || []).length, 2);
  has('  each named', two, 'Company phone');

  t.setRegister('A', { 'Lucena, Gerald': { pagibig: 0, sss: 0, philhealth: 0, advances: 0, wtax: 0,
    salaryDeduction: 0, salaryDeductionLines: [] } });
  has('with no deduction the line still prints at zero, like every other', t.payslip(EMP, 'A'), 'Salary Deduction');
}

// ─────────────────────────────────────────────────────────────
section('4 · the tracker table');
{
  const ctx = boot(); const t = ctx.__t;
  t.setDeductions([{ deductionNo: 'DED-202609-001', employee: 'Lucena, Gerald', username: 'gerald.l',
    item: 'Lenovo laptop', totalAmount: 34995, perCutoffAmount: 2916.25, cadence: 'First Cutoff Only',
    status: 'Active', paid: 8748.75, remaining: 26246.25, settled: false, postingCount: 3,
    instalmentsLeft: 9, nextPeriod: '2026-12-A', projectedEndPeriod: '2027-08-A',
    formDocLink: 'https://drive.example/signed.pdf', postings: [] }]);
  t.render();
  const html = t.el('sdBody').innerHTML;
  has('the number is shown', html, 'DED-202609-001');
  has('paid so far', html, '₱8,748.75');
  has('and what is left', html, '₱26,246.25');
  has('when the next one comes off', html, '1st Cutoff · December 2026');
  has('  how many are left', html, '9 left');
  has('  and when it should finish', html, 'ends 1st Cutoff · August 2027');
  has('the signed form is linked', html, 'signed form');

  t.setDeductions([{ deductionNo: 'DED-202609-002', employee: 'Reyes, Gayle', username: 'gayle',
    item: 'Phone', totalAmount: 6000, perCutoffAmount: 500, cadence: 'Every Cutoff',
    status: 'Draft', paid: 0, remaining: 6000, settled: false, postingCount: 0, instalmentsLeft: 12,
    nextPeriod: '', projectedEndPeriod: '', formDocLink: '', postings: [] }]);
  t.render();
  const draft = t.el('sdBody').innerHTML;
  has('a draft says so', draft, 'Draft');
  has('  and flags the missing authorization', draft, 'not attached');

  t.setDeductions([]);
  t.render();
  has('an empty tracker explains itself', t.el('sdBody').innerHTML, 'No salary deductions yet');
}

// ─────────────────────────────────────────────────────────────
section('5 · the projection shown while the form is typed');
{
  const ctx = boot(); const t = ctx.__t;
  const project = (total, per, cadence, start) => {
    t.el('sdTotal').value = total; t.el('sdPer').value = per;
    t.el('sdCadence').value = cadence; t.el('sdStart').value = start;
    t.project();
    return t.el('sdProjection').innerHTML;
  };

  let h = project(34995, 2916.25, 'First Cutoff Only', '2026-09-A');
  has("Gerald's actual agreement — 12 deductions", h, '<strong>12</strong> deduction');
  has('  every 1st cutoff', h, 'every 1st cutoff');
  has('  from September 2026', h, '1st Cutoff · September 2026');
  has('  to August 2027', h, '1st Cutoff · August 2027');
  has('  and they add up to the agreed total', h, 'exactly ₱34,995.00');

  h = project(24995, 2082.92, 'First Cutoff Only', '2026-09-A');
  has('an uneven total still gives 12', h, '<strong>12</strong> deduction');
  has('  with a smaller last payment', h, 'the last one <strong>₱2,082.88</strong>');
  has('  summing exactly', h, 'exactly ₱24,995.00');

  h = project(24995, 2082.92, 'Every Cutoff', '2026-09-A');
  has('every cutoff finishes sooner', h, '2nd Cutoff · February 2027');

  h = project(1000, 5000, 'Every Cutoff', '2026-09-A');
  has('a per-cutoff amount above the total is refused before saving', h, 'more than the total');

  h = project(0, 0, 'Every Cutoff', '2026-09-A');
  eq('an incomplete form projects nothing', h, '');

  h = project(34995, 2916.25, 'First Cutoff Only', '2026-09-A');
  has('and it says the end date can move', h, 'carries forward');
}

console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
