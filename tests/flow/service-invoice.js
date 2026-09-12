/* A276 — billing a hire must not destroy the tool.
 *
 * Run:  node tests/flow/service-invoice.js
 *
 * WHY THIS FILE EXISTS. createInvoice is the only place in the whole system that moves stock on the
 * sale side, and it did three things unconditionally that are all wrong for a hire:
 *
 *   1. `_applyInventory(..., -qty, ...)` — and a hire line's QUANTITY IS ITS DURATION. Billing a
 *      seven-day rental removed SEVEN units of a torque wrench that never left the building and was
 *      coming back anyway. Permanently: there is no movement ledger to reverse it from.
 *   2. Dr COGS / Cr Inventory, for a tool that is not consumed and has no cost of sale.
 *   3. The short-stock gate compared "7 days" against an on-hand balance, so every rental invoice
 *      demanded a confirmation that we had seven wrenches.
 *
 * And a refundable deposit is not revenue at all. It credits a LIABILITY (2100), stays out of
 * 'Total Sales' so the P&L cannot count it as income, but still belongs in the receivable because
 * the client does have to remit it.
 *
 * Both new accounts must be IN `COA`, not merely posted to: getTrialBalance sums the whole Journal
 * and then emits COA.map(...), so a code missing from that array is counted and silently dropped —
 * the trial balance keeps footing while omitting real money. That is asserted here too.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want,
  { got, want });
const section = (t) => console.log('\n' + t);

const TOOL = 'HYDRAULIC TORQUE WRENCH';

function boot(soType) {
  const store = {
    Inventory: [{ 'Item No': 'TW-01', 'Description': TOOL, 'Available Balance': 3,
                  'Purchase Price/Unit': 40000, 'Shipping Cost/Unit': 0, 'Landed Cost/Unit': 40000,
                  'Total Landed Cost': 120000, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-00001' }],
    SalesOrders: [{ 'SO No': 'SO-001', 'Date': '2026-09-01', 'Customer': 'ACME', 'Status': 'Open',
                    'Total': 190000, 'Type': soType || '' }],
    Clients: [{ 'Customer': 'ACME', 'Payment Terms': '30 days' }],
    Invoices: [], InvoiceItems: [], ARAging: [], Journal: [], ChartOfAccounts: []
  };
  return { ctx: load(undefined, store), store };
}

const bal = (store) => Number(store.Inventory[0]['Available Balance']);
const jrows = (store, acct) => (store.Journal || []).filter(r => String(r['Account Code']) === acct);
const jsum = (store, acct, side) => jrows(store, acct)
  .reduce((a, r) => a + (Number(r[side === 'dr' ? 'Debit' : 'Credit']) || 0), 0);

// ─────────────────────────────────────────────────────────────
section('1 · a goods invoice behaves exactly as it always did');
{
  const { ctx, store } = boot('');
  const res = call(ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 60000, itemId: 'ITM-00001' }]) });
  ok('the invoice is raised', res.success === true, res);
  eq('stock falls by the quantity sold', bal(store), 1);
  eq('sales are credited', jsum(store, '4000', 'cr'), 120000);
  eq('COGS is booked', jsum(store, '5000', 'dr'), 80000);
  eq('  against inventory', jsum(store, '1300', 'cr'), 80000);
  eq('the receivable is the sale', Number(store.ARAging[0]['Amount (PHP)']), 120000);
  eq('nothing reaches service revenue', jsum(store, '4100', 'cr'), 0);
  eq('nothing reaches customer deposits', jsum(store, '2100', 'cr'), 0);
}

// ─────────────────────────────────────────────────────────────
section('2 · a hire invoice moves no stock and books no cost');
{
  const { ctx, store } = boot('Service');
  const res = call(ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([
      { itemNo: 'TW-01', itemName: 'RENTAL — ' + TOOL, qty: 7, price: 12000, itemId: 'ITM-00001' },
      { itemNo: '', itemName: 'MOBILIZATION & DEMOBILIZATION', qty: 1, price: 15000 }]) });
  ok('the invoice is raised', res.success === true, res);
  eq('THE TOOL IS STILL ON THE SHELF', bal(store), 3);
  eq('no cost of sale is booked', jsum(store, '5000', 'dr'), 0);
  eq('  and inventory is not credited', jsum(store, '1300', 'cr'), 0);
  eq('service revenue carries the hire', jsum(store, '4100', 'cr'), 99000);
  eq('  and nothing lands in goods sales', jsum(store, '4000', 'cr'), 0);
  eq('the receivable is the whole hire', Number(store.ARAging[0]['Amount (PHP)']), 99000);
  eq('Total Sales records it as revenue', Number(store.Invoices[0]['Total Sales']), 99000);
  eq('  with no COGS', Number(store.Invoices[0]['Total COGS']), 0);
}

// ─────────────────────────────────────────────────────────────
section('3 · the short-stock gate does not ask about days');
{
  // 14 days of a tool we own 3 of. As goods this must be challenged; as a hire it must not.
  const asGoods = boot('');
  const g = call(asGoods.ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 14, price: 12000, itemId: 'ITM-00001' }]) });
  eq('selling 14 of 3 is refused', g.needsConfirm, 'shortStock');

  const asHire = boot('Service');
  const h = call(asHire.ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([{ itemNo: 'TW-01', itemName: TOOL, qty: 14, price: 12000, itemId: 'ITM-00001' }]) });
  ok('hiring it for 14 days is not', h.success === true, h);
  eq('  and the stock is untouched', bal(asHire.store), 3);
}

// ─────────────────────────────────────────────────────────────
section('4 · a deposit is held, not earned');
{
  const { ctx, store } = boot('Service');
  const res = call(ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([
      { itemNo: '', itemName: 'RENTAL — ' + TOOL, qty: 7, price: 12000 },
      { itemNo: '', itemName: 'Refundable security deposit', qty: 1, price: 20000,
        chargeKind: 'Deposit' }]) });
  ok('the invoice is raised', res.success === true, res);
  eq('the deposit credits the liability', jsum(store, '2100', 'cr'), 20000);
  eq('  and never touches revenue', jsum(store, '4000', 'cr') + jsum(store, '4100', 'cr'), 84000);
  eq('Total Sales excludes it', Number(store.Invoices[0]['Total Sales']), 84000);
  eq('  but it is recorded on the invoice', Number(store.Invoices[0]['Total Deposit']), 20000);
  eq('the client still owes it, so the receivable includes it',
     Number(store.ARAging[0]['Amount (PHP)']), 104000);
  eq('the entry balances', jsum(store, '1200', 'dr'),
     jsum(store, '4000', 'cr') + jsum(store, '4100', 'cr') + jsum(store, '2100', 'cr'));
}

// ─────────────────────────────────────────────────────────────
section('5 · a line can name itself, whatever the order says');
{
  const { ctx, store } = boot('');            // a SUPPLY order carrying one hire line
  call(ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([
      { itemNo: 'TW-01', itemName: TOOL, qty: 1, price: 60000, itemId: 'ITM-00001' },
      { itemNo: '', itemName: 'On-site operator', qty: 3, price: 4500, chargeKind: 'Operator' }]) });
  eq('the goods line still moves stock', bal(store), 2);
  eq('goods sales', jsum(store, '4000', 'cr'), 60000);
  eq('the operator line is service revenue', jsum(store, '4100', 'cr'), 13500);
  eq('  and books no cost', jsum(store, '5000', 'dr'), 40000);   // the goods line only
}

// ─────────────────────────────────────────────────────────────
section('6 · the trial balance can actually see the new accounts');
{
  const { ctx, store } = boot('Service');
  call(ctx, 'createInvoice', { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true,
    items: JSON.stringify([
      { itemNo: '', itemName: 'RENTAL', qty: 7, price: 12000 },
      { itemNo: '', itemName: 'Deposit', qty: 1, price: 20000, chargeKind: 'Deposit' }]) });
  const tb = call(ctx, 'getTrialBalance', {});
  ok('the trial balance renders', tb.success === true, tb);
  const codes = (tb.data || tb.rows || []).map(r => String(r.code));
  ok('4100 Service Revenue is listed', codes.indexOf('4100') !== -1, codes);
  ok('2100 Customer Deposits is listed', codes.indexOf('2100') !== -1, codes);
  const find = (c) => (tb.data || tb.rows || []).filter(r => String(r.code) === c)[0] || {};
  eq('  service revenue carries its balance', find('4100').creditBalance, 84000);
  eq('  and the deposit its own', find('2100').creditBalance, 20000);
}

// ─────────────────────────────────────────────────────────────
section('7 · the type survives the whole chain');
{
  /* The gap this closes: the columns were being WRITTEN and never READ BACK, so the browser could not
     tell a hire from a sale, the builder could not open in the right mode, and an order made from a
     service quotation silently became a supply order — which is the one mistake that ends with the
     invoice destroying the tool's stock. */
  const store = {
    Quotations: [{ 'Quotation No': 'Q1', 'Customer': 'ACME', 'Type': 'Service', 'Service Kind': 'Rental' }],
    QuotationItems: [{ 'Quotation No': 'Q1', 'Item Name': 'RENTAL', 'Quoted Qty': 7,
                       'Quoted Price': 8500, 'UOM': 'DAYS', 'Charge Kind': 'Rental',
                       'Rate Basis': 'Day', 'Duration': 7 }],
    SalesOrders: [], SalesOrderItems: [], Clients: [], Shipments: [], Documents: [], ActivityLog: [],
    Inventory: [], Invoices: [], InvoiceItems: [], ARAging: [], Journal: []
  };
  const ctx = load(undefined, store);

  const q = (call(ctx, 'getQuotations', {}).data || [])[0] || {};
  eq('the quotation reads back as a service', q.type, 'Service');
  eq('  with its kind', q.serviceKind, 'Rental');
  eq('  and the line keeps its basis', q.items[0].rateBasis, 'Day');
  eq('  and its duration', q.items[0].duration, 7);

  // No type passed — the order must take it from the quotation rather than silently becoming a sale.
  const so = call(ctx, 'createSalesOrder', { customer: 'ACME', quotationNo: 'Q1', createdBy: 'me',
    items: JSON.stringify([{ itemName: 'RENTAL', qty: 7, price: 8500,
                             chargeKind: 'Rental', rateBasis: 'Day', duration: 7 }]) });
  ok('the order is created', so.success === true, so);
  const soRow = (call(ctx, 'getSalesOrders', {}).data || [])[0] || {};
  eq('it INHERITED the type without being told', soRow.type, 'Service');
  eq('  and the line kept its charge kind', soRow.items[0].chargeKind, 'Rental');

  const inv = call(ctx, 'createInvoice', { customer: 'ACME', soNo: soRow.soNo, confirmNoDocs: true,
    items: JSON.stringify([{ itemName: 'RENTAL', qty: 7, price: 8500 }]) });
  ok('and the invoice bills it as a service', inv.success === true, inv);
  eq('  crediting service revenue', jsum(store, '4100', 'cr'), 59500);
  eq('  with no COGS', jsum(store, '5000', 'dr'), 0);
}

console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
