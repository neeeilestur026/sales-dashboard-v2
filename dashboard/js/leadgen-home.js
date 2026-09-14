/* leadgen-home.js — A277 · the Lead Generation dashboard.
 *
 * THE PAGE DRAWS; IT DOES NOT COUNT. getLeadgenCounts returns the eight numbers, the quotas, the
 * server's date and hour and the working days of the week; getLeadgenFollowups returns who is due.
 * After every save the page re-fetches rather than incrementing locally, so a deduped retry or a
 * refused write can never show a number the sheet does not have. Nothing counted is computed from
 * new Date() here — the on-pace rule uses the server's hour.
 *
 * Roles: leadgen edits; director / management / admin read (flowSetViewerOnly), and the first two
 * may change the quotas and the working week — the one write they are allowed, done with the
 * viewer lock lifted for that call only. */

let lgSession = null, lgCanEdit = false, lgOversight = false, lgMaySetQuotas = false;
let lgCounts = null, lgFollowups = [], lgMailbox = null;
let lgData = { plants: [], contacts: [], leads: [], accred: [], batches: [] };
let lgActiveTab = 'plants';
let lgDockTab = 'call';
let lgLastPlant = '';

/* Mirrors _LG_ENUM in FlowAPI.gs. The server refuses anything outside these; the dropdowns only
   keep people from finding that out the hard way. */
const LG_ENUM = {
  sector: ['Cement', 'Mining', 'Power', 'Water', 'Oil & Gas', 'Shipyard', 'Semiconductor', 'Other'],
  territory: ['Luzon', 'VisMin'],
  plantStatus: ['Active', 'Cold', 'Do Not Contact', 'Customer'],
  contactRole: ['Maintenance / O&M Head', 'MRO / Purchasing', 'Other'],
  emailVerified: ['Unverified', 'Pattern', 'Switchboard', 'Bounced'],
  contactStatus: ['New', 'Replied', 'Wrong Person', 'Do Not Contact'],
  callOutcome: ['No answer', 'Wrong person', 'Referred', 'Interested', 'Not interested'],
  callKind: ['Cold', 'Follow-up'],
  batchKind: ['Intro', 'Follow-up'],
  leadStatus: ['Handed Off', 'Presentation Booked', 'Quoted', 'Won', 'Lost', 'Returned'],
  accredStatus: ['Submitted', 'Pending', 'Approved', 'Expired'],
};
const LG_TILES = [
  ['plants', 'Plants researched', '🏭', 'plant'], ['contacts', 'Contacts verified', '👤', 'contact'],
  ['introEmails', 'Intro emails', '✉️', 'batch'], ['followupEmails', 'Follow-up emails', '↩️', 'batch'],
  ['coldCalls', 'Cold calls', '📞', 'call'], ['followupCalls', 'Follow-up calls', '📲', 'call'],
  ['leads', 'Leads handed off', '🎯', 'lead'], ['meetings', 'Meetings booked', '📅', 'lead'],
];
const LG_TILE_LABEL = {}; LG_TILES.forEach(t => { LG_TILE_LABEL[t[0]] = t[1]; });
const LG_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* Per-entity UI: columns for the table, fields for the edit modal. [key, label, type, options, span] */
const LG_UI = {
  plants: {
    label: 'Plants', icon: '🏭', title: 'Plants & sites',
    cols: [['plantNo', 'No'], ['company', 'Company'], ['plantSite', 'Plant / Site'], ['sector', 'Sector'], ['province', 'Province'], ['territory', 'Territory'], ['status', 'Status'], ['nextActionDate', 'Next action']],
    fields: [['company', 'Company *', 'text'], ['plantSite', 'Plant / Site', 'text'], ['sector', 'Sector *', 'select', LG_ENUM.sector], ['territory', 'Territory *', 'select', LG_ENUM.territory],
             ['province', 'Province', 'text'], ['status', 'Status', 'select', LG_ENUM.plantStatus], ['equipment', 'Equipment / lines', 'text'], ['source', 'Source', 'text'],
             ['philgeps', 'PhilGEPS-registered', 'check'], ['nextActionDate', 'Next action date', 'date'], ['nextAction', 'Next action', 'text', null, 'full'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['company', 'sector', 'territory'], filters: ['sector', 'territory', 'status'],
  },
  contacts: {
    label: 'Contacts', icon: '👤', title: 'Contacts',
    cols: [['contactNo', 'No'], ['name', 'Name'], ['role', 'Role'], ['company', 'Company'], ['plantSite', 'Site'], ['email', 'Email'], ['emailVerified', 'Verified'], ['status', 'Status'], ['introSent', 'Intro sent']],
    fields: [['plantNo', 'Plant *', 'plant'], ['name', 'Name *', 'text'], ['role', 'Role', 'select', LG_ENUM.contactRole], ['emailVerified', 'Email verified', 'select', LG_ENUM.emailVerified],
             ['email', 'Email', 'text'], ['mobile', 'Mobile', 'text'], ['linkedin', 'LinkedIn', 'text'], ['status', 'Status', 'select', LG_ENUM.contactStatus], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['plantNo', 'name'], filters: ['sector', 'territory', 'emailVerified', 'status'],
  },
  leads: {
    label: 'Leads', icon: '🎯', title: 'Qualified leads — the lead sheet', cards: true,
    fields: [['plantNo', 'Plant *', 'plant'], ['contactNo', 'Contact', 'contact'], ['status', 'Status', 'select', LG_ENUM.leadStatus], ['handedTo', 'Handed to (username)', 'text'],
             ['rightPerson', 'Right person', 'check'], ['ownMaintenance', 'Runs its own maintenance', 'check'], ['flangedOrHydraulic', 'Has flanged / hydraulic work', 'check'], ['saidYes', 'Said yes to a presentation or asked for a quote', 'check'],
             ['pain', 'Pain', 'text', null, 'full'], ['whatTheySaid', 'What they said', 'textarea', null, 'full'], ['nextStep', 'Next step', 'text'], ['nextStepDate', 'Next step date', 'date'],
             ['presentationDate', 'Presentation date', 'date'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['plantNo'], filters: ['territory', 'status'],
  },
  accred: {
    label: 'Accreditation', icon: '📋', title: 'Vendor accreditation',
    cols: [['accredNo', 'No'], ['company', 'Company'], ['plantSite', 'Site'], ['status', 'Status'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['expiry', 'Expiry'], ['docsSent', 'Docs']],
    fields: [['plantNo', 'Plant *', 'plant'], ['company', 'Company', 'text'], ['status', 'Status', 'select', LG_ENUM.accredStatus], ['docsSent', 'Documents sent', 'check'],
             ['submitted', 'Submitted', 'date'], ['approved', 'Approved', 'date'], ['expiry', 'Expiry', 'date'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['plantNo'], filters: ['status'],
  },
};
const LG_TAB_ORDER = ['plants', 'contacts', 'leads', 'accred'];

// ── boot ──────────────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  lgSession = requireLeadgenAccess();
  if (!lgSession) return;
  renderNavbar('leadgen-home');
  lgCanEdit = lgSession.role === 'leadgen';
  lgOversight = !lgCanEdit;
  lgMaySetQuotas = ['director', 'management'].includes(lgSession.role);
  if (typeof flowSetViewerOnly === 'function') flowSetViewerOnly(lgOversight);
  if (!lgOversight) { const sec = document.getElementById('newsec-daily-reports'); if (sec) sec.remove(); }
  if (lgOversight) { document.getElementById('roTag').style.display = ''; document.getElementById('logBtn').style.display = 'none'; }
  if (lgMaySetQuotas) document.getElementById('settingsBtn').style.display = '';

  const h = new Date().getHours();
  document.getElementById('greeting').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', ' + String(lgSession.name || '').split(' ')[0] + '.';
  document.getElementById('subline').textContent = lgOversight ? 'Lead Generation — oversight view' : 'Lead Generation';

  document.getElementById('logBtn').addEventListener('click', () => openDock(lgDockTab));
  document.getElementById('dockClose').addEventListener('click', closeDock);
  document.getElementById('dockForm').addEventListener('submit', (e) => { e.preventDefault(); submitDock(); });
  document.getElementById('recCancel').addEventListener('click', closeRecModal);
  document.getElementById('recForm2').addEventListener('submit', (e) => { e.preventDefault(); submitRecord(); });
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('setCancel').addEventListener('click', () => document.getElementById('setModal').classList.remove('open'));
  document.getElementById('setForm').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
  document.getElementById('fridayPdfBtn').addEventListener('click', openWeekPdf);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDock(); closeRecModal(); document.getElementById('setModal').classList.remove('open'); } });

  buildTabs();
  await loadAll();
  if (location.hash) { const t = location.hash.slice(1); if (LG_UI[t]) { lgActiveTab = t; render(); } scrollToHash(); }
  const poll = setInterval(() => { if (document.visibilityState === 'visible') { loadCounts(); loadFollowups(); } }, 60000);
  window.addEventListener('pagehide', () => clearInterval(poll));
});

function scrollToHash() {
  const id = { followups: 'followups-anchor', tiles: 'tiles-anchor', leads: 'trackers', accred: 'trackers' }[location.hash.slice(1)];
  const el = id && document.getElementById(id);
  if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
}

async function loadAll() {
  await Promise.all([loadCounts(), loadFollowups(), loadData()]);
  loadMailbox();
}
async function loadCounts() {
  try {
    const r = await fetchFlow('getLeadgenCounts', {}, { fresh: true });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the counts.');
    lgCounts = r;
    renderHeader(); renderTiles(); renderWeek();
  } catch (e) { document.getElementById('tilesMeta').textContent = e.message; }
}
async function loadFollowups() {
  try {
    const r = await fetchFlow('getLeadgenFollowups', {}, { fresh: true });
    lgFollowups = (r && r.data) || [];
    renderFollowups();
  } catch (e) { document.getElementById('followups').innerHTML = `<div class="lg-empty">${flowEsc(e.message)}</div>`; }
}
async function loadData() {
  try {
    const r = await fetchFlow('getLeadgen', {}, { fresh: true });
    lgData = Object.assign({ plants: [], contacts: [], leads: [], accred: [], batches: [] }, (r && r.data) || {});
    render();
  } catch (e) { flash(e.message, false); }
}
/* The mailbox is the check, not the count: how many of today's sent emails went to listed
   contacts. Own mailbox only — an oversight role is not shown someone else's. */
async function loadMailbox() {
  if (lgOversight || typeof apiFetchEmailLogToday !== 'function' || !lgCounts) return;
  try {
    const r = await apiFetchEmailLogToday(undefined, lgCounts.today);
    const emails = (r && r.success && r.emails) || (r && r.data) || [];
    const known = {};
    lgData.contacts.forEach(c => { const e = String(c.email || '').trim().toLowerCase(); if (e) known[e] = 1; });
    let seen = 0;
    (Array.isArray(emails) ? emails : []).forEach(m => {
      const to = String(m.recipient || m.to || '').toLowerCase();
      if (Object.keys(known).some(k => to.indexOf(k) !== -1)) seen++;
    });
    lgMailbox = { seen, needsSetup: !!(r && r.needsSetup), meta: (r && r.meta) || null, ok: !!(r && (r.success || r.emails || r.data)) };
  } catch (e) { lgMailbox = { ok: false, error: e.message }; }
  renderTiles();
}

// ── header, tiles, week ───────────────────────────────────────────────────────────────────────
function renderHeader() {
  const k = lgCounts, d = k.today;
  const dt = new Date(d + 'T00:00:00');
  document.getElementById('dateDay').textContent = String(dt.getDate());
  document.getElementById('dateDow').textContent = dt.toLocaleDateString('en-US', { weekday: 'long' });
  document.getElementById('dateMon').textContent = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const s = k.sector || {};
  document.getElementById('weekPillText').textContent = (s.name ? 'Week ' + s.index + ' of ' + s.of + ' · ' + s.name : 'Week ' + k.week.start) +
    (k.day.working ? '' : ' · not a working day');
}
/* Met / on pace / behind. "On pace" is time-aware against the SERVER hour over an 8:00–17:00 day:
   at 10am, 10 of 40 emails is fine; at 4pm it is not. */
function tileState(n, q, hour, working) {
  if (!working) return 'off';
  if (!(q > 0)) return 'off';
  if (n >= q) return 'met';
  const [h, m] = String(hour || '00:00').split(':').map(Number);
  const frac = Math.max(0, Math.min(1, ((h + (m || 0) / 60) - 8) / 9));
  return n >= q * frac ? 'pace' : 'behind';
}
function lgBar(pct, color) { return `<div class="lg-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></i></div>`; }
function renderTiles() {
  const k = lgCounts; if (!k) return;
  const stName = { met: '✓ met', pace: 'on pace', behind: 'behind', off: '—' };
  const stColor = { met: '#16a34a', pace: '#4f46e5', behind: '#d97706', off: '#c7cdd6' };
  document.getElementById('tilesMeta').textContent = (k.day.working ? 'Working day · ' : 'Not a working day · ') + 'server time ' + k.hour;
  document.getElementById('tiles').innerHTML = LG_TILES.map(([key, label, icon, dock]) => {
    const n = k.day[key] || 0, q = k.quotas[key] || 0, st = tileState(n, q, k.hour, k.day.working);
    const pct = q > 0 ? Math.round(n / q * 100) : 0;
    let sub = '';
    if (key === 'introEmails' && lgMailbox) {
      sub = lgMailbox.needsSetup ? 'mailbox not connected' : lgMailbox.ok ? `mailbox saw ${lgMailbox.seen} to listed contacts` : 'mailbox unreachable';
    } else if (key === 'leads') sub = 'aim 3–5 · ' + (k.reps.Luzon || 'no Luzon rep') + ' / ' + (k.reps.VisMin || 'no VisMin rep');
    const tag = lgCanEdit ? 'button type="button"' : 'div';
    return `<${tag} class="b-card lg-tile" data-dock="${dock}" ${lgCanEdit ? `title="Log ${label.toLowerCase()}"` : ''}>
      <span class="st st-${st}">${stName[st]}</span>
      <div class="t"><span class="b-ic ic">${icon}</span><span>${flowEsc(label)}</span></div>
      <div class="n b-tabnum">${n}<small>/ ${q}</small></div>
      ${lgBar(pct, stColor[st])}
      <div class="sub">${flowEsc(sub)}</div>
    </${tag.split(' ')[0]}>`;
  }).join('');
  if (lgCanEdit) document.querySelectorAll('#tiles [data-dock]').forEach(b => b.addEventListener('click', () => openDock(b.getAttribute('data-dock'))));
}
function renderWeek() {
  const k = lgCounts; if (!k) return;
  const w = k.week;
  document.getElementById('weekMeta').textContent = w.start + ' → ' + w.end + ' · ' + w.workingDays.length + ' working day' + (w.workingDays.length === 1 ? '' : 's');
  const rows = LG_TILES.map(([key, label]) => {
    const n = w.totals[key] || 0, t = w.targets[key] || 0;
    const pct = t > 0 ? Math.round(n / t * 100) : 0;
    const color = t > 0 && n >= t ? '#16a34a' : '#4f46e5';
    return `<div class="wk-row"><span>${flowEsc(label)}</span>${lgBar(pct, color)}<span class="v">${n} / ${t}</span></div>`;
  }).join('');
  const rate = w.replyRate === null || w.replyRate === undefined ? '—' : w.replyRate + '%';
  const aim = w.replyRateAim ? ` <span class="lg-meta">(aim ${w.replyRateAim}%)</span>` : '';
  const strip = w.days.map((d, i) => {
    const c = w.byDay[d] || {};
    const future = d > k.today;
    let cls = 'd', metN = 0, tot = 0;
    LG_TILES.forEach(([key]) => { if ((k.quotas[key] || 0) > 0) { tot++; if ((c[key] || 0) >= k.quotas[key]) metN++; } });
    if (!c.working) cls += ' off';
    else if (future) cls += ' future';
    else if (tot && metN === tot) cls += ' met';
    else if (metN) cls += ' part';
    if (d === k.today) cls += ' today';
    const body = !c.working ? '·' : future ? '' : (metN + '/' + tot);
    return `<div class="${cls}" title="${d}${c.working ? '' : ' — not a working day'}">${LG_DOW[i]}<b>${body || '&nbsp;'}</b></div>`;
  }).join('');
  document.getElementById('week').innerHTML = rows +
    `<div class="wk-rate"><span>Reply rate <span class="lg-meta">· replies ÷ intro emails, this week</span></span><span><b>${rate}</b>${aim}</span></div>` +
    `<div class="strip">${strip}</div>`;
}

// ── follow-ups ────────────────────────────────────────────────────────────────────────────────
function renderFollowups() {
  document.getElementById('fuCount').textContent = lgFollowups.length;
  const host = document.getElementById('followups');
  if (!lgFollowups.length) { host.innerHTML = '<div class="lg-empty">Nothing due — every intro is inside its cadence.</div>'; return; }
  const cls = { 'Day 3': 'stg-d3', 'Day 7': 'stg-d7', 'Day 14': 'stg-d14', 'Revisit': 'stg-rev', 'Replied': 'stg-rep' };
  host.innerHTML = lgFollowups.map(f => {
    const late = f.overdue > 0 ? `<span class="late"> · ${f.overdue} day${f.overdue === 1 ? '' : 's'} late</span>` : '';
    const acts = lgCanEdit ? `<div class="act">
        <button type="button" class="lg-mini" data-fu-call="${flowEsc(f.contactNo)}">📞 Call</button>
        <button type="button" class="lg-mini${f.stage === 'Replied' ? '' : ' pri'}" data-fu-email="${flowEsc(f.contactNo)}">✉ Email</button></div>` : '';
    return `<div class="fu"><span class="stg ${cls[f.stage] || 'stg-rev'}">${flowEsc(f.stage)}</span>
      <div class="who"><b>${flowEsc(f.name)} · ${flowEsc(f.company)}${f.plantSite ? ' — ' + flowEsc(f.plantSite) : ''}</b>${flowEsc(f.action)} · due ${flowEsc(f.due)}${late}</div>${acts}</div>`;
  }).join('');
  host.querySelectorAll('[data-fu-call]').forEach(b => b.addEventListener('click', () => openDock('call', { contactNo: b.getAttribute('data-fu-call'), kind: 'Follow-up' })));
  host.querySelectorAll('[data-fu-email]').forEach(b => b.addEventListener('click', () => openDock('batch', { contactNos: [b.getAttribute('data-fu-email')], kind: 'Follow-up' })));
}

// ── the dock ──────────────────────────────────────────────────────────────────────────────────
const DOCK_TABS = [['call', '📞 Call'], ['batch', '✉️ Email batch'], ['plant', '🏭 Plant'], ['contact', '👤 Contact']];
let lgDockPrefill = null;
function openDock(tab, prefill) {
  if (!lgCanEdit) return;
  lgDockTab = DOCK_TABS.some(t => t[0] === tab) ? tab : 'call';
  lgDockPrefill = prefill || null;
  renderDock();
  document.getElementById('dock').classList.add('open');
}
function closeDock() { document.getElementById('dock').classList.remove('open'); }
function plantOptions(sel) {
  return lgData.plants.slice().sort((a, b) => String(a.company).localeCompare(String(b.company)))
    .map(p => `<option value="${flowEsc(p.plantNo)}"${p.plantNo === sel ? ' selected' : ''}>${flowEsc(p.company)}${p.plantSite ? ' — ' + flowEsc(p.plantSite) : ''}</option>`).join('');
}
function contactOptions(sel, onlyEmail) {
  return lgData.contacts.filter(c => !onlyEmail || c.email).slice().sort((a, b) => String(a.company).localeCompare(String(b.company)) || String(a.name).localeCompare(String(b.name)))
    .map(c => `<option value="${flowEsc(c.contactNo)}"${c.contactNo === sel ? ' selected' : ''}>${flowEsc(c.name)} · ${flowEsc(c.company)}${c.plantSite ? ' — ' + flowEsc(c.plantSite) : ''}</option>`).join('');
}
function sel(key, label, opts, value, span) {
  return `<div${span ? ' class="full"' : ''}><label>${flowEsc(label)}</label><select data-key="${key}">${opts.map(o => `<option${String(value) === o ? ' selected' : ''}>${flowEsc(o)}</option>`).join('')}</select></div>`;
}
function inp(key, label, type, value, span, extra) {
  return `<div${span ? ' class="full"' : ''}><label>${flowEsc(label)}</label><input type="${type}" data-key="${key}" value="${flowEsc(value == null ? '' : value)}"${extra || ''}></div>`;
}
function renderDock() {
  const k = lgCounts || { today: flowToday(), sector: {}, maxBatch: 60 };
  const p = lgDockPrefill || {};
  document.getElementById('dockTabs').innerHTML = DOCK_TABS.map(([id, l]) => `<span class="dock-tab${id === lgDockTab ? ' active' : ''}" data-tab="${id}">${l}</span>`).join('');
  document.querySelectorAll('#dockTabs .dock-tab').forEach(t => t.addEventListener('click', () => { lgDockTab = t.getAttribute('data-tab'); lgDockPrefill = null; renderDock(); }));
  const F = document.getElementById('dockFields'), hint = document.getElementById('dockHint');
  const sectorNow = (k.sector && k.sector.name) || '';
  if (lgDockTab === 'call') {
    hint.textContent = 'one call, one outcome';
    F.innerHTML = `<div class="full"><label>Contact *</label><select data-key="contactNo" required><option value="">— pick a contact —</option>${contactOptions(p.contactNo || '')}</select></div>` +
      sel('kind', 'Kind', LG_ENUM.callKind, p.kind || 'Cold') + sel('outcome', 'Outcome', LG_ENUM.callOutcome, 'No answer') +
      inp('date', 'Date', 'date', k.today) + inp('notes', 'Notes (referred to whom, why not interested…)', 'text', '') ;
  } else if (lgDockTab === 'batch') {
    hint.textContent = 'the count is read off the selection';
    const pre = (p.contactNos || []).reduce((m, x) => { m[x] = 1; return m; }, {});
    F.innerHTML = sel('kind', 'Kind', LG_ENUM.batchKind, p.kind || 'Intro') + inp('timeSlot', 'Time slot', 'text', '', false, ' placeholder="08:30"') +
      sel('sector', 'Sector', [''].concat(LG_ENUM.sector), sectorNow) + inp('template', 'Template', 'text', '') +
      `<div class="full"><label>Contacts (with an email)</label>
        <div class="pick-tools"><input type="text" id="pickSearch" placeholder="Filter by name or company…"><select id="pickSector"><option value="">All sectors</option>${LG_ENUM.sector.map(s => `<option${s === sectorNow && !p.contactNos ? ' selected' : ''}>${s}</option>`).join('')}</select>
          <button type="button" class="lg-mini" id="pickAll">select shown</button><button type="button" class="lg-mini" id="pickNone">clear</button><span class="cnt" id="pickCount">0 selected</span></div>
        <div class="pick" id="pick"></div>
        <div class="dock-hint">At most ${k.maxBatch || 60} per batch. An Intro batch starts each contact's follow-up clock; a second intro does not restart it.</div></div>` +
      inp('date', 'Date', 'date', k.today) + inp('notes', 'Notes', 'text', '');
    const pick = document.getElementById('pick');
    const drawPick = () => {
      const q = document.getElementById('pickSearch').value.trim().toLowerCase(), s = document.getElementById('pickSector').value;
      const chosen = {}; pick.querySelectorAll('input:checked').forEach(i => { chosen[i.value] = 1; });
      Object.assign(chosen, pre); Object.keys(pre).forEach(x => delete pre[x]);
      const rows = lgData.contacts.filter(c => c.email && c.status !== 'Do Not Contact' && (!s || c.sector === s) && (!q || (c.name + ' ' + c.company + ' ' + c.plantSite).toLowerCase().includes(q)));
      pick.innerHTML = rows.length ? rows.map(c => `<label><input type="checkbox" value="${flowEsc(c.contactNo)}"${chosen[c.contactNo] ? ' checked' : ''}>${flowEsc(c.name)} · ${flowEsc(c.company)}${c.plantSite ? ' — ' + flowEsc(c.plantSite) : ''}<small>${c.introSent ? 'intro ' + flowEsc(c.introSent) : 'no intro yet'}</small></label>`).join('')
        : '<div class="lg-empty">No contacts with an email match.</div>';
      Object.keys(chosen).filter(x => !rows.some(c => c.contactNo === x)).forEach(x => { pick.insertAdjacentHTML('afterbegin', `<label><input type="checkbox" value="${flowEsc(x)}" checked>${flowEsc((lgData.contacts.find(c => c.contactNo === x) || { name: x }).name)}<small>selected</small></label>`); });
      pick.querySelectorAll('input').forEach(i => i.addEventListener('change', countPick));
      countPick();
    };
    const countPick = () => { const n = pick.querySelectorAll('input:checked').length; const el = document.getElementById('pickCount'); el.textContent = n + ' selected'; el.style.color = n > (k.maxBatch || 60) ? '#b91c1c' : ''; };
    document.getElementById('pickSearch').addEventListener('input', drawPick);
    document.getElementById('pickSector').addEventListener('change', drawPick);
    document.getElementById('pickAll').addEventListener('click', () => { pick.querySelectorAll('input').forEach(i => { i.checked = true; }); countPick(); });
    document.getElementById('pickNone').addEventListener('click', () => { pick.querySelectorAll('input').forEach(i => { i.checked = false; }); countPick(); });
    drawPick();
  } else if (lgDockTab === 'plant') {
    hint.textContent = 'one site per row — a second site of the same company is a second plant';
    F.innerHTML = inp('company', 'Company *', 'text', '', false, ' required') + inp('plantSite', 'Plant / Site', 'text', '') +
      sel('sector', 'Sector *', LG_ENUM.sector, sectorNow || 'Cement') + sel('territory', 'Territory *', LG_ENUM.territory, 'Luzon') +
      inp('province', 'Province', 'text', '') + inp('equipment', 'Equipment / lines', 'text', '') + inp('source', 'Source (PhilGEPS, LinkedIn, Google…)', 'text', '') +
      `<div><label>&nbsp;</label><label class="chk"><input type="checkbox" data-key="philgeps"> PhilGEPS-registered</label></div>` + inp('notes', 'Notes', 'text', '', true);
  } else {
    hint.textContent = 'two per plant: the maintenance head and MRO / purchasing';
    F.innerHTML = `<div class="full"><label>Plant *</label><select data-key="plantNo" required><option value="">— pick a plant —</option>${plantOptions(p.plantNo || lgLastPlant)}</select></div>` +
      inp('name', 'Name *', 'text', '', false, ' required') + sel('role', 'Role', LG_ENUM.contactRole, 'Maintenance / O&M Head') +
      inp('email', 'Email', 'text', '') + sel('emailVerified', 'Email verified', LG_ENUM.emailVerified, 'Unverified') +
      inp('mobile', 'Mobile', 'text', '') + inp('linkedin', 'LinkedIn', 'text', '') + inp('notes', 'Notes', 'text', '', true);
  }
  document.getElementById('dockMsg').style.display = 'none';
  const first = F.querySelector('input:not([type=checkbox]),select'); if (first) setTimeout(() => first.focus(), 50);
}
function dockValues() {
  const rec = {};
  document.querySelectorAll('#dockFields [data-key]').forEach(el => {
    rec[el.getAttribute('data-key')] = el.type === 'checkbox' ? el.checked : (el.value || '').trim();
  });
  return rec;
}
async function submitDock() {
  const btn = document.getElementById('dockSave'), msg = document.getElementById('dockMsg');
  const rec = dockValues();
  const err = (t) => { msg.style.display = 'block'; msg.textContent = t; msg.style.color = '#b45309'; };
  msg.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let res;
    if (lgDockTab === 'call') {
      if (!rec.contactNo) throw new Error('Pick the contact you called.');
      res = await postFlow('logSalesCall', { contactNo: rec.contactNo, kind: rec.kind, outcome: rec.outcome, notes: rec.notes, date: rec.date });
    } else if (lgDockTab === 'batch') {
      const nos = Array.from(document.querySelectorAll('#pick input:checked')).map(i => i.value);
      if (!nos.length) throw new Error('Pick the contacts this batch went to.');
      res = await postFlow('saveLeadgenRecord', { entity: 'batches', clientRef: flowClientRef(),
        record: JSON.stringify({ kind: rec.kind, timeSlot: rec.timeSlot, sector: rec.sector, template: rec.template, notes: rec.notes, date: rec.date, contactNos: nos }) });
    } else if (lgDockTab === 'plant') {
      res = await postFlow('saveLeadgenRecord', { entity: 'plants', clientRef: flowClientRef(), record: JSON.stringify(rec) });
    } else {
      if (!rec.plantNo) throw new Error('Pick the plant.');
      lgLastPlant = rec.plantNo;
      res = await postFlow('saveLeadgenRecord', { entity: 'contacts', clientRef: flowClientRef(), record: JSON.stringify(rec) });
    }
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    flash(res.message || 'Saved.', true);
    const keep = document.getElementById('dockKeep').checked && lgDockTab !== 'batch';
    await Promise.all([loadCounts(), loadFollowups(), loadData()]);
    if (keep) { lgDockPrefill = lgDockTab === 'contact' ? { plantNo: lgLastPlant } : null; renderDock(); }
    else closeDock();
  } catch (e) { err(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

// ── trackers ──────────────────────────────────────────────────────────────────────────────────
function render() { buildTabs(); renderPanel(lgActiveTab); }
function buildTabs() {
  document.getElementById('tabs').innerHTML = LG_TAB_ORDER.map(k => {
    const u = LG_UI[k];
    return `<div class="mkt-tab ${lgActiveTab === k ? 'active' : ''}" data-tab="${k}">${u.icon} ${u.label}<span class="cnt">${(lgData[k] || []).length}</span></div>`;
  }).join('');
  document.querySelectorAll('#tabs .mkt-tab').forEach(t => t.addEventListener('click', () => { lgActiveTab = t.getAttribute('data-tab'); render(); }));
}
function filterValues(key) {
  if (key === 'sector') return LG_ENUM.sector; if (key === 'territory') return LG_ENUM.territory;
  if (key === 'status') return { plants: LG_ENUM.plantStatus, contacts: LG_ENUM.contactStatus, leads: LG_ENUM.leadStatus, accred: LG_ENUM.accredStatus }[lgActiveTab];
  if (key === 'emailVerified') return LG_ENUM.emailVerified; return [];
}
function renderPanel(tab) {
  const u = LG_UI[tab], host = document.getElementById('panels');
  const rows = (lgData[tab] || []).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  host.innerHTML = `<div class="panel-toolbar">
      <h3>${u.icon} ${flowEsc(u.title)}</h3>
      <input type="text" id="pSearch" placeholder="Search…">
      ${(u.filters || []).map(f => `<select data-filter="${f}"><option value="">All ${({ emailVerified: 'verification', status: 'statuses', territory: 'territories', sector: 'sectors' })[f] || f}</option>${filterValues(f).map(v => `<option>${flowEsc(v)}</option>`).join('')}</select>`).join('')}
      <span class="spacer"></span>
      ${/* `primary` alongside btn-primary: bento-skin-director paints .btn-sm white AFTER .btn-primary indigo, so a
            small primary button is white-on-white unless it also carries the skin's own .btn-sm.primary class. */ ''}
      ${lgCanEdit && tab !== 'leads' ? `<button type="button" class="btn btn-sm btn-primary primary" id="pAdd">+ Add ${u.label.replace(/s$/, '')}</button>` : ''}
      ${lgCanEdit && tab === 'leads' ? `<button type="button" class="btn btn-sm btn-primary primary" id="pAdd">+ Qualify a lead</button>` : ''}
    </div><div id="pBody" style="overflow-x:auto;"></div>`;
  const reRender = () => renderRows(tab, rows);
  document.getElementById('pSearch').addEventListener('input', reRender);
  host.querySelectorAll('[data-filter]').forEach(s => s.addEventListener('change', reRender));
  if (document.getElementById('pAdd')) document.getElementById('pAdd').addEventListener('click', () => openRecModal(tab, null));
  renderRows(tab, rows);
}
function renderRows(tab, rows) {
  const u = LG_UI[tab];
  const q = (document.getElementById('pSearch').value || '').trim().toLowerCase();
  const fs = {}; document.querySelectorAll('#panels [data-filter]').forEach(s => { if (s.value) fs[s.getAttribute('data-filter')] = s.value; });
  const filtered = rows.filter(r => Object.keys(fs).every(k => String(r[k] || '') === fs[k]) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
  const body = document.getElementById('pBody');
  if (!filtered.length) { body.innerHTML = '<div class="lg-empty">Nothing here yet.</div>'; return; }
  if (u.cards) { renderLeadCards(filtered); return; }
  const th = u.cols.map(c => `<th>${c[1]}</th>`).join('');
  const trs = filtered.map(r => {
    const tds = u.cols.map(c => cell(r, c[0])).join('');
    const acts = lgCanEdit ? `<td style="white-space:nowrap;"><button class="mkt-act" data-edit="${r.rowIndex}">Edit</button> <button class="mkt-act" data-del="${r.rowIndex}" title="Remove">✕</button></td>` : '<td></td>';
    return `<tr>${tds}${acts}</tr>`;
  }).join('');
  body.innerHTML = `<table class="flow-table"><thead><tr>${th}<th></th></tr></thead><tbody>${trs}</tbody></table>`;
  wireRowButtons(tab, body);
}
function wireRowButtons(tab, body) {
  body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openRecModal(tab, b.getAttribute('data-edit'))));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delRecord(tab, b.getAttribute('data-del'))));
  body.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => openLeadPdf(b.getAttribute('data-pdf'))));
}
function cell(r, key) {
  const v = r[key];
  if (key === 'status' || key === 'emailVerified') return `<td>${badge(v)}</td>`;
  if (typeof v === 'boolean') return `<td>${v ? '✓' : '—'}</td>`;
  if (/Date$|^introSent$|^submitted$|^approved$|^expiry$/.test(key)) return `<td style="white-space:nowrap;">${flowEsc(v || '—')}</td>`;
  return `<td>${flowEsc(v || '—')}</td>`;
}
function badge(s) {
  const k = String(s || '').toLowerCase();
  let cls = 'b-new';
  if (['active', 'approved', 'won', 'replied', 'pattern', 'switchboard', 'customer', 'presentation booked', 'quoted'].includes(k)) cls = 'b-good';
  else if (['pending', 'submitted', 'handed off', 'new'].includes(k)) cls = 'b-info';
  else if (['cold', 'unverified', 'returned'].includes(k)) cls = 'b-warm';
  else if (['lost', 'expired', 'bounced', 'wrong person', 'do not contact'].includes(k)) cls = 'b-bad';
  return `<span class="mkt-badge ${cls}">${flowEsc(s || '—')}</span>`;
}
function renderLeadCards(rows) {
  const body = document.getElementById('pBody');
  const flag = (on, t) => `<span class="${on ? '' : 'no'}">${on ? '✓' : '✕'} ${t}</span>`;
  body.innerHTML = `<div class="lead-cards">${rows.map(l => `<div class="lead">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;"><h4>${flowEsc(l.company)}${l.plantSite ? ' — ' + flowEsc(l.plantSite) : ''}</h4>${badge(l.status)}</div>
      <div class="kv">${flowEsc(l.leadNo)} · ${flowEsc(l.territory)} → <b>${flowEsc(l.handedTo || 'no rep set')}</b> · handed ${flowEsc(l.handedOffOn || '—')}${l.rehandedOn ? ' · re-handed ' + flowEsc(l.rehandedOn) + ' (not counted)' : ''}</div>
      ${l.contactName ? `<div class="kv"><b>${flowEsc(l.contactName)}</b>${l.contactRole ? ' · ' + flowEsc(l.contactRole) : ''}${l.contactMobile ? ' · ' + flowEsc(l.contactMobile) : ''}${l.contactEmail ? ' · ' + flowEsc(l.contactEmail) : ''}</div>` : ''}
      <div class="q">${flag(l.rightPerson, 'right person')}${flag(l.ownMaintenance, 'own maintenance')}${flag(l.flangedOrHydraulic, 'flanged / hydraulic')}${flag(l.saidYes, 'said yes')}</div>
      ${l.pain ? `<div class="kv"><b>Pain:</b> ${flowEsc(l.pain)}</div>` : ''}
      ${l.whatTheySaid ? `<div class="kv"><b>They said:</b> ${flowEsc(l.whatTheySaid)}</div>` : ''}
      ${l.nextStep || l.nextStepDate ? `<div class="kv"><b>Next:</b> ${flowEsc(l.nextStep || '')}${l.nextStepDate ? ' · ' + flowEsc(l.nextStepDate) : ''}</div>` : ''}
      ${l.presentationDate ? `<div class="kv"><b>Presentation:</b> ${flowEsc(l.presentationDate)}${l.bookedOn ? ' (booked ' + flowEsc(l.bookedOn) + ')' : ''}</div>` : ''}
      ${l.status === 'Returned' ? `<div class="kv" style="color:#b91c1c"><b>Returned ${flowEsc(l.returnedOn)}:</b> ${flowEsc(l.returnReason)}</div>` : ''}
      <div class="foot"><button type="button" class="lg-mini" data-pdf="${flowEsc(l.leadNo)}">📄 Lead sheet</button>${lgCanEdit ? `<button type="button" class="lg-mini" data-edit="${l.rowIndex}">Edit</button><button type="button" class="lg-mini" data-del="${l.rowIndex}">✕</button>` : ''}</div>
    </div>`).join('')}</div>`;
  wireRowButtons('leads', body);
}

// ── edit modal ────────────────────────────────────────────────────────────────────────────────
function openRecModal(entity, rowIndex) {
  const u = LG_UI[entity];
  const rec = rowIndex ? (lgData[entity] || []).find(r => String(r.rowIndex) === String(rowIndex)) : null;
  const idKey = { plants: 'plantNo', contacts: 'contactNo', leads: 'leadNo', accred: 'accredNo' }[entity];
  document.getElementById('recEntity').value = entity;
  document.getElementById('recRowIndex').value = rec ? rec.rowIndex : '';
  document.getElementById('recId').value = rec ? rec[idKey] : '';
  document.getElementById('recModalTitle').textContent = (rec ? 'Edit ' : (entity === 'leads' ? 'Qualify a ' : 'Add ')) + u.label.replace(/s$/, '');
  document.getElementById('recForm').innerHTML = u.fields.filter(f => rec || !(entity === 'leads' && (f[0] === 'status' || f[0] === 'handedTo'))).map(f => fieldHtml(f, rec)).join('') +
    (entity === 'leads' && !rec ? '<div class="full dock-hint">A lead is handed off only when all four conditions are ticked. The rep is chosen by territory; a Prospect client is created if the company is new.</div>' : '');
  document.getElementById('recFormMsg').style.display = 'none';
  document.getElementById('recModal').classList.add('open');
  const first = document.querySelector('#recForm input:not([type=checkbox]),#recForm select'); if (first) setTimeout(() => first.focus(), 50);
}
function fieldHtml(f, rec) {
  const [key, label, type, opts, span] = f;
  const v = rec ? (rec[key] != null ? rec[key] : '') : '';
  const cls = span === 'full' ? ' class="full"' : '';
  let input;
  if (type === 'select') input = `<select data-key="${key}">${(opts || []).map(o => `<option${String(v) === o ? ' selected' : ''}>${flowEsc(o)}</option>`).join('')}</select>`;
  else if (type === 'plant') input = `<select data-key="${key}"><option value="">— pick a plant —</option>${plantOptions(v || lgLastPlant)}</select>`;
  else if (type === 'contact') input = `<select data-key="${key}"><option value="">— none —</option>${contactOptions(v)}</select>`;
  else if (type === 'check') return `<div${cls}><label class="chk"><input type="checkbox" data-key="${key}"${v === true ? ' checked' : ''}> ${flowEsc(label)}</label></div>`;
  else if (type === 'textarea') input = `<textarea data-key="${key}">${flowEsc(v)}</textarea>`;
  else input = `<input type="${type}" data-key="${key}" value="${flowEsc(v)}">`;
  return `<div${cls}><label>${flowEsc(label)}</label>${input}</div>`;
}
function closeRecModal() { document.getElementById('recModal').classList.remove('open'); }
async function submitRecord() {
  const entity = document.getElementById('recEntity').value, u = LG_UI[entity];
  const rec = {};
  document.querySelectorAll('#recForm [data-key]').forEach(el => { rec[el.getAttribute('data-key')] = el.type === 'checkbox' ? el.checked : (el.value || '').trim(); });
  for (const r of (u.required || [])) if (!rec[r]) { formErr(u.fields.find(f => f[0] === r)[1].replace(' *', '') + ' is required.'); return; }
  const ri = document.getElementById('recRowIndex').value, id = document.getElementById('recId').value;
  if (ri) { rec.rowIndex = ri; rec[{ plants: 'plantNo', contacts: 'contactNo', leads: 'leadNo', accred: 'accredNo' }[entity]] = id; }
  if (rec.plantNo) lgLastPlant = rec.plantNo;
  const btn = document.getElementById('recSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveLeadgenRecord', { entity, record: JSON.stringify(rec), clientRef: ri ? undefined : flowClientRef() });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    closeRecModal();
    flash(res.message || 'Saved.', true);
    await Promise.all([loadCounts(), loadFollowups(), loadData()]);
  } catch (e) { formErr(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}
async function delRecord(entity, rowIndex) {
  const rec = (lgData[entity] || []).find(r => String(r.rowIndex) === String(rowIndex));
  if (!rec) return;
  const id = rec[{ plants: 'plantNo', contacts: 'contactNo', leads: 'leadNo', accred: 'accredNo' }[entity]];
  if (!confirm('Remove ' + id + '? It is kept on the sheet, marked removed, and drops out of every count.')) return;
  try {
    const res = await postFlow('deleteLeadgenRecord', { entity, id, rowIndex: rec.rowIndex });
    if (!res || !res.success) throw new Error((res && res.message) || 'Remove failed.');
    flash(res.message || 'Removed.', true);
    await Promise.all([loadCounts(), loadFollowups(), loadData()]);
  } catch (e) { flash(e.message, false); }
}

// ── PDFs — rendered by Flask/ReportLab from the same payloads the screen drew ─────────────────
async function fetchPdf(url, payload, name) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) { let m = 'HTTP ' + res.status; try { const j = await res.json(); if (j && j.message) m = j.message; } catch (e) {} throw new Error(m); }
  const blob = await res.blob();
  const u = URL.createObjectURL(blob);
  const w = window.open(u, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = u; a.download = name; a.click(); }
}
async function openWeekPdf() {
  if (!lgCounts) return;
  const btn = document.getElementById('fridayPdfBtn'); btn.disabled = true;
  try { await fetchPdf('/flow/leadgen-report-pdf', Object.assign({}, lgCounts, { preparedBy: lgSession.name, labels: LG_TILE_LABEL }), 'LeadGen_Week_' + lgCounts.week.start + '.pdf'); }
  catch (e) { flash('PDF: ' + e.message, false); }
  finally { btn.disabled = false; }
}
async function openLeadPdf(leadNo) {
  const l = lgData.leads.find(x => x.leadNo === leadNo); if (!l) return;
  try { await fetchPdf('/flow/leadgen-lead-pdf', { lead: l, preparedBy: lgSession.name }, 'Lead_' + leadNo + '.pdf'); }
  catch (e) { flash('PDF: ' + e.message, false); }
}

// ── settings (director / management) ─────────────────────────────────────────────────────────
async function openSettings() {
  const k = lgCounts; if (!k) return;
  document.getElementById('setQuotas').innerHTML = LG_TILES.map(([key, label]) => `<div><label>${flowEsc(label)}</label><input type="number" min="0" data-quota="${key}" value="${k.quotas[key] || 0}"></div>`).join('');
  document.getElementById('setMaxBatch').value = k.maxBatch || 60;
  document.getElementById('setReplyAim').value = k.week.replyRateAim || 0;
  document.getElementById('setDays').innerHTML = LG_DOW.map(d => `<label><input type="checkbox" value="${d}"${(k.workingDays || []).includes(d) ? ' checked' : ''}>${d}</label>`).join('');
  document.getElementById('setHolidays').value = (k.holidays || []).join(', ');
  let cycle = ''; try { const s = await fetchFlow('getFlowSettings', {}, { fresh: true }); cycle = (s && s.data && s.data.lgSectorCycle) || ''; } catch (e) {}
  document.getElementById('setCycle').value = cycle;
  let users = [];
  try { const r = await apiGetUsers(); users = (r && (r.users || r.data)) || []; } catch (e) {}
  const reps = users.filter(u => String(u.role || '').toLowerCase() === 'sales');
  const opts = (cur) => `<option value="">— none —</option>` + reps.map(u => `<option value="${flowEsc(u.username)}"${u.username === cur ? ' selected' : ''}>${flowEsc(u.fullName || u.name || u.username)} (${flowEsc(u.username)})</option>`).join('') +
    (cur && !reps.some(u => u.username === cur) ? `<option value="${flowEsc(cur)}" selected>${flowEsc(cur)}</option>` : '');
  document.getElementById('setRepLuzon').innerHTML = opts(k.reps.Luzon);
  document.getElementById('setRepVisMin').innerHTML = opts(k.reps.VisMin);
  document.getElementById('setMsg').style.display = 'none';
  document.getElementById('setModal').classList.add('open');
}
async function saveSettings() {
  const patch = {};
  document.querySelectorAll('#setQuotas [data-quota]').forEach(i => { patch[{ plants: 'lgQuotaPlants', contacts: 'lgQuotaContacts', introEmails: 'lgQuotaIntroEmails', followupEmails: 'lgQuotaFollowupEmails', coldCalls: 'lgQuotaColdCalls', followupCalls: 'lgQuotaFollowupCalls', leads: 'lgQuotaLeads', meetings: 'lgQuotaMeetings' }[i.getAttribute('data-quota')]] = Number(i.value) || 0; });
  patch.lgMaxBatch = Number(document.getElementById('setMaxBatch').value) || 60;
  patch.lgReplyRateAim = Number(document.getElementById('setReplyAim').value) || 0;
  patch.lgWorkingDays = Array.from(document.querySelectorAll('#setDays input:checked')).map(i => i.value).join(',');
  patch.lgHolidays = document.getElementById('setHolidays').value.split(',').map(s => s.trim()).filter(Boolean).join(',');
  patch.lgSectorCycle = document.getElementById('setCycle').value.split(',').map(s => s.trim()).filter(Boolean).join(',');
  patch.lgRepLuzon = document.getElementById('setRepLuzon').value;
  patch.lgRepVisMin = document.getElementById('setRepVisMin').value;
  const bad = patch.lgHolidays.split(',').filter(Boolean).find(d => !/^\d{4}-\d{2}-\d{2}$/.test(d));
  const msg = document.getElementById('setMsg');
  if (bad) { msg.style.display = 'block'; msg.style.color = '#b45309'; msg.textContent = '"' + bad + '" is not a yyyy-mm-dd date.'; return; }
  if (!patch.lgWorkingDays) { msg.style.display = 'block'; msg.style.color = '#b45309'; msg.textContent = 'Pick at least one working day.'; return; }
  const btn = document.getElementById('setSave'); btn.disabled = true;
  try {
    if (typeof flowSetViewerOnly === 'function') flowSetViewerOnly(false);      // the one write oversight may make
    const res = await postFlow('setFlowSettings', { settings: JSON.stringify(patch) });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    document.getElementById('setModal').classList.remove('open');
    flash('Quotas and working week saved.', true);
    await loadCounts();
  } catch (e) { msg.style.display = 'block'; msg.style.color = '#b45309'; msg.textContent = e.message; }
  finally { if (typeof flowSetViewerOnly === 'function') flowSetViewerOnly(lgOversight); btn.disabled = false; }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────
function formErr(m) { const el = document.getElementById('recFormMsg'); el.style.display = 'block'; el.textContent = m; el.style.color = '#b45309'; }
function flash(text, ok) { const m = document.getElementById('msg'); m.style.display = 'block'; m.textContent = text; m.style.color = ok ? '#15803d' : '#b45309'; setTimeout(() => { m.style.display = 'none'; }, 3500); }
