/* team-daily-reports.js — A366 · team daily reports (team-daily-reports.html), for management and the director.
 *
 * Neil, 23 Oct 2026: management opens any person's new daily report and reads it exactly as that person sees their own
 * "My daily report" — all of it, read only. Laid out like Contacts on a Mac (the Client Book, A362): the people on the
 * left, grouped by team, each with where their report stands on the chosen day; the chosen person's report on the right,
 * drawn by the same engine as their own page (js/sales-report.js for a rep, js/team-report.js for accounting, lead gen
 * and admin) in its read-only view mode. On a tablet or phone the list comes first and a report opens full height, with
 * "‹ Team" (and the browser's Back) returning to the list. Needs FlowAPI 185 (management may read every report). */
const TDR = { me: null, today: '', day: '', users: [], rows: [], groups: [], f: { q: '', state: '' }, open: null, mounted: {}, wasSplit: null, rowsOk: true, seq: 0 };
const TDR_SECTION = { sales: 'proof', accounting: 'tdrAccounting', leadgen: 'tdrLeadgen', admin: 'tdrAdmin' };
const TDR_SPLIT_MQ = '(min-width: 1180px)';

function _tdrE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _tdrId(id) { return document.getElementById(id); }
function _tdrNowMin() { const d = new Date(); return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes(); }   // Manila, UTC+8
function _tdrClock(iso) { return typeof srClock === 'function' ? srClock(iso) : String(iso || '').slice(11, 16); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireTeamReportsAccess === 'function' ? requireTeamReportsAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('team-daily-reports');
  TDR.me = s;
  TDR.today = TDR.day = flowToday();
  const ready = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(185).catch(() => false) : false;
  if (!ready) {
    _tdrId('tdrNotice').innerHTML = '<div class="dh-banner warn">The team\'s new daily reports open here with the next FlowAPI update (version 185). The old daily reports work as before meanwhile.</div>';
    _tdrId('tdrSplit').hidden = true;
    const stepper = document.querySelector('.tdr-day');
    if (stepper) stepper.hidden = true;
    return;
  }
  _tdrWire();
  await tdrLoadRoster();
  await tdrLoadDay();
  if (tdrSplit()) { const first = tdrFilter(TDR.groups, TDR.f).reduce((a, g) => a.concat(g.people), [])[0]; if (first) tdrOpen(first, false); }
  TDR.wasSplit = tdrSplit();
  tdrFit();
});

/* ── the reads ────────────────────────────────────────────────────────────────────────────────── */

/** The people with a new daily report: the roster (falling back to the mail roster, as All daily reports does). */
async function tdrLoadRoster() {
  const keep = (list) => (list || []).filter(u => ['sales', 'accounting', 'leadgen', 'admin'].indexOf(String(u.role || '').toLowerCase()) >= 0);
  let users = [];
  if (typeof apiGetUsers === 'function') users = await apiGetUsers().then(r => keep((r && (r.data || r.users)) || [])).catch(() => []);
  if (!users.length && typeof apiFetchEmailUsers === 'function') users = await apiFetchEmailUsers().then(r => keep(r && r.success ? r.users : [])).catch(() => []);
  TDR.users = users;
}

/** Every report of the day, every kind, in one read; then the list. */
async function tdrLoadDay() {
  const seq = ++TDR.seq, day = TDR.day;
  _tdrId('tdrList').innerHTML = '<p class="tdr-empty">Reading the day…</p>';
  const r = await postFlow('getProofReports', { kind: 'all', from: day, to: day }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (seq !== TDR.seq) return;
  TDR.rowsOk = !!(r && r.success);
  TDR.rows = TDR.rowsOk ? r.data || [] : [];
  _tdrId('tdrNotice').innerHTML = TDR.rowsOk ? '' : '<div class="dh-banner warn">Could not read the saved reports' + (r && r.message ? ' (' + _tdrE(r.message) + ')' : '') + '. Reload the page.</div>';
  tdrRender();
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────────── */

function tdrRender() {
  TDR.groups = tdrGroups(TDR.users, TDR.rows, TDR.day, TDR.today, _tdrNowMin());
  const c = tdrCounts(TDR.groups), f = TDR.f;
  const chip = (state, label, n) => '<button type="button" class="tdr-chip' + (f.state === state ? ' on' : '') + '" data-state="' + state + '" aria-pressed="' + (f.state === state) + '">' + label + ' <span class="n">' + n + '</span></button>';
  _tdrId('tdrChips').innerHTML = chip('', 'Everyone', c.total) + chip('submitted', 'Submitted', c.submitted) + chip('saved', 'Saved', c.saved) + chip('none', 'Not started', c.notStarted);
  const date = _tdrId('tdrDate');
  if (date) { date.value = TDR.day; date.max = TDR.today; date.min = srAddDays(TDR.today, -28); }
  const prev = _tdrId('tdrPrev'), next = _tdrId('tdrNext');
  if (next) next.disabled = TDR.day >= TDR.today;
  if (prev) prev.disabled = TDR.day <= srAddDays(TDR.today, -28);
  const shown = tdrFilter(TDR.groups, f);
  _tdrId('tdrList').innerHTML = !TDR.groups.length ? '<p class="tdr-empty">Nobody with a new daily report was found in the user list.</p>'
    : !shown.length ? '<p class="tdr-empty">No one matches.</p>'
    : shown.map(g => '<div class="tdr-group" role="group" aria-label="' + _tdrE(g.label) + '"><h2 class="tdr-ghead">' + _tdrE(g.label) + ' <span>' + g.submitted + ' of ' + g.people.length + ' submitted</span></h2>' +
        g.people.map(tdrRowHtml).join('') + '</div>').join('');
}

/** One person: their name and the time, then where the report stands and the lines typed. */
function tdrRowHtml(p) {
  const on = TDR.open && TDR.open.name === p.name && TDR.open.role === p.role;
  const state = p.state === 'submitted' ? '<span class="tdr-st ok">Submitted ' + _tdrE(_tdrClock(p.at)) + '</span>'
    : p.state === 'saved' ? '<span class="tdr-st' + (p.late ? ' late' : '') + '">Saved ' + _tdrE(_tdrClock(p.at)) + (p.late ? ' — 4:30 report not in' : ' — 4:30 report due') + '</span>'
    : '<span class="tdr-st' + (p.late ? ' late' : ' dim') + '">Not started</span>';
  return '<button type="button" class="tdr-row' + (on ? ' on' : '') + '"' + (on ? ' aria-current="true"' : '') + ' data-person="' + _tdrE(p.role + '|' + p.name) + '">' +
    '<span class="tdr-r1"><span class="tdr-name">' + _tdrE(p.name) + '</span>' + (p.lines ? '<span class="tdr-lines">' + p.lines + ' line' + (p.lines === 1 ? '' : 's') + '</span>' : '') + '</span>' +
    '<span class="tdr-r2">' + state + (p.inRoster ? '' : '<span class="tdr-st dim"> · not in the user list</span>') + '</span></button>';
}

/* ── one person's report ──────────────────────────────────────────────────────────────────────── */

/** Show a person's own report, read only, in their team's section (mounted once, then moved). */
async function tdrOpen(p, push) {
  TDR.open = { name: p.name, username: p.username, role: p.role };
  Object.keys(TDR_SECTION).forEach(role => { const el = _tdrId(TDR_SECTION[role]); if (el) el.hidden = role !== p.role; });
  _tdrId('tdrEmpty').hidden = true;
  const pane = _tdrId('tdrPane');
  if (pane) { pane.scrollTop = 0; pane.classList.remove('tdr-enter'); void pane.offsetWidth; pane.classList.add('tdr-enter'); }
  document.querySelectorAll('#tdrList .tdr-row').forEach(b => {
    const on = b.getAttribute('data-person') === p.role + '|' + p.name;
    b.classList.toggle('on', on);
    if (on) { b.setAttribute('aria-current', 'true'); if (tdrSplit() && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); } else b.removeAttribute('aria-current');
  });
  if (!tdrSplit()) {
    document.body.classList.add('tdr-reading');
    if (push !== false && history.pushState) history.pushState({ tdr: p.role + '|' + p.name }, '');
    window.scrollTo(0, 0);
  }
  await _tdrShow(p);
}

/** The team's report engine: mounted once (read only, fixed to the person), then moved. An open while the first mount is
 *  still reading waits for it, then moves the report to whoever is chosen by then, on the page's day by then. */
async function _tdrShow(p) {
  const role = p.role, view = { name: p.name, username: p.username, day: TDR.day };
  if (!TDR.mounted[role]) {
    TDR.mounted[role] = (role === 'sales' ? salesReport(TDR_SECTION.sales, { view }) : teamReport(TDR_SECTION[role], role, { view })).catch(() => {});
    return TDR.mounted[role];
  }
  await TDR.mounted[role];
  const o = TDR.open;
  if (!o || o.role !== role || o.name !== p.name) return;   // another person was chosen meanwhile; their open moves it
  const now = { name: o.name, username: o.username, day: TDR.day };
  return role === 'sales' ? salesReportShow(now, TDR.day) : teamReportShow(role, now, TDR.day);
}

/** Back to the list (a tablet or phone). */
function tdrBack(fromHistory) {
  document.body.classList.remove('tdr-reading');
  if (!fromHistory && history.state && history.state.tdr && history.back) { history.back(); return; }
  const b = TDR.open && document.querySelector('#tdrList .tdr-row[data-person="' + (TDR.open.role + '|' + TDR.open.name).replace(/"/g, '\\"') + '"]');
  if (b && b.focus) b.focus();
}

/** Another day: the list read again, and the open report moved to that day. */
async function tdrSetDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > TDR.today || day < srAddDays(TDR.today, -28)) { _tdrId('tdrDate').value = TDR.day; return; }
  TDR.day = day;
  await tdrLoadDay();
  if (TDR.open) await _tdrShow(TDR.open);
}

/* ── the split: beside each other on a wide screen, fitted to the window ──────────────────────── */

function tdrSplit() { try { return !!(window.matchMedia && window.matchMedia(TDR_SPLIT_MQ).matches); } catch (e) { return false; } }
function tdrFit() {
  const sp = _tdrId('tdrSplit');
  if (!sp || !sp.getBoundingClientRect || !sp.style || !sp.style.setProperty) return;
  if (!tdrSplit()) { sp.style.removeProperty('--tdr-h'); return; }
  const top = sp.getBoundingClientRect().top + (window.scrollY || 0);
  const h = Math.max(460, Math.round(window.innerHeight - top - 20));
  sp.style.setProperty('--tdr-h', h + 'px');
  const over = document.documentElement.scrollHeight - window.innerHeight;
  if (over > 0 && h - over >= 460) sp.style.setProperty('--tdr-h', (h - over) + 'px');
}

/* ── wiring ───────────────────────────────────────────────────────────────────────────────────── */

function _tdrWire() {
  _tdrId('tdrPrev').addEventListener('click', () => tdrSetDay(srAddDays(TDR.day, -1)));
  _tdrId('tdrNext').addEventListener('click', () => tdrSetDay(srAddDays(TDR.day, 1)));
  _tdrId('tdrDate').addEventListener('change', (e) => tdrSetDay(e.target.value));
  _tdrId('tdrQ').addEventListener('input', (e) => { TDR.f.q = e.target.value; tdrRender(); });
  _tdrId('tdrChips').addEventListener('click', (e) => { const b = e.target.closest('[data-state]'); if (b) { TDR.f.state = b.getAttribute('data-state'); tdrRender(); } });
  const list = _tdrId('tdrList');
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) tdrOpen(_tdrPersonOf(b)); });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.prototype.slice.call(list.querySelectorAll('.tdr-row')), i = all.indexOf(document.activeElement);
    const next = all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (tdrSplit()) tdrOpen(_tdrPersonOf(next));
  });
  _tdrId('tdrBack').addEventListener('click', () => tdrBack(false));
  window.addEventListener('popstate', () => { if (document.body.classList.contains('tdr-reading')) tdrBack(true); });
  window.addEventListener('resize', () => {
    const now = tdrSplit();
    if (now !== TDR.wasSplit) { TDR.wasSplit = now; if (now) document.body.classList.remove('tdr-reading'); }
    tdrFit();
  });
}
function _tdrPersonOf(b) {
  const v = b.getAttribute('data-person') || '', role = v.split('|')[0], name = v.slice(role.length + 1);
  const g = TDR.groups.find(x => x.key === role), p = g && g.people.find(x => x.name === name);
  return p || { name, username: '', role };
}
