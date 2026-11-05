/* client-hub-model.js — A396 · the client information hub, pure: labels, filters, the checklist, the CSV. No DOM, no reads.
 *
 * Neil, 5 Nov 2026: every detail of every client in one place, for management, admin, the director and HR, with each
 * client's accreditation. FlowAPI 199's getClientHub builds the cards (one per client, from the Client master, both reps'
 * Client Books, Collection details and lead gen's tracker); this file turns them into what js/client-hub.js draws. */
const CH_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CH_SEGS = [['all', 'All clients'], ['accredited', 'Accredited'], ['renew', 'Renew soon'], ['expired', 'Expired'], ['process', 'On process'], ['not', 'Not accredited'], ['nolabel', 'No rep label'], ['missing', 'Missing files']];
const CH_STATE_SEG = { 'Accredited': 'accredited', 'Renew soon': 'renew', 'Expired': 'expired', 'On process': 'process', 'Not accredited': 'not', 'No label': 'nolabel' };
const CH_TYPES = { 'image/jpeg': 'Picture', 'image/png': 'Picture', 'image/webp': 'Picture', 'image/gif': 'Picture', 'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint', 'text/plain': 'Text', 'text/csv': 'CSV' };
const CH_MAX_MB = 10;

/** '3 Feb 2026' (a yyyy-mm-dd or an ISO time). */
function chDay(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? (+s.slice(8, 10)) + ' ' + CH_MON[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4) : '';
}
/** 'Accredited' → the badge's tone. */
function chTone(state) { return { 'Accredited': 'ok', 'Renew soon': 'warn', 'Expired': 'bad', 'On process': 'mid', 'Not accredited': 'off', 'No label': 'off' }[state] || 'off'; }
/** The one line that says where a client's accreditation stands. */
function chStatusLine(a) {
  if (!a) return '';
  const left = a.daysLeft;
  if (a.state === 'Expired') return 'Expired ' + chDay(a.expires) + ' · time to re-apply';
  if (a.state === 'Renew soon') return 'Accredited · expires ' + chDay(a.expires) + ' · renew within ' + left + (left === 1 ? ' day' : ' days');
  if (a.state === 'Accredited') return ['Accredited', a.since ? 'since ' + chDay(a.since) : '', a.expires ? 'expires ' + chDay(a.expires) : 'no expiry date yet'].filter(Boolean).join(' · ');
  if (a.state === 'On process') { const l = (a.labels || [])[0]; return 'On process' + (l && l.step ? ' · ' + l.step : ''); }
  if (a.state === 'Not accredited') return 'Not accredited';
  return 'No rep has this client in their Client Book';
}
/** The list's short badge: 'Expires 1 Dec 2026', 'Expired', 'On process'… */
function chBadge(a) {
  if (!a) return '';
  if (a.state === 'Accredited') return a.expires ? 'Accredited to ' + chDay(a.expires) : 'Accredited';
  if (a.state === 'Renew soon') return 'Renew by ' + chDay(a.expires);
  if (a.state === 'Expired') return 'Expired ' + chDay(a.expires);
  return a.state;
}
function chInSeg(c, seg) {
  if (!seg || seg === 'all') return true;
  const a = c.accred || {};
  if (seg === 'missing') return ['Accredited', 'Renew soon', 'Expired', 'On process'].indexOf(a.state) >= 0 && a.missing > 0;
  return CH_STATE_SEG[a.state] === seg;
}
/** Everything a search can hit: the names, the people and their numbers, the TIN, the addresses, the sector. */
function chText(c) {
  const p = (c.people || []).map(x => [x.name, x.position].concat(x.emails || [], x.phones || []).join(' ')).join(' ');
  return [c.company].concat(c.names || [], c.owners || [], (c.addresses || []).map(a => a.text), [c.sector, c.tier, c.billing && c.billing.tin, p]).join(' ').toLowerCase();
}
function chFilter(cards, f) {
  const q = String((f && f.q) || '').trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
  return (cards || []).filter(c => chInSeg(c, f && f.seg) && (!words.length || (t => words.every(w => t.indexOf(w) >= 0))(chText(c))));
}
function chSummary(cards) {
  const out = { all: 0 };
  CH_SEGS.forEach(s => { out[s[0]] = 0; });
  (cards || []).forEach(c => { out.all++; CH_SEGS.forEach(s => { if (s[0] !== 'all' && chInSeg(c, s[0])) out[s[0]]++; }); });
  return out;
}
/** One accreditation year's checklist: each requirement with its files that year, and last year's to reuse. */
function chChecklist(card, reqs, year) {
  const files = ((card && card.accred && card.accred.files) || []).filter(f => !f.archived), y = String(year), prev = String(+year - 1);
  return (reqs || []).map(r => {
    const now = files.filter(f => f.requirement === r && f.year === y), last = files.filter(f => f.requirement === r && f.year === prev);
    return { requirement: r, files: now, last: now.length ? [] : last, done: now.length > 0, optional: r === 'Other' };
  });
}
/** The years a client's checklist can show: this one, the one before, and any year with files. */
function chYears(card, today) {
  const a = (card && card.accred) || {}, set = {};
  [a.year, String(+String(today).slice(0, 4))].concat((a.files || []).map(f => f.year)).forEach(y => { if (/^\d{4}$/.test(String(y))) set[y] = 1; });
  return Object.keys(set).sort().reverse();
}
/** '1.2 MB' */
function chSize(n) { const b = +n || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
/** Refuse a file before reading it: the type and the size the server takes. */
function chFileCheck(file) {
  if (!file) return 'Choose a file.';
  if (!CH_TYPES[String(file.type || '').toLowerCase()]) return 'Add a picture (JPEG, PNG, WebP, GIF), a PDF, a Word, Excel or PowerPoint file, or a text file.';
  if (file.size > CH_MAX_MB * 1048576) return 'That file is ' + chSize(file.size) + '. Keep it under ' + CH_MAX_MB + ' MB.';
  return '';
}
/** The main person: the one marked main, else the first. */
function chPrimary(c) { const p = (c && c.people) || []; return p.find(x => x.primary) || p[0] || null; }
function _chCsvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
/** The list as a CSV: identity, terms, the main contact, accreditation. */
function chCsv(cards) {
  const head = ['Client', 'Also written', 'Sector', 'Tier', 'Reps', 'Address', 'Main contact', 'Phone', 'Email', 'Terms', 'VAT', 'EWT %', 'TIN', 'Accreditation', 'Since', 'Expires', 'Files missing'];
  const rows = (cards || []).map(c => {
    const p = chPrimary(c) || {}, b = c.billing || {}, a = c.accred || {};
    return [c.company, (c.names || []).filter(n => n !== c.company).join('; '), c.sector, c.tier, (c.owners || []).join('; '), ((c.addresses || [])[0] || {}).text,
      p.name, (p.phones || [])[0], (p.emails || [])[0], b.terms, b.vatType, b.ewtRate, b.tin, a.state, a.since, a.expires, a.missing];
  });
  return [head].concat(rows).map(r => r.map(_chCsvCell).join(',')).join('\n') + '\n';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CH_SEGS, CH_TYPES, CH_MAX_MB, chDay, chTone, chStatusLine, chBadge, chInSeg, chText, chFilter, chSummary, chChecklist, chYears, chSize, chFileCheck, chPrimary, chCsv };
}
