/* A409 — withholding tax is worked out, not typed.
 *
 * Run:  node tests/flow/payroll-wtax.js
 *
 * Neil, 27 Nov 2026: "it should be automatic … after deductions of benefits after gross pay". The
 * WTax cell was a box that started at 0, so no tax was taken unless someone typed it.
 *
 * The rules pinned here:
 *   1. The BIR semi-monthly table (from 1 Jan 2023): nothing up to ₱10,417, then 15 / 20 / 25 / 30 /
 *      35% of the amount over each bracket, continuous at every edge.
 *   2. Taxable pay = gross less the cutoff's MANDATORY Pag-IBIG (≤ ₱200), SSS and PhilHealth (not
 *      advances, not loans). A411: a fixed salary follows the same table (no blanket exemption).
 *   3. Only an OPEN cutoff is worked out. Approved = the saved (paid) figure. Unknown / not loaded =
 *      the saved figure, with a banner when the check failed.
 *   4. A saved row holding a different figure is starred; Save sends the worked-out figure.
 *   5. The cell is computed (no input), and editing SSS moves WTax, Total Ded. and Net Pay together.
 *   6. The approval document reads the same figure; the salary-deduction cap counts it.
 *   7. The state comes from the approvals ledger by the server's rule, outside the pinned Promise.all.
 *   8. A411 — Performance Bonus / Perfect Attendance are tax-free up to ₱90,000 for the year (from the
 *      ledger); Commission and the rest are taxed; an unreadable ledger taxes the bonus.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/director-home.js'), 'utf8');

/* A small DOM: elements by id that keep what is written into them. */
const ELS = {};
const mk = (id) => ({ id, innerHTML: '', textContent: '', value: '', title: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  setAttribute() {}, getAttribute: () => null });
const byId = (id) => (ELS[id] = ELS[id] || mk(id));
const SENT = [];
const ctx = { console, setTimeout: () => 0, alert: () => {},
  document: { addEventListener() {}, getElementById: byId, querySelectorAll: () => [], createElement: () => mk(''), body: mk('body') },
  localStorage: { getItem: () => null, setItem() {} },
  location: { origin: 'http://localhost' }, window: {} };
vm.createContext(ctx);
require('./hxutil').load(ctx);
vm.runInContext(SRC + `
this.__t = {
  set(emps, hours, regA, regB, y, m) { _employees = emps; _hoursA = hours; _hoursB = hours;
    _holidaysA = {}; _holidaysB = {}; _registerA = regA; _registerB = regB;
    _currentYear = y; _currentMonth = m; },
  state(a, b) { _cutoffStateA = a; _cutoffStateB = b; },
  get states() { return [_cutoffStateA, _cutoffStateB]; },
  table: _wtaxSemiMonthly, rule: _wtaxRuleText, d: _payDeductions, slip: _computePaySlip,
  grid: renderPayGrid, cell: _updateRegCell, save: saveRegister, read: _readCutoffStates, build: _buildCutoffHtml,
  ytd: _readBenefitsYtd, free: _taxFreeBenefits,
  inc(cutoff, rows) { _applyIncentives(cutoff, rows); },
  setYtd(v) { _benefitsYtd = v; },
  stubApi(o) { Object.assign(globalThis, o); }
};`, ctx);
const T = ctx.__t;

console.log('\n1 · the BIR semi-monthly table');
eq('  0 taxable', T.table(0), 0);
eq('  negative taxable is no tax', T.table(-500), 0);
eq('  ₱10,417 exactly pays nothing', T.table(10417), 0);
eq('  ₱10,418 pays 15% of ₱1', T.table(10418), 0.15);
eq('  ₱11,700 → 15% of ₱1,283', T.table(11700), 192.45);
eq('  ₱16,667 → ₱937.50 (both brackets agree at the edge)', T.table(16667), 937.5);
eq('  ₱16,666 → 15% of ₱6,249', T.table(16666), 937.35);
eq('  ₱20,000 → ₱937.50 + 20% of ₱3,333', T.table(20000), 1604.10);
eq('  ₱33,333 → ₱4,270.70', T.table(33333), 4270.70);
eq('  ₱83,333 → ₱16,770.70', T.table(83333), 16770.70);
eq('  ₱333,333 → ₱91,770.70', T.table(333333), 91770.70);
eq('  ₱400,000 → ₱91,770.70 + 35% of ₱66,667', T.table(400000), 115104.15);
ok('  the rule text names the bracket', /15% of the amount over ₱10,417\.00/.test(T.rule(11700)) &&
   /₱937\.50 \+ 20% of the amount over ₱16,667\.00/.test(T.rule(20000)) && /No tax up to ₱10,417\.00/.test(T.rule(9000)));

/* People. Hourly: daily 1,000 → 125 an hour. Cutoff B (Nov 11–25). */
const HOURLY = { firstName: 'Juan', lastName: 'Cruz', dailyRate: 1000, otherIncome: 0 };
const FIXED  = { firstName: 'Ana', lastName: 'Reyes', payType: 'Fixed', fixedAmount: 15000, dailyRate: 0, otherIncome: 0 };
const LOW    = { firstName: 'Lea', lastName: 'Santos', dailyRate: 600, otherIncome: 0 };
const days = (who, list, hrs) => Object.assign({}, ...list.map(d => ({ [who + '|2026-11-' + d]: { employee: who, date: '2026-11-' + d, dayType: 'Regular', hours: hrs } })));
const WORK = ['11', '12', '13', '14', '17', '18', '19', '20', '21', '24', '25', '15', '16'];   // 13 days
let d0;
const HOURS = Object.assign({}, days('Cruz, Juan', WORK, 8), days('Santos, Lea', WORK, 8));

console.log('\n2 · taxable pay = gross less Pag-IBIG, SSS and PhilHealth (open cutoff)');
T.set([HOURLY, FIXED, LOW], HOURS, {}, {}, 2026, '11');
T.state('open', 'open');
const dB = T.d(HOURLY, 'B'), gB = T.slip(HOURLY, 'B').grossPay;
eq('  gross for 13 days at ₱1,000', gB, 13000);
eq('  taxable = 13,000 − 600 SSS − 200 PhilHealth', dB.wtaxTaxable, 12200);
eq('  WTax = 15% of (12,200 − 10,417)', dB.wtax, 267.45);
ok('  worked out, not provisional on an unsaved row', dB.wtaxAuto === true && dB.wtaxProvisional === false);
eq('  Total Ded. carries it', dB.totalDed, 600 + 200 + 267.45);
eq('  payslip net = gross − the same total', T.slip(HOURLY, 'B').netPay, 13000 - 1067.45);
const dA = T.d(HOURLY, 'A');
ok('  cutoff A takes only Pag-IBIG off before the table', Math.abs(dA.wtaxTaxable - (T.slip(HOURLY, 'A').grossPay - 200)) < 0.005);
eq('  low earner (₱600 a day) pays nothing', T.d(LOW, 'B').wtax, 0);
const dF = T.d(FIXED, 'B');
eq('  A411 — a fixed salary follows the table: ₱15,000 is all taxable', dF.wtaxTaxable, 15000);
eq('  fixed salary WTax = 15% of ₱4,583', dF.wtax, 687.45);
const F9 = Object.assign({}, FIXED, { firstName: 'Nina', fixedAmount: 9000 });
const F10 = Object.assign({}, FIXED, { firstName: 'Dina', fixedAmount: 10000 });
const F12 = Object.assign({}, FIXED, { firstName: 'Sam', fixedAmount: 12000 });
T.set([F9, F10, F12], HOURS, {}, {}, 2026, '11');
eq('  ₱9,000 a cutoff pays nothing (under ₱10,417)', T.d(F9, 'B').wtax, 0);
eq('  ₱10,000 a cutoff pays nothing', T.d(F10, 'B').wtax, 0);
eq('  ₱12,000 a cutoff pays 15% of ₱1,583', T.d(F12, 'B').wtax, 237.45);
ok('  no blanket fixed-salary exemption left in the code', !/wtaxExempt|Fixed salary: no withholding tax/.test(SRC));
T.set([F12], HOURS, {}, { 'Reyes, Sam': { period: '2026-11-B', employee: 'Reyes, Sam', wtax: 0, salaryDeductionStored: 0 } }, 2026, '11');
d0 = T.d(F12, 'B');
ok('  saved 0 under the old exemption → 237.45 and starred on an open cutoff', d0.wtax === 237.45 && d0.wtaxProvisional === true, d0);
T.state('open', 'approved');
eq('  but an APPROVED cutoff keeps the tax that was paid', T.d(F12, 'B').wtax, 0);
T.state('open', 'open');
T.set([HOURLY, FIXED, LOW], HOURS, {}, {}, 2026, '11');
T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': { advances: 3000 } }, 2026, '11');
eq('  an advance does not lower the tax', T.d(HOURLY, 'B').wtax, 267.45);

console.log('\n3 · only an open cutoff is worked out');
const savedRow = (o) => Object.assign({ period: '2026-11-B', employee: 'Cruz, Juan', pagibig: 0, sss: 600, philhealth: 200,
  advances: 0, wtax: 0, salaryDeductionStored: 0 }, o || {});
T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 0 }) }, 2026, '11');
T.state('open', 'approved');
let d = T.d(HOURLY, 'B');
ok('  approved: the saved (paid) 0 stays', d.wtax === 0 && d.wtaxAuto === false && d.wtaxProvisional === false, d);
T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 120 }) }, 2026, '11');
eq('  approved: a saved 120 stays 120', T.d(HOURLY, 'B').wtax, 120);
T.state('open', 'unknown');
eq('  approvals unreadable: the saved figure', T.d(HOURLY, 'B').wtax, 120);
T.state(null, null);
eq('  nothing loaded yet: the saved figure', T.d(HOURLY, 'B').wtax, 120);
T.set([HOURLY], HOURS, {}, {}, 2026, '11');
eq('  nothing loaded and nothing saved: 0, never a guess', T.d(HOURLY, 'B').wtax, 0);

console.log('\n4 · a saved row that disagrees is starred; Save sends the worked-out figure');
T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 0 }) }, 2026, '11');
T.state('open', 'open');
d = T.d(HOURLY, 'B');
ok('  saved 0, worked out 267.45 → provisional', d.wtax === 267.45 && d.wtaxProvisional === true && d.wtaxSaved === 0, d);
T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 267.45 }) }, 2026, '11');
ok('  saved = worked out → no star', T.d(HOURLY, 'B').wtaxProvisional === false);
T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 500 }) }, 2026, '11');
eq('  an old typed 500 is replaced on an open cutoff', T.d(HOURLY, 'B').wtax, 267.45);

(async () => {
  T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 0 }) }, 2026, '11');
  T.state('open', 'open');
  T.stubApi({
    apiSavePayrollRegister: async (period, rows) => { SENT.push({ period, rows }); return { success: true }; },
    apiGetPayrollRegister: async () => ({ success: true, data: [savedRow({ wtax: 267.45 })], salaryDeductionDue: {} }),
  });
  await T.save('B');
  const sent = (SENT[0] || { rows: [] }).rows.find(r => r.employee === 'Cruz, Juan') || {};
  eq('  Save sends WTax 267.45', sent.wtax, 267.45);
  eq('  for period 2026-11-B', (SENT[0] || {}).period, '2026-11-B');
  ok('  after the save the star is gone', T.d(HOURLY, 'B').wtaxProvisional === false);

  console.log('\n5 · the cell is computed, and follows the contributions');
  T.set([HOURLY, LOW], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 0 }) }, 2026, '11');
  T.state('open', 'open');
  T.grid('B');
  const html = byId('payBGrid').innerHTML;
  ok('  no WTax input any more', !/data-field="wtax"/.test(html));
  ok('  a computed cell with an id per row', /<td class="num computed" id="wtax_B_[^"]+" title="Taxable pay ₱12,200\.00/.test(html), html.slice(0, 0));
  ok('  it shows ₱267.45 with the not-saved star', /267\.45<span title="Not saved to this cutoff yet" class="dh-warn-text"> \*<\/span>/.test(html));
  ok('  the tooltip says what is saved and how to apply it', /Saved now as ₱0\.00; Save Pay Register to apply it\./.test(html));
  ok('  a zero tax is a dim dash', /id="wtax_B_[^"]*Santos[^"]*"[^>]*><span class="dh-dim">—<\/span>/.test(html) || /<span class="dh-dim">—<\/span><\/td>\s*<td class="num computed" id="totalDed_B_[^"]*Santos/.test(html));
  ok('  the header explains the column', /title="Worked out from the BIR semi-monthly table on taxable pay: gross less mandatory Pag-IBIG \(up to ₱200\), SSS, PhilHealth and bonuses still under ₱90,000 for the year">WTax</.test(html));
  ok('  no banner on an open cutoff', !/Withholding tax shows the saved figures/.test(html));
  T.set([F9], HOURS, {}, {}, 2026, '11'); T.grid('B');
  ok('  a ₱9,000 fixed salary: the whole gross, under the threshold', /title="Taxable pay ₱9,000\.00 = the whole gross\. No tax up to ₱10,417\.00 a cutoff\."><span class="dh-dim">—<\/span>/.test(byId('payBGrid').innerHTML));
  T.set([HOURLY, LOW], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 0 }) }, 2026, '11'); T.grid('B');

  // type a new SSS for Juan → taxable 12,800 − 200 → WTax moves
  const k = Object.keys(ELS).find(id => /^wtax_B_/.test(id) && /Cruz/.test(id)) ||
            ('wtax_B_' + vm.runInContext("_empKey('Cruz, Juan')", ctx));
  const key = k.replace(/^wtax_B_/, '');
  T.cell({ dataset: { emp: 'Cruz, Juan', cutoff: 'B', field: 'sss' }, value: '1000' });
  eq('  SSS 1,000 → taxable 11,800 → WTax 15% of 1,383', T.d(HOURLY, 'B').wtax, 207.45);
  ok('  the WTax cell is rewritten', /207\.45/.test(byId('wtax_B_' + key).innerHTML), byId('wtax_B_' + key).innerHTML);
  ok('  Total Ded. = 1,000 + 200 + 207.45', /1,407\.45/.test(byId('totalDed_B_' + key).textContent), byId('totalDed_B_' + key).textContent);
  ok('  Net Pay = 13,000 − 1,407.45', /11,592\.55/.test(byId('netPay_B_' + key).textContent), byId('netPay_B_' + key).textContent);

  // an unsaved row: typing advances keeps the default SSS/PhilHealth the grid shows
  T.set([HOURLY], HOURS, {}, {}, 2026, '11');
  T.cell({ dataset: { emp: 'Cruz, Juan', cutoff: 'B', field: 'advances' }, value: '100' });
  ok('  unsaved row: Total Ded. = 600 + 200 + 100 + 267.45 (defaults kept)', /1,167\.45/.test(byId('totalDed_B_' + key).textContent), byId('totalDed_B_' + key).textContent);

  T.state('open', 'unknown');
  T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 0 }) }, 2026, '11');
  T.grid('B');
  ok('  unknown: the banner says the saved figures are shown', /Withholding tax shows the saved figures\./.test(byId('payBGrid').innerHTML));
  T.state('open', 'approved'); T.grid('B');
  ok('  approved: no banner, the tooltip says "as saved and paid"', !/Withholding tax shows the saved figures/.test(byId('payBGrid').innerHTML) &&
     /the withholding tax as saved and paid/.test(byId('payBGrid').innerHTML));

  console.log('\n6 · the approval document and the salary-deduction cap');
  T.state('open', 'open');
  T.set([HOURLY], HOURS, {}, { 'Cruz, Juan': savedRow({ wtax: 267.45 }) }, 2026, '11');
  ok('  the approval document reads dd.wtax', /const wtax\s+= dd\.wtax/.test(SRC) && !/const wtax\s+= saved\.wtax/.test(SRC));
  const built = T.build('B');
  ok('  and prints ₱267.45', !!built && /267\.45/.test(built.html));
  vm.runInContext("_sdDueB = { 'Cruz, Juan': { amount: 20000, lines: [] } };", ctx);
  T.set([HOURLY], HOURS, {}, {}, 2026, '11');
  eq('  an unsaved deduction is capped at gross − SSS − PhilHealth − WTax', T.d(HOURLY, 'B').salaryDeduction, 13000 - 800 - 267.45);
  vm.runInContext("_sdDueB = {};", ctx);

  console.log('\n7 · the state comes from the approvals ledger');
  const ledger = (rows) => { ctx.apiGetPayrollApprovals = async () => ({ success: true, data: rows }); };
  ledger([{ period: '2026-11-A', status: 'Approved' }, { period: '2026-11-B', status: 'Rejected' }, { period: '2026-11-B', status: 'For Approval' }]);
  let s = await T.read('2026-11-A', '2026-11-B');
  ok('  A approved, B open (rejected + pending are not approved)', s.A === 'approved' && s.B === 'open', s);
  ledger([{ period: '2026-11-B', status: 'Rejected' }, { period: '2026-11-B', status: 'Approved' }]);
  s = await T.read('2026-11-A', '2026-11-B');
  ok('  any Approved submission makes it approved (the server rule)', s.A === 'open' && s.B === 'approved', s);
  ok('  the rows ride along for the employer-share prefill', Array.isArray(s.rows) && s.rows.length === 2);
  ctx.apiGetPayrollApprovals = async () => { throw new Error('timeout'); };
  s = await T.read('2026-11-A', '2026-11-B');
  ok('  a failed read is unknown, never open', s.A === 'unknown' && s.B === 'unknown');
  ctx.apiGetPayrollApprovals = async () => ({ success: false, message: 'no' });
  s = await T.read('2026-11-A', '2026-11-B');
  ok('  a refused read is unknown', s.A === 'unknown' && s.B === 'unknown');
  delete ctx.apiGetPayrollApprovals; delete globalThis.apiGetPayrollApprovals;
  s = await T.read('2026-11-A', '2026-11-B');
  ok('  no such action is unknown', s.A === 'unknown' && s.B === 'unknown');
  ok('  loadPeriod reads it OUTSIDE the pinned Promise.all', /const statesP = _readCutoffStates\(periodA, periodB\);[\s\S]{0,160}\n\s*try \{/.test(SRC) &&
     !/Promise\.all\(\[[^\]]*_readCutoffStates/.test(SRC));
  ok('  and waits for it before the pay grids draw', /await statesP;[\s\S]{0,200}renderPayGrid\('A'\)/.test(SRC));
  ok('  and resets the last period\'s answer first', /_cutoffStateA = null; _cutoffStateB = null;[^\n]*\n\s*const statesP/.test(SRC));
  ok('  the employer share reuses the rows', /_prefillEmployerShare\(periodA, periodB, states\.rows\)/.test(SRC));

  console.log('\n8 · A411 — bonuses, the ₱90,000 cap and Pag-IBIG');
  T.state('open', 'open');
  T.set([HOURLY], HOURS, {}, {}, 2026, '11');
  const incRow = (cat, amt, st) => ({ employee: 'Cruz, Juan', period: '2026-11-B', category: cat, amount: amt, status: st || 'Active' });
  T.inc('B', [incRow('Performance Bonus', 5000)]);
  T.setYtd({});
  let dd = T.d(HOURLY, 'B');
  eq('  gross now carries the bonus', T.slip(HOURLY, 'B').grossPay, 18000);
  eq('  a Performance Bonus is left out of taxable pay', dd.wtaxTaxable, 12200);
  eq('  so WTax is unchanged by it', dd.wtax, 267.45);
  ok('  the tooltip names the tax-free bonus', /= gross less Pag-IBIG, SSS and PhilHealth, less ₱5,000\.00 of bonus\.[\s\S]*Bonuses are tax-free up to ₱90,000 a year with the 13th month\./.test(vm.runInContext('_wtaxTip', ctx)('B', dd)));
  T.inc('B', [incRow('Perfect Attendance', 1000)]);
  eq('  Perfect Attendance too', T.d(HOURLY, 'B').wtaxTaxable, 12200);
  T.inc('B', [incRow('Commission', 5000)]);
  dd = T.d(HOURLY, 'B');
  eq('  a Commission is taxed: taxable 17,200', dd.wtaxTaxable, 17200);
  eq('  WTax = 937.50 + 20% of 533', dd.wtax, 1044.10);
  T.inc('B', [incRow('Sales Incentive', 2000)]);
  eq('  a Sales Incentive is taxed', T.d(HOURLY, 'B').wtaxTaxable, 14200);
  T.inc('B', [incRow('Performance Bonus', 5000, 'Voided')]);
  eq('  a voided bonus is not pay at all', T.d(HOURLY, 'B').wtaxTaxable, 12200);
  T.inc('B', [incRow('Performance Bonus', 10000)]);
  T.setYtd({ 'Cruz, Juan': [{ period: '2026-03-A', amount: 50000 }, { period: '2026-11-A', amount: 35000 }, { period: '2026-11-B', amount: 10000 }] });
  dd = T.d(HOURLY, 'B');
  ok('  earlier bonuses 85,000 → only 5,000 of this 10,000 is tax-free (this cutoff\'s own row not counted twice)',
     dd.wtaxBenefits.free === 5000 && dd.wtaxBenefits.taxed === 5000, dd.wtaxBenefits);
  eq('  so taxable = 12,200 + 5,000', dd.wtaxTaxable, 17200);
  ok('  the tooltip says the excess is taxed', /₱5,000\.00 of bonus is over this year's ₱90,000 and is taxed\./.test(vm.runInContext('_wtaxTip', ctx)('B', dd)));
  T.setYtd({ 'Cruz, Juan': [{ period: '2026-01-A', amount: 95000 }] });
  eq('  past the cap: the whole bonus is taxed', T.d(HOURLY, 'B').wtaxTaxable, 22200);
  T.setYtd(null);
  dd = T.d(HOURLY, 'B');
  ok('  ledger unreadable → the bonus is taxed, and the tooltip says so', dd.wtaxTaxable === 22200 &&
     /could not be read/.test(vm.runInContext('_wtaxTip', ctx)('B', dd)), dd.wtaxBenefits);
  T.inc('B', []); T.setYtd({});
  // Pag-IBIG: a voluntary 500 on cutoff A — only 200 comes off taxable pay
  const VOL = Object.assign({}, HOURLY, { hdmfAmount: 500 });
  T.set([VOL], HOURS, {}, {}, 2026, '11');
  const dv = T.d(VOL, 'A');
  eq('  Pag-IBIG 500 is still DEDUCTED in full', dv.pagibig, 500);
  eq('  but only the mandatory 200 lowers taxable pay', dv.wtaxTaxable, T.slip(VOL, 'A').grossPay - 200);
  ok('  and the tooltip says why', /Pag-IBIG above ₱200 is voluntary and stays taxable\./.test(vm.runInContext('_wtaxTip', ctx)('A', dv)));
  // the ledger read
  ctx.apiGetPayrollIncentives = async () => ({ success: true, data: [
    { employee: 'A', period: '2026-03-A', category: 'Performance Bonus', amount: 1000 },
    { employee: 'A', period: '2026-04-B', category: 'Commission', amount: 9000 },
    { employee: 'A', period: '2025-12-B', category: 'Performance Bonus', amount: 7000 },
    { employee: 'A', period: '2026-05-A', category: 'Perfect Attendance', amount: 500, status: 'Voided' },
    { employee: 'B', period: '2026-06-B', category: 'Perfect Attendance', amount: 300 } ] });
  const y = await T.ytd(2026);
  ok('  the year read keeps only this year\'s live bonus-type rows', JSON.stringify(y) ===
     JSON.stringify({ A: [{ period: '2026-03-A', amount: 1000 }], B: [{ period: '2026-06-B', amount: 300 }] }), y);
  ctx.apiGetPayrollIncentives = async () => { throw new Error('x'); };
  ok('  a failed read is null (unknown)', (await T.ytd(2026)) === null);
  ok('  loadPeriod reads it beside the approvals, outside the pinned Promise.all, before the grids',
     /const ytdP = _readBenefitsYtd\(year\);/.test(SRC) && !/Promise\.all\(\[[^\]]*_readBenefitsYtd/.test(SRC) &&
     /_benefitsYtd = await ytdP;[\s\S]{0,300}renderPayGrid\('A'\)/.test(SRC));

  console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ' + N + ' passed'));
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
