/* quotation-status-model.js — A382 · Quotation status (quotation-status.html). Pure: no DOM, no I/O.
 *
 * Neil, 29 Oct 2026: each rep's own list of every quotation, each one set to Won, Pending (the last follow-up: when,
 * how, and where it stands) or Lost with a reason — "we just need to have the status of all the quotations … fully
 * organize, and clean". This decides which state each quotation is in, the counts and the progress, the sections, the
 * clean-up hints (open twice, possibly won), what may be done to each, and how to undo a change.
 *
 * It reuses the rules the rest of the portal already runs on, rather than a copy of them: flowQuotationBucket and
 * flowFollowUp (js/flow-api.js) for won / closed / sent and the follow-up clock, flowQuotationOwner for whose deal it is,
 * crCanonKey (js/client-rollup.js) for one client spelled several ways. The lists mirror FlowAPI 191's
 * (_QUOTE_LOST_REASONS, _QUOTE_FOLLOWUP_STATUSES, _QUOTE_FOLLOWUP_VIA); tests/flow/quotation-status.js holds them equal. */

const QS_LOST_REASONS = [   // [reason, the outcome it means]
  ['Price', 'Lost'], ['Lead time', 'Lost'], ['Specs did not fit', 'Lost'], ['Went with a competitor', 'Lost'],
  ['No budget', 'Not Pursued'], ['No reply from the client', 'Not Pursued'],
  ['Duplicate quotation', 'Cancelled'], ['Other', 'Lost']
];
const QS_FOLLOWUP_STATUSES = ['Waiting for reply', 'Client is evaluating', 'Waiting for budget or approval',
  'Waiting for their PO', 'Asked for a revised offer', 'Will call back', 'Other'];
const QS_FOLLOWUP_VIA = ['Email', 'Call', 'Viber', 'Visit'];
const QS_BULK_MAX = 25;   // the server takes 25 per call; the page sends a bigger selection in chunks

/* the segments, in the order the control shows them; 'all' is a view of every row, not a segment of its own */
const QS_SEGMENTS = [
  { key: 'update', label: 'To update' },
  { key: 'pending', label: 'Pending' },
  { key: 'won', label: 'Won' },
  { key: 'closed', label: 'Closed' },
  { key: 'notsent', label: 'Not sent yet' },
  { key: 'all', label: 'All' }
];
const QS_OUTCOME_LABEL = { 'Lost': 'Lost', 'Not Pursued': 'Not pursued', 'Cancelled': 'Cancelled' };

function _qsLow(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function _qsDate(v) { return typeof flowDate === 'function' ? flowDate(v) : String(v || '').slice(0, 10); }
function _qsDays(a, b) {
  if (typeof flowDaysBetween === 'function') return flowDaysBetween(a, b);
  const x = String(a || '').slice(0, 10), y = String(b || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return null;
  return Math.round((new Date(y + 'T00:00:00Z') - new Date(x + 'T00:00:00Z')) / 86400000);
}
function _qsOwner(q) { return typeof flowQuotationOwner === 'function' ? flowQuotationOwner(q) : String((q || {}).salesperson || (q || {}).createdBy || '').trim(); }
function _qsKey(name) { return typeof crCanonKey === 'function' ? crCanonKey(name) : _qsLow(name).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function _qsSubjectKey(s) { return _qsLow(s).replace(/\brev\s*\d+\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }

/** The outcome a lost reason means ('' for an unknown reason). */
function qsOutcomeFor(reason) {
  const r = QS_LOST_REASONS.find(x => x[0] === reason);
  return r ? r[1] : '';
}

/** The newest active email linked to a quotation as a follow-up (or after its send), else null — the one the page
 *  uses instead of asking the rep to pick again. */
function qsLinkedFollowUp(q, links) {
  const sent = _qsDate((q || {}).sentAt);
  const live = (links || []).filter(l => String(l.status || 'Active') === 'Active' && _qsDate(l.sentAt) &&
    (String(l.kind || '') === 'Follow-up' || (sent && _qsDate(l.sentAt) > sent)));
  live.sort((a, b) => String(_qsDate(b.sentAt)).localeCompare(String(_qsDate(a.sentAt))));
  return live[0] || null;
}

/** The last follow-up on record: the rep's own (Quotation status) or a follow-up email linked since. {date, via, link}. */
function qsLastFollowUp(q, links) {
  const own = _qsDate((q || {}).lastFollowUp), link = qsLinkedFollowUp(q, links), ld = link ? _qsDate(link.sentAt) : '';
  if (ld && (!own || ld >= own)) return { date: ld, via: 'Email', link: link };
  if (own) return { date: own, via: String((q || {}).followUpVia || ''), link: null };
  return { date: '', via: '', link: null };
}

/** Which segment a quotation is in: won | closed | notsent (draft, in approval, sent back) | pending | update. */
function qsSegment(q, hasSO) {
  const b = typeof flowQuotationBucket === 'function' ? flowQuotationBucket(q, hasSO) : 'internal';
  if (b === 'won') return 'won';
  if (b === 'closed') return 'closed';
  if (b === 'internal') return 'notsent';
  return String((q || {}).result || '') === 'Pending' ? 'pending' : 'update';
}

/** What a closed quotation would go back to: the status it was closed from, else what its dates prove, else ''. */
function qsRestoreTo(q) {
  const o = q || {}, from = String(o.closedFrom || '').trim();
  if (from && ['Not Pursued', 'Lost', 'Cancelled'].indexOf(from) === -1) return from;
  if (o.sentAt) return 'Sent';
  if (o.approvedAt) return 'Approved';
  return '';
}

/** What may be done to one quotation here — the server's own rules (setQuotationResult), so a button never offers what
 *  the server refuses. */
function qsCanAct(q, seg, hasSO) {
  const o = q || {}, ordered = !!(hasSO && hasSO[String(o.quotationNo || '')]);
  if (ordered) return { won: false, pending: false, lost: false, open: false, ordered: true };
  if (seg === 'notsent') return { won: false, pending: false, lost: true, open: false };
  if (seg === 'closed') {
    const back = qsRestoreTo(o), sentish = back === 'Sent' || back === 'Approved';
    return { won: sentish, pending: sentish, lost: true, open: !!back, restoreTo: back };
  }
  return { won: seg !== 'won', pending: true, lost: true, open: seg === 'won' || seg === 'pending' };
}

/** The one spelling a client is shown in: the one its rows use most (ties: the longest, then the first). */
function qsClientNames(quotations) {
  const by = {};
  (quotations || []).forEach(q => {
    const raw = String((q || {}).customer || '').trim(), k = _qsKey(raw);
    if (!k) return;
    const m = by[k] = by[k] || {};
    m[raw] = (m[raw] || 0) + 1;
  });
  const out = {};
  Object.keys(by).forEach(k => {
    out[k] = Object.keys(by[k]).sort((a, b) => (by[k][b] - by[k][a]) || (b.length - a.length) || a.localeCompare(b))[0];
  });
  return out;
}

/** Open quotations that look like the same deal twice: the same client and the same subject (a revision number set
 *  aside), or the same number for the same client (flowQuotationDupPairs). → { quotationNo: [the others] } */
function qsDuplicates(rows) {
  const open = (rows || []).filter(r => r.seg === 'update' || r.seg === 'pending' || r.seg === 'notsent');
  const out = {}, add = (a, b) => { if (a === b) return; (out[a] = out[a] || []).indexOf(b) === -1 && out[a].push(b); };
  const groups = {};
  open.forEach(r => {
    const subj = _qsSubjectKey(r.q.subject);
    if (!subj || !r.clientKey) return;
    (groups[r.clientKey + '|' + subj] = groups[r.clientKey + '|' + subj] || []).push(r.q.quotationNo);
  });
  Object.keys(groups).forEach(k => { const g = groups[k]; if (g.length > 1) g.forEach(a => g.forEach(b => add(a, b))); });
  if (typeof flowQuotationDupPairs === 'function') {
    (flowQuotationDupPairs(open.map(r => r.q)) || []).forEach(g => {   // {prefix, customer, rows}: one number, one client
      const nos = (g.rows || []).map(x => String(x.quotationNo || '')).filter(Boolean);
      nos.forEach(a => nos.forEach(b => add(a, b)));
    });
  }
  return out;
}

/** Open quotations a sales order may have won without naming them: an order for the same client with no quotation
 *  number, dated on or after the quotation and within 180 days, for about the same amount (0.85× to 1.2×: the order may
 *  carry VAT). A hint for the rep, never a decision. → { quotationNo: {soNo, date, total} } */
function qsPossibleWins(rows, salesOrders) {
  const free = (salesOrders || []).filter(s => !String(s.quotationNo || '').trim() && _qsDate(s.date));
  const out = {};
  (rows || []).forEach(r => {
    if (r.seg !== 'update' && r.seg !== 'pending') return;
    const d = _qsDate(r.q.date), total = Number(r.q.total) || 0;
    const hit = free.filter(s => _qsKey(s.customer) === r.clientKey && _qsDate(s.date) >= d && (_qsDays(d, _qsDate(s.date)) || 0) <= 180 &&
      total > 0 && (Number(s.total) || 0) >= total * 0.85 && (Number(s.total) || 0) <= total * 1.2)
      .sort((a, b) => String(_qsDate(a.date)).localeCompare(String(_qsDate(b.date))))[0];
    if (hit) out[r.q.quotationNo] = { soNo: String(hit.soNo || ''), date: _qsDate(hit.date), total: Number(hit.total) || 0 };
  });
  return out;
}

/**
 * Everything the page draws, from the reads it makes.
 * @param {Array} quotations getQuotations rows (already scoped to the person)
 * @param {object} o { hasSO: {no: true}, links: {no: [QuotationEmails rows]}, cfg, salesOrders, today }
 * @returns {{rows, counts, progress: {done, total}}} — counts.update + pending + won + closed + notsent === rows.length
 */
function qsBuild(quotations, o) {
  const opt = o || {}, today = opt.today || (typeof flowToday === 'function' ? flowToday() : ''), names = qsClientNames(quotations);
  const rows = (quotations || []).map(q => {
    const seg = qsSegment(q, opt.hasSO), links = (opt.links || {})[String(q.quotationNo)] || [];
    const clientKey = _qsKey(q.customer);
    const fu = (seg === 'pending' || seg === 'update') && typeof flowFollowUp === 'function' ? flowFollowUp(q, links, opt.cfg, opt.hasSO, today) : null;
    return {
      q: q, seg: seg, clientKey: clientKey, client: names[clientKey] || String(q.customer || '').trim() || 'No client',
      age: _qsDays(q.date, today), last: qsLastFollowUp(q, links), linked: qsLinkedFollowUp(q, links),
      due: !!(fu && (fu.state === 'due' || fu.state === 'overdue' || fu.state === 'replied')), fu: fu,
      can: qsCanAct(q, seg, opt.hasSO), owner: _qsOwner(q)
    };
  });
  const dups = qsDuplicates(rows), wins = qsPossibleWins(rows, opt.salesOrders);
  rows.forEach(r => { r.dups = dups[r.q.quotationNo] || []; r.maybeWon = wins[r.q.quotationNo] || null; });
  const counts = { update: 0, pending: 0, won: 0, closed: 0, notsent: 0, all: rows.length };
  rows.forEach(r => { counts[r.seg]++; });
  const total = rows.length - counts.notsent;
  return { rows: rows, counts: counts, progress: { done: counts.pending + counts.won + counts.closed, total: total } };
}

/** The reps whose quotations are in the list, most quotations first — for the oversight switch. */
function qsOwners(quotations) {
  const n = {};
  (quotations || []).forEach(q => { const w = _qsOwner(q) || '—'; n[w] = (n[w] || 0) + 1; });
  return Object.keys(n).sort((a, b) => (n[b] - n[a]) || a.localeCompare(b)).map(name => ({ name: name, count: n[name] }));
}

/** The rows of one segment that match a search (client, number, subject, PR or client reference). */
function qsFilter(rows, f) {
  const seg = (f && f.seg) || 'update', term = _qsLow(f && f.q);
  return (rows || []).filter(r => {
    if (seg !== 'all' && r.seg !== seg) return false;
    if (!term) return true;
    const hay = _qsLow([r.client, r.q.customer, r.q.quotationNo, r.q.subject, r.q.prNo, r.q.clientRefNo].join(' '));
    return term.split(/\s+/).every(t => hay.indexOf(t) >= 0);
  });
}

/** oldest (the default: the backlog first) | newest | biggest | client */
function qsSort(rows, key) {
  const d = r => String(_qsDate(r.q.date) || ''), no = r => String(r.q.quotationNo || '');
  const cmp = {
    oldest: (a, b) => d(a).localeCompare(d(b)) || no(a).localeCompare(no(b)),
    newest: (a, b) => d(b).localeCompare(d(a)) || no(b).localeCompare(no(a)),
    biggest: (a, b) => ((Number(b.q.total) || 0) - (Number(a.q.total) || 0)) || d(a).localeCompare(d(b)),
    client: (a, b) => a.client.localeCompare(b.client) || d(a).localeCompare(d(b))
  }[key] || null;
  return (rows || []).slice().sort(cmp || ((a, b) => d(a).localeCompare(d(b))));
}

const _QS_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function _qsMonth(v) { const s = _qsDate(v); return /^\d{4}-\d{2}/.test(s) ? _QS_MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4) : 'No date'; }

/** The sorted rows of a segment in titled groups, so a long list reads in parts:
 *  To update by age, Pending due-first then by where it stands, Won by month, Closed by reason, Not sent by status. */
function qsSections(rows, seg, sortKey) {
  const list = qsSort(rows, sortKey || 'oldest');
  const groups = [], at = {};
  const put = (title, r, order) => { if (!at[title]) { at[title] = { title: title, rows: [], order: order }; groups.push(at[title]); } at[title].rows.push(r); };
  if (sortKey === 'client') { list.forEach(r => put(r.client, r, 0)); return groups; }
  if (sortKey === 'biggest') return list.length ? [{ title: '', rows: list }] : [];
  list.forEach(r => {
    if (seg === 'update') {
      const a = r.age == null ? 0 : r.age;
      if (a > 90) put('Over 90 days', r, 0); else if (a >= 30) put('30 to 90 days', r, 1); else put('Under 30 days', r, 2);
    } else if (seg === 'pending') {
      if (r.due) put('Follow-up due', r, -1);
      else { const s = String(r.q.followUpStatus || 'Other'); put(s, r, QS_FOLLOWUP_STATUSES.indexOf(s)); }
    } else if (seg === 'won') put(_qsMonth(r.q.resultAt || r.q.date), r, -Number(String(_qsDate(r.q.resultAt || r.q.date)).replace(/-/g, '')) || 0);
    else if (seg === 'closed') { const why = String(r.q.resultReason || QS_OUTCOME_LABEL[r.q.status] || r.q.status || 'Closed'); put(why, r, 0); }
    else if (seg === 'notsent') {
      const st = String(r.q.status || 'Draft');
      put(st === 'Rejected' ? 'Sent back to fix' : st.indexOf('Pending') === 0 ? 'In approval' : 'Draft', r, st === 'Rejected' ? 0 : st.indexOf('Pending') === 0 ? 1 : 2);
    } else put((QS_SEGMENTS.find(s => s.key === r.seg) || {}).label || '', r, QS_SEGMENTS.findIndex(s => s.key === r.seg));
  });
  return groups.sort((a, b) => a.order - b.order);
}

/** What the form says is wrong before it is sent ('' when it may go) — the server says the same. */
function qsValidate(kind, f, q, today) {
  const v = f || {}, note = String(v.note || '').trim();
  if (kind === 'lost') {
    if (!qsOutcomeFor(v.reason)) return 'Choose why it was lost.';
    if (v.reason === 'Other' && note.length < 3) return 'Say what happened — "Other" needs a note.';
    return '';
  }
  if (kind === 'pending') {
    if (!v.email && QS_FOLLOWUP_VIA.indexOf(v.via) === -1) return 'Choose how you followed up.';
    const d = String(v.date || (v.email ? _qsDate(v.email.sentAt) : '') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return v.via === 'Email' && !v.email ? 'Pick the email, or give its date.' : 'Give the date of the last follow-up.';
    if (today && d > today) return 'The follow-up date is in the future.';
    if (q && _qsDate(q.date) && d < _qsDate(q.date)) return 'That is before the quotation itself (' + _qsDate(q.date) + ').';
    if (QS_FOLLOWUP_STATUSES.indexOf(v.status) === -1) return 'Choose where it stands.';
    if (v.status === 'Other' && note.length < 3) return 'Say where it stands — "Other" needs a note.';
  }
  return '';
}

/** The call that puts one quotation back the way it was before a change, or null when it cannot be done exactly.
 *  `prev` is the server's `previous` state; `now` is the state it returned. */
function qsUndo(prev, now) {
  const p = prev || {}, n = now || {}, closed = s => ['Lost', 'Not Pursued', 'Cancelled'].indexOf(String(s || '')) !== -1;
  const guard = { quotationNo: n.quotationNo || p.quotationNo, ifResultAt: n.resultAt || '' };
  if (!closed(p.status) && closed(n.status)) return Object.assign(guard, { result: 'open', keep: true, approvalNote: p.approvalNote || '' });
  if (closed(p.status)) {
    if (!p.resultReason) return null;   // closed before 191, with no reason code: nothing exact to go back to
    return Object.assign(guard, { result: 'lost', reason: p.resultReason, note: '' });
  }
  if (p.result === 'Won') return Object.assign(guard, { result: 'won', note: p.resultNote || '' });
  if (p.result === 'Pending' && p.lastFollowUp && p.followUpVia && p.followUpStatus) {
    return Object.assign(guard, { result: 'pending', followUpDate: p.lastFollowUp, followUpVia: p.followUpVia, followUpStatus: p.followUpStatus, note: p.resultNote || '' });
  }
  return Object.assign(guard, { result: 'open' });
}

/** A bulk close's Undo: every closed quotation back to where it was, each with its own note. */
function qsUndoBulk(results) {
  const nos = [], notes = {};
  (results || []).forEach(r => { if (r && r.previous && r.quotationNo) { nos.push(r.quotationNo); notes[r.quotationNo] = r.previous.approvalNote || ''; } });
  return nos.length ? { quotationNos: nos, result: 'open', keep: true, approvalNotes: notes } : null;
}

/** The server's returned state laid over the row the page holds, so the list redraws without a reload. */
function qsApply(q, state) {
  const out = Object.assign({}, q || {});
  ['status', 'result', 'resultAt', 'resultBy', 'resultReason', 'resultNote', 'lastFollowUp', 'followUpVia', 'followUpStatus', 'closedFrom', 'approvalNote']
    .forEach(k => { if (state && state[k] !== undefined) out[k] = state[k]; });
  if (state && state.sentAt && !out.sentAt) out.sentAt = state.sentAt;
  return out;
}

/** What to search a rep's older sent mail for, for one quotation: the client's addresses or domain on file, the
 *  quotation's number (its year-number core) and the client's own reference. */
function qsMailMatch(q, clientEmail) {
  const o = q || {}, to = [], subject = [];
  const em = String(clientEmail || '').trim().toLowerCase();
  if (/@/.test(em)) { to.push(em); to.push(em.split('@')[1]); }
  const core = /^(\d{4}-\d{2,4})/.exec(String(o.quotationNo || ''));
  if (core) subject.push(core[1]);
  if (String(o.clientRefNo || '').trim().length >= 4) subject.push(String(o.clientRefNo).trim());
  return { to: to.slice(0, 6), subject: subject.slice(0, 4) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QS_LOST_REASONS, QS_FOLLOWUP_STATUSES, QS_FOLLOWUP_VIA, QS_SEGMENTS, QS_BULK_MAX, QS_OUTCOME_LABEL,
    qsOutcomeFor, qsLinkedFollowUp, qsLastFollowUp, qsSegment, qsRestoreTo, qsCanAct, qsClientNames, qsDuplicates, qsPossibleWins,
    qsBuild, qsOwners, qsFilter, qsSort, qsSections, qsValidate, qsUndo, qsUndoBulk, qsApply, qsMailMatch };
}
