/* A320 — the books: other payments, manual expenses, travel and commissions; and two live travel fixes.
 *
 * Run:  node tests/flow/books-other.js
 *
 * The rules pinned here:
 *   1. LIVE FIX (books off too): an approved travel week is expensed ONCE. The expense now carries the
 *      payout's PR number, and paying the payout no longer books it a second time — including weeks
 *      expensed before this fix, found through the travel record. A float cash advance is not an expense.
 *   2. With the books on, a travel week is an expense of the week it happened (Dr by item / Cr 2025); its
 *      payout clears 2025; a float issue is an advance to the rep (1210).
 *   3. A Type 'Other' payment posts to the account chosen on it, else a rule on its department, else the
 *      Inbox; with a PO No it pays landed costs (2050). VAT only with TIN + SI no.; EWT only when switched on.
 *   4. A manual expense needs how it was paid (books on); a rule on its category picks the account;
 *      judgement categories wait in the Inbox; editing re-posts; deleting withdraws.
 *   5. A commission is expensed when approved (6040 / 2040), and follows its adjustment.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);

const GAYLE = { actorName: 'Crystal Gayle', actorRole: 'sales' };
const ACCT = { actorName: 'Rojan Francisco', actorRole: 'accounting' };
const DIR = { actorName: 'Neil Estur', actorRole: 'director' };
const w = (a, b) => Object.assign({}, a, b);
const ITEMS = JSON.stringify([
  { seq: 1, date: '2026-07-27', kind: 'Transport', description: 'Residence to Terminal', means: 'Tricycle', amount: 35, hasReceipt: false },
  { seq: 2, date: '2026-07-27', kind: 'Meals', description: 'Lunch', amount: 150, hasReceipt: false },
  { seq: 3, date: '2026-07-28', kind: 'Transport', description: 'Fuel', means: 'Fuel', amount: 500, hasReceipt: false }]);

function boot(mode, extra) {
  const store = Object.assign({ FlowSettings: mode ? [{ Key: 'booksEngine', Value: mode }] : [],
    TravelReplenishments: [], TravelReplenishmentItems: [], TravelFloats: [], PaymentRequests: [], Expenses: [], ActivityLog: [],
    Documents: [], WeeklyItineraries: [], ItineraryItems: [], ClientVisits: [], APAging: [], PurchaseOrders: [], Journal: [] }, extra || {});
  return { ctx: load(undefined, store), store };
}
function approvedWeek(ctx) {
  call(ctx, 'setTravelFloat', w(DIR, { user: 'Crystal Gayle', amount: 2000, effectiveFrom: '2026-01-01' }));
  const r = call(ctx, 'saveTravelReplenishment', w(GAYLE, { weekStart: '2026-07-27', purpose: 'Client visits', position: 'Sales Engineer', items: ITEMS }));
  call(ctx, 'submitTravelReplenishment', w(ACCT, { travNo: r.travNo, waiverReason: 'no itinerary filed yet' }));
  call(ctx, 'approveTravelReplenishment', w(ACCT, { travNo: r.travNo }));
  const a = call(ctx, 'approveTravelReplenishment', w(DIR, { travNo: r.travNo }));
  return { travNo: r.travNo, prNo: a.prNo, out: a };
}
const proof = (store, prNo) => store.Documents.push({ 'Module': 'Payment Request', 'Ref No': prNo, 'Doc Type': 'Proof of Payment' });
const GLa = (store, acct) => (store.GL || []).filter(g => g.Account === acct);
const net = (store, acct) => Math.round(GLa(store, acct).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0) * 100) / 100;
const balanced = (store) => Math.abs((store.GL || []).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0)) < 0.005;

sec('1 · live fixes (books off): a travel week is expensed once; a float is not an expense');
{
  const { ctx, store } = boot();
  const wk = approvedWeek(ctx);
  ok('the week is approved with a payout', wk.out.success && /^PR-/.test(wk.prNo), wk.out);
  const trav = store.Expenses.filter(e => String(e['Legacy Key']).indexOf('TRAV:') === 0);
  eq('one travel expense', trav.length, 1);
  eq('  carrying the payout number (it carried the TRAV number before)', trav[0]['Voucher No'], wk.prNo);
  proof(store, wk.prNo);
  const pr = store.PaymentRequests.find(p => p['PR No'] === wk.prNo);
  const paid = call(ctx, 'markPaymentRequestPaid', w(pr['Payment Method'] && /tele/i.test(pr['Payment Method']) ? ACCT : DIR, { prNo: wk.prNo, valueDate: '2026-08-03' }));
  ok('the payout is paid', paid.success, paid);
  eq('  still ONE expense for the week (it was booked twice)', store.Expenses.length, 1);
  // a week expensed before the fix: its voucher is the TRAV number
  const b = boot();
  const wk2 = approvedWeek(b.ctx);
  b.store.Expenses[0]['Voucher No'] = wk2.travNo;
  proof(b.store, wk2.prNo);
  const pr2 = b.store.PaymentRequests.find(p => p['PR No'] === wk2.prNo);
  call(b.ctx, 'markPaymentRequestPaid', w(/tele/i.test(pr2['Payment Method']) ? ACCT : DIR, { prNo: wk2.prNo, valueDate: '2026-08-03' }));
  eq('  a week expensed before the fix is found through its travel record', b.store.Expenses.length, 1);
  const c = boot();
  const fl = call(c.ctx, 'setTravelFloat', w(DIR, { user: 'Crystal Gayle', amount: 2000, effectiveFrom: '2026-01-01' }));
  const f = call(c.ctx, 'requestTravelFloatCash', w(DIR, { floatKey: fl.floatKey }));
  ok('a float cash request is raised', f.success && f.prNo, f);
  const fpr = c.store.PaymentRequests.find(p => p['PR No'] === f.prNo);
  fpr.Status = 'Approved';
  proof(c.store, f.prNo);
  const fp = call(c.ctx, 'markPaymentRequestPaid', w(/tele/i.test(fpr['Payment Method']) ? ACCT : DIR, { prNo: f.prNo, valueDate: '2026-07-20' }));
  ok('the float is paid', fp.success, fp);
  eq('  and it is not booked as spending (the rep owes it back)', c.store.Expenses.length, 0);
  ok('  the message says so', /float advance/.test(fp.message), fp.message);
}

sec('2 · travel in the books');
{
  const { ctx, store } = boot('shadow');
  const wk = approvedWeek(ctx);
  const tl = store.GL.filter(g => g['Event Key'] === 'TRAV:' + wk.travNo);
  ok('the week is expensed by item, dated the week it happened', tl.length && tl.every(g => g.Date === '2026-08-02' || g.Date === '2026-08-01' || g.Date === '2026-08-02'), tl.map(g => g.Date));
  eq('  fuel 6110', net(store, '6110'), 500);
  eq('  meals 6130', net(store, '6130'), 150);
  eq('  other transport 6100', net(store, '6100'), 35);
  eq('  owed to the rep (2025)', net(store, '2025'), -685);
  proof(store, wk.prNo);
  const pr = store.PaymentRequests.find(p => p['PR No'] === wk.prNo);
  const paid = call(ctx, 'markPaymentRequestPaid', w(/tele/i.test(pr['Payment Method']) ? ACCT : DIR, { prNo: wk.prNo, valueDate: '2026-08-03', paidFrom: '1010' }));
  ok('the payout is paid from cash on hand', paid.success, paid);
  eq('  2025 is cleared', net(store, '2025'), 0);
  eq('  cash on hand paid it', net(store, '1010'), -685);
  const fl = call(ctx, 'setTravelFloat', w(DIR, { user: 'Juan Rep', amount: 3000, effectiveFrom: '2026-01-01' }));
  const f = call(ctx, 'requestTravelFloatCash', w(DIR, { floatKey: fl.floatKey }));
  const fpr = store.PaymentRequests.find(p => p['PR No'] === f.prNo);
  fpr.Status = 'Approved'; proof(store, f.prNo);
  call(ctx, 'markPaymentRequestPaid', w(/tele/i.test(fpr['Payment Method']) ? ACCT : DIR, { prNo: f.prNo, valueDate: '2026-08-04', paidFrom: '1010' }));
  eq('a float issue is an advance to the rep (1210)', net(store, '1210'), 3000);
  ok('balanced', balanced(store));
}

sec('3 · other payments');
{
  const other = (no, extra) => Object.assign({ 'PR No': no, 'Type': 'Other', 'Payee': 'FedEx', 'Supplier': '', 'Currency': 'PHP', 'Amount': 1120,
    'Purpose': 'Courier', 'Department': 'Logistics', 'Payment Method': 'Telegraphic Transfer', 'Status': 'Approved' }, extra || {});
  const { ctx, store } = boot('shadow', { PaymentRequests: [other('PRF-A'), other('PRF-B'), other('PRF-C', { 'PO No': 'PO-9', 'Payee': 'Broker' }), other('PRF-D')] });
  ['PRF-A', 'PRF-B', 'PRF-C', 'PRF-D'].forEach(n => proof(store, n));
  let r = call(ctx, 'markPaymentRequestPaid', w(ACCT, { prNo: 'PRF-A', valueDate: '2026-05-02', paidFrom: 'AUB', account: '6150', supplierTin: '111-222-333-00000', siNo: 'OR 9', vatAmount: 120 }));
  ok('a courier payment with an account chosen posts', r.success, r);
  eq('  6150 net of VAT', net(store, '6150'), 1000);
  eq('  input VAT claimed with TIN and OR', net(store, '1500'), 120);
  eq('  AUB paid it', net(store, '1022'), -1120);
  r = call(ctx, 'markPaymentRequestPaid', w(ACCT, { prNo: 'PRF-B', valueDate: '2026-05-02', paidFrom: 'AUB', vatAmount: 120 }));
  ok('no account and no department rule: recorded, but waits in the Inbox', r.success && store.GLInbox.some(i => i['Source No'] === 'PRF-B' && i.Reason === 'no account'), store.GLInbox);
  r = call(ctx, 'markPaymentRequestPaid', w(ACCT, { prNo: 'PRF-C', valueDate: '2026-05-03', paidFrom: 'AUB' }));
  eq('a payment carrying a PO No clears landed costs (2050)', net(store, '2050'), 1120);
  store.FlowSettings.push({ Key: 'ewtMode', Value: 'on' });
  r = call(ctx, 'markPaymentRequestPaid', w(ACCT, { prNo: 'PRF-D', valueDate: '2026-05-04', paidFrom: 'AUB', account: '6300', ewtAtc: 'WC010', ewtBase: 1142.86, ewtAmount: 22.86 }));
  ok('with withholding on, the tax withheld goes to 2310', r.success && net(store, '2310') === -22.86 && GLa(store, '2310')[0]['Tax Code'] === 'WC010', [r, net(store, '2310')]);
  eq('  the fee is the gross (cash + tax)', net(store, '6300'), 1142.86);
  ok('balanced', balanced(store));
}

sec('4 · manual expenses');
{
  const { ctx, store } = boot('shadow');
  let r = call(ctx, 'addExpense', w(ACCT, { date: '2026-05-10', category: 'Utilities', description: 'Meralco May', amount: 5600 }));
  ok('with the books on, how it was paid is required', !r.success && /how this was paid/.test(r.message), r);
  r = call(ctx, 'addExpense', w(ACCT, { date: '2026-05-10', category: 'Utilities', description: 'Meralco May', amount: 5600, paidFrom: 'AUB' }));
  ok('a utilities bill posts by the category rule', r.success && net(store, '6210') === 5600 && net(store, '1022') === -5600, r);
  r = call(ctx, 'addExpense', w(ACCT, { date: '2026-05-10', category: 'Salaries and wages', description: 'misc', amount: 900, paidFrom: '1010' }));
  ok('a judgement category waits in the Inbox', r.success && store.GLInbox.some(i => i['Source No'] === r.expNo && /no account for/.test(i.Reason)), store.GLInbox.map(i => i.Reason));
  const row = store.Expenses.find(e => e['Exp No'] === store.Expenses[0]['Exp No']);
  r = call(ctx, 'updateExpense', w(ACCT, { rowIndex: 2, category: 'Utilities', amount: 6000, date: '2026-05-10' }));
  ok('an edit re-posts', r.success && net(store, '6210') === 6000, [r, net(store, '6210')]);
  r = call(ctx, 'addExpense', w(ACCT, { date: '2026-05-11', category: 'Rent expense', amount: 30000, paidFrom: '2020' }));
  ok('an unpaid bill is accrued (2020)', r.success && net(store, '2020') === -30000, r);
  r = call(ctx, 'deleteExpense', w(ACCT, { rowIndex: 2 }));
  ok('deleting withdraws it', r.success && net(store, '6210') === 0 && net(store, '1022') === 0, [r, net(store, '6210')]);
  const mig = boot('shadow');
  r = call(mig.ctx, 'addExpense', w(ACCT, { date: '2026-05-12', category: 'Utilities', amount: 100, legacyKey: 'PRF:PRF-X' }));
  ok('an expense that is a view of a payment needs no "paid from" and is never posted', r.success && !(mig.store.GL || []).length, r);
  ok('balanced', balanced(store));
}

sec('5 · commissions');
{
  const { ctx, store } = boot('shadow', { CommissionRequests: [{ 'Comm No': 'COMM-1', 'Salesperson': 'Crystal Gayle', 'SO No': 'SO-1', 'Amount (PHP)': 2500,
    'Adjustment (PHP)': 0, 'Status': 'Approved', 'Mgmt Approved At': '2026-06-30' }] });
  ctx._BOOKS_CFG = ctx._BOOKS_ACCTS = ctx._BOOKS_PERIODS = ctx._BOOKS_EVX = null;
  let r = ctx._booksSyncCommission('COMM-1', 'Neil');
  ok('an approved commission is expensed in the month approved', r && r.posted && GLa(store, '6040')[0].Date === '2026-06-30', r);
  eq('  owed to the rep (2040)', net(store, '2040'), -2500);
  store.CommissionRequests[0]['Adjustment (PHP)'] = -500;
  ctx._BOOKS_CFG = ctx._BOOKS_ACCTS = ctx._BOOKS_PERIODS = ctx._BOOKS_EVX = null;
  r = ctx._booksSyncCommission('COMM-1', 'Neil');
  ok('an adjustment re-posts it', r && r.posted && r.reversed, r);
  eq('  2040 follows', net(store, '2040'), -2000);
  store.CommissionRequests[0].Status = 'Rejected';
  ctx._BOOKS_CFG = ctx._BOOKS_ACCTS = ctx._BOOKS_PERIODS = ctx._BOOKS_EVX = null;
  ctx._booksSyncCommission('COMM-1', 'Neil');
  eq('a rejected one is withdrawn', net(store, '6040'), 0);
  const src = require('fs').readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  ok('the final approval and every adjustment call the books', /if \(stage\.next === 'Approved'\) _booksSyncCommission\(p\.commNo/.test(src) && /_booksSyncCommission\(p\.commNo, p\.actorName\);   \/\/ A320 — an approved commission's accrual follows its adjustment/.test(src));
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
