/* team-report-model.js — A351 · the accounting, lead gen and admin daily reports: what they count.
 *
 * Neil, 22 Oct 2026: daily reports like the sales one for the other three roles, first on his dashboard, a private
 * trial. Each report reads ONE person's day (while he tries it, he picks whose) and counts it from the portal's own
 * records, never from what was typed; the few things the portal cannot see are typed as log lines.
 *
 * The tasks are the portal's own, not invented: each role's home-page queue (flowComputeActions, auth.js), the
 * ActivityLog module/action pairs its work writes (_MODULE_MAP, FlowAPI.gs), lead gen's server counts and quotas
 * (getLeadgenCounts), and the original admin form (Code.gs: PO status, shipments, client delivery, pending inquiry,
 * received quotation). Accounting and admin have no quotas in the portal, so none are made up here: their counts show
 * plainly and their queue says what is left.
 *
 * PURE. Everything arrives as arguments; tests/flow/team-report.js runs it in node with flow-api.js and
 * sales-report-model.js, whose day and money helpers it reuses (srAddDays, srWeekDays, srDow, srClock, srMinutes,
 * srMoney, _srS, _srSame, _srDate, _srNum).
 */

/* A line type's fill: an empty "what" takes the linked record's company (the AR's customer, the PO's supplier) — only
   where that company IS the answer (a supplier follow-up's PR names the client, not the supplier).
   acts: { module: [actions] | '*' } — the person's ActivityLog rows that make up a tile; each row is one event (an
   invoice issued, a payment recorded). distinct: the record counts once however often it was saved that day (a payment
   request created, submitted and revised is one request). refRe narrows by Ref No. undo: an action that cancels the
   record the same day (an invoice issued and voided) — it is left out and the tile says how many. */
const TR_ROLES = {
  accounting: {
    title: 'Accounting Daily Report', role: 'accounting', noun: 'Accounting',
    tiles: [
      { key: 'invoices', label: 'Invoices issued', acts: { 'Invoice': ['Issued'] }, money: true, undo: ['Voided'] },
      { key: 'collections', label: 'Collections recorded', acts: { 'Collection': ['Recorded'] }, money: true },
      { key: 'acknowledged', label: 'Field collections acknowledged', acts: { 'Collection': ['Acknowledged'] } },
      { key: 'payReqs', label: 'Payment requests prepared', acts: { 'Payment Request': ['Created', 'Submitted', 'Revised'] }, distinct: true },
      { key: 'paid', label: 'Transfers paid', acts: { 'Payment Request': ['Paid'] }, money: true },
      { key: 'ap', label: 'Payables updated', acts: { 'AP Aging': ['Updated'] }, distinct: true },
      { key: 'received', label: 'Materials received', acts: { 'Receiving': ['Received'] } },
      { key: 'expenses', label: 'Expenses recorded', acts: { 'Expense': ['Added', 'Imported'] } }
      // A353 (Neil, 22 Oct): books work is no longer a tile, and travel reports are a typed line below
    ],
    week: ['invoices', 'collections', 'paid'],
    /* A352 — Neil, 22 Oct: "it has emails, for follow up collections". Counted from the person's sent mail. */
    mail: { key: 'mailCollect', label: 'Collection follow-up emails', short: 'Collection emails', tag: 'Collection follow-up', on: 'collection',
            none: 'Not a collection follow-up', help: 'An email counts when its subject is about payment (SOA, reminder, overdue…) or it went to a customer with a past-due receivable.' },
    lines: [
      { type: 'Collection call', results: ['Promised to pay', 'Paid already', 'No answer', 'Disputed'], link: 'ar', what: 'Customer', fill: true, next: true },
      { type: 'Collection email', results: ['SOA sent', 'Reminder sent', 'Reply received', 'Promised to pay'], link: 'ar', what: 'Customer', fill: true, next: true },
      { type: 'Billing', results: ['Payment slip', 'Cash voucher', 'Marked paid', 'Sales payment request paid'], what: 'Reference no.' },
      { type: 'Bank reconciliation', results: ['Balanced', 'Differences found'], what: 'Account and period' },
      { type: 'Month check', results: ['Done, no issues', 'Issues found'], what: 'Month' },
      { type: 'Travel report', results: ['Signed', 'Sent back to the rep', 'Waiting for receipts'], what: 'Rep and week' },
      { type: 'Other task', results: [], what: 'What' }
    ],
    typedNote: 'Billing, sales payment requests, bank work and travel reports are typed here. A collection email is counted from the mailbox; type one only when it went from another mailbox.'
  },
  leadgen: {
    title: 'Lead Gen Daily Report', role: 'leadgen', noun: 'Lead gen',
    counts: [['attempts', 'Outbound attempts'], ['conversations', 'Decision-maker conversations'], ['emails', 'Prospecting emails'],
             ['linkedin', 'LinkedIn requests & messages'], ['suppliers', 'Local suppliers researched'], ['accounts', 'Target accounts researched'],
             ['crm', 'CRM updated'], ['scheduled', 'Meetings / calls scheduled']],
    weekly: [['leads', 'Qualified leads handed off'], ['suppliersHandedOff', 'Suppliers handed off'], ['meetings', 'Presentations booked']],
    week: ['attempts', 'conversations', 'emails'],
    lines: [
      { type: 'Accreditation', results: ['Docs sent', 'Followed up', 'Approved', 'Rejected'], link: 'accred', what: 'Plant / company', fill: true },
      { type: 'Rep request', results: ['Sent to the rep', 'Waiting', 'Done'], link: 'lead', what: 'What the rep needs' },
      { type: 'Other task', results: [], what: 'What' }
    ],
    typedNote: 'Calls, emails, LinkedIn, plants, contacts, suppliers and hand-offs are logged on the lead gen home and counted above; only what it cannot see is typed here.'
  },
  admin: {
    title: 'Admin Daily Report', role: 'admin', noun: 'Admin',
    tiles: [
      { key: 'website', label: 'Website requests handled', acts: { 'Website request': ['Pricing request made', 'Status changed'] }, distinct: true },
      { key: 'sourced', label: 'PRs sourced', acts: { 'Pricing Request': ['Sourced'] } },
      { key: 'forwarded', label: 'PRs sent for pricing', acts: { 'Pricing Request': ['Forwarded'] } },
      { key: 'verified', label: 'PRs verified', acts: { 'Pricing Request': ['Verified'] } },
      { key: 'toRep', label: 'Website PRs sent to a rep', acts: { 'Pricing Request': ['Reattributed'] } },
      { key: 'docs', label: 'Documents attached to PRs', acts: { 'Document': ['Attached'] }, refRe: /^PR-/ },
      { key: 'quoteApprovals', label: 'Quotations approved or rejected', acts: { 'Quotation': ['Approved', 'Rejected'] } },
      { key: 'quotesSent', label: 'Quotations sent', acts: { 'Quotation': ['Sent'] } },
      { key: 'sos', label: 'Sales orders', acts: { 'Sales Order': ['Created', 'Updated'] }, distinct: true },
      { key: 'pos', label: 'Purchase orders', acts: { 'Purchase Order': ['Created', 'Submitted'] }, distinct: true },
      { key: 'payReqs', label: 'Payment requests', acts: { 'Payment Request': ['Created', 'Approved', 'Paid'] }, distinct: true },
      { key: 'stock', label: 'Receiving and shipments', acts: { 'Receiving': ['Received'], 'Shipment': ['Stage Updated', 'Updated'] }, distinct: true }
    ],
    stuck: true,
    week: ['sourced', 'quotesSent', 'pos'],
    /* A352 — Neil, 22 Oct: "it has emails for request of price to supplier". Counted from the person's sent mail. */
    mail: { key: 'mailPrice', label: 'Price requests to suppliers', short: 'Price requests', tag: 'Price request', on: 'price',
            none: 'Not a price request', help: 'An email counts when it asks for a quotation, price or stock and did not go to a customer; our own quotations and order emails do not count.' },
    lines: [
      { type: 'Price request email', results: ['Sent', 'Quote received', 'No reply yet'], link: 'pr', what: 'Supplier' },
      { type: 'Supplier follow-up', results: ['Quote received', 'Waiting', 'No stock', 'Declined'], link: 'pr', what: 'Supplier' },
      { type: 'PO status', results: ['On schedule', 'Delayed', 'Shipped'], link: 'po', what: 'Supplier', fill: true },
      { type: 'Shipment', results: ['In transit', 'Arrived', 'Cleared', 'Delayed'], link: 'po', what: 'International or local', whatChoices: ['International', 'Local'] },
      { type: 'Client delivery', results: ['Delivered', 'Scheduled', 'Delayed'], link: 'so', what: 'Client', fill: true },
      { type: 'Inquiry', results: ['Answered', 'Forwarded to a rep', 'Waiting'], what: 'Company' },
      { type: 'Other task', results: [], what: 'What' }
    ],
    typedNote: 'Supplier, PO, shipment and delivery follow-ups happen by phone and email, so they are typed here. A price request email is counted from the mailbox; type one only when it went from another mailbox.'
  }
};
const TR_LINE_FIELDS = ['type', 'what', 'result', 'note', 'nextDate', 'linkType', 'linkId', 'linkLabel'];
const TR_REPORT_END = 16 * 60 + 30;
/* The PR worklist's own stage limits (js/pr-worklist.js PRW_DEFAULTS), overridable from FlowSettings the same way. */
const TR_PR_LIMITS = { prSourcingDays: 3, prVerifyDays: 2 };
const TR_PR_STAGE = { 'Requested': 'prSourcingDays', 'Sourcing': 'prSourcingDays', 'Mgmt Priced': 'prVerifyDays' };

function _trDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function _trOpenStatus(s) { return !/deliver|closed|complete|cancel|void|paid|received/i.test(_srS(s)); }

/* ── the person's day, from the portal ─────────────────────────────────────────────────────── */

/** raw = { today, activity, settings, ar, prs, pos, sos, clients, suppliers, lgCounts, lgFollowups, lgData } — whatever the role reads. */
function trIndex(raw) {
  const r = raw || {};
  const cfg = Object.assign({}, TR_PR_LIMITS);
  Object.keys(TR_PR_LIMITS).forEach(k => { const n = Number((r.settings || {})[k]); if ((r.settings || {})[k] !== '' && (r.settings || {})[k] != null && isFinite(n) && n >= 0) cfg[k] = n; });
  return {
    today: _srS(r.today) || (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10)),
    cfg, activity: r.activity || [], ar: r.ar || [], prs: r.prs || [], pos: r.pos || [], sos: r.sos || [], clients: r.clients || [], suppliers: r.suppliers || [],
    lg: { counts: r.lgCounts && r.lgCounts.success !== false ? r.lgCounts : null, followups: r.lgFollowups || [], data: r.lgData || {} }
  };
}

/** The person's ActivityLog rows on the day, in time order. */
function trRows(ix, person, day) {
  return ix.activity.filter(a => _srSame(a.user, person) && _srDate(a.date || a.timestamp) === day)
    .sort((a, b) => _srS(a.timestamp).localeCompare(_srS(b.timestamp)));
}
function _trMatch(tile, a) {
  const acts = tile.acts[_srS(a.module)];
  if (!acts) return false;
  if (acts !== '*' && acts.indexOf(_srS(a.action)) < 0) return false;
  return !tile.refRe || tile.refRe.test(_srS(a.refNo));
}
function trEnded(day, today, nowMin) { return day < today || (day === today && (nowMin == null ? 0 : nowMin) >= TR_REPORT_END); }

/** One activity tile: how many events (or records, when distinct), and the money on them. */
function _trActTile(tile, rows) {
  const mod = Object.keys(tile.acts)[0], undone = {};
  if (tile.undo) rows.forEach(a => { if (_srS(a.module) === mod && tile.undo.indexOf(_srS(a.action)) >= 0 && _srS(a.refNo)) undone[_srS(a.refNo)] = 1; });
  const all = rows.filter(a => _trMatch(tile, a)), hit = all.filter(a => !undone[_srS(a.refNo)]), nUndone = all.length - hit.length;
  const refs = {};
  let n = 0;
  hit.forEach(a => { const k = _srS(a.refNo); if (!tile.distinct || !k) n++; else if (!refs[k]) { refs[k] = 1; n++; } });
  const value = tile.money ? hit.reduce((s, a) => s + _srNum(a.amount), 0) : 0;
  return { key: tile.key, label: tile.label, value: n, money: value, text: String(n) + (tile.money && value ? ' · ' + srMoney(value) : ''),
           target: (tile.money ? 'records · their amounts' : 'records') + (nUndone ? ' · ' + nUndone + ' voided the same day, not counted' : ''), status: 'none', bar: null,
           items: hit.map(a => ({ time: srClock(a.timestamp), ref: _srS(a.refNo), what: _srS(a.action) + (a.summary ? ' — ' + _srS(a.summary) : ''), value: _srNum(a.amount) })) };
}

/** PRs sitting past their stage limit right now (a live state, so only for today). */
function trStuckPrs(ix) {
  return ix.prs.map(p => {
    const k = TR_PR_STAGE[_srS(p.status)], d = _srDate(p.date);
    if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const age = _trDays(d, ix.today), limit = ix.cfg[k];
    return age > limit ? { ref: _srS(p.prNo), customer: _srS(p.customer), status: _srS(p.status), age, limit } : null;
  }).filter(Boolean).sort((a, b) => b.age - a.age);
}

/** The tiles the portal fills: { portal: [...], weekly: [...] }. */
function trTiles(roleKey, ix, person, day, nowMin) {
  const cfg = TR_ROLES[roleKey], ended = trEnded(day, ix.today, nowMin);
  if (cfg.counts) {
    const k = ix.lg.counts, d = (k && k.day) || {}, q = (k && k.quotas) || {}, qm = (k && k.quotasMax) || {};
    const portal = cfg.counts.map(([key, label]) => {
      const v = _srNum(d[key]), min = _srNum(q[key]), max = Math.max(min, _srNum(qm[key]));
      return { key, label, value: v, text: k ? String(v) : '—', target: min ? (max > min ? min + '–' + max + ' a day' : min + ' a day') : 'no quota',
               bar: min && k ? v / min : null, status: !k ? 'nr' : !min ? 'none' : v >= min ? 'ok' : ended ? 'red' : 'none', items: [] };
    });
    const w = (k && k.week && k.week.weekly) || {};
    const weekly = cfg.weekly.map(([key, label]) => {
      const x = w[key] || {}, v = _srNum(x.value), min = _srNum(x.min), max = _srNum(x.max);
      return { key: 'w_' + key, label, value: v, text: k ? String(v) : '—', target: min ? (max > min ? min + '–' + max + ' a week' : min + ' a week') : 'this week',
               bar: min && k ? v / min : null, status: !k ? 'nr' : !min ? 'none' : v >= min ? 'ok' : 'none', items: [] };
    });
    if (k && k.week) weekly.push({ key: 'w_replyRate', label: 'Reply rate', value: k.week.replyRate, text: k.week.replyRate === null || k.week.replyRate === undefined ? '—' : k.week.replyRate + '%',
      target: k.week.replyRateAim ? 'aim ' + k.week.replyRateAim + '%' : 'this week', bar: null, status: 'none', items: [] });
    return { portal, weekly };
  }
  const rows = trRows(ix, person, day);
  const portal = cfg.tiles.map(t => _trActTile(t, rows));
  if (cfg.stuck && day === ix.today) {
    const stuck = trStuckPrs(ix);
    portal.push({ key: 'stuck', label: 'PRs past their stage limit', value: stuck.length, text: String(stuck.length),
      target: 'sourcing ' + ix.cfg.prSourcingDays + ' days · verify ' + ix.cfg.prVerifyDays + ' days', bar: null, status: stuck.length ? 'red' : 'ok',
      items: stuck.map(s => ({ ref: s.ref, what: s.customer + ' — ' + s.status + ', ' + s.age + ' days (limit ' + s.limit + ')' })) });
  }
  return { portal, weekly: [] };
}

/* ── the report the person keeps ───────────────────────────────────────────────────────────── */

function trBlank(roleKey, person) { return { v: 1, kind: roleKey, person: _srS(person), lines: [], pm: { blocker: '' }, mailMarks: {} }; }
/** A saved report made safe to read. */
function trFill(saved, roleKey, person) {
  const o = saved && typeof saved === 'object' ? saved : {}, b = trBlank(roleKey, o.person || person);
  b.lines = Array.isArray(o.lines) ? o.lines.filter(l => l && l.id) : [];
  b.pm = { blocker: _srS(o.pm && o.pm.blocker) };
  if (o.mailMarks && typeof o.mailMarks === 'object') Object.keys(o.mailMarks).forEach(k => { if (o.mailMarks[k] === true || o.mailMarks[k] === false) b.mailMarks[k] = o.mailMarks[k]; });
  return b;
}
/** A new typed line, stamped now. The type must be one of the role's. */
function trNewLine(roleKey, f, who, nowIso) {
  const types = TR_ROLES[roleKey].lines.map(x => x.type);
  const line = { id: 'T' + Date.parse(nowIso).toString(36) + Math.random().toString(36).slice(2, 6), loggedAt: nowIso, createdBy: _srS(who),
                 editedAt: '', editReason: '', voidedAt: '', voidReason: '', history: [] };
  TR_LINE_FIELDS.forEach(k => { line[k] = _srS((f || {})[k]); });
  if (types.indexOf(line.type) < 0) line.type = 'Other task';
  if (!line.linkType || !line.linkId) { line.linkType = 'none'; line.linkId = ''; line.linkLabel = ''; }
  return line;
}
/** An edit keeps what the line said before, and why it changed. A reason is required. */
function trEditLine(line, changes, reason, nowIso) {
  if (!_srS(reason)) return { error: 'Say why the line is changing.' };
  const before = {};
  TR_LINE_FIELDS.forEach(k => { before[k] = line[k]; });
  line.history = (line.history || []).concat([{ at: nowIso, reason: _srS(reason), before }]);
  TR_LINE_FIELDS.forEach(k => { if (changes && changes[k] !== undefined && k !== 'type') line[k] = _srS(changes[k]); });
  if (!line.linkType || !line.linkId) { line.linkType = 'none'; line.linkId = ''; line.linkLabel = ''; }
  line.editedAt = nowIso; line.editReason = _srS(reason);
  return { line };
}
/** A void keeps the line, struck through, with its reason. Never a delete. */
function trVoidLine(line, reason, nowIso) {
  if (!_srS(reason)) return { error: 'Say why the line is voided.' };
  line.voidedAt = nowIso; line.voidReason = _srS(reason);
  return { line };
}
function trDayLines(report, day) { return ((report && report.lines) || []).filter(l => _srDate(l.loggedAt) === day).sort((a, b) => _srS(a.loggedAt).localeCompare(_srS(b.loggedAt))); }

/** The tiles from the typed lines: one per line type, voided lines left out. */
function trMineTiles(roleKey, report, day) {
  const live = trDayLines(report, day).filter(l => !l.voidedAt);
  return TR_ROLES[roleKey].lines.map(x => {
    const ls = live.filter(l => l.type === x.type);
    return { key: 'm_' + x.type.replace(/\W+/g, ''), label: x.type === 'Other task' ? 'Other tasks' : x.type, value: ls.length, text: String(ls.length),
             target: 'typed lines', bar: null, status: 'none',
             items: ls.map(l => ({ time: srClock(l.loggedAt), ref: l.linkId, what: [l.what, l.note].filter(Boolean).join(' — '), result: l.result })) };
  });
}

/** "Log lines with a link: X of Y" — the day's live lines that can take a link. */
function trLinked(roleKey, report, day) {
  const linkable = {};
  TR_ROLES[roleKey].lines.forEach(x => { if (x.link) linkable[x.type] = 1; });
  const ls = trDayLines(report, day).filter(l => !l.voidedAt && linkable[l.type]);
  return { linked: ls.filter(l => l.linkType && l.linkType !== 'none' && l.linkId).length, total: ls.length };
}

/** What the 4:30 report fixes for good. */
function trSnapshot(portal, mine, day, person) {
  const out = { day, at: '', person: _srS(person) };
  portal.concat(mine).forEach(t => { out[t.key] = { text: t.text, value: t.value, status: t.status }; });
  return out;
}

/* ── A352 · the person's sent mail: collection follow-ups (accounting), price requests to suppliers (admin) ── */

const TR_COLLECT_RE = /\b(SOA|statements? of accounts?|collections?|payments?|overdue|past due|remittances?|reminders?|outstanding|unpaid|balance due|due date|settlement|check pick ?up|cheque)\b/i;
const TR_RFQ_RE = /\b(RFQ|request(ing)? (a |for )?(quotation|quote|price|pricing|offer|proposal)|quotation request|price request|pricing request|price (inquiry|enquiry))\b/i;
const TR_PRICE_RE = /\b(quot(e|es|ation|ations)|prices?|pricing|inquiry|enquiry|availability|lead ?time|offer|stocks?)\b/i;
const TR_ORDER_RE = /\b(purchase order|P\.?O\.? ?(no|#|\d)|order confirmation|invoices?|payments?|deliver(y|ies))\b/i;
const TR_OUR_QUOTE_RE = /\b(\d{4}-\d{3,}-[A-Z]{2,}|quotation\s*(no\.?|#)\s*\d)/i;   // our own quotation going out (2026-560-ADM), not a request
const TR_PUBLIC_MAIL = { 'gmail.com': 1, 'yahoo.com': 1, 'outlook.com': 1, 'hotmail.com': 1, 'icloud.com': 1, 'live.com': 1, 'ymail.com': 1 };
const TR_SUFFIX_RE = /\b(corporation|corp|incorporated|inc|company|co|ltd|limited|enterprises|enterprise|ent|philippines|phils|phil|international|intl|group|holdings|resources|pte|sdn|bhd|llc|gmbh)\b/g;

/** 'Philcement Corp.' → 'philcement'; 'FIRST FARMERS HOLDING CORPORATION' → 'firstfarmers' — the name, joined, as a domain would spell it. */
function _trCompact(name) {
  return _srS(name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s*[-–—]\s+.*$/, '').replace(/[.,&]/g, ' ').replace(TR_SUFFIX_RE, ' ').replace(/[^a-z0-9]/g, '');
}
function _trDomain(addr) {
  const a = _srS(addr).toLowerCase(), at = a.indexOf('@');
  if (at < 0) return '';
  const d = a.slice(at + 1);
  return TR_PUBLIC_MAIL[d] ? '' : d.split('.')[0].replace(/[^a-z0-9]/g, '');
}
function _trOrgs(list) {
  const seen = {}, out = [];
  list.forEach(o => {
    const c = _trCompact(o.name);
    if (!c || c.length < 3) return;
    if (!seen[c]) { seen[c] = { name: _srS(o.name), compact: c, emails: {} }; out.push(seen[c]); }
    _srS(o.email).toLowerCase().split(/[\s,;\/]+/).filter(x => x.indexOf('@') > 0).forEach(x => { seen[c].emails[x] = 1; });
  });
  return out;
}
/** The organisation an email went to: its exact address on file, or its domain spelling the name (4+ letters). */
function _trOrgOf(orgs, addr) {
  const a = _srS(addr).toLowerCase(), d = _trDomain(a);
  const byMail = orgs.find(o => o.emails[a]);
  if (byMail) return byMail;
  if (!d || d.length < 4) return null;
  return orgs.find(o => o.compact === d) || orgs.find(o => o.compact.indexOf(d) === 0 || (o.compact.length >= 4 && d.indexOf(o.compact) === 0)) || null;
}

/** The day's sent mail, each email marked when it counts, and why. marks = { messageId: true | false } — the director's
 *  own correction, which always wins over the guess. */
function trMail(roleKey, ix, emails, marks) {
  const cfg = TR_ROLES[roleKey].mail;
  if (!cfg) return [];
  const m = marks || {};
  const customers = _trOrgs(ix.clients.map(c => ({ name: c.customer, email: c.email })).concat(ix.ar.map(a => ({ name: a.customer }))).concat(ix.sos.map(x => ({ name: x.customer }))));
  const suppliers = _trOrgs(ix.suppliers.map(x => ({ name: x.supplier })).concat(ix.pos.map(p => ({ name: p.supplier }))));
  const pastDue = {};
  ix.ar.forEach(a => {
    if (_srS(a.status).toLowerCase() === 'paid' || _srNum(a.outstanding) <= 0) return;
    const due = _srDate(a.dueDate), c = _trCompact(a.customer);
    if (!c || !/^\d{4}-/.test(due) || due >= ix.today) return;
    if (!pastDue[c] || due < pastDue[c].due) pastDue[c] = { arNo: _srS(a.arNo), due };
  });
  return (emails || []).map(e => {
    const subj = _srS(e.subject), cust = _trOrgOf(customers, e.recipient), sup = cust ? null : _trOrgOf(suppliers, e.recipient);
    let why = '', ref = '';
    if (cfg.on === 'collection') {
      const due = cust ? pastDue[cust.compact] : null;
      if (TR_COLLECT_RE.test(subj)) why = 'the subject is about payment';
      else if (due) why = 'to ' + cust.name + ', who has a past-due receivable';
      ref = due ? due.arNo : '';
    } else {
      if (TR_RFQ_RE.test(subj) && !cust) why = 'the subject asks for a price';
      else if (!cust && TR_PRICE_RE.test(subj) && !TR_ORDER_RE.test(subj) && !TR_OUR_QUOTE_RE.test(subj)) why = sup ? 'to supplier ' + sup.name + ', about price or stock' : 'asks about price or stock, not to a customer';
      ref = (subj.match(/PR-\d{6}-\d{3}/i) || [''])[0].toUpperCase();
    }
    const id = _srS(e.messageId), mark = m[id], counted = mark === true ? true : mark === false ? false : !!why;
    return { id, time: srClock(e.sentAt), sort: srMinutes(e.sentAt), to: _srS(e.name || e.recipient), recipient: _srS(e.recipient), subject: subj,
             org: (cust || sup || {}).name || '', why, counted, marked: mark === true || mark === false, ref };
  }).sort((a, b) => a.sort - b.sort);
}

/** The mail tiles: the role's own (collection follow-ups / price requests), then everything sent.
 *  state: 'ok' | 'loading' | 'setup' (the mailbox is not connected) | 'error' | 'none' (no login to read). */
function trMailTiles(roleKey, rows, state) {
  const cfg = TR_ROLES[roleKey].mail;
  if (!cfg) return [];
  const ok = state === 'ok', why = { loading: 'reading the mailbox…', setup: 'the mailbox is not connected', error: 'the mailbox could not be read', none: 'no login to read' }[state] || '';
  const counted = (rows || []).filter(r => r.counted);
  const item = (r) => ({ time: r.time, ref: r.ref, what: r.subject + ' — to ' + r.to + (r.org ? ' (' + r.org + ')' : ''), result: r.marked ? (r.counted ? 'counted by you' : 'not counted, by you') : r.why });
  return [
    { key: cfg.key, label: cfg.label, value: ok ? counted.length : null, text: ok ? String(counted.length) : '—', target: ok ? 'from the sent mail' : why, bar: null, status: ok ? 'none' : 'nr', items: ok ? counted.map(item) : [] },
    { key: 'mailSent', label: 'Emails sent', value: ok ? rows.length : null, text: ok ? String(rows.length) : '—', target: ok ? 'from the sent mail' : why, bar: null, status: ok ? 'none' : 'nr', items: ok ? rows.map(item) : [] }
  ];
}

/* ── the person's feed, links, queue and week ──────────────────────────────────────────────── */

/** Everything the portal logged for the person that day — they typed none of this. */
function trFeed(ix, person, day) {
  return trRows(ix, person, day).map(a => ({ time: srClock(a.timestamp), sort: srMinutes(a.timestamp), module: _srS(a.module), action: _srS(a.action),
    ref: _srS(a.refNo), text: _srS(a.summary), amount: _srNum(a.amount) }));
}

/** What a typed line can link to, from the role's own records. */
function trLinkOptions(roleKey, ix) {
  const out = { ar: [], accred: [], lead: [], pr: [], po: [], so: [] };
  if (roleKey === 'accounting') {
    out.ar = ix.ar.filter(a => _srS(a.status).toLowerCase() !== 'paid' && _srNum(a.outstanding) > 0)
      .map(a => ({ id: _srS(a.arNo), due: _srDate(a.dueDate), label: _srS(a.arNo) + ' — ' + _srS(a.customer) + ', ' + srMoney(a.outstanding), company: _srS(a.customer) }))
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
      .map(a => Object.assign(a, { label: a.label + (a.due ? (a.due < ix.today ? ', past due ' : ', due ') + a.due : '') }));
  } else if (roleKey === 'leadgen') {
    out.accred = (ix.lg.data.accred || []).filter(a => !a.deletedOn).map(a => ({ id: _srS(a.accredNo), label: _srS(a.accredNo) + ' — ' + _srS(a.company) + ', ' + (_srS(a.status) || 'no status'), company: _srS(a.company) }));
    out.lead = (ix.lg.data.leads || []).filter(l => /Handed Off|Presentation Booked|Returned/.test(_srS(l.status)))
      .map(l => ({ id: _srS(l.leadNo), label: _srS(l.leadNo) + ' — ' + _srS(l.company) + ', ' + _srS(l.status) + (l.handedTo ? ' (' + _srS(l.handedTo) + ')' : ''), company: _srS(l.company) }));
  } else if (roleKey === 'admin') {
    out.pr = ix.prs.filter(p => TR_PR_STAGE[_srS(p.status)] || _srS(p.status) === 'For Mgmt Pricing')
      .map(p => ({ id: _srS(p.prNo), label: _srS(p.prNo) + ' — ' + _srS(p.customer) + ', ' + _srS(p.status), company: _srS(p.customer) }));
    out.po = ix.pos.filter(p => _trOpenStatus(p.status))
      .map(p => ({ id: _srS(p.poNo), label: _srS(p.poNo) + ' — ' + _srS(p.supplier) + ', ' + (_srS(p.status) || 'Draft'), company: _srS(p.supplier) }));
    out.so = ix.sos.filter(s => _trOpenStatus(s.status) && !/^DEMO-/i.test(_srS(s.soNo)))
      .map(s => ({ id: _srS(s.soNo), label: _srS(s.soNo) + ' — ' + _srS(s.customer), company: _srS(s.customer) }));
  }
  return out;
}

/** The home-page queue (flowComputeActions) as plain rows: urgent first. */
function trQueue(items) {
  const rank = { urgent: 0, warn: 1, info: 2, ok: 3 };
  return (items || []).map(i => ({ text: _srS(i.text), tone: _srS(i.tone) || 'info', link: _srS(i.link), amt: _srNum(i.amt) }))
    .sort((a, b) => (rank[a.tone] === undefined ? 4 : rank[a.tone]) - (rank[b.tone] === undefined ? 4 : rank[b.tone]));
}

/** Mon–Sun: three key counts a day (and the mail count, A352) and whether the 4:30 report went in.
 *  saved = { 'yyyy-mm-dd': {submittedAt, report} }; mailByDay = { 'yyyy-mm-dd': emails | null (unreadable) } — a day
 *  not read yet is 'loading'. */
function trWeek(roleKey, ix, person, day, saved, mailByDay) {
  const cfg = TR_ROLES[roleKey], days = srWeekDays(day);
  const label = (key) => { const c = (cfg.tiles || []).find(t => t.key === key); if (c) return c.label; const k = (cfg.counts || []).find(x => x[0] === key); return k ? k[1] : key; };
  const byDay = ix.lg.counts && ix.lg.counts.week && ix.lg.counts.week.byDay;
  const rows = days.map(d => {
    if (d > ix.today) return { day: d, future: true };
    let vals;
    if (cfg.counts) vals = cfg.week.map(k => (byDay && byDay[d] ? _srNum(byDay[d][k]) : null));
    else { const rs = trRows(ix, person, d); vals = cfg.week.map(k => _trActTile(cfg.tiles.find(t => t.key === k), rs).value); }
    const s = (saved || {})[d], weekend = srDow(d) === 'Sat' || srDow(d) === 'Sun';
    if (cfg.mail) {
      const em = (mailByDay || {})[d];
      vals.push(Array.isArray(em) ? trMail(roleKey, ix, em, s && s.report && s.report.mailMarks).filter(r => r.counted).length : em === null ? null : 'loading');
    }
    return { day: d, vals, report: s && s.submittedAt ? { state: 'done', time: srClock(s.submittedAt) } : weekend ? { state: 'none' } : { state: 'due' } };
  });
  const past = rows.filter(r => !r.future);
  const cols = cfg.week.length + (cfg.mail ? 1 : 0);
  const totals = Array.from({ length: cols }, (_, i) => past.some(r => typeof r.vals[i] === 'number') ? past.reduce((s, r) => s + (typeof r.vals[i] === 'number' ? r.vals[i] : 0), 0) : null);
  const work = past.filter(r => srDow(r.day) !== 'Sat' && srDow(r.day) !== 'Sun');
  return { days, heads: cfg.week.map(label).concat(cfg.mail ? [cfg.mail.short] : []), rows, totals, reports: work.filter(r => r.report.state === 'done').length, reportDays: work.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TR_ROLES, TR_LINE_FIELDS, trIndex, trRows, trTiles, trStuckPrs, trEnded, trBlank, trFill, trNewLine, trEditLine, trVoidLine, trMail, trMailTiles,
                     trDayLines, trMineTiles, trLinked, trSnapshot, trFeed, trLinkOptions, trQueue, trWeek };
}
