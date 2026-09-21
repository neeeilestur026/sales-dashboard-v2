/* A281 — THE SCREEN MUST QUOTE WHAT THE INVOICE WILL BILL.
 *
 * Run:  node tests/flow/quotation-deposit-vat.js
 *
 * A refundable deposit is the client's own money held against damage, not consideration for a
 * supply, so no output VAT arises on it. createInvoice has worked that way since A278 and
 * service-invoice.js pins it there. The quote configurator did not: qcTotals() VATed the whole
 * subtotal, so a hire with a 20,000 deposit was QUOTED 13,320 of VAT and would be BILLED 10,920 —
 * a discrepancy on the document the client keeps, discovered in the browser and invisible to every
 * server-side test in the suite because the server was already right.
 *
 * There are three places the same 12% is computed for one quotation — qcTotals(), the per-option
 * rows beneath it, and build_summary_table in the PDF. This file holds the first two; the route
 * test (service_quotation_route.py) holds the third. All three must agree on every case here.
 *
 * Figures: the A276 sample, 190,000 of revenue, plus a 20,000 refundable deposit.
 */
const { page } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + want, Math.abs(got - want) < 0.005, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const LINES = [
  { itemNo: 'HTW-3000', qty: 7, price: 8500, chargeKind: 'Rental', optionNo: '', lineKey: 'k1' },
  { itemNo: 'HP-700', qty: 7, price: 12000, chargeKind: 'Rental', optionNo: '', lineKey: 'k2' },
  { itemNo: 'OPR', qty: 7, price: 4500, chargeKind: 'Operator', optionNo: '', lineKey: 'k3' },
  { itemNo: 'MOB', qty: 1, price: 15000, chargeKind: 'Mobilization', optionNo: '', lineKey: 'k4' },
  { itemNo: 'DEP', qty: 1, price: 20000, chargeKind: 'Deposit', optionNo: '', lineKey: 'k5' },
];

/** Boot the real configurator, then set the state the form would be in. */
function totals(items, { type = 'Service', discount = 0, vat = 'inclusive', options = false, rec = '' } = {}) {
  const p = page(['js/flow-pricing-engine.js', 'js/flow-quote-configurator.js'], 'flow-quotations.html',
                 { username: 'Neil Estur', role: 'admin', name: 'Neil Estur' });
  p.els.qcQuoteType.value = type;
  p.els.qcDiscount.value = String(discount);
  p.els.qcVat.value = vat;
  p.ctx.__items = items;
  return p.run(
    'qcItems = __items; qcOptionsEnabled = ' + JSON.stringify(options) +
    '; qcRecommended = ' + JSON.stringify(rec) + '; qcPartial = false; qcTotals();');
}

sec('1 · a hire with a refundable deposit');
let t = totals(LINES);
eq('subtotal is the whole of it', t.gross, 210000);
eq('  VAT is charged on the 190,000 that is revenue', t.vatBase, 190000);
eq('  so VAT is 22,800', t.vat, 22800);
ok('  and NOT 25,200 — the bug this file exists for', Math.abs(t.vat - 25200) > 1);
eq('the client still pays the deposit: grand total 232,800', t.grand, 232800);
eq('  the deposit is reported for the row that explains the gap', t.deposit, 20000);

sec('2 · the same lines as a SUPPLY quotation are untouched');
t = totals(LINES, { type: 'Supply' });
eq('no charge kinds exist there, so VAT is on all of it', t.vat, 25200);
eq('  and nothing is set aside', t.deposit, 0);
eq('  grand total 235,200', t.grand, 235200);

sec('3 · a hire with no deposit line computes exactly what it always did');
t = totals(LINES.slice(0, 4));
eq('VAT on the full 190,000', t.vat, 22800);
eq('  total 212,800 — the A276 sample, unchanged', t.grand, 212800);
eq('  deposit 0, so the label stays plain', t.deposit, 0);

sec('4 · a quotation discount comes off the VAT base too');
t = totals(LINES, { discount: 10 });
eq('net 189,000', t.net, 189000);
eq('  base 171,000 — 10% off the revenue, not off the subtotal', t.vatBase, 171000);
eq('  VAT 20,520', t.vat, 20520);
eq('  grand 209,520', t.grand, 209520);
ok('  this is what the PDF prints: see service_quotation_route.py', true);

sec('5 · VAT-exclusive and zero-rated are unaffected');
for (const opt of ['exclusive', 'zero']) {
  t = totals(LINES, { vat: opt });
  eq(opt + ': no VAT at all', t.vat, 0);
  eq('  grand = net', t.grand, 210000);
}

sec('6 · options — a deposit inside a losing option is not in any figure');
const OPT = [
  { itemNo: 'A1', qty: 7, price: 10000, chargeKind: 'Rental', optionNo: '1', lineKey: 'o1' },
  { itemNo: 'A2', qty: 1, price: 5000, chargeKind: 'Deposit', optionNo: '1', lineKey: 'o2' },
  { itemNo: 'B1', qty: 7, price: 12000, chargeKind: 'Rental', optionNo: '2', lineKey: 'o3' },
  { itemNo: 'B2', qty: 1, price: 30000, chargeKind: 'Deposit', optionNo: '2', lineKey: 'o4' },
  { itemNo: 'MOB', qty: 1, price: 15000, chargeKind: 'Mobilization', optionNo: '', lineKey: 'o5' },
];
t = totals(OPT, { options: true, rec: '2' });
eq('the recommended option plus the base line', t.gross, 84000 + 30000 + 15000);
eq('  its deposit is excluded, the losing one is not counted at all', t.vatBase, 84000 + 15000);
eq('  VAT 11,880', t.vat, 11880);
ok('both option groups are still listed', t.groups.length === 2);
eq('  option 1 carries its own deposit', t.groups[0].deposit, 5000);
eq('  option 2 carries its own', t.groups[1].deposit, 30000);

sec('7 · the shape qcRenderTotals draws from');
t = totals(LINES);
ok('vatBase is exposed so the row can name it', typeof t.vatBase === 'number');
ok('deposit is exposed so the row can be conditional', typeof t.deposit === 'number');
ok('every key the renderer already used survives',
   ['gross', 'pct', 'discount', 'net', 'vat', 'grand', 'opt', 'groups', 'rec'].every(k => k in t),
   Object.keys(t));

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S) of ' + N : 'all ok (' + N + ')'));
process.exit(FAIL ? 1 : 0);
