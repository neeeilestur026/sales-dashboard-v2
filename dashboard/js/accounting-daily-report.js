/* ═══════════════════════════════════════════════
   accounting-daily-report.js — auto-logged flow activity, rendered as a daily report
   ═══════════════════════════════════════════════ */

let drSession = null;
let drEntries = [];        // all activity entries for the selected date
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
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);

  load();
});

function _date() { return document.getElementById('datePicker').value; }

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
    document.getElementById('timelineBody').innerHTML =
      `<tr><td colspan="7" class="dr-empty">${_esc(e.message)}</td></tr>`;
  }
  render();
  loadEmails();
  loadNotes();
}

function _filtered() { return drEntries; }

function render() {
  const rows = _filtered();

  // ── Summary tiles ──
  const isDoc = a => ['Created', 'Issued', 'Received', 'Added', 'PDF Saved'].includes(a);
  const sum = (pred) => rows.filter(pred).reduce((s, e) => s + _num(e.amount), 0);
  document.getElementById('sumMovements').textContent = rows.length;
  document.getElementById('sumDocs').textContent = rows.filter(e => isDoc(e.action) && e.action !== 'PDF Saved').length;
  document.getElementById('sumSales').textContent = _money(sum(e => e.module === 'Invoice' && e.action === 'Issued'));
  document.getElementById('sumPaid').textContent = _money(sum(e => e.module === 'AP Aging'));
  document.getElementById('sumReceived').textContent = _money(sum(e => e.module === 'Receiving'));
  document.getElementById('sumPdfs').textContent = rows.filter(e => e.action === 'PDF Saved').length;

  // ── Timeline (chronological, newest first as returned) ──
  document.getElementById('tlCount').textContent = rows.length;
  const tb = document.getElementById('timelineBody');
  tb.innerHTML = rows.length ? rows.map(e => `
    <tr>
      <td>${_esc(_time(e.timestamp))}</td>
      <td>${_esc(e.user) || '<span style="color:var(--text-muted);">—</span>'}</td>
      <td><span class="mod-badge ${_modClass(e.module)}">${_esc(e.module)}</span></td>
      <td><span class="act-chip">${_esc(e.action)}</span></td>
      <td>${_esc(e.refNo)}</td>
      <td style="color:var(--text-secondary);">${_esc(e.summary)}</td>
      <td class="num">${e.amount ? _money(e.amount) : ''}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="dr-empty">No recorded activity for this day.</td></tr>';

  // ── Per-module sections ──
  const byMod = {};
  rows.forEach(e => { (byMod[e.module] = byMod[e.module] || []).push(e); });
  const mods = MODULE_ORDER.filter(m => byMod[m]).concat(Object.keys(byMod).filter(m => !MODULE_ORDER.includes(m)));
  document.getElementById('moduleSections').innerHTML = mods.map(m => {
    const list = byMod[m];
    return `<div class="dr-sect">
      <div class="dr-sect-title"><span class="mod-badge ${_modClass(m)}">${_esc(m)}</span> <span class="pill">${list.length}</span></div>
      <div style="overflow-x:auto;"><table class="flow-table">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Reference</th><th>Detail</th><th class="num">Amount</th></tr></thead>
        <tbody>${list.map(e => `<tr>
          <td>${_esc(_time(e.timestamp))}</td><td>${_esc(e.user)}</td>
          <td><span class="act-chip">${_esc(e.action)}</span></td>
          <td>${_esc(e.refNo)}</td><td style="color:var(--text-secondary);">${_esc(e.summary)}</td>
          <td class="num">${e.amount ? _money(e.amount) : ''}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
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
    }
  } catch (e) { emails = []; }
  emails = Array.isArray(emails) ? emails : [];
  document.getElementById('emailCount').textContent = emails.length;
  if (needsSetup) {
    body.innerHTML = `<tr><td colspan="4" class="dr-empty">Connect your GoDaddy mailbox to auto-pull your sent emails — <a href="email-setup.html" style="color:var(--accent,#0f766e);font-weight:600;">Connect email →</a></td></tr>`;
    return;
  }
  body.innerHTML = emails.length ? emails.map(r => {
    const t = r.sentAt || r.time || r.date || '';
    return `<tr><td>${_esc(t)}</td><td>${_esc(r.recipient || r.to || '')}</td><td>${_esc(r.subject || '')}</td><td>${_esc(r.category || '')}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="dr-empty">No emails sent on ${_esc(_date())}.</td></tr>`;
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
