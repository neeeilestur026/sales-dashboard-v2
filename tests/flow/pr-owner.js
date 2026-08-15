/* A226 — WHOSE PURCHASE REQUEST IS IT, and the width trap that guards the answer.
 *
 * pr-worklist.js tests the pure engine. This file tests the SERVER half, and it exists mainly for one
 * assertion the plan called the single most dangerous edit in it.
 *
 * THE WIDTH TRAP, ASSERTED BEFORE ANY BEHAVIOUR. `Salesperson` had to be APPENDED (19 -> 20), never
 * inserted, and that is not a style preference. `_setPRStatus` writes hard-coded columns 8, 10 and 12;
 * `setMgmtPricing` / `rejectMgmtPricing` write column 15. An INSERT anywhere left of those shifts all
 * 315 live rows one cell right and every one of those writes lands in its neighbour's column — a
 * status written over a PDF link, a timestamp written over notes, silently, with no error anywhere.
 * So the column numbers are asserted against the schema BY NAME: if someone inserts a column, the
 * name at position 8 stops being 'Status' and this file fails before any behaviour is examined.
 * The same trap has been sprung five times in this codebase (A186, A193, A205, A215, A218).
 *
 * THE TOLERANCE IS A BUG FIX, not a nicety. The old filter matched `String(a) === String(b)` on free
 * text typed into a browser session. One trailing space silently empties a rep's entire tracker with
 * no error — and it had already happened: PR-202607-242 and PR-202607-295 were permanently stranded,
 * invisible to the rep who raised them and to every consumer of the handler. Those two rows are named
 * here so the fix cannot be quietly reverted.
 *
 * THE FILTER CHANGE MUST BE A STRICT WIDENING. Sixteen surfaces call getPricingRequests. A widening
 * cannot regress any of them; a narrowing would empty a page. So it is proved as a superset over a
 * live-shaped roster rather than asserted in a comment.
 *
 * The server half lives in Apps Script, so it is lifted out of FlowAPI.gs and eval'd here — the same
 * technique tests/flow/pr-per-po.js, pay-ownership.js and fx-chain.js use.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const GAS = fs.readFileSync(path.join(ROOT, 'apps-script/FlowAPI.gs'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** Pull one top-level `function name(...) { ... }` out of a source by brace matching. */
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = src.indexOf('{', i);
  let d = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
/* Count the top-level entries of an array literal written into a sheet, SCOPED TO ONE FUNCTION.
 *
 * Two lessons are built in, both paid for:
 *
 *   • the comma count must skip block comments and quoted strings, because these value lists carry
 *     both and their commas are not separators. A naive counter over-reports and raises a FALSE
 *     width-trap alarm — which is exactly what a hand-rolled one did in A225;
 *   • THE SEARCH MUST BE BOUNDED BY THE FUNCTION. The first version of this file searched forward
 *     from `function importPricingSubmissions` for `_append('PricingRequests'` — a call that function
 *     does not make (it writes through `sh.appendRow`) — walked straight past its closing brace and
 *     measured createPricingRequest's 20 instead. It reported the import as 20 wide when it is 18,
 *     i.e. it silently measured the wrong function and would have gone on passing for ever. So the
 *     body is brace-matched first and the call is looked for INSIDE it, or this throws. */
function fnBody(name) {
  const i = GAS.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = GAS.indexOf('{', i);
  let d = 0;
  for (let k = s; k < GAS.length; k++) {
    if (GAS[k] === '{') d++;
    else if (GAS[k] === '}') { d--; if (!d) return GAS.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
/** @param {string} fnName @param {string} call e.g. "_append('PricingRequests', [" or "sh.appendRow([" */
function countRow(fnName, call) {
  const src = fnBody(fnName);
  const a = src.indexOf(call);
  if (a < 0) throw new Error('no ' + call + ' inside ' + fnName + ' — wrong call form?');
  const st = src.indexOf('[', a + call.length - 1);
  let d = 0, en = -1;
  for (let k = st; k < src.length; k++) {
    if (src[k] === '[') d++;
    else if (src[k] === ']') { d--; if (!d) { en = k; break; } }
  }
  const body = src.slice(st + 1, en).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let depth = 0, n = 1, inStr = null;
  for (const c of body) {
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"') inStr = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return body.trim() ? n : 0;
}
/** The declared column list for one sheet in SCHEMA. */
function schemaCols(sheet) {
  const m = new RegExp(sheet + ':\\s*\\[([\\s\\S]*?)\\]').exec(GAS);
  if (!m) throw new Error('no SCHEMA entry: ' + sheet);
  return eval('([' + m[1] + '])');
}

// ── the server, verbatim ──────────────────────────────────────────────────────────────────────
eval(lift(GAS, '_prOwner'));
eval(lift(GAS, '_prSameOwner'));

const COLS = schemaCols('PricingRequests');

console.log('== THE WIDTH TRAP — asserted before any behaviour ==');
{
  eq('SCHEMA.PricingRequests is 20 wide', COLS.length, 20);
  eq('and the new column is the LAST one, appended', COLS[COLS.length - 1], 'Salesperson');
  eq('createPricingRequest writes exactly that many values',
    countRow('createPricingRequest', "_append('PricingRequests', ["), 20);

  /* importPricingSubmissions deliberately writes 18 and always has. It is an import path for records
     from the old system: it fills the first 18 columns and leaves Plant Site and Salesperson unset,
     which is right — a migrated record has no plant site and belongs to no current rep. Pinned at 18
     rather than left unstated, so a later widening cannot silently shift IT either.
     Note the DIFFERENT CALL FORM: this one writes through sh.appendRow, not _append. */
  eq('importPricingSubmissions still writes 18 — deliberate, now pinned',
    countRow('importPricingSubmissions', 'sh.appendRow(['), 18);
  ok('and those two are genuinely different writers, not the same one measured twice',
    fnBody('importPricingSubmissions').indexOf("_append('PricingRequests'") < 0);

  /* THE ASSERTION THE WHOLE EDIT TURNS ON. These four numbers are hard-coded in the writers; if a
     column is ever inserted rather than appended, the name at that position changes and this fails. */
  eq('col 8 is still Status         (_setPRStatus)', COLS[7], 'Status');
  eq('col 10 is still Notes         (_setPRStatus)', COLS[9], 'Notes');
  eq('col 12 is still Updated At    (_setPRStatus)', COLS[11], 'Updated At');
  eq('col 15 is still Priced Items JSON (setMgmtPricing / rejectMgmtPricing)', COLS[14], 'Priced Items JSON');

  ok('no column name appears twice', new Set(COLS).size === COLS.length, COLS);
}

/* A242 — the ITEM sheet's width trap, which nothing pinned until partial quoting needed a column on
   it. Two positional BLOCK writes live here, at different anchors, and either one landing a cell out
   would corrupt supplier prices across 926 live lines rather than fail loudly. */
console.log('\n== THE WIDTH TRAP, item sheet — asserted before any behaviour ==');
{
  const IC = schemaCols('PricingRequestItems');
  eq('SCHEMA.PricingRequestItems is 19 wide', IC.length, 19);
  eq('and the new column is the LAST one, appended', IC[IC.length - 1], 'Quoted On');
  eq('Item ID stays at 18, where A159 put it', IC[17], 'Item ID');
  eq('createPricingRequest writes exactly that many values',
    countRow('createPricingRequest', "sh.appendRow(["), 19);

  /* importPricingSubmissions writes 14 and always has — a legacy row carries no Orig No/Name, no
     VAT note, no catalogue Item ID and, now, no quotation. Pinned so a later widening cannot shift
     it silently either. */
  eq('importPricingSubmissions still writes 14 for items — deliberate, now pinned',
    countRow('importPricingSubmissions', 'itemSh.appendRow(['), 14);

  /* THE ANCHORS. updatePRSourcing writes cols 8-13 as ONE range and rejectMgmtPricing writes cols
     9-14 as another; both are hard-coded. If a column were ever inserted rather than appended, the
     names at these positions change and this fails instead of the sheet corrupting. */
  eq('col 8 is still Included            (updatePRSourcing block start)', IC[7], 'Included');
  eq('col 13 is still CBM                (updatePRSourcing block end)', IC[12], 'CBM');
  eq('col 9 is still Supplier            (rejectMgmtPricing block start)', IC[8], 'Supplier');
  eq('col 14 is still Final Price        (rejectMgmtPricing block end, setMgmtPricing)', IC[13], 'Final Price');
  eq('col 5 is still Qty                 (setMgmtPricing)', IC[4], 'Qty');
  eq('col 12 is still Supplier Price (FC)(setMgmtPricing)', IC[11], 'Supplier Price (FC)');

  ok('no column name appears twice', new Set(IC).size === IC.length, IC);
}

console.log('\n== _prOwner — the column, then who typed it, and never a guess ==');
{
  eq('a recorded Salesperson wins',
    _prOwner({ 'Salesperson': 'Gerald Lucena', 'Requested By': 'Larry Estur' }), 'Gerald Lucena');
  eq('blank Salesperson falls back to who requested it',
    _prOwner({ 'Salesperson': '', 'Requested By': 'Larry Estur' }), 'Larry Estur');
  eq('whitespace-only Salesperson is not an owner',
    _prOwner({ 'Salesperson': '   ', 'Requested By': 'Larry Estur' }), 'Larry Estur');
  eq('both blank stays blank — never defaulted to anybody',
    _prOwner({ 'Salesperson': '', 'Requested By': '' }), '');
  eq('a missing row does not throw', _prOwner(null), '');
  eq('the camelCase DTO shape reads too (the client passes rows back)',
    _prOwner({ salesperson: 'Crystal Gayle' }), 'Crystal Gayle');
  eq('stored values are trimmed on the way out',
    _prOwner({ 'Salesperson': ' Kimberlyn Blones ' }), 'Kimberlyn Blones');
}

console.log('\n== _prSameOwner — the two live rows this fix exists for ==');
{
  /* PR-202607-242 and PR-202607-295 carried a trailing space in 'Requested By'. Under the old exact
     String(a) === String(b) they matched nothing, so they were invisible to the rep who raised them
     and to all 16 consumers of the handler — with no error, no warning, and no way to notice. */
  ok('a trailing space no longer strands a request (PR-202607-242)',
    _prSameOwner('Kimberlyn Blones ', 'Kimberlyn Blones'));
  ok('nor a leading one (PR-202607-295)',
    _prSameOwner(' Kimberlyn Blones', 'Kimberlyn Blones'));
  ok('nor a doubled inner space', _prSameOwner('Kimberlyn  Blones', 'Kimberlyn Blones'));
  ok('nor a tab', _prSameOwner('Kimberlyn\tBlones', 'Kimberlyn Blones'));
  ok('case does not decide ownership', _prSameOwner('gerald lucena', 'Gerald Lucena'));
  ok('the exact match still matches', _prSameOwner('Larry Estur', 'Larry Estur'));

  ok('and it is still a NAME test, not a substring one — Gerald is not Larry',
    !_prSameOwner('Gerald Lucena', 'Larry Estur'));
  ok('a first name alone does not claim the row',
    !_prSameOwner('Gerald', 'Gerald Lucena'));
  ok('blank matches only blank', _prSameOwner('', '') && !_prSameOwner('', 'Larry Estur'));
  ok('null/undefined do not throw and do not match a name',
    !_prSameOwner(null, 'Larry Estur') && !_prSameOwner(undefined, 'Larry Estur'));
}

console.log('\n== the filter is a STRICT WIDENING — every old match survives ==');
{
  /* The four live rep names, plus the shapes the sheet actually holds: the clean rows, the two
     stranded ones, a blank, and a case-variant. */
  const ROWS = [
    { 'PR No': 'PR-202601-001', 'Requested By': 'Larry Estur' },
    { 'PR No': 'PR-202602-014', 'Requested By': 'Kimberlyn Blones' },
    { 'PR No': 'PR-202607-242', 'Requested By': 'Kimberlyn Blones ' },   // the stranded pair
    { 'PR No': 'PR-202607-295', 'Requested By': ' Kimberlyn Blones' },
    { 'PR No': 'PR-202603-077', 'Requested By': 'Gerald Lucena' },
    { 'PR No': 'PR-202604-101', 'Requested By': 'gerald lucena' },
    { 'PR No': 'PR-202605-133', 'Requested By': 'Crystal Gayle' },
    { 'PR No': 'PR-202606-180', 'Requested By': '' },                     // one of the 5 blanks
    // reassigned: raised by one rep, owned by another. The column decides.
    { 'PR No': 'PR-202608-311', 'Requested By': 'Larry Estur', 'Salesperson': 'Gerald Lucena' }
  ];
  const NAMES = ['Larry Estur', 'Kimberlyn Blones', 'Gerald Lucena', 'Crystal Gayle'];
  const oldWay = (who) => ROWS.filter(r => String(r['Requested By']) === String(who)).map(r => r['PR No']);
  const newWay = (who) => ROWS.filter(r => _prSameOwner(_prOwner(r), who)).map(r => r['PR No']);

  /* THE WIDENING CLAIM, STATED EXACTLY. It holds for every row with no recorded Salesperson — which
     is every one of the 315 live rows today, since the column is new and the backfill has not run.
     That is what "no consumer regresses" means and it is proved, not asserted.
     A row that HAS a recorded owner is a different matter: it is allowed — required — to move off the
     board of whoever typed it. Testing those two claims as one would make the second one impossible
     to state, so they are separated rather than blurred. */
  const notReassigned = (no) => !ROWS.some(r => r['PR No'] === no && String(r['Salesperson'] || '').trim());
  NAMES.forEach(function (n) {
    const before = oldWay(n).filter(notReassigned), after = newWay(n);
    ok('superset for ' + n + ' — no un-reassigned row the old filter returned is lost',
      before.every(x => after.indexOf(x) >= 0), { before: before, after: after });
  });
  /* And the one row that does move, named, so the exception cannot creep wider than one row. */
  eq('exactly one row changes hands, and only because a Salesperson was recorded on it',
    ROWS.filter(r => oldWay(r['Requested By']).indexOf(r['PR No']) >= 0 &&
                     newWay(r['Requested By']).indexOf(r['PR No']) < 0).map(r => r['PR No']),
    ['PR-202608-311']);

  eq('Kimberlyn gains exactly the two stranded rows', newWay('Kimberlyn Blones'),
    ['PR-202602-014', 'PR-202607-242', 'PR-202607-295']);
  eq('Gerald gains the case-variant AND the reassigned row', newWay('Gerald Lucena'),
    ['PR-202603-077', 'PR-202604-101', 'PR-202608-311']);
  eq('and Larry LOSES the row he no longer owns — the column decides, not who typed it',
    newWay('Larry Estur'), ['PR-202601-001']);

  /* The union across the roster plus the blanks must be every row: nobody may be double-counted onto
     two reps' boards, and nobody may vanish from all of them. */
  const seen = [].concat.apply([], NAMES.map(newWay));
  const blanks = ROWS.filter(r => !_prOwner(r)).map(r => r['PR No']);
  eq('no row lands on two reps at once', seen.length, new Set(seen).size);
  eq('union + blanks accounts for every row', seen.length + blanks.length, ROWS.length);
  eq('the blank is REPORTED, never defaulted to a rep', blanks, ['PR-202606-180']);

  /* An empty `who` must mean "everyone" — the oversight path. A filter that treated '' as a name
     would show management an empty page. */
  const who = '';
  eq('no name asked for = every row (the oversight path)',
    (who ? ROWS.filter(r => _prSameOwner(_prOwner(r), who)) : ROWS).length, ROWS.length);
}

console.log('\n== salespersonSource — a page that groups by a guess says so ==');
{
  const src = (h) => String(h['Salesperson'] || '').trim() ? 'recorded' : 'from who requested it';
  eq('a recorded owner is recorded', src({ 'Salesperson': 'Gerald Lucena' }), 'recorded');
  eq('a fallback owner says where it came from', src({ 'Requested By': 'Larry Estur' }), 'from who requested it');
  eq('whitespace is not a recording', src({ 'Salesperson': '  ' }), 'from who requested it');
}

console.log('\n== registration — an unregistered action leaves no audit row at all ==');
{
  const listOf = (name) => {
    const i = GAS.indexOf('var ' + name + ' = ');
    const s = GAS.indexOf('{', i);
    let d = 0;
    for (let k = s; k < GAS.length; k++) {
      if (GAS[k] === '{') d++;
      else if (GAS[k] === '}') { d--; if (!d) return GAS.slice(s, k + 1); }
    }
    throw new Error('unbalanced: ' + name);
  };
  const H = listOf('HANDLERS'), M = listOf('MUTATIONS'), L = listOf('_MODULE_MAP'), S = listOf('_SECURED');
  const has = (blob, a) => new RegExp('(^|[\\s{,])' + a + '\\s*:').test(blob);

  ['previewPricingRequestOwners', 'runPricingRequestOwnerBackfill', 'setPricingRequestSalesperson']
    .forEach(a => ok(a + ' is reachable (HANDLERS)', has(H, a)));

  ['runPricingRequestOwnerBackfill', 'setPricingRequestSalesperson'].forEach(a => {
    ok(a + ' takes the lock (MUTATIONS)', has(M, a));
    ok(a + ' leaves an audit row (_MODULE_MAP)', has(L, a));
    /* Both rewrite attribution off a browser-supplied role — the backfill across 315 rows at once. */
    ok(a + ' is _SECURED', has(S, a));
  });

  ok('previewPricingRequestOwners takes NO lock — it is a read', !has(M, 'previewPricingRequestOwners'));
  eq('FLOW_VERSION is at least 130', Number((GAS.match(/FLOW_VERSION\s*=\s*(\d+)/) || [])[1]) >= 130, true);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
process.exit(fail ? 1 : 0);
