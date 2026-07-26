/* ═══════════════════════════════════════════════
   admin-daily-report.js — Admin Daily Report: auto-tracked FLOW activity for the
   logged-in admin (scoped to session.name) + sent emails + weekly view + notes.
   Mirrors the sales report (report.js) with admin-relevant modules — the old
   version read the dead production getters, so PO/SO/shipment/payment/pricing
   movements never showed; they all live in the flow ActivityLog.
   ═══════════════════════════════════════════════ */

let drSession = null;
let drEntries = [];        // this admin's activity entries for the selected date
let drEmailCount = 0;
let drEmailMeta = null;    // {folder, windowCount, matched, date} diagnostic from the mail fetch

function _emailMetaHint() {
  const m = drEmailMeta;
  if (!m || !m.folder) return '';
  return ` <span style="color:var(--text-muted,#94a3b8);font-size:0.72rem;">· checked “${_esc(m.folder)}”, ${m.windowCount || 0} in window</span>`;
}
const MODULE_ORDER = ['Purchase Order', 'Sales Order', 'Shipment', 'Payment Request',
                      'Pricing Request', 'Quotation', 'Receiving', 'Invoice', 'Inventory', 'Document'];

function _esc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _money(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }
function _modClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _time(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }

document.addEventListener('DOMContentLoaded', () => {
  drSession = requireAdmin();
  if (!drSession) return;
  renderNavbar('admin-daily-report');

  const picker = document.getElementById('datePicker');
  picker.value = flowToday();
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('pdfBtn').addEventListener('click', _drDayPdf);
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);

  load();
  // Auto-refresh the read-only parts every 60s while viewing TODAY and the tab is visible.
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && _date() === flowToday()) refreshLive();
  }, 60000);
  window.addEventListener('pagehide', () => clearInterval(poll));
});

function _date() { return document.getElementById('datePicker').value; }

async function refreshLive() {
  const date = _date();
  try {
    const res = await fetchFlow('getActivityLog', { date, user: drSession.name });
    drEntries = ((res && res.data) || []).filter(e => e.module !== 'Call');
    render();
  } catch (e) { /* keep previous */ }
  loadEmails();
}

async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Prepared by ${drSession.name} · Generated ${new Date().toLocaleString('en-US')}`;

  // Every flow mutation (PO/SO create-update, shipment stage updates, payment requests,
  // PR sourcing/verify, quotations, receiving, invoices, docs…) is auto-logged with the
  // acting user — this report reads the admin's own movements.

  // A155: prime the request-number → client/supplier name map so legacy blank-ref
  // "Client saved" rows can be titled with the client they belong to (idempotent).
  if (typeof flowPrimeRefNames === 'function') await flowPrimeRefNames();
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
  if (typeof initReportWeek === 'function') initReportWeek({ user: drSession.name, date, mountId: 'weekSect', modules: ['Purchase Order', 'Sales Order', 'Shipment', 'Payment Request', 'Pricing Request'] });
  // Submission card — initialized from load() only (never the poller), so typing is never interrupted.
  if (typeof initReportSubmit === 'function') {
    initReportSubmit({
      user: drSession.name, role: 'admin', date, mountId: 'submitSect', chipId: 'drSubmitChip',
      getSnapshot: () => ({
        entries: drEntries, calls: 0, emails: drEmailCount,
        notes: (document.getElementById('notesField') || {}).value || '',
      }),
    });
  }
}

/** This admin's day as a PDF. */
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
    name: drSession.name, role: 'admin', date, generatedAt: flowToday(),
    totals: {
      moves: tasks.length, calls: 0, emails: drEmailCount,
      docs: counts.docs, pdfs: counts.pdfs, amount: 0,
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

  // ── Summary tiles — distinct tasks per module ──
  document.getElementById('sumMovements').textContent = tasks.length;
  document.getElementById('sumPOs').textContent = flowTasksIn(tasks, 'Purchase Order');
  document.getElementById('sumSOs').textContent = flowTasksIn(tasks, 'Sales Order');
  document.getElementById('sumShip').textContent = flowTasksIn(tasks, 'Shipment');
  document.getElementById('sumPay').textContent = flowTasksIn(tasks, 'Payment Request');
  document.getElementById('sumPricing').textContent = flowTasksIn(tasks, 'Pricing Request');
  document.getElementById('sumEmails').textContent = drEmailCount;
  if (typeof reportSubmitRefreshSnapshot === 'function') reportSubmitRefreshSnapshot();

  // ── Today's Work — one card per record ──
  document.getElementById('tlCount').textContent = tasks.length;
  document.getElementById('taskCards').innerHTML = flowRenderTaskCards(tasks, { moduleOrder: MODULE_ORDER });
}

// ── Sent Emails (the admin's own mailbox, date-aware) ──
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

// ── Per-user Notes ──
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
