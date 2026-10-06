/* A325 — the Code.gs half of the system scan, proven in Node before it is pasted.
 *
 * Run:  node tests/flow/codegs-scan.js
 *
 *   1. Payroll, bank and outbound-mail actions refuse a sales login (any login used to pass).
 *   2. An approval acts with the SIGNED-IN role, never the one the request names.
 *   3. A payroll employee is edited / deleted only while that row is still that person.
 *   4. The leave balance moves on a status CHANGE: approving twice takes the days once; un-approving
 *      gives them back.
 *   5. A row number from the browser names the record the page showed (orders, clients) — and a
 *      field the client form sent blank is cleared, not restored.
 *   6. forwardPRToPricing refuses a sheet that is not the caller's; the counter and the newly listed
 *      mutations are POST-only.
 *   7. An approved cutoff refuses incentive changes; a bill's bank leg is not deleted on its own.
 *   8. updateQuotationDriveLink never falls back to "the last row".
 *   9. Dates: the activity log matches its Date cells, birthdays cross the year boundary.
 *  10. Archival of 201-399 old rows finishes (it used to stick forever), and alert mail goes only to a
 *      configured address.
 */
const path = require('path');
const { makeCtx, seedSession } = require(path.join(__dirname, 'gasload-code.js'));

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

function fresh(props) {
  const store = {
    Users: [
      ['Username', 'Password', 'Role', 'Full Name', 'Quotation Sheet ID', 'PR Sheet ID', 'PO Sheet ID', 'App URL - Quotation', 'App URL - PR', 'App URL - PO', 'MRO Sheet ID', 'App URL - MRO', 'Training Mode'],
      ['sam', '', 'sales', 'Sam Sales', 'QS-sam', 'PR-sam', 'PO-sam', '', '', '', '', '', 'FALSE'],
      ['otto', '', 'sales', 'Otto Other', 'QS-otto', 'PR-otto', 'PO-otto', '', '', '', '', '', 'FALSE'],
      ['neil', '', 'director', 'Neil Director', '', '', '', '', '', '', '', '', 'FALSE'],
      ['mia', '', 'management', 'Mia Manager', '', '', '', '', '', '', '', '', 'FALSE'],
      ['ana', '', 'accounting', 'Ana Acct', '', '', '', '', '', '', '', '', 'FALSE'],
    ],
    Sessions: [['Token', 'Username', 'Full Name', 'Role', 'Created At', 'Expires At']],
  };
  seedSession(store, 't-sales', 'sam', 'Sam Sales', 'sales');
  seedSession(store, 't-dir', 'neil', 'Neil Director', 'director');
  seedSession(store, 't-mgmt', 'mia', 'Mia Manager', 'management');
  seedSession(store, 't-acct', 'ana', 'Ana Acct', 'accounting');
  const ctx = makeCtx(store, Object.assign({ INTERNAL_SHARED_SECRET: 'server-secret' }, props || {}));
  return ctx;
}
const get = (ctx, params) => JSON.parse(ctx.doGet({ parameter: params }).getContent());
const post = (ctx, body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const sheet = (ctx, name) => ctx.__store[name];

sec('1 · payroll, bank and mail refuse a sales login');
{
  const ctx = fresh();
  for (const action of ['savePayrollEmployee', 'getPayrollEmployees', 'getBankTransactions', 'addBankTransaction', 'markBillPaid', 'getBillingRecords', 'sendPOEmail', 'sendAcctEmail', 'savePayrollIncentive', 'decidePayrollApproval']) {
    const r = post(ctx, { action, token: 't-sales' });
    ok(action + ' → Forbidden', r.success === false && /Forbidden/.test(r.message), r);
  }
  const r = get(ctx, { action: 'getPayrollEmployees', token: 't-dir' });
  ok('the director still reads payroll', r.success === true, r);
}

sec('2 · an approval acts with the signed-in role');
{
  const ctx = fresh();
  ctx._SESSION = { username: 'sam', role: 'sales' };
  eq('a sales session claiming admin acts as', ctx._callerRole('admin'), 'sales');
  ctx._SESSION = { username: 'backend', role: 'backend', backend: true };
  eq('the server (shared secret, no user) may name the role', ctx._callerRole('Management'), 'management');
}

sec('3 · payroll employee rows are checked before they are changed');
{
  const ctx = fresh();
  ctx._payrollEmployeesSheet();
  const pe = sheet(ctx, 'Payroll Employees');
  pe.push(['Dandan', 'Gayle', 600, 0, 200, 'Active'], ['Estur', 'Rex', 700, 0, 200, 'Active']);
  let r = post(ctx, { action: 'deletePayrollEmployee', token: 't-dir', id: 1, expectName: 'Estur, Rex' });
  ok('a stale delete (row 1 is Dandan, the page meant Estur) is refused', r.success === false && /changed/.test(r.message), r);
  eq('  nobody was deleted', pe.length, 3);
  r = post(ctx, { action: 'savePayrollEmployee', token: 't-dir', id: 2, expectName: 'Dandan, Gayle', lastName: 'Dandan', firstName: 'Gayle', dailyRate: 999 });
  ok('a stale save is refused', r.success === false && /changed/.test(r.message), r);
  eq('  Rex keeps his rate', pe[2][2], 700);
  r = post(ctx, { action: 'deletePayrollEmployee', token: 't-dir', id: 2, expectName: 'Estur, Rex' });
  ok('the right row deletes', r.success === true && pe.length === 2 && pe[1][0] === 'Dandan', r);
  r = post(ctx, { action: 'deletePayrollEmployee', token: 't-dir', id: 1 });
  ok('an older page (no expectName) still works', r.success === true && pe.length === 1, r);
}

sec('4 · leave balance moves on a status change only');
{
  const ctx = fresh();
  ctx._employeesSheet(); ctx._leaveRequestsSheet();
  sheet(ctx, 'Employee Masterlist').push(['Ana Acct', 'Accountant', 'Finance', '2024-01-01', '', '', '', '', '', '', 15]);
  sheet(ctx, 'Leave Requests').push(['Ana Acct', 'Vacation', '2026-10-12', '2026-10-14', 3, 'Trip', 'Pending', '', '', '']);
  const bal = () => sheet(ctx, 'Employee Masterlist')[1][10];
  let r = post(ctx, { action: 'updateLeaveRequest', token: 't-mgmt', rowIndex: 2, status: 'Approved' });
  ok('management approves', r.success === true, r);
  eq('  15 − 3', bal(), 12);
  post(ctx, { action: 'updateLeaveRequest', token: 't-mgmt', rowIndex: 2, status: 'Approved', notes: 'saved again' });
  eq('approving again takes nothing more', bal(), 12);
  post(ctx, { action: 'updateLeaveRequest', token: 't-mgmt', rowIndex: 2, status: 'Rejected' });
  eq('rejecting an approved leave gives the days back', bal(), 15);
  r = post(ctx, { action: 'updateLeaveRequest', token: 't-sales', rowIndex: 2, status: 'Approved', approverRole: 'management' });
  ok('a sales login naming management cannot approve', r.success === false, r);
  eq('  balance untouched', bal(), 15);
}

sec('5 · row numbers name the record the page showed');
{
  const ctx = fresh();
  ctx._ordersSheet(); ctx._clientsSheet();
  sheet(ctx, 'Orders').push(['2026-10-01', 'ORD-1', 'Local', 'ACME'], ['2026-10-02', 'ORD-2', 'Local', 'BETA']);
  let r = post(ctx, { action: 'deleteOrder', token: 't-acct', rowIndex: 2, expectKey: 'ORD-2' });
  ok('deleting row 2 meant for ORD-2 (it holds ORD-1) is refused', r.success === false && /changed/.test(r.message), r);
  eq('  both orders remain', sheet(ctx, 'Orders').length, 3);
  r = post(ctx, { action: 'deleteOrder', token: 't-acct', rowIndex: 3, expectKey: 'ORD-2' });
  ok('the right row deletes', r.success === true && sheet(ctx, 'Orders').length === 2, r);

  sheet(ctx, 'Clients').push(['sam', 'ACME', 'Power', 'Site', '111', '', '', 'Jo', 'Buyer', '0917', 'jo@acme.ph', 'Active', '2026-01-01', 'old note']);
  r = post(ctx, { action: 'updateClient', token: 't-sales', rowIndex: 2, expectKey: 'ACME', companyName: 'ACME', email: '', notes: '' });
  ok('updateClient saves', r.success === true, r);
  eq('  a field sent blank is cleared', sheet(ctx, 'Clients')[1][10], '');
  eq('  a field not sent keeps its value', sheet(ctx, 'Clients')[1][9], '0917');
  r = post(ctx, { action: 'updateClient', token: 't-sales', rowIndex: 2, expectKey: 'BETA', companyName: 'BETA' });
  ok('an update meant for another client is refused', r.success === false && sheet(ctx, 'Clients')[1][1] === 'ACME', r);
}

sec('6 · sheets inside JSON are checked; mutations are POST-only');
{
  const ctx = fresh();
  let r = post(ctx, { action: 'forwardPRToPricing', token: 't-sales', forwardedBy: 'Sam', prRefsJson: JSON.stringify([{ sheetId: 'PR-otto', rowIndex: 2 }]), itemsJson: '[]' });
  ok("forwarding another agent's PR sheet is refused", r.success === false && /not yours/.test(r.message), r);
  ok('  and nothing was submitted', !(sheet(ctx, 'Pricing Submissions') || []).slice(1).length);
  for (const action of ['forwardPRToPricing', 'getNextQuotationNumber', 'attachSalaryDeductionForm', 'activateSalaryDeduction', 'skipSalaryDeductionCutoff']) {
    r = get(ctx, { action, token: 't-dir' });
    ok(action + ' over GET is refused', r.success === false && /POST/.test(r.message), r);
  }
  r = post(ctx, { action: 'getNextQuotationNumber', token: 't-sales' });
  ok('the quotation counter answers a POST', r.success === true && r.count > 0, r);
  r = post(ctx, { action: 'checkSheetAccess', token: 't-sales', sheetId: 'QS-sam' });
  ok('checkSheetAccess: your own sheet', r.success === true, r);
  r = post(ctx, { action: 'checkSheetAccess', token: 't-sales', sheetId: 'QS-otto' });
  ok("checkSheetAccess: someone else's is refused", r.success === false && /not yours/.test(r.message), r);
}

sec('7 · approved cutoffs and bank legs');
{
  const ctx = fresh();
  ctx._payrollApprovalsSheet();
  sheet(ctx, 'Payroll Approvals').push(['2026-09-B', 'Sep B', 'neil', '', 'Approved', 'mia', '', '', '', '']);
  let r = post(ctx, { action: 'savePayrollIncentive', token: 't-dir', period: '2026-09-B', employee: 'Dandan, Gayle', amount: 500 });
  ok('an incentive on an approved cutoff is refused', r.success === false && /approved/.test(r.message), r);
  r = post(ctx, { action: 'savePayrollIncentive', token: 't-dir', period: '2026-10-A', employee: 'Dandan, Gayle', amount: 500 });
  ok('an open cutoff takes it', r.success === true, r);
  sheet(ctx, 'Payroll Incentives')[1][1] = '2026-09-B';             // pretend it was given before approval
  r = post(ctx, { action: 'voidPayrollIncentive', token: 't-dir', incentiveId: sheet(ctx, 'Payroll Incentives')[1][0] });
  ok('voiding one on an approved cutoff is refused', r.success === false && /approved/.test(r.message), r);

  ctx._bankTransactionsSheet();
  sheet(ctx, 'Bank Transactions').push(['TX-1', '2026-10-01', 'AUB', 'Payment', 'Out', 2500, 'PHP', 'PLDT', 'PaymentRequest', 'PR-1', '', 'ana', '']);
  r = post(ctx, { action: 'deleteBankTransaction', token: 't-dir', id: 'TX-1' });
  ok("a paid bill's bank leg is not deleted on its own", r.success === false && sheet(ctx, 'Bank Transactions').length === 2, r);
}

sec('8 · the Drive link never lands on "the last row"');
{
  const ctx = fresh();
  sheet(ctx, 'Users');                                             // quotation sheets resolve to the same stub spreadsheet: give it a first sheet
  const users = ctx.__store.Users;
  const before = JSON.stringify(users);
  const r = post(ctx, { action: 'updateQuotationDriveLink', token: 't-sales', sheetId: 'QS-sam', refNo: '2026-999', driveLink: 'https://drive/x' });
  ok('an unknown reference is refused', r.success === false && /not found/.test(r.message), r);
  ok('  and no row was written', JSON.stringify(users) === before);
}

sec('9 · dates');
{
  const ctx = fresh();
  ok('a Date cell matches its Manila day', ctx._rowDateMatches(new Date(2026, 9, 6, 0, 0, 0), '2026-10-06') === true);
  eq('28 Dec → 3 Jan', ctx._daysUntilNext(0, 3, new Date(2026, 11, 28, 15)).days, 6);
  eq('today is 0 days away', ctx._daysUntilNext(9, 6, new Date(2026, 9, 6, 9)).days, 0);
  ctx._employeesSheet();
  sheet(ctx, 'Employee Masterlist').push(['Ana Acct', '', '', '2020-01-02', '', '', '', '', '', '1990-01-03', 15]);
  const realDate = ctx.Date;
  ctx.Date = class extends realDate { constructor(...a) { if (a.length) super(...a); else super(2026, 11, 28, 10); } static now() { return new realDate(2026, 11, 28, 10).getTime(); } };
  const r = ctx.handleGetBirthdayAnniversary({});                  // directly: the session check would see the faked clock
  ctx.Date = realDate;
  ok('in late December, early-January birthdays and anniversaries show', r.success && r.data.some(x => x.type === 'Birthday' && x.daysAway === 6) && r.data.some(x => x.type === 'Anniversary' && x.daysAway === 5 && x.detail === '7 year(s)'), r);
}

sec('10 · archival finishes; alert mail only to a configured address');
{
  const ctx = fresh();
  let triggers = 0;
  ctx.ScriptApp = { newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => { triggers++; } }) }) }) };
  ctx._historySheet(); ctx._historyArchiveSheet();
  const hist = sheet(ctx, 'ShipmentHistory');
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  for (let i = 0; i < 250; i++) hist.push(['E' + i, 'S1', old, 'x', 'x', '', '', '', '', '', '', '', '', '', '', '', '']);
  hist.push(['NEW', 'S1', new Date().toISOString(), 'x', 'x', '', '', '', '', '', '', '', '', '', '', '', '']);
  ctx.archiveOldHistoryEvents();
  ok('the first run moves 200 and schedules another', hist.length === 52 && triggers === 1, { left: hist.length, triggers });
  ctx.archiveOldHistoryEvents();
  ok('the second run moves the other 50 (it used to throw here forever)', hist.length === 2 && hist[1][0] === 'NEW', hist.length);
  eq('  all 250 are in the archive', sheet(ctx, 'ShipmentHistoryArchive').length - 1, 250);

  eq('no ADMIN_ALERT_EMAIL → no address (never the placeholder)', ctx._alertEmail(), '');
  const ctx2 = fresh({ ADMIN_ALERT_EMAIL: 'ops@hi-escorp.ph' });
  eq('with it set', ctx2._alertEmail(), 'ops@hi-escorp.ph');
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
