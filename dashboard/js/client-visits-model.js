/* client-visits-model.js — A369 · client visits, the new itinerary (client-visits.html). Pure: no DOM, no reads.
 *
 * Neil, 25 Oct 2026: a client visit page for each sales rep — they pick one of their Client Book clients and who to
 * visit; the director approves first; accounting sees the approved visits by day. The weekly itinerary keeps working
 * beside it. A visit (FlowAPI 186, getVisitPlans) is { visitPlanNo, date, time, user, clientNo, company, location,
 * address, contacts: [{id, name, position}], someoneElse, purpose, status, decision, decisionNote, cancelReason,
 * result, … }. The week view is js/client-visits-week.js. */

const CV_STATUSES = ['Draft', 'Pending Director', 'Approved', 'Done', 'Rejected', 'Cancelled'];
const CV_LOCATIONS = ['Plant', 'Head office', 'Other'];
const CV_AHEAD = 92;
const CV_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _cvS(v) { return String(v == null ? '' : v).trim(); }
function _cvSame(a, b) { const x = _cvS(a).toLowerCase(); return !!x && x === _cvS(b).toLowerCase(); }

/* ── days ─────────────────────────────────────────────────────────────────────────────────── */

function cvAddDays(day, n) {
  const d = new Date(_cvS(day) + 'T00:00:00Z');
  if (isNaN(d)) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The Monday of the week a day falls in. */
function cvMonday(day) {
  const d = new Date(_cvS(day) + 'T00:00:00Z');
  if (isNaN(d)) return '';
  return cvAddDays(_cvS(day), -((d.getUTCDay() + 6) % 7));
}
/** "Mon 27 Oct", or with the year when it is not `thisYear`. */
function cvDayLabel(day, thisYear) {
  const d = new Date(_cvS(day) + 'T00:00:00Z');
  if (isNaN(d)) return _cvS(day);
  const y = d.getUTCFullYear();
  return CV_DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + CV_MON[d.getUTCMonth()] + (thisYear && String(y) !== String(thisYear) ? ' ' + y : '');
}
/** "27 Oct – 2 Nov 2026" for the week starting `monday`. */
function cvWeekLabel(monday) {
  const a = new Date(monday + 'T00:00:00Z'), b = new Date(cvAddDays(monday, 6) + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return '';
  return a.getUTCDate() + ' ' + CV_MON[a.getUTCMonth()] + ' – ' + b.getUTCDate() + ' ' + CV_MON[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
}
/** "9:30 AM" from "09:30"; '' when there is no time. */
function cvClock(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(_cvS(t));
  if (!m) return '';
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM');
}

/* ── a visit, read ────────────────────────────────────────────────────────────────────────── */

/** The town: the last two parts of an address ("Norzagaray, Bulacan"). */
function cvTown(addr) { return _cvS(addr).split(',').map(x => x.trim()).filter(Boolean).slice(-2).join(', '); }
/** Who is to be visited, in words. */
function cvPeople(v) { return ((v && v.contacts) || []).map(c => _cvS(c && c.name)).concat(_cvS(v && v.someoneElse)).filter(Boolean).join(', '); }
/** The words and tone of a status. */
function cvStatus(v) {
  const s = _cvS(v && v.status);
  if (s === 'Pending Director') return { text: 'With the director', tone: 'mid' };
  if (s === 'Approved') return { text: 'Approved', tone: 'ok' };
  if (s === 'Done') return { text: 'Done', tone: 'done' };
  if (s === 'Rejected') return { text: 'Sent back', tone: 'bad' };
  if (s === 'Cancelled') return { text: 'Cancelled', tone: 'off' };
  return { text: 'Draft', tone: 'draft' };
}
/** What accounting sees: the approved visits, the done ones, and the ones cancelled after they were approved
 *  — the same rule the server reads by. */
function cvForAccounting(v) {
  const s = _cvS(v && v.status);
  return s === 'Approved' || s === 'Done' || (s === 'Cancelled' && _cvS(v.decision) === 'Approved');
}
/** Newest day first, then by time; no time last within a day. */
function cvSort(list) {
  return (list || []).slice().sort((a, b) => (a.date === b.date ? (_cvS(a.time) || '99').localeCompare(_cvS(b.time) || '99') : (a.date < b.date ? 1 : -1)));
}
/** Earliest day first (for what is coming up). */
function cvSortUp(list) {
  return (list || []).slice().sort((a, b) => (a.date === b.date ? (_cvS(a.time) || '99').localeCompare(_cvS(b.time) || '99') : (a.date < b.date ? -1 : 1)));
}

/* ── what each person may do ──────────────────────────────────────────────────────────────── */

/** The buttons a visit shows to `me` ({role, name}) on `today`. The server checks every one again. */
function cvCan(v, me, today) {
  const role = _cvS(me && me.role).toLowerCase(), mine = role === 'sales' && _cvSame(v && v.user, me && me.name);
  const s = _cvS(v && v.status), open = s !== 'Done' && s !== 'Cancelled', future = _cvS(v && v.date) >= today;
  return {
    edit: mine && open && future,
    send: mine && (s === 'Draft' || s === 'Rejected') && future,
    cancel: open && (mine || role === 'director'),
    done: mine && s === 'Approved' && _cvS(v.date) <= today,
    decide: role === 'director' && s === 'Pending Director'
  };
}

/** A rep's own visits in three: what needs them (drafts, visits sent back, approved visits whose day has come), what
 *  is coming up (with the director or approved, today or later), and the rest (done, cancelled, or past). */
function cvSalesBuckets(list, today) {
  const out = { needs: [], upcoming: [], past: [] };
  (list || []).forEach(v => {
    const s = _cvS(v.status), d = _cvS(v.date);
    if (s === 'Draft' || s === 'Rejected' || (s === 'Approved' && d <= today)) out.needs.push(v);
    else if ((s === 'Pending Director' || s === 'Approved') && d >= today) out.upcoming.push(v);
    else out.past.push(v);
  });
  out.needs = cvSortUp(out.needs); out.upcoming = cvSortUp(out.upcoming); out.past = cvSort(out.past);
  return out;
}
/** Visits by day, in the order given: [{day, items}]. */
function cvByDay(list) {
  const out = [], at = {};
  (list || []).forEach(v => { const d = _cvS(v.date); if (!(d in at)) { at[d] = out.length; out.push({ day: d, items: [] }); } out[at[d]].items.push(v); });
  return out;
}
/** Visits by rep (A to Z), then by day: [{user, days: [{day, items}]}]. */
function cvByRep(list) {
  const reps = {};
  (list || []).forEach(v => { const u = _cvS(v.user) || 'No name'; (reps[u] = reps[u] || []).push(v); });
  return Object.keys(reps).sort((a, b) => a.localeCompare(b)).map(u => ({ user: u, days: cvByDay(cvSortUp(reps[u])) }));
}
/** The reps named on these visits, A to Z. */
function cvReps(list) {
  const seen = {};
  (list || []).forEach(v => { const u = _cvS(v.user); if (u) seen[u.toLowerCase()] = seen[u.toLowerCase()] || u; });
  return Object.keys(seen).map(k => seen[k]).sort((a, b) => a.localeCompare(b));
}

/* ── planning a visit ─────────────────────────────────────────────────────────────────────── */

/** The places a client can be visited, with the address and why one cannot be chosen. */
function cvPlaces(client) {
  const c = client || {}, plant = _cvS(c.siteAddress), head = _cvS(c.headOfficeAddress);
  return [
    { loc: 'Plant', addr: plant, ok: !!plant, why: plant ? '' : 'No plant address in the Client Book' },
    { loc: 'Head office', addr: head, ok: !!head, why: head ? '' : 'No head office address in the Client Book' },
    { loc: 'Other', addr: '', ok: true, why: '' }
  ];
}
/** The first place that can be chosen: the plant, else the head office, else Other. */
function cvDefaultPlace(client) { return cvPlaces(client).filter(p => p.ok)[0].loc; }
/** The rep's own live clients to choose from, A to Z. */
function cvClients(book, me) {
  return ((book && book.clients) || []).filter(c => c && !c.archivedAt && _cvSame(c.owner, me && me.name))
    .sort((a, b) => _cvS(a.company).localeCompare(_cvS(b.company)));
}
/** The day of a visit, checked: '' when it will do, else what is wrong. */
function cvDayCheck(date, today) {
  const d = _cvS(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'Choose the day of the visit.';
  if (d < today) return 'The day has passed; choose today or a later day.';
  if (d > cvAddDays(today, CV_AHEAD)) return 'A visit can be planned up to ' + CV_AHEAD + ' days ahead.';
  return '';
}
/** One company of a plan, checked against its client: { stop } as the server takes it, or { error }. */
function cvStopCheck(f, client) {
  const x = f || {}, places = cvPlaces(client);
  const time = _cvS(x.time);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'The time must be like 09:30.' };
  const place = places.filter(p => p.loc === x.location)[0];
  if (!place) return { error: 'Say where.' };
  if (!place.ok) return { error: place.why + '. Add it there, or choose Other and type the address.' };
  const address = place.loc === 'Other' ? _cvS(x.address) : place.addr;
  if (!address) return { error: 'Type the address of the visit.' };
  const ids = (x.contactIds || []).map(_cvS).filter(Boolean), other = _cvS(x.someoneElse);
  if (!ids.length && !other) return { error: 'Choose who you will visit, or type someone else.' };
  const stop = { clientNo: _cvS(client.clientNo), time, location: place.loc, contactIds: ids, someoneElse: other, purpose: _cvS(x.purpose) };
  if (place.loc === 'Other') stop.address = address;
  return { stop };
}
/** The rep's own live visit (not cancelled) to a client on a day, other than `except`. */
function cvTwin(mine, clientNo, date, except) {
  return (mine || []).filter(v => v && _cvS(v.clientNo) === _cvS(clientNo) && _cvS(v.date) === date && _cvS(v.status) !== 'Cancelled' && _cvS(v.visitPlanNo) !== _cvS(except))[0] || null;
}
/** What the form sends to saveVisitPlan for ONE visit (a change, or a new one before FlowAPI 187), or the first thing
 *  missing. `f` = {clientNo, date, time, location, address, contactIds, someoneElse, purpose, visitPlanNo}; `mine` the
 *  rep's own visits. The server checks it all again. */
function cvPlanParams(f, client, today, mine) {
  const x = f || {};
  if (!client) return { error: 'Choose the client.' };
  const bad = cvDayCheck(x.date, today);
  if (bad) return { error: bad };
  const r = cvStopCheck(x, client), date = _cvS(x.date);
  if (r.error) return r;
  if (cvTwin(mine, client.clientNo, date, x.visitPlanNo)) return { error: 'You already have a visit to ' + client.company + ' that day.' };
  const s = r.stop, out = { clientNo: s.clientNo, date, time: s.time, location: s.location, contactIds: JSON.stringify(s.contactIds), someoneElse: s.someoneElse, purpose: s.purpose };
  if (s.address) out.address = s.address;
  if (_cvS(x.visitPlanNo)) out.visitPlanNo = _cvS(x.visitPlanNo);
  return { params: out };
}
/* A370 — Neil, 25 Oct 2026: "the new plan a visit can add multiple companies to visit in a day". One day and its
   companies, sent in one go (FlowAPI 187, saved all or none). */
const CV_DAY_MAX = 10;
/** What the form sends for a day of visits, or the first thing missing — naming the visit (and its company) it is in:
 *  { params: {date, stops} } or { error, stop }. `stops` = the form's companies, `byNo` the rep's clients by number. */
function cvDayParams(date, stops, byNo, today, mine) {
  const bad = cvDayCheck(date, today);
  if (bad) return { error: bad };
  const list = stops || [];
  if (!list.length) return { error: 'Add at least one company to visit.' };
  if (list.length > CV_DAY_MAX) return { error: 'Plan up to ' + CV_DAY_MAX + ' companies in one day.' };
  const d = _cvS(date), out = [], seen = {};
  for (let i = 0; i < list.length; i++) {
    const client = (byNo || {})[_cvS(list[i] && list[i].clientNo)];
    if (!client) return { error: 'Visit ' + (i + 1) + ': Choose the client.', stop: i + 1 };
    const tag = 'Visit ' + (i + 1) + ' (' + client.company + ')', r = cvStopCheck(list[i], client);
    if (r.error) return { error: tag + ': ' + r.error, stop: i + 1 };
    if (seen[client.clientNo]) return { error: client.company + ' is in this day twice (visits ' + seen[client.clientNo] + ' and ' + (i + 1) + ').', stop: i + 1 };
    seen[client.clientNo] = i + 1;
    if (cvTwin(mine, client.clientNo, d)) return { error: tag + ': you already have a visit to ' + client.company + ' that day.', stop: i + 1 };
    out.push(r.stop);
  }
  return { params: { date: d, stops: JSON.stringify(out) } };
}

/** The history of one visit, in words, oldest first. */
function cvLogLines(log, no) {
  const say = { created: 'Planned', edited: 'Changed', sent: 'Sent to the director', reopened: 'Changed after it was approved; back with the director',
                approved: 'Approved', 'sent back': 'Sent back', cancelled: 'Cancelled', done: 'Marked done' };
  return (log || []).filter(l => _cvS(l.visitPlanNo) === _cvS(no)).sort((a, b) => (_cvS(a.at) < _cvS(b.at) ? -1 : 1))
    .map(l => ({ at: _cvS(l.at), by: _cvS(l.by), text: (say[_cvS(l.kind)] || _cvS(l.kind)) + (l.kind !== 'reopened' && _cvS(l.note) ? ': ' + _cvS(l.note) : '') }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CV_STATUSES, CV_LOCATIONS, CV_AHEAD, cvAddDays, cvMonday, cvDayLabel, cvWeekLabel, cvClock, cvTown, cvPeople, cvStatus,
                     cvForAccounting, cvSort, cvSortUp, cvCan, cvSalesBuckets, cvByDay, cvByRep, cvReps, CV_DAY_MAX, cvDayCheck, cvStopCheck, cvTwin, cvDayParams,
                     cvPlaces, cvDefaultPlace, cvClients, cvPlanParams, cvLogLines };
}
