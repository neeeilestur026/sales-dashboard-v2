/* A324 — the books jobs fit inside Flask's minute and continue in rounds.
 *
 * Run:  node tests/flow/books-slices.js
 *
 * Flask stops waiting for Apps Script after a minute ("Read timed out") while the script carries on.
 * Each long job now stops starting new work at a budget counted from the start of the call and says
 * where to carry on. Pinned, by squeezing the budget to nothing so every round does the least it may:
 *   1. syncBooks: one record per round, a `next` cursor, `done` at the end — and the rounds together
 *      post exactly what one uninterrupted run posts: same ledger, no record twice, one DocMeta row
 *      per invoice (the checking runs under the read memo while the invoice builder files its Doc ID).
 *   2. getBooksCoverage: stops early, says it is partial and how far it checked.
 *   3. ingestBookEvents: at least one post per round, `left` until done, the same books as one run.
 *   4. A sync still closes the Inbox item of an event that finally posts.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);
const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };

function world() {
  const store = {
    FlowSettings: [],
    Inventory: [{ 'Item No': 'TW-01', 'Description': 'Wrench', 'Available Balance': 100, 'Landed Cost/Unit': 40000, 'Item ID': 'ITM-00001', 'Type': 'Stock', 'Currency': 'PHP' }],
    SalesOrders: [{ 'SO No': 'SO-001', 'Customer': 'ACME', 'Status': 'Open', 'Type': '' }], Clients: [],
    Invoices: [], InvoiceItems: [], ARAging: [], Collections: [], Journal: [], ActivityLog: [], Expenses: []
  };
  const ctx = load(undefined, store);
  ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].forEach((date, i) =>
    call(ctx, 'createInvoice', Object.assign({ customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true, confirmReinvoice: true, date,
      items: JSON.stringify([{ itemNo: 'TW-01', itemName: 'Wrench', qty: 1, price: 60000 + i * 1000, itemId: 'ITM-00001' }]) }, ACC)));
  call(ctx, 'addExpense', Object.assign({ date: '2026-03-06', category: 'Utilities', amount: 700, paidFrom: '1010' }, ACC));
  store.FlowSettings.push({ Key: 'booksEngine', Value: 'shadow' });
  return { ctx, store };
}
// by source number, not event key: an invoice's key carries its Doc ID, a fresh UUID in each world
const ledger = (store) => (store.GL || []).map(g => [g['Source Type'], g['Source No'], g.Account, Number(g.Debit) || 0, Number(g.Credit) || 0].join('|')).sort().join('\n');

sec('1 · "Post what is missing", one record per round');
{
  const one = world();
  const r1 = call(one.ctx, 'syncBooks', Object.assign({}, ACC));
  ok('with time to spare it finishes in one round', r1.success && r1.done === true && r1.next === '' && r1.left === 0, r1);
  eq('  six records posted', r1.posted, 6);

  const sliced = world();
  sliced.ctx._BOOKS_WRITE_MS = -1;                   // no budget at all: the least each round may do
  let after = '', rounds = 0, r, cursors = [];
  do {
    r = call(sliced.ctx, 'syncBooks', Object.assign({ after }, ACC));
    if (!r.success) break;
    rounds++; cursors.push(r.next); after = r.next;
  } while (!r.done && rounds < 30);
  ok('every round succeeds and the last says done', r.success && r.done === true, r);
  ok('  it took several rounds', rounds >= 6, rounds);
  ok('  the cursor only moves forward', cursors.slice(0, -1).every((c, i) => i === 0 || c > cursors[i - 1]), cursors);
  eq('  the same ledger as one round', ledger(sliced.store), ledger(one.store));
  const keys = (sliced.store.EventIndex || []).map(x => x['Event Key']);
  eq('  no record posted twice', new Set(keys).size, keys.length);
  const inv = (sliced.store.DocMeta || []).filter(d => d['Source Type'] === 'Invoice').map(d => d['Source No']);
  eq('  one DocMeta row per invoice', new Set(inv).size, inv.length);
  sliced.ctx._BOOKS_WRITE_MS = 35000;
  const again = call(sliced.ctx, 'syncBooks', Object.assign({}, ACC));
  ok('pressing again later finds nothing to post', again.success && again.posted === 0 && again.done, again);
}

sec('2 · coverage that runs out of time says so');
{
  const w = world();
  w.ctx._BOOKS_READ_MS = -1;
  const c = call(w.ctx, 'getBooksCoverage', Object.assign({}, ACC));
  ok('it answers instead of timing out', c.success, c);
  ok('  partial, checked through the first day', c.partial === true && c.checkedThrough === '2026-03-01', c);
  ok('  and never claims complete', c.complete === false);
  w.ctx._BOOKS_READ_MS = 40000;
  const full = call(w.ctx, 'getBooksCoverage', Object.assign({}, ACC));
  ok('with time, the whole range and no partial flag', full.partial === false && full.checkedThrough === '' && full.counts.Invoice.total === 5, full);
}

sec('3 · the payroll & payments sync, in rounds');
{
  const row = (employee, o) => Object.assign({ employee, basic: 0, gross: 0, pagibig: 0, sss: 0, philhealth: 0, advances: 0, wtax: 0, net: 0, salaryDeduction: 0 }, o);
  const pay = (m, cut) => ({ period: '2026-' + m + '-' + cut, rows: [row('Dandan, Gayle', { basic: 6000, gross: 6000, pagibig: cut === 'A' ? 200 : 0, net: cut === 'A' ? 5800 : 6000 })],
    commissionIncentives: 0, paidDate: '2026-' + m + '-' + (cut === 'A' ? '11' : '26'), paidBank: 'AUB',
    employerShares: cut === 'B' ? { month: '2026-' + m, totals: { sssER: 0, sssEC: 0, phER: 0, hdmfER: 200 }, missing: [] } : null });
  const feed = JSON.stringify({ complete: true, payroll: [pay('03', 'A'), pay('03', 'B'), pay('04', 'A'), pay('04', 'B')], directorPayables: [],
    billing: [{ prNumber: 'PR-1', payee: 'PLDT', department: 'Admin', currency: 'PHP', amount: 2500, bankAccountCode: 'AUB', bankTxId: 'TX-1', valueDate: '2026-03-05' }],
    bankTransactions: [] });
  const boot = () => { const store = { FlowSettings: [{ Key: 'booksEngine', Value: 'shadow' }], ActivityLog: [] }; return { ctx: load(undefined, store), store }; };
  const one = boot();
  call(one.ctx, 'saveAccountRule', Object.assign({ source: 'billing.department', value: 'Admin', account: '6140' }, ACC));
  const a = call(one.ctx, 'ingestBookEvents', Object.assign({ feed }, ACC));
  ok('with time, one round', a.success && a.counts.left === 0, a.counts);

  const sl = boot();
  call(sl.ctx, 'saveAccountRule', Object.assign({ source: 'billing.department', value: 'Admin', account: '6140' }, ACC));
  sl.ctx._BOOKS_WRITE_MS = -1;
  let r, rounds = 0;
  do { r = call(sl.ctx, 'ingestBookEvents', Object.assign({ feed }, ACC)); rounds++; } while (r.success && r.counts.left > 0 && rounds < 30);
  ok('each round posts at least one thing and says what is left', r.success && r.counts.left === 0 && rounds >= 9, { rounds, counts: r.counts });
  eq('  the same books as one round', ledger(sl.store), ledger(one.store));
}

sec('4 · a sync still closes the Inbox item of an event that finally posts');
{
  const store = { FlowSettings: [{ Key: 'booksEngine', Value: 'shadow' }], ActivityLog: [] };
  const ctx = load(undefined, store);
  const feed = JSON.stringify({ complete: true, payroll: [], directorPayables: [], bankTransactions: [],
    billing: [{ prNumber: 'PR-9', payee: 'Globe', department: 'Sales', currency: 'PHP', amount: 900, bankAccountCode: 'AUB', bankTxId: 'TX-9', valueDate: '2026-03-07' }] });
  call(ctx, 'ingestBookEvents', Object.assign({ feed }, ACC));
  ok('no rule yet: it waits in the Inbox', (store.GLInbox || []).some(i => i['Event Key'] === 'CG:BILL:TX-9' && i.Status === 'Open'));
  call(ctx, 'saveAccountRule', Object.assign({ source: 'billing.department', value: 'Sales', account: '6140' }, ACC));
  const r = call(ctx, 'ingestBookEvents', Object.assign({ feed }, ACC));
  ok('with the rule it posts', r.success && r.counts.posted === 1, r.counts);
  ok('  and its Inbox item is closed', store.GLInbox.filter(i => i['Event Key'] === 'CG:BILL:TX-9').every(i => i.Status !== 'Open'), store.GLInbox.map(i => i.Status));
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
