/* A334 — retire the receivables recorded twice (FlowAPI 170).
 *
 * Run:  node tests/flow/a334-retire-duplicates.js
 *
 * WHY. 16 invoices were in the portal twice, each copy fully paid by its own payment, so ₱4.62M of
 * collections counted twice. Accounting approved keeping one copy of each (15 Oct 2026). The fixtures
 * below are three of the real pairs, with their real numbers:
 *   • invoice 80 (Philcement): imported 24 Jun and again 6 Sep, the plain case;
 *   • invoice 100 (Philcement): the copy that stays is filed as 'INV-2026-0100', which matches no
 *     invoice, so it must take the going copy's link to invoice 100;
 *   • invoice 82 (Taganito): the copy that stays carries a ₱0.0012 leftover payment that accounting
 *     agreed to cancel, which would leave ₱0.0012 open unless the receivable is settled to the centavo.
 * Pinned: nothing changes unless every pair passes; payments are voided, never deleted; every removed
 * receivable is copied in full into Overrides first; the copy that stays is still fully paid.
 */
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 1e-6 : JSON.stringify(got) === JSON.stringify(want), { got, want });
const section = (t) => console.log('\n== ' + t + ' ==');

const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };
const WHY = 'Duplicate receivable: accounting approved keeping the 24 Jun copy (Duplicate Receivables file, 15 Oct 2026).';
const PAIRS = [
  { removeArNo: 'AR-202609-041', keepArNo: 'AR-202606-029' },
  { removeArNo: 'AR-202606-050', keepArNo: 'AR-202606-010' },
  { removeArNo: 'AR-202606-049', keepArNo: 'AR-202606-025' },
];

function boot(extra) {
  const arRow = (no, inv, so, cust, amt) => ({ 'AR No': no, 'INV No': inv, 'SO No': so, 'Customer': cust, 'Amount (PHP)': amt,
    'Collected (PHP)': amt, 'Status': 'Paid', 'Due Date': '', 'Notes': '', 'Created At': '2026-06-24', 'Updated At': '' });
  const col = (no, ar, inv, so, cust, date, amt, ewt) => ({ 'Collection No': no, 'AR No': ar, 'INV No': inv, 'SO No': so, 'Customer': cust,
    'Date': date, 'Amount (PHP)': amt, 'Method': 'Imported', 'Reference No': '', 'Notes': '', 'Created At': '2026-06-24', 'EWT (PHP)': ewt,
    'Voided': '', 'Void Reason': '' });
  const store = Object.assign({
    FlowSettings: [], Periods: [], Journal: [], ChartOfAccounts: [], ActivityLog: [], Documents: [], DocMeta: [], Overrides: [],
    CommissionRequests: [], CommissionRequestItems: [], SalesOrders: [],
    Invoices: [
      { 'INV No': '80', 'SO No': '180100005691', 'Customer': 'Philcement Corporation', 'Voided': '' },
      { 'INV No': '100', 'SO No': 'SO-202606-005', 'Customer': 'Philcement Corporation', 'Voided': '' },
      { 'INV No': '82', 'SO No': '3120016966 | T16', 'Customer': 'Taganito HPAL Nickel Corporation', 'Voided': '' },
    ],
    ARAging: [
      arRow('AR-202606-010', 'INV-2026-0100', '180100006167', 'Philcement Corporation', 63192.88),
      arRow('AR-202606-025', '82', '3120016966 | T16', 'Taganito HPAL Nickel Corporation', 193148.8812),
      arRow('AR-202606-029', '80', '180100005691', 'Philcement Corporation', 148094.41),
      arRow('AR-202606-049', '82', '3120016966 | T16', 'Taganito HPAL Nickel Corporation', 195099.8),
      arRow('AR-202606-050', '100', '180100006167', 'Philcement Corporation', 63762.19),
      arRow('AR-202609-041', '80', '180100005691', 'Philcement Corporation', 148094.41),
      arRow('AR-209912-001', '999', 'X', 'Someone Else', 1000),
    ],
    Collections: [
      col('COL-202606-009', 'AR-202606-025', '82', '3120016966 | T16', 'Taganito HPAL Nickel Corporation', '2026-05-04', 193148.88, 0),
      col('COL-202608-008', 'AR-202606-025', '82', '3120016966 | T16', 'Taganito HPAL Nickel Corporation', '2026-05-04', 0.0011999999987892807, 0),
      col('COL-202606-013', 'AR-202606-029', '80', '180100005691', 'Philcement Corporation', '2026-04-07', 148094.41, 0),
      col('COL-202606-033', 'AR-202606-049', '82', '3120016966 | T16', 'Taganito HPAL Nickel Corporation', '2026-06-29', 195099.8, 1951),
      col('COL-202606-034', 'AR-202606-050', '100', '180100006167', 'Philcement Corporation', '2026-06-29', 63762.19, 637.62),
      col('COL-202607-005', 'AR-202606-010', 'INV-2026-0100', '180100006167', 'Philcement Corporation', '2026-07-13', 63192.88, 0),
      col('COL-202609-041', 'AR-202609-041', '80', '180100005691', 'Philcement Corporation', '2026-07-04', 148094.41, 1334.18),
    ],
  }, extra || {});
  return { ctx: load(undefined, store), store };
}
const run = (ctx, extra) => call(ctx, 'retireDuplicateReceivables', Object.assign(
  { pairs: JSON.stringify(PAIRS), extraVoids: JSON.stringify(['COL-202608-008']), reason: WHY }, ACC, extra || {}));
const ar = (store, no) => store.ARAging.find(r => r['AR No'] === no);
const col = (store, no) => store.Collections.find(r => r['Collection No'] === no);
const snapshot = (store) => JSON.stringify([store.ARAging, store.Collections, store.Overrides]);

section('1 · who, why, and a dry run that writes nothing');
{
  const { ctx, store } = boot();
  const before = snapshot(store);
  let r = run(ctx, { actorRole: 'management', actorName: 'Mo Mgmt' });
  ok('management is refused', !r.success && /accounting, admin or the director/.test(r.message), r);
  r = run(ctx, { reason: 'dup' });
  ok('a reason under 10 characters is refused', !r.success && /at least 10 characters/.test(r.message), r);
  r = run(ctx, { dryRun: true });
  ok('dry run succeeds', r.success && r.dryRun, r);
  eq('  3 receivables, 4 payments (3 going copies + the leftover)', [r.totals.receivables, r.totals.payments], [3, 4]);
  eq('  the counted-twice total is the going copies\' payments', r.totals.amount, 406956.4);
  eq('  invoice 100 is relinked, the others are not', r.plan.map(x => x.relinkTo), ['', '100', '']);
  ok('  nothing written', snapshot(store) === before);
}

section('2 · all or nothing: one bad pair stops the whole list');
{
  const { ctx, store } = boot();
  const before = snapshot(store);
  let r = call(ctx, 'retireDuplicateReceivables', Object.assign({ reason: WHY, pairs: JSON.stringify(PAIRS.concat([{ removeArNo: 'AR-209912-001', keepArNo: 'AR-202606-029' }])) }, ACC));
  ok('a receivable listed in two pairs stops the whole list', !r.success && r.problems.some(p => /listed twice/.test(p)), r);
  ok('  nothing written', snapshot(store) === before);
  r = call(ctx, 'retireDuplicateReceivables', Object.assign({ reason: WHY, pairs: JSON.stringify([PAIRS[0], { removeArNo: 'AR-209912-001', keepArNo: 'AR-202606-010' }]) }, ACC));
  ok('a pair on another invoice is refused, by name, and the good pair with it', !r.success && r.problems.some(p => /invoice 999 and invoice INV-2026-0100 are not the same/.test(p)), r);
  ok('  nothing written', snapshot(store) === before);
  r = call(ctx, 'retireDuplicateReceivables', Object.assign({ reason: WHY, pairs: JSON.stringify([{ removeArNo: 'AR-202606-029', keepArNo: 'AR-202606-029' }]) }, ACC));
  ok('a receivable paired with itself is refused', !r.success && /two different receivables/.test(r.message), r);
  r = call(ctx, 'retireDuplicateReceivables', Object.assign({ reason: WHY, pairs: JSON.stringify([{ removeArNo: 'AR-NOPE', keepArNo: 'AR-202606-029' }]) }, ACC));
  ok('an unknown receivable is refused', !r.success && /AR-NOPE was not found/.test(r.message), r);
}
{
  const { ctx, store } = boot();
  col(store, 'COL-202606-013')['Voided'] = 'true';                    // the kept copy of 80 is no longer paid
  const r = run(ctx);
  ok('the copy that stays must still be fully paid', !r.success && r.problems.some(p => /AR-202606-029 would not be fully paid/.test(p)), r);
  eq('  nothing written', store.Overrides.length, 0);
}
{
  const { ctx, store } = boot();
  const r = call(ctx, 'retireDuplicateReceivables', Object.assign({ reason: WHY, pairs: JSON.stringify(PAIRS), extraVoids: JSON.stringify(['COL-202606-009']) }, ACC));
  ok('an extra void that would reopen a real balance is refused', !r.success && r.problems.some(p => /would leave 193148.88 unpaid/.test(p)), r);
  eq('  nothing written', store.Overrides.length, 0);
}

section('3 · the real run');
{
  const { ctx, store } = boot();
  const r = run(ctx);
  ok('succeeds', r.success, r);
  eq('the three going receivables are gone', ['AR-202609-041', 'AR-202606-050', 'AR-202606-049'].map(n => !!ar(store, n)), [false, false, false]);
  eq('the kept copies and the unrelated receivable remain', ['AR-202606-029', 'AR-202606-010', 'AR-202606-025', 'AR-209912-001'].map(n => !!ar(store, n)), [true, true, true, true]);
  eq('the going payments are voided, not deleted', ['COL-202609-041', 'COL-202606-034', 'COL-202606-033', 'COL-202608-008'].map(n => col(store, n) && col(store, n)['Voided']), ['true', 'true', 'true', 'true']);
  ok('  with the reason and who did it', /accounting approved/.test(col(store, 'COL-202609-041')['Void Reason']) && /Duplicate of AR-202606-029/.test(col(store, 'COL-202609-041')['Void Reason']) && /Ana Acct/.test(col(store, 'COL-202609-041')['Void Reason']), col(store, 'COL-202609-041'));
  eq('the kept payments are untouched', ['COL-202606-013', 'COL-202607-005', 'COL-202606-009'].map(n => col(store, n)['Voided']), ['', '', '']);
  eq('every kept copy is still Paid', ['AR-202606-029', 'AR-202606-010', 'AR-202606-025'].map(n => ar(store, n)['Status']), ['Paid', 'Paid', 'Paid']);
  eq('invoice 100: the kept copy and its payment now point at invoice 100', [ar(store, 'AR-202606-010')['INV No'], col(store, 'COL-202607-005')['INV No']], ['100', '100']);
  eq('invoice 82: the ₱0.0012 leftover is voided and the receivable settled to ₱193,148.88', [ar(store, 'AR-202606-025')['Amount (PHP)'], ar(store, 'AR-202606-025')['Status']], [193148.88, 'Paid']);
  const rules = store.Overrides.map(o => o['Rule']);
  eq('Overrides: one row per removal, the relink and the settlement', rules.slice().sort(), ['relinked-invoice', 'retired-duplicate', 'retired-duplicate', 'retired-duplicate', 'settled-sub-centavo']);
  const copy = store.Overrides.find(o => o['Ref No'] === 'AR-202609-041');
  ok('  each removed receivable is kept in full, as JSON', copy && JSON.parse(copy['Entered'])['Amount (PHP)'] === 148094.41 && copy['Expected'] === 'kept AR-202606-029', copy);
  ok('  every row carries the reason and the action', store.Overrides.every(o => o['Reason'] === WHY.slice(0, 300) && o['Action'] === 'retireDuplicateReceivables' && o['User'] === 'Ana Acct'));
  eq('the summary', [r.retired.length, r.voided.length, r.relinked, r.settled], [3, 4, ['AR-202606-010 → 100'], ['AR-202606-025']]);
  const again = run(ctx);
  ok('running it again changes nothing (the going copies are gone)', !again.success && /was not found/.test(again.message), again);
}

section('4 · a payment counted in a commission is not voided without saying so');
{
  const { ctx, store } = boot({
    CommissionRequests: [{ 'Comm No': 'COMM-1', 'Status': 'Approved', 'Salesperson': 'Crystal Gayle', 'SO No': '180100005691' }],
    CommissionRequestItems: [{ 'Comm No': 'COMM-1', 'Collection No': 'COL-202609-041', 'Net Cash (PHP)': 146760.23 }],
  });
  const r = run(ctx);
  ok('refused, naming the claim', !r.success && r.problems.some(p => /COL-202609-041 is claimed on commission COMM-1/.test(p)), r);
  eq('  nothing written', store.Overrides.length, 0);
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
