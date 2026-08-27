/* A252 — renaming an invoice number.
 *
 * Run:  node tests/flow/invoice-rename.js
 *
 * WHY THIS FILE EXISTS. The business issues invoices on its own paper with its own numbering; the
 * INV-YYYYMM-NNN sequence this system mints is an internal placeholder. Putting the real number on
 * the record is a RE-KEY, not an edit — every downstream money row points at the string.
 *
 * The rules pinned here, because each one is a way to fragment an invoice or double-pay a claim:
 *
 *   1. THE SWEEP IS SCHEMA-DRIVEN. Every sheet carrying an 'INV No' moves, discovered from SCHEMA
 *      rather than a hand-kept list, so a sheet that gains the column later cannot be forgotten.
 *
 *   2. COLLISION IS CASE-INSENSITIVE. Two invoices differing only in case are one number to a human
 *      reading a statement.
 *
 *   3. A CLAIM IN FLIGHT FREEZES THE NUMBER. _commPriorClaimed matches by string, so a half-moved
 *      rename would let one collection be claimed twice.
 *
 *   4. createInvoice MUST REFUSE A NUMBER ALREADY IN USE. It accepted a caller-supplied invNo on
 *      trust, and _postJournal opens with _removeJournal(source, sourceNo) — so re-using a number
 *      would have deleted the FIRST invoice's GL entry and left two rows sharing one number. That is
 *      the bug this feature would otherwise have walked straight into.
 */
const fs = require('fs');
const path = require('path');

let FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { console.log('  ok   ' + label); }
  else { FAIL++; console.log('  FAIL ' + label + (extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); }
};
const eq = (label, got, want) => ok(label + ' = ' + JSON.stringify(want), got === want, { got, want });

const SRC = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const body = SRC.slice(SRC.indexOf('function renameInvoice(p)'),
                       SRC.indexOf('function updateARAging(p)'));
ok('renameInvoice exists', body.length > 200);

console.log('\n1 · which sheets must move');
/* Read SCHEMA out of the source and derive the answer, rather than asserting a list I typed —
   a hand-typed list here would rot in exactly the way the schema-driven sweep exists to prevent. */
const schemaSrc = SRC.slice(SRC.indexOf('var SCHEMA = {'));
const end = schemaSrc.indexOf('\n};');
const carriers = [];
schemaSrc.slice(0, end).split('\n').forEach(line => {
  const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*\[/);
  if (m && /'INV No'/.test(line)) carriers.push(m[1]);
});
console.log('     sheets carrying an INV No: ' + carriers.join(', '));
ok('more than one sheet carries it (so a sweep is required)', carriers.length > 1, carriers);
['Invoices', 'InvoiceItems', 'ARAging', 'Collections'].forEach(n =>
  ok('  ' + n + ' is one of them', carriers.indexOf(n) >= 0, carriers));
ok('the sweep is schema-driven, not a hand-kept list',
   /Object\.keys\(SCHEMA\)\.forEach/.test(body) && /SCHEMA\[name\]\.indexOf\('INV No'\)/.test(body));
carriers.forEach(n => ok('  ' + n + ' is NOT hard-coded in the sweep',
  !new RegExp("_sheet\\('" + n + "'\\)[\\s\\S]{0,80}INV No").test(body)));

console.log('\n2 · the refusals');
ok('empty new number refused', /newInvNo required/.test(body));
ok('unchanged number is a no-op, not a rewrite', /renamed: false/.test(body));
ok('missing invoice refused', /not found/.test(body));
ok('collision test lowercases both sides',
   /\.trim\(\)\.toLowerCase\(\)/.test(body) && /newNo\.toLowerCase\(\)/.test(body));
ok('a commission claim in flight refuses the rename',
   /_COMM_LOCKING/.test(body) && /in flight against it/.test(body));
ok('  and it names the claims', /locked\.map/.test(body));

console.log('\n3 · what follows the number');
ok('Documents move (Module = Invoice)', /String\(d\['Module'\]\) === 'Invoice'/.test(body));
ok('  and are confirmed before they move', /needsConfirm: 'renameDocs'/.test(body));
ok('the GL entry number moves', /'JE-INV-' \+ newNo/.test(body));
ok('the GL source number moves', /jSrcNo/.test(body));
ok('the memo a person reads moves too', /jMemo/.test(body));
ok('  by exact-substring swap, never a loose replace',
   /memo\.split\(oldNo\)\.join\(newNo\)/.test(body) && !/replace\(new RegExp\(oldNo/.test(body));

console.log('\n4 · createInvoice refuses a number already in use');
const ci = SRC.slice(SRC.indexOf('function createInvoice(p)'));
const ciBody = ci.slice(0, ci.indexOf("\n_nextNumber") > 0 ? ci.indexOf('\nfunction ') : ci.indexOf('\nfunction '));
ok('the guard exists', /already exists\. Use a different number/.test(ciBody));
ok('  it is case-insensitive', /String\(p\.invNo\)\.trim\(\)\.toLowerCase\(\)/.test(ciBody));
ok('  it runs BEFORE the number is chosen',
   ciBody.indexOf('already exists. Use a different number') < ciBody.indexOf("_nextNumber('Invoices'"));

console.log('\n5 · registration surface');
const reg = (re, what) => ok(what, re.test(SRC));
reg(/renameInvoice: renameInvoice,/, 'HANDLERS');
reg(/renameInvoice: \['Invoice', 'Renamed'\],/, '_MODULE_MAP');
const secured = SRC.slice(SRC.indexOf('var _SECURED = {'));
ok('_SECURED', /renameInvoice: 1/.test(secured.slice(0, secured.indexOf('\n};'))));
const mut = SRC.slice(SRC.indexOf('var MUTATIONS = {') >= 0 ? SRC.indexOf('var MUTATIONS = {') : 0);
ok('MUTATIONS', /renameInvoice: 1/.test(mut.slice(0, mut.indexOf('\n};'))));
const py = fs.readFileSync(path.join(__dirname, '../../blueprints/flow.py'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-api.js'), 'utf8');
ok('blueprints/flow.py mirror', /"renameInvoice"/.test(py));
ok('dashboard/js/flow-api.js mirror', /'renameInvoice'/.test(js));

console.log('\n6 · the browser side');
const ui = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-invoices.js'), 'utf8');
ok('an Edit No button is offered', /renameInvoiceAction/.test(ui));
ok('gated on the backend that understands it', /flowVersionAtLeast\(142\)/.test(ui));
ok('  and hidden from the viewer role', /if \(ivViewer\) ivCanRename = false;/.test(ui));
ok('the docs confirm is retried honestly', /confirmDocs: 'true'/.test(ui));
ok('the list reloads after a rename', /renameInvoiceAction[\s\S]{0,1400}await loadInvoices\(\)/.test(ui));

/* A floor, not an equality. renameInvoice shipped in 142 and every later version still carries it;
   asserting equality made this test fail the moment 143 shipped, which is noise, not a regression. */
const V = Number((SRC.match(/var FLOW_VERSION = (\d+)/) || [])[1]);
ok('\nFLOW_VERSION >= 142 (where renameInvoice shipped) — got ' + V, V >= 142);

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
