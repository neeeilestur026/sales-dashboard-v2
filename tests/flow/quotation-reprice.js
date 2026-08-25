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
 *   2. PRICE ONLY. Quantity is the client's requirement and a rep may have set it deliberately (on
 *      PR-202608-058 the quotation says 18 commissioning days where the request says 20). A refresh
 *      that moved quantity would silently alter the offer, so differences are reported, not applied.
 *
 *   3. THE ARITHMETIC IS THE DOCUMENT'S. The new total is Σ qty × new price using the QUOTATION's
 *      quantities — not the request's — because those quantities are what the document prints.
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
  const price = [], qty = [];
  let oldT = 0, newT = 0;
  rows.forEach((src, n) => {
    const it = qcItems[n], was = N(it.price), now = N(src.finalPrice), q = N(it.qty);
    oldT += q * was; newT += q * now;
    if (Math.abs(was - now) > 0.005) price.push({ n, was, now });
    if (Math.abs(q - N(src.qty)) > 1e-9) qty.push({ n, q, pq: N(src.qty) });
  });
  return { price, qty, oldT: Math.round(oldT * 100) / 100, newT: Math.round(newT * 100) / 100 };
}

// ── the real records, captured from live data ────────────────────────────────────────
const QUO = [
  { itemNo: 'CYGF-BL1500-60P-S', itemName: 'Prime Power：1500kw/1875kva Stand by', qty: 3, price: 33750050 },
  { itemNo: 'DSE8610', itemName: '20GP Containerized Switch gear  6.6kV', qty: 1, price: 16189146.36 },
  { itemNo: 'N/A', itemName: 'Commissioning engineer to the Philippines', qty: 18, price: 309272.73 },
  { itemNo: 'N/A', itemName: 'Operator training at site', qty: 7, price: 154636.36 },
];
const PR = [
  { included: true, itemNo: 'CYGF-BL1500-60P-S', itemName: 'Prime Power：1500kw/1875kva Stand by', qty: 3, finalPrice: 33750050 },
  { included: true, itemNo: 'DSE8610', itemName: '20GP Containerized Switch gear  6.6kV', qty: 1, finalPrice: 18508691.82 },
  { included: true, itemNo: 'N/A', itemName: 'Commissioning engineer to the Philippines', qty: 20, finalPrice: 309272.73 },
  { included: true, itemNo: 'N/A', itemName: 'Operator training at site', qty: 7, finalPrice: 154636.36 },
];

console.log('\n1 · the live case — PR-202608-058 / 2026-449-NE-ACIC-GENSETS REV1');
const p1 = pair(QUO, PR);
ok('pairs cleanly (counts agree, every name matches)', p1.ok, p1);
const d1 = diff(QUO, p1.rows);
eq('  exactly one line is repriced', d1.price.length, 1);
eq('  it is the switchgear (line 2)', d1.price[0].n, 1);
eq('  16,189,146.36 -> 18,508,691.82', d1.price[0].now, 18508691.82);
eq('  one quantity differs', d1.qty.length, 1);
eq('  and it is REPORTED, not applied (18 stays 18)', QUO[2].qty, 18);
eq('  old total uses the quotation quantities', d1.oldT, 3 * 33750050 + 16189146.36 + 18 * 309272.73 + 7 * 154636.36);
eq('  delta', Math.round((d1.newT - d1.oldT) * 100) / 100, 2319545.46);

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
eq('no price changes', d3.price.length, 0);
eq('no quantity noise', d3.qty.length, 0);
eq('total unchanged', d3.newT, d3.oldT);

console.log('\n4 · the source still implements these rules');
const src = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-quote-configurator.js'), 'utf8');
ok('qcPairWithPr exists', /function qcPairWithPr\(/.test(src));
ok('  it filters on included', /\.filter\(i => i && i\.included\)/.test(src));
ok('  it compares counts', /included\.length !== qcItems\.length/.test(src));
ok('  it corroborates by name', /Refusing to reprice by position alone/.test(src));
ok('qcRefreshPricesFromPR exists', /async function qcRefreshPricesFromPR\(/.test(src));
ok('  it only ever writes price', /qcItems\[h\.n\]\.price = h\.now;/.test(src));
ok('  it never writes qty', !/qcItems\[[^\]]*\]\.qty\s*=\s*(?!.*lineKey)/.test(
     src.slice(src.indexOf('async function qcRefreshPricesFromPR'),
               src.indexOf('function qcSyncRefreshBtn'))));
ok('  it requires edit mode and a PR', /qcMode !== 'edit' \|\| !qcQuotationNo \|\| !qcEditPrNo/.test(src));
ok('the button is hidden off the edit-with-PR path', /const on = qcMode === 'edit' && !!qcQuotationNo && !!qcEditPrNo && !qcFromPr;/.test(src));
ok('the fully-quoted banner offers the refresh', /qcOpenAndRefresh/.test(src));
ok('qcEditPrNo is cleared on reset', /qcEditPrNo = '';\s*\/\/ A251/.test(src));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
