/* A247 — the AP anomaly banner.
 *
 * Run:  node tests/flow/ap-anomaly-banner.js
 *
 * WHY THIS FILE EXISTS. previewAPAgingAnomalies has existed, worked, been read-only and unsecured —
 * and been wired to NO PAGE AT ALL. Nothing was stopping it being shown; it simply never was.
 *
 * That is how AP-202607-001 carried ₱446,393.80 for 720 USD — an implied ₱619.99/USD against a paid
 * figure of ₱46,393.80 that was correct all along. The row did colour its implied-rate cell red, but
 * a SETTLED payable renders inside the collapsed "Settled payables" block, so ₱400,000 of phantom
 * debt sat behind a fold on the largest number in the book.
 *
 * THE RANKING IS THE POINT, and it is what this file mostly pins. The sweep flags four live rows and
 * they are three different kinds of thing. Showing them as one undifferentiated list would train
 * people to ignore the banner, which is worse than not having it:
 *
 *   TYPO        blocking and not explainable as a fee. Needs a person.
 *   BANK CHARGE paid slightly over on a foreign wire. A219 is explicit that this is a real cost with
 *               nowhere else to sit and must NOT be corrected away — so it must not read as an error.
 *   NOTE        non-blocking. AP-202607-007 is a PHP order whose payable is 12% higher because VAT
 *               was typed onto it; A219 says calling that wrong is overreach.
 *
 * The fixtures below are the REAL shapes returned by the live handler, copied verbatim.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (x === undefined ? '' : '\n         ' + String(x).slice(0, 300))); } };

/* Load just the page module with the handful of globals it uses. It is a browser script with no
   module system, so this is the same vm technique prwload.js and qwload.js use. */
function load(anom) {
  const ctx = {
    console, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
    window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetchFlow: () => Promise.resolve({ data: [] }), postFlow: () => Promise.resolve({}),
    flowEsc: s => String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    flowNum: v => (parseFloat(v) || 0),
    flowMoney: (v, _c) => '₱' + (parseFloat(v) || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    flowDate: s => String(s || '').slice(0, 10),
    requireOversight: () => ({ name: 'T', role: 'accounting' }),
    renderNavbar() {}, renderFlowNav() {}, flowLedgerInjectCss() {},
    setTimeout, clearTimeout, Date, Math, JSON, Object, String, Number, Array, isFinite, parseFloat
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/flow-ap-aging.js'), 'utf8'),
                  ctx, { filename: 'flow-ap-aging.js' });
  /* NOT `this.apAnomalies = …`. A top-level `let` in a vm script lives in LEXICAL scope, not on
     the context object — the same trap gasload.js, qwload.js and prwload.js each document. A
     context property of that name would be a different binding from the one the function reads,
     and the banner would silently render empty. Assigning the bare identifier hits the real one. */
  vm.runInContext('apAnomalies = ' + JSON.stringify(anom) + ';', ctx);
  return ctx;
}

// The live payload, verbatim.
const LIVE = {
  success: true, checked: 11, flagged: 4, blocking: 3, likelyBankCharges: 2,
  bankChargeTotal: 2330.96, overstatedBy: 0,
  data: [
    { apNo: 'AP-202607-001', supplier: 'Aolai Rescue Technology Co.,Ltd', currency: 'USD',
      status: 'Paid', amountFC: 720, amountPHP: 446393.8, paidPHP: 46393.8, impliedRate: 619.99,
      likelyBankCharge: false, bankChargePHP: null, blocking: true,
      why: '₱446393.80 for 720.00 USD implies ₱619.99 per USD. That is outside any real rate.' },
    { apNo: 'AP-202607-005', supplier: 'Power Team Hydraulic Technologies', currency: 'USD',
      status: 'Paid', amountFC: 5035.36, amountPHP: 310429.944, paidPHP: 310895.71, impliedRate: 61.65,
      likelyBankCharge: true, bankChargePHP: 465.77, blocking: true,
      why: 'Paid (₱310895.71) is more than the payable (₱310429.94).' },
    { apNo: 'AP-202607-014', supplier: 'CEJN PRODUCTS FAR EAST PTE LTD', currency: 'SGD',
      status: 'Paid', amountFC: 2493.9, amountPHP: 119083.725, paidPHP: 120948.92, impliedRate: 47.75,
      likelyBankCharge: true, bankChargePHP: 1865.19, blocking: true,
      why: 'Paid (₱120948.92) is more than the payable (₱119083.73).' },
    { apNo: 'AP-202607-007', supplier: 'RS Components Corporation', currency: 'PHP',
      status: 'Paid', amountFC: 27000, amountPHP: 30240, paidPHP: 30240, impliedRate: 1.12,
      likelyBankCharge: false, bankChargePHP: null, blocking: false,
      why: 'This is a PHP purchase order, but the payable is 12.0% above the order total.' }
  ]
};

console.log('== the live book: the typo is named, and named LOUDEST ==');
{
  const html = load(LIVE).apAnomalyBanner();
  ok('the banner renders', html.length > 0);
  ok('it names the payable that is actually wrong', html.includes('AP-202607-001'));
  ok('  with its impossible implied rate', /619\.99/.test(html));
  ok('  and both figures, so the size of the gap is visible',
     html.includes('446,393.80') && html.includes('46,393.80'));
  ok('  in red', /#fef2f2|#991b1b/.test(html));
}

console.log('\n== a bank charge is reported as EXPLAINED, never as an error ==');
{
  /* A219: the charge is OUR cost and must never reduce what the supplier is owed. A banner that
     called these errors would invite somebody to "correct" a real cost out of the books. */
  const html = load(LIVE).apAnomalyBanner();
  ok('both fee rows are named', html.includes('AP-202607-005') && html.includes('AP-202607-014'));
  ok('  with the total', html.includes('2,330.96'));
  ok('  and are told to be left alone', /leave it alone/i.test(html));
  ok('  NOT in the red block',
     html.indexOf('AP-202607-005') > html.indexOf('#fffbeb') - 1200, 'ordering/colour');
  ok('  the red block counts ONE payable, not three', /1 payable\(s\) do not reconcile/.test(html), html.slice(0, 200));
}

console.log('\n== a non-blocking note stays a note ==');
{
  const html = load(LIVE).apAnomalyBanner();
  ok('the VAT row is mentioned', html.includes('AP-202607-007'));
  ok('  quietly — muted, not red or amber',
     /text-muted[^)]*\)[^<]*">\s*AP-202607-007|AP-202607-007/.test(html) && !/#991b1b[^<]*AP-202607-007/.test(html));
}

console.log('\n== after the correction, the typo block disappears ==');
{
  const fixed = JSON.parse(JSON.stringify(LIVE));
  fixed.data = fixed.data.filter(r => r.apNo !== 'AP-202607-001');
  fixed.blocking = 2; fixed.flagged = 3;
  const html = load(fixed).apAnomalyBanner();
  ok('no red "do not reconcile" block', !/do not reconcile/.test(html), html.slice(0, 200));
  ok('  but the bank charges are still reported', html.includes('AP-202607-005'));
}

console.log('\n== it never breaks the ledger ==');
[null, undefined, {}, { success: false }, { success: true, data: [] }, { success: true, data: null },
 { success: true, data: [null] }, { success: true, data: [{}] }].forEach((a, i) => {
  ok('payload ' + i + ' renders without throwing', (() => {
    try { const h = load(a).apAnomalyBanner(); return typeof h === 'string'; }
    catch (e) { return false; }
  })());
});
{
  // A clean book must say nothing at all — a banner that always shows is a banner nobody reads.
  const html = load({ success: true, checked: 11, data: [] }).apAnomalyBanner();
  ok('a clean book renders an EMPTY banner', html === '', JSON.stringify(html));
}

console.log('\n== the page still fetches it best-effort ==');
{
  const src = fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/flow-ap-aging.js'), 'utf8');
  ok('the sweep is fetched', src.includes("fetchFlow('previewAPAgingAnomalies')"));
  ok('  and its failure is caught, so an older backend costs nothing',
     /previewAPAgingAnomalies'\)\.catch\(/.test(src));
  ok('  the banner is rendered above the tables',
     src.indexOf('apAnomalyBanner()') < src.indexOf('Open payables'));
}

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
