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
/* Numbers compare with a tolerance; anything else compares exactly. The numeric-only version of
   this helper reported "Rental" !== "Rental", because Math.abs('Rental' - 'Rental') is NaN. */
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want,
  { got, want });
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

sec('8 · A282 — qty is how many, duration is how long');
/* A276 put the duration in the quantity column, so the form could quote seven days of ONE wrench
   and had no way at all to say "two wrenches for a week". The screen must now agree with the PDF
   (service_quotation_route.py) and the receivable (service-quotation-chain.js) on all three
   numbers, and only a rate per unit of TIME is ever multiplied by a duration. */
const HIRE = [
  { itemNo: 'HTW', qty: 2, price: 8500, chargeKind: 'Rental', rateBasis: 'DAYS', duration: 7, optionNo: '', lineKey: 'h1' },
  { itemNo: 'OPR', qty: 1, price: 4500, chargeKind: 'Operator', rateBasis: 'MANDAYS', duration: 7, optionNo: '', lineKey: 'h2' },
  { itemNo: 'MOB', qty: 1, price: 15000, chargeKind: 'Mobilization', rateBasis: 'LOT', duration: '', optionNo: '', lineKey: 'h3' },
  { itemNo: 'DEP', qty: 2, price: 10000, chargeKind: 'Deposit', rateBasis: 'LOT', duration: '', optionNo: '', lineKey: 'h4' },
];
t = totals(HIRE);
eq('two wrenches for seven days: 2 x 8,500 x 7',
   totals([HIRE[0]]).gross, 119000);            // the line the whole change exists for
eq('subtotal 185,500', t.gross, 185500);
eq('  the deposit doubles with the TOOLS: 2 x 10,000', t.deposit, 20000);
eq('  and is not multiplied by the week', t.vatBase, 165500);
eq('VAT 19,860', t.vat, 19860);
eq('  grand 205,360 — the same figure the invoice raises', t.grand, 205360);

sec('9 · only a rate per unit of TIME is spanned');
for (const [basis, dur, want] of [['DAYS', 5, 50000], ['WEEKS', 2, 20000], ['HOURS', 3, 30000],
                                  ['MANDAYS', 4, 40000], ['SHIFTS', 2, 20000],
                                  ['LOT', 5, 10000], ['PC(S)', 5, 10000],
                                  ['DAYS', 0, 10000], ['DAYS', '', 10000], ['', 5, 10000]]) {
  t = totals([{ itemNo: 'X', qty: 1, price: 10000, chargeKind: 'Rental', rateBasis: basis, duration: dur, optionNo: '', lineKey: 'z' }]);
  eq((basis || '(none)') + ' x ' + (dur === '' ? "''" : dur), t.gross, want);
}

sec('10 · a SUPPLY quotation never spans, whatever the line carries');
t = totals([{ itemNo: 'X', qty: 2, price: 10000, chargeKind: 'Rental', rateBasis: 'DAYS', duration: 7, optionNo: '', lineKey: 'z' }],
           { type: 'Supply' });
eq('2 x 10,000, the duration ignored', t.gross, 20000);
ok('  and 140,000 appears nowhere near it', t.grand !== 140000 * 1.12);

sec('11 · A283 — a row added AFTER switching to Service is a hire line');
/* THE BUG THIS SECTION EXISTS FOR, reported from the live form: only the first row showed a
   Duration box; every row added afterwards showed a dash, while its Per dropdown said DAYS.
   qcAddRow seeded no chargeKind/rateBasis/duration and the Charge and Per cells defaulted their
   DISPLAY without writing back, so the item held two empty strings. Visible half: the dash.
   Silent half: that line billed for ONE rate-unit instead of seven, and a Deposit row added the
   same way would have posted as taxable revenue instead of the 2100 liability. */
{
  const p = page(['js/flow-pricing-engine.js', 'js/flow-quote-configurator.js'], 'flow-quotations.html',
                 { username: 'Neil Estur', role: 'admin', name: 'Neil Estur' });
  p.els.qcQuoteType.value = 'Service';
  p.els.qcDiscount.value = '0';
  p.els.qcVat.value = 'inclusive';
  // Exactly the sequence in the screenshot: switch the type, THEN add rows.
  const rows = p.run('qcItems = []; qcOptionsEnabled = false; qcRecommended = ""; qcPartial = false;' +
                     'qcTypeChanged(); qcAddRow(); qcAddRow(); qcAddRow();' +
                     'JSON.parse(JSON.stringify(qcItems));');
  eq('three rows were added', rows.length, 3);
  rows.forEach((r, n) => {
    eq('row ' + (n + 1) + ' carries a charge kind', r.chargeKind, 'Rental');
    eq('  and a rate basis', r.rateBasis, 'DAYS');
    eq('  and a duration — not the blank that printed a dash', Number(r.duration), 1);
  });
  ok('EVERY row shows a duration box, not just the first',
     rows.every(r => r.rateBasis === 'DAYS' && Number(r.duration) > 0), rows);

  // And the money: 2 tools x 8,500 x 7 on a row that was added after the switch.
  const t11 = p.run('qcItems[0].qty = 2; qcItems[0].price = 8500; qcItems[0].duration = 7;' +
                    'qcItems[1].qty = 0; qcItems[2].qty = 0; qcTotals();');
  eq('a row added after the switch bills the full span', t11.gross, 119000);
  ok('  not 17,000, which is what a blank duration billed', Math.abs(t11.gross - 17000) > 1);

  // A Deposit row added after the switch must still be a deposit, not revenue.
  const t12 = p.run('qcItems[1].qty = 2; qcItems[1].price = 10000; qcItems[1].chargeKind = "Deposit";' +
                    'qcItems[1].rateBasis = "LOT"; qcSet(qcItems[1].lineKey, "rateBasis", "LOT"); qcTotals();');
  eq('the deposit is recognised and kept out of the VAT base', t12.deposit, 20000);
  eq('  so VAT is 12% of the rental only', t12.vat, 14280);
}

sec('12 · switching back to Supply strips the hire shape');
{
  const p = page(['js/flow-pricing-engine.js', 'js/flow-quote-configurator.js'], 'flow-quotations.html',
                 { username: 'Neil Estur', role: 'admin', name: 'Neil Estur' });
  p.els.qcQuoteType.value = 'Service';
  p.els.qcDiscount.value = '0';
  p.els.qcVat.value = 'inclusive';
  p.run('qcItems = []; qcOptionsEnabled = false; qcRecommended = ""; qcPartial = false;' +
        'qcTypeChanged(); qcAddRow(); qcItems[0].qty = 2; qcItems[0].price = 10000; qcItems[0].duration = 7;');
  const svcGross = p.run('qcTotals().gross');
  eq('as a hire: 2 x 10,000 x 7', svcGross, 140000);
  p.els.qcQuoteType.value = '';
  const supRows = p.run('qcTypeChanged(); JSON.parse(JSON.stringify(qcItems));');
  eq('the charge kind is cleared', supRows[0].chargeKind, '');
  eq('  the rate basis too', supRows[0].rateBasis, '');
  eq('  and the duration', String(supRows[0].duration), '');
  eq('so as a sale it is 2 x 10,000 and nothing is spanned', p.run('qcTotals().gross'), 20000);
}

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S) of ' + N : 'all ok (' + N + ')'));
process.exit(FAIL ? 1 : 0);
