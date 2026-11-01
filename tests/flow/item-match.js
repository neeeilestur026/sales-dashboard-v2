/* A387 — the browser's item resolver (dashboard/js/item-match.js) decides exactly as FlowAPI's _ibResolve does.
 *
 * Run:  node tests/flow/item-match.js
 *
 * A page that stamps an id the server would not, or refuses one the server would take, is the "first N/A row" bug in a
 * new place. Both resolvers run over the same rows and the same lines here, and must agree on every answer.
 */
const { load } = require('./gasload');
const path = require('path');
const im = require('../../dashboard/js/item-match.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

const ROWS = [
  ['ITM-00001', 'N/A', 'PIECE INSULATED PIER AND SCREWD'], ['ITM-00002', 'N/A', '1-TORCH;  HAND; CUTTING'], ['ITM-00003', 'N/A', 'TORCH TIP; CUTTING; SIZE 2'],
  ['ITM-00004', 'CP872', 'Impact wrench CP872'], ['ITM-00005', 'TBA', 'Hydraulic hose 2m'], ['ITM-00006', 'TBA', 'Hydraulic hose 2m'],
  ['ITM-00007', '123', 'Torque multiplier 123'], ['ITM-00008', 'DUP-1', 'Gauge, analogue'], ['ITM-00009', 'DUP-1', 'Gauge, digital'],
  ['ITM-00010', '-', 'Mobile welding rig'], ['ITM-00011', 'none', 'Cutting torch tip cleaner set'], ['ITM-00012', 'abc-9', 'Spare seal kit ABC'],
  ['', 'N/A', 'Old pipe wrench 24in'], ['', 'N/A', 'Old pipe wrench 18in']];   // the oldest rows have no Item ID yet (live, 1 Nov 2026)
const LINES = [
  { itemNo: 'N/A', name: '1-torch; hand; cutting' }, { itemNo: 'N/A', name: 'TORCH; HAND; CUTTING' }, { itemNo: 'N/A', name: '1-torch; hand; cutting', itemId: 'ITM-00001' },
  { itemNo: 'N/A', name: 'Mobile welding rig', itemId: 'ITM-00001' }, { itemNo: 'cp872', name: 'anything' }, { itemNo: '00123', name: 'x' },
  { itemNo: 'TBA', name: 'Hydraulic hose 2m' }, { itemNo: 'DUP-1', name: 'Gauge, digital' }, { itemNo: 'DUP-1', name: 'Gauge' }, { itemNo: 'ZX-1', name: 'Laser kit' },
  { itemNo: '', name: '' }, { itemNo: 'N/A', name: 'Brand new thing' }, { itemNo: 'ABC-9', name: 'Spare seal kit' }, { itemNo: 'N/A', name: 'x', itemId: 'ITM-09999' },
  { itemNo: 'N/A', name: 'cutting torch tip', pick: 'ITM-00003' }, { itemNo: 'N/A', name: 'x', pick: 'new' }, { itemNo: 'N/A', name: 'x', pick: 'ITM-09999' },
  { itemNo: 'CP872', name: 'Impact wrench CP872', itemId: 'ITM-00004' }, { itemNo: 'N/A', name: 'whatever', itemId: 'ITM-00002', trust: true },
  { itemNo: 'tba', name: 'Mobile welding rig' }, { itemNo: '-', name: 'MOBILE  WELDING RIG' },
  { itemNo: 'N/A', name: 'Old pipe wrench 24in' }, { itemNo: 'N/A', name: 'old pipe wrench' }, { itemNo: 'N/A', name: 'x', pick: 'row:14:' + im.imHash('Old pipe wrench 24in') },
  { itemNo: 'N/A', name: 'x', pick: 'row:14:wrong' }];

const c = load(GS, {});
const serverRows = ROWS.map((r, i) => ({ 'Item ID': r[0], 'Item No': r[1], 'Description': r[2], 'Available Balance': i, 'Type': 'Stock', rowIndex: i + 2 }));
const browserRows = ROWS.map((r, i) => ({ itemId: r[0], itemNo: r[1], description: r[2], balance: i, type: 'Stock', rowIndex: i + 2 }));
const sx = c._ibIndex(serverRows, []), bx = im.imIndex(browserRows);
const sid = (r) => (r ? c._ibRowKey(r) : ''), bid = (r) => (r ? im.imRowKey(r) : '');

console.log('\n== the two resolvers agree on every line ==');
LINES.forEach(l => {
  const q = { itemId: l.itemId, itemNo: l.itemNo, name: l.name, pick: l.pick }, o = { trustId: !!l.trust };
  const s = c._ibResolve(sx, q, o), b = im.imResolve(bx, q, o);
  const sa = { row: sid(s.row), how: s.how, suspect: s.suspect || '', cands: (s.candidates || []).map(sid) };
  const ba = { row: bid(b.row), how: b.how, suspect: b.suspect || '', cands: (b.candidates || []).map(bid) };
  ok(JSON.stringify(l) + ' → ' + (sa.row || sa.how), JSON.stringify(sa) === JSON.stringify(ba), [sa, ba]);
});

console.log('\n== and on the small rules ==');
['N/A', 'n/a', 'NA', '', '-', '—', 'TBA', 'tba', 'none', 'None', 'ABC', '0', 'n.a'].forEach(v =>
  ok('placeholder ' + JSON.stringify(v), c._ibPlaceholder(v) === im.imPlaceholder(v), [c._ibPlaceholder(v), im.imPlaceholder(v)]));
ok('a row with no id has the same row key on both sides', c._ibRowKey(serverRows[12]) === im.imRowKey(browserRows[12]) && /^row:14:[0-9a-z]+$/.test(im.imRowKey(browserRows[12])), [c._ibRowKey(serverRows[12]), im.imRowKey(browserRows[12])]);
ok('the same candidates for a name, best first', JSON.stringify(c._ibCandidates(sx, 'torch; hand; cutting', 6).map(sid)) === JSON.stringify(im.imCandidates(bx, 'torch; hand; cutting', 6).map(bid)));
ok('the picker search finds by any word in the code or the name', im.imSearch(browserRows, 'torch cutting', 8).map(bid).join() === 'ITM-00002,ITM-00003,ITM-00011');

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
