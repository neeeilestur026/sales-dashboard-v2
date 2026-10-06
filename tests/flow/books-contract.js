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

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
