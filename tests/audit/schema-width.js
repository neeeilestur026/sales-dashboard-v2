/* A243 — THE WIDTH TRAP, across every sheet instead of the nine that happen to have a test.
 *
 * Run:  node tests/audit/schema-width.js
 *
 * WHY. `_append('Sheet', [...])` writes by POSITION. Google Sheets accepts a short array without
 * complaint, so a writer that is one element behind its SCHEMA silently files every value after the
 * gap one column to the left — the record looks plausible and the damage is only found later, in
 * money. This codebase has paid for that repeatedly; FLOW_VERSION's own changelog and half the
 * SCHEMA comments are about where a column may and may not be inserted.
 *
 * Nine sheets were pinned before this file, each by whichever A-number needed one at the time:
 * Quotations, PurchaseOrders, APAging, PaymentRequests, PricingRequests, PricingRequestItems and the
 * three travel sheets. The other 43 were not — including CommissionRequests, the 42-column widest
 * positional writer in the repo, which decides what a person is paid.
 *
 * This walks all of them. It is a PREVENTION test: it passes today (every arity matches), and its
 * whole value is failing the day someone appends a column and updates only one of the two places.
 */
const fs = require('fs');
const path = require('path');
const GAS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');

let FAIL = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (x === undefined ? '' : '\n         ' + x)); } };

/* ── SCHEMA, evaluated rather than regexed: it is a plain object literal and the real widths are
      what matter, not what a pattern thinks it sees. ─────────────────────────────────────────── */
const start = GAS.indexOf('var SCHEMA = {');
let d = 0, end = start;
for (let k = start; k < GAS.length; k++) {
  if (GAS[k] === '{') d++;
  else if (GAS[k] === '}') { d--; if (!d) { end = k + 1; break; } }
}
const SCHEMA = eval('(' + GAS.slice(start + 'var SCHEMA = '.length, end) + ')');
const sheets = Object.keys(SCHEMA);
console.log('== SCHEMA ==');
ok('parsed (' + sheets.length + ' sheets)', sheets.length >= 45, 'only ' + sheets.length);

/* Count the top-level elements of an array literal starting at `i` (which points at '['). Depth-aware
   for nested brackets/braces/parens, and string-aware so a comma inside a quoted value is not an
   element boundary. Comments are stripped first. */
function arity(src, i) {
  let depth = 0, n = 0, seen = false, q = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; seen = true; continue; }
    if ('[{('.includes(c)) { depth++; if (depth === 1) continue; }
    else if (']})'.includes(c)) { depth--; if (!depth) return seen ? n + 1 : 0; }
    else if (c === ',' && depth === 1) { n++; continue; }
    if (depth >= 1 && !/\s/.test(c)) seen = true;
  }
  return -1;
}
const clean = GAS.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                 .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
const lineOf = i => clean.slice(0, i).split('\n').length;

/* ── every _append('Sheet', [ ... ]) ───────────────────────────────────────────────────────────── */
console.log('\n== every _append writes exactly SCHEMA-many values ==');
{
  const re = /_append\(\s*'([A-Za-z]+)'\s*,\s*\[/g;
  let m, checked = 0, bad = [];
  while ((m = re.exec(clean))) {
    const sheet = m[1];
    if (!SCHEMA[sheet]) { bad.push(sheet + ' @' + lineOf(m.index) + ' — not a SCHEMA sheet'); continue; }
    const n = arity(clean, m.index + m[0].length - 1);
    checked++;
    if (n !== SCHEMA[sheet].length)
      bad.push(sheet + ' @line ' + lineOf(m.index) + ': writes ' + n + ', SCHEMA is ' + SCHEMA[sheet].length);
  }
  console.log('     positional _append call sites checked: ' + checked);
  ok('every _append matches its sheet width', bad.length === 0, bad.join('\n         '));
}

/* ── the DELIBERATE short writers ──────────────────────────────────────────────────────────────
   Two importers write short on purpose, because a migrated record genuinely has no value for the
   trailing columns. Pinned by NAME and COUNT so they cannot drift either — pr-owner.js:63 records
   that an earlier measurement got this exact pair wrong. */
console.log('\n== the two deliberate short writers are still exactly as short as they were ==');
{
  const fnBody = name => {
    const a = clean.indexOf('function ' + name + '(');
    if (a < 0) return '';
    let dd = 0, k = clean.indexOf('{', a);
    for (let j = k; j < clean.length; j++) {
      if (clean[j] === '{') dd++;
      else if (clean[j] === '}') { dd--; if (!dd) return clean.slice(a, j + 1); }
    }
    return '';
  };
  const body = fnBody('importPricingSubmissions');
  const at = (b, call) => { const i = b.indexOf(call); return i < 0 ? -1 : arity(b, i + call.length - 1); };
  ok('importPricingSubmissions still writes 18 into PricingRequests (20)',
     at(body, 'sh.appendRow([') === 18, 'now ' + at(body, 'sh.appendRow(['));
  ok('  and 14 into PricingRequestItems (19)',
     at(body, 'itemSh.appendRow([') === 14, 'now ' + at(body, 'itemSh.appendRow(['));
}

/* ── hard-coded anchors ────────────────────────────────────────────────────────────────────────
   A getRange(row, C, 1, N) with literal C and N is the SILENT variant: insert a column inside the
   block and every value lands one cell over, with no error anywhere. There is no way to check the
   arithmetic mechanically, so instead pin the NAME at each anchor — the same technique pr-owner.js
   uses for _setPRStatus's cols 8/10/12. If a column moves, the name at that index changes. */
console.log('\n== the names at every hard-coded column anchor ==');
{
  const at = (sheet, col) => SCHEMA[sheet][col - 1];
  const pin = (sheet, col, want, why) =>
    ok(sheet + ' col ' + col + ' is still "' + want + '"  (' + why + ')', at(sheet, col) === want,
       'it is now "' + at(sheet, col) + '" — a column was inserted, and that writer now corrupts');

  /* Verified against the writers, not guessed: reverseReceiving and updateInventoryItem both write
     [balance, purchase, shipping, landed, total, 'PHP', now] — exactly cols 3..9. */
  pin('Inventory', 3, 'Available Balance', 'the 7-wide block in updateInventoryItem + reverseReceiving starts here');
  pin('Inventory', 8, 'Currency', "...its 6th value is the literal 'PHP'");
  pin('Inventory', 9, 'Last Updated', '...and its 7th is _now()');
  pin('PurchaseOrders', 1, 'PO No', 'updatePurchaseOrder rewrites a 9-wide block from col 1');
  pin('PurchaseOrders', 9, 'Created At', '...and this is its last cell, carried through unchanged');
  pin('Quotations', 1, 'Quotation No', 'updateQuotation rewrites 7 wide from col 1; renameQuotation 7 too');
  pin('Quotations', 7, 'Created At', '...and this is its last cell');
  pin('PricingRequests', 8, 'Status', '_setPRStatus');
  pin('PricingRequests', 10, 'Notes', '_setPRStatus');
  pin('PricingRequests', 12, 'Updated At', '_setPRStatus');
  pin('PricingRequests', 15, 'Priced Items JSON', 'setMgmtPricing / rejectMgmtPricing');
  pin('PricingRequestItems', 8, 'Included', 'updatePRSourcing block start');
  pin('PricingRequestItems', 13, 'CBM', 'updatePRSourcing block end');
  pin('PricingRequestItems', 9, 'Supplier', 'rejectMgmtPricing block start');
  pin('PricingRequestItems', 14, 'Final Price', 'rejectMgmtPricing block end');
  pin('PricingRequestItems', 19, 'Quoted On', 'A242 appended it; the two blocks above forbid an insert');
}

/* ── the widest unpinned writers, now pinned ───────────────────────────────────────────────────
   Named individually because these are the ones where a silent short write costs the most. */
console.log('\n== the money-bearing widths ==');
[['CommissionRequests', 42, 'decides what a person is paid'],
 ['SOCostDetails', 18, 'the gross-profit record; saveSOCostDetails is a FULL-ROW overwrite'],
 ['DailyReports', 24, 'no test mentioned this sheet at all before A243'],
 ['Quotations', 27, 'A218 appended Salesperson'],
 ['PricingRequestItems', 19, 'A242 appended Quoted On'],
 ['PaymentRequests', 41, ''], ['PurchaseOrders', 17, ''], ['APAging', 13, ''],
 ['Expenses', 17, ''], ['Shipments', 16, ''], ['QuotationEmails', 18, ''], ['WeeklyItineraries', 16, '']]
  .forEach(([s, w, why]) =>
    ok(s + ' is ' + w + ' wide' + (why ? '  (' + why + ')' : ''), SCHEMA[s] && SCHEMA[s].length === w,
       'now ' + (SCHEMA[s] ? SCHEMA[s].length : 'MISSING')));

console.log('\n== no sheet has a duplicate column name ==');
{
  const dupes = sheets.filter(s => new Set(SCHEMA[s]).size !== SCHEMA[s].length);
  ok('every column name is unique within its sheet', dupes.length === 0,
     'a duplicate makes every name-based lookup ambiguous: ' + dupes.join(', '));
}

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
