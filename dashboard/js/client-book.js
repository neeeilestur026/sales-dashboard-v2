/* client-book.js — A350 · the Client Book page (director-client-book.html), a private trial for the director.
 *
 * The list, its filters and summary chips, and one client's full detail: contact people (several, each with several
 * emails and phones), accreditation with its history, the sales status once accredited (with what the portal's records
 * say), the client's purchase requests, quotations and sales orders, the Sales Daily Report lines about it, and the
 * whole timeline. The numbers and matching are js/client-book-model.js (pure, tested). Saving is the trial's own four
 * actions (FlowAPI 178): nothing here writes the real client list, PRs or quotations. */

const CB = { me: null, ix: null, clients: [], log: [], lists: null, reports: [], roster: [], ok: true, okMsg: '', open: '', back: null, built: false,
             f: { q: '', accreditation: '', status: '', owner: '', flag: '', archived: false, sort: 'updated' } };

function _cbE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _cbId(id) { return document.getElementById(id); }
function _cbLists() { return CB.lists || { accreditation: CB_ACCRED, steps: CB_STEPS, status: CB_STATUS }; }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireDirector === 'function' ? requireDirector() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('director-client-book');
  if (typeof hxDatePill === 'function') hxDatePill('long');
  CB.me = String(s.name || s.username || '').trim();
  _cbId('cbAdd').addEventListener('click', (e) => cbAddDialog(e.currentTarget));
  _cbId('cbExport').addEventListener('click', cbExport);
  _cbId('cbChips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) cbChip(b.getAttribute('data-chip')); });
  _cbId('cbTable').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) cbDetail(b.getAttribute('data-open'), b); });
  await cbLoad();
});

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

async function cbLoad() {
  _cbId('cbTable').innerHTML = '<tbody><tr><td class="cb-empty">Reading the Client Book…</td></tr></tbody>';
  const today = flowToday(), from = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 120); return d.toISOString().slice(0, 10); })();
  const read = (a, p) => fetchFlow(a, p || {}).then(r => (r && r.success !== false ? r.data : null)).catch(() => null);
  const [book, quotations, prs, salesOrders, clients, activity, users, reports] = await Promise.all([
    postFlow('getClientBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) })),
    read('getQuotations'), read('getPricingRequests'), read('getSalesOrders'), read('getClients'),
    read('getActivityLog', { from, to: today }),
    typeof apiGetUsers === 'function' ? apiGetUsers().then(r => (r && (r.data || r.users)) || []).catch(() => []) : Promise.resolve([]),
    postFlow('getProofReports', { from, to: today }).then(r => (r && r.success ? r.data || [] : [])).catch(() => [])
  ]);
  CB.ix = cbIndex({ today, quotations, prs, salesOrders, clients, activity });
  CB.reports = reports;
  CB.roster = (users || []).filter(u => String(u.role || '').toLowerCase() === 'sales').map(u => String(u.fullName || u.name || u.username || '').trim()).filter(Boolean).sort();
  cbTakeBook(book);
  cbRender();
  const ask = new URLSearchParams(location.search || '').get('client');   // a Sales Daily Report line links here
  if (ask && CB.clients.some(c => c.clientNo === ask)) cbDetail(ask, null);
}
function cbTakeBook(book) {
  CB.ok = !!(book && book.success);
  CB.okMsg = CB.ok ? '' : (book && book.message) || '';
  CB.clients = CB.ok ? book.clients || [] : [];
  CB.log = CB.ok ? book.log || [] : [];
  if (CB.ok && book.lists) CB.lists = book.lists;
}
async function cbReload() {
  const book = await postFlow('getClientBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) }));
  cbTakeBook(book);
  cbRender();
  if (CB.open) cbDetail(CB.open, CB.back);
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function cbRender() {
  const n = _cbId('cbNotice');
  n.innerHTML = CB.ok ? '' : '<div class="cb-notice' + (/Unknown action|not a secured action/i.test(CB.okMsg) ? '' : ' bad') + '">' + (/Unknown action|not a secured action/i.test(CB.okMsg)
    ? 'The Client Book needs the FlowAPI update (version 178). Until it is pasted nothing can be saved here.'
    : 'Could not read the Client Book: ' + _cbE(CB.okMsg)) + '</div>';
  _cbId('cbAdd').disabled = !CB.ok;
  const sum = cbSummary(CB.clients, CB.log, CB.ix.today), f = CB.f;
  const chip = (key, label, count) => '<button type="button" class="cb-chip' + (cbChipOn(key) ? ' on' : '') + '" data-chip="' + key + '" aria-pressed="' + cbChipOn(key) + '">' +
    _cbE(label) + ' <span class="n">' + count + '</span></button>';
  _cbId('cbChips').innerHTML = chip('all', 'All clients', sum.total) + chip('a:Accredited', 'Accredited', sum.accredited) + chip('a:On process', 'On process', sum.onProcess) +
    chip('a:Not accredited', 'Not accredited', sum.notAccredited) + chip('f:needsUpdate', 'Needs an update', sum.needsUpdate) +
    chip('f:expiring', 'Accreditation expiring', sum.expiring) + chip('f:nextOverdue', 'Next step overdue', sum.nextOverdue) + chip('archived', 'Archived', sum.archived);
  const owners = Array.from(new Set(CB.roster.concat(CB.clients.map(c => c.owner).filter(Boolean)))).sort();
  const opt = (v, cur, label) => '<option value="' + _cbE(v) + '"' + (v === cur ? ' selected' : '') + '>' + _cbE(label || v) + '</option>';
  if (!CB.built) {
    CB.built = true;
    _cbId('cbFilters').innerHTML =
      '<label class="cb-search"><span>Search</span><input type="search" id="cbQ" placeholder="Company, contact, email or phone" autocomplete="off"></label>' +
      '<label><span>Status</span><select id="cbStatus"></select></label><label><span>Owner</span><select id="cbOwner"></select></label>' +
      '<label><span>Sort</span><select id="cbSort">' + [['updated', 'Last update'], ['company', 'Company'], ['next', 'Next step date'], ['open', 'Open quotations']].map(x => opt(x[0], f.sort, x[1])).join('') + '</select></label>';
    _cbId('cbQ').addEventListener('input', (e) => { f.q = e.target.value; cbRenderTable(); });
    ['cbStatus', 'cbOwner', 'cbSort'].forEach(id => _cbId(id).addEventListener('change', (e) => {
      f[{ cbStatus: 'status', cbOwner: 'owner', cbSort: 'sort' }[id]] = e.target.value; cbRenderTable();
    }));
  }
  _cbId('cbStatus').innerHTML = opt('', f.status, 'Any status') + _cbLists().status.map(s => opt(s, f.status)).join('');
  _cbId('cbOwner').innerHTML = opt('', f.owner, 'Any owner') + owners.map(o => opt(o, f.owner)).join('');
  cbRenderTable();
}
function cbChipOn(key) {
  const f = CB.f;
  if (key === 'all') return !f.accreditation && !f.flag && !f.archived;
  if (key === 'archived') return f.archived;
  if (key.indexOf('a:') === 0) return !f.archived && f.accreditation === key.slice(2);
  return !f.archived && f.flag === key.slice(2);
}
function cbChip(key) {
  const f = CB.f;
  f.accreditation = ''; f.flag = ''; f.archived = false;
  if (key === 'archived') f.archived = true;
  else if (key.indexOf('a:') === 0) f.accreditation = key.slice(2);
  else if (key.indexOf('f:') === 0) f.flag = key.slice(2);
  cbRender();
}

function cbRenderTable() {
  const rows = cbFilter(CB.clients, CB.log, CB.ix, CB.f);
  const t = _cbId('cbTable');
  if (!CB.clients.length) {
    t.innerHTML = '<tbody><tr><td class="cb-empty">' + (CB.ok ? 'No clients yet. Press Add client to start the book.' : 'Nothing to show yet.') + '</td></tr></tbody>';
    _cbId('cbFoot').textContent = '';
    return;
  }
  t.innerHTML = '<thead><tr><th scope="col">Company</th><th scope="col">Owner</th><th scope="col">Accreditation</th><th scope="col">Sales status</th>' +
    '<th scope="col">From the portal</th><th scope="col">Next step</th><th scope="col">Last update</th></tr></thead><tbody>' +
    (rows.length ? rows.map(cbRow).join('') : '<tr><td colspan="7" class="cb-empty">No client matches.</td></tr>') + '</tbody>';
  _cbId('cbFoot').textContent = rows.length + ' of ' + CB.clients.filter(c => !!c.archivedAt === CB.f.archived).length + ' shown.';
}

function cbBadge(text, tone) { return '<span class="cb-badge ' + (tone || '') + '">' + _cbE(text) + '</span>'; }
function cbAccTone(a) { return a === 'Accredited' ? 'ok' : a === 'On process' ? 'mid' : 'off'; }
function cbStatusTone(s) { return s === 'PO received' ? 'ok' : s === 'Lost' || s === 'No requirement now' ? 'off' : s ? 'mid' : ''; }

function cbRow(c) {
  const p = cbPrimary(c), fl = cbFlags(c, CB.log, CB.clients, CB.ix.today), r = cbRecords(CB.ix, c), say = cbRecordsSay(r, c);
  const acc = cbAccredLast(c, CB.log);
  return '<tr class="' + (c.archivedAt ? 'archived' : '') + '"><td><button type="button" class="cb-open" data-open="' + _cbE(c.clientNo) + '">' + _cbE(c.company) + '</button>' +
      (p ? '<span class="cb-sub">' + _cbE([p.name, p.position].filter(Boolean).join(', ')) + ((c.contacts || []).length > 1 ? ' + ' + ((c.contacts || []).length - 1) + ' more' : '') + '</span>' : '<span class="cb-sub">No contact yet</span>') +
      (fl.twins.length ? '<span class="cb-flag">Possible duplicate</span>' : '') + '</td>' +
    '<td>' + _cbE(c.owner || '—') + '</td>' +
    '<td>' + cbBadge(c.accreditation, cbAccTone(c.accreditation)) + (c.accreditationStep ? '<span class="cb-sub">' + _cbE(c.accreditationStep) + '</span>' : '') +
      (c.accreditation === 'Accredited' ? (c.accreditedUntil ? '<span class="cb-sub' + (fl.expired || fl.expiring ? ' warn' : '') + '">' + (fl.expired ? 'Expired ' : 'Until ') + _cbE(cbDay(c.accreditedUntil)) + '</span>' : '')
        : '<span class="cb-sub">Last update ' + _cbE(cbDay(acc.at) || '—') + '</span>') + '</td>' +
    '<td>' + (c.accreditation === 'Accredited' ? (c.status ? cbBadge(c.status, cbStatusTone(c.status)) + '<span class="cb-sub">since ' + _cbE(cbDay(c.statusUpdatedAt)) + '</span>' : '<span class="cb-dim">No status yet</span>') +
      (say && say.suggest ? '<span class="cb-say">Records say: ' + _cbE(say.status) + '</span>' : '') : '<span class="cb-dim">—</span>') + '</td>' +
    '<td>' + (r.total ? _cbE(r.prs.length + ' PR' + (r.prs.length === 1 ? '' : 's') + ' · ' + r.quotes.length + ' quotation' + (r.quotes.length === 1 ? '' : 's')) +
      (r.openValue ? '<span class="cb-sub">' + _cbE(cbMoney(r.openValue)) + ' open</span>' : '') : '<span class="cb-dim">None yet</span>') + '</td>' +
    '<td>' + (c.nextStep ? _cbE(c.nextStep) : '<span class="cb-dim">—</span>') + (c.nextStepDate ? '<span class="cb-sub' + (fl.nextOverdue ? ' warn' : '') + '">' + _cbE(cbDay(c.nextStepDate)) + '</span>' : '') + '</td>' +
    '<td>' + _cbE(cbDay(fl.lastUpdate) || '—') + (fl.needsUpdate ? '<span class="cb-sub warn">' + fl.daysSince + ' days ago</span>' : '') + (c.archivedAt ? '<span class="cb-sub">Archived</span>' : '') + '</td></tr>';
}

function cbExport() {
  const rows = cbFilter(CB.clients, CB.log, CB.ix, CB.f);
  const blob = new Blob([cbCsv(rows, CB.log, CB.ix)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'client-book-' + CB.ix.today + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── the dialog ───────────────────────────────────────────────────────────────────────────────── */

function cbOverlay() {
  let ov = _cbId('cbOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay cb-overlay';
  ov.id = 'cbOverlay';
  ov.innerHTML = '<div class="flow-modal cb-modal" role="dialog" aria-modal="true" aria-labelledby="cbTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) { cbClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) cbClose();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) cbClose(); });
  return ov;
}
function cbShow(html, back) {
  const ov = cbOverlay(), box = ov.querySelector('.cb-modal');
  CB.back = back || CB.back;
  box.innerHTML = html;
  ov.classList.add('open');
  document.body.classList.add('cb-open-dlg');
  return box;
}
function cbClose() {
  const ov = _cbId('cbOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('cb-open-dlg');
  CB.open = '';
  if (CB.back && CB.back.focus) CB.back.focus();
}
function cbMsg(box, text, bad) { const m = box.querySelector('.cb-msg'); if (m) { m.textContent = text; m.className = 'cb-msg' + (bad ? ' bad' : ' ok'); } }

/* the contact people editor, shared by Add client and the detail */
function cbPersonHtml(p, i) {
  const v = p || {};
  return '<fieldset class="cb-person" data-person="' + i + '"><legend>Contact ' + (i + 1) + '</legend>' +
    '<div class="cb-grid2"><label>Name<input type="text" class="cb-in" data-f="name" value="' + _cbE(v.name) + '" maxlength="120"></label>' +
    '<label>Position<input type="text" class="cb-in" data-f="position" value="' + _cbE(v.position) + '" maxlength="120" placeholder="Maintenance planner"></label></div>' +
    '<div class="cb-grid2"><label>Emails (one per line)<textarea class="cb-in" data-f="emails" rows="2" placeholder="name@company.ph">' + _cbE((v.emails || []).join('\n')) + '</textarea></label>' +
    '<label>Phone numbers (one per line)<textarea class="cb-in" data-f="phones" rows="2" placeholder="0917 123 4567">' + _cbE((v.phones || []).join('\n')) + '</textarea></label></div>' +
    '<div class="cb-personfoot"><label class="cb-inline"><input type="radio" name="cbPrimary" data-f="primary"' + (v.primary ? ' checked' : '') + '> Main contact</label>' +
    '<input type="hidden" data-f="id" value="' + _cbE(v.id || ('P' + Date.now().toString(36) + i)) + '">' +
    '<button type="button" class="cb-mini" data-rmperson="' + i + '">Remove this person</button></div></fieldset>';
}
function cbReadPeople(box) {
  return Array.prototype.map.call(box.querySelectorAll('.cb-person'), (fs) => {
    const g = (f) => fs.querySelector('[data-f="' + f + '"]');
    const lines = (t) => String(t.value || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    return { id: g('id').value, name: g('name').value.trim(), position: g('position').value.trim(), emails: lines(g('emails')), phones: lines(g('phones')), primary: g('primary').checked };
  }).filter(p => p.name || p.emails.length || p.phones.length);
}
function cbWirePeople(box) {
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    const wrap = box.querySelector('.cb-people');
    if (b.hasAttribute('data-addperson')) {
      wrap.insertAdjacentHTML('beforeend', cbPersonHtml({ primary: !wrap.querySelector('.cb-person') }, wrap.querySelectorAll('.cb-person').length));
      const last = wrap.querySelector('.cb-person:last-child [data-f="name"]'); if (last) last.focus();
    } else if (b.hasAttribute('data-rmperson')) {
      const fs = b.closest('.cb-person'); if (fs) fs.remove();
      wrap.querySelectorAll('.cb-person legend').forEach((l, i) => { l.textContent = 'Contact ' + (i + 1); });
    }
  });
}
function cbOwnerSelect(cur, suggest) {
  const list = Array.from(new Set(CB.roster.concat(cur ? [cur] : []).concat(suggest ? [suggest] : []))).sort();
  return '<select class="cb-in" name="owner"><option value="">No owner yet</option>' +
    list.map(o => '<option value="' + _cbE(o) + '"' + ((cur || suggest) === o ? ' selected' : '') + '>' + _cbE(o) + (o === suggest && o !== cur ? ' (from the records)' : '') + '</option>').join('') + '</select>';
}

/** The live client already in the book under the same company (by the server's own key), or null. */
function cbTwinOf(name) {
  const key = crCanonKey(name);
  return key ? CB.clients.find(c => !c.archivedAt && crCanonKey(c.company) === key) || null : null;
}

/* Add client */
function cbAddDialog(back) {
  const names = CB.ix.names.map(n => '<option value="' + _cbE(n.name) + '"></option>').join('');
  const box = cbShow('<header class="cb-mhead"><div><h3 id="cbTitle">Add a client</h3><p class="cb-sub">It starts as Not accredited unless you say otherwise. The real client list is not changed.</p></div>' +
    '<button type="button" class="btn btn-secondary" data-close>Close</button></header>' +
    '<form class="cb-form" id="cbAddForm" autocomplete="off">' +
      '<label>Company<input type="text" class="cb-in" name="company" list="cbNames" required maxlength="160" placeholder="As the portal names it"><datalist id="cbNames">' + names + '</datalist></label>' +
      '<p class="cb-warn" id="cbDup" hidden></p>' +
      '<div class="cb-grid2"><label>Owner (sales rep)<span id="cbOwnerBox">' + cbOwnerSelect('', '') + '</span></label>' +
      '<label>Accreditation<select class="cb-in" name="accreditation">' + _cbLists().accreditation.map(a => '<option' + (a === 'Not accredited' ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label></div>' +
      '<div class="cb-people">' + cbPersonHtml({ primary: true }, 0) + '</div>' +
      '<button type="button" class="btn btn-secondary cb-addperson" data-addperson>Add another person</button>' +
      '<div class="cb-grid2"><label>Next step<input type="text" class="cb-in" name="nextStep" maxlength="190" placeholder="Send the vendor accreditation forms"></label>' +
      '<label>Next step date<input type="date" class="cb-in" name="nextStepDate"></label></div>' +
      '<label>Notes<textarea class="cb-in" name="notes" rows="2" maxlength="2000"></textarea></label>' +
      '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Add the client</button></div></form>', back);
  cbWirePeople(box);
  const form = box.querySelector('#cbAddForm');
  const company = form.elements.company;
  company.addEventListener('input', () => {
    const v = company.value.trim(), twin = cbTwinOf(v);
    const dup = _cbId('cbDup');
    dup.hidden = !twin;
    if (twin) dup.innerHTML = '"' + _cbE(twin.company) + '" is already in the book. <button type="button" class="cb-link" data-open-twin="' + _cbE(twin.clientNo) + '">Open it</button>';
    const sug = v ? cbOwnerSuggest(CB.ix, v) : '';
    const cur = form.elements.owner.value;
    _cbId('cbOwnerBox').innerHTML = cbOwnerSelect(cur, sug);
  });
  box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-open-twin]'); if (b) cbDetail(b.getAttribute('data-open-twin'), CB.back); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const params = { company: company.value.trim(), owner: form.elements.owner.value, accreditation: form.elements.accreditation.value,
                     contactsJson: JSON.stringify(cbReadPeople(box)), nextStep: form.elements.nextStep.value.trim(), nextStepDate: form.elements.nextStepDate.value,
                     notes: form.elements.notes.value.trim() };
    if (form.dataset.allow === '1') params.allowDuplicate = true;
    btn.disabled = true; cbMsg(box, 'Saving…');
    const r = await postFlow('saveClientBookClient', params).catch(e => ({ success: false, message: String(e && e.message || e) }));
    btn.disabled = false;
    if (r && r.success) { CB.open = r.clientNo; await cbReload(); return; }
    if (r && r.duplicate) {
      form.dataset.allow = '1';
      btn.textContent = 'Add it anyway (another site)';
      cbMsg(box, r.message + ' Open it from the list, or add it anyway if this is another site.', true);
      return;
    }
    cbMsg(box, (r && r.message) || 'The client could not be saved.', true);
  });
  company.focus();
}

/* One client's detail */
function cbDetail(no, back) {
  const c = CB.clients.find(x => x.clientNo === no);
  if (!c) return;
  CB.open = no;
  const lists = _cbLists(), r = cbRecords(CB.ix, c), say = cbRecordsSay(r, c), fl = cbFlags(c, CB.log, CB.clients, CB.ix.today);
  const log = cbLogFor(CB.log, no), acc = cbAccredLast(c, CB.log), lines = cbDayLines(CB.reports, c);
  const live = !c.archivedAt && CB.ok;
  const refOpts = r.quotes.map(q => ({ v: q.ref, l: 'Quotation ' + q.ref + ' — ' + q.status })).concat(r.prs.map(p => ({ v: p.ref, l: 'PR ' + p.ref + ' — ' + p.status })))
    .concat(r.sos.map(s => ({ v: s.ref, l: 'Sales order ' + s.ref })));
  const hist = (kinds) => log.filter(l => kinds.indexOf(l.kind) >= 0).map(cbLogLi).join('');
  const link = (kind, ref) => kind === 'pr' ? '<a href="flow-pricing-request.html?pr=' + encodeURIComponent(ref) + '">' + _cbE(ref) + '</a>'
    : kind === 'quotation' ? '<a href="flow-quotations.html?review=' + encodeURIComponent(ref) + '">' + _cbE(ref) + '</a>' : '<b>' + _cbE(ref) + '</b>';
  const recRow = (x) => '<li><span class="tm">' + _cbE(cbDay(x.date)) + '</span><span>' + link(x.kind, x.ref) + ' <span class="cb-sub">' + _cbE(x.status || '') +
    (x.owner ? ' · ' + _cbE(x.owner) : '') + (x.followUpDue ? ' · day-' + x.followUpDue + ' follow-up due today' : '') + '</span></span><span class="amt">' + (x.value ? _cbE(cbMoney(x.value)) : '') + '</span></li>';
  const box = cbShow(
    '<header class="cb-mhead"><div><h3 id="cbTitle">' + _cbE(c.company) + '</h3><p class="cb-sub">' + _cbE(c.clientNo) + ' · ' + _cbE(c.owner || 'no owner') + ' · ' +
      cbBadge(c.accreditation, cbAccTone(c.accreditation)) + (c.status && c.accreditation === 'Accredited' ? ' ' + cbBadge(c.status, cbStatusTone(c.status)) : '') +
      (c.archivedAt ? ' ' + cbBadge('Archived', 'off') : '') + '</p></div><button type="button" class="btn btn-secondary" data-close>Close</button></header>' +
    (fl.twins.length ? '<p class="cb-warn">Possible duplicate of ' + _cbE(fl.twins.join(', ')) + ' (the same company).</p>' : '') +
    (c.archivedAt ? '<p class="cb-warn">Archived ' + _cbE(cbDay(c.archivedAt)) + ': ' + _cbE(c.archiveReason) + '</p>' : '') +

    '<section class="cb-sec"><h4>Accreditation</h4>' +
      '<p class="cb-sub">' + (c.accreditation === 'Accredited' ? (c.accreditedUntil ? 'Accredited until ' + _cbE(cbDay(c.accreditedUntil)) + (fl.expired ? ' — expired' : fl.expiring ? ' — expiring soon' : '') : 'Accredited')
        : 'Last update ' + _cbE(cbDay(acc.at) || '—') + (acc.note ? ': ' + _cbE(acc.note) : '')) + '</p>' +
      (live ? '<form class="cb-form" data-kind="accreditation"><fieldset class="cb-pills"><legend class="cb-sr">Accreditation</legend>' +
        lists.accreditation.map(a => '<label class="cb-pill"><input type="radio" name="pick" value="' + a + '"' + (a === c.accreditation ? ' checked' : '') + '><span>' + a + '</span></label>').join('') + '</fieldset>' +
        '<div class="cb-grid2"><label>Step (on process)<select class="cb-in" name="step"><option value="">—</option>' + lists.steps.map(s => '<option' + (s === c.accreditationStep ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
        '<label>Accredited until<input type="date" class="cb-in" name="until" value="' + _cbE(c.accreditedUntil) + '"></label></div>' +
        '<label>What changed (one line)<input type="text" class="cb-in" name="note" maxlength="500" placeholder="Vendor forms submitted to purchasing"></label>' +
        '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Save the accreditation update</button></div></form>' : '') +
      (hist(['accreditation', 'created']) ? '<ul class="cb-hist">' + hist(['accreditation', 'created']) + '</ul>' : '') + '</section>' +

    '<section class="cb-sec"><h4>Sales status</h4>' +
      (c.accreditation !== 'Accredited' ? '<p class="cb-sub">The sales status starts once the client is accredited. Its purchase requests and quotations still show below.</p>'
      : (say && say.status !== c.status ? '<div class="cb-sayline' + (say.suggest ? ' on' : '') + '"><span>The records say: <b>' + _cbE(say.status) + '</b> — ' + _cbE(say.why) + ' (' + _cbE(cbDay(say.date)) + ').</span>' +
          (say.suggest && live ? '<button type="button" class="btn btn-secondary" data-usesay>Use it</button>' : '') + '</div>' : '') +
        (c.status ? '<p class="cb-sub">' + cbBadge(c.status, cbStatusTone(c.status)) + ' since ' + _cbE(cbDay(c.statusUpdatedAt)) + (c.statusRef ? ' · ' + _cbE(c.statusRef) : '') + (c.statusNote ? ' — ' + _cbE(c.statusNote) : '') + '</p>' : '') +
        (live ? '<form class="cb-form" data-kind="status"><div class="cb-grid2"><label>Status<select class="cb-in" name="pick">' + lists.status.map(s => '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
          '<label>Linked to<select class="cb-in" name="ref"><option value="">No record</option>' + refOpts.map(o => '<option value="' + _cbE(o.v) + '"' + (o.v === c.statusRef ? ' selected' : '') + '>' + _cbE(o.l) + '</option>').join('') + '</select></label></div>' +
          '<label>What changed (one line)<input type="text" class="cb-in" name="note" maxlength="500"></label>' +
          '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Save the status</button></div></form>' : '') +
        (hist(['status']) ? '<ul class="cb-hist">' + hist(['status']) + '</ul>' : '')) + '</section>' +

    '<section class="cb-sec"><h4>From the portal <span class="cb-sub">read only</span></h4>' +
      (r.total ? '<ul class="cb-recs">' + r.sos.map(recRow).join('') + r.quotes.map(recRow).join('') + r.prs.map(recRow).join('') + '</ul>'
               : '<p class="cb-sub">No purchase requests, quotations or sales orders under this company name yet.</p>') + '</section>' +

    '<section class="cb-sec"><h4>From the Sales Daily Report</h4>' +
      (lines.length ? '<ul class="cb-hist">' + lines.map(l => '<li><span class="tm">' + _cbE(cbDay(l.day)) + '</span><span>' + _cbE(l.type) + ' — ' + _cbE([l.person, l.note].filter(Boolean).join(', ') || l.company) +
        (l.result ? '<span class="cb-sub">' + _cbE(l.result) + '</span>' : '') + '<span class="cb-sub">' + _cbE(l.user) + '</span></span></li>').join('') + '</ul>'
        : '<p class="cb-sub">No lines about this client in the Sales Daily Report yet.</p>') + '</section>' +

    '<section class="cb-sec"><h4>Contacts and details</h4>' +
      (live ? '<form class="cb-form" id="cbEdit" autocomplete="off"><div class="cb-grid2"><label>Company<input type="text" class="cb-in" name="company" required maxlength="160" value="' + _cbE(c.company) + '"></label>' +
          '<label>Owner (sales rep)' + cbOwnerSelect(c.owner, '') + '</label></div>' +
          '<div class="cb-people">' + ((c.contacts || []).length ? c.contacts.map(cbPersonHtml).join('') : cbPersonHtml({ primary: true }, 0)) + '</div>' +
          '<button type="button" class="btn btn-secondary cb-addperson" data-addperson>Add another person</button>' +
          '<div class="cb-grid2"><label>Next step<input type="text" class="cb-in" name="nextStep" maxlength="190" value="' + _cbE(c.nextStep) + '"></label>' +
          '<label>Next step date<input type="date" class="cb-in" name="nextStepDate" value="' + _cbE(c.nextStepDate) + '"></label></div>' +
          '<label>Notes<textarea class="cb-in" name="notes" rows="2" maxlength="2000">' + _cbE(c.notes) + '</textarea></label>' +
          '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Save contacts and details</button></div></form>'
        : '<ul class="cb-hist">' + (c.contacts || []).map(p => '<li><span>' + _cbE(p.name) + (p.position ? ', ' + _cbE(p.position) : '') + '<span class="cb-sub">' + _cbE((p.emails || []).concat(p.phones || []).join(' · ')) + '</span></span></li>').join('') + '</ul>') + '</section>' +

    '<section class="cb-sec"><h4>Timeline</h4><ul class="cb-hist">' + log.map(cbLogLi).join('') + '</ul></section>' +

    (CB.ok ? '<section class="cb-sec"><form class="cb-form" id="cbArchive">' + (c.archivedAt
        ? '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-secondary">Restore this client</button></div>'
        : '<label>Archive this client — why?<input type="text" class="cb-in" name="reason" maxlength="190" placeholder="Plant closed"></label><div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-secondary">Archive</button></div>') +
      '</form></section>' : ''), back);
  cbWirePeople(box);
  box.querySelectorAll('form[data-kind]').forEach(form => form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const el = form.elements, kind = form.getAttribute('data-kind');
    const value = kind === 'accreditation' ? ((Array.prototype.find.call(el.pick, x => x.checked) || {}).value || '') : el.pick.value;
    const params = { clientNo: no, kind, value, note: el.note.value.trim() };
    if (kind === 'accreditation') { if (value === 'On process' && el.step.value) params.step = el.step.value; if (value === 'Accredited' && el.until.value) params.until = el.until.value; }
    else if (el.ref.value) params.ref = el.ref.value;
    await cbPost(form, 'setClientBookStatus', params);
  }));
  const use = box.querySelector('[data-usesay]');
  if (use) use.addEventListener('click', () => cbPost(box.querySelector('form[data-kind="status"]'), 'setClientBookStatus',
    { clientNo: no, kind: 'status', value: say.status, ref: say.ref, note: 'From the records: ' + say.why }));
  const edit = box.querySelector('#cbEdit');
  if (edit) edit.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const el = edit.elements;
    cbPost(edit, 'saveClientBookClient', { clientNo: no, company: el.company.value.trim(), owner: el.owner.value, contactsJson: JSON.stringify(cbReadPeople(edit)),
      nextStep: el.nextStep.value.trim(), nextStepDate: el.nextStepDate.value, notes: el.notes.value.trim() });
  });
  const arch = box.querySelector('#cbArchive');
  if (arch) arch.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (c.archivedAt) cbPost(arch, 'archiveClientBookClient', { clientNo: no, restore: true });
    else {
      const reason = arch.elements.reason.value.trim();
      if (!reason) { arch.elements.reason.focus(); cbMsg(arch, 'Say why first.', true); return; }
      cbPost(arch, 'archiveClientBookClient', { clientNo: no, reason });
    }
  });
}

/** One history line: the day, what changed, the note, who. */
function cbLogLi(l) {
  return '<li><span class="tm">' + _cbE(cbDay(l.at)) + '</span><span>' + _cbE(cbLogText(l)) + (l.ref ? ' · ' + _cbE(l.ref) : '') +
    (l.note ? '<span class="cb-sub">' + _cbE(l.note) + '</span>' : '') + '<span class="cb-sub">' + _cbE(l.by) + '</span></span></li>';
}

/** Send one change, then read the book again so the list, the detail and the timeline all agree. */
async function cbPost(form, action, params) {
  const btn = form && form.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  if (form) cbMsg(form, 'Saving…');
  const r = await postFlow(action, params).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (btn) btn.disabled = false;
  if (r && r.success) { await cbReload(); return r; }
  if (form) cbMsg(form, (r && r.message) || 'The change could not be saved.', true);
  return r;
}
