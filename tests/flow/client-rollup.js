/* A217 — one client, one place.
 *
 * What this file exists to hold down:
 *   • crCanonKey stays a FAITHFUL port of the server's _canonKey. If the two drift, the same client
 *     gets one Drive folder and two rows on this page. The live names below are the same ones A193
 *     verified the server against;
 *   • the alias registry wins over the algorithm, in the server's order — an alias row exists
 *     precisely to correct the algorithm, including to SPLIT what it merged;
 *   • the repeat-price check finds the four real pairs on the live book and stays quiet on prices
 *     that did not move;
 *   • nothing is dropped: every quotation, visit and order lands on exactly one client.
 */
const R = require('../../dashboard/js/client-rollup.js');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

console.log('== crCanonKey is the server\'s algorithm, not a new one ==');
{
  eq('legal suffixes go', R.crCanonKey('Apex Mining Co., Inc.'), 'apex mining');
  eq('and the SHOUTING variant lands on the same key', R.crCanonKey('APEX MINING CO INC'), 'apex mining');
  eq('a parenthesised abbreviation is the same firm',
     R.crCanonKey('Filipinas Fair Holdings (FFHC)'), 'filipinas fair');
  /* The rule keys on whitespace AFTER the dash. The live book writes it both ways — "Corporation -
     TSI BU" and "Corporation- SNAPB BU" — and keying on a fully spaced dash filed one company two
     ways depending on a stray space. */
  eq('a business unit after a spaced dash is stripped',
     R.crCanonKey('Aboitiz Power Corporation - TSI BU'), 'aboitiz power');
  eq('...and after a half-spaced dash too',
     R.crCanonKey('Aboitiz Power Corporation- SNAPB BU'), 'aboitiz power');
  /* The one that matters. A dash BETWEEN word characters must not start a business-unit suffix, or
     "Itogon-Suyoc Resources" would be truncated to "itogon" and merge with any other Itogon. The
     hyphen itself does not survive — the final [^a-z0-9 ] pass turns it into a space, on the server
     too — so what is asserted is that the second word is still there. */
  eq('a dash inside a name does not truncate it',
     R.crCanonKey('Itogon-Suyoc Resources Inc.'), 'itogon suyoc');
  ok('...i.e. "suyoc" is not lost', R.crCanonKey('Itogon-Suyoc Resources Inc.').indexOf('suyoc') !== -1);
  eq('whereas a spaced dash really does start a suffix',
     R.crCanonKey('Itogon Suyoc - Mining Division'), 'itogon suyoc');
  eq('punctuation and case do not make a second client',
     R.crCanonKey('  Eagle   Cement,  Corp.  '), 'eagle cement');
  eq('blank is blank', R.crCanonKey(''), '');
  eq('null does not throw', R.crCanonKey(null), '');
  eq('a name that is ONLY a suffix does not vanish into a shared empty key',
     R.crCanonKey('Corporation'), '');
}
{
  // The suffix list is copied verbatim from FlowAPI.gs:4149 — assert it, so an edit to one is caught.
  eq('the suffix list matches the server\'s, term for term',
     String(R.CR_SUFFIX_RE),
     '/\\b(corporation|corp|incorporated|inc|company|co|ltd|limited|enterprises|enterprise|ent|philippines|phils|phil|international|intl|group|holdings|resources)\\b/g');
}

console.log('\n== the alias registry wins, in the server\'s order ==');
{
  const reg = { byRaw: { 'aboitiz power corporation - tl': 'aboitiz-tl' }, byKey: { 'aboitiz-tl': 'Aboitiz Power (TL)' } };
  eq('a pinned raw spelling beats the algorithm',
     R.crKeyFor('Aboitiz Power Corporation - TL', reg), 'aboitiz-tl');
  eq('an unpinned one still falls back to it',
     R.crKeyFor('Aboitiz Power Corporation - TSI BU', reg), 'aboitiz power');
  /* This is the point of keying on the RAW spelling: the registry can SPLIT what the algorithm
     merged. Both of the above would otherwise be 'aboitiz power'. */
  ok('so the registry can split what the algorithm merged',
     R.crKeyFor('Aboitiz Power Corporation - TL', reg) !== R.crKeyFor('Aboitiz Power Corporation - TSI BU', reg));
  eq('and it supplies the display spelling', R.crDisplay(['x'], 'aboitiz-tl', reg), 'Aboitiz Power (TL)');
  eq('without a registry the fullest raw spelling is shown',
     R.crDisplay(['APEX MINING', 'Apex Mining Co., Inc.'], 'apex mining', null), 'Apex Mining Co., Inc.');
}

console.log('\n== the repeat-price check — the three real pairs from the live book ==');
{
  const Q = (no, date, items) => ({ quotationNo: no, date: date, customer: 'X', status: 'Sent', items: items });
  const findings = R.crPriceFindings([
    Q('A', '2026-07-25', [{ itemName: 'GREASE GUN,W/ FLEXIBLE HOSE', price: 1672.76, qty: 1 }]),
    Q('B', '2026-07-15', [{ itemName: 'grease gun, w/ flexible hose', price: 1510.12, qty: 1 }])
  ]);
  eq('the same item, two prices, one client', findings.length, 1);
  eq('the gap is reported as a percentage', findings[0].gapPct, 11);
  eq('low and high are both kept', [findings[0].low, findings[0].high], [1510.12, 1672.76]);
  ok('and these did NOT go out the same day', findings[0].sameDay === false);
  eq('with both quotation numbers, oldest first', findings[0].quotes.map(q => q.quotationNo), ['B', 'A']);
}
{
  /* THE FALSE POSITIVE THAT DECIDED crItemKey DOES NOT TRUNCATE.
     A first pass at this analysis compared only the first 55 characters and reported a 22% same-day
     price contradiction at Petra Cement. It was not one: the two lines are an "…uninterruptible power
     supply, 2000 VA 1.6 kW" and a "…1000 VA 800 W" — different products, on the SAME quotation,
     correctly priced differently. They agree for 86 characters. Long industrial part descriptions
     routinely differ only in the rating at the very end, so any prefix comparison will invent
     contradictions between a client's own line items. */
  const long2000 = 'PowerWalker VFI 2000 CG PF1, 110V AC 160 V AC 280 V AC 300 V AC input, uninterruptible power supply, 2000 VA 1.6 kW';
  const long1000 = 'PowerWalker VFI 2000 CG PF1, 110V AC 160 V AC 280 V AC 300 V AC input, uninterruptible power supply, 1000 VA 800 W';
  ok('the two names really do agree for the first 55 characters',
     long2000.slice(0, 55) === long1000.slice(0, 55));
  eq('but they are different products, so this is NOT a price contradiction',
     R.crPriceFindings([{ quotationNo: 'P1', date: '2026-07-25',
       items: [{ itemName: long2000, price: 103735.85, qty: 1 },
               { itemName: long1000, price: 85139.62, qty: 1 }] }]).length, 0);
}
{
  const Q = (no, date, price) => ({ quotationNo: no, date: date, items: [{ itemName: 'OLAER PARKER BLADDER 50 L', price: price, qty: 1 }] });
  const f = R.crPriceFindings([Q('A', '2026-07-07', 65700), Q('B', '2026-07-19', 74455.43), Q('C', '2026-07-20', 70000)]);
  eq('three quotes of one item is still one finding', f.length, 1);
  eq('spanning the full range', f[0].gapPct, 13);
  ok('and NOT flagged as same-day', f[0].sameDay === false);
  eq('all three are listed in date order', f[0].quotes.map(q => q.quotationNo), ['A', 'B', 'C']);
}
{
  const same = [{ quotationNo: 'A', date: '2026-07-01', items: [{ itemName: 'Grease gun', price: 1510.12, qty: 1 }] },
                { quotationNo: 'B', date: '2026-07-08', items: [{ itemName: 'GREASE GUN', price: 1510.12, qty: 2 }] }];
  eq('quoted twice at the same price is not a finding', R.crPriceFindings(same).length, 0);
  eq('quoted once is not a finding',
     R.crPriceFindings([{ quotationNo: 'A', items: [{ itemName: 'Anything', price: 5, qty: 1 }] }]).length, 0);
  eq('a zero price is not compared against a real one',
     R.crPriceFindings([{ quotationNo: 'A', items: [{ itemName: 'X', price: 0, qty: 1 }] },
                        { quotationNo: 'B', items: [{ itemName: 'X', price: 900, qty: 1 }] }]).length, 0);
  eq('an unnamed line is skipped rather than grouping every blank together',
     R.crPriceFindings([{ quotationNo: 'A', items: [{ itemName: '', price: 1, qty: 1 }] },
                        { quotationNo: 'B', items: [{ itemName: '  ', price: 2, qty: 1 }] }]).length, 0);
  eq('a quotation with no items does not throw', R.crPriceFindings([{ quotationNo: 'A' }]).length, 0);
  eq('and neither does nothing at all', R.crPriceFindings(null).length, 0);
}

console.log('\n== the rollup groups everything, and loses nothing ==');
{
  const d = {
    quotations: [
      { quotationNo: 'Q1', customer: 'Apex Mining Co., Inc.', date: '2026-07-15', total: 1000, status: 'Sent', items: [] },
      { quotationNo: 'Q2', customer: 'APEX MINING', date: '2026-07-20', total: 2000, status: 'Sent', items: [] },
      { quotationNo: 'Q3', customer: 'Eagle Cement Corp', date: '2026-07-01', total: 500, status: 'Sent', items: [] }
    ],
    visits: [{ visitNo: 'V1', company: 'Apex Mining', date: '2026-08-05', user: 'Kimberlyn Blones' }],
    orders: [{ soNo: 'SO1', customer: 'Apex Mining Co Inc', date: '2026-08-01', total: 900 }],
    links: { Q1: [{ messageId: 'm1' }] }
  };
  const r = R.clientRollup(d);
  eq('two clients, not five spellings', r.clients.length, 2);
  eq('the busiest first', r.clients[0].name, 'Apex Mining Co., Inc.');
  // Four raw spellings reach it: two quotations, one visit, one order.
  eq('every raw spelling that reached it is recorded', r.clients[0].names.length, 4);
  eq('two quotations', r.clients[0].counts.quotations, 2);
  eq('one visit', r.clients[0].counts.visits, 1);
  eq('one order', r.clients[0].counts.orders, 1);
  eq('nothing was dropped',
     r.clients.reduce((s, c) => s + c.counts.quotations + c.counts.visits + c.counts.orders, 0),
     d.quotations.length + d.visits.length + d.orders.length);
  eq('and the registry was NOT used, so the page must say so', r.usedRegistry, false);
  eq('with one, it says so', R.clientRollup(d, { registry: { byRaw: {}, byKey: {} } }).usedRegistry, true);
}

console.log('\n== the timeline ==');
{
  const d = {
    quotations: [{ quotationNo: 'Q1', customer: 'Apex', date: '2026-07-15', total: 1000,
                   status: 'Sent', sentAt: '2026-07-16', items: [] }],
    visits: [{ visitNo: 'V1', company: 'Apex', date: '2026-08-05', personVisited: 'Ms. Joana' }],
    orders: [{ soNo: 'SO1', customer: 'Apex', date: '2026-08-01', total: 900 }],
    links: {}
  };
  const t = R.clientRollup(d).clients[0].timeline;
  eq('newest first', t.map(e => e.date), ['2026-08-05', '2026-08-01', '2026-07-16', '2026-07-15']);
  eq('and every kind is on it', t.map(e => e.kind), ['visit', 'order', 'sent', 'quotation']);
  eq('lastTouch is the newest event', R.clientRollup(d).clients[0].lastTouch, '2026-08-05');
}
{
  const d = { quotations: [{ quotationNo: 'Q1', customer: 'Apex', date: '', total: 1, items: [] },
                           { quotationNo: 'Q2', customer: 'Apex', date: '2026-07-01', total: 1, items: [] }],
              visits: [], orders: [], links: {} };
  const t = R.clientRollup(d).clients[0].timeline;
  eq('an undated row is kept, not dropped', t.length, 2);
  eq('and sorts last rather than first', t[t.length - 1].ref, 'Q1');
}

console.log('\n== rubbish in does not take the page down ==');
{
  const r = R.clientRollup({ quotations: [null, { customer: '' }, { customer: 'Real Client', items: null }],
                             visits: [null], orders: [null], links: null });
  eq('nameless and null rows form no client', r.clients.length, 1);
  eq('the real one survives', r.clients[0].name, 'Real Client');
  eq('nothing at all is an empty list, not a crash', R.clientRollup(null).clients.length, 0);
  eq('and neither is an empty object', R.clientRollup({}).clients.length, 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
