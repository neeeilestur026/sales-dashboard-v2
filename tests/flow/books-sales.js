/* A320 — the books, sales side: invoices and collections post to the GL, through the real FlowAPI.gs.
 *
 * Run:  node tests/flow/books-sales.js
 *
 * The rules pinned here:
 *   1. With the books off nothing changes: a 0% invoice needs no VAT type and nothing reaches the GL.
 *   2. An invoice posts AR gross / sales by VAT type (4000 · 4010 · 4020) / service 4100 / output VAT 2200
 *      / refundable deposit 2100 and per-item COGS against inventory — keyed on a permanent Doc ID, dated
 *      by the invoice, every taxed line tagged with its tax code and base.
 *   3. With the books on, a 0% invoice must say zero-rated or exempt, and a type must agree with the VAT.
 *   4. Renaming moves the number, never the key; a VAT repair re-posts by reversal; a void reverses it at
 *      the original COGS, dated the day of the void.
 *   5. A collection posts bank (where it was deposited) net + 2307 EWT / AR gross, dated by the collection;
 *      with the books on, where it was deposited is required. Corrections and voids reverse.
 *   6. A closed month takes no new invoice or collection.
 *   7. A collection of a migrated 2026 invoice (not in the books) waits in the Inbox; an engine error never
 *      fails the user's action — it is parked in the Inbox instead.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);

const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };
const TOOL = 'HYDRAULIC TORQUE WRENCH';
function boot(mode, extra) {
  const store = Object.assign({
    FlowSettings: mode ? [{ Key: 'booksEngine', Value: mode }] : [],
    Inventory: [{ 'Item No': 'TW-01', 'Description': TOOL, 'Available Balance': 30, 'Purchase Price/Unit': 40000, 'Shipping Cost/Unit': 0,
                  'Landed Cost/Unit': 40000, 'Total Landed Cost': 1200000, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-00001' }],
    SalesOrders: [{ 'SO No': 'SO-001', 'Date': '2026-09-01', 'Customer': 'ACME', 'Status': 'Open', 'Total': 190000, 'Type': '' },
                  { 'SO No': 'SO-H', 'Date': '2026-09-01', 'Customer': 'ACME', 'Status': 'Open', 'Total': 50000, 'Type': 'service' }],
    Clients: [{ 'Customer': 'ACME', 'Payment Terms': '30 days' }],
    Invoices: [], InvoiceItems: [], ARAging: [], Collections: [], Journal: [], ChartOfAccounts: [], ActivityLog: []
  }, extra || {});
  return { ctx: load(undefined, store), store };
}
const inv = (ctx, items, extra) => call(ctx, 'createInvoice', Object.assign(
  { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true, date: '2026-09-10', items: JSON.stringify(items) }, ACC, extra || {}));
const GL = (store, acct) => (store.GL || []).filter(g => g.Account === acct);
const net = (store, acct) => Math.round(GL(store, acct).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0) * 100) / 100;
const balanced = (store) => Math.abs((store.GL || []).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0)) < 0.005;
const WRENCH = [{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 60000, itemId: 'ITM-00001' }];

sec('1 · books off: nothing changes');
{
  const { ctx, store } = boot();
  const r = inv(ctx, WRENCH, { vatRate: 0 });
  ok('a 0% invoice needs no VAT type while the books are off', r.success, r);
  ok('  nothing reaches the GL or the side table', !(store.GL || []).length && !(store.DocMeta || []).length);
  ok('  the legacy journal still posts', store.Journal.some(j => j['Account Code'] === '1200'));
}

sec('2 · an invoice posts to the books');
{
  const { ctx, store } = boot('shadow');
  const r = inv(ctx, WRENCH);
  ok('a 12% invoice posts', r.success, r);
  const meta = store.DocMeta.find(m => m['Source Type'] === 'Invoice' && m['Source No'] === r.invNo);
  ok('  it gets a permanent Doc ID', meta && /^[0-9a-f-]{36}$/.test(meta['Doc ID']), meta);
  const key = 'INV:' + meta['Doc ID'];
  ok('  keyed on the Doc ID, dated by the invoice', store.GL.every(g => g['Event Key'] === key && g.Date === '2026-09-10'));
  eq('  AR gross', net(store, '1200'), 134400);
  eq('  sales 12% VAT', net(store, '4000'), -120000);
  eq('  output VAT', net(store, '2200'), -14400);
  eq('  COGS', net(store, '5000'), 80000);
  eq('  inventory issued', net(store, '1300'), -80000);
  const s = GL(store, '4000')[0], v = GL(store, '2200')[0];
  ok('  the sale and the VAT carry their tax code and base', s['Tax Code'] === 'VAT-12' && s['Tax Base'] === 120000 && v['Tax Code'] === 'VAT-12' && v['Tax Base'] === 120000, [s, v]);
  ok('  COGS carries the item', GL(store, '5000')[0]['Item ID'] === 'ITM-00001');
  ok('  the party and SO are on every line', store.GL.every(g => g.Party === 'ACME' && g['SO No'] === 'SO-001'));
  ok('  balanced', balanced(store));
  ok('  and the legacy journal is untouched in shadow mode', store.Journal.some(j => j['Account Code'] === '4000'));
  const h = inv(ctx, [{ itemNo: 'H-1', itemName: 'Wrench hire', qty: 1, price: 30000, chargeKind: 'Rental', rateBasis: 'per day', duration: 1 },
                      { itemNo: 'DEP', itemName: 'Security deposit', qty: 1, price: 20000, chargeKind: 'Deposit' }], { soNo: 'SO-H', confirmReinvoice: true });
  ok('a hire invoice with a deposit posts', h.success, h);
  const hk = 'INV:' + store.DocMeta.find(m => m['Source No'] === h.invNo)['Doc ID'];
  const hl = store.GL.filter(g => g['Event Key'] === hk);
  ok('  rental revenue to 4100, the deposit to 2100, no COGS', hl.some(g => g.Account === '4100' && g.Credit === 30000) && hl.some(g => g.Account === '2100' && g.Credit === 20000) && !hl.some(g => g.Account === '5000'), hl);
}

sec('3 · VAT type with the books on');
{
  const { ctx, store } = boot('shadow');
  let r = inv(ctx, WRENCH, { vatRate: 0 });
  ok('a 0% invoice without a type is refused', !r.success && /zero-rated or VAT-exempt/.test(r.message), r);
  r = inv(ctx, WRENCH, { vatRate: 0, vatType: 'VAT-0', zeroRatingRef: 'PEZA cert 2026-114' });
  ok('zero-rated posts to 4010 with no output VAT', r.success && net(store, '4010') === -120000 && net(store, '2200') === 0, r);
  ok('  the zero-rating support is kept', store.DocMeta.some(m => m['Zero Rating Ref'] === 'PEZA cert 2026-114'));
  r = inv(ctx, WRENCH, { vatRate: 0, vatType: 'VAT-EX', confirmReinvoice: true });
  ok('exempt posts to 4020', r.success && net(store, '4020') === -120000, r);
  r = inv(ctx, WRENCH, { vatRate: 12, vatType: 'VAT-0', confirmReinvoice: true });
  ok('a zero-rated type with 12% VAT is refused', !r.success, r);
  r = inv(ctx, WRENCH, { vatType: 'VAT-9', confirmReinvoice: true });
  ok('an unknown type is refused', !r.success, r);
}

sec('4 · rename, VAT repair, void');
{
  const { ctx, store } = boot('shadow');
  const r = inv(ctx, WRENCH);
  const docId = store.DocMeta[0]['Doc ID'], key = 'INV:' + docId;
  const before = store.GL.length;
  const rn = call(ctx, 'renameInvoice', Object.assign({ invNo: r.invNo, newInvNo: 'SI-0001' }, ACC));
  ok('the invoice is renamed', rn.success, rn);
  ok('  its books fields follow the new number, same Doc ID', store.DocMeta[0]['Source No'] === 'SI-0001' && store.DocMeta[0]['Doc ID'] === docId);
  ok('  and the alias is kept', store.DocAliases.some(a => a['Old No'] === r.invNo && a['New No'] === 'SI-0001'));
  const again = call(ctx, 'getBooksStatus', Object.assign({}, ACC));
  ctx._BOOKS_CFG = ctx._BOOKS_ACCTS = ctx._BOOKS_PERIODS = ctx._BOOKS_EVX = null;
  const sync = ctx._booksSyncInvoice('SI-0001');
  ok('  re-syncing after the rename changes nothing (same key, same money)', sync && sync.noop, sync);
  eq('  no new GL lines', store.GL.length, before);
  ok('  status still balanced', again.totals.balanced);
  store.Invoices[0]['VAT'] = 0; store.Invoices[0]['VAT Rate'] = 12;   // as if the invoice had been stored net
  ctx._BOOKS_CFG = ctx._BOOKS_ACCTS = ctx._BOOKS_PERIODS = ctx._BOOKS_EVX = null;
  const parked = ctx._booksSyncInvoice('SI-0001');
  ok('a 12% type with no VAT stored disagrees, so it waits for a person', parked && parked.inbox && parked.reason === 'no VAT type', parked);
  store.Invoices[0]['VAT'] = 14400;
  const v = call(ctx, 'voidInvoice', Object.assign({ invNo: 'SI-0001', reason: 'issued to the wrong client' }, ACC));
  ok('voiding works', v.success, v);
  const today = ctx._dateStr(ctx._now());   // the backend's own clock (a test-realm Date is not a vm Date)
  ok('  the reversal is dated today', store.GL.some(g => g['Source Type'] === 'Reversal' && g.Date === today));
  ['1200', '4000', '2200', '5000', '1300'].forEach(a => eq('  ' + a + ' nets to zero', net(store, a), 0));
  eq('  the event is marked reversed', store.EventIndex.find(x => x['Event Key'] === key).Status, 'Reversed');
  ok('  and the Inbox item it had raised closes itself', store.GLInbox.every(i => i.Status !== 'Open'), store.GLInbox.map(i => [i.Reason, i.Status]));
}

sec('5 · collections');
{
  const { ctx, store } = boot('shadow');
  const r = inv(ctx, WRENCH);
  const arNo = store.ARAging[0]['AR No'];
  let c = call(ctx, 'recordCollection', Object.assign({ arNo, amount: 134400, ewt: 1200, date: '2026-10-02', confirmNoDocs: true }, ACC));
  ok('with the books on, where the money went is required', !c.success && /deposited/.test(c.message), c);
  c = call(ctx, 'recordCollection', Object.assign({ arNo, amount: 134400, ewt: 1200, date: '2026-10-02', confirmNoDocs: true, depositedTo: 'METRO_ZAB', chequeNo: '000123' }, ACC));
  ok('a collection posts', c.success, c);
  const cl = store.GL.filter(g => g['Event Key'] === 'COL:' + c.collectionNo);
  ok('  dated by the collection', cl.every(g => g.Date === '2026-10-02'));
  ok('  Metrobank Zabarte gets the net cash', cl.some(g => g.Account === '1020' && g.Debit === 133200), cl);
  ok('  the 2307 EWT goes to 1600 tagged CWT', cl.some(g => g.Account === '1600' && g.Debit === 1200 && g['Tax Code'] === 'CWT'));
  ok('  AR is credited gross', cl.some(g => g.Account === '1200' && g.Credit === 134400));
  eq('  the receivable is cleared in the books', net(store, '1200'), 0);
  ok('  the cheque number is kept', store.DocMeta.some(m => m['Source Type'] === 'Collection' && m['Cheque No'] === '000123'));
  const k = call(ctx, 'correctCollection', Object.assign({ collectionNo: c.collectionNo, amount: 134400, ewt: 2400 }, ACC));
  ok('a correction re-posts by reversal', k.success && store.GL.some(g => g['Source Type'] === 'Reversal'), k);
  eq('  1600 now holds the corrected EWT', net(store, '1600'), 2400);
  eq('  the bank the corrected net cash', net(store, '1020'), 132000);
  eq('  AR still cleared', net(store, '1200'), 0);
  const vc = call(ctx, 'voidCollection', Object.assign({ collectionNo: c.collectionNo, reason: 'bounced' }, ACC));
  ok('a void reverses it', vc.success, vc);
  eq('  the bank is back to zero', net(store, '1020'), 0);
  eq('  and the receivable is open again', net(store, '1200'), 134400);
  ok('  balanced throughout', balanced(store));
  c = call(ctx, 'recordCollection', Object.assign({ arNo, amount: 1000, date: '2026-10-03', confirmNoDocs: true, depositedTo: '1100' }, ACC));
  ok('undeposited cheques go to 1100', c.success && net(store, '1100') === 1000, c);
}

sec('6 · closed months');
{
  const { ctx, store } = boot('shadow', { Periods: [{ Period: '2026-08', Status: 'Closed' }] });
  const r = inv(ctx, WRENCH, { date: '2026-08-20' });
  ok('no invoice into a closed month', !r.success && r.periodClosed && /2026-08 is closed/.test(r.message), r);
  ok('  nothing written', !store.Invoices.length && !(store.GL || []).length);
  inv(ctx, WRENCH);
  const c = call(ctx, 'recordCollection', Object.assign({ arNo: store.ARAging[0]['AR No'], amount: 100, date: '2026-08-31', confirmNoDocs: true, depositedTo: 'AUB' }, ACC));
  ok('no collection into a closed month', !c.success && c.periodClosed, c);
}

sec('7 · what needs a person, and engine errors');
{
  const { ctx, store } = boot('shadow', {
    Invoices: [{ 'INV No': 'INV-M1', 'SO No': 'SO-001', 'Date': '2026-02-01', 'Customer': 'ACME', 'Total Sales': 1000, 'Total COGS': 0, 'Created By': 'Migrated (legacy)', 'VAT Rate': 12, 'VAT': 120 }],
    ARAging: [{ 'AR No': 'AR-M1', 'INV No': 'INV-M1', 'SO No': 'SO-001', 'Customer': 'ACME', 'Amount (PHP)': 1120, 'Collected (PHP)': 0, 'Status': 'Unpaid' }] });
  const c = call(ctx, 'recordCollection', Object.assign({ arNo: 'AR-M1', amount: 1120, date: '2026-03-01', confirmNoDocs: true, depositedTo: 'AUB' }, ACC));
  ok('a collection of a migrated 2026 invoice is recorded', c.success, c);
  ok('  but waits in the Inbox (its invoice is not in the books)', store.GLInbox.some(i => i['Source No'] === c.collectionNo && i.Reason === 'no invoice in the books'), store.GLInbox);
  ok('  and nothing half-posted', !(store.GL || []).length);
  ctx._booksInvoiceEvent = () => { throw new Error('boom'); };
  const r = inv(ctx, WRENCH, { confirmReinvoice: true });
  ok('an engine error does not fail the invoice', r.success, r);
  ok('  it is parked in the Inbox with the message', store.GLInbox.some(i => i.Reason === 'engine error' && /boom/.test(i.Description)), store.GLInbox.map(i => i.Reason));
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
