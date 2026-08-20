/* A245 — the Monthly AP Aging engine.
 *
 * Run:  node tests/flow/ap-monthly.js
 *
 * WHY THIS FILE EXISTS. Every figure this report shows is money somebody will act on, and the data
 * underneath it does not support a naive reading:
 *
 *   • APAging['Paid (PHP)'] is a single CUMULATIVE scalar with NO date of its own, and 'Updated At'
 *     moves on any write. So AP alone cannot say which month a payment fell in.
 *   • The only per-payment dated record is the PaymentRequests row — and on the live book only 3 of
 *     the 8 settled payables reach one. Three have no linked request at all; two link to a request
 *     that is not itself marked paid.
 *   • The Journal cannot substitute: _postJournal is idempotent per (source, sourceNo) and posts the
 *     RUNNING TOTAL at _now(), so a July partial is replaced by an August entry.
 *
 * THE ONE IDENTITY THAT MAKES THE REPORT TRUSTWORTHY: across all months the dated slices sum EXACTLY
 * to Σ Paid (PHP). Every case below is a way that identity could break, or a way a wrong number could
 * reach a financial page — each was raised by an adversarial review of the rule before it was built.
 */
const path = require('path');
const M = require(path.resolve(__dirname, '../../dashboard/js/ap-monthly-model.js'));

let FAIL = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (x === undefined ? '' : '\n         ' + JSON.stringify(x))); } };
const eq = (l, g, w) => ok(l + ' = ' + JSON.stringify(w), JSON.stringify(g) === JSON.stringify(w), { got: g });
const near = (l, g, w) => ok(l + ' = ' + w, Math.abs(g - w) < 0.005, { got: g, want: w });

const ap = (o) => Object.assign({ apNo: 'AP-1', poNo: 'PO-1', supplier: 'ACME', currency: 'PHP',
  amountFC: 1000, amountPHP: 1000, paidPHP: 0, status: 'Unpaid', dueDate: '',
  createdAt: '2026-07-01', updatedAt: '2026-07-01' }, o);
const pr = (o) => Object.assign({ prNo: 'PRF-1', poNo: 'PO-1', type: 'PO', status: 'Paid',
  amount: 0, currency: 'PHP', actualDebitedPHP: 0, bankChargePHP: 0,
  paidAt: '2026-07-15', valueDate: '' }, o);

const total = b => b.slices.reduce((t, s) => t + s.amount, 0);

console.log('== the identity: slices sum exactly to Σ Paid (PHP) ==');
{
  const b = M.apmSlices(
    [ap({ apNo: 'AP-1', poNo: 'PO-1', paidPHP: 600, status: 'Paid' }),
     ap({ apNo: 'AP-2', poNo: 'PO-2', paidPHP: 400, status: 'Paid', updatedAt: '2026-08-03' })],
    [pr({ prNo: 'PRF-1', poNo: 'PO-1', amount: 250 })]);
  near('Σ slices equals Σ Paid (PHP)', total(b), 1000);
  near('  the explained part keeps its own date', b.slices.filter(s => s.basis === 'recorded')[0].amount, 250);
  eq('  and is dated by the request', b.slices.filter(s => s.basis === 'recorded')[0].ym, '2026-07');
  near('  the rest is the remainder, inferred', b.slices.filter(s => s.basis === 'inferred')
       .reduce((t, s) => t + s.amount, 0), 750);
}

console.log('\n== the bank charge is OUR cost and never settles the supplier ==');
{
  // A219 found ₱2,070.60 and ₱465.77 of exactly this folded into "paid" with nowhere else to go.
  near('settled = debited − charge', M.apmSettled({ actualDebitedPHP: 10000, bankChargePHP: 500 }), 9500);
  near('  no debited recorded → fall back to the request amount',
       M.apmSettled({ amount: 7000, actualDebitedPHP: 0, bankChargePHP: 0 }), 7000);
}

console.log('\n== GUARD: one payment fanned across two payables is counted ONCE ==');
{
  /* _linkPrToAp stamps a request onto EVERY AP row for its PO, and _prTargetAp only refuses multi-row
     POs when Amount (PHP) > 0 — a zero-amount sibling escapes. Walking payables and pulling in
     matching requests would double the month. */
  const b = M.apmSlices(
    [ap({ apNo: 'AP-1', poNo: 'PO-9', amountPHP: 1000, paidPHP: 300, status: 'Partial' }),
     ap({ apNo: 'AP-2', poNo: 'PO-9', amountPHP: 0, paidPHP: 0 })],
    [pr({ prNo: 'PRF-9', poNo: 'PO-9', amount: 300 })]);
  eq('the payment produced exactly one slice', b.slices.filter(s => s.basis === 'recorded').length, 1);
  near('  and the total is not doubled', total(b), 300);
  ok('  both rows are flagged as sharing a PO',
     b.payables.every(p => p.flags.indexOf('shares-po') >= 0), b.payables.map(p => p.flags));
}

console.log('\n== GUARD: a blank PO is never a join key ==');
{
  /* A Type:'Other' request has no PO either, and '' === '' would attach every one of them to every
     unkeyed payable. _prTargetAp refuses an empty poNo for the same reason. */
  const b = M.apmSlices(
    [ap({ apNo: 'AP-B', poNo: '', amountPHP: 5000, paidPHP: 0 })],
    [pr({ prNo: 'PRF-O', poNo: '', type: 'Other', amount: 9999 }),
     pr({ prNo: 'PRF-X', poNo: '', type: 'PO', amount: 8888 })]);
  eq('nothing attached to the blank-PO payable', b.slices.length, 0);
  near('  and the total stays zero', total(b), 0);
}

console.log('\n== GUARD: a Type:"Other" payment never reaches AP ==');
{
  // It writes an Expenses row instead; counting it here would also count it twice against that sheet.
  const b = M.apmSlices([ap({ paidPHP: 0 })], [pr({ type: 'Other', amount: 5000 })]);
  eq('no slice from an Other request', b.slices.length, 0);
}

console.log('\n== GUARD: an unpaid or rejected request is not evidence of anything ==');
{
  const b = M.apmSlices([ap({ paidPHP: 0 })],
    [pr({ status: 'Approved', amount: 1000 }), pr({ prNo: 'PRF-2', status: 'Rejected', amount: 1000 })]);
  eq('neither produced a slice', b.slices.length, 0);
}

console.log('\n== GUARD: a NEGATIVE remainder is surfaced, never clamped ==');
{
  /* revisePaymentRequest refuses a paid request and directs the user to "record a correction on AP
     Aging instead"; updateAPAging then OVERWRITES Paid (PHP) with no floor. Clamping to zero would
     quietly break the sum identity — the one thing making this report trustworthy. */
  const b = M.apmSlices(
    [ap({ apNo: 'AP-C', poNo: 'PO-C', paidPHP: 200, status: 'Partial', updatedAt: '2026-08-05' })],
    [pr({ prNo: 'PRF-C', poNo: 'PO-C', amount: 500 })]);
  const rem = b.slices.filter(s => s.basis === 'inferred')[0];
  ok('the correction appears as a negative slice', rem && rem.amount < 0, rem);
  ok('  flagged so a person can see it, with both figures',
     rem && rem.flags.indexOf('over-explained') >= 0 && rem.explained === 500 && rem.apPaid === 200, rem);
  near('  and the identity still holds', total(b), 200);
}

console.log('\n== GUARD: a foreign amount sitting in the peso column is flagged ==');
{
  /* Under confirmNoActual `settles` falls back to Amount, which on an FX request is FOREIGN units.
     AP and the request agree so the split balances, but the month is understated ~60x. */
  const b = M.apmSlices([ap({ poNo: 'PO-F', paidPHP: 720, status: 'Paid' })],
    [pr({ prNo: 'PRF-F', poNo: 'PO-F', currency: 'USD', amount: 720, actualDebitedPHP: 0 })]);
  ok('flagged', b.slices[0].flags.indexOf('fc-amount-unconverted') >= 0, b.slices[0].flags);
  const b2 = M.apmSlices([ap({ poNo: 'PO-F', paidPHP: 41000, status: 'Paid' })],
    [pr({ prNo: 'PRF-F', poNo: 'PO-F', currency: 'USD', amount: 720, actualDebitedPHP: 41000 })]);
  ok('  not flagged when the bank figure IS recorded',
     b2.slices[0].flags.indexOf('fc-amount-unconverted') < 0);
}

console.log('\n== both dates are kept, and Value Date wins ==');
{
  const b = M.apmSlices([ap({ poNo: 'PO-V', paidPHP: 100, status: 'Paid' })],
    [pr({ prNo: 'PRF-V', poNo: 'PO-V', amount: 100, paidAt: '2026-07-31', valueDate: '2026-08-02' })]);
  const s = b.slices[0];
  eq('bucketed by the bank date', s.ym, '2026-08');
  eq('  the click date is still on the slice', s.paidAt, '2026-07-31');
  eq('  and so is the value date', s.valueDate, '2026-08-02');
}

console.log('\n== open at month-end is reconstructed, not read off Status ==');
{
  /* Status is a LIVE label. Asking "what was open at 31 July" and filtering status !== 'Paid' drops
     everything settled in August, because it reads as settled TODAY. */
  const rows = [ap({ apNo: 'AP-J', poNo: 'PO-J', amountPHP: 1000, paidPHP: 1000, status: 'Paid',
                     createdAt: '2026-07-02', updatedAt: '2026-08-20' })];
  const b = M.apmSlices(rows, [pr({ prNo: 'PRF-J', poNo: 'PO-J', amount: 1000, paidAt: '2026-08-20' })]);
  const jul = M.apmMonth(b, '2026-07'), aug = M.apmMonth(b, '2026-08');
  near('it WAS open at 31 July, even though it reads Paid now', jul.open.total, 1000);
  near('  and is not open at 31 August', aug.open.total, 0);
  near('  the payment lands in August', aug.paid.total, 1000);
  near('  and not in July', jul.paid.total, 0);
}

console.log('\n== aging basis: due date when present, else the date raised ==');
{
  const b = M.apmSlices(
    [ap({ apNo: 'AP-D', poNo: 'PO-D', amountPHP: 500, dueDate: '2026-08-20', createdAt: '2026-06-01' }),
     ap({ apNo: 'AP-E', poNo: 'PO-E', amountPHP: 500, dueDate: '', createdAt: '2026-06-01' })], []);
  const r = M.apmMonth(b, '2026-08');
  const byNo = {}; r.open.rows.forEach(x => { byNo[x.apNo] = x; });
  eq('a row with a due date ages from it', byNo['AP-D'].ageBasis, 'due');
  eq('  and one without ages from when it was raised', byNo['AP-E'].ageBasis, 'raised');
  eq('  which puts them in different buckets', [byNo['AP-D'].bucket, byNo['AP-E'].bucket], ['1-30', '90+']);
}

console.log('\n== an implausible exchange rate is flagged, not corrected ==');
{
  const b = M.apmSlices([ap({ apNo: 'AP-R', poNo: 'PO-R', currency: 'USD',
                              amountFC: 720, amountPHP: 446393.80, createdAt: '2026-07-01' })], []);
  const row = M.apmMonth(b, '2026-08').open.rows[0];
  near('the implied rate is shown', row.impliedRate, 619.99);
  ok('  and flagged as outside the band', row.flags.indexOf('rate-out-of-band') >= 0, row.flags);
  const b2 = M.apmSlices([ap({ apNo: 'AP-S', poNo: 'PO-S', currency: 'USD',
                               amountFC: 720, amountPHP: 41760, createdAt: '2026-07-01' })], []);
  ok('  a normal rate is not flagged',
     M.apmMonth(b2, '2026-08').open.rows[0].flags.indexOf('rate-out-of-band') < 0);
}

console.log('\n== a foreign payable is settled on the OBLIGATION, not the peso estimate ==');
{
  /* A222 — Amount (PHP) on a foreign row is an ESTIMATE typed at PO time; the pesos that actually
     left are whatever the bank gave that day. Subtracting one from the other to decide "still open"
     is wrong in both directions, and on the live book invented ₱400,000 of debt on an order already
     marked Paid. */
  const b = M.apmSlices(
    [ap({ apNo: 'AP-FX', poNo: 'PO-FX', currency: 'USD', amountFC: 720, amountPHP: 446393.80,
          paidPHP: 46393.80, status: 'Paid', createdAt: '2026-07-01', updatedAt: '2026-07-20' })], []);
  const r = M.apmMonth(b, '2026-08');
  near('it is NOT reported as ₱400,000 of debt', r.open.total, 0);
  eq('  it is reported as an estimate gap instead', r.estimateGaps.length, 1);
  near('  naming the gap', r.estimateGaps[0].gap, 400000);
  near('  and the implied rate that caused it', r.estimateGaps[0].impliedRate, 619.99);

  // A PHP payable is unaffected: there the payable IS the obligation.
  const b2 = M.apmSlices(
    [ap({ apNo: 'AP-P', poNo: 'PO-P', currency: 'PHP', amountPHP: 1000, paidPHP: 400,
          status: 'Partial', createdAt: '2026-07-01', updatedAt: '2026-07-20' })], []);
  near('a part-paid PHP payable is still open for the balance',
       M.apmMonth(b2, '2026-08').open.total, 600);
  eq('  and raises no estimate gap', M.apmMonth(b2, '2026-08').estimateGaps.length, 0);
}

console.log('\n== nothing here throws on rubbish ==');
[null, undefined, [], [null], [{}], [{ poNo: null, paidPHP: 'x' }]].forEach((r, i) => {
  ok('input ' + i + ' does not throw', (() => {
    try { const b = M.apmSlices(r, r); M.apmMonth(b, '2026-08'); M.apmMonths(b); return true; }
    catch (e) { return false; }
  })());
});

/* ── THE LIVE BOOK ────────────────────────────────────────────────────────────────────────────── */
console.log('\n== the live book, if a snapshot is present ==');
{
  const fs = require('fs');
  const S = '/private/tmp/claude-501/-Users-neilestur-Documents-app-CRM-sales-dashboard/' +
            '815863d9-c2cf-4190-a7c3-fb6e0c291a74/scratchpad/scan';
  if (!fs.existsSync(S + '/ap.json') || !fs.existsSync(S + '/pr.json')) {
    console.log('  --  no snapshot in this checkout; the fixture assertions above stand alone');
  } else {
    const apRows = JSON.parse(fs.readFileSync(S + '/ap.json', 'utf8')).data;
    const prRows = JSON.parse(fs.readFileSync(S + '/pr.json', 'utf8')).data;
    const b = M.apmSlices(apRows, prRows);
    console.log('     ' + apRows.length + ' payables, ' + b.slices.length + ' dated slices');
    near('Σ slices === Σ Paid (PHP)', total(b), b.totalPaid);
    ok('  no slice is stranded without a date', b.slices.every(s => s.ym), 
       b.slices.filter(s => !s.ym).map(s => s.apNo));
    M.apmMonths(b).forEach(m => {
      const r = M.apmMonth(b, m);
      console.log('     ' + m + '  paid ' + r.paid.total.toFixed(2) +
                  '  (recorded ' + r.paid.recorded.toFixed(2) +
                  ', inferred ' + r.paid.inferred.toFixed(2) + ')' +
                  '  open at month-end ' + r.open.total.toFixed(2));
    });
    const months = M.apmMonths(b).map(m => M.apmMonth(b, m).paid.total).reduce((t, v) => t + v, 0);
    near('  every month adds back to the whole', months, b.totalPaid);
  }
}

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
