/* leadgen-daily-report.js — A277 · the lead-gen user's auto daily report. Pattern B, like
   marketing-daily-report.js: the TIMELINE is the day's ActivityLog (modules Lead Gen and Call); the
   SUMMARY TILES are getLeadgenCounts({date}) — counted from the stamp columns on the rows, never off
   the timeline, so the number here is the number the dashboard showed and the director signs off. */

let ldrSession = null, ldrEntries = [], ldrCounts = null, ldrEmailMeta = null;

const DAILY_TASKS = [
  'Research 15 plants — one sector this week, every site listed separately with province and territory',
  'Find & verify 20 contacts — the maintenance head and MRO / purchasing at each plant',
  'Send 40 intro emails in batches — 8:30 and 10:30, one sector per batch',
  'Send 30 follow-up emails — day 3, day 7, day 14 after each intro',
  'Make 20 cold calls — outcome logged one by one',
  'Make 10 follow-up calls — to everyone who replied or was referred',
  'Hand 3–5 qualified leads to the rep — all four conditions ticked',
  'Book 1 presentation or site visit',
];

function _esc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _time(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function _modClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }

document.addEventListener('DOMContentLoaded', () => {
  ldrSession = requireLeadgen();
  if (!ldrSession) return;
  renderNavbar('leadgen-daily-report');
  const picker = document.getElementById('datePicker');
  picker.value = flowToday();
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);
  renderTasks();
  load();
  const poll = setInterval(() => { if (document.visibilityState === 'visible' && _date() === flowToday()) refreshLive(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(poll));
});

function _date() { return document.getElementById('datePicker').value; }
function _emailMetaHint() {
  const m = ldrEmailMeta;
  return (m && m.folder) ? ` <span style="color:var(--text-muted,#94a3b8);font-size:0.72rem;">· checked “${_esc(m.folder)}”, ${m.windowCount || 0} in window</span>` : '';
}

async function refreshLive() {
  await Promise.all([loadTimeline(), loadCounts()]).catch(() => {});
  render();
  loadEmails();
}
async function loadTimeline() {
  const res = await fetchFlow('getActivityLog', { date: _date(), user: ldrSession.name }, { fresh: true });
  ldrEntries = ((res && res.data) || []).filter(e => e.module === 'Lead Gen' || e.module === 'Call');
}
async function loadCounts() {
  const r = await fetchFlow('getLeadgenCounts', { date: _date() }, { fresh: true });
  ldrCounts = (r && r.success) ? r : null;
}
async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent = `For ${date} · Prepared by ${ldrSession.name} · Generated ${new Date().toLocaleString('en-US')}`;
  try { await Promise.all([loadTimeline(), loadCounts()]); }
  catch (e) { ldrEntries = []; document.getElementById('timelineBody').innerHTML = `<tr><td colspan="5" class="dr-empty">${_esc(e.message)}</td></tr>`; }
  render();
  loadEmails();
  loadNotes();
  renderTasks();
}

function render() {
  const d = (ldrCounts && ldrCounts.day) || {}, q = (ldrCounts && ldrCounts.quotas) || {};
  const set = (id, key) => { document.getElementById(id).textContent = (d[key] == null ? '—' : d[key]) + (q[key] ? ' / ' + q[key] : ''); };
  set('sumPlants', 'plants'); set('sumContacts', 'contacts'); set('sumIntro', 'introEmails'); set('sumFollowupEmails', 'followupEmails');
  set('sumCold', 'coldCalls'); set('sumFollowupCalls', 'followupCalls'); set('sumLeads', 'leads'); set('sumMeetings', 'meetings');
  const rows = ldrEntries;
  document.getElementById('sumMovements').textContent = rows.length;
  document.getElementById('tlCount').textContent = rows.length;
  document.getElementById('timelineBody').innerHTML = rows.length ? rows.map(e => `
    <tr>
      <td>${_esc(_time(e.timestamp))}</td>
      <td><span class="mod-badge ${_modClass(e.module)}">${_esc(e.module)}</span></td>
      <td><span class="act-chip">${_esc(e.action)}</span></td>
      <td>${_esc(e.refNo)}</td>
      <td style="color:var(--text-secondary);">${_esc(e.summary)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="dr-empty">No recorded activity for this day.</td></tr>';
}

function _taskState() { try { return JSON.parse(localStorage.getItem('leadgenDailyTasks') || '{}'); } catch (e) { return {}; } }
function renderTasks() {
  const day = _date(), state = _taskState(), el = document.getElementById('taskList');
  el.innerHTML = DAILY_TASKS.map((t, i) => {
    const id = day + '|' + i, done = !!state[id];
    return `<label class="${done ? 'done' : ''}"><input type="checkbox" data-tid="${id}"${done ? ' checked' : ''}>${_esc(t)}</label>`;
  }).join('');
  el.querySelectorAll('input[data-tid]').forEach(cb => cb.addEventListener('change', () => {
    const s = _taskState(); s[cb.getAttribute('data-tid')] = cb.checked;
    localStorage.setItem('leadgenDailyTasks', JSON.stringify(s));
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
      ldrEmailMeta = (r && r.meta) || null;
    }
  } catch (e) { emails = []; }
  emails = Array.isArray(emails) ? emails : [];
  document.getElementById('emailCount').textContent = emails.length;
  document.getElementById('sumEmails').textContent = emails.length;
  if (needsSetup) {
    body.innerHTML = `<tr><td colspan="4" class="dr-empty">Connect your GoDaddy mailbox to auto-pull your sent emails — <a href="email-setup.html" style="color:var(--accent,#4f46e5);font-weight:600;">Email Setup</a>.</td></tr>`;
    return;
  }
  body.innerHTML = emails.length ? emails.map(r => {
    const t = r.sentAt || r.time || r.date || '';
    return `<tr><td>${_esc(t)}</td><td>${_esc(r.recipient || r.to || '')}</td><td>${_esc(r.subject || '')}</td><td>${_esc(r.category || '')}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="dr-empty">No emails sent on ${_esc(_date())}.${_emailMetaHint()}</td></tr>`;
}

async function loadNotes() {
  try { const r = await fetchFlow('getDailyNote', { date: _date(), user: ldrSession.name }); document.getElementById('notesField').value = (r && r.notes) || ''; }
  catch (e) { /* leave as-is */ }
}
async function saveNotes() {
  const btn = document.getElementById('saveNotesBtn'), msg = document.getElementById('notesMsg');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const r = await postFlow('saveDailyNote', { date: _date(), user: ldrSession.name, notes: document.getElementById('notesField').value });
    msg.textContent = r && r.success ? 'Saved ✓' : (r.message || 'Failed');
  } catch (e) { msg.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Save Notes'; setTimeout(() => { msg.textContent = ''; }, 2500); }
}
