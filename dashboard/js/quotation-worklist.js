/* A215 — what to DO about a quotation, not what state it is in.
 *
 * The quotation list has always been a date-ordered table of statuses. A rep reading it has to know
 * that Rejected means "fix it", Approved means "you still have to send this", Pending Management
 * means "do nothing", and Sent means "chase it, eventually" — and re-derive that for all 72 rows
 * every time they open the page. That is not tracking; it is rebuilding the picture from scratch.
 *
 * This turns each quotation into ONE INSTRUCTION with an urgency, so the list can be ordered by what
 * the rep must do rather than by when it happened. Newest-first is precisely backwards for tracking:
 * the row that needs attention most is the one that has sat longest, so it ends up furthest down.
 *
 * Pure and DOM-free, and table-tested — the puller-selector.js / quotation-email-match.js precedent.
 * It reuses flowFollowUp and flowQuotationBucket rather than restating their rules: those two already
 * decide what is closed, what is chaseable and when the clock started, and a second copy of that
 * judgement would drift from the first.
 *
 * WHAT IT WILL NOT DO: invent urgency it cannot see. A quotation marked Sent with no send date (65 of
 * 72 live ones, at the time of writing) cannot be ranked by how long it has been quiet, so it is NOT
 * quietly sorted to the bottom or dressed up as fine — it gets its own honest line saying the date is
 * missing. Guessing here would put real deals below imaginary ones.
 */

/* Every step a rep can be at, with the ordering baked in.
 *
 * `pri` decides the coarse order inside "needs you now" and encodes one judgement worth stating:
 * ANSWERING A CLIENT WHO HAS REPLIED OUTRANKS EVERYTHING. Somebody is actively waiting on us. A
 * rejected quotation is more urgent to the business than an unsent one, but nobody outside the
 * company is sitting there wondering — so it comes second.
 *
 * `group` is what the page renders as a section. Three, not seven, because the rep's real question is
 * only ever "is this mine to move, or am I waiting on someone?" */
const QW_STEPS = {
  answer:         { pri: 0, group: 'now',     verb: 'Answer',   title: 'They replied' },
  fix:            { pri: 1, group: 'now',     verb: 'Fix',      title: 'Sent back to you' },
  send:           { pri: 2, group: 'now',     verb: 'Send',     title: 'Approved, not sent' },
  chase:          { pri: 3, group: 'now',     verb: 'Chase',    title: 'Gone quiet' },
  'no-send-date': { pri: 4, group: 'now',     verb: 'Check',    title: 'Send date missing' },
  'wait-approval':{ pri: 5, group: 'waiting', verb: '',         title: 'Waiting for approval' },
  'wait-client':  { pri: 6, group: 'waiting', verb: '',         title: 'With the client' },
  snoozed:        { pri: 7, group: 'waiting', verb: '',         title: 'Parked' },
  draft:          { pri: 8, group: 'waiting', verb: 'Open',     title: 'Still a draft' },
  won:            { pri: 9, group: 'done',    verb: '',         title: 'Became an order' },
  closed:         { pri: 10, group: 'done',   verb: '',         title: 'Closed' }
};

const QW_GROUPS = ['now', 'waiting', 'done'];

/** Days late, floored at 0. Used for ordering, so it must never go negative and re-sort a deal that
 *  is merely young above one that is genuinely late. */
function qwOverdue(days, threshold) {
  if (days === null || days === undefined) return 0;
  const over = days - (threshold || 0);
  return over > 0 ? over : 0;
}

/** Is this quotation parked until a future date?
 *
 *  Snoozing is what keeps the list TRUE. A rep who has a real reason to leave something — "the client
 *  said call us in October" — needs it to go away and come back, or the worklist keeps insisting on
 *  work that has already been handled, and a list that nags about handled work stops being read. */
function qwSnoozed(q, today) {
  const until = flowDate((q || {}).snoozeUntil);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return null;
  const left = flowDaysBetween(today || flowToday(), until);
  if (left === null || left <= 0) return null;                 // the park has expired: back on the list
  return { until: until, daysLeft: left, reason: String((q || {}).snoozeReason || '') };
}

/** One quotation -> one instruction.
 *
 *  Returns { step, group, pri, verb, title, line, detail, days, overdueBy, value, followUp }
 *   · `line`   — the state in plain words, e.g. "24 days quiet". Rendered on the row.
 *   · `detail` — the why, when there is one: the rejection reason, who it is with.
 *   · `overdueBy` — days past the threshold, 0 when not late. The primary sort inside a group.
 */
function quotationWorklistStep(q, links, cfg, hasSO, today) {
  /* One unreadable row must never blank the whole list. The rep would see an empty page and no reason
     for it, which is worse than the table this replaces — so every field is read defensively and a
     row with nothing in it comes out as a draft rather than an exception. */
  q = q || {};
  const now = today || flowToday();
  const bucket = flowQuotationBucket(q, hasSO);
  const fu = flowFollowUp(q, links, cfg, hasSO);
  const value = (typeof flowQuotationNet === 'function') ? flowQuotationNet(q) : 0;
  const status = String((q || {}).status || '');

  const at = (step, line, detail, days, overdueBy) => {
    const s = QW_STEPS[step];
    return { step: step, group: s.group, pri: s.pri, verb: s.verb, title: s.title,
             line: line || '', detail: detail || '',
             days: (days === undefined ? null : days), overdueBy: overdueBy || 0,
             value: value, followUp: fu };
  };

  // Done first — nothing about a won or closed deal is work.
  if (bucket === 'won') return at('won', 'Order raised', '', null, 0);
  if (bucket === 'closed') return at('closed', status, String((q || {}).approvalNote || ''), null, 0);

  // Rejected outranks the parked flag: a quotation sent back to the rep is theirs to fix now.
  if (status === 'Rejected') {
    const d = flowDaysBetween(q.approvedAt || q.date, now);
    return at('fix', d === null ? 'sent back' : ('sent back ' + qwAgo(d)),
              String((q || {}).approvalNote || ''), d, qwOverdue(d, 0));
  }

  const parked = qwSnoozed(q, now);
  if (parked) {
    return at('snoozed', 'parked until ' + parked.until, parked.reason, parked.daysLeft, 0);
  }

  if (bucket === 'internal') {
    // In someone else's queue, or not yet submitted. Either way the rep is not blocked.
    if (status.indexOf('Pending') === 0) {
      const d = flowDaysBetween(q.date, now);
      return at('wait-approval', 'with ' + status.replace(/^Pending\s*/, '').toLowerCase() +
                (d === null ? '' : ' ' + qwAgo(d)), '', d, 0);
    }
    const d = flowDaysBetween(q.date, now);
    return at('draft', d === null ? 'draft' : ('draft ' + qwAgo(d)), '', d, 0);
  }

  if (bucket === 'approved') {
    // fu.state is 'not-sent' only once it has been sitting past approvedNotSentDays; before that
    // there is genuinely nothing wrong, so it waits rather than shouting.
    const d = flowDaysBetween(q.approvedAt || q.date, now);
    if (fu.state === 'not-sent') {
      return at('send', 'approved ' + qwAgo(d) + ', not sent', '', d, fu.days || 0);
    }
    return at('wait-client', 'approved ' + qwAgo(d), 'Ready to send.', d, 0);
  }

  // bucket === 'sent'
  if (fu.state === 'replied') {
    return at('answer', 'replied ' + qwAgo(fu.days), 'The client came back — this needs your answer.',
              fu.days, qwOverdue(fu.days, 0));
  }
  if (fu.state === 'unknown' && !fu.sentAt) {
    /* Marked Sent before the system recorded when. It cannot be ranked against deals whose clock is
       known, so it is neither hidden nor faked — it asks to be corrected. */
    return at('no-send-date', 'sent date not recorded',
              'Link the email that carried it, and the follow-up clock starts.', null, 0);
  }
  if (fu.state === 'due' || fu.state === 'overdue') {
    return at('chase', fu.days + ' days quiet', fu.reason, fu.days, qwOverdue(fu.days, fu.threshold));
  }
  // 'ok', or 'unknown' because the mailbox could not be read — with the client, nothing to do yet.
  const d = fu.days === null ? flowDaysBetween(fu.sentAt || q.sentAt, now) : fu.days;
  return at('wait-client', d === null ? 'with the client' : ('quiet ' + qwAgo(d)),
            fu.state === 'unknown' ? 'Reply state unknown — the mailbox could not be read.' : '',
            d, 0);
}

/** "today" / "yesterday" / "3 days ago" — a date a person can act on without doing arithmetic. */
function qwAgo(days) {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

/** The whole list, grouped and ordered.
 *
 *  Ordering inside a group: step priority, then HOW LATE, then value. Late-and-large first, which is
 *  the order a rep would choose themselves if they had time to sort 72 rows by hand.
 *
 *  Every quotation lands in exactly one group and nothing is dropped — the counts have to sum to the
 *  input length, and the test asserts it. A worklist that silently loses a deal is worse than the
 *  table it replaces. */
function quotationWorklist(quotations, linksByNo, cfg, hasSO, today) {
  const rows = (quotations || []).map(row => {
    const q = row || {};
    const step = quotationWorklistStep(q, (linksByNo || {})[String(q.quotationNo)] || [],
                                       cfg, hasSO, today);
    return Object.assign({ quotation: q }, step);
  });
  rows.sort((a, b) => (a.pri - b.pri) || (b.overdueBy - a.overdueBy) || (b.value - a.value) ||
                      String(a.quotation.quotationNo).localeCompare(String(b.quotation.quotationNo)));

  const groups = { now: [], waiting: [], done: [] };
  rows.forEach(r => groups[r.group].push(r));
  return {
    rows: rows,
    groups: groups,
    counts: { now: groups.now.length, waiting: groups.waiting.length, done: groups.done.length,
              total: rows.length },
    value: {
      now: groups.now.reduce((s, r) => s + r.value, 0),
      waiting: groups.waiting.reduce((s, r) => s + r.value, 0),
      done: groups.done.reduce((s, r) => s + r.value, 0)
    }
  };
}

/** The team view: the same rows, grouped by whose they are, worst first.
 *  Reps are ordered by how much work is waiting on them, not alphabetically — the point of the
 *  management view is to see where things are stuck. */
function quotationWorklistByRep(list) {
  const by = {};
  (list.rows || []).forEach(r => {
    /* A218 — group by the OWNER. Grouping by who typed a quotation put another rep's deals in
       somebody's column and hid their own, which on a management screen reads as a performance
       difference that never happened. */
    const who = (typeof flowQuotationOwner === 'function'
      ? flowQuotationOwner(r.quotation) : String(r.quotation.createdBy || '')) || '—';
    (by[who] = by[who] || { rep: who, now: [], waiting: [], done: [], nowValue: 0 });
    by[who][r.group].push(r);
    if (r.group === 'now') by[who].nowValue += r.value;
  });
  return Object.keys(by).map(k => by[k])
    .sort((a, b) => (b.now.length - a.now.length) || (b.nowValue - a.nowValue) ||
                    a.rep.localeCompare(b.rep));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QW_STEPS, QW_GROUPS, quotationWorklistStep, quotationWorklist,
                     quotationWorklistByRep, qwSnoozed, qwOverdue, qwAgo };
}
