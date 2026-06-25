/* ═══════════════════════════════════════════════
   all-daily-reports.js — oversight view of EVERY user's daily report for a date.
   Groups the flow ActivityLog by user; each user is a collapsible card with their
   summary tiles, activity timeline, per-module breakdown, and personal note.
   Accessible to admin / accounting / management / director.
   ═══════════════════════════════════════════════ */

let adrSession = null;
let adrEntries = [];        // all users' activity for the selected date
let adrNotes = {};          // user -> note text
const MODULE_ORDER = ['Pricing Request', 'Quotation', 'Sales Order', 'Purchase Order', 'AP Aging', 'Receiving', 'Invoice', 'Inventory', 'Marketing', 'Call', 'Document'];

function _e(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _m(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }
function _n(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _modClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _time(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }

document.addEventListener('DOMContentLoaded', () => {
  adrSession = requireOversight();
  if (!adrSession) return;
  renderNavbar('all-daily-reports');
  const picker = document.getElementById('datePicker');
  picker.value = new Date().toISOString().slice(0, 10);
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('userSearch').addEventListener('input', render);
  load();
});

function _date() { return document.getElementById('datePicker').value; }

async function load() {
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Oversight by ${adrSession.name} · Generated ${new Date().toLocaleString('en-US')}`;
  try {
    const res = await fetchFlow('getActivityLog', { date });   // ALL users
    adrEntries = (res && res.data) || [];
  } catch (e) {
    adrEntries = [];
    document.getElementById('userReports').innerHTML = `<div class="dr-empty">${_e(e.message)}</div>`;
  }
  // Fetch each active user's personal note for the day (best-effort, parallel).
  adrNotes = {};
  const users = Array.from(new Set(adrEntries.map(e => e.user).filter(Boolean)));
  await Promise.all(users.map(u =>
    fetchFlow('getDailyNote', { date, user: u }).then(r => { if (r && r.notes) adrNotes[u] = r.notes; }).catch(() => {})
  ));
  render();
}

function _isDoc(a) { return ['Created', 'Issued', 'Received', 'Added'].includes(a); }

function render() {
  const q = (document.getElementById('userSearch').value || '').trim().toLowerCase();

  // ── Org summary ──
  const allUsers = Array.from(new Set(adrEntries.map(e => e.user).filter(Boolean)));
  const sumAmt = pred => adrEntries.filter(pred).reduce((s, e) => s + _n(e.amount), 0);
  document.getElementById('sumUsers').textContent = allUsers.length;
  document.getElementById('sumMovements').textContent = adrEntries.length;
  document.getElementById('sumDocs').textContent = adrEntries.filter(e => _isDoc(e.action)).length;
  document.getElementById('sumSales').textContent = _m(sumAmt(e => e.module === 'Invoice' && e.action === 'Issued'));
  document.getElementById('sumPaid').textContent = _m(sumAmt(e => e.module === 'AP Aging'));
  document.getElementById('sumPdfs').textContent = adrEntries.filter(e => e.action === 'PDF Saved').length;

  // ── Group by user ──
  const byUser = {};
  adrEntries.forEach(e => { const u = e.user || 'Unknown'; (byUser[u] = byUser[u] || []).push(e); });
  let names = Object.keys(byUser).sort((a, b) => a.localeCompare(b));
  // include users with only a note (no activity)
  Object.keys(adrNotes).forEach(u => { if (!byUser[u]) { byUser[u] = []; names.push(u); } });
  if (q) names = names.filter(n => n.toLowerCase().includes(q));
  document.getElementById('userCount').textContent = names.length;

  const cont = document.getElementById('userReports');
  if (!names.length) { cont.innerHTML = '<div class="dr-empty">No activity recorded for this day.</div>'; return; }

  cont.innerHTML = names.map((name, i) => {
    const rows = byUser[name] || [];
    const docs = rows.filter(e => _isDoc(e.action)).length;
    const note = adrNotes[name];
    // module breakdown chips
    const byMod = {};
    rows.forEach(e => { byMod[e.module] = (byMod[e.module] || 0) + 1; });
    const modChips = MODULE_ORDER.filter(m => byMod[m]).concat(Object.keys(byMod).filter(m => !MODULE_ORDER.includes(m)))
      .map(m => `<span class="mod-badge ${_modClass(m)}">${_e(m)} ${byMod[m]}</span>`).join('');
    // timeline rows
    const tl = rows.length ? rows.map(e => `<tr>
        <td>${_e(_time(e.timestamp))}</td>
        <td><span class="mod-badge ${_modClass(e.module)}">${_e(e.module)}</span></td>
        <td><span class="act-chip">${_e(e.action)}</span></td>
        <td>${_e(e.refNo)}</td>
        <td style="color:var(--text-secondary);">${_e(e.summary)}</td>
        <td class="num">${e.amount ? _m(e.amount) : ''}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="dr-empty">No movements (note only).</td></tr>';
    return `<details class="urep"${i === 0 ? ' open' : ''}>
      <summary><span class="uname">${_e(name)}</span>
        <span class="ustat">${rows.length} movement(s) · ${docs} doc(s)${note ? ' · 📝 note' : ''}</span></summary>
      <div class="urep-body">
        ${modChips ? `<div class="umods">${modChips}</div>` : ''}
        <div style="overflow-x:auto;"><table class="flow-table">
          <thead><tr><th>Time</th><th>Module</th><th>Action</th><th>Reference</th><th>Detail</th><th class="num">Amount</th></tr></thead>
          <tbody>${tl}</tbody>
        </table></div>
        ${note ? `<div class="urep-note"><strong>Notes:</strong> ${_e(note)}</div>` : ''}
      </div>
    </details>`;
  }).join('');
}
