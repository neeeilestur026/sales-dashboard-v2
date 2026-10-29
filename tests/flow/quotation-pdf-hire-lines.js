/* A383 — the filed PDF of a hire must carry each line's duration, rate basis and charge kind.
 *
 * Run:  node tests/flow/quotation-pdf-hire-lines.js
 *
 * WHY THIS FILE EXISTS. Neil, 29 Oct 2026: a rental quotation with a 7-day hire read "1 DAY" on the
 * PDF after Finalize. The preview was right and the record was right (Duration 7, Line Total for
 * seven days); only the filed document was wrong. qcSavePdf rebuilds payload.items from the SAVED
 * record (A173), and that rebuild copied qty, price and uom but not chargeKind, rateBasis or
 * duration. The route spans a line by rateBasis (never by uom, A282), so with no basis every line
 * was one rate-unit: the duration cell printed 1 and the amount was one day's. A refundable deposit
 * lost its charge kind the same way, so the document VATed it.
 *
 * This runs the real qcSavePdf against stubs and reads the payload it posts to /flow/quotation-pdf.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-quote-configurator.js'), 'utf8');
const FN = SRC.slice(SRC.indexOf('async function qcSavePdf('), SRC.indexOf('async function qcSyncPhotos('));

/* The record exactly as getQuotations returns it: the hire shape has been in its DTO since A276. */
const HIRE = [
  { itemNo: 'TWHC11', itemName: 'Torque Wrench, 10940 ftlbs', qty: 1, price: 18093.75, uom: 'DAY',
    chargeKind: 'Rental', rateBasis: 'DAY', duration: 7, lineKey: 'k1', optionNo: '' },
  { itemNo: 'PUMP', itemName: 'Electric pump 220/230V', qty: 1, price: 13338.69, uom: 'DAY',
    chargeKind: 'Rental', rateBasis: 'DAY', duration: 7, lineKey: 'k2', optionNo: '' },
  { itemNo: 'MOB', itemName: 'Mobilization', qty: 1, price: 15000, uom: 'LOT',
    chargeKind: 'Mobilization', rateBasis: 'LOT', duration: 0, lineKey: 'k3', optionNo: '' },
  { itemNo: '', itemName: 'Refundable security deposit', qty: 1, price: 20000, uom: 'LOT',
    chargeKind: 'Deposit', rateBasis: 'LOT', duration: 0, lineKey: 'k4', optionNo: '' }
];

async function run(recItems, localItems) {
  let posted = null;
  const ctx = {
    console, JSON, Promise, String, Number, Array, Object, Math, Date, Error,
    qcPhotoLoad: null, qcPhotoFailed: false,
    qcItems: localItems,
    qcPayload: () => ({ customer: 'Philcement Corporation', date: '2026-10-29', discountPct: 0,
                        docType: 'Service', vatOption: 'add', descMode: 'long',
                        doc: { subject: 'RENTAL TOOLS' }, items: [] }),
    document: { getElementById: () => null },
    flowNum: v => parseFloat(v) || 0,
    flowDate: d => String(d || '').slice(0, 10),
    fetchFlow: async () => ({ data: [{ quotationNo: 'Q-1', customer: 'Philcement Corporation',
      date: '2026-10-29', subject: 'RENTAL TOOLS', discountPct: 0, recommendedOption: '',
      layoutJson: '{"v":2}', items: recItems }] }),
    hxAuthHeaders: h => h,
    fetch: async (url, opts) => { posted = { url, body: JSON.parse(opts.body) };
                                  return { ok: true, blob: async () => ({}) }; },
    FileReader: function () { this.readAsDataURL = () => { this.result = 'data:x;base64,QQ=='; this.onload(); }; },
    postFlow: async () => ({ success: true }),
    qcSyncPhotos: async () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(FN + '\nthis.__run = qcSavePdf;', ctx);
  await ctx.__run('Q-1');
  return posted;
}

(async () => {
  console.log('\n1 · a hire rebuilt from the record keeps its duration, basis and charge kind');
  const local = HIRE.map(i => Object.assign({}, i));
  const p = await run(HIRE, local);
  ok('it posts to the quotation PDF route', p && p.url === '/flow/quotation-pdf');
  const it = (p && p.body.items) || [];
  eq('  four lines', it.length, 4);
  eq('  the wrench is 7 days', it[0] && it[0].duration, 7);
  eq('  on a DAY basis', it[0] && it[0].rateBasis, 'DAY');
  eq('  the pump is 7 days', it[1] && it[1].duration, 7);
  eq('  the wrench is a Rental', it[0] && it[0].chargeKind, 'Rental');
  eq('  the deposit stays a Deposit, so the route does not VAT it', it[3] && it[3].chargeKind, 'Deposit');
  eq('  the mobilization keeps its LOT basis', it[2] && it[2].rateBasis, 'LOT');

  console.log('\n2 · the RECORD wins over this browser (A173: build from what was saved)');
  const stale = HIRE.map(i => Object.assign({}, i, { duration: 3 }));
  const p2 = await run(HIRE, stale);
  eq('a stale 3 in the form does not replace the saved 7', p2.body.items[0].duration, 7);

  console.log('\n3 · a record from a backend that does not return the keys falls back to the form');
  const bare = HIRE.map(i => { const o = Object.assign({}, i);
    delete o.chargeKind; delete o.rateBasis; delete o.duration; return o; });
  const p3 = await run(bare, local);
  eq('duration from the form', p3.body.items[0].duration, 7);
  eq('rate basis from the form', p3.body.items[0].rateBasis, 'DAY');
  eq('charge kind from the form', p3.body.items[3].chargeKind, 'Deposit');

  console.log('\n4 · a supply line is unchanged: no basis, nothing to span');
  const supply = [{ itemNo: 'S-1', itemName: 'Bolt', qty: 4, price: 100, uom: 'pc(s)',
    chargeKind: '', rateBasis: '', duration: 0, lineKey: 's1', optionNo: '' }];
  const p4 = await run(supply, supply.map(i => Object.assign({}, i)));
  eq('rate basis blank', p4.body.items[0].rateBasis, '');
  eq('charge kind blank', p4.body.items[0].chargeKind, '');

  console.log('\n5 · the route spans by rateBasis, so the basis is what had to reach it');
  const PY = fs.readFileSync(path.join(__dirname, '../../blueprints/flow.py'), 'utf8');
  ok('flow.py spans with rate_span(it.get("rateBasis"), it.get("duration"))',
     /rate_span\(it\.get\("rateBasis"\), it\.get\("duration"\)\)/.test(PY));
  ok('  and reads chargeKind for the deposit', /it\.get\("chargeKind"\)/.test(PY));

  console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
