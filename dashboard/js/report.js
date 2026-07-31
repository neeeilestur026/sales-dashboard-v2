/* ═══════════════════════════════════════════════
   report.js — Sales Daily Report: auto-tracked flow activity for the
   logged-in sales rep (scoped to session.name) + sent emails + personal notes.
   Mirrors the accounting daily report but filtered to one user.
   ═══════════════════════════════════════════════ */

let drSession = null;
let drEntries = [];        // this rep's activity entries for the selected date
let drEmailCount = 0;
let drEmailMeta = null;    // {folder, windowCount, matched, date} diagnostic from the mail fetch
let drCalls = [];          // this rep's logged calls for the selected date
let drVisits = [];         // A189 — this rep's logged client visits for the selected date

// Muted diagnostic appended when a day shows zero sent emails (explains why: folder/window/matched).
function _emailMetaHint() {
  const m = drEmailMeta;
  if (!m || !m.folder) return '';
  return ` <span style="color:var(--text-muted,#94a3b8);font-size:0.72rem;">· checked “${_esc(m.folder)}”, ${m.windowCount || 0} in window</span>`;
}
const MODULE_ORDER = ['Pricing Request', 'Quotation', 'Inventory'];

function _esc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _money(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }
function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _modClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _time(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }

document.addEventListener('DOMContentLoaded', () => {
  drSession = requireSales();
  if (!drSession) return;
  renderNavbar('report');

  const picker = document.getElementById('datePicker');
  picker.value = flowToday();
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('pdfBtn').addEventListener('click', _drDayPdf);
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);
  document.getElementById('logCallBtn').addEventListener('click', logCall);
  document.getElementById('logVisitBtn').addEventListener('click', logVisit);   // A189

  load();
  // Auto-refresh the read-only parts (activity + sent emails + calls) every 60s while viewing TODAY
  // and the tab is visible — so sent emails keep updating during the day. Notes are never touched.
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && _date() === flowToday()) refreshLive();
  }, 60000);
  window.addEventListener('pagehide', () => clearInterval(poll));
});

function _date() { return document.getElementById('datePicker').value; }

// Live refresh of the read-only sections only (safe to run on a timer — leaves the notes field alone).
async function refreshLive() {
  const date = _date();
  try {
    const res = await fetchFlow('getActivityLog', { date, user: drSession.name });
    drEntries = ((res && res.data) || []).filter(e => e.module !== 'Call');
    render();
  } catch (e) { /* keep previous */ }
  loadEmails();
  if (typeof loadCalls === 'function') loadCalls();
  if (typeof loadVisits === 'function') loadVisits();   // A189
}

async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Prepared by ${drSession.name} · Generated ${new Date().toLocaleString('en-US')}`;

  // Activity (flow backend) — scoped to THIS rep so reps never see each other's movements.
  // A155: prime the request-number → client/supplier name map so legacy blank-ref
  // "Client saved" rows can be titled with the client they belong to (idempotent).
  if (typeof flowPrimeRefNames === 'function') await flowPrimeRefNames();
  // Calls are shown in their own section, so keep the 'Call' module out of the generic timeline.
  try {
    const res = await fetchFlow('getActivityLog', { date, user: drSession.name });
    drEntries = ((res && res.data) || []).filter(e => e.module !== 'Call');
  } catch (e) {
    drEntries = [];
    const tc = document.getElementById('taskCards');
    if (tc) tc.innerHTML = `<div class="dr-empty">${_esc(e.message)}</div>`;
  }
  render();
  loadEmails();
  loadNotes();
  loadCalls();
  loadVisits();   // A189
  if (typeof initReportWeek === 'function') initReportWeek({ user: drSession.name, date, mountId: 'weekSect', withCalls: true, modules: ['Quotation', 'Pricing Request', 'Inventory'] });
  // Submission card — initialized from load() only (never the poller), so typing is never interrupted.
  if (typeof initReportSubmit === 'function') {
    initReportSubmit({
      user: drSession.name, role: 'sales', date, mountId: 'submitSect', chipId: 'drSubmitChip',
      getSnapshot: () => ({
        entries: drEntries, calls: drCalls.length, emails: drEmailCount,
        visits: drVisits.length,   // A189
        notes: (document.getElementById('notesField') || {}).value || '',
      }),
    });
  }
}

/** This rep's day as a PDF — the same document management/HR see for them. */
function _drDayPdf() {
  const date = _date();
  // Deduped: one row per record (matches the on-screen task cards), not one per raw action.
  const tasks = flowRollupActivity(drEntries);
  const counts = flowActivityCounts(tasks);
  const byMod = {};
  tasks.forEach(t => {
    const m = t.module || 'Other';
    const verbs = t.verbs.join(' → ') + (t.touches > 1 ? ` (×${t.touches})` : '');
    (byMod[m] = byMod[m] || []).push({ time: (t.touches > 1 ? _time(t.firstTs) + '–' + _time(t.lastTs) : _time(t.lastTs)), action: verbs, refNo: t.refNo, summary: t.latestSummary, amount: t.amount });
  });
  const order = MODULE_ORDER.concat(Object.keys(byMod).filter(m => MODULE_ORDER.indexOf(m) < 0));
  const model = {
    name: drSession.name, role: 'sales', date, generatedAt: flowToday(),
    totals: {
      moves: tasks.length, calls: drCalls.length, emails: drEmailCount,
      visits: drVisits.length,   // A189
      docs: counts.docs, pdfs: counts.pdfs, amount: 0,
    },
    modules: order.filter(m => byMod[m]).map(m => ({ module: m, rows: byMod[m] })),
    calls: drCalls.map(c => ({ time: _time(c.createdAt), contact: c.contact, company: c.company, outcome: c.outcome, notes: c.notes })),
    // A189 — falls back to the logged-at time when the rep left the visit time blank.
    visits: drVisits.map(v => ({ time: v.time || _time(v.createdAt), personVisited: v.personVisited,
                                 company: v.company, cityAddress: v.cityAddress, topic: v.topic })),
    notes: (document.getElementById('notesField') || {}).value || '',
    submission: (typeof _rsRecord !== 'undefined') ? _rsRecord : null,
  };
  flowReportPdf({
    html: flowPersonDayHtml(model), scale: 3,
    filename: `Daily_Report_${String(drSession.name).replace(/[^A-Za-z0-9]+/g, '_')}_${date}.pdf`,
  }).catch(err => alert('PDF failed: ' + err.message));
}

function render() {
  if (typeof flowRenderInjectCss === 'function') flowRenderInjectCss();
  // Collapse repeat touches of the same record into ONE task (Pricing Request PR-1 sourced then priced
  // = one task, not four) so every count reflects DISTINCT work, not raw actions.
  const tasks = (typeof flowRollupActivity === 'function') ? flowRollupActivity(drEntries) : drEntries;

  // ── Summary tiles — distinct tasks ──
  document.getElementById('sumMovements').textContent = tasks.length;
  document.getElementById('sumPRs').textContent = flowTasksIn(tasks, 'Pricing Request', 'Created');
  document.getElementById('sumQuotes').textContent = flowTasksIn(tasks, 'Quotation', 'Created');
  document.getElementById('sumInv').textContent = flowTasksIn(tasks, 'Inventory', 'Added');
  document.getElementById('sumPdfs').textContent = tasks.filter(t => t.verbs && t.verbs.indexOf('PDF Saved') >= 0).length;
  document.getElementById('sumEmails').textContent = drEmailCount;
  if (typeof reportSubmitRefreshSnapshot === 'function') reportSubmitRefreshSnapshot();

  // ── Today's Work — one card per record (expandable touch history) ──
  document.getElementById('tlCount').textContent = tasks.length;
  document.getElementById('taskCards').innerHTML = flowRenderTaskCards(tasks, { moduleOrder: MODULE_ORDER });
}

// ── Sent Emails (production backend, read-only) — the rep's emails today ──
async function loadEmails() {
  const body = document.getElementById('emailBody');
  let emails = [], needsSetup = false;
  try {
    if (typeof apiFetchEmailLogToday === 'function') {
      const r = await apiFetchEmailLogToday(undefined, _date());
      needsSetup = !!(r && r.needsSetup);
      emails = (r && r.success && r.emails) || (r && r.data) || [];
      drEmailMeta = (r && r.meta) || null;
    }
  } catch (e) { emails = []; }
  emails = Array.isArray(emails) ? emails : [];
  drEmailCount = emails.length;
  document.getElementById('emailCount').textContent = emails.length;
  if (typeof reportSubmitRefreshSnapshot === 'function') reportSubmitRefreshSnapshot();
  document.getElementById('sumEmails').textContent = emails.length;
  if (needsSetup) {
    body.innerHTML = `<tr><td colspan="4" class="dr-empty">Connect your GoDaddy mailbox to auto-pull your sent emails — <a href="email-setup.html" style="color:var(--accent,#0f766e);font-weight:600;">Connect email →</a></td></tr>`;
    return;
  }
  body.innerHTML = emails.length ? emails.map(r => {
    const t = r.sentAt || r.time || r.date || '';
    return `<tr><td>${_esc(t)}</td><td>${_esc(r.recipient || r.to || '')}</td><td>${_esc(r.subject || '')}</td><td>${_esc(r.category || '')}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="dr-empty">No emails sent on ${_esc(_date())}.${_emailMetaHint()}</td></tr>`;
}

// ── Per-rep Notes (flow backend, scoped by user) ──
async function loadNotes() {
  try {
    const r = await fetchFlow('getDailyNote', { date: _date(), user: drSession.name });
    document.getElementById('notesField').value = (r && r.notes) || '';
  } catch (e) { /* leave as-is */ }
}

async function saveNotes() {
  const btn = document.getElementById('saveNotesBtn');
  const msg = document.getElementById('notesMsg');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const r = await postFlow('saveDailyNote', { date: _date(), user: drSession.name, notes: document.getElementById('notesField').value });
    msg.textContent = r && r.success ? 'Saved ✓' : (r.message || 'Failed');
  } catch (e) { msg.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Save Notes'; setTimeout(() => { msg.textContent = ''; }, 2500); }
}

// ── Call Log (flow backend, scoped by rep + date) ──
async function loadCalls() {
  try {
    const r = await fetchFlow('getSalesCalls', { date: _date(), user: drSession.name });
    drCalls = (r && r.data) || [];
  } catch (e) { drCalls = []; }
  document.getElementById('sumCalls').textContent = drCalls.length;
  document.getElementById('callCount').textContent = drCalls.length;
  if (typeof reportSubmitRefreshSnapshot === 'function') reportSubmitRefreshSnapshot();
  document.getElementById('callBody').innerHTML = drCalls.length ? drCalls.map(c => `
    <tr>
      <td>${_esc(_time(c.createdAt))}</td>
      <td>${_esc(c.contact || '—')}</td>
      <td>${_esc(c.company || '—')}</td>
      <td><span class="act-chip">${_esc(c.outcome || '')}</span></td>
      <td style="color:var(--text-secondary);">${_esc(c.notes || '')}</td>
      <td class="no-print"><button class="btn btn-xs" data-del="${c.rowIndex}" style="border:1px solid var(--border);border-radius:6px;padding:0.1rem 0.45rem;font-size:0.72rem;cursor:pointer;">✕</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="dr-empty">No calls logged for this day.</td></tr>';
  document.querySelectorAll('#callBody [data-del]').forEach(b => b.addEventListener('click', () => delCall(b.getAttribute('data-del'))));
}

async function logCall() {
  const contact = document.getElementById('callContact').value.trim();
  const company = document.getElementById('callCompany').value.trim();
  if (!contact && !company) { alert('Enter a contact or company.'); return; }
  const btn = document.getElementById('logCallBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const r = await postFlow('logSalesCall', {
      date: _date(), contact, company,
      outcome: document.getElementById('callOutcome').value,
      notes: document.getElementById('callNotes').value.trim(),
    });
    if (!r || !r.success) throw new Error((r && r.message) || 'Failed to log call.');
    document.getElementById('callContact').value = '';
    document.getElementById('callCompany').value = '';
    document.getElementById('callNotes').value = '';
    await loadCalls();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = '+ Log Call'; }
}

async function delCall(rowIndex) {
  if (!confirm('Remove this call?')) return;
  try {
    const r = await postFlow('deleteSalesCall', { rowIndex });
    if (!r || !r.success) throw new Error((r && r.message) || 'Failed.');
    await loadCalls();
  } catch (e) { alert(e.message); }
}

// ── A189: Client Visits (flow backend, scoped by rep + date) ──
async function loadVisits() {
  try {
    const r = await fetchFlow('getClientVisits', { date: _date(), user: drSession.name });
    drVisits = (r && r.data) || [];
  } catch (e) { drVisits = []; }
  document.getElementById('sumVisits').textContent = drVisits.length;
  document.getElementById('visitCount').textContent = drVisits.length;
  if (typeof reportSubmitRefreshSnapshot === 'function') reportSubmitRefreshSnapshot();
  document.getElementById('visitBody').innerHTML = drVisits.length ? drVisits.map(v => `
    <tr>
      <td>${_esc(v.time || _time(v.createdAt))}</td>
      <td>${_esc(v.personVisited || '—')}</td>
      <td>${_esc(v.company || '—')}</td>
      <td>${_esc(v.cityAddress || '—')}</td>
      <td style="color:var(--text-secondary);">${_esc(v.topic || '')}</td>
      <td class="no-print"><button class="btn btn-xs" data-del="${v.rowIndex}" data-no="${_esc(v.visitNo)}" style="border:1px solid var(--border);border-radius:6px;padding:0.1rem 0.45rem;font-size:0.72rem;cursor:pointer;">✕</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="dr-empty">No client visits logged for this day.</td></tr>';
  document.querySelectorAll('#visitBody [data-del]').forEach(b =>
    b.addEventListener('click', () => delVisit(b.getAttribute('data-del'), b.getAttribute('data-no'))));
}

async function logVisit() {
  const personVisited = document.getElementById('visitPerson').value.trim();
  const company = document.getElementById('visitCompany').value.trim();
  if (!personVisited && !company) { alert('Enter the person visited or the company.'); return; }
  const btn = document.getElementById('logVisitBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const r = await postFlow('logClientVisit', {
      date: _date(), personVisited, company,
      time: document.getElementById('visitTime').value,
      cityAddress: document.getElementById('visitCity').value.trim(),
      topic: document.getElementById('visitTopic').value.trim(),
    });
    if (!r || !r.success) throw new Error((r && r.message) || 'Failed to log visit.');
    ['visitTime', 'visitPerson', 'visitCompany', 'visitCity', 'visitTopic']
      .forEach(id => { document.getElementById(id).value = ''; });
    await loadVisits();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = '+ Log Visit'; }
}

async function delVisit(rowIndex, visitNo) {
  if (!confirm('Remove this client visit?')) return;
  try {
    // visitNo goes with the row index so the backend can refuse a stale-list delete rather than
    // removing whichever visit has since shifted into that position.
    const r = await postFlow('deleteClientVisit', { rowIndex, visitNo });
    if (!r || !r.success) throw new Error((r && r.message) || 'Failed.');
    await loadVisits();
  } catch (e) { alert(e.message); }
}
