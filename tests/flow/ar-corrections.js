/* A342 — two director corrections on receivables (FlowAPI 175).
 *
 * Run:  node tests/flow/ar-corrections.js
 *
 * The fixtures are the live rows of 19 Oct 2026 (read-only), dates as Manila days (the harness formats a Date
 * object oddly, which would hide the date rules):
 *   • Therma South, SO 150005851: 2 torches x 175,193.09 + 2 clamps x 26,432.35 = 403,250.88, billed in
 *     TWO invoices of 201,625.44 (one torch + one clamp each). The import put the whole order on invoice
 *     126, and its receivable AR-202608-007 says 403,250.88.
 *   • MINCON: AR-202608-009 (invoice 121, 38,607.93 before VAT, unpaid) is to go; DEMO-AR-001
 *     (43,240.88, paid by DEMO-COL-001) stays.
 * Pinned here:
 *   • restateMigratedInvoice sets the invoice, its one line and its receivable, keeps the cost, logs to
 *     Overrides, and refuses: a non-director, a short reason, a wrong expectTotal (so it cannot run twice),
 *     an app invoice, VAT or a deposit, two lines, no / two receivables, more already collected, a journal;
 *   • after it, the second invoice fits inside the order: only the reason for a second invoice of the
 *     same amount is asked, never "above the order";
 *   • removeReceivable removes exactly one row, keeps a full copy in Overrides, and refuses a payment on it
 *     or a wrong expectAmount; the DEMO receivable and payment are untouched;
 *   • the removed invoice is never offered or re-created: backfillMissingAR skips it, getARAging lists it
 *     in removedInvoices, and the AR page and the Month check count it as answered;
 *   • Clear demo order refuses on the live system (it would delete the real Mincon payment);
 *   • dryRun writes nothing; both are secured.
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
const REASON = 'SO 150005851 is billed in two invoices of 201,625.44 (one torch and one clamp each).';

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

section('restate invoice 126');
{
  const c = load(undefined, store());
  const base = { invNo: '126', expectTotal: 403250.88, totalSales: 201625.44, reason: REASON };
  const before = snapshot(c);
  let r = call(c, 'restateMigratedInvoice', Object.assign({ dryRun: true }, base, DIR));
  ok('dryRun: the plan, nothing written', r.success && r.dryRun && r.plan.arNo === 'AR-202608-007' && r.plan.totalSales.to === 201625.44
    && r.plan.totalCogs.to === 127014.09 && r.plan.orderTotal === 403250.88 && snapshot(c) === before, r);
  [
    ['accounting is refused (director only)', Object.assign({}, base, ACC), /Only the director/],
    ['a short reason is refused', Object.assign({}, base, DIR, { reason: 'fix it' }), /at least 10/],
    ['a wrong expectTotal is refused', Object.assign({}, base, DIR, { expectTotal: 403250 }), /403250\.88 on file, not 403250\.00/],
    ['an unknown invoice is refused', Object.assign({}, base, DIR, { invNo: '999' }), /not found/],
    ['a zero amount is refused', Object.assign({}, base, DIR, { totalSales: 0 }), /more than zero/],
  ].forEach(([l, prm, re]) => { const x = call(c, 'restateMigratedInvoice', prm); ok(l, !x.success && re.test(x.message), x); });
  ok('  and none of them wrote anything', snapshot(c) === before);
  ok('without the app\'s secret it is refused', /through the app/.test(call(c, 'restateMigratedInvoice', Object.assign({ flowSecret: '' }, base, DIR)).message));

  r = call(c, 'restateMigratedInvoice', Object.assign({}, base, DIR));
  const inv = row(c, 'Invoices', 'INV No', '126'), line = row(c, 'InvoiceItems', 'INV No', '126'), ar = row(c, 'ARAging', 'AR No', 'AR-202608-007');
  ok('the invoice is 201,625.44 and keeps its cost', r.success && inv['Total Sales'] === 201625.44 && inv['Total COGS'] === 127014.09, inv);
  ok('  its one line too', line['Selling Price'] === 201625.44 && line['Line Sales'] === 201625.44 && line['Line COGS'] === 127014.09 && line['Qty'] === 1, line);
  ok('  its receivable is 201,625.44, still unpaid, with a note', ar['Amount (PHP)'] === 201625.44 && ar['Collected (PHP)'] === 0 && ar['Status'] === 'Unpaid'
    && /^Backfilled \(missing AR\) · Restated \d{4}-\d{2}-\d{2} from 403250\.88$/.test(ar['Notes']), ar);
  const ov = c.__store.Overrides;
  ok('  one Overrides row: who, what, from, to and why', ov.length === 1 && ov[0]['Rule'] === 'restated-invoice' && ov[0]['Ref No'] === '126' && ov[0]['Expected'] === 403250.88
    && ov[0]['Entered'] === 201625.44 && ov[0]['User'] === 'Neil Estur' && ov[0]['Role'] === 'director' && /two invoices/.test(ov[0]['Reason']), ov);
  ok('  nothing else changed', row(c, 'Invoices', 'INV No', '121')['Total Sales'] === 38607.93 && c.__store.ARAging.length === 4 && c.__store.Journal.length === 0);
  const again = call(c, 'restateMigratedInvoice', Object.assign({}, base, DIR));
  ok('running it again is refused (the amount on file moved)', !again.success && /201625\.44 on file, not 403250\.88/.test(again.message), again);

  // the second invoice now fits inside the order: only "second invoice / same amount" asks
  const ask = call(c, 'createInvoice', Object.assign({ soNo: '150005851', customer: 'THERMA SOUTH, INC.', invNo: '131', date: '2026-10-19', vatType: 'VAT-12', vatRate: 12,
    createdBy: 'Acct One', confirmShort: true, items: JSON.stringify([{ itemNo: 'N/A', itemName: '1-TORCH; HAND; TOMAHAWK 625', qty: 1, price: 175193.09 },
      { itemNo: 'N/A', itemName: 'CLAMP; WORK AND CABLE; FOR TOMAHAWK 625', qty: 1, price: 26432.35 }]) }, ACC));
  const rules = (ask.problems || []).map(x => x.rule).sort().join(',');
  ok('the second invoice asks once, for a second invoice of the same amount, never "above the order"', !ask.success && rules === 'duplicateInvoice,reinvoice', ask);
}
{
  const refuse = (mut, re, l) => {
    const s = store(); mut(s);
    const c = load(undefined, s);
    const x = call(c, 'restateMigratedInvoice', Object.assign({ invNo: '126', expectTotal: 403250.88, totalSales: 201625.44, reason: REASON }, DIR));
    ok(l, !x.success && re.test(x.message) && c.__store.Overrides.length === 0, x);
  };
  refuse(s => { s.Invoices[0]['Created By'] = 'Acct One'; }, /brought in from the old records/, 'an app invoice is refused (void and re-issue it)');
  refuse(s => { s.Invoices[0]['VAT'] = 48390.11; }, /VAT or a deposit/, 'an invoice with VAT is refused');
  refuse(s => { s.Invoices[0]['Total Deposit'] = 5000; }, /VAT or a deposit/, '  or a deposit');
  refuse(s => { s.InvoiceItems.push(Object.assign({}, s.InvoiceItems[0])); }, /has 2 lines/, 'two lines are refused');
  refuse(s => { s.ARAging.splice(1, 1); }, /has 0 receivables/, 'no receivable is refused');
  refuse(s => { s.ARAging.push(Object.assign({}, s.ARAging[1], { 'AR No': 'AR-X' })); }, /has 2 receivables/, 'two receivables are refused');
  refuse(s => { s.ARAging[1]['Amount (PHP)'] = 451640.99; }, /not the invoice's 403250\.88/, 'a receivable on another basis is refused');
  refuse(s => { s.Collections.push({ 'Collection No': 'COL-1', 'AR No': 'AR-202608-007', 'Amount (PHP)': 250000, 'Voided': '' }); }, /250000\.00 collected/, 'more already collected than the new amount is refused');
  refuse(s => { s.Journal.push({ 'Source': 'INV', 'Source No': '126', 'Debit': 1 }); }, /journal entries/, 'an invoice with journal entries is refused');
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
