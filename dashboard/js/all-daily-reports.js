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
  picker.addEventListener('change', () => load());   // wrapped: the change Event must not become the `fresh` arg
  document.getElementById('refreshBtn').addEventListener('click', () => load(true));   // fresh: bypass the flow read-cache
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

// Progressive load: paint activity IMMEDIATELY, then notes, then emails batch-by-batch — instead of
// blocking the first render on the slowest data (per-user IMAP fetches take seconds each).
// A sequence counter discards stale async completions when a new load supersedes (poll/date change).
let adrLoadSeq = 0;
let adrEmailsLoading = false;
async function load(fresh) {
  const seq = ++adrLoadSeq;
  const opts = fresh ? { fresh: true } : {};
  const date = _date();
  document.getElementById('reportMeta').textContent =
    `For ${date} · Oversight by ${adrSession.name} · Generated ${new Date().toLocaleString('en-US')}`;

  // 1) Activity → first paint right away.
  try {
    const res = await fetchFlow('getActivityLog', { date }, opts);   // ALL users
    if (seq !== adrLoadSeq) return;
    adrEntries = (res && res.data) || [];
  } catch (e) {
    if (seq !== adrLoadSeq) return;
    adrEntries = [];
    document.getElementById('userReports').innerHTML = `<div class="dr-empty">${_e(e.message)}</div>`;
  }
  adrNotes = {};
  adrEmailsLoading = true;
  render();

  // 2) Notes (parallel, best-effort) → repaint when done.
  const users = Array.from(new Set(adrEntries.map(e => e.user).filter(Boolean)));
  Promise.all(users.map(u =>
    fetchFlow('getDailyNote', { date, user: u }, opts).then(r => { if (r && r.notes) adrNotes[u] = r.notes; }).catch(() => {})
  )).then(() => { if (seq === adrLoadSeq) render(); });

  // 3) Sent emails (batched IMAP — the slow part) → repaint after each batch, flag cleared at the end.
  await adrLoadAllEmails(seq);
  if (seq !== adrLoadSeq) return;
  adrEmailsLoading = false;
  render();
}

// Fetch the whole user roster (via the Flask proxy — the production Code.gs deployment 404s on GET
// getUsers) and, for everyone except director, pull their sent emails in SMALL BATCHES: the old
// unbounded parallel fan-out caused 401s (cold Flask session cache racing validateSession) and
// 500s (GoDaddy throttles concurrent IMAP logins from one IP).
let adrRosterError = '';
async function adrLoadAllEmails(seq) {
  adrEmails = {};
  adrRosterError = '';
  if (typeof apiFetchEmailUsers !== 'function' || typeof apiFetchEmailLogToday !== 'function') return;
  let list = [];
  try {
    const r = await apiFetchEmailUsers();
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the user list.');
    list = r.users || [];
  } catch (e) {
    adrRosterError = e.message || 'Could not load the user list.';
    return;
  }
  const targets = list.filter(u => String(u.role || '').toLowerCase() !== 'director');
  const date = _date();
  const fetchOne = (u) => {
    const uname = u.username || u.fullName || u.name;                 // creds are keyed by login username
    const disp = u.fullName || u.name || u.username;                  // cards are keyed by display name
    if (!uname) return Promise.resolve();
    return apiFetchEmailLogToday(uname, date).then(r => {
      if (r && r.success) adrEmails[disp] = { emails: r.emails || [], needsSetup: !!r.needsSetup };
      else adrEmails[disp] = { emails: [], needsSetup: !!(r && r.needsSetup), error: (r && r.message) || 'load failed' };
    }).catch(e => { adrEmails[disp] = { emails: [], needsSetup: false, error: e.message || 'load failed' }; });
  };
  // Warm the Flask session cache with ONE call (the viewer's own mailbox) before fanning out,
  // so the batches never race a cold validateSession.
  try { await apiFetchEmailLogToday(undefined, date); } catch (e) { /* warm-up only */ }
  // Batches of 3 — enough parallelism to stay fast without tripping GoDaddy's per-IP IMAP limits.
  // Repaint after each batch so email sections fill in progressively instead of all at the end.
  for (let i = 0; i < targets.length; i += 3) {
    await Promise.all(targets.slice(i, i + 3).map(fetchOne));
    if (seq !== undefined && seq !== adrLoadSeq) return;   // superseded by a newer load
    render();
  }
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
  // total sent emails across all users (appended to the report meta line; re-computed on every
  // progressive repaint so the count grows as batches land instead of freezing at the first paint)
  const totalEmails = Object.values(adrEmails).reduce((s, v) => s + ((v.emails || []).length), 0);
  const meta = document.getElementById('reportMeta');
  if (meta) {
    const base = meta.textContent.replace(/ · \d+ sent email\(s\).*$/, '');
    meta.textContent = base + (adrEmailsLoading ? ` · ${totalEmails} sent email(s) (loading…)` : ` · ${totalEmails} sent email(s)`);
  }

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
  if (!rec) {
    // Roster unavailable → say WHY instead of a bare dash.
    if (adrRosterError) return head + `<div class="dr-empty" style="font-size:0.8rem;color:#b45309;">Sent emails unavailable — ${_e(adrRosterError)}</div>`;
    if (adrEmailsLoading) return head + `<div class="dr-empty" style="font-size:0.8rem;">Loading sent emails…</div>`;
    return head + `<div class="dr-empty" style="font-size:0.8rem;">—</div>`;
  }
  if (rec.needsSetup) {
    const why = rec.reconnect
      ? `${_e(name)} needs to reconnect their mailbox — ${_e(rec.message || 'the stored credentials could not be read.')}`
      : `${_e(name)} hasn't connected their mailbox.`;
    return head + `<div class="dr-empty" style="font-size:0.8rem;">${why}</div>`;
  }
  if (rec.error) return head + `<div class="dr-empty" style="font-size:0.8rem;color:#b45309;">Couldn't load (${_e(rec.error)}) — retrying on the next refresh.</div>`;
  const emails = rec.emails || [];
  if (!emails.length) return head + `<div class="dr-empty" style="font-size:0.8rem;">No emails sent on ${_e(_date())}.</div>`;
  return head + `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Time</th><th>To</th><th>Subject</th></tr></thead>
    <tbody>${emails.map(m => `<tr><td>${_e(m.sentAt || m.time || '')}</td><td>${_e(m.recipient || '')}</td><td>${_e(m.subject || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
