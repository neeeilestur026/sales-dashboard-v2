/* A281 — A HIRE, FROM THE QUOTATION THE BUILDER SENDS TO THE INVOICE IT BECOMES.
 *
 * Run:  node tests/flow/service-quotation-chain.js
 *
 * service-invoice.js proves the invoice half: a hire moves no stock, credits 4100, and a deposit
 * credits the 2100 liability instead of revenue. It starts from an invoice whose lines already
 * carry the hire shape.
 *
 * This starts one step earlier, from the EXACT payload the quote configurator now sends, and walks
 * the whole chain — createQuotation -> getQuotations -> createSalesOrder -> createInvoice. Until
 * A281 nothing in any UI produced that payload, so every link past the first was reachable only
 * from a test. The point of this file is that the chain is now driven from the front of it.
 *
 * The figures are the A276 sample: 7 x 8,500 + 7 x 12,000 + 7 x 4,500 + 1 LOT x 15,000 = 190,000,
 * plus a 20,000 refundable deposit that is NOT part of it.
 */
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

/* Exactly what qcFinalize builds for a service quotation — the field names and nothing else. */
const ITEMS = [
  { itemNo: 'HTW-3000', itemName: 'HYDRAULIC TORQUE WRENCH, 3000 Nm', qty: 7, price: 8500,
    uom: 'DAYS', chargeKind: 'Rental', rateBasis: 'DAYS', duration: 7, lineKey: 'k1', optionNo: '' },
  { itemNo: 'HP-700', itemName: 'ELECTRIC HYDRAULIC PUMP', qty: 7, price: 12000,
    uom: 'DAYS', chargeKind: 'Rental', rateBasis: 'DAYS', duration: 7, lineKey: 'k2', optionNo: '' },
  { itemNo: 'OPR', itemName: 'CERTIFIED OPERATOR on site', qty: 7, price: 4500,
    uom: 'MANDAYS', chargeKind: 'Operator', rateBasis: 'MANDAYS', duration: 7, lineKey: 'k3', optionNo: '' },
  { itemNo: 'MOB', itemName: 'MOBILIZATION and DEMOBILIZATION', qty: 1, price: 15000,
    uom: 'LOT', chargeKind: 'Mobilization', rateBasis: 'LOT', duration: 1, lineKey: 'k4', optionNo: '' },
  { itemNo: '', itemName: 'Refundable security deposit', qty: 1, price: 20000,
    uom: 'LOT', chargeKind: 'Deposit', rateBasis: 'LOT', duration: 1, lineKey: 'k5', optionNo: '' },
];
const jsum = (store, acct, side) => (store.Journal || [])
  .filter(r => String(r['Account Code']) === acct)
  .reduce((s, r) => s + Number(r[side === 'dr' ? 'Debit' : 'Credit'] || 0), 0);

function boot() {
  const store = {
    Inventory: [{ 'Item No': 'HTW-3000', 'Description': 'HYDRAULIC TORQUE WRENCH, 3000 Nm',
                  'Available Balance': 2, 'Purchase Price/Unit': 400000, 'Shipping Cost/Unit': 0,
                  'Landed Cost/Unit': 400000, 'Total Landed Cost': 800000, 'Currency': 'PHP',
                  'Type': 'Stock', 'Item ID': 'ITM-00001' }],
    Clients: [{ 'Customer': 'HOLCIM PHILIPPINES, INC.', 'Payment Terms': '30 days' }],
    Quotations: [], QuotationItems: [], SalesOrders: [], SalesOrderItems: [],
    Invoices: [], InvoiceItems: [], ARAging: [], Journal: [], ChartOfAccounts: []
  };
  return { ctx: load(undefined, store), store };
}

const ADMIN = { actorName: 'Neil Estur', actorRole: 'admin', createdBy: 'Neil Estur' };

/* ── 1 · the quotation the builder sends ───────────────────────────────────────────────────── */
const { ctx, store } = boot();
sec('1 · createQuotation stores the hire shape');
const q = call(ctx, 'createQuotation', Object.assign({
  customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-21',
  subject: 'RENTAL OF HYDRAULIC TORQUE WRENCH PACKAGE',
  quoteType: 'Service', serviceKind: 'Tool rental',
  items: JSON.stringify(ITEMS)
}, ADMIN));
ok('the quotation is created', q.success === true, q);
const qRow = store.Quotations[0];
eq('Type is Service', String(qRow['Type']), 'Service');
eq('  and the kind is recorded', String(qRow['Service Kind']), 'Tool rental');
/* The stored Total is the revenue lines PLUS the deposit, because the client is billed all of it —
   the split into revenue and liability happens at the invoice, not the quotation. */
eq('the total is every line', Number(qRow['Total']), 210000);
const qi = store.QuotationItems;
eq('five lines stored', qi.length, 5);
eq('the wrench line keeps its charge kind', String(qi[0]['Charge Kind']), 'Rental');
eq('  its rate basis', String(qi[0]['Rate Basis']), 'DAYS');
eq('  and its duration, beside the qty that equals it', Number(qi[0]['Duration']), 7);
eq('the operator line is by the manday', String(qi[2]['Rate Basis']), 'MANDAYS');
eq('the deposit is marked as one', String(qi[4]['Charge Kind']), 'Deposit');

sec('2 · getQuotations reads it back for the builder to reopen');
const got = call(ctx, 'getQuotations', {}).data[0];
eq('type', got.type, 'Service');
eq('serviceKind', got.serviceKind, 'Tool rental');
eq('the line carries chargeKind back', got.items[0].chargeKind, 'Rental');
eq('  and rateBasis, which the form turns back into the picker', got.items[0].rateBasis, 'DAYS');

/* ── 3 · the sales order inherits it without being told ────────────────────────────────────── */
sec('3 · createSalesOrder inherits the type from the quotation');
const so = call(ctx, 'createSalesOrder', Object.assign({
  quotationNo: q.quotationNo, customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-22',
  items: JSON.stringify(ITEMS)
}, ADMIN));
ok('the order is created', so.success === true, so);
const soRow = store.SalesOrders[0];
/* _orderTypeFrom falls back to the QUOTATION when the caller does not say — the order is the deal
   that was agreed, and a browser that forgot the field must not turn a hire into a sale. */
eq('Type came across without the caller passing it', String(soRow['Type']), 'Service');
eq('the order line keeps the charge kind', String(store.SalesOrderItems[0]['Charge Kind']), 'Rental');
eq('  and the duration', Number(store.SalesOrderItems[0]['Duration']), 7);

/* ── 4 · the invoice: the reason any of this matters ───────────────────────────────────────── */
sec('4 · createInvoice bills the hire without destroying the tool');
const before = Number(store.Inventory[0]['Available Balance']);
const inv = call(ctx, 'createInvoice', Object.assign({
  soNo: so.soNo, customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-29', confirmNoDocs: true,
  items: JSON.stringify(ITEMS)
}, ADMIN));
ok('the invoice is issued', inv.success === true, inv);
/* THE A276 BUG, guarded from the front of the chain: a 7-day hire billed as 7 units would have
   taken seven wrenches out of a stock of two. */
eq('stock is untouched — a hire consumes nothing', Number(store.Inventory[0]['Available Balance']), before);
eq('no cost of sale is booked', jsum(store, '5000', 'dr'), 0);
eq('every revenue line is SERVICE revenue', jsum(store, '4100', 'cr'), 190000);
eq('  and nothing reaches goods sales', jsum(store, '4000', 'cr'), 0);
eq('the deposit credits the liability, not income', jsum(store, '2100', 'cr'), 20000);
eq('Total Sales is the revenue only', Number(store.Invoices[0]['Total Sales']), 190000);
eq('  the deposit recorded beside it', Number(store.Invoices[0]['Total Deposit']), 20000);
/* A278 — VAT on the revenue, never on the deposit: 12% of 190,000, not of 210,000. */
eq('VAT is charged on the revenue only', jsum(store, '2200', 'cr'), 22800);
ok('  and NOT on the deposit', jsum(store, '2200', 'cr') !== 25200);
eq('the receivable is revenue + VAT + deposit', Number(store.ARAging[0]['Amount (PHP)']), 232800);
eq('the entry balances', jsum(store, '1200', 'dr'),
   jsum(store, '4000', 'cr') + jsum(store, '4100', 'cr') + jsum(store, '2200', 'cr') + jsum(store, '2100', 'cr'));

/* ── 5 · the quotation and the invoice must name the SAME figure ───────────────────────────── */
sec('5 · what the client was quoted is what the client is billed');
/* The quotation's own arithmetic, spelled out here rather than imported: subtotal is every line,
   VAT is 12% of the lines that are not a deposit, and the total is the two added. This is what
   qcTotals() computes in the browser (quotation-deposit-vat.js) and what build_summary_table
   prints on the PDF (service_quotation_route.py). If any of the three drifts, the client holds a
   document promising one number while the receivable demands another — which is exactly what this
   whole appendix is about. */
const qGross = ITEMS.reduce((s2, i) => s2 + i.qty * i.price, 0);
const qVat = ITEMS.filter(i => i.chargeKind !== 'Deposit').reduce((s2, i) => s2 + i.qty * i.price, 0) * 0.12;
eq('the quotation subtotal', qGross, 210000);
eq('  its VAT excludes the deposit', qVat, 22800);
eq('  so the quotation says 232,800', qGross + qVat, 232800);
eq('AND THE RECEIVABLE SAYS THE SAME', Number(store.ARAging[0]['Amount (PHP)']), qGross + qVat);
eq('  the stored quotation Total stays VAT-EXCLUSIVE, as every quotation has been since A182',
   Number(store.Quotations[0]['Total']), 210000);

/* ── 6 · a mis-typed quotation can be corrected ────────────────────────────────────────────── */
sec('6 · updateQuotation writes Type — A281');
/* createQuotation has stored Type since A276; the edit path never did, so the type was fixed for
   ever at creation. A rep who built a hire as a supply quotation could fix every line and the
   document and the RECORD would still say Supply — and the record is what createSalesOrder and
   createInvoice read to decide whether a tool leaves stock. */
/* Born a DRAFT, because correcting the type is an edit like any other and is gated on the same
   editable statuses. Every quotation auto-routes for approval on create (Pending Admin for a rep,
   Pending Management for an admin), so the status is passed explicitly here — a real one reaches
   this state through Revise, which is the existing rule for every term of the offer and is not
   A281's business. */
const REP = { actorName: 'Rep One', actorRole: 'sales', createdBy: 'Rep One' };
const sup = call(ctx, 'createQuotation', Object.assign({
  quotationNo: '2026-451-NE', customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-21', status: 'Draft',
  items: JSON.stringify([{ itemNo: 'HTW-3000', itemName: 'WRENCH', qty: 7, price: 8500, lineKey: 'x1' }])
}, REP));
ok('a supply quotation is created', sup.success === true, sup);
const row451 = () => store.Quotations.filter(r => String(r['Quotation No']) === '2026-451-NE')[0];
eq('  typed as a supply quotation', String(row451()['Type'] || ''), '');
call(ctx, 'updateQuotation', Object.assign({
  quotationNo: '2026-451-NE', customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-21',
  quoteType: 'Service', serviceKind: 'Tool rental',
  items: JSON.stringify([{ itemNo: 'HTW-3000', itemName: 'WRENCH', qty: 7, price: 8500,
                           chargeKind: 'Rental', rateBasis: 'DAYS', duration: 7, lineKey: 'x1' }])
}, REP));
eq('the correction lands', String(row451()['Type']), 'Service');
eq('  with its service kind', String(row451()['Service Kind']), 'Tool rental');
/* A174 — an unsent field is left alone. A layout-only save, or any older caller, must not blank it. */
call(ctx, 'updateQuotation', Object.assign({
  quotationNo: '2026-451-NE', customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-21',
  items: JSON.stringify([{ itemNo: 'HTW-3000', itemName: 'WRENCH', qty: 7, price: 9000,
                           chargeKind: 'Rental', rateBasis: 'DAYS', duration: 7, lineKey: 'x1' }])
}, REP));
eq('an edit that does not mention the type leaves it alone', String(row451()['Type']), 'Service');
eq('  and the price edit did land', Number(row451()['Total']), 63000);
/* And the reverse is a real value, not an omission: a hire corrected back to a sale must clear. */
call(ctx, 'updateQuotation', Object.assign({
  quotationNo: '2026-451-NE', customer: 'HOLCIM PHILIPPINES, INC.', date: '2026-09-21',
  quoteType: '', serviceKind: '',
  items: JSON.stringify([{ itemNo: 'HTW-3000', itemName: 'WRENCH', qty: 7, price: 9000, lineKey: 'x1' }])
}, REP));
eq('correcting it back to a supply quotation clears the type', String(row451()['Type'] || ''), '');
eq('  and the service kind with it', String(row451()['Service Kind'] || ''), '');

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
