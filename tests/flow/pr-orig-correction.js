/* A256 — correcting the "requested" line that prints on a client's quotation.
 *
 * Run:  node tests/flow/pr-orig-correction.js
 *
 * WHY THIS FILE EXISTS. Orig Item No / Orig Item Name are captured ONCE, first-change-wins, by
 * updatePRSourcing. Nothing could change them afterwards. They are not internal: flow_quotation_pdf
 * prints Orig Item Name as the bold heading above OUR OFFER — the line the client asked for. So a
 * wrong capture was permanent and went out on the document. On PR-202608-011 the two lines'
 * requested descriptions were transposed.
 *
 * The rules pinned here:
 *   1. The auto-capture still only fires when the field is EMPTY (first change wins).
 *   2. An EXPLICIT correction overwrites, and is applied AFTER the capture so it wins.
 *   3. Blank never overwrites — the A174 rule that stops a partial save wiping real text.
 *   4. The cols-8-13 positional block is not widened by any of this.
 */
const fs = require('fs');
const path = require('path');
let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };

const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const i = GS.indexOf('function updatePRSourcing(p)');
const fn = GS.slice(i, GS.indexOf('\nfunction ', i + 10));

console.log('\n1 · the explicit correction exists');
ok('origItemNo is accepted', /u\.origItemNo !== undefined/.test(fn));
ok('origItemName is accepted', /u\.origItemName !== undefined/.test(fn));
ok('  it writes col 15', /getRange\(row\.rowIndex, 15, 1, 1\)[\s\S]{0,80}String\(u\.origItemNo\)/.test(fn));
ok('  it writes col 16', /getRange\(row\.rowIndex, 16, 1, 1\)[\s\S]{0,80}String\(u\.origItemName\)/.test(fn));

console.log('\n2 · blank never overwrites (A174)');
ok('origItemNo guarded on non-blank', /String\(u\.origItemNo\)\.trim\(\) !== ''/.test(fn));
ok('origItemName guarded on non-blank', /String\(u\.origItemName\)\.trim\(\) !== ''/.test(fn));

console.log('\n3 · the correction wins over the auto-capture');
const capNo = fn.indexOf("sh.getRange(row.rowIndex, 15, 1, 1).setValues([[row['Item No']]])");
const expNo = fn.indexOf('String(u.origItemNo).trim()');
ok('explicit write comes AFTER the capture', capNo > -1 && expNo > capNo, { capNo, expNo });
ok('the auto-capture still only fires when empty',
   /!String\(row\['Orig Item No'\] \|\| ''\)\.trim\(\)/.test(fn));

console.log('\n4 · the positional block was not widened');
ok('cols 8-13 still written as a 6-wide range', /getRange\(row\.rowIndex, 8, 1, 6\)/.test(fn));
ok('  and nothing writes 8,1,7 or wider', !/getRange\(row\.rowIndex, 8, 1, [7-9]\)/.test(fn));

console.log('\n5 · what the PDF actually prints');
const PDF = fs.readFileSync(path.join(__dirname, '../../pdf_generators/flow_quotation_pdf.py'), 'utf8');
ok('the heading is orig_name, falling back to name', /req_name = orig_name or name/.test(PDF));
ok('  and OUR OFFER sits under it', /OUR OFFER/.test(PDF));
ok('an N/A orig code is not treated as a real request',
   /_orig_code_real = orig_code and orig_code\.lower\(\) not in \("n\/a", "na", "-"\)/.test(PDF));

const V = Number((GS.match(/var FLOW_VERSION = (\d+)/) || [])[1]);
ok('FLOW_VERSION >= 144 (where this shipped) — got ' + V, V >= 144);
console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
