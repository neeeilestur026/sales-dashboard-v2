/* A212 steps 3–6 — submit, approve, and the money.
 *
 * The properties this file exists to hold down, in order of what they would cost:
 *   • THE PAYABLE IS ALWAYS `Total Spent` — never the float, never float − spent, and the identity
 *     survives an overspend;
 *   • the payee is the TRAVELLER, never the approver who happened to press the button;
 *   • approving twice does not pay twice, and does not post the expense twice;
 *   • an approval that has raised money cannot be reopened and edited underneath it;
 *   • a signature is never lost to a downstream failure, and a failed payout says so.
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
  ItineraryItems: [], ClientVisits: [], APAging: [], PurchaseOrders: [] });

const GAYLE = { actorName: 'Crystal Gayle', actorRole: 'sales' };
const OTHER = { actorName: 'Other Rep', actorRole: 'sales' };
const ACCT  = { actorName: 'Rojan Leo R. Francisco Jr.', actorRole: 'accounting' };
const DIR   = { actorName: 'Neil M. Estur', actorRole: 'director' };
const MGMT  = { actorName: 'A Manager', actorRole: 'management' };
const with_ = (a, b) => Object.assign({}, a, b);

const SAMPLE = JSON.stringify([
  { seq: 1, date: '2026-07-27', kind: 'Transport', description: 'Residence to Terminal',
    means: 'Tricycle', amount: 35, hasReceipt: false },
  { seq: 2, date: '2026-07-27', kind: 'Transport', description: 'Terminal to Manila',
    means: 'Bus', amount: 70, hasReceipt: true }
]);

/** A context with a float already issued and one saved week, ready to submit. */
function fresh(opts) {
  const o = opts || {};
  const c = load(null, store());
  c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: o.float === undefined ? 2000 : o.float,
                                effectiveFrom: '2026-01-01' }));
  const r = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27',
    purpose: 'Client visit in Makati, City', position: 'Sales Engineer',
    items: o.items || SAMPLE }));
  return { c, no: r.travNo };
}
/** Straight through to Approved. */
function approved(opts) {
  const f = fresh(opts);
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'no itinerary filed yet' }));
  f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no }));
  f.out = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  return f;
}

console.log('== the float is an entitlement, set by the director and effective-dated ==');
{
  const c = load(null, store());
  ok('a rep cannot set their own float', !c.setTravelFloat(with_(GAYLE, { user: 'Crystal Gayle', amount: 5000 })).success);
  ok('nor can accounting', !c.setTravelFloat(with_(ACCT, { user: 'Crystal Gayle', amount: 5000 })).success);
  const a = c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: 2000, effectiveFrom: '2026-01-01' }));
  eq('the director can', a.success, true);
  eq('the row is 10 wide', c.__store.TravelFloats[0].__arity, 10);
  eq('and it is Active', String(c.__store.TravelFloats[0]['Status']), 'Active');
  eq('setting the same figure again changes nothing',
     c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: 2000, effectiveFrom: '2026-02-01' })).unchanged, true);
  eq('still one row', c.__store.TravelFloats.length, 1);

  const b = c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: 3000, effectiveFrom: '2026-09-01' }));
  eq('a RAISE opens a second row', c.__store.TravelFloats.length, 2);
  eq('and closes the first the day BEFORE, so no week has two active floats',
     [String(c.__store.TravelFloats[0]['Effective To']), String(c.__store.TravelFloats[0]['Status'])],
     ['2026-08-31', 'Ended']);
  eq('an August week still reads the old figure', c._travFloatFor('Crystal Gayle', '2026-08-10').amount, 2000);
  eq('a September week reads the new one', c._travFloatFor('Crystal Gayle', '2026-09-07').amount, 3000);
  ok('a zero float is refused', !c.setTravelFloat(with_(DIR, { user: 'X', amount: 0 })).success);
  ok('a nameless float is refused', !c.setTravelFloat(with_(DIR, { amount: 100 })).success);
}

console.log('\n== a BACKDATED float still leaves a clean timeline (the scan found this) ==');
{
  const c = load(null, store());
  c.setTravelFloat(with_(DIR, { user: 'A', amount: 2000, effectiveFrom: '2026-06-01' }));
  c.setTravelFloat(with_(DIR, { user: 'A', amount: 3000, effectiveFrom: '2026-03-01' }));   // EARLIER
  const rows = c.__store.TravelFloats.map(r => [c._num(r['Amount']), String(r['Effective From']),
                                                String(r['Effective To']), String(r['Status'])]);
  /* Closing only "the current row" is not enough: at the backdated date the June float has not
     started, so it is not current, and both rows stayed open-ended and Active. _travFloatFor then
     answered by sheet order. */
  ok('no row ends before it starts', rows.every(r => !r[2] || r[2] >= r[1]), rows);
  eq('exactly one is Active — the latest', rows.filter(r => r[3] === 'Active').length, 1);
  eq('and the earlier one ends the day before the later begins',
     rows.filter(r => r[1] === '2026-03-01')[0][2], '2026-05-31');
  eq('June reads the June float', c._travFloatFor('A', '2026-06-15').amount, 2000);
  /* An ENDED float still counts inside its own window. Filtering on Active alone made a superseded
     float invisible to the weeks it covered — the draft fell back to the company default and submit
     refused a week that had been perfectly well funded at the time. */
  eq('April reads the float that was actually held then', c._travFloatFor('A', '2026-04-15').amount, 3000);
  eq('and reports it as configured, so submit does not refuse a past week',
     c._travFloatFor('A', '2026-04-15').configured, true);
  eq('a REQUESTED float is still not held', c._TRAV_FLOAT_HELD['Requested'], undefined);
}

console.log('\n== two floats on the SAME date: the later one wins outright (the stretch test found this) ==');
{
  const c = load(null, store());
  c.setTravelFloat(with_(DIR, { user: 'A', amount: 2000, effectiveFrom: '2026-05-01' }));
  c.setTravelFloat(with_(DIR, { user: 'A', amount: 2500, effectiveFrom: '2026-05-01' }));   // a correction
  const rows = c.__store.TravelFloats.filter(r => String(r['User']) === 'A');
  eq('both rows are kept — the history is not rewritten', rows.length, 2);
  /* Ending the first the day before the second would give it a window that closes before it opens.
     It never applied for a single day, so it is SUPERSEDED, and superseded is not "held". */
  eq('the first is superseded, not ended', String(rows[0]['Status']), 'Superseded');
  eq('with no window at all', String(rows[0]['Effective To'] || ''), '');
  eq('the second is Active', String(rows[1]['Status']), 'Active');
  eq('and the day itself reads the correction', c._travFloatFor('A', '2026-05-01').amount, 2500);
  ok('no row ends before it starts',
     rows.every(r => !String(r['Effective To'] || '') ||
                     String(r['Effective To']) >= String(r['Effective From'])),
     rows.map(r => [String(r['Effective From']), String(r['Effective To'])]));
}

console.log('\n== 200 legs: the expense components sum to the whole EXACTLY, no float dust ==');
{
  const legs = [];
  for (let i = 1; i <= 200; i++) {
    legs.push({ seq: i, date: '2026-07-27', kind: 'Transport', description: 'Leg ' + i,
                means: 'Bus', amount: 13.37, hasReceipt: false });
  }
  const f = approved({ items: JSON.stringify(legs) });
  const e = f.c.__store.Expenses[0];
  eq('claim', f.c._num(f.c.__store.TravelReplenishments[0]['Total Spent']), 2674);
  eq('payable', f.c._num(f.c.__store.PaymentRequests[0]['Amount']), 2674);
  /* Accumulating 200 legs of 13.37 gives 2673.999999999998. Rounding only the SUM left that dust in
     the component cells, which is the kind of figure somebody screenshots. */
  eq('and the parts add up exactly, not to within a rounding tolerance',
     ['Toll', 'Fuel', 'Meals', 'Load Balance', 'Other'].reduce((s, k) => s + f.c._num(e[k]), 0), 2674);
}

console.log('\n== a payable DELETED after the fact is re-raised, not believed (the scan found this) ==');
{
  const f = approved();
  const dead = String(f.c.__store.PaymentRequests[0]['PR No']);
  f.c.__store.PaymentRequests.length = 0;                   // somebody deletes it; the rep is unpaid
  const retry = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('the retry raises a new one rather than trusting a dead number', retry.success, true);
  eq('one payable again', f.c.__store.PaymentRequests.length, 1);
  ok('and it is a NEW number', String(f.c.__store.PaymentRequests[0]['PR No']) !== dead,
     [dead, String(f.c.__store.PaymentRequests[0]['PR No'])]);
  eq('for the right amount', f.c._num(f.c.__store.PaymentRequests[0]['Amount']), 105);
  eq('still one expense', f.c.__store.Expenses.length, 1);
  eq('and the record points at the live one',
     String(f.c.__store.TravelReplenishments[0]['Payment Request No']),
     String(f.c.__store.PaymentRequests[0]['PR No']));
}

console.log('\n== the float cash goes through the ORDINARY chain — it is an advance, not a refund ==');
{
  const c = load(null, store());
  const f = c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: 2000, effectiveFrom: '2026-01-01' }));
  ok('a rep cannot request it', !c.requestTravelFloatCash(with_(GAYLE, { floatKey: f.floatKey })).success);
  const r = c.requestTravelFloatCash(with_(DIR, { floatKey: f.floatKey }));
  eq('the director can', r.success, true);
  const pr = c.__store.PaymentRequests[0];
  eq('it is a DRAFT — nobody has signed an advance yet', String(pr['Status']), 'Draft');
  eq('payable to the rep', String(pr['Payee']), 'Crystal Gayle');
  eq('for the float amount', c._num(pr['Amount']), 2000);
  eq('the float remembers which request', String(c.__store.TravelFloats[0]['Issue PR No']), r.prNo);
  ok('and asking twice is refused', !c.requestTravelFloatCash(with_(DIR, { floatKey: f.floatKey })).success);
  eq('so there is still one payment request', c.__store.PaymentRequests.length, 1);
}

console.log('\n== submit: the preconditions ==');
{
  const c = load(null, store());
  const empty = c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: '[]' }));
  const e1 = c.submitTravelReplenishment(with_(GAYLE, { travNo: empty.travNo }));
  ok('an empty week cannot be submitted', !e1.success, e1);

  c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE }));
  const e2 = c.submitTravelReplenishment(with_(GAYLE, { travNo: empty.travNo }));
  ok('without a float it is refused', !e2.success, e2);
  eq('and it names the fix rather than the state', e2.needsFloat, true);

  c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: 2000, effectiveFrom: '2026-01-01' }));
  const e3 = c.submitTravelReplenishment(with_(GAYLE, { travNo: empty.travNo }));
  ok('with no approved itinerary a REP still cannot get through', !e3.success, e3);
  eq('but it says a waiver is what is missing', e3.needsWaiver, true);

  const e4 = c.submitTravelReplenishment(with_(GAYLE, { travNo: empty.travNo, waiverReason: 'let me' }));
  ok('and the rep cannot waive it for themselves', !e4.success, e4);

  const e5 = c.submitTravelReplenishment(with_(ACCT, { travNo: empty.travNo, waiverReason: 'no itinerary filed yet' }));
  eq('accounting can', e5.success, true);
  eq('status', String(c.__store.TravelReplenishments[0]['Status']), 'Pending Accounting');
  eq('and the waiver is on the record, with who gave it',
     [String(c.__store.TravelReplenishments[0]['Waiver By']),
      String(c.__store.TravelReplenishments[0]['Waiver Reason'])],
     ['Rojan Leo R. Francisco Jr.', 'no itinerary filed yet']);
  eq('the itinerary status at submit was recorded honestly',
     String(c.__store.TravelReplenishments[0]['Itinerary Status At Submit']), 'none');
}

console.log('\n== an APPROVED itinerary needs no waiver at all ==');
{
  const f = fresh();
  f.c.__store.WeeklyItineraries.push({ 'Itinerary No': 'ITN-1', 'Week Start': '2026-07-27',
    'Week End': '2026-08-02', 'User': 'Crystal Gayle', 'Status': 'Approved' });
  const r = f.c.submitTravelReplenishment(with_(GAYLE, { travNo: f.no }));
  eq('the rep submits their own week unaided', r.success, true);
  eq('and the itinerary is linked', String(f.c.__store.TravelReplenishments[0]['Itinerary No']), 'ITN-1');
  eq('no waiver was recorded', String(f.c.__store.TravelReplenishments[0]['Waiver By']), '');
}

console.log('\n== the chain is ACCOUNTING then DIRECTOR — not management, not the other way round ==');
{
  const f = fresh();
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  ok('the director cannot sign first', !f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no })).success);
  ok('management is not in this chain at all', !f.c.approveTravelReplenishment(with_(MGMT, { travNo: f.no })).success);
  ok('nor is the rep', !f.c.approveTravelReplenishment(with_(GAYLE, { travNo: f.no })).success);
  const a = f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no }));
  eq('accounting signs first', a.status, 'Pending Director');
  ok('and cannot then sign again as the director', !f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no })).success);
  eq('no money yet', f.c.__store.PaymentRequests.length, 0);
  const b = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('the director closes it', b.status, 'Approved');
}

console.log('\n== self-approval is refused BY NAME, whatever the role ==');
{
  // The workbook's own sample traveller IS the accounting staffer who signs the middle block.
  const c = load(null, store());
  c.setTravelFloat(with_(DIR, { user: 'Rojan Leo R. Francisco Jr.', amount: 2000, effectiveFrom: '2026-01-01' }));
  const r = c.saveTravelReplenishment(with_(ACCT, { weekStart: '2026-07-27', items: SAMPLE }));
  c.submitTravelReplenishment(with_(DIR, { travNo: r.travNo, waiverReason: 'no itinerary' }));
  const a = c.approveTravelReplenishment(with_(ACCT, { travNo: r.travNo }));
  ok('the accountant cannot certify their own claim', !a.success, a);
  eq('and is told exactly why', /your own travel claim/i.test(a.message), true);
}

console.log('\n== THE PAYABLE IS `Total Spent` ==');
{
  const f = approved();
  const pr = f.c.__store.PaymentRequests[0];
  eq('one payment request', f.c.__store.PaymentRequests.length, 1);
  eq('for what was SPENT — not the float, not float minus spent', f.c._num(pr['Amount']), 105);
  eq('payable to the TRAVELLER, not the director who approved it', String(pr['Payee']), 'Crystal Gayle');
  eq('type Other — it has no purchase order', String(pr['Type']), 'Other');
  eq('paid in cash', String(pr['Payment Method']), 'Cash');
  eq('and it arrives already Approved, ready to pay', String(pr['Status']), 'Approved');
  eq('the stamps are the ones the travel chain actually collected, not invented',
     [String(pr['Dir Approved By']), String(pr['Admin Approved By'])],
     ['Neil M. Estur', 'Rojan Leo R. Francisco Jr.']);
  eq('the travel record points at it', String(f.c.__store.TravelReplenishments[0]['Payment Request No']), pr['PR No']);
  eq('the reply names it', f.out.prNo, String(pr['PR No']));
  ok('the purpose identifies the week', /2026-07-27/.test(String(pr['Purpose'])), String(pr['Purpose']));
}

console.log('\n== an OVERSPEND is still paid in full — the extra was the rep\'s own money ==');
{
  const f = approved({ items: JSON.stringify([
    { seq: 1, date: '2026-07-27', kind: 'Transport', amount: 2300, hasReceipt: true }]) });
  eq('the payable is the whole 2,300', f.c._num(f.c.__store.PaymentRequests[0]['Amount']), 2300);
  eq('not the float', f.c._num(f.c.__store.TravelReplenishments[0]['Float Amount']), 2000);
  const dto = f.c.getTravelReplenishments(with_(GAYLE, {})).data[0];
  eq('and the rep is shown what they advanced', [dto.remaining, dto.advanced, dto.overspent],
     [0, 300, true]);
}

console.log('\n== ONE expense row, and it reaches the P&L ==');
{
  const f = approved({ items: JSON.stringify([
    { seq: 1, date: '2026-07-27', kind: 'Transport', amount: 100, hasReceipt: false },
    { seq: 2, date: '2026-07-27', kind: 'Meals', amount: 250, hasReceipt: true },
    { seq: 3, date: '2026-07-27', kind: 'Load', amount: 50, hasReceipt: false },
    { seq: 4, date: '2026-07-28', kind: 'Parking/Toll', amount: 80, hasReceipt: true }]) });
  const ex = f.c.__store.Expenses;
  eq('exactly one', ex.length, 1);
  eq('for the whole claim', f.c._num(ex[0]['Amount']), 480);
  eq('broken down by kind',
     ['Toll', 'Meals', 'Load Balance', 'Other'].map(k => f.c._num(ex[0][k])), [80, 250, 50, 100]);
  eq('and the parts sum to the whole',
     f.c._num(ex[0]['Toll']) + f.c._num(ex[0]['Fuel']) + f.c._num(ex[0]['Meals']) +
     f.c._num(ex[0]['Load Balance']) + f.c._num(ex[0]['Other']), f.c._num(ex[0]['Amount']));
  eq('keyed for idempotency', String(ex[0]['Legacy Key']), 'TRAV:' + f.no);
  eq('under a category the expense report already knows',
     String(ex[0]['Category']), 'Transportation and Travel');
  eq('and it is Operating expense, so it hits the P&L', String(ex[0]['Type']), 'Operating');
}

console.log('\n== approving twice does not pay twice ==');
{
  const f = approved();
  const again = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  ok('the second approval is refused', !again.success, again);
  eq('one payment request', f.c.__store.PaymentRequests.length, 1);
  eq('one expense row', f.c.__store.Expenses.length, 1);
  // and the same through the dispatcher, which is where a double-click actually lands
  eq('accounting cannot re-approve it either',
     f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no })).success, false);
}

console.log('\n== a failed payout does not cost the signature, and retry is idempotent ==');
{
  const f = fresh();
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no }));

  const realCreate = f.c.createPaymentRequest;
  f.c.createPaymentRequest = function () { throw new Error('Drive is having a moment'); };
  const bad = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('the approval still succeeded', bad.success, true);
  eq('the record IS approved — the signature was given', String(f.c.__store.TravelReplenishments[0]['Status']), 'Approved');
  ok('but it says the payout failed rather than implying it worked', !!bad.payableFailed, bad);
  ok('and the message tells the approver what to do', /retry/i.test(bad.message), bad.message);
  eq('no payment request exists', f.c.__store.PaymentRequests.length, 0);
  eq('and no expense was posted either', f.c.__store.Expenses.length, 0);

  f.c.createPaymentRequest = realCreate;
  const fixed = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('the retry raises it', fixed.success, true);
  eq('one payment request now', f.c.__store.PaymentRequests.length, 1);
  eq('one expense', f.c.__store.Expenses.length, 1);
  eq('for the right amount', f.c._num(f.c.__store.PaymentRequests[0]['Amount']), 105);
  ok('and a third call is refused', !f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no })).success);
  eq('still one of each',
     [f.c.__store.PaymentRequests.length, f.c.__store.Expenses.length], [1, 1]);
}

console.log('\n== an expense that fails leaves the payable standing, and only the expense retries ==');
{
  const f = fresh();
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no }));
  const realAdd = f.c.addExpense;
  f.c.addExpense = function () { throw new Error('the sheet is locked'); };
  const half = f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('the payable was raised', f.c.__store.PaymentRequests.length, 1);
  eq('the expense was not', f.c.__store.Expenses.length, 0);
  ok('and it is reported', !!half.payableFailed, half);
  f.c.addExpense = realAdd;
  f.c.approveTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('the retry posts the expense', f.c.__store.Expenses.length, 1);
  eq('and does NOT raise a second payable', f.c.__store.PaymentRequests.length, 1);
}

console.log('\n== reject, and the way back ==');
{
  const f = fresh();
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  ok('a reason is required', !f.c.rejectTravelReplenishment(with_(ACCT, { travNo: f.no })).success);
  ok('a rep cannot reject', !f.c.rejectTravelReplenishment(with_(GAYLE, { travNo: f.no, reason: 'no' })).success);
  const r = f.c.rejectTravelReplenishment(with_(ACCT, { travNo: f.no, reason: 'Bus fare looks high — attach the ticket.' }));
  eq('accounting can', r.success, true);
  eq('status', String(f.c.__store.TravelReplenishments[0]['Status']), 'Rejected');
  eq('the reason is on the record',
     String(f.c.__store.TravelReplenishments[0]['Approval Note']), 'Bus fare looks high — attach the ticket.');
  eq('a rejected week is editable again',
     f.c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE })).success, true);
  eq('and nothing was paid', f.c.__store.PaymentRequests.length, 0);
}

console.log('\n== THE UNWIND: an approval that raised money cannot be reopened underneath it ==');
{
  const f = approved();
  const rev = f.c.reviseTravelReplenishment(with_(DIR, { travNo: f.no }));
  ok('reopening is refused while the payable stands', !rev.success, rev);
  ok('and it names the payment request', /PR-|payment request/i.test(rev.message), rev.message);
  eq('the week is still Approved', String(f.c.__store.TravelReplenishments[0]['Status']), 'Approved');
  eq('and still not editable',
     f.c.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE })).success, false);

  // Reject the payment request, and the way back opens.
  f.c._prSet(String(f.c.__store.PaymentRequests[0]['PR No']), { 'Status': 'Rejected' });
  const rev2 = f.c.reviseTravelReplenishment(with_(DIR, { travNo: f.no }));
  eq('with the payable rejected it reopens', rev2.success, true);
  eq('as a Draft', String(f.c.__store.TravelReplenishments[0]['Status']), 'Draft');
  eq('with EVERY stamp cleared',
     ['Acct Approved By', 'Acct Approved At', 'Dir Approved By', 'Dir Approved At',
      'Waiver By', 'Payment Request No', 'Submitted At']
       .map(k => String(f.c.__store.TravelReplenishments[0][k] || '')), ['', '', '', '', '', '', '']);
}

console.log('\n== a rep may withdraw their own week, but only before anyone signs ==');
{
  const f = fresh();
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  eq('at Pending Accounting the rep can pull it back',
     f.c.reviseTravelReplenishment(with_(GAYLE, { travNo: f.no })).success, true);

  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no }));
  const late = f.c.reviseTravelReplenishment(with_(GAYLE, { travNo: f.no }));
  ok('once accounting has signed, they cannot', !late.success, late);
  eq('but an approver can', f.c.reviseTravelReplenishment(with_(ACCT, { travNo: f.no })).success, true);
  ok('and another rep can never touch it',
     !f.c.reviseTravelReplenishment(with_(OTHER, { travNo: f.no })).success);
}

console.log('\n== the float cannot move under a claim without the approver seeing it ==');
{
  const f = fresh();
  f.c.submitTravelReplenishment(with_(ACCT, { travNo: f.no, waiverReason: 'x' }));
  f.c.setTravelFloat(with_(DIR, { user: 'Crystal Gayle', amount: 5000, effectiveFrom: '2026-07-01' }));
  const a = f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no }));
  ok('approval stops and asks', !a.success, a);
  eq('naming both figures', [a.storedFloat, a.liveFloat], [2000, 5000]);
  eq('and it goes through once confirmed',
     f.c.approveTravelReplenishment(with_(ACCT, { travNo: f.no, confirmFloatChanged: true })).success, true);
}

console.log('\n== deleting an approved week is refused — the money is already out ==');
{
  const f = approved();
  ok('refused', !f.c.deleteTravelReplenishment(with_(DIR, { travNo: f.no })).success);
  eq('the payable survives', f.c.__store.PaymentRequests.length, 1);
}

console.log('\n== registration ==');
{
  const c = load(null, store());
  ['submitTravelReplenishment', 'approveTravelReplenishment', 'rejectTravelReplenishment',
   'reviseTravelReplenishment', 'setTravelFloat', 'requestTravelFloatCash', 'getTravelFloats']
    .forEach(a => ok(a + ' is in HANDLERS', typeof c.HANDLERS[a] === 'function'));
  ['submitTravelReplenishment', 'approveTravelReplenishment', 'rejectTravelReplenishment',
   'reviseTravelReplenishment', 'setTravelFloat', 'requestTravelFloatCash'].forEach(a => {
    ok(a + ' takes the script lock', !!c.MUTATIONS[a]);
    ok(a + ' leaves an audit row', !!c._MODULE_MAP[a]);
  });
  ok('getTravelFloats is a READ — no lock, no audit row',
     !c.MUTATIONS.getTravelFloats && !c._MODULE_MAP.getTravelFloats);
  ['submitTravelReplenishment', 'approveTravelReplenishment', 'rejectTravelReplenishment',
   'reviseTravelReplenishment', 'setTravelFloat', 'requestTravelFloatCash', 'getTravelFloats']
    .forEach(a => ok(a + ' is secured', !!c._SECURED[a]));
}

console.log('\n== the dispatcher enforces the whole surface ==');
{
  const h = load(null, store());
  h.__props['FLOW_MUTATION_SECRET'] = 's3cret';
  ['submitTravelReplenishment', 'approveTravelReplenishment', 'rejectTravelReplenishment',
   'reviseTravelReplenishment', 'setTravelFloat', 'requestTravelFloatCash', 'getTravelFloats']
    .forEach(a => {
      const r = call(h, a, with_(DIR, { travNo: 'X', floatKey: 'X', user: 'Y', amount: 1, reason: 'z' }));
      ok(a + ' needs the server secret', /must be performed through the app/.test(r.message || ''), r);
    });
  eq('nothing reached any sheet',
     [h.__store.TravelFloats.length, h.__store.PaymentRequests.length, h.__store.Expenses.length], [0, 0, 0]);
  eq('and with the secret it works',
     call(h, 'setTravelFloat', with_(DIR, { user: 'Crystal Gayle', amount: 2000,
       effectiveFrom: '2026-01-01', flowSecret: 's3cret' })).success, true);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall good');
process.exit(fail ? 1 : 0);
