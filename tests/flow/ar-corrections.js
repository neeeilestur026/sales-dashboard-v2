/* A342 — a director correction on receivables, and voiding an imported invoice (FlowAPI 175).
 *
 * Run:  node tests/flow/ar-corrections.js
 *
 * The fixtures are the live rows of 19 Oct 2026 (read-only), dates as Manila days (the harness formats a Date
 * object oddly, which would hide the date rules):
 *   • Therma South, SO 150005851: 2 torches x 175,193.09 + 2 clamps x 26,432.35 = 403,250.88, delivered
 *     in two parts, so billed in TWO invoices of 201,625.44 (one torch + one clamp each). The import put
 *     the whole order on invoice 126 (receivable AR-202608-007, 403,250.88). Neil: void it and re-issue.
 *   • MINCON: AR-202608-009 (invoice 121, 38,607.93 before VAT, unpaid) is to go; DEMO-AR-001
 *     (43,240.88, paid by DEMO-COL-001) stays.
 * Pinned here:
 *   • voiding invoice 126 takes its receivable off AR Aging and keeps the row (voided, with the reason),
 *     and puts NO stock back for an imported invoice (it never took any out); an app invoice still does;
 *   • renaming the voided record frees the number 126; the first delivery is re-issued as 126 with no
 *     question, the second asks once for the reason (second invoice, same amount), and the order ends up
 *     billed exactly 403,250.88;
 *   • removeReceivable removes exactly one row, keeps a full copy in Overrides, and refuses a payment on it
 *     or a wrong expectAmount; the DEMO receivable and payment are untouched;
 *   • the removed invoice is never offered or re-created: backfillMissingAR skips it, getARAging lists it
 *     in removedInvoices, and the AR page and the Month check count it as answered;
 *   • Clear demo order refuses on the live system (it would delete the real Mincon payment);
 *   • dryRun writes nothing; removeReceivable is secured and director only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const section = (t) => console.log('\n== ' + t + ' ==');
const DIR = { actorRole: 'director', actorName: 'Neil Estur' };
const ACC = { actorRole: 'accounting', actorName: 'Acct One' };

function store() {
  return {
    SalesOrders: [{ 'SO No': '150005851', 'Quotation No': '2026-406-KIM', 'Date': '2026-07-29', 'Customer': 'THERMA SOUTH, INC.',
      'Status': 'Delivered', 'Total': 403250.88, 'Created By': 'Crystal Gayle', 'Created At': '2026-07-29', 'Supplier Type': 'Local' },   // before the document rules (live: advisoryOnly)
      { 'SO No': 'ME-PO-260805-01', 'Customer': 'MINCON  ENTERPRISES', 'Status': 'Delivered', 'Total': 38607.93, 'Created By': 'Crystal Gayle', 'Date': '2026-08-13' },
      { 'SO No': 'DEMO-SO-001', 'Customer': 'DEMO — Mincon Philippines Inc.', 'Status': 'Delivered', 'Total': 38607.93, 'Created By': 'Neil' }],
    SalesOrderItems: [
      { 'SO No': '150005851', 'Item No': 'N/A', 'Item Name': '1-TORCH; HAND; TOMAHAWK 625', 'Qty': 2, 'Price/Unit': 175193.09, 'Total Price': 350386.18 },
      { 'SO No': '150005851', 'Item No': 'N/A', 'Item Name': 'CLAMP; WORK AND CABLE; FOR TOMAHAWK 625', 'Qty': 2, 'Price/Unit': 26432.35, 'Total Price': 52864.70 }],
    Invoices: [
      { 'INV No': '126', 'SO No': '150005851', 'Date': '2026-07-29', 'Customer': 'THERMA SOUTH, INC.', 'Total Sales': 403250.88,
        'Total COGS': 127014.09, 'Created By': 'Migrated (legacy)', 'Created At': '2026-08-13', 'Voided': '', 'Void Reason': '', 'Total Deposit': 0, 'VAT Rate': 0, 'VAT': 0 },
      { 'INV No': '121', 'SO No': 'ME-PO-260805-01', 'Date': '2026-08-13', 'Customer': 'MINCON  ENTERPRISES', 'Total Sales': 38607.93,
        'Total COGS': 15736.73, 'Created By': 'Migrated (legacy)', 'Voided': '', 'Total Deposit': 0, 'VAT Rate': 0, 'VAT': 0 },
      { 'INV No': 'DEMO-INV-001', 'SO No': 'DEMO-SO-001', 'Customer': 'DEMO — Mincon Philippines Inc.', 'Total Sales': 38607.93, 'Total COGS': 0, 'Created By': 'Neil', 'Voided': '', 'Total Deposit': 0, 'VAT Rate': 12, 'VAT': 4632.95 }],
    InvoiceItems: [
      { 'INV No': '126', 'Item No': '(migrated)', 'Item Name': 'Migrated legacy sales', 'Qty': 1, 'Selling Price': 403250.88, 'Line Sales': 403250.88, 'Landed Cost/Unit': 127014.09, 'Line COGS': 127014.09 },
      { 'INV No': '121', 'Item No': '(migrated)', 'Item Name': 'Migrated legacy sales', 'Qty': 1, 'Selling Price': 38607.93, 'Line Sales': 38607.93, 'Landed Cost/Unit': 15736.73, 'Line COGS': 15736.73 }],
    ARAging: [
      { 'AR No': 'DEMO-AR-001', 'INV No': 'DEMO-INV-001', 'SO No': 'DEMO-SO-001', 'Customer': 'DEMO — Mincon Philippines Inc.', 'Amount (PHP)': 43240.88, 'Collected (PHP)': 43240.88,
        'Status': 'Paid', 'Due Date': '2026-08-07', 'Notes': 'DEMO — remove with Clear demo order.', 'Created At': '2026-08-07', 'Updated At': '2026-08-07' },
      { 'AR No': 'AR-202608-007', 'INV No': '126', 'SO No': '150005851', 'Customer': 'THERMA SOUTH, INC.', 'Amount (PHP)': 403250.88, 'Collected (PHP)': 0, 'Status': 'Unpaid',
        'Due Date': '2026-09-20', 'Notes': 'Backfilled (missing AR)', 'Created At': '2026-08-27', 'Updated At': '2026-09-30' },
      { 'AR No': 'AR-202608-009', 'INV No': '121', 'SO No': 'ME-PO-260805-01', 'Customer': 'MINCON  ENTERPRISES', 'Amount (PHP)': 38607.93, 'Collected (PHP)': 0, 'Status': 'Unpaid',
        'Due Date': '', 'Notes': 'Backfilled (missing AR)', 'Created At': '2026-08-27', 'Updated At': '2026-08-27' },
      // the oldest live receivable: it sets the AR ledger's baseline (23 Jun), so invoice 121 (12 Aug) is "live"
      { 'AR No': 'AR-202606-003', 'INV No': '107', 'SO No': '150002447', 'Customer': 'Therma Luzon Inc.', 'Amount (PHP)': 551736.69, 'Collected (PHP)': 551736.69,
        'Status': 'Paid', 'Due Date': '', 'Notes': 'Migrated (legacy)', 'Created At': '2026-06-23', 'Updated At': '2026-08-18' }],
    Collections: [{ 'Collection No': 'DEMO-COL-001', 'AR No': 'DEMO-AR-001', 'INV No': 'DEMO-INV-001', 'SO No': 'DEMO-SO-001', 'Customer': 'DEMO — Mincon Philippines Inc.',
      'Date': '2026-08-07', 'Amount (PHP)': 43240.88, 'Method': 'Bank Transfer', 'Reference': 'DEMO-REF-001', 'Notes': 'DEMO — remove with Clear demo order.', 'EWT (PHP)': 386.08, 'Voided': '' }],
    Journal: [], Overrides: [], ActivityLog: [], FlowSettings: [], Inventory: [], Clients: [], Documents: [], DocMeta: []
  };
}
const row = (c, sheet, key, val) => (c.__store[sheet] || []).find(r => String(r[key]) === String(val));
const snapshot = (c) => JSON.stringify(['Invoices', 'InvoiceItems', 'ARAging', 'Collections', 'Overrides'].map(s => c.__store[s]));

section('void invoice 126 and re-issue it as two deliveries');
{
  const c = load(undefined, store());
  const invCount = c.__store.Inventory.length;
  const reason = 'SO 150005851 was delivered in two parts; accounting re-issues one invoice per delivery (Neil, 19 Oct 2026).';
  let r = call(c, 'voidInvoice', Object.assign({ invNo: '126', reason: reason }, DIR));
  const inv = row(c, 'Invoices', 'INV No', '126');
  ok('invoice 126 is voided with the reason, its row kept', r.success && r.arRemoved === 1 && inv['Voided'] === 'true' && /two parts/.test(inv['Void Reason']), r);
  ok('  its receivable AR-202608-007 is off AR Aging', !row(c, 'ARAging', 'AR No', 'AR-202608-007') && !!row(c, 'ARAging', 'AR No', 'AR-202608-009'));
  ok('  an imported invoice puts NO stock back (no "Migrated legacy sales" item)', c.__store.Inventory.length === invCount, c.__store.Inventory);
  ok('  nothing else moved', row(c, 'Invoices', 'INV No', '121')['Voided'] === '' && c.__store.Collections.length === 1);

  r = call(c, 'renameInvoice', Object.assign({ invNo: '126', newInvNo: '126-VOID' }, DIR));
  ok('the voided record is renamed 126-VOID, so the number 126 is free again', r.success && !!row(c, 'Invoices', 'INV No', '126-VOID') && !row(c, 'Invoices', 'INV No', '126'), r);

  const items = JSON.stringify([{ itemNo: 'N/A', itemName: '1-TORCH; HAND; TOMAHAWK 625', qty: 1, price: 175193.09 },
    { itemNo: 'N/A', itemName: 'CLAMP; WORK AND CABLE; FOR TOMAHAWK 625', qty: 1, price: 26432.35 }]);
  const issue = (invNo, extra) => call(c, 'createInvoice', Object.assign({ soNo: '150005851', customer: 'THERMA SOUTH, INC.', invNo: invNo, date: '2026-10-19',
    vatType: 'VAT-12', vatRate: 12, createdBy: 'Acct One', confirmShort: true, items: items }, ACC, extra || {}));
  r = issue('126');
  ok('the first delivery is re-issued as invoice 126 with no question asked', r.success && r.invNo === '126' && r.totalSales === 201625.44, r);
  ok('  with its own receivable', !!(c.__store.ARAging.find(a => String(a['INV No']) === '126')));
  r = issue('131');
  ok('the second delivery asks once: a second invoice on one order, the same amount (never "above the order")',
    !r.success && (r.problems || []).map(x => x.rule).sort().join() === 'duplicateInvoice,reinvoice', r);
  r = issue('131', { overrideReason: 'Second delivery of SO 150005851.' });
  ok('  and with the reason it is issued: the order is billed exactly, 403,250.88', r.success && c.__store.Invoices.filter(v => String(v['SO No']) === '150005851' && v['Voided'] !== 'true')
    .reduce((t, v) => t + v['Total Sales'], 0) === 403250.88, r);
}
{
  // voiding an invoice the app issued still puts its stock back (A325 unchanged)
  const s = store();
  s.Inventory = [{ 'Item No': 'HE-1', 'Description': 'Pump', 'Available Balance': 3, 'Purchase Price/Unit': 100, 'Shipping Cost/Unit': 0, 'Landed Cost/Unit': 100, 'Total Landed Cost': 300, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-1' }];
  s.Invoices.push({ 'INV No': 'INV-202610-001', 'SO No': '150005851', 'Customer': 'THERMA SOUTH, INC.', 'Total Sales': 100, 'Total COGS': 100, 'Created By': 'Acct One', 'Voided': '', 'Total Deposit': 0, 'VAT Rate': 0, 'VAT': 0 });
  s.InvoiceItems.push({ 'INV No': 'INV-202610-001', 'Item No': 'HE-1', 'Item Name': 'Pump', 'Qty': 1, 'Selling Price': 100, 'Line Sales': 100, 'Landed Cost/Unit': 100, 'Line COGS': 100, 'Item ID': 'ITM-1' });
  const c = load(undefined, s);
  const r = call(c, 'voidInvoice', Object.assign({ invNo: 'INV-202610-001', reason: 'Issued by mistake' }, DIR));
  ok('voiding an app invoice still puts its stock back', r.success && row(c, 'Inventory', 'Item No', 'HE-1')['Available Balance'] === 4, r);
}

section('remove AR-202608-009, keep the DEMO receivable');
{
  const c = load(undefined, store());
  const base = { arNo: 'AR-202608-009', expectAmount: 38607.93, reason: 'Duplicate of DEMO-AR-001 (43,240.88 with VAT, paid); this one is before VAT.' };
  const before = snapshot(c);
  let r = call(c, 'removeReceivable', Object.assign({ dryRun: true }, base, DIR));
  ok('dryRun: the plan, nothing written', r.success && r.dryRun && r.plan.invNo === '121' && r.plan.amount === 38607.93 && r.plan.otherReceivablesOnInvoice === 0 && snapshot(c) === before, r);
  ok('accounting is refused (director only)', !call(c, 'removeReceivable', Object.assign({}, base, ACC)).success);
  ok('a wrong expectAmount is refused', /38607\.93 on file, not 43240\.88/.test(call(c, 'removeReceivable', Object.assign({}, base, DIR, { expectAmount: 43240.88 })).message));
  ok('a receivable with a payment is refused', /payment\(s\) recorded \(DEMO-COL-001\)/.test(call(c, 'removeReceivable', Object.assign({}, base, DIR, { arNo: 'DEMO-AR-001', expectAmount: 43240.88 })).message));
  ok('  and none of them wrote anything', snapshot(c) === before);

  r = call(c, 'removeReceivable', Object.assign({}, base, DIR));
  ok('AR-202608-009 is gone, the other two stay', r.success && !row(c, 'ARAging', 'AR No', 'AR-202608-009') && c.__store.ARAging.map(a => a['AR No']).join() === 'DEMO-AR-001,AR-202608-007,AR-202606-003', c.__store.ARAging.map(a => a['AR No']));
  const demo = row(c, 'ARAging', 'AR No', 'DEMO-AR-001');
  ok('  the DEMO receivable and its payment are untouched', demo['Amount (PHP)'] === 43240.88 && demo['Status'] === 'Paid' && demo['INV No'] === 'DEMO-INV-001'
    && c.__store.Collections.length === 1 && c.__store.Collections[0]['Amount (PHP)'] === 43240.88);
  ok('  the invoice 121 and its order are untouched', !!row(c, 'Invoices', 'INV No', '121') && !!row(c, 'SalesOrders', 'SO No', 'ME-PO-260805-01'));
  const ov = c.__store.Overrides[0], copy = JSON.parse(ov['Entered']);
  ok('  a full copy in Overrides, keyed to its invoice', ov['Rule'] === 'removed-receivable' && ov['Ref No'] === 'AR-202608-009' && ov['Expected'] === '121'
    && copy['Amount (PHP)'] === 38607.93 && copy['Customer'] === 'MINCON  ENTERPRISES' && copy['INV No'] === '121', ov);
  ok('running it again finds nothing to remove', /was not found/.test(call(c, 'removeReceivable', Object.assign({}, base, DIR)).message));

  const bf = call(c, 'backfillMissingAR', Object.assign({ invNos: JSON.stringify(['121']) }, ACC));
  ok('backfillMissingAR never re-creates it, even when asked for invoice 121', bf.success && !row(c, 'ARAging', 'INV No', '121'), bf);
  const bf2 = call(c, 'backfillMissingAR', ACC);
  ok('  nor in an unscoped run', bf2.success && !row(c, 'ARAging', 'INV No', '121'), bf2);
  const read = call(c, 'getARAging', {});
  ok('getARAging lists it as answered on purpose', JSON.stringify(read.removedInvoices) === '["121"]' && read.data.length === c.__store.ARAging.length, read.removedInvoices);

  // the AR page and the Month check
  const D = path.join(__dirname, '../../dashboard/js/');
  const SRC = fs.readFileSync(D + 'flow-ar-aging.js', 'utf8');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(SRC.slice(SRC.indexOf('function arReconcile('), SRC.indexOf('/* A254')), ctx);
  const invs = call(c, 'getInvoices', {}).data;
  const page = ctx.arReconcile(read.data, invs, read.removedInvoices);
  const without = ctx.arReconcile(read.data, invs, []);
  ok('the AR page does not offer invoice 121 a receivable', !page.unaged.some(v => String(v.invNo) === '121') && without.unaged.some(v => String(v.invNo) === '121'),
    { with: page.unaged.map(v => v.invNo), without: without.unaged.map(v => v.invNo) });
  const mctx = { console }; vm.createContext(mctx);
  vm.runInContext(fs.readFileSync(D + 'month-check-model.js', 'utf8'), mctx);
  const mc = call(c, 'getMonthCheck', ACC);
  const fn = mctx.mcCheck || mctx.monthCheck || Object.values(mctx).find(f => typeof f === 'function' && /function\s+\w+\(data, month\)/.test(String(f)));
  const res = fn(mc, '2026-08');
  const noAr = (res.checks || res).find(x => x.key === 'invoiceNoReceivable');
  ok('the Month check does not list invoice 121 as missing a receivable', noAr && !noAr.items.some(i => String(i.ref) === '121'), noAr && noAr.items);
}

section('Clear demo order is off on the live system');
{
  const c = load(undefined, store());
  const r = call(c, 'clearCommissionDemo', DIR);
  ok('the director is refused, and the DEMO rows stay', !r.success && /switched off on the live system/.test(r.message) && !!row(c, 'ARAging', 'AR No', 'DEMO-AR-001') && c.__store.Collections.length === 1, r);
  const s = load(undefined, Object.assign(store(), { FlowSettings: [{ 'Key': 'allowDemo', 'Value': 'on' }] }));
  const r2 = call(s, 'clearCommissionDemo', DIR);
  ok('  on staging (allowDemo on) it still clears', r2.success && !row(s, 'ARAging', 'AR No', 'DEMO-AR-001'), r2);
}

console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
