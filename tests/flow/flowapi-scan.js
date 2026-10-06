/* A325 — the FlowAPI half of the system scan (FLOW_VERSION 166), pinned.
 *
 * Run:  node tests/flow/flowapi-scan.js
 *
 *   1. Voiding a hire invoice returns no stock (it never left); a goods invoice still returns its own.
 *   2. updatePurchaseOrder refuses BEFORE it writes: the PO, its items and its status are untouched.
 *   3. Neither a quotation nor a PO takes a status from the browser.
 *   4. Two receiving lines on one item reverse in sequence (10 − 5 − 3 = 2, not 7).
 *   5. Identifiers Sheets parsed as numbers still compare equal; numbering never wraps or restarts.
 *   6. A foreign PO request counts in pesos against the payable.
 *   7. Who may act: daily notes, itineraries, document deletes, the counter reset, commission reads.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);
const SAM = { actorRole: 'sales', actorName: 'Sam Sales' };
const ANA = { actorRole: 'accounting', actorName: 'Ana Acct' };

const TOOL = 'HYDRAULIC TORQUE WRENCH';
function invWorld(soType) {
  const store = {
    Inventory: [{ 'Item No': 'TW-01', 'Description': TOOL, 'Available Balance': 3, 'Purchase Price/Unit': 40000,
                  'Shipping Cost/Unit': 0, 'Landed Cost/Unit': 40000, 'Total Landed Cost': 120000, 'Currency': 'PHP',
                  'Type': 'Stock', 'Item ID': 'ITM-00001' }],
    SalesOrders: [{ 'SO No': 'SO-001', 'Date': '2026-09-01', 'Customer': 'ACME', 'Status': 'Open', 'Total': 190000, 'Type': soType }],
    Clients: [{ 'Customer': 'ACME', 'Payment Terms': '30 days' }],
    Invoices: [], InvoiceItems: [], ARAging: [], Journal: [], ChartOfAccounts: [], Collections: []
  };
  return { ctx: load(undefined, store), store };
}

sec('1 · voiding returns only the stock that left');
{
  const { ctx, store } = invWorld('Service');
  const inv = call(ctx, 'createInvoice', Object.assign({ customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: 'RENTAL — ' + TOOL, qty: 7, price: 12000, itemId: 'ITM-00001' },
                           { itemNo: '', itemName: 'MOBILIZATION', qty: 1, price: 15000 }]) }, ANA));
  ok('a hire invoice is raised', inv.success, inv);
  const v = call(ctx, 'voidInvoice', Object.assign({ invNo: inv.invNo, reason: 'wrong client' }, ANA));
  ok('and voided', v.success, v);
  eq('  the tool count is still 3 (it used to gain 7 phantom tools)', Number(store.Inventory[0]['Available Balance']), 3);
  eq('  and no Stock row was invented for "MOBILIZATION"', store.Inventory.length, 1);

  const g = invWorld('');
  const gi = call(g.ctx, 'createInvoice', Object.assign({ customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 60000, itemId: 'ITM-00001' }]) }, ANA));
  eq('a goods invoice takes 2 out', Number(g.store.Inventory[0]['Available Balance']), 1);
  call(g.ctx, 'voidInvoice', Object.assign({ invNo: gi.invNo, reason: 'wrong client' }, ANA));
  eq('  and voiding puts the 2 back', Number(g.store.Inventory[0]['Available Balance']), 3);
}

sec('2 · a PO edit that is refused writes nothing');
{
  const store = {
    PurchaseOrders: [{ 'PO No': 'PO-1', 'SO No': '', 'Date': '2026-09-01', 'Supplier': 'ACME TOOLS', 'Currency': 'PHP',
                       'Total': 1000, 'Status': 'Draft', 'Created By': 'Ana', 'Created At': '2026-09-01' }],
    PurchaseOrderItems: [{ 'PO No': 'PO-1', 'Item No': 'TW-01', 'Item Name': TOOL, 'Qty': 1, 'Price/Unit': 1000, 'Total Price': 1000 }],
    APAging: [{ 'AP No': 'AP-1', 'PO No': 'PO-1', 'Supplier': 'ACME TOOLS', 'Amount (PHP)': 1000, 'Currency': 'PHP', 'Amount (FC)': 1000, 'Status': 'Unpaid' }],
    PaymentRequests: [{ 'PR No': 'PRF-1', 'Type': 'PO', 'PO No': 'PO-1', 'Currency': 'PHP', 'Amount': 1000, 'Status': 'Approved' }],
    Inventory: [], Journal: [], SalesOrders: []
  };
  const ctx = load(undefined, store);
  const r = call(ctx, 'updatePurchaseOrder', Object.assign({ poNo: 'PO-1', supplier: 'ACME TOOLS', currency: 'PHP',
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 5, price: 1000 }]) }, ANA));
  ok('the edit asks first (a payment request stands on the PO)', r.needsConfirm === 'poHasRequests', r);
  eq('  the PO total is unchanged', Number(store.PurchaseOrders[0]['Total']), 1000);
  eq('  its item is unchanged', Number(store.PurchaseOrderItems[0]['Qty']), 1);
  const s = call(ctx, 'updatePurchaseOrder', Object.assign({ poNo: 'PO-1', supplier: 'ACME TOOLS', currency: 'PHP', status: 'Approved',
    confirmRepricePaid: true, items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 1000 }]) }, ANA));
  ok('confirmed, it saves', s.success, s);
  eq('  but a status the browser sent is ignored', String(store.PurchaseOrders[0]['Status']), 'Draft');
}

sec('3 · the browser cannot choose an approval status');
{
  const store = { Quotations: [], QuotationItems: [], Clients: [{ 'Customer': 'ACME' }], PurchaseOrders: [], PurchaseOrderItems: [],
                  APAging: [], Inventory: [], Journal: [], SalesOrders: [] };
  const ctx = load(undefined, store);
  const q = call(ctx, 'createQuotation', Object.assign({ customer: 'ACME', status: 'Approved',
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 1, price: 100 }]) }, SAM));
  ok('a sales quotation is created', q.success, q);
  eq('  as Pending Admin, not the Approved it asked for', String(store.Quotations[0]['Status']), 'Pending Admin');
  const d = call(ctx, 'createQuotation', Object.assign({ customer: 'ACME', status: 'Draft',
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 1, price: 100 }]) }, SAM));
  eq('  Draft may still be asked for', String(store.Quotations[1]['Status']), 'Draft');
  const po = call(ctx, 'createPurchaseOrder', Object.assign({ supplier: 'ACME TOOLS', currency: 'PHP', status: 'Approved',
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 1, price: 100 }]) }, ANA));
  ok('a PO is created', po.success, po);
  eq('  as Draft', String(store.PurchaseOrders[0]['Status']), 'Draft');
}

sec('4 · two receiving lines on one item reverse in sequence');
{
  const store = { Inventory: [{ 'Item No': 'TW-01', 'Description': TOOL, 'Available Balance': 10, 'Purchase Price/Unit': 100,
                                'Shipping Cost/Unit': 0, 'Item ID': 'ITM-00001', 'Type': 'Stock' }] };
  const ctx = load(undefined, store);
  const line = (q) => ({ 'Item No': 'TW-01', 'Item Name': TOOL, 'Item ID': 'ITM-00001', 'Qty Received': q,
                         'Purchase Price/Unit (PHP)': 100, 'Shipping/Unit (PHP)': 0 });
  const after = {};
  const a = ctx._rcvReversalLine(line(5), after), b = ctx._rcvReversalLine(line(3), after);
  eq('the first line leaves 5', a.balanceAfter, 5);
  eq('the second starts from 5 and leaves 2 (it used to leave 7)', b.balanceAfter, 2);
}

sec('5 · identifiers and numbering');
{
  const ctx = load(undefined, { GL: [], SalesCalls: [] });
  ok("a fingerprint stored as 123456 equals '00123456'", ctx._fpSame(123456, '00123456'));
  ok("one stored as 1.2345e+71 equals '12345e67'", ctx._fpSame(1.2345e71, '12345e67'));
  ok('different fingerprints still differ', !ctx._fpSame('0a1b2c3d', '0a1b2c3e') && !ctx._fpSame(123, '00000124'));
  ok("cheque 123 is cheque '000123'", ctx._idNorm(123) === ctx._idNorm('000123'));
  const ym = ctx.Utilities.formatDate(new Date(), ctx.Session.getScriptTimeZone(), 'yyyyMM');
  const store2 = { SalesCalls: [{ 'Call No': 'CALL-' + ym + '-999' }], GL: [{ 'Entry No': 'JE-202610-00007' }] };
  const c2 = load(undefined, store2);
  eq('after 999 comes 1000, not 001', c2._nextNumber('SalesCalls', 1, 'CALL'), 'CALL-' + ym + '-1000');
  eq('a journal number with no counter starts above the sheet', c2._glEntryNo('2026-10-15'), 'JE-202610-00008');
}

sec('6 · a paid USD request counts in pesos');
{
  const store = { PaymentRequests: [{ 'PR No': 'PRF-9', 'Type': 'PO', 'PO No': 'PO-9', 'Currency': 'USD', 'Amount': 2000,
    'Status': 'Paid', 'Actual Debited (PHP)': 116893, 'Bank Charge (PHP)': 893 }] };
  const ctx = load(undefined, store);
  eq('USD 2,000 paid → ₱116,000 (it was read as ₱2,000)', ctx._poRequestedPHP('PO-9'), 116000);
}

sec('7 · who may act');
{
  const store = { DailyNotes: [], WeeklyItineraries: [{ 'Itinerary No': 'ITIN-1', 'Week Start': '2026-10-05', 'User': 'Otto Other', 'Status': 'Draft' }],
                  ItineraryItems: [{ 'Itinerary No': 'ITIN-1', 'Seq': 1, 'Company': 'ACME' }],
                  Documents: [{ 'Doc ID': 'DOC-1', 'Module': 'Payment Request', 'Ref No': 'PRF-1', 'Doc Type': 'Proof of payment', 'Uploaded By': 'Ana Acct' },
                              { 'Doc ID': 'DOC-2', 'Module': 'Quotation', 'Ref No': 'Q-1', 'Doc Type': 'Supplier Quotation', 'Uploaded By': 'Sam Sales' }] };
  const ctx = load(undefined, store);
  let r = call(ctx, 'saveDailyNote', Object.assign({ date: '2026-10-06', user: 'Otto Other', notes: 'x' }, SAM));
  ok("a rep cannot write another rep's notes", r.success === false, r);
  r = call(ctx, 'saveDailyNote', Object.assign({ date: '2026-10-06', user: 'sam sales', notes: 'mine' }, SAM));
  ok('  their own (any case) is fine, kept as sent', r.success && store.DailyNotes[0]['Updated By'] === 'sam sales', store.DailyNotes);
  r = call(ctx, 'saveDailyNote', { date: '2026-10-06', user: 'Otto Other', notes: 'for him', actorRole: 'management', actorName: 'Mia' });
  ok('  management may act for anyone', r.success, r);
  r = call(ctx, 'submitWeeklyItinerary', Object.assign({ itineraryNo: 'ITIN-1' }, SAM));
  ok("a rep cannot submit another rep's itinerary", r.success === false && /belongs to/.test(r.message), r);
  r = call(ctx, 'deleteWeeklyItinerary', Object.assign({ itineraryNo: 'ITIN-1' }, SAM));
  ok('  nor delete it', r.success === false && store.WeeklyItineraries.length === 1, r);
  r = call(ctx, 'deleteDocument', Object.assign({ docId: 'DOC-1' }, SAM));
  ok("a rep cannot delete accounting's proof of payment", r.success === false && store.Documents.length === 2, r);
  r = call(ctx, 'deleteDocument', Object.assign({ docId: 'DOC-2' }, SAM));
  ok('  but can delete what they uploaded', r.success === true && store.Documents.length === 1, r);
  r = call(ctx, 'deleteDocument', Object.assign({ docId: 'DOC-1' }, ANA));
  ok('  accounting can delete any', r.success === true && store.Documents.length === 0, r);
  r = call(ctx, 'resetSequenceCounters', Object.assign({ prefix: 'PR' }, SAM));
  ok('resyncing numbering is admin-only', r.success === false, r);
  r = call(ctx, 'getCommissionPayoutReport', { flowSecret: '', actorRole: 'sales' });
  ok('the payout report needs the secured path now', r.success === false, r);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
