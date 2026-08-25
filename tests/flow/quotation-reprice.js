/* A251 — refreshing a quotation's prices from its repriced pricing request.
 *
 * Run:  node tests/flow/quotation-reprice.js
 *
 * WHY THIS FILE EXISTS. Management reprices the REQUEST, never the quotation. Nothing carried the
 * new price into the document the client actually receives, so a repriced request left the rep with
 * two bad options: send the stale figure, or raise a second quotation for the same items. Both were
 * happening — PR-202608-058 already carries two quotations for one set of 12 items.
 *
 * The rules pinned here, because each one is a way to put a wrong number on a client's document:
 *
 *   1. PAIRING IS CORROBORATED, NEVER GUESSED. `itemId` is empty on both sides of this book, so
 *      position is the only key there is — and position alone silently reprices the wrong line the
 *      first time anyone inserts an item. The counts must agree AND every paired line must carry the
 *      same name; if either fails the refresh REFUSES and changes nothing.
 *
 *   2. QUANTITY COMES ACROSS TOO. This shipped price-only first, on the reasoning that a rep might
 *      have set a quantity deliberately. That was wrong, and it is the bug this file now guards:
 *      REV1 of 2026-449-NE-ACIC-GENSETS carried 18 commissioning days against the request's 20,
 *      leaving the client's document PHP 692,770 under the figure the business had agreed. The
 *      request is management's record of the deal — both fields come across.
 *
 *   3. THE ARITHMETIC IS THE REQUEST'S. The new total is Σ new qty × new price, and the old total
 *      Σ old qty × old price, so the delta shown to the rep is the real movement in the offer.
 */
const fs = require('fs');
const path = require('path');

let FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { console.log('  ok   ' + label); }
  else { FAIL++; console.log('  FAIL ' + label + (extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); }
};
const eq = (label, got, want) => ok(label + ' = ' + JSON.stringify(want), got === want, { got, want });

/* The pairing rule, lifted from flow-quote-configurator.js. Kept as a copy on purpose: the source is
   welded to the DOM, and a rule this cheap to restate is cheaper to restate than to stub a document
   for. The source assertion at the bottom is what stops the two drifting apart. */
function pair(qcItems, prItems) {
  const included = (prItems || []).filter(i => i && i.included);
  if (included.length !== qcItems.length) return { ok: false, why: 'count' };
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  for (let n = 0; n < included.length; n++) {
    if (norm(qcItems[n].itemName || qcItems[n].itemNo) !== norm(included[n].itemName || included[n].itemNo)) {
      return { ok: false, why: 'name@' + n };
    }
  }
  return { ok: true, rows: included };
}
const N = v => (v === '' || v == null) ? 0 : (parseFloat(v) || 0);
function diff(qcItems, rows) {
  const hits = [];
  let oldT = 0, newT = 0;
  rows.forEach((src, n) => {
    const it = qcItems[n];
    const wasP = N(it.price), nowP = N(src.finalPrice), wasQ = N(it.qty), nowQ = N(src.qty);
    oldT += wasQ * wasP; newT += nowQ * nowP;
    if (Math.abs(wasP - nowP) > 0.005 || Math.abs(wasQ - nowQ) > 1e-9) hits.push({ n, wasP, nowP, wasQ, nowQ });
  });
  return { hits, oldT: Math.round(oldT * 100) / 100, newT: Math.round(newT * 100) / 100 };
}

// the quotation EXACTLY as it stood before the fix (all 12 lines, live data)
const QUO = [
  { itemNo: "CYGF-BL1500-60P-S", itemName: "Prime Power：1500kw/1875kva Stand by Power: 1650kw/2062kva 40HQ Silent Containerized Generator Set", qty: 3, price: 33750050.0 },
  { itemNo: "DSE8610", itemName: "20GP Containerized Switch gear  6.6kVHV Deep-Sea", qty: 1, price: 16189146.36 },
  { itemNo: "N/A", itemName: "Commissioning engineer to the Philippines", qty: 18, price: 309272.73 },
  { itemNo: "N/A", itemName: "Operator training at site", qty: 7, price: 154636.36 },
  { itemNo: "N/A", itemName: "Single-core C-YJV 6/6kV 150mm² cable", qty: 1, price: 21649.09 },
  { itemNo: "N/A", itemName: "Galvanized trough cable", qty: 1, price: 2319.55 },
  { itemNo: "N/A", itemName: "Single-core control cable", qty: 1, price: 185.56 },
  { itemNo: "N/A", itemName: "Multi-core control cable", qty: 1, price: 773.18 },
  { itemNo: "N/A", itemName: "Shielded communication cable", qty: 1, price: 448.45 },
  { itemNo: "N/A", itemName: "Earthing conductor", qty: 1, price: 1159.77 },
  { itemNo: "N/A", itemName: "GB copper-bonded steel earth rod", qty: 1, price: 43607.45 },
  { itemNo: "N/A", itemName: "Earthing connection fitting set", qty: 1, price: 2938.09 },
];
// the pricing request's included lines, at management's current figures
const PR = [
  { included: true, itemNo: "CYGF-BL1500-60P-S", itemName: "Prime Power：1500kw/1875kva Stand by Power: 1650kw/2062kva 40HQ Silent Containerized Generator Set", qty: 3, finalPrice: 33750050.0 },
  { included: true, itemNo: "DSE8610", itemName: "20GP Containerized Switch gear  6.6kVHV Deep-Sea", qty: 1, finalPrice: 18508691.82 },
  { included: true, itemNo: "N/A", itemName: "Commissioning engineer to the Philippines", qty: 20, finalPrice: 309272.73 },
  { included: true, itemNo: "N/A", itemName: "Operator training at site", qty: 7, finalPrice: 154636.36 },
  { included: true, itemNo: "N/A", itemName: "Single-core C-YJV 6/6kV 150mm² cable", qty: 1, finalPrice: 21649.09 },
  { included: true, itemNo: "N/A", itemName: "Galvanized trough cable", qty: 1, finalPrice: 2319.55 },
  { included: true, itemNo: "N/A", itemName: "Single-core control cable", qty: 1, finalPrice: 185.56 },
  { included: true, itemNo: "N/A", itemName: "Multi-core control cable", qty: 1, finalPrice: 773.18 },
  { included: true, itemNo: "N/A", itemName: "Shielded communication cable", qty: 1, finalPrice: 448.45 },
  { included: true, itemNo: "N/A", itemName: "Earthing conductor", qty: 1, finalPrice: 1159.77 },
  { included: true, itemNo: "N/A", itemName: "GB copper-bonded steel earth rod", qty: 1, finalPrice: 43607.45 },
  { included: true, itemNo: "N/A", itemName: "Earthing connection fitting set", qty: 1, finalPrice: 2938.09 },
];

console.log('\n1 · the live case — PR-202608-058 / 2026-449-NE-ACIC-GENSETS REV1');
const p1 = pair(QUO, PR);
ok('pairs cleanly (counts agree, every name matches)', p1.ok, p1);
const d1 = diff(QUO, p1.rows);
eq('  two lines move', d1.hits.length, 2);
eq('  the switchgear is repriced', d1.hits[0].nowP, 18508691.82);
eq('  commissioning days go 18 -> 20', d1.hits[1].nowQ, 20);
eq('  ...and its price is unchanged', d1.hits[1].nowP, d1.hits[1].wasP);
eq('  old total = old qty x old price', d1.oldT, 124161741.16);
eq('  new total = new qty x new price', d1.newT, 127099832.08);
/* The regression this file exists for: 142,351,811.93 VAT-inclusive is the figure the business
   agreed. Price-only produced 141,659,041.01 — PHP 692,770.92 short. */
eq('  VAT-inc lands on the agreed 142,351,811.93',
   Math.round(d1.newT * 1.12 * 100) / 100, 142351811.93);
ok('  price-only would have been PHP 692,770.92 short',
   Math.abs((d1.newT * 1.12) - 141659041.01 - 692770.92) < 0.05);

console.log('\n2 · pairing REFUSES rather than guessing');
ok('a line removed from the request -> refused',
   !pair(QUO, PR.slice(0, 3)).ok);
ok('an extra included line -> refused',
   !pair(QUO, PR.concat([{ included: true, itemName: 'New line', qty: 1, finalPrice: 5 }])).ok);
const shuffled = PR.map(x => Object.assign({}, x));
shuffled[1] = Object.assign({}, shuffled[1], { itemName: 'Something else entirely' });
ok('a name that no longer agrees -> refused', !pair(QUO, shuffled).ok);
ok('  and it names the offending line', pair(QUO, shuffled).why === 'name@1');
ok('an EXCLUDED line is ignored, not counted',
   pair(QUO, PR.concat([{ included: false, itemName: 'Deferred', qty: 1, finalPrice: 9 }])).ok);

console.log('\n3 · a request that has not moved');
const same = QUO.map((q, n) => Object.assign({ included: true }, PR[n], { finalPrice: q.price, qty: q.qty }));
const d3 = diff(QUO, pair(QUO, same).rows);
eq('nothing moves', d3.hits.length, 0);
eq('total unchanged', d3.newT, d3.oldT);

console.log('\n4 · the source still implements these rules');
const src = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-quote-configurator.js'), 'utf8');
ok('qcPairWithPr exists', /function qcPairWithPr\(/.test(src));
ok('  it filters on included', /\.filter\(i => i && i\.included\)/.test(src));
ok('  it compares counts', /included\.length !== qcItems\.length/.test(src));
ok('  it corroborates by name', /Refusing to reprice by position alone/.test(src));
ok('qcRefreshPricesFromPR exists', /async function qcRefreshPricesFromPR\(/.test(src));
ok('  it writes BOTH price and qty', /qcItems\[h\.n\]\.price = h\.nowP; qcItems\[h\.n\]\.qty = h\.nowQ;/.test(src));
ok('  the confirmation itemises a qty move', /qty ' \+ h\.wasQ \+ ' → ' \+ h\.nowQ/.test(src));
ok('  totals use each side\'s own qty', /oldTotal \+= wasQ \* wasP; newTotal \+= nowQ \* nowP;/.test(src));
ok('  it requires edit mode and a PR', /qcMode !== 'edit' \|\| !qcQuotationNo \|\| !qcEditPrNo/.test(src));
ok('the button is hidden off the edit-with-PR path', /const on = qcMode === 'edit' && !!qcQuotationNo && !!qcEditPrNo && !qcFromPr;/.test(src));
ok('the fully-quoted banner offers the refresh', /qcOpenAndRefresh/.test(src));
ok('qcEditPrNo is cleared on reset', /qcEditPrNo = '';\s*\/\/ A251/.test(src));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
