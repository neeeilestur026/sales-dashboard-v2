/* A321 — payroll, Billing, Director Payables and bank-page movements reach the books (FlowAPI side).
 *
 * Run:  node tests/flow/books-payroll.js
 *
 * Pinned:
 *   1. A cutoff posts gross to 6010 (commission incentives clear 2040 instead), each employee deduction
 *      to its payable (2420 Pag-IBIG, 2400 SSS, 2410 PhilHealth, 2300 WTax, 1210 advances, 1220 salary
 *      deductions), net pay to 2030, and a 13th-month accrual (basic ÷ 12) to 6030 / 2035.
 *   2. Cutoff B carries the month's employer shares (6020 / the agencies); a missing contribution table
 *      sends it to the Inbox instead of posting a guess.
 *   3. Payroll marked paid clears 2030 from the bank it left.
 *   4. A Billing or Director Payable payment posts by its rule, else waits in the Inbox; a foreign one
 *      needs the pesos the bank took. Personal payables are advances to officers (1230).
 *   5. Own-bank transfers post themselves; any other bank-page movement needs a person.
 *   6. Syncing twice posts nothing new; a payable un-marked in Code.gs is withdrawn; a partial snapshot
 *      withdraws nothing.
 *   6b. A person's Inbox decision is kept: a classified movement re-posts to the same account on every
 *      sync; an ignored one stays out until its amount or date changes; a waiting item is not rewritten.
 *   7. Only accounting/admin/director (or the server) may sync, and only with the books on.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);
const ACC = { actorRole: 'accounting', actorName: 'Ana Acct' };

const row = (employee, o) => Object.assign({ employee, basic: 0, holiday: 0, ot: 0, otherIncome: 0, gross: 0, pagibig: 0, sss: 0, philhealth: 0,
  advances: 0, wtax: 0, totalDeductions: 0, net: 0, incentive: 0, salaryDeduction: 0 }, o);
// Cutoff A: Pag-IBIG deducted. Gayle: 6,000 basic + 500 OT + 1,000 commission incentive = 7,500; Pag-IBIG 200; advance 300.
const A = { period: '2026-05-A', label: 'May 1st cutoff', rows: [
  row('Dandan, Gayle', { basic: 6000, ot: 500, incentive: 1000, gross: 7500, pagibig: 200, advances: 300, net: 7000 }),
  row('Simeon, Angelica', { basic: 5000, gross: 5000, pagibig: 200, net: 4800 })], commissionIncentives: 1000, paidDate: '2026-05-11', paidBank: 'AUB' };
// Cutoff B: SSS + PhilHealth deducted, WTax, salary deduction; employer shares from the tables.
const B = { period: '2026-05-B', label: 'May 2nd cutoff', rows: [
  row('Dandan, Gayle', { basic: 6000, gross: 6000, sss: 825, philhealth: 200, wtax: 150, salaryDeduction: 500, net: 4325 }),
  row('Simeon, Angelica', { basic: 5000, gross: 5000, sss: 400, philhealth: 200, net: 4400 })], commissionIncentives: 0,
  employerShares: { month: '2026-05', totals: { sssER: 1600, sssEC: 20, phER: 400, hdmfER: 400 }, missing: [] } };
const feed = (o) => JSON.stringify(Object.assign({ complete: true, payroll: [A, B], billing: [], directorPayables: [], bankTransactions: [] }, o || {}));

function boot(mode) {
  const store = { FlowSettings: mode ? [{ Key: 'booksEngine', Value: mode }] : [], ActivityLog: [] };
  return { ctx: load(undefined, store), store };
}
const GLa = (store, acct) => (store.GL || []).filter(g => g.Account === acct);
const net = (store, acct) => Math.round(GLa(store, acct).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0) * 100) / 100;
const balanced = (store) => Math.abs((store.GL || []).reduce((s, g) => s + (Number(g.Debit) || 0) - (Number(g.Credit) || 0), 0)) < 0.005;

sec('1–3 · payroll');
{
  const { ctx, store } = boot('shadow');
  const r = call(ctx, 'ingestBookEvents', Object.assign({ feed: feed() }, ACC));
  ok('the cutoffs post', r.success && r.counts.posted === 3, r);
  const a = store.GL.filter(g => g['Event Key'] === 'CG:PAY:2026-05-A');
  ok('  cutoff A is dated the 10th', a.every(g => g.Date === '2026-05-10'));
  eq('  wages 6010 (gross less commission, both cutoffs)', net(store, '6010'), (12500 - 1000) + 11000);
  eq('  the commission incentive clears 2040', net(store, '2040'), 1000);
  eq('  Pag-IBIG: 400 employee (A) + 400 employer (B)', net(store, '2420'), -800);
  eq('  SSS: 1,225 employee + 1,620 employer and EC', net(store, '2400'), -2845);
  eq('  PhilHealth: 400 + 400', net(store, '2410'), -800);
  eq('  employer contributions 6020', net(store, '6020'), 2420);
  eq('  withholding tax on compensation', net(store, '2300'), -150);
  eq('  cash advances recovered', net(store, '1210'), -300);
  eq('  salary deductions recovered', net(store, '1220'), -500);
  eq("  13th month accrued: 22,000 basic ÷ 12, exact for the month", net(store, "6030"), 1833.33);
  eq('  and owed (2035)', net(store, '2035'), -1833.33);
  eq('  cutoff A is paid: 2030 = only B is still owed', net(store, '2030'), -(4325 + 4400));
  eq('  AUB paid cutoff A on the 11th', net(store, '1022'), -11800);
  ok('  balanced', balanced(store));
  const again = call(ctx, 'ingestBookEvents', Object.assign({ feed: feed() }, ACC));
  ok('syncing again posts nothing new', again.success && again.counts.posted === 0 && again.counts.unchanged === 3, again.counts);
  const B2 = JSON.parse(JSON.stringify(B)); B2.employerShares.missing = ['SSS']; B2.period = '2026-06-B'; B2.employerShares.month = '2026-06';
  const r2 = call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [A, B, B2] }) }, ACC));
  ok('a month without its contribution table waits in the Inbox', r2.counts.inbox === 1 && store.GLInbox.some(i => i['Event Key'] === 'CG:PAY:2026-06-B' && /contribution table for SSS/.test(i.Reason)), store.GLInbox.map(i => i.Reason));
  const B3 = JSON.parse(JSON.stringify(B)); B3.period = '2026-07-B'; B3.rows[0].net = 9999;
  call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [A, B, B3] }) }, ACC));
  ok('a register that does not add up waits in the Inbox', store.GLInbox.some(i => i['Event Key'] === 'CG:PAY:2026-07-B' && /adds up/.test(i.Reason)));
}

sec('4–5 · Billing, Director Payables and the bank page');
{
  const { ctx, store } = boot('shadow');
  const bill = [{ prNumber: 'PR-0101', payee: 'PLDT', department: 'Admin', purpose: 'Internet May', currency: 'PHP', amount: 2500, bankAccountCode: 'AUB', bankTxId: 'TX-1', valueDate: '2026-05-05' },
                { prNumber: 'PR-0102', payee: 'Adobe', department: 'Marketing', purpose: 'Licence', currency: 'USD', amount: 60, bankAccountCode: 'AUB', bankTxId: 'TX-2', valueDate: '2026-05-06' }];
  const dps = [{ id: 'dp-1', payee: 'Meralco', category: 'Utilities', description: 'May', amount: 8000, currency: 'PHP', bankAccount: 'AUB', bankTxId: 'TX-3', valueDate: '2026-05-07' },
               { id: 'dp-2', payee: 'BIR', category: 'Tax', description: '1601-C April', amount: 3000, currency: 'PHP', bankAccount: 'AUB', bankTxId: 'TX-4', valueDate: '2026-05-10' },
               { id: 'dp-3', payee: 'Neil', category: 'Personal', description: 'Car insurance', amount: 15000, currency: 'PHP', bankAccount: 'METRO_ZAB', bankTxId: 'TX-5', valueDate: '2026-05-12' }];
  const txs = [{ id: 'B1', date: '2026-05-02', accountCode: 'METRO_ZAB', type: 'Transfer Out', direction: -1, amount: 100000, pairedId: 'B2' },
               { id: 'B2', date: '2026-05-02', accountCode: 'AUB', type: 'Transfer In', direction: 1, amount: 100000, pairedId: 'B1' },
               { id: 'B3', date: '2026-05-03', accountCode: 'METRO_SJDM', type: 'Deposit', direction: 1, amount: 50000, description: 'client deposit' }];
  call(ctx, 'saveAccountRule', Object.assign({ source: 'billing.department', value: 'Admin', account: '6140' }, ACC));
  const r = call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [], billing: bill, directorPayables: dps, bankTransactions: txs }) }, ACC));
  ok('ingested', r.success, r);
  eq('a Billing payment with a department rule posts (6140)', net(store, '6140'), 2500);
  ok('  a foreign one without the pesos waits for them', store.GLInbox.some(i => i['Event Key'] === 'CG:BILL:TX-2' && /pesos/.test(i.Reason)));
  eq('a utilities payable posts by its category rule', net(store, '6210'), 8000);
  ok('  a tax payment waits (which tax is a decision)', store.GLInbox.some(i => i['Event Key'] === 'CG:DP:dp-2' && /account for Tax/.test(i.Reason)));
  eq('  a personal payable is an advance to an officer (1230)', net(store, '1230'), 15000);
  eq('an own-bank transfer posts itself: AUB in', net(store, '1022'), 100000 - 2500 - 8000);
  eq('  Metrobank Zabarte out', net(store, '1020'), -100000 - 15000);
  ok('any other bank-page movement needs a person', store.GLInbox.some(i => i['Event Key'] === 'CG:BANK:B3' && /classification/.test(i.Reason)));
  ok('balanced', balanced(store));

  const dps2 = dps.filter(d => d.id !== 'dp-1');
  const partial = call(ctx, 'ingestBookEvents', Object.assign({ feed: JSON.stringify({ complete: false, payroll: [], billing: bill, directorPayables: dps2, bankTransactions: txs }) }, ACC));
  ok('a partial snapshot withdraws nothing', partial.counts.withdrawn === 0 && net(store, '6210') === 8000, partial.counts);
  const w = call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [], billing: bill, directorPayables: dps2, bankTransactions: txs }) }, ACC));
  ok('a payable un-marked in Code.gs is withdrawn', w.counts.withdrawn === 1 && net(store, '6210') === 0, w.counts);
  const dps3 = dps.map(d => d.id === 'dp-3' ? Object.assign({}, d, { amount: 16000 }) : d);
  call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [], billing: bill, directorPayables: dps3, bankTransactions: txs }) }, ACC));
  eq('an amount edited after payment re-posts', net(store, '1230'), 16000);
}

sec('6 · a decision made in the Inbox is kept');
{
  const { ctx, store } = boot('shadow');
  const txs = [{ id: 'B3', date: '2026-05-03', accountCode: 'METRO_SJDM', type: 'Deposit', direction: 1, amount: 50000, description: 'loan from director' },
               { id: 'B4', date: '2026-05-04', accountCode: 'AUB', type: 'Withdrawal', direction: -1, amount: 2000, description: 'payroll top-up (already in payroll)' },
               { id: 'X1', date: '2026-05-05', accountCode: 'AUB', type: 'Transfer Out', direction: -1, amount: 10000, pairedId: 'X2' },
               { id: 'X2', date: '2026-05-05', accountCode: 'METRO_ZAB', type: 'Transfer In', direction: 1, amount: 9975, pairedId: 'X1' }];
  const sync = (t) => call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [], bankTransactions: t || txs }) }, ACC));
  const r = sync();
  ok('three movements wait for a person', r.counts.inbox === 3, r.counts);
  ok('  a transfer that lost 25 pesos asks about the difference', store.GLInbox.some(i => i['Event Key'] === 'CG:XFER:X1' && /transfer difference/.test(i.Reason)));
  const item = (k) => store.GLInbox.find(i => i['Event Key'] === k && i.Status === 'Open');
  ok('the deposit is posted as a loan from the director (2900)', call(ctx, 'resolveBooksInboxItem', Object.assign({ itemId: item('CG:BANK:B3')['Item ID'], resolution: 'post', account: '2900' }, ACC)).success);
  ok('the withdrawal is ignored (already in payroll)', call(ctx, 'resolveBooksInboxItem', Object.assign({ itemId: item('CG:BANK:B4')['Item ID'], resolution: 'ignore', reason: 'already in payroll' }, ACC)).success);
  ok('the transfer fee is posted to bank charges (6330)', call(ctx, 'resolveBooksInboxItem', Object.assign({ itemId: item('CG:XFER:X1')['Item ID'], resolution: 'post', account: '6330' }, ACC)).success);
  eq('  ZAB received 9,975', net(store, '1020'), 9975);
  eq('  the fee', net(store, '6330'), 25);
  const lines = store.GL.length, items = store.GLInbox.length;
  const again = sync();
  ok('syncing again: nothing new posted, nothing back in the Inbox', again.counts.posted === 0 && again.counts.inbox === 0 && store.GL.length === lines && store.GLInbox.length === items, again.counts);
  eq('  the loan stays posted once', net(store, '2900'), -50000);
  const changed = txs.map(t => t.id === 'B4' ? Object.assign({}, t, { amount: 2500 }) : t);
  sync(changed);
  ok('an ignored movement whose amount changed asks again', store.GLInbox.some(i => i['Event Key'] === 'CG:BANK:B4' && i.Status === 'Open'));
  const before = store.GLInbox.filter(i => i.Status === 'Open').length;
  const quiet = sync(changed);
  ok('  and a waiting item is not rewritten on every sync', quiet.counts.inbox === 1 && store.GLInbox.filter(i => i.Status === 'Open').length === before, quiet.counts);
  const moved = txs.map(t => t.id === 'B3' ? Object.assign({}, t, { amount: 60000 }) : t);
  sync(moved);
  eq('a posted movement whose amount changed re-posts to the same account', net(store, '2900'), -60000);
  ok('  balanced', balanced(store));
  const cov = call(ctx, 'getBooksCoverage', Object.assign({ from: '2026-05-01', to: '2026-05-31' }, ACC));
  ok('coverage reads fine with decisions in place', cov.success, cov);
}

sec('6c · an event a person moved out of a closed month stays moved');
{
  const { ctx, store } = boot('shadow');
  store.Periods = [{ Period: '2026-04', Status: 'Closed' }];
  const tx = [{ id: 'X3', date: '2026-04-15', accountCode: 'AUB', type: 'Transfer Out', direction: -1, amount: 5000, pairedId: 'X4' },
              { id: 'X4', date: '2026-04-15', accountCode: 'METRO_SJDM', type: 'Transfer In', direction: 1, amount: 5000, pairedId: 'X3' }];
  const sync = () => call(ctx, 'ingestBookEvents', Object.assign({ feed: feed({ payroll: [], bankTransactions: tx }) }, ACC));
  sync();
  const it = store.GLInbox.find(i => i['Event Key'] === 'CG:XFER:X3' && i.Status === 'Open');
  ok('a transfer dated into a closed month waits', it && /closed period/.test(it.Reason), store.GLInbox);
  ok('  posted into May by a person', call(ctx, 'resolveBooksInboxItem', Object.assign({ itemId: it['Item ID'], resolution: 'post', date: '2026-05-01' }, ACC)).success);
  const lines = store.GL.length;
  const again = sync();
  ok('syncing again leaves it in May: no reversal, no new Inbox item', store.GL.length === lines && again.counts.unchanged === 1 && !store.GLInbox.some(i => i.Status === 'Open'), again.counts);
  ok('  every line is dated 1 May', store.GL.every(g => g.Date === '2026-05-01'));
}

sec('7 · who may sync');
{
  const { ctx } = boot('shadow');
  ok('sales may not', !call(ctx, 'ingestBookEvents', { feed: feed(), actorRole: 'sales' }).success);
  ok('the server may (role "system")', call(ctx, 'ingestBookEvents', { feed: feed(), actorRole: 'system', actorName: 'server' }).success);
  const off = boot();
  ok('not while the books are off', !call(off.ctx, 'ingestBookEvents', Object.assign({ feed: feed() }, ACC)).success);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
