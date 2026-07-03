/* ═══════════════════════════════════════════════
   all-daily-reports.js — oversight view of EVERY user's daily report for a date.
   Groups the flow ActivityLog by user; each user is a collapsible card with their
   summary tiles, activity timeline, per-module breakdown, and personal note.
   Accessible to admin / accounting / management / director.
   ═══════════════════════════════════════════════ */

let adrSession = null;
let adrEntries = [];        // all users' activity for the selected date
let adrNotes = {};          // user -> note text
let adrEmails = {};         // display name -> { emails, needsSetup } (per-day GoDaddy sent mail, all roles except director)
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
  picker.value = flowToday();
  picker.addEventListener('change', load);
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('userSearch').addEventListener('input', render);
  load();
  // Auto-update the whole oversight view (activity + every user's sent emails) while viewing TODAY.
  // Longer interval — it fans out IMAP to every user, so don't hammer GoDaddy.
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && _date() === flowToday()) load();
  }, 180000);
  window.addEventListener('pagehide', () => clearInterval(poll));
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
  // Pull every user's per-day sent emails from GoDaddy (all roles EXCEPT director) and auto-aggregate.
  await adrLoadAllEmails();
  render();
}

// Fetch the whole user list and, for everyone except director, pull their sent-today emails in parallel.
async function adrLoadAllEmails() {
  adrEmails = {};
  if (typeof apiGetUsers !== 'function' || typeof apiFetchEmailLogToday !== 'function') return;
  let list = [];
  try { const r = await apiGetUsers(); list = (r && (r.data || r.users)) || []; } catch (e) { return; }
  const targets = list.filter(u => String(u.role || '').toLowerCase() !== 'director');
  await Promise.all(targets.map(u => {
    const uname = u.username || u.fullName || u.name;                 // creds are keyed by login username
    const disp = u.fullName || u.name || u.username;                  // cards are keyed by display name
    if (!uname) return Promise.resolve();
    return apiFetchEmailLogToday(uname, _date()).then(r => {
      adrEmails[disp] = { emails: (r && r.success && r.emails) || [], needsSetup: !!(r && r.needsSetup) };
    }).catch(() => { adrEmails[disp] = { emails: [], needsSetup: false }; });
  }));
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
  // total sent emails across all users (appended to the report meta line)
  const totalEmails = Object.values(adrEmails).reduce((s, v) => s + ((v.emails || []).length), 0);
  const meta = document.getElementById('reportMeta');
  if (meta && !/sent email/.test(meta.textContent)) meta.textContent += ` · ${totalEmails} sent email(s)`;

  // ── Group by user ──
  const byUser = {};
  adrEntries.forEach(e => { const u = e.user || 'Unknown'; (byUser[u] = byUser[u] || []).push(e); });
  let names = Object.keys(byUser).sort((a, b) => a.localeCompare(b));
  // include users with only a note (no activity)
  Object.keys(adrNotes).forEach(u => { if (!byUser[u]) { byUser[u] = []; names.push(u); } });
  // include users who sent emails today but had no flow activity
  Object.keys(adrEmails).forEach(u => { if (!byUser[u] && (adrEmails[u].emails || []).length) { byUser[u] = []; names.push(u); } });
  names = Array.from(new Set(names));
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
    return `<details class="urep"${i === 0 ? ' open' : ''} data-user="${_e(name)}">
      <summary><span class="uname">${_e(name)}</span>
        <span class="ustat">${rows.length} movement(s) · ${docs} doc(s)${(adrEmails[name] && (adrEmails[name].emails || []).length) ? ` · ✉️ ${adrEmails[name].emails.length} sent` : ''}${note ? ' · 📝 note' : ''}</span></summary>
      <div class="urep-body">
        ${modChips ? `<div class="umods">${modChips}</div>` : ''}
        <div style="overflow-x:auto;"><table class="flow-table">
          <thead><tr><th>Time</th><th>Module</th><th>Action</th><th>Reference</th><th>Detail</th><th class="num">Amount</th></tr></thead>
          <tbody>${tl}</tbody>
        </table></div>
        ${adrEmailHtml(name)}
        ${note ? `<div class="urep-note"><strong>Notes:</strong> ${_e(note)}</div>` : ''}
      </div>
    </details>`;
  }).join('');
}

// The user's per-day sent emails (auto-loaded up front in adrLoadAllEmails), rendered inline.
function adrEmailHtml(name) {
  const head = `<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);margin:0.6rem 0 0.3rem;">✉️ Sent Emails — ${_e(_date())}</div>`;
  const rec = adrEmails[name];
  if (!rec) return head + `<div class="dr-empty" style="font-size:0.8rem;">—</div>`;
  if (rec.needsSetup) return head + `<div class="dr-empty" style="font-size:0.8rem;">${_e(name)} hasn't connected their mailbox.</div>`;
  const emails = rec.emails || [];
  if (!emails.length) return head + `<div class="dr-empty" style="font-size:0.8rem;">No emails sent on ${_e(_date())}.</div>`;
  return head + `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Time</th><th>To</th><th>Subject</th></tr></thead>
    <tbody>${emails.map(m => `<tr><td>${_e(m.sentAt || m.time || '')}</td><td>${_e(m.recipient || '')}</td><td>${_e(m.subject || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
