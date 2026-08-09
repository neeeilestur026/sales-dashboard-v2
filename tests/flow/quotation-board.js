/* A217 — the board is a PROJECTION of the worklist, never a second opinion.
 *
 * What this file exists to hold down:
 *   • every quotation lands in exactly one column and the counts sum to the input — a board that
 *     silently drops a deal is worse than the table it replaces, and worse than the worklist it
 *     claims to agree with;
 *   • the board and the worklist never disagree: for every row, the column is derived from the step
 *     the worklist already assigned, so a change to one moves the other;
 *   • `wait-client` really is pulled back apart — the step that means BOTH "approved, not due yet"
 *     and "sent, sitting quietly" must not put an unsent quotation in the client's column;
 *   • a drag only fires an action the backend actually has, and a refused drag says why.
 *
 * The model is loaded together with flow-api.js and quotation-worklist.js in ONE vm context, because
 * quotationWorklist calls flowFollowUp / flowQuotationBucket directly and the point is to exercise
 * the real wiring rather than stubs that can drift from it.
 */
const { load } = require('./qwload');

const TODAY = '2026-08-09';
const c = load(TODAY);

// The model has no flow-api dependency, so it is required directly rather than through the vm.
const M = require('../../dashboard/js/quotation-board-model.js');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

let _n = 0;
const Q = (o) => Object.assign({ quotationNo: 'Q-' + (++_n), customer: 'A Client', date: '2026-07-01',
  total: 100000, status: 'Sent', createdBy: 'Crystal Gayle' }, o);
const board = (qs, hasSO) => M.quotationBoard(c.quotationWorklist(qs, {}, null, hasSO || {}, TODAY));
const colOf = (q, hasSO) => M.quotationBoardColumn(
  Object.assign({ quotation: q }, c.quotationWorklistStep(q, [], null, hasSO || {}, TODAY)));

console.log('== each state lands in the column a person would point at ==');
{
  eq('a draft',              colOf(Q({ status: 'Draft' })), 'draft');
  eq('waiting on admin',     colOf(Q({ status: 'Pending Admin', date: '2026-08-06' })), 'approval');
  eq('waiting on management', colOf(Q({ status: 'Pending Management', date: '2026-08-06' })), 'approval');
  eq('sent back to the rep', colOf(Q({ status: 'Rejected', approvedAt: '2026-08-06' })), 'sent-back');
  eq('approved and overdue to send', colOf(Q({ status: 'Approved', approvedAt: '2026-08-01' })), 'approved');
  eq('sent and gone quiet',  colOf(Q({ status: 'Sent', sentAt: '2026-07-01' })), 'client');
  eq('sent recently',        colOf(Q({ status: 'Sent', sentAt: '2026-08-08' })), 'client');
  eq('closed',               colOf(Q({ status: 'Not Pursued' })), 'closed');
  // An order exists for SOME OTHER quotation — this one is untouched. (Named explicitly: an
  // auto-numbered fixture once collided with its own hasSO key and made this pass for the wrong
  // reason.)
  eq('someone else\'s sales order changes nothing',
     colOf(Q({ quotationNo: 'Q-NO-SO', status: 'Sent' }), { 'Q-SOMEONE-ELSE': 1 }), 'client');
}
{
  const q = Q({ quotationNo: 'Q-WON', status: 'Sent' });
  eq('...and WITH its own order it is Won', colOf(q, { 'Q-WON': 1 }), 'won');
}

console.log('\n== the wait-client ambiguity is pulled back apart ==');
{
  /* Both of these come back from the worklist as the SAME step. On a board they are two different
     places: one we are still holding, one the client is holding. */
  const held = Q({ status: 'Approved', approvedAt: '2026-08-08' });   // approved yesterday, not yet due
  const gone = Q({ status: 'Sent', sentAt: '2026-08-08' });           // sent yesterday, nothing wrong
  eq('both are the same worklist step',
     [c.quotationWorklistStep(held, [], null, {}, TODAY).step,
      c.quotationWorklistStep(gone, [], null, {}, TODAY).step], ['wait-client', 'wait-client']);
  eq('but the unsent one is still ours', colOf(held), 'approved');
  eq('and the sent one is the client\'s', colOf(gone), 'client');
}

console.log('\n== a parked quotation stays where it is, it does not leave the pipeline ==');
{
  const parked = Q({ status: 'Sent', sentAt: '2026-07-01', snoozeUntil: '2026-10-01', snoozeReason: 'call us in October' });
  eq('still with the client', colOf(parked), 'client');
}

console.log('\n== nothing is dropped and nothing is counted twice ==');
{
  const qs = [
    Q({ status: 'Draft' }),
    Q({ status: 'Pending Admin', date: '2026-08-06' }),
    Q({ status: 'Rejected', approvedAt: '2026-08-06' }),
    Q({ status: 'Approved', approvedAt: '2026-08-01' }),
    Q({ status: 'Sent', sentAt: '2026-07-01' }),
    Q({ status: 'Not Pursued' }),
    Q({ quotationNo: 'Q-SO', status: 'Sent', sentAt: '2026-07-01' })
  ];
  const b = board(qs, { 'Q-SO': 1 });
  eq('every quotation is on the board once', b.total, qs.length);
  eq('the columns sum to the input', b.columns.reduce((s, x) => s + x.rows.length, 0), qs.length);
  eq('and each is in exactly one', new Set(b.columns.flatMap(x => x.rows.map(r => r.quotation.quotationNo))).size, qs.length);
  eq('seven columns, always, even the empty ones', b.columns.length, 7);
  eq('in pipeline order', b.columns.map(x => x.key),
     ['draft', 'sent-back', 'approval', 'approved', 'client', 'won', 'closed']);
}
{
  const b = board([]);
  eq('an empty book is an empty board, not a crash', b.total, 0);
  eq('the columns are still drawn', b.columns.length, 7);
  eq('and every value is zero', b.columns.map(x => x.value), [0, 0, 0, 0, 0, 0, 0]);
}
{
  const b = M.quotationBoard(null);
  eq('a null list does not throw', b.total, 0);
  eq('an unplaceable row is visible, not lost', M.quotationBoardColumn({ step: 'nonsense' }), 'draft');
  eq('and so is a null row', M.quotationBoardColumn(null), 'draft');
}

console.log('\n== column value is the money, so a header can say something a count cannot ==');
{
  const b = board([Q({ status: 'Sent', sentAt: '2026-07-01', total: 1000000 }),
                   Q({ status: 'Sent', sentAt: '2026-07-01', total: 500000 })]);
  const client = b.columns.find(x => x.key === 'client');
  eq('two quotations', client.count, 2);
  eq('and their combined value', client.value, 1500000);
  eq('the board total agrees', b.value, 1500000);
}

console.log('\n== drags: only real transitions, and a refusal explains itself ==');
{
  eq('draft to approval submits it', M.quotationBoardMove('draft', 'approval').action, 'submitQuotationApproval');
  eq('sent back to approval resubmits', M.quotationBoardMove('sent-back', 'approval').action, 'submitQuotationApproval');
  eq('approved to client sends it', M.quotationBoardMove('approved', 'client').action, 'sendQuotation');
  eq('with the client to closed closes it', M.quotationBoardMove('client', 'closed').action, 'closeQuotation');
  ok('and closing asks why', M.quotationBoardMove('client', 'closed').needsReason === true);
  eq('closed back to draft reopens', M.quotationBoardMove('closed', 'draft').action, 'reopenQuotation');
}
{
  /* Approving by drag would be a second, weaker approval path — it would bypass the stale-PDF gate
     and the pricing review that the real one is built on. */
  const m = M.quotationBoardMove('approval', 'approved');
  ok('you cannot approve by dragging', !m.ok);
  ok('and it says where to go instead', /review/i.test(m.reason), m.reason);
}
{
  const m = M.quotationBoardMove('client', 'won');
  ok('you cannot declare a win by hand', !m.ok);
  ok('because a sales order is what makes it true', /sales order/i.test(m.reason), m.reason);
}
{
  const m = M.quotationBoardMove('client', 'draft');
  ok('sending a live quotation back to draft is refused', !m.ok);
  ok('and points at Revise, which clears the approvals on purpose', /revise/i.test(m.reason), m.reason);
}
{
  eq('a drag onto its own column is a no-op', M.quotationBoardMove('client', 'client'), null);
  eq('and so is a drag from nowhere', M.quotationBoardMove(null, 'client'), null);
}

console.log('\n== the board agrees with the worklist, row for row ==');
{
  /* The property that matters most: for every quotation, the column is a function of the step the
     worklist already chose. If someone changes a rule in quotation-worklist.js, the board follows —
     it cannot quietly hold a different opinion. */
  const qs = [Q({ status: 'Draft' }), Q({ status: 'Rejected', approvedAt: '2026-08-01' }),
              Q({ status: 'Pending Management', date: '2026-08-01' }),
              Q({ status: 'Approved', approvedAt: '2026-08-01' }),
              Q({ status: 'Sent', sentAt: '2026-07-01' }), Q({ status: 'Lost' })];
  const list = c.quotationWorklist(qs, {}, null, {}, TODAY);
  const b = M.quotationBoard(list);
  const placed = {};
  b.columns.forEach(col => col.rows.forEach(r => { placed[r.quotation.quotationNo] = col.key; }));
  const derived = {};
  list.rows.forEach(r => { derived[r.quotation.quotationNo] = M.quotationBoardColumn(r); });
  // Compared as sorted pairs: two maps with the same content but different insertion order are the
  // same answer, and JSON.stringify would call them different.
  const pairs = o => Object.keys(o).sort().map(k => k + '=' + o[k]);
  eq('every card sits where its own step says it should', pairs(placed), pairs(derived));
  eq('and the worklist total is the board total', list.rows.length, b.total);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
