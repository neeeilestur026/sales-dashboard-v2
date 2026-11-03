/* shutdown-calendar.js — A391 · the shutdown calendar (shutdown-calendar.html): client plant shutdowns, one shared calendar.
 *
 * Neil, 2 Nov 2026: when a client's plant stops for maintenance or a turnaround, the reps prepare the quotes, rentals and
 * tools before it starts. Sales, the director and management add shutdowns; every rep sees every one; only the rep who
 * added it, the director and management change it (the server decides; each entry says canEdit). Month (multi-day bars,
 * js/shutdown-calendar-model.js shdmMonthGrid) or Upcoming (under way, this week, the next 30 days, later). The add/edit
 * sheet suggests the client from the person's own Client Book and the client master, and offers a Book client's plant or
 * head office as the site. Archive has an Undo, never a confirm. Built to the apple-design skill (css/shutdown-calendar.css).
 */
const SHD = { s: null, items: [], log: [], today: '', may: {}, lists: { statuses: SHDM_STATUSES, offers: SHDM_OFFERS }, view: 'month', ym: '', f: { q: '', chip: 'all' },
              book: [], master: [], roster: [], back: null };

function _shdE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _shdId(id) { return document.getElementById(id); }
function _shdToast(t, tone) { if (typeof hxToast === 'function') hxToast(t, { tone: tone }); }
function _shdOld(r) { return /unknown action|not a secured action/i.test(String(r && r.message)); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireShutdownAccess === 'function' ? requireShutdownAccess() : null;
  if (!s) return;
  SHD.s = s;
  if (typeof renderNavbar === 'function') renderNavbar('shutdown-calendar');
  SHD.today = typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10);
  SHD.ym = SHD.today.slice(0, 7);
  const q = new URLSearchParams(location.search || '');
  SHD.view = q.get('view') === 'upcoming' || (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 'upcoming' : 'month';
  _shdId('shdAdd').addEventListener('click', (e) => shdEdit(null, e.currentTarget));
  _shdId('shdSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { SHD.view = b.getAttribute('data-view'); shdRender(); } });
  _shdId('shdSeg').addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); SHD.view = SHD.view === 'month' ? 'upcoming' : 'month'; shdRender();
    const b = document.querySelector('#shdSeg [data-view="' + SHD.view + '"]'); if (b) b.focus(); } });
  _shdId('shdStep').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (!b) return; const st = b.getAttribute('data-step');
    SHD.ym = st === 'today' ? SHD.today.slice(0, 7) : shdmStepMonth(SHD.ym, st === 'next' ? 1 : -1); shdRender(); });
  _shdId('shdQ').addEventListener('input', (e) => { SHD.f.q = e.target.value; shdRender(); });
  _shdId('shdChips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) { SHD.f.chip = b.getAttribute('data-chip'); shdRender(); } });
  _shdId('shdBody').addEventListener('click', shdBodyClick);
  await shdLoad();
  if (typeof hxDeepLink === 'function') hxDeepLink(() => shdEdit(null, null));
  const id = q.get('id');
  if (id) { const it = SHD.items.find(x => x.shutdownNo === id); if (it) shdDetail(it, null); }
});

async function shdLoad() {
  _shdId('shdBody').innerHTML = '<p class="shd-empty">Reading the calendar…</p>';
  const r = await postFlow('getShutdowns', { archived: true, log: true }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!r || !r.success) {
    _shdId('shdNotice').innerHTML = '<p class="shd-notice' + (_shdOld(r) ? '' : ' bad') + '">' + _shdE(_shdOld(r)
      ? 'The shutdown calendar needs FlowAPI 195. Paste it in Apps Script and make a new deployment, then reload this page.'
      : (r && r.message) || 'The calendar could not be read.') + '</p>';
    _shdId('shdBody').innerHTML = '';
    return;
  }
  SHD.items = r.items || []; SHD.log = r.log || []; SHD.today = r.today || SHD.today; SHD.may = r.may || {}; if (r.lists) SHD.lists = r.lists;
  shdRender();
  if (!SHD.master.length) shdSuggestions();
}
async function shdSuggestions() {
  const role = SHD.s.role;
  const [master, book, users] = await Promise.all([
    fetchFlow('getClients').then(r => (r && r.data) || []).catch(() => []),
    role === 'management' ? Promise.resolve([]) : postFlow('getClientBook', {}).then(r => (r && r.success && r.clients) || []).catch(() => []),
    typeof apiGetUsers === 'function' ? apiGetUsers().then(r => (r && (r.data || r.users)) || []).catch(() => []) : Promise.resolve([])
  ]);
  SHD.master = master; SHD.book = book;
  SHD.roster = users.filter(u => ['sales', 'director', 'management'].indexOf(String(u.role || '').toLowerCase()) >= 0)
    .map(u => String(u.fullName || u.name || u.username || '').trim()).filter(Boolean).sort();
}

/* ── the views ────────────────────────────────────────────────────────────────────────────────── */

/** A segmented control's buttons are redrawn, its indicator is kept: it slides from wherever it stands (even mid-slide),
 *  a redraw to the same segment does not move it, and the first time it is simply placed, so nothing moves on load. */
function _shdSegDraw(seg, thumbClass, buttonsHtml) {
  let th = seg.querySelector('.' + thumbClass);
  const first = !th;
  Array.prototype.slice.call(seg.children).forEach(c => { if (c !== th) c.remove(); });
  seg.insertAdjacentHTML('beforeend', buttonsHtml);
  if (first) { th = document.createElement('span'); th.className = thumbClass + ' now'; th.setAttribute('aria-hidden', 'true'); seg.insertBefore(th, seg.firstChild); }
  const on = seg.querySelector('[aria-selected="true"]');
  if (on && typeof on.offsetLeft === 'number') { th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
  if (first) { void th.offsetWidth; th.classList.remove('now'); }
}
function shdRender() {
  const seg = _shdId('shdSeg');
  _shdSegDraw(seg, 'shd-thumb', [['month', 'Month'], ['upcoming', 'Upcoming']].map(v =>
    '<button type="button" role="tab" class="shd-segb" data-view="' + v[0] + '" aria-selected="' + (SHD.view === v[0]) + '" tabindex="' + (SHD.view === v[0] ? 0 : -1) + '">' + v[1] + '</button>').join(''));
  _shdId('shdStep').hidden = SHD.view !== 'month';
  _shdId('shdMonth').textContent = shdmMonthLabel(SHD.ym);
  const counts = { all: 0, mine: 0, Tentative: 0, Confirmed: 0, archived: 0 };
  SHD.items.forEach(it => { if (it.archived) { counts.archived++; return; } counts.all++; if (it.mine) counts.mine++; if (counts[it.status] !== undefined) counts[it.status]++; });
  _shdId('shdChips').innerHTML = [['all', 'All'], ['mine', 'Mine'], ['Tentative', 'Tentative'], ['Confirmed', 'Confirmed'], ['archived', 'Archived']]
    .filter(c => c[0] === 'all' || counts[c[0]] || SHD.f.chip === c[0])
    .map(c => '<button type="button" class="shd-chip' + (SHD.f.chip === c[0] ? ' on' : '') + '" data-chip="' + c[0] + '" aria-pressed="' + (SHD.f.chip === c[0]) + '">' + c[1] +
      ' <span class="n">' + counts[c[0]] + '</span></button>').join('');
  const shown = shdmFilter(SHD.items, SHD.f);
  _shdId('shdBody').innerHTML = SHD.view === 'month' ? shdMonthHtml(shown) : shdUpcomingHtml(shown);
}
function shdBarClass(b) {
  const st = String(b.item.status || 'Tentative').toLowerCase();
  return 'shd-bar c' + (b.col + 1) + ' s' + b.span + ' l' + b.lane + ' st-' + st + (b.contL ? ' cl' : '') + (b.contR ? ' cr' : '') + (b.item.archived ? ' arch' : '');
}
function shdMonthHtml(items) {
  const g = shdmMonthGrid(SHD.ym, items, { today: SHD.today, archived: SHD.f.chip === 'archived' });
  const head = '<div class="shd-dow" aria-hidden="true">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => '<span>' + d + '</span>').join('') + '</div>';
  const weeks = g.weeks.map(w => '<div class="shd-week">' +
    w.days.map((d, i) => '<button type="button" class="shd-cell d' + (i + 1) + (d.inMonth ? '' : ' out') + (d.today ? ' today' : '') + '" data-day="' + d.date + '" aria-label="' +
      _shdE(shdmDay(d.date, SHD.today) + (d.count ? ', ' + d.count + ' shutdown' + (d.count === 1 ? '' : 's') : '')) + '"><span class="shd-dn">' + d.day + '</span>' +
      (d.count ? '<span class="shd-dot" aria-hidden="true"></span>' : '') + '</button>').join('') +
    w.bars.map(b => '<button type="button" class="' + shdBarClass(b) + '" data-open="' + _shdE(b.no) + '" title="' + _shdE(b.item.company + ' · ' + shdmRangeLabel(b.item.start, b.item.end, SHD.today)) + '">' +
      '<span>' + _shdE(b.item.company) + (b.item.site ? ' · ' + _shdE(b.item.site) : '') + '</span></button>').join('') +
    w.more.map((n, i) => n ? '<button type="button" class="shd-more c' + (i + 1) + '" data-day="' + w.days[i].date + '">+' + n + ' more</button>' : '').join('') + '</div>').join('');
  return '<div class="shd-month" role="grid" aria-label="' + _shdE(g.label) + '">' + head + weeks + '</div>' +
    (!items.filter(it => !it.archived).length && SHD.f.chip !== 'archived' ? '<p class="shd-empty">No shutdowns yet. Heard of a client\'s plant stopping for maintenance? Add it, so the team can prepare.</p>' : '');
}
function shdRowHtml(it) {
  const soon = shdmSoon(it, SHD.today);
  return '<li><button type="button" class="shd-row" data-open="' + _shdE(it.shutdownNo) + '">' +
    '<span class="shd-r1"><b>' + _shdE(it.company) + '</b><span class="shd-when">' + _shdE(shdmRangeLabel(it.start, it.end, SHD.today)) + '</span></span>' +
    '<span class="shd-r2">' + _shdE([it.site, it.scope].filter(Boolean).join(' · ') || 'No details yet') + '</span>' +
    '<span class="shd-r3"><span class="shd-st st-' + _shdE(String(it.status).toLowerCase()) + '">' + _shdE(it.status) + '</span>' +
    (soon && soon !== 'ended' ? '<span class="shd-soon">' + _shdE(soon) + '</span>' : '') + (it.offer.length ? '<span>' + _shdE(it.offer.join(' · ')) + '</span>' : '') +
    '<span class="shd-who">' + _shdE(it.followUpBy || it.createdBy) + (it.mine ? ' · yours' : '') + '</span></span></button></li>';
}
function shdUpcomingHtml(items) {
  if (SHD.f.chip === 'archived') return items.length ? '<ol class="shd-list">' + items.map(shdRowHtml).join('') + '</ol>' : '<p class="shd-empty">Nothing archived.</p>';
  const groups = shdmUpcoming(items, SHD.today);
  return groups.length ? groups.map(g => '<section class="shd-group"><h2>' + _shdE(g.label) + ' <span class="n">' + g.items.length + '</span></h2><ol class="shd-list">' +
    g.items.map(shdRowHtml).join('') + '</ol></section>').join('')
    : '<p class="shd-empty">' + _shdE(SHD.f.q ? 'Nothing matches “' + SHD.f.q + '”.' : 'No shutdowns coming up. Heard of one? Add it, so the team can prepare.') + '</p>';
}
function shdBodyClick(e) {
  const o = e.target.closest('[data-open]');
  if (o) { const it = SHD.items.find(x => x.shutdownNo === o.getAttribute('data-open')); if (it) shdDetail(it, o); return; }
  const d = e.target.closest('[data-day]');
  if (d) shdDaySheet(d.getAttribute('data-day'), d);
}

/* ── the sheets ───────────────────────────────────────────────────────────────────────────────── */

function shdSheet(html, back) {
  SHD.back = back || document.activeElement;
  let ov = _shdId('shdOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'modal-overlay shd-overlay'; ov.id = 'shdOverlay';
    ov.innerHTML = '<div class="modal wide shd-modal" role="dialog" aria-modal="true" aria-labelledby="shdSheetTitle"></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || (e.target.closest && e.target.closest('[data-close]'))) shdClose(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('open')) shdClose(); });
  }
  const box = ov.querySelector('.shd-modal');
  box.innerHTML = html;
  ov.classList.add('open');
  const first = box.querySelector('input, textarea, button');
  if (first) first.focus();
  return box;
}
function shdClose() { const ov = _shdId('shdOverlay'); if (ov) ov.classList.remove('open'); if (SHD.back && SHD.back.focus) SHD.back.focus(); }
function shdDaySheet(date, back) {
  const on = shdmFilter(SHD.items, SHD.f).filter(it => it.start <= date && (it.end || it.start) >= date);
  const box = shdSheet('<h3 id="shdSheetTitle">' + _shdE(shdmDay(date, SHD.today)) + '</h3>' + (on.length ? '<ol class="shd-list">' + on.map(shdRowHtml).join('') + '</ol>'
    : '<p class="shd-empty">No shutdowns on this day.</p>') + '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Close</button>' +
    '<button type="button" class="btn btn-primary primary" data-addon="' + date + '">Add one on this day</button></div>', back);
  box.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]'); if (o) { const it = SHD.items.find(x => x.shutdownNo === o.getAttribute('data-open')); if (it) shdDetail(it, back); }
    const a = e.target.closest('[data-addon]'); if (a) shdEdit({ start: a.getAttribute('data-addon') }, back);
  });
}
function shdFact(k, v) { return v ? '<div class="shd-fact"><dt>' + _shdE(k) + '</dt><dd>' + _shdE(v).replace(/\n/g, '<br>') + '</dd></div>' : ''; }
function shdDetail(it, back) {
  const log = SHD.log.filter(l => l.shutdownNo === it.shutdownNo).slice(0, 8);
  const box = shdSheet('<h3 id="shdSheetTitle">' + _shdE(it.company) + '</h3><p class="shd-sub"><span class="shd-st st-' + _shdE(String(it.status).toLowerCase()) + '">' + _shdE(it.status) + '</span> ' +
    _shdE(shdmRangeLabel(it.start, it.end, SHD.today)) + (shdmSoon(it, SHD.today) ? ' · ' + _shdE(shdmSoon(it, SHD.today)) : '') + (it.archived ? ' · archived' : '') + '</p>' +
    '<dl class="shd-facts">' + shdFact('Site', [it.siteKind, it.site].filter(Boolean).join(': ')) + shdFact('Scope', it.scope) + shdFact('We can offer', it.offer.join(', ')) +
      shdFact('The opportunity', it.opportunity) + shdFact('Contact', it.contact) + shdFact('Follow-up', it.followUpBy) + shdFact('Notes', it.notes) +
      shdFact('Added by', it.createdBy) + '</dl>' +
    (log.length ? '<details class="shd-log"><summary>Changes</summary><ol>' + log.map(l => '<li>' + _shdE(l.note || (l.kind + (l.to ? ': ' + l.to : ''))) + ' <span>' +
      _shdE(l.by + ' · ' + String(l.at).slice(0, 10)) + '</span></li>').join('') + '</ol></details>' : '') +
    '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Close</button>' +
    (it.canEdit ? (it.archived ? '<button type="button" class="btn btn-secondary" data-restore>Restore</button>'
      : '<button type="button" class="btn btn-secondary" data-arch>Archive</button><button type="button" class="btn btn-primary primary" data-edit>Edit</button>')
      : '<span class="shd-dim">Only ' + _shdE(it.createdBy) + ', the director or management can change it.</span>') + '</div>', back);
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]')) shdEdit(it, back);
    if (e.target.closest('[data-arch]')) shdArchive(it, false);
    if (e.target.closest('[data-restore]')) shdArchive(it, true);
  });
}
async function shdArchive(it, restore) {
  const r = await postFlow('archiveShutdown', { shutdownNo: it.shutdownNo, restore }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!r || !r.success) return _shdToast((r && r.message) || 'Not saved.', 'error');
  shdClose();
  await shdLoad();
  if (!restore && typeof hxSnackbar === 'function') hxSnackbar(it.company + ' archived.', { action: 'Undo', onAction: () => shdArchive(it, true) });
  else _shdToast(r.message, 'ok');
}
/** Add (it null, or { start }) or edit. A field left as it was is not sent. */
function shdEdit(it, back) {
  const isEdit = !!(it && it.shutdownNo), v = it || {};
  const sugg = shdmSuggest(SHD.book, SHD.master);
  const chip = (name, val, label, on, type) => '<label class="shd-cchip"><input type="' + (type || 'radio') + '" name="' + name + '" value="' + _shdE(val) + '"' + (on ? ' checked' : '') + '><span>' + _shdE(label) + '</span></label>';
  const html = '<form class="shd-form" novalidate><h3 id="shdSheetTitle">' + (isEdit ? 'Edit the shutdown' : 'Add a shutdown') + '</h3>' +
    '<label>Client <input type="text" class="shd-in" name="company" list="shdCos" maxlength="120" autocomplete="off" value="' + _shdE(v.company || '') + '" placeholder="Which client\'s plant is stopping?"></label>' +
    '<datalist id="shdCos">' + sugg.slice(0, 400).map(x => '<option value="' + _shdE(x.name) + '"></option>').join('') + '</datalist>' +
    '<div class="shd-places" data-places></div>' +
    '<label>Site <input type="text" class="shd-in" name="site" maxlength="190" value="' + _shdE(v.site || '') + '" placeholder="Plant, mill or line"></label>' +
    '<div class="shd-grid2"><label>Starts <input type="date" class="shd-in" name="start" value="' + _shdE(v.start || '') + '"></label>' +
    '<label>Ends <input type="date" class="shd-in" name="end" value="' + _shdE(v.end || '') + '"></label></div>' +
    '<label>Scope <textarea class="shd-in" name="scope" rows="2" maxlength="1000" placeholder="What they will work on: kiln relining, mill overhaul, boiler inspection…">' + _shdE(v.scope || '') + '</textarea></label>' +
    '<fieldset class="shd-field"><legend>What we can offer</legend><div class="shd-chips">' + (SHD.lists.offers || SHDM_OFFERS).map(o => chip('offer', o, o, (v.offer || []).indexOf(o) >= 0, 'checkbox')).join('') + '</div></fieldset>' +
    '<label>The opportunity <textarea class="shd-in" name="opportunity" rows="2" maxlength="1000" placeholder="Tools to rent, parts to quote, a service crew…">' + _shdE(v.opportunity || '') + '</textarea></label>' +
    '<label>Contact <input type="text" class="shd-in" name="contact" maxlength="190" value="' + _shdE(v.contact || '') + '"></label>' +
    '<fieldset class="shd-field"><legend>Status</legend><div class="shd-chips">' + (SHD.lists.statuses || SHDM_STATUSES).map(st => chip('status', st, st, (v.status || 'Tentative') === st)).join('') + '</div></fieldset>' +
    '<label>Who follows it up <input type="text" class="shd-in" name="followUpBy" list="shdRoster" maxlength="120" value="' + _shdE(v.followUpBy || (SHD.s.name || '')) + '"></label>' +
    '<datalist id="shdRoster">' + SHD.roster.map(n => '<option value="' + _shdE(n) + '"></option>').join('') + '</datalist>' +
    '<label>Notes <textarea class="shd-in" name="notes" rows="2" maxlength="1000">' + _shdE(v.notes || '') + '</textarea></label>' +
    '<input type="hidden" name="clientNo" value="' + _shdE(v.clientNo || '') + '"><input type="hidden" name="siteKind" value="' + _shdE(v.siteKind || '') + '">' +
    '<p class="shd-msg" aria-live="polite"></p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
    '<button type="submit" class="btn btn-primary primary">' + (isEdit ? 'Save' : 'Add to the calendar') + '</button></div></form>';
  const box = shdSheet(html, back), form = box.querySelector('form'), msg = box.querySelector('.shd-msg'), fld = (n) => form.elements.namedItem(n);
  const places = () => {
    const name = fld('company').value.trim().toLowerCase(), hit = sugg.find(x => String(x.name).toLowerCase() === name);
    fld('clientNo').value = hit && hit.clientNo ? hit.clientNo : '';
    const host = form.querySelector('[data-places]');
    host.innerHTML = hit && hit.book ? shdmPlaces(hit.book).map(p => '<button type="button" class="shd-place" data-place="' + _shdE(p.kind) + '" data-text="' + _shdE(p.text) + '">' +
      _shdE(p.label) + (p.text ? '<span>' + _shdE(p.text) + '</span>' : '') + '</button>').join('') : '';
  };
  places();
  form.addEventListener('input', (e) => { if (e.target.name === 'company') places(); msg.textContent = ''; msg.className = 'shd-msg'; });
  form.addEventListener('click', (e) => {
    const p = e.target.closest('[data-place]');
    if (!p) return;
    fld('siteKind').value = p.getAttribute('data-place');
    if (p.getAttribute('data-text')) fld('site').value = p.getAttribute('data-text'); else fld('site').focus();
    form.querySelectorAll('[data-place]').forEach(b => b.classList.toggle('on', b === p));
  });
  form.addEventListener('change', (e) => { if (e.target.name === 'start' && !fld('end').value) fld('end').value = e.target.value; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = { company: fld('company').value, site: fld('site').value, siteKind: fld('siteKind').value, clientNo: fld('clientNo').value, start: fld('start').value, end: fld('end').value,
                scope: fld('scope').value, opportunity: fld('opportunity').value, contact: fld('contact').value, followUpBy: fld('followUpBy').value, notes: fld('notes').value,
                status: (form.querySelector('input[name="status"]:checked') || {}).value || 'Tentative',
                offer: Array.from(form.querySelectorAll('input[name="offer"]:checked')).map(x => x.value).join(',') };
    const bad = shdmCheck(f, SHD.today);
    if (bad) { msg.textContent = bad; msg.className = 'shd-msg bad'; return; }
    if (isEdit) {
      Object.keys(f).forEach(k => { const was = k === 'offer' ? (it.offer || []).join(',') : String(it[k] == null ? '' : it[k]); if (String(f[k]) === was) delete f[k]; });
      f.shutdownNo = it.shutdownNo; f.ifUpdatedAt = it.updatedAt;
    } else f.clientRef = typeof flowClientRef === 'function' ? flowClientRef() : String(Date.now());
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; msg.textContent = 'Saving…'; msg.className = 'shd-msg';
    const r = await postFlow('saveShutdown', f).catch(err => ({ success: false, message: String(err && err.message || err) }));
    btn.disabled = false;
    if (!r || !r.success) {
      msg.className = 'shd-msg bad';
      msg.innerHTML = _shdE((r && r.message) || 'Not saved.') + (r && r.duplicate ? ' <button type="button" class="shd-link" data-twin>Open it</button>' : '');
      if (r && r.duplicate) msg.querySelector('[data-twin]').addEventListener('click', () => shdDetail(Object.assign({}, r.duplicate, { offer: r.duplicate.offer || [] }), back));
      return;
    }
    shdClose();
    _shdToast(r.unchanged ? 'Nothing changed.' : r.message, 'ok');
    try { sessionStorage.removeItem('hx_shd_n'); } catch (err) {}
    SHD.ym = (r.item && r.item.start ? r.item.start.slice(0, 7) : SHD.ym);
    shdLoad();
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SHD, shdRender };
