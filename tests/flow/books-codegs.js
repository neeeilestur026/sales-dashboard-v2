/* A321 — Code.gs v5: what the books need from payroll, the Billing page and Director Payables.
 *
 * Run:  node tests/flow/books-codegs.js
 *
 * Pinned:
 *   1. Contribution tables are entered, never seeded: brackets contiguous (no overlap, no gap above a
 *      peso), rates 0–100%, PhilHealth one row, Pag-IBIG with both rates, SSS with the employer amount,
 *      one basis per table. Saving the same agency + date replaces that table only.
 *   2. Employer shares per employee per calendar month: the table in force on day 1 of the month; a share
 *      only where the employee's own deduction was taken; SSS on gross, PhilHealth / Pag-IBIG on basic
 *      unless the table says otherwise; PhilHealth floor and ceiling; Pag-IBIG capped; a pay between two
 *      brackets falls into the lower one; a missing table is reported, never guessed.
 *   3. Mark payroll paid: approved cutoffs only, the bank's date and the account required, not twice;
 *      undo clears it. Director and accounting only.
 *   4. Billing and Director Payables: a foreign item needs the pesos the bank took, and the bank page
 *      is debited in pesos; the value date is stored.
 *   5. getBooksFeed: approved cutoffs only (the last decision wins), cutoff B carries the month's shares,
 *      commission incentives are totalled, voided ones left out; paid Billing and Payables with their
 *      Bank Tx IDs; bank-page rows except the legs Billing and Payables already carry.
 *      Accounting, admin and director only.
 *   6. Employee TIN is stored and read; a save that does not send it keeps it.
 */
const { makeCtx, seedSession } = require('./gasload-code');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);

const REG_H = ['Period', 'Employee', 'Basic Pay', 'Holiday Pay', 'OT Pay', 'Other Income', 'Gross Pay', 'Pag-IBIG', 'SSS', 'PhilHealth',
               'Advances', 'WTax', 'Total Deductions', 'Net Pay', 'Incentive', 'Salary Deduction'];
const reg = (period, emp, basic, gross, hdmf, sss, ph, net) => [period, emp, basic, 0, gross - basic, 0, gross, hdmf, sss, ph, 0, 0, hdmf + sss + ph, net, 0, 0];
function boot() {
  const store = {
    Users: [['Username', 'Password', 'Role', 'Full Name']],
    Sessions: [['Token', 'Username', 'FullName', 'Role', 'CreatedAt', 'ExpiresAt']],
    'Payroll Register': [REG_H,
      reg('2026-05-A', 'Dandan, Gayle', 6000, 6500, 200, 0, 0, 6300),
      reg('2026-05-B', 'Dandan, Gayle', 6000, 6000, 0, 825, 300, 4875),
      reg('2026-05-A', 'Estur, Neil', 9000, 9000, 0, 0, 0, 9000),          // a fixed-salary manager: no deductions, no shares
      reg('2026-05-B', 'Estur, Neil', 9000, 9000, 0, 0, 0, 9000),
      reg('2026-05-A', 'Simeon, Angelica', 2000, 2000, 200, 0, 0, 1800),
      reg('2026-05-B', 'Simeon, Angelica', 2000, 2000, 0, 400, 200, 1400)],
    'Payroll Approvals': [['Period', 'Cutoff Label', 'Submitted By', 'Submitted At', 'Status', 'Approved By', 'Decided At', 'Notes', 'Totals JSON', 'Snapshot HTML'],
      ['2026-05-A', 'May 1st cutoff', 'hr', '2026-05-11', 'Approved', 'Neil Estur', '2026-05-11T09:00:00Z', '', '{}', ''],
      ['2026-05-B', 'May 2nd cutoff', 'hr', '2026-05-26', 'Rejected', 'Neil Estur', '2026-05-26T09:00:00Z', 'fix OT', '{}', ''],
      ['2026-05-B', 'May 2nd cutoff', 'hr', '2026-05-27', 'Approved', 'Neil Estur', '2026-05-27T09:00:00Z', '', '{}', ''],
      ['2026-06-A', 'June 1st cutoff', 'hr', '2026-06-11', 'Pending', '', '', '', '{}', '']],
    'Payroll Incentives': [['Incentive ID', 'Period', 'Cutoff', 'Employee', 'Amount', 'Category', 'Reason', 'Given By', 'Recorded At', 'Status', 'Voided By', 'Voided At', 'Source', 'Source Ref'],
      ['INC-1', '2026-05-A', 'A', 'Dandan, Gayle', 500, 'Commission', 'SO-1', 'n', '', 'Active', '', '', 'commission', 'CR-1'],
      ['INC-2', '2026-05-A', 'A', 'Dandan, Gayle', 300, 'Commission', 'SO-2', 'n', '', 'Voided', 'n', '', 'commission', 'CR-2'],
      ['INC-3', '2026-05-A', 'A', 'Simeon, Angelica', 250, 'Performance', 'good', 'n', '', 'Active', '', '', '', '']],
    PaymentRequests: [['Request Date', 'PR Number', 'Requested By', 'Department', 'Purpose', 'Priority', 'Payee Name', 'Payee Type', 'Bank Name', 'Bank Branch',
      'Account Name', 'Account Number', 'Payment Method', 'Currency', 'Amount', 'Due Date', 'Remarks', 'Supporting Docs', 'Submitted At', 'Drive Link', 'Status',
      'Admin Approval', 'Mgmt Approval', 'Attachment Links', 'Billing Status', 'Paid At', 'Paid By', 'Payment Slip Link', 'Cash Voucher Link', 'CV Number'],
      ['2026-05-01', 'PR-0101', 'x', 'Admin', 'Internet May', 'Normal', 'PLDT', '', '', '', '', '', 'Transfer', 'PHP', 2500, '', '', '', '', '', 'Approved', '', '', '', 'Pending', '', '', '', '', ''],
      ['2026-05-01', 'PR-0102', 'x', 'Marketing', 'Licence', 'Normal', 'Adobe', '', '', '', '', '', 'Card', 'USD', 60, '', '', '', '', '', 'Approved', '', '', '', 'Pending', '', '', '', '', '']],
    'Director Payables': [['ID', 'Created At', 'Due Date', 'Payee', 'Category', 'Description', 'Amount', 'Currency', 'Status', 'Paid At', 'Paid By', 'Bank Account', 'Bank Tx ID', 'Notes'],
      ['dp-1', '', '2026-05-07', 'Meralco', 'Utilities', 'May', 8000, 'PHP', 'Pending', '', '', '', '', ''],
      ['dp-2', '', '2026-05-09', 'Supplier SG', 'Other', 'Spare part', 100, 'SGD', 'Pending', '', '', '', '', '']],
    'Bank Transactions': [['ID', 'Date', 'Account Code', 'Type', 'Direction', 'Amount', 'Currency', 'Description', 'Ref Type', 'Ref ID', 'Paired ID', 'Created By', 'Created At'],
      ['B1', '2026-05-02T02:00:00.000Z', 'METRO_ZAB', 'Transfer Out', -1, 100000, 'PHP', 'to AUB', 'Transfer', '', 'B2', 'n', ''],
      ['B2', '2026-05-02T02:00:00.000Z', 'AUB', 'Transfer In', 1, 100000, 'PHP', 'from ZAB', 'Transfer', '', 'B1', 'n', '']],
    'Payroll Employees': [['Last Name', 'First Name', 'Daily Rate', 'Other Income', 'HDMF Amount', 'Status', 'Pay Type', 'Fixed Amount', 'SSS Amount', 'PhilHealth Amount', 'Date Hired', 'Username'],
      ['Dandan', 'Gayle', 600, 0, 200, 'Active', 'Hourly', 0, 825, 300, '', '']],
  };
  seedSession(store, 'T-dir', 'neil', 'Neil Estur', 'director');
  seedSession(store, 'T-acc', 'ana', 'Ana Acct', 'accounting');
  seedSession(store, 'T-hr', 'hr', 'Hana HR', 'hr');
  seedSession(store, 'T-sales', 'gerald', 'Gerald Lucena', 'sales');
  const c = makeCtx(store, { USERS_SHEET_ID: 'users-sheet', INTERNAL_SHARED_SECRET: 'server-secret' });
  c.__store = store;
  return c;
}
const post = (c, body) => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const get = (c, params) => JSON.parse(c.doGet({ parameter: params }).getContent());
const save = (c, token, agency, effectiveFrom, rows) => post(c, { action: 'savePayrollContributionTables', token, agency, effectiveFrom, rows: JSON.stringify(rows) });

// Illustrative tables only — NOT official rates. The real ones are typed from the circulars by HR or the CPA.
const SSS = [{ from: 0, to: 5249.99, ee: 250, er: 510, ec: 10 }, { from: 5250, to: 9999.99, ee: 500, er: 1010, ec: 10 }, { from: 10000, to: 0, ee: 825, er: 1655, ec: 30 }];
const PH = [{ rate: 5, eeShare: 50, floor: 10000, ceiling: 100000 }];
const HDMF = [{ from: 0, to: 1500, ee: 1, er: 2 }, { from: 1500.01, to: 0, ee: 2, er: 2, ceiling: 10000 }];

sec('1 · contribution tables');
{
  const c = boot();
  ok('a sales login may not save', !save(c, 'T-sales', 'SSS', '2026-01-01', SSS).success);
  ok('HR may', save(c, 'T-hr', 'SSS', '2026-01-01', SSS).success);
  const bad = (label, agency, rows, re) => { const r = save(c, 'T-acc', agency, '2026-01-01', rows); ok(label, !r.success && re.test(r.message), r); };
  bad('overlapping brackets are refused', 'SSS', [{ from: 0, to: 5300, er: 1 }, { from: 5250, to: 0, er: 2 }], /overlap/);
  bad('a gap above a peso is refused', 'SSS', [{ from: 0, to: 5000, er: 1 }, { from: 5250, to: 0, er: 2 }], /gap/);
  bad('an open-ended bracket must be the last', 'SSS', [{ from: 0, to: 0, er: 1 }, { from: 5250, to: 0, er: 2 }], /last bracket/);
  bad('SSS needs the employer amount', 'SSS', [{ from: 0, to: 0, ee: 100 }], /employer/);
  bad('a rate above 100% is refused', 'PhilHealth', [{ rate: 120, eeShare: 50 }], /0 and 100/);
  bad('PhilHealth takes one row', 'PhilHealth', [PH[0], PH[0]], /one row/);
  bad('Pag-IBIG needs both rates', 'Pag-IBIG', [{ from: 0, to: 0, ee: 2 }], /employee and employer/);
  bad('an unknown agency is refused', 'GSIS', SSS, /Unknown agency/);
  bad('a basis is gross or basic', 'SSS', SSS.map(r => Object.assign({ basis: 'net' }, r)), /gross or basic/);
  ok('no date, no table', !save(c, 'T-acc', 'SSS', '', SSS).success);
  ok('PhilHealth and Pag-IBIG save', save(c, 'T-acc', 'PhilHealth', '2026-01-01', PH).success && save(c, 'T-acc', 'Pag-IBIG', '2026-01-01', HDMF).success);
  ok('saving the same agency and date replaces that table', save(c, 'T-acc', 'SSS', '2026-01-01', SSS).success);
  const t = get(c, { action: 'getPayrollContributionTables', token: 'T-acc' });
  eq('  three SSS rows, not six', t.data.filter(r => r.agency === 'SSS').length, 3);
  eq('  SSS reads gross by default', t.data.find(r => r.agency === 'SSS').basis, 'gross');
  eq('  PhilHealth reads basic by default', t.data.find(r => r.agency === 'PhilHealth').basis, 'basic');
  ok('  stamped with who saved it', t.data[0].updatedBy === 'Ana Acct', t.data[0]);

  sec('2 · employer shares');
  const sh = (month, tok) => get(c, { action: 'getPayrollEmployerShares', token: tok || 'T-acc', month });
  ok('a sales login may not read per-employee pay', !sh('2026-05', 'T-sales').success);
  const r = sh('2026-05');
  ok('read', r.success, r);
  const by = (n) => r.data.perEmployee.find(e => e.employee === n);
  const g = by('Dandan, Gayle'), a = by('Simeon, Angelica'), n = by('Estur, Neil');
  eq('Gayle: May gross 12,500 → SSS top bracket ER', g.sssER, 1655);
  eq('  and EC', g.sssEC, 30);
  eq('  PhilHealth on basic 12,000 × 5% × half', g.phER, 300);
  eq('  Pag-IBIG on basic capped at 10,000 × 2%', g.hdmfER, 200);
  eq('Angelica: PhilHealth basic 4,000 lifted to the 10,000 floor', a.phER, 250);
  eq('  Pag-IBIG 4,000 × 2%', a.hdmfER, 80);
  eq('  SSS 4,000 → first bracket', a.sssER, 510);
  ok('the fixed-salary manager (no deductions) owes no shares', n.sssER === 0 && n.phER === 0 && n.hdmfER === 0, n);
  eq('the month totals', JSON.stringify(r.data.totals), JSON.stringify({ sssER: 2165, sssEC: 40, phER: 550, hdmfER: 280 }));
  ok('nothing missing', r.data.missing.length === 0, r.data.missing);
  save(c, 'T-acc', 'SSS', '2026-06-01', SSS.map(x => Object.assign({}, x, { er: x.er + 100 })));
  eq('a table effective in June does not touch May', sh('2026-05').data.totals.sssER, 2165);
  c.__store['Payroll Register'].push(reg('2026-06-B', 'Dandan, Gayle', 5249.995, 5249.995, 0, 250, 0, 5000));
  eq('a pay between two brackets falls into the lower one (June table)', sh('2026-06').data.perEmployee[0].sssER, 610);
  c.__store['Payroll Register'].push(reg('2025-12-B', 'Dandan, Gayle', 6000, 6000, 0, 825, 300, 4875));
  eq('a month with no table in force reports what is missing', sh('2025-12').data.missing.join(','), 'SSS,PhilHealth');
}

sec('3 · mark payroll paid');
{
  const c = boot();
  const mk = (tok, o) => post(c, Object.assign({ action: 'markPayrollPaid', token: tok }, o));
  ok('HR may not', !mk('T-hr', { period: '2026-05-A', paidDate: '2026-05-11', bankAccountCode: 'AUB' }).success);
  ok('a pending cutoff cannot be paid', /not approved/.test(mk('T-acc', { period: '2026-06-A', paidDate: '2026-06-11', bankAccountCode: 'AUB' }).message));
  ok('the bank date is required', /date/.test(mk('T-acc', { period: '2026-05-A', bankAccountCode: 'AUB' }).message));
  ok('the account is required', /account/.test(mk('T-acc', { period: '2026-05-A', paidDate: '2026-05-11' }).message));
  ok('accounting marks it', mk('T-acc', { period: '2026-05-A', paidDate: '2026-05-11', bankAccountCode: 'AUB' }).success);
  const row = c.__store['Payroll Approvals'][1];
  ok('  date, bank, who', row[10] === '2026-05-11' && row[11] === 'AUB' && row[12] === 'Ana Acct', row.slice(10));
  ok('  headers appended', c.__store['Payroll Approvals'][0][10] === 'Paid Date' && c.__store['Payroll Approvals'][0][13] === 'Paid At');
  ok('not twice', /already marked paid/.test(mk('T-dir', { period: '2026-05-A', paidDate: '2026-05-12', bankAccountCode: 'AUB' }).message));
  ok('the latest approval row is the one marked', mk('T-dir', { period: '2026-05-B', paidDate: '2026-05-26', bankAccountCode: 'METRO_ZAB' }).success && c.__store['Payroll Approvals'][3][10] === '2026-05-26' && !c.__store['Payroll Approvals'][2][10]);
  ok('undo clears it', mk('T-dir', { period: '2026-05-A', undo: true }).success && c.__store['Payroll Approvals'][1][10] === '');
  ok('GET is refused (a mutation)', /POST/.test(get(c, { action: 'markPayrollPaid', token: 'T-acc', period: '2026-05-A' }).message || ''));
}

sec('4 · Billing and Director Payables in pesos');
{
  const c = boot();
  const pr = c.__store.PaymentRequests, dp = c.__store['Director Payables'], tx = c.__store['Bank Transactions'];
  let r = post(c, { action: 'markBillPaid', token: 'T-acc', rowIndex: 3, bankAccountCode: 'AUB', valueDate: '2026-05-06' });
  ok('a USD request without the pesos is refused', !r.success && /pesos/.test(r.message), r);
  ok('  and nothing was written', pr[2][24] === 'Pending' && tx.length === 3);
  r = post(c, { action: 'markBillPaid', token: 'T-acc', rowIndex: 3, bankAccountCode: 'AUB', valueDate: '2026-05-06', amountPHP: 3480.5 });
  ok('with the pesos it is paid', r.success, r);
  eq('  the bank page is debited in pesos', tx[tx.length - 1][5], 3480.5);
  eq('  in PHP', tx[tx.length - 1][6], 'PHP');
  ok('  value date and pesos stored (cols 33–34)', pr[2][32] === '2026-05-06' && pr[2][33] === 3480.5, pr[2].slice(30));
  r = post(c, { action: 'markBillPaid', token: 'T-acc', rowIndex: 2, bankAccountCode: 'AUB', valueDate: '2026-05-05' });
  ok('a peso request needs no extra figure', r.success && pr[1][33] === 2500, pr[1].slice(30));
  r = post(c, { action: 'markDirectorPayablePaid', token: 'T-dir', id: 'dp-2', bankAccountCode: 'AUB', valueDate: '2026-05-09' });
  ok('an SGD payable without the pesos is refused', !r.success && /pesos/.test(r.message), r);
  r = post(c, { action: 'markDirectorPayablePaid', token: 'T-dir', id: 'dp-2', bankAccountCode: 'AUB', valueDate: '2026-05-09', amountPHP: 4300 });
  ok('with them it is paid', r.success, r);
  ok('  cols 15–16 hold the value date and pesos', dp[2][14] === '2026-05-09' && dp[2][15] === 4300 && dp[0][14] === 'Value Date', dp[2]);
  ok('  the bank page took 4,300 pesos', tx[tx.length - 1][5] === 4300);
  r = post(c, { action: 'markDirectorPayablePaid', token: 'T-dir', id: 'dp-1', bankAccountCode: 'METRO_ZAB' });
  ok('a peso payable with no date uses today', r.success && /^\d{4}-\d{2}-\d{2}$/.test(dp[1][14]) && dp[1][15] === 8000, dp[1]);

  sec('5 · the books feed');
  save(c, 'T-acc', 'SSS', '2026-01-01', SSS); save(c, 'T-acc', 'PhilHealth', '2026-01-01', PH); save(c, 'T-acc', 'Pag-IBIG', '2026-01-01', HDMF);
  post(c, { action: 'markPayrollPaid', token: 'T-acc', period: '2026-05-A', paidDate: '2026-05-11', bankAccountCode: 'AUB' });
  ok('HR may not read it', !post(c, { action: 'getBooksFeed', token: 'T-hr' }).success);
  const f = post(c, { action: 'getBooksFeed', token: 'T-acc' });
  ok('accounting reads it', f.success && f.complete === true && f.codeVersion >= 5, f);
  eq('approved cutoffs only (B: rejected then approved → in; June A pending → out)', f.payroll.map(p => p.period).join(','), '2026-05-A,2026-05-B');
  const A = f.payroll[0], B = f.payroll[1];
  ok('  cutoff A carries its paid mark', A.paidDate === '2026-05-11' && A.paidBank === 'AUB', A);
  eq('  commission incentives totalled, voided and non-commission left out', A.commissionIncentives, 500);
  ok('  three register rows with every figure', A.rows.length === 3 && A.rows[0].gross === 6500 && A.rows[0].pagibig === 200, A.rows[0]);
  ok('  only cutoff B carries the month\'s employer shares', A.employerShares === null && B.employerShares && B.employerShares.totals.sssER === 2165, B.employerShares);
  eq('paid Billing requests', f.billing.map(b => b.prNumber + ':' + b.amountPHP + ':' + b.valueDate).join(','), 'PR-0101:2500:2026-05-05,PR-0102:3480.5:2026-05-06');
  ok('  each with its Bank Tx ID', f.billing.every(b => b.bankTxId.length > 10));
  eq('paid Director Payables', f.directorPayables.map(d => d.id + ':' + d.amountPHP).sort().join(','), 'dp-1:8000,dp-2:4300');
  eq('bank-page rows, without the legs Billing and Payables carry', f.bankTransactions.map(t => t.id).join(','), 'B1,B2');
  eq('  dated by day', f.bankTransactions[0].date, '2026-05-02');
}

sec('6 · employee TIN');
{
  const c = boot();
  const base = { action: 'savePayrollEmployee', token: 'T-dir', id: 1, lastName: 'Dandan', firstName: 'Gayle', dailyRate: 600, otherIncome: 0, hdmfAmount: 200, status: 'Active' };
  let r = post(c, Object.assign({ tin: '123-456-789-00000' }, base));
  ok('saved with a TIN', r.success, r);
  const emp = () => c.__store['Payroll Employees'].find(x => x[0] === 'Dandan');
  eq('  column 13', emp()[12], '123-456-789-00000');
  r = post(c, base);
  eq('a save that does not send the TIN keeps it', emp()[12], '123-456-789-00000');
  const list = get(c, { action: 'getPayrollEmployees', token: 'T-dir' });
  ok('  and it is read back', list.success && list.data.some(e => e.tin === '123-456-789-00000'), list.data && list.data[0]);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
