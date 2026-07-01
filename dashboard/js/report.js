/* ═══════════════════════════════════════════════
   report.js — Sales Daily Report: auto-tracked flow activity for the
   logged-in sales rep (scoped to session.name) + sent emails + personal notes.
   Mirrors the accounting daily report but filtered to one user.
   ═══════════════════════════════════════════════ */

let drSession = null;
let drEntries = [];        // this rep's activity entries for the selected date
let drEmailCount = 0;
let drCalls = [];          // this rep's logged calls for the selected date
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
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);
  document.getElementById('logCallBtn').addEventListener('click', logCall);

  load();
});

function _date() { return document.getElementById('datePicker').value; }

async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Prepared by ${drSession.name} · Generated ${new Date().toLocaleString('en-US')}`;

  // Activity (flow backend) — scoped to THIS rep so reps never see each other's movements.
  // Calls are shown in their own section, so keep the 'Call' module out of the generic timeline.
  try {
    const res = await fetchFlow('getActivityLog', { date, user: drSession.name });
    drEntries = ((res && res.data) || []).filter(e => e.module !== 'Call');
  } catch (e) {
    drEntries = [];
    document.getElementById('timelineBody').innerHTML =
      `<tr><td colspan="6" class="dr-empty">${_esc(e.message)}</td></tr>`;
  }
  render();
  loadEmails();
  loadNotes();
  loadCalls();
}

function render() {
  const rows = drEntries;

  // ── Summary tiles ──
  document.getElementById('sumMovements').textContent = rows.length;
  document.getElementById('sumPRs').textContent = rows.filter(e => e.module === 'Pricing Request' && e.action === 'Created').length;
  document.getElementById('sumQuotes').textContent = rows.filter(e => e.module === 'Quotation' && e.action === 'Created').length;
  document.getElementById('sumInv').textContent = rows.filter(e => e.module === 'Inventory' && e.action === 'Added').length;
  document.getElementById('sumPdfs').textContent = rows.filter(e => e.action === 'PDF Saved').length;
  document.getElementById('sumEmails').textContent = drEmailCount;

  // ── Timeline (chronological, newest first as returned) ──
  document.getElementById('tlCount').textContent = rows.length;
  const tb = document.getElementById('timelineBody');
  tb.innerHTML = rows.length ? rows.map(e => `
    <tr>
      <td>${_esc(_time(e.timestamp))}</td>
      <td><span class="mod-badge ${_modClass(e.module)}">${_esc(e.module)}</span></td>
      <td><span class="act-chip">${_esc(e.action)}</span></td>
      <td>${_esc(e.refNo)}</td>
      <td style="color:var(--text-secondary);">${_esc(e.summary)}</td>
      <td class="num">${e.amount ? _money(e.amount) : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="dr-empty">No recorded activity for this day.</td></tr>';

  // ── Per-module sections ──
  const byMod = {};
  rows.forEach(e => { (byMod[e.module] = byMod[e.module] || []).push(e); });
  const mods = MODULE_ORDER.filter(m => byMod[m]).concat(Object.keys(byMod).filter(m => !MODULE_ORDER.includes(m)));
  document.getElementById('moduleSections').innerHTML = mods.map(m => {
    const list = byMod[m];
    return `<div class="dr-sect">
      <div class="dr-sect-title"><span class="mod-badge ${_modClass(m)}">${_esc(m)}</span> <span class="pill">${list.length}</span></div>
      <div style="overflow-x:auto;"><table class="flow-table">
        <thead><tr><th>Time</th><th>Action</th><th>Reference</th><th>Detail</th><th class="num">Amount</th></tr></thead>
        <tbody>${list.map(e => `<tr>
          <td>${_esc(_time(e.timestamp))}</td>
          <td><span class="act-chip">${_esc(e.action)}</span></td>
          <td>${_esc(e.refNo)}</td><td style="color:var(--text-secondary);">${_esc(e.summary)}</td>
          <td class="num">${e.amount ? _money(e.amount) : ''}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

// ── Sent Emails (production backend, read-only) — the rep's emails today ──
async function loadEmails() {
  const body = document.getElementById('emailBody');
  let emails = [], needsSetup = false;
  try {
    if (typeof apiFetchEmailLogToday === 'function') {
      const r = await apiFetchEmailLogToday();
      needsSetup = !!(r && r.needsSetup);
      emails = (r && r.success && r.emails) || (r && r.data) || [];
    }
  } catch (e) { emails = []; }
  emails = Array.isArray(emails) ? emails : [];
  drEmailCount = emails.length;
  document.getElementById('emailCount').textContent = emails.length;
  document.getElementById('sumEmails').textContent = emails.length;
  if (needsSetup) {
    body.innerHTML = `<tr><td colspan="4" class="dr-empty">Connect your GoDaddy mailbox to auto-pull your sent emails — <a href="email-setup.html" style="color:var(--accent,#0f766e);font-weight:600;">Connect email →</a></td></tr>`;
    return;
  }
  body.innerHTML = emails.length ? emails.map(r => {
    const t = r.sentAt || r.time || r.date || '';
    return `<tr><td>${_esc(t)}</td><td>${_esc(r.recipient || r.to || '')}</td><td>${_esc(r.subject || '')}</td><td>${_esc(r.category || '')}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="dr-empty">No emails sent today.</td></tr>';
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
