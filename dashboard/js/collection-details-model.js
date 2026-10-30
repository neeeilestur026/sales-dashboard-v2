/* collection-details-model.js — A384 · what the collection details work out (collection-details.html, and AR aging's card).
 *
 * Neil, 29 Oct 2026: "each company or client has a collection details, what bank, address, contact person, and contact
 * number". One row per client: every Client master company, every customer on an open receivable that is not on the
 * master, and the details accounting saved for it (FlowAPI CollectionBook, getCollectionBook).
 *
 * A client is known by cdKey, the browser twin of FlowAPI's _cdKey: _canonKey's reduction WITHOUT its business-unit drop,
 * because fourteen Aboitiz Power units each pay on their own. tests/flow/collection-book-store.js holds the two equal.
 *
 * PURE. Everything arrives as arguments; tests/flow/collection-details.js runs it in node. Its card escapes with flowEsc
 * (js/flow-api.js).
 */

/* The server's lists (getCollectionBook returns them); these are the same lists. Pays By uses AR aging's Method words. */
const CD_PAYS_BY = ['Cheque', 'Bank Transfer', 'Online', 'Cash', 'Other'];
const CD_BANKED = { 'Cheque': 1, 'Bank Transfer': 1, 'Online': 1 };   // a way to pay that comes from a bank
const CD_PH_BANKS = ['BDO', 'BPI', 'Metrobank', 'Security Bank', 'Land Bank', 'PNB', 'UnionBank', 'RCBC', 'China Bank', 'EastWest Bank',
  'AUB', 'PSBank', 'Maybank', 'DBP', 'Bank of Commerce', 'Robinsons Bank', 'CTBC Bank', 'Sterling Bank', 'Citibank', 'HSBC', 'Standard Chartered'];
const _CD_SUFFIX_RE = /\b(corporation|corp|incorporated|inc|company|co|ltd|limited|enterprises|enterprise|ent|philippines|phils|phil|international|intl|group|holdings|resources)\b/g;
const _CD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _cdS(v) { return String(v == null ? '' : v).trim(); }
function _cdRaw(name) { return _cdS(name).toLowerCase().replace(/\s+/g, ' '); }
function _cdEsc(s) { return flowEsc(s); }   // js/flow-api.js, which both pages load first (the one escaper, tests/flow/no-duplicates.js)

/** FlowAPI _cdKey, exactly: "Aboitiz Power Corporation - TMI BU" → "aboitiz power tmi bu"; "THERMA LUZON, INC." → "therma luzon". */
function cdKey(name) {
  const s = String(name == null ? '' : name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[.,]/g, ' ').replace(_CD_SUFFIX_RE, ' ');
  return s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** "26 Oct 2026" from a date or an ISO time (blank for nothing). */
function cdDay(v) {
  const d = _cdS(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return Number(d.slice(8, 10)) + ' ' + _CD_MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4);
}
/** "26 Oct" this year, "26 Oct 2025" before. */
function cdShortDay(v, today) { const d = cdDay(v), y = _cdS(today).slice(0, 4); return y && d.slice(-4) === y ? d.slice(0, -5) : d; }
function cdMoney(n) { return '₱' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
/** What a phone link dials: the digits, and a leading + when there is one. */
function cdTel(phone) { const s = _cdS(phone).replace(/^'/, ''); return (s.charAt(0) === '+' ? '+' : '') + s.replace(/\D/g, ''); }
function cdPrimary(rec) { const c = (rec && rec.contacts) || []; return c.find(x => x.primary) || c[0] || null; }
function cdPlaceName(places, code) { const p = (places || []).find(x => x.code === code); return p ? p.name : _cdS(code); }

/** What a client's details still lack, in words; [] when they are complete. Their bank only counts when they pay from one. */
function cdMissing(rec) {
  if (!rec) return ['how they pay', 'their bank', 'the address', 'a contact number'];
  const out = [];
  if (!_cdS(rec.paysBy)) out.push('how they pay');
  if ((!_cdS(rec.paysBy) || CD_BANKED[rec.paysBy]) && !_cdS(rec.theirBank)) out.push('their bank');
  if (!_cdS(rec.address)) out.push('the address');
  if (!(rec.contacts || []).some(p => (p.phones || []).some(x => _cdS(x)))) out.push('a contact number');
  return out;
}
/** 'none' (nothing saved), 'missing' (saved, not complete) or 'complete'. */
function cdStatus(rec) { return !rec ? 'none' : cdMissing(rec).length ? 'missing' : 'complete'; }

/** The saved details for a name: the same key, or a name it is also saved under. */
function cdFind(records, name) {
  const k = cdKey(name), raw = _cdRaw(name);
  if (!k) return null;
  return (records || []).find(r => r.key === k || cdKey(r.client) === k) ||
         (records || []).find(r => (r.aliases || []).some(a => _cdRaw(a) === raw || cdKey(a) === k)) || null;
}

/** One row per client, from the Client master (`clients`, getClients), the receivables (`ar`, getARAging) and the saved
 *  details (`records`). Each: { key, client, names, master, rec, open, owed, status, missing, cheques }. */
function cdBuild(clients, ar, records, chequeBanks) {
  const by = {}, order = [];
  const take = (key, name) => {
    if (!by[key]) { by[key] = { key, client: _cdS(name), names: [], master: null, rec: null, open: [], owed: 0 }; order.push(key); }
    const row = by[key];
    if (_cdS(name) && !row.names.some(n => _cdRaw(n) === _cdRaw(name))) row.names.push(_cdS(name));
    return row;
  };
  (clients || []).forEach(c => {
    const name = _cdS(c && c.customer), key = cdKey(name);
    if (!key) return;
    const row = take(key, name);
    if (!row.master) row.master = { address: '', contactPerson: '', designation: '', email: '', phone: '' };
    ['address', 'contactPerson', 'designation', 'email', 'phone'].forEach(f => { if (!row.master[f] && _cdS(c[f])) row.master[f] = _cdS(c[f]); });
  });
  (ar || []).forEach(a => {
    const out = Number(a && a.outstanding) || 0, key = cdKey(a && a.customer);
    if (!key || out <= 0.005 || _cdS(a.status).toLowerCase() === 'paid') return;
    const row = take(key, a.customer);
    row.open.push({ arNo: _cdS(a.arNo), invNo: _cdS(a.invNo), soNo: _cdS(a.soNo), outstanding: out, dueDate: _cdS(a.dueDate).slice(0, 10), status: _cdS(a.status) });
    row.owed += out;
  });
  (records || []).forEach(r => {
    const key = _cdS(r && r.key) || cdKey(r && r.client);
    if (!key) return;
    const row = take(key, r.client);
    row.rec = r;
    row.client = _cdS(r.client) || row.client;   // the name the details were saved under
  });
  return order.map(k => {
    const row = by[k];
    row.owed = Math.round(row.owed * 100) / 100;
    row.open.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
    row.status = cdStatus(row.rec);
    row.missing = cdMissing(row.rec);
    row.cheques = (chequeBanks && chequeBanks[k]) || [];
    return row;
  });
}

/** The chip counts; `complete` is the progress line's "N of M". */
function cdSummary(rows) {
  const r = rows || [];
  return { total: r.length, owe: r.filter(x => x.owed > 0.005).length, missing: r.filter(x => x.status !== 'complete').length,
           complete: r.filter(x => x.status === 'complete').length, saved: r.filter(x => x.rec).length };
}
function cdInSegment(row, seg) {
  return seg === 'owe' ? row.owed > 0.005 : seg === 'missing' ? row.status !== 'complete' : seg === 'complete' ? row.status === 'complete' : true;
}

/** f = { q, seg ('all'|'owe'|'missing'|'complete'), sort ('owed'|'name'|'updated') }. Search covers the client and its
 *  other names, the bank, the address and the people (a phone matches on 4 digits or more). */
function cdFilter(rows, f) {
  const o = f || {}, q = _cdS(o.q).toLowerCase(), qd = q.replace(/\D/g, '');
  const out = (rows || []).filter(r => {
    if (!cdInSegment(r, o.seg || 'all')) return false;
    if (!q) return true;
    const rec = r.rec || {}, m = r.master || {};
    const hay = [r.client].concat(r.names, [rec.paysBy, rec.theirBank, rec.bankNote, rec.address, rec.whenToCollect, rec.notes, m.address, m.contactPerson, m.email, m.phone, String(m.phone || '').replace(/\D/g, '')])
      .concat(r.open.map(x => x.arNo + ' ' + x.invNo))
      .concat((rec.contacts || []).reduce((a, p) => a.concat([p.name, p.position]).concat(p.emails || []).concat(p.phones || []).concat((p.phones || []).map(x => String(x).replace(/\D/g, ''))), []))
      .join(' ').toLowerCase();
    return hay.indexOf(q) >= 0 || (qd.length >= 4 && hay.indexOf(qd) >= 0);
  });
  const sort = o.sort || 'owed', name = (a, b) => a.client.localeCompare(b.client);
  out.sort((a, b) => sort === 'name' ? name(a, b)
    : sort === 'updated' ? _cdS(b.rec && b.rec.updatedAt).localeCompare(_cdS(a.rec && a.rec.updatedAt)) || name(a, b)
    : (b.owed - a.owed) || name(a, b));
  return out;
}

/** The client master's contact as a contact person, for "Copy from client master" (null when it has none). */
function cdMasterPerson(master) {
  const m = master || {};
  if (!_cdS(m.contactPerson) && !_cdS(m.email) && !_cdS(m.phone)) return null;
  return { name: _cdS(m.contactPerson), position: _cdS(m.designation), emails: _cdS(m.email) ? [_cdS(m.email).toLowerCase()] : [],
           phones: _cdS(m.phone) ? _cdS(m.phone).split(/\s*[\/;]\s*/).filter(Boolean) : [], primary: false };
}
/** What AR aging's Record Collection form can start from: the Method and the Deposited to (blank where not saved). */
function cdPrefill(rec) {
  return { method: rec && CD_PAYS_BY.indexOf(rec.paysBy) >= 0 ? rec.paysBy : '', depositedTo: _cdS(rec && rec.paysInto) };
}

/** A client's details as three grouped lists — how they pay, where to collect, who to call — escaped, for the page and
 *  for AR aging. o = { places, empty (text when nothing is saved), compact (one short block, for the Record Collection form) }. */
function cdCardHtml(rec, o) {
  const opt = o || {}, e = _cdEsc, none = (t) => '<span class="cd-dim">' + e(t) + '</span>';
  if (!rec) return '<p class="cd-none">' + e(opt.empty || 'No collection details yet.') + '</p>';
  const tel = (t) => '<a class="cd-tel" href="tel:' + e(cdTel(t)) + '">' + e(String(t).replace(/^'/, '')) + '</a>';
  const mail = (m) => '<a href="mailto:' + e(m) + '">' + e(m) + '</a>';
  const into = rec.paysInto ? cdPlaceName(opt.places, rec.paysInto) : '';
  if (opt.compact) {
    const main = cdPrimary(rec), pay = [rec.paysBy, rec.theirBank, into ? 'into ' + into : ''].filter(Boolean).map(e).join(' · ');
    return '<div class="cd-brief">' + (pay ? '<p class="cd-brief-pay">' + pay + '</p>' : '') +
      (main ? '<p class="cd-brief-who"><b>' + e(main.name || '') + '</b>' + (main.position ? ' <span class="cd-dim">' + e(main.position) + '</span>' : '') +
        ((main.phones || []).length ? ' ' + tel(main.phones[0]) : '') + '</p>' : '') +
      (rec.address ? '<p class="cd-brief-where">' + e(rec.address) + (rec.whenToCollect ? ' · ' + e(rec.whenToCollect) : '') + '</p>' : '') + '</div>';
  }
  const fact = (k, v) => '<div class="cd-fact"><span class="cd-fk">' + k + '</span><span class="cd-fv">' + v + '</span></div>';
  const group = (title, html) => '<section class="cd-group"><h4 class="cd-gh">' + title + '</h4><div class="cd-facts">' + html + '</div></section>';
  const people = (rec.contacts || []).map(p => '<li><span class="cd-pname">' + e(p.name || (p.emails || [])[0] || (p.phones || [])[0] || 'Contact') +
      (p.primary && (rec.contacts || []).length > 1 ? ' <span class="cd-badge">Main</span>' : '') + '</span>' + (p.position ? '<span class="cd-ppos">' + e(p.position) + '</span>' : '') +
      ((p.phones || []).length ? '<span class="cd-phones">' + p.phones.map(tel).join('') + '</span>' : '') +
      ((p.emails || []).length ? '<span class="cd-mails">' + p.emails.map(mail).join('') + '</span>' : '') + '</li>').join('');
  return group('How they pay', fact('Pays by', rec.paysBy ? e(rec.paysBy) : none('Not set')) +
      fact('Their bank', rec.theirBank ? e(rec.theirBank) + (rec.bankNote ? '<span class="cd-fsub">' + e(rec.bankNote) + '</span>' : '') : none(CD_BANKED[rec.paysBy] || !rec.paysBy ? 'Not set' : 'Not needed')) +
      fact('Pays into', into ? e(into) : none('Not set'))) +
    group('Where to collect', fact('Address', rec.address ? '<span class="cd-pre">' + e(rec.address) + '</span>' : none('Not set')) +
      (rec.whenToCollect ? fact('When', e(rec.whenToCollect)) : '')) +
    group('Who to call', people ? '<ul class="cd-peeps">' + people + '</ul>' : '<p class="cd-none">No contact people yet.</p>') +
    (rec.notes ? group('Notes', '<p class="cd-note">' + e(rec.notes) + '</p>') : '');
}

/** The filtered list as CSV: one row per contact person (a client with none still has its row). */
function cdCsv(rows, places) {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Client', 'Other names', 'Pays by', 'Their bank', 'Bank note', 'Pays into', 'Collection address', 'When to collect',
                'Contact', 'Position', 'Main contact', 'Phones', 'Emails', 'Open balance (PHP)', 'Open invoices', 'Missing', 'Notes', 'Updated', 'Updated by'];
  const lines = [];
  (rows || []).forEach(r => {
    const rec = r.rec || {};
    const base = [r.client, r.names.filter(n => _cdRaw(n) !== _cdRaw(r.client)).join('; '), rec.paysBy, rec.theirBank, rec.bankNote,
                  rec.paysInto ? cdPlaceName(places, rec.paysInto) : '', rec.address, rec.whenToCollect];
    const tail = [r.owed ? r.owed.toFixed(2) : '', r.open.length || '', r.missing.join('; '), rec.notes, _cdS(rec.updatedAt).slice(0, 10), rec.updatedBy];
    const people = (rec.contacts || []).length ? rec.contacts : [null];
    people.forEach(p => lines.push(base.concat(p ? [p.name, p.position, p.primary ? 'Yes' : '', (p.phones || []).join('; '), (p.emails || []).join('; ')] : ['', '', '', '', '']).concat(tail).map(q).join(',')));
  });
  return [head.join(',')].concat(lines).join('\n');
}

/** One history line in words. */
function cdLogText(l) {
  const k = _cdS(l && l.kind);
  return k === 'created' ? 'Details added' : k === 'details' ? 'Details changed' : k === 'contacts' ? 'Contact people changed' : k;
}
function cdLogFor(log, clientNo) { return (log || []).filter(l => l.clientNo === clientNo).sort((a, b) => _cdS(b.at).localeCompare(_cdS(a.at))); }
/** One line per email that is not one, for the form to say as it is typed. */
function cdBadEmails(text) { return String(text == null ? '' : text).split(/[\n,;]+/).map(x => x.trim()).filter(x => x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CD_PAYS_BY, CD_BANKED, CD_PH_BANKS, cdKey, cdDay, cdShortDay, cdMoney, cdTel, cdPrimary, cdPlaceName, cdMissing, cdStatus, cdFind,
                     cdBuild, cdSummary, cdInSegment, cdFilter, cdMasterPerson, cdPrefill, cdCardHtml, cdCsv, cdLogText, cdLogFor, cdBadEmails };
}
