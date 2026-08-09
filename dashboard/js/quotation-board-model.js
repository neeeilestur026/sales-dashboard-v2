/* A217 — which column a quotation belongs in. Pure, DOM-free, table-tested.
 *
 * This deliberately does NOT decide anything. Every judgement was already made by
 * quotationWorklistStep (quotation-worklist.js): what state a quotation is in, how late it is, what
 * the rep must do. All this does is map the eleven steps onto seven columns and add them up.
 *
 * That constraint is the whole point. A board and a worklist that each decided "is this quotation
 * still live?" for themselves would disagree inside a week — A208 is the local precedent, where three
 * copies of one KPI differed by eight million pesos on a single screen. So the board is a projection
 * of the worklist, never a second opinion about it.
 *
 * The one genuine subtlety: the `wait-client` step covers TWO different pipeline positions. A
 * quotation approved and not yet due to be sent, and a quotation already sent and sitting quietly,
 * both come back as `wait-client` because from the rep's point of view neither is work right now
 * (quotation-worklist.js:129 and :148). A board is about position, not workload, so they must be
 * pulled apart again — and status is what separates them.
 */

const QB_COLUMNS = [
  { key: 'draft',     label: 'Draft',        sub: 'not submitted',      steps: ['draft'] },
  { key: 'sent-back', label: 'Sent back',    sub: 'fix and resubmit',   steps: ['fix'] },
  { key: 'approval',  label: 'In approval',  sub: 'with us',            steps: ['wait-approval'] },
  { key: 'approved',  label: 'Approved',     sub: 'ready to send',      steps: ['send'] },
  { key: 'client',    label: 'With the client', sub: 'waiting on them',
    steps: ['answer', 'chase', 'no-send-date', 'snoozed'] },
  { key: 'won',       label: 'Won',          sub: 'became an order',    steps: ['won'] },
  { key: 'closed',    label: 'Closed',       sub: 'not pursued',        steps: ['closed'] }
];

/** step -> column, for the ten steps that map unambiguously. */
const _QB_BY_STEP = (function () {
  const m = {};
  QB_COLUMNS.forEach(c => c.steps.forEach(s => { m[s] = c.key; }));
  return m;
})();

/**
 * Which column does one worklist row belong in?
 * @param {object} row a row from quotationWorklist().rows — {step, quotation, …}
 * @returns {string} a QB_COLUMNS key. Never null: an unrecognised step lands in 'draft' rather than
 *          vanishing, because a card the board cannot place must still be visible somewhere.
 */
function quotationBoardColumn(row) {
  const r = row || {};
  const step = String(r.step || '');
  if (step === 'wait-client') {
    /* The ambiguous one. 'Approved' means we are still holding it; anything else means it has gone
       out and the wait is the client's. Read from status rather than re-deriving the bucket, so this
       cannot drift from flowQuotationBucket without the status itself changing. */
    return String((r.quotation || {}).status || '') === 'Approved' ? 'approved' : 'client';
  }
  return _QB_BY_STEP[step] || 'draft';
}

/**
 * The whole board.
 * @param {object} list the result of quotationWorklist()
 * @returns {{columns: Array, total: number, value: number}} one entry per QB_COLUMNS, in order,
 *          each {key, label, sub, rows, count, value}. Counts sum to the input length — nothing is
 *          dropped and nothing is counted twice; the table test asserts both.
 */
function quotationBoard(list) {
  const byKey = {};
  QB_COLUMNS.forEach(c => { byKey[c.key] = { key: c.key, label: c.label, sub: c.sub, rows: [], count: 0, value: 0 }; });

  ((list || {}).rows || []).forEach(r => {
    const col = byKey[quotationBoardColumn(r)];
    col.rows.push(r);
    col.count++;
    col.value += (Number(r.value) || 0);
  });

  const columns = QB_COLUMNS.map(c => byKey[c.key]);
  return {
    columns: columns,
    total: columns.reduce((s, c) => s + c.count, 0),
    value: columns.reduce((s, c) => s + c.value, 0)
  };
}

/* Which drags are REAL transitions.
 *
 * Only moves that map onto a backend action that already exists, and only ones whose meaning is
 * unambiguous from the drag alone. Approving is deliberately absent: approveQuotation is gated on the
 * stale-PDF check (_quotationPdfMismatch) and, for the tiers that can see it, on the pricing review —
 * signing that off by dragging a card past two gates would be a second, weaker approval path. The
 * board says so out loud rather than silently refusing.
 */
const QB_MOVES = {
  'draft>approval':   { action: 'submitQuotationApproval', verb: 'Submit for approval' },
  'sent-back>approval': { action: 'submitQuotationApproval', verb: 'Resubmit for approval' },
  'approved>client':  { action: 'sendQuotation',           verb: 'Mark as sent to the client' },
  'client>closed':    { action: 'closeQuotation',          verb: 'Close', needsReason: true },
  'approved>closed':  { action: 'closeQuotation',          verb: 'Close', needsReason: true },
  'draft>closed':     { action: 'closeQuotation',          verb: 'Close', needsReason: true },
  'sent-back>closed': { action: 'closeQuotation',          verb: 'Close', needsReason: true },
  'closed>draft':     { action: 'reopenQuotation',         verb: 'Reopen' }
};

/** What a drag from `from` to `to` means, or null when it is not a move the system can make.
 *  `reason` explains the refusal in the user's terms — a board that just snaps the card back
 *  teaches nobody anything. */
function quotationBoardMove(from, to) {
  if (!from || !to || from === to) return null;
  const m = QB_MOVES[from + '>' + to];
  if (m) return Object.assign({ from: from, to: to, ok: true }, m);

  let reason = 'That is not a move the system can make.';
  if (to === 'approved' || (to === 'approval' && from !== 'draft' && from !== 'sent-back')) {
    reason = 'Approving happens in the review, where the pricing and the saved PDF are checked. Open the quotation instead.';
  } else if (to === 'won') {
    reason = 'A quotation becomes Won when a sales order records it — not by hand.';
  } else if (from === 'won') {
    reason = 'This one already has a sales order against it.';
  } else if (to === 'draft' && from !== 'closed') {
    reason = 'Use Revise on the quotation — that clears the approvals deliberately.';
  }
  return { from: from, to: to, ok: false, reason: reason };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QB_COLUMNS, QB_MOVES, quotationBoardColumn, quotationBoard, quotationBoardMove };
}
