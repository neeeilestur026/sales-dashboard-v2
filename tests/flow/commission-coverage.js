/* A234 — THE FULLY-COLLECTED GATE. A commission may only be submitted once the order behind it has
 * actually been collected, and this file is why that sentence can be trusted.
 *
 * Two halves, because they fail differently:
 *   · _commCoverage is pure, so the BOUNDARY is asserted exactly — no seeding, no rounding surprises
 *     hiding behind sheet data. This is where 99.4 vs 99.5 is settled.
 *   · submitCommissionRequest is exercised end to end, because a correct helper that nothing calls is
 *     the failure this file exists to catch. A211 shipped guards; A234 has to prove they are wired.
 *
 * THE TRAP THIS ENCODES. A VAT/EWT order NEVER collects its face value: the client hands over the
 * VAT-inclusive amount less 1% withholding, so a "collected == SO total" rule would refuse every real
 * order forever and no rep would ever be paid. The gate measures against _commExpectedCash, and the
 * case at the bottom of the boundary table is exactly that order at genuine 100% — it must PASS.
 */
const { load, call } = require('./gasload');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const store = () => ({ Quotations: [], QuotationItems: [], SalesOrders: [], SalesOrderItems: [],
  Invoices: [], ARAging: [], Collections: [], CommissionRequests: [], CommissionRequestItems: [],
  CommissionRates: [], Documents: [], ActivityLog: [], Clients: [], Inventory: [], Journal: [],
  FlowSettings: [], QuotationEmails: [], MailIndex: [] });

const c = load(null, store());

console.log('== the constant, asserted on its own line ==');
eq('_COMM_FULL_PCT', c._COMM_FULL_PCT, 99.5);

console.log('\n== collectible cash is NOT the order total ==');
/* 100,000 ex-VAT: the client adds 12% VAT and withholds 1% of the ex-VAT amount.
   100,000 x (0.99 + 0.12) = 111,000 — this is the number the gate measures against.

   ASSERTED TO THE CENTAVO, NOT THE BIT. The raw return is 110999.99999999999: in IEEE754
   0.99 + 0.12 is 1.1099999999999999, and that wobble predates A234 — _commExpectedCash has always
   returned it. It is harmless HERE and the next assertion is the one that proves it: pct is rounded
   to one decimal, which absorbs anything under ~0.05 percentage points (about 55 pesos on this
   order), and the error is ~1e-11. Asserting the bit pattern instead would be a test that fails for
   a reason nobody is paid differently over. */
eq('_commExpectedCash(100000), to the centavo',
   Math.round(c._commExpectedCash(100000) * 100) / 100, 111000);
ok('and it is BELOW the VAT-inclusive 112,000 a naive rule would demand',
   c._commExpectedCash(100000) < 112000);
/* The wobble cannot move the verdict at the exact boundary, which is the only place it could matter. */
eq('float wobble does not flip the 99.5% boundary',
   [c._commCoverage(100000, 0, 110445).pct, c._commCoverage(100000, 0, 110445).full], [99.5, true]);

console.log('\n== the boundary, both sides ==');
const cov = (total, prior, base) => c._commCoverage(total, prior, base);
// 111,000 collectible. 99.5% of it is 110,445 exactly.
eq('110,445 of 111,000 -> 99.5%, full', [cov(100000, 0, 110445).pct, cov(100000, 0, 110445).full], [99.5, true]);
eq('110,444 -> 99.5% too (it ROUNDS up), full', [cov(100000, 0, 110444).pct, cov(100000, 0, 110444).full], [99.5, true]);
/* The rounded pct is what the note PRINTS, so the gate must use the rounded value too — a claim the
   screen calls 99.5% must not be refused by a server testing 99.4995 unrounded. */
eq('110,000 -> 99.1%, NOT full', [cov(100000, 0, 110000).pct, cov(100000, 0, 110000).full], [99.1, false]);
eq('the shortfall is reported in pesos', cov(100000, 0, 110000).shortfall, 1000);

console.log('\n== the case a naive "collected == SO total" rule would block forever ==');
const fullCash = cov(100000, 0, 111000);
eq('a VAT/EWT order at genuine 100% of collectible cash', [fullCash.pct, fullCash.full], [100, true]);
ok('and it is not flagged over-collected', fullCash.over === false);

console.log('\n== prior claims count toward completeness ==');
eq('60,000 prior + 51,000 now = 111,000 -> full', cov(100000, 60000, 51000).full, true);
eq('60,000 prior + 40,000 now -> not full', cov(100000, 60000, 40000).full, false);

console.log('\n== an unvalued order is UNKNOWABLE, not incomplete ==');
const unv = cov(0, 0, 50000);
eq('valued=false and full=false', [unv.valued, unv.full], [false, false]);
ok('shortfall is not invented', unv.shortfall === 0);
eq('a negative total is unvalued too', c._commCoverage(-5, 0, 10).valued, false);

console.log('\n== over-collection is full, and still flagged ==');
const over = cov(100000, 0, 130000);
eq('over-collected is full (it is collected) but flagged', [over.full, over.over], [true, true]);

console.log('\n== the note and the gate cannot disagree ==');
/* The whole reason _commCoverage exists. Every case in the boundary table above is re-read through
   the SENTENCE, and PARTIAL must appear exactly when full is false. */
[[100000, 0, 110445], [100000, 0, 110000], [100000, 60000, 51000], [100000, 0, 111000],
 [100000, 0, 130000], [0, 0, 50000]].forEach(function (t) {
  const note = c._commCoverageNote(t[0], 0, t[1], t[2]);
  const cv = c._commCoverage(t[0], t[1], t[2]);
  const saysPartial = /PARTIAL/.test(note);
  ok('note/gate agree for ' + JSON.stringify(t) + ' (full=' + cv.full + ', PARTIAL=' + saysPartial + ')',
     cv.valued ? (saysPartial === !cv.full) : !saysPartial, note);
});

console.log('\n== A234 refactor: the note is BYTE-IDENTICAL to the pre-A234 wording ==');
/* Pinned, not derived. These strings were produced by the code BEFORE _commCoverage was extracted —
   verified at the time against git HEAD across a 288-case branch matrix (every combination of
   unvalued / partial / exact / over, with and without prior and invoiced), zero differences. Pinning
   them here is what stops a later tidy-up of _commCoverage quietly rewording what an approver reads. */
eq('partial', c._commCoverageNote(100000, 0, 0, 110000),
   'Claimed cash after this request: PHP 110,000.00 of PHP 111,000.00 collectible on a PHP 100,000.00 order (99.1%). PARTIAL — the order is not fully collected.');
eq('complete', c._commCoverageNote(100000, 0, 0, 111000),
   'Claimed cash after this request: PHP 111,000.00 of PHP 111,000.00 collectible on a PHP 100,000.00 order (100%).');
eq('unvalued', c._commCoverageNote(0, 0, 0, 50000),
   'Sales order carries no value on record — judge this claim on the collections listed.');
eq('over-collected', c._commCoverageNote(100000, 0, 0, 130000),
   'Claimed cash after this request: PHP 130,000.00 of PHP 111,000.00 collectible on a PHP 100,000.00 order (117.1%). OVER-COLLECTED: claimed cash exceeds what this order can produce by PHP 19,000.00 — verify before approving.');
eq('with prior and part-invoiced', c._commCoverageNote(100000, 40000, 60000, 51000),
   'Claimed cash after this request: PHP 111,000.00 of PHP 111,000.00 collectible on a PHP 100,000.00 order (100%). PHP 60,000.00 was already claimed on this order. Only PHP 40,000.00 has been invoiced so far.');

/* ── the gate, end to end ───────────────────────────────────────────────────────────────────────
 *
 * The half above proves the arithmetic. This half proves it is WIRED — a correct _commCoverage that
 * submitCommissionRequest never consults would pass every assertion so far and still pay a rep on a
 * half-collected order. Seeded through the sheets so the real handler runs against real _rows.
 *
 * The order is 100,000 ex-VAT, so 111,000 is collectible (see above). The client hands over the
 * VAT-inclusive 112,000 and withholds 1,000, which is why a COMPLETE collection row reads
 * Amount 112,000 / EWT 1,000 — base 111,000. That is the shape of a real payment, not a contrivance.
 */
function seed(collectionAmount, collectionEwt, soTotal) {
  const s = store();
  s.Quotations.push({ 'Quotation No': '2026-001-GL-ACME-PUMP', 'Customer': 'ACME',
    'Status': 'Approved', 'Total': soTotal, 'Salesperson': 'Gerald Lucena', 'Created By': 'Gerald Lucena' });
  s.SalesOrders.push({ 'SO No': 'SO-001', 'Quotation No': '2026-001-GL-ACME-PUMP',
    'Customer': 'ACME', 'Status': 'Open', 'Total': soTotal });
  s.Collections.push({ 'Collection No': 'COL-1', 'SO No': 'SO-001', 'Customer': 'ACME',
    'Date': '2026-08-01', 'Amount (PHP)': collectionAmount, 'EWT (PHP)': collectionEwt, 'Voided': '' });
  s.CommissionRates.push({ 'Rate Key': 'R1', 'Scope': 'all', 'Scope Value': '',
    'Min Base (PHP)': 0, 'Max Base (PHP)': '', 'Rate %': 5, 'Effective From': '2020-01-01' });
  s.CommissionRequests.push({ 'Comm No': 'COMM-1', 'Date': '2026-08-10', 'Salesperson': 'Gerald Lucena',
    'SO No': 'SO-001', 'Quotation No': '2026-001-GL-ACME-PUMP', 'Customer': 'ACME',
    'Base (PHP)': collectionAmount - collectionEwt, 'Status': 'Draft', 'Created By': 'Gerald Lucena' });
  s.CommissionRequestItems.push({ 'Comm No': 'COMM-1', 'Collection No': 'COL-1', 'SO No': 'SO-001' });
  return load(null, s);
}
const submit = (ctx) => call(ctx, 'submitCommissionRequest',
  { commNo: 'COMM-1', actorName: 'Gerald Lucena', actorRole: 'sales', confirmBaseChanged: true });

console.log('\n== the gate is WIRED into submitCommissionRequest ==');
{
  const partial = submit(seed(100000, 1000, 100000));           // base 99,000 of 111,000 -> 89.2%
  ok('a part-collected order is REFUSED', partial.success === false, partial);
  ok('  and the refusal names the shortfall in pesos', /still to collect/.test(partial.message || ''), partial.message);
  ok('  and tells the rep the draft survives', /Keep the draft/.test(partial.message || ''), partial.message);
  ok('  and does NOT claim the rate or the collections are at fault',
     !/rate has not been set up|claims no collections/.test(partial.message || ''), partial.message);
}
{
  const full = submit(seed(112000, 1000, 100000));              // base 111,000 of 111,000 -> 100%
  ok('a fully collected order SUBMITS', full.success === true, full);
}
{
  const unvalued = submit(seed(112000, 1000, 0));               // no value on the order
  ok('an unvalued order is refused', unvalued.success === false, unvalued);
  ok('  and says the coverage is UNKNOWABLE, not that it is uncollected',
     /no way to tell/.test(unvalued.message || '') && !/still to collect/.test(unvalued.message || ''),
     unvalued.message);
  ok('  and points at who can fix it', /accounting/.test(unvalued.message || ''), unvalued.message);
}
{
  /* Drafting must stay open — the rep builds the claim and watches it close the gap. If this ever
     starts failing, the gate has crept from the submit door onto the draft door. */
  const ctx = seed(100000, 1000, 100000);
  const d = ctx._commDerive('SO-001', ['COL-1'], 'COMM-1', null);
  ok('a part-collected claim still DERIVES for the draft screen', d.ok === true, d.message);
  eq('  and carries the coverage the browser mirrors', [d.coverage.full, d.coverage.pct], [false, 89.2]);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
