/* A275 — salary deductions: an employee buys something and repays it from payroll.
 *
 * Run:  node tests/flow/salary-deduction.js
 *
 * WHY THIS FILE EXISTS. Every number here comes out of a real person's pay, and the engine has three
 * properties that are easy to state and easy to break:
 *
 *   1. The instalments always sum to EXACTLY the agreed total — never a centavo more, whatever the
 *      division does. The form this replaced got this wrong three different ways at once.
 *   2. A short cutoff CARRIES FORWARD. The per-cutoff figure never rises; the schedule just runs
 *      longer. That is what the employee signed.
 *   3. Approving a cutoff banks the money ONCE, and re-saving an approved cutoff cannot move a
 *      figure that has already been signed for.
 *
 * The awkward cases are pinned deliberately: a 1st-cutoff-only shortfall must wait for the next 1st
 * cutoff rather than grabbing the 2nd, and a void must re-open a schedule that had reached zero.
 */
const path = require('path');
const { makeCtx, seedSession } = require(path.join(__dirname, 'gasload-code.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want,
  { got, want });
const section = (t) => console.log('\n' + t);

const EMP = 'Lucena, Gerald';
const TOKEN = 'TKN-DIRECTOR';

/* Sheets must be seeded BEFORE the context is built: the stub binds each sheet object to the array
   it finds at boot, so assigning store[name] afterwards is invisible to the loaded script. */
function boot(extraSheets) {
  const store = Object.assign({}, extraSheets || {});
  seedSession(store, TOKEN, 'gerald.l', 'Gerald Lucena', 'director');
  seedSession(store, 'TKN-EMP', 'gerald.l', 'Gerald Lucena', 'sales');
  seedSession(store, 'TKN-OTHER', 'someone.else', 'Someone Else', 'sales');
  return makeCtx(store);
}

/** Create + attach the signed form + activate. Returns the deduction number. */
function agree(ctx, opts) {
  const res = ctx.handleSaveSalaryDeduction(Object.assign({
    token: TOKEN, employee: EMP, username: 'gerald.l', item: 'Lenovo laptop',
    totalAmount: 34995, perCutoffAmount: 2916.25,
    cadence: 'First Cutoff Only', startPeriod: '2026-09-A'
  }, opts || {}));
  if (!res.success) throw new Error('agree failed: ' + res.message);
  if (opts && opts.leaveDraft) return res.deductionNo;
  ctx.handleAttachSalaryDeductionForm({ token: TOKEN, deductionNo: res.deductionNo,
    link: 'https://drive.example/signed.pdf', docId: 'DOC-1', fileName: 'signed.pdf' });
  ctx.handleActivateSalaryDeduction({ token: TOKEN, deductionNo: res.deductionNo });
  return res.deductionNo;
}

/** One employee's register row for a cutoff. gross is basic pay; no statutory unless asked. */
function regRow(basic, extra) {
  return Object.assign({ employee: EMP, basicPay: basic, holidayPay: 0, otPay: 0, otherIncome: 0,
    pagibig: 0, sss: 0, philhealth: 0, advances: 0, wtax: 0 }, extra || {});
}

function saveReg(ctx, period, basic, extra) {
  return ctx.handleSavePayrollRegister({ period, rows: JSON.stringify([regRow(basic, extra)]) });
}

function readReg(ctx, period) {
  const r = ctx.handleGetPayrollRegister({ period });
  return (r.data || [])[0] || null;
}

/** Save, submit and approve one cutoff. Returns the decide result. */
function runCutoff(ctx, period, basic, extra) {
  saveReg(ctx, period, basic, extra);
  ctx.handleSubmitPayrollForApproval({ period, cutoffLabel: period, submittedBy: 'Director',
    totalsJSON: '{}', snapshotHtml: '<p>x</p>' });
  const appr = ctx.__store['Payroll Approvals'];
  const rowIndex = appr.length;                        // the row just appended, 1-based incl. header
  return ctx.handleDecidePayrollApproval({ rowIndex, decision: 'Approved',
    approvedBy: 'Management', period });
}

function paidRemaining(ctx, dedNo) {
  const r = ctx.handleGetSalaryDeductions({ token: TOKEN });
  return (r.data || []).filter(d => d.deductionNo === dedNo)[0];
}

// ─────────────────────────────────────────────────────────────
section('1 · a draft deducts nothing until the signed form is on file');
{
  const ctx = boot();
  const no = agree(ctx, { leaveDraft: true });
  ok('the record is created as a Draft', paidRemaining(ctx, no).status === 'Draft');

  const refused = ctx.handleActivateSalaryDeduction({ token: TOKEN, deductionNo: no });
  ok('activation is refused with no authorization attached', refused.success === false);
  ok('  and says why', /authorization/i.test(refused.message || ''));

  saveReg(ctx, '2026-09-A', 20000);
  eq('a Draft takes nothing from the register', readReg(ctx, '2026-09-A').salaryDeduction, 0);

  ctx.handleAttachSalaryDeductionForm({ token: TOKEN, deductionNo: no,
    link: 'https://drive.example/signed.pdf' });
  ok('activation succeeds once the form is attached',
     ctx.handleActivateSalaryDeduction({ token: TOKEN, deductionNo: no }).success === true);
  saveReg(ctx, '2026-09-A', 20000);
  eq('and now it deducts', readReg(ctx, '2026-09-A').salaryDeduction, 2916.25);
}

// ─────────────────────────────────────────────────────────────
section('2 · the instalments sum to exactly the total');
{
  const cases = [
    { label: '34,995 over 12, 1st cutoff only', total: 34995, per: 2916.25,
      cadence: 'First Cutoff Only', start: '2026-09-A', n: 12, end: '2027-08-A' },
    { label: '24,995 over 12, 1st cutoff only', total: 24995, per: 2082.92,
      cadence: 'First Cutoff Only', start: '2026-09-A', n: 12, end: '2027-08-A' },
    { label: '24,995 over 12, every cutoff', total: 24995, per: 2082.92,
      cadence: 'Every Cutoff', start: '2026-09-A', n: 12, end: '2027-02-B' }
  ];
  cases.forEach(c => {
    const ctx = boot();
    const no = agree(ctx, { totalAmount: c.total, perCutoffAmount: c.per,
      cadence: c.cadence, startPeriod: c.start });
    let period = c.start, taken = [], guard = 0;
    while (guard++ < 40) {
      const rec = paidRemaining(ctx, no);
      if (rec.remaining <= 0) break;
      if (c.cadence === 'Every Cutoff' || period.slice(-1) === 'A') {
        runCutoff(ctx, period, 40000);
        const row = readReg(ctx, period);
        if (row && row.salaryDeduction > 0) taken.push({ period, amount: row.salaryDeduction });
      }
      period = ctx._sdCutoffNext(period);
    }
    const sum = taken.reduce((a, b) => a + b.amount, 0);
    eq(c.label + ' — instalments', taken.length, c.n);
    eq(c.label + ' — sum', Math.round(sum * 100) / 100, c.total);
    eq(c.label + ' — last cutoff', taken[taken.length - 1].period, c.end);
    ok(c.label + ' — the final payment is the remainder, not a full instalment',
       taken[taken.length - 1].amount <= c.per + 0.005);
    eq(c.label + ' — nothing is left owing', paidRemaining(ctx, no).remaining, 0);
  });
}

// ─────────────────────────────────────────────────────────────
section('3 · a short cutoff carries forward and the schedule runs longer');
{
  const ctx = boot();
  const no = agree(ctx, { totalAmount: 24995, perCutoffAmount: 2082.92 });
  let period = '2026-09-A', taken = [], guard = 0;
  while (guard++ < 40) {
    if (paidRemaining(ctx, no).remaining <= 0) break;
    if (period.slice(-1) === 'A') {
      // the third cutoff can only bear 1,000
      const basic = (taken.length === 2) ? 1000 : 40000;
      runCutoff(ctx, period, basic);
      const row = readReg(ctx, period);
      if (row && row.salaryDeduction > 0) taken.push({ period, amount: row.salaryDeduction });
    }
    period = ctx._sdCutoffNext(period);
  }
  eq('the short cutoff takes only what the pay could bear', taken[2].amount, 1000);
  eq('the cutoff after it is a FULL instalment, not a catch-up', taken[3].amount, 2082.92);
  eq('one extra cutoff appears at the end', taken.length, 13);
  eq('and it is still a 1st cutoff', taken[12].period.slice(-1), 'A');
  eq('the total is still exact',
     Math.round(taken.reduce((a, b) => a + b.amount, 0) * 100) / 100, 24995);
}

// ─────────────────────────────────────────────────────────────
section('4 · the deduction never drives net pay negative');
{
  const ctx = boot();
  agree(ctx);
  // gross 3,000 with 2,900 of statutory already taken: only 100 is left to give
  saveReg(ctx, '2026-09-A', 3000, { pagibig: 100, sss: 1400, philhealth: 1400 });
  const row = readReg(ctx, '2026-09-A');
  eq('it takes only what remains after the statutory five', row.salaryDeduction, 100);
  eq('net pay lands exactly on zero, never below', row.netPay, 0);

  const ctx2 = boot();
  agree(ctx2);
  // already underwater before this deduction exists
  saveReg(ctx2, '2026-09-A', 1000, { advances: 1500 });
  const row2 = readReg(ctx2, '2026-09-A');
  eq('an already-negative payslip is not made worse', row2.salaryDeduction, 0);
  eq('  and the pre-existing negative is left visible', row2.netPay, -500);
}

// ─────────────────────────────────────────────────────────────
section('5 · saving is repeatable; approving banks exactly once');
{
  const ctx = boot();
  const no = agree(ctx);
  saveReg(ctx, '2026-09-A', 40000);
  const first = readReg(ctx, '2026-09-A').salaryDeduction;
  saveReg(ctx, '2026-09-A', 40000);
  eq('two saves give the same figure', readReg(ctx, '2026-09-A').salaryDeduction, first);
  eq('and no money is banked by saving alone', paidRemaining(ctx, no).paid, 0);

  ctx.handleSubmitPayrollForApproval({ period: '2026-09-A', cutoffLabel: '1st', submittedBy: 'D',
    totalsJSON: '{}', snapshotHtml: '<p>x</p>' });
  const rowIndex = ctx.__store['Payroll Approvals'].length;
  const d1 = ctx.handleDecidePayrollApproval({ rowIndex, decision: 'Approved',
    approvedBy: 'M', period: '2026-09-A' });
  eq('approving banks one posting', d1.salaryDeductions.posted, 1);
  eq('  paid moves', paidRemaining(ctx, no).paid, 2916.25);

  const d2 = ctx.handleDecidePayrollApproval({ rowIndex, decision: 'Approved',
    approvedBy: 'M', period: '2026-09-A' });
  ok('approving the same row twice is refused outright', d2.success === false);
  eq('  and nothing further is banked', paidRemaining(ctx, no).paid, 2916.25);
  eq('  exactly one posting exists', paidRemaining(ctx, no).postingCount, 1);
}

// ─────────────────────────────────────────────────────────────
section('6 · an approved cutoff is frozen');
{
  const ctx = boot();
  const no = agree(ctx);
  runCutoff(ctx, '2026-09-A', 40000);
  const after = ctx.handleSavePayrollRegister({ period: '2026-09-A',
    rows: JSON.stringify([regRow(40000)]) });
  ok('re-saving an approved cutoff is refused', after.success === false);
  ok('  and says the cutoff was approved', /approved/i.test(after.message || ''));
  eq('the signed figure is untouched', readReg(ctx, '2026-09-A').salaryDeduction, 2916.25);
  eq('paid did not move', paidRemaining(ctx, no).paid, 2916.25);

  const resub = ctx.handleSubmitPayrollForApproval({ period: '2026-09-A', cutoffLabel: '1st',
    submittedBy: 'D', totalsJSON: '{}', snapshotHtml: '<p>x</p>' });
  ok('and it cannot be submitted for approval again', resub.success === false);
}

// ─────────────────────────────────────────────────────────────
section('7 · the approval row index is not trusted on its own');
{
  const ctx = boot();
  agree(ctx);
  saveReg(ctx, '2026-09-A', 40000);
  ctx.handleSubmitPayrollForApproval({ period: '2026-09-A', cutoffLabel: '1st', submittedBy: 'D',
    totalsJSON: '{}', snapshotHtml: '<p>x</p>' });
  const rowIndex = ctx.__store['Payroll Approvals'].length;

  const wrong = ctx.handleDecidePayrollApproval({ rowIndex, decision: 'Approved',
    approvedBy: 'M', period: '2026-10-A' });
  ok('deciding with the wrong period is refused', wrong.success === false);
  ok('  and names what the row actually is', /2026-09-A/.test(wrong.message || ''));
  eq('nothing was banked', paidRemaining(ctx, ctx.__store['Salary Deductions'][1][0]).paid, 0);

  const right = ctx.handleDecidePayrollApproval({ rowIndex, decision: 'Approved',
    approvedBy: 'M', period: '2026-09-A' });
  ok('the right period goes through', right.success === true);
}

// ─────────────────────────────────────────────────────────────
section('8 · a void re-opens a schedule that had reached zero');
{
  const ctx = boot();
  const no = agree(ctx, { totalAmount: 5832.50, perCutoffAmount: 2916.25 });
  runCutoff(ctx, '2026-09-A', 40000);
  runCutoff(ctx, '2026-10-A', 40000);
  let rec = paidRemaining(ctx, no);
  eq('the deduction is settled', rec.remaining, 0);
  ok('  and reads as settled', rec.settled === true);

  const v = ctx.handleVoidSalaryDeductionPosting({ token: TOKEN,
    postingId: rec.postings[1].postingId, reason: 'keyed twice' });
  ok('the posting voids', v.success === true);
  rec = paidRemaining(ctx, no);
  eq('the balance re-opens', rec.remaining, 2916.25);
  ok('  and it is no longer settled', rec.settled === false);
  eq('  the voided posting is kept, not deleted', ctx.__store['Salary Deduction Postings'].length - 1, 2);
}

// ─────────────────────────────────────────────────────────────
section('9 · the employee card shows your own record and nobody else’s');
{
  const ctx = boot();
  agree(ctx);
  const mine = ctx.handleGetMySalaryDeductions({ token: 'TKN-EMP' });
  eq('the employee sees their own deduction', mine.data.length, 1);
  eq('  with the balance', mine.data[0].remaining, 34995);

  const theirs = ctx.handleGetMySalaryDeductions({ token: 'TKN-OTHER' });
  eq('a different login sees nothing', theirs.data.length, 0);

  const spoof = ctx.handleGetMySalaryDeductions({ token: 'TKN-OTHER', username: 'gerald.l' });
  eq('and cannot ask for someone else by name', spoof.data.length, 0);

  const anon = ctx.handleGetMySalaryDeductions({});
  ok('no session, no answer', anon.success === false);
  ok('the full roster read is gated too', ctx.handleGetSalaryDeductions({}).success === false);
  ok('  and closed to a plain sales login',
     ctx.handleGetSalaryDeductions({ token: 'TKN-OTHER' }).success === false);
}

// ─────────────────────────────────────────────────────────────
section('10 · the agreement itself is validated');
{
  const ctx = boot();
  const bad = (p, why) => ok(why, ctx.handleSaveSalaryDeduction(Object.assign({
    token: TOKEN, employee: EMP, username: 'gerald.l', item: 'Laptop',
    totalAmount: 34995, perCutoffAmount: 2916.25,
    cadence: 'First Cutoff Only', startPeriod: '2026-09-A' }, p)).success === false);

  bad({ username: '' }, 'a login account must be chosen — never guessed from the name');
  bad({ totalAmount: 0 }, 'the total must be more than zero');
  bad({ perCutoffAmount: 40000 }, 'the per-cutoff amount cannot exceed the total');
  bad({ cadence: 'Weekly' }, 'the cadence has to be one of the two that exist');
  bad({ startPeriod: '2026-09' }, 'the first cutoff must be a real cutoff key');
  bad({ startPeriod: '2026-09-B' }, 'a 1st-cutoff-only deduction cannot start on a 2nd cutoff');

  const no = agree(ctx);
  runCutoff(ctx, '2026-09-A', 40000);
  const lower = ctx.handleSaveSalaryDeduction({ token: TOKEN, deductionNo: no, employee: EMP,
    username: 'gerald.l', item: 'Laptop', totalAmount: 1000, perCutoffAmount: 500,
    cadence: 'First Cutoff Only', startPeriod: '2026-09-A' });
  ok('the total cannot be edited below what has already been collected', lower.success === false);
}

// ─────────────────────────────────────────────────────────────
section('11 · a payroll rename follows the money');
{
  const ctx = boot({ 'Payroll Employees': [
    ['Last Name', 'First Name', 'Daily Rate', 'Other Income', 'HDMF Amount', 'Status', 'Pay Type', 'Fixed Amount'],
    ['Lucena', 'Gerald', 1000, 0, 100, 'Active', 'Hourly', 0]
  ] });
  const no = agree(ctx);
  runCutoff(ctx, '2026-09-A', 40000);
  ctx.handleSavePayrollEmployee({ id: 1, lastName: 'Lucena-Cruz', firstName: 'Gerald',
    dailyRate: 1000, otherIncome: 0, hdmfAmount: 100, status: 'Active' });
  const rec = paidRemaining(ctx, no);
  eq('the deduction follows the new name', rec.employee, 'Lucena-Cruz, Gerald');
  eq('  and so does the posting', rec.postings[0].employee, 'Lucena-Cruz, Gerald');
  eq('  with the balance intact', rec.paid, 2916.25);
}

// ─────────────────────────────────────────────────────────────
section('12 · the payslip can name what the money went to');
{
  const ctx = boot();
  agree(ctx, { item: 'Lenovo laptop' });
  agree(ctx, { item: 'Company phone', totalAmount: 6000, perCutoffAmount: 500 });
  saveReg(ctx, '2026-09-A', 40000);
  const row = readReg(ctx, '2026-09-A');
  eq('two concurrent deductions are two lines', row.salaryDeductionLines.length, 2);
  eq('  named individually', row.salaryDeductionLines[0].item, 'Lenovo laptop');
  eq('  and they add up to the register column',
     Math.round((row.salaryDeductionLines[0].amount + row.salaryDeductionLines[1].amount) * 100) / 100,
     row.salaryDeduction);

  const ctx2 = boot();
  agree(ctx2, { item: 'Lenovo laptop' });
  agree(ctx2, { item: 'Company phone', totalAmount: 6000, perCutoffAmount: 500 });
  saveReg(ctx2, '2026-09-A', 2000);          // only 2,000 to give across both
  const tight = readReg(ctx2, '2026-09-A');
  eq('when the pay is short the oldest agreement is served first',
     tight.salaryDeductionLines[0].amount, 2000);
  eq('  and the younger one takes nothing', tight.salaryDeductionLines.length, 1);
  eq('  the lines still add up to the column',
     tight.salaryDeductionLines[0].amount, tight.salaryDeduction);
}

console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
