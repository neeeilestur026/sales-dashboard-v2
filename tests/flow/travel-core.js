/* A212 step 1 — the schema widths and the pure money core, before any handler exists.
 *
 * The headline case is the workbook's own sample, and it is the standing regression test for this
 * whole feature: two items, ₱35 tricycle and ₱70 bus, both trips and both without receipts. Each
 * printed page totals ₱105 and the claim is ₱105. Anything that reports ₱210 has added two
 * overlapping projections together, which is the single easiest mistake to make here.
 */
const { load } = require('./gasload');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const c = load(null, { TravelReplenishments: [], TravelReplenishmentItems: [], TravelFloats: [],
                       PaymentRequests: [], Expenses: [], ActivityLog: [], Documents: [] });

console.log('== the three sheets exist at the widths the comments claim ==');
eq('TravelReplenishments', c.SCHEMA.TravelReplenishments.length, 33);
eq('TravelReplenishmentItems', c.SCHEMA.TravelReplenishmentItems.length, 13);
eq('TravelFloats', c.SCHEMA.TravelFloats.length, 10);
eq('no duplicate column names in TravelReplenishments',
   c.SCHEMA.TravelReplenishments.length,
   c.SCHEMA.TravelReplenishments.filter((v, i, a) => a.indexOf(v) === i).length);
/* The derived figures must NOT be columns. A stored Remaining is a second source of truth for
   Float − Spent and would drift the first time either is corrected. */
['Remaining', 'Remaining Float', 'Employee Advanced', 'Paid', 'Paid At'].forEach(col => {
  eq('"' + col + '" is deliberately not a column', c.SCHEMA.TravelReplenishments.indexOf(col), -1);
});

console.log('\n== the workbook sample: 105, on three pages, not 210 ==');
{
  const items = [
    { 'Kind': 'Transport', 'Amount': 35, 'Has Receipt': 'No', 'Date': '2026-07-27' },
    { 'Kind': 'Transport', 'Amount': 70, 'Has Receipt': 'No', 'Date': '2026-07-27' }
  ];
  const d = c._travDerive(items);
  eq('TOTAL SPENT (the claim, and the payable)', d.total, 105);
  eq('Travel Itinerary page total', d.transport, 105);
  eq('COENRR page total', d.noReceipt, 105);
  eq('receipted (prints on neither page)', d.receipted, 0);
  ok('the two page subtotals OVERLAP — adding them would double-count',
     d.transport + d.noReceipt === 210 && d.total === 105);
}

console.log('\n== the fourth quadrant is counted, even though no page prints it ==');
{
  const d = c._travDerive([
    { 'Kind': 'Transport', 'Amount': 35, 'Has Receipt': 'No' },     // both pages
    { 'Kind': 'Transport', 'Amount': 200, 'Has Receipt': 'Yes' },   // itinerary only
    { 'Kind': 'Meals', 'Amount': 60, 'Has Receipt': 'No' },         // COENRR only
    { 'Kind': 'Meals', 'Amount': 150, 'Has Receipt': 'Yes' }        // NEITHER page
  ]);
  eq('total covers all four quadrants', d.total, 445);
  eq('itinerary shows the two trips', d.transport, 235);
  eq('COENRR shows the two without receipts', d.noReceipt, 95);
  eq('and the invisible quadrant is reported separately', d.receipted, 350);
  ok('so the cover sheet can tie back to the total', d.total === 445);
}

console.log('\n== Monday keying is recomputed, never trusted ==');
eq('a Wednesday resolves to its Monday', c._travMonday('2026-07-29'), '2026-07-27');
eq('a Sunday resolves BACK to the Monday, not forward', c._travMonday('2026-08-02'), '2026-07-27');
eq('a Monday is its own Monday', c._travMonday('2026-07-27'), '2026-07-27');
eq('week end is the Sunday', c._travWeekEnd('2026-07-27'), '2026-08-02');
eq('garbage in -> empty, not today', c._travMonday('not-a-date'), '');
eq('and empty in -> empty', c._travMonday(''), '');

console.log('\n== the duration label is the days TRAVELLED, not the week bounds ==');
eq('Mon-Fri inside a Mon-Sun week',
   c._travDurationLabel([{ 'Date': '2026-07-27' }, { 'Date': '2026-07-31' }]), 'July 27-31, 2026');
eq('a single day', c._travDurationLabel([{ 'Date': '2026-07-29' }]), 'July 29, 2026');
eq('spanning a month end',
   c._travDurationLabel([{ 'Date': '2026-07-30' }, { 'Date': '2026-08-01' }]), 'July 30 – August 1, 2026');
eq('no items -> no label', c._travDurationLabel([]), '');

console.log('\n== remaining vs advanced: an overspend is never a negative remaining ==');
{
  const row = (float, spent) => ({ 'Trav No': 'T', 'Float Amount': float, 'Total Spent': spent });
  const under = c._travMap(row(2000, 1500), []);
  eq('underspend: remaining', under.remaining, 500);
  eq('underspend: advanced', under.advanced, 0);
  eq('underspend: not flagged', under.overspent, false);
  const over = c._travMap(row(2000, 2300), []);
  eq('overspend: remaining is ZERO, not −300', over.remaining, 0);
  eq('overspend: the rep advanced 300 of their own', over.advanced, 300);
  eq('overspend: flagged', over.overspent, true);
  const exact = c._travMap(row(2000, 2000), []);
  eq('exact: remaining 0, advanced 0, not flagged',
     [exact.remaining, exact.advanced, exact.overspent], [0, 0, false]);
}

console.log('\n== the stage table says what the cover sheet says ==');
eq('the chain', c._TRAV_STAGES.map(s => [s.status, s.role, s.next]),
   [['Pending Accounting', 'accounting', 'Pending Director'],
    ['Pending Director', 'director', 'Approved']]);
eq('management is NOT in it', c._TRAV_STAGES.some(s => s.role === 'management'), false);
eq('and it is NOT the payment-request order', c._TRAV_STAGES[0].role === c._PR_STAGES[0].role, false);
eq('nor the itinerary order', c._TRAV_STAGES[0].role === c._ITIN_STAGES[0].role, false);
eq('editable states', ['Draft', 'Rejected', '', 'Pending Accounting', 'Approved']
   .map(s => [s, c._travEditable(s)]),
   [['Draft', true], ['Rejected', true], ['', true], ['Pending Accounting', false], ['Approved', false]]);
eq('a Draft does NOT hold its receipts', !!c._TRAV_LOCKING['Draft'], false);
eq('but everything past submit does',
   ['Pending Accounting', 'Pending Director', 'Approved'].map(s => !!c._TRAV_LOCKING[s]), [true, true, true]);

console.log('\n== self-approval is refused BY NAME, not by role ==');
{
  const r = { 'Trav No': 'TRAV-1', 'User': 'Rojan Leo R. Francisco Jr.', 'Status': 'Pending Accounting' };
  ok('the workbook\'s own case: the traveller IS the accounting staffer',
     !!c._travMayApprove(r, 'Rojan Leo R. Francisco Jr.', 'accounting'));
  eq('and the message says why',
     /your own travel claim/.test(c._travMayApprove(r, 'Rojan Leo R. Francisco Jr.', 'accounting').message), true);
  eq('a different accounting staffer may', c._travMayApprove(r, 'Someone Else', 'accounting'), null);
  eq('the director may not sign at the accounting stage',
     /Only accounting can approve/.test(c._travMayApprove(r, 'The Director', 'director').message), true);
  const r2 = Object.assign({}, r, { 'Status': 'Pending Director' });
  eq('at the director stage the director may', c._travMayApprove(r2, 'The Director', 'director'), null);
  eq('an Approved record is past approving',
     /Not awaiting approval/.test(c._travMayApprove(
       Object.assign({}, r, { 'Status': 'Approved' }), 'X', 'director').message), true);
}

console.log('\n== ownership, on a positive allow-list ==');
{
  const r = { 'Trav No': 'TRAV-1', 'User': 'Crystal Gayle' };
  eq('the owner may', c._travMayActOn(r, 'Crystal Gayle', 'sales'), null);
  eq('another rep may not', /belongs to Crystal Gayle/.test(c._travMayActOn(r, 'Other Rep', 'sales').message), true);
  eq('accounting may (oversight)', c._travMayActOn(r, 'Acct', 'accounting'), null);
  eq('the director may (oversight)', c._travMayActOn(r, 'Dir', 'director'), null);
  /* The negative test that A211 had to fix on commissions: a role nobody thought about must NOT
     fall through just because it is not 'sales'. */
  ['hr', 'marketing', 'management', ''].forEach(role => {
    ok('a ' + (role || '(blank)') + ' role is refused someone else\'s claim',
       !!c._travMayActOn(r, 'Whoever', role));
  });
}

console.log('\n== reads scope from the SESSION, not from a name the browser sent ==');
eq('no identity at all is refused',
   !!c._travReadScope({ user: 'Crystal Gayle' }).blocked, true);
eq('a rep is pinned to themselves whatever they ask for',
   c._travReadScope({ actorRole: 'sales', actorName: 'Crystal Gayle', user: 'Someone Else' }).scope,
   'Crystal Gayle');
eq('oversight may name anyone',
   c._travReadScope({ actorRole: 'accounting', actorName: 'A', user: 'Crystal Gayle' }).scope, 'Crystal Gayle');
eq('oversight naming nobody sees everything',
   c._travReadScope({ actorRole: 'director', actorName: 'D' }).scope, '');

console.log('\n== the float is effective-dated, and falls back honestly ==');
{
  const f = load(null, { TravelFloats: [], TravelReplenishments: [], TravelReplenishmentItems: [] });
  const none = f._travFloatFor('Crystal Gayle', '2026-08-03');
  eq('nobody issued a float yet -> the default, reported as NOT configured',
     [none.amount, none.configured], [2000, false]);
  f.__store.TravelFloats.push({ 'Float Key': 'TF-1', 'User': 'Crystal Gayle', 'Amount': 2000,
    'Effective From': '2026-01-01', 'Effective To': '', 'Status': 'Active' });
  eq('an active float is found', f._travFloatFor('Crystal Gayle', '2026-08-03').amount, 2000);
  eq('and it is reported as configured', f._travFloatFor('Crystal Gayle', '2026-08-03').configured, true);
  f.__store.TravelFloats.push({ 'Float Key': 'TF-2', 'User': 'Crystal Gayle', 'Amount': 3000,
    'Effective From': '2026-09-01', 'Effective To': '', 'Status': 'Active' });
  eq('a FUTURE raise does not apply to an August week',
     f._travFloatFor('Crystal Gayle', '2026-08-03').amount, 2000);
  eq('but does from September', f._travFloatFor('Crystal Gayle', '2026-09-07').amount, 3000);
  f.__store.TravelFloats.push({ 'Float Key': 'TF-3', 'User': 'Someone Else', 'Amount': 9999,
    'Effective From': '2026-01-01', 'Effective To': '', 'Status': 'Active' });
  eq('another person\'s float is not mine', f._travFloatFor('Crystal Gayle', '2026-09-07').amount, 3000);
  f.__store.TravelFloats.push({ 'Float Key': 'TF-4', 'User': 'New Hire', 'Amount': 1000,
    'Effective From': '2026-01-01', 'Effective To': '', 'Status': 'Requested' });
  eq('a REQUESTED float is not yet held', f._travFloatFor('New Hire', '2026-09-07').configured, false);
}

console.log('\n== the width trap: every sheet round-trips by header name ==');
{
  const w = load(null, { TravelReplenishments: [], TravelReplenishmentItems: [], TravelFloats: [] });
  [['TravelReplenishments', 33], ['TravelReplenishmentItems', 13], ['TravelFloats', 10]].forEach(([sheet, n]) => {
    const arr = w.SCHEMA[sheet].map((h, i) => 'v' + i);
    w._append(sheet, arr);
    const row = w.__store[sheet][0];
    eq(sheet + ': _append arity === schema width', row.__arity, n);
    /* Read back BY HEADER NAME. A value list one short shifts every column after it, and the row
       still looks plausible — this is the check that catches it. */
    const shifted = w.SCHEMA[sheet].filter((h, i) => row[h] !== 'v' + i);
    eq(sheet + ': no column landed in its neighbour\'s cell', shifted, []);
  });
}

process.exit(fail ? 1 : 0);
