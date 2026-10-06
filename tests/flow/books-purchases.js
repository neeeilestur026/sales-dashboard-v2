/* A320 — the books, purchases side: the advances model, through the real FlowAPI.gs.
 *
 * Run:  node tests/flow/books-purchases.js
 *
 * The rules pinned here (the independent review's worked example):
 *   USD 10,000 PO estimated at 56. 50% paid before receipt at 57 (+ ₱500 charge), goods received at
 *   56.5, the balance paid at 58.
 *   1. A PO posts nothing. A payment before receipt is an advance (1460) at the pesos the bank took;
 *      the bank charge is ours (6330), never the supplier's.
 *   2. Receiving books stock = the advances it uses (historical pesos) + the rest at the receipt rate:
 *      285,000 + 5,000 × 56.5 = 567,500; the unadvanced part is the payable (2010, FC and pesos).
 *      The inventory sheet is costed by the SAME computation (no paid-fraction trap).
 *   3. Paying after receipt clears 2010 at its carrying pesos; the difference is realised FX (7010/4520).
 *      Nothing is ever pushed into FX that belongs in stock.
 *   4. A short shipment leaves the unused advance on 1460 (for a person), never in FX.
 *   5. VAT: an import's VAT needs its import entry and goes 1500 (VAT-IMP) / 2050; a local supplier's VAT is
 *      claimed only with TIN + SI no. and comes out of the cost; otherwise it is refused (leave it at 0).
 *   6. A foreign receipt without a rate takes the PO's rate and asks a person to confirm it.
 *   7. With the books on: mark-paid needs the company account, the value date and (foreign) the pesos
 *      debited; AP Aging is no second door to pay; reversing a receiving reverses its entry.
 *   8. With the books off, receiving behaves exactly as before.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);
const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };

function pr(no, poNo, cur, amount, est) {
  return { 'PR No': no, 'Type': 'PO', 'PO No': poNo, 'SO No': 'SO-1', 'Supplier': 'Enerpac Asia', 'Payee': 'Enerpac Asia', 'Currency': cur,
           'Amount': amount, 'Purpose': 'PO payment', 'Payment Method': 'Telegraphic Transfer', 'Status': 'Approved', 'Amount (PHP) Est': est || '' };
}
function boot(mode, extra) {
  const store = Object.assign({
    FlowSettings: mode ? [{ Key: 'booksEngine', Value: mode }] : [],
    Inventory: [{ 'Item No': 'PE-55', 'Description': 'Hydraulic pump', 'Available Balance': 0, 'Purchase Price/Unit': 0, 'Shipping Cost/Unit': 0,
                  'Landed Cost/Unit': 0, 'Total Landed Cost': 0, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-00055' },
                { 'Item No': 'CP-10', 'Description': 'CEJN coupler', 'Available Balance': 0, 'Purchase Price/Unit': 0, 'Shipping Cost/Unit': 0,
                  'Landed Cost/Unit': 0, 'Total Landed Cost': 0, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-00010' }],
    PurchaseOrders: [{ 'PO No': 'PO-USD', 'SO No': 'SO-1', 'Date': '2026-03-01', 'Supplier': 'Enerpac Asia', 'Currency': 'USD', 'Total Purchase (FC)': 10000, 'Status': 'Approved', 'Exchange Rate': 56, 'Total (PHP) Est': 560000 },
                     { 'PO No': 'PO-PHP', 'SO No': 'SO-2', 'Date': '2026-03-01', 'Supplier': 'Local Hose Co', 'Currency': 'PHP', 'Total Purchase (FC)': 100000, 'Status': 'Approved', 'Exchange Rate': 1 }],
    PurchaseOrderItems: [], APAging: [
      { 'AP No': 'AP-1', 'PO No': 'PO-USD', 'Supplier': 'Enerpac Asia', 'Currency': 'USD', 'Amount (FC)': 10000, 'Amount (PHP)': 560000, 'Status': 'Unpaid', 'Paid (PHP)': 0 },
      { 'AP No': 'AP-2', 'PO No': 'PO-PHP', 'Supplier': 'Local Hose Co', 'Currency': 'PHP', 'Amount (FC)': 100000, 'Amount (PHP)': 100000, 'Status': 'Unpaid', 'Paid (PHP)': 0 }],
    PaymentRequests: [pr('PRF-1', 'PO-USD', 'USD', 5000, 280000), pr('PRF-2', 'PO-USD', 'USD', 5000, 280000), pr('PRF-3', 'PO-PHP', 'PHP', 100000)],
    Documents: ['PRF-1', 'PRF-2', 'PRF-3'].map(n => ({ 'Module': 'Payment Request', 'Ref No': n, 'Doc Type': 'Proof of Payment' })),
    MaterialsReceiving: [], ReceivingItems: [], Journal: [], ActivityLog: [], Shipments: []
  }, extra || {});
  return { ctx: load(undefined, store), store };
}
const GLa = (store, acct) => (store.GL || []).filter(g => g.Account === acct);
const net = (store, acct) => Math.round(GLa(store, acct).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0) * 100) / 100;
const balanced = (store) => Math.abs((store.GL || []).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0)) < 0.005;
const pay = (ctx, prNo, extra) => call(ctx, 'markPaymentRequestPaid', Object.assign({ prNo, paidFrom: 'AUB' }, ACC, extra));
const receive = (ctx, poNo, items, extra) => call(ctx, 'createReceiving', Object.assign({ poNo, supplier: poNo === 'PO-USD' ? 'Enerpac Asia' : 'Local Hose Co',
  currency: poNo === 'PO-USD' ? 'USD' : 'PHP', date: '2026-04-10', confirmNoDocs: true, items: JSON.stringify(items) }, ACC, extra));
const PUMPS = (qty) => [{ itemNo: 'PE-55', itemName: 'Hydraulic pump', qty, price: 100, itemId: 'ITM-00055' }];

sec('1–3 · the worked example');
{
  const { ctx, store } = boot('shadow');
  let r = call(ctx, 'createPurchaseOrder', Object.assign({}, ACC));
  ok('(a PO posts nothing to the books)', !(store.GL || []).length);
  r = pay(ctx, 'PRF-1', { actualDebitedPHP: 285500, bankChargePHP: 500, valueDate: '2026-03-05' });
  ok('the 50% advance is paid', r.success, r);
  eq('  1460 advance at the pesos the bank took, net of its charge', net(store, '1460'), 285000);
  ok('  carried in USD too', GLa(store, '1460')[0]['FC Currency'] === 'USD' && GLa(store, '1460')[0]['FC Amount'] === 5000);
  eq('  the bank charge is ours', net(store, '6330'), 500);
  eq('  AUB pays the lot', net(store, '1022'), -285500);
  ok('  dated by the value date, tagged with the PO', GLa(store, '1460')[0].Date === '2026-03-05' && GLa(store, '1460')[0]['PO No'] === 'PO-USD');
  r = receive(ctx, 'PO-USD', PUMPS(100), { receiptRate: 56.5, additional: true });
  ok('the goods are received at 56.5', r.success, r);
  eq('  stock = 285,000 advanced + 5,000 × 56.5', net(store, '1300'), 567500);
  eq('  the advance is used up', net(store, '1460'), 0);
  eq('  the payable is the unadvanced half at the receipt rate', net(store, '2010'), -282500);
  ok('  carried as USD 5,000', GLa(store, '2010').some(g => g['FC Amount'] === 5000 && g.Rate === 56.5));
  const inv = store.Inventory.find(i => i['Item ID'] === 'ITM-00055');
  eq('  the inventory sheet agrees: 5,675 a unit', Number(inv['Landed Cost/Unit']), 5675);
  eq('  and in total', Number(inv['Total Landed Cost']), 567500);
  r = pay(ctx, 'PRF-2', { actualDebitedPHP: 290000, valueDate: '2026-04-20' });
  ok('the balance is paid at 58', r.success, r);
  eq('  the payable is cleared at its carrying pesos', net(store, '2010'), 0);
  eq('  the 7,500 difference is realised FX loss', net(store, '7010'), 7500);
  eq('  stock is untouched by the payment', net(store, '1300'), 567500);
  ok('  balanced', balanced(store));
}

sec('4 · a short shipment leaves the advance for a person, never in FX');
{
  const { ctx, store } = boot('shadow');
  pay(ctx, 'PRF-1', { actualDebitedPHP: 285000, valueDate: '2026-03-05' });
  receive(ctx, 'PO-USD', PUMPS(30), { receiptRate: 56.5, additional: true });
  eq('only 3,000 of the 5,000 advanced is used (at its historical rate)', net(store, '1460'), 114000);
  eq('  stock 3,000 × 57', net(store, '1300'), 171000);
  eq('  no payable', net(store, '2010'), 0);
  eq('  no FX', net(store, '7010') + net(store, '4520'), 0);
}

sec('nothing paid before receipt; a peso PO');
{
  const { ctx, store } = boot('shadow');
  let r = receive(ctx, 'PO-PHP', [{ itemNo: 'CP-10', itemName: 'CEJN coupler', qty: 50, price: 2000, itemId: 'ITM-00010' }]);
  ok('received with nothing paid (no ₱0-cost trap with the books on)', r.success, r);
  eq('  stock at the PO price', net(store, '1300'), 100000);
  eq('  all of it payable', net(store, '2010'), -100000);
  eq('  the inventory sheet agrees', Number(store.Inventory.find(i => i['Item ID'] === 'ITM-00010')['Landed Cost/Unit']), 2000);
  r = pay(ctx, 'PRF-3', { valueDate: '2026-04-25' });
  ok('paid later', r.success, r);
  eq('  the payable clears with no FX', net(store, '2010'), 0);
  eq('  no FX on a peso PO', net(store, '7010') + net(store, '4520'), 0);
}

sec('5 · VAT and charges');
{
  const { ctx, store } = boot('shadow');
  let r = receive(ctx, 'PO-USD', PUMPS(10), { receiptRate: 56.5, vat: 12000, duties: 3000 });
  ok('import VAT without its import entry is refused', !r.success && /IEIRD/.test(r.message), r);
  r = receive(ctx, 'PO-USD', PUMPS(10), { receiptRate: 56.5, vat: 12000, duties: 3000, delivery: 2000, importEntryNo: 'C-2026-0011', dutiableValue: 56500 });
  ok('with it, received', r.success, r);
  eq('  import VAT to 1500', net(store, '1500'), 12000);
  ok('  tagged VAT-IMP with the dutiable value', GLa(store, '1500')[0]['Tax Code'] === 'VAT-IMP' && GLa(store, '1500')[0]['Tax Base'] === 56500);
  eq('  duties + delivery + VAT wait in 2050 for the broker payment', net(store, '2050'), -17000);
  eq('  stock includes the duties and delivery, not the VAT', net(store, '1300'), 56500 + 5000);
  const b = boot('shadow');
  r = receive(b.ctx, 'PO-PHP', [{ itemNo: 'CP-10', itemName: 'CEJN coupler', qty: 50, price: 2240, itemId: 'ITM-00010' }], { vat: 12000 });
  ok('local VAT without TIN and SI no. is refused', !r.success && /TIN/.test(r.message), r);
  r = receive(b.ctx, 'PO-PHP', [{ itemNo: 'CP-10', itemName: 'CEJN coupler', qty: 50, price: 2240, itemId: 'ITM-00010' }], { vat: 12000, supplierTin: '123-456-789-00000', siNo: 'SI 0042' });
  ok('with them, received', r.success, r);
  eq('  VAT claimed', net(b.store, '1500'), 12000);
  eq('  and taken out of the cost (112,000 − 12,000)', net(b.store, '1300'), 100000);
  eq('  the inventory sheet agrees', Number(b.store.Inventory.find(i => i['Item ID'] === 'ITM-00010')['Total Landed Cost']), 100000);
  eq('  nothing in 2050 (the VAT was inside the price)', net(b.store, '2050'), 0);
}

sec('6 · a foreign receipt without a rate');
{
  const { ctx, store } = boot('shadow');
  const r = receive(ctx, 'PO-USD', PUMPS(10));
  ok('takes the PO rate', r.success && net(store, '2010') === -56000, r);
  ok('  and asks a person to confirm it', store.GLInbox.some(i => i.Reason === 'receipt rate to confirm' && i['Source No'] === r.mrNo));
}

sec('7 · books-on guards');
{
  const { ctx, store } = boot('shadow');
  let r = call(ctx, 'markPaymentRequestPaid', Object.assign({ prNo: 'PRF-1', actualDebitedPHP: 285000, valueDate: '2026-03-05' }, ACC));
  ok('mark-paid needs the company account', !r.success && /account this was paid from/.test(r.message), r);
  r = pay(ctx, 'PRF-1', { actualDebitedPHP: 285000 });
  ok('  and the value date', !r.success && /value date/.test(r.message), r);
  r = pay(ctx, 'PRF-1', { valueDate: '2026-03-05', confirmNoActual: true });
  ok('  and, for a foreign payment, the pesos debited (no estimate)', !r.success && /actually debited/.test(r.message), r);
  r = call(ctx, 'updateAPAging', Object.assign({ rowIndex: 2, apNo: 'AP-1', paidPHP: 1000, externalPayment: true, externalPaymentReason: 'paid outside' }, ACC));
  ok('AP Aging is no second door to pay', !r.success && /payment request/.test(r.message), r);
  const rc = receive(ctx, 'PO-USD', PUMPS(10), { receiptRate: 56.5 });
  r = call(ctx, 'reverseReceiving', Object.assign({ mrNo: rc.mrNo, confirmReverse: true }, ACC));
  ok('reversing a receiving reverses its entry', r.success && net(store, '1300') === 0 && net(store, '2010') === 0, [r, net(store, '1300')]);
}

sec('8 · books off: receiving as before');
{
  const { ctx, store } = boot();
  store.APAging[0]['Paid (PHP)'] = 285000;
  const r = receive(ctx, 'PO-USD', PUMPS(100), { confirmPartialPay: true });
  ok('received the old way', r.success, r);
  eq('  costed at the paid fraction, exactly as before', Number(store.Inventory.find(i => i['Item ID'] === 'ITM-00055')['Landed Cost/Unit']), 2850);
  ok('  nothing in the books', !(store.GL || []).length);
  ok('  the partial-payment question is still asked', !receive(ctx, 'PO-USD', PUMPS(1), { additional: true }).success);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
