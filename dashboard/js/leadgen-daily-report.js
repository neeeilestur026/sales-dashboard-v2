/* leadgen-daily-report.js — A277 · the lead-gen user's auto daily report. Pattern B, like
   marketing-daily-report.js: the TIMELINE is the day's ActivityLog (modules Lead Gen and Call); the
   SUMMARY TILES are getLeadgenCounts({date}) — counted from the stamp columns on the rows, never off
   the timeline, so the number here is the number the dashboard showed and the director signs off.

   A277-2 — THE CHECKLIST VERIFIES ITSELF. There is nothing to tick. Each of the eight tasks is
   drawn from getLeadgenDay({date}) — the plants themselves, the contacts verified, every email
   batch with the contacts it went to, every call with who and what, the leads and the booked
   presentations — and reads as done only when the records are there. Emails go one step further:
   each contact on a batch is looked up in the GoDaddy Sent folder for that day, so "40 intro
   emails" is forty addresses the mailbox actually saw, or it says which it did not. */

let ldrSession = null, ldrEntries = [], ldrCounts = null, ldrDay = null, ldrEmails = [], ldrEmailMeta = null, ldrNeedsSetup = false;

/* A279 — the nine daily items of the job description, verified against the records. */
const DAILY_TASKS = [
  ['attempts', 'Make 40–50 outbound contact attempts', 'calls, emails and LinkedIn messages combined — every one listed'],
  ['conversations', 'Reach 5–10 actual decision-makers', 'calls that reached the decision-maker — not voicemails or gatekeepers'],
  ['emails', 'Send 25–30 personalised prospecting emails', 'checked against the Sent folder, address by address'],
  ['linkedin', 'Send 5–10 LinkedIn connection requests and messages', 'who, and which'],
  ['suppliers', 'Research 5–10 local suppliers', 'company, category, location, contact'],
  ['accounts', 'Research 10–15 new target accounts in detail', 'sector, province, territory, equipment, source'],
  ['crm', 'Update the CRM with all activity', 'every record touched today'],
  ['eod', 'Submit the end-of-day report to the Director', 'this page, submitted'],
  ['scheduled', 'Schedule and confirm 1–3 meetings or follow-up calls', 'calls booked for coming days, presentations booked'],
];
const WEEKLY_TASKS = [
  ['activeAccounts', 'Target accounts in active pursuit (20–30)'], ['leads', 'Qualified leads handed to Field Sales (10–20)'],
  ['suppliersHandedOff', 'Qualified local suppliers handed off (25–50)'], ['intelUpdates', 'Accounts updated with new intelligence'],
  ['meetings', 'Presentations booked'],
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
  document.getElementById('submitBtn').addEventListener('click', submitToDirector);
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
  await Promise.all([loadTimeline(), loadCounts(), loadDay(), loadEmails()]).catch(() => {});
  render();
  renderVerified();
}
async function loadDay() {
  const r = await fetchFlow('getLeadgenDay', { date: _date() }, { fresh: true });
  ldrDay = (r && r.success) ? r : null;
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
  try { await Promise.all([loadTimeline(), loadCounts(), loadDay(), loadEmails()]); }
  catch (e) { ldrEntries = []; document.getElementById('timelineBody').innerHTML = `<tr><td colspan="5" class="dr-empty">${_esc(e.message)}</td></tr>`; }
  render();
  renderVerified();
  loadNotes();
}

function render() {
  const d = (ldrCounts && ldrCounts.day) || {}, q = (ldrCounts && ldrCounts.quotas) || {};
  const set = (id, key) => { document.getElementById(id).textContent = (d[key] == null ? '—' : d[key]) + (q[key] ? ' / ' + q[key] : ''); };
  const setR = (id, key) => { const el = document.getElementById(id); if (!el) return; const qx = ((ldrCounts && ldrCounts.quotasMax) || {})[key] || q[key]; el.textContent = (d[key] == null ? '—' : d[key]) + (q[key] ? ' / ' + (qx > q[key] ? q[key] + '–' + qx : q[key]) : ''); };
  setR('sumAttempts', 'attempts'); setR('sumConversations', 'conversations'); setR('sumEmails', 'emails'); setR('sumLinkedin', 'linkedin');
  setR('sumSuppliers', 'suppliers'); setR('sumAccounts', 'accounts'); setR('sumScheduled', 'scheduled');
  const eodEl = document.getElementById('sumEod'); if (eodEl) eodEl.textContent = d.eod ? 'Submitted' : 'Not yet';
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

/* ── the verified checklist ────────────────────────────────────────────────────────────────── */
/* Was this address written to from the mailbox on this day? The Sent folder's recipient field is
   free text ("Name <addr>", several addresses) so it is a substring match on the lowercased email;
   the sent time and subject come back so the row can say WHICH email. */
function _sentTo(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return ldrEmails.find(m => String(m.recipient || m.to || '').toLowerCase().indexOf(e) !== -1) || null;
}
function _mailboxNote() {
  if (ldrNeedsSetup) return '<span class="ev-warn">mailbox not connected — emails cannot be verified</span>';
  if (!ldrEmails.length) return '<span class="ev-warn">the Sent folder shows nothing for this day</span>';
  return '';
}
function _batchRows(batches) {
  return batches.map(b => {
    const confirmed = b.contacts.filter(c => _sentTo(c.email)).length;
    const rows = b.contacts.map(c => {
      const m = _sentTo(c.email);
      const mark = ldrNeedsSetup ? '<span class="ev-mark ev-unk">?</span>' : m ? `<span class="ev-mark ev-ok" title="${_esc((m.sentAt || m.time || '') + ' ' + (m.subject || ''))}">✓ in Sent${m.sentAt || m.time ? ' ' + _esc(m.sentAt || m.time) : ''}</span>` : '<span class="ev-mark ev-no">not in Sent</span>';
      return `<li>${mark}<b>${_esc(c.name)}</b>${c.role ? ' · ' + _esc(c.role) : ''} · ${_esc(c.company)}${c.plantSite ? ' — ' + _esc(c.plantSite) : ''} · <span class="ev-dim">${_esc(c.email || 'no email')}</span></li>`;
    }).join('');
    const head = `${_esc(b.timeSlot || '')} ${_esc(b.kind)}${b.sector ? ' · ' + _esc(b.sector) : ''}${b.template ? ' · ' + _esc(b.template) : ''} · ${b.contacts.length} contact${b.contacts.length === 1 ? '' : 's'}` +
      (ldrNeedsSetup ? '' : ` · <b>${confirmed} of ${b.contacts.length} confirmed by the mailbox</b>`);
    return `<div class="ev-batch"><div class="ev-batch-h">${head}</div><ul class="ev-list">${rows}</ul></div>`;
  }).join('');
}
function _callLi(c) {
  return `<span class="ev-dim">${_esc(_time(c.createdAt))}</span> <b>${_esc(c.contact)}</b>${c.role ? ' · ' + _esc(c.role) : ''} · ${_esc(c.company)}${c.plantSite ? ' — ' + _esc(c.plantSite) : ''} · <span class="act-chip">${_esc(c.reached || '')}</span> <span class="act-chip">${_esc(c.outcome)}</span>${c.notes ? ' · ' + _esc(c.notes) : ''}`;
}
function _liLi(t) {
  return `<span class="act-chip">${_esc(t.kind)}</span> <b>${_esc(t.name)}</b>${t.role ? ' · ' + _esc(t.role) : ''} · ${_esc(t.company)}${t.plantSite ? ' — ' + _esc(t.plantSite) : ''}${t.linkedin ? ' · <span class="ev-dim">' + _esc(t.linkedin) + '</span>' : ''}`;
}
function _evidence(key, d) {
  const li = (s) => `<li>${s}</li>`;
  if (key === 'attempts') {
    return `<ul class="ev-list">${(d.calls || []).map(c => li('📞 ' + _callLi(c))).join('')}${(d.linkedin || []).map(t => li('💼 ' + _liLi(t))).join('')}</ul>` +
      _batchRows((d.introBatches || []).concat(d.followupBatches || []));
  }
  if (key === 'conversations') return `<ul class="ev-list">${(d.conversations || []).map(c => li(_callLi(c))).join('')}</ul>`;
  if (key === 'emails') return _batchRows((d.introBatches || []).concat(d.followupBatches || []));
  if (key === 'linkedin') return `<ul class="ev-list">${(d.linkedin || []).map(t => li(_liLi(t))).join('')}</ul>`;
  if (key === 'suppliers') return `<ul class="ev-list">${(d.suppliers || []).map(x => li(`<b>${_esc(x.company)}</b>${x.category ? ' · ' + _esc(x.category) : ''}${x.location ? ' · ' + _esc(x.location) : ''}${x.contact ? ' · ' + _esc(x.contact) : ''}${x.email || x.mobile ? ' · <span class="ev-dim">' + _esc([x.email, x.mobile].filter(Boolean).join(' · ')) + '</span>' : ''} · ${_esc(x.status)}`)).join('')}</ul>`;
  if (key === 'accounts') return `<ul class="ev-list">${(d.accounts || []).map(p => li(`<b>${_esc(p.company)}</b>${p.plantSite ? ' — ' + _esc(p.plantSite) : ''} · ${_esc(p.sector)} · ${_esc(p.province || '—')} · ${_esc(p.territory)}${p.source ? ' · <span class="ev-dim">source: ' + _esc(p.source) + '</span>' : ''}${p.equipment ? ' · <span class="ev-dim">' + _esc(p.equipment) + '</span>' : ''}`)).join('')}</ul>`;
  if (key === 'crm') return `<div class="ev-none" style="font-style:normal;">${d.crm || 0} record${d.crm === 1 ? '' : 's'} created, edited or logged today — see the timeline below.</div>`;
  if (key === 'eod') {
    const e = d.eod;
    return `<div class="ev-none" style="font-style:normal;">${e ? `Submitted ${_esc(String(e.submittedAt).slice(0, 16).replace('T', ' '))}${e.submitCount > 1 ? ' (updated ' + (e.submitCount - 1) + '×)' : ''} · ${_esc(e.status)}${e.reviewedBy ? ' by ' + _esc(e.reviewedBy) : ''}` : 'Not submitted yet — write your highlights below and press <b>Submit to Director</b>.'}</div>`;
  }
  if (key === 'scheduled') return `<ul class="ev-list">${(d.scheduledCalls || []).map(c => li(`📞 <b>${_esc(c.name)}</b> · ${_esc(c.company)}${c.plantSite ? ' — ' + _esc(c.plantSite) : ''} · call booked for <b>${_esc(c.nextCallDate)}</b>`)).join('')}${(d.meetings || []).map(l => li(`📅 <b>${_esc(l.company)}</b>${l.plantSite ? ' — ' + _esc(l.plantSite) : ''} · presentation <b>${_esc(l.presentationDate || 'date not set')}</b> · attendees: ${_esc(l.attendees || (l.contactName ? l.contactName + (l.handedTo ? ', ' + l.handedTo : '') : 'not recorded'))}`)).join('')}</ul>`;
  if (key === 'plants') return `<ul class="ev-list">${d.plants.map(p => li(`<b>${_esc(p.company)}</b>${p.plantSite ? ' — ' + _esc(p.plantSite) : ''} · ${_esc(p.sector)} · ${_esc(p.province || '—')} · ${_esc(p.territory)}${p.source ? ' · <span class="ev-dim">source: ' + _esc(p.source) + '</span>' : ''}${p.equipment ? ' · <span class="ev-dim">' + _esc(p.equipment) + '</span>' : ''}`)).join('')}</ul>`;
  if (key === 'contacts') return `<ul class="ev-list">${d.contacts.map(c => li(`<b>${_esc(c.name)}</b> · ${_esc(c.role)} · ${_esc(c.company)}${c.plantSite ? ' — ' + _esc(c.plantSite) : ''} · <span class="ev-dim">${_esc(c.email || 'no email')}${c.mobile ? ' · ' + _esc(c.mobile) : ''}</span> · verified by ${_esc(c.emailVerified)}`)).join('')}</ul>`;
  if (key === 'introEmails') return _batchRows(d.introBatches);
  if (key === 'followupEmails') return _batchRows(d.followupBatches);
  if (key === 'coldCalls' || key === 'followupCalls') {
    const calls = key === 'coldCalls' ? d.coldCalls : d.followupCalls;
    return `<ul class="ev-list">${calls.map(c => li(`<span class="ev-dim">${_esc(_time(c.createdAt))}</span> <b>${_esc(c.contact)}</b>${c.role ? ' · ' + _esc(c.role) : ''} · ${_esc(c.company)}${c.plantSite ? ' — ' + _esc(c.plantSite) : ''} · <span class="act-chip">${_esc(c.outcome)}</span>${c.notes ? ' · ' + _esc(c.notes) : ''}`)).join('')}</ul>`;
  }
  if (key === 'leads') return `<ul class="ev-list">${d.leads.map(l => li(`<b>${_esc(l.company)}</b>${l.plantSite ? ' — ' + _esc(l.plantSite) : ''} · ${_esc(l.contactName || 'no contact')}${l.contactRole ? ' (' + _esc(l.contactRole) + ')' : ''} · handed to <b>${_esc(l.handedTo || 'no rep set')}</b>${l.pain ? ' · pain: ' + _esc(l.pain) : ''}${l.rehandedOn ? ' · <span class="ev-dim">re-handed</span>' : ''}`)).join('')}</ul>`;
  if (key === 'meetings') return `<ul class="ev-list">${d.meetings.map(l => li(`<b>${_esc(l.company)}</b>${l.plantSite ? ' — ' + _esc(l.plantSite) : ''} · presentation <b>${_esc(l.presentationDate || 'date not set')}</b> · attendees: ${_esc(l.attendees || (l.contactName ? l.contactName + (l.handedTo ? ', ' + l.handedTo : '') : 'not recorded'))}`)).join('')}</ul>`;
  return '';
}
function renderVerified() {
  const el = document.getElementById('taskList');
  const d = ldrDay, k = ldrCounts;
  if (!d || !k) { el.innerHTML = '<div class="dr-empty">Could not load the day\'s records.</div>'; return; }
  const note = _mailboxNote();
  el.innerHTML = DAILY_TASKS.map(([key, title, sub]) => {
    const n = k.day[key] || 0, q = k.quotas[key] || 0, qx = (k.quotasMax || {})[key] || q;
    const tgt = key === 'eod' ? '' : (qx > q ? q + '–' + qx : String(q));
    let state, label;
    if (key === 'eod') { state = n ? 'done' : 'none'; label = n ? 'submitted' : 'not submitted'; }
    else if (key === 'crm') { state = n ? 'done' : 'none'; label = n ? n + ' record' + (n === 1 ? '' : 's') + ' logged' : 'nothing logged'; }
    else if (q > 0 && n >= q) { state = 'done'; label = `verified ${n} / ${tgt}`; }
    else if (n > 0) { state = 'part'; label = `${n} / ${tgt} — ${q - n} short`; }
    else { state = 'none'; label = `0 / ${tgt}`; }
    // a full email quota is only "verified" when the mailbox agrees
    if (key === 'emails' && state === 'done' && !ldrNeedsSetup) {
      const bs = (d.introBatches || []).concat(d.followupBatches || []);
      const seen = bs.reduce((s, b) => s + b.contacts.filter(c => _sentTo(c.email)).length, 0);
      if (seen < n) { state = 'part'; label = `${n} logged · mailbox confirms ${seen}`; }
    }
    const body = n ? _evidence(key, d) : '<div class="ev-none">nothing recorded</div>';
    const extra = (key === 'emails' && note) ? `<div class="ev-note">${note}</div>` : '';
    return `<details class="ev ev-${state}"${n ? ' open' : ''}>
      <summary><span class="ev-box">${state === 'done' ? '✓' : state === 'part' ? '◐' : ''}</span><span class="ev-title">${_esc(title)}<small>${_esc(sub)}</small></span><span class="ev-pill">${_esc(label)}</span></summary>
      ${extra}${body}</details>`;
  }).join('') +
  `<div class="dr-sect-title" style="margin-top:1rem;">This week</div>` +
  WEEKLY_TASKS.map(([key, title]) => {
    const x = ((k.week || {}).weekly || {})[key] || { value: 0, min: 0, max: 0 };
    const state = x.min > 0 ? (x.value >= x.min ? 'done' : (x.value > 0 ? 'part' : 'none')) : (x.value > 0 ? 'done' : 'none');
    const label = x.min > 0 ? `${x.value} / ${x.max > x.min ? x.min + '–' + x.max : x.min}` : String(x.value);
    return `<details class="ev ev-${state}"><summary><span class="ev-box">${state === 'done' ? '✓' : state === 'part' ? '◐' : ''}</span><span class="ev-title">${_esc(title)}<small>Monday to Friday of this week</small></span><span class="ev-pill">${_esc(label)}</span></summary></details>`;
  }).join('');
}

/* ── A279 · submit to the Director, through the flow the reps already use ──────────────────── */
async function submitToDirector() {
  const btn = document.getElementById('submitBtn'), msg = document.getElementById('notesMsg');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const day = (ldrCounts && ldrCounts.day) || {};
    const r = await postFlow('submitDailyReport', {
      user: ldrSession.name, role: 'leadgen', date: _date(), clientRef: flowClientRef(),
      movements: ldrEntries.length, calls: (day.attempts || 0), emails: (day.emails || 0),
      countsJson: JSON.stringify(day), highlights: document.getElementById('notesField').value,
      notes: document.getElementById('notesField').value
    });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not submit.');
    msg.textContent = r.message + ' ✓';
    await Promise.all([loadCounts(), loadDay()]);
    render(); renderVerified();
  } catch (e) { msg.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Submit to Director'; setTimeout(() => { msg.textContent = ''; }, 4000); }
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
  ldrEmails = emails; ldrNeedsSetup = needsSetup;
  document.getElementById('emailCount').textContent = emails.length;
  const mb = document.getElementById('sumEmailsMailbox'); if (mb) mb.textContent = emails.length;
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
