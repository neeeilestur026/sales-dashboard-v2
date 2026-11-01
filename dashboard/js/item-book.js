/* item-book.js — A387 · the Item Book page (item-book.html): every product, one card each.
 *
 * Neil, 1 Nov 2026: one card per product "so that information and details can be easily found and identified". The
 * list (search, chips, sort) and one item's card: its name, code, brand, model, type and specs, what is on hand and
 * where each piece is, its barcodes and labels, its photos, and — in History — every request, quotation, order,
 * invoice, purchase order, receiving, dispatch and rental it appeared on, matched by the same rules the stock moves by.
 * Supplier prices and landed cost appear only when the server sends them (management and the director). Admin and the
 * director change the card; nothing here ever writes Inventory. Numbers and words: js/item-book-model.js (pure).
 *
 * Built to the apple-design skill on the A344 tokens: the Contacts-on-a-Mac split (js/hx-split.js), a translucent card
 * header, a segmented control with a sliding indicator and arrow keys, feedback on press, Undo instead of a confirm
 * when a photo is hidden, and the reduced-motion / transparency / contrast settings honoured in css/item-book.css.
 */

const IB = { me: null, may: {}, lists: null, items: [], f: { q: '', chip: 'all', sort: 'name' }, shown: 200, open: '', back: null,
             card: null, tab: 'overview', part: 'sell', hist: {}, thumbs: {}, sv: null, wasWide: null, busy: false };
const IB_PAGE = 200;

function _ibE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _ibId(id) { return document.getElementById(id); }
function _ibDay(v) {
  const s = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}
function _ibToast(t, tone) { if (typeof hxToast === 'function') hxToast(t, { tone: tone }); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireItemBookAccess === 'function' ? requireItemBookAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('item-book');
  IB.me = String(s.name || s.username || '').trim();
  IB.sv = hxSplitView({ split: 'ibSplit', pane: 'ibPane', prefix: 'ib', label: 'ibCardTitle',
    onClose: () => { if (!IB.sv.wide()) IB.open = ''; if (IB.back && IB.back.focus) IB.back.focus(); } });
  _ibId('ibQ').addEventListener('input', (e) => { IB.f.q = e.target.value; IB.shown = IB_PAGE; ibRender(); });
  _ibId('ibSort').addEventListener('change', (e) => { IB.f.sort = e.target.value; ibRender(); });
  _ibId('ibChips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) { IB.f.chip = b.getAttribute('data-chip'); IB.shown = IB_PAGE; ibRender(); } });
  _ibId('ibList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b) return ibOpen(b.getAttribute('data-open'), b);
    if (e.target.closest('[data-more]')) { IB.shown += IB_PAGE; ibRender(); }
  });
  _ibId('ibList').addEventListener('keydown', ibListKeys);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', ibOnResize);
  await ibLoad();
});

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

async function ibLoad() {
  _ibId('ibList').innerHTML = '<p class="ib-empty">Reading the items…</p>';
  const r = await postFlow('getItemBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!r || !r.success) {
    const old = /Unknown action/i.test(String(r && r.message));
    _ibId('ibNotice').innerHTML = '<p class="ib-notice' + (old ? '' : ' bad') + '">' + _ibE(old
      ? 'The Item Book needs FlowAPI 194. Paste it in Apps Script and make a new deployment, then reload this page.'
      : (r && r.message) || 'The items could not be read.') + '</p>';
    _ibId('ibList').innerHTML = '';
    return;
  }
  IB.items = r.items || []; IB.may = r.may || {}; IB.lists = r.lists || { brands: [], categories: [] };
  ibNoIdNotice(r.noId || 0);
  const sel = _ibId('ibSort');
  sel.innerHTML = IBM_SORTS.map(x => '<option value="' + x[0] + '">' + _ibE(x[1]) + '</option>').join('');
  sel.value = IB.f.sort;
  ibRender();
  const q = new URLSearchParams(location.search || '');
  if (q.get('id')) ibOpen(q.get('id'), null);
  else if (q.get('name') || q.get('no')) ibOpenLine(q.get('no') || 'N/A', q.get('name') || '');
  else if (IB.sv.wide()) ibPaneEmpty();
  IB.wasWide = IB.sv.wide();
  IB.sv.fit();
}

/* The oldest inventory rows were never given an Item ID (A159's backfillItemIds was not run), so they cannot have a card
   yet. Whoever may change cards can give them one, once; it only fills the blank Item ID cells. */
function ibNoIdNotice(n) {
  const box = _ibId('ibNotice');
  if (!n) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="ib-notice">' + _ibE(n + ' older item' + (n === 1 ? ' has' : 's have') + ' no item id yet, so ' + (n === 1 ? 'it is' : 'they are') + ' not on this list.') +
    (IB.may.edit ? ' <button type="button" class="btn btn-secondary btn-sm" id="ibBackfill">Give ' + (n === 1 ? 'it an id' : 'them ids') + '</button>' : ' Admin or the director can add them.') + '</div>';
  const b = _ibId('ibBackfill');
  if (b) b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Giving ids…';
    const r = await postFlow('backfillItemIds', {}).catch(e => ({ success: false, message: String(e && e.message || e) }));
    _ibToast((r && r.message) || 'Done.', r && r.success ? 'ok' : 'error');
    if (r && r.success) ibLoad(); else { b.disabled = false; b.textContent = 'Try again'; }
  });
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function ibRender() {
  const counts = ibmCounts(IB.items);
  _ibId('ibChips').innerHTML = IBM_CHIPS.map(c => {
    const n = counts[c[0]] || 0, on = IB.f.chip === c[0];
    if (!n && !on && c[0] !== 'all') return '';
    return '<button type="button" class="ib-chip' + (on ? ' on' : '') + '" data-chip="' + c[0] + '" aria-pressed="' + on + '">' + _ibE(c[1]) + ' <span class="n">' + n + '</span></button>';
  }).join('');
  const rows = ibmFilter(IB.items, IB.f), show = rows.slice(0, IB.shown);
  _ibId('ibCount').textContent = ibmCountLine(rows.length, IB.items.length);
  _ibId('ibList').innerHTML = !rows.length
    ? '<p class="ib-empty">' + _ibE(IB.f.q ? 'No item matches “' + IB.f.q + '”.' : 'No items here.') + '</p>'
    : show.map(ibRow).join('') + (rows.length > show.length ? '<button type="button" class="ib-more" data-more="1">Show ' + Math.min(IB_PAGE, rows.length - show.length) + ' more</button>' : '');
}
function ibRow(it) {
  const code = ibmHasCode(it.itemNo) ? it.itemNo : '', sub = [code, it.brand, it.model].filter(Boolean).join(' · ') || (it.displayName ? _ibmShort(it.name, 80) : 'No code');
  const tags = [it.category, it.photos ? it.photos + ' photo' + (it.photos === 1 ? '' : 's') : '', it.tracked ? 'Tracked by piece' : '', it.barcodes ? 'Barcode' : ''].filter(Boolean);
  return '<div class="ib-item" role="listitem"><button type="button" class="ib-open' + (IB.open === it.itemId ? ' on' : '') + '" data-open="' + _ibE(it.itemId) + '">' +
    '<span class="ib-r1"><span class="ib-name">' + _ibE(ibmTitle(it)) + '</span>' +
    '<span class="ib-qty' + (it.type === 'Stock' ? (it.balance > 0 ? ' in' : ' out') : '') + '">' + (it.type === 'Stock' ? _ibE(it.balance) + ' on hand' : 'Catalog') + '</span></span>' +
    '<span class="ib-r2">' + _ibE(sub) + '</span>' +
    (tags.length ? '<span class="ib-r3">' + tags.map(t => '<span class="ib-tag">' + _ibE(t) + '</span>').join('') + '</span>' : '') + '</button></div>';
}
function ibListKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = Array.from(_ibId('ibList').querySelectorAll('.ib-open')), i = all.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) { next.focus(); if (IB.sv.wide()) ibOpen(next.getAttribute('data-open'), next); }
}
function ibOnResize() {
  const now = IB.sv.wide();
  if (now !== IB.wasWide) {
    IB.wasWide = now;
    if (now && IB.open && IB.card) ibDraw();
    else if (now) ibPaneEmpty();
    else IB.open = '';
  }
  IB.sv.fit();
}
function ibPaneEmpty() {
  const p = _ibId('ibPane');
  if (p) p.innerHTML = '<div class="ib-paneempty"><p class="ib-empty">Pick an item to see its card.</p></div>';
}

/* ── one card ─────────────────────────────────────────────────────────────────────────────────── */

async function ibOpen(itemId, back) {
  IB.open = itemId; IB.back = back || IB.back;
  document.querySelectorAll('#ibList .ib-open').forEach(b => b.classList.toggle('on', b.getAttribute('data-open') === itemId));
  if (!IB.card || IB.card.item.itemId !== itemId) { IB.hist = {}; IB.tab = IB.tab === 'log' ? 'overview' : IB.tab; }
  IB.sv.show('<div class="ib-loading"><p class="ib-empty">Opening the card…</p></div>', { key: itemId, pane: true });
  const r = await postFlow('getItemCard', { itemId }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (IB.open !== itemId) return;                          // another item was picked meanwhile
  if (!r || !r.success || !r.item) { IB.sv.show('<p class="ib-empty">' + _ibE((r && r.message) || 'This item could not be read.') + '</p>', { key: itemId, pane: true }); return; }
  IB.card = r;
  ibDraw();
  if (IB.tab === 'history') ibLoadHistory();
}
/** From a document line (another page's link): the same rules as the stock moves. Two rows fit → say so, open neither. */
async function ibOpenLine(no, name) {
  const r = await postFlow('getItemCard', { itemNo: no, itemName: name }).catch(() => null);
  if (r && r.success && r.item) { IB.card = r; IB.open = r.item.itemId; ibDraw(); return; }
  const c = (r && r.resolved && r.resolved.candidates) || [];
  _ibId('ibNotice').innerHTML = '<div class="ib-notice">' + _ibE('No single item is “' + (name || no) + '”.') +
    (c.length ? ' It could be: ' + c.map(x => '<button type="button" class="ib-link" data-pickopen="' + _ibE(x.itemId) + '">' + _ibE(ibmTitle({ name: x.name, itemNo: x.itemNo })) + '</button>').join(', ') + '.' : '') + '</div>';
  _ibId('ibNotice').onclick = (e) => { const b = e.target.closest('[data-pickopen]'); if (b) ibOpen(b.getAttribute('data-pickopen'), b); };
}
const IB_TABS = [['overview', 'Overview'], ['history', 'History'], ['photos', 'Photos'], ['log', 'Log']];
function ibDraw() {
  const c = IB.card, it = c.item, code = ibmHasCode(it.itemNo) ? it.itemNo : '';
  const shown = (c.photos || []).filter(p => !p.hidden);
  const head = '<header class="ib-dhead"><div class="ib-dtop">' +
    '<div class="ib-thumb" data-thumb="' + _ibE(shown[0] ? shown[0].docId : '') + '" aria-hidden="true">' + (shown[0] ? '' : '<span class="ib-noimg">No photo</span>') + '</div>' +
    '<div class="ib-dtitle"><h2 id="ibCardTitle">' + _ibE(ibmTitle(it)) + '</h2>' +
    '<p class="ib-dsub">' + [code ? '<span class="ib-code">' + _ibE(code) + '</span>' : '<span class="ib-dim">No code</span>', '<span class="ib-dim">' + _ibE(it.itemId) + '</span>',
      '<span class="ib-badge' + (it.type === 'Stock' ? ' ok' : '') + '">' + _ibE(it.type || 'Catalog') + '</span>',
      it.type === 'Stock' ? '<span class="ib-badge' + (it.balance > 0 ? ' in' : ' out') + '">' + _ibE(it.balance) + ' on hand</span>' : ''].filter(Boolean).join(' ') + '</p></div>' +
    '<div class="ib-dacts">' + (IB.may.edit ? '<button type="button" class="btn btn-secondary btn-sm" data-act="edit">Edit</button>' : '') +
    '<button type="button" class="ib-close" data-close aria-label="Close">Close</button></div></div>' +
    '<div class="ib-seg ib-tabs" role="tablist" aria-label="The item"><span class="ib-thumbseg" aria-hidden="true"></span>' +
    IB_TABS.map(t => '<button type="button" class="ib-segb" role="tab" data-tab="' + t[0] + '" id="ibTab-' + t[0] + '" aria-controls="ibPanel-' + t[0] + '" aria-selected="' + (IB.tab === t[0]) + '" tabindex="' + (IB.tab === t[0] ? 0 : -1) + '">' +
      _ibE(t[1]) + (t[0] === 'photos' && c.photos.length ? ' <span class="n">' + shown.length + '</span>' : '') + '</button>').join('') + '</div></header>';
  const panel = (k, html) => '<section class="ib-panel" role="tabpanel" id="ibPanel-' + k + '" aria-labelledby="ibTab-' + k + '"' + (IB.tab === k ? '' : ' hidden') + '>' + html + '</section>';
  const box = IB.sv.show(head + panel('overview', ibOverview()) + panel('history', ibHistoryHtml()) + panel('photos', ibPhotosHtml()) + panel('log', ibLogHtml()), { key: it.itemId, pane: true });
  if (!box || !box.querySelector) return;
  ibWire(box);
  ibSegThumb(box.querySelector('.ib-tabs'));
  ibThumbs(box);
}
function ibFact(k, v, raw) { return v === '' || v === null || v === undefined ? '' : '<div class="ib-fact"><span class="ib-fk">' + _ibE(k) + '</span><span class="ib-fv">' + (raw ? v : _ibE(v)) + '</span></div>'; }
function ibOverview() {
  const c = IB.card, it = c.item, sp = ibmSpecs(it), long = (it.description || '').length > 160;
  const facts = [
    ibFact('Description', long ? '<span class="ib-desc">' + _ibE(it.description.slice(0, 160)) + '…</span> <button type="button" class="ib-link" data-act="full">Show all</button>' : _ibE(it.description), true),
    ibFact('Code', ibmHasCode(it.itemNo) ? it.itemNo : 'No code (' + (it.itemNo || 'blank') + ')'),
    ibFact('Brand', it.brand), ibFact('Model', it.model), ibFact('Type', it.category),
    ibFact('On hand', it.type === 'Stock' ? String(it.balance) : 'Not stocked (catalog item)'),
    it.landedCost !== undefined ? ibFact('Landed cost', ibmMoney(it.landedCost, it.costCurrency) + ' each · ' + ibmMoney(it.totalLanded, it.costCurrency) + ' on hand') : '',
    ibFact('Barcodes', (c.barcodes || []).map(b => b.barcode).join(', ')),
    ibFact('Labels', (c.labels || []).length ? (c.labels.map(l => l.code).filter(Boolean).join(', ') || c.labels.length + ' label') + ' · printed ' + c.labels.reduce((t, l) => t + (l.printed || 0), 0) + '×' : ''),
    ibFact('Notes', it.notes)].join('');
  const specs = sp.specs.length ? '<h3 class="ib-h">Specs' + (sp.fromCard ? '' : ' <span class="ib-dim">read from the description</span>') + '</h3><dl class="ib-specs">' +
    sp.specs.map(s => '<div><dt>' + _ibE(s[0]) + '</dt><dd>' + _ibE(s[1]) + '</dd></div>').join('') + '</dl>' : '';
  const pieces = (c.pieces || []).length ? '<h3 class="ib-h">Pieces <span class="ib-dim">' + c.pieces.length + '</span></h3><div class="ib-table"><table class="flow-table"><thead><tr><th>Piece</th><th>Where</th><th>Status</th><th>Last move</th></tr></thead><tbody>' +
    c.pieces.map(p => '<tr><td><b>' + _ibE(p.assetNo) + '</b></td><td>' + _ibE(p.location) + '</td><td>' + _ibE(p.status) + '</td><td>' + _ibE(_ibDay(p.lastMoveAt)) + (p.lastRef ? ' · ' + _ibE(p.lastRef) : '') + '</td></tr>').join('') +
    '</tbody></table></div>' : '';
  const twins = (c.twins || []).length ? '<p class="ib-note">Same name as ' + c.twins.map(t => '<button type="button" class="ib-link" data-pickopen="' + _ibE(t.itemId) + '">' + _ibE(t.itemId) + (ibmHasCode(t.itemNo) ? ' (' + _ibE(t.itemNo) + ')' : '') + '</button>').join(', ') +
    ': documents with this name match neither until someone picks one.</p>' : '';
  return '<div class="ib-facts">' + facts + '</div>' + specs + pieces + twins;
}

/* ── history: three parts, loaded side by side the first time History opens ───────────────────── */

function ibHistoryHtml() {
  return '<div class="ib-seg ib-parts" role="radiogroup" aria-label="Which part of the history"><span class="ib-thumbseg" aria-hidden="true"></span>' +
    IBM_PARTS.map(p => '<button type="button" class="ib-segb" role="radio" data-part="' + p[0] + '" aria-checked="' + (IB.part === p[0]) + '" tabindex="' + (IB.part === p[0] ? 0 : -1) + '">' + _ibE(p[1]) +
      (IB.hist[p[0]] && IB.hist[p[0]].lines ? ' <span class="n">' + IB.hist[p[0]].lines.length + '</span>' : '') + '</button>').join('') + '</div>' +
    '<div class="ib-hist" aria-live="polite">' + ibPartHtml(IB.part) + '</div>';
}
function ibPartHtml(part) {
  const h = IB.hist[part];
  if (!h) return '<p class="ib-empty">Reading the history…</p>';
  if (h.error) return '<p class="ib-empty">' + _ibE(h.error) + '</p>';
  const lines = h.lines || [];
  let say = '';
  if (part === 'sell') {
    const lq = ibmLast(lines, 'quotation'), li = ibmLast(lines, 'invoice');
    say = [ibmSellSay(lines), lq ? 'Last quoted ' + ibmPeso(lq.price) + ' to ' + lq.party + ' on ' + _ibDay(lq.date) + '.' : '', li ? 'Last sold ' + ibmPeso(li.price) + ' to ' + li.party + ' on ' + _ibDay(li.date) + '.' : ''].filter(Boolean).join(' ');
  }
  const groups = ibmGroups(part, lines);
  const body = !groups.length ? '<p class="ib-empty">' + (part === 'sell' ? 'No request, quotation, order or invoice names this item yet.' : part === 'buy' ? 'Not bought or priced by a supplier yet.' : 'No dispatches or rentals yet.') + '</p>'
    : groups.map(g => '<details class="ib-group" open><summary class="ib-gh"><span>' + _ibE(g.label) + '</span><span class="ib-dim">' + g.lines.length + '</span></summary><ol class="ib-hlist">' +
        g.lines.map(l => ibLineRow(part, l)).join('') + '</ol></details>').join('');
  const unclear = h.unclearCount ? '<details class="ib-group ib-unclear"><summary class="ib-gh"><span>Marked as this item, may be another</span><span class="ib-dim">' + h.unclearCount + '</span></summary>' +
    '<p class="ib-note">These lines carry this item\'s id but a name no item in stock has, so they are not counted above. Most were stamped by the old quotation builder.</p><ol class="ib-hlist">' +
    (h.unclear || []).map(l => ibLineRow(part, l)).join('') + '</ol></details>' : '';
  return (say ? '<p class="ib-say">' + _ibE(say) + '</p>' : '') + body + unclear + (h.more ? '<p class="ib-note">And ' + h.more + ' older lines.</p>' : '');
}
function ibLineRow(part, l) {
  const money = [];
  if (l.price) money.push(ibmPeso(l.price));
  if (l.unitCost !== undefined && l.unitCost) money.push('cost ' + ibmMoney(l.unitCost, l.costCurrency || 'PHP'));
  if (l.supplierPrice !== undefined && l.supplierPrice) money.push('supplier ' + ibmMoney(l.supplierPrice, l.costCurrency || 'PHP'));
  if (l.landedCost !== undefined && l.landedCost) money.push('landed ' + ibmPeso(l.landedCost));
  const who = [l.party, l.supplier, l.by].filter(Boolean).join(' · ');
  const how = ibmHowSay(l), qty = l.qty ? l.qty + (l.uom ? ' ' + l.uom : '') : '';
  const meta = [l.so && l.so !== l.ref ? 'SO ' + l.so : '', l.po && l.po !== l.ref ? l.po : '', l.asset || '', l.status].filter(Boolean).join(' · ');
  /* two lines a row, like a grouped list: the document and its date, then who, how many and at what */
  return '<li class="ib-hl"><div class="ib-hl1"><b>' + _ibE(l.ref) + '</b><span class="ib-hld">' + _ibE(_ibDay(l.date)) + '</span></div>' +
    '<div class="ib-hl2"><span class="ib-hlw">' + _ibE(who || '—') + '</span><span class="ib-hlm">' + _ibE([qty ? '× ' + qty : '', money.join(' · ')].filter(Boolean).join('  ')) + '</span></div>' +
    (meta || how ? '<div class="ib-hl3">' + _ibE(meta) + (how ? '<span class="ib-warnt">' + _ibE(how) + '</span>' : '') + '</div>' : '') + '</li>';
}
async function ibLoadHistory() {
  const it = IB.card && IB.card.item;
  if (!it) return;
  const id = it.itemId;
  await Promise.all(IBM_PARTS.map(p => p[0]).filter(k => !IB.hist[k]).map(k =>
    postFlow('getItemHistory', { itemId: id, part: k }).then(r => { if (IB.open === id) IB.hist[k] = r && r.success ? r : { error: (r && r.message) || 'Could not read this part.' }; })
      .catch(e => { if (IB.open === id) IB.hist[k] = { error: String(e && e.message || e) }; })
      .then(() => { if (IB.open === id) ibRedrawHistory(); })));
}
function ibRedrawHistory() {
  const panel = document.querySelector('#ibPanel-history');
  if (!panel) return;
  panel.innerHTML = ibHistoryHtml();
  ibSegThumb(panel.querySelector('.ib-parts'));
}

/* ── photos and log ───────────────────────────────────────────────────────────────────────────── */

function ibPhotosHtml() {
  const c = IB.card, shown = (c.photos || []).filter(p => !p.hidden), hidden = (c.photos || []).filter(p => p.hidden);
  const tile = (p) => '<figure class="ib-ph' + (p.hidden ? ' hid' : '') + '"><div class="ib-phimg" data-thumb="' + _ibE(p.docId) + '"></div><figcaption>' + _ibE(p.type) +
    '<span class="ib-sub">' + _ibE([p.by, _ibDay(p.at)].filter(Boolean).join(' · ')) + '</span>' +
    (IB.may.edit ? '<button type="button" class="ib-link" data-' + (p.hidden ? 'unhide' : 'hide') + '="' + _ibE(p.docId) + '">' + (p.hidden ? 'Show again' : 'Hide') + '</button>' : '') + '</figcaption></figure>';
  return (IB.may.edit ? '<div class="ib-panelbar"><label class="btn btn-secondary btn-sm ib-add">Add a photo<input type="file" accept="image/*" capture="environment" data-act="photo" hidden></label>' +
      '<span class="ib-msg" aria-live="polite"></span></div>' : '') +
    (shown.length ? '<div class="ib-photos">' + shown.map(tile).join('') + '</div>' : '<p class="ib-empty">No photos yet' + (IB.may.edit ? '. Add one, or take one with the scanner.' : '.') + '</p>') +
    (hidden.length && IB.may.edit ? '<details class="ib-group"><summary class="ib-gh"><span>Hidden</span><span class="ib-dim">' + hidden.length + '</span></summary><div class="ib-photos">' + hidden.map(tile).join('') + '</div></details>' : '');
}
function ibLogHtml() {
  const log = IB.card.log || [];
  if (!log.length) return '<p class="ib-empty">No changes to this card yet.</p>';
  return '<ol class="ib-log">' + log.map(l => '<li><span class="ib-lk">' + _ibE(l.kind) + '</span> ' + _ibE(l.note || ((l.from ? l.from + ' → ' : '') + (l.to || ''))) +
    '<span class="ib-sub">' + _ibE([l.by, _ibDay(l.at)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ol>';
}
/** Fill every [data-thumb] in the box, six at a time (the server's limit), from the thumbnails already read. */
async function ibThumbs(box) {
  const it = IB.card && IB.card.item;
  if (!it || !box) return;
  const want = Array.from(box.querySelectorAll('[data-thumb]')).map(el => el.getAttribute('data-thumb')).filter(id => id && !IB.thumbs[id]);
  const uniq = want.filter((x, i) => want.indexOf(x) === i);
  for (let i = 0; i < uniq.length; i += 6) {
    const r = await postFlow('getItemPhotos', { itemId: it.itemId, docIds: JSON.stringify(uniq.slice(i, i + 6)) }).catch(() => null);
    ((r && r.data) || []).forEach(p => { IB.thumbs[p.docId] = 'data:' + p.mimeType + ';base64,' + p.base64; });
    if (IB.open !== it.itemId) return;
  }
  box.querySelectorAll('[data-thumb]').forEach(el => {
    const src = IB.thumbs[el.getAttribute('data-thumb')];
    if (src && !el.querySelector('img')) { const img = document.createElement('img'); img.alt = ''; img.src = src; el.innerHTML = ''; el.appendChild(img); }
  });
}

/* ── wiring: tabs (arrow keys), parts, actions ────────────────────────────────────────────────── */

function ibSegThumb(seg) {
  if (!seg) return;
  const on = seg.querySelector('[aria-selected="true"], [aria-checked="true"]'), th = seg.querySelector('.ib-thumbseg');
  if (on && th && typeof on.offsetLeft === 'number') { th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
}
function ibSegKeys(e, seg, attr, go) {
  const all = Array.from(seg.querySelectorAll('[' + attr + ']')), i = all.indexOf(document.activeElement);
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault();
  const next = e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[(i + step + all.length) % all.length];
  go(next.getAttribute(attr), true);
}
function ibTab(k, focus) {
  IB.tab = k;
  const box = document.querySelector('.ib-detail, .ib-sheet');
  if (!box) return;
  box.querySelectorAll('.ib-tabs [data-tab]').forEach(b => { const on = b.getAttribute('data-tab') === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  box.querySelectorAll('.ib-panel').forEach(p => { p.hidden = p.id !== 'ibPanel-' + k; });
  ibSegThumb(box.querySelector('.ib-tabs'));
  if (k === 'history') { ibSegThumb(box.querySelector('.ib-parts')); ibLoadHistory(); }
  if (k === 'photos') ibThumbs(box);
}
function ibPart(k, focus) {
  IB.part = k;
  ibRedrawHistory();
  if (focus) { const b = document.querySelector('.ib-parts [data-part="' + k + '"]'); if (b) b.focus(); }
}
function ibWire(box) {
  if (!box) return;
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (t) return ibTab(t.getAttribute('data-tab'));
    const p = e.target.closest('[data-part]'); if (p) return ibPart(p.getAttribute('data-part'));
    const o = e.target.closest('[data-pickopen]'); if (o) return ibOpen(o.getAttribute('data-pickopen'), o);
    const h = e.target.closest('[data-hide], [data-unhide]'); if (h) return ibHide(h.getAttribute('data-hide') || h.getAttribute('data-unhide'), h.hasAttribute('data-hide'));
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.getAttribute('data-act');
    if (act === 'edit') ibEdit(a);
    else if (act === 'full') { const d = box.querySelector('.ib-desc'); if (d) { d.textContent = IB.card.item.description; a.remove(); } }
  });
  box.addEventListener('keydown', (e) => {
    const tabs = e.target.closest('.ib-tabs'), parts = e.target.closest('.ib-parts');
    if (tabs) ibSegKeys(e, tabs, 'data-tab', ibTab);
    else if (parts) ibSegKeys(e, parts, 'data-part', ibPart);
  });
  box.addEventListener('change', (e) => { if (e.target.getAttribute('data-act') === 'photo' && e.target.files && e.target.files[0]) ibAddPhoto(e.target.files[0], box); });
}

/* ── changes (admin and the director) ─────────────────────────────────────────────────────────── */

async function ibSave(fields) {
  const it = IB.card.item;
  const r = await postFlow('saveItemDetails', Object.assign({ itemId: it.itemId, ifUpdatedAt: it.updatedAt || '' }, fields)).catch(e => ({ success: false, message: String(e && e.message || e) }));
  return r || { success: false, message: 'No answer from the server.' };
}
async function ibReloadCard() {
  const id = IB.open, r = await postFlow('getItemCard', { itemId: id }).catch(() => null);
  if (r && r.success && r.item && IB.open === id) {
    IB.card = r;
    const row = IB.items.find(x => x.itemId === id);
    if (row) Object.assign(row, { displayName: r.item.displayName, brand: r.item.brand, model: r.item.model, category: r.item.category,
      photos: (r.photos || []).filter(p => !p.hidden).length, details: true });
    ibRender();
    ibDraw();
  }
}
async function ibHide(docId, hide) {
  const before = (IB.card.photos || []).filter(p => p.hidden).map(p => p.docId);
  const after = hide ? before.concat([docId]) : before.filter(x => x !== docId);
  const r = await ibSave({ hideJson: JSON.stringify(after) });
  if (!r.success) return _ibToast(r.message, 'error');
  await ibReloadCard();
  if (typeof hxSnackbar === 'function') hxSnackbar(hide ? 'Photo hidden from the card.' : 'Photo shown again.', { action: 'Undo', onAction: async () => {
    const u = await ibSave({ hideJson: JSON.stringify(before) });
    if (u.success) ibReloadCard(); else _ibToast(u.message, 'error');
  } });
}
async function ibAddPhoto(file, box) {
  const msg = box.querySelector('.ib-msg');
  if (msg) msg.textContent = 'Adding the photo…';
  try {
    const url = await flowDownscaleImage(file, 1600, 0.8);
    const r = await postFlow('uploadScanPhoto', { mode: 'item', docNo: IB.card.item.itemId, base64: String(url).replace(/^data:[^,]*,/, ''), mimeType: 'image/jpeg' });
    if (!r || !r.success) throw new Error((r && r.message) || 'The photo was not saved.');
    _ibToast('Photo added.', 'ok');
    await ibReloadCard();
  } catch (e) { if (msg) msg.textContent = String(e && e.message || e); }
}
function ibEdit(back) {
  const it = IB.card.item, L = IB.lists || { brands: [], categories: [] }, sp = ibmSpecs(it).specs;
  const pick = (name, list, val) => {
    const inList = !val || list.indexOf(val) >= 0;
    return '<select class="ib-in" data-f="' + name + '"><option value="">Not set</option>' + list.map(x => '<option' + ((inList ? val : 'Others') === x ? ' selected' : '') + '>' + _ibE(x) + '</option>').join('') + '</select>' +
      '<input type="text" class="ib-in ib-other" data-f="' + name + 'Other" maxlength="60" placeholder="Type it" value="' + _ibE(inList ? '' : val) + '"' + (inList ? ' hidden' : '') + '>';
  };
  const specRow = (s) => '<div class="ib-specrow"><input type="text" class="ib-in" data-s="k" maxlength="60" placeholder="Label" value="' + _ibE(s[0]) + '">' +
    '<input type="text" class="ib-in" data-s="v" maxlength="400" placeholder="Value" value="' + _ibE(s[1]) + '"><button type="button" class="ib-link" data-rmspec>Remove</button></div>';
  const html = '<form class="ib-form" novalidate><h2 id="ibCardTitle">Edit ' + _ibE(ibmTitle(it)) + '</h2>' +
    '<p class="ib-note">Documents keep printing the full description; these details are the card\'s own.</p>' +
    '<label>Display name<input type="text" class="ib-in" data-f="name" maxlength="120" value="' + _ibE(it.displayName) + '" placeholder="' + _ibE(_ibmShort(it.description, 70)) + '"></label>' +
    '<div class="ib-grid2"><label>Brand' + pick('brand', L.brands || [], it.brand) + '</label><label>Model<input type="text" class="ib-in" data-f="model" maxlength="60" value="' + _ibE(it.model) + '"></label></div>' +
    '<label>Type' + pick('category', L.categories || [], it.category) + '</label>' +
    '<fieldset class="ib-specsed"><legend>Specs</legend><div data-specs>' + (sp.length ? sp : [['', '']]).map(specRow).join('') + '</div>' +
    '<button type="button" class="ib-link" data-addspec>Add a spec</button></fieldset>' +
    '<label>Notes<textarea class="ib-in" data-f="notes" rows="3" maxlength="1000">' + _ibE(it.notes) + '</textarea></label>' +
    '<p class="ib-msg" aria-live="polite"></p><div class="ib-formfoot"><button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
    '<button type="submit" class="btn btn-primary primary">Save</button></div></form>';
  IB.back = back;
  const box = IB.sv.show(html, { key: 'edit-' + it.itemId });
  const form = box.querySelector('form'), msg = box.querySelector('.ib-msg');
  form.addEventListener('change', (e) => {
    const f = e.target.getAttribute('data-f');
    if (f === 'brand' || f === 'category') { const o = form.querySelector('[data-f="' + f + 'Other"]'); o.hidden = e.target.value !== 'Others'; if (!o.hidden) o.focus(); }
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-addspec]')) { form.querySelector('[data-specs]').insertAdjacentHTML('beforeend', specRow(['', ''])); form.querySelector('[data-specs] .ib-specrow:last-child input').focus(); }
    const rm = e.target.closest('[data-rmspec]'); if (rm) rm.closest('.ib-specrow').remove();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (k) => { const el = form.querySelector('[data-f="' + k + '"]'); return el ? el.value : ''; };
    const specs = ibmSpecRows(Array.from(form.querySelectorAll('.ib-specrow')).map(r => [r.querySelector('[data-s="k"]').value, r.querySelector('[data-s="v"]').value]));
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; msg.textContent = 'Saving…'; msg.className = 'ib-msg';
    const r = await ibSave({ name: v('name'), brand: v('brand'), brandOther: v('brandOther'), model: v('model'), category: v('category'), categoryOther: v('categoryOther'),
                             specsJson: JSON.stringify(specs), notes: v('notes') });
    btn.disabled = false;
    if (!r.success) { msg.textContent = r.message || 'Not saved.'; msg.className = 'ib-msg bad'; return; }
    IB.sv.close();
    _ibToast(r.unchanged ? 'Nothing changed.' : r.message, 'ok');
    await ibReloadCard();
  });
  const first = form.querySelector('[data-f="name"]');
  if (first) first.focus();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { IB, ibRow, ibOverview, ibPartHtml };
