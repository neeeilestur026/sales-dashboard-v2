/* ═══════════════════════════════════════════════
   hr-daily-report.js — Auto-feed HR-Marketing Daily Report
   ═══════════════════════════════════════════════ */

let session = null;
let alreadySubmitted = false;
let lastSnapshot = null;

document.addEventListener('DOMContentLoaded', async () => {
  session = requireHR();
  if (!session) return;
  renderNavbar('hr-daily-report');

  document.getElementById('reportDate').textContent =
    new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  document.getElementById('refreshBtn').addEventListener('click', loadFeed);
  document.getElementById('submitBtn').addEventListener('click', submitReport);

  await checkAlreadySubmitted();
  await loadFeed();
});

function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function checkAlreadySubmitted() {
  try {
    const result = await apiGetHRDailyReports({ hrName: session.name, date: _todayISO() });
    if (result.success && result.data && result.data.length > 0) {
      const mine = result.data.find(r => r.submitted);
      if (mine) {
        alreadySubmitted = true;
        document.getElementById('submittedBanner').style.display = 'block';
        document.getElementById('submitBtn').disabled = true;
        document.getElementById('submitBtn').textContent = 'Already Submitted';
        if (mine.notes) document.getElementById('notesField').value = mine.notes;
      }
    }
  } catch (err) { console.error('check submitted error:', err); }
}

async function loadFeed() {
  const date = _todayISO();
  const [autofillRes, emailRes] = await Promise.all([
    apiGetHrDailyAutofill(session.name, date).catch(() => ({ success: false })),
    apiFetchEmailLogToday().catch(() => ({ success: false }))
  ]);
  const data = (autofillRes && autofillRes.success && autofillRes.data) || {};
  const emails = (emailRes && emailRes.success && emailRes.emails) || (emailRes && emailRes.data) || [];

  lastSnapshot = {
    recruitment: data.recruitment || [],
    onboarding: data.onboarding || [],
    hrTasks: data.hrTasks || [],
    memos: data.memos || [],
    campaigns: data.campaigns || [],
    content: data.content || [],
    emails: Array.isArray(emails) ? emails : []
  };

  renderSummary(lastSnapshot);
  renderRec(lastSnapshot.recruitment);
  renderOnb(lastSnapshot.onboarding);
  renderTasks(lastSnapshot.hrTasks);
  renderMemos(lastSnapshot.memos);
  renderCamp(lastSnapshot.campaigns);
  renderContent(lastSnapshot.content);
  renderEmails(lastSnapshot.emails);
}

function _escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function _statusPill(status) {
  if (!status) return '<span class="status-pill">—</span>';
  const s = String(status).toLowerCase().replace(/\s+/g,'-');
  return `<span class="status-pill status-${_escape(s)}">${_escape(status)}</span>`;
}
function _setCount(id, n) { const el = document.getElementById(id); if (el) el.textContent = n; }
function _emptyRow(cols, msg) { return `<tr><td colspan="${cols}" class="empty-state">${msg}</td></tr>`; }

function renderSummary(snap) {
  const totals = [
    { label: 'Recruitment', value: snap.recruitment.length },
    { label: 'Onboarding', value: snap.onboarding.length },
    { label: 'HR Tasks', value: snap.hrTasks.length },
    { label: 'Memos', value: snap.memos.length },
    { label: 'Campaigns', value: snap.campaigns.length },
    { label: 'Content', value: snap.content.length },
    { label: 'Emails', value: snap.emails.length }
  ];
  document.getElementById('summaryRow').innerHTML = totals.map(t =>
    `<div class="summary-tile"><div class="label">${_escape(t.label)}</div><div class="value">${t.value}</div></div>`
  ).join('');
}

function renderRec(rows) {
  _setCount('recCount', rows.length);
  document.getElementById('recBody').innerHTML = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.name)}</td><td>${_escape(r.position)}</td><td>${_escape(r.stage)}</td><td>${_escape(r.notes)}</td></tr>`
  ).join('') : _emptyRow(4, 'No recruitment activity today.');
}
function renderOnb(rows) {
  _setCount('onbCount', rows.length);
  document.getElementById('onbBody').innerHTML = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.name)}</td><td>${_escape(r.position)}</td><td>${_statusPill(r.status)}</td><td>${_escape(r.notes)}</td></tr>`
  ).join('') : _emptyRow(4, 'No onboarding updates today.');
}
function renderTasks(rows) {
  _setCount('tasksCount', rows.length);
  document.getElementById('tasksBody').innerHTML = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.title)}</td><td>${_escape(r.type)}</td><td>${_statusPill(r.status)}</td><td>${_escape(r.notes)}</td></tr>`
  ).join('') : _emptyRow(4, 'No HR tasks today.');
}
function renderMemos(rows) {
  _setCount('memoCount', rows.length);
  document.getElementById('memoBody').innerHTML = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.title)}</td><td>${_escape(r.type)}</td><td>${_escape(r.target)}</td><td>${_escape(r.priority)}</td></tr>`
  ).join('') : _emptyRow(4, 'No memos created today.');
}
function renderCamp(rows) {
  _setCount('campCount', rows.length);
  document.getElementById('campBody').innerHTML = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.name)}</td><td>${_escape(r.channel)}</td><td>${_statusPill(r.status)}</td><td>${_escape(r.notes)}</td></tr>`
  ).join('') : _emptyRow(4, 'No campaign updates today.');
}
function renderContent(rows) {
  _setCount('contentCount', rows.length);
  document.getElementById('contentBody').innerHTML = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.title)}</td><td>${_escape(r.platform)}</td><td>${_statusPill(r.status)}</td><td>${_escape(r.notes)}</td></tr>`
  ).join('') : _emptyRow(4, 'No content scheduled or updated today.');
}
function renderEmails(rows) {
  _setCount('emailCount', rows.length);
  document.getElementById('emailBody').innerHTML = rows.length ? rows.map(r => {
    const t = r.sentAt ? new Date(r.sentAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';
    return `<tr><td>${_escape(t)}</td><td>${_escape(r.recipient || '')}</td><td>${_escape(r.subject || '')}</td></tr>`;
  }).join('') : _emptyRow(3, 'No emails sent from GoDaddy today.');
}

async function submitReport() {
  if (alreadySubmitted) return;
  const msgEl = document.getElementById('formMsg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  if (!lastSnapshot) {
    msgEl.textContent = 'No data loaded yet. Click Refresh first.';
    msgEl.className = 'form-msg error';
    return;
  }

  const notes = document.getElementById('notesField').value.trim();
  const snapshot = {
    version: 2,
    capturedAt: new Date().toISOString(),
    recruitment: lastSnapshot.recruitment,
    onboarding: lastSnapshot.onboarding,
    hrTasks: lastSnapshot.hrTasks,
    memos: lastSnapshot.memos,
    campaigns: lastSnapshot.campaigns,
    content: lastSnapshot.content,
    emails: lastSnapshot.emails,
    notes: notes
  };

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const result = await apiSubmitHRDailyReport({
      hrName: session.name,
      snapshotData: JSON.stringify(snapshot),
      notes: notes,
      recruitmentActivity: '[]',
      onboardingActivity: '[]',
      employeeAdmin: '[]',
      marketingActivity: '[]',
      otherTasks: '[]',
      otherTaskParagraph: ''
    });
    if (result.success) {
      alreadySubmitted = true;
      msgEl.textContent = 'Report submitted successfully!';
      msgEl.className = 'form-msg success';
      document.getElementById('submittedBanner').style.display = 'block';
      btn.textContent = 'Already Submitted';
    } else {
      msgEl.textContent = result.message || 'Failed to submit.';
      msgEl.className = 'form-msg error';
      btn.disabled = false;
      btn.textContent = 'Submit Daily Report';
    }
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    msgEl.className = 'form-msg error';
    btn.disabled = false;
    btn.textContent = 'Submit Daily Report';
  }
}
