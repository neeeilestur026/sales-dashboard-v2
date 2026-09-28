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
  reached: ['Decision-maker', 'Gatekeeper', 'Voicemail / no answer'],           // A279
  linkedinKind: ['Connection request', 'Message'],
  supplierStatus: ['Researching', 'Qualified', 'Handed Off', 'Rejected'],
};
/* A279 — the nine daily items of the job description, in its order. The fourth element is which
   logger the tile opens; 'eod' goes to the daily report instead. */
const LG_TILES = [
  ['attempts', 'Outbound attempts', 'phone', 'call'], ['conversations', 'Decision-maker conversations', 'chat', 'call'],
  ['emails', 'Prospecting emails', 'mail', 'batch'], ['linkedin', 'LinkedIn requests & messages', 'linkedin', 'linkedin'],
  ['suppliers', 'Local suppliers researched', 'package', 'supplier'], ['accounts', 'Target accounts researched', 'factory', 'plant'],
  ['crm', 'CRM updated', 'database', 'contact'], ['eod', 'End-of-day report', 'file', 'eod'],
  ['scheduled', 'Meetings / calls scheduled', 'calendar', 'contact'],
];
const LG_WEEKLY = [
  ['activeAccounts', 'Target accounts in active pursuit'], ['leads', 'Qualified leads handed to Field Sales'],
  ['suppliersHandedOff', 'Qualified local suppliers handed off'], ['intelUpdates', 'Accounts updated with new intelligence'],
  ['meetings', 'Presentations booked'],
];
const LG_TILE_LABEL = {}; LG_TILES.forEach(t => { LG_TILE_LABEL[t[0]] = t[1]; });
const LG_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/* A287 — feather-style icons, one string each, 24-box, stroke = currentColor. The keys are what
   LG_TILES, LG_UI, and DOCK_TABS carry; leadgen.css sizes the svg by its container. */
const _lgIco = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const LG_ICON = {
  phone: _lgIco('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>'),
  chat: _lgIco('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  mail: _lgIco('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
  linkedin: _lgIco('<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>'),
  package: _lgIco('<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
  factory: _lgIco('<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>'),
  database: _lgIco('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'),
  file: _lgIco('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  calendar: _lgIco('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  users: _lgIco('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  target: _lgIco('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  clipboard: _lgIco('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'),
  pin: _lgIco('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
};

/* Per-entity UI: columns for the table, fields for the edit modal. [key, label, type, options, span] */
const LG_UI = {
  plants: {
    label: 'Plants', icon: 'factory', title: 'Plants and sites',
    cols: [['plantNo', 'No'], ['company', 'Company'], ['plantSite', 'Plant / Site'], ['sector', 'Sector'], ['province', 'Province'], ['territory', 'Territory'], ['status', 'Status'], ['nextActionDate', 'Next action']],
    fields: [['company', 'Company *', 'text'], ['plantSite', 'Plant / Site', 'text'], ['sector', 'Sector *', 'select', LG_ENUM.sector], ['territory', 'Territory *', 'select', LG_ENUM.territory],
             ['province', 'Province', 'text'], ['status', 'Status', 'select', LG_ENUM.plantStatus], ['equipment', 'Equipment / lines', 'text'], ['source', 'Source', 'text'],
             ['philgeps', 'PhilGEPS-registered', 'check'], ['nextActionDate', 'Next action date', 'date'], ['nextAction', 'Next action', 'text', null, 'full'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['company', 'sector', 'territory'], filters: ['sector', 'territory', 'status'],
  },
  contacts: {
    label: 'Contacts', icon: 'users', title: 'Contacts',
    cols: [['contactNo', 'No'], ['name', 'Name'], ['role', 'Role'], ['company', 'Company'], ['plantSite', 'Site'], ['email', 'Email'], ['emailVerified', 'Verified'], ['status', 'Status'], ['introSent', 'Intro sent'], ['nextCallDate', 'Next call']],
    fields: [['plantNo', 'Plant *', 'plant'], ['name', 'Name *', 'text'], ['role', 'Role', 'select', LG_ENUM.contactRole], ['emailVerified', 'Email verified', 'select', LG_ENUM.emailVerified],
             ['email', 'Email', 'text'], ['mobile', 'Mobile', 'text'], ['linkedin', 'LinkedIn', 'text'], ['status', 'Status', 'select', LG_ENUM.contactStatus],
             ['nextCallDate', 'Next call scheduled for', 'date'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['plantNo', 'name'], filters: ['sector', 'territory', 'emailVerified', 'status'],
  },
  suppliers: {
    label: 'Suppliers', icon: 'package', title: 'Local suppliers, for local procurement',
    cols: [['supplierNo', 'No'], ['company', 'Company'], ['category', 'Category'], ['location', 'Location'], ['contact', 'Contact'], ['email', 'Email'], ['status', 'Status'], ['handedOffOn', 'Handed off']],
    fields: [['company', 'Company *', 'text'], ['category', 'Category (fasteners, hydraulics, machining…)', 'text'], ['location', 'Location', 'text'],
             ['status', 'Status', 'select', LG_ENUM.supplierStatus], ['contact', 'Contact person', 'text'], ['email', 'Email', 'text'],
             ['mobile', 'Mobile', 'text'], ['website', 'Website', 'text'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['company'], filters: ['status'],
  },
  leads: {
    label: 'Leads', icon: 'target', title: 'Qualified leads', cards: true,
    fields: [['plantNo', 'Plant *', 'plant'], ['contactNo', 'Contact', 'contact'], ['status', 'Status', 'select', LG_ENUM.leadStatus], ['handedTo', 'Handed to (rep username)', 'text'],
             ['rightPerson', 'Right person', 'check'], ['ownMaintenance', 'Runs its own maintenance', 'check'], ['flangedOrHydraulic', 'Has flanged / hydraulic work', 'check'], ['saidYes', 'Said yes to a presentation or asked for a quote', 'check'],
             ['pain', 'Pain', 'text', null, 'full'], ['whatTheySaid', 'What they said', 'textarea', null, 'full'], ['nextStep', 'Next step', 'text'], ['nextStepDate', 'Next step date', 'date'],
             ['presentationDate', 'Presentation date', 'date'], ['attendees', 'Attendees (presentation)', 'text'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['plantNo'], filters: ['territory', 'status'],
  },
  accred: {
    label: 'Accreditation', icon: 'clipboard', title: 'Vendor accreditation',
    cols: [['accredNo', 'No'], ['company', 'Company'], ['plantSite', 'Site'], ['status', 'Status'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['expiry', 'Expiry'], ['docsSent', 'Docs']],
    fields: [['plantNo', 'Plant *', 'plant'], ['company', 'Company', 'text'], ['status', 'Status', 'select', LG_ENUM.accredStatus], ['docsSent', 'Documents sent', 'check'],
             ['submitted', 'Submitted', 'date'], ['approved', 'Approved', 'date'], ['expiry', 'Expiry', 'date'], ['notes', 'Notes', 'textarea', null, 'full']],
    required: ['plantNo'], filters: ['status'],
  },
};
const LG_TAB_ORDER = ['plants', 'contacts', 'suppliers', 'leads', 'accred'];

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
  document.getElementById('subline').textContent = lgOversight ? 'Lead generation, oversight view' : 'Lead generation';

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
    if (!r || !r.success) throw new Error((r && r.message) || "Today's counts did not load.");
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
function lgBar(pct, state) { return `<div class="lg-bar"><i class="${state}" style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`; }
function renderTiles() {
  const k = lgCounts; if (!k) return;
  const stName = { met: '✓ met', pace: 'on pace', behind: 'behind', off: '—' };
  document.getElementById('tilesMeta').textContent = (k.day.working ? 'Counted at server time ' : 'Not a working day, counted at server time ') + k.hour;
  const range = (key) => { const a = k.quotas[key] || 0, b = (k.quotasMax || {})[key] || a; return b > a ? a + '–' + b : String(a); };
  document.getElementById('tiles').innerHTML = LG_TILES.map(([key, label, icon, dock]) => {
    const n = k.day[key] || 0, q = k.quotas[key] || 0, st = tileState(n, q, k.hour, k.day.working);
    const pct = q > 0 ? Math.round(n / q * 100) : 0;
    let sub = '';
    if (key === 'emails' && lgMailbox) {
      sub = lgMailbox.needsSetup ? 'Mailbox not connected' : lgMailbox.ok ? `mailbox saw ${lgMailbox.seen} to listed contacts` : 'Mailbox unreachable';
    } else if (key === 'attempts') sub = 'Calls, emails and LinkedIn, combined';
    else if (key === 'conversations') sub = 'Calls that reached the decision-maker';
    else if (key === 'crm') sub = n ? n + ' record' + (n === 1 ? '' : 's') + ' touched today' : 'Nothing logged yet';
    else if (key === 'eod') sub = n ? 'Submitted to Management' : 'Report not submitted yet. Open it from here.';
    else if (key === 'scheduled') sub = 'Follow-up calls booked plus presentations';
    const tag = lgCanEdit ? 'button type="button"' : 'div';
    return `<${tag} class="b-card lg-tile" data-dock="${dock}" data-st="${st}" ${lgCanEdit ? `title="${key === 'eod' ? 'Open the daily report' : 'Log ' + label.toLowerCase()}"` : ''}>
      <span class="st st-${st}">${stName[st]}</span>
      <div class="t"><span class="ic">${LG_ICON[icon] || ''}</span><span>${flowEsc(label)}</span></div>
      <div class="n">${key === 'eod' ? (n ? 'Done' : '—') : n}<small>${key === 'eod' ? '' : '/ ' + range(key)}</small></div>
      ${lgBar(pct, st)}
      <div class="sub">${flowEsc(sub)}</div>
    </${tag.split(' ')[0]}>`;
  }).join('');
  if (lgCanEdit) document.querySelectorAll('#tiles [data-dock]').forEach(b => b.addEventListener('click', () => {
    const d = b.getAttribute('data-dock');
    if (d === 'eod') { location.href = 'leadgen-daily-report.html'; return; }
    openDock(d);
  }));
}
function renderWeek() {
  const k = lgCounts; if (!k) return;
  const w = k.week;
  document.getElementById('weekMeta').textContent = w.start + ' → ' + w.end + ' · ' + w.workingDays.length + ' working day' + (w.workingDays.length === 1 ? '' : 's');
  const rowOf = (label, n, t, tMax) => {
    const pct = t > 0 ? Math.round(n / t * 100) : 0;
    const state = t > 0 && n >= t ? 'met' : 'on';
    const tgt = tMax > t ? t + '–' + tMax : String(t);
    return `<div class="wk-row"><span>${flowEsc(label)}</span>${lgBar(pct, state)}<span class="v">${n} / ${tgt}</span></div>`;
  };
  const rows = LG_TILES.filter(([key]) => key !== 'crm' && key !== 'eod').map(([key, label]) =>
    rowOf(label, w.totals[key] || 0, w.targets[key] || 0, (w.targetsMax || {})[key] || 0)).join('') +
    `<div class="wk-head">Weekly targets</div>` +
    LG_WEEKLY.map(([key, label]) => { const x = (w.weekly || {})[key] || { value: 0, min: 0, max: 0 }; return rowOf(label, x.value, x.min, x.max); }).join('');
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
  if (!lgFollowups.length) { host.innerHTML = '<div class="lg-empty">Nothing due today. Every intro is still within its follow-up window.</div>'; return; }
  const cls = { 'Day 3': 'stg-d3', 'Day 7': 'stg-d7', 'Day 14': 'stg-d14', 'Revisit': 'stg-rev', 'Replied': 'stg-rep' };
  host.innerHTML = lgFollowups.map(f => {
    const late = f.overdue > 0 ? `<span class="late">, ${f.overdue} day${f.overdue === 1 ? '' : 's'} late</span>` : '';
    const acts = lgCanEdit ? `<div class="act">
        <button type="button" class="lg-mini" data-fu-call="${flowEsc(f.contactNo)}">Call</button>
        <button type="button" class="lg-mini${f.stage === 'Replied' ? '' : ' pri'}" data-fu-email="${flowEsc(f.contactNo)}">Email</button></div>` : '';
    return `<div class="fu"><span class="stg ${cls[f.stage] || 'stg-rev'}">${flowEsc(f.stage)}</span>
      <div class="who"><b>${flowEsc(f.name)} · ${flowEsc(f.company)}${f.plantSite ? ' — ' + flowEsc(f.plantSite) : ''}</b>${flowEsc(f.action)}, due ${flowEsc(f.due)}${late}</div>${acts}</div>`;
  }).join('');
  host.querySelectorAll('[data-fu-call]').forEach(b => b.addEventListener('click', () => openDock('call', { contactNo: b.getAttribute('data-fu-call'), kind: 'Follow-up' })));
  host.querySelectorAll('[data-fu-email]').forEach(b => b.addEventListener('click', () => openDock('batch', { contactNos: [b.getAttribute('data-fu-email')], kind: 'Follow-up' })));
}

// ── the dock ──────────────────────────────────────────────────────────────────────────────────
const DOCK_TABS = [['call', 'phone', 'Call'], ['batch', 'mail', 'Emails'], ['linkedin', 'linkedin', 'LinkedIn'], ['plant', 'factory', 'Account'], ['contact', 'users', 'Contact'], ['supplier', 'package', 'Supplier']];
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
  document.getElementById('dockTabs').innerHTML = DOCK_TABS.map(([id, ic, l]) => `<span class="dock-tab${id === lgDockTab ? ' active' : ''}" data-tab="${id}" role="button" tabindex="0"><span class="ico">${LG_ICON[ic] || ''}</span>${l}</span>`).join('');
  document.querySelectorAll('#dockTabs .dock-tab').forEach(t => t.addEventListener('click', () => { lgDockTab = t.getAttribute('data-tab'); lgDockPrefill = null; renderDock(); }));
  const F = document.getElementById('dockFields'), hint = document.getElementById('dockHint');
  const sectorNow = (k.sector && k.sector.name) || '';
  if (lgDockTab === 'call') {
    hint.textContent = 'One call: who you reached and the outcome.';
    F.innerHTML = `<div class="full"><label>Contact *</label><select data-key="contactNo" required><option value="">— pick a contact —</option>${contactOptions(p.contactNo || '')}</select></div>` +
      sel('kind', 'Kind', LG_ENUM.callKind, p.kind || 'Cold') + sel('reached', 'Who did you reach?', LG_ENUM.reached, 'Voicemail / no answer') +
      sel('outcome', 'Outcome', LG_ENUM.callOutcome, 'No answer') + inp('date', 'Date', 'date', k.today) +
      inp('notes', 'Notes: the topic, who they referred you to, why not interested', 'text', '', true);
  } else if (lgDockTab === 'batch') {
    hint.textContent = 'The count is read off the selection.';
    const pre = (p.contactNos || []).reduce((m, x) => { m[x] = 1; return m; }, {});
    F.innerHTML = sel('kind', 'Kind', LG_ENUM.batchKind, p.kind || 'Intro') + inp('timeSlot', 'Time slot', 'text', '', false, ' placeholder="08:30"') +
      sel('sector', 'Sector', [''].concat(LG_ENUM.sector), sectorNow) + inp('template', 'Template', 'text', '') +
      `<div class="full"><label>Contacts (with an email)</label>
        <div class="pick-tools"><input type="text" id="pickSearch" placeholder="Filter by name or company…"><select id="pickSector"><option value="">All sectors</option>${LG_ENUM.sector.map(s => `<option${s === sectorNow && !p.contactNos ? ' selected' : ''}>${s}</option>`).join('')}</select>
          <button type="button" class="lg-mini" id="pickAll">Select shown</button><button type="button" class="lg-mini" id="pickNone">Clear</button><span class="cnt" id="pickCount">0 selected</span></div>
        <div class="pick" id="pick"></div>
        <div class="dock-hint">At most ${k.maxBatch || 60} per batch. An Intro batch starts each contact's follow-up clock. A second intro does not restart it.</div></div>` +
      inp('date', 'Date', 'date', k.today) + inp('notes', 'Notes', 'text', '');
    const pick = document.getElementById('pick');
    const drawPick = () => {
      const q = document.getElementById('pickSearch').value.trim().toLowerCase(), s = document.getElementById('pickSector').value;
      const chosen = {}; pick.querySelectorAll('input:checked').forEach(i => { chosen[i.value] = 1; });
      Object.assign(chosen, pre); Object.keys(pre).forEach(x => delete pre[x]);
      const rows = lgData.contacts.filter(c => c.email && c.status !== 'Do Not Contact' && (!s || c.sector === s) && (!q || (c.name + ' ' + c.company + ' ' + c.plantSite).toLowerCase().includes(q)));
      pick.innerHTML = rows.length ? rows.map(c => `<label><input type="checkbox" value="${flowEsc(c.contactNo)}"${chosen[c.contactNo] ? ' checked' : ''}>${flowEsc(c.name)} · ${flowEsc(c.company)}${c.plantSite ? ' — ' + flowEsc(c.plantSite) : ''}<small>${c.introSent ? 'intro ' + flowEsc(c.introSent) : 'no intro yet'}</small></label>`).join('')
        : '<div class="lg-empty">No contacts with an email match this filter.</div>';
      Object.keys(chosen).filter(x => !rows.some(c => c.contactNo === x)).forEach(x => { pick.insertAdjacentHTML('afterbegin', `<label><input type="checkbox" value="${flowEsc(x)}" checked>${flowEsc((lgData.contacts.find(c => c.contactNo === x) || { name: x }).name)}<small>selected</small></label>`); });
      pick.querySelectorAll('input').forEach(i => i.addEventListener('change', countPick));
      countPick();
    };
    const countPick = () => { const n = pick.querySelectorAll('input:checked').length; const el = document.getElementById('pickCount'); el.textContent = n + ' selected'; el.classList.toggle('over', n > (k.maxBatch || 60)); };
    document.getElementById('pickSearch').addEventListener('input', drawPick);
    document.getElementById('pickSector').addEventListener('change', drawPick);
    document.getElementById('pickAll').addEventListener('click', () => { pick.querySelectorAll('input').forEach(i => { i.checked = true; }); countPick(); });
    document.getElementById('pickNone').addEventListener('click', () => { pick.querySelectorAll('input').forEach(i => { i.checked = false; }); countPick(); });
    drawPick();
  } else if (lgDockTab === 'linkedin') {
    hint.textContent = 'A connection request or a message, one per contact per act.';
    F.innerHTML = `<div class="full"><label>Contact *</label><select data-key="contactNo" required><option value="">— pick a contact —</option>${contactOptions(p.contactNo || '')}</select></div>` +
      sel('kind', 'Kind', LG_ENUM.linkedinKind, 'Connection request') + inp('date', 'Date', 'date', k.today);
  } else if (lgDockTab === 'supplier') {
    hint.textContent = 'A local supplier for local procurement. Qualified once vetted, Handed Off sends it to the Suppliers master.';
    F.innerHTML = inp('company', 'Company *', 'text', '', false, ' required') + inp('category', 'Category (fasteners, hydraulics, machining…)', 'text', '') +
      inp('location', 'Location', 'text', '') + sel('status', 'Status', LG_ENUM.supplierStatus, 'Researching') +
      inp('contact', 'Contact person', 'text', '') + inp('email', 'Email', 'text', '') + inp('mobile', 'Mobile', 'text', '') + inp('website', 'Website', 'text', '') +
      inp('notes', 'Notes', 'text', '', true);
  } else if (lgDockTab === 'plant') {
    hint.textContent = 'One site per row. A second site of the same company is a second account.';
    F.innerHTML = inp('company', 'Company *', 'text', '', false, ' required') + inp('plantSite', 'Plant / Site', 'text', '') +
      sel('sector', 'Sector *', LG_ENUM.sector, sectorNow || 'Cement') + sel('territory', 'Territory *', LG_ENUM.territory, 'Luzon') +
      inp('province', 'Province', 'text', '') + inp('equipment', 'Equipment / lines', 'text', '') + inp('source', 'Source (PhilGEPS, LinkedIn, Google…)', 'text', '') +
      `<div><label>&nbsp;</label><label class="chk"><input type="checkbox" data-key="philgeps"> PhilGEPS-registered</label></div>` + inp('notes', 'Notes', 'text', '', true);
  } else {
    hint.textContent = 'Two per plant: the maintenance head and MRO or purchasing.';
    F.innerHTML = `<div class="full"><label>Plant *</label><select data-key="plantNo" required><option value="">— pick a plant —</option>${plantOptions(p.plantNo || lgLastPlant)}</select></div>` +
      inp('name', 'Name *', 'text', '', false, ' required') + sel('role', 'Role', LG_ENUM.contactRole, 'Maintenance / O&M Head') +
      inp('email', 'Email', 'text', '') + sel('emailVerified', 'Email verified', LG_ENUM.emailVerified, 'Unverified') +
      inp('mobile', 'Mobile', 'text', '') + inp('linkedin', 'LinkedIn', 'text', '') +
      inp('nextCallDate', 'Next call scheduled for (optional)', 'date', '') + inp('notes', 'Notes', 'text', '', true);
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
  const err = (t) => { msg.className = 'flow-msg bad'; msg.style.display = 'block'; msg.textContent = t; };
  msg.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let res;
    if (lgDockTab === 'call') {
      if (!rec.contactNo) throw new Error('Pick the contact you called.');
      res = await postFlow('logSalesCall', { contactNo: rec.contactNo, kind: rec.kind, reached: rec.reached, outcome: rec.outcome, notes: rec.notes, date: rec.date });
    } else if (lgDockTab === 'batch') {
      const nos = Array.from(document.querySelectorAll('#pick input:checked')).map(i => i.value);
      if (!nos.length) throw new Error('Pick the contacts this batch went to.');
      res = await postFlow('saveLeadgenRecord', { entity: 'batches', clientRef: flowClientRef(),
        record: JSON.stringify({ kind: rec.kind, timeSlot: rec.timeSlot, sector: rec.sector, template: rec.template, notes: rec.notes, date: rec.date, contactNos: nos }) });
    } else if (lgDockTab === 'linkedin') {
      if (!rec.contactNo) throw new Error('Pick the contact.');
      res = await postFlow('saveLeadgenRecord', { entity: 'linkedin', clientRef: flowClientRef(), record: JSON.stringify(rec) });
    } else if (lgDockTab === 'supplier') {
      res = await postFlow('saveLeadgenRecord', { entity: 'suppliers', clientRef: flowClientRef(), record: JSON.stringify(rec) });
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
    return `<div class="mkt-tab${lgActiveTab === k ? ' active' : ''}" data-tab="${k}" role="tab" tabindex="0"><span class="ico">${LG_ICON[u.icon] || ''}</span>${u.label}<span class="cnt">${(lgData[k] || []).length}</span></div>`;
  }).join('');
  document.querySelectorAll('#tabs .mkt-tab').forEach(t => t.addEventListener('click', () => { lgActiveTab = t.getAttribute('data-tab'); render(); }));
}
function filterValues(key) {
  if (key === 'sector') return LG_ENUM.sector; if (key === 'territory') return LG_ENUM.territory;
  if (key === 'status') return { plants: LG_ENUM.plantStatus, contacts: LG_ENUM.contactStatus, leads: LG_ENUM.leadStatus, accred: LG_ENUM.accredStatus, suppliers: LG_ENUM.supplierStatus }[lgActiveTab];
  if (key === 'emailVerified') return LG_ENUM.emailVerified; return [];
}
function renderPanel(tab) {
  const u = LG_UI[tab], host = document.getElementById('panels');
  const rows = (lgData[tab] || []).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  host.innerHTML = `<div class="panel-toolbar">
      <h3>${flowEsc(u.title)}</h3>
      <input type="text" id="pSearch" placeholder="Search ${u.label.toLowerCase()}" aria-label="Search ${u.label.toLowerCase()}">
      ${(u.filters || []).map(f => `<select data-filter="${f}"><option value="">All ${({ emailVerified: 'verification', status: 'statuses', territory: 'territories', sector: 'sectors' })[f] || f}</option>${filterValues(f).map(v => `<option>${flowEsc(v)}</option>`).join('')}</select>`).join('')}
      <span class="spacer"></span>
      ${/* `primary` alongside btn-primary: the old director skin painted .btn-sm white AFTER .btn-primary indigo, so a
            small primary button is white-on-white unless it also carries the skin's own .btn-sm.primary class. */ ''}
      ${lgCanEdit && tab !== 'leads' ? `<button type="button" class="lg-btn primary" id="pAdd">Add ${u.label.replace(/s$/, '').toLowerCase()}</button>` : ''}
      ${lgCanEdit && tab === 'leads' ? `<button type="button" class="lg-btn primary" id="pAdd">Qualify a lead</button>` : ''}
    </div><div id="pBody" class="lg-scroll"></div>`;
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
  if (!filtered.length) {
    const empty = { plants: 'No target accounts yet. Add the first plant.', contacts: 'No contacts yet.', suppliers: 'No local suppliers researched yet.', leads: 'No qualified leads yet.', accred: 'No accreditation records yet.' };
    body.innerHTML = `<div class="lg-empty">${(q || Object.keys(fs).length) ? 'Nothing matches this search.' : (empty[tab] || 'Nothing here yet.')}</div>`; return;
  }
  if (u.cards) { renderLeadCards(filtered); return; }
  const th = u.cols.map(c => `<th>${c[1]}</th>`).join('');
  const trs = filtered.map(r => {
    const tds = u.cols.map(c => cell(r, c[0])).join('');
    const acts = lgCanEdit ? `<td class="lg-nowrap"><button type="button" class="mkt-act" data-edit="${r.rowIndex}">Edit</button> <button type="button" class="mkt-act" data-del="${r.rowIndex}">Remove</button></td>` : '<td></td>';
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
  if (/Date$|^introSent$|^submitted$|^approved$|^expiry$/.test(key)) return `<td class="lg-nowrap">${flowEsc(v || '—')}</td>`;
  return `<td>${flowEsc(v || '—')}</td>`;
}
function badge(s) {
  const k = String(s || '').toLowerCase();
  let cls = 'b-new';
  if (['active', 'approved', 'won', 'replied', 'pattern', 'switchboard', 'customer', 'presentation booked', 'quoted', 'qualified'].includes(k)) cls = 'b-good';
  else if (['pending', 'submitted', 'handed off', 'new', 'researching'].includes(k)) cls = 'b-info';
  else if (['cold', 'unverified', 'returned'].includes(k)) cls = 'b-warm';
  else if (['lost', 'expired', 'bounced', 'wrong person', 'do not contact', 'rejected'].includes(k)) cls = 'b-bad';
  return `<span class="mkt-badge ${cls}">${flowEsc(s || '—')}</span>`;
}
function renderLeadCards(rows) {
  const body = document.getElementById('pBody');
  const flag = (on, t) => `<span class="${on ? '' : 'no'}">${on ? '✓' : '✕'} ${t}</span>`;
  body.innerHTML = `<div class="lead-cards">${rows.map(l => `<div class="lead">
      <div class="lead-h"><h4>${flowEsc(l.company)}${l.plantSite ? ' — ' + flowEsc(l.plantSite) : ''}</h4>${badge(l.status)}</div>
      <div class="kv">${flowEsc(l.leadNo)} · ${flowEsc(l.territory)}, handed to <b>${flowEsc(l.handedTo || 'no rep set')}</b> on ${flowEsc(l.handedOffOn || '—')}${l.rehandedOn ? ', re-handed ' + flowEsc(l.rehandedOn) + ' (not counted)' : ''}</div>
      ${l.contactName ? `<div class="kv"><b>${flowEsc(l.contactName)}</b>${l.contactRole ? ' · ' + flowEsc(l.contactRole) : ''}${l.contactMobile ? ' · ' + flowEsc(l.contactMobile) : ''}${l.contactEmail ? ' · ' + flowEsc(l.contactEmail) : ''}</div>` : ''}
      <div class="q">${flag(l.rightPerson, 'right person')}${flag(l.ownMaintenance, 'own maintenance')}${flag(l.flangedOrHydraulic, 'flanged / hydraulic')}${flag(l.saidYes, 'said yes')}</div>
      ${l.pain ? `<div class="kv"><b>Pain:</b> ${flowEsc(l.pain)}</div>` : ''}
      ${l.whatTheySaid ? `<div class="kv"><b>They said:</b> ${flowEsc(l.whatTheySaid)}</div>` : ''}
      ${l.nextStep || l.nextStepDate ? `<div class="kv"><b>Next:</b> ${flowEsc(l.nextStep || '')}${l.nextStepDate ? ' · ' + flowEsc(l.nextStepDate) : ''}</div>` : ''}
      ${l.presentationDate ? `<div class="kv"><b>Presentation:</b> ${flowEsc(l.presentationDate)}${l.bookedOn ? ' (booked ' + flowEsc(l.bookedOn) + ')' : ''}${l.attendees ? ' · ' + flowEsc(l.attendees) : ''}</div>` : ''}
      ${l.status === 'Returned' ? `<div class="kv returned"><b>Returned ${flowEsc(l.returnedOn)}:</b> ${flowEsc(l.returnReason)}</div>` : ''}
      <div class="foot"><button type="button" class="lg-mini" data-pdf="${flowEsc(l.leadNo)}">Lead sheet (PDF)</button>${lgCanEdit ? `<button type="button" class="lg-mini" data-edit="${l.rowIndex}">Edit</button><button type="button" class="lg-mini" data-del="${l.rowIndex}">Remove</button>` : ''}</div>
    </div>`).join('')}</div>`;
  wireRowButtons('leads', body);
}

// ── edit modal ────────────────────────────────────────────────────────────────────────────────
function openRecModal(entity, rowIndex) {
  const u = LG_UI[entity];
  const rec = rowIndex ? (lgData[entity] || []).find(r => String(r.rowIndex) === String(rowIndex)) : null;
  const idKey = { plants: 'plantNo', contacts: 'contactNo', leads: 'leadNo', accred: 'accredNo', suppliers: 'supplierNo' }[entity];
  document.getElementById('recEntity').value = entity;
  document.getElementById('recRowIndex').value = rec ? rec.rowIndex : '';
  document.getElementById('recId').value = rec ? rec[idKey] : '';
  document.getElementById('recModalTitle').textContent = (rec ? 'Edit ' : (entity === 'leads' ? 'Qualify a ' : 'Add ')) + u.label.replace(/s$/, '');
  document.getElementById('recForm').innerHTML = u.fields.filter(f => rec || !(entity === 'leads' && (f[0] === 'status' || f[0] === 'handedTo'))).map(f => fieldHtml(f, rec)).join('') +
    (entity === 'leads' && !rec ? '<div class="full dock-hint">A lead is handed off only when all four conditions are ticked. The rep is chosen by territory, and a Prospect client is created if the company is new.</div>' : '');
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
  if (ri) { rec.rowIndex = ri; rec[{ plants: 'plantNo', contacts: 'contactNo', leads: 'leadNo', accred: 'accredNo', suppliers: 'supplierNo' }[entity]] = id; }
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
  const id = rec[{ plants: 'plantNo', contacts: 'contactNo', leads: 'leadNo', accred: 'accredNo', suppliers: 'supplierNo' }[entity]];
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
  const qmax = k.quotasMax || {};
  document.getElementById('setQuotas').innerHTML = LG_TILES.map(([key, label]) => `<div><label>${flowEsc(label)}</label>
      <div class="lg-range"><input type="number" min="0" data-quota="${key}" value="${k.quotas[key] || 0}" title="Minimum, met at this">
      <span class="lg-dash">–</span><input type="number" min="0" data-quota-max="${key}" value="${qmax[key] || k.quotas[key] || 0}" title="Stretch"></div></div>`).join('') +
    `<div class="full"><label>Per week</label></div>` +
    LG_WEEKLY.filter(([key]) => ['activeAccounts', 'leads', 'suppliersHandedOff'].includes(key)).map(([key, label]) => { const x = (k.week.weekly || {})[key] || {}; return `<div><label>${flowEsc(label)}</label>
      <div class="lg-range"><input type="number" min="0" data-week="${key}" value="${x.min || 0}"><span class="lg-dash">–</span><input type="number" min="0" data-week-max="${key}" value="${x.max || 0}"></div></div>`; }).join('');
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
  const QK = { attempts: 'lgQuotaAttempts', conversations: 'lgQuotaConversations', emails: 'lgQuotaEmails', linkedin: 'lgQuotaLinkedin', suppliers: 'lgQuotaSuppliers', accounts: 'lgQuotaAccounts', crm: 'lgQuotaCrm', eod: 'lgQuotaEod', scheduled: 'lgQuotaScheduled' };
  const WK = { activeAccounts: 'lgWeekActiveAccounts', leads: 'lgWeekLeads', suppliersHandedOff: 'lgWeekSuppliers' };
  document.querySelectorAll('#setQuotas [data-quota]').forEach(i => { patch[QK[i.getAttribute('data-quota')]] = Number(i.value) || 0; });
  document.querySelectorAll('#setQuotas [data-quota-max]').forEach(i => { patch[QK[i.getAttribute('data-quota-max')] + 'Max'] = Number(i.value) || 0; });
  document.querySelectorAll('#setQuotas [data-week]').forEach(i => { patch[WK[i.getAttribute('data-week')]] = Number(i.value) || 0; });
  document.querySelectorAll('#setQuotas [data-week-max]').forEach(i => { patch[WK[i.getAttribute('data-week-max')] + 'Max'] = Number(i.value) || 0; });
  patch.lgMaxBatch = Number(document.getElementById('setMaxBatch').value) || 60;
  patch.lgReplyRateAim = Number(document.getElementById('setReplyAim').value) || 0;
  patch.lgWorkingDays = Array.from(document.querySelectorAll('#setDays input:checked')).map(i => i.value).join(',');
  patch.lgHolidays = document.getElementById('setHolidays').value.split(',').map(s => s.trim()).filter(Boolean).join(',');
  patch.lgSectorCycle = document.getElementById('setCycle').value.split(',').map(s => s.trim()).filter(Boolean).join(',');
  patch.lgRepLuzon = document.getElementById('setRepLuzon').value;
  patch.lgRepVisMin = document.getElementById('setRepVisMin').value;
  const bad = patch.lgHolidays.split(',').filter(Boolean).find(d => !/^\d{4}-\d{2}-\d{2}$/.test(d));
  const msg = document.getElementById('setMsg');
  if (bad) { msg.className = 'flow-msg bad'; msg.style.display = 'block'; msg.textContent = '"' + bad + '" is not a yyyy-mm-dd date.'; return; }
  if (!patch.lgWorkingDays) { msg.className = 'flow-msg bad'; msg.style.display = 'block'; msg.textContent = 'Pick at least one working day.'; return; }
  const btn = document.getElementById('setSave'); btn.disabled = true;
  try {
    if (typeof flowSetViewerOnly === 'function') flowSetViewerOnly(false);      // the one write oversight may make
    const res = await postFlow('setFlowSettings', { settings: JSON.stringify(patch) });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    document.getElementById('setModal').classList.remove('open');
    flash('Quotas and working week saved.', true);
    await loadCounts();
  } catch (e) { msg.className = 'flow-msg bad'; msg.style.display = 'block'; msg.textContent = e.message; }
  finally { if (typeof flowSetViewerOnly === 'function') flowSetViewerOnly(lgOversight); btn.disabled = false; }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────
function formErr(m) { const el = document.getElementById('recFormMsg'); el.className = 'flow-msg bad'; el.style.display = 'block'; el.textContent = m; }
function flash(text, ok) { const m = document.getElementById('msg'); m.className = 'lg-toast ' + (ok ? 'ok' : 'bad'); m.style.display = 'block'; m.textContent = text; setTimeout(() => { m.style.display = 'none'; }, 3500); }
