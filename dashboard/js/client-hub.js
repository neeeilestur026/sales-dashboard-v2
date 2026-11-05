/* client-hub.js — A396 · the client information hub (client-hub.html): every client's details and accreditation.
 *
 * Neil, 5 Nov 2026: "create a client information hub … all the details of all clients, only the details like the collection
 * details and everything else, no need for the quotations status and PO … add a accreditation status, then add also the
 * accreditation requirement files … if accredited put accredited, then the date … when the accreditation started, then
 * expiry usually a year, then files for organization of re applying accreditation". Management, admin, the director and HR
 * read it and keep the accreditation dates and files; HR does not see Collection details (the server leaves them out).
 *
 * Laid out like Collection details (and Contacts on a Mac): the list on the left, the client on the right, each scrolling
 * on its own; on a tablet or phone the client opens as a sheet. The client has four tabs in a segmented control that keeps
 * its indicator (it slides, it never jumps). Built to the apple-design skill: feedback on press, Undo instead of a confirm,
 * the last copy drawn at once while the fresh read runs. The labels and the checklist are js/client-hub-model.js. */

const CH = { me: '', role: '', may: { edit: false, collection: false }, ok: true, okMsg: '', cards: [], lists: { requirements: [] }, today: '', renewDays: 60,
             open: '', back: null, tab: 'overview', year: '', built: false, wasSplit: null, editing: false, stale: false, key: '',
             f: { q: '', seg: 'all' } };
const CH_TABS = [['overview', 'Overview'], ['contacts', 'Contacts'], ['billing', 'Billing & collection'], ['accred', 'Accreditation']];

function _chE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function _chId(id) { return document.getElementById(id); }
function _chFail(e) { return { success: false, message: String(e && e.message || e) }; }
function _chToast(text, tone) { if (typeof window.hxToast === 'function') window.hxToast(text, { tone: tone || 'ok' }); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireClientHubAccess === 'function' ? requireClientHubAccess() : null;   // management, admin, the director, HR
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('client-hub');
  if (typeof hxDatePill === 'function') hxDatePill('long');
  CH.me = String(s.name || s.username || '').trim();
  CH.role = String(s.role || '').toLowerCase();
  CH.key = 'hx_ch1:' + (s.username || s.name);
  _chId('chExport').addEventListener('click', chExport);
  _chId('chChips').addEventListener('click', (e) => { const b = e.target.closest('[data-seg]'); if (b) { CH.f.seg = b.getAttribute('data-seg'); chRender(); } });
  _chId('chTable').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) chDetail(b.getAttribute('data-open'), b); });
  _chId('chTable').addEventListener('keydown', chListKeys);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', chOnResize);
  const c = chFromCache();
  if (c) { chTake(c); CH.stale = true; chAfterLoad(); }
  await chLoad();
});

/* ── load: one read, drawn at once from this browser's last copy (today's only) ─────────────────── */

function chFromCache() {
  try { const c = JSON.parse(localStorage.getItem(CH.key) || 'null'); return c && c.success && Array.isArray(c.cards) && c.today === (typeof flowToday === 'function' ? flowToday() : '') ? c : null; } catch (e) { return null; }
}
function chToCache(r) { try { localStorage.setItem(CH.key, JSON.stringify(r)); } catch (e) { /* storage full or blocked: fine */ } }
function chSkeleton() {
  return '<div class="ch-skel" aria-hidden="true">' + Array.from({ length: 7 }, () => '<span class="ch-skrow"><span></span><span></span></span>').join('') + '</div>' +
    '<p class="ch-sr" role="status">Reading the clients…</p>';
}
function chTake(r) {
  CH.ok = !!(r && r.success);
  CH.okMsg = CH.ok ? '' : (r && r.message) || '';
  if (!CH.ok) return;
  CH.cards = r.cards || [];
  CH.lists = r.lists || CH.lists;
  CH.may = r.may || CH.may;
  CH.today = r.today || CH.today;
  CH.renewDays = r.renewDays || CH.renewDays;
}
async function chLoad() {
  if (!CH.cards.length) _chId('chTable').innerHTML = chSkeleton();
  CH.today = CH.today || (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10));
  const r = await postFlow('getClientHub', {}).catch(_chFail);
  if (!(r && r.success) && CH.cards.length) { CH.stale = false; chRender(); return; }   // a failed refresh keeps what is on screen
  const first = !CH.cards.length;
  chTake(r);
  CH.stale = false;
  if (CH.ok) chToCache(r);
  if (first) chAfterLoad(); else { chRender(); if (CH.open && CH.cards.some(c => c.key === CH.open)) chDetail(CH.open, CH.back); }
}
function chAfterLoad() {
  chRender();
  let ask = '';
  try { ask = new URLSearchParams(location.search || '').get('client') || ''; } catch (e) { ask = ''; }
  const hit = ask ? CH.cards.find(c => c.key === ask || c.company.toLowerCase() === ask.toLowerCase()) : null;
  if (hit) chDetail(hit.key, null);
  else if (chSplit()) { const f = chFilter(CH.cards, CH.f)[0]; if (f) chDetail(f.key, null); else chPaneEmpty(); }
  CH.wasSplit = chSplit();
  chFit();
}
async function chReload() { await chLoad(); }

/* ── the split view (as Collection details) ──────────────────────────────────────────────────── */

const CH_SPLIT_MQ = '(min-width: 1180px)';
function chSplit() { try { return !!_chId('chPane') && !!(window.matchMedia && window.matchMedia(CH_SPLIT_MQ).matches); } catch (e) { return false; } }
function chFit() {
  const sp = _chId('chSplit');
  if (!sp || !sp.getBoundingClientRect || !sp.style || !sp.style.setProperty) return;
  if (!chSplit()) { sp.style.removeProperty('--ch-h'); return; }
  const top = sp.getBoundingClientRect().top + (window.scrollY || 0);
  sp.style.setProperty('--ch-h', Math.max(440, Math.round(window.innerHeight - top - 20)) + 'px');
}
function chOnResize() {
  const now = chSplit();
  if (now !== CH.wasSplit) { CH.wasSplit = now; if (now && CH.open) chDetail(CH.open, CH.back); else if (now) chPaneEmpty(); else CH.open = ''; }
  chFit();
  chPlaceThumb(document.querySelector('.ch-tabs'), true);
}
function chPaneEmpty() {
  const pane = _chId('chPane');
  if (pane) pane.innerHTML = '<div class="ch-pane-empty"><p>' + (CH.cards.length ? 'Choose a client to see its details and accreditation.' : 'Your clients will show here.') + '</p></div>';
}
function chListKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = Array.prototype.slice.call(_chId('chTable').querySelectorAll('.ch-open')), i = all.indexOf(document.activeElement);
  const next = all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  e.preventDefault(); next.focus();
  if (chSplit()) chDetail(next.getAttribute('data-open'), next);
}
function chMarkOpen() {
  const t = _chId('chTable');
  if (!t || !t.querySelectorAll) return;
  t.querySelectorAll('.ch-open').forEach(b => {
    const on = b.getAttribute('data-open') === CH.open;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    if (on && chSplit() && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
  });
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function chRender() {
  const old = /Unknown action|not a secured action/i.test(CH.okMsg), notes = [];
  if (!CH.ok) notes.push('<div class="ch-notice' + (old ? '' : ' bad') + '">' + (old
    ? 'The client hub opens once the FlowAPI update (version 199) is pasted.'
    : 'Could not read the clients: ' + _chE(CH.okMsg)) + '</div>');
  _chId('chNotice').innerHTML = notes.join('');
  const sum = chSummary(CH.cards), f = CH.f;
  _chId('chProgress').innerHTML = CH.cards.length ? '<span class="n">' + sum.accredited + '</span> accredited, <span class="n">' + sum.renew + '</span> to renew soon and <span class="n">' +
    sum.expired + '</span> expired, of <span class="n">' + sum.all + '</span> clients' + (CH.stale ? ' <span class="ch-sync">Updating…</span>' : '') : '';
  _chId('chChips').innerHTML = CH_SEGS.filter(s => s[0] === 'all' || sum[s[0]] || f.seg === s[0]).map(s => '<button type="button" class="ch-chip' + (f.seg === s[0] ? ' on' : '') +
    '" data-seg="' + s[0] + '" aria-pressed="' + (f.seg === s[0]) + '">' + _chE(s[1]) + ' <span class="n">' + sum[s[0]] + '</span></button>').join('');
  if (!CH.built) {
    CH.built = true;
    _chId('chFilters').innerHTML = '<label class="ch-search"><span class="ch-sr">Search</span><input type="search" id="chQ" placeholder="Search clients, people, phone numbers or TIN" autocomplete="off"></label>';
    const q = _chId('chQ');
    if (q) q.addEventListener('input', (e) => { f.q = e.target.value; chRenderTable(); });
  }
  chRenderTable();
  chFit();
}
function chRenderTable() {
  const rows = chFilter(CH.cards, CH.f), t = _chId('chTable');
  if (!CH.cards.length) { t.innerHTML = CH.ok ? '<p class="ch-empty">No clients yet. They come from the Client master and the reps\' Client Books.</p>' : ''; _chId('chFoot').textContent = ''; return; }
  t.innerHTML = rows.length ? rows.map(chRow).join('') : '<p class="ch-empty">No client matches.</p>';
  const of = CH.cards.filter(c => chInSeg(c, CH.f.seg)).length;
  _chId('chFoot').textContent = rows.length === of ? of + (of === 1 ? ' client' : ' clients') : rows.length + ' of ' + of + ' clients';
}
function chTag(text, tone) { return '<span class="ch-badge ' + (tone || '') + '">' + _chE(text) + '</span>'; }
/** One client in the list: its name; the sector and its reps; its accreditation. */
function chRow(c) {
  const a = c.accred || {}, meta = [c.sector, (c.owners || []).map(o => o.split(' ')[0]).join(', '), c.stage].filter(Boolean).join(' · ');
  return '<div class="ch-item" role="listitem"><button type="button" class="ch-open' + (CH.open === c.key ? ' on" aria-current="true' : '') + '" data-open="' + _chE(c.key) + '">' +
    '<span class="ch-r1"><span class="ch-name">' + _chE(c.company) + '</span></span>' +
    '<span class="ch-r2">' + (meta ? _chE(meta) : '<span class="ch-dim">No rep has this client</span>') + '</span>' +
    '<span class="ch-r3">' + chTag(chBadge(a), chTone(a.state)) + (a.mismatch ? chTag('Reps differ', 'warn') : '') + '</span></button></div>';
}
function chExport() {
  const blob = new Blob([chCsv(chFilter(CH.cards, CH.f))], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'client-hub-' + CH.today + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── the sheet (a bottom sheet on phones, from apple.css / apple.js) ──────────────────────────── */

function chOverlay() {
  let ov = _chId('chOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay ch-overlay';
  ov.id = 'chOverlay';
  ov.innerHTML = '<div class="flow-modal ch-modal" role="dialog" aria-modal="true" aria-labelledby="chTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) { chClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) chClose();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) chClose(); });
  return ov;
}
function chShow(html, back) {
  CH.back = back || CH.back;
  if (chSplit()) {
    const ov = _chId('chOverlay');
    if (ov && ov.classList.contains('open')) { ov.classList.remove('open'); document.body.classList.remove('ch-open-dlg'); }
    const pane = _chId('chPane'), was = pane.querySelector('.ch-sheet'), same = !!was && was.getAttribute('data-key') === CH.open, top = pane.scrollTop;
    pane.innerHTML = '<div class="ch-sheet' + (same ? '' : ' ch-enter') + '" data-key="' + _chE(CH.open) + '">' + html + '</div>';
    pane.scrollTop = same ? top : 0;
    return pane.firstChild;
  }
  const ov = chOverlay(), box = ov.querySelector('.ch-modal');
  box.innerHTML = '<div class="ch-sheet">' + html + '</div>';
  ov.classList.add('open');
  document.body.classList.add('ch-open-dlg');
  return box.firstChild;
}
function chClose() {
  const ov = _chId('chOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('ch-open-dlg');
  if (!chSplit()) CH.open = '';
  if (CH.back && CH.back.focus) CH.back.focus();
}

/* ── one client ─────────────────────────────────────────────────────────────────────────────────── */

function chFact(k, v) { return v ? '<div class="ch-fact"><dt class="ch-fk">' + _chE(k) + '</dt><dd class="ch-fv">' + v + '</dd></div>' : ''; }
function chGroup(title, facts, empty) { return '<section class="ch-group"><h4 class="ch-gh">' + _chE(title) + '</h4>' + (facts ? '<dl class="ch-facts">' + facts + '</dl>' : '<p class="ch-none">' + _chE(empty) + '</p>') + '</section>'; }
function chOverviewHtml(c) {
  const others = (c.names || []).filter(n => n.toLowerCase() !== c.company.toLowerCase());
  const who = chFact('Reps', _chE((c.owners || []).join(', '))) + chFact('Sector', _chE(c.sector)) + chFact('Tier', _chE(c.tier)) + chFact('Stage', _chE(c.stage)) +
    chFact('Also written', others.map(_chE).join('<br>'));
  const where = (c.addresses || []).map(a => chFact(a.kind, '<span class="ch-pre">' + _chE(a.text) + '</span>')).join('');
  const notes = (c.notes || []).map(n => '<p class="ch-note"><span class="ch-fsub">' + _chE(n.source) + '</span>' + _chE(n.text) + '</p>').join('');
  return chGroup('The client', who, 'No rep has this client in their Client Book yet.') + chGroup('Addresses', where, 'No address yet.') +
    (notes ? '<section class="ch-group"><h4 class="ch-gh">Notes</h4><div class="ch-facts">' + notes + '</div></section>' : '');
}
function chPeopleHtml(c) {
  const people = c.people || [];
  if (!people.length) return '<p class="ch-none">No contacts yet. They come from the Client master, the reps\' Client Books' + (CH.may.collection ? ' and Collection details' : '') + '.</p>';
  return '<ul class="ch-peeps">' + people.map(p => '<li><span class="ch-pname">' + _chE(p.name || (p.emails || [])[0] || 'Contact') + (p.primary ? ' ' + chTag('Main contact', 'ok') : '') + '</span>' +
    (p.position ? '<span class="ch-ppos">' + _chE(p.position) + '</span>' : '') +
    ((p.phones || []).length ? '<span class="ch-phones">' + p.phones.map(t => '<a class="ch-tel" href="tel:' + _chE(String(t).replace(/[^\d+]/g, '')) + '">' + _chE(t) + '</a>').join('') + '</span>' : '') +
    ((p.emails || []).length ? '<span class="ch-mails">' + p.emails.map(m => '<a href="mailto:' + _chE(m) + '">' + _chE(m) + '</a>').join('') + '</span>' : '') +
    '<span class="ch-src">' + _chE((p.sources || []).join(' · ')) + '</span></li>').join('') + '</ul>';
}
function chBillingHtml(c) {
  const b = c.billing || {}, coll = c.collection;
  const bill = chFact('Payment terms', _chE(b.terms)) + chFact('VAT', _chE(b.vatType)) + chFact('Zero-rating ref', _chE(b.zeroRatingRef)) +
    chFact('EWT', b.ewtRate !== '' && b.ewtRate != null ? _chE(b.ewtRate) + '%' : '') + chFact('TIN', _chE(b.tin));
  // the Client master opens for admin (who edits it) and management (who reads it); the director and HR keep reading here
  const editLink = CH.role === 'admin' ? '<p class="ch-sub ch-who"><a href="flow-clients.html">Edit in the Client master</a></p>'
    : CH.role === 'management' ? '<p class="ch-sub ch-who"><a href="flow-clients.html">Open the Client master</a></p>' : '';
  let html = chGroup('Billing', bill, 'The Client master has no billing details for this client yet.') + editLink;
  if (CH.may.collection) {
    const cf = coll ? chFact('Pays by', _chE(coll.paysBy)) + chFact('Their bank', _chE([coll.theirBank, coll.bankNote].filter(Boolean).join(' · '))) + chFact('Pays into', _chE(coll.paysInto)) +
      chFact('Collect at', '<span class="ch-pre">' + _chE(coll.address) + '</span>') + chFact('When', _chE(coll.whenToCollect)) + chFact('Notes', _chE(coll.notes)) : '';
    html += chGroup('Collection', cf, 'No collection details yet.') +
      (CH.role === 'admin' || CH.role === 'director' ? '<p class="ch-sub ch-who"><a href="collection-details.html?client=' + encodeURIComponent(c.company) + '">' +
        (CH.role === 'admin' ? (coll ? 'Edit' : 'Add') + ' in Collection details' : 'Open in Collection details') + '</a></p>' : '');   // accounting and admin keep them
  }
  return html;
}
function chLabelsHtml(a) {
  if (!(a.labels || []).length) return '<p class="ch-none">No rep has labelled this client. The reps label accreditation in their Client Book.</p>';
  return '<ul class="ch-labels">' + a.labels.map(l => '<li><span class="ch-lwho">' + _chE(l.owner) + '</span>' + chTag(l.value, chTone(l.value === 'Accredited' ? 'Accredited' : l.value)) +
    '<span class="ch-sub">' + _chE([l.step, l.until ? 'until ' + chDay(l.until) : '', l.updatedAt ? 'labelled ' + chDay(l.updatedAt) : ''].filter(Boolean).join(' · ')) + '</span>' +
    (l.note ? '<span class="ch-sub">' + _chE(l.note) + '</span>' : '') + '</li>').join('') + '</ul>' +
    (a.mismatch ? '<p class="ch-warn">The reps\' labels differ. The latest one is shown above; ask them to agree in their Client Books.</p>' : '');
}
function chDatesForm(c) {
  const a = c.accred || {};
  return '<form class="ch-form" id="chDates" autocomplete="off" novalidate hidden>' +
    '<div class="ch-grid3"><label>Accredited since<input type="date" class="ch-in" name="since" value="' + _chE(a.since) + '"></label>' +
    '<label>Expires<input type="date" class="ch-in" name="expires" value="' + _chE(a.expires) + '"><span class="ch-hint">Leave empty for a year after the start.</span></label>' +
    '<label>Accreditation year<input type="number" class="ch-in" name="year" min="2020" max="2030" value="' + _chE(a.year) + '"></label></div>' +
    '<label>Note<input type="text" class="ch-in" name="note" maxlength="300" value="' + _chE(a.note) + '" placeholder="Who to send the renewal to, what they asked for"></label>' +
    '<div class="ch-formfoot"><button type="button" class="btn btn-secondary" data-cancel>Cancel</button><span class="ch-msg" role="status" aria-live="polite"></span>' +
    '<button type="submit" class="btn btn-primary primary">Save</button></div></form>';
}
function chChecklistHtml(c) {
  const a = c.accred || {}, years = chYears(c, CH.today), year = years.indexOf(CH.year) >= 0 ? CH.year : String(a.year || years[0]);
  CH.year = year;
  const list = chChecklist(c, CH.lists.requirements || [], year), edit = CH.may.edit;
  const yearPills = '<div class="ch-years" role="group" aria-label="Accreditation year">' + years.map(y => '<button type="button" class="ch-year' + (y === year ? ' on' : '') + '" data-year="' + y + '" aria-pressed="' + (y === year) + '">' + y + '</button>').join('') + '</div>';
  const chip = (f) => '<span class="ch-file"><button type="button" class="ch-fopen" data-file="' + _chE(f.fileNo) + '" title="' + _chE(f.note || f.fileName) + '">' + _chE(f.fileName) +
    ' <span class="ch-dim">' + _chE((CH_TYPES[f.fileType] || 'File') + ' · ' + chSize(f.fileSize)) + '</span></button>' +
    (edit ? '<button type="button" class="ch-fx" data-archive="' + _chE(f.fileNo) + '" aria-label="Take ' + _chE(f.fileName) + ' off the checklist">×</button>' : '') + '</span>';
  const rows = list.map((r, i) => '<li class="ch-req' + (r.done ? ' done' : r.optional ? ' opt' : ' missing') + '" data-req="' + _chE(r.requirement) + '">' +
    '<span class="ch-mark" aria-hidden="true">' + (r.done ? '<svg viewBox="0 0 16 16"><path d="M4 8.5l2.6 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</span>' +
    '<div class="ch-rmain"><span class="ch-rname">' + _chE(r.requirement) + '</span>' +
      '<span class="ch-rstate">' + (r.done ? r.files.length + (r.files.length === 1 ? ' file' : ' files') : r.optional ? 'Optional' : 'Missing for ' + year) + '</span>' +
      (r.files.length ? '<span class="ch-files">' + r.files.map(chip).join('') + '</span>' : '') +
      (r.last.length ? '<span class="ch-last">' + (+year - 1) + ': ' + r.last.map(f => '<button type="button" class="ch-fopen" data-file="' + _chE(f.fileNo) + '">' + _chE(f.fileName) + '</button>' +
        (edit ? '<button type="button" class="ch-link" data-reuse="' + _chE(f.fileNo) + '">Use for ' + year + '</button>' : '')).join(' ') + '</span>' : '') +
      '<span class="ch-rmsg" role="status" aria-live="polite"></span></div>' +
    (edit ? '<label class="ch-up"><input type="file" class="ch-sr" data-upload accept="' + Object.keys(CH_TYPES).join(',') + '">' + (r.files.length ? 'Add' : 'Upload') + '</label>' : '') + '</li>').join('');
  return '<section class="ch-group"><div class="ch-checkhead"><h4 class="ch-gh">Requirement files</h4>' + yearPills + '</div><ul class="ch-reqs">' + rows + '</ul>' +
    (edit ? '<p class="ch-sub">PDF, pictures, Word, Excel or PowerPoint, up to ' + CH_MAX_MB + ' MB each. Files stay private: only the client hub opens them.</p>' : '') + '</section>';
}
function chAccredHtml(c) {
  const a = c.accred || {}, edit = CH.may.edit;
  const head = '<div class="ch-status ' + chTone(a.state) + '"><p class="ch-sline">' + _chE(chStatusLine(a)) + '</p>' +
    (a.updatedAt ? '<p class="ch-sub">Dates kept by ' + _chE(a.updatedBy) + ', ' + chDay(a.updatedAt) + (a.note ? ' · ' + _chE(a.note) : '') + '</p>' : '') + '</div>';
  const dates = chFact('Accredited since', a.since ? _chE(chDay(a.since)) : '<span class="ch-dim">Not set</span>') +
    chFact('Expires', a.expires ? _chE(chDay(a.expires)) + (a.daysLeft != null ? ' <span class="ch-dim">' + (a.daysLeft >= 0 ? a.daysLeft + ' days left' : -a.daysLeft + ' days ago') + '</span>' : '') : '<span class="ch-dim">Not set</span>') +
    chFact('Year', _chE(a.year));
  const bar = edit ? '<div class="ch-panelbar"><button type="button" class="btn btn-secondary" data-dates aria-expanded="false" aria-controls="chDates">Edit dates</button>' +
    (a.expires ? '<button type="button" class="btn btn-secondary" data-reapply>Re-apply for ' + (+(a.year || CH.today.slice(0, 4)) + 1) + '</button>' : '') + '</div>' : '';
  const lead = (a.lead || []).length ? chGroup('Lead gen\'s tracker', a.lead.map(l => chFact(l.status, _chE([l.approved ? 'approved ' + chDay(l.approved) : '', l.expiry ? 'expires ' + chDay(l.expiry) : ''].filter(Boolean).join(' · ')))).join(''), '') : '';
  return head + '<section class="ch-group"><h4 class="ch-gh">The reps\' labels</h4>' + chLabelsHtml(a) + '</section>' +
    '<section class="ch-group"><h4 class="ch-gh">Dates</h4><div id="chDateFacts"><dl class="ch-facts">' + dates + '</dl>' + bar + '</div>' + (edit ? chDatesForm(c) : '') + '</section>' +
    lead + chChecklistHtml(c);
}
function chTabsHtml() {
  return '<div class="ch-tabs" role="tablist" aria-label="About this client"><span class="ch-thumb now" aria-hidden="true"></span>' + CH_TABS.map(t =>
    '<button type="button" role="tab" class="ch-tab" id="chTab-' + t[0] + '" data-tab="' + t[0] + '" aria-selected="' + (CH.tab === t[0]) + '" aria-controls="chPanel-' + t[0] + '" tabindex="' +
    (CH.tab === t[0] ? 0 : -1) + '">' + _chE(t[1]) + '</button>').join('') + '</div>';
}
/** The indicator under the chosen tab. `instant` skips the slide (a fresh client, a resize). */
function chPlaceThumb(tabs, instant) {
  const th = tabs && tabs.querySelector('.ch-thumb'), on = tabs && tabs.querySelector('[aria-selected="true"]');
  if (!th || !on || typeof on.offsetLeft !== 'number') return;
  if (instant) th.classList.add('now');
  th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  if (instant) { void th.offsetWidth; th.classList.remove('now'); }
  if (on.scrollIntoView && tabs.scrollWidth > tabs.clientWidth) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });   // a phone: the chosen tab stays in sight
}
function chDetail(key, back) {
  const c = CH.cards.find(x => x.key === key);
  if (!c) return;
  if (CH.open !== key) { CH.editing = false; CH.year = ''; }
  CH.open = key;
  const a = c.accred || {}, owners = (c.owners || []).join(', ');
  const head = '<header class="ch-dhead"><div class="ch-dtop"><div class="ch-dtitle"><h3 id="chTitle">' + _chE(c.company) + '</h3>' +
    '<p class="ch-sub">' + chTag(a.state, chTone(a.state)) + (c.sector ? chTag(c.sector, '') : '') + (owners ? '<span>' + _chE(owners) + '</span>' : '') + '</p></div>' +
    '<button type="button" class="btn btn-secondary ch-close" data-close>Close</button></div>' + chTabsHtml() + '</header>';
  const panel = (k, html) => '<div class="ch-panel" role="tabpanel" id="chPanel-' + k + '" aria-labelledby="chTab-' + k + '"' + (CH.tab === k ? '' : ' hidden') + '>' + html + '</div>';
  const box = chShow(head + '<div class="ch-body">' + panel('overview', chOverviewHtml(c)) + panel('contacts', chPeopleHtml(c)) + panel('billing', chBillingHtml(c)) +
    panel('accred', chAccredHtml(c)) + '</div>', back);
  chMarkOpen();
  chPlaceThumb(box.querySelector('.ch-tabs'), true);
  chWire(box, c);
}
function chSetTab(box, k, focus) {
  CH.tab = k;
  box.querySelectorAll('.ch-tab').forEach(b => { const on = b.getAttribute('data-tab') === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus && b.focus) b.focus(); });
  box.querySelectorAll('.ch-panel').forEach(p => { p.hidden = p.id !== 'chPanel-' + k; });
  chPlaceThumb(box.querySelector('.ch-tabs'), false);
}

/* ── wiring: tabs, dates, files ─────────────────────────────────────────────────────────────────── */

function chWire(box, c) {
  const tabs = box.querySelector('.ch-tabs');
  if (tabs) tabs.addEventListener('keydown', (e) => {
    const i = CH_TABS.findIndex(t => t[0] === CH.tab), n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? CH_TABS.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    chSetTab(box, CH_TABS[(n + CH_TABS.length) % CH_TABS.length][0], true);
  });
  const form = box.querySelector('#chDates'), facts = box.querySelector('#chDateFacts');
  const openDates = (show, preset) => {
    if (!form) return;
    CH.editing = show; form.hidden = !show; if (facts) facts.hidden = show;
    box.querySelectorAll('[data-dates]').forEach(b => b.setAttribute('aria-expanded', String(show)));
    if (show && preset) Object.keys(preset).forEach(k => { if (form.elements[k]) form.elements[k].value = preset[k]; });
    if (show && form.elements.since && form.elements.since.focus) form.elements.since.focus();
  };
  if (form) {
    if (CH.editing) openDates(true);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); chSaveDates(form, c); });
    form.addEventListener('input', () => chCheckDates(form));
  }
  box.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-tab')) chSetTab(box, t.getAttribute('data-tab'), false);
    else if (t.hasAttribute('data-dates')) openDates(true);
    else if (t.hasAttribute('data-reapply')) {
      const a = c.accred || {}, start = a.expires && a.expires > CH.today ? a.expires : CH.today;
      openDates(true, { since: start, expires: '', year: String(+(a.year || CH.today.slice(0, 4)) + 1), note: '' });
    } else if (t.hasAttribute('data-cancel')) openDates(false);
    else if (t.hasAttribute('data-year')) { CH.year = t.getAttribute('data-year'); chDetail(c.key, CH.back); }
    else if (t.hasAttribute('data-file')) chOpenFile(t.getAttribute('data-file'));
    else if (t.hasAttribute('data-archive')) chArchive(t.getAttribute('data-archive'), false);
    else if (t.hasAttribute('data-reuse')) chReuse(t, c);
  });
  box.addEventListener('change', (e) => { const inp = e.target; if (inp && inp.hasAttribute && inp.hasAttribute('data-upload')) chUpload(inp, c); });
}
/** Said as it is typed: an expiry before the start. */
function chCheckDates(form) {
  const s = form.elements.since.value, x = form.elements.expires.value, m = form.querySelector('.ch-msg');
  const bad = s && x && x < s ? 'The expiry is before the start.' : '';
  if (m) { m.textContent = bad; m.className = 'ch-msg' + (bad ? ' bad' : ''); }
  return !bad;
}
async function chSaveDates(form, c) {
  if (!chCheckDates(form)) return;
  const el = form.elements, btn = form.querySelector('[type="submit"]'), m = form.querySelector('.ch-msg'), a = c.accred || {};
  btn.disabled = true; m.textContent = 'Saving…'; m.className = 'ch-msg';
  const p = { company: c.company, since: el.since.value, expires: el.expires.value, year: el.year.value, note: el.note.value.trim(),
              ifUpdatedAt: a.updatedAt || '', clientRef: typeof flowClientRef === 'function' ? flowClientRef() : String(Date.now()) };
  if (!a.updatedAt) delete p.ifUpdatedAt;
  const r = await postFlow('saveClientAccred', p).catch(_chFail);
  btn.disabled = false;
  if (!(r && r.success)) { m.textContent = (r && r.message) || 'Not saved.'; m.className = 'ch-msg bad'; return; }
  CH.editing = false;
  if (r.year) CH.year = String(r.year);   // re-applying moves the checklist to the new year
  _chToast(r.unchanged ? 'Nothing changed.' : 'Saved ' + c.company + '\'s accreditation dates.', 'ok');
  await chReload();
}
function _chRowMsg(inp, text, bad) {
  const li = inp.closest('.ch-req'), m = li && li.querySelector('.ch-rmsg');
  if (m) { m.textContent = text; m.className = 'ch-rmsg' + (bad ? ' bad' : ''); }
  if (li) li.classList.toggle('busy', !!text && !bad);
}
async function chUpload(inp, c) {
  const file = inp.files && inp.files[0], li = inp.closest('.ch-req'), req = li && li.getAttribute('data-req');
  const bad = chFileCheck(file);
  if (bad) { _chRowMsg(inp, bad, true); inp.value = ''; return; }
  _chRowMsg(inp, 'Uploading ' + file.name + '…');
  try {
    const isImg = /^image\/(jpeg|png|webp)$/.test(file.type) && typeof flowDownscaleImage === 'function';
    const url = isImg ? await flowDownscaleImage(file, 1600, 0.82) : await fileToDataURL(file);
    const r = await postFlow('saveClientAccredFile', { company: c.company, year: CH.year, requirement: req, fileBase64: String(url).replace(/^data:[^,]*,/, ''),
      fileName: file.name, mimeType: isImg ? 'image/jpeg' : file.type, clientRef: typeof flowClientRef === 'function' ? flowClientRef() : String(Date.now()) });
    if (!(r && r.success)) throw new Error((r && r.message) || 'Not added.');
    _chToast(r.message || 'Added.', 'ok');
    await chReload();
  } catch (e) { _chRowMsg(inp, String(e.message || e), true); }
  inp.value = '';
}
async function chReuse(btn, c) {
  const li = btn.closest('.ch-req'), req = li && li.getAttribute('data-req');
  btn.disabled = true;
  const r = await postFlow('saveClientAccredFile', { company: c.company, year: CH.year, requirement: req, reuseFileNo: btn.getAttribute('data-reuse'),
    clientRef: typeof flowClientRef === 'function' ? flowClientRef() : String(Date.now()) }).catch(_chFail);
  btn.disabled = false;
  if (!(r && r.success)) { _chToast((r && r.message) || 'Not added.', 'bad'); return; }
  _chToast(r.message || 'Listed.', 'ok');
  await chReload();
}
async function chArchive(no, restore) {
  const r = await postFlow('archiveClientAccredFile', { fileNo: no, restore: restore }).catch(_chFail);
  if (!(r && r.success)) { _chToast((r && r.message) || 'Not changed.', 'bad'); return; }
  if (!restore && typeof hxSnackbar === 'function') hxSnackbar('Taken off the checklist.', { action: 'Undo', onAction: () => chArchive(no, true) });
  else _chToast(r.message || 'Done.', 'ok');
  await chReload();
}
/** Open a file: the window opens on the press (so it is not blocked), then the file arrives in it. */
async function chOpenFile(no) {
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  const r = await postFlow('getClientHubFile', { fileNo: no }).catch(_chFail);
  if (!(r && r.success) || r.missing) { if (w) w.close(); _chToast((r && r.message) || 'The file could not be opened.', 'bad'); return; }
  const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
  if (w && /^(image\/|application\/pdf|text\/)/.test(r.mimeType)) { w.location.href = url; return; }
  if (w) w.close();
  const a = document.createElement('a');
  a.href = url; a.download = r.fileName || 'file';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
