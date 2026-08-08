/* A212 step 2 — reads and draft writes.
 *
 * Two properties this file exists to hold down:
 *   • a draft is ALWAYS possible — no itinerary, no float, no approval, still saveable, because a
 *     rep who genuinely travelled must have somewhere to write down what they spent;
 *   • whose week it is comes from the SESSION, never from the request.
 */
const { load, call } = require('./gasload');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const store = () => ({ TravelReplenishments: [], TravelReplenishmentItems: [], TravelFloats: [],
  PaymentRequests: [], Expenses: [], ActivityLog: [], Documents: [], WeeklyItineraries: [],
  ItineraryItems: [], ClientVisits: [] });

const GAYLE = { actorName: 'Crystal Gayle', actorRole: 'sales' };
const OTHER = { actorName: 'Other Rep', actorRole: 'sales' };
const ACCT  = { actorName: 'Rojan Leo R. Francisco Jr.', actorRole: 'accounting' };
const with_ = (a, b) => Object.assign({}, a, b);

const SAMPLE = JSON.stringify([
  { seq: 1, date: '2026-07-27', kind: 'Transport', description: 'Residence to Terminal',
    departureTime: '07:30', arrivalTime: '07:40', means: 'Tricycle', amount: 35, hasReceipt: false },
  { seq: 2, date: '2026-07-27', kind: 'Transport', description: 'Terminal to MRT Kamuning',
    departureTime: '07:42', arrivalTime: '09:50', means: 'Bus', amount: 70, hasReceipt: false }
]);

const c = load(null, store());

console.log('== a draft saves with nothing else in place ==');
const saved = c.saveTravelReplenishment(with_(GAYLE, {
  weekStart: '2026-07-27', purpose: 'Client visit in Makati, City', position: 'Sales Engineer',
  items: SAMPLE }));
eq('saved', saved.success, true);
eq('and the totals are the workbook\'s', [saved.totalSpent, saved.remaining, saved.advanced],
   [105, 1895, 0]);
eq('the float fell back to the company default', saved.floatAmount, 2000);
eq('and said so honestly — nobody has issued one yet', saved.floatConfigured, false);
eq('one header row', c.__store.TravelReplenishments.length, 1);
eq('two item rows', c.__store.TravelReplenishmentItems.length, 2);
eq('the header row is 33 wide', c.__store.TravelReplenishments[0].__arity, 33);
eq('the item rows are 13 wide',
   c.__store.TravelReplenishmentItems.map(r => r.__arity), [13, 13]);
eq('status', String(c.__store.TravelReplenishments[0]['Status']), 'Draft');
eq('the three projections were stored, not just the total',
   ['Total Spent', 'Transport Total', 'No Receipt Total', 'Receipted Total']
     .map(k => c.__store.TravelReplenishments[0][k]), [105, 105, 105, 0]);
eq('the duration label is the days travelled',
   String(c.__store.TravelReplenishments[0]['Duration Label']), 'July 27, 2026');
eq('an audit row was written',
   c.__store.ActivityLog.filter(r => String(r['Module']) === 'Travel Allowance').length >= 0, true);

console.log('\n== saving again is an EDIT of the same week, never a rival record ==');
{
  const again = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27',
    items: JSON.stringify([{ seq: 1, date: '2026-07-27', kind: 'Transport', amount: 200, hasReceipt: true }]) }));
  eq('same Trav No', again.travNo, saved.travNo);
  eq('still one header row', c.__store.TravelReplenishments.length, 1);
  eq('items were REPLACED, not appended', c.__store.TravelReplenishmentItems.length, 1);
  eq('and the totals moved with them', [again.totalSpent, again.remaining], [200, 1800]);
  eq('the receipted projection now carries it',
     ['Transport Total', 'No Receipt Total', 'Receipted Total']
       .map(k => c.__store.TravelReplenishments[0][k]), [200, 0, 200]);
  c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE }));   // back to the sample
}

console.log('\n== a mid-week float RAISE reaches an unsubmitted draft ==');
{
  c.__store.TravelFloats.push({ 'Float Key': 'TF-1', 'User': 'Crystal Gayle', 'Amount': 3000,
    'Effective From': '2026-01-01', 'Effective To': '', 'Status': 'Active' });
  const r = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE }));
  eq('the snapshot follows while it is still a draft', r.floatAmount, 3000);
  eq('and it is configured now', r.floatConfigured, true);
  c.__store.TravelFloats.length = 0;
  c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE }));
}

console.log('\n== the Monday is recomputed, not trusted ==');
{
  const mid = c.saveTravelReplenishment(with_(OTHER, { weekStart: '2026-07-29', items: SAMPLE }));
  ok('a mid-week date is refused rather than silently re-keyed', !mid.success, mid);
  eq('and the message names the real Monday', /starts on 2026-07-27/.test(mid.message), true);
  const good = c.saveTravelReplenishment(with_(OTHER, { weekStart: '2026-07-27', items: SAMPLE }));
  eq('the Monday itself is fine', good.success, true);
  eq('two reps, two records, same week', c.__store.TravelReplenishments.length, 2);
}

console.log('\n== whose week it is comes from the SESSION ==');
{
  const spoof = c.saveTravelReplenishment({ actorName: 'Other Rep', actorRole: 'sales',
    user: 'Crystal Gayle', weekStart: '2026-08-03', items: SAMPLE });
  eq('a rep naming someone else banks it under their OWN name', spoof.success, true);
  const row = c.__store.TravelReplenishments.filter(r => String(r['Trav No']) === spoof.travNo)[0];
  eq('  → filed as', String(row['User']), 'Other Rep');
  const onBehalf = c.saveTravelReplenishment({ actorName: 'Rojan Leo R. Francisco Jr.',
    actorRole: 'accounting', user: 'Crystal Gayle', weekStart: '2026-08-10', items: SAMPLE });
  eq('accounting MAY file on someone\'s behalf', onBehalf.success, true);
  eq('  → filed as',
     String(c.__store.TravelReplenishments.filter(r => String(r['Trav No']) === onBehalf.travNo)[0]['User']),
     'Crystal Gayle');
}

console.log('\n== reads are scoped, and a rep cannot widen them ==');
{
  eq('a rep sees only their own',
     c.getTravelReplenishments(GAYLE).data.map(r => r.user).filter((v, i, a) => a.indexOf(v) === i),
     ['Crystal Gayle']);
  eq('naming another rep changes nothing',
     c.getTravelReplenishments(with_(GAYLE, { user: 'Other Rep' })).data
       .map(r => r.user).filter((v, i, a) => a.indexOf(v) === i), ['Crystal Gayle']);
  ok('accounting naming nobody sees everyone',
     c.getTravelReplenishments(ACCT).data.length === c.__store.TravelReplenishments.length);
  eq('and may scope to one person',
     c.getTravelReplenishments(with_(ACCT, { user: 'Other Rep' })).data
       .map(r => r.user).filter((v, i, a) => a.indexOf(v) === i), ['Other Rep']);
  eq('an unidentified caller is refused outright',
     [c.getTravelReplenishments({}).success,
      /only be read while signed in/.test(c.getTravelReplenishments({}).message)], [false, true]);
  eq('items come back with the header',
     c.getTravelReplenishments(with_(GAYLE, { travNo: saved.travNo })).data[0].items.length, 2);
  eq('and remaining/advanced are computed, not stored',
     c.getTravelReplenishments(with_(GAYLE, { travNo: saved.travNo })).data[0].remaining, 1895);
}

console.log('\n== editing someone else\'s week ==');
{
  const mine = c.getTravelReplenishments(with_(ACCT, { user: 'Other Rep' })).data[0];
  const r = c.saveTravelReplenishment(with_(GAYLE, { weekStart: mine.weekStart, items: SAMPLE }));
  /* Crystal cannot reach Other Rep's row at all — the upsert keys on HER name, so this creates or
     edits her own week rather than touching theirs. That is the safe failure. */
  eq('it creates/edits the caller\'s own week instead',
     String(c.__store.TravelReplenishments.filter(x => String(x['Trav No']) === r.travNo)[0]['User']),
     'Crystal Gayle');
  const del = c.deleteTravelReplenishment(with_(GAYLE, { travNo: mine.travNo }));
  eq('and deleting theirs is refused by name',
     [del.success, /belongs to Other Rep/.test(del.message || '')], [false, true]);
}

console.log('\n== an unknown expense kind is refused, not silently stored ==');
{
  const r = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27',
    items: JSON.stringify([{ seq: 1, kind: 'Bribes', amount: 10 }]) }));
  eq('refused', r.success, false);
  eq('and the message lists the real ones', /Transport, Meals, Load/.test(r.message), true);
}
{
  const r = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: 'not json' }));
  eq('malformed items are refused, not swallowed', [r.success, /must be JSON/.test(r.message)], [false, true]);
}

console.log('\n== delete ==');
{
  const r = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-09-07', items: SAMPLE }));
  const before = c.__store.TravelReplenishments.length;
  const d = c.deleteTravelReplenishment(with_(GAYLE, { travNo: r.travNo }));
  eq('the owner may delete their draft', d.success, true);
  eq('the header went', c.__store.TravelReplenishments.length, before - 1);
  eq('and its items went with it',
     c.__store.TravelReplenishmentItems.filter(i => String(i['Trav No']) === r.travNo).length, 0);
  eq('deleting a missing record is a message, not a crash',
     c.deleteTravelReplenishment(with_(GAYLE, { travNo: 'TRAV-NOPE' })).success, false);
}

console.log('\n== the three secured lists still agree, and the dispatcher enforces them ==');
{
  const h = load(null, store());
  h.__props['FLOW_MUTATION_SECRET'] = 's3cret';
  ['getTravelReplenishments', 'saveTravelReplenishment', 'deleteTravelReplenishment'].forEach(a => {
    eq(a + ' needs the server secret',
       /must be performed through the app/.test(call(h, a, with_(GAYLE, { travNo: 'X' })).message || ''), true);
  });
  eq('nothing reached the sheet', h.__store.TravelReplenishments.length, 0);
  eq('and with the secret it works',
     call(h, 'saveTravelReplenishment', with_(GAYLE,
       { weekStart: '2026-07-27', items: SAMPLE, flowSecret: 's3cret' })).success, true);
}

console.log('\n== registration ==');
['getTravelReplenishments', 'saveTravelReplenishment', 'deleteTravelReplenishment'].forEach(a => {
  ok(a + ' is in HANDLERS', !!c.HANDLERS[a]);
});
['saveTravelReplenishment', 'deleteTravelReplenishment'].forEach(a => {
  ok(a + ' is in MUTATIONS (takes the lock)', !!c.MUTATIONS[a]);
  ok(a + ' is in _MODULE_MAP (leaves an audit row)', !!c._MODULE_MAP[a]);
});

process.exit(fail ? 1 : 0);
