/* A398 — the TYPE of each incentive is printed on the payslip and on the payroll PDF.
 *
 * Run:  node tests/flow/incentive-type.js
 *
 * Neil, 13 Nov 2026: "when added an incentive there is a type of incentive right? make it appear on
 * the exported pdf of the payroll and also on the payslip of the person with incentive". The type
 * ("What is it for") has been stored with every incentive since A229; only the total was printed.
 *
 * Pinned here:
 *   1. The lines come from the same ledger rows as the total: voided rows never print, two entries
 *      of one type print as one line, and the order is the order they were given.
 *   2. The payslip prints one "Incentive: <type>" line per type, and the lines add up to the total.
 *      No incentive, or a payslip released before A398 (no lines), prints the single line as before;
 *      lines that do not add up also fall back to it.
 *   3. The released slip carries the lines, so the employee's own copy shows the types too.
 *   4. The payroll PDF names the types under the Incentive amount and lists every incentive with
 *      its type, what it is for and its amount; with no incentives the PDF has no such table.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });

const D = path.join(__dirname, '../../dashboard/');
const DH = fs.readFileSync(D + 'js/director-home.js', 'utf8');
const PS = fs.readFileSync(D + 'js/payslip.js', 'utf8');

const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  setAttribute() {}, getAttribute: () => null });
const ctx = { console, alert() {},
  document: { addEventListener() {}, getElementById: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el() },
  localStorage: { getItem: () => null, setItem() {} }, location: { origin: 'http://localhost' }, window: {} };
vm.createContext(ctx);
require('./hxutil').load(ctx);
vm.runInContext(PS, ctx);
vm.runInContext(DH + `
this.__t = { set(emps, hours, reg, y, m) { _employees = emps; _hoursA = hours; _hoursB = hours; _holidaysA = {}; _holidaysB = {};
  _registerA = reg; _registerB = reg; _currentYear = y; _currentMonth = m; },
  apply: _applyIncentives, lines: _incentiveLinesFor, items: _incentiveItemsFor, total: _incentiveFor,
  compute: _computePaySlip, period: _payslipPeriod, slipHtml: _payslipHtml, shared: hxPayslipHtml,
  cutoff: _buildCutoffHtml, releaseRows: _releaseRows };`, ctx);
const T = ctx.__t;

const GERALD = { firstName: 'Gerald', lastName: 'Lucena', dailyRate: 575, otherIncome: 0, hdmfAmount: 200, sssAmount: 600, philhealthAmount: 200 };
const KIM = { firstName: 'Kimberlyn', lastName: 'Blones', dailyRate: 575, otherIncome: 0, hdmfAmount: 200, sssAmount: 600, philhealthAmount: 200 };
const H = (who, d, hrs) => ({ [who + '|2026-11-' + d]: { employee: who, date: '2026-11-' + d, dayType: 'Regular', hours: hrs } });
T.set([GERALD, KIM], Object.assign({}, H('Lucena, Gerald', '12', 8), H('Lucena, Gerald', '13', 8), H('Blones, Kimberlyn', '12', 8)), {}, 2026, '11');

/* The server lists newest first (handleGetPayrollIncentives reverses the sheet). */
const inc = (id, emp, amount, category, reason, status) => ({ incentiveId: id, period: '2026-11-B', cutoff: 'B', employee: emp,
  amount, category, reason, status: status || 'Active' });
T.apply('B', [
  inc('INC-4', 'Lucena, Gerald', 250, 'Perfect Attendance', 'second week too'),
  inc('INC-3', 'Lucena, Gerald', 999, 'Referral', 'typo', 'Voided'),
  inc('INC-2', 'Lucena, Gerald', 2000, 'Sales Incentive', 'closed <Therma> order'),
  inc('INC-1', 'Lucena, Gerald', 500, 'Perfect Attendance', 'no absences'),
]);

console.log('\n1 · the lines come from the ledger rows behind the total');
eq('the total still sums the active rows', T.total('Lucena, Gerald', 'B'), 2750);
eq('every active incentive, oldest first, voided left out', T.items('Lucena, Gerald', 'B').map(i => i.category + ' ' + i.amount),
   ['Perfect Attendance 500', 'Sales Incentive 2000', 'Perfect Attendance 250']);
eq('one line per type, in the order first given', T.lines('Lucena, Gerald', 'B'),
   [{ category: 'Perfect Attendance', amount: 750 }, { category: 'Sales Incentive', amount: 2000 }]);
eq('nobody else is touched', T.lines('Blones, Kimberlyn', 'B'), []);
eq('the other cutoff has none', T.lines('Lucena, Gerald', 'A'), []);
T.apply('A', [inc('INC-9', 'Lucena, Gerald', 300, '', '')]);
eq('a row with no type prints as Other', T.lines('Lucena, Gerald', 'A'), [{ category: 'Other', amount: 300 }]);
T.apply('A', []);

console.log('\n2 · the payslip prints each type');
const s = T.compute(GERALD, 'B'), pr = T.period('B');
eq('the computed slip carries the lines', s.incentiveLines, [{ category: 'Perfect Attendance', amount: 750 }, { category: 'Sales Incentive', amount: 2000 }]);
eq('  and the total it always had', s.incentive, 2750);
const html = T.slipHtml(GERALD, 'B');
ok('"Incentive: Perfect Attendance" ₱750.00', /<td class="l">Incentive: Perfect Attendance<\/td><td class="r">₱750\.00<\/td>/.test(html), html.slice(html.indexOf('Earnings'), html.indexOf('GROSS')));
ok('"Incentive: Sales Incentive" ₱2,000.00', /<td class="l">Incentive: Sales Incentive<\/td><td class="r">₱2,000\.00<\/td>/.test(html));
ok('  and no bare "Incentive" line beside them', !/<td class="l">Incentive<\/td>/.test(html));
ok('  the voided Referral is not on it', !/Referral/.test(html));
ok('  nor any reason (the reason stays in the director\'s history)', !/no absences|Therma/.test(html));
ok('  in the Earnings block, before GROSS PAY', html.indexOf('Incentive: Perfect') > html.indexOf('Other Income') && html.indexOf('Incentive: Sales') < html.indexOf('GROSS PAY'));
const kimHtml = T.slipHtml(KIM, 'B');
ok('no incentive: the single "Incentive ₱0.00" line, as before', /<td class="l">Incentive<\/td><td class="r">₱0\.00<\/td>/.test(kimHtml) && !/Incentive:/.test(kimHtml));
const old = Object.assign({}, s); delete old.incentiveLines;
ok('a payslip released before A398 (no lines) prints the single total', /<td class="l">Incentive<\/td><td class="r">₱2,750\.00<\/td>/.test(T.shared(old, pr)));
const bad = Object.assign({}, s, { incentiveLines: [{ category: 'Sales Incentive', amount: 2000 }] });
ok('lines that do not add up to the total fall back to the single line', /<td class="l">Incentive<\/td><td class="r">₱2,750\.00<\/td>/.test(T.shared(bad, pr)) && !/Incentive:/.test(T.shared(bad, pr)));
const esc = Object.assign({}, s, { incentive: 10, incentiveLines: [{ category: '<b>x</b>', amount: 10 }] });
ok('a type is escaped', /Incentive: &lt;b&gt;x&lt;\/b&gt;/.test(T.shared(esc, pr)));
ok('the label fits the receipt column (29 characters at most for the six types)',
   ['Perfect Attendance', 'Sales Incentive', 'Performance Bonus', 'Commission', 'Referral', 'Other'].every(c => ('Incentive: ' + c).length <= 29));

console.log('\n3 · the employee\'s released copy carries the types');
const rel = T.releaseRows([GERALD], 'B');
eq('the release sends the lines with the figures', rel[0].slip.s.incentiveLines, s.incentiveLines);
ok('  and survives the JSON the server stores', /Incentive: Sales Incentive/.test(T.shared(JSON.parse(JSON.stringify(rel[0].slip.s)), pr)));

console.log('\n4 · the payroll PDF names the types');
const built = T.cutoff('B');
ok('it builds', built && /Payroll Register/.test(built.html));
const reg = built.html.slice(built.html.indexOf('Section 2'), built.html.indexOf('Incentives by type'));
ok('the register cell names the types under the amount', /₱2,750\.00<div class="inc-type">Perfect Attendance<br>Sales Incentive<\/div>/.test(reg), reg.slice(0, 2000));
const tbl = built.html.slice(built.html.indexOf('Incentives by type'), built.html.indexOf('Section 3'));
ok('an "Incentives by type" table follows the register', tbl.length > 0 && /<th>Type<\/th><th>What it is for<\/th>/.test(tbl));
eq('  one row per incentive, voided left out', (tbl.match(/<tr><td class="name">/g) || []).length, 3);
ok('  with its type, what it is for and the amount', /Lucena, Gerald<\/td><td>Sales Incentive<\/td>\s*<td class="why">closed &lt;Therma&gt; order<\/td><td class="num">₱2,000\.00<\/td>/.test(tbl), tbl);
ok('  and the total of the Incentive column', /<td colspan="3">TOTAL<\/td><td class="num">₱2,750\.00<\/td>/.test(tbl));
ok('  the Cost Summary is still Section 3', /<h2>Section 3 — Cutoff Cost Summary<\/h2>/.test(built.html));
T.apply('B', []);
const none = T.cutoff('B');
ok('with no incentives there is no such table and no type line', !/Incentives by type/.test(none.html) && !/<div class="inc-type">/.test(none.html));
ok('  and the PDF is otherwise the same shape', /Section 2 — Payroll Register/.test(none.html) && /Section 3 — Cutoff Cost Summary/.test(none.html));

console.log('\n5 · the director\'s grid says the types on hover');
ok('the Incentive cell carries a title with each type and amount', /const incTip = _incentiveLinesFor\(empName, cutoff\)\.map\(l => `\$\{l\.category\} — \$\{peso\(l\.amount\)\}`\)/.test(DH)
   && /<td class="num computed"\$\{incTip \? ` title="\$\{esc\(incTip\)\}"` : ''\}>/.test(DH));

console.log(FAIL ? `\n${FAIL} FAILED` : '\nall passed');
process.exit(FAIL ? 1 : 0);
