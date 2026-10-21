/* proof-of-work-model.js — A347 · the Sales "proof of work", computed from records the portal already keeps.
 *
 * The report is Neil's (pack of 20 Oct 2026: Hi-ESCORP_Proof_of_Work_Sales.pdf, Sales_My_Day_and_Reports.pdf and
 * the filled sample salesproof.pdf): per rep, the 8:00 numbers, what they logged during the day, what the portal
 * logged by itself, the 4:30 numbers, and the Friday week. Every number points at the records behind it.
 *
 * PURE. Everything arrives in `raw`; nothing is fetched or drawn here, so tests/flow/proof-of-work.js runs it in
 * node. The rules it shares are not copied: flowQuotationOwner / flowQuotationNet / flowQuotationBucket /
 * flowFollowUp / flowDate / flowWeekDates come from flow-api.js, and iwSameCompany from itinerary-week.js.
 *
 * Every number is { key, label, value, text, target, status, source, items[], note?, notRecorded? }:
 *   status  'ok' | 'watch' | 'red' | 'none' (no target that day) | 'nr' (not recorded yet)
 *   source  'AUTO' (the portal counts it) · 'MY LOG' (the rep typed it) · 'LOG + MATCH' (matched afterwards)
 *   items   the records behind it, each with its own reference — what the detail view lists.
 *
 * Neil's decisions (21 Oct): follow-ups run on the portal's 7-day rule (flowFollowUp), not day 3/7/14; a call to
 * the client or a follow-up action on the quotation counts as contact, the same as a chase email. Numbers the
 * portal cannot prove yet say so ("not recorded yet") instead of being guessed; they come with step 2.
 */

/* The pack's targets. Each can be overridden by a FlowSettings row with the same key; no row is needed. */
const POW_DEFAULTS = {
  powVisitsDay: 2,                 // visits / presentations, a field day
  powVisitsWeek: 6, powVisitsWeekRed: 4,
  powQuotesWeek: 5, powQuotesWeekValue: 1100000, powQuotesWeekRed: 3,
  powOpenQuotes: 4500000, powOpenQuotesRed: 3000000,
  powSoMonth: 1500000,
  powWithin48: 0.9,
  powSlotsWeek: 6,
  powFieldDays: 'Mon,Tue,Wed'
};

const POW_NOT_RECORDED = {
  rfqWaiting: 'The portal has no "waiting for specs" state on a purchase request yet, so this cannot be counted. It comes with step 2.',
  prsReturned: 'Purchasing has no "returned for missing specs" step yet. It comes with step 2.',
  perfCalls: 'A call has no type yet, so a performance call (7 days after a delivery) cannot be told apart from other calls. It comes with step 2.'
};

/* Typed by the rep (MY LOG); everything else in the ActivityLog is the portal logging by itself. */
const POW_TYPED_MODULES = { 'Call': 1, 'Client Visit': 1 };
/* Things done ON a quotation that count as following it up. 'Sent' is the send itself, not a follow-up. */
const POW_FOLLOW_ACTIONS = { 'Follow-up Set': 1, 'Parked': 1, 'Email Linked': 1, 'Reply Checked': 1, 'Closed': 1, 'Revised': 1 };
const POW_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const POW_DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

function _powS(v) { return String(v == null ? '' : v).trim(); }
function _powSame(a, b) { const x = _powS(a).toLowerCase(), y = _powS(b).toLowerCase(); return !!x && x === y; }
function _powNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function _powDemo(no) { return /^DEMO-/i.test(_powS(no)); }
function _powDate(v) { return typeof flowDate === 'function' ? flowDate(v) : _powS(v).slice(0, 10); }
function _powSameCo(a, b) { return typeof iwSameCompany === 'function' ? iwSameCompany(a, b) : _powSame(a, b); }

/** The pack's targets, with any FlowSettings pow* row laid over them. */
function powCfg(settings) {
  const c = Object.assign({}, POW_DEFAULTS), s = settings || {};
  Object.keys(POW_DEFAULTS).forEach(k => {
    if (s[k] === undefined || s[k] === null || s[k] === '') return;
    if (k === 'powFieldDays') { c[k] = String(s[k]); return; }
    const n = Number(s[k]);
    if (isFinite(n) && n >= 0) c[k] = n;
  });
  return c;
}

/* ── time and days ─────────────────────────────────────────────────────────────────────────── */

/** Minutes after Manila midnight, for ordering a day's lines; -1 when there is no time in it.
 *  Three shapes arrive: 'HH:mm' typed, a Sheets time cell anchored to 1899-12-30 (the +8 goes on the UTC parts,
 *  as iwTime12 does, because Manila's 1899 offset is local mean time), and a real ISO timestamp. */
function _powMinutes(v) {
  const s = _powS(v);
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^1899-12-\d{2}T(\d{2}):(\d{2})/.exec(s);
  if (m) return ((Number(m[1]) + 8) % 24) * 60 + Number(m[2]);
  if (!/T\d{2}:\d{2}/.test(s)) return -1;
  const t = Date.parse(s);
  if (isNaN(t)) return -1;
  return Math.floor((((t / 60000) + 480) % 1440 + 1440) % 1440);   // Manila is UTC+8 all year
}
/** '3:05 PM', or '' when the value carries no time. */
function powClock(v) {
  const m = _powMinutes(v);
  if (m < 0) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  return (h % 12 || 12) + ':' + String(mm).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}
function powDow(day) { const d = new Date(_powS(day) + 'T00:00:00Z'); return isNaN(d) ? '' : POW_DOW[d.getUTCDay()]; }
function _powAddDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function _powPrevWorkday(day) { let d = _powAddDays(day, -1); while (powDow(d) === 'Sat' || powDow(d) === 'Sun') d = _powAddDays(d, -1); return d; }
function powIsFieldDay(day, cfg) { return String((cfg || POW_DEFAULTS).powFieldDays).split(',').map(_powS).indexOf(powDow(day)) >= 0; }
/** 'Tuesday 21 Oct' */
function powDayLong(day) {
  const d = new Date(_powS(day) + 'T00:00:00Z');
  if (isNaN(d)) return _powS(day);
  return POW_DAY_NAMES[powDow(day)] + ' ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}
/** The Mon–Fri of the week holding `day`. */
function powWorkWeek(day) {
  if (typeof flowWeekDates === 'function') return flowWeekDates(day, 0).slice(0, 5);
  const back = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7, mon = _powAddDays(day, -back);
  return [0, 1, 2, 3, 4].map(i => _powAddDays(mon, i));
}

/** ₱186,400 below a million, ₱3.8M / ₱1.25M above. */
function powMoney(v) {
  const n = _powNum(v);
  if (Math.abs(n) >= 1e6) return '₱' + (n / 1e6).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'M';
  return '₱' + Math.round(n).toLocaleString('en-US');
}

/* ── the index: every read, cleaned and keyed once ─────────────────────────────────────────── */

/**
 * raw = { quotations, salesOrders, quotationEmails, prs, activity, calls, visits, itineraries, leads, roster,
 *         settings, today }   — each the `data` of its read; any may be missing.
 */
function powIndex(raw) {
  const r = raw || {};
  const ix = {
    today: _powS(r.today) || (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10)),
    settings: r.settings || {},
    cfg: powCfg(r.settings),
    quotations: (r.quotations || []).filter(q => q && !_powDemo(q.quotationNo)),
    sos: (r.salesOrders || []).filter(s => s && !_powDemo(s.soNo)),
    activity: r.activity || [], calls: r.calls || [], visits: r.visits || [],
    itins: r.itineraries || [], leads: r.leads || [], roster: r.roster || [],
    hasSO: {}, links: {}, qByNo: {}, prs: {}, prCreated: {}, qSent: {}
  };
  ix.sos.forEach(s => { if (s.quotationNo) ix.hasSO[_powS(s.quotationNo)] = true; });
  ix.quotations.forEach(q => { ix.qByNo[_powS(q.quotationNo)] = q; });
  (r.quotationEmails || []).forEach(l => {
    const k = _powS(l && l.quotationNo);
    if (k) (ix.links[k] = ix.links[k] || []).push(l);
  });
  (r.prs || []).forEach(p => { if (p && p.prNo) ix.prs[_powS(p.prNo)] = p; });
  ix.activity.forEach(a => {
    if (a.module === 'Pricing Request' && a.action === 'Created' && a.refNo) {
      const k = _powS(a.refNo);
      if (!ix.prCreated[k] || a.timestamp < ix.prCreated[k].ts) ix.prCreated[k] = { ts: _powS(a.timestamp), user: _powS(a.user) };
    }
    if (a.module === 'Quotation' && a.action === 'Sent' && a.refNo) {
      const k = _powS(a.refNo);
      if (!ix.qSent[k] || a.timestamp < ix.qSent[k].ts) ix.qSent[k] = { ts: _powS(a.timestamp), user: _powS(a.user) };
    }
  });
  return ix;
}

/** Owner of a quotation / PR — the same rules the quotation and PR pages use. */
function _powQOwner(q) { return typeof flowQuotationOwner === 'function' ? flowQuotationOwner(q) : _powS(q.salesperson || q.createdBy); }
function _powPrOwner(p) { return _powS(p.salesperson || p.requestedBy); }

/** The sales reps: every login with the sales role. With no roster (a read failed), whoever owns a sent
 *  quotation or logged a visit stands in, so the section never goes blank on one failed read. */
function powReps(ix) {
  const seen = {}, out = [];
  const add = (name, username) => {
    const n = _powS(name);
    if (!n || seen[n.toLowerCase()]) return;
    seen[n.toLowerCase()] = true;
    out.push({ name: n, username: _powS(username), first: n.split(/\s+/)[0] });
  };
  (ix.roster || []).forEach(u => {
    if (String(u && u.role || '').toLowerCase() !== 'sales') return;
    add(u.fullName || u.name || u.username, u.username);
  });
  if (!out.length) {
    ix.visits.forEach(v => add(v.user, ''));
    ix.quotations.forEach(q => { if (q.status === 'Sent' && q.salesperson) add(q.salesperson, ''); });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function _powN(key, label, o) {
  return Object.assign({ key, label, value: 0, text: '0', target: '', status: 'none', source: 'AUTO', items: [] }, o || {});
}
function _powNR(key, label, target) {
  return _powN(key, label, { text: '—', target, status: 'nr', notRecorded: POW_NOT_RECORDED[key], value: null });
}

/* ── quotations: open, due, contacted ───────────────────────────────────────────────────────── */

/** The rep's quotations with the client on `day`: sent, not won or lost (as they stand now), and already sent by
 *  then. An old quotation with no sent stamp counts — it went out before the portal recorded when. */
function _powOpenOn(ix, rep, day) {
  return ix.quotations.filter(q => {
    if (!_powSame(_powQOwner(q), rep.name)) return false;
    if ((typeof flowQuotationBucket === 'function' ? flowQuotationBucket(q, ix.hasSO) : (q.status === 'Sent' ? 'sent' : '')) !== 'sent') return false;
    const s = _powDate(q.sentAt);
    return !s || s <= day;
  });
}

/** Every contact with the client on one quotation between two days: a chase email linked to it, a call the rep
 *  logged to that client, or a follow-up action on the quotation itself. */
function _powContacts(ix, rep, q, from, to) {
  const no = _powS(q.quotationNo), out = [];
  const inRange = (d) => !!d && d >= from && d <= to;
  (ix.links[no] || []).forEach(l => {
    if (_powS(l.status || 'Active') !== 'Active' || _powS(l.kind) === 'Initial') return;
    const d = _powDate(l.sentAt);
    if (inRange(d)) out.push({ date: d, time: powClock(l.sentAt), kind: 'Email', ref: _powS(l.subject) || 'linked email', text: 'Chase email linked to the quotation' });
  });
  ix.calls.forEach(c => {
    if (!_powSame(c.user, rep.name) || !_powSameCo(c.company, q.customer)) return;
    const d = _powDate(c.date);
    if (inRange(d)) out.push({ date: d, time: powClock(c.createdAt), kind: 'Call', ref: _powS(c.callNo), text: [c.contact, c.outcome].filter(Boolean).join(' — ') });
  });
  ix.activity.forEach(a => {
    if (a.module !== 'Quotation' || !POW_FOLLOW_ACTIONS[a.action] || _powS(a.refNo) !== no || !_powSame(a.user, rep.name)) return;
    const d = _powDate(a.date || a.timestamp);
    if (inRange(d)) out.push({ date: d, time: powClock(a.timestamp), kind: a.action, ref: no, text: _powS(a.summary) });
  });
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** The rep's open quotations past the follow-up mark on the MORNING of `day`: the 7-day rule (flowFollowUp) judged
 *  as of that day, with only what had happened before it — later emails are dropped, a later reply is unseen, and
 *  the rep's calls and follow-up actions count as contact. State 'due' (7 to 13 days without contact) is the day's
 *  follow-up list; 'overdue' (14 days or more) is the backlog, kept apart so it does not swamp the day. */
function _powPastMark(ix, rep, day) {
  return _powOpenOn(ix, rep, day).map(q => {
    const no = _powS(q.quotationNo);
    const links = (ix.links[no] || [])
      .filter(l => { const d = _powDate(l.sentAt); return !d || d < day; })
      .map(l => (_powDate(l.replyAt) >= day ? Object.assign({}, l, { replyAt: '' }) : l));
    const sent = _powDate(q.sentAt);
    if (sent) {
      _powContacts(ix, rep, q, sent, _powAddDays(day, -1)).forEach(c => {
        if (c.kind !== 'Email') links.push({ sentAt: c.date, status: 'Active', kind: 'Contact' });
      });
    }
    const f = typeof flowFollowUp === 'function' ? flowFollowUp(q, links, ix.settings, ix.hasSO, day) : { state: 'unknown' };
    return { q, f };
  }).filter(x => x.f.state === 'due' || x.f.state === 'overdue');
}
function _powDueOn(ix, rep, day) { return _powPastMark(ix, rep, day).filter(x => x.f.state === 'due'); }
function _powOverdueOn(ix, rep, day) { return _powPastMark(ix, rep, day).filter(x => x.f.state === 'overdue'); }

/* ── one day ───────────────────────────────────────────────────────────────────────────────── */

/** What the rep typed that day (MY LOG): their calls and client visits, in time order. */
function powLog(ix, rep, day) {
  const lines = [];
  ix.calls.forEach(c => {
    if (!_powSame(c.user, rep.name) || _powDate(c.date) !== day) return;
    lines.push({ sort: _powMinutes(c.createdAt), time: powClock(c.createdAt), type: 'Call', client: _powS(c.company),
                 person: _powS(c.contact), what: _powS(c.notes), result: _powS(c.outcome), ref: _powS(c.callNo) });
  });
  ix.visits.forEach(v => {
    if (!_powSame(v.user, rep.name) || _powDate(v.date) !== day) return;
    const t = _powMinutes(v.time) >= 0 ? v.time : v.createdAt;
    lines.push({ sort: _powMinutes(t), time: powClock(t), type: 'Visit', client: _powS(v.company), person: _powS(v.personVisited),
                 what: _powS(v.agenda), result: _powS(v.summaryOfAgenda), ref: _powS(v.visitNo), place: _powS(v.cityAddress),
                 photo: _powS(v.photoDocId), plan: _powS(v.itineraryItem) });
  });
  return lines.sort((a, b) => a.sort - b.sort);
}

/** What the portal logged by itself that day: the rep's ActivityLog, less the lines they typed. */
function powAuto(ix, rep, day) {
  return ix.activity
    .filter(a => _powSame(a.user, rep.name) && _powDate(a.date || a.timestamp) === day && !POW_TYPED_MODULES[a.module])
    .map(a => ({ sort: _powMinutes(a.timestamp), time: powClock(a.timestamp), kind: _powS(a.module) + ' ' + _powS(a.action).toLowerCase(),
                 ref: _powS(a.refNo), text: _powS(a.summary), amount: _powNum(a.amount) }))
    .sort((a, b) => a.sort - b.sort);
}

/** The sent emails (Flask /api/email/today) folded into the auto log, in time order. */
function powWithEmails(auto, emails) {
  const mail = (emails || []).map(e => ({ sort: _powMinutes(e.sentAt), time: powClock(e.sentAt), kind: 'Email out', ref: '',
    text: '"' + _powS(e.subject || '(no subject)') + '" to ' + _powS(e.name || e.recipient || e.company) }));
  return (auto || []).concat(mail).sort((a, b) => a.sort - b.sort);
}

function _powBooked(ix, rep, day) {
  const items = [];
  ix.itins.forEach(it => {
    if (!_powSame(it.user, rep.name)) return;
    const st = _powS(it.status) || 'Draft', counted = st !== 'Draft' && st !== 'Rejected';
    (it.items || []).forEach(x => {
      if (_powS(x.date) !== day) return;
      items.push({ sort: _powMinutes(x.plannedTime), time: powClock(x.plannedTime) || _powS(x.plannedTime), kind: 'Plan', client: _powS(x.company),
                   person: _powS(x.personToMeet), what: _powS(x.purpose || x.agenda), ref: _powS(it.itineraryNo) + ' #' + x.seq, planStatus: st, counted });
    });
  });
  ix.leads.forEach(l => {
    if (_powDate(l.presentationDate) !== day) return;
    if (!_powSame(l.handedTo, rep.username) && !_powSame(l.handedTo, rep.name)) return;
    items.push({ sort: _powMinutes(l.presentationDate), time: powClock(l.presentationDate), kind: 'Presentation', client: _powS(l.company),
                 person: _powS(l.contactName), what: 'Presentation booked by Lead Gen', ref: _powS(l.leadNo), planStatus: _powS(l.status), counted: true });
  });
  return items.sort((a, b) => a.sort - b.sort);
}

/** The 8:00 numbers for `day`. */
function powMorning(ix, rep, day) {
  const cfg = ix.cfg, field = powIsFieldDay(day, cfg);
  const booked = _powBooked(ix, rep, day), nBooked = booked.filter(b => b.counted).length;

  const past = _powPastMark(ix, rep, day), due = past.filter(x => x.f.state === 'due'), overdue = past.filter(x => x.f.state === 'overdue');
  const overdueValue = overdue.reduce((s, x) => s + flowQuotationNet(x.q), 0);
  const prev = _powPrevWorkday(day);
  const dueBefore = {}; _powDueOn(ix, rep, prev).forEach(x => { dueBefore[_powS(x.q.quotationNo)] = true; });
  const carried = due.filter(x => dueBefore[_powS(x.q.quotationNo)]).length;

  const open = _powOpenOn(ix, rep, day);
  const openValue = open.reduce((s, q) => s + flowQuotationNet(q), 0);
  const undated = open.filter(q => !_powDate(q.sentAt)), undatedValue = undated.reduce((s, q) => s + flowQuotationNet(q), 0);

  return [
    _powN('booked', 'Visits / presentations booked today', {
      value: nBooked, text: String(nBooked), target: field ? cfg.powVisitsDay + ' a field day' : 'not a field day',
      status: field ? (nBooked >= cfg.powVisitsDay ? 'ok' : 'red') : 'none',
      items: booked, note: 'From the weekly plan (submitted or approved) and the presentations Lead Gen booked. A stop in a plan still in draft is listed but not counted.'
    }),
    _powN('followDue', 'Follow-ups due today', {
      value: due.length, text: String(due.length), target: 'all done the same day',
      status: !due.length ? 'ok' : carried ? 'red' : 'watch',
      extra: overdue.length ? overdue.length + ' more overdue, 14+ days' : '',
      items: due.map(x => ({ ref: _powS(x.q.quotationNo), client: _powS(x.q.customer), value: flowQuotationNet(x.q), what: x.f.label,
                             state: x.f.state, carried: !!dueBefore[_powS(x.q.quotationNo)] }))
        .concat(overdue.map(x => ({ ref: _powS(x.q.quotationNo), client: _powS(x.q.customer), value: flowQuotationNet(x.q), what: x.f.label,
                                    state: 'overdue', overdue: true }))),
      note: 'Open quotations with no contact for ' + (_powNum(ix.settings.quotationFollowUpDays) || 7) + ' to 13 days (the portal\'s follow-up rule). A chase email, a call to the client or a follow-up set on the quotation counts as contact.' +
            (carried ? ' ' + carried + ' of them were already due on the last working day.' : '') +
            (overdue.length ? ' Listed after them, not counted: ' + overdue.length + ' quotations (' + powMoney(overdueValue) + ') with no contact for 14 days or more — chase them or close them as lost.' : '')
    }),
    _powNR('rfqWaiting', 'RFQs waiting for specs', '0 older than 24 h'),
    _powN('openQuotes', 'Open quotations (₱)', {
      value: openValue, text: powMoney(openValue), target: powMoney(cfg.powOpenQuotes) + ' or more',
      status: openValue >= cfg.powOpenQuotes ? 'ok' : openValue < cfg.powOpenQuotesRed ? 'red' : 'watch',
      items: open.map(q => ({ ref: _powS(q.quotationNo), client: _powS(q.customer), value: flowQuotationNet(q), what: _powS(q.subject),
                              date: _powDate(q.sentAt) })).sort((a, b) => b.value - a.value),
      note: 'Quotations sent and not yet won or lost, net of discount. Won and lost are as they stand today.' +
            (overdueValue ? ' ' + powMoney(overdueValue) + ' of it has had no contact for 14 days or more.' : '') +
            (undatedValue ? ' ' + powMoney(undatedValue) + ' (' + undated.length + ' quotations) was sent before the portal recorded send dates.' : '')
    })
  ];
}

function _powRfqs(ix, rep, day) {
  return Object.keys(ix.prCreated).filter(no => _powDate(ix.prCreated[no].ts) === day).map(no => {
    const pr = ix.prs[no];
    return { ref: no, owner: pr ? _powPrOwner(pr) : ix.prCreated[no].user, client: pr ? _powS(pr.customer) : '', time: powClock(ix.prCreated[no].ts),
             sort: _powMinutes(ix.prCreated[no].ts), what: pr ? _powS(pr.status) : '' };
  }).filter(x => _powSame(x.owner, rep.name)).sort((a, b) => a.sort - b.sort);
}

/** Quotations the rep's clients received on `day`: the "Sent" event in the log, or a real sent stamp that day
 *  (an estimated stamp from the backfill is never counted). */
function _powQuotesSent(ix, rep, day) {
  const seen = {}, out = [];
  const add = (q, ts) => {
    const no = _powS(q.quotationNo);
    if (seen[no] || !_powSame(_powQOwner(q), rep.name)) return;
    seen[no] = true;
    out.push({ ref: no, client: _powS(q.customer), value: flowQuotationNet(q), time: powClock(ts), sort: _powMinutes(ts), what: _powS(q.subject), prNo: _powS(q.prNo), sentTs: _powS(ts) });
  };
  Object.keys(ix.qSent).forEach(no => { const q = ix.qByNo[no]; if (q && _powDate(ix.qSent[no].ts) === day) add(q, ix.qSent[no].ts); });
  ix.quotations.forEach(q => { if (q.sentAt && !_powS(q.sentAtBasis) && _powDate(q.sentAt) === day) add(q, q.sentAt); });
  return out.sort((a, b) => a.sort - b.sort);
}

function _powFollowDone(ix, rep, day) {
  return _powDueOn(ix, rep, day).map(x => {
    const proof = _powContacts(ix, rep, x.q, day, day);
    return { ref: _powS(x.q.quotationNo), client: _powS(x.q.customer), value: flowQuotationNet(x.q), done: proof.length > 0, proof,
             what: proof.length ? proof.map(p => p.kind + (p.time ? ' ' + p.time : '')).join(', ') : 'no contact recorded' };
  });
}

/** The 4:30 numbers for `day`. `nowMin` (minutes after midnight) keeps today's follow-ups at "watch" until 4:30. */
function powEvening(ix, rep, day, nowMin) {
  const cfg = ix.cfg, field = powIsFieldDay(day, cfg);
  const visits = powLog(ix, rep, day).filter(l => l.type === 'Visit');
  const rfqs = _powRfqs(ix, rep, day);
  const sent = _powQuotesSent(ix, rep, day), sentValue = sent.reduce((s, x) => s + x.value, 0);
  const fu = _powFollowDone(ix, rep, day), done = fu.filter(x => x.done).length;
  const chased = _powOverdueOn(ix, rep, day).map(x => ({ x, proof: _powContacts(ix, rep, x.q, day, day) })).filter(c => c.proof.length)
    .map(c => ({ ref: _powS(c.x.q.quotationNo), client: _powS(c.x.q.customer), value: flowQuotationNet(c.x.q), done: true, overdue: true, proof: c.proof,
                 what: 'overdue, chased: ' + c.proof.map(p => p.kind + (p.time ? ' ' + p.time : '')).join(', ') }));
  const before430 = day === ix.today && (nowMin == null ? 0 : nowMin) < 16 * 60 + 30;
  return [
    _powN('visitsDone', 'Visits / presentations done', {
      value: visits.length, text: String(visits.length), source: 'MY LOG', target: field ? cfg.powVisitsDay + ' a field day' : 'not a field day',
      status: field ? (visits.length >= cfg.powVisitsDay ? 'ok' : 'watch') : (visits.length ? 'ok' : 'none'),
      items: visits, note: 'The client visits the rep logged that day, each with its photo.'
    }),
    _powN('rfqs', 'RFQs received', {
      value: rfqs.length, text: String(rfqs.length), target: 'set after the 20 Nov pilot', items: rfqs,
      note: 'Purchase requests created that day for this rep\'s clients.'
    }),
    _powN('quotesSent', 'Quotes sent', {
      value: sent.length, text: sent.length ? sent.length + ' · ' + powMoney(sentValue) : '0', target: cfg.powQuotesWeek + ' a week worth ' + powMoney(cfg.powQuotesWeekValue),
      items: sent, note: 'Quotations marked sent to the client that day.'
    }),
    _powN('followDone', 'Follow-ups done', {
      value: done, text: done + ' of ' + fu.length, source: 'MY LOG', target: 'all due, with a result',
      status: !fu.length || done === fu.length ? 'ok' : before430 ? 'watch' : 'red',
      extra: chased.length ? 'and ' + chased.length + ' overdue chased' : '',
      items: fu.concat(chased), note: 'Of the follow-ups due that morning, those with a contact that day: a chase email, a call to the client, or a follow-up set on the quotation. Overdue quotations the rep chased that day are listed after them.'
    })
  ];
}

/* ── the week ──────────────────────────────────────────────────────────────────────────────── */

function _powPrCreatedTs(ix, prNo) {
  const c = ix.prCreated[prNo];
  if (c) return c.ts;
  const pr = ix.prs[prNo];
  return pr ? _powS(pr.date) : '';
}
function _powPrFor(ix, quote) {
  if (quote.prNo && ix.prs[quote.prNo]) return quote.prNo;
  const no = quote.ref;
  const hit = Object.keys(ix.prs).find(k => { const p = ix.prs[k]; return _powS(p.quotationNo) === no || (p.quotationNos || []).indexOf(no) >= 0; });
  return hit || _powS(quote.prNo);
}

/** Sales orders this month up to `day`, each given to a rep: by its quotation's owner, otherwise by the client —
 *  the rep who last quoted that client before the order. Orders neither way reaches are returned as `unmatched`. */
function powSalesOrders(ix, rep, day) {
  const month = day.slice(0, 7), mine = [], unmatched = [];
  ix.sos.forEach(so => {
    const d = _powDate(so.date);
    if (d.slice(0, 7) !== month || d > day) return;
    let owner = '', how = '';
    const q = so.quotationNo && ix.qByNo[_powS(so.quotationNo)];
    if (q) { owner = _powQOwner(q); how = 'quotation ' + _powS(so.quotationNo); }
    else {
      let best = null, bestDay = '';
      ix.quotations.forEach(x => {
        const qd = _powDate(x.sentAt || x.date);
        if (!qd || qd > d || !_powSameCo(x.customer, so.customer) || /^(Draft|Pending|Rejected)/.test(_powS(x.status))) return;
        if (qd > bestDay) { best = x; bestDay = qd; }
      });
      if (best) { owner = _powQOwner(best); how = 'client, last quoted in ' + _powS(best.quotationNo); }
    }
    const row = { ref: _powS(so.soNo), client: _powS(so.customer), value: _powNum(so.total), date: d, owner, what: owner ? 'matched by ' + how : 'no quotation or client match' };
    if (!owner) unmatched.push(row);
    else if (_powSame(owner, rep.name)) mine.push(row);
  });
  return { mine: mine.sort((a, b) => a.date.localeCompare(b.date)), unmatched };
}

function _powSlots(ix, rep, day) {
  const nextMon = _powAddDays(powWorkWeek(day)[0], 7), items = [];
  ix.itins.forEach(it => {
    if (!_powSame(it.user, rep.name) || _powS(it.weekStart) !== nextMon) return;
    const st = _powS(it.status) || 'Draft', counted = st !== 'Draft' && st !== 'Rejected';
    (it.items || []).forEach(x => items.push({ date: _powS(x.date), time: powClock(x.plannedTime), client: _powS(x.company), person: _powS(x.personToMeet),
                                               what: _powS(x.purpose), ref: _powS(it.itineraryNo) + ' #' + x.seq, planStatus: st, counted }));
  });
  return items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** The Friday weekly form for the week holding `day`: ten lines, Mon–Fri columns, the week, target and status. */
function powWeek(ix, rep, day, nowMin) {
  const cfg = ix.cfg, days = powWorkWeek(day), upTo = day < ix.today ? day : ix.today;
  const live = days.filter(d => d <= upTo);
  const ended = day >= days[4] || ix.today > days[4];
  const per = days.map(d => {
    if (d > upTo) return null;
    const ev = powEvening(ix, rep, d, d === ix.today ? nowMin : 24 * 60);
    return { day: d, visits: ev[0], rfqs: ev[1], quotes: ev[2], follow: ev[3] };
  });
  const sum = (k) => per.reduce((s, p) => s + (p ? p[k].value : 0), 0);
  const itemsOf = (k) => per.reduce((a, p) => a.concat(p ? p[k].items.map(i => Object.assign({ day: p.day }, i)) : []), []);
  const cell = (fn) => days.map((d, i) => (per[i] ? fn(per[i]) : ''));

  const visits = sum('visits');
  const rfqItems = itemsOf('rfqs');
  const quoteItems = itemsOf('quotes'), quoteValue = quoteItems.reduce((s, x) => s + x.value, 0);
  const followItems = itemsOf('follow'), followDue = followItems.filter(x => !x.overdue), followDone = followDue.filter(x => x.done).length;

  const within = quoteItems.map(x => {
    const pr = _powPrFor(ix, x), created = pr ? _powPrCreatedTs(ix, pr) : '';
    const hrs = created && x.sentTs ? (Date.parse(x.sentTs) - Date.parse(created)) / 3600000 : null;
    return Object.assign({}, x, { prNo: pr, prCreated: created, hours: hrs, ok: hrs !== null && isFinite(hrs) && hrs <= 48,
                                  what: hrs === null || !isFinite(hrs) ? 'no PR on record' : Math.round(hrs) + ' h from ' + pr });
  }).filter(x => x.prNo);
  const withinOk = within.filter(x => x.ok).length;

  const so = powSalesOrders(ix, rep, day), soValue = so.mine.reduce((s, x) => s + x.value, 0);
  const dim = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
  const pace = cfg.powSoMonth * Math.min(1, Number(day.slice(8, 10)) / dim);

  const morning = powMorning(ix, rep, day), open = morning[3];
  const slots = _powSlots(ix, rep, day), nSlots = slots.filter(s => s.counted).length;

  const rows = [
    _powN('visits', 'Visits / presentations done', {
      value: visits, text: String(visits), source: 'MY LOG', target: cfg.powVisitsWeek + ' a week',
      status: visits >= cfg.powVisitsWeek ? 'ok' : (ended && visits < cfg.powVisitsWeekRed) ? 'red' : 'watch',
      cells: cell(p => String(p.visits.value)), items: itemsOf('visits')
    }),
    _powN('rfqs', 'RFQs received', { value: rfqItems.length, text: String(rfqItems.length), target: 'set after the 20 Nov pilot', cells: cell(p => String(p.rfqs.value)), items: rfqItems }),
    _powNR('prsReturned', 'PRs returned for missing specs', '0'),
    _powN('quotes', 'Quotes sent', {
      value: quoteItems.length, text: quoteItems.length + ' · ' + powMoney(quoteValue), target: cfg.powQuotesWeek + ' worth ' + powMoney(cfg.powQuotesWeekValue),
      status: quoteItems.length >= cfg.powQuotesWeek && quoteValue >= cfg.powQuotesWeekValue ? 'ok' : (ended && quoteItems.length < cfg.powQuotesWeekRed) ? 'red' : 'watch',
      cells: cell(p => String(p.quotes.value)), items: quoteItems
    }),
    _powN('within48', 'Quotes within 48 hours', {
      value: withinOk, text: withinOk + ' of ' + within.length, target: Math.round(cfg.powWithin48 * 100) + '%',
      status: !within.length || withinOk / within.length >= cfg.powWithin48 ? 'ok' : 'watch', items: within,
      note: 'Time from the purchase request being created to the quotation being sent. Quotations with no purchase request are left out.'
    }),
    _powN('follow', 'Follow-ups done', {
      value: followDone, text: followDone + ' of ' + followDue.length, source: 'MY LOG', target: 'all due, with a result',
      status: followDone === followDue.length ? 'ok' : 'red', cells: cell(p => p.follow.text), items: followItems
    }),
    _powNR('perfCalls', 'Performance calls', '1 per delivery'),
    _powN('soMonth', 'Sales orders, month to date (₱)', {
      value: soValue, text: powMoney(soValue), source: 'LOG + MATCH', target: powMoney(cfg.powSoMonth) + ' a month',
      status: soValue >= pace ? 'ok' : 'watch', items: so.mine, unmatched: so.unmatched,
      note: 'Sales orders dated this month, before VAT. Each is given to the rep who owns its quotation, or else the rep who last quoted that client. On pace means at least ' + powMoney(pace) + ' by this date.'
    }),
    Object.assign({}, open, { key: 'open' }),
    _powN('slots', 'Slots confirmed for next week', {
      value: nSlots, text: nSlots + ' of ' + cfg.powSlotsWeek, target: cfg.powSlotsWeek + ' by Fri 16:00',
      status: nSlots >= cfg.powSlotsWeek ? 'ok' : ended ? 'red' : 'watch', items: slots,
      note: 'Stops in next week\'s plan once it is submitted. A plan still in draft is listed but not counted.'
    })
  ];
  return { days, live, rows, pace, soValue, nowEnded: ended };
}

/* ── what the rep would say ────────────────────────────────────────────────────────────────── */

function _powFind(list, key) { return (list || []).find(n => n.key === key) || _powN(key, ''); }

/** The 8:00 script, in the sample's words: what the person typed, and the numbers the portal read for them.
 *  typed = { booked, plan, blocker } from the form; a blank booked falls back to the stops in their weekly plan. */
function powSaysMorning(m, cfg, typed) {
  const t = typed || {}, b = _powFind(m, 'booked'), f = _powFind(m, 'followDue'), o = _powFind(m, 'openQuotes');
  const target = (cfg || POW_DEFAULTS).powOpenQuotes;
  const booked = _powS(t.booked) !== '' ? _powS(t.booked) : String(b.value);
  let s = 'Booked today: ' + booked + '. Follow-ups due: ' + f.value + '. RFQs waiting for specs: not recorded yet. ' +
          'Open quotes: ' + o.text + (o.value >= target ? ' — at or above ' : ' — below ') + powMoney(target) + '.';
  if (_powS(t.plan)) s += ' Today: ' + _powS(t.plan).replace(/\.$/, '') + '.';
  s += ' Blocker: ' + (_powS(t.blocker) && !/^(n\/?a|none|no|no blocker|wala)\.?$/i.test(_powS(t.blocker)) ? _powS(t.blocker).replace(/\.$/, '') : 'none') + '.';
  return s;
}

/** The 4:30 script, in the sample's words. typed = { visits, follow, carry } from the form. */
function powSaysEvening(e, typed) {
  const t = typed || {}, v = _powFind(e, 'visitsDone'), r = _powFind(e, 'rfqs'), q = _powFind(e, 'quotesSent'), f = _powFind(e, 'followDone');
  let s = 'Visits: ' + (_powS(t.visits) !== '' ? _powS(t.visits) : v.value) + '. ' +
          'RFQs: ' + r.value + (r.items.length ? ' — ' + r.items.slice(0, 3).map(i => i.ref + (i.client ? ', ' + i.client : '')).join('; ') : '') + '. ' +
          'Quotes sent: ' + q.value + (q.value ? ', worth ' + powMoney(q.items.reduce((a, x) => a + x.value, 0)) : '') + '. ' +
          'Follow-ups: ' + (_powS(t.follow) || f.text) + '.';
  if (_powS(t.carry)) s += ' Carries over: ' + _powS(t.carry).replace(/\.$/, '') + '.';
  return s;
}

/** The week's "Reading it" line: what is on target, what is not, and where next week's focus goes. */
function powReading(rep, w, ix) {
  const row = (k) => w.rows.find(x => x.key === k) || _powN(k, '');
  const activity = ['visits', 'quotes', 'follow'].map(row);
  const off = activity.filter(x => x.status === 'watch' || x.status === 'red');
  let s = off.length ? off.map(x => x.label + ' ' + x.text + ' against ' + x.target).join('; ') + '.' : 'Activity is on target.';
  const so = row('soMonth'), open = row('open');
  s += ' Sales orders this month are ' + so.text + (so.status === 'ok' ? ', on the ' : ' — under the ') + powMoney(ix.cfg.powSoMonth) + ' pace';
  if (so.status !== 'ok') {
    const next = (row('follow').items || []).filter(x => !x.done && !x.overdue).slice(0, 2).map(x => x.ref).concat(
      (open.items || []).slice(0, 2).map(x => x.ref)).slice(0, 2);
    s += ', so the open quotes (' + open.text + ') are the focus next week' + (next.length ? ': ' + next.join(', ') : '');
  }
  return s + '.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { POW_DEFAULTS, POW_NOT_RECORDED, powCfg, powIndex, powReps, powMorning, powEvening, powWeek, powLog, powAuto,
                     powWithEmails, powSalesOrders, powSaysMorning, powSaysEvening, powReading, powClock, powMoney,
                     powDow, powDayLong, powWorkWeek, powIsFieldDay };
}
