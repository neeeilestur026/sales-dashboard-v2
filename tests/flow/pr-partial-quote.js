/* A242 — partial quotations from one pricing request.
 *
 * Run:  node tests/flow/pr-partial-quote.js
 *
 * WHY THIS FILE EXISTS. A request with 5 items where only 3 are priced could not be quoted at all:
 * every deferral point in the flow collapsed "later" into "never" — the admin could not forward a
 * partly-sourced request, removing a line from management's engine UN-INCLUDED it from the deal, and
 * createQuotationFromPR carried every included line and then flipped the request to Quoted, which its
 * own comment called "the real invariant". The 2 leftover items had nowhere to exist.
 *
 * The three rules this file pins, because each one is a way to put a wrong number on a document a
 * client receives:
 *
 *   1. QUOTABLE IS DERIVED, NEVER READ. 'Quoted On' is stamped and never cleared, so "can this line
 *      be quoted" is computed from the quotation it names — gone or Cancelled means yes. That is what
 *      makes the write safe: Apps Script cannot write two cells atomically, and a stamp naming a
 *      quotation that was never created reads as quotable, so a half-finished create heals itself
 *      instead of stranding a line nobody can quote.
 *
 *   2. PRICED IS NOT "Final Price > 0". A genuine ₱0 freebie is priced and belongs on the quotation;
 *      a line management deferred is not, and would print at ₱0.00 on the client's copy. Only the
 *      saved breakdown tells them apart.
 *
 *   3. THE MONEY MUST NOT BE COUNTED TWICE. Σ of the two quotations equals the request's priced
 *      value, and no line appears on both.
 *
 * The server helpers are lifted from FlowAPI.gs verbatim and the client mirror is loaded from
 * flow-api.js, then the SAME table is run through both — two copies of a rule is how a screen and a
 * server come to disagree about what a rep may do.
 */
const fs = require('fs');
const path = require('path');
const { load } = require('./prwload.js');

let FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { console.log('  ok   ' + label); }
  else { FAIL++; console.log('  FAIL ' + label + (extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); }
};
const eq = (label, got, want) => ok(label + ' = ' + JSON.stringify(want), got === want, { got, want });

// ── the server, verbatim ─────────────────────────────────────────────────────────────────────────
const GAS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
function lift(name) {
  const a = GAS.indexOf('\nfunction ' + name + '(');
  if (a < 0) throw new Error('no function ' + name + ' in FlowAPI.gs');
  let i = GAS.indexOf('{', a), depth = 0, j = i;
  for (; j < GAS.length; j++) {
    if (GAS[j] === '{') depth++;
    else if (GAS[j] === '}' && --depth === 0) break;
  }
  return GAS.slice(a, j + 1);
}
const _QUOTE_CLOSED = ['Not Pursued', 'Lost', 'Cancelled'];
const _num = v => (Number(String(v == null ? 0 : v).replace(/[^0-9.\-]/g, '')) || 0);
eval(lift('_quoPickForPR'));
eval(lift('_quoAllForPR'));
eval(lift('_prLineQuotable'));
eval(lift('_prPricedLines'));
eval(lift('_prLinePriced'));

// ── the client mirror ────────────────────────────────────────────────────────────────────────────
const ctx = load('2026-08-15');

/* Sanity: _QUOTE_CLOSED and FLOW_Q_CLOSED_STATUSES are two lists of the same three statuses, one per
   side of the wire. If they ever drift, every rule below answers differently in the browser than on
   the server, silently. */
console.log('== the two closed-status lists have not drifted ==');
eq('same members', _QUOTE_CLOSED.slice().sort().join('|'),
   (ctx.FLOW_Q_CLOSED_STATUSES || []).slice().sort().join('|'));

/* ── the table ──────────────────────────────────────────────────────────────────────────────────
   One row per state a line can be in, run through BOTH implementations. */
const QUOTES = {
  'Q-DRAFT':     { 'Quotation No': 'Q-DRAFT',     'Status': 'Draft' },
  'Q-SENT':      { 'Quotation No': 'Q-SENT',      'Status': 'Sent' },
  'Q-APPROVED':  { 'Quotation No': 'Q-APPROVED',  'Status': 'Approved' },
  'Q-CANCELLED': { 'Quotation No': 'Q-CANCELLED', 'Status': 'Cancelled' },
  'Q-LOST':      { 'Quotation No': 'Q-LOST',      'Status': 'Lost' },
  'Q-NOTPUR':    { 'Quotation No': 'Q-NOTPUR',    'Status': 'Not Pursued' },
  'Q-REJECTED':  { 'Quotation No': 'Q-REJECTED',  'Status': 'Rejected' }
};
const QUO_DTO = {};
Object.keys(QUOTES).forEach(k => { QUO_DTO[k] = { quotationNo: k, status: QUOTES[k].Status }; });

const CASES = [
  ['never quoted',                          '',            true],
  ['on a Draft quotation',                  'Q-DRAFT',     false],
  ['on a Sent quotation — the client has it', 'Q-SENT',    false],
  ['on an Approved quotation',              'Q-APPROVED',  false],
  ['on a CANCELLED quotation — we withdrew it, so it is free again', 'Q-CANCELLED', true],
  ['on a LOST quotation — the client decided; that is an ending',    'Q-LOST',      false],
  ['on a Not Pursued quotation — also an ending',                    'Q-NOTPUR',    false],
  ['on a REJECTED quotation — rework on the same document, not free','Q-REJECTED',  false],
  ['naming a quotation that no longer exists',  'Q-DELETED', true],
  ['naming one with padding around it',         '  Q-SENT ', false],
  ['naming nothing but whitespace',             '   ',       true]
];

console.log('\n== rule 1 — quotable is DERIVED from the quotation it names ==');
CASES.forEach(([label, on, want]) => {
  const srv = _prLineQuotable({ 'Quoted On': on }, QUOTES);
  const cli = ctx.flowPrLineQuotable({ quotedOn: on }, QUO_DTO);
  ok(label + ' -> ' + (want ? 'quotable' : 'taken'), srv === want, { got: srv, want });
  ok('  and the browser agrees', cli === srv, { server: srv, client: cli });
});

console.log('\n== rule 2 — priced is NOT "Final Price > 0" ==');
{
  const hdr = { 'Priced Items JSON': JSON.stringify([
    { line: 1, finalPrice: 1000 },
    { line: 2, finalPrice: 0 },          // a real freebie: management priced it AT zero
    { line: 4, finalPrice: 250 }
  ]) };
  const rec = { pricedItemsJson: hdr['Priced Items JSON'] };
  const p = _prPricedLines(hdr), pc = ctx.flowPrPricedLines(rec);
  ok('the breakdown is recognised', p.has === true && pc.has === true);
  eq('a priced line', _prLinePriced({ 'Line': 1, 'Final Price': 1000 }, p), true);
  eq('a ₱0 FREEBIE is priced — it belongs on the quotation',
     _prLinePriced({ 'Line': 2, 'Final Price': 0 }, p), true);
  eq('  and the browser agrees',
     ctx.flowPrLinePriced({ line: 2, finalPrice: 0 }, pc), true);
  eq('a DEFERRED line is not priced — it would print at ₱0.00',
     _prLinePriced({ 'Line': 3, 'Final Price': 0 }, p), false);
  eq('  and the browser agrees',
     ctx.flowPrLinePriced({ line: 3, finalPrice: 0 }, pc), false);

  /* Rows written before the breakdown column existed have none at all. Falling back to Final Price
     is the only signal there is, and it must not read every legacy line as deferred. */
  const none = _prPricedLines({ 'Priced Items JSON': '' });
  const noneC = ctx.flowPrPricedLines({});
  ok('no breakdown at all is reported as such', none.has === false && noneC.has === false);
  eq('  legacy line with a price falls back to priced',
     _prLinePriced({ 'Line': 9, 'Final Price': 500 }, none), true);
  eq('  legacy line at zero falls back to unpriced',
     _prLinePriced({ 'Line': 9, 'Final Price': 0 }, none), false);
  eq('  and the browser agrees on both',
     String(ctx.flowPrLinePriced({ line: 9, finalPrice: 500 }, noneC)) + '/' +
     String(ctx.flowPrLinePriced({ line: 9, finalPrice: 0 }, noneC)), 'true/false');

  // Malformed JSON must not throw on a page a rep is standing in front of.
  ok('rubbish JSON does not throw', (() => {
    try { _prPricedLines({ 'Priced Items JSON': '{not json' }); ctx.flowPrPricedLines({ pricedItemsJson: '{' }); return true; }
    catch (e) { return false; }
  })());
}

console.log('\n== _quoAllForPR — all of them, live first, and _quoPickForPR still picks one ==');
{
  const rows = [
    { 'PR No': 'PR-1', 'Quotation No': 'Q-A', 'Status': 'Cancelled' },
    { 'PR No': 'PR-1', 'Quotation No': 'Q-B', 'Status': 'Sent' },
    { 'PR No': 'PR-1', 'Quotation No': 'Q-C', 'Status': 'Draft' },
    { 'PR No': 'PR-2', 'Quotation No': 'Q-D', 'Status': 'Draft' }
  ];
  eq('all three, live before retired',
     _quoAllForPR('PR-1', rows).map(q => q['Quotation No']).join(','), 'Q-B,Q-C,Q-A');
  eq('a request with none', _quoAllForPR('PR-9', rows).length, 0);
  /* The reason this helper exists rather than a wider _quoPickForPR: the picker must keep answering
     exactly as it does today, because 16 surfaces read its single answer. */
  eq('the picker is unchanged — last live wins',
     _quoPickForPR(_quoAllForPR('PR-1', rows))['Quotation No'], 'Q-C');
}

console.log('\n== rule 3 — the split, and the money ==');
{
  /* The case the whole feature exists for: 5 items, 3 priced. */
  const rec = {
    prNo: 'PR-202608-001',
    pricedItemsJson: JSON.stringify([{ line: 1 }, { line: 2 }, { line: 3 }]),
    items: [
      { line: 1, included: true, qty: 2, finalPrice: 1000, quotedOn: '' },
      { line: 2, included: true, qty: 1, finalPrice: 5000, quotedOn: '' },
      { line: 3, included: true, qty: 3, finalPrice: 0,    quotedOn: '' },   // priced freebie
      { line: 4, included: true, qty: 1, finalPrice: 0,    quotedOn: '' },   // deferred
      { line: 5, included: true, qty: 4, finalPrice: 0,    quotedOn: '' },   // deferred
      { line: 6, included: false, qty: 9, finalPrice: 999, quotedOn: '' }    // dropped by admin
    ]
  };
  const before = ctx.flowPrRemaining(rec, {});
  eq('included lines', before.included.length, 5);
  eq('  the excluded one is not counted', before.included.some(i => i.line === 6), false);
  eq('ready to quote now', before.ready.map(i => i.line).join(','), '1,2,3');
  eq('  including the ₱0 freebie', before.ready.some(i => i.line === 3), true);
  eq('waiting on a price', before.unpriced.map(i => i.line).join(','), '4,5');
  eq('nothing quoted yet', before.quoted.length, 0);
  eq('value ready to quote', before.readyValue, 7000);

  // Quotation 1 goes out with lines 1-3.
  const after1 = ctx.flowPrRemaining(Object.assign({}, rec, {
    items: rec.items.map(i => (i.line <= 3 ? Object.assign({}, i, { quotedOn: 'Q-1' }) : i))
  }), { 'Q-1': { quotationNo: 'Q-1', status: 'Sent' } });
  eq('after the first quotation, 3 are taken', after1.quoted.map(i => i.line).join(','), '1,2,3');
  eq('  and 2 remain open', after1.open.map(i => i.line).join(','), '4,5');
  eq('  neither is ready — nobody has priced them', after1.ready.length, 0);
  eq('  the money already out', after1.quotedValue, 7000);
  eq('  and none of it is still counted as in play', after1.openValue, 0);

  // Management prices the remainder; quotation 2 goes out with lines 4-5.
  const priced2 = Object.assign({}, rec, {
    pricedItemsJson: JSON.stringify([{ line: 1 }, { line: 2 }, { line: 3 }, { line: 4 }, { line: 5 }]),
    items: rec.items.map(i => {
      if (i.line <= 3) return Object.assign({}, i, { quotedOn: 'Q-1' });
      if (i.line === 4) return Object.assign({}, i, { finalPrice: 2000 });
      if (i.line === 5) return Object.assign({}, i, { finalPrice: 750 });
      return i;
    })
  });
  const mid = ctx.flowPrRemaining(priced2, { 'Q-1': { quotationNo: 'Q-1', status: 'Sent' } });
  eq('the remainder is now ready', mid.ready.map(i => i.line).join(','), '4,5');
  eq('  worth', mid.readyValue, 5000);

  const after2 = ctx.flowPrRemaining(Object.assign({}, priced2, {
    items: priced2.items.map(i => (i.line === 4 || i.line === 5)
      ? Object.assign({}, i, { quotedOn: 'Q-2' }) : i)
  }), { 'Q-1': { quotationNo: 'Q-1', status: 'Sent' },
        'Q-2': { quotationNo: 'Q-2', status: 'Draft' } });
  eq('everything is quoted', after2.open.length, 0);
  ok('  which is what turns the request from Partly Quoted to Quoted', after2.open.length === 0);

  /* THE ARITHMETIC. Two quotations, one request, and not a centavo counted twice. */
  const q1 = 2 * 1000 + 1 * 5000 + 3 * 0;
  const q2 = 1 * 2000 + 4 * 750;
  eq('quotation 1 + quotation 2 = the request', q1 + q2, 7000 + 5000);
  eq('  and that is what the helper reports as quoted', after2.quotedValue, q1 + q2);
  const lines = after2.quoted.map(i => i.line);
  eq('  no line appears twice', new Set(lines).size, lines.length);

  /* Cancel quotation 1 and its three lines come back — the A227 rule, per line this time. */
  const voided = ctx.flowPrRemaining(Object.assign({}, priced2, {
    items: priced2.items.map(i => (i.line === 4 || i.line === 5)
      ? Object.assign({}, i, { quotedOn: 'Q-2' }) : i)
  }), { 'Q-1': { quotationNo: 'Q-1', status: 'Cancelled' },
        'Q-2': { quotationNo: 'Q-2', status: 'Draft' } });
  eq('cancelling the first quotation frees its lines',
     voided.open.map(i => i.line).join(','), '1,2,3');
  eq('  and quotation 2 still holds its own', voided.quoted.map(i => i.line).join(','), '4,5');
}

console.log('\n== nothing here throws on rubbish ==');
[null, undefined, {}, { items: null }, { items: [null] }, { pricedItemsJson: '[]' }].forEach((r, i) => {
  ok('input ' + i + ' does not throw', (() => {
    try { ctx.flowPrRemaining(r, null); return true; } catch (e) { return false; }
  })());
});

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
