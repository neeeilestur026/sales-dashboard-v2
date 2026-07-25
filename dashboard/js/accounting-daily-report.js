/* ═══════════════════════════════════════════════
   accounting-daily-report.js — auto-logged flow activity, rendered as a daily report
   ═══════════════════════════════════════════════ */

let drSession = null;
let drEntries = [];        // all activity entries for the selected date
let drEmailCount = 0;      // today's sent-email count (also feeds the daily-report submission)
const MODULE_ORDER = ['Quotation', 'Sales Order', 'Purchase Order', 'AP Aging', 'Receiving', 'Invoice', 'Inventory'];

function _esc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _money(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }
function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _modClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _time(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }

document.addEventListener('DOMContentLoaded', () => {
  drSession = requireAccounting();
  if (!drSession) return;
  renderNavbar('accounting-daily-report');

  const picker = document.getElementById('datePicker');
  picker.value = flowToday();
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('pdfBtn').addEventListener('click', _drDayPdf);
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);

  load();
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && _date() === flowToday()) refreshLive();
  }, 60000);
  window.addEventListener('pagehide', () => clearInterval(poll));
});

function _date() { return document.getElementById('datePicker').value; }
let drEmailMeta = null;
function _emailMetaHint() {
  const m = drEmailMeta;
  return (m && m.folder) ? ` <span style="color:var(--text-muted,#94a3b8);font-size:0.72rem;">· checked “${_esc(m.folder)}”, ${m.windowCount || 0} in window</span>` : '';
}

// Live refresh of read-only sections (activity + sent emails) — never touches the notes field.
async function refreshLive() {
  try {
    const res = await fetchFlow('getActivityLog', { date: _date(), user: drSession.name });
    drEntries = (res && res.data) || [];
    render();
  } catch (e) { /* keep previous */ }
  loadEmails();
}

async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Prepared by ${drSession.name} · Generated ${new Date().toLocaleString('en-US')}`;

  // Activity (flow backend) — scoped to THIS accounting user only (personal report).
  try {
    const res = await fetchFlow('getActivityLog', { date, user: drSession.name });
    drEntries = (res && res.data) || [];
  } catch (e) {
    drEntries = [];
    const tc = document.getElementById('taskCards');
    if (tc) tc.innerHTML = `<div class="dr-empty">${_esc(e.message)}</div>`;
  }
  render();
  loadEmails();
  loadNotes();
  if (typeof initReportWeek === 'function') initReportWeek({ user: drSession.name, date, mountId: 'weekSect', modules: ['Invoice', 'Receiving', 'Collection', 'Expense', 'Quotation'] });
  // Submission card — initialized from load() only (never the poller), so typing is never interrupted.
  if (typeof initReportSubmit === 'function') {
    const sum = (pred) => drEntries.filter(pred).reduce((s, e) => s + _num(e.amount), 0);
    initReportSubmit({
      user: drSession.name, role: 'accounting', date, mountId: 'submitSect', chipId: 'drSubmitChip',
      getSnapshot: () => ({
        entries: drEntries, calls: 0, emails: drEmailCount,
        notes: (document.getElementById('notesField') || {}).value || '',
        amount: sum(e => e.module === 'Invoice' && e.action === 'Issued'),
        metrics: {
          salesInvoiced: sum(e => e.module === 'Invoice' && e.action === 'Issued'),
          apPaid: sum(e => e.module === 'AP Aging'),
          received: sum(e => e.module === 'Receiving'),
        },
      }),
    });
  }
}

/** This accountant's day as a PDF. */
function _drDayPdf() {
  const date = _date();
  // Deduped: one row per record (matches the on-screen task cards).
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
    name: drSession.name, role: 'accounting', date, generatedAt: flowToday(),
    totals: {
      moves: tasks.length, calls: 0, emails: drEmailCount,
      docs: counts.docs, pdfs: counts.pdfs,
      amount: flowTaskAmount(tasks, 'Invoice'), amountLabel: 'Invoiced',
    },
    modules: order.filter(m => byMod[m]).map(m => ({ module: m, rows: byMod[m] })),
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
  // Collapse repeat touches of the same record into ONE task so counts are DISTINCT work.
  const tasks = (typeof flowRollupActivity === 'function') ? flowRollupActivity(drEntries) : drEntries;
  const counts = flowActivityCounts(tasks);

  // ── Summary tiles — distinct tasks; peso tiles sum distinct records (no double-count from repeat saves) ──
  document.getElementById('sumMovements').textContent = tasks.length;
  document.getElementById('sumDocs').textContent = counts.docs;
  document.getElementById('sumSales').textContent = _money(flowTaskAmount(tasks, 'Invoice'));
  document.getElementById('sumPaid').textContent = _money(flowTaskAmount(tasks, 'AP Aging'));
  document.getElementById('sumReceived').textContent = _money(flowTaskAmount(tasks, 'Receiving'));
  document.getElementById('sumPdfs').textContent = counts.pdfs;
  if (typeof reportSubmitRefreshSnapshot === 'function') reportSubmitRefreshSnapshot();

  // ── Today's Work — one card per record ──
  document.getElementById('tlCount').textContent = tasks.length;
  document.getElementById('taskCards').innerHTML = flowRenderTaskCards(tasks, { moduleOrder: MODULE_ORDER });
}

// ── Sent Emails (production backend, read-only) ──
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
  if (needsSetup) {
    body.innerHTML = `<tr><td colspan="4" class="dr-empty">Connect your GoDaddy mailbox to auto-pull your sent emails — <a href="email-setup.html" style="color:var(--accent,#0f766e);font-weight:600;">Connect email →</a></td></tr>`;
    return;
  }
  body.innerHTML = emails.length ? emails.map(r => {
    const t = r.sentAt || r.time || r.date || '';
    return `<tr><td>${_esc(t)}</td><td>${_esc(r.recipient || r.to || '')}</td><td>${_esc(r.subject || '')}</td><td>${_esc(r.category || '')}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="dr-empty">No emails sent on ${_esc(_date())}.${_emailMetaHint()}</td></tr>`;
}

// ── Per-day Notes (flow backend) — scoped to this user ──
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
