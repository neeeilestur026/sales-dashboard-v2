/* A331 — safeguards on sales orders, invoices and payments (FlowAPI 168).
 *
 * Run:  node tests/flow/a331-safeguards.js
 *
 * WHY. The 14 Oct 2026 reconciliation of accounting's COLLECTED sheet against the portal found 111 of
 * 113 invoices at VAT 0% with nothing saying why, EWT typed by hand (on the total with VAT, or not at
 * all), 14 invoices imported twice, a real payment saved as DEMO-COL-001, and a Taganito order billed
 * ₱404,731 above its PO. Every one of those saved without a word. Pinned here, rule by rule:
 *   • it BLOCKS without a reason (needsReason, nothing written — not even a document number),
 *   • it SAVES with a reason of 10+ characters and writes one Overrides row per problem,
 *   • FlowSettings safeguards = off turns it back into the old behaviour,
 * plus the hard refusals that no reason opens (an invoice to another customer, a zero-rated sale with
 * no reference, management recording money), and replays of the real mistakes.
 */
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const section = (t) => console.log('\n== ' + t + ' ==');
const has = (res, rule) => !!(res && res.needsReason && String(res.needsReason).split(',').indexOf(rule) >= 0);

const THERMA = 'THERMA SOUTH INC';
const TAGANITO = 'TAGANITO HPAL NICKEL CORPORATION';
const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };
const DIR = { actorRole: 'director', actorName: 'Neil Estur' };
const MGT = { actorRole: 'management', actorName: 'Mo Mgmt' };
const SALES = { actorRole: 'sales', actorName: 'Crystal Gayle' };
const WHY = { overrideReason: 'Checked with accounting (test)' };

function boot(opts) {
  opts = opts || {};
  const settings = [];
  if (opts.off) settings.push({ Key: 'safeguards', Value: 'off' });
  if (opts.books) settings.push({ Key: 'booksEngine', Value: opts.books });
  if (opts.demo) settings.push({ Key: 'allowDemo', Value: 'on' });
  const store = Object.assign({
    FlowSettings: settings,
    Clients: [
      { 'Customer': THERMA, 'Default VAT Type': 'VAT-12', 'EWT Rate': '1', 'Payment Terms': '30 days' },
      { 'Customer': TAGANITO, 'Default VAT Type': 'VAT-0', 'Zero Rating Ref': 'BOI-ZR-2026-014', 'EWT Rate': '1' },
      { 'Customer': 'ACME', 'Default VAT Type': '', 'EWT Rate': '' }
    ],
    Inventory: [{ 'Item No': 'BL-50', 'Description': 'BLADDER 50 L', 'Available Balance': 100,
                  'Purchase Price/Unit': 1000, 'Shipping Cost/Unit': 0, 'Landed Cost/Unit': 1000,
                  'Total Landed Cost': 100000, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-00001' }],
    SalesOrders: [], SalesOrderItems: [], Invoices: [], InvoiceItems: [], ARAging: [], Collections: [],
    Journal: [], ChartOfAccounts: [], ActivityLog: [], Documents: [], DocMeta: [], Periods: []
  }, opts.extra || {});
  return { ctx: load(undefined, store), store };
}
const soLine = (price) => JSON.stringify([{ itemNo: 'BL-50', itemName: 'BLADDER 50 L', qty: 1, price }]);
const invLine = (price) => JSON.stringify([{ itemNo: 'BL-50', itemName: 'BLADDER 50 L', qty: 1, price, itemId: 'ITM-00001' }]);
const mkSO = (ctx, soNo, customer, price, extra) => call(ctx, 'createSalesOrder', Object.assign(
  { soNo, customer, date: '2026-10-01', status: 'Open', createdBy: 'Crystal Gayle', items: soLine(price) }, SALES, extra || {}));
const mkInv = (ctx, soNo, customer, price, extra) => call(ctx, 'createInvoice', Object.assign(
  { soNo, customer, date: '2026-10-02', confirmNoDocs: true, createdBy: 'Ana Acct', items: invLine(price) }, ACC, extra || {}));
const pay = (ctx, arNo, received, ewt, extra) => call(ctx, 'recordCollection', Object.assign(
  { arNo, received, ewt, date: '2026-10-10', method: 'Bank Transfer', ref: '', confirmNoDocs: true }, ACC, extra || {}));
const ar = (store, arNo) => store.ARAging.find(r => r['AR No'] === arNo);

/* ── 1 · a sales order says what its VAT is ──────────────────────────────────────────────────── */
{
  section('1 · sales orders carry a VAT type');
  const { ctx, store } = boot();
  let r = mkSO(ctx, 'SO-1', 'ACME', 50000);
  ok('no VAT type, and none on the client: refused', !r.success && /VAT type/.test(r.message), r);
  eq('  nothing written', store.SalesOrders.length, 0);
  r = mkSO(ctx, 'SO-1', THERMA, 120000);
  ok('the client\'s default fills it', r.success && r.vatType === 'VAT-12', r);
  eq('  and it is on the row', store.SalesOrders[0]['VAT Type'], 'VAT-12');
  r = mkSO(ctx, 'SO-2', TAGANITO, 1000000);
  ok('a zero-rated client: VAT-0 with the client\'s reference', r.success && r.vatType === 'VAT-0', r);
  eq('  the reference travels with the order', store.SalesOrders[1]['Zero Rating Ref'], 'BOI-ZR-2026-014');
  r = mkSO(ctx, 'SO-3', 'ACME', 50000, { vatType: 'VAT-0' });
  ok('VAT-0 with no reference anywhere: refused, no reason opens it', !r.success && !r.needsReason && /zero-rating reference/i.test(r.message), r);
  r = mkSO(ctx, 'SO-4', 'NEWCO TRADING', 50000, { vatType: 'VAT-12' });
  ok('a customer not on the Clients list asks for a reason', has(r, 'unknownCustomer'), r);
  eq('  and writes nothing', store.SalesOrders.length, 2);
  r = mkSO(ctx, 'SO-4', 'NEWCO TRADING', 50000, Object.assign({ vatType: 'VAT-12' }, WHY));
  ok('with a reason it saves', r.success, r);
  const ov = (store.Overrides || []).filter(o => o['Rule'] === 'unknownCustomer');
  ok('  and the Overrides row says who, what and why',
     ov.length === 1 && ov[0]['User'] === 'Crystal Gayle' && ov[0]['Role'] === 'sales' && ov[0]['Entered'] === 'NEWCO TRADING' &&
     ov[0]['Reason'] === WHY.overrideReason && ov[0]['Action'] === 'createSalesOrder', ov);

  const off = boot({ off: true });
  r = mkSO(off.ctx, 'SO-9', 'NEWCO TRADING', 50000);
  ok('safeguards off: no VAT type and an unknown customer save as before', r.success && !(off.store.Overrides || []).length, r);
}

/* ── 2 · once billed, an order's basis does not move ─────────────────────────────────────────── */
{
  section('2 · editing an order that is already invoiced');
  const { ctx, store } = boot();
  mkSO(ctx, 'SO-1', THERMA, 120000);
  ok('invoiced', mkInv(ctx, 'SO-1', THERMA, 100000).success);
  const upd = (extra) => call(ctx, 'updateSalesOrder', Object.assign({ soNo: 'SO-1', customer: THERMA, date: '2026-10-01',
    status: 'Open', items: soLine(120000) }, SALES, extra || {}));
  let r = upd({ vatType: 'VAT-EX' });
  ok('the VAT type cannot change under its invoices', !r.success && /already invoiced/.test(r.message), r);
  r = upd({ items: soLine(90000) });
  ok('the total cannot drop below what is billed', !r.success && /below/.test(r.message), r);
  eq('  the order is untouched', Number(store.SalesOrders[0]['Total']), 120000);
  r = upd({ items: soLine(130000) });
  ok('raising it is fine, and an edit without a VAT type keeps the one stored', r.success && store.SalesOrders[0]['VAT Type'] === 'VAT-12', r);
}

/* ── 3 · invoices follow their order ─────────────────────────────────────────────────────────── */
{
  section('3 · invoices: customer, VAT type, billing cap, duplicates');
  const { ctx, store } = boot();
  mkSO(ctx, 'SO-TAG', TAGANITO, 1000000);
  let r = mkInv(ctx, 'SO-TAG', THERMA, 600000);
  ok('another customer than the order\'s: refused outright', !r.success && !r.needsReason, r);
  r = mkInv(ctx, 'SO-TAG', TAGANITO, 600000);
  ok('the order\'s VAT type is used when the page sends none', r.success && r.vatRate === 0, r);
  eq('  no VAT on a zero-rated sale', Number(store.Invoices[0]['VAT']), 0);
  eq('  the receivable is the net', Number(store.ARAging[0]['Amount (PHP)']), 600000);
  const docMeta = (store.DocMeta || []).find(d => d['Source No'] === store.Invoices[0]['INV No']);
  ok('  the invoice records VAT-0 and the reference', docMeta && docMeta['VAT Type'] === 'VAT-0' && docMeta['Zero Rating Ref'] === 'BOI-ZR-2026-014', docMeta);

  // Replay: the Taganito PO — a second invoice for the same amount takes billing past the order.
  const invBefore = store.Invoices.length;
  r = mkInv(ctx, 'SO-TAG', TAGANITO, 600000);
  ok('billing above the order asks for a reason', has(r, 'overBilling'), r);
  ok('  so does the same amount on the same order', has(r, 'duplicateInvoice'), r);
  ok('  and the order already being invoiced', has(r, 'reinvoice'), r);
  const ob = (r.problems || []).find(x => x.rule === 'overBilling') || {};
  eq('  it says how much is left to bill', ob.expected, 400000);
  eq('  nothing written', store.Invoices.length, invBefore);
  eq('  and no invoice number used up', store.ARAging.length, 1);
  r = mkInv(ctx, 'SO-TAG', TAGANITO, 600000, WHY);
  ok('with a reason it is issued', r.success, r);
  eq('  one Overrides row per problem', (store.Overrides || []).filter(o => o['Action'] === 'createInvoice').length, 3);

  r = mkInv(ctx, 'SO-TAG', TAGANITO, 1000, { vatType: 'VAT-12', vatRate: 12 });
  ok('a VAT type other than the order\'s asks for a reason', has(r, 'vatTypeMismatch'), r);

  const off = boot({ off: true });
  mkSO(off.ctx, 'SO-TAG', TAGANITO, 1000000);
  mkInv(off.ctx, 'SO-TAG', TAGANITO, 600000);
  r = mkInv(off.ctx, 'SO-TAG', TAGANITO, 600000, { confirmReinvoice: true });
  ok('safeguards off: the old yes/no confirm is enough again', r.success && !(off.store.Overrides || []).length, r);
}

/* ── 4 · one payment model, and the EWT is checked ───────────────────────────────────────────── */
{
  section('4 · payments: cash + EWT settles, and the EWT is what the rate gives');
  const { ctx, store } = boot();
  mkSO(ctx, 'SO-TS', THERMA, 120000);
  const inv = mkInv(ctx, 'SO-TS', THERMA, 120000);
  eq('Therma: 120,000 + 12% = 134,400 due', Number(ar(store, inv.arNo)['Amount (PHP)']), 134400);

  let r = pay(ctx, inv.arNo, 133200, 1200, MGT);
  ok('management may not record a payment', !r.success && /accounting, admin or the director/.test(r.message), r);
  r = pay(ctx, inv.arNo, 133200, 1200, SALES);
  ok('nor sales', !r.success, r);

  // Replay: EWT taken on the total with VAT (1% of 134,400 = 1,344 instead of 1% of 120,000 = 1,200).
  r = pay(ctx, inv.arNo, 133056, 1344);
  ok('EWT on the total with VAT asks for a reason', has(r, 'ewtMismatch'), r);
  eq('  expected 1% of the before-VAT amount', (r.problems || [])[0] && r.problems[0].expected, 1200);
  eq('  nothing recorded', store.Collections.length, 0);
  r = pay(ctx, inv.arNo, 133056, 1344, { overrideReason: 'Withheld on the gross per their 2307' });
  ok('with the reason it records', r.success, r);
  eq('  cash + EWT settles the receivable exactly', ar(store, inv.arNo)['Status'], 'Paid');
  eq('  the Amount stored is what was settled', Number(store.Collections[0]['Amount (PHP)']), 134400);
  eq('  and the EWT', Number(store.Collections[0]['EWT (PHP)']), 1344);

  const b = boot();
  mkSO(b.ctx, 'SO-TS', THERMA, 120000);
  const i2 = mkInv(b.ctx, 'SO-TS', THERMA, 120000);
  r = pay(b.ctx, i2.arNo, 133200, 1200, { clientRef: 'CR-1' });
  ok('the right figures need no reason at all', r.success && !(b.store.Overrides || []).length, r);
  eq('  Paid', ar(b.store, i2.arNo)['Status'], 'Paid');
  const again = pay(b.ctx, i2.arNo, 133200, 1200, { clientRef: 'CR-1' });
  ok('the same form sent twice (same clientRef) records once', again.success && b.store.Collections.length === 1, again);
  r = pay(b.ctx, i2.arNo, 1000, 0);
  ok('anything more against a settled receivable is more than is due', has(r, 'overCollect'), r);
  const z = boot({ extra: { ARAging: [{ 'AR No': 'AR-ZERO', 'INV No': '', 'SO No': '', 'Customer': THERMA, 'Amount (PHP)': 0,
    'Collected (PHP)': 0, 'Status': 'Unpaid', 'Due Date': '', 'Notes': '', 'Created At': '2026-10-01', 'Updated At': '' }] } });
  r = pay(z.ctx, 'AR-ZERO', 1000, 0);
  ok('anything against a ₱0 receivable asks for a reason (it used to skip every check)', has(r, 'zeroReceivable'), r);

  // Replay: the payment typed before VAT, no EWT — the VAT stays owed and the EWT is missing.
  const c = boot();
  mkSO(c.ctx, 'SO-TS', THERMA, 120000);
  const i3 = mkInv(c.ctx, 'SO-TS', THERMA, 120000);
  r = pay(c.ctx, i3.arNo, 120000, 0);
  ok('no EWT from a customer that withholds asks for a reason', has(r, 'ewtMissing'), r);
  r = pay(c.ctx, i3.arNo, 140000, 1400);
  ok('more than is due asks for a reason', has(r, 'overCollect'), r);
  r = pay(c.ctx, i3.arNo, 50000, 0, { overrideReason: '2307 to follow from Therma' });
  ok('a part payment with a reason records', r.success, r);
  r = pay(c.ctx, i3.arNo, 50000, 0);
  ok('the same amount on the same receivable and day asks again — it looks recorded already', has(r, 'duplicatePayment'), r);
  eq('  one payment so far', c.store.Collections.length, 1);

  r = pay(c.ctx, i3.arNo, 100, -5);
  ok('a negative EWT is refused (no longer silently zeroed)', !r.success && /negative/.test(r.message), r);
  r = call(c.ctx, 'recordCollection', Object.assign({ arNo: i3.arNo, amount: 100, ewt: 500, date: '2026-10-10', confirmNoDocs: true }, ACC));
  ok('an EWT above the amount is refused (no longer silently clamped)', !r.success && /more than the amount/.test(r.message), r);

  // A cheque already used for this customer, on another receivable.
  const d = boot();
  mkSO(d.ctx, 'SO-A', THERMA, 120000); const ia = mkInv(d.ctx, 'SO-A', THERMA, 120000);
  mkSO(d.ctx, 'SO-B', THERMA, 50000);  const ib = mkInv(d.ctx, 'SO-B', THERMA, 50000);
  ok('cheque 000777 pays SO-A', pay(d.ctx, ia.arNo, 133200, 1200, { method: 'Cheque', ref: '000777' }).success);
  r = pay(d.ctx, ib.arNo, 55500, 500, { method: 'Cheque', ref: '777' });
  ok('the same cheque (any leading zeros) on another invoice asks for a reason', has(r, 'duplicateReference'), r);
  mkSO(d.ctx, 'SO-C', THERMA, 10000); const ic = mkInv(d.ctx, 'SO-C', THERMA, 10000);
  ok('a placeholder reference', pay(d.ctx, ib.arNo, 55500, 500, { ref: 'Per master AR ledger', overrideReason: 'Cheque 777 really paid both (test)' }).success);
  r = pay(d.ctx, ic.arNo, 11100, 100, { ref: 'Per master AR ledger' });
  ok('  with no digit is not a cheque, so reusing it is no duplicate', r.success, r);

  // A legacy receivable with no invoice cannot be checked, so it is not blocked.
  const e = boot({ extra: { ARAging: [{ 'AR No': 'AR-OLD', 'INV No': '', 'SO No': '', 'Customer': THERMA, 'Amount (PHP)': 5000,
    'Collected (PHP)': 0, 'Status': 'Unpaid', 'Due Date': '', 'Notes': 'Migrated (legacy)', 'Created At': '2026-06-01', 'Updated At': '' }] } });
  r = pay(e.ctx, 'AR-OLD', 5000, 0);
  ok('a receivable with no invoice records without an EWT question', r.success, r);

  const off = boot({ off: true });
  mkSO(off.ctx, 'SO-TS', THERMA, 120000);
  const io = mkInv(off.ctx, 'SO-TS', THERMA, 120000);
  r = pay(off.ctx, io.arNo, 120000, 0, MGT);
  ok('safeguards off: no EWT question and no role check — the old behaviour', r.success && !(off.store.Overrides || []).length, r);
}

/* ── 5 · the expected EWT the forms show is the one the save checks ─────────────────────────── */
{
  section('5 · getPaymentGuide');
  const { ctx, store } = boot();
  mkSO(ctx, 'SO-TS', THERMA, 120000);
  const inv = mkInv(ctx, 'SO-TS', THERMA, 120000);
  let g = call(ctx, 'getPaymentGuide', Object.assign({ arNos: inv.arNo + ',AR-NOPE' }, ACC));
  const row = g.data && g.data[inv.arNo];
  ok('a checkable receivable', row && row.check === true, g);
  eq('  1% of the before-VAT share: per peso settled', row && Math.round(row.perPeso * 1e6) / 1e6, Math.round(0.01 * 120000 / 134400 * 1e6) / 1e6);
  eq('  on the full 134,400 that is 1,200', row && Math.round(row.perPeso * 134400 * 100) / 100, 1200);
  ok('  an unknown receivable is simply absent', !(g.data && g.data['AR-NOPE']), g.data);
  g = call(ctx, 'getPaymentGuide', Object.assign({ arNos: inv.arNo }, SALES));
  ok('sales cannot read it (they do not record payments)', !g.success, g);
}

/* ── 6 · corrections, voids and closed months ────────────────────────────────────────────────── */
{
  section('6 · corrections and voids: who, and when');
  const { ctx, store } = boot({ books: 'shadow', extra: { Periods: [{ 'Period': '2026-09', 'Status': 'Closed' }] } });
  mkSO(ctx, 'SO-TS', THERMA, 120000);
  const inv = mkInv(ctx, 'SO-TS', THERMA, 120000);
  const p1 = pay(ctx, inv.arNo, 66600, 600, { depositedTo: 'METRO_ZAB' });   // the books want where it went
  ok('a payment to correct', p1.success, p1);
  let r = call(ctx, 'correctCollection', Object.assign({ collectionNo: p1.collectionNo, ewt: 0 }, MGT));
  ok('management may not correct a payment', !r.success && /correct a payment/.test(r.message), r);
  r = call(ctx, 'voidCollection', Object.assign({ collectionNo: p1.collectionNo, reason: 'test' }, MGT));
  ok('nor void one', !r.success && /void a payment/.test(r.message), r);
  r = call(ctx, 'voidInvoice', Object.assign({ invNo: inv.invNo, reason: 'test' }, MGT));
  ok('nor void an invoice', !r.success && /void an invoice/.test(r.message), r);

  // A payment dated in a closed month cannot be voided from it.
  store.Collections[0]['Date'] = '2026-09-30';
  r = call(ctx, 'voidCollection', Object.assign({ collectionNo: p1.collectionNo, reason: 'wrong customer' }, ACC));
  ok('a payment in a closed month cannot be voided', !r.success && r.periodClosed, r);
  store.Invoices[0]['Date'] = '2026-09-15';
  r = call(ctx, 'voidInvoice', Object.assign({ invNo: inv.invNo, reason: 'wrong amount' }, ACC));
  ok('nor an invoice in a closed month', !r.success && r.periodClosed, r);
}

/* ── 7 · bulk import: the director's call, with a reason, and it de-duplicates ───────────────── */
{
  section('7 · importCollections (replay: the June / September re-import)');
  const existing = { ARAging: [{ 'AR No': 'AR-001', 'INV No': '123', 'SO No': 'SO-OLD', 'Customer': THERMA, 'Amount (PHP)': 10000,
    'Collected (PHP)': 10000, 'Status': 'Paid', 'Due Date': '', 'Notes': 'Migrated (legacy)', 'Created At': '2026-06-02', 'Updated At': '' }],
    Collections: [{ 'Collection No': 'COL-001', 'AR No': 'AR-001', 'INV No': '123', 'SO No': 'SO-OLD', 'Customer': THERMA, 'Date': '2026-06-01',
      'Amount (PHP)': 10000, 'Method': '', 'Reference No': '', 'Notes': 'Migrated (legacy)', 'Created At': '2026-06-02', 'EWT (PHP)': 0, 'Voided': '' }] };
  const { ctx, store } = boot({ extra: existing });
  const rows = JSON.stringify([
    { invoiceNo: '000123', customer: THERMA, totalAmountDue: 10000, amountReceived: 10000, dateCollected: '2026-06-01' },   // the same invoice, re-imported
    { invoiceNo: '', customer: THERMA, totalAmountDue: 5000, amountReceived: 5000, dateCollected: '2026-06-05' },          // no number: cannot be checked
    { invoiceNo: '555', customer: 'Therma South, Inc.', totalAmountDue: 10000, amountReceived: 10000, dateCollected: '2026-06-01' },   // the same payment, another number
    { invoiceNo: '777', customer: 'DMCI', totalAmountDue: 8000, amountReceived: 0 }                                          // genuinely new
  ]);
  let r = call(ctx, 'importCollections', Object.assign({ items: rows }, ACC));
  ok('accounting may not bulk-import', !r.success && /director/.test(r.message), r);
  r = call(ctx, 'importCollections', Object.assign({ items: rows }, DIR));
  ok('the director is asked why', has(r, 'bulkImport'), r);
  r = call(ctx, 'importCollections', Object.assign({ items: rows, overrideReason: 'Opening balances from the 2025 ledger' }, DIR));
  ok('with a reason it runs', r.success, r);
  eq('  only the genuinely new row is written', store.ARAging.length, 2);
  ok('  the new one is 777', store.ARAging.some(a => a['INV No'] === '777'), store.ARAging.map(a => a['INV No']));
  eq('  no payment written twice', store.Collections.length, 1);
}

/* ── 8 · demo data never reaches the live sheets ─────────────────────────────────────────────── */
{
  section('8 · seedCommissionDemo (replay: DEMO-COL-001 held a real Mincon payment)');
  const { ctx, store } = boot();
  const r = call(ctx, 'seedCommissionDemo', DIR);
  ok('refused on live, even for the director', !r.success && /staging|allowDemo|demo/i.test(r.message), r);
  eq('  nothing written', store.SalesOrders.length, 0);
}

/* ── 9 · a client's tax defaults are accounting's decision ───────────────────────────────────── */
{
  section('9 · saveClient');
  const { ctx, store } = boot();
  let r = call(ctx, 'saveClient', Object.assign({ customer: THERMA, ewtRate: 'none' }, SALES));
  ok('sales cannot make a client "does not withhold"', !r.success, r);
  r = call(ctx, 'saveClient', Object.assign({ customer: THERMA, phone: '0917' }, SALES));
  ok('but can still keep its contact details', r.success && store.Clients[0]['EWT Rate'] === '1', r);
  r = call(ctx, 'saveClient', Object.assign({ customer: TAGANITO, ewtRate: '1', vatType: 'VAT-0', zeroRatingRef: 'BOI-ZR-2026-014' }, ACC));
  ok('accounting sets them', r.success, r);
  r = call(ctx, 'saveClient', Object.assign({ customer: 'ACME', vatType: 'VAT-15' }, ACC));
  ok('a VAT type the rules cannot read is refused', !r.success, r);
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
