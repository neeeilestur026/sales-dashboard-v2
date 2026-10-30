/* collection-details.js — A384 · collection details (collection-details.html): accounting and admin keep them, the
 * director reads them.
 *
 * Neil, 29 Oct 2026: "each company or client has a collection details, what bank, address, contact person, and contact
 * number. the accounting, and admin dashboard can see this and they will be only ones to update this, but this will be
 * seen by director, accounting and admin dashboard". One row per client — every Client master company and every customer
 * with an open receivable — and for each: how they pay and from which bank, which of our accounts it lands in, where and
 * when to collect, and the people to call. AR aging shows the same card when a payment is recorded.
 *
 * Laid out like the supplier list (and Contacts on a Mac): the list on the left, the client on the right, each scrolling
 * on its own; on a tablet or phone the client opens as a sheet. Built to the apple-design skill: feedback on press, forms
 * that say what is wrong as you type, and a save over someone else's refused rather than lost. The numbers are
 * js/collection-details-model.js (pure, tested). */

const CD = { me: '', canEdit: false, ok: true, okMsg: '', masterOk: true, records: [], log: [], cheques: {}, lists: null, clients: [], ar: [],
             rows: [], today: '', open: '', back: null, built: false, wasSplit: null, editing: false,
             f: { q: '', seg: 'all', sort: 'owed' } };

function _cdE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _cdId(id) { return document.getElementById(id); }
function _cdLists() { return CD.lists || { paysBy: CD_PAYS_BY, places: [] }; }
function _cdFail(e) { return { success: false, message: String(e && e.message || e) }; }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireCollectionDetailsAccess === 'function' ? requireCollectionDetailsAccess() : null;   // accounting, admin, the director
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('collection-details');
  if (typeof hxDatePill === 'function') hxDatePill('long');
  CD.me = String(s.name || s.username || '').trim();
  CD.canEdit = ['accounting', 'admin'].indexOf(String(s.role || '').toLowerCase()) >= 0;   // the server says the same (_CD_EDIT)
  _cdId('cdExport').addEventListener('click', cdExport);
  _cdId('cdChips').addEventListener('click', (e) => { const b = e.target.closest('[data-seg]'); if (b) { CD.f.seg = b.getAttribute('data-seg'); cdRender(); } });
  _cdId('cdTable').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) cdDetail(b.getAttribute('data-open'), b); });
  _cdId('cdTable').addEventListener('keydown', cdListKeys);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', cdOnResize);
  await cdLoad();
});

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

function cdSkeleton() {
  return '<div class="cd-skel" aria-hidden="true">' + Array.from({ length: 6 }, () => '<span class="cd-skrow"><span></span><span></span></span>').join('') + '</div>' +
    '<p class="cd-sr" role="status">Reading the clients…</p>';
}
async function cdLoad() {
  _cdId('cdTable').innerHTML = cdSkeleton();
  CD.today = typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10);
  /* The book itself is the version test (not getVersion, which can be a minute stale here): only the server saying it has
     no such action means FlowAPI 192 is not pasted yet. The clients and receivables still list meanwhile. */
  const [book, cl, ar] = await Promise.all([
    postFlow('getCollectionBook', {}).catch(_cdFail),
    fetchFlow('getClients').catch(_cdFail),
    fetchFlow('getARAging').catch(_cdFail)]);
  cdTake(book);
  CD.masterOk = !!(cl && cl.success);
  CD.clients = CD.masterOk ? cl.data || [] : [];
  CD.ar = ar && ar.success ? ar.data || [] : [];
  cdRebuild();
  cdRender();
  const ask = new URLSearchParams(location.search || '').get('client');   // AR aging links here
  const hit = ask ? CD.rows.find(r => r.key === cdKey(ask)) : null;
  if (hit) cdDetail(hit.key, null);
  else if (cdSplit()) { const first = cdFilter(CD.rows, CD.f)[0]; if (first) cdDetail(first.key, null); else cdPaneEmpty(); }
  CD.wasSplit = cdSplit();
  cdFit();
}
function cdTake(book) {
  CD.ok = !!(book && book.success);
  CD.okMsg = CD.ok ? '' : (book && book.message) || '';
  if (!CD.ok) return;
  CD.records = book.records || [];
  CD.log = book.log || [];
  CD.cheques = book.chequeBanks || {};
  if (book.lists) CD.lists = book.lists;
}
function cdRebuild() { CD.rows = cdBuild(CD.clients, CD.ar, CD.records, CD.cheques); }
/** Read the book again (after a save, or when someone else saved), then show the same client. */
async function cdReloadBook() {
  cdTake(await postFlow('getCollectionBook', {}).catch(_cdFail));
  cdRebuild();
  cdRender();
  if (CD.open && CD.rows.some(r => r.key === CD.open)) cdDetail(CD.open, CD.back);
}

/* ── the split view (as the supplier list) ─────────────────────────────────────────────────────── */

const CD_SPLIT_MQ = '(min-width: 1180px)';
function cdSplit() {
  try { return !!_cdId('cdPane') && !!(window.matchMedia && window.matchMedia(CD_SPLIT_MQ).matches); } catch (e) { return false; }
}
function cdFit() {
  const sp = _cdId('cdSplit');
  if (!sp || !sp.getBoundingClientRect || !sp.style || !sp.style.setProperty) return;
  if (!cdSplit()) { sp.style.removeProperty('--cd-h'); return; }
  const top = sp.getBoundingClientRect().top + (window.scrollY || 0);
  sp.style.setProperty('--cd-h', Math.max(440, Math.round(window.innerHeight - top - 20)) + 'px');
}
function cdOnResize() {
  const now = cdSplit();
  if (now !== CD.wasSplit) {
    CD.wasSplit = now;
    if (now && CD.open) cdDetail(CD.open, CD.back);
    else if (now) cdPaneEmpty();
    else CD.open = '';
  }
  cdFit();
}
function cdPaneEmpty() {
  const pane = _cdId('cdPane');
  if (pane) pane.innerHTML = '<div class="cd-pane-empty"><p>' + (CD.rows.length ? 'Choose a client to see how they pay and who to call.' : 'Your clients will show here.') + '</p></div>';
}
function cdListKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = Array.prototype.slice.call(_cdId('cdTable').querySelectorAll('.cd-open')), i = all.indexOf(document.activeElement);
  const next = all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (cdSplit()) cdDetail(next.getAttribute('data-open'), next);
}
function cdMarkOpen() {
  const t = _cdId('cdTable');
  if (!t || !t.querySelectorAll) return;
  t.querySelectorAll('.cd-open').forEach(b => {
    const on = b.getAttribute('data-open') === CD.open;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    if (on && cdSplit() && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
  });
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function cdRender() {
  const old = /Unknown action|not a secured action/i.test(CD.okMsg), notes = [];
  if (!CD.ok) notes.push('<div class="cd-notice' + (old ? '' : ' bad') + '">' + (old
    ? 'Collection details open once the FlowAPI update (version 192) is pasted. The clients and what they owe show meanwhile; nothing can be saved yet.'
    : 'Could not read the collection details: ' + _cdE(CD.okMsg)) + '</div>');
  if (!CD.masterOk) notes.push('<div class="cd-notice bad">Could not read the Client master, so only clients with an open receivable are listed. Reload to try again.</div>');
  _cdId('cdNotice').innerHTML = notes.join('');
  const sum = cdSummary(CD.rows), f = CD.f;
  _cdId('cdProgress').innerHTML = CD.rows.length ? '<span class="n">' + sum.complete + '</span> of <span class="n">' + sum.total + '</span> clients have their collection details' : '';
  const chip = (key, label, count) => '<button type="button" class="cd-chip' + (f.seg === key ? ' on' : '') + '" data-seg="' + key + '" aria-pressed="' + (f.seg === key) + '">' +
    _cdE(label) + ' <span class="n">' + count + '</span></button>';
  _cdId('cdChips').innerHTML = chip('all', 'All clients', sum.total) + chip('owe', 'Owe us now', sum.owe) + chip('missing', 'Missing details', sum.missing) + chip('complete', 'Complete', sum.complete);
  if (!CD.built) {
    CD.built = true;
    const opt = (v, label) => '<option value="' + v + '"' + (v === f.sort ? ' selected' : '') + '>' + label + '</option>';
    _cdId('cdFilters').innerHTML =
      '<label class="cd-search"><span class="cd-sr">Search</span><input type="search" id="cdQ" placeholder="Search clients, people, phone numbers or banks" autocomplete="off"></label>' +
      '<label><span class="cd-sr">Sort</span><select id="cdSort">' + opt('owed', 'Sort: owes most') + opt('name', 'Sort: name') + opt('updated', 'Sort: last update') + '</select></label>';
    _cdId('cdQ').addEventListener('input', (e) => { f.q = e.target.value; cdRenderTable(); });
    _cdId('cdSort').addEventListener('change', (e) => { f.sort = e.target.value; cdRenderTable(); });
  }
  cdRenderTable();
  cdFit();
}
function cdRenderTable() {
  const rows = cdFilter(CD.rows, CD.f), t = _cdId('cdTable');
  if (!CD.rows.length) { t.innerHTML = '<p class="cd-empty">No clients to show yet. Clients come from the Client master and the open receivables.</p>'; _cdId('cdFoot').textContent = ''; return; }
  const empty = CD.f.seg === 'complete' ? 'No client has all its collection details yet.' : CD.f.seg === 'owe' ? 'No client owes us right now.'
    : CD.f.seg === 'missing' ? 'Every client has its collection details.' : 'No client matches.';
  t.innerHTML = rows.length ? rows.map(cdRow).join('') : '<p class="cd-empty">' + (CD.f.q ? 'No client matches.' : empty) + '</p>';
  const of = CD.rows.filter(r => cdInSegment(r, CD.f.seg)).length;
  _cdId('cdFoot').textContent = rows.length === of ? of + (of === 1 ? ' client' : ' clients') : rows.length + ' of ' + of + ' clients';
}
function cdBadge(text, tone) { return '<span class="cd-badge ' + (tone || '') + '">' + _cdE(text) + '</span>'; }
/** Missing, in a few words: "Missing the address and a contact number". */
function cdMissingSay(row) {
  const m = row.missing;
  return m.length > 2 ? 'Missing ' + m.slice(0, 2).join(', ') + ' and ' + (m.length - 2) + ' more' : 'Missing ' + m.join(' and ');
}
/** One client in the list: its name and what it owes; how it pays and from which bank; then who to call and what is missing. */
function cdRow(r) {
  const rec = r.rec, main = cdPrimary(rec);
  const pay = rec ? [rec.paysBy, rec.theirBank].filter(Boolean).map(_cdE).join(' · ') : '';
  const who = main ? [_cdE(main.name || (main.emails || [])[0] || ''), (main.phones || [])[0] ? _cdE(main.phones[0]) : ''].filter(Boolean).join(' · ') : '';
  const tag = r.status === 'complete' ? cdBadge('Complete', 'ok') : r.status === 'missing' ? cdBadge(cdMissingSay(r), 'warn') : '';
  return '<div class="cd-item" role="listitem"><button type="button" class="cd-open' + (CD.open === r.key ? ' on" aria-current="true' : '') + '" data-open="' + _cdE(r.key) + '">' +
    '<span class="cd-r1"><span class="cd-name">' + _cdE(r.client) + '</span>' + (r.owed > 0.005 ? '<span class="cd-owed">' + _cdE(cdMoney(r.owed)) + ' open</span>' : '') + '</span>' +
    '<span class="cd-r2">' + (rec ? pay || '<span class="cd-dim">How they pay is not set</span>' : '<span class="cd-dim">No details yet</span>') + '</span>' +
    (who || tag ? '<span class="cd-r3">' + (who ? '<span>' + who + '</span>' : '') + tag + '</span>' : '') + '</button></div>';
}
function cdExport() {
  const blob = new Blob([cdCsv(cdFilter(CD.rows, CD.f), _cdLists().places)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'collection-details-' + CD.today + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── the sheet (a bottom sheet on phones, from apple.css / apple.js) ──────────────────────────── */

function cdOverlay() {
  let ov = _cdId('cdOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay cd-overlay';
  ov.id = 'cdOverlay';
  ov.innerHTML = '<div class="flow-modal cd-modal" role="dialog" aria-modal="true" aria-labelledby="cdTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) { cdClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) cdClose();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) cdClose(); });
  return ov;
}
/** Show a client beside the list when there is room, else in the sheet. Each showing is a fresh element. */
function cdShow(html, back) {
  CD.back = back || CD.back;
  if (cdSplit()) {
    const ov = _cdId('cdOverlay');
    if (ov && ov.classList.contains('open')) { ov.classList.remove('open'); document.body.classList.remove('cd-open-dlg'); }
    const pane = _cdId('cdPane'), was = pane.querySelector('.cd-sheet'), same = !!was && was.getAttribute('data-key') === CD.open, top = pane.scrollTop;
    pane.innerHTML = '<div class="cd-sheet' + (same ? '' : ' cd-enter') + '" data-key="' + _cdE(CD.open) + '">' + html + '</div>';
    pane.scrollTop = same ? top : 0;
    return pane.firstChild;
  }
  const ov = cdOverlay(), box = ov.querySelector('.cd-modal');
  box.innerHTML = '<div class="cd-sheet">' + html + '</div>';
  ov.classList.add('open');
  document.body.classList.add('cd-open-dlg');
  return box.firstChild;
}
function cdClose() {
  const ov = _cdId('cdOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('cd-open-dlg');
  if (!cdSplit()) CD.open = '';
  if (CD.back && CD.back.focus) CD.back.focus();
}
function cdMsg(box, text, bad) { const m = box && box.querySelector('.cd-msg'); if (m) { m.textContent = text; m.className = 'cd-msg' + (bad ? ' bad' : ' ok'); } }

/* ── one client ───────────────────────────────────────────────────────────────────────────────── */

function cdDetail(key, back) {
  const row = CD.rows.find(r => r.key === key);
  if (!row) return;
  if (CD.open !== key) CD.editing = false;
  CD.open = key;
  const rec = row.rec, edit = CD.canEdit && CD.ok, log = rec ? cdLogFor(CD.log, rec.clientNo) : [];
  const others = row.names.filter(n => n.toLowerCase() !== row.client.toLowerCase());
  const status = row.status === 'complete' ? cdBadge('Complete', 'ok') : row.status === 'missing' ? cdBadge(cdMissingSay(row), 'warn') : cdBadge('No details yet', 'off');
  const head = '<header class="cd-dhead"><div class="cd-dtop"><div class="cd-dtitle"><h3 id="cdTitle">' + _cdE(row.client) + '</h3>' +
      '<p class="cd-sub">' + status + (row.owed > 0.005 ? cdBadge(cdMoney(row.owed) + ' open', 'owed') : '') + '</p>' +
      '<p class="cd-dmeta">' + [rec ? 'Updated ' + _cdE(cdShortDay(rec.updatedAt, CD.today)) + (rec.updatedBy ? ' by ' + _cdE(rec.updatedBy) : '') : '',
        others.length ? 'Also written ' + others.slice(0, 3).map(n => '"' + _cdE(n) + '"').join(', ') + (others.length > 3 ? ' and ' + (others.length - 3) + ' more' : '') : ''].filter(Boolean).join(' · ') + '</p></div>' +
      '<button type="button" class="btn btn-secondary cd-close" data-close>Close</button></div></header>';
  const card = rec ? cdCardHtml(rec, { places: _cdLists().places })
    : '<div class="cd-start"><p class="cd-start-t">No details yet.</p><p class="cd-sub">' + (edit ? 'Add how ' + _cdE(row.client) + ' pays and who to call.' : 'Accounting and admin add them.') + '</p></div>';
  const bar = edit ? '<div class="cd-panelbar"><button type="button" class="btn ' + (rec ? 'btn-secondary' : 'btn-primary') + '" data-edit aria-expanded="false" aria-controls="cdEdit">' +
      (rec ? 'Edit' : 'Add details') + '</button></div>' : (rec ? '<p class="cd-sub cd-who">Accounting and admin keep these up to date.</p>' : '');
  const open = row.open.length ? '<section class="cd-sec"><h4>Open receivables</h4><ul class="cd-ars">' + row.open.map(a => '<li><span class="cd-arno">' + _cdE(a.arNo) +
      (a.invNo ? '<span class="cd-dim"> · Invoice ' + _cdE(a.invNo) + '</span>' : '') + '</span><span class="cd-due">' + (a.dueDate ? 'Due ' + _cdE(cdShortDay(a.dueDate, CD.today)) : '') + '</span>' +
      '<span class="cd-amt">' + _cdE(cdMoney(a.outstanding)) + '</span></li>').join('') + '</ul><p class="cd-sub"><a href="flow-ar-aging.html">Open AR aging</a></p></section>' : '';
  const history = log.length ? '<section class="cd-sec"><h4>History</h4><ul class="cd-hist">' + log.map(l => '<li><span class="tm">' + _cdE(cdDay(l.at)) + '</span><span>' + _cdE(cdLogText(l)) +
      (l.note ? '<span class="cd-sub">' + _cdE(l.note) + '</span>' : '') + '<span class="cd-sub">' + _cdE(l.by) + '</span></span></li>').join('') + '</ul></section>' : '';
  const box = cdShow(head + '<div class="cd-body"><div id="cdFacts">' + card + bar + '</div>' + (edit ? cdFormHtml(row) : '') + open + history + '</div>', back);
  cdMarkOpen();
  cdWireDetail(box, row);
}

function cdWireDetail(box, row) {
  const form = box.querySelector('#cdEdit'), facts = box.querySelector('#cdFacts');
  const openEdit = (show) => {
    if (!form) return;
    CD.editing = show;
    form.hidden = !show;
    if (facts) facts.hidden = show;
    box.querySelectorAll('[data-edit]').forEach(b => b.setAttribute('aria-expanded', String(show)));
    const first = show && form.querySelector('input[name="paysBy"]:checked, input[name="paysBy"]');
    if (first && first.focus) first.focus();
  };
  if (form) { form.hidden = true; cdWireForm(form, row, () => openEdit(false)); if (CD.editing) openEdit(true); }
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-edit], [data-cancel]');
    if (!t) return;
    if (t.hasAttribute('data-edit')) openEdit(true);
    else openEdit(false);
  });
}

/* ── the form ─────────────────────────────────────────────────────────────────────────────────── */

function cdPersonHtml(p, i) {
  const v = p || {};
  return '<fieldset class="cd-person" data-person><legend>Contact ' + (i + 1) + '</legend>' +
    '<div class="cd-grid2"><label>Name<input type="text" class="cd-in" data-f="name" value="' + _cdE(v.name) + '" maxlength="120"></label>' +
    '<label>Position<input type="text" class="cd-in" data-f="position" value="' + _cdE(v.position) + '" maxlength="120" placeholder="Accounts payable"></label></div>' +
    '<div class="cd-grid2"><label>Phone numbers (one per line)<textarea class="cd-in" data-f="phones" rows="2" placeholder="0917 123 4567">' + _cdE((v.phones || []).join('\n')) + '</textarea>' +
      '<span class="cd-err" data-badphone hidden></span></label>' +
    '<label>Emails (one per line)<textarea class="cd-in" data-f="emails" rows="2" placeholder="ap@client.com.ph">' + _cdE((v.emails || []).join('\n')) + '</textarea>' +
      '<span class="cd-err" data-bad hidden></span></label></div>' +
    '<div class="cd-personfoot"><label class="cd-inline"><input type="radio" name="cdPrimary" data-f="primary"' + (v.primary ? ' checked' : '') + '> Main contact</label>' +
    '<input type="hidden" data-f="id" value="' + _cdE(v.id || ('P' + Date.now().toString(36) + i)) + '">' +
    '<button type="button" class="cd-mini" data-rmperson>Remove this person</button></div></fieldset>';
}
function cdReadPeople(form) {
  return Array.prototype.map.call(form.querySelectorAll('.cd-person'), (fs) => {
    const g = (f) => fs.querySelector('[data-f="' + f + '"]');
    const lines = (t, re) => String(t.value || '').split(re).map(x => x.trim()).filter(Boolean);
    return { id: g('id').value, name: g('name').value.trim(), position: g('position').value.trim(), emails: lines(g('emails'), /[\n,;]+/), phones: lines(g('phones'), /[\n;]+/), primary: g('primary').checked };
  }).filter(p => p.name || p.emails.length || p.phones.length);
}
/** A phone line with fewer than 7 digits is a typo, said as it is typed. */
function cdBadPhones(text) { return String(text == null ? '' : text).split(/[\n;]+/).map(x => x.trim()).filter(x => x && x.replace(/\D/g, '').length < 7); }
function cdFormHtml(row) {
  const v = row.rec || {}, L = _cdLists(), m = row.master || {}, mp = cdMasterPerson(row.master);
  const people = (v.contacts || []).length ? v.contacts : [{ primary: true }];
  const hasMaster = mp && !(v.contacts || []).some(p => (p.name || '').toLowerCase() === (mp.name || '').toLowerCase());
  const pills = '<fieldset class="cd-pills"><legend>Pays by</legend>' + L.paysBy.map(x => '<label class="cd-pill"><input type="radio" name="paysBy" value="' + _cdE(x) + '"' +
    (v.paysBy === x ? ' checked' : '') + '><span>' + _cdE(x) + '</span></label>').join('') + '</fieldset>';
  const seen = row.cheques.length ? '<p class="cd-seen"><span>Seen on their cheques:</span>' + row.cheques.map(c => '<button type="button" class="cd-seenbtn" data-bank="' + _cdE(c.bank) + '">' +
    _cdE(c.bank) + (c.date ? ' <span class="cd-dim">' + _cdE(cdShortDay(c.date, CD.today)) + '</span>' : '') + '</button>').join('') + '</p>' : '';
  return '<form class="cd-form" id="cdEdit" autocomplete="off" novalidate>' +
    '<h5 class="cd-formh">How they pay</h5>' + pills +
    '<div class="cd-grid2"><label>Their bank<input type="text" class="cd-in" name="theirBank" list="cdBanks" maxlength="60" value="' + _cdE(v.theirBank) + '" placeholder="BDO"></label>' +
      '<label>Bank note<input type="text" class="cd-in" name="bankNote" maxlength="160" value="' + _cdE(v.bankNote) + '" placeholder="Branch, account name"></label></div>' + seen +
    '<datalist id="cdBanks">' + CD_PH_BANKS.concat(row.cheques.map(c => c.bank)).filter((b, i, a) => a.indexOf(b) === i).map(b => '<option value="' + _cdE(b) + '">').join('') + '</datalist>' +
    '<label>Pays into (our account)<select class="cd-in" name="paysInto"><option value="">Not set</option>' + L.places.map(p => '<option value="' + _cdE(p.code) + '"' +
      (p.code === v.paysInto ? ' selected' : '') + '>' + _cdE(p.name) + '</option>').join('') + '</select></label>' +
    '<h5 class="cd-formh">Where to collect</h5>' +
    '<label>Collection address<textarea class="cd-in" name="address" rows="2" maxlength="300" placeholder="Building, street, city">' + _cdE(v.address) + '</textarea>' +
      (m.address && m.address !== v.address ? '<button type="button" class="cd-link" data-useaddr>Use the Client master address</button>' : '') + '</label>' +
    '<label>When to collect<input type="text" class="cd-in" name="whenToCollect" maxlength="160" value="' + _cdE(v.whenToCollect) + '" placeholder="Cheque release Fridays, 1 to 4 pm"></label>' +
    '<h5 class="cd-formh">Who to call</h5><div class="cd-people">' + people.map(cdPersonHtml).join('') + '</div>' +
    '<div class="cd-peoplebar"><button type="button" class="btn btn-secondary" data-addperson>Add another person</button>' +
      (hasMaster ? '<button type="button" class="cd-link" data-addmaster>Add ' + _cdE(mp.name || 'the Client master contact') + ' from the Client master</button>' : '') + '</div>' +
    '<label>Notes<textarea class="cd-in" name="notes" rows="2" maxlength="500" placeholder="Documents they need before paying">' + _cdE(v.notes) + '</textarea></label>' +
    '<div class="cd-formfoot">' + (row.rec ? '<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>' : '<button type="button" class="btn btn-secondary" data-cancel>Not now</button>') +
      '<span class="cd-msg" role="status" aria-live="polite"></span><button type="submit" class="btn btn-primary">Save</button></div></form>';
}
function cdFormParams(form, row) {
  const el = form.elements, pick = Array.prototype.find.call(form.querySelectorAll('input[name="paysBy"]'), x => x.checked);
  return { client: row.client, paysBy: pick ? pick.value : '', theirBank: el.theirBank.value.trim(), bankNote: el.bankNote.value.trim(), paysInto: el.paysInto.value,
           address: el.address.value.trim(), whenToCollect: el.whenToCollect.value.trim(), contactsJson: JSON.stringify(cdReadPeople(form)),
           notes: el.notes.value.trim(), ifUpdatedAt: row.rec ? row.rec.updatedAt : '' };
}
function cdWireForm(form, row, close) {
  const wrap = form.querySelector('.cd-people');
  const renumber = () => wrap.querySelectorAll('.cd-person legend').forEach((l, i) => { l.textContent = 'Contact ' + (i + 1); });
  form.addEventListener('input', (ev) => {
    const t = ev.target, f = t.getAttribute && t.getAttribute('data-f');
    if (f === 'emails' || f === 'phones') {
      const bad = f === 'emails' ? cdBadEmails(t.value) : cdBadPhones(t.value), say = t.parentNode.querySelector(f === 'emails' ? '[data-bad]' : '[data-badphone]');
      if (say) { say.hidden = !bad.length; say.textContent = bad.length ? '"' + bad[0] + '" is not ' + (f === 'emails' ? 'an email address.' : 'a full phone number.') : ''; }
    }
  });
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    if (b.hasAttribute('data-addperson')) {
      wrap.insertAdjacentHTML('beforeend', cdPersonHtml({ primary: !wrap.querySelector('.cd-person') }, wrap.querySelectorAll('.cd-person').length));
      const last = wrap.querySelector('.cd-person:last-child [data-f="name"]'); if (last) last.focus();
    } else if (b.hasAttribute('data-addmaster')) {
      const mp = cdMasterPerson(row.master), blank = Array.prototype.find.call(wrap.querySelectorAll('.cd-person'), fs =>
        !Array.prototype.some.call(fs.querySelectorAll('[data-f="name"], [data-f="emails"], [data-f="phones"]'), x => x.value.trim()));
      if (blank) blank.remove();
      wrap.insertAdjacentHTML('beforeend', cdPersonHtml(Object.assign({}, mp, { primary: !wrap.querySelector('.cd-person') }), wrap.querySelectorAll('.cd-person').length));
      renumber(); b.remove();
    } else if (b.hasAttribute('data-rmperson')) {
      const fs = b.closest('.cd-person'); if (fs) fs.remove();
      renumber();
    } else if (b.hasAttribute('data-useaddr')) {
      form.elements.address.value = (row.master || {}).address || '';
      form.elements.address.focus(); b.remove();
    } else if (b.hasAttribute('data-bank')) {
      form.elements.theirBank.value = b.getAttribute('data-bank');
    } else if (b.hasAttribute('data-reload')) {
      CD.editing = false; cdReloadBook();
    } else if (b.hasAttribute('data-cancel')) close();
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (form.querySelector('[data-bad]:not([hidden]), [data-badphone]:not([hidden])')) { cdMsg(form, 'Fix what is marked in red first.', true); return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    cdMsg(form, 'Saving…');
    const r = await postFlow('saveCollectionDetails', cdFormParams(form, row)).catch(_cdFail);
    btn.disabled = false;
    if (!(r && r.success)) {
      cdMsg(form, (r && r.message) || 'The details could not be saved.', true);
      if (r && r.stale) { const m = form.querySelector('.cd-msg'); if (m) m.insertAdjacentHTML('beforeend', ' <button type="button" class="cd-link" data-reload>Reload</button>'); }
      return;
    }
    /* the saved record is drawn at once; the history follows from a quiet re-read */
    const i = CD.records.findIndex(x => x.clientNo === r.record.clientNo);
    if (i >= 0) CD.records[i] = r.record; else CD.records.push(r.record);
    CD.editing = false;
    cdRebuild();
    cdRender();
    cdDetail(row.key, CD.back);
    if (typeof window.hxToast === 'function') window.hxToast('Saved ' + row.client + '’s collection details.', { tone: 'ok' });
    cdReloadBook();
  });
}
