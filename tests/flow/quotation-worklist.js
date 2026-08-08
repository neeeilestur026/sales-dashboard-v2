/* A215 — the next-step engine.
 *
 * What this file exists to hold down:
 *   • every quotation lands in EXACTLY ONE group and nothing is dropped — a worklist that silently
 *     loses a deal is worse than the table it replaces;
 *   • the ordering is late-and-large first, because that is the order a rep would pick by hand;
 *   • a client who replied outranks everything, including a rejection;
 *   • a quotation with no send date is neither hidden nor faked — 65 of 72 live rows are in that
 *     state, and sorting them by an invented age would bury real deals under imaginary ones.
 */
const { load } = require('./qwload');

const TODAY = '2026-08-08';
const c = load(TODAY);

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** A quotation, with only the fields the engine reads. */
const Q = (o) => Object.assign({ quotationNo: 'Q-' + Math.random().toString(36).slice(2, 7),
  customer: 'A Client', date: '2026-07-01', total: 100000, status: 'Sent', createdBy: 'Crystal Gayle' }, o);
const step = (q, links, hasSO) => c.quotationWorklistStep(q, links || [], null, hasSO || {}, TODAY);

console.log('== every status maps to one instruction ==');
{
  eq('rejected -> fix', step(Q({ status: 'Rejected', approvedAt: '2026-08-06',
      approvalNote: 'Price is above the ceiling' })).step, 'fix');
  eq('and it carries the reason, because "rejected" alone is not actionable',
     step(Q({ status: 'Rejected', approvedAt: '2026-08-06', approvalNote: 'Price is above the ceiling' })).detail,
     'Price is above the ceiling');

  eq('approved and sitting -> send',
     step(Q({ status: 'Approved', approvedAt: '2026-08-01' })).step, 'send');
  eq('and it says how long it has been sitting',
     step(Q({ status: 'Approved', approvedAt: '2026-08-01' })).line, 'approved 7 days ago, not sent');
  /* Under approvedNotSentDays (2) there is genuinely nothing wrong yet — it must not shout. */
  eq('approved yesterday -> not yet work',
     step(Q({ status: 'Approved', approvedAt: '2026-08-07' })).step, 'wait-client');

  eq('sent and quiet past the threshold -> chase',
     step(Q({ status: 'Sent', sentAt: '2026-07-10' })).step, 'chase');
  eq('sent three days ago -> with the client, nothing to do',
     step(Q({ status: 'Sent', sentAt: '2026-08-05' })).step, 'wait-client');

  eq('pending management -> waiting, not work',
     step(Q({ status: 'Pending Management', date: '2026-08-04' })).step, 'wait-approval');
  eq('and it names who has it',
     step(Q({ status: 'Pending Management', date: '2026-08-04' })).line, 'with management 4 days ago');

  /* The SO map is keyed by quotation number, so a quotation must only be "won" by ITS OWN order —
     not by the mere existence of orders belonging to other deals. */
  eq('somebody else\'s sales order does not win this one',
     step(Q({ quotationNo: 'Q-MINE', status: 'Sent', sentAt: '2026-08-06' }), [], { 'Q-WON': true }).step,
     'wait-client');
  eq('its own does', step(Q({ quotationNo: 'Q-WON', status: 'Sent', sentAt: '2026-08-06' }), [],
     { 'Q-WON': true }).step, 'won');
  eq('not pursued -> done', step(Q({ status: 'Not Pursued' })).step, 'closed');
  eq('a draft -> waiting, with a way in', step(Q({ status: 'Draft', date: '2026-08-06' })).step, 'draft');
}

console.log('\n== a client who replied outranks everything ==');
{
  const replied = step(Q({ status: 'Sent', sentAt: '2026-07-20' }),
                       [{ status: 'Active', sentAt: '2026-07-20', replyAt: '2026-08-05' }]);
  eq('reply -> answer', replied.step, 'answer');
  eq('it says when', replied.line, 'replied 3 days ago');
  ok('and it ranks above a rejection', replied.pri < step(Q({ status: 'Rejected' })).pri,
     [replied.pri, step(Q({ status: 'Rejected' })).pri]);
  ok('above an unsent approval', replied.pri < step(Q({ status: 'Approved', approvedAt: '2026-08-01' })).pri);
  ok('and above a chase', replied.pri < step(Q({ status: 'Sent', sentAt: '2026-07-10' })).pri);
}

console.log('\n== a chase we sent resets the clock (the last-contact rule) ==');
{
  const stale = step(Q({ status: 'Sent', sentAt: '2026-07-10' }));
  eq('untouched since 10 July', stale.step, 'chase');
  const chased = step(Q({ status: 'Sent', sentAt: '2026-07-10' }),
                      [{ status: 'Active', sentAt: '2026-07-10' },
                       { status: 'Active', sentAt: '2026-08-07' }]);   // a chase yesterday
  eq('chased yesterday -> off the worklist', chased.step, 'wait-client');
  ok('because nagging about work just done is how a tracker loses its reader',
     chased.group === 'waiting');
}

console.log('\n== no send date is stated, never guessed ==');
{
  /* 65 of 72 live "Sent" quotations are in exactly this state. */
  const s = step(Q({ status: 'Sent', sentAt: '' }));
  eq('it gets its own step', s.step, 'no-send-date');
  eq('and says so plainly', s.line, 'sent date not recorded');
  eq('with no invented age', s.days, null);
  eq('and no invented lateness — so it cannot outrank a real one', s.overdueBy, 0);
  ok('it is still WORK, not hidden away in waiting', s.group === 'now');
  ok('but it ranks below every deal whose clock is known',
     s.pri > step(Q({ status: 'Sent', sentAt: '2026-07-10' })).pri);
}

console.log('\n== parking a deal takes it off the list, and gives it back ==');
{
  const parked = step(Q({ status: 'Sent', sentAt: '2026-07-01',
                          snoozeUntil: '2026-10-01', snoozeReason: 'Client said call in October' }));
  eq('parked -> waiting', parked.group, 'waiting');
  eq('and it says until when', parked.line, 'parked until 2026-10-01');
  eq('and why, so nobody has to remember', parked.detail, 'Client said call in October');

  const expired = step(Q({ status: 'Sent', sentAt: '2026-07-01', snoozeUntil: '2026-08-01' }));
  eq('an expired park comes back as work', expired.group, 'now');
  eq('as the chase it always was', expired.step, 'chase');

  /* A rejection is the rep's to fix whatever they parked earlier — it must beat the park. */
  const rejectedParked = step(Q({ status: 'Rejected', approvedAt: '2026-08-06',
                                  snoozeUntil: '2026-10-01' }));
  eq('a rejection overrides a park', rejectedParked.step, 'fix');
}

console.log('\n== the ordering: late and large first ==');
{
  const list = c.quotationWorklist([
    Q({ quotationNo: 'A', status: 'Sent', sentAt: '2026-08-01', total: 5000000 }),   // 7d, small lateness
    Q({ quotationNo: 'B', status: 'Sent', sentAt: '2026-06-27', total: 10000 }),     // 42d, very late
    Q({ quotationNo: 'C', status: 'Sent', sentAt: '2026-07-25', total: 900000 }),
    Q({ quotationNo: 'D', status: 'Approved', approvedAt: '2026-08-01' }),
    Q({ quotationNo: 'E', status: 'Rejected', approvedAt: '2026-08-07' }),
    Q({ quotationNo: 'F', status: 'Pending Management', date: '2026-08-05' }),
    Q({ quotationNo: 'G', status: 'Not Pursued' })
  ], {}, null, {}, TODAY);

  eq('the steps come out in priority order',
     list.rows.map(r => r.step),
     ['fix', 'send', 'chase', 'chase', 'chase', 'wait-approval', 'closed']);
  eq('and inside "chase", the latest first — not the largest',
     list.groups.now.filter(r => r.step === 'chase').map(r => r.quotation.quotationNo),
     ['B', 'C', 'A']);

  // Same lateness, different value: the bigger deal wins the tie.
  const tie = c.quotationWorklist([
    Q({ quotationNo: 'SMALL', status: 'Sent', sentAt: '2026-07-01', total: 1000 }),
    Q({ quotationNo: 'BIG', status: 'Sent', sentAt: '2026-07-01', total: 9000000 })
  ], {}, null, {}, TODAY);
  eq('equally late -> the larger deal first', tie.rows.map(r => r.quotation.quotationNo),
     ['BIG', 'SMALL']);
}

console.log('\n== nothing is ever lost ==');
{
  const many = [];
  const statuses = ['Sent', 'Approved', 'Rejected', 'Pending Management', 'Pending Admin',
                    'Not Pursued', 'Lost', 'Cancelled', 'Draft', ''];
  for (let i = 0; i < 60; i++) {
    many.push(Q({ quotationNo: 'Q' + i, status: statuses[i % statuses.length],
                  sentAt: i % 3 ? '2026-07-0' + (i % 9 + 1) : '',
                  approvedAt: '2026-08-0' + (i % 8 + 1), total: i * 1000 }));
  }
  const list = c.quotationWorklist(many, {}, null, {}, TODAY);
  eq('every row is accounted for', list.counts.total, 60);
  eq('and the three groups sum to it',
     list.counts.now + list.counts.waiting + list.counts.done, 60);
  ok('every row has a step that exists in the table',
     list.rows.every(r => !!c.QW_STEPS[r.step]), list.rows.filter(r => !c.QW_STEPS[r.step]).slice(0, 3));
  ok('every row has a group that exists', list.rows.every(r => c.QW_GROUPS.indexOf(r.group) >= 0));
  ok('no row appears in two groups',
     list.groups.now.concat(list.groups.waiting, list.groups.done).length === 60);
  ok('the group values sum to the total value',
     Math.abs((list.value.now + list.value.waiting + list.value.done) -
              list.rows.reduce((s, r) => s + r.value, 0)) < 0.005);
}

console.log('\n== it never throws, whatever the row looks like ==');
{
  const junk = [undefined, null, {}, { quotationNo: null }, { status: {} }, { status: 'Sent', sentAt: 'not a date' },
                { status: 'Sent', sentAt: '2026-13-45' }, { total: 'abc' }, { total: NaN },
                { status: 'Sent', sentAt: '2099-01-01' }, { snoozeUntil: 'nope' },
                { snoozeUntil: '2026-13-99' }];
  let threw = 0;
  junk.forEach((q, i) => {
    try {
      const s = c.quotationWorklistStep(q, [], null, {}, TODAY);
      if (!s || !c.QW_STEPS[s.step]) { fail++; console.log('  FAIL shape #' + i, JSON.stringify(s)); }
    } catch (e) { threw++; console.log('  THREW #' + i, e.message); }
  });
  eq('nothing threw on ' + junk.length + ' malformed rows', threw, 0);
  eq('and a whole malformed list still builds', c.quotationWorklist(junk, {}, null, {}, TODAY).counts.total, junk.length);
  eq('an empty list is an empty worklist, not a crash',
     c.quotationWorklist([], {}, null, {}, TODAY).counts.total, 0);
  eq('and so is no list at all', c.quotationWorklist(null, null, null, null, TODAY).counts.total, 0);

  /* A send date in the future is somebody's typo, not a negative age. */
  const future = c.quotationWorklistStep({ quotationNo: 'F', status: 'Sent', sentAt: '2099-01-01' },
                                         [], null, {}, TODAY);
  ok('a future send date never produces negative lateness', future.overdueBy >= 0, future);
}

console.log('\n== the team view groups by rep, busiest first ==');
{
  const list = c.quotationWorklist([
    Q({ quotationNo: 'A', createdBy: 'Gerald Lucena', status: 'Sent', sentAt: '2026-07-01', total: 100 }),
    Q({ quotationNo: 'B', createdBy: 'Crystal Gayle', status: 'Sent', sentAt: '2026-07-01', total: 100 }),
    Q({ quotationNo: 'C', createdBy: 'Crystal Gayle', status: 'Rejected', approvedAt: '2026-08-06' }),
    Q({ quotationNo: 'D', createdBy: 'Crystal Gayle', status: 'Not Pursued' })
  ], {}, null, {}, TODAY);
  const byRep = c.quotationWorklistByRep(list);
  eq('the rep with the most to do is first', byRep.map(r => r.rep), ['Crystal Gayle', 'Gerald Lucena']);
  eq('and their open work is counted, not their closed', byRep[0].now.length, 2);
  eq('closed work sits apart', byRep[0].done.length, 1);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall good');
process.exit(fail ? 1 : 0);
