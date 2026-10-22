/* client-book-model.js — A350 · what the Client Book works out (a private trial, the director's only).
 *
 * Neil, 21 Oct 2026: each client with its contact people (several, each with several emails and phones), its
 * accreditation (Accredited / On process / Not accredited, with the last update) and, once accredited, its sales status
 * — tied to the client's purchase requests and quotations so it can be tracked, and tracked in the Sales Daily Report.
 *
 * PURE. Everything arrives as arguments; tests/flow/client-book.js runs it in node. A client is matched to the portal's
 * records by crCanonKey (js/client-rollup.js), the browser twin of the server's _canonKey; flowQuotationBucket /
 * flowQuotationOwner / flowQuotationNet / flowDate come from flow-api.js. The records are only ever read.
 */

/* The page shows the server's lists when it has them (getClientBook returns them); these are the same lists. */
const CB_ACCRED = ['Accredited', 'On process', 'Not accredited'];
const CB_STEPS = ['Requirements received', 'Documents submitted', 'Under evaluation', 'Site audit'];
const CB_STATUS = ['RFQ pending', 'RFQ received', 'Quotation sent', 'Following up', 'Negotiating', 'PO received', 'Lost', 'On hold', 'No requirement now'];
const CB_TIERS = ['Major', 'Minor'];   // A354 — every client is labelled Major or Minor
const CB_SECTORS = ['Oil and gas', 'Cement', 'Power', 'Aviation', 'Automotive', 'Construction', 'Mining', 'Others'];   // A354 — and its industry
/** A sector off the list (typed for "Others") counts as Others. */
function cbSectorGroup(sector) { const s = _cbS(sector); return !s ? '' : CB_SECTORS.indexOf(s) >= 0 ? s : 'Others'; }
const CB_STALE_DAYS = 14, CB_EXPIRY_DAYS = 30;
const CB_PR_DONE = { 'Quoted': 1, 'Partly Quoted': 1, 'Migrated': 1 };   // a PR in these states is no longer an open RFQ
const CB_FOLLOW_DAYS = [3, 7, 14];                                       // the Sales Daily Report's follow-up rule

function _cbS(v) { return String(v == null ? '' : v).trim(); }
function _cbDate(v) { return typeof flowDate === 'function' ? flowDate(v) : _cbS(v).slice(0, 10); }
function _cbKey(name) { return typeof crCanonKey === 'function' ? crCanonKey(name) : _cbS(name).toLowerCase(); }
function _cbNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function _cbAdd(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function _cbDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function _cbWeekend(day) { const w = new Date(day + 'T00:00:00Z').getUTCDay(); return w === 6 ? _cbAdd(day, 2) : w === 0 ? _cbAdd(day, 1) : day; }

/** ₱186,400 below a million, ₱3.8M above. */
function cbMoney(v) {
  const n = _cbNum(v);
  if (Math.abs(n) >= 1e6) return '₱' + (n / 1e6).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'M';
  return '₱' + Math.round(n).toLocaleString('en-US');
}
/** '21 Oct 2026' */
function cbDay(v) {
  const d = _cbDate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(5, 7)) - 1];
  return Number(d.slice(8)) + ' ' + m + ' ' + d.slice(0, 4);
}

/* ── the portal's records, grouped by client ───────────────────────────────────────────────── */

/** raw = { quotations, prs, salesOrders, clients (the real Clients sheet, names only), activity, today }
 *  A358: a PR made for a Client Book client carries its Client No, and so does — through its PR No — the quotation made
 *  from it, and the sales order made from that quotation (linkedTo). Linked records are filed under that client
 *  (`linked`) as well as under their company name; cbRecords lets the link win. */
function cbIndex(raw) {
  const r = raw || {}, by = {}, linked = {};
  const slot = (key) => (by[key] = by[key] || { prs: [], quotes: [], sos: [] });
  const lslot = (no) => (linked[no] = linked[no] || { prs: [], quotes: [], sos: [] });
  const prLink = {}, qLink = {};
  (r.prs || []).forEach(p => { if (p && p.prNo && _cbS(p.clientNo)) prLink[_cbS(p.prNo)] = _cbS(p.clientNo); });
  (r.quotations || []).forEach(q => { if (q && q.quotationNo && prLink[_cbS(q.prNo)]) qLink[_cbS(q.quotationNo)] = prLink[_cbS(q.prNo)]; });
  const file = (type, key, rec) => { slot(key)[type].push(rec); if (rec.linkedTo) lslot(rec.linkedTo)[type].push(rec); };
  const prCreated = {};
  (r.activity || []).forEach(a => { if (a.module === 'Pricing Request' && a.action === 'Created' && a.refNo && (!prCreated[a.refNo] || a.timestamp < prCreated[a.refNo])) prCreated[a.refNo] = a.timestamp; });
  const hasSO = {};
  (r.salesOrders || []).forEach(s => { if (s.quotationNo) hasSO[_cbS(s.quotationNo)] = true; });
  (r.prs || []).forEach(p => {
    if (!p || !p.prNo || !_cbS(p.customer)) return;
    file('prs', _cbKey(p.customer), { kind: 'pr', ref: _cbS(p.prNo), customer: _cbS(p.customer), status: _cbS(p.status), owner: _cbS(p.salesperson || p.requestedBy),
      date: _cbDate(prCreated[p.prNo] || p.date), open: !CB_PR_DONE[_cbS(p.status)], quotationNo: _cbS(p.quotationNo), linkedTo: prLink[_cbS(p.prNo)] || '' });
  });
  (r.quotations || []).forEach(q => {
    if (!q || !q.quotationNo || /^DEMO-/i.test(q.quotationNo) || !_cbS(q.customer)) return;
    const bucket = typeof flowQuotationBucket === 'function' ? flowQuotationBucket(q, hasSO) : '';
    file('quotes', _cbKey(q.customer), { kind: 'quotation', ref: _cbS(q.quotationNo), customer: _cbS(q.customer), status: _cbS(q.status), bucket,
      owner: typeof flowQuotationOwner === 'function' ? flowQuotationOwner(q) : _cbS(q.salesperson || q.createdBy),
      value: typeof flowQuotationNet === 'function' ? flowQuotationNet(q) : _cbNum(q.total),
      sent: _cbS(q.sentAtBasis) ? '' : _cbDate(q.sentAt), date: _cbDate(q.sentAt || q.date || q.createdAt), prNo: _cbS(q.prNo), linkedTo: qLink[_cbS(q.quotationNo)] || '' });
  });
  (r.salesOrders || []).forEach(s => {
    if (!s || !s.soNo || /^DEMO-/i.test(s.soNo) || !_cbS(s.customer)) return;
    file('sos', _cbKey(s.customer), { kind: 'so', ref: _cbS(s.soNo), customer: _cbS(s.customer), status: _cbS(s.status), value: _cbNum(s.total),
      date: _cbDate(s.date), quotationNo: _cbS(s.quotationNo), linkedTo: qLink[_cbS(s.quotationNo)] || '' });
  });
  [by, linked].forEach(m => Object.keys(m).forEach(k => ['prs', 'quotes', 'sos'].forEach(t => m[k][t].sort((a, b) => b.date.localeCompare(a.date)))));
  return { today: _cbS(r.today) || (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10)), by, linked,
           names: cbNames(r) };
}

/** The company names the portal already uses (quotations, PRs, sales orders, the Clients sheet), for the add form. */
function cbNames(raw) {
  const seen = {}, out = [];
  const add = (n) => { const s = _cbS(n), k = _cbKey(s); if (!s || !k || seen[k]) return; seen[k] = s; out.push({ name: s, key: k }); };
  ((raw && raw.clients) || []).forEach(c => add(c.customer));
  ((raw && raw.salesOrders) || []).forEach(s => { if (!/^DEMO-/i.test(_cbS(s.soNo))) add(s.customer); });
  ((raw && raw.quotations) || []).forEach(q => { if (!/^DEMO-/i.test(_cbS(q.quotationNo))) add(q.customer); });
  ((raw && raw.prs) || []).forEach(p => add(p.customer));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A client's records: its PRs, quotations and sales orders, newest first, with the follow-up due on the day.
 *  A358: the records linked to this client (through a PR made for it) whatever their company is spelled, then the
 *  records matched by its company name — never one linked to another client. Each says which (`linked`). */
function cbRecords(ix, client) {
  const byName = ix.by[_cbKey(client.company)] || { prs: [], quotes: [], sos: [] };
  const L = (ix.linked && ix.linked[_cbS(client.clientNo)]) || { prs: [], quotes: [], sos: [] };
  const take = (type) => {
    const seen = {}, out = [];
    L[type].concat(byName[type].filter(x => !x.linkedTo)).forEach(x => {
      if (seen[x.ref]) return;
      seen[x.ref] = 1;
      out.push(Object.assign({}, x, { linked: !!x.linkedTo && x.linkedTo === _cbS(client.clientNo) }));
    });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  };
  const g = { prs: take('prs'), quotes: take('quotes'), sos: take('sos') };
  const quotes = g.quotes.map(q => {
    let due = null;
    if (q.bucket === 'sent' && q.sent) {
      const step = CB_FOLLOW_DAYS.find(n => _cbWeekend(_cbAdd(q.sent, n)) === ix.today);
      if (step) due = step;
    }
    return Object.assign({}, q, { followUpDue: due });
  });
  const open = quotes.filter(q => q.bucket === 'sent');
  return { prs: g.prs, quotes, sos: g.sos, openPrs: g.prs.filter(p => p.open).length, openQuotes: open.length,
           openValue: open.reduce((s, q) => s + q.value, 0), total: g.prs.length + quotes.length + g.sos.length };
}

/** What the records say the sales stage is — the latest event wins (a sales order before a quotation before a PR on
 *  the same day). Returned as a suggestion when it differs from the client's status and is newer than its last update;
 *  it is never applied by itself. A354: offered whatever the accreditation — the two are separate labels. */
function cbRecordsSay(recs, client) {
  const c = [];
  recs.sos.forEach(s => c.push({ status: 'PO received', ref: s.ref, date: s.date, rank: 4, why: 'Sales order ' + s.ref }));
  recs.quotes.filter(q => q.bucket === 'sent').forEach(q => c.push({ status: q.followUpDue ? 'Following up' : 'Quotation sent', ref: q.ref, date: q.sent || q.date, rank: 3,
    why: 'Quotation ' + q.ref + ' sent' + (q.followUpDue ? ', day-' + q.followUpDue + ' follow-up due today' : '') }));
  recs.prs.filter(p => p.open).forEach(p => c.push({ status: 'RFQ received', ref: p.ref, date: p.date, rank: 2, why: 'Purchase request ' + p.ref + ' (' + p.status + ')' }));
  recs.quotes.filter(q => q.status === 'Lost').forEach(q => c.push({ status: 'Lost', ref: q.ref, date: q.date, rank: 1, why: 'Quotation ' + q.ref + ' closed as Lost' }));
  if (!c.length) return null;
  c.sort((a, b) => b.date.localeCompare(a.date) || b.rank - a.rank);
  const best = c[0];
  const since = _cbDate(client.statusUpdatedAt);
  const fresh = best.status !== client.status && (!since || best.date >= since);
  return Object.assign({}, best, { suggest: fresh });   // A354 — the status no longer waits for the accreditation
}

/** The owner a new client is given by default: whoever owns its latest quotation or PR. */
function cbOwnerSuggest(ix, company) {
  const g = ix.by[_cbKey(company)];
  if (!g) return '';
  const all = g.quotes.map(q => ({ owner: q.owner, date: q.date })).concat(g.prs.map(p => ({ owner: p.owner, date: p.date })))
    .filter(x => x.owner && !/^(admin|website|migrated|backfill|manual)/i.test(x.owner)).sort((a, b) => b.date.localeCompare(a.date));
  return all.length ? all[0].owner : '';
}

/* ── the client's own history and flags ────────────────────────────────────────────────────── */

/** One log row in words: 'Added to the Client Book', 'Accreditation: On process → Accredited until 2027-10-31', … */
function cbLogText(l) {
  const ch = _cbS(l.from) ? _cbS(l.from) + ' → ' + _cbS(l.to) : _cbS(l.to);
  return l.kind === 'created' ? 'Added to the Client Book' : l.kind === 'accreditation' ? 'Accreditation: ' + ch : l.kind === 'status' ? 'Status: ' + ch
    : l.kind === 'contacts' ? 'Contact people: ' + ch : l.kind === 'archived' ? 'Archived' : l.kind === 'restored' ? 'Restored' : 'Details changed';
}

function cbLogFor(log, clientNo) { return (log || []).filter(l => l.clientNo === clientNo).sort((a, b) => _cbS(b.at).localeCompare(_cbS(a.at))); }

/** The client's flags on `today`: needs an update (nothing logged for 14 days), next step overdue, accreditation
 *  expiring (within 30 days) or expired, and the other clients with the same company key. */
function cbFlags(client, log, clients, today) {
  const last = cbLogFor(log, client.clientNo)[0];
  const lastDay = _cbDate((last && last.at) || client.updatedAt || client.createdAt);
  const until = client.accreditation === 'Accredited' ? _cbDate(client.accreditedUntil) : '';
  const twins = (clients || []).filter(o => o.clientNo !== client.clientNo && !o.archivedAt && o.key && o.key === client.key).map(o => o.clientNo);
  return {
    lastUpdate: lastDay, daysSince: lastDay ? _cbDays(lastDay, today) : null,
    needsUpdate: !client.archivedAt && !!lastDay && _cbDays(lastDay, today) >= CB_STALE_DAYS,
    nextOverdue: !client.archivedAt && !!client.nextStepDate && client.nextStepDate < today,
    expired: !!until && until < today,
    expiring: !!until && until >= today && _cbDays(today, until) <= CB_EXPIRY_DAYS,
    twins
  };
}
/** The accreditation's last update (On process / Not accredited show it). */
function cbAccredLast(client, log) {
  const l = cbLogFor(log, client.clientNo).find(x => x.kind === 'accreditation' || x.kind === 'created');
  return { at: (l && l.at) || client.accreditationUpdatedAt || '', note: (l && l.note) || client.accreditationNote || '' };
}

/* ── search, filters, summary, export ──────────────────────────────────────────────────────── */

function cbPrimary(client) { const c = client.contacts || []; return c.find(x => x.primary) || c[0] || null; }

/** f = { q, accreditation, status, owner, flag ('needsUpdate'|'expiring'|'nextOverdue'), archived, sort } */
function cbFilter(clients, log, ix, f) {
  const o = f || {}, q = _cbS(o.q).toLowerCase();
  const rows = (clients || []).filter(c => {
    if (!!c.archivedAt !== !!o.archived) return false;
    if (o.accreditation && c.accreditation !== o.accreditation) return false;
    if (o.tier && (c.tier || '') !== o.tier) return false;
    if (o.sector && cbSectorGroup(c.sector) !== o.sector) return false;
    if (o.status && c.status !== o.status) return false;
    if (o.owner && c.owner !== o.owner) return false;
    if (o.flag) { const fl = cbFlags(c, log, clients, ix.today); if (o.flag === 'expiring' ? !(fl.expiring || fl.expired) : !fl[o.flag]) return false; }
    if (!q) return true;
    const hay = [c.company, c.tier, c.sector, c.siteAddress, c.owner, c.status, c.accreditation, c.notes, c.nextStep].concat((c.contacts || []).reduce((a, p) =>
      a.concat([p.name, p.position, p.note]).concat(p.emails || []).concat(p.phones || []).concat((p.phones || []).map(x => String(x).replace(/\D/g, ''))), [])).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0 || (q.replace(/\D/g, '').length >= 4 && hay.indexOf(q.replace(/\D/g, '')) >= 0);
  });
  const sort = o.sort || 'updated';
  const last = (c) => cbFlags(c, log, clients, ix.today).lastUpdate || '';
  rows.sort((a, b) => sort === 'company' ? a.company.localeCompare(b.company)
    : sort === 'next' ? (a.nextStepDate || '9999').localeCompare(b.nextStepDate || '9999')
    : sort === 'open' ? cbRecords(ix, b).openValue - cbRecords(ix, a).openValue
    : last(b).localeCompare(last(a)) || a.company.localeCompare(b.company));
  return rows;
}

/** The counts the summary chips and the dashboard card show (archived clients left out). */
function cbSummary(clients, log, today) {
  const live = (clients || []).filter(c => !c.archivedAt);
  const fl = live.map(c => cbFlags(c, log, clients, today));
  return { total: live.length, major: live.filter(c => c.tier === 'Major').length, minor: live.filter(c => c.tier === 'Minor').length,
           accredited: live.filter(c => c.accreditation === 'Accredited').length,
           onProcess: live.filter(c => c.accreditation === 'On process').length, notAccredited: live.filter(c => c.accreditation === 'Not accredited').length,
           needsUpdate: fl.filter(x => x.needsUpdate).length, expiring: fl.filter(x => x.expiring || x.expired).length,
           nextOverdue: fl.filter(x => x.nextOverdue).length, archived: (clients || []).length - live.length };
}

/** The filtered list as CSV (one row per client, every contact person in one cell). */
function cbCsv(rows, log, ix) {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Client No', 'Company', 'Major or minor', 'Sector', 'Site address', 'Owner', 'Accreditation', 'Step', 'Accredited until', 'Accreditation last update', 'Status', 'Status since', 'Status ref',
                'Primary contact', 'Position', 'Emails', 'Phones', 'Other contacts', 'Open PRs', 'Open quotations', 'Open quotations value', 'Next step', 'Next step date', 'Last update'];
  const lines = rows.map(c => {
    const p = cbPrimary(c) || {}, others = (c.contacts || []).filter(x => x !== p), r = cbRecords(ix, c), fl = cbFlags(c, log, rows, ix.today);
    return [c.clientNo, c.company, c.tier, c.sector, c.siteAddress, c.owner, c.accreditation, c.accreditationStep, c.accreditedUntil, _cbDate(cbAccredLast(c, log).at), c.status, _cbDate(c.statusUpdatedAt), c.statusRef,
            p.name || '', p.position || '', (p.emails || []).join('; '), (p.phones || []).join('; '),
            others.map(o => [o.name, o.position, (o.emails || []).join(' / '), (o.phones || []).join(' / ')].filter(Boolean).join(', ')).join(' | '),
            r.openPrs, r.openQuotes, Math.round(r.openValue), c.nextStep, c.nextStepDate, fl.lastUpdate].map(q).join(',');
  });
  return [head.join(',')].concat(lines).join('\n');
}

/* ── the Sales Daily Report trial ──────────────────────────────────────────────────────────── */

/** The daily report lines (ProofReports, the trial's own) linked to this client, or naming its company. */
function cbDayLines(reports, client) {
  const key = _cbKey(client.company), out = [];
  (reports || []).forEach(r => ((r.report && r.report.lines) || []).forEach(l => {
    if (l.voidedAt) return;
    if ((l.linkType === 'client' && l.linkId === client.clientNo) || (l.company && _cbKey(l.company) === key)) {
      out.push({ day: r.date, user: r.user, type: l.type, company: l.company, person: l.person, note: l.note, result: l.result, loggedAt: l.loggedAt });
    }
  }));
  return out.sort((a, b) => _cbS(b.loggedAt).localeCompare(_cbS(a.loggedAt)));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CB_ACCRED, CB_STEPS, CB_STATUS, CB_TIERS, CB_SECTORS, cbSectorGroup, cbIndex, cbNames, cbRecords, cbRecordsSay, cbOwnerSuggest, cbLogText, cbLogFor, cbFlags, cbAccredLast,
                     cbPrimary, cbFilter, cbSummary, cbCsv, cbDayLines, cbMoney, cbDay };
}
