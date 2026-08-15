/* A226 — the purchase-request worklist: what the rep does next, held down.
 *
 * A rep raises a request and loses sight of it while it sits in other people's queues. Seven live
 * requests are at "Returned to Sales" — priced, verified, waiting on the rep — and nothing said so.
 *
 * What this file exists to hold down:
 *
 *   • EVERY REQUEST LANDS IN EXACTLY ONE GROUP and nothing is dropped. A tracker that silently loses
 *     rows is worse than the list it replaces, and 45% of this book is imported history that must be
 *     excluded VISIBLY rather than quietly;
 *   • the ordering judgement: the rep's own move outranks chasing somebody else, and chases run
 *     latest-stage-first. That inverts the naive "oldest first" and is the whole value of the list;
 *   • BOTH LIVE DATE FORMATS age correctly. 173 rows are ISO and 142 are the JavaScript toString the
 *     import left behind ('Mon Jun 29 2026 16:44:00 GMT+0800 …'). A parser that only knows ISO would
 *     silently mark 142 requests undateable;
 *   • `quotation-gone` fires on a quotation that NO LONGER EXISTS, not on a missing number. Measured
 *     against the live book: 0 Quoted requests lack a number, but 15 name one that has since been
 *     deleted or renamed. That is the case worth surfacing, and the plan had it the other way round;
 *   • an unpriced request reports `priced:false` rather than ₱0.00 — the A215 rule about never
 *     stating a figure nobody agreed;
 *   • THE LIVE RECONCILE. Group counts must add back to the status counts of whatever snapshot is
 *     present.
 *
 * A242 — the reconcile was written against A226's book and froze its four totals at 315. The book
 * grows, so those assertions could only ever pass while the snapshot was ABSENT and the whole block
 * skipped; the moment a fresh snapshot appeared they failed on 342 without a single thing being
 * wrong. They now derive the total from the snapshot itself. What is actually being asserted is
 * unchanged and is the only thing worth asserting: every request lands in exactly one group, the
 * groups sum to the whole, and each status's rows land in the steps that status can produce — all
 * true at any size of book.
 */
const path = require('path');
const fs = require('fs');
const { load } = require('./prwload.js');

const TODAY = '2026-08-11';
const ctx = load(TODAY);
const {
  PRW_STEPS, PRW_GROUPS, PRW_DEFAULTS, PRW_LANES, PRW_LANE_LABEL,
  pricingRequestWorklistStep, pricingRequestWorklist, pricingRequestWorklistByRep,
  pricingRequestWorklistBoard, prwConcentration,
  prValue, prwAge, qwOverdue, qwAgo
} = ctx;

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** A request `n` days before TODAY, in whichever live date format is asked for. */
function daysAgo(n, fmt) {
  const d = new Date(Date.UTC(2026, 7, 11) - n * 86400000);
  if (fmt === 'js') {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const W = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return W[d.getUTCDay()] + ' ' + M[d.getUTCMonth()] + ' ' + String(d.getUTCDate()).padStart(2, '0') +
           ' ' + d.getUTCFullYear() + ' 09:30:00 GMT+0800 (Standard na Oras sa Pilipinas)';
  }
  return d.toISOString().replace('T', 'T').slice(0, 10) + 'T01:00:00.000Z';
}
const PR = (o) => Object.assign({
  prNo: 'PR-X', customer: 'Acme', status: 'Requested', date: daysAgo(1),
  salesperson: 'Kimberlyn Blones', items: [], quotationNo: '', quotationNoSource: ''
}, o);
const step = (pr, q, links) => pricingRequestWorklistStep(pr, links || [], q || null, {}, TODAY);

console.log('== the step table is coherent — checked before any behaviour ==');
{
  const keys = Object.keys(PRW_STEPS);
  ok('every step names a real group',
     keys.every(k => PRW_GROUPS.indexOf(PRW_STEPS[k].group) !== -1));
  eq('priorities are unique', keys.length, new Set(keys.map(k => PRW_STEPS[k].pri)).size);
  eq('priorities are 0..n-1 with no gaps',
     keys.map(k => PRW_STEPS[k].pri).sort((a, b) => a - b), keys.map((_, i) => i));
  ok('every "now" step gives the rep a verb',
     keys.filter(k => PRW_STEPS[k].group === 'now').every(k => !!PRW_STEPS[k].verb));
  ok('no "waiting" or "done" step gives a verb — it is somebody else\'s move',
     keys.filter(k => PRW_STEPS[k].group !== 'now').every(k => !PRW_STEPS[k].verb));
  ok('quote is first — the rep\'s own move outranks every chase', PRW_STEPS.quote.pri === 0);
  ok('chases run LATEST STAGE FIRST (verify < pricing < sourcing)',
     PRW_STEPS['chase-verify'].pri < PRW_STEPS['chase-pricing'].pri &&
     PRW_STEPS['chase-pricing'].pri < PRW_STEPS['chase-admin'].pri);
  ok('unknown is waiting — never work, never finished', PRW_STEPS.unknown.group === 'waiting');
  ok('migrated is done and silent', PRW_STEPS.migrated.group === 'done' && !PRW_STEPS.migrated.verb);
  ok('there is no snooze step — a PR sits in someone else\'s queue',
     keys.every(k => k.indexOf('snooz') === -1));

  /* `hands` — the second axis, added after the live data showed `group` alone was not enough. */
  ok('every step says whose move is next',
     keys.every(k => ['you', 'them', 'nobody', 'unclear'].indexOf(PRW_STEPS[k].hands) !== -1));
  ok('a step the rep can finish alone always gives them a verb',
     keys.filter(k => PRW_STEPS[k].hands === 'you').every(k => !!PRW_STEPS[k].verb));
  ok('nothing "done" asks anybody to move',
     keys.filter(k => PRW_STEPS[k].group === 'done').every(k => PRW_STEPS[k].hands === 'nobody'));
  ok('every chase is somebody else\'s move, by definition',
     keys.filter(k => k.indexOf('chase-') === 0).every(k => PRW_STEPS[k].hands === 'them'));
  ok('unknown claims nothing about whose move it is',
     PRW_STEPS.unknown.hands === 'unclear');
  eq('every lane has a label', PRW_LANES.filter(l => !PRW_LANE_LABEL[l]), []);
}

console.log('\n== both live date formats age identically ==');
{
  /* 173 rows are ISO and 142 are the JavaScript toString the import left. A parser that only knew
     ISO would mark 142 requests undateable and drop them all into `no-date`. */
  [0, 1, 3, 10, 45].forEach(n => {
    eq('ISO ' + n + ' days ago', prwAge(PR({ date: daysAgo(n) }), TODAY), n);
    eq('  JS  ' + n + ' days ago', prwAge(PR({ date: daysAgo(n, 'js') }), TODAY), n);
  });
  eq('an unreadable date is null, not 0', prwAge(PR({ date: 'sometime last year' }), TODAY), null);
  eq('a blank date is null', prwAge(PR({ date: '' }), TODAY), null);
  eq('  and that becomes no-date, never sorted as fresh',
     step(PR({ date: '' })).step, 'no-date');
  ok('  no-date is WORK, not waiting — somebody has to look at it',
     PRW_STEPS['no-date'].group === 'now');
}

console.log('\n== every live status maps to a step ==');
{
  const cases = [
    ['Requested',        1,  'wait-sourcing'],
    ['Requested',        9,  'chase-admin'],
    ['Sourcing',         1,  'wait-sourcing'],
    ['Sourcing',         9,  'chase-admin'],
    ['For Mgmt Pricing', 1,  'wait-pricing'],
    ['For Mgmt Pricing', 9,  'chase-pricing'],
    ['Mgmt Priced',      1,  'wait-verify'],
    ['Mgmt Priced',      9,  'chase-verify'],
    ['Migrated',         500,'migrated']
  ];
  cases.forEach(([st, age, want]) =>
    eq(st.padEnd(17) + ' at ' + String(age).padStart(3) + ' days', step(PR({ status: st, date: daysAgo(age) })).step, want));

  ['', 'Verifying', 'Something New'].forEach(st =>
    eq('unrecognised ' + JSON.stringify(st) + ' → unknown (waiting)', step(PR({ status: st })).step, 'unknown'));

  eq('Returned to Sales → quote, at 1 day',
     step(PR({ status: 'Returned to Sales', date: daysAgo(1) })).step, 'quote');
  eq('Returned to Sales → quote, at 400 days too — age never demotes it',
     step(PR({ status: 'Returned to Sales', date: daysAgo(400) })).step, 'quote');
  ok('  and it is the top priority in the whole table',
     step(PR({ status: 'Returned to Sales' })).pri === 0);
}

console.log('\n== the thresholds are the boundary, and they come from FlowSettings ==');
{
  const at = (st, n, cfg) => pricingRequestWorklistStep(
    PR({ status: st, date: daysAgo(n) }), [], null, cfg || {}, TODAY);
  eq('sourcing at exactly the threshold is still waiting',
     at('Sourcing', PRW_DEFAULTS.prSourcingDays).step, 'wait-sourcing');
  eq('  one day past it is a chase',
     at('Sourcing', PRW_DEFAULTS.prSourcingDays + 1).step, 'chase-admin');
  eq('  and overdueBy counts only the excess',
     at('Sourcing', PRW_DEFAULTS.prSourcingDays + 4).overdueBy, 4);
  eq('a FlowSettings override moves the boundary',
     at('Sourcing', 5, { prSourcingDays: 30 }).step, 'wait-sourcing');
  eq('  verification is the shortest fuse by default',
     PRW_DEFAULTS.prVerifyDays < PRW_DEFAULTS.prSourcingDays, true);
}

console.log('\n== Quoted: the four outcomes, and the one that is work ==');
{
  const Q = (status) => ({ quotationNo: 'QTN-1', status: status, date: daysAgo(5), total: 100 });
  eq('quoted + the quotation is out with the client → done',
     step(PR({ status: 'Quoted', quotationNo: 'QTN-1' }), Q('Sent')).step, 'quoted');
  eq('quoted + still a draft → send it (the rep has one more move)',
     step(PR({ status: 'Quoted', quotationNo: 'QTN-1' }), Q('Draft')).step, 'send-quote');
  eq('quoted + approved but unsent → send it',
     step(PR({ status: 'Quoted', quotationNo: 'QTN-1' }), Q('Approved')).step, 'send-quote');

  /* THE LIVE DEFECT. 0 Quoted requests lack a number; 15 name a quotation that no longer exists.
     The plan predicted the opposite, so this assertion is the corrected one. */
  const gone = step(PR({ status: 'Quoted', quotationNo: 'QTN-DELETED' }), null);
  eq('quoted + the quotation is GONE → work, named', gone.step, 'quotation-gone');
  ok('  and the message names the number so it can be hunted',
     gone.detail.indexOf('QTN-DELETED') !== -1, gone.detail);
  eq('quoted + no number was ever recorded → also work',
     step(PR({ status: 'Quoted', quotationNo: '' }), null).step, 'quotation-gone');
  ok('  quotation-gone outranks every chase', PRW_STEPS['quotation-gone'].pri < PRW_STEPS['chase-verify'].pri);

  /* "WE COULD NOT CHECK" IS NOT "THERE WAS NOTHING". Only the server resolves the Notes fallback,
     which answers for 41 of the 76 live Quoted requests. Against an older backend a blank means
     unanswerable — and reporting that as work put 30 false alarms in one rep's list on first load. */
  const unver = pricingRequestWorklistStep(
    PR({ status: 'Quoted', quotationNo: '' }), [], null, { prQuotationLinkUnverified: true }, TODAY);
  eq('unverifiable link → quoted, NOT a false alarm', unver.step, 'quoted');
  ok('  and it says why it cannot confirm', /cannot confirm/.test(unver.detail), unver.detail);
  eq('  the flag never rescues a link that is genuinely DEAD',
     pricingRequestWorklistStep(PR({ status: 'Quoted', quotationNo: 'QTN-DELETED' }), [], null,
                                { prQuotationLinkUnverified: true }, TODAY).step, 'quotation-gone');
}

console.log('\n== value: honest about what has not been priced ==');
{
  const items = (arr) => arr.map((x, i) => ({ line: i + 1, qty: x[0], finalPrice: x[1], included: x[2] !== false }));
  eq('two included lines', prValue({ items: items([[2, 100], [3, 50]]) }),
     { value: 350, priced: true, lines: 2, included: 2, open: 2, quoted: 0 });
  eq('an EXCLUDED line is not counted', prValue({ items: items([[2, 100], [99, 999, false]]) }),
     { value: 200, priced: true, lines: 2, included: 1, open: 1, quoted: 0 });
  eq('nothing sourced yet → priced:false, so the UI shows a dash not zero',
     prValue({ items: items([[5, 0], [2, 0]]) }),
     { value: 0, priced: false, lines: 2, included: 2, open: 2, quoted: 0 });
  eq('no items at all', prValue({ items: [] }),
     { value: 0, priced: false, lines: 0, included: 0, open: 0, quoted: 0 });

  /* A242 — money already out on a quotation is not money in play. Without this a partly-quoted
     request reports its whole value here while the quoted half is separately live on the quotation
     board, and every rollup built on prValue double-counts it. */
  const q = (arr) => arr.map((x, i) => ({ line: i + 1, qty: x[0], finalPrice: x[1],
                                          included: true, quotable: x[2] }));
  eq('a quoted line stops counting as in play',
     prValue({ items: q([[2, 100, false], [3, 50, true]]) }),
     { value: 150, priced: true, lines: 2, included: 2, open: 1, quoted: 1 });
  eq('  every line quoted → nothing in play',
     prValue({ items: q([[2, 100, false], [3, 50, false]]) }),
     { value: 0, priced: false, lines: 2, included: 2, open: 0, quoted: 2 });
  /* An older backend sends no `quotable` at all. Undefined must read as OPEN, or every request in
     the book would silently report zero value the moment this shipped. */
  eq('no quotable field → treated as open, exactly as before',
     prValue({ items: items([[2, 100], [3, 50]]) }).value, 350);
  eq('no items key at all', prValue({}),
     { value: 0, priced: false, lines: 0, included: 0, open: 0, quoted: 0 });
  ok('an unpriced request never contributes value to a group total',
     pricingRequestWorklist([PR({ items: items([[5, 0]]) })], {}, {}, {}, TODAY).value.waiting === 0);
}

console.log('\n== the list: nothing dropped, ordered as argued ==');
{
  const list = pricingRequestWorklist([
    PR({ prNo: 'A', status: 'Sourcing',          date: daysAgo(30) }),
    PR({ prNo: 'B', status: 'Returned to Sales', date: daysAgo(1) }),
    PR({ prNo: 'C', status: 'Mgmt Priced',       date: daysAgo(30) }),
    PR({ prNo: 'D', status: 'Migrated',          date: daysAgo(400) }),
    PR({ prNo: 'E', status: 'Requested',         date: daysAgo(1) })
  ], {}, {}, {}, TODAY);
  eq('counts sum to the input', list.counts.total, 5);
  eq('  = now + waiting + done', list.counts.now + list.counts.waiting + list.counts.done, 5);
  eq('order is quote, then verify, then sourcing, then the waits',
     list.rows.map(r => r.prNo), ['B', 'C', 'A', 'E', 'D']);
  ok('the imported one is in done, not now', list.groups.done.map(r => r.prNo).indexOf('D') !== -1);

  // ties break on how overdue, then value
  const tie = pricingRequestWorklist([
    PR({ prNo: 'small', status: 'Sourcing', date: daysAgo(10), items: [{ qty: 1, finalPrice: 10, included: true }] }),
    PR({ prNo: 'big',   status: 'Sourcing', date: daysAgo(10), items: [{ qty: 1, finalPrice: 900, included: true }] })
  ], {}, {}, {}, TODAY);
  eq('same step, same age → the larger request first', tie.rows.map(r => r.prNo), ['big', 'small']);
}

console.log('\n== A227: a revised quotation — cancelled is a withdrawal, not an outcome ==');
{
  const Q = (no, st) => ({ quotationNo: no, status: st, total: 100 });
  const pr = PR({ prNo: 'PR-202608-039', status: 'Quoted', customer: 'EAGLE CEMENT CORPORATION',
                  quotationNo: '2026-440-NE-ECC-JACK_PALLET', quotationNoSource: 'column' });

  /* The live case that prompted this: an approved quotation is found to have an error and is
     retired with Close, and the request behind it is waiting on a corrected one. Reading that as
     "done" leaves a client waiting with nothing on anybody's list. */
  eq('cancelled → the rep has to re-quote',
     step(pr, Q('2026-440-NE-ECC-JACK_PALLET', 'Cancelled')).step, 'quotation-void');
  eq('  and it is the rep\'s own move, not a chase',
     PRW_STEPS['quotation-void'].hands, 'you');
  ok('  the detail names the number and says nothing has replaced it',
     /JACK_PALLET was cancelled/.test(step(pr, Q('2026-440-NE-ECC-JACK_PALLET', 'Cancelled')).detail));

  /* The other two closed statuses are real endings — the CLIENT decided. Nothing to do. */
  eq('lost is genuinely finished',        step(pr, Q('2026-440-NE-ECC-JACK_PALLET', 'Lost')).step, 'quoted');
  eq('not pursued is genuinely finished', step(pr, Q('2026-440-NE-ECC-JACK_PALLET', 'Not Pursued')).step, 'quoted');

  /* Once the replacement carries the PR No, the resolver hands over and this goes quiet by itself. */
  const rev = PR({ prNo: 'PR-202608-039', status: 'Quoted',
                   quotationNo: '2026-440-NE-ECC-JACK_PALLET_REV1', quotationNoSource: 'column' });
  eq('a live replacement puts the request back on "send it"',
     step(rev, Q('2026-440-NE-ECC-JACK_PALLET_REV1', 'Approved')).step, 'send-quote');
  eq('  and once that is sent, done',
     step(rev, Q('2026-440-NE-ECC-JACK_PALLET_REV1', 'Sent')).step, 'quoted');
}

console.log('\n== the four lanes: splitting "now" by whose move it actually is ==');
{
  /* WHY THIS EXISTS. On live data one rep's `now` bucket holds 67 requests, of which 6 are hers to
     complete and 61 are other people's queues gone stale. Headed "needs you now", that number is
     unreadable. The lanes separate the two without moving anything between groups. */
  const list = pricingRequestWorklist([
    PR({ prNo: 'Q1', status: 'Returned to Sales' }),                       // hers: quote
    PR({ prNo: 'C1', status: 'Sourcing',    date: daysAgo(30) }),          // chase
    PR({ prNo: 'C2', status: 'Sourcing',    date: daysAgo(20) }),          // chase
    PR({ prNo: 'C3', status: 'Mgmt Priced', date: daysAgo(30) }),          // chase
    PR({ prNo: 'W1', status: 'Requested',   date: daysAgo(1) }),           // waiting
    PR({ prNo: 'D1', status: 'Migrated',    date: daysAgo(400) })          // done
  ], {}, {}, {}, TODAY);
  const b = pricingRequestWorklistBoard(list);

  eq('lane counts', PRW_LANES.map(k => b.counts[k]), [1, 3, 1, 1]);
  eq('THE INVARIANT — yours + chase is exactly the old `now`',
     b.counts.yours + b.counts.chase, list.counts.now);
  eq('and the four lanes still sum to everything',
     PRW_LANES.reduce((t, k) => t + b.counts[k], 0), list.counts.total);
  eq('waiting and done pass through untouched',
     [b.counts.waiting, b.counts.done], [list.counts.waiting, list.counts.done]);
  eq('the rep\'s own lane holds only steps she can finish alone',
     b.lanes.yours.every(r => PRW_STEPS[r.step].hands === 'you'), true);
  eq('oldest is reported per lane, so a stale chase is visible without opening it',
     b.oldest.chase, 30);

  // A row whose step is somehow unknown to the table must NOT be claimed as the rep's own move.
  const odd = pricingRequestWorklist([PR({ prNo: 'X', status: 'Halfway' })], {}, {}, {}, TODAY);
  const ob = pricingRequestWorklistBoard(odd);
  eq('an unrecognised stage never lands in "yours to do"', ob.counts.yours, 0);

  let threw = false;
  try { pricingRequestWorklistBoard(null); } catch (e) { threw = true; }
  ok('a null list does not throw', !threw);
  eq('  and reports four empty lanes',
     PRW_LANES.map(k => pricingRequestWorklistBoard(null).counts[k]), [0, 0, 0, 0]);
}

console.log('\n== the concentration finding — one sentence, or silence ==');
{
  const many = [];
  for (let i = 0; i < 20; i++) many.push(PR({ prNo: 'S' + i, status: 'Sourcing', date: daysAgo(10 + i) }));
  many.push(PR({ prNo: 'Q1', status: 'Returned to Sales' }));
  const c = prwConcentration(pricingRequestWorklist(many, {}, {}, {}, TODAY));
  eq('names the step that dominates', c.step, 'chase-admin');
  eq('  with the count, the base it is a share of, and the share', [c.n, c.of, c.share], [20, 21, 95]);
  eq('  and the oldest one in it', c.oldest, 29);
  eq('  it is somebody else\'s move, and says so', c.hands, 'them');

  /* SILENCE IS THE DEFAULT. A banner that always fires is wallpaper, so it must stay null whenever
     there is nothing singular to report. */
  eq('a small list says nothing',
     prwConcentration(pricingRequestWorklist([PR({ status: 'Returned to Sales' })], {}, {}, {}, TODAY)), null);
  eq('an evenly spread list says nothing',
     prwConcentration(pricingRequestWorklist([
       PR({ prNo: 'a', status: 'Sourcing',    date: daysAgo(30) }),
       PR({ prNo: 'b', status: 'Sourcing',    date: daysAgo(30) }),
       PR({ prNo: 'c', status: 'Mgmt Priced', date: daysAgo(30) }),
       PR({ prNo: 'd', status: 'Mgmt Priced', date: daysAgo(30) }),
       PR({ prNo: 'e', status: 'Returned to Sales' }),
       PR({ prNo: 'f', status: 'Returned to Sales' })
     ], {}, {}, {}, TODAY)), null);
  eq('a list that is ALL one step says nothing — there is nothing to single out',
     prwConcentration(pricingRequestWorklist(
       [0,1,2,3,4,5].map(i => PR({ prNo: 'z' + i, status: 'Sourcing', date: daysAgo(30) })),
       {}, {}, {}, TODAY)), null);
  eq('an empty list says nothing', prwConcentration(pricingRequestWorklist([], {}, {}, {}, TODAY)), null);
  eq('a null list says nothing, and does not throw', prwConcentration(null), null);
}

console.log('\n== per rep, busiest first ==');
{
  const list = pricingRequestWorklist([
    PR({ prNo: 'K1', salesperson: 'Kimberlyn Blones', status: 'Returned to Sales' }),
    PR({ prNo: 'K2', salesperson: 'Kimberlyn Blones', status: 'Sourcing', date: daysAgo(30) }),
    PR({ prNo: 'G1', salesperson: 'Gerald Lucena',    status: 'Sourcing', date: daysAgo(30) }),
    PR({ prNo: 'N1', salesperson: '',                 requestedBy: '', status: 'Requested' })
  ], {}, {}, {}, TODAY);
  const reps = pricingRequestWorklistByRep(list);
  eq('the rep with most to do is first', reps[0].rep, 'Kimberlyn Blones');
  eq('  with both of them in "now"', reps[0].now.length, 2);
  ok('a request naming nobody is not silently dropped',
     reps.some(r => r.rep === '(nobody named)'));
  eq('every row is accounted for across the reps',
     reps.reduce((t, r) => t + r.now.length + r.waiting.length + r.done.length, 0), 4);
}

console.log('\n== THE LIVE BOOK — reconciled against itself ==');
{
  const SCAN = '/private/tmp/claude-501/-Users-neilestur-Documents-app-CRM-sales-dashboard/' +
               '815863d9-c2cf-4190-a7c3-fb6e0c291a74/scratchpad/scan/getPricingRequests.json';
  if (!fs.existsSync(SCAN)) {
    console.log('  --  live snapshot not present in this checkout; the fixture assertions above stand alone');
  } else {
    const prs = JSON.parse(fs.readFileSync(SCAN, 'utf8')).data;
    const quo = JSON.parse(fs.readFileSync(SCAN.replace('getPricingRequests', 'getQuotations'), 'utf8')).data;
    // Reproduce what the widened getPricingRequests now emits, so the engine sees the real shape.
    const quoByPR = {}, quoByNo = {};
    quo.forEach(q => {
      const k = String(q.prNo || '');
      if (k && !quoByPR[k]) quoByPR[k] = String(q.quotationNo);
      quoByNo[String(q.quotationNo)] = q;
    });
    prs.forEach(p => {
      let qno = quoByPR[String(p.prNo)] || '', src = qno ? 'column' : '';
      if (!qno) {
        const m = String(p.notes || '').match(/Quotation\s+(\S+)/i);
        if (m) { qno = m[1].replace(/[.\s]+$/, ''); src = 'notes'; }
      }
      p.quotationNo = qno; p.quotationNoSource = src;
      p.salesperson = String(p.salesperson || p.requestedBy || '');
    });

    const list = pricingRequestWorklist(prs, {}, quoByNo, {}, TODAY);
    const LIVE = prs.length;                    // A242: the book's size, not a frozen number
    console.log('     live requests in this snapshot:', LIVE);
    eq('every live request is in exactly one group', list.counts.total, LIVE);
    eq('  = now + waiting + done',
       list.counts.now + list.counts.waiting + list.counts.done, LIVE);

    const byStep = {};
    list.rows.forEach(r => { byStep[r.step] = (byStep[r.step] || 0) + 1; });
    console.log('     step distribution:', JSON.stringify(byStep));

    /* Reconcile each status against the steps that status can produce. Counts come from the snapshot
       on both sides, so the shape is asserted and the size is not. */
    const byStatus = {};
    prs.forEach(p => { const s = String(p.status); byStatus[s] = (byStatus[s] || 0) + 1; });
    const sum = (...steps) => steps.reduce((t, s) => t + (byStep[s] || 0), 0);
    eq('  every Migrated lands in done', byStep.migrated || 0, byStatus.Migrated);
    eq('  every Returned to Sales lands in quote', byStep.quote || 0, byStatus['Returned to Sales']);
    /* A242 — 'quotation-void' belongs in this sum and was missing. A227 added the step (a Quoted
       request whose only quotation was CANCELLED) without widening the reconcile, so the moment one
       appeared in the live book the total came up one short. It never fired because this whole block
       only runs when a snapshot is present, and there was none. */
    eq('  every Quoted splits across quoted / send-quote / quotation-gone / quotation-void',
       sum('quoted', 'send-quote', 'quotation-gone', 'quotation-void'), byStatus.Quoted);
    eq('  Requested + Sourcing land in the sourcing pair',
       sum('chase-admin', 'wait-sourcing'),
       (byStatus.Requested || 0) + (byStatus.Sourcing || 0));
    eq('  Mgmt Priced lands in the verify pair',
       sum('chase-verify', 'wait-verify'), byStatus['Mgmt Priced'] || 0);
    eq('  For Mgmt Pricing lands in the pricing pair',
       sum('chase-pricing', 'wait-pricing'), byStatus['For Mgmt Pricing'] || 0);
    eq('  nothing fell through to unknown', byStep.unknown || 0, 0);
    /* A242 — no live request is partly quoted yet, so the two new steps must be empty. This is the
       assertion that proves the feature changed no existing row: the moment one appears here, it is
       because somebody used it. */
    eq('  no live request is Partly Quoted yet', byStatus['Partly Quoted'] || 0, 0);
    eq('  so neither new step fires on the live book',
       (byStep['quote-rest'] || 0) + (byStep['price-rest'] || 0), 0);
    eq('  nothing was undateable — both formats parsed', byStep['no-date'] || 0, 0);

    ok('the 15 requests naming a deleted quotation are surfaced, not hidden',
       (byStep['quotation-gone'] || 0) > 0, byStep['quotation-gone']);
    console.log('     quotation-gone (a number that resolves to nothing):', byStep['quotation-gone'] || 0);

    // Migrated history must not leak into the rep's work.
    ok('NO imported record appears in "now"',
       list.groups.now.every(r => r.status !== 'Migrated'));
    const reps = pricingRequestWorklistByRep(list);
    console.log('     per rep — now / waiting / done:');
    reps.forEach(r => console.log('        ' + r.rep.padEnd(20) +
      String(r.now.length).padStart(4) + String(r.waiting.length).padStart(5) +
      String(r.done.length).padStart(6)));
    eq('  every request is attributed to exactly one rep',
       reps.reduce((t, r) => t + r.now.length + r.waiting.length + r.done.length, 0), LIVE);
  }
}

/* A242 — the partly-quoted request. The whole reason the status exists is that its leftover items
   were invisible: before this, quoting 3 of 5 flipped the request to 'Quoted' and the other 2 fell
   out of every list with nothing anywhere saying they had never been sent to anybody. */
console.log('\n== A242: a request that is only partly quoted ==');
{
  const line = (n, price, quotable) => ({ line: n, qty: 1, finalPrice: price,
                                          included: true, quotable: quotable });
  const partly = (items) => pricingRequestWorklistStep(
    { prNo: 'PR-1', date: daysAgo(2), status: 'Partly Quoted', quotationNo: 'Q-1',
      customer: 'ACME', items },
    [], { quotationNo: 'Q-1', status: 'Sent' }, {}, TODAY);

  // 3 quoted, 2 priced and waiting — the rep can finish it alone.
  const ready = partly([line(1, 100, false), line(2, 100, false), line(3, 100, false),
                        line(4, 250, true), line(5, 250, true)]);
  eq('priced remainder → the rep quotes the rest', ready.step, 'quote-rest');
  eq('  which is theirs to do', PRW_STEPS[ready.step].hands, 'you');
  eq('  and it is urgent, not "done"', ready.group, 'now');
  eq('  the value in play is the REMAINDER only, not the whole request', ready.value, 500);
  ok('  and the detail says how the request is split', /3 item\(s\) already quoted/.test(ready.detail), ready.detail);

  // 3 quoted, 2 with no price — somebody else has to move first.
  const unpriced = partly([line(1, 100, false), line(2, 100, false), line(3, 100, false),
                           line(4, 0, true), line(5, 0, true)]);
  eq('unpriced remainder → it needs pricing first', unpriced.step, 'price-rest');
  eq('  which is somebody else’s move', PRW_STEPS[unpriced.step].hands, 'them');
  eq('  and no value is claimed for lines nobody has priced', unpriced.value, 0);
  eq('  so the UI shows a dash, not ₱0.00', unpriced.priced, false);

  /* Every line out but the status never caught up. The stamp and the status are two separate cell
     writes and Apps Script cannot do both at once, so this state is reachable — reading it as done
     is right, and saying so beats inventing work. */
  const all = partly([line(1, 100, false), line(2, 100, false)]);
  eq('every line quoted but the status lagged → read as done', all.step, 'quoted');
  eq('  and it lands in done, not now', all.group, 'done');

  ok('both new steps are in the table with a verb',
     !!(PRW_STEPS['quote-rest'].verb && PRW_STEPS['price-rest'].verb));
}

console.log('\n== rubbish does not throw ==');
{
  [null, undefined, {}, { items: null }, { status: null }, { date: {} }, { prNo: 12345 }].forEach((x, i) => {
    let threw = false;
    try { pricingRequestWorklistStep(x, null, null, null, TODAY); } catch (e) { threw = true; console.log('    ', e.message); }
    ok('input ' + i + ' does not throw', !threw);
  });
  let threw = false;
  try { pricingRequestWorklist(null, null, null, null, TODAY); } catch (e) { threw = true; }
  ok('a null list does not throw', !threw);
  eq('  and reports an empty board',
     pricingRequestWorklist([], {}, {}, {}, TODAY).counts, { now: 0, waiting: 0, done: 0, total: 0 });
}

console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall ok');
process.exit(fail ? 1 : 0);
