/* A320 — the Books page (books.html) and the books' wiring in the browser.
 *
 * Run:  node tests/flow/books-contract.js
 *
 * Pinned:
 *   1. The page follows the site rules (theme.js first, no inline style or script) and loads its scripts in order.
 *   2. Every books read goes through postFlow (secured), never a plain fetchFlow GET.
 *   3. The guard is the oversight guard; changing the books is for accounting/admin/director, the engine
 *      switch for the director/management — the same sets FlowAPI.gs enforces.
 *   4. The navbar offers "Books" to accounting, admin, management and the director, not to sales.
 *   5. The forms that feed the books send their new fields only when filled (an edit never blanks them).
 *   6. A321: Payroll in the books (roles = Code.gs, the last decision per cutoff), the Books sync button
 *      (Flask roles = the books' roles), rule kinds = FlowAPI, and every Code.gs pay dialog sending the
 *      bank's date and the pesos.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');

console.log('\n1 · the page');
const H = read('books.html'), JS = read('js/books.js');
const scripts = (h) => (h.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(',');
eq('scripts in order', scripts(H), 'theme.js,api.js,auth.js,flow-api.js,books.js');
ok('theme.js first in body; no inline style or script', /<body class="bk">\s*<script src="js\/theme\.js"><\/script>/.test(H) && !/<style[\s>]/.test(H) && !/<script>/.test(H) && !/style="/.test(H));
ok('styles.css first, then flow.css and books.css', /href="css\/styles\.css">\s*<link rel="stylesheet" href="css\/flow\.css">\s*<link rel="stylesheet" href="css\/books\.css">/.test(H));
ok('six tabs: Inbox, Coverage, General ledger, Trial balance, Chart of accounts, Rules',
   (H.match(/data-tab="(\w+)"/g) || []).map(m => m.slice(10, -1)).join(',') === 'inbox,coverage,ledger,tb,accounts,rules');
ok('the engine switch has Off / Shadow / On', /data-mode="off"/.test(H) && /data-mode="shadow"/.test(H) && /data-mode="on"/.test(H));
eq('it needs FlowAPI 161', (JS.match(/MIN_VERSION = (\d+)/) || [])[1], '161');

console.log('\n2 · secured reads');
['getBooksStatus', 'getAccounts', 'getBooksInbox', 'getBooksCoverage', 'getGLEntries', 'getGLTrialBalance', 'getAccountRules'].forEach(a =>
  ok(a + ' is read through postFlow', new RegExp("read\\('" + a + "'").test(JS) || new RegExp("postFlow\\('" + a + "'").test(JS)));
ok('no plain fetchFlow anywhere on the page', !/fetchFlow\(/.test(JS));
const all = fs.readdirSync(D + 'js').filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n');
ok('no page reads the books with a plain GET', !/fetchFlow\('(getBooksStatus|getAccounts|getBooksInbox|getBooksCoverage|getGLEntries|getGLTrialBalance|getAccountRules|getTaxCodes)'/.test(all));

console.log('\n3 · roles match the backend');
const ctx = { console, window: {}, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] } };
ctx.window = ctx;
vm.createContext(ctx); require('./hxutil').load(ctx);
vm.runInContext(JS, ctx);
const gsSet = (name) => Object.keys(eval('(' + GS.match(new RegExp('var ' + name + ' = (\\{[^}]*\\});'))[1] + ')')).sort().join(',');
eq('who may change the books', ctx.__books.ACT_ROLES.slice().sort().join(','), gsSet('_BOOKS_ACT_ROLES'));
eq('who may flip the engine (setFlowSettings)', ctx.__books.SWITCH_ROLES.slice().sort().join(','), 'director,management');
ok('the page uses the oversight guard', /requireOversight\(\)/.test(JS));
ok('the switch explains each mode before changing it', /confirm\('Switch the books engine to/.test(JS) && Object.keys(ctx.__books.MODE_HINT).join(',') === 'off,shadow,on');

console.log('\n4 · the navbar');
const A = read('js/auth.js');
eq('four "Books" links (admin, accounting, management, director)', (A.match(/href="books\.html"/g) || []).length, 4);

console.log('\n5 · the forms that feed the books');
const INV = read('js/flow-invoices.js'), AR = read('js/flow-ar-aging.js'), PR = read('js/flow-pr-actions.js'), EX = read('js/flow-expenses.js'), RC = read('js/flow-receiving.js');
ok('invoice: VAT type sent, zero-rating support only for zero-rated', /payload\.vatType = document\.getElementById\('vatType'\)\.value/.test(INV) && /payload\.vatType === 'VAT-0' && zr/.test(INV));
ok('collection: deposited-to and cheque no. only when filled', /if \(dep && dep\.value\) payload\.depositedTo/.test(AR) && /if \(chq && chq\.value\.trim\(\)\) payload\.chequeNo/.test(AR));
ok('mark-paid: value date always, paid-from when chosen, books fields for Other payments', /payload\.valueDate = document\.getElementById\('pmpValueDate'\)\.value;/.test(PR) && /if \(paidFrom\) payload\.paidFrom = paidFrom/.test(PR) && /if \(acct\) payload\.account = acct/.test(PR));
ok('expense: paid-from / TIN / OR / VAT only when filled', /if \(pf\) payload\.paidFrom = pf/.test(EX) && /if \(num\('fVat'\) > 0\) payload\.vatAmount/.test(EX));
ok('receiving: rate and VAT evidence only when filled', /payload\.receiptRate = flowNum/.test(RC) && /if \(_v\('shipImportEntry'\)\) payload\.importEntryNo/.test(RC) && /if \(_v\('shipTin'\)\) payload\.supplierTin/.test(RC));

{
  /* A322 — Operating expenses read newest voucher first, not grouped by category. */
  const sx = { flowDate: (d) => String(d || '').slice(0, 10), Intl };
  vm.createContext(sx);
  vm.runInContext(EX.match(/const _VOUCHER_ORDER = [^\n]*\n/)[0] + EX.match(/function byVoucherDesc\(a, b\) \{[\s\S]*?\n\}/)[0] + '; this.f = byVoucherDesc;', sx);
  const rows = [{ voucherNo: 'PR-202609-120', date: '2026-09-30' }, { voucherNo: '', date: '2026-10-05' }, { voucherNo: 'PR-202610-009', date: '2026-10-02' },
                { voucherNo: '998', date: '2026-01-02' }, { voucherNo: 'PR-202610-014', date: '2026-10-03' }, { voucherNo: '1050', date: '2026-01-03' },
                { voucherNo: '', date: '2026-10-06' }, { voucherNo: 'pr-202610-014', date: '2026-10-04' }];
  eq('expenses: newest voucher first, numbers as numbers, ties by newest date, blanks last',
     rows.slice().sort(sx.f).map(r => (r.voucherNo || '·') + '@' + r.date.slice(5)).join(' '),
     'pr-202610-014@10-04 PR-202610-014@10-03 PR-202610-009@10-02 PR-202609-120@09-30 1050@01-03 998@01-02 ·@10-06 ·@10-05');
  ok('  the list uses it, and no longer sorts by category', /rows\.slice\(\)\.sort\(byVoucherDesc\)/.test(EX) && !/localeCompare\(b\.category/.test(EX));
  ok('  the Voucher column comes first', /<th class="c-vou">Voucher<\/th><th class="c-date">Date<\/th>/.test(EX));
}

console.log('\n6 · A321 — payroll and Code.gs payments');
{
  const PH = read('payroll-books.html'), PJ = read('js/payroll-books.js'), CG = fs.readFileSync(path.join(__dirname, '../../apps-script/Code.gs'), 'utf8');
  eq('payroll-books: scripts in order', scripts(PH), 'theme.js,api.js,auth.js,payroll-books.js');
  ok('  theme.js first; no inline style or script', /<body class="bk">\s*<script src="js\/theme\.js"><\/script>/.test(PH) && !/<style[\s>]/.test(PH) && !/<script>/.test(PH) && !/style="/.test(PH));
  const pc = { console, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] }, window: {} };
  vm.createContext(pc); vm.runInContext(PJ, pc);
  const PB = pc.window.__payrollBooks;
  const roles = (action) => eval(CG.match(new RegExp(action + ": (\\[[^\\]]*\\])"))[1]).slice().sort().join(',');
  eq('  who marks payroll paid = Code.gs', PB.PAY_ROLES.slice().sort().join(','), roles('markPayrollPaid'));
  eq('  who edits the tables = Code.gs', PB.TABLE_ROLES.slice().sort().join(','), roles('savePayrollContributionTables'));
  eq('  the agencies = Code.gs', Object.keys(PB.COLS).join(','), eval(CG.match(/var _CONTRIB_AGENCIES = (\[[^\]]*\]);/)[1]).join(','));
  eq('  the default bases = Code.gs', JSON.stringify(PB.BASIS_DEFAULT), JSON.stringify(eval('(' + CG.match(/var _CONTRIB_BASIS_DEFAULT = (\{[^}]*\});/)[1] + ')')));
  const ap = [{ rowIndex: 2, period: '2026-05-A', status: 'Approved' }, { rowIndex: 3, period: '2026-05-B', status: 'Approved' },
              { rowIndex: 4, period: '2026-05-B', status: 'For Approval' }, { rowIndex: 5, period: '2026-06-A', status: 'Rejected' }, { rowIndex: 6, period: '2026-06-A', status: 'Approved' }];
  eq('  cutoffs to pay: the last decision per period, approved only, newest first', PB.latestPerPeriod(ap).map(r => r.period).join(','), '2026-06-A,2026-05-A');
  eq('  five navbar links (admin, accounting, management, director, HR)', (A.match(/href="payroll-books\.html"/g) || []).length, 5);
  const API = read('js/api.js');
  ok('  api.js wrappers', ['apiGetPayrollContributionTables', 'apiSavePayrollContributionTables', 'apiGetPayrollEmployerShares', 'apiMarkPayrollPaid'].every(f => new RegExp('function ' + f + '\\(').test(API)));

  ok('Books: the sync button posts to /books/sync with the session header', /fetch\('\/books\/sync', \{ method: 'POST', headers: hxAuthHeaders/.test(JS) && /id="bkSyncBtn"/.test(H));
  const BP = fs.readFileSync(path.join(__dirname, '../../blueprints/books.py'), 'utf8');
  eq('  who may sync (Flask) = who acts on the books', eval(BP.match(/SYNC_ROLES = (\[[^\]]*\])/)[1]).slice().sort().join(','), gsSet('_BOOKS_ACT_ROLES'));
  eq('  the rule kinds the page knows = FlowAPI', Object.keys(ctx.__books ? eval('(' + JS.match(/const RULE_LABEL = (\{[\s\S]*?\});/)[1] + ')') : {}).join(','), eval(GS.match(/var _BOOKS_RULE_SOURCES = (\[[^\]]*\]);/)[1]).join(','));
  ok('  the Inbox remembers the rule the line names, not always an expense category', /p\.ruleSource = card\.dataset\.ruleSource/.test(JS) && !/p\.ruleSource = 'expense\.category'/.test(JS));

  const PRJ = read('js/payment-requests.js'), ABJ = read('js/accounting-billing.js'), DPJ = read('js/director-payables-inline.js');
  const BILL = fs.readFileSync(path.join(__dirname, '../../blueprints/billing.py'), 'utf8');
  ok('Billing (admin page): the bank date always, the pesos for a foreign request', /valueDate: pick\.valueDate/.test(PRJ) && /amountPHP: pick\.amountPHP/.test(PRJ) && /if \(foreign && !\(amountPHP > 0\)\)/.test(PRJ));
  ok('Billing (accounting page): bank, date and pesos reach Code.gs through Flask', /bankAccountCode, valueDate,/.test(ABJ) && /for key in \("bankAccountCode", "valueDate", "amountPHP"\)/.test(BILL));
  ok('Director Payables: the bank date and the pesos', /valueDate: valueDate,/.test(DPJ) && /amountPHP: amountPHP \? String\(amountPHP\) : ''/.test(DPJ) && /id="payValueDate"/.test(read('director-payables.html')));
  const DH = read('js/director-home.js');
  ok('employee TIN: sent formatted, a malformed one refused, an absent field never blanks it', /tin:\s+_eeTin\(\)/.test(DH) && /if \(data\.tin === null\)/.test(DH) && /if \(data\.tin === undefined\) delete data\.tin/.test(DH));
  const tinCtx = { document: { getElementById: (id) => id === 'eeTin' ? { value: tinCtx.v } : null } };
  vm.createContext(tinCtx); vm.runInContext(DH.match(/function _eeTin\(\) \{[\s\S]*?\n\}/)[0] + '; this.f = _eeTin;', tinCtx);
  const tin = (v) => { tinCtx.v = v; return tinCtx.f(); };
  ok('  123456789 → 123-456-789; with branch; spaces; junk refused', tin('123456789') === '123-456-789' && tin('123 456 789 00000') === '123-456-789-00000' && tin('') === '' && tin('12-34') === null && tin('123456789012345678') === null);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
