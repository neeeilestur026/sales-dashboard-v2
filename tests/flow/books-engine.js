/* A320 — the books engine (general ledger), through the real FlowAPI.gs.
 *
 * Run:  node tests/flow/books-engine.js
 *
 * The rules pinned here:
 *   1. Switched off (the default), nothing is written and nothing is refused: live flows are untouched.
 *   2. The chart, tax codes and starting rules seed themselves once; the legacy 1400 is inactive; each
 *      company bank maps to its own GL account.
 *   3. _glPost writes a balanced entry in centavos, in ONE block, with an EventIndex row. The same event
 *      again is a no-op; a changed event is reversed and re-posted — nothing is ever deleted.
 *   4. Anything uncertain goes to the Inbox with the whole event: no account, an unusable account, an
 *      unbalanced entry, a closed month, a change after close. Resolving it posts it (and can remember
 *      a rule); ignoring it needs a reason.
 *   5. Dates before the books start are not posted (the opening balances cover them).
 *   6. Withdrawing an event reverses it.
 *   7. Roles: only accounting/admin/director change the books; management may read; the approval switch
 *      approves in 'self' mode and holds in the stricter modes.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);

const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };
const DIR = { actorRole: 'director', actorName: 'Dee Director' };
const MGT = { actorRole: 'management', actorName: 'Max Mgmt' };
const SALE = { actorRole: 'sales', actorName: 'Sam Sales' };

function boot(mode) {
  const store = { FlowSettings: mode ? [{ Key: 'booksEngine', Value: mode, 'Updated By': 't', 'Updated At': '' }] : [],
                  ActivityLog: [] };
  const ctx = load(undefined, store);
  return { ctx, store };
}
/** Run engine internals the way a request would: caches fresh, inside one "call". */
function run(ctx, fn) { ctx._BOOKS_CFG = ctx._BOOKS_ACCTS = ctx._BOOKS_PERIODS = ctx._BOOKS_EVX = null; return fn(); }
const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
const sale = (key, amt, date) => ({ key, date: date || '2026-02-10', sourceType: 'Test', sourceNo: key, memo: 'test',
  lines: [{ account: '1200', debit: amt }, { account: '4000', credit: amt }] });

sec('1 · off by default: nothing is written, nothing is refused');
{
  const { ctx, store } = boot();
  const r = run(ctx, () => ctx._glPost(sale('T:1', 100)));
  ok('_glPost is skipped while the engine is off', r.skipped === 'off', r);
  ok('  no GL rows', !(store.GL || []).length);
  ok('a closed month refuses nothing while off', run(ctx, () => ctx._periodOpen('2026-01-15')) === true);
  eq('the setting defaults to off', run(ctx, () => ctx._booksMode()), 'off');
}

sec('2 · the chart, tax codes and rules seed themselves');
{
  const { ctx, store } = boot('shadow');
  const a = run(ctx, () => ctx._booksAccounts());
  eq('every seeded account is there', Object.keys(a).length, ctx._BOOKS_COA.length);
  ok('the twelve legacy codes keep their meaning', ['1010', '1200', '1300', '1500', '1600', '2010', '2100', '2200', '4000', '4100', '5000'].every(c => a[c]) && a['1200'].type === 'Asset' && a['2200'].type === 'Liability');
  ok('the legacy 1400 is inactive (the advances model never uses it)', a['1400'] && a['1400'].active === false);
  eq('Metrobank Zabarte maps to 1020', run(ctx, () => ctx._booksBankAccount('METRO_ZAB')), '1020');
  eq('AUB maps to 1022', run(ctx, () => ctx._booksBankAccount('AUB')), '1022');
  ok('tax codes seeded, only 12% VAT carries a rate', store.TaxCodes.length === ctx._BOOKS_TAX_CODES.length && store.TaxCodes.find(t => t.Code === 'VAT-12').Rate === 12);
  eq('a starting rule maps "utilities" to 6210', run(ctx, () => ctx._booksRule('expense.category', 'Utilities')).account, '6210');
  ok('judgement categories have no rule (they go to the Inbox)', run(ctx, () => ctx._booksRule('expense.category', 'salaries and wages')) === null);
  run(ctx, () => ctx._booksAccounts());
  eq('seeding runs once', store.Accounts.length, ctx._BOOKS_COA.length);
}

sec('3 · one writer: balanced, centavo-exact, one block, indexed, never deleted');
{
  const { ctx, store } = boot('shadow');
  let r = run(ctx, () => ctx._glPost({ key: 'T:c', date: '2026-02-01', sourceType: 'Test', sourceNo: 'c',
    lines: [{ account: '6500', debit: 0.1 }, { account: '6500', debit: 0.2 }, { account: '1010', credit: 0.3 }] }));
  ok('0.1 + 0.2 against 0.3 balances in centavos', r.posted, r);
  r = run(ctx, () => ctx._glPost(sale('INV:1', 1120)));
  ok('a sale posts', r.posted && /^JE-202602-\d{5}$/.test(r.entryNo), r);
  const lines = store.GL.filter(g => g['Entry No'] === r.entryNo);
  eq('  two lines', lines.length, 2);
  ok('  contiguous, numbered 1..n, same date and period', lines[0].Line === 1 && lines[1].Line === 2 && lines.every(l => l.Date === '2026-02-10' && l.Period === '2026-02'));
  const ix = store.EventIndex.find(x => x['Event Key'] === 'INV:1');
  ok('  indexed with its entry and fingerprint', ix && ix['Entry No'] === r.entryNo && ix.Status === 'Posted' && /^[0-9a-f]{8}$/.test(ix.Fingerprint), ix);
  const again = run(ctx, () => ctx._glPost(sale('INV:1', 1120)));
  ok('the same event again is a no-op', again.noop && again.entryNo === r.entryNo, again);
  eq('  no new lines', store.GL.length, 5);
  const changed = run(ctx, () => ctx._glPost(sale('INV:1', 1500)));
  ok('a changed event reverses the old entry and posts the new one', changed.posted && changed.reversed && changed.entryNo !== r.entryNo, changed);
  eq('  nothing was deleted (2 + 2 reversal + 2 new + 3 earlier)', store.GL.length, 9);
  const ar = store.GL.filter(g => g.Account === '1200');
  eq('  AR now nets to the new amount', sum(ar, 'Debit') - sum(ar, 'Credit'), 1500);
  ok('  the reversal points at what it reverses', store.GL.some(g => g.Reverses === r.entryNo));
  const tb = call(ctx, 'getGLTrialBalance', Object.assign({}, ACC));
  ok('the trial balance from the GL balances', tb.success && tb.totals.balanced && tb.totals.debit === tb.totals.credit, tb.totals);
}

sec('4 · the Inbox: nothing posts on a guess');
{
  const { ctx, store } = boot('shadow');
  let r = run(ctx, () => ctx._glPost({ key: 'EXP:9', date: '2026-03-05', sourceType: 'Expense', sourceNo: 'EXP-9', memo: 'Mystery payment',
    lines: [{ account: '', debit: 500 }, { account: '1022', credit: 500 }] }));
  ok('a line with no account goes to the Inbox', r.inbox && r.reason === 'no account rule', r);
  ok('  nothing reached the GL', !(store.GL || []).length);
  const ib = call(ctx, 'getBooksInbox', Object.assign({}, ACC));
  ok('  the Inbox lists it with its lines and amount', ib.data.length === 1 && ib.data[0].amount === 500 && ib.data[0].lines.length === 2, ib.data);
  r = run(ctx, () => ctx._glPost({ key: 'EXP:9', date: '2026-03-05', sourceType: 'Expense', sourceNo: 'EXP-9', memo: 'Mystery payment',
    lines: [{ account: '', debit: 500 }, { account: '1022', credit: 500 }] }));
  eq('  parking it again does not duplicate it', store.GLInbox.length, 1);
  let res = call(ctx, 'resolveBooksInboxItem', Object.assign({ itemId: ib.data[0].itemId, resolution: 'ignore', reason: '' }, ACC));
  ok('ignoring needs a reason', !res.success, res);
  res = call(ctx, 'resolveBooksInboxItem', Object.assign({ itemId: ib.data[0].itemId, resolution: 'post', account: '6210', remember: true, ruleSource: 'expense.category', ruleValue: 'Water bill' }, ACC));
  ok('resolving with an account posts it', res.success && /Posted JE-/.test(res.message), res);
  ok('  the GL has the expense against the bank', store.GL.some(g => g.Account === '6210' && g.Debit === 500) && store.GL.some(g => g.Account === '1022' && g.Credit === 500));
  ok('  and the rule is remembered', run(ctx, () => ctx._booksRule('expense.category', 'water bill')).account === '6210');
  ok('  the item is closed with who resolved it', store.GLInbox[0].Status === 'Resolved' && store.GLInbox[0]['Resolved By'] === 'Ana Acct');
  ok('  and audited', store.BooksAudit.some(a => a.Action === 'resolveBooksInboxItem'));
  r = run(ctx, () => ctx._glPost({ key: 'X:1', date: '2026-03-05', sourceType: 'Test', lines: [{ account: '1400', debit: 5 }, { account: '1010', credit: 5 }] }));
  ok('an inactive account goes to the Inbox', r.inbox && r.reason === 'account not usable', r);
  r = run(ctx, () => ctx._glPost({ key: 'X:2', date: '2026-03-05', sourceType: 'Test', lines: [{ account: '6500', debit: 5 }, { account: '1010', credit: 4 }] }));
  ok('an unbalanced entry goes to the Inbox, never the GL', r.inbox && r.reason === 'does not balance', r);
  r = run(ctx, () => ctx._glPost({ key: 'X:3', date: '2026-03-05', sourceType: 'Test', lines: [{ account: '9999', debit: 5 }, { account: '1010', credit: 5 }] }));
  ok('an account outside the chart goes to the Inbox', r.inbox && r.reason === 'account not usable', r);
  r = run(ctx, () => ctx._glPost(sale('OLD:1', 10, '2025-12-20')));
  ok('a date before the books start is not posted', r.skipped === 'before books start', r);
}

sec('5 · closed months');
{
  const { ctx, store } = boot('shadow');
  run(ctx, () => ctx._glPost(sale('INV:2', 100, '2026-01-20')));
  store.Periods = [{ Period: '2026-01', Status: 'Closed', 'Checklist JSON': '', 'Closed By': 'Ana', 'Closed At': '', 'Reopened By': '', 'Reopened At': '', Reason: '' }];
  ok('a document dated in a closed month is refused (engine on)', run(ctx, () => ctx._periodOpen('2026-01-31')) === false);
  ok('  and the open month is fine', run(ctx, () => ctx._periodOpen('2026-02-01')) === true);
  ok('  the refusal names the month and the way forward', /2026-01 is closed/.test(run(ctx, () => ctx._periodRefusal('2026-01-31')).message));
  let r = run(ctx, () => ctx._glPost(sale('INV:3', 50, '2026-01-25')));
  ok('a new posting into a closed month goes to the Inbox', r.inbox && r.reason === 'closed period', r);
  r = run(ctx, () => ctx._glPost(sale('INV:2', 120, '2026-01-20')));
  ok('a change after close goes to the Inbox, not a reversal', r.inbox && r.reason === 'source changed after close', r);
  eq('  the closed month is untouched', store.GL.filter(g => g.Period === '2026-01').length, 2);
}

sec('6 · withdrawing an event reverses it');
{
  const { ctx, store } = boot('shadow');
  run(ctx, () => ctx._glPost(sale('COL:1', 300, '2026-02-03')));
  const w = run(ctx, () => ctx._glWithdraw('COL:1', '2026-02-05', 'voided', 'Ana'));
  ok('a withdrawal posts a reversal', /^JE-/.test(w.reversed), w);
  const ar = store.GL.filter(g => g.Account === '1200');
  eq('  the account nets to zero', sum(ar, 'Debit') - sum(ar, 'Credit'), 0);
  eq('  the event is marked reversed', store.EventIndex.find(x => x['Event Key'] === 'COL:1').Status, 'Reversed');
  ok('  withdrawing twice is a no-op', run(ctx, () => ctx._glWithdraw('COL:1', '2026-02-05')).noop === true);
}

sec('7 · roles and the approval switch');
{
  const { ctx, store } = boot('shadow');
  let r = call(ctx, 'saveAccount', Object.assign({ code: '6510', name: 'Subscriptions', type: 'Expense' }, SALE));
  ok('sales cannot change the chart', !r.success, r);
  r = call(ctx, 'saveAccount', Object.assign({ code: '6510', name: 'Subscriptions', type: 'Expense' }, ACC));
  ok('accounting adds an account', r.success && store.Accounts.some(a => a.Code === '6510' && a.Normal === 'Debit'), r);
  r = call(ctx, 'saveAccount', Object.assign({ code: '65A0', name: 'x', type: 'Expense' }, ACC));
  ok('  a code is four digits', !r.success, r);
  r = call(ctx, 'saveAccount', Object.assign({ code: '1200', name: 'Trade receivables', type: 'Asset', active: false }, ACC));
  ok('  a system account cannot be switched off', !r.success && /system/.test(r.message), r);
  r = call(ctx, 'saveAccount', Object.assign({ code: '1200', name: 'Trade receivables', type: 'Expense' }, ACC));
  ok('  nor change type', !r.success, r);
  r = call(ctx, 'saveAccount', Object.assign({ code: '1200', name: 'Trade receivables', type: 'Asset' }, ACC));
  ok('  but can be renamed', r.success && store.Accounts.find(a => a.Code === '1200').Name === 'Trade receivables', r);
  ok('  every change is audited', store.BooksAudit.filter(a => a.Action === 'saveAccount').length === 2);
  ok('management may read the books', call(ctx, 'getAccounts', Object.assign({}, MGT)).success);
  ok('sales may not', !call(ctx, 'getAccounts', Object.assign({}, SALE)).success);
  ok('nor without a role', !call(ctx, 'getGLEntries', {}).success);
  ok('"self" approval approves at once', run(ctx, () => ctx._booksApprove('je', 1e6, ACC)).approved === true);
  store.FlowSettings.push({ Key: 'booksApprovalMode', Value: 'management' }, { Key: 'booksApprovalThreshold', Value: 10000 });
  ok('management mode holds an accounting entry above the threshold', run(ctx, () => ctx._booksApprove('je', 50000, ACC)).pending === true);
  ok('  approves one below it', run(ctx, () => ctx._booksApprove('je', 9999, ACC)).approved === true);
  ok('  and management approves', run(ctx, () => ctx._booksApprove('je', 50000, MGT)).approved === true);
  r = call(ctx, 'setFlowSettings', Object.assign({ settings: JSON.stringify({ booksEngine: 'on' }) }, ACC));
  ok('only the director or management switch the books on', !r.success, r);
  const st = call(ctx, 'getBooksStatus', Object.assign({}, DIR));
  ok('the status reports the mode and a balanced GL', st.success && st.mode === 'shadow' && st.totals.balanced, st);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
