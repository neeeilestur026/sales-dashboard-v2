/* A276 — the hire register: what is out, with whom, and when it is due back.
 *
 * Run:  node tests/flow/hire-register.js
 *
 * WHY THIS FILE EXISTS.
 *
 *   1. OVERDUE IS DERIVED. A stored overdue flag is wrong the morning after it is written and nothing
 *      comes along to correct it. Everything here that says "overdue" is computed from the due date
 *      and today, which means it has to be right for a tool due yesterday, due today, and returned
 *      late — three cases that a naive `due < today` gets wrong in two of them.
 *   2. A HIRE IS N TOOLS, NOT ONE. The client returns three of four wrenches; the fourth is still
 *      out and still chased. A register that tracked the agreement instead of the unit cannot say
 *      that, and cannot tell you WHICH wrench is missing.
 *   3. THE DEPOSIT IS SETTLED AT CLOSE. So closing must refuse while anything is still out — closing
 *      over a missing tool is how a deposit gets refunded for a wrench nobody has.
 *   4. A LOST TOOL IS NOT A RETURNED ONE. It gets no return date, or the hire reads as finished with
 *      a tool still missing.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want,
  { got, want });
const section = (t) => console.log('\n' + t);

/* LOCAL date, not UTC. The code asks Utilities.formatDate for "today" and gasload stubs that with
   the local date parts — its own comment says so: "the tests build dates in local time and read them
   back the same way, so a real tz conversion here would make assertions depend on the machine."
   Building these with toISOString() is a UTC date, so on a UTC+8 machine every one of them was a day
   behind what the code called today. That suite passed when it was written and failed the next
   morning, which is worse than not having it: a test that depends on the hour is not a test. */
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

function boot() {
  const store = {
    Hires: [], HireUnits: [],
    SalesOrders: [{ 'SO No': 'SO-900', 'Customer': 'ACME', 'Type': 'Service' }],
    Clients: [{ 'Customer': 'ACME', 'Payment Terms': '30 days' }]
  };
  return { ctx: load(undefined, store), store };
}

const hires = (ctx, params) => call(ctx, 'getHires', params || {}).data || [];
const one = (ctx, no) => hires(ctx).filter(h => h.hireNo === no)[0];

const TWO_TOOLS = JSON.stringify([
  { itemName: 'RAD PNEUMATIC TORQUE WRENCH', qty: 1, assetRef: 'TW-A' },
  { itemName: 'HYDRAULIC TORQUE WRENCH SET', qty: 1, assetRef: 'TW-B' }]);

// ─────────────────────────────────────────────────────────────
section('1 · opening a hire');
{
  const { ctx } = boot();
  const res = call(ctx, 'createHire', { soNo: 'SO-900', customer: 'ACME',
    startDate: day(0), hirePeriod: '7 days', depositHeld: 20000, units: TWO_TOOLS });
  ok('a hire is opened', res.success === true, res);
  const h = one(ctx, res.hireNo);
  eq('it carries both tools', h.unitCount, 2);
  eq('it starts Reserved — nothing has left yet', h.status, 'Reserved');
  eq('the due date is the period after the start', h.dueDate, day(7));
  eq('the deposit is recorded', h.depositHeld, 20000);
  eq('each tool is identifiable', h.units[0].assetRef, 'TW-A');

  const bad = call(ctx, 'createHire', { customer: 'ACME', units: '[]' });
  ok('a hire with no tools is refused', bad.success === false);
  ok('a hire with no customer is refused',
     call(ctx, 'createHire', { units: TWO_TOOLS }).success === false);
  ok('a due date before the start is refused',
     call(ctx, 'createHire', { customer: 'ACME', units: TWO_TOOLS,
       startDate: day(5), dueDate: day(1) }).success === false);
}

// ─────────────────────────────────────────────────────────────
section('2 · the clock starts when the tool leaves');
{
  const { ctx } = boot();
  const no = call(ctx, 'createHire', { customer: 'ACME', startDate: day(-3),
    hirePeriod: '7 days', units: TWO_TOOLS }).hireNo;
  // agreed three days ago; collected today. The seven days run from collection.
  const d = call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1, outDate: day(0), hirePeriod: '7 days' });
  ok('the tool is dispatched', d.success === true, d);
  const h = one(ctx, no);
  eq('its out date is when it left', h.units[0].outDate, day(0));
  eq('and it is due seven days from THEN, not from the agreement', h.units[0].dueDate, day(7));
  eq('the hire now reads On Hire', h.status, 'On Hire');
}

// ─────────────────────────────────────────────────────────────
section('3 · overdue is derived, and the boundaries are the point');
{
  const { ctx } = boot();
  const no = call(ctx, 'createHire', { customer: 'ACME', units: TWO_TOOLS,
    startDate: day(-9), dueDate: day(-2) }).hireNo;
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1, outDate: day(-9), dueDate: day(-2) });
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 2, outDate: day(-9), dueDate: day(0) });
  const h = one(ctx, no);
  ok('a tool due two days ago is overdue', h.units[0].overdue === true);
  eq('  by two days', h.units[0].daysOverdue, 2);
  ok('a tool due TODAY is not overdue yet', h.units[1].overdue === false);
  eq('  and carries no day count', h.units[1].daysOverdue, 0);
  eq('the hire reports how many are late', h.overdueCount, 1);
  eq('  and the worst of them', h.maxDaysOverdue, 2);

  call(ctx, 'returnHireUnit', { hireNo: no, line: 1, returnedDate: day(0), condition: 'Good' });
  const h2 = one(ctx, no);
  ok('a tool returned LATE stops being overdue once it is back', h2.units[0].overdue === false);
  eq('  and the hire stops counting it', h2.overdueCount, 0);
}

// ─────────────────────────────────────────────────────────────
section('4 · a hire is N tools, returned separately');
{
  const { ctx } = boot();
  const no = call(ctx, 'createHire', { customer: 'ACME', units: TWO_TOOLS, dueDate: day(3) }).hireNo;
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1 });
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 2 });
  call(ctx, 'returnHireUnit', { hireNo: no, line: 1, condition: 'Good' });
  const h = one(ctx, no);
  eq('one is back', h.units[0].status, 'Returned');
  eq('one is still out', h.units[1].status, 'Out');
  eq('  and the register says exactly which', h.units[1].assetRef, 'TW-B');
  eq('the hire is still On Hire', h.status, 'On Hire');
  eq('  with one outstanding', h.outCount, 1);

  call(ctx, 'returnHireUnit', { hireNo: no, line: 2, condition: 'Scratched' });
  eq('once both are back the hire reads Returned', one(ctx, no).status, 'Returned');
  eq('  and the condition is on the record', one(ctx, no).units[1].condition, 'Scratched');
}

// ─────────────────────────────────────────────────────────────
section('5 · a lost tool is not a returned one');
{
  const { ctx } = boot();
  const no = call(ctx, 'createHire', { customer: 'ACME', units: TWO_TOOLS,
    startDate: day(-8), dueDate: day(-1) }).hireNo;
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1 });
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 2 });
  const r = call(ctx, 'returnHireUnit', { hireNo: no, line: 1, status: 'Lost', notes: 'left on site' });
  ok('it can be marked lost', r.success === true, r);
  const h = one(ctx, no);
  eq('its status says so', h.units[0].status, 'Lost');
  eq('it has NO return date', h.units[0].returnedDate, '');
  ok('and it is not counted as still out', h.outCount === 1);
  ok('an invented status is refused',
     call(ctx, 'returnHireUnit', { hireNo: no, line: 2, status: 'Maybe' }).success === false);
}

// ─────────────────────────────────────────────────────────────
section('6 · closing settles the deposit, so it refuses over an open tool');
{
  const { ctx } = boot();
  const no = call(ctx, 'createHire', { customer: 'ACME', units: TWO_TOOLS,
    depositHeld: 20000, dueDate: day(5) }).hireNo;
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1 });
  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 2 });

  const refused = call(ctx, 'closeHire', { hireNo: no });
  ok('closing over tools still out is refused', refused.success === false);
  eq('  and says why', refused.needsConfirm, 'unitsStillOut');
  ok('  naming the tools', /TW-A/.test(refused.message) && /TW-B/.test(refused.message), refused.message);

  call(ctx, 'returnHireUnit', { hireNo: no, line: 1, condition: 'Good' });
  call(ctx, 'returnHireUnit', { hireNo: no, line: 2, condition: 'Good' });
  const done = call(ctx, 'closeHire', { hireNo: no, actorName: 'Admin' });
  ok('with everything back it closes', done.success === true, done);
  eq('and stays closed', one(ctx, no).status, 'Closed');

  ok('closing an unknown hire is refused',
     call(ctx, 'closeHire', { hireNo: 'HIRE-NOPE' }).success === false);
}

// ─────────────────────────────────────────────────────────────
section('7 · the awkward calls');
{
  const { ctx } = boot();
  const no = call(ctx, 'createHire', { customer: 'ACME', units: TWO_TOOLS, dueDate: day(3) }).hireNo;
  ok('dispatching a line that does not exist is refused',
     call(ctx, 'dispatchHireUnit', { hireNo: no, line: 99 }).success === false);
  ok('dispatching with no line is refused',
     call(ctx, 'dispatchHireUnit', { hireNo: no }).success === false);
  ok('returning a line that does not exist is refused',
     call(ctx, 'returnHireUnit', { hireNo: no, line: 99 }).success === false);

  call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1 });
  call(ctx, 'returnHireUnit', { hireNo: no, line: 1, condition: 'Good' });
  const again = call(ctx, 'returnHireUnit', { hireNo: no, line: 1, condition: 'Good' });
  ok('returning the same tool twice asks first', again.success === false);
  eq('  with a named confirmation', again.needsConfirm, 'alreadyReturned');
  ok('  and goes through when confirmed',
     call(ctx, 'returnHireUnit', { hireNo: no, line: 1, condition: 'Good',
       confirmReturnAgain: true }).success === true);
  ok('dispatching a tool that already came back is refused',
     call(ctx, 'dispatchHireUnit', { hireNo: no, line: 1 }).success === false);
}

// ─────────────────────────────────────────────────────────────
section('8 · the date arithmetic does not depend on where the server thinks it is');
{
  /* Fixed dates, no "today" — so this section is deterministic at any hour, in any zone.
     WHY IT EXISTS: _addTermDays parses 'YYYY-MM-DD' as UTC MIDNIGHT and then adds days with LOCAL
     date parts. West of UTC those disagree and a seven-day hire came back due on day six. Harmless
     for the AR due dates it was written for, since this project's timezone is east of UTC — but a
     hire's due date is the date a customer gets chased on, and "right as long as nobody moves the
     script timezone" is not a property to rely on.
     Run this file under TZ=America/New_York to see the bug this pins. */
  const { ctx } = boot();
  const add = ctx._hireAddDays;
  eq('seven days on', add('2026-09-12', 7), '2026-09-19');
  eq('across a month end', add('2026-09-28', 7), '2026-10-05');
  eq('across a year end', add('2026-12-29', 5), '2027-01-03');
  eq('a leap day is a real day', add('2028-02-27', 3), '2028-03-01');
  eq('a non-leap February is not', add('2027-02-27', 3), '2027-03-02');
  eq('zero days is the same day', add('2026-09-12', 0), '2026-09-12');
  eq('rubbish in, blank out', add('not a date', 7), '');

  const due = ctx._hireDueDate('2026-09-12', '7 days');
  eq('a hire period reads the number out of the words', due, '2026-09-19');
  eq('  and an unparseable period yields nothing rather than a guess',
     ctx._hireDueDate('2026-09-12', 'ASAP'), '');
}

console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
