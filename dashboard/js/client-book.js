/* client-book.js — A350 · the Client Book page (director-client-book.html), a private trial for the director.
 *
 * The list, its filters and summary chips, and one client's full detail: contact people (several, each with several
 * emails and phones), accreditation with its history, the sales status once accredited (with what the portal's records
 * say), the client's purchase requests, quotations and sales orders, the Sales Daily Report lines about it, and the
 * whole timeline. The numbers and matching are js/client-book-model.js (pure, tested). Saving is the trial's own four
 * actions (FlowAPI 178): nothing here writes the real client list, PRs or quotations.
 *
 * A362 (Neil, 22 Oct 2026: "its too long … re design it … using apple design skill"): laid out like Contacts on a Mac.
 * A compact list on the left and the client on the right, each scrolling on its own, so the page fits the window; on a
 * tablet or phone the client opens as a sheet. The client is four tabs — Overview, Records, Contacts, Timeline — under a
 * sticky header, and every form waits behind its own Update / Edit button. */

const CB = { me: null, all: true, ix: null, raw: null, clients: [], log: [], lists: null, reports: [], roster: [], ok: true, okMsg: '', open: '', back: null, built: false, v180: false, v183: false,
             tab: 'overview', wasSplit: null,
             f: { q: '', accreditation: '', tier: '', sector: '', status: '', owner: '', flag: '', archived: false, sort: 'updated' } };

function _cbE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _cbId(id) { return document.getElementById(id); }
function _cbLists() { return CB.lists || { accreditation: CB_ACCRED, steps: CB_STEPS, status: CB_STATUS, tiers: CB_TIERS, sectors: CB_SECTORS }; }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireClientBookAccess === 'function' ? requireClientBookAccess() : null;   // A358 — the director and the sales reps
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('director-client-book');
  if (typeof hxDatePill === 'function') hxDatePill('long');
  CB.me = String(s.name || s.username || '').trim();
  CB.all = s.role === 'director';   // a rep sees their own clients (the server scopes the rows) and owns every client they add
  if (!CB.all) cbRepHeader();
  _cbId('cbAdd').addEventListener('click', (e) => cbAddDialog(e.currentTarget));
  _cbId('cbExport').addEventListener('click', cbExport);
  _cbId('cbChips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) cbChip(b.getAttribute('data-chip')); });
  _cbId('cbTable').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) cbDetail(b.getAttribute('data-open'), b); });
  _cbId('cbTable').addEventListener('keydown', cbListKeys);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', cbOnResize);
  await cbLoad();
});

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

async function cbLoad() {
  _cbId('cbTable').innerHTML = '<p class="cb-empty">Reading the Client Book…</p>';
  const today = flowToday(), from = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 120); return d.toISOString().slice(0, 10); })();
  const read = (a, p) => fetchFlow(a, p || {}).then(r => (r && r.success !== false ? r.data : null)).catch(() => null);
  CB.v180 = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(180).catch(() => false) : false;   // A354 — the Major / Minor label saves from 180
  CB.v183 = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(183).catch(() => false) : false;   // A360 — connecting past records from 183
  CB.v186 = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(186).catch(() => false) : false;   // A369 — the head office address from 186
  const [book, quotations, prs, salesOrders, clients, activity, users, reports] = await Promise.all([
    postFlow('getClientBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) })),
    read('getQuotations'), read('getPricingRequests'), read('getSalesOrders'), read('getClients'),
    read('getActivityLog', { from, to: today }),
    // A358 — the owner list and the Sales Daily Report trial are the director's; a rep reads neither
    CB.all && typeof apiGetUsers === 'function' ? apiGetUsers().then(r => (r && (r.data || r.users)) || []).catch(() => []) : Promise.resolve([]),
    CB.all ? postFlow('getProofReports', { from, to: today }).then(r => (r && r.success ? r.data || [] : [])).catch(() => []) : Promise.resolve([])
  ]);
  CB.raw = { today, quotations, prs, salesOrders, clients, activity };   // cbTakeBook indexes it with the book's links
  CB.reports = reports;
  CB.roster = (users || []).filter(u => String(u.role || '').toLowerCase() === 'sales').map(u => String(u.fullName || u.name || u.username || '').trim()).filter(Boolean).sort();
  cbTakeBook(book);
  cbRender();
  const ask = new URLSearchParams(location.search || '').get('client');   // a Sales Daily Report line links here
  if (ask && CB.clients.some(c => c.clientNo === ask)) cbDetail(ask, null);
  else if (cbSplit()) { const first = cbFilter(CB.clients, CB.log, CB.ix, CB.f)[0]; if (first) cbDetail(first.clientNo, null); else cbPaneEmpty(); }
  CB.wasSplit = cbSplit();
  cbFit();
}
function cbTakeBook(book) {
  CB.ok = !!(book && book.success);
  CB.okMsg = CB.ok ? '' : (book && book.message) || '';
  CB.clients = CB.ok ? book.clients || [] : [];
  CB.log = CB.ok ? book.log || [] : [];
  if (CB.ok && book.lists) CB.lists = book.lists;
  CB.ix = cbIndex(Object.assign({}, CB.raw || {}, { links: CB.ok ? book.links || [] : [] }));   // A360 — records connected by hand
}
async function cbReload() {
  const book = await postFlow('getClientBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) }));
  cbTakeBook(book);
  cbRender();
  if (CB.open) cbDetail(CB.open, CB.back);
}

/** A358 — a rep's page: their own clients. */
function cbRepHeader() {
  const h = _cbId('cbH1'), p = _cbId('cbLede'), t = _cbId('cbTrial');
  if (h) h.textContent = 'My clients';
  if (p) p.textContent = 'Your clients with their people, accreditation and sales status. Pick a client on a new purchase request to keep it with them.';
  if (t) t.textContent = 'Only you and the director see these';
}

/* ── A362 · the split view ──────────────────────────────────────────────────────────────────────── */

const CB_SPLIT_MQ = '(min-width: 1180px)';
/** Wide enough to show the client beside the list (otherwise it opens as a sheet). */
function cbSplit() {
  try { return !!_cbId('cbPane') && !!(window.matchMedia && window.matchMedia(CB_SPLIT_MQ).matches); } catch (e) { return false; }
}
/** The list and the client fill the rest of the window, so the page never grows past the screen. */
function cbFit() {
  const sp = _cbId('cbSplit');
  if (!sp || !sp.getBoundingClientRect || !sp.style || !sp.style.setProperty) return;
  if (!cbSplit()) { sp.style.removeProperty('--cb-h'); return; }
  const top = sp.getBoundingClientRect().top + (window.scrollY || 0);
  const h = Math.max(440, Math.round(window.innerHeight - top - 20));
  sp.style.setProperty('--cb-h', h + 'px');
  const over = document.documentElement.scrollHeight - window.innerHeight;   // the page's own bottom padding
  if (over > 0 && h - over >= 440) sp.style.setProperty('--cb-h', (h - over) + 'px');
}
function cbOnResize() {
  const now = cbSplit();
  if (now !== CB.wasSplit) {
    CB.wasSplit = now;
    if (now && CB.open) cbDetail(CB.open, CB.back);          // the open sheet moves into the pane
    else if (now) cbPaneEmpty();
    else CB.open = '';                                       // the pane is gone; a tap opens the sheet
  }
  cbFit();
}
function cbPaneEmpty() {
  const pane = _cbId('cbPane');
  if (pane) pane.innerHTML = '<div class="cb-pane-empty"><p>' + (CB.clients.length ? 'Choose a client to see their people, accreditation, sales status and records.' : 'Your clients will show here.') + '</p></div>';
}
/** Up and down move through the list (and open the client beside it). */
function cbListKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = Array.prototype.slice.call(_cbId('cbTable').querySelectorAll('.cb-open')), i = all.indexOf(document.activeElement);
  const next = all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (cbSplit()) cbDetail(next.getAttribute('data-open'), next);
}
/** The open client is marked in the list. */
function cbMarkOpen() {
  const t = _cbId('cbTable');
  if (!t || !t.querySelectorAll) return;
  t.querySelectorAll('.cb-open').forEach(b => {
    const on = b.getAttribute('data-open') === CB.open;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    if (on && cbSplit() && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });   // opened from a link or the keys
  });
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function cbRender() {
  const n = _cbId('cbNotice');
  n.innerHTML = CB.ok ? '' : '<div class="cb-notice' + (/Unknown action|not a secured action/i.test(CB.okMsg) ? '' : ' bad') + '">' + (/Unknown action|not a secured action/i.test(CB.okMsg)
    ? 'The Client Book needs the FlowAPI update (version 178). Until it is pasted nothing can be saved here.'
    : !CB.all && /trial/i.test(CB.okMsg) ? 'Your Client Book opens with the next FlowAPI update (version 182). Nothing is lost meanwhile.'
    : 'Could not read the Client Book: ' + _cbE(CB.okMsg)) + '</div>';
  _cbId('cbAdd').disabled = !CB.ok;
  const sum = cbSummary(CB.clients, CB.log, CB.ix.today), f = CB.f;
  // A362 — a chip with nothing in it is left out (All stays, and so does the chip you are on)
  const chip = (key, label, count) => (!count && key !== 'all' && !cbChipOn(key)) ? '' : '<button type="button" class="cb-chip' + (cbChipOn(key) ? ' on' : '') + '" data-chip="' + key + '" aria-pressed="' + cbChipOn(key) + '">' +
    _cbE(label) + ' <span class="n">' + count + '</span></button>';
  _cbId('cbChips').innerHTML = chip('all', 'All clients', sum.total) + chip('t:Major', 'Major', sum.major) + chip('t:Minor', 'Minor', sum.minor) +
    (sum.noLabel ? chip('t:none', 'No label', sum.noLabel) : '') +   // A361 — imported clients wait for their Major / Minor label
    chip('a:Accredited', 'Accredited', sum.accredited) + chip('a:On process', 'On process', sum.onProcess) +
    chip('a:Not accredited', 'Not accredited', sum.notAccredited) + chip('f:needsUpdate', 'Needs an update', sum.needsUpdate) +
    chip('f:expiring', 'Accreditation expiring', sum.expiring) + chip('f:nextOverdue', 'Next step overdue', sum.nextOverdue) + chip('archived', 'Archived', sum.archived);
  const owners = Array.from(new Set(CB.roster.concat(CB.clients.map(c => c.owner).filter(Boolean)))).sort();
  const opt = (v, cur, label) => '<option value="' + _cbE(v) + '"' + (v === cur ? ' selected' : '') + '>' + _cbE(label || v) + '</option>';
  if (!CB.built) {
    CB.built = true;
    _cbId('cbFilters').innerHTML =
      '<label class="cb-search"><span class="cb-sr">Search</span><input type="search" id="cbQ" placeholder="Search company, contact, email or phone" autocomplete="off"></label>' +
      '<label><span class="cb-sr">Sector</span><select id="cbSector"></select></label>' +
      '<label><span class="cb-sr">Status</span><select id="cbStatus"></select></label>' + (CB.all ? '<label><span class="cb-sr">Owner</span><select id="cbOwner"></select></label>' : '') +
      '<label><span class="cb-sr">Sort</span><select id="cbSort">' + [['updated', 'Sort: last update'], ['company', 'Sort: company'], ['next', 'Sort: next step date'], ['open', 'Sort: open quotations']].map(x => opt(x[0], f.sort, x[1])).join('') + '</select></label>';
    _cbId('cbQ').addEventListener('input', (e) => { f.q = e.target.value; cbRenderTable(); });
    ['cbSector', 'cbStatus', 'cbOwner', 'cbSort'].filter(id => _cbId(id)).forEach(id => _cbId(id).addEventListener('change', (e) => {
      f[{ cbSector: 'sector', cbStatus: 'status', cbOwner: 'owner', cbSort: 'sort' }[id]] = e.target.value; cbRenderTable();
    }));
  }
  _cbId('cbSector').innerHTML = opt('', f.sector, 'Any sector') + CB_SECTORS.map(s => opt(s, f.sector)).join('');
  _cbId('cbStatus').innerHTML = opt('', f.status, 'Any status') + _cbLists().status.map(s => opt(s, f.status)).join('');
  if (_cbId('cbOwner')) _cbId('cbOwner').innerHTML = opt('', f.owner, 'Any owner') + owners.map(o => opt(o, f.owner)).join('');
  cbRenderTable();
  cbFit();
}
function cbChipOn(key) {
  const f = CB.f;
  if (key === 'all') return !f.accreditation && !f.tier && !f.flag && !f.archived;
  if (key === 'archived') return f.archived;
  if (key.indexOf('a:') === 0) return !f.archived && f.accreditation === key.slice(2);
  if (key.indexOf('t:') === 0) return !f.archived && f.tier === key.slice(2);
  return !f.archived && f.flag === key.slice(2);
}
function cbChip(key) {
  const f = CB.f;
  f.accreditation = ''; f.tier = ''; f.flag = ''; f.archived = false;
  if (key === 'archived') f.archived = true;
  else if (key.indexOf('a:') === 0) f.accreditation = key.slice(2);
  else if (key.indexOf('t:') === 0) f.tier = key.slice(2);
  else if (key.indexOf('f:') === 0) f.flag = key.slice(2);
  cbRender();
}

function cbRenderTable() {
  const rows = cbFilter(CB.clients, CB.log, CB.ix, CB.f);
  const t = _cbId('cbTable');
  if (!CB.clients.length) {
    t.innerHTML = '<p class="cb-empty">' + (CB.ok ? 'No clients yet. Press Add client to start the book.' : 'Nothing to show yet.') + '</p>';
    _cbId('cbFoot').textContent = '';
    return;
  }
  t.innerHTML = rows.length ? rows.map(cbRow).join('') : '<p class="cb-empty">No client matches.</p>';
  const of = CB.clients.filter(c => !!c.archivedAt === CB.f.archived).length;
  _cbId('cbFoot').textContent = (rows.length === of ? of + (of === 1 ? ' client' : ' clients') : rows.length + ' of ' + of + ' clients') + (CB.f.archived ? ', archived' : '');
}

function cbBadge(text, tone) { return '<span class="cb-badge ' + (tone || '') + '">' + _cbE(text) + '</span>'; }
/* A354 — Major / Minor */
function cbTierBadge(t) { return t ? '<span class="cb-badge tier-' + _cbE(t.toLowerCase()) + '">' + _cbE(t) + '</span>' : '<span class="cb-badge tier-none">No label</span>'; }
function cbTierPills(cur, required) {
  return '<fieldset class="cb-pills cb-tier"><legend>Major or minor client</legend>' + CB_TIERS.map(t => '<label class="cb-pill"><input type="radio" name="tier" value="' + t + '"' +
      (cur === t ? ' checked' : '') + (required && CB.v180 ? ' required' : '') + (CB.v180 ? '' : ' disabled') + '><span>' + t + '</span></label>').join('') +
    (CB.v180 ? '' : '<span class="cb-sub">The label is saved once the FlowAPI update (180) is pasted.</span>') + '</fieldset>';
}
function cbTierOf(form) { const r = Array.prototype.find.call(form.querySelectorAll('input[name="tier"]'), x => x.checked); return r ? r.value : ''; }
/* A354 — the industry, and the site's address. A369 — two addresses: the plant (stored as 'Site Address') and the head office. */
function cbSectorBadge(s) { return s ? '<span class="cb-badge sector">' + _cbE(s) + '</span>' : '<span class="cb-badge tier-none">No sector</span>'; }
function cbLabels(c) { return '<span class="cb-labels">' + cbTierBadge(c.tier) + cbSectorBadge(c.sector) + '</span>'; }
function cbSectorFields(cur, required) {
  const listed = CB_SECTORS.indexOf(cur) >= 0, pick = !cur ? '' : listed ? cur : 'Others', off = CB.v180 ? '' : ' disabled';
  return '<div class="cb-grid2"><label>Industry or sector<select class="cb-in" name="sector"' + (required && CB.v180 ? ' required' : '') + off + '>' +
      (required ? '<option value="">Choose…</option>' : '') + CB_SECTORS.map(x => '<option' + (x === pick ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
    '<label class="cb-other"' + (pick === 'Others' ? '' : ' hidden') + '>Which industry?<input type="text" class="cb-in" name="sectorOther" maxlength="60" value="' + _cbE(listed || cur === 'Others' ? '' : cur) + '" placeholder="Shipbuilding"' + off + '></label></div>' +
    '<div class="cb-grid2"><label>Plant address<textarea class="cb-in" name="siteAddress" rows="2" maxlength="300" placeholder="Plant / site, barangay, city, province"' + off + '></textarea></label>' +
    '<label>Head office address<textarea class="cb-in" name="headOfficeAddress" rows="2" maxlength="300" placeholder="Building, street, city"' + (CB.v186 ? '' : ' disabled') + '></textarea>' +
      (CB.v186 ? '' : '<span class="cb-sub">Saved once the FlowAPI update (186) is pasted.</span>') + '</label></div>';
}
function cbWireSector(form, site, head) {
  const sel = form.querySelector('select[name="sector"]'), other = form.querySelector('.cb-other'), ta = form.querySelector('textarea[name="siteAddress"]');
  const ho = form.querySelector('textarea[name="headOfficeAddress"]');
  if (ta && site) ta.value = site;
  if (ho && head) ho.value = head;
  if (sel && other) sel.addEventListener('change', () => { other.hidden = sel.value !== 'Others'; });
}
function cbSectorOf(form) {
  const sel = form.querySelector('select[name="sector"]'), other = form.querySelector('input[name="sectorOther"]');
  const v = sel ? sel.value : '';
  return v === 'Others' && other && other.value.trim() ? other.value.trim() : v;
}
function cbAccTone(a) { return a === 'Accredited' ? 'ok' : a === 'On process' ? 'mid' : 'off'; }
function cbStatusTone(s) { return s === 'PO received' ? 'ok' : s === 'Lost' || s === 'No requirement now' ? 'off' : s ? 'mid' : ''; }

/** A362 — a day in the list: "22 Oct" this year, "22 Oct 2025" before. */
function cbShortDay(v) { const d = cbDay(v), y = String(CB.ix && CB.ix.today || '').slice(0, 4); return y && d.slice(-4) === y ? d.slice(0, -5) : d; }
/** A362 — the town of a site address: its last two parts ("Brgy. Bigte, Norzagaray, Bulacan" → "Norzagaray, Bulacan"). */
function cbPlace(addr) { const parts = String(addr || '').split(',').map(x => x.trim()).filter(Boolean); return parts.slice(-2).join(', '); }

/** One client in the list: three short lines — the company and its last update; its label, industry, town (and owner,
 *  for the director); its accreditation and sales status, its records, and anything that needs attention. */
function cbRow(c) {
  const fl = cbFlags(c, CB.log, CB.clients, CB.ix.today), r = cbRecords(CB.ix, c), say = cbRecordsSay(r, c);
  const meta = [c.tier ? _cbE(c.tier) : '<span class="cb-nolabel">No label</span>', c.sector ? _cbE(c.sector) : '<span class="cb-nolabel">No sector</span>',
    _cbE(cbPlace(c.siteAddress || c.headOfficeAddress)), CB.all ? _cbE(c.owner || 'No owner') : ''].filter(Boolean).join(' · ');
  const acc = cbBadge(c.accreditation, cbAccTone(c.accreditation)) + (c.accreditation === 'Accredited'
      ? (c.accreditedUntil ? ' <span class="' + (fl.expired || fl.expiring ? 'cb-warnt' : '') + '">' + (fl.expired ? 'expired ' : 'until ') + _cbE(cbDay(c.accreditedUntil)) + '</span>' : '')
      : (c.accreditationStep ? ' ' + _cbE(c.accreditationStep) : ''));
  const recs = r.total ? r.prs.length + ' PR' + (r.prs.length === 1 ? '' : 's') + ' · ' + r.quotes.length + ' quotation' + (r.quotes.length === 1 ? '' : 's') + (r.openValue ? ' · ' + cbMoney(r.openValue) + ' open' : '') : '';
  const flags = [fl.twins.length ? 'Possible duplicate' : '', fl.needsUpdate ? 'Not updated in ' + fl.daysSince + ' days' : '', fl.nextOverdue ? 'Next step overdue (' + cbDay(c.nextStepDate) + ')' : ''].filter(Boolean);
  return '<div class="cb-item" role="listitem"><button type="button" class="cb-open' + (c.archivedAt ? ' archived' : '') + (CB.open === c.clientNo ? ' on" aria-current="true' : '') + '" data-open="' + _cbE(c.clientNo) + '">' +
    '<span class="cb-r1"><span class="cb-name">' + _cbE(c.company) + '</span><span class="cb-when">' + (c.archivedAt ? 'Archived' : _cbE(cbShortDay(fl.lastUpdate) || '')) + '</span></span>' +
    '<span class="cb-r2">' + meta + '</span>' +
    '<span class="cb-r3">' + acc + (c.status ? ' ' + cbBadge(c.status, cbStatusTone(c.status)) : '') + (recs ? ' <span>' + _cbE(recs) + '</span>' : '') + '</span>' +
    (flags.length || (say && say.suggest) ? '<span class="cb-r4">' + flags.map(x => '<span class="cb-flag">' + _cbE(x) + '</span>').join('') +
      (say && say.suggest ? '<span class="cb-say">Records say: ' + _cbE(say.status) + '</span>' : '') + '</span>' : '') +
    '</button></div>';
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
/** Show a client (o.pane: beside the list when there is room) or a form (always a sheet over the page). Each showing
 *  is a fresh element, so the listeners of the last one never pile up on the next. */
function cbShow(html, back, o) {
  CB.back = back || CB.back;
  if (o && o.pane && cbSplit()) {
    const ov = _cbId('cbOverlay');
    if (ov && ov.classList.contains('open')) { ov.classList.remove('open'); document.body.classList.remove('cb-open-dlg'); }
    const pane = _cbId('cbPane'), was = pane.querySelector('.cb-sheet'), same = !!was && was.getAttribute('data-no') === CB.open, top = pane.scrollTop;
    pane.innerHTML = '<div class="cb-sheet cb-detail' + (same ? '' : ' cb-enter') + '" data-no="' + _cbE(CB.open) + '">' + html + '</div>';
    pane.scrollTop = same ? top : 0;
    return pane.firstChild;
  }
  const ov = cbOverlay(), box = ov.querySelector('.cb-modal');
  box.innerHTML = '<div class="cb-sheet' + (o && o.pane ? ' cb-detail' : '') + '">' + html + '</div>';
  ov.classList.add('open');
  document.body.classList.add('cb-open-dlg');
  return box.firstChild;
}
/** Where the open client is drawn now. */
function cbHost() { return (cbSplit() && _cbId('cbPane')) || cbOverlay(); }
function cbClose() {
  const ov = _cbId('cbOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('cb-open-dlg');
  if (!cbSplit()) CB.open = '';                              // beside the list the client stays open
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
      '<p class="cb-warn" id="cbDup" hidden></p>' + cbTierPills('', true) + cbSectorFields('', true) +
      '<div class="cb-grid2">' + (CB.all ? '<label>Owner (sales rep)<span id="cbOwnerBox">' + cbOwnerSelect('', '') + '</span></label>' : '') +
      '<label>Accreditation<select class="cb-in" name="accreditation">' + _cbLists().accreditation.map(a => '<option' + (a === 'Not accredited' ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label></div>' +
      '<div class="cb-people">' + cbPersonHtml({ primary: true }, 0) + '</div>' +
      '<button type="button" class="btn btn-secondary cb-addperson" data-addperson>Add another person</button>' +
      '<div class="cb-grid2"><label>Next step<input type="text" class="cb-in" name="nextStep" maxlength="190" placeholder="Send the vendor accreditation forms"></label>' +
      '<label>Next step date<input type="date" class="cb-in" name="nextStepDate"></label></div>' +
      '<label>Notes<textarea class="cb-in" name="notes" rows="2" maxlength="2000"></textarea></label>' +
      '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Add the client</button></div></form>', back);
  cbWirePeople(box);
  const form = box.querySelector('#cbAddForm');
  cbWireSector(form, '');
  const company = form.elements.company;
  company.addEventListener('input', () => {
    const v = company.value.trim(), twin = cbTwinOf(v);
    const dup = _cbId('cbDup');
    dup.hidden = !twin;
    if (twin) dup.innerHTML = '"' + _cbE(twin.company) + '" is already in the book. <button type="button" class="cb-link" data-open-twin="' + _cbE(twin.clientNo) + '">Open it</button>';
    if (!_cbId('cbOwnerBox')) return;                    // a rep owns what they add
    const sug = v ? cbOwnerSuggest(CB.ix, v) : '';
    const cur = form.elements.owner.value;
    _cbId('cbOwnerBox').innerHTML = cbOwnerSelect(cur, sug);
  });
  box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-open-twin]'); if (b) cbDetail(b.getAttribute('data-open-twin'), CB.back); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const params = { company: company.value.trim(), owner: form.elements.owner ? form.elements.owner.value : '', accreditation: form.elements.accreditation.value,
                     contactsJson: JSON.stringify(cbReadPeople(box)), nextStep: form.elements.nextStep.value.trim(), nextStepDate: form.elements.nextStepDate.value,
                     notes: form.elements.notes.value.trim() };
    if (form.dataset.allow === '1') params.allowDuplicate = true;
    if (CB.v180) {
      params.tier = cbTierOf(form);
      if (!params.tier) { cbMsg(box, 'Choose Major or Minor first.', true); return; }
      params.sector = cbSectorOf(form);
      if (!params.sector) { cbMsg(box, 'Choose the industry first.', true); return; }
      params.siteAddress = form.elements.siteAddress.value.trim();
    }
    if (CB.v186) params.headOfficeAddress = form.elements.headOfficeAddress.value.trim();   // A369
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

/* One client's detail. A362: a header that stays put (the company, its labels, the tabs) over four tabs — Overview,
   Records, Contacts, Timeline. Every panel is drawn at once and the tabs only show one, so a form keeps what was typed
   when you look elsewhere; every form waits behind its own Update / Edit button. */
const CB_TABS = ['overview', 'records', 'contacts', 'timeline'];
function cbDetail(no, back) {
  const c = CB.clients.find(x => x.clientNo === no);
  if (!c) return;
  CB.open = no;
  if (CB_TABS.indexOf(CB.tab) < 0) CB.tab = 'overview';
  const lists = _cbLists(), r = cbRecords(CB.ix, c), say = cbRecordsSay(r, c), fl = cbFlags(c, CB.log, CB.clients, CB.ix.today);
  const log = cbLogFor(CB.log, no), acc = cbAccredLast(c, CB.log), lines = cbDayLines(CB.reports, c), people = c.contacts || [], main = cbPrimary(c);
  const live = !c.archivedAt && CB.ok;
  const refOpts = r.quotes.map(q => ({ v: q.ref, l: 'Quotation ' + q.ref + ' — ' + q.status })).concat(r.prs.map(p => ({ v: p.ref, l: 'PR ' + p.ref + ' — ' + p.status })))
    .concat(r.sos.map(s => ({ v: s.ref, l: 'Sales order ' + s.ref })));
  const link = (kind, ref) => kind === 'pr' ? '<a href="flow-pricing-request.html?pr=' + encodeURIComponent(ref) + '">' + _cbE(ref) + '</a>'
    : kind === 'quotation' ? '<a href="flow-quotations.html?review=' + encodeURIComponent(ref) + '">' + _cbE(ref) + '</a>' : '<b>' + _cbE(ref) + '</b>';
  /* A360 — from FlowAPI 183 a record can be connected here (Link), taken off (Take off), or found and connected below.
     A rep only connects their own records (the server checks it too); a sales order follows its quotation. */
  const canLink = live && CB.v183;
  const mineRec = (x) => CB.all || (x.owners || []).some(o => o.toLowerCase() === String(CB.me || '').toLowerCase());
  const HOW = { made: 'Linked on the PR', linked: 'Linked', pr: 'Through its PR', quotation: 'Through its quotation' };
  const key = (x) => _cbE(x.kind + '|' + x.ref);
  const act = (x) => !canLink || x.kind === 'so' ? '' : x.linked
    ? (x.how === 'quotation' ? '' : '<button type="button" class="cb-recbtn" data-unlink="' + key(x) + '">Take off</button>')
    : (mineRec(x) ? '<button type="button" class="cb-recbtn" data-link="' + key(x) + '">Link</button>' : '');
  const recRow = (x) => '<li><span class="tm">' + _cbE(cbDay(x.date)) + '</span><span>' + link(x.kind, x.ref) + (x.linked ? ' <span class="cb-badge ok">' + (HOW[x.how] || 'Linked') + '</span>' : '') + ' <span class="cb-sub">' + _cbE(x.status || '') +
    (x.owner ? ' · ' + _cbE(x.owner) : '') + (x.followUpDue ? ' · day-' + x.followUpDue + ' follow-up due today' : '') + '</span></span><span class="cb-recend">' + (x.value ? '<span class="amt">' + _cbE(cbMoney(x.value)) + '</span>' : '') + act(x) + '</span></li>';
  const withName = (n) => { const o = CB.clients.find(k => k.clientNo === n); return o ? o.company : n; };
  const findRow = (x) => '<li><span class="tm">' + _cbE(cbDay(x.date)) + '</span><span>' + link(x.kind, x.ref) + ' ' + _cbE(x.customer) + ' <span class="cb-sub">' + _cbE(x.status || '') +
    (x.owner ? ' · ' + _cbE(x.owner) : '') + (x.linkedTo ? ' · now with ' + _cbE(withName(x.linkedTo)) : '') + '</span></span><span class="cb-recend">' + (x.value ? '<span class="amt">' + _cbE(cbMoney(x.value)) + '</span>' : '') +
    '<button type="button" class="cb-recbtn" data-link="' + key(x) + '">' + (x.linkedTo ? 'Move here' : 'Link') + '</button></span></li>';
  const loose = canLink ? r.prs.concat(r.quotes).filter(x => !x.linked && mineRec(x)) : [];
  const clientNos = {}; CB.clients.forEach(k => { clientNos[k.clientNo] = 1; });
  const sugg = canLink ? cbFindRecords(CB.ix, c, { me: CB.me, all: CB.all, clientNos }) : { items: [], more: 0 };

  const tab = (id, label, n) => '<button type="button" role="tab" class="cb-tab" id="cbTab-' + id + '" aria-controls="cbPanel-' + id + '" aria-selected="' + (CB.tab === id) + '"' +
    ' tabindex="' + (CB.tab === id ? 0 : -1) + '" data-tab="' + id + '">' + label + (n ? ' <span class="n">' + n + '</span>' : '') + '</button>';
  const panel = (id, html) => '<div class="cb-panel" role="tabpanel" id="cbPanel-' + id + '" aria-labelledby="cbTab-' + id + '"' + (CB.tab === id ? '' : ' hidden') + '>' + html + '</div>';
  const fact = (label, value, action, form) => '<div class="cb-fact"><span class="cb-fk">' + label + '</span><span class="cb-fv">' + value + '</span>' + (action || '') + (form || '') + '</div>';
  const reveal = (id, label) => live ? '<button type="button" class="cb-recbtn cb-act" data-reveal="' + id + '" aria-expanded="false" aria-controls="' + id + '">' + label + '</button>' : '';
  const goto = (id, label) => '<button type="button" class="cb-recbtn cb-act" data-goto="' + id + '">' + label + '</button>';
  const mail = (e) => '<a href="mailto:' + _cbE(e) + '">' + _cbE(e) + '</a>', tel = (t) => '<a href="tel:' + _cbE(String(t).replace(/[^\d+]/g, '')) + '">' + _cbE(t) + '</a>';

  const head = '<header class="cb-dhead"><div class="cb-dtop"><div class="cb-dtitle"><h3 id="cbTitle">' + _cbE(c.company) + '</h3>' +
      '<p class="cb-sub">' + cbLabels(c) + ' ' + cbBadge(c.accreditation, cbAccTone(c.accreditation)) + (c.status ? ' ' + cbBadge(c.status, cbStatusTone(c.status)) : '') +
      (c.archivedAt ? ' ' + cbBadge('Archived', 'off') : '') + '</p>' +
      '<p class="cb-dmeta">' + [_cbE(c.clientNo), CB.all ? _cbE(c.owner || 'No owner') : '', c.siteAddress ? 'Plant: ' + _cbE(cbPlace(c.siteAddress)) : '', c.headOfficeAddress ? 'Head office: ' + _cbE(cbPlace(c.headOfficeAddress)) : ''].filter(Boolean).join(' · ') + '</p></div>' +
      '<button type="button" class="btn btn-secondary cb-close" data-close>Close</button></div>' +
    '<div class="cb-tabs" role="tablist" aria-label="About ' + _cbE(c.company) + '">' + tab('overview', 'Overview') + tab('records', 'Records', r.total) +
      tab('contacts', 'Contacts', people.length) + tab('timeline', 'Timeline', log.length) + '</div></header>';

  const warns = (fl.twins.length ? '<p class="cb-warn">Possible duplicate of ' + _cbE(fl.twins.join(', ')) + ' (the same company).</p>' : '') +
    (c.archivedAt ? '<p class="cb-warn">Archived ' + _cbE(cbDay(c.archivedAt)) + ': ' + _cbE(c.archiveReason) + '</p>' : '');

  const accForm = live ? '<form class="cb-form cb-subform" data-kind="accreditation" id="cbAccForm" hidden><fieldset class="cb-pills"><legend class="cb-sr">Accreditation</legend>' +
      lists.accreditation.map(a => '<label class="cb-pill"><input type="radio" name="pick" value="' + a + '"' + (a === c.accreditation ? ' checked' : '') + '><span>' + a + '</span></label>').join('') + '</fieldset>' +
      '<div class="cb-grid2"><label>Step (on process)<select class="cb-in" name="step"><option value="">—</option>' + lists.steps.map(s => '<option' + (s === c.accreditationStep ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
      '<label>Accredited until<input type="date" class="cb-in" name="until" value="' + _cbE(c.accreditedUntil) + '"></label></div>' +
      '<label>What changed (one line)<input type="text" class="cb-in" name="note" maxlength="500" placeholder="Vendor forms submitted to purchasing"></label>' +
      '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Save the accreditation update</button></div></form>' : '';
  const statusForm = live ? '<form class="cb-form cb-subform" data-kind="status" id="cbStatusForm" hidden><div class="cb-grid2"><label>Status<select class="cb-in" name="pick">' + lists.status.map(s => '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
      '<label>Linked to<select class="cb-in" name="ref"><option value="">No record</option>' + refOpts.map(o => '<option value="' + _cbE(o.v) + '"' + (o.v === c.statusRef ? ' selected' : '') + '>' + _cbE(o.l) + '</option>').join('') + '</select></label></div>' +
      '<label>What changed (one line)<input type="text" class="cb-in" name="note" maxlength="500"></label>' +
      '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Save the status</button></div></form>' : '';
  const accText = c.accreditation === 'Accredited'
    ? (c.accreditedUntil ? 'until ' + _cbE(cbDay(c.accreditedUntil)) + (fl.expired ? ' — <span class="cb-warnt">expired</span>' : fl.expiring ? ' — <span class="cb-warnt">expiring soon</span>' : '') : '')
    : (c.accreditationStep ? _cbE(c.accreditationStep) + ' · ' : '') + 'last update ' + _cbE(cbDay(acc.at) || '—') + (acc.note ? ': ' + _cbE(acc.note) : '');
  const SR_SHOWN = 4;
  const overview = warns +
    (say && say.status !== c.status ? '<div class="cb-sayline' + (say.suggest ? ' on' : '') + '"><span>The records say: <b>' + _cbE(say.status) + '</b> — ' + _cbE(say.why) + ' (' + _cbE(cbDay(say.date)) + ').</span>' +
      (say.suggest && live ? '<button type="button" class="btn btn-secondary" data-usesay>Use it</button>' : '') + '</div>' : '') +
    '<div class="cb-facts">' +
      fact('Accreditation', cbBadge(c.accreditation, cbAccTone(c.accreditation)) + (accText ? ' <span class="cb-fsub">' + accText + '</span>' : ''), reveal('cbAccForm', 'Update'), accForm) +
      fact('Sales status', c.status ? cbBadge(c.status, cbStatusTone(c.status)) + ' <span class="cb-fsub">since ' + _cbE(cbDay(c.statusUpdatedAt)) + (c.statusRef ? ' · ' + _cbE(c.statusRef) : '') +
        (c.statusNote ? ' — ' + _cbE(c.statusNote) : '') + '</span>' : '<span class="cb-dim">No status yet</span>', reveal('cbStatusForm', 'Update'), statusForm) +
      fact('Next step', c.nextStep || c.nextStepDate ? _cbE(c.nextStep || '—') + (c.nextStepDate ? ' <span class="cb-fsub' + (fl.nextOverdue ? ' cb-warnt' : '') + '">' + _cbE(cbDay(c.nextStepDate)) + (fl.nextOverdue ? ' — overdue' : '') + '</span>' : '')
        : '<span class="cb-dim">None set</span>', live ? '<button type="button" class="cb-recbtn cb-act" data-edit>Edit</button>' : '') +
      fact('Portal records', r.total ? _cbE(r.prs.length + ' PR' + (r.prs.length === 1 ? '' : 's') + ' · ' + r.quotes.length + ' quotation' + (r.quotes.length === 1 ? '' : 's') + ' · ' + r.sos.length + ' sales order' + (r.sos.length === 1 ? '' : 's')) +
        (r.openValue ? ' <span class="cb-fsub">' + _cbE(cbMoney(r.openValue)) + ' open</span>' : '') : '<span class="cb-dim">None yet</span>', goto('records', 'See them')) +
      fact('Addresses', c.siteAddress || c.headOfficeAddress ? [c.siteAddress ? '<span class="cb-addr"><b>Plant</b> ' + _cbE(c.siteAddress) + '</span>' : '',
        c.headOfficeAddress ? '<span class="cb-addr"><b>Head office</b> ' + _cbE(c.headOfficeAddress) + '</span>' : ''].join('')
        : '<span class="cb-dim">None yet</span>', live ? '<button type="button" class="cb-recbtn cb-act" data-edit>Edit</button>' : '') +   // A369
      fact('Main contact', main ? '<b>' + _cbE(main.name || (main.emails || [])[0] || (main.phones || [])[0] || '') + '</b>' + (main.position ? ' <span class="cb-fsub">' + _cbE(main.position) + '</span>' : '') +
        ((main.emails || []).length || (main.phones || []).length ? '<span class="cb-flinks">' + (main.emails || []).slice(0, 1).map(mail).concat((main.phones || []).slice(0, 1).map(tel)).join(' · ') + '</span>' : '')
        : '<span class="cb-dim">No contact yet</span>', goto('contacts', people.length > 1 ? 'All ' + people.length : 'Contacts')) +
      (c.notes ? fact('Notes', '<span class="cb-notes">' + _cbE(c.notes) + '</span>') : '') +
    '</div>' +
    (!CB.all ? '' : '<section class="cb-sec"><h4>From the Sales Daily Report</h4>' +
      (lines.length ? '<ul class="cb-hist">' + lines.map((l, i) => '<li' + (i >= SR_SHOWN ? ' class="cb-more" hidden' : '') + '><span class="tm">' + _cbE(cbDay(l.day)) + '</span><span>' + _cbE(l.type) + ' — ' + _cbE([l.person, l.note].filter(Boolean).join(', ') || l.company) +
        (l.result ? '<span class="cb-sub">' + _cbE(l.result) + '</span>' : '') + '<span class="cb-sub">' + _cbE(l.user) + '</span></span></li>').join('') + '</ul>' +
        (lines.length > SR_SHOWN ? '<button type="button" class="cb-link" data-showmore>Show all ' + lines.length + '</button>' : '')
        : '<p class="cb-sub">No lines about this client in the Sales Daily Report yet.</p>') + '</section>');

  const records = '<div class="cb-sec cb-flat" id="cbRecs">' +
      (r.total ? '<p class="cb-sub">' + (canLink ? 'Linked records stay with this client whatever the company is called on them; the rest are matched by its name. Link one to keep it here.'
                                                : 'Records linked on a PR made for this client are marked; the rest are matched by the company name.') + '</p>' +
        (loose.length > 1 ? '<div class="cb-recsbar"><button type="button" class="btn btn-secondary" data-linkall>Link all ' + loose.length + ' matched by name</button></div>' : '') +
        '<ul class="cb-recs">' + r.sos.map(recRow).join('') + r.quotes.map(recRow).join('') + r.prs.map(recRow).join('') + '</ul>'
             : '<p class="cb-sub">No purchase requests, quotations or sales orders under this company name yet.</p>') +
      (canLink ? '<p class="cb-msg" role="status"></p><div class="cb-find"><h5>Connect a past purchase request or quotation</h5>' +
        (sugg.items.length ? '<p class="cb-sub">Similar company names' + (CB.all ? '' : ' among yours') + ':</p><ul class="cb-recs">' + sugg.items.map(findRow).join('') + '</ul>' +
          (sugg.more ? '<p class="cb-sub">' + sugg.more + ' more with a similar name — find them by number or name below.</p>' : '') : '') +
        '<label>Find by number or company<input type="search" class="cb-in" data-find maxlength="80" autocomplete="off" placeholder="PR-202603-014, a quotation number or part of the name"></label>' +
        '<div data-found></div></div>' : (r.total ? '<p class="cb-sub cb-ro">Read only.</p>' : '')) + '</div>';

  const peopleList = people.length ? '<ul class="cb-peeps">' + people.map(p => '<li><span class="cb-pname">' + _cbE(p.name || (p.emails || [])[0] || (p.phones || [])[0] || 'Contact') +
      (p.primary ? ' <span class="cb-badge mid">Main</span>' : '') + '</span>' + (p.position ? '<span class="cb-ppos">' + _cbE(p.position) + '</span>' : '') +
      ((p.emails || []).length || (p.phones || []).length ? '<span class="cb-plinks">' + (p.emails || []).map(mail).concat((p.phones || []).map(tel)).join('') + '</span>' : '') +
      (p.note ? '<span class="cb-ppos">' + _cbE(p.note) + '</span>' : '') + '</li>').join('') + '</ul>' : '<p class="cb-sub">No contact people yet.</p>';
  const contacts = '<div class="cb-sec cb-flat"><div class="cb-panelbar"><h4>Contacts and details</h4>' + reveal('cbEdit', 'Edit details and contacts') + '</div>' +
      '<div id="cbPeople">' + peopleList + '</div>' +
      (live ? '<form class="cb-form" id="cbEdit" autocomplete="off" hidden><div class="cb-grid2"><label>Company<input type="text" class="cb-in" name="company" required maxlength="160" value="' + _cbE(c.company) + '"></label>' +
          (CB.all ? '<label>Owner (sales rep)' + cbOwnerSelect(c.owner, '') + '</label>' : '') + '</div>' + cbTierPills(c.tier, false) + cbSectorFields(c.sector, false) +
          '<div class="cb-people">' + (people.length ? people.map(cbPersonHtml).join('') : cbPersonHtml({ primary: true }, 0)) + '</div>' +
          '<button type="button" class="btn btn-secondary cb-addperson" data-addperson>Add another person</button>' +
          '<div class="cb-grid2"><label>Next step<input type="text" class="cb-in" name="nextStep" maxlength="190" value="' + _cbE(c.nextStep) + '"></label>' +
          '<label>Next step date<input type="date" class="cb-in" name="nextStepDate" value="' + _cbE(c.nextStepDate) + '"></label></div>' +
          '<label>Notes<textarea class="cb-in" name="notes" rows="2" maxlength="2000">' + _cbE(c.notes) + '</textarea></label>' +
          '<div class="cb-formfoot"><button type="button" class="btn btn-secondary" data-cancel="cbEdit">Cancel</button><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-primary">Save contacts and details</button></div></form>' : '') + '</div>';

  const timeline = '<div class="cb-sec cb-flat"><h4>Timeline</h4><ul class="cb-hist">' + log.map(cbLogLi).join('') + '</ul></div>' +
    (CB.ok ? '<div class="cb-sec"><form class="cb-form" id="cbArchive">' + (c.archivedAt
        ? '<div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-secondary">Restore this client</button></div>'
        : '<label>Archive this client — why?<input type="text" class="cb-in" name="reason" maxlength="190" placeholder="Plant closed"></label><div class="cb-formfoot"><span class="cb-msg" role="status"></span><button type="submit" class="btn btn-secondary">Archive</button></div>') +
      '</form></div>' : '');

  const box = cbShow(head + panel('overview', overview) + panel('records', records) + panel('contacts', contacts) + panel('timeline', timeline), back, { pane: true });
  cbMarkOpen();
  cbWirePeople(box);
  if (box.querySelector('#cbEdit')) cbWireSector(box.querySelector('#cbEdit'), c.siteAddress, c.headOfficeAddress);
  cbWireTabs(box);
  const recs = box.querySelector('#cbRecs');
  if (recs && canLink) {
    const send = async (btn, action, params, done) => {
      btn.disabled = true;
      const res = await cbPost(recs, action, params);
      if (!(res && res.success)) { btn.disabled = false; return; }
      const again = cbHost().querySelector('#cbRecs');   // the detail was drawn again from the new book
      if (again) cbMsg(again, done(res));
    };
    recs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-link], [data-unlink], [data-linkall]');
      if (!b || b.disabled) return;
      if (b.hasAttribute('data-linkall')) {
        send(b, 'linkClientBookRecords', { clientNo: no, records: JSON.stringify(loose.map(x => ({ kind: x.kind, no: x.ref }))) }, (res) => 'Connected ' + res.linked + ' records.');
        return;
      }
      const v = (b.getAttribute('data-link') || b.getAttribute('data-unlink')).split('|'), kind = v[0], ref = v.slice(1).join('|');
      if (b.hasAttribute('data-link')) send(b, 'linkClientBookRecords', { clientNo: no, records: JSON.stringify([{ kind, no: ref }]) }, () => 'Connected ' + ref + '.');
      else send(b, 'unlinkClientBookRecord', { kind, no: ref }, () => {
        if (typeof window.hxSnackbar === 'function') window.hxSnackbar(ref + ' was taken off ' + c.company + '.', { action: 'Undo', onAction: () => cbPost(null, 'linkClientBookRecords', { clientNo: no, records: JSON.stringify([{ kind, no: ref }]) }) });   // A375
        return ref + ' was taken off this client. It can be connected again below.';
      });
    });
    const find = recs.querySelector('[data-find]'), found = recs.querySelector('[data-found]');
    find.addEventListener('input', () => {
      const q = find.value.trim();
      if (!q) { found.innerHTML = ''; return; }
      const f = cbFindRecords(CB.ix, c, { me: CB.me, all: CB.all, q, clientNos });
      found.innerHTML = f.items.length ? '<ul class="cb-recs">' + f.items.map(findRow).join('') + '</ul>' + (f.more ? '<p class="cb-sub">' + f.more + ' more — type more of the number or the name.</p>' : '')
        : '<p class="cb-sub">Nothing ' + (CB.all ? '' : 'of yours ') + 'matches "' + _cbE(q) + '" that is not already on this client.</p>';
    });
  }
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
    const params = { clientNo: no, company: el.company.value.trim(), owner: el.owner ? el.owner.value : '', contactsJson: JSON.stringify(cbReadPeople(edit)),
      nextStep: el.nextStep.value.trim(), nextStepDate: el.nextStepDate.value, notes: el.notes.value.trim() };
    if (CB.v180 && cbTierOf(edit)) params.tier = cbTierOf(edit);
    if (CB.v180) { if (cbSectorOf(edit)) params.sector = cbSectorOf(edit); params.siteAddress = el.siteAddress.value.trim(); }
    if (CB.v186) params.headOfficeAddress = el.headOfficeAddress.value.trim();   // A369
    cbPost(edit, 'saveClientBookClient', params);
  });
  const arch = box.querySelector('#cbArchive');
  if (arch) arch.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (c.archivedAt) cbPost(arch, 'archiveClientBookClient', { clientNo: no, restore: true });
    else {
      const reason = arch.elements.reason.value.trim();
      if (!reason) { arch.elements.reason.focus(); cbMsg(arch, 'Say why first.', true); return; }
      /* A375 — undo from a snackbar rather than a confirm first */
      cbPost(arch, 'archiveClientBookClient', { clientNo: no, reason }).then(r => {
        if (r && r.success && typeof window.hxSnackbar === 'function') window.hxSnackbar('Archived ' + c.company + '.', { action: 'Undo', onAction: () => cbPost(null, 'archiveClientBookClient', { clientNo: no, restore: true }) });
      });
    }
  });
}

/** A362 — the tabs (arrow keys move between them, as a tab list should), the Update / Edit buttons that open a form
 *  in place, "See them" / "All 5" that jump to a tab, and "Show all" under the daily report lines. */
function cbWireTabs(box) {
  const tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
  const pick = (id, focus) => {
    CB.tab = id;
    tabs.forEach(t => { const on = t.getAttribute('data-tab') === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    box.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = p.id !== 'cbPanel-' + id; });
    const host = box.parentNode;
    if (host && host.scrollTop > 0 && box.querySelector('.cb-dhead')) host.scrollTop = 0;
  };
  const open = (id, btn) => {
    const f = box.querySelector('#' + id);
    if (!f) return;
    f.hidden = !f.hidden;
    box.querySelectorAll('[data-reveal="' + id + '"]').forEach(b => b.setAttribute('aria-expanded', String(!f.hidden)));
    if (id === 'cbEdit') { const list = box.querySelector('#cbPeople'); if (list) list.hidden = !f.hidden; }
    const first = !f.hidden && f.querySelector('input:not([type="hidden"]):not([type="radio"]), select, textarea');
    if (first) first.focus(); else if (f.hidden && btn && btn.focus) btn.focus();
  };
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab], [data-goto], [data-reveal], [data-edit], [data-cancel], [data-showmore]');
    if (!t) return;
    if (t.hasAttribute('data-tab')) pick(t.getAttribute('data-tab'), false);
    else if (t.hasAttribute('data-goto')) pick(t.getAttribute('data-goto'), true);
    else if (t.hasAttribute('data-reveal')) open(t.getAttribute('data-reveal'), t);
    else if (t.hasAttribute('data-cancel')) open(t.getAttribute('data-cancel'), box.querySelector('[data-reveal="' + t.getAttribute('data-cancel') + '"]'));
    else if (t.hasAttribute('data-edit')) { pick('contacts', false); const f = box.querySelector('#cbEdit'); if (f && f.hidden) open('cbEdit'); }
    else if (t.hasAttribute('data-showmore')) { box.querySelectorAll('.cb-more').forEach(li => { li.hidden = false; }); t.remove(); }
  });
  const list = box.querySelector('[role="tablist"]');
  if (list) list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (i < 0 || (!step && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
    pick(tabs[n].getAttribute('data-tab'), true);
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
