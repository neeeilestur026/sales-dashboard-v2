/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   pr-worklist.js — A226. What to DO about a purchase request, not what state it is in.

   A rep raises a request and then loses sight of it. It spends most of its life in OTHER PEOPLE'S
   queues — admin sourcing it, management pricing it, admin verifying it — and the only screen that
   showed it was built around doing that work, not tracking it. Seven requests are sitting at
   "Returned to Sales" right now: priced, verified, and waiting on the rep. Nothing told them so.

   Pure and DOM-free, like quotation-worklist.js and client-rollup.js, because a list that decides
   what somebody does first is exactly the kind of thing that has to be table-tested rather than
   eyeballed. Table-tested at tests/flow/pr-worklist.js via tests/flow/prwload.js.

   ── THE ORDERING JUDGEMENT, stated once ──────────────────────────────────────────────────────
   THE REP'S OWN MOVE OUTRANKS CHASING SOMEBODY ELSE. `quote` is first because it is the only step
   where money moves and it is entirely in the rep's hands. Chases are then ordered LATEST STAGE
   FIRST — verify before pricing before sourcing — because a request one step from the rep's hands
   is worth more than one five steps away. That inverts the naive "oldest stage first".

   ── NO SNOOZE, deliberately ──────────────────────────────────────────────────────────────────
   Quotations can be parked (qwSnoozed) because the client genuinely may not be ready. A purchase
   request sits in a COLLEAGUE'S queue; parking it hides a stuck request, which is the opposite of
   what this list is for. If it is stuck, that is the finding.

   Reuses qwOverdue / qwAgo from quotation-worklist.js rather than copying them — both are page
   globals and the two lists appear on one screen, so a second copy of qwAgo would drift in wording.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/* Every step, with where it belongs and what the rep is being asked to do.
 *
 * A step's `pri` is its sort rank, and the table IS the priority argument — read top to bottom.
 * `verb` empty means there is nothing for the rep to do; it is somebody else's move.
 *
 * ── `hands`: THE SECOND AXIS, and the one the first design was missing ────────────────────────
 * `group` answers "is this urgent". It does NOT answer "can I finish it myself", and on live data
 * that turned out to be the question that matters. One rep's `now` bucket holds 67 requests — of
 * which 6 are hers to complete and 61 are other people's queues gone past their threshold. A list
 * of 67 things headed "needs you now", 91% of which she cannot personally finish, is not a worklist;
 * it is a number nobody reads twice.
 *
 * So each step also records WHOSE MOVE IS NEXT:
 *   'you'     — the rep can complete it alone
 *   'them'    — it needs somebody else to act; the rep can only chase
 *   'nobody'  — finished, or never in the flow at all
 *   'unclear' — we genuinely do not know, and must not pretend either way
 *
 * `group` is untouched by this, so every existing consumer keeps its answer. */
const PRW_STEPS = {
  quote:            { pri: 0,  group: 'now',     hands: 'you',     verb: 'Create quotation', title: 'Priced and ready' },
  /* A242 — a request can now be PARTLY quoted: some items went out on one quotation, the rest are
     still on the request. Two new steps, because the remainder is in one of two different hands.
     Ranked above 'send-quote': an item nobody has quoted at all is further from the client than a
     quotation sitting unsent. */
  'quote-rest':     { pri: 1,  group: 'now',     hands: 'you',     verb: 'Quote the rest',   title: 'Partly quoted — the rest is priced' },
  'send-quote':     { pri: 2,  group: 'now',     hands: 'you',     verb: 'Send',             title: 'Quoted, not sent' },
  'quotation-gone': { pri: 3,  group: 'now',     hands: 'you',     verb: 'Check',            title: 'Quotation no longer exists' },
  'quotation-void': { pri: 4,  group: 'now',     hands: 'you',     verb: 'Re-quote',         title: 'Quotation was cancelled' },
  'chase-verify':   { pri: 5,  group: 'now',     hands: 'them',    verb: 'Chase',            title: 'Waiting on verification' },
  'chase-pricing':  { pri: 6,  group: 'now',     hands: 'them',    verb: 'Chase',            title: 'Stuck with management' },
  'chase-admin':    { pri: 7,  group: 'now',     hands: 'them',    verb: 'Chase',            title: 'Stuck in sourcing' },
  /* The other half of a partly-quoted request: the leftover items have no price, so somebody else
     has to move before the rep can. `hands: 'them'` keeps it out of "yours to do" while still
     showing on the list — the whole reason the status exists is that these items were invisible. */
  'price-rest':     { pri: 8,  group: 'now',     hands: 'them',    verb: 'Send for pricing', title: 'Partly quoted — the rest needs pricing' },
  'no-date':        { pri: 9,  group: 'now',     hands: 'you',     verb: 'Check',            title: 'Date missing' },
  'wait-verify':    { pri: 10, group: 'waiting', hands: 'them',    verb: '',                 title: 'With admin (verification)' },
  'wait-pricing':   { pri: 11, group: 'waiting', hands: 'them',    verb: '',                 title: 'With management (pricing)' },
  'wait-sourcing':  { pri: 12, group: 'waiting', hands: 'them',    verb: '',                 title: 'With admin (sourcing)' },
  unknown:          { pri: 13, group: 'waiting', hands: 'unclear', verb: '',                 title: 'Unrecognised stage' },
  quoted:           { pri: 14, group: 'done',    hands: 'nobody',  verb: '',                 title: 'Became a quotation' },
  migrated:         { pri: 15, group: 'done',    hands: 'nobody',  verb: '',                 title: 'Imported history' }
};
const PRW_GROUPS = ['now', 'waiting', 'done'];

/* The four lanes the tracker actually shows. `now` splits on `hands`; the other two pass through.
   Ordered as the rail renders them, which is also the order a rep should read them. */
const PRW_LANES = ['yours', 'chase', 'waiting', 'done'];
const PRW_LANE_LABEL = {
  yours:   'Yours to do',
  chase:   'Chase someone',
  waiting: 'Waiting — still within time',
  done:    'Done'
};

/* How long a stage may sit before it is a chase rather than a wait. Overridable from FlowSettings so
   a number is a screen, not a deploy. Verification is the shortest because it is the last gate before
   the rep can act, and the request is already fully priced by then. */
const PRW_DEFAULTS = { prSourcingDays: 3, prPricingDays: 3, prVerifyDays: 2 };

/* The live status vocabulary, mapped to who is holding the request. 'Returned to Sales' is DISPLAYED
   as "For Quotation" (flow-pricing-request.js:27) but the stored value is what arrives here. */
const PRW_STAGE = {
  'Requested':        { chase: 'chase-admin',   wait: 'wait-sourcing', cfg: 'prSourcingDays' },
  'Sourcing':         { chase: 'chase-admin',   wait: 'wait-sourcing', cfg: 'prSourcingDays' },
  'For Mgmt Pricing': { chase: 'chase-pricing', wait: 'wait-pricing',  cfg: 'prPricingDays' },
  'Mgmt Priced':      { chase: 'chase-verify',  wait: 'wait-verify',   cfg: 'prVerifyDays' }
};

/** Σ qty × final price over the INCLUDED lines.
 *
 *  `priced` is the honest half: a request at Requested or Sourcing has no Final Price yet, and
 *  rendering ₱0.00 for it would state a cost nobody has agreed. The UI shows '—' instead — the same
 *  rule A215 applied to a send date nobody recorded.
 *
 *  NOTE finalPrice is a VAT-EXCLUSIVE unit price (flow-api.js:635), not a line total. */
function prValue(pr) {
  const items = ((pr || {}).items) || [];
  const inc = items.filter(i => i && i.included);
  /* A242 — MONEY ALREADY OUT ON A QUOTATION IS NOT MONEY IN PLAY. A partly-quoted request would
     otherwise report its whole five-line value here while the three quoted lines are separately
     live on the quotation board, and every rollup fed by this — the worklist lanes, the tracker's
     concentration figures, the per-rep totals — would count them twice.
     `quotable` is answered by the server (it needs the quotations' statuses). Rows from a backend
     that does not send it are undefined, i.e. still open, which is exactly what every record was
     before this existed — so no existing figure moves. */
  const open = inc.filter(i => i.quotable === undefined || i.quotable === true);
  let v = 0, priced = false;
  open.forEach(i => {
    const fp = Number(i.finalPrice) || 0;
    if (fp > 0) priced = true;
    v += (Number(i.qty) || 0) * fp;
  });
  return { value: Math.round(v * 100) / 100, priced: priced, lines: items.length,
           included: inc.length, open: open.length, quoted: inc.length - open.length };
}

/** Days between the request's date and `today` — null when the date cannot be read at all.
 *  flowDate handles BOTH live formats: ISO ('2026-06-29T16:00:00.000Z', 173 rows) and the JavaScript
 *  toString the import left behind ('Mon Jun 29 2026 16:44:00 GMT+0800 …', 142 rows). */
function prwAge(pr, today) {
  const d = flowDate((pr || {}).date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return flowDaysBetween(d, today || flowToday());
}

/**
 * One request → one instruction.
 *
 * @param pr        a getPricingRequests row
 * @param links     that request's email links (Step 2; [] until then)
 * @param quotation the resolved Quotations row, or null. `pr.quotationNo` says whether a link
 *                  EXISTS; this argument says whether the quotation still does — and those are
 *                  different questions. 15 live requests name a quotation that has since been
 *                  deleted or renamed, which is why `quotation-gone` exists.
 * @param cfg       getFlowSettings().data
 * @param today     'yyyy-MM-dd', pinned by the caller so the list does not drift with the clock
 */
function pricingRequestWorklistStep(pr, links, quotation, cfg, today) {
  pr = pr || {};
  const c = Object.assign({}, PRW_DEFAULTS, cfg || {});
  const status = String(pr.status || '').trim();
  const days = prwAge(pr, today);
  const val = prValue(pr);
  const out = {
    prNo: String(pr.prNo || ''), customer: String(pr.customer || ''),
    owner: String(pr.salesperson || pr.requestedBy || ''),
    status: status, days: days, overdueBy: 0,
    value: val.value, priced: val.priced, lines: val.lines, included: val.included,
    quotationNo: String(pr.quotationNo || ''),
    quotationNoSource: String(pr.quotationNoSource || ''),
    links: (links || []).length
  };

  const finish = (step, detail) => {
    const s = PRW_STEPS[step] || PRW_STEPS.unknown;
    out.step = step; out.group = s.group; out.pri = s.pri;
    out.verb = s.verb; out.title = s.title; out.detail = detail || '';
    return out;
  };

  // Imported history is not work. It never enters the worklist and never nags — see the History view.
  if (status === 'Migrated') return finish('migrated', 'Imported from the old system.');

  /* A242 — PARTLY QUOTED. Some items went out; the rest are still here, and the entire point of the
     status is that they stay visible. Which step depends on whose move it is, and the honest answer
     is "it depends whether anybody has priced them yet" — a rep told to quote items that carry no
     price would be sent to a screen where the tick boxes are all empty. */
  if (status === 'Partly Quoted') {
    const gone = val.quoted, left = val.open;
    const head = gone + ' item(s) already quoted' + (out.quotationNo ? ' (' + out.quotationNo + ')' : '') +
                 ', ' + left + ' still on this request';
    if (!left) {
      /* Every line is out but the status never caught up — the write that flips it to Quoted is a
         separate cell from the one that stamps the lines, and Apps Script cannot do both at once.
         Reading it as done is right; saying so is better than pretending there is work. */
      return finish('quoted', head + '. Nothing is outstanding.');
    }
    return finish(val.priced ? 'quote-rest' : 'price-rest',
      head + (val.priced ? ' and priced — put them on a second quotation.'
                         : ' with no price yet — they need sourcing and management pricing first.'));
  }

  if (status === 'Quoted') {
    /* THE LINK EXISTS BUT THE QUOTATION DOES NOT. 13 live requests are in this state: the number was
       recorded (35 resolve from the column, 41 from the request's own Notes) and the quotation has
       since been deleted or renumbered. Saying "quoted" would hide it for ever; this is the one
       Quoted case that is genuinely work. */
    if (out.quotationNo && !quotation) {
      return finish('quotation-gone',
        'This says it became ' + out.quotationNo + ', but no quotation of that number exists any more.');
    }
    if (!out.quotationNo) {
      /* "WE COULD NOT CHECK" IS NOT "THERE WAS NOTHING".
       *
       * Only the server resolves the Notes fallback, and that fallback answers for 41 of the 76 live
       * Quoted requests. Against an older backend the page can only see Quotations['PR No'], so a
       * blank here means the question was unanswerable — not that the link is missing. Reporting it
       * as work put 30 false alarms in one rep's list on the very first load.
       *
       * Same distinction flowFollowUp draws with its stale reply-check guard (flow-api.js:1158): a
       * mailbox that could not be read must never render as "the client did not reply". */
      if (cfg && cfg.prQuotationLinkUnverified) {
        return finish('quoted',
          'Marked quoted. This page cannot confirm which quotation until the backend is updated.');
      }
      return finish('quotation-gone', 'Marked quoted, but the quotation it became was never recorded.');
    }
    /* Quoted and the quotation is still internal — the rep has one more move: send it.
       flowQuotationBucket is the same authority the quotation worklist uses, so the two lists
       cannot disagree about what "sent" means. */
    const bucket = (typeof flowQuotationBucket === 'function')
      ? flowQuotationBucket(quotation, {}) : '';
    if (bucket === 'internal' || bucket === 'approved') {
      return finish('send-quote', out.quotationNo + ' exists but has not gone to the client yet.');
    }
    /* A227 — CANCELLED IS NOT AN OUTCOME, it is a withdrawal.
     *
     * flowQuotationBucket lumps all three closed statuses together, which is right for the quotation
     * board and wrong here. 'Lost' and 'Not Pursued' are real endings: the client decided, and there
     * is nothing left for the rep to do. 'Cancelled' means WE retired the document — almost always
     * because it had an error in it — and the request behind it is live again. Calling that "done"
     * hides a client who is still waiting for a corrected quotation.
     *
     * This fires only when the retired one is still the best link the request has. Once a live
     * replacement carries the same PR No, _quoPickForPR hands over the replacement instead and this
     * request goes back to reading `send-quote` against the new number. */
    if (String((quotation || {}).status || '') === 'Cancelled') {
      return finish('quotation-void',
        out.quotationNo + ' was cancelled, and no live quotation has replaced it on this request yet.');
    }
    return finish('quoted', 'Became ' + out.quotationNo + '.');
  }

  /* PRICED, VERIFIED, AND WAITING ON THE REP — the whole reason this tracker exists. Seven live
     requests are sitting here and nothing told anybody.
     Checked BEFORE the date guard on purpose: age is irrelevant to this step. A request that is
     ready to quote is ready to quote whether it was returned yesterday or is missing its date
     entirely, and demoting it to 'no-date' would bury the one thing the rep can actually act on.
     Stored as 'Returned to Sales'; the screens display it as "For Quotation". */
  if (status === 'Returned to Sales') {
    return finish('quote', val.priced
      ? 'Priced and verified — this one is yours to quote.'
      : 'Returned to you, but no line carries a price yet — check it before quoting.');
  }

  // A date we cannot read cannot be aged. Never faked, never silently sorted as fresh.
  if (days === null) return finish('no-date', 'This request has no readable date, so it cannot be aged.');

  const stage = PRW_STAGE[status];
  if (!stage) {
    /* A status this table has never seen. It lands in `waiting` — never `now` (it is not known to be
       work) and never `done` (it is not known to be finished). Same rule flowQuotationBucket states. */
    return finish('unknown', status ? ('Status "' + status + '" is not one this tracker knows.')
                                    : 'This request has no status at all.');
  }
  const threshold = Number(c[stage.cfg]) || 0;
  out.overdueBy = qwOverdue(days, threshold);
  if (out.overdueBy > 0) {
    return finish(stage.chase, 'Sitting ' + qwAgo(days) + ', past the ' + threshold + '-day mark.');
  }
  return finish(stage.wait, 'Raised ' + qwAgo(days) + '.');
}

/** The whole list, grouped and sorted. Nothing is dropped — the test asserts the counts sum. */
function pricingRequestWorklist(prs, linksByNo, quoByNo, cfg, today) {
  const day = today || flowToday();
  const rows = (prs || []).map(pr => pricingRequestWorklistStep(
    pr, (linksByNo || {})[String(pr.prNo)] || [],
    (quoByNo || {})[String(pr.quotationNo || '')] || null, cfg, day));

  /* Priority, then how overdue, then value, then number. Newest-first is exactly backwards for a
     tracker: the oldest stuck request is the one that needs reading first. */
  rows.sort((a, b) =>
    (a.pri - b.pri) ||
    (b.overdueBy - a.overdueBy) ||
    (b.value - a.value) ||
    String(a.prNo).localeCompare(String(b.prNo)));

  const groups = { now: [], waiting: [], done: [] };
  rows.forEach(r => { (groups[r.group] || groups.waiting).push(r); });
  const sum = list => Math.round(list.reduce((t, r) => t + (r.priced ? r.value : 0), 0) * 100) / 100;
  return {
    rows: rows, groups: groups,
    counts: { now: groups.now.length, waiting: groups.waiting.length,
              done: groups.done.length, total: rows.length },
    value: { now: sum(groups.now), waiting: sum(groups.waiting), done: sum(groups.done) }
  };
}

/** The four lanes, from one already-built list. Reads `pricingRequestWorklist`'s output rather than
 *  re-deriving anything, so the board and the counts can never disagree — the A208 lesson, where a
 *  tile said ₱10.7M above a counter saying ₱18.4M because each filtered separately.
 *
 *  THE INVARIANT, asserted in the table test: yours + chase === counts.now, and the four lanes sum
 *  to the total. Splitting a bucket is only safe if nothing falls between the halves. */
function pricingRequestWorklistBoard(list) {
  const rows = ((list || {}).rows) || [];
  const lanes = { yours: [], chase: [], waiting: [], done: [] };
  rows.forEach(r => {
    if (r.group === 'done') { lanes.done.push(r); return; }
    if (r.group === 'waiting') { lanes.waiting.push(r); return; }
    // Inside `now`, whose move is it? Anything not explicitly the rep's own is a chase — the safe
    // side, because over-claiming "you can finish this" is the failure that empties a worklist.
    lanes[((PRW_STEPS[r.step] || {}).hands === 'you') ? 'yours' : 'chase'].push(r);
  });
  const sum = l => Math.round(l.reduce((t, r) => t + (r.priced ? r.value : 0), 0) * 100) / 100;
  const oldest = l => l.reduce((m, r) => Math.max(m, Number(r.days) || 0), 0);
  const out = { lanes: lanes, counts: {}, value: {}, oldest: {} };
  PRW_LANES.forEach(k => {
    out.counts[k] = lanes[k].length;
    out.value[k] = sum(lanes[k]);
    out.oldest[k] = oldest(lanes[k]);
  });
  out.counts.total = rows.length;
  return out;
}

/** The one systemic finding worth a banner: when a single step holds most of what is open.
 *
 *  On live data this is the most useful sentence on the page — 58 of one rep's 67 open requests are
 *  the SAME problem (sourcing has not come back), and reading that once beats scrolling 58 rows to
 *  infer it. Returns null when nothing dominates, because a banner that always fires is wallpaper.
 *
 *  Every number it carries is countable off the list itself; it states no cause it cannot see. */
function prwConcentration(list, minRows, minShare) {
  const now = (((list || {}).groups) || {}).now || [];
  if (now.length < (minRows === undefined ? 5 : minRows)) return null;
  const by = {};
  now.forEach(r => {
    const k = r.step;
    if (!by[k]) by[k] = { step: k, title: (PRW_STEPS[k] || {}).title || k,
                          hands: (PRW_STEPS[k] || {}).hands || '', n: 0, value: 0, oldest: 0 };
    by[k].n++;
    if (r.priced) by[k].value += r.value;
    by[k].oldest = Math.max(by[k].oldest, Number(r.days) || 0);
  });
  const keys = Object.keys(by);
  if (keys.length < 2) return null;                 // one step IS the list; there is nothing to single out
  const top = keys.map(k => by[k]).sort((a, b) => b.n - a.n)[0];
  const share = top.n / now.length;
  if (share < (minShare === undefined ? 0.4 : minShare)) return null;
  top.value = Math.round(top.value * 100) / 100;
  top.share = Math.round(share * 100);
  top.of = now.length;
  return top;
}

/** Per rep, busiest first — the oversight view. Groups on the OWNER, which is the stored
 *  Salesperson where there is one and who requested it otherwise (see _prOwner in FlowAPI.gs). */
function pricingRequestWorklistByRep(list) {
  const by = {};
  ((list || {}).rows || []).forEach(r => {
    const k = r.owner || '(nobody named)';
    if (!by[k]) by[k] = { rep: k, now: [], waiting: [], done: [], nowValue: 0 };
    by[k][r.group].push(r);
    if (r.group === 'now' && r.priced) by[k].nowValue += r.value;
  });
  return Object.keys(by).map(k => {
    by[k].nowValue = Math.round(by[k].nowValue * 100) / 100;
    return by[k];
  }).sort((a, b) => (b.now.length - a.now.length) || (b.nowValue - a.nowValue) ||
                    String(a.rep).localeCompare(String(b.rep)));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PRW_STEPS, PRW_GROUPS, PRW_DEFAULTS, PRW_STAGE,
                     PRW_LANES, PRW_LANE_LABEL,
                     pricingRequestWorklistStep, pricingRequestWorklist,
                     pricingRequestWorklistBoard, prwConcentration,
                     pricingRequestWorklistByRep, prValue, prwAge };
}
