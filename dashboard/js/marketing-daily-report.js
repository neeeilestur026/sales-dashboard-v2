/* marketing-daily-report.js — per-marketing-user auto daily report: marketing movements
   (from the activity log), a daily-task checklist, sent emails, and notes. Mirrors report.js.
   Management views marketing activity via all-daily-reports (all-users aggregation). */

let mdrSession = null;
let mdrEntries = [];
let mdrEmailCount = 0;

const DAILY_TASKS = [
  'Monitor & respond to digital inquiries (website, LinkedIn, Facebook, email)',
  'Manage social posting schedule & engagement',
  'Work on active content projects (brochures, campaigns, presentations)',
  'Coordinate with the sales team on immediate material needs',
];

function _esc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _time(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function _modClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
// Marketing activity refNo carries the record id prefix → entity bucket.
function _bucket(refNo) {
  const p = String(refNo || '').split('-')[0];
  return ({ LEAD: 'leads', CNT: 'content', CMP: 'campaigns', AST: 'enablement', EVT: 'events', PRN: 'principal' })[p] || '';
}

document.addEventListener('DOMContentLoaded', () => {
  mdrSession = requireMarketing();
  if (!mdrSession) return;
  renderNavbar('marketing-daily-report');
  const picker = document.getElementById('datePicker');
  picker.value = flowToday();
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);
  renderTasks();
  load();
});

function _date() { return document.getElementById('datePicker').value; }

async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Prepared by ${mdrSession.name} · Generated ${new Date().toLocaleString('en-US')}`;
  try {
    const res = await fetchFlow('getActivityLog', { date, user: mdrSession.name });
    mdrEntries = ((res && res.data) || []).filter(e => e.module === 'Marketing' || e.module === 'Call');
  } catch (e) {
    mdrEntries = [];
    document.getElementById('timelineBody').innerHTML = `<tr><td colspan="5" class="dr-empty">${_esc(e.message)}</td></tr>`;
  }
  render();
  loadEmails();
  loadNotes();
  renderTasks();
}

function render() {
  const rows = mdrEntries;
  const mk = rows.filter(e => e.module === 'Marketing');
  const cnt = (b) => mk.filter(e => _bucket(e.refNo) === b).length;
  document.getElementById('sumMovements').textContent = rows.length;
  document.getElementById('sumLeads').textContent = cnt('leads');
  document.getElementById('sumContent').textContent = cnt('content');
  document.getElementById('sumCampaigns').textContent = cnt('campaigns');
  document.getElementById('sumEvents').textContent = cnt('events') + cnt('principal');

  document.getElementById('tlCount').textContent = rows.length;
  const tb = document.getElementById('timelineBody');
  tb.innerHTML = rows.length ? rows.map(e => `
    <tr>
      <td>${_esc(_time(e.timestamp))}</td>
      <td><span class="mod-badge ${_modClass(e.module)}">${_esc(e.module)}</span></td>
      <td><span class="act-chip">${_esc(e.action)}</span></td>
      <td>${_esc(e.refNo)}</td>
      <td style="color:var(--text-secondary);">${_esc(e.summary)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="dr-empty">No recorded activity for this day.</td></tr>';
}

// ── Daily task checklist (personal, localStorage per day) ──
function _taskState() { try { return JSON.parse(localStorage.getItem('mktgDailyTasks') || '{}'); } catch (e) { return {}; } }
function renderTasks() {
  const day = _date();
  const state = _taskState();
  const el = document.getElementById('taskList');
  el.innerHTML = DAILY_TASKS.map((t, i) => {
    const id = day + '|' + i;
    const done = !!state[id];
    return `<label class="${done ? 'done' : ''}"><input type="checkbox" data-tid="${id}"${done ? ' checked' : ''}>${_esc(t)}</label>`;
  }).join('');
  el.querySelectorAll('input[data-tid]').forEach(cb => cb.addEventListener('change', () => {
    const s = _taskState();
    s[cb.getAttribute('data-tid')] = cb.checked;
    localStorage.setItem('mktgDailyTasks', JSON.stringify(s));
    cb.closest('label').classList.toggle('done', cb.checked);
  }));
}

async function loadEmails() {
  const body = document.getElementById('emailBody');
  let emails = [], needsSetup = false;
  try {
    if (typeof apiFetchEmailLogToday === 'function') {
      const r = await apiFetchEmailLogToday(undefined, _date());
      needsSetup = !!(r && r.needsSetup);
      emails = (r && r.success && r.emails) || (r && r.data) || [];
    }
  } catch (e) { emails = []; }
  emails = Array.isArray(emails) ? emails : [];
  mdrEmailCount = emails.length;
  document.getElementById('emailCount').textContent = emails.length;
  document.getElementById('sumEmails').textContent = emails.length;
  if (needsSetup) {
    body.innerHTML = `<tr><td colspan="4" class="dr-empty">Connect your GoDaddy mailbox to auto-pull your sent emails — <a href="email-setup.html" style="color:var(--accent,#0f766e);font-weight:600;">Connect email →</a></td></tr>`;
    return;
  }
  body.innerHTML = emails.length ? emails.map(r => {
    const t = r.sentAt || r.time || r.date || '';
    return `<tr><td>${_esc(t)}</td><td>${_esc(r.recipient || r.to || '')}</td><td>${_esc(r.subject || '')}</td><td>${_esc(r.category || '')}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="dr-empty">No emails sent on ${_esc(_date())}.</td></tr>`;
}

async function loadNotes() {
  try {
    const r = await fetchFlow('getDailyNote', { date: _date(), user: mdrSession.name });
    document.getElementById('notesField').value = (r && r.notes) || '';
  } catch (e) { /* leave as-is */ }
}

async function saveNotes() {
  const btn = document.getElementById('saveNotesBtn');
  const msg = document.getElementById('notesMsg');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const r = await postFlow('saveDailyNote', { date: _date(), user: mdrSession.name, notes: document.getElementById('notesField').value });
    msg.textContent = r && r.success ? 'Saved ✓' : (r.message || 'Failed');
  } catch (e) { msg.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Save Notes'; setTimeout(() => { msg.textContent = ''; }, 2500); }
}
