/* A248 — Invoice → AR Aging reconciliation.
 *
 * Run:  node tests/flow/ar-reconcile.js
 *
 * WHY THIS FILE EXISTS. The AR aging page loaded ARAging and nothing else, so an invoice that never
 * produced a receivable was not merely unflagged — it was UNDETECTABLE from that page, which had
 * nothing to compare against. Its empty state even said "Issue an invoice to generate one", pointing
 * the reader at exactly the wrong conclusion when the failure is an invoice that WAS issued.
 *
 * Reconciled against the live book: the live path is sound — every invoice created through the app
 * has its AR row, and all 51 collections resolve to a real receivable. The gap is migration: 65
 * invoices worth ₱37.3M carry `Migrated (legacy)` and never got one.
 *
 * THE CLASSIFIER MUST NOT INVENT DEBT, and that is what most of these cases pin:
 *
 *   · a VOIDED invoice is SUPPOSED to have no receivable — voidInvoice deletes it, because ARAging
 *     has no `Voided` column. Counting one as "missing" is precisely the bug backfillMissingAR had,
 *     where pressing a button recreated a full-value receivable for every invoice ever voided.
 *   · the SO fallback resolves ONLY when exactly one invoice claims that order. Two invoices on one
 *     order is genuine ambiguity, and guessing attaches a receivable to the wrong sale.
 *   · a legacy row with no SO and an invoice number that matches nothing is UNRESOLVED, not guessed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (x === undefined ? '' : '\n         ' + JSON.stringify(x).slice(0, 260))); } };
const eq = (l, g, w) => ok(l + ' = ' + JSON.stringify(w), JSON.stringify(g) === JSON.stringify(w), { got: g });

const ctx = {
  console, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
  window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetchFlow: () => Promise.resolve({ data: [] }), postFlow: () => Promise.resolve({}),
  flowEsc: s => String(s == null ? '' : s), flowNum: v => (parseFloat(v) || 0),
  flowMoney: v => '₱' + (parseFloat(v) || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  flowDate: s => String(s || '').slice(0, 10), requireOversight: () => ({ role: 'accounting' }),
  renderNavbar() {}, renderFlowNav() {}, flowLedgerInjectCss() {},
  setTimeout, clearTimeout, Date, Math, JSON, Object, String, Number, Array, parseFloat, isFinite
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/flow-ar-aging.js'), 'utf8'),
                ctx, { filename: 'flow-ar-aging.js' });
const R = ctx.arReconcile;

const ar = o => Object.assign({ arNo: 'AR-1', invNo: '', soNo: '', amountPHP: 100,
                               status: 'Unpaid', createdAt: '2026-06-23' }, o);
const iv = o => Object.assign({ invNo: 'INV-1', soNo: '', customer: 'C', date: '2026-07-01',
                                totalSales: 100, voided: false }, o);

console.log('== the healthy path ==');
{
  const r = R([ar({ invNo: 'INV-1' })], [iv({ invNo: 'INV-1' })]);
  eq('a matching invoice number is a direct hit', r.direct.length, 1);
  eq('  nothing is reported as unaged', r.unaged.length, 0);
  eq('  and nothing is inferred', r.viaSo.length, 0);
}

console.log('\n== a VOIDED invoice is supposed to have no receivable ==');
{
  /* voidInvoice DELETES the AR row — ARAging has no Voided column, unlike Invoices and Collections
     which are flagged so the reversal stays auditable. Calling that "missing" is how you resurrect
     a debt the customer does not owe. */
  const r = R([], [iv({ invNo: 'INV-V', voided: true, totalSales: 50000 })]);
  eq('a voided invoice with no AR row is NOT reported', r.unaged.length, 0);
  eq('  and contributes nothing to the value', r.unagedValue, 0);
  const r2 = R([], [iv({ invNo: 'INV-L', voided: false, totalSales: 50000 })]);
  eq('a LIVE invoice with no AR row IS reported', r2.unaged.length, 1);
  eq('  with its value', r2.unagedValue, 50000);
}

console.log('\n== the SO fallback resolves only when it is unambiguous ==');
{
  const one = R([ar({ arNo: 'AR-X', invNo: 'INV-2026-106', soNo: 'SO-9' })],
                [iv({ invNo: 'INV-202607-088', soNo: 'SO-9' })]);
  eq('one invoice on that order → resolved via SO', one.viaSo.length, 1);
  eq('  and the invoice is NOT also reported as unaged', one.unaged.length, 0);
  eq('  it is not counted as a direct hit', one.direct.length, 0);

  const many = R([ar({ arNo: 'AR-Y', invNo: 'INV-2026-107', soNo: 'SO-8' })],
                 [iv({ invNo: 'INV-202607-090', soNo: 'SO-8' }),
                  iv({ invNo: 'INV-202607-091', soNo: 'SO-8' })]);
  eq('TWO invoices on that order → NOT resolved, never guessed', many.viaSo.length, 0);
  eq('  the AR row is unresolved instead', many.unresolved.length, 1);
  eq('  and both invoices are honestly reported as unaged', many.unaged.length, 2);
}

console.log('\n== a legacy row with no SO is unresolved, not guessed ==');
{
  const r = R([ar({ arNo: 'AR-L', invNo: '79', soNo: '', status: 'Paid' })],
              [iv({ invNo: 'INV-202607-088', soNo: 'SO-1' })]);
  eq('unresolved', r.unresolved.length, 1);
  eq('  and it did not attach itself to an unrelated invoice', r.viaSo.length, 0);
  ok('  a set of settled legacy rows is recognised as settled', r.unresolvedAllPaid === true);
  const mixed = R([ar({ arNo: 'A', invNo: '79', status: 'Paid' }),
                   ar({ arNo: 'B', invNo: '80', status: 'Unpaid' })], []);
  ok('  but not when one is still open', mixed.unresolvedAllPaid === false);
}

console.log('\n== every AR row lands in exactly one bucket ==');
{
  const rows = [ar({ arNo: 'A', invNo: 'INV-1' }), ar({ arNo: 'B', invNo: 'X', soNo: 'SO-1' }),
                ar({ arNo: 'C', invNo: 'nope' })];
  const r = R(rows, [iv({ invNo: 'INV-1' }), iv({ invNo: 'INV-2', soNo: 'SO-1' })]);
  eq('direct + viaSo + unresolved === row count',
     r.direct.length + r.viaSo.length + r.unresolved.length, rows.length);
}

console.log('\n== A249: the BASELINE decides what is a defect and what is history ==');
{
  /* balance-sheet.js states the policy: migrated records predate the new-system baseline and are
     excluded on purpose. So a pre-baseline invoice with no receivable is CORRECT, and reporting it
     turns the banner into wallpaper. Only on-or-after the baseline is a real defect. */
  const ledger = [ar({ arNo: 'AR-B', invNo: 'INV-SEED', soNo: 'SO-SEED', createdAt: '2026-06-23' })];
  const invs = [iv({ invNo: 'INV-SEED', soNo: 'SO-SEED', date: '2026-06-23' }),
                iv({ invNo: 'OLD', date: '2025-03-01', totalSales: 10 }),
                iv({ invNo: 'NEW', date: '2026-07-01', totalSales: 20 })];
  const r = R(ledger, invs);
  eq('the baseline is derived from the earliest receivable', r.baseline, '2026-06-23');
  eq('a post-baseline invoice with no AR is a DEFECT', r.unagedLive.map(v => v.invNo), ['NEW']);
  eq('  and is valued', r.unagedLiveValue, 20);
  eq('a pre-baseline one is history, not a defect', r.unagedHistory.map(v => v.invNo), ['OLD']);
  eq('  the two tiers still sum to the whole', r.unagedLive.length + r.unagedHistory.length, r.unaged.length);

  /* THE BOUNDARY. An invoice dated exactly ON the baseline was issued the day the ledger opened, so
     it should have produced a receivable. Off by one here moves millions between "chase this" and
     "already settled". */
  const onDay = R(ledger, [iv({ invNo: 'INV-SEED', soNo: 'SO-SEED', date: '2026-06-23' }),
                           iv({ invNo: 'EDGE', date: '2026-06-23', totalSales: 5 })]);
  eq('an invoice dated ON the baseline is live, not history',
     onDay.unagedLive.map(v => v.invNo), ['EDGE']);
  const dayBefore = R(ledger, [iv({ invNo: 'INV-SEED', soNo: 'SO-SEED', date: '2026-06-23' }),
                               iv({ invNo: 'EDGE2', date: '2026-06-22', totalSales: 5 })]);
  eq('  the day before is history', dayBefore.unagedHistory.map(v => v.invNo), ['EDGE2']);

  /* An empty ledger must not declare the whole book settled — the safe direction is to treat
     everything as live and let a person look. */
  const none = R([], [iv({ invNo: 'X', date: '2020-01-01', totalSales: 1 })]);
  eq('no receivables at all -> everything is live, nothing is written off', none.unagedHistory.length, 0);
  eq('  and it appears as a defect', none.unagedLive.length, 1);
}

console.log('\n== it never breaks the ledger ==');
[[null, null], [undefined, undefined], [[], []], [[null], [null]], [[{}], [{}]],
 [[ar({})], null]].forEach((a, i) => {
  ok('input ' + i + ' does not throw', (() => {
    try { const r = R(a[0], a[1]); return !!r && Array.isArray(r.unaged); } catch (e) { return false; }
  })());
});
ok('the banner renders nothing when invoices could not be read',
   (() => { vm.runInContext('arInvoices = null; arData = [];', ctx);
            return ctx.arReconcileBanner() === ''; })());

/* ── THE LIVE BOOK ────────────────────────────────────────────────────────────────────────────── */
console.log('\n== the live book, if a snapshot is present ==');
{
  const S = '/private/tmp/claude-501/-Users-neilestur-Documents-app-CRM-sales-dashboard/' +
            '815863d9-c2cf-4190-a7c3-fb6e0c291a74/scratchpad/scan';
  if (!fs.existsSync(S + '/getARAging.json') || !fs.existsSync(S + '/getInvoices.json')) {
    console.log('  --  no snapshot in this checkout; the fixture assertions above stand alone');
  } else {
    const arRows = JSON.parse(fs.readFileSync(S + '/getARAging.json', 'utf8')).data;
    const invRows = JSON.parse(fs.readFileSync(S + '/getInvoices.json', 'utf8')).data;
    const r = R(arRows, invRows);
    console.log(`     ${invRows.length} invoices, ${arRows.length} receivables`);
    console.log(`     direct ${r.direct.length} · via SO ${r.viaSo.length} · ` +
                `unresolved ${r.unresolved.length} · unaged ${r.unaged.length} ` +
                `(₱${r.unagedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    eq('every receivable is classified once',
       r.direct.length + r.viaSo.length + r.unresolved.length, arRows.length);
    ok('the unaged set is entirely migrated — the live path is sound',
       r.unaged.every(v => String(v.createdBy || '').indexOf('Migrated') >= 0),
       r.unaged.filter(v => String(v.createdBy || '').indexOf('Migrated') < 0)
        .map(v => v.invNo + ' by ' + v.createdBy));
    console.log(`     baseline ${r.baseline} · live defects ${r.unagedLive.length} ` +
                `(₱${r.unagedLiveValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}) · ` +
                `pre-baseline history ${r.unagedHistory.length}`);
    /* The whole point of A249: the actionable number is small. If this ever grows, something is
       creating post-baseline invoices without receivables again. */
    ok('the live-defect tier is the small one', r.unagedLive.length < r.unagedHistory.length,
       { live: r.unagedLive.length, history: r.unagedHistory.length });
    eq('  the two tiers account for every unaged invoice',
       r.unagedLive.length + r.unagedHistory.length, r.unaged.length);
    ok('the legacy unresolved rows are all settled', r.unresolvedAllPaid === true);
  }
}

console.log('\n== the server-side Voided filters this depends on ==');
{
  const gs = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  const body = (name) => {
    const a = gs.indexOf('function ' + name + '(');
    let d = 0;
    for (let k = gs.indexOf('{', a); k < gs.length; k++) {
      if (gs[k] === '{') d++; else if (gs[k] === '}') { d--; if (!d) return gs.slice(a, k + 1); }
    }
    return '';
  };
  const bf = body('backfillMissingAR');
  ok('backfillMissingAR skips VOIDED invoices', /v\['Voided'\][\s\S]{0,40}'true'/.test(bf), bf.slice(0, 120));
  ok('  and ignores VOIDED collections', /c\['Voided'\][\s\S]{0,40}'true'/.test(bf));
  ok('correctCollection ignores voided siblings when checking over-collection',
     /Voided/.test(body('correctCollection')));

  /* A249 — the three server fixes this page's numbers depend on. */
  ok('the migrated-invoice delete never touches a VOIDED invoice',
     /Voided[\s\S]{0,30}!==\s*'true'/.test(body('_deleteMigratedInvoiceForSO')));
  ok('regeneration REUSES the invoice number instead of re-minting it',
     /existing\.rowIndex/.test(body('_writeMigratedRecordsForSO')));
  /* Checks for a WRITE, not a mention — the function's comment explains at length why it must not
     create one, and matching the bare sheet name would fail on the explanation itself. */
  ok('  and still does not WRITE an AR row (that belongs to the scoped backfill)',
     !/_append\(\s*'ARAging'|ARAging'\s*\)\.appendRow/.test(body('_writeMigratedRecordsForSO')));
  ok("saveSOCostDetails passes 'COGS Type' to the writer",
     /'COGS Type':\s*cogsType/.test(body('saveSOCostDetails')));
  ok('backfillMissingAR accepts an invNos scope', /p\.invNos/.test(body('backfillMissingAR')));
}

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
