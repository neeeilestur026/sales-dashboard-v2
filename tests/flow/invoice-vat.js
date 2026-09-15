/* A278 — OUTPUT VAT: net revenue, gross receivable, gross ledger.
 *
 * Run:  node tests/flow/invoice-vat.js
 *
 * THE BUG THIS ENCODES. The stored price chain is VAT-exclusive end to end (A182) and the 12% was
 * added only when the quotation PDF rendered — it was never persisted. So the client was billed
 * 112,000 while the receivable said 100,000: every full payment tripped the over-collect confirm,
 * the aging ran 12% light, and account 1200 was debited net at invoice and credited gross at
 * collection with nothing to absorb the difference, because no output-VAT account existed at all.
 *
 * What is pinned here is the whole contract: revenue did NOT move (that is the point — fifteen P&L
 * and KPI readers take 'Total Sales' as revenue), the receivable and the AR debit are gross, the
 * difference is a 2200 liability, a deposit is not VATable, a legacy row behaves exactly as it
 * always did, and the repair can never silently eat an invoice's COGS entry.
 */
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const section = (t) => console.log('\n== ' + t + ' ==');

const TOOL = 'HYDRAULIC TORQUE WRENCH';
function boot(soType, extra) {
  const store = Object.assign({
    Inventory: [{ 'Item No': 'TW-01', 'Description': TOOL, 'Available Balance': 30,
                  'Purchase Price/Unit': 40000, 'Shipping Cost/Unit': 0, 'Landed Cost/Unit': 40000,
                  'Total Landed Cost': 1200000, 'Currency': 'PHP', 'Type': 'Stock', 'Item ID': 'ITM-00001' }],
    SalesOrders: [{ 'SO No': 'SO-001', 'Date': '2026-09-01', 'Customer': 'ACME', 'Status': 'Open',
                    'Total': 190000, 'Type': soType || '' }],
    Clients: [{ 'Customer': 'ACME', 'Payment Terms': '30 days' }],
    Invoices: [], InvoiceItems: [], ARAging: [], Collections: [], Journal: [], ChartOfAccounts: []
  }, extra || {});
  return { ctx: load(undefined, store), store };
}
const jsum = (store, acct, side) => (store.Journal || [])
  .filter(r => String(r['Account Code']) === acct)
  .reduce((s, r) => s + Number(r[side === 'dr' ? 'Debit' : 'Credit'] || 0), 0);
const jrows = (store, acct) => (store.Journal || []).filter(r => String(r['Account Code']) === acct);
const inv = (ctx, items, extra) => call(ctx, 'createInvoice', Object.assign(
  { customer: 'ACME', soNo: 'SO-001', confirmNoDocs: true, items: JSON.stringify(items) }, extra || {}));

/* ── 1 · the default is 12%, and revenue does not move ─────────────────────────────────────── */
{
  section('1 · default 12%');
  const { ctx, store } = boot();
  const r = inv(ctx, [{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 60000, itemId: 'ITM-00001' }]);
  ok('the invoice is raised', r.success === true, r);
  eq('Total Sales is the NET revenue, unchanged', Number(store.Invoices[0]['Total Sales']), 120000);
  eq('the rate is recorded', Number(store.Invoices[0]['VAT Rate']), 12);
  eq('the VAT amount is recorded', Number(store.Invoices[0]['VAT']), 14400);
  eq('the receivable is the gross', Number(store.ARAging[0]['Amount (PHP)']), 134400);
  eq('the AR debit matches the receivable', jsum(store, '1200', 'dr'), 134400);
  eq('output VAT is credited', jsum(store, '2200', 'cr'), 14400);
  eq('sales are still credited NET', jsum(store, '4000', 'cr'), 120000);
  eq('the result reports the rate', r.vatRate, 12);
  eq('  and the total due', r.totalDue, 134400);
  ok('  and says so in the message, for a stale tab that sent no rate',
     /net 120000\.00 \+ VAT 12% 14400\.00/.test(r.message), r.message);
  const dto = call(ctx, 'getInvoices', {}).data[0];
  eq('the DTO carries the rate', dto.vatRate, 12);
  eq('  the amount', dto.vat, 14400);
  eq('  the derived total due', dto.totalDue, 134400);
  eq('  and totalDeposit, which was never emitted before', dto.totalDeposit, 0);
}

/* ── 2 · zero-rated: the entry is byte-identical to pre-A278 ───────────────────────────────── */
{
  section('2 · exempt / zero-rated');
  const { ctx, store } = boot();
  const r = inv(ctx, [{ itemNo: 'TW-01', itemName: TOOL, qty: 1, price: 50000, itemId: 'ITM-00001' }], { vatRate: 0 });
  ok('the invoice is raised', r.success === true, r);
  eq('no VAT', Number(store.Invoices[0]['VAT']), 0);
  eq('the receivable is the net', Number(store.ARAging[0]['Amount (PHP)']), 50000);
  /* The raw cell must read '0', not blank: _num cannot tell them apart, and the repair MUST NOT
     re-VAT a sale somebody deliberately marked exempt. */
  ok('the rate cell says 0 — a recorded fact, not an absence',
     String(store.Invoices[0]['VAT Rate']).trim() === '0', store.Invoices[0]['VAT Rate']);
  ok('NO 2200 line exists at all — the entry is what it was before A278', jrows(store, '2200').length === 0);
  eq('and it still balances', jsum(store, '1200', 'dr'), jsum(store, '4000', 'cr'));
}

/* ── 3 · rounded once, so the journal foots to the centavo ─────────────────────────────────── */
{
  section('3 · rounding');
  const { ctx, store } = boot();
  inv(ctx, [{ itemNo: 'TW-01', itemName: TOOL, qty: 3, price: 1234.57, itemId: 'ITM-00001' }]);
  // 3 x 1,234.57 = 3,703.71; 12% = 444.4452 -> 444.45, rounded in createInvoice and nowhere else.
  eq('the VAT is rounded to the centavo', jsum(store, '2200', 'cr'), 444.45);
  eq('  and stored at the same value', Number(store.Invoices[0]['VAT']), 444.45);
  const dr = jsum(store, '1200', 'dr');
  const cr = jsum(store, '4000', 'cr') + jsum(store, '4100', 'cr') + jsum(store, '2200', 'cr') + jsum(store, '2100', 'cr');
  ok('debit equals credits exactly, not merely within a tolerance', dr === cr, { dr, cr });
  eq('  and the receivable is the same number', Number(store.ARAging[0]['Amount (PHP)']), 4148.16);
}

/* ── 4 · a deposit is not VATable ──────────────────────────────────────────────────────────── */
{
  section('4 · deposits are outside the VAT base');
  const { ctx, store } = boot('Service');
  inv(ctx, [{ itemNo: '', itemName: 'RENTAL', qty: 7, price: 12000 },
            { itemNo: '', itemName: 'Refundable security deposit', qty: 1, price: 20000, chargeKind: 'Deposit' }]);
  eq('VAT is 12% of the revenue', jsum(store, '2200', 'cr'), 10080);
  ok('  and NOT 12% of what the client remits', jsum(store, '2200', 'cr') !== 12480);
  eq('the deposit still credits its liability in full', jsum(store, '2100', 'cr'), 20000);
  eq('the receivable is revenue + VAT + deposit', Number(store.ARAging[0]['Amount (PHP)']), 114080);
}

/* ── 5 · a legacy blank-VAT invoice is unmoved ─────────────────────────────────────────────── */
{
  section('5 · legacy rows do not move on their own');
  const LEGACY = { 'INV No': 'INV-OLD-1', 'SO No': 'SO-OLD', 'Date': '2026-01-15', 'Customer': 'ACME',
                   'Total Sales': 88933.33, 'Total COGS': 0, 'Created By': 'Migrated (legacy)', 'Created At': '2026-01-15' };
  const { ctx, store } = boot('', { Invoices: [LEGACY] });
  const dto = call(ctx, 'getInvoices', {}).data[0];
  eq('the DTO reports no VAT', dto.vat, 0);
  eq('  no rate', dto.vatRate, 0);
  eq('  and total due is just the net', dto.totalDue, 88933.33);
  const r = call(ctx, 'backfillMissingAR', { invNos: JSON.stringify(['INV-OLD-1']) });
  ok('the backfill runs', r.success === true, r);
  eq('and recreates the receivable at exactly what it always was',
     Number(store.ARAging[0]['Amount (PHP)']), 88933.33);
}

/* ── 6 · backfillMissingAR agrees with createInvoice — incl. the deposit it used to drop ───── */
{
  section('6 · the backfill writes the same receivable createInvoice would');
  const { ctx, store } = boot('Service');
  inv(ctx, [{ itemNo: '', itemName: 'RENTAL', qty: 7, price: 12000 },
            { itemNo: '', itemName: 'Deposit', qty: 1, price: 20000, chargeKind: 'Deposit' }]);
  const original = Number(store.ARAging[0]['Amount (PHP)']);
  eq('the original receivable', original, 114080);
  store.ARAging.length = 0;                       // as if the AR row had never been written
  const r = call(ctx, 'backfillMissingAR', {});
  ok('the backfill runs', r.success === true, r);
  /* This is the assertion that pins the A276 leftover: before A278 the backfill read only
     'Total Sales', so it minted a receivable short by the deposit AND by the VAT. */
  eq('the recreated receivable is identical', Number(store.ARAging[0]['Amount (PHP)']), original);
}

/* ── 7 · the repair ────────────────────────────────────────────────────────────────────────── */
{
  section('7 · previewInvoiceVatRepair / applyInvoiceVatRepair');
  // A book as it stands the day before the fix: receivables booked NET by the old createInvoice.
  const mk = (invNo, soNo, net, opts) => Object.assign(
    { 'INV No': invNo, 'SO No': soNo, 'Date': '2026-08-10', 'Customer': 'ACME',
      'Total Sales': net, 'Total COGS': net / 2, 'Created By': 'Ana', 'Created At': '2026-08-10',
      'Voided': '', 'Void Reason': '', 'Total Deposit': 0 }, opts || {});
  const ar = (arNo, invNo, soNo, amt, collected) => ({
    'AR No': arNo, 'INV No': invNo, 'SO No': soNo, 'Customer': 'ACME', 'Amount (PHP)': amt,
    'Collected (PHP)': collected || 0, 'Status': collected ? 'Paid' : 'Unpaid',
    'Due Date': '2026-09-09', 'Notes': '', 'Created At': '2026-08-10', 'Updated At': '2026-08-10' });
  const je = (invNo, ar, sales, cogs) => ([
    { 'Entry No': 'JE-INV-' + invNo, 'Date': '2026-08-10', 'Source': 'INV', 'Source No': invNo,
      'Account Code': '1200', 'Account Name': 'Accounts Receivable', 'Debit': ar, 'Credit': 0, 'Currency': 'PHP' },
    { 'Entry No': 'JE-INV-' + invNo, 'Date': '2026-08-10', 'Source': 'INV', 'Source No': invNo,
      'Account Code': '4000', 'Account Name': 'Sales', 'Debit': 0, 'Credit': sales, 'Currency': 'PHP' },
    { 'Entry No': 'JE-INV-' + invNo, 'Date': '2026-08-10', 'Source': 'INV', 'Source No': invNo,
      'Account Code': '5000', 'Account Name': 'Cost of Goods Sold', 'Debit': cogs, 'Credit': 0, 'Currency': 'PHP' },
    { 'Entry No': 'JE-INV-' + invNo, 'Date': '2026-08-10', 'Source': 'INV', 'Source No': invNo,
      'Account Code': '1300', 'Account Name': 'Inventory', 'Debit': 0, 'Credit': cogs, 'Currency': 'PHP' }]);

  const { ctx, store } = boot('', {
    Invoices: [
      mk('INV-A', 'SO-A', 100000),                                            // unpaid, repairable
      mk('INV-B', 'SO-B', 200000),                                            // over-collected at gross
      mk('INV-M', 'SO-M', 50000, { 'Created By': 'Migrated (legacy)' }),      // migrated
      mk('INV-V', 'SO-V', 70000, { 'Voided': 'true' }),                       // voided
      mk('INV-S', 'SO-S', 60000, { 'VAT Rate': 0, 'VAT': 0 }),                // already stamped exempt
      mk('INV-D1', 'SO-D', 10000), mk('INV-D2', 'SO-D', 20000)                // two live invoices on one SO
    ],
    ARAging: [
      ar('AR-A', 'INV-A', 'SO-A', 100000),
      ar('AR-B', 'INV-B', 'SO-B', 200000, 224000),
      ar('AR-M', 'INV-M', 'SO-M', 55500),
      ar('AR-V', 'INV-V', 'SO-V', 70000),
      ar('AR-S', 'INV-S', 'SO-S', 60000),
      ar('AR-D1', 'INV-D1', 'SO-D', 10000),
      ar('AR-X', 'INV-GONE', 'SO-X', 12345)
    ],
    Collections: [{ 'Collection No': 'COL-1', 'AR No': 'AR-B', 'INV No': 'INV-B', 'SO No': 'SO-B',
                    'Date': '2026-09-01', 'Amount (PHP)': 224000, 'EWT (PHP)': 0, 'Voided': '' }],
    Journal: [].concat(je('INV-A', 100000, 100000, 50000), je('INV-B', 200000, 200000, 100000),
                       je('INV-D1', 10000, 10000, 5000))
  });

  const before = JSON.stringify(store);
  const pre = call(ctx, 'previewInvoiceVatRepair', {});
  ok('the preview runs', pre.success === true, pre);
  ok('IT WRITES NOTHING', JSON.stringify(store) === before);
  ok('it says plainly that it imputes', pre.imputed === true && /IMPUTES 12%/.test(pre.message), pre.message);
  const row = (n) => pre.rows.filter(r => r.invNo === n)[0];
  ok('the unpaid one is offered', !!row('INV-A') && row('INV-A').category === 'unpaid', pre.rows);
  eq('  with the imputed VAT shown per row', row('INV-A').imputedVat, 12000);
  eq('  and the before/after amounts', row('INV-A').amountAfter, 112000);
  ok('the over-collected one is offered and categorised', row('INV-B').category === 'overCollected', row('INV-B'));
  eq('  its outstanding goes from negative to zero', row('INV-B').outstandingAfter, 0);
  const why = (n) => (pre.skipped.filter(s => s.invNo === n)[0] || {}).reason || '';
  ok('the migrated invoice is refused', !row('INV-M') && /migrated/.test(why('INV-M')), why('INV-M'));
  ok('the voided invoice is refused', !row('INV-V') && /voided/.test(why('INV-V')), why('INV-V'));
  ok('the already-stamped invoice is refused', !row('INV-S') && /already records/.test(why('INV-S')), why('INV-S'));
  ok('the receivable with no invoice is refused', !row('INV-GONE') && /no invoice/.test(why('INV-GONE')), why('INV-GONE'));
  ok('the two-invoices-on-one-SO row is flagged ambiguous', row('INV-D1').ambiguous === true, row('INV-D1'));

  ok('apply with no list refuses', call(ctx, 'applyInvoiceVatRepair', {}).success === false);
  const noSuch = call(ctx, 'applyInvoiceVatRepair', { invNos: JSON.stringify(['INV-M']) });
  ok('apply naming a skipped invoice refuses with the PREVIEW\'s own reason',
     noSuch.repaired.length === 0 && /migrated/.test(noSuch.refused[0].reason), noSuch.refused);
  const ambig = call(ctx, 'applyInvoiceVatRepair', { invNos: JSON.stringify(['INV-D1']) });
  ok('an ambiguous row needs confirmation', ambig.repaired.length === 0 && /more than one/.test(ambig.refused[0].reason), ambig.refused);

  const salesBefore = jsum(store, '4000', 'cr'), cogsBefore = jsum(store, '5000', 'dr'), invBefore = jsum(store, '1300', 'cr');
  const res = call(ctx, 'applyInvoiceVatRepair', { invNos: JSON.stringify(['INV-A', 'INV-B']) });
  ok('the repair runs', res.success === true, res);
  eq('two invoices repaired', res.repaired.length, 2);
  eq('the VAT stamped in total', res.vatStamped, 36000);
  const findInv = (n) => store.Invoices.filter(v => v['INV No'] === n)[0];
  const findAr = (n) => store.ARAging.filter(a => a['AR No'] === n)[0];
  eq('the invoice now records its rate', Number(findInv('INV-A')['VAT Rate']), 12);
  eq('  and its VAT', Number(findInv('INV-A')['VAT']), 12000);
  eq('  while Total Sales is untouched', Number(findInv('INV-A')['Total Sales']), 100000);
  eq('the receivable is gross', Number(findAr('AR-A')['Amount (PHP)']), 112000);
  eq('the over-collected row now settles exactly', Number(findAr('AR-B')['Amount (PHP)']), 224000);
  eq('  and reads Paid honestly', String(findAr('AR-B')['Status']), 'Paid');
  /* THE GUARD. _postJournal replaces every line for (INV, no), so a repair that rebuilt the entry
     from the invoice alone would silently delete its COGS and inventory legs. */
  eq('COGS is untouched by the repair', jsum(store, '5000', 'dr'), cogsBefore);
  eq('  inventory too', jsum(store, '1300', 'cr'), invBefore);
  eq('  and revenue', jsum(store, '4000', 'cr'), salesBefore);
  eq('only output VAT moved', jsum(store, '2200', 'cr'), 36000);
  eq('  and the AR debit by the same amount', jsum(store, '1200', 'dr'), 100000 + 200000 + 10000 + 36000);
  const jeA = (store.Journal || []).filter(j => String(j['Source No']) === 'INV-A');
  ok('the corrected entry keeps the invoice\'s own date, not today\'s',
     jeA.every(j => String(j['Date']).slice(0, 10) === '2026-08-10'), jeA.map(j => j['Date']));
  const again = call(ctx, 'applyInvoiceVatRepair', { invNos: JSON.stringify(['INV-A']) });
  ok('running it twice changes nothing — the stamp is the guard',
     again.repaired.length === 0 && /already records/.test(again.refused[0].reason), again.refused);
}

/* ── 8 · the reported symptom is gone ──────────────────────────────────────────────────────── */
{
  section('8 · a full payment no longer looks like an over-collection');
  const { ctx, store } = boot();
  const r = inv(ctx, [{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 60000, itemId: 'ITM-00001' }]);
  const arNo = r.arNo;
  // The client remits the VAT-inclusive amount less 1% withholding on the net: 134,400 - 1,200.
  const col = call(ctx, 'recordCollection', { arNo: arNo, amount: 134400, ewtPHP: 1200,
    date: '2026-09-20', method: 'Bank', confirmNoDocs: true, actorName: 'Acct', actorRole: 'accounting' });
  ok('it records without a confirmation prompt', col.success === true && !col.needsConfirm, col);
  const a = call(ctx, 'getARAging', {}).data[0];
  eq('the receivable settles exactly', a.outstanding, 0);
  eq('  and reads Paid', a.status, 'Paid');

  // ...and the guard still works: paying only the net must NOT close the invoice.
  const b = boot();
  const r2 = inv(b.ctx, [{ itemNo: 'TW-01', itemName: TOOL, qty: 2, price: 60000, itemId: 'ITM-00001' }]);
  call(b.ctx, 'recordCollection', { arNo: r2.arNo, amount: 120000, date: '2026-09-20',
    method: 'Bank', confirmNoDocs: true, actorName: 'Acct', actorRole: 'accounting' });
  const a2 = call(b.ctx, 'getARAging', {}).data[0];
  eq('paying only the net leaves the VAT outstanding', a2.outstanding, 14400);
  eq('  and the row is Partial, not Paid', a2.status, 'Partial');
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
