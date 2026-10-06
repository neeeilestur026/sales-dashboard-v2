/* A320 — coverage: proof that nothing was missed, and the sync that fixes it.
 *
 * Run:  node tests/flow/books-coverage.js
 *
 * The rules pinned here:
 *   1. Records made while the books were off are reported as missing once they are on (from the start
 *      date), per source type; nothing is written by looking.
 *   2. syncBooks posts them, oldest first; coverage is then complete.
 *   3. A record edited behind the books' back (straight on the sheet) is reported as changed, and a sync
 *      re-posts it by reversal.
 *   4. Something only a person can decide stays "in the Inbox" and does not count as missing.
 *   5. Records before the books start and migrated records are not counted.
 *   6. Only accounting / admin / director may sync; management may look.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);
const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };
const MGT = { actorRole: 'management', actorName: 'Max' };

const store = {
  FlowSettings: [],
  Inventory: [{ 'Item No': 'TW-01', 'Description': 'Wrench', 'Available Balance': 30, 'Landed Cost/Unit': 40000, 'Item ID': 'ITM-00001', 'Type': 'Stock', 'Currency': 'PHP' }],
  SalesOrders: [{ 'SO No': 'SO-001', 'Customer': 'ACME', 'Status': 'Open', 'Type': '' }], Clients: [],
  Invoices: [{ 'INV No': 'INV-OLD', 'SO No': 'SO-001', 'Date': '2025-12-20', 'Customer': 'ACME', 'Total Sales': 500, 'VAT Rate': 12, 'VAT': 60, 'Created By': 'x' },
             { 'INV No': 'INV-MIG', 'SO No': 'SO-001', 'Date': '2026-02-02', 'Customer': 'ACME', 'Total Sales': 500, 'VAT Rate': 12, 'VAT': 60, 'Created By': 'Migrated (legacy)' }],
  InvoiceItems: [], ARAging: [], Collections: [], Journal: [], ActivityLog: [], Expenses: []
};
const { ctx } = { ctx: load(undefined, store) };
const inv = (date) => call(ctx, 'createInvoice', Object.assign({ customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true, confirmReinvoice: true, date,
  items: JSON.stringify([{ itemNo: 'TW-01', itemName: 'Wrench', qty: 1, price: 60000, itemId: 'ITM-00001' }]) }, ACC));

sec('1 · records made while the books were off');
{
  inv('2026-03-01'); inv('2026-03-05');
  call(ctx, 'addExpense', Object.assign({ date: '2026-03-06', category: 'Utilities', amount: 700 }, ACC));
  ok('(nothing in the books while off)', !(store.GL || []).length);
  store.FlowSettings.push({ Key: 'booksEngine', Value: 'shadow' });
  const c = call(ctx, 'getBooksCoverage', Object.assign({}, MGT));
  ok('management can see coverage', c.success, c);
  eq('  two invoices missing', c.counts.Invoice.missing, 2);
  ok('  the 2025 and the migrated invoice are not counted', c.counts.Invoice.total === 2, c.counts.Invoice);
  ok('  the expense has no "paid from", so it is listed too', c.counts.Expense.total === 1, c.counts.Expense);
  ok('  looking writes nothing', !(store.GL || []).length);
  ok('  not complete', c.complete === false);
}

sec('2 · sync posts them');
{
  let r = call(ctx, 'syncBooks', Object.assign({}, MGT));
  ok('management cannot sync', !r.success, r);
  r = call(ctx, 'syncBooks', Object.assign({}, ACC));
  ok('accounting syncs', r.success && r.posted === 2 && r.inbox === 1, r);
  const c = call(ctx, 'getBooksCoverage', Object.assign({}, ACC));
  eq('  the invoices are posted', c.counts.Invoice.ok, 2);
  eq('  the expense waits in the Inbox (no "paid from")', c.counts.Expense.inbox, 1);
  ok('  coverage is complete apart from what a person must decide', c.complete === true, c.problems);
  ok('  posted oldest first', store.GL[0].Date === '2026-03-01');
}

sec('3 · edited behind the books\' back');
{
  store.Invoices.find(i => i.Date === '2026-03-05')['VAT'] = 0;     // someone typed over the sheet
  store.Invoices.find(i => i.Date === '2026-03-05')['VAT Rate'] = 0;
  let c = call(ctx, 'getBooksCoverage', Object.assign({}, ACC));
  ok('it is reported', c.problems.some(x => x.sourceType === 'Invoice' && (x.state === 'changed')), c.problems);
  store.Invoices.find(i => i.Date === '2026-03-05')['VAT'] = 7200;
  store.Invoices.find(i => i.Date === '2026-03-05')['VAT Rate'] = 12;
  store.InvoiceItems.filter(i => i['INV No'] === store.Invoices.find(v => v.Date === '2026-03-05')['INV No']).forEach(i => { i['Line COGS'] = 39000; });
  c = call(ctx, 'getBooksCoverage', Object.assign({}, ACC));
  ok('a COGS edit is reported as changed', c.problems.some(x => x.sourceType === 'Invoice' && x.state === 'changed'), c.problems);
  const r = call(ctx, 'syncBooks', Object.assign({}, ACC));
  ok('sync re-posts it by reversal', r.success && r.posted === 1 && store.GL.some(g => g['Source Type'] === 'Reversal'), r);
  c = call(ctx, 'getBooksCoverage', Object.assign({}, ACC));
  ok('  and coverage is complete again', c.complete === true, c.problems);
  const bal = store.GL.reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0);
  ok('  balanced', Math.abs(bal) < 0.005);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
