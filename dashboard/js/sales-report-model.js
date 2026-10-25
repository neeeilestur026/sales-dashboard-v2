/* sales-report-model.js — A348 · the numbers of the Sales Daily Report (redesigned), first on the director's dashboard.
 *
 * Neil's rules (21 Oct 2026): the portal fills what it already logs (work email, PRs, quotations); the person logs a
 * call, visit or result as one line, linked to a quote, PR, DR or email; the report IS the count, plus one line of
 * blocker at 4:30 (A349: no 8:00 huddle card, Neil 21 Oct); a desk day is the normal day.
 *
 * PURE. Everything arrives as arguments; nothing is fetched or drawn, so tests/flow/sales-report.js runs it in node.
 * The shared rules are not copied: flowQuotationOwner / flowQuotationNet / flowQuotationBucket / flowDate / flowToday
 * come from flow-api.js, iwSameCompany from itinerary-week.js.
 *
 * A tile is { key, label, value, text, bar (0..1, or null), target, status, note, items[] }:
 *   status  'ok' (on pace) · 'watch' · 'red' (past the red line) · 'none' (no target) · 'nr' (cannot be counted)
 * A log line is { id, type, company, person, note, result, reason, nextDate, linkType, linkId, linkLabel, loggedAt,
 *   createdBy, editedAt, editReason, voidedAt, voidReason, history[] } — never deleted; an edit or a void keeps a
 *   reason and what the line said before.
 */

/* The one set of targets (the prompt's table). Each can be overridden by a FlowSettings row with the same key. */
const SR_TARGETS = {
  srEmailsDay: 50, srEmailsDayRed: 40,
  srCallsDay: 20, srCallsDayRed: 15,
  srEmailsWeek: 250, srCallsWeek: 100,
  srQuotesWeek: 5, srQuotesWeekValue: 1100000, srQuotesWeekRed: 3,
  srWithin48: 0.9, srWithin48Red: 0.8,
  srOpenQuotes: 4500000, srOpenQuotesRed: 3000000
};
const SR_FOLLOW_DAYS = [3, 7, 14];                 // after the sent date; a weekend due date moves to Monday
const SR_LINE_TYPES = ['Call', 'Performance call', 'Quote result', 'Sales order', 'Visit'];
const SR_CALL_RESULTS = ['Reached', 'No answer', 'Booked', 'Call back'];
const SR_VISIT_RESULTS = ['RFQ promised', 'RFQ on site', 'Need later', 'No need'];
const SR_LOST_REASONS = ['Price', 'Time', 'Spec', 'Other'];
const SR_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SR_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SR_DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const SR_DAY_START = 8 * 60, SR_DAY_END = 17 * 60, SR_REPORT_END = 16 * 60 + 30;   // the working day, Manila minutes

function _srS(v) { return String(v == null ? '' : v).trim(); }
function _srSame(a, b) { const x = _srS(a).toLowerCase(), y = _srS(b).toLowerCase(); return !!x && x === y; }
function _srNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function _srDemo(no) { return /^DEMO-/i.test(_srS(no)); }
function _srDate(v) { return typeof flowDate === 'function' ? flowDate(v) : _srS(v).slice(0, 10); }
function _srSameCo(a, b) { return typeof iwSameCompany === 'function' ? iwSameCompany(a, b) : _srSame(a, b); }
function _srNet(q) { return typeof flowQuotationNet === 'function' ? flowQuotationNet(q) : _srNum(q.total); }
function _srOwner(q) { return typeof flowQuotationOwner === 'function' ? flowQuotationOwner(q) : _srS(q.salesperson || q.createdBy); }
function _srBucket(q, hasSO) { return typeof flowQuotationBucket === 'function' ? flowQuotationBucket(q, hasSO) : (q.status === 'Sent' ? 'sent' : ''); }

/** The targets, with any FlowSettings sr* row laid over them. */
function srCfg(settings) {
  const c = Object.assign({}, SR_TARGETS), s = settings || {};
  Object.keys(SR_TARGETS).forEach(k => {
    if (s[k] === undefined || s[k] === null || s[k] === '') return;
    const n = Number(s[k]);
    if (isFinite(n) && n >= 0) c[k] = n;
  });
  return c;
}

/* ── time and days (Manila) ─────────────────────────────────────────────────────────────────── */

/** Minutes after Manila midnight; -1 when there is no time. 'HH:mm', a Sheets 1899 time cell (+8 on the UTC parts, as
 *  iwTime12 does), or a real timestamp. */
function srMinutes(v) {
  const s = _srS(v);
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^1899-12-\d{2}T(\d{2}):(\d{2})/.exec(s);
  if (m) return ((Number(m[1]) + 8) % 24) * 60 + Number(m[2]);
  if (!/T\d{2}:\d{2}/.test(s)) return -1;
  const t = Date.parse(s);
  if (isNaN(t)) return -1;
  return Math.floor((((t / 60000) + 480) % 1440 + 1440) % 1440);
}
function srClock(v) {
  const m = srMinutes(v);
  if (m < 0) return '';
  const h = Math.floor(m / 60);
  return (h % 12 || 12) + ':' + String(m % 60).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}
function srDow(day) { const d = new Date(_srS(day) + 'T00:00:00Z'); return isNaN(d) ? '' : SR_DOW[d.getUTCDay()]; }
function srAddDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** 'Tuesday 21 Oct' */
function srDayLong(day) {
  const d = new Date(_srS(day) + 'T00:00:00Z');
  return isNaN(d) ? _srS(day) : SR_DAY_NAMES[srDow(day)] + ' ' + d.getUTCDate() + ' ' + SR_MONTHS[d.getUTCMonth()];
}
/** Mon..Sun of the week holding `day`. */
function srWeekDays(day) {
  const back = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7, mon = srAddDays(day, -back);
  return [0, 1, 2, 3, 4, 5, 6].map(i => srAddDays(mon, i));
}
/** A due date that falls on a Saturday or Sunday moves to the Monday after. */
function srShiftWeekend(day) { const w = srDow(day); return w === 'Sat' ? srAddDays(day, 2) : w === 'Sun' ? srAddDays(day, 1) : day; }

/** ₱186,400 below a million, ₱3.8M / ₱1.25M above. */
function srMoney(v) {
  const n = _srNum(v);
  if (Math.abs(n) >= 1e6) return '₱' + (n / 1e6).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'M';
  return '₱' + Math.round(n).toLocaleString('en-US');
}

/* ── the index: every read, cleaned and keyed once ─────────────────────────────────────────── */

/** raw = { today, quotations, salesOrders, quotationEmails, prs, activity, calls, visits, itineraries, settings, visitPlans } */
function srIndex(raw) {
  const r = raw || {};
  const ix = {
    today: _srS(r.today) || (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10)),
    settings: r.settings || {}, cfg: srCfg(r.settings),
    quotations: (r.quotations || []).filter(q => q && !_srDemo(q.quotationNo)),
    sos: (r.salesOrders || []).filter(s => s && !_srDemo(s.soNo)),
    activity: r.activity || [], calls: r.calls || [], visits: r.visits || [], itins: r.itineraries || [],
    plans: r.visitPlans || [],   // A369 — client visits, the new itinerary (FlowAPI 186)
    hasSO: {}, links: {}, qByNo: {}, prs: {}, prCreated: {}, qSent: {},
    book: { clients: (r.book && r.book.clients) || [], log: (r.book && r.book.log) || [], links: (r.book && r.book.links) || [] }   // A350 — the Client Book trial, when FlowAPI 178 is in; A360 its links
  };
  ix.sos.forEach(s => { if (s.quotationNo) ix.hasSO[_srS(s.quotationNo)] = true; });
  ix.quotations.forEach(q => { ix.qByNo[_srS(q.quotationNo)] = q; });
  (r.quotationEmails || []).forEach(l => { const k = _srS(l && l.quotationNo); if (k) (ix.links[k] = ix.links[k] || []).push(l); });
  (r.prs || []).forEach(p => { if (p && p.prNo) ix.prs[_srS(p.prNo)] = p; });
  ix.activity.forEach(a => {
    const k = _srS(a.refNo);
    if (!k) return;
    if (a.module === 'Pricing Request' && a.action === 'Created' && (!ix.prCreated[k] || a.timestamp < ix.prCreated[k].ts)) ix.prCreated[k] = { ts: _srS(a.timestamp), user: _srS(a.user) };
    if (a.module === 'Quotation' && a.action === 'Sent' && (!ix.qSent[k] || a.timestamp < ix.qSent[k].ts)) ix.qSent[k] = { ts: _srS(a.timestamp), user: _srS(a.user) };
  });
  return ix;
}

/* ── the report the person keeps (v2) ──────────────────────────────────────────────────────── */

function srBlank() {
  return { v: 2, dayType: '', dayTypeOverridden: false, am: { plan: '', givenAt: '' }, pm: { blocker: '' }, bookings: [], lines: [], visits: [] };
}
/** A saved report made safe to read. A day saved by the A347 form (no v:2) starts blank, its content kept as legacy. */
function srFill(saved) {
  const o = saved && typeof saved === 'object' ? saved : {};
  const b = srBlank();
  if (o.v !== 2) { if (Object.keys(o).length) b.legacy = o; return b; }
  b.dayType = o.dayType === 'visit' || o.dayType === 'desk' ? o.dayType : '';
  b.dayTypeOverridden = !!o.dayTypeOverridden;
  b.am = { plan: _srS(o.am && o.am.plan), givenAt: _srS(o.am && o.am.givenAt) };
  b.pm = { blocker: _srS(o.pm && o.pm.blocker) };
  b.bookings = Array.isArray(o.bookings) ? o.bookings.map(_srS).filter(Boolean) : [];
  b.lines = Array.isArray(o.lines) ? o.lines.filter(l => l && l.id).map(l => Object.assign({ history: [] }, l, { history: Array.isArray(l.history) ? l.history : [] })) : [];
  b.visits = Array.isArray(o.visits) ? o.visits.filter(v => v && v.id) : [];
  if (o.legacy) b.legacy = o.legacy;
  return b;
}
const SR_LINE_FIELDS = ['type', 'company', 'person', 'note', 'result', 'reason', 'nextDate', 'linkType', 'linkId', 'linkLabel'];
/** A new line, stamped now. */
function srNewLine(f, who, nowIso) {
  const line = { id: 'L' + Date.parse(nowIso).toString(36) + Math.random().toString(36).slice(2, 6), loggedAt: nowIso, createdBy: _srS(who),
                 editedAt: '', editReason: '', voidedAt: '', voidReason: '', history: [] };
  SR_LINE_FIELDS.forEach(k => { line[k] = _srS((f || {})[k]); });
  if (SR_LINE_TYPES.indexOf(line.type) < 0) line.type = 'Call';
  if (!line.linkType || !line.linkId) { line.linkType = 'none'; line.linkId = ''; line.linkLabel = ''; }
  return line;
}
/** An edit keeps what the line said before, and why it changed. A reason is required. */
function srEditLine(line, changes, reason, nowIso) {
  if (!_srS(reason)) return { error: 'Say why the line is changing.' };
  const before = {};
  SR_LINE_FIELDS.forEach(k => { before[k] = line[k]; });
  line.history = (line.history || []).concat([{ at: nowIso, reason: _srS(reason), before }]);
  SR_LINE_FIELDS.forEach(k => { if (changes && changes[k] !== undefined) line[k] = _srS(changes[k]); });
  if (!line.linkType || !line.linkId) { line.linkType = 'none'; line.linkId = ''; line.linkLabel = ''; }
  line.editedAt = nowIso; line.editReason = _srS(reason);
  return { line };
}
/** Adding a link to a line that had none is filling it in, not changing it: no reason asked, still remembered. */
function srAddLink(line, linkType, linkId, linkLabel, nowIso) {
  line.history = (line.history || []).concat([{ at: nowIso, reason: 'link added', before: { linkType: line.linkType, linkId: line.linkId } }]);
  line.linkType = _srS(linkType) || 'none'; line.linkId = _srS(linkId); line.linkLabel = _srS(linkLabel);
  if (!line.linkId) { line.linkType = 'none'; line.linkLabel = ''; }
  return line;
}
/** A void keeps the line, struck through, with its reason. Never a delete. */
function srVoidLine(line, reason, nowIso) {
  if (!_srS(reason)) return { error: 'Say why the line is voided.' };
  line.voidedAt = nowIso; line.voidReason = _srS(reason);
  return { line };
}
const _srLive = (report) => ((report && report.lines) || []).filter(l => !l.voidedAt);
function _srOn(day) { return (l) => _srDate(l.loggedAt) === day; }
/** "Log lines with a link: X of Y" — the day's live lines. */
function srLinked(report, day) {
  const lines = _srLive(report).filter(_srOn(day));
  return { linked: lines.filter(l => l.linkType && l.linkType !== 'none' && l.linkId).length, total: lines.length };
}

/* ── the day type ──────────────────────────────────────────────────────────────────────────── */

/** The stops in the person's weekly plan for `day` (a plan that is submitted or approved; a draft is not a booking),
 *  and A369 their client visits that day (sent to the director, approved or done; not a draft, sent back or cancelled). */
function srPlanned(ix, me, day) {
  const out = [];
  (ix.plans || []).forEach(v => {
    const st = _srS(v.status);
    if (!_srSame(v.user, me.name) || _srS(v.date) !== day || ['Pending Director', 'Approved', 'Done'].indexOf(st) < 0) return;
    const town = _srS(v.address).split(',').map(x => x.trim()).filter(Boolean).slice(-2).join(', ');
    out.push({ ref: _srS(v.visitPlanNo), time: srClock(v.time) || _srS(v.time), sort: srMinutes(v.time), company: _srS(v.company),
               person: (v.contacts || []).map(c => _srS(c && c.name)).concat(_srS(v.someoneElse)).filter(Boolean).join(', '),
               city: town, purpose: _srS(v.purpose), status: st });
  });
  ix.itins.forEach(it => {
    const st = _srS(it.status) || 'Draft';
    if (!_srSame(it.user, me.name) || st === 'Draft' || st === 'Rejected') return;
    (it.items || []).forEach(x => {
      if (_srS(x.date) !== day) return;
      out.push({ ref: _srS(it.itineraryNo) + '#' + x.seq, time: srClock(x.plannedTime) || _srS(x.plannedTime), sort: srMinutes(x.plannedTime),
                 company: _srS(x.company), person: _srS(x.personToMeet), city: _srS(x.cityArea), purpose: _srS(x.purpose), status: st });
    });
  });
  return out.sort((a, b) => a.sort - b.sort);
}
/** Visit day when the plan has a stop that day; otherwise a desk day. The person's own switch wins. */
function srDayType(ix, me, day, report) {
  const planned = srPlanned(ix, me, day);
  const auto = planned.length ? 'visit' : 'desk';
  const r = report || {};
  return { type: r.dayTypeOverridden && (r.dayType === 'visit' || r.dayType === 'desk') ? r.dayType : auto, auto, planned, overridden: !!r.dayTypeOverridden };
}

/* ── quotations: open, due a follow-up, done ───────────────────────────────────────────────── */

/** The person's quotations with the client on `day`: Sent, no sales order, not closed, sent by then. */
function srOpenQuotes(ix, me, day) {
  return ix.quotations.filter(q => {
    if (!_srSame(_srOwner(q), me.name) || _srBucket(q, ix.hasSO) !== 'sent') return false;
    const s = _srDate(q.sentAt);
    return !s || s <= day;
  });
}

/** Follow-ups due on `day`: day 3, 7 and 14 after the sent date, a weekend moved to Monday, while still Sent.
 *  Done when a Call line linked to that quotation is logged that day, or a follow-up email is linked to it that day. */
function srFollowUps(ix, me, day, report) {
  const lines = _srLive(report).filter(_srOn(day));
  const out = [];
  srOpenQuotes(ix, me, day).forEach(q => {
    const sent = _srDate(q.sentAt);
    if (!sent) return;
    const step = SR_FOLLOW_DAYS.find(n => srShiftWeekend(srAddDays(sent, n)) === day);
    if (!step) return;
    const no = _srS(q.quotationNo);
    const call = lines.find(l => l.type === 'Call' && l.linkType === 'quotation' && l.linkId === no);
    const mail = (ix.links[no] || []).find(l => _srS(l.status || 'Active') === 'Active' && _srS(l.kind) !== 'Initial' && _srDate(l.sentAt) === day);
    out.push({ ref: no, client: _srS(q.customer), value: _srNet(q), step, sent,
               done: !!(call || mail), by: call ? { kind: 'Call', result: call.result, time: srClock(call.loggedAt), id: call.id }
                                            : mail ? { kind: 'Email', result: _srS(mail.subject), time: srClock(mail.sentAt) } : null });
  });
  return out.sort((a, b) => (a.done - b.done) || b.value - a.value);
}

/* A367 — Neil, 24 Oct 2026: "allow to select even older quotations". A follow-up on any other open quotation (one
   past day 14, or simply not due today) is picked from the follow-ups list and counts on top of the ones due. */
/** Whole days from `a` to `b` (YYYY-MM-DD). */
function srDaysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
/** The person's open quotations that are NOT due a follow-up on `day`: the ones that can still be followed up. */
function _srNotDue(ix, me, day) {
  const due = {};
  srFollowUps(ix, me, day, null).forEach(x => { due[x.ref] = true; });
  return srOpenQuotes(ix, me, day).filter(q => !due[_srS(q.quotationNo)]);
}
/** Follow-ups done on `day` on those other open quotations: a Call line linked to one, or a follow-up email linked to it. */
function srOtherFollowUps(ix, me, day, report) {
  const lines = _srLive(report).filter(_srOn(day));
  const out = [];
  _srNotDue(ix, me, day).forEach(q => {
    const no = _srS(q.quotationNo), sent = _srDate(q.sentAt);
    const call = lines.find(l => l.type === 'Call' && l.linkType === 'quotation' && l.linkId === no);
    const mail = call ? null : (ix.links[no] || []).find(l => _srS(l.status || 'Active') === 'Active' && _srS(l.kind) !== 'Initial' && _srDate(l.sentAt) === day);
    if (!call && !mail) return;
    out.push({ ref: no, client: _srS(q.customer), value: _srNet(q), sent, age: sent ? srDaysBetween(sent, day) : null, extra: true, done: true,
               by: call ? { kind: 'Call', result: call.result, time: srClock(call.loggedAt), id: call.id } : { kind: 'Email', result: _srS(mail.subject), time: srClock(mail.sentAt) } });
  });
  return out.sort((a, b) => b.value - a.value);
}
/** What can be picked to follow up on `day`: the other open quotations not yet followed up that day, oldest sent
 *  first (no sent date last). */
function srFollowUpChoices(ix, me, day, report) {
  const done = {};
  srOtherFollowUps(ix, me, day, report).forEach(x => { done[x.ref] = true; });
  return _srNotDue(ix, me, day).filter(q => !done[_srS(q.quotationNo)]).map(q => {
    const sent = _srDate(q.sentAt), age = sent ? srDaysBetween(sent, day) : null;
    return { ref: _srS(q.quotationNo), client: _srS(q.customer), value: _srNet(q), sent, age,
             label: _srS(q.quotationNo) + ' — ' + _srS(q.customer) + ', ' + srMoney(_srNet(q)) + (age === null ? '' : age === 0 ? ' · sent today' : ' · sent ' + age + (age === 1 ? ' day' : ' days') + ' ago') };
  }).sort((a, b) => (a.sent ? 0 : 1) - (b.sent ? 0 : 1) || _srS(a.sent).localeCompare(_srS(b.sent)) || a.ref.localeCompare(b.ref));
}

/* ── the portal's own records ──────────────────────────────────────────────────────────────── */

function _srPrsOn(ix, me, day, by) {
  return Object.keys(ix.prCreated).filter(no => _srDate(ix.prCreated[no].ts) === day).map(no => {
    const pr = ix.prs[no], c = ix.prCreated[no];
    return { ref: no, owner: pr ? _srS(pr.salesperson || pr.requestedBy) : c.user, creator: c.user, client: pr ? _srS(pr.customer) : '',
             time: srClock(c.ts), sort: srMinutes(c.ts), what: pr ? _srS(pr.status) : '' };
  }).filter(x => _srSame(by === 'made' ? x.creator : x.owner, me.name)).sort((a, b) => a.sort - b.sort);
}
/** Quotations the person's clients received on `day`: the Sent event, or a real sent stamp that day. */
function srQuotesSent(ix, me, day) {
  const seen = {}, out = [];
  const add = (q, ts) => {
    const no = _srS(q.quotationNo);
    if (seen[no] || !_srSame(_srOwner(q), me.name)) return;
    seen[no] = true;
    out.push({ ref: no, client: _srS(q.customer), value: _srNet(q), time: srClock(ts), sort: srMinutes(ts), sentTs: _srS(ts), prNo: _srS(q.prNo), day });
  };
  Object.keys(ix.qSent).forEach(no => { const q = ix.qByNo[no]; if (q && _srDate(ix.qSent[no].ts) === day) add(q, ix.qSent[no].ts); });
  ix.quotations.forEach(q => { if (q.sentAt && !_srS(q.sentAtBasis) && _srDate(q.sentAt) === day) add(q, q.sentAt); });
  return out.sort((a, b) => a.sort - b.sort);
}
function _srPrFor(ix, quote) {
  if (quote.prNo && ix.prs[quote.prNo]) return quote.prNo;
  const hit = Object.keys(ix.prs).find(k => { const p = ix.prs[k]; return _srS(p.quotationNo) === quote.ref || (p.quotationNos || []).indexOf(quote.ref) >= 0; });
  return hit || _srS(quote.prNo);
}
/** This week's quotations sent so far (Mon..day), each with the hours from its PR being created. */
function srWithin48(ix, me, day) {
  const days = srWeekDays(day).filter(d => d <= day);
  return days.reduce((a, d) => a.concat(srQuotesSent(ix, me, d)), []).map(x => {
    const pr = _srPrFor(ix, x), c = pr && ix.prCreated[pr] ? ix.prCreated[pr].ts : (pr && ix.prs[pr] ? _srS(ix.prs[pr].date) : '');
    const hrs = c && x.sentTs ? (Date.parse(x.sentTs) - Date.parse(c)) / 3600000 : null;
    return Object.assign({}, x, { prNo: pr, hours: hrs, ok: hrs !== null && isFinite(hrs) && hrs <= 48,
                                  what: hrs === null || !isFinite(hrs) ? 'no PR on record' : Math.round(hrs) + ' h from ' + pr });
  }).filter(x => x.prNo);
}

/* ── the tiles ─────────────────────────────────────────────────────────────────────────────── */

/** How much of the working day has gone: 0 before 8:00, 1 after 17:00 or on a past day. */
function _srElapsed(ix, day, nowMin) {
  if (day < ix.today) return 1;
  if (day > ix.today) return 0;
  return Math.max(0, Math.min(1, ((nowMin == null ? SR_DAY_END : nowMin) - SR_DAY_START) / (SR_DAY_END - SR_DAY_START)));
}
/** On pace for the part of the day gone; red only once the day is over (or the report is due) and it is under the red line. */
function _srPace(ix, day, nowMin, value, target, red) {
  const ended = day < ix.today || (day === ix.today && (nowMin == null ? SR_DAY_END : nowMin) >= SR_REPORT_END);
  if (value >= target * _srElapsed(ix, day, nowMin)) return value >= target || !ended ? 'ok' : 'watch';
  if (ended && value < red) return 'red';
  return 'watch';
}
function _srTile(key, label, o) { return Object.assign({ key, label, value: 0, text: '0', bar: null, target: '', status: 'none', note: '', items: [] }, o || {}); }

/** Row A — the portal fills these. `emails` is the day's sent list, or null when the mailbox could not be read. */
function srPortalTiles(ix, me, day, emails, nowMin) {
  const c = ix.cfg;
  const em = Array.isArray(emails) ? emails : null;
  const rfqs = _srPrsOn(ix, me, day, 'owner'), made = _srPrsOn(ix, me, day, 'made');
  const sent = srQuotesSent(ix, me, day);
  const week = srWeekDays(day).filter(d => d <= day).reduce((a, d) => a.concat(srQuotesSent(ix, me, d)), []);
  const weekValue = week.reduce((s, x) => s + x.value, 0);
  const workDaysGone = srWeekDays(day).slice(0, 5).filter(d => d <= day).length;
  const weekEnded = srDow(day) === 'Fri' && day < ix.today || ['Sat', 'Sun'].indexOf(srDow(day)) >= 0;
  const w48 = srWithin48(ix, me, day), w48ok = w48.filter(x => x.ok).length, share = w48.length ? w48ok / w48.length : null;
  const open = srOpenQuotes(ix, me, day), openValue = open.reduce((s, q) => s + _srNet(q), 0);
  return [
    _srTile('emailsSent', 'Emails sent', em ? {
      value: em.length, text: String(em.length), bar: Math.min(1, em.length / c.srEmailsDay), target: c.srEmailsDay + ' a day',
      status: _srPace(ix, day, nowMin, em.length, c.srEmailsDay, c.srEmailsDayRed),
      items: em.map(e => ({ time: srClock(e.sentAt), what: _srS(e.subject) || '(no subject)', client: _srS(e.name || e.recipient) }))
    } : { value: null, text: '—', target: c.srEmailsDay + ' a day', status: 'nr', note: 'The work mailbox could not be read, so sent emails cannot be counted.' }),
    _srTile('rfqs', 'RFQs received', { value: rfqs.length, text: String(rfqs.length), items: rfqs, note: 'Purchase requests created that day for your clients (one PR is one client RFQ).' }),
    _srTile('prsMade', 'PRs made', { value: made.length, text: String(made.length), items: made, note: 'Purchase requests you created that day.' }),
    _srTile('quotesSent', 'Quotes sent', {
      value: sent.length, text: String(sent.length), bar: Math.min(1, week.length / c.srQuotesWeek),
      target: c.srQuotesWeek + ' a week · ' + week.length + ' so far',
      status: week.length >= c.srQuotesWeek && weekValue >= c.srQuotesWeekValue ? 'ok'
            : weekEnded && week.length < c.srQuotesWeekRed ? 'red'
            : week.length >= c.srQuotesWeek * workDaysGone / 5 ? 'ok' : 'watch',
      items: sent, note: 'Quotations marked sent to the client that day. This week: ' + week.length + ' worth ' + srMoney(weekValue) + ' (target ' + c.srQuotesWeek + ' worth ' + srMoney(c.srQuotesWeekValue) + ').'
    }),
    _srTile('within48', 'Quotes within 48 h', {
      value: share, text: share === null ? '—' : Math.round(share * 100) + '%', bar: share, target: Math.round(c.srWithin48 * 100) + '% · ' + w48ok + ' of ' + w48.length + ' this week',
      status: share === null ? 'none' : share >= c.srWithin48 ? 'ok' : share < c.srWithin48Red ? 'red' : 'watch', items: w48,
      note: 'This week\'s quotations, from the purchase request being created to the quotation being sent. Quotations with no PR are left out.'
    }),
    _srTile('openQuotes', 'Open quotations (₱)', {
      value: openValue, text: srMoney(openValue), bar: Math.min(1, openValue / c.srOpenQuotes), target: srMoney(c.srOpenQuotes) + ' or more',
      status: openValue >= c.srOpenQuotes ? 'ok' : openValue < c.srOpenQuotesRed ? 'red' : 'watch',
      items: open.map(q => ({ ref: _srS(q.quotationNo), client: _srS(q.customer), value: _srNet(q), date: _srDate(q.sentAt) })).sort((a, b) => b.value - a.value),
      note: 'Your quotations with status Sent, not won (no sales order) and not closed, net of discount.'
    })
  ];
}

/** Calls already in the portal's call log for the person that day (logged on the old page), shown grey and counted. */
function srCallLog(ix, me, day) {
  return ix.calls.filter(c => _srSame(c.user, me.name) && _srDate(c.date) === day && !_srS(c.kind))
    .map(c => ({ ref: _srS(c.callNo), time: srClock(c.createdAt), sort: srMinutes(c.createdAt), company: _srS(c.company), person: _srS(c.contact), note: _srS(c.notes), result: _srS(c.outcome) }));
}
function srVisitLog(ix, me, day) {
  return ix.visits.filter(v => _srSame(v.user, me.name) && _srDate(v.date) === day)
    .map(v => ({ ref: _srS(v.visitNo), time: srClock(srMinutes(v.time) >= 0 ? v.time : v.createdAt), company: _srS(v.company), person: _srS(v.personVisited), note: _srS(v.agenda), result: _srS(v.summaryOfAgenda) }));
}

/** Row B — from the person's log lines. */
function srMineTiles(ix, me, day, report, nowMin, dayType) {
  const c = ix.cfg, lines = _srLive(report).filter(_srOn(day));
  const calls = lines.filter(l => l.type === 'Call'), oldCalls = srCallLog(ix, me, day);
  const nCalls = calls.length + oldCalls.length;
  const fu = srFollowUps(ix, me, day, report), done = fu.filter(x => x.done).length, other = srOtherFollowUps(ix, me, day, report);
  const ended = day < ix.today || (day === ix.today && (nowMin == null ? SR_DAY_END : nowMin) >= SR_REPORT_END);
  const booked = calls.filter(l => l.result === 'Booked').length + ((report && report.bookings) || []).length;
  const visits = lines.filter(l => l.type === 'Visit'), oldVisits = srVisitLog(ix, me, day), nVisits = visits.length + oldVisits.length;
  const dt = dayType || srDayType(ix, me, day, report);
  return [
    _srTile('calls', 'Calls logged', {
      value: nCalls, text: String(nCalls), bar: Math.min(1, nCalls / c.srCallsDay), target: c.srCallsDay + ' a day',
      status: _srPace(ix, day, nowMin, nCalls, c.srCallsDay, c.srCallsDayRed),
      items: calls.map(l => ({ time: srClock(l.loggedAt), client: l.company, person: l.person, what: l.note, result: l.result, ref: l.linkId }))
        .concat(oldCalls.map(x => Object.assign({ grey: true }, x, { client: x.company, what: x.note }))),
      note: oldCalls.length ? oldCalls.length + ' of them are in the portal\'s call log (logged on the old page).' : ''
    }),
    _srTile('followUps', 'Follow-ups done', {
      value: done + other.length, text: done + ' of ' + fu.length + (other.length ? ' +' + other.length : ''), bar: fu.length ? done / fu.length : null,
      target: 'all due today, the same day' + (other.length ? '; +' + other.length + ' on other quotations' : ''),
      status: !fu.length || done === fu.length ? 'ok' : ended ? 'red' : 'watch', items: fu.concat(other),
      note: 'Quotations due on day 3, 7 or 14 after they were sent (a weekend moves to Monday). Done by a call linked to the quotation, or a follow-up email linked to it, that day. A follow-up on any other open quotation, older ones included, counts on top (+).'
    }),
    _srTile('booked', 'Presentations booked', {
      value: booked, text: String(booked), target: 'target set after the 20 Nov pilot', status: 'none',
      items: calls.filter(l => l.result === 'Booked').map(l => ({ time: srClock(l.loggedAt), client: l.company, person: l.person, what: l.note, result: 'Booked' }))
        .concat(((report && report.bookings) || []).map(id => ({ what: 'Invite email marked as a booking', ref: id }))),
      note: 'Calls with the result Booked, and invite emails you marked as a booking.'
    }),
    dt.type === 'desk' && !nVisits
      ? _srTile('visits', 'Visits done', { value: null, text: '—', target: 'Desk day — no visit booked', status: 'none' })
      : _srTile('visits', 'Visits done', {
          value: nVisits, text: String(nVisits), bar: dt.planned.length ? Math.min(1, nVisits / dt.planned.length) : null,
          target: dt.planned.length ? dt.planned.length + ' booked' : 'unplanned',
          status: dt.planned.length ? (nVisits >= dt.planned.length ? 'ok' : 'watch') : 'none',
          items: visits.map(l => ({ time: srClock(l.loggedAt), client: l.company, person: l.person, what: l.note, result: l.result, ref: l.linkId }))
            .concat(oldVisits.map(x => Object.assign({ grey: true }, x, { client: x.company, what: x.note })))
        })
  ];
}

/** Every number on the page, as text and value — what the 4:30 report fixes when it is submitted. */
function srSnapshot(portal, mine, day, report) {
  const out = { day, at: '', linked: srLinked(report, day) };
  portal.concat(mine).forEach(t => { out[t.key] = { text: t.text, value: t.value, status: t.status }; });
  return out;
}

/* ── the portal's feed ─────────────────────────────────────────────────────────────────────── */

/** "Logged by the portal — you typed none of this": sent and received email, PRs and quotations, by time. */
function srPortalFeed(ix, me, day, sent, received) {
  const items = [];
  (sent || []).forEach(e => items.push({ kind: 'email', sort: srMinutes(e.sentAt), time: srClock(e.sentAt), id: _srS(e.messageId),
    text: 'Sent "' + (_srS(e.subject) || '(no subject)') + '" to ' + (_srS(e.name || e.recipient || e.company) || 'someone'), sent: true }));
  (received || []).filter(e => _srDate(e.date || e.sentAt) === day).forEach(e => items.push({ kind: 'email', sort: srMinutes(e.date || e.sentAt), time: srClock(e.date || e.sentAt),
    id: _srS(e.messageId), text: 'Received "' + (_srS(e.subject) || '(no subject)') + '" from ' + (_srS(e.name || e.from || e.company) || 'someone') + (e.category && e.category !== 'Other' ? ' (' + e.category + ')' : ''), sent: false }));
  ix.activity.filter(a => _srSame(a.user, me.name) && _srDate(a.date || a.timestamp) === day && (a.module === 'Pricing Request' || a.module === 'Quotation'))
    .forEach(a => {
      const pr = a.module === 'Pricing Request', q = !pr && ix.qByNo[_srS(a.refNo)], p = pr && ix.prs[_srS(a.refNo)];
      /* A358 — a PR made for a Client Book client (and its quotation, through the PR No) names that client;
         A360 — a record connected by hand (or taken off) on the Client Book decides first */
      const cbNo = pr ? srBookClient(ix, 'pr', a.refNo) : srBookClient(ix, 'quotation', a.refNo);
      const cb = cbNo ? ix.book.clients.find(c => _srS(c.clientNo) === cbNo) : null;
      items.push({ kind: pr ? 'pr' : 'quotation', sort: srMinutes(a.timestamp), time: srClock(a.timestamp), ref: _srS(a.refNo),
        client: cbNo ? { no: cbNo, company: cb ? _srS(cb.company) : cbNo } : null,
        text: (pr ? 'PR ' : 'Quotation ') + _srS(a.action).toLowerCase() + ((p && p.customer) || (q && q.customer) ? ' — ' + _srS((p && p.customer) || q.customer) : '') +
              (q && _srNet(q) ? ', ' + srMoney(_srNet(q)) : '') });
    });
  /* A350 — the person's Client Book changes that day */
  const co = {};
  ix.book.clients.forEach(c => { co[c.clientNo] = _srS(c.company); });
  ix.book.log.filter(l => _srSame(l.by, me.name) && _srDate(l.at) === day).forEach(l => items.push({ kind: 'client', sort: srMinutes(l.at), time: srClock(l.at), ref: '',
    text: srClientBookText(l) + (co[l.clientNo] ? ' — ' + co[l.clientNo] : '') }));
  return items.sort((a, b) => a.sort - b.sort);
}
/** One Client Book log row as a feed line. */
/** A360 — the Client Book client a PR or quotation belongs to: its own link row (blank = none), else the client its PR
 *  was made for, else (a quotation) its PR's. The same rule as FlowAPI 183's _cbLinkOf. */
function srBookClient(ix, kind, no) {
  const n = _srS(no), own = {};
  (ix.book.links || []).forEach(l => { own[_srS(l.kind) + ':' + _srS(l.no)] = _srS(l.clientNo); });
  if ((kind + ':' + n) in own) return own[kind + ':' + n];
  if (kind === 'pr') return _srS(ix.prs[n] && ix.prs[n].clientNo);
  const q = ix.qByNo[n];
  return q && _srS(q.prNo) ? srBookClient(ix, 'pr', q.prNo) : '';
}
function srClientBookText(l) {
  const ch = (what) => what + (l.from ? ' ' + _srS(l.from) + ' → ' : ' ') + _srS(l.to) + (l.ref ? ' (' + _srS(l.ref) + ')' : '');
  return l.kind === 'created' ? 'Added to the Client Book' : l.kind === 'accreditation' ? ch('Accreditation') : l.kind === 'status' ? ch('Status')
    : l.kind === 'contacts' ? 'Contacts updated' : l.kind === 'archived' ? 'Archived from the Client Book' : l.kind === 'restored' ? 'Restored to the Client Book'
    : l.kind === 'linked' ? 'Connected ' + (_srS(l.ref) || 'a record') : l.kind === 'unlinked' ? 'Took ' + (_srS(l.ref) || 'a record') + ' off'   // A360
    : 'Client details updated';
}
/** "Other portal activity today" — the rest of the person's log, not part of the sales report. */
function srOtherActivity(ix, me, day) {
  const rows = ix.activity.filter(a => _srSame(a.user, me.name) && _srDate(a.date || a.timestamp) === day);
  const tasks = {};
  rows.forEach(a => { if (a.module !== 'Pricing Request' && a.module !== 'Quotation' && a.module !== 'Call' && a.module !== 'Client Visit') tasks[a.module + '|' + (_srS(a.refNo) || a.timestamp)] = 1; });
  return { inventory: rows.filter(a => a.module === 'Inventory' && a.action === 'Added').length,
           pdfs: rows.filter(a => a.action === 'PDF Saved').length, tasks: Object.keys(tasks).length };
}

/** What a log line can link to: the person's open quotations, their PRs of the last two weeks, the day's emails. */
function srLinkOptions(ix, me, day, sent, received) {
  const from = srAddDays(day, -14);
  return {
    quotation: srOpenQuotes(ix, me, day).map(q => ({ id: _srS(q.quotationNo), label: _srS(q.quotationNo) + ' — ' + _srS(q.customer) + ', ' + srMoney(_srNet(q)), company: _srS(q.customer) })),
    pr: Object.keys(ix.prs).filter(no => { const p = ix.prs[no], c = ix.prCreated[no]; const d = c ? _srDate(c.ts) : _srDate(p.date); return _srSame(p.salesperson || p.requestedBy, me.name) && d >= from && d <= day; })
      .map(no => ({ id: no, label: no + ' — ' + _srS(ix.prs[no].customer), company: _srS(ix.prs[no].customer) })),
    /* A350 — the Client Book's clients, the person's own first (in the trial the director links to anyone's) */
    client: ix.book.clients.filter(c => !c.archivedAt).sort((a, b) => (_srSame(b.owner, me.name) - _srSame(a.owner, me.name)) || _srS(a.company).localeCompare(_srS(b.company)))
      .map(c => ({ id: _srS(c.clientNo), label: _srS(c.company) + (c.owner && !_srSame(c.owner, me.name) ? ' — ' + _srS(c.owner) : '') + ' (' + (_srS(c.status) || _srS(c.accreditation)) + ')', company: _srS(c.company) })),
    email: (sent || []).map(e => ({ id: _srS(e.messageId), label: 'Sent ' + srClock(e.sentAt) + ' — ' + (_srS(e.subject) || '(no subject)'), company: _srS(e.company) }))
      .concat((received || []).filter(e => _srDate(e.date || e.sentAt) === day).map(e => ({ id: _srS(e.messageId), label: 'Received ' + srClock(e.date || e.sentAt) + ' — ' + (_srS(e.subject) || '(no subject)'), company: _srS(e.company) })))
  };
}

/* ── A356 · the call form picks the company and the person from the Client Book ──────────────── */

function _srCo(name) { return _srS(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
/** The Client Book's live clients for the call form: the person's own first, then by company. */
function srBookClients(ix, me) {
  return ix.book.clients.filter(c => !c.archivedAt && _srS(c.company))
    .sort((a, b) => (_srSame(b.owner, me.name) - _srSame(a.owner, me.name)) || _srS(a.company).localeCompare(_srS(b.company)));
}
/** A contact as the Person field shows it: "Ana Cruz, Purchasing officer". */
function srContactLabel(p) { return [_srS(p && p.name), _srS(p && p.position)].filter(Boolean).join(', '); }
/** What the call form knows from what is typed: the Client Book client (its name in any case or punctuation), its
 *  contact people (the main contact first), the one typed (by name, or name and position), and the link the call takes. */
function srCallLookup(ix, me, company, person) {
  const key = _srCo(company), client = key ? srBookClients(ix, me).find(c => _srCo(c.company) === key) || null : null;
  if (!client) return { client: null, people: [], contact: null, link: null };
  const people = (client.contacts || []).filter(p => p && (_srS(p.name) || (p.emails || []).length || (p.phones || []).length))
    .slice().sort((a, b) => (b.primary === true) - (a.primary === true));
  const typed = _srS(person).toLowerCase();
  const contact = typed ? people.find(p => srContactLabel(p).toLowerCase() === typed || _srS(p.name).toLowerCase() === typed) || null : null;
  return { client, people, contact, link: { linkType: 'client', linkId: _srS(client.clientNo) } };
}

/* ── the week ──────────────────────────────────────────────────────────────────────────────── */

/** Mon–Sun. reports = { 'yyyy-mm-dd': {report, submittedAt} }, emailsByDay = { 'yyyy-mm-dd': [..] | null }. */
function srWeek(ix, me, day, reports, emailsByDay) {
  const c = ix.cfg, days = srWeekDays(day);
  const rows = days.map(d => {
    if (d > ix.today) return { day: d, future: true };
    const saved = (reports || {})[d] || null, rep = saved ? srFill(saved.report) : srBlank();
    const calls = _srLive(rep).filter(_srOn(d)).filter(l => l.type === 'Call');
    const nCalls = calls.length + srCallLog(ix, me, d).length;
    const fu = srFollowUps(ix, me, d, rep), fuOther = srOtherFollowUps(ix, me, d, rep).length;
    const em = emailsByDay && Array.isArray(emailsByDay[d]) ? emailsByDay[d].length : null;
    const weekend = srDow(d) === 'Sat' || srDow(d) === 'Sun';
    return {
      day: d, emails: em, calls: nCalls, fuDone: fu.filter(x => x.done).length, fuDue: fu.length, fuOther,
      quotes: srQuotesSent(ix, me, d).length, booked: calls.filter(l => l.result === 'Booked').length + rep.bookings.length,
      report: saved && saved.submittedAt ? { state: 'done', time: srClock(saved.submittedAt) } : weekend ? { state: 'none' } : { state: 'due' },
      emailTone: em === null || weekend ? '' : em < c.srEmailsDayRed ? 'watch' : em >= c.srEmailsDay ? 'ok' : '',
      callTone: weekend ? '' : nCalls < c.srCallsDayRed ? 'red' : nCalls >= c.srCallsDay ? 'ok' : ''
    };
  });
  const past = rows.filter(r => !r.future), sum = (k) => past.reduce((s, r) => s + (r[k] || 0), 0);
  const workDays = rows.filter(r => !r.future && srDow(r.day) !== 'Sat' && srDow(r.day) !== 'Sun');
  return { days, rows, totals: {
    emails: past.some(r => r.emails !== null) ? sum('emails') : null, emailsTarget: c.srEmailsWeek,
    calls: sum('calls'), callsTarget: c.srCallsWeek, fuDone: sum('fuDone'), fuDue: sum('fuDue'), fuOther: sum('fuOther'),
    quotes: sum('quotes'), quotesTarget: c.srQuotesWeek, booked: sum('booked'),
    reports: workDays.filter(r => r.report.state === 'done').length, reportDays: workDays.length
  } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SR_TARGETS, SR_FOLLOW_DAYS, srCfg, srIndex, srBlank, srFill, srNewLine, srEditLine, srAddLink, srVoidLine, srLinked,
                     srPlanned, srDayType, srOpenQuotes, srFollowUps, srOtherFollowUps, srFollowUpChoices, srDaysBetween, srQuotesSent, srWithin48, srPortalTiles, srMineTiles,
                     srSnapshot, srPortalFeed, srClientBookText, srOtherActivity, srLinkOptions, srBookClients, srContactLabel, srCallLookup, srWeek, srCallLog, srVisitLog, srClock, srMoney, srDow, srDayLong,
                     srWeekDays, srShiftWeekend, srAddDays };
}
