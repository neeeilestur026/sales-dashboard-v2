/* supplier-list.js — A374 · the supplier list (supplier-list.html), for admin and the director.
 *
 * Neil, 26 Oct 2026: "a suppliers list for admin dashboard" — each supplier with several contact people, phones and
 * emails, its address, local or international, the distributorship we hold for them, how it usually delivers, the
 * payment terms and the items we usually order — "then this product will go to under this supplier with the priced and
 * last updated price date". The prices arrive by themselves: every request line admin forwards to management is filed
 * under its supplier (FlowAPI 189, submitForPricing); this page shows each item's last price, when, and its history.
 *
 * Laid out like the Client Book (and Contacts on a Mac): the list on the left, the supplier on the right, each
 * scrolling on its own; on a tablet or phone the supplier opens as a sheet. Four tabs — Overview, Contacts, Items
 * priced, History. Built to the apple-design skill: feedback on press, forms that say what is wrong as you type,
 * Restore instead of a confirm for Archive, and a preview before the one step that cannot be undone (Merge).
 * The numbers are js/supplier-list-model.js (pure, tested). */

const SL = { me: '', ok: true, okMsg: '', suppliers: [], prices: [], log: [], lists: null, today: '', open: '', back: null, built: false,
             tab: 'overview', wasSplit: null, flash: '',
             f: { q: '', type: '', distributor: false, delivery: '', needs: false, archived: false, sort: 'name' } };

function _slE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _slId(id) { return document.getElementById(id); }
function _slLists() { return SL.lists || { types: SL_TYPES, delivery: SL_DELIVERY, terms: SL_TERMS }; }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireSupplierListAccess === 'function' ? requireSupplierListAccess() : null;   // admin and the director
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('supplier-list');
  if (typeof hxDatePill === 'function') hxDatePill('long');
  SL.me = String(s.name || s.username || '').trim();
  _slId('slAdd').addEventListener('click', (e) => slAddDialog(e.currentTarget));
  _slId('slExport').addEventListener('click', slExport);
  _slId('slChips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) slChip(b.getAttribute('data-chip')); });
  _slId('slTable').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) slDetail(b.getAttribute('data-open'), b); });
  _slId('slTable').addEventListener('keydown', slListKeys);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', slOnResize);
  await slLoad();
});

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

/** While it reads: rows shaped like the list, not a spinner. */
function slSkeleton() {
  return '<div class="sl-skel" aria-hidden="true">' + Array.from({ length: 6 }, () => '<span class="sl-skrow"><span></span><span></span></span>').join('') + '</div>' +
    '<p class="sl-sr" role="status">Reading the supplier list…</p>';
}
async function slLoad() {
  _slId('slTable').innerHTML = slSkeleton();
  SL.today = typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10);
  /* The list itself is the test, not getVersion: a version read can be a minute stale in this browser, or dropped by
     Google right after a deployment, and then said "189 is not pasted" on a server that has it. Only the server saying
     it has no such action means the update is missing. */
  slTake(await postFlow('getSupplierBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) })));
  slRender();
  const ask = new URLSearchParams(location.search || '').get('supplier');   // the sourcing table links here
  if (ask && SL.suppliers.some(x => x.supplierNo === ask)) slDetail(ask, null);
  else if (slSplit()) { const first = slFilter(SL.suppliers, SL.prices, SL.f)[0]; if (first) slDetail(first.supplierNo, null); else slPaneEmpty(); }
  SL.wasSplit = slSplit();
  slFit();
}
function slTake(book) {
  SL.ok = !!(book && book.success);
  SL.okMsg = SL.ok ? '' : (book && book.message) || '';
  SL.suppliers = SL.ok ? book.suppliers || [] : [];
  SL.prices = SL.ok ? book.prices || [] : [];
  SL.log = SL.ok ? book.log || [] : [];
  if (SL.ok && book.lists) SL.lists = book.lists;
}
async function slReload() {
  slTake(await postFlow('getSupplierBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) })));
  slRender();
  if (SL.open && SL.suppliers.some(x => x.supplierNo === SL.open)) slDetail(SL.open, SL.back);
}

/* ── the split view (as the Client Book) ─────────────────────────────────────────────────────── */

const SL_SPLIT_MQ = '(min-width: 1180px)';
/** Wide enough to show the supplier beside the list (otherwise it opens as a sheet). */
function slSplit() {
  try { return !!_slId('slPane') && !!(window.matchMedia && window.matchMedia(SL_SPLIT_MQ).matches); } catch (e) { return false; }
}
/** The list and the supplier fill the rest of the window, so the page never grows past the screen. */
function slFit() {
  const sp = _slId('slSplit');
  if (!sp || !sp.getBoundingClientRect || !sp.style || !sp.style.setProperty) return;
  if (!slSplit()) { sp.style.removeProperty('--sl-h'); return; }
  const top = sp.getBoundingClientRect().top + (window.scrollY || 0);
  sp.style.setProperty('--sl-h', Math.max(440, Math.round(window.innerHeight - top - 20)) + 'px');
}
function slOnResize() {
  const now = slSplit();
  if (now !== SL.wasSplit) {
    SL.wasSplit = now;
    if (now && SL.open) slDetail(SL.open, SL.back);
    else if (now) slPaneEmpty();
    else SL.open = '';
  }
  slFit();
}
function slPaneEmpty() {
  const pane = _slId('slPane');
  if (pane) pane.innerHTML = '<div class="sl-pane-empty"><p>' + (SL.suppliers.length ? 'Choose a supplier to see its people, terms and the prices it gave.' : 'Your suppliers will show here.') + '</p></div>';
}
/** Up and down move through the list (and open the supplier beside it). */
function slListKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = Array.prototype.slice.call(_slId('slTable').querySelectorAll('.sl-open')), i = all.indexOf(document.activeElement);
  const next = all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (slSplit()) slDetail(next.getAttribute('data-open'), next);
}
function slMarkOpen() {
  const t = _slId('slTable');
  if (!t || !t.querySelectorAll) return;
  t.querySelectorAll('.sl-open').forEach(b => {
    const on = b.getAttribute('data-open') === SL.open;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    if (on && slSplit() && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
  });
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function slRender() {
  const n = _slId('slNotice'), old = /Unknown action|not a secured action/i.test(SL.okMsg);
  n.innerHTML = SL.ok ? '' : '<div class="sl-notice' + (old ? '' : ' bad') + '">' + (old
    ? 'The supplier list opens once the FlowAPI update (version 189) is pasted. Nothing is lost meanwhile: forwarded prices start filing from then.'
    : 'Could not read the supplier list: ' + _slE(SL.okMsg)) + '</div>';
  _slId('slAdd').disabled = !SL.ok;
  const sum = slSummary(SL.suppliers), f = SL.f;
  const chip = (key, label, count) => (!count && key !== 'all' && !slChipOn(key)) ? '' : '<button type="button" class="sl-chip' + (slChipOn(key) ? ' on' : '') + '" data-chip="' + key +
    '" aria-pressed="' + slChipOn(key) + '">' + _slE(label) + ' <span class="n">' + count + '</span></button>';
  _slId('slChips').innerHTML = chip('all', 'All suppliers', sum.total) + chip('t:Local', 'Local', sum.local) + chip('t:International', 'International', sum.international) +
    chip('d', 'We distribute', sum.distributor) + chip('n', 'Needs details', sum.needs) + chip('archived', 'Archived', sum.archived);
  const opt = (v, cur, label) => '<option value="' + _slE(v) + '"' + (v === cur ? ' selected' : '') + '>' + _slE(label || v) + '</option>';
  if (!SL.built) {
    SL.built = true;
    _slId('slFilters').innerHTML =
      '<label class="sl-search"><span class="sl-sr">Search</span><input type="search" id="slQ" placeholder="Search suppliers, people, brands or items" autocomplete="off"></label>' +
      '<label><span class="sl-sr">Delivery</span><select id="slDelivery"></select></label>' +
      '<label><span class="sl-sr">Sort</span><select id="slSort">' + [['name', 'Sort: name'], ['priced', 'Sort: last priced'], ['updated', 'Sort: last update']].map(x => opt(x[0], f.sort, x[1])).join('') + '</select></label>';
    _slId('slQ').addEventListener('input', (e) => { f.q = e.target.value; slRenderTable(); });
    _slId('slDelivery').addEventListener('change', (e) => { f.delivery = e.target.value; slRenderTable(); });
    _slId('slSort').addEventListener('change', (e) => { f.sort = e.target.value; slRenderTable(); });
  }
  _slId('slDelivery').innerHTML = opt('', f.delivery, 'Any delivery') + _slLists().delivery.map(d => opt(d, f.delivery)).join('');
  slRenderTable();
  slFit();
}
function slChipOn(key) {
  const f = SL.f;
  if (key === 'all') return !f.type && !f.distributor && !f.needs && !f.archived;
  if (key === 'archived') return f.archived;
  if (key.indexOf('t:') === 0) return !f.archived && f.type === key.slice(2);
  if (key === 'd') return !f.archived && f.distributor;
  return !f.archived && f.needs;
}
function slChip(key) {
  const f = SL.f;
  f.type = ''; f.distributor = false; f.needs = false; f.archived = false;
  if (key === 'archived') f.archived = true;
  else if (key.indexOf('t:') === 0) f.type = key.slice(2);
  else if (key === 'd') f.distributor = true;
  else if (key === 'n') f.needs = true;
  slRender();
}
function slRenderTable() {
  const rows = slFilter(SL.suppliers, SL.prices, SL.f), t = _slId('slTable');
  if (!SL.suppliers.length) {
    t.innerHTML = SL.ok ? '<div class="sl-empty"><p>No suppliers yet.</p><p class="sl-sub">Add one, or forward a priced purchase request: its suppliers are added here by themselves.</p>' +
      '<button type="button" class="btn btn-primary" data-addfirst>Add supplier</button></div>' : '<p class="sl-empty">Nothing to show yet.</p>';
    const first = t.querySelector && t.querySelector('[data-addfirst]');
    if (first) first.addEventListener('click', (e) => slAddDialog(e.currentTarget));
    _slId('slFoot').textContent = '';
    return;
  }
  t.innerHTML = rows.length ? rows.map(slRow).join('') : '<p class="sl-empty">No supplier matches.</p>';
  const of = SL.suppliers.filter(s => slArchived(s) === SL.f.archived).length;
  _slId('slFoot').textContent = (rows.length === of ? of + (of === 1 ? ' supplier' : ' suppliers') : rows.length + ' of ' + of + ' suppliers') + (SL.f.archived ? ', archived' : '');
}
function slBadge(text, tone) { return '<span class="sl-badge ' + (tone || '') + '">' + _slE(text) + '</span>'; }
/** One supplier in the list: its name and when it last priced; local or international, the main contact and the town;
 *  then whether we distribute for it, whether it needs details, and how many items it has priced. */
function slRow(s) {
  const last = slLastPriced(SL.prices, s.supplierNo), main = slPrimary(s), n = slItems(SL.prices, s.supplierNo).length;
  const meta = [s.type ? _slE(s.type) : '<span class="sl-dim">Local or international?</span>', main ? _slE(main.name || (main.emails || [])[0] || (main.phones || [])[0] || '') : '',
                _slE(slPlace(s.address))].filter(Boolean).join(' · ');
  const tags = [s.distributor ? slBadge('We distribute' + ((s.brands || []).length ? ': ' + s.brands.slice(0, 3).join(', ') : ''), 'dist') : '',
                s.needsDetails ? slBadge('Needs details', 'warn') : '', n ? '<span>' + n + ' item' + (n === 1 ? '' : 's') + ' priced</span>' : ''].filter(Boolean).join(' ');
  return '<div class="sl-item" role="listitem"><button type="button" class="sl-open' + (slArchived(s) ? ' archived' : '') + (SL.open === s.supplierNo ? ' on" aria-current="true' : '') +
    '" data-open="' + _slE(s.supplierNo) + '"><span class="sl-r1"><span class="sl-name">' + _slE(s.supplier) + '</span><span class="sl-when">' +
    (slArchived(s) ? 'Archived' : last ? 'Priced ' + _slE(slShortDay(last, SL.today)) : '') + '</span></span><span class="sl-r2">' + meta + '</span>' +
    (tags ? '<span class="sl-r3">' + tags + '</span>' : '') + '</button></div>';
}
function slExport() {
  const blob = new Blob([slCsv(slFilter(SL.suppliers, SL.prices, SL.f), SL.prices)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'supplier-list-' + SL.today + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── the sheet (a bottom sheet on phones, from apple.css / apple.js) ──────────────────────────── */

function slOverlay() {
  let ov = _slId('slOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay sl-overlay';
  ov.id = 'slOverlay';
  ov.innerHTML = '<div class="flow-modal sl-modal" role="dialog" aria-modal="true" aria-labelledby="slTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) { slClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) slClose();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) slClose(); });
  return ov;
}
/** Show a supplier (o.pane: beside the list when there is room) or a form (always a sheet). Each showing is a fresh
 *  element, so the listeners of the last one never pile up on the next. */
function slShow(html, back, o) {
  SL.back = back || SL.back;
  if (o && o.pane && slSplit()) {
    const ov = _slId('slOverlay');
    if (ov && ov.classList.contains('open')) { ov.classList.remove('open'); document.body.classList.remove('sl-open-dlg'); }
    const pane = _slId('slPane'), was = pane.querySelector('.sl-sheet'), same = !!was && was.getAttribute('data-no') === SL.open, top = pane.scrollTop;
    pane.innerHTML = '<div class="sl-sheet sl-detail' + (same ? '' : ' sl-enter') + '" data-no="' + _slE(SL.open) + '">' + html + '</div>';
    pane.scrollTop = same ? top : 0;
    return pane.firstChild;
  }
  const ov = slOverlay(), box = ov.querySelector('.sl-modal');
  box.innerHTML = '<div class="sl-sheet' + (o && o.pane ? ' sl-detail' : '') + '">' + html + '</div>';
  ov.classList.add('open');
  document.body.classList.add('sl-open-dlg');
  return box.firstChild;
}
function slClose() {
  const ov = _slId('slOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('sl-open-dlg');
  if (!slSplit()) SL.open = '';
  if (SL.back && SL.back.focus) SL.back.focus();
}
function slMsg(box, text, bad) { const m = box && box.querySelector('.sl-msg'); if (m) { m.textContent = text; m.className = 'sl-msg' + (bad ? ' bad' : ' ok'); } }

/* ── the form (Add supplier, and Edit on a supplier) ─────────────────────────────────────────── */

function slPersonHtml(p, i) {
  const v = p || {};
  return '<fieldset class="sl-person" data-person><legend>Contact ' + (i + 1) + '</legend>' +
    '<div class="sl-grid2"><label>Name<input type="text" class="sl-in" data-f="name" value="' + _slE(v.name) + '" maxlength="120"></label>' +
    '<label>Position<input type="text" class="sl-in" data-f="position" value="' + _slE(v.position) + '" maxlength="120" placeholder="Sales"></label></div>' +
    '<div class="sl-grid2"><label>Emails (one per line)<textarea class="sl-in" data-f="emails" rows="2" placeholder="name@supplier.ph">' + _slE((v.emails || []).join('\n')) + '</textarea>' +
      '<span class="sl-err" data-bad hidden></span></label>' +
    '<label>Phone numbers (one per line)<textarea class="sl-in" data-f="phones" rows="2" placeholder="0917 123 4567">' + _slE((v.phones || []).join('\n')) + '</textarea></label></div>' +
    '<div class="sl-personfoot"><label class="sl-inline"><input type="radio" name="slPrimary" data-f="primary"' + (v.primary ? ' checked' : '') + '> Main contact</label>' +
    '<input type="hidden" data-f="id" value="' + _slE(v.id || ('P' + Date.now().toString(36) + i)) + '">' +
    '<button type="button" class="sl-mini" data-rmperson>Remove this person</button></div></fieldset>';
}
function slReadPeople(form) {
  return Array.prototype.map.call(form.querySelectorAll('.sl-person'), (fs) => {
    const g = (f) => fs.querySelector('[data-f="' + f + '"]');
    const lines = (t) => String(t.value || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    return { id: g('id').value, name: g('name').value.trim(), position: g('position').value.trim(), emails: lines(g('emails')), phones: lines(g('phones')), primary: g('primary').checked };
  }).filter(p => p.name || p.emails.length || p.phones.length);
}
function slPills(name, list, cur, legend) {
  return '<fieldset class="sl-pills"><legend>' + legend + '</legend>' + list.map(x => '<label class="sl-pill"><input type="radio" name="' + name + '" value="' + _slE(x) + '"' +
    (cur === x ? ' checked' : '') + '><span>' + _slE(x) + '</span></label>').join('') + '</fieldset>';
}
function slPicked(form, name) { const r = Array.prototype.find.call(form.querySelectorAll('input[name="' + name + '"]'), x => x.checked); return r ? r.value : ''; }
/** The whole form, for a new supplier (s = null) or one being edited. */
function slFormHtml(s, id) {
  const v = s || {}, L = _slLists(), people = (v.contacts || []).length ? v.contacts : [{ primary: true }], listed = !v.terms || L.terms.indexOf(v.terms) >= 0;
  return '<form class="sl-form" id="' + id + '" autocomplete="off" novalidate>' +
    '<label>Supplier name<input type="text" class="sl-in" name="supplier" required maxlength="160" value="' + _slE(v.supplier) + '" placeholder="As they name themselves"></label>' +
    '<p class="sl-warn" data-dup hidden></p><p class="sl-err" data-err="supplier" hidden></p>' +
    '<label>Other spellings (one per line)<textarea class="sl-in" name="aliases" rows="2" placeholder="Yale HW">' + _slE((v.aliases || []).join('\n')) + '</textarea>' +
      '<span class="sl-hint">How the name is sometimes typed on a purchase request; those prices are filed here too.</span></label>' +
    slPills('type', L.types, v.type || '', 'Local or international') +
    slPills('dist', ['Yes', 'No'], v.supplierNo ? (v.distributor ? 'Yes' : 'No') : '', 'We distribute for them') +
    '<label class="sl-brands"' + (v.distributor ? '' : ' hidden') + '>Brands we distribute (one per line)<textarea class="sl-in" name="brands" rows="2" placeholder="CEJN">' +
      _slE((v.brands || []).join('\n')) + '</textarea></label>' +
    '<label>Address<textarea class="sl-in" name="address" rows="2" maxlength="300" placeholder="Building, street, city">' + _slE(v.address) + '</textarea></label>' +
    slPills('delivery', L.delivery, v.delivery || '', 'Usual delivery') +
    '<label class="sl-delnote"' + (v.delivery === 'Other' ? '' : ' hidden') + '>How they deliver<input type="text" class="sl-in" name="deliveryNote" maxlength="190" value="' + _slE(v.deliveryNote) +
      '" placeholder="By sea freight to Manila port"></label><p class="sl-err" data-err="deliveryNote" hidden></p>' +
    '<div class="sl-grid2"><label>Payment terms<select class="sl-in" name="terms"><option value="">Not set</option>' + L.terms.map(t => '<option' + (t === v.terms ? ' selected' : '') + '>' + _slE(t) + '</option>').join('') +
      '<option value="__other"' + (listed ? '' : ' selected') + '>Other…</option></select></label>' +
    '<label class="sl-termsother"' + (listed ? ' hidden' : '') + '>Which terms?<input type="text" class="sl-in" name="termsOther" maxlength="80" value="' + _slE(listed ? '' : v.terms) + '" placeholder="45 days after delivery"></label></div>' +
    '<div class="sl-grid2"><label>TIN<input type="text" class="sl-in" name="tin" maxlength="40" value="' + _slE(v.tin) + '" placeholder="000-000-000-000"></label></div>' +
    '<label>Usual items we order (one per line)<textarea class="sl-in" name="usualItems" rows="3" placeholder="Hex bolts">' + _slE((v.usualItems || []).join('\n')) + '</textarea></label>' +
    '<h5 class="sl-formh">Contact people</h5><div class="sl-people">' + people.map(slPersonHtml).join('') + '</div>' +
    '<button type="button" class="btn btn-secondary sl-addperson" data-addperson>Add another person</button>' +
    '<label>Notes<textarea class="sl-in" name="notes" rows="2" maxlength="2000">' + _slE(v.notes) + '</textarea></label>' +
    '<div class="sl-formfoot">' + (s ? '<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>' : '') +
      '<span class="sl-msg" role="status" aria-live="polite"></span><button type="submit" class="btn btn-primary">' + (s ? 'Save changes' : 'Add supplier') + '</button></div></form>';
}
function slFormParams(form) {
  const el = form.elements, dist = slPicked(form, 'dist') === 'Yes', delivery = slPicked(form, 'delivery');
  return { supplier: el.supplier.value.trim(), aliases: el.aliases.value, type: slPicked(form, 'type'), distributor: dist, brands: dist ? el.brands.value : '',
           address: el.address.value.trim(), delivery, deliveryNote: delivery === 'Other' ? el.deliveryNote.value.trim() : '',
           terms: el.terms.value === '__other' ? el.termsOther.value.trim() : el.terms.value, tin: el.tin.value.trim(), usualItems: el.usualItems.value,
           contactsJson: JSON.stringify(slReadPeople(form)), notes: el.notes.value.trim() };
}
function slErr(form, field, text) { const p = form.querySelector('[data-err="' + field + '"]'); if (p) { p.textContent = text || ''; p.hidden = !text; } }
/** What the form says as it is typed: a name already on the list, an email that is not one, the fields that open. */
function slWireForm(form, s, done) {
  const el = form.elements, exceptNo = s ? s.supplierNo : '';
  const twin = () => {
    const t = slTwin(SL.suppliers, el.supplier.value, exceptNo), box = form.querySelector('[data-dup]');
    box.hidden = !t;
    if (t) box.innerHTML = '"' + _slE(t.supplier) + '" is already on the list. <button type="button" class="sl-link" data-open-twin="' + _slE(t.supplierNo) + '">Open it</button>';
    slErr(form, 'supplier', el.supplier.value.trim() || !form.dataset.touched ? '' : 'Type the supplier\'s name.');
  };
  el.supplier.addEventListener('input', () => { form.dataset.touched = '1'; delete form.dataset.allow; twin(); });
  form.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.name === 'dist') form.querySelector('.sl-brands').hidden = slPicked(form, 'dist') !== 'Yes';
    if (t.name === 'delivery') { form.querySelector('.sl-delnote').hidden = slPicked(form, 'delivery') !== 'Other'; slErr(form, 'deliveryNote', ''); }
    if (t.name === 'terms') { form.querySelector('.sl-termsother').hidden = el.terms.value !== '__other'; if (el.terms.value === '__other') el.termsOther.focus(); }
  });
  form.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.getAttribute && t.getAttribute('data-f') === 'emails') {
      const bad = slBadEmails(t.value), say = t.parentNode.querySelector('[data-bad]');
      if (say) { say.hidden = !bad.length; say.textContent = bad.length ? '"' + bad[0] + '" is not an email address.' : ''; }
    }
    if (t.name === 'deliveryNote' && t.value.trim()) slErr(form, 'deliveryNote', '');
  });
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    const wrap = form.querySelector('.sl-people');
    if (b.hasAttribute('data-addperson')) {
      wrap.insertAdjacentHTML('beforeend', slPersonHtml({ primary: !wrap.querySelector('.sl-person') }, wrap.querySelectorAll('.sl-person').length));
      const last = wrap.querySelector('.sl-person:last-child [data-f="name"]'); if (last) last.focus();
    } else if (b.hasAttribute('data-rmperson')) {
      const fs = b.closest('.sl-person'); if (fs) fs.remove();
      wrap.querySelectorAll('.sl-person legend').forEach((l, i) => { l.textContent = 'Contact ' + (i + 1); });
    } else if (b.hasAttribute('data-open-twin')) slDetail(b.getAttribute('data-open-twin'), SL.back);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const params = slFormParams(form);
    form.dataset.touched = '1';
    if (!params.supplier) { slErr(form, 'supplier', 'Type the supplier\'s name.'); el.supplier.focus(); return; }
    if (params.delivery === 'Other' && !params.deliveryNote) { slErr(form, 'deliveryNote', 'Say how this supplier delivers.'); el.deliveryNote.focus(); return; }
    if (form.querySelector('[data-bad]:not([hidden])')) { slMsg(form, 'Fix the email marked in red first.', true); return; }
    if (s) params.supplierNo = s.supplierNo;
    if (form.dataset.allow === '1') params.allowDuplicate = true;
    const r = await slPost(form, 'saveSupplierBookSupplier', params, { quiet: true });
    if (r && r.success) { if (done) done(r); SL.flash = s ? 'Saved.' : 'Added.'; SL.open = r.supplierNo; if (!s) SL.tab = 'overview'; await slReload(); return; }   // the sheet closes first: closing forgets the open supplier
    if (r && r.duplicate) {
      form.dataset.allow = '1';
      form.querySelector('[type="submit"]').textContent = s ? 'Save anyway' : 'Add it anyway';
      slMsg(form, r.message + ' Open it from the list, or save anyway if it is a different supplier.', true);
    }
  });
}
function slAddDialog(back) {
  const box = slShow('<header class="sl-mhead"><div><h3 id="slTitle">Add a supplier</h3><p class="sl-sub">Its prices file here by themselves whenever a purchase request naming it is forwarded to management.</p></div>' +
    '<button type="button" class="btn btn-secondary" data-close>Close</button></header>' + slFormHtml(null, 'slAddForm'), back);
  const form = box.querySelector('#slAddForm');
  slWireForm(form, null, () => slClose());
  form.elements.supplier.focus();
}

/* ── one supplier ─────────────────────────────────────────────────────────────────────────────── */

const SL_TABS = ['overview', 'contacts', 'items', 'history'];
const SL_SOURCE = { 'Forwarded PR': 'Added from a forwarded purchase request', Import: 'Filled from past purchase requests', 'Supplier file': 'From the supplier file', Manual: '' };
function slPrLink(no) { return no ? '<a href="flow-pricing-request.html?pr=' + encodeURIComponent(no) + '">' + _slE(no) + '</a>' : ''; }
function slDetail(no, back) {
  const s = SL.suppliers.find(x => x.supplierNo === no);
  if (!s) return;
  SL.open = no;
  if (SL_TABS.indexOf(SL.tab) < 0) SL.tab = 'overview';
  const live = !slArchived(s) && SL.ok, items = slItems(SL.prices, no), log = slLogFor(SL.log, no), people = s.contacts || [], main = slPrimary(s);
  const flash = SL.flash; SL.flash = '';
  const tab = (id, label, n) => '<button type="button" role="tab" class="sl-tab" id="slTab-' + id + '" aria-controls="slPanel-' + id + '" aria-selected="' + (SL.tab === id) + '"' +
    ' tabindex="' + (SL.tab === id ? 0 : -1) + '" data-tab="' + id + '">' + label + (n ? ' <span class="n">' + n + '</span>' : '') + '</button>';
  const panel = (id, html) => '<div class="sl-panel" role="tabpanel" id="slPanel-' + id + '" aria-labelledby="slTab-' + id + '"' + (SL.tab === id ? '' : ' hidden') + '>' + html + '</div>';
  const fact = (label, value) => '<div class="sl-fact"><span class="sl-fk">' + label + '</span><span class="sl-fv">' + value + '</span></div>';
  const none = (t) => '<span class="sl-dim">' + t + '</span>';
  const mail = (e) => '<a href="mailto:' + _slE(e) + '">' + _slE(e) + '</a>', tel = (t) => '<a href="tel:' + _slE(String(t).replace(/[^\d+]/g, '')) + '">' + _slE(t) + '</a>';
  const lines = (arr) => (arr || []).length ? '<span class="sl-lines">' + arr.map(x => '<span>' + _slE(x) + '</span>').join('') + '</span>' : '';

  const head = '<header class="sl-dhead"><div class="sl-dtop"><div class="sl-dtitle"><h3 id="slTitle">' + _slE(s.supplier) + '</h3>' +
      '<p class="sl-sub">' + (s.type ? slBadge(s.type, 'type') : '') + (s.distributor ? slBadge('We distribute for them', 'dist') : '') + (s.needsDetails ? slBadge('Needs details', 'warn') : '') +
      (slArchived(s) ? slBadge('Archived', 'off') : '') + '</p>' +
      '<p class="sl-dmeta">' + [_slE(s.supplierNo), _slE(SL_SOURCE[s.source] || ''), s.address ? _slE(slPlace(s.address)) : ''].filter(Boolean).join(' · ') + '</p></div>' +
      '<button type="button" class="btn btn-secondary sl-close" data-close>Close</button></div>' +
    (flash ? '<p class="sl-flash" role="status">' + _slE(flash) + '</p>' : '') +
    '<div class="sl-tabs" role="tablist" aria-label="About ' + _slE(s.supplier) + '">' + tab('overview', 'Overview') + tab('contacts', 'Contacts', people.length) +
      tab('items', 'Items priced', items.length) + tab('history', 'History', log.length) + '</div></header>';

  const warns = (s.needsDetails && live ? '<p class="sl-warn">' + (s.source === 'Manual' ? 'This supplier has no contact person or address yet.' : _slE(SL_SOURCE[s.source] || 'Added') + '; it has no contact person or address yet.') +
      ' <button type="button" class="sl-link" data-reveal="slEdit">Add them</button></p>' : '') +
    (slArchived(s) ? '<p class="sl-warn">Archived ' + _slE(slDay(s.archivedAt)) + (s.archivedBy ? ' by ' + _slE(s.archivedBy) : '') + ': ' + _slE(s.archiveReason) + '</p>' : '');
  const lastAt = slLastPriced(SL.prices, no);
  const overview = warns + '<div class="sl-facts" id="slFacts">' +
      fact('Local or international', s.type ? _slE(s.type) : none('Not set')) +
      fact('Distributorship', s.distributor ? 'We distribute for them' + ((s.brands || []).length ? '<span class="sl-fsub">' + _slE(s.brands.join(', ')) + '</span>' : '') : none('No')) +
      fact('Address', s.address ? '<span class="sl-pre">' + _slE(s.address) + '</span>' : none('None yet')) +
      fact('Usual delivery', s.delivery ? _slE(s.delivery) + (s.deliveryNote ? '<span class="sl-fsub">' + _slE(s.deliveryNote) + '</span>' : '') : none('Not set')) +
      fact('Payment terms', s.terms ? _slE(s.terms) : none('Not set')) +
      (s.tin ? fact('TIN', _slE(s.tin)) : '') +
      fact('Usual items', lines(s.usualItems) || none('None yet')) +
      fact('Main contact', main ? '<b>' + _slE(main.name || (main.emails || [])[0] || (main.phones || [])[0] || '') + '</b>' + (main.position ? ' <span class="sl-fsub-i">' + _slE(main.position) + '</span>' : '') +
        ((main.emails || []).length || (main.phones || []).length ? '<span class="sl-flinks">' + (main.emails || []).slice(0, 1).map(mail).concat((main.phones || []).slice(0, 1).map(tel)).join(' · ') + '</span>' : '')
        : none('No contact yet')) +
      fact('Items priced', items.length ? items.length + ' item' + (items.length === 1 ? '' : 's') + '<span class="sl-fsub">last priced ' + _slE(slDay(lastAt)) + '</span>' : none('None yet')) +
      ((s.aliases || []).length ? fact('Other spellings', lines(s.aliases)) : '') +
      (s.notes ? fact('Notes', '<span class="sl-pre">' + _slE(s.notes) + '</span>') : '') +
    '</div>' + (live ? '<div class="sl-panelbar"><button type="button" class="btn btn-secondary" data-reveal="slEdit" aria-expanded="false" aria-controls="slEdit">Edit</button></div>' + slFormHtml(s, 'slEdit') : '');

  const contacts = people.length ? '<ul class="sl-peeps">' + people.map(p => '<li><span class="sl-pname">' + _slE(p.name || (p.emails || [])[0] || (p.phones || [])[0] || 'Contact') +
      (p.primary ? ' ' + slBadge('Main', 'type') : '') + '</span>' + (p.position ? '<span class="sl-ppos">' + _slE(p.position) + '</span>' : '') +
      ((p.emails || []).length || (p.phones || []).length ? '<span class="sl-plinks">' + (p.emails || []).map(mail).concat((p.phones || []).map(tel)).join('') + '</span>' : '') + '</li>').join('') + '</ul>'
    : '<p class="sl-empty">No contact people yet.</p>';
  const contactsPanel = contacts + (live ? '<div class="sl-panelbar"><button type="button" class="btn btn-secondary" data-editpeople>' + (people.length ? 'Edit contact people' : 'Add a contact person') + '</button></div>' : '');

  const itemRow = (it, i) => '<li class="sl-itm" data-item="' + _slE((it.itemName + ' ' + it.itemNo).toLowerCase()) + '"><div class="sl-itop"><span class="sl-iname">' + _slE(it.itemName || it.itemNo) +
      (it.itemNo && !/^(n\/?a|none|tba|-+)$/i.test(it.itemNo) ? ' <span class="sl-code">' + _slE(it.itemNo) + '</span>' : '') + '</span>' +
      '<span class="sl-iprice">' + _slE(slMoney(it.last.currency, it.last.price)) + (it.uom ? '<span class="sl-per"> / ' + _slE(it.uom) + '</span>' : '') + '</span></div>' +
    '<div class="sl-imeta"><span>Last priced ' + _slE(slDay(it.last.at)) + '</span>' + (it.last.vat ? '<span>VAT ' + _slE(it.last.vat.toLowerCase()) + '</span>' : '') +
      '<span>' + slPrLink(it.last.prNo) + (it.last.customer ? ' · ' + _slE(it.last.customer) : '') + '</span>' +
      (it.count > 1 ? '<button type="button" class="sl-link" data-hist="' + i + '" aria-expanded="false" aria-controls="slHist' + i + '">' + it.count + ' prices</button>' : '') + '</div>' +
    (it.count > 1 ? '<ol class="sl-ihist" id="slHist' + i + '" hidden>' + it.history.map(h => '<li><span class="tm">' + _slE(slDay(h.at)) + '</span><span class="amt">' + _slE(slMoney(h.currency, h.price)) +
      '</span><span>' + slPrLink(h.prNo) + (h.customer ? ' · ' + _slE(h.customer) : '') + (h.source === 'Import' ? ' · from past requests' : '') + '</span></li>').join('') + '</ol>' : '') + '</li>';
  const itemsPanel = items.length ? (items.length > 8 ? '<label class="sl-itemq"><span class="sl-sr">Find an item</span><input type="search" class="sl-in" data-itemq placeholder="Find an item" autocomplete="off"></label>' : '') +
      '<ul class="sl-items">' + items.map(itemRow).join('') + '</ul><p class="sl-sub">The price admin forwarded to management, in the supplier\'s currency.</p>'
    : '<p class="sl-empty">Prices appear here when admin forwards a purchase request with this supplier.</p>';

  const others = SL.suppliers.filter(x => !slArchived(x) && x.supplierNo !== no).sort((a, b) => a.supplier.localeCompare(b.supplier));
  const merge = live && others.length ? '<section class="sl-sec"><h4>Merge into another supplier</h4><p class="sl-sub">When this supplier was entered twice. Its prices, other spellings and people move to the one you choose, and this one is archived.</p>' +
      '<div class="sl-mergebar"><label><span class="sl-sr">Merge into</span><select class="sl-in" data-mergeinto><option value="">Choose the supplier…</option>' +
      others.map(x => '<option value="' + _slE(x.supplierNo) + '">' + _slE(x.supplier) + '</option>').join('') + '</select></label>' +
      '<button type="button" class="btn btn-secondary" data-mergecheck>Check what moves</button></div><div data-mergeplan></div></section>' : '';
  const archive = SL.ok ? '<section class="sl-sec"><form class="sl-form" id="slArchive">' + (slArchived(s)
      ? '<div class="sl-formfoot"><span class="sl-msg" role="status"></span><button type="submit" class="btn btn-secondary">Restore this supplier</button></div>'
      : '<label>Archive this supplier — why?<input type="text" class="sl-in" name="reason" maxlength="190" placeholder="Closed down"></label><div class="sl-formfoot"><span class="sl-msg" role="status"></span><button type="submit" class="btn btn-secondary">Archive</button></div>') +
    '</form></section>' : '';
  const history = '<ul class="sl-hist">' + log.map(l => '<li><span class="tm">' + _slE(slDay(l.at)) + '</span><span>' + _slE(slLogText(l)) + (l.ref ? ' · ' + (/^PR-/.test(l.ref) ? slPrLink(l.ref) : _slE(l.ref)) : '') +
      (l.note ? '<span class="sl-sub">' + _slE(l.note) + '</span>' : '') + '<span class="sl-sub">' + _slE(l.by) + '</span></span></li>').join('') + '</ul>' + merge + archive;

  const box = slShow(head + panel('overview', overview) + panel('contacts', contactsPanel) + panel('items', itemsPanel) + panel('history', history), back, { pane: true });
  slMarkOpen();
  slWireDetail(box, s, items);
}

function slWireDetail(box, s, items) {
  const tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]')), edit = box.querySelector('#slEdit'), facts = box.querySelector('#slFacts');
  const pick = (id, focus) => {
    SL.tab = id;
    tabs.forEach(t => { const on = t.getAttribute('data-tab') === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    box.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = p.id !== 'slPanel-' + id; });
    const host = box.parentNode;
    if (host && host.scrollTop > 0) host.scrollTop = 0;
  };
  const openEdit = (show, focusPeople) => {
    if (!edit) return;
    edit.hidden = !show;
    if (facts) facts.hidden = show;
    box.querySelectorAll('[data-reveal="slEdit"]').forEach(b => b.setAttribute('aria-expanded', String(show)));
    const first = show && (focusPeople ? edit.querySelector('.sl-person [data-f="name"]') : edit.elements.supplier);
    if (first && first.focus) first.focus();
  };
  if (edit) { edit.hidden = true; slWireForm(edit, s, null); }
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab], [data-reveal], [data-cancel], [data-editpeople], [data-hist], [data-mergecheck], [data-mergego], [data-mergeoff]');
    if (!t) return;
    if (t.hasAttribute('data-tab')) pick(t.getAttribute('data-tab'), false);
    else if (t.hasAttribute('data-reveal')) { pick('overview', false); openEdit(edit ? edit.hidden : false, false); }
    else if (t.hasAttribute('data-cancel')) openEdit(false);
    else if (t.hasAttribute('data-editpeople')) { pick('overview', false); openEdit(true, true); }
    else if (t.hasAttribute('data-hist')) {
      const ol = box.querySelector('#slHist' + t.getAttribute('data-hist'));
      if (ol) { ol.hidden = !ol.hidden; t.setAttribute('aria-expanded', String(!ol.hidden)); }
    } else if (t.hasAttribute('data-mergecheck')) slMergeCheck(box, s);
    else if (t.hasAttribute('data-mergego')) slMergeGo(box, s, t.getAttribute('data-mergego'));
    else if (t.hasAttribute('data-mergeoff')) { const p = box.querySelector('[data-mergeplan]'); if (p) p.innerHTML = ''; }
  });
  const list = box.querySelector('[role="tablist"]');
  if (list) list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (i < 0 || (!step && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
    pick(tabs[n].getAttribute('data-tab'), true);
  });
  const q = box.querySelector('[data-itemq]');
  if (q) q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    box.querySelectorAll('.sl-itm').forEach(li => { li.hidden = !!v && String(li.getAttribute('data-item') || '').indexOf(v) < 0; });
  });
  const arch = box.querySelector('#slArchive');
  if (arch) arch.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (slArchived(s)) { SL.flash = 'Restored.'; await slPost(arch, 'archiveSupplierBookSupplier', { supplierNo: s.supplierNo, restore: true }); return; }
    const reason = arch.elements.reason.value.trim();
    if (!reason) { arch.elements.reason.focus(); slMsg(arch, 'Say why first.', true); return; }
    SL.flash = 'Archived. Restore it below if that was a mistake.';   // undo instead of a confirm
    await slPost(arch, 'archiveSupplierBookSupplier', { supplierNo: s.supplierNo, reason });
  });
}

/* Merge: the one step that cannot simply be undone, so it is checked first and shown in full. */
async function slMergeCheck(box, s) {
  const into = box.querySelector('[data-mergeinto]').value, out = box.querySelector('[data-mergeplan]');
  if (!into) { out.innerHTML = '<p class="sl-err">Choose the supplier to merge into first.</p>'; return; }
  out.innerHTML = '<p class="sl-sub" role="status">Checking…</p>';
  const r = await postFlow('mergeSupplierBookSupplier', { fromNo: s.supplierNo, intoNo: into, dryRun: true }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!(r && r.success && r.plan)) { out.innerHTML = '<p class="sl-err">' + _slE((r && r.message) || 'Could not check the merge.') + '</p>'; return; }
  const p = r.plan, n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
  out.innerHTML = '<div class="sl-mergeplan" role="status"><p><b>' + _slE([n(p.prices, 'price'), n(p.names.length, 'name'), p.contacts ? n(p.contacts, 'contact person') : ''].filter(Boolean).join(', ')) +
    '</b> move to ' + _slE(p.into.supplier) + '.' + (p.names.length ? ' ' + _slE(p.names.join(', ')) + ' becomes one of its other spellings.' : '') +
    ' ' + _slE(p.from.supplier) + ' is then archived.</p><div class="sl-formfoot"><button type="button" class="btn btn-secondary" data-mergeoff>Cancel</button>' +
    '<span class="sl-msg" role="status"></span><button type="button" class="btn btn-primary" data-mergego="' + _slE(into) + '">Merge into ' + _slE(p.into.supplier) + '</button></div></div>';
}
async function slMergeGo(box, s, into) {
  const out = box.querySelector('[data-mergeplan]'), btn = out.querySelector('[data-mergego]');
  if (btn) btn.disabled = true;
  slMsg(out, 'Merging…');
  const r = await postFlow('mergeSupplierBookSupplier', { fromNo: s.supplierNo, intoNo: into }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!(r && r.success)) { if (btn) btn.disabled = false; slMsg(out, (r && r.message) || 'The merge did not go through.', true); return; }
  SL.flash = 'Merged in ' + s.supplier + '.';
  SL.open = r.supplierNo;
  SL.tab = 'items';
  await slReload();
}

/** Send one change, then read the list again so the list, the supplier and its history all agree. */
async function slPost(form, action, params, o) {
  const btn = form && form.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  if (form) slMsg(form, 'Saving…');
  const r = await postFlow(action, params).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (btn) btn.disabled = false;
  if (r && r.success) { if (!(o && o.quiet)) { SL.flash = SL.flash || 'Saved.'; await slReload(); } return r; }
  SL.flash = '';
  if (form && !(r && r.duplicate)) slMsg(form, (r && r.message) || 'The change could not be saved.', true);
  return r || { success: false };
}
