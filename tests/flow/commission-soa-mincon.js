/* A239 — GERALD'S MINCON SOA, AS A FIXTURE. Run: node tests/flow/commission-soa-mincon.js
 *
 * WHY THIS FILE EXISTS. A210 built the whole deduction ladder from one real document —
 * 2026_003_SOA_GEL_Mincon.xlsx, the sheet Admin/Accounting actually compute commission on — and
 * verified it BY HAND, once. Nothing has held it since: grep the numbers and the only hit is a
 * baseline text dump. So the ladder that decides what every rep is paid could drift from the
 * document it was derived from and no test would fail. This is that verification made executable.
 *
 * THE SOURCE ROW, transcribed from the sheet (row 7, the only line on it):
 *
 *     VAT-ex order value        38,607.93     from quotation QTN-202607-005, MINCON ENTERPRISES
 *     12% VAT                    4,632.9516
 *     PO amount                 43,240.8816
 *     Collected                 42,854.8023   PO less 1% EWT withheld by the client
 *     Less 12% VAT               5,188.9058   <- of the PO AMOUNT, not of the VAT charged
 *     Local tax 3%               1,297.2264
 *     Net of taxes              36,368.6701
 *     Commission                   909.2168   <- 2.5%, though the column header says 3%
 *     Net of EWT                   900.1246   <- less 1% on the commission itself
 *
 * TWO THINGS HERE LOOK LIKE BUGS AND ARE NOT. Both are pinned deliberately, because both are one
 * "tidy-up" away from silently changing somebody's pay:
 *
 *   · THE RATE IS 2.5%, NOT THE 3% THE COLUMN HEADER CLAIMS. 36,368.6701 x 3% would be 1,091.0601;
 *     the sheet's own figure is 909.2168, which is 2.5%. A210 recorded 2.5% as confirmed and the
 *     header as a mislabel. Do not raise the constant because the spreadsheet says 3%.
 *   · THE VAT DEDUCTION IS 12% OF THE VAT-INCLUSIVE PO AMOUNT (5,188.91), NOT THE VAT ACTUALLY
 *     CHARGED (4,632.95). About PHP 14 more per PHP 38.6k of sale, taken out of the rep's pay.
 *     It was queried and kept so new claims reconcile with historical SOAs.
 */
const { load } = require('./gasload');

let fail = 0;
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
                          else console.log('  ok  ', l); };
/** Money is compared to the CENTAVO-and-beyond, because the sheet carries four decimals and the
 *  whole point of this file is that the two agree exactly rather than approximately. */
const peso = (l, got, want) => ok(l + ' = ' + got.toFixed(4),
                                  Math.abs(got - want) < 0.00005, { want: want.toFixed(4) });

const store = () => ({ CommissionRequests: [], CommissionItems: [], CommissionRates: [],
                       SalesOrders: [], Collections: [], Quotations: [], ARAging: [],
                       Invoices: [], ActivityLog: [] });
const c = load(null, store());

// ── the document ────────────────────────────────────────────────────────────
const EX        = 38607.93;      // VAT-exclusive order value, from the quotation
const VAT       =  4632.9516;
const PO        = 43240.8816;
const COLLECTED = 42854.8023;
const VAT_DED   =  5188.9058;
const LOCAL_TAX =  1297.2264;
const NET_TAXES = 36368.6701;
const COMMISSION =  909.2168;
const NET_EWT    =  900.1246;

console.log('== the constants the ladder is built from ==');
// If any of these has moved, every figure below is answering a different question.
ok('VAT deducted at 12%',        c._COMM_VAT_PCT === 12,       c._COMM_VAT_PCT);
ok('local tax at 3%',            c._COMM_LOCAL_TAX_PCT === 3,  c._COMM_LOCAL_TAX_PCT);
ok('EWT at 1%',                  c._COMM_EWT_PCT === 1,        c._COMM_EWT_PCT);
ok('VAT charged on a sale is 12%', c._COMM_VAT_RATE === 12,    c._COMM_VAT_RATE);
ok("the VAT deduction is on the INCLUSIVE amount — see the header note",
   c._COMM_VAT_ON === 'inclusive', c._COMM_VAT_ON);
ok('the company rate is 2.5%, NOT the 3% the sheet header claims',
   c._COMM_DEFAULT_RATE === 2.5, c._COMM_DEFAULT_RATE);

console.log('\n== the sheet is internally consistent — checked before trusting it ==');
peso('12% VAT is 12% of the ex-VAT value',   EX * 0.12, VAT);
peso('PO amount is ex-VAT plus that VAT',    EX + VAT, PO);
peso('collected is the PO less 1% of ex-VAT', PO - EX * 0.01, COLLECTED);
peso('  which is the same as ex-VAT x 1.11', EX * 1.11, COLLECTED);
peso('the VAT deduction is 12% of the PO amount', PO * 0.12, VAT_DED);
ok('  and is NOT 12% of the VAT charged', Math.abs(VAT * 0.12 - VAT_DED) > 1,
   { charged12: (VAT * 0.12).toFixed(4), sheet: VAT_DED.toFixed(4) });
peso('local tax is 3% of the PO amount',     PO * 0.03, LOCAL_TAX);
peso('net of taxes is collected less both',  COLLECTED - VAT_DED - LOCAL_TAX, NET_TAXES);
peso('commission is 2.5% of net of taxes',   NET_TAXES * 0.025, COMMISSION);
ok('  3% would NOT reproduce the sheet', Math.abs(NET_TAXES * 0.03 - COMMISSION) > 100,
   { atThreePct: (NET_TAXES * 0.03).toFixed(4), sheet: COMMISSION.toFixed(4) });
peso('net of EWT is the commission less 1%', COMMISSION * 0.99, NET_EWT);

console.log('\n== THE ENGINE REPRODUCES THE DOCUMENT, fully collected ==');
{
  const collected = c._commExpectedCash(EX);
  peso('expected cash matches the sheet\'s Collected', collected, COLLECTED);

  const l = c._commLadder(collected, EX);
  peso('PO amount',      l.poAmount,     PO);
  peso('VAT deduction',  l.vatDeduction, VAT_DED);
  peso('local tax',      l.localTax,     LOCAL_TAX);
  peso('net of taxes',   l.netOfTaxes,   NET_TAXES);
  ok('the fraction is a full order', Math.abs(l.fraction - 1) < 1e-9, l.fraction);
  ok('and it is not an estimate', l.estimated === false);

  const gross = l.netOfTaxes * c._COMM_DEFAULT_RATE / 100;
  peso('commission at the shipped rate', gross, COMMISSION);
  peso('NET OF EWT — what Gerald is paid', gross * (1 - c._COMM_EWT_PCT / 100), NET_EWT);
}

console.log('\n== the A210 identity, stated in the ladder\'s own comment ==');
// "Net of Taxes = VAT-exclusive order value x 0.942 (1.11 - 0.168)". If the ladder ever stops
// collapsing to this, one of the three percentages has moved.
peso('net of taxes = ex-VAT x 0.942', EX * 0.942, NET_TAXES);
peso('  and = collected x 0.942 / 1.11', COLLECTED * 0.942 / 1.11, NET_TAXES);

console.log('\n== a PART payment is apportioned, not taken whole ==');
{
  // The deductions belong to the ORDER, so half the cash carries half of them. Without the
  // pro-rata the first instalment would absorb the entire 12% and 3%, underpaying the rep on it
  // and overpaying on the last one.
  const half = c._commExpectedCash(EX) / 2;
  const l = c._commLadder(half, EX);
  ok('the fraction halves', Math.abs(l.fraction - 0.5) < 1e-9, l.fraction);
  peso('the VAT deduction halves too', l.vatDeduction, VAT_DED / 2);
  peso('as does the local tax',        l.localTax,     LOCAL_TAX / 2);
  peso('so net of taxes is exactly half', l.netOfTaxes, NET_TAXES / 2);

  const other = c._commLadder(c._commExpectedCash(EX) - half, EX);
  peso('and the two halves rebuild the whole', l.netOfTaxes + other.netOfTaxes, NET_TAXES);
}

console.log('\n== an order with NO value on record is reported, never guessed ==');
{
  const l = c._commLadder(COLLECTED, 0);
  ok('it says so plainly', l.estimated === true);
  ok('  and the basis names the reason', /no value/.test(String(l.basis)), l.basis);
  // The fallback identity is exactly right when the payment is proportional, which this one is.
  peso('  and the figure still lands on the document', l.netOfTaxes, NET_TAXES);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed — the engine still agrees with the SOA');
process.exit(fail ? 1 : 0);
