/* A257 — editing a quotation must re-read it first.
 *
 * Run:  node tests/flow/quotation-stale-edit.js
 *
 * WHY THIS FILE EXISTS. qcOpen loaded whatever `qList` held. `qList` is an in-memory array filled
 * once on page load and refreshed only by an explicit action, so a tab left open goes stale without
 * limit — the 60s sessionStorage cache does not help, because nothing re-reads.
 *
 * That is not a display problem. updateQuotation rewrites EVERY line from the payload, so saving
 * from a stale editor silently reverts whatever changed in the meantime. On 2026-426-KIM-SPI it
 * presented exactly as reported: the old description with a price the rep knew was right — because
 * the price had been corrected in the same session the stale copy predated.
 *
 * The rules pinned here:
 *   1. qcOpen re-reads with { fresh: true }, bypassing the read cache.
 *   2. It refreshes qList too, so the row behind the editor stops lying as well.
 *   3. A failed read FALLS BACK to the cached row and SAYS SO — being unable to open a quotation is
 *      worse than editing a stale one, but the rep must know which they have.
 *   4. qcOpenAndRefresh awaits it, or the price refresh would run against an unloaded editor.
 */
const fs = require('fs');
const path = require('path');
let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-quote-configurator.js'), 'utf8');
const fn = SRC.slice(SRC.indexOf('async function qcOpen('), SRC.indexOf('function qcSyncLock('));

console.log('\n1 · it re-reads instead of trusting the in-memory list');
ok('qcOpen is async', /async function qcOpen\(/.test(SRC));
ok('  it fetches getQuotations', /fetchFlow\('getQuotations'/.test(fn));
ok('  bypassing the cache with { fresh: true }', /\{ fresh: true \}/.test(fn));
ok('  and it picks the record by number', /String\(x\.quotationNo\) === String\(no\)/.test(fn));
ok('  qList is refreshed too, so the row stops lying', /qList = r\.data/.test(fn));

console.log('\n2 · an explicit record still wins (callers that already hold one)');
ok('record parameter is honoured first', /let q = record \|\| null;/.test(fn));

console.log('\n3 · a failed read degrades honestly');
ok('falls back to the cached row', /catch \(e\)[\s\S]{0,220}qList\.find/.test(fn));
ok('  and TELLS the user it is stale', /Could not re-read/.test(fn));
ok('  still refuses when there is nothing at all', /is not in the list/.test(fn));

console.log('\n4 · the refresh caller awaits it');
ok('qcOpenAndRefresh is async', /async function qcOpenAndRefresh\(/.test(SRC));
ok('  and awaits qcOpen', /await qcOpen\(no, 'edit'\);/.test(SRC));
ok('  before refreshing prices',
   SRC.indexOf("await qcOpen(no, 'edit')") < SRC.indexOf('qcRefreshPricesFromPR();\n}'));

console.log('\n5 · the hazard this protects against is real');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
ok('updateQuotation rewrites every line when items are sent',
   /_writeItems\('QuotationItems'/.test(GS));
ok('  so a stale editor would revert newer changes — hence the re-read',
   /p\.items !== undefined/.test(GS));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
