/* A254 — the scoped "Create these receivables" control.
 *
 * Run:  node tests/flow/ar-backfill-scope.js
 *
 * WHY THIS FILE EXISTS. backfillMissingAR has taken an `invNos` scope since A249 and nothing ever
 * sent it. The single button that called it sent {} — and unscoped, that function creates a
 * receivable for EVERY invoice lacking one: on the live book, 95 rows worth PHP 49,748,568.78,
 * against a real gap of 9 worth PHP 1,983,383.04. Pressing it would have taken AR outstanding from
 * PHP 1.55M to PHP 51.3M by billing the same money twice.
 *
 * The rules pinned here, because each one is a way to invent debt:
 *
 *   1. THE SCOPE IS unagedLive — the exact set the banner prints. What you press is what you were
 *      shown; the two cannot drift.
 *
 *   2. PRE-BASELINE IS EXCLUDED. Those invoices are already carried by the June snapshot;
 *      backfilling them double-counts. balance-sheet.js states the policy.
 *
 *   3. A RECEIVABLE ALREADY ATTACHED THROUGH THE SALES ORDER IS EXCLUDED. AR rows carry the older
 *      INV-YYYY-NNN numbering, so the server — which matches on invoice number alone — cannot see
 *      the link and would raise a SECOND receivable for a sale already carried. On the live book
 *      that is INV-202608-018 (First Farmers), and it is the difference between 9 and 10.
 *
 *   4. A VOIDED INVOICE IS SUPPOSED TO HAVE NO RECEIVABLE. voidInvoice deletes it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { console.log('  ok   ' + label); }
  else { FAIL++; console.log('  FAIL ' + label + (extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); }
};
const eq = (label, got, want) => ok(label + ' = ' + JSON.stringify(want), got === want, { got, want });

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-ar-aging.js'), 'utf8');
const ctx = { console, flowNum: v => parseFloat(v) || 0, flowMoney: v => String(v), flowEsc: v => String(v) };
vm.createContext(ctx);
vm.runInContext(SRC.slice(SRC.indexOf('function arReconcile('), SRC.indexOf('/* A254')), ctx);
const R = ctx.arReconcile;

const BASE = '2026-06-23';
const AR = [
  { arNo: 'AR-1', invNo: 'INV-202606-001', soNo: 'SO-A', createdAt: BASE + 'T00:00:00Z', amountPHP: 100 },
  // the sales-order rescue: legacy number, no invoice match, but its SO has exactly one invoice
  { arNo: 'AR-2', invNo: 'INV-2026-0113', soNo: 'SO-FF', createdAt: BASE + 'T00:00:00Z', amountPHP: 88139.28 },
];
const INV = [
  { invNo: 'INV-202606-001', soNo: 'SO-A',  date: '2026-06-25', totalSales: 100,      customer: 'Has AR' },
  { invNo: 'INV-202608-018', soNo: 'SO-FF', date: '2026-07-01', totalSales: 88933.33, customer: 'First Farmers' },
  { invNo: 'INV-202608-020', soNo: 'SO-B',  date: '2026-07-13', totalSales: 672974.6, customer: 'Petra' },
  { invNo: 'INV-202605-900', soNo: 'SO-OLD', date: '2026-05-01', totalSales: 999999,  customer: 'Pre-baseline' },
  { invNo: 'INV-202608-099', soNo: 'SO-V',  date: '2026-07-20', totalSales: 5000, customer: 'Voided', voided: true },
];
const r = R(AR, INV);
const live = r.unagedLive.map(v => v.invNo).sort();

console.log('\n1 · what the scope contains');
eq('baseline is derived from the AR ledger', r.baseline, BASE);
eq('exactly one invoice needs a receivable', r.unagedLive.length, 1);
eq('  and it is the genuinely missing one', live.join(','), 'INV-202608-020');
eq('  its value', r.unagedLiveValue, 672974.6);

console.log('\n2 · what the scope EXCLUDES, and why');
ok('pre-baseline history — already in the June snapshot',
   live.indexOf('INV-202605-900') < 0);
ok('  and it is still counted as history, not lost',
   r.unagedHistory.some(v => v.invNo === 'INV-202605-900'));
ok('a receivable attached through the SALES ORDER — would be a duplicate',
   live.indexOf('INV-202608-018') < 0);
ok('  the SO rescue is what saw it', r.viaSo.some(a => a.arNo === 'AR-2'));
ok('a voided invoice — voidInvoice deletes its receivable on purpose',
   live.indexOf('INV-202608-099') < 0);
ok('an invoice that already has a receivable by number',
   live.indexOf('INV-202606-001') < 0);

console.log('\n3 · an ambiguous sales order is never guessed at');
const amb = R(
  [{ arNo: 'AR-X', invNo: 'LEGACY-1', soNo: 'SO-TWO', createdAt: BASE + 'T00:00:00Z', amountPHP: 10 }],
  [{ invNo: 'INV-1', soNo: 'SO-TWO', date: '2026-07-01', totalSales: 10, customer: 'c' },
   { invNo: 'INV-2', soNo: 'SO-TWO', date: '2026-07-02', totalSales: 20, customer: 'c' }]);
eq('two invoices on one order -> not resolved via SO', amb.viaSo.length, 0);
eq('  the AR row is reported unresolved instead', amb.unresolved.length, 1);
ok('  and BOTH invoices stay in scope rather than one being silently claimed',
   amb.unagedLive.length === 2);

console.log('\n4 · an empty AR ledger does not declare the book settled');
const empty = R([], INV);
ok('no baseline -> everything is treated as live, nothing excluded as history',
   empty.unagedHistory.length === 0 && empty.unagedLive.length > 0);

console.log('\n5 · the control sends the scope, and the unscoped button is gone');
ok('arBackfillLive exists', /async function arBackfillLive\(/.test(SRC));
ok('  it sends invNos', /invNos: JSON\.stringify\(rows\.map\(v => String\(v\.invNo\)\)\)/.test(SRC));
ok('  built from unagedLive, the same set the banner prints', /r\.unagedLive\.slice\(\)/.test(SRC));
ok('  it confirms before writing', /if \(!confirm\(/.test(SRC));
ok('  the confirm names the total', /money\(r\.unagedLiveValue\)/.test(SRC));
ok('  the button is limited to admin & accounting',
   /arSession\.role === 'admin' \|\| arSession\.role === 'accounting'/.test(SRC));
const LC = fs.readFileSync(path.join(__dirname, '../../dashboard/flow-lifecycle.html'), 'utf8');
ok('the unscoped lifecycle button is REMOVED', !/llBtnAr/.test(LC));
ok('  and no caller sends an empty payload to backfillMissingAR',
   !/llBackfill\('backfillMissingAR'/.test(LC));
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
ok('backfillMissingAR still honours invNos', /if \(only && !only\[invNo\]\)/.test(GS));
/* Slice to the real end of the block, not a guessed byte count — the entry sits 5,938 chars in and
   a fixed window silently "passed" by reading the wrong text. */
const secStart = GS.indexOf('var _SECURED = {');
const secBlock = GS.slice(secStart, GS.indexOf('\n};', secStart));
ok('  and is still _SECURED', /backfillMissingAR: 1/.test(secBlock));
ok('  (the whole block was read, not a fixed window)', secBlock.length > 5000);

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
