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
let adrSubs = {};           // user -> that day's submitted daily report (what they stand behind)
let adrVisits = {};         // A189 — user -> that day's client visits
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

  // A155: prime the request-number → client/supplier name map so legacy blank-ref
  // "Client saved" rows can be titled with the client they belong to (idempotent).
  if (typeof flowPrimeRefNames === 'function') await flowPrimeRefNames();
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
  // A189 — one call for the whole team's visits, grouped here rather than per user, so adding a rep
  // costs no extra request. Failure is non-fatal: the rest of the report still renders.
  adrVisits = {};
  try {
    const vr = await fetchFlow('getClientVisits', { date }, opts);
    if (seq === adrLoadSeq) {
      ((vr && vr.data) || []).forEach(v => {
        const u = String(v.user || 'Unknown').trim() || 'Unknown';
        (adrVisits[u] = adrVisits[u] || []).push(v);
      });
    }
  } catch (e) { adrVisits = {}; }
  adrEmailsLoading = true;
  render();

  // 2) Notes (parallel, best-effort) → repaint when done.
  const users = Array.from(new Set(adrEntries.map(e => e.user).filter(Boolean)));
  Promise.all(users.map(u =>
    fetchFlow('getDailyNote', { date, user: u }, opts).then(r => { if (r && r.notes) adrNotes[u] = r.notes; }).catch(() => {})
  )).then(() => { if (seq === adrLoadSeq) render(); });

  // 2b) Submitted daily reports for the date — read-only here; management acknowledges on its own
  //     dashboard. Absent until the backend carries submitDailyReport, which reads as unsubmitted.
  adrSubs = {};
  fetchFlow('getDailyReports', { date }, opts)
    .then(r => { if (r && r.success) (r.data || []).forEach(x => { adrSubs[String(x.user).trim()] = x; }); })
    .catch(() => {})
    .then(() => { if (seq === adrLoadSeq) render(); });

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
  if (typeof flowRenderInjectCss === 'function') flowRenderInjectCss();
  const q = (document.getElementById('userSearch').value || '').trim().toLowerCase();

  // Group by user, then collapse EACH user's raw actions into DISTINCT tasks (one per record) — so a
  // record a user touched several times counts once, and a record two users worked credits each of them.
  const byUser = {};
  adrEntries.forEach(e => { const u = e.user || 'Unknown'; (byUser[u] = byUser[u] || []).push(e); });
  const userTasks = {};   // name -> { tasks:[...], counts:{...} }
  Object.keys(byUser).forEach(u => { const t = flowRollupActivity(byUser[u]); userTasks[u] = { tasks: t, counts: flowActivityCounts(t) }; });

  // ── Org summary — distinct tasks summed across users ──
  let orgTasks = 0, orgDocs = 0, orgPdfs = 0, orgSales = 0, orgPaid = 0;
  Object.keys(userTasks).forEach(u => {
    const ut = userTasks[u];
    orgTasks += ut.counts.tasks; orgDocs += ut.counts.docs; orgPdfs += ut.counts.pdfs;
    orgSales += flowTaskAmount(ut.tasks, 'Invoice'); orgPaid += flowTaskAmount(ut.tasks, 'AP Aging');
  });
  const activeUsers = Object.keys(byUser).filter(u => u && u !== 'Unknown');
  document.getElementById('sumUsers').textContent = activeUsers.length;
  document.getElementById('sumMovements').textContent = orgTasks;
  document.getElementById('sumDocs').textContent = orgDocs;
  document.getElementById('sumSales').textContent = _m(orgSales);
  document.getElementById('sumPaid').textContent = _m(orgPaid);
  document.getElementById('sumPdfs').textContent = orgPdfs;
  const orgVisits = Object.keys(adrVisits).reduce((s, u) => s + adrVisits[u].length, 0);   // A189
  const sv = document.getElementById('sumVisits'); if (sv) sv.textContent = orgVisits;
  const totalEmails = Object.values(adrEmails).reduce((s, v) => s + ((v.emails || []).length), 0);
  const meta = document.getElementById('reportMeta');
  if (meta) {
    const base = meta.textContent.replace(/ · \d+ sent email\(s\).*$/, '');
    meta.textContent = base + (adrEmailsLoading ? ` · ${totalEmails} sent email(s) (loading…)` : ` · ${totalEmails} sent email(s)`);
  }

  // ── Full user list (include note-only / submission-only / email-only users) ──
  let names = Object.keys(byUser).sort((a, b) => a.localeCompare(b));
  Object.keys(adrNotes).forEach(u => { if (!byUser[u]) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  Object.keys(adrSubs).forEach(u => { if (!byUser[u]) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  Object.keys(adrEmails).forEach(u => { if (!byUser[u] && (adrEmails[u].emails || []).length) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  // A189 — a rep whose whole day was client visits has no ActivityLog rows, so without this they
  // would be missing from the team report entirely.
  Object.keys(adrVisits).forEach(u => { if (!byUser[u]) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  names = Array.from(new Set(names));
  if (q) names = names.filter(n => n.toLowerCase().includes(q));
  document.getElementById('userCount').textContent = names.length;

  // ── Team Productivity comparison — per user, sorted by distinct tasks (real output at a glance) ──
  renderProductivity(names, userTasks);

  const cont = document.getElementById('userReports');
  if (!names.length) { cont.innerHTML = '<div class="dr-empty">No activity recorded for this day.</div>'; return; }

  cont.innerHTML = names.map((name, i) => {
    const ut = userTasks[name] || { tasks: [], counts: flowActivityCounts([]) };
    const tasks = ut.tasks, c = ut.counts;
    const note = adrNotes[name];
    const modChips = Object.keys(c.byModule).sort((a, b) => (MODULE_ORDER.indexOf(a) + 1 || 99) - (MODULE_ORDER.indexOf(b) + 1 || 99))
      .map(m => `<span class="mod-badge ${_modClass(m)}">${_e(m)} ${c.byModule[m]}</span>`).join('');
    const sub = adrSubs[String(name).trim()];
    return `<details class="urep"${i === 0 ? ' open' : ''} data-user="${_e(name)}">
      <summary><span class="uname">${_e(name)}</span>
        <span class="ustat">${c.tasks} task(s) · ${c.docs} doc(s)${(adrVisits[name] || []).length ? ` · 🤝 ${adrVisits[name].length} visit(s)` : ''}${(adrEmails[name] && (adrEmails[name].emails || []).length) ? ` · ✉️ ${adrEmails[name].emails.length} sent` : ''}${note ? ' · 📝 note' : ''}${sub ? ` · <span style="color:${sub.status === 'Reviewed' ? '#0d9488' : '#15803d'};">✓ submitted</span>` : ' · <span style="color:#b45309;">not submitted</span>'}</span></summary>
      <div class="urep-body">
        ${modChips ? `<div class="umods">${modChips}</div>` : ''}
        ${flowRenderTaskCards(tasks, { moduleOrder: MODULE_ORDER, emptyText: 'No movements (note only).' })}
        ${adrVisitHtml(name)}
        ${adrEmailHtml(name)}
        ${adrSubmissionHtml(sub)}
        ${note ? `<div class="urep-note"><strong>Notes:</strong> ${_e(note)}</div>` : ''}
      </div>
    </details>`;
  }).join('');
}

/** Compact per-user productivity comparison (distinct tasks today), sorted high→low. */
function renderProductivity(names, userTasks) {
  const el = document.getElementById('prodCompare');
  if (!el) return;
  const rows = names.map(function (n) {
    const c = (userTasks[n] || {}).counts || flowActivityCounts([]);
    const top = Object.keys(c.byModule).sort(function (a, b) { return c.byModule[b] - c.byModule[a]; })
      .slice(0, 3).map(function (m) { return _e(m) + ' ' + c.byModule[m]; }).join(' · ');
    const sub = adrSubs[String(n).trim()];
    const em = (adrEmails[n] && (adrEmails[n].emails || []).length) || 0;
    const vis = (adrVisits[String(n).trim()] || []).length;   // A189
    return { name: n, tasks: c.tasks, docs: c.docs, top: top, emails: em, visits: vis, submitted: !!sub };
  }).sort(function (a, b) { return b.tasks - a.tasks || a.name.localeCompare(b.name); });
  const max = Math.max(1, rows[0] ? rows[0].tasks : 1);
  el.innerHTML = '<div style="overflow-x:auto;"><table class="flow-table"><thead><tr>'
    + '<th>User</th><th class="num">Tasks</th><th>Output</th><th style="width:30%;"></th>'
    + '<th class="num">Visits</th><th class="num">Emails</th><th>Submitted</th></tr></thead><tbody>'
    + rows.map(function (r) {
      return '<tr><td style="font-weight:600;">' + _e(r.name) + '</td>'
        + '<td class="num" style="font-weight:700;">' + r.tasks + '</td>'
        + '<td style="font-size:0.78rem;color:var(--text-secondary,#475569);">' + (r.top || '—') + '</td>'
        + '<td><div style="height:8px;border-radius:999px;background:var(--bg-inset,#f1f5f9);overflow:hidden;">'
        + '<div style="height:100%;width:' + Math.round(r.tasks / max * 100) + '%;background:var(--accent,#4f46e5);"></div></div></td>'
        + '<td class="num">' + (r.visits || '') + '</td>'
        + '<td class="num">' + (r.emails || '') + '</td>'
        + '<td>' + (r.submitted ? '<span style="color:#15803d;font-weight:700;">✓</span>' : '<span style="color:#b45309;">—</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

// The user's per-day sent emails (auto-loaded up front in adrLoadAllEmails), rendered inline.
/** What the person wrote when they submitted. Read-only here — management acknowledges reports on
 *  its own dashboard, so this view stays a pure oversight read. */
function adrSubmissionHtml(sub) {
  if (!sub) return '';
  const part = (label, text) => text
    ? `<div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#0d9488;margin-top:0.4rem;">${label}</div>
       <div style="font-size:0.84rem;white-space:pre-wrap;">${_e(text)}</div>` : '';
  const body = part('Highlights', sub.highlights) + part('Blockers', sub.blockers) + part('Plan', sub.plan);
  return `<div style="margin-top:0.7rem;border-left:3px solid var(--accent,#0d9488);background:var(--bg-inset,#f8fafc);padding:0.6rem 0.85rem;border-radius:0 8px 8px 0;">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
      <strong style="font-size:0.8rem;">Daily report submitted</strong>
      <span style="font-size:0.75rem;color:var(--text-muted,#64748b);">${_e(_time(sub.submittedAt))}${(parseFloat(sub.submitCount) || 0) > 1 ? ` · updated ${parseFloat(sub.submitCount)}×` : ''}</span>
      ${sub.status === 'Reviewed' ? `<span style="margin-left:auto;font-size:0.75rem;color:#0d9488;font-weight:700;">✓ Reviewed by ${_e(sub.reviewedBy)}</span>` : ''}
    </div>
    ${body || '<div style="font-size:0.82rem;color:var(--text-muted,#94a3b8);font-style:italic;">Submitted with no written notes.</div>'}
  </div>`;
}

/** A189 — one rep's client visits for the selected day. Silent when they logged none, so the card
    doesn't grow an empty section for the roles that never do visits. */
function adrVisitHtml(name) {
  const visits = adrVisits[String(name).trim()] || [];
  if (!visits.length) return '';
  const head = `<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);margin:0.6rem 0 0.3rem;">🤝 Client Visits — ${_e(_date())} <span style="font-weight:600;color:var(--text-secondary,#475569);">(${visits.length})</span></div>`;
  return head + `<div style="overflow-x:auto;"><table class="flow-table">
    <thead><tr><th>Time</th><th>Person visited</th><th>Company</th><th>City / address</th><th>Topic</th></tr></thead>
    <tbody>${visits.map(v => `<tr>
      <td>${_e(v.time || _time(v.createdAt))}</td>
      <td>${_e(v.personVisited || '—')}</td>
      <td>${_e(v.company || '—')}</td>
      <td>${_e(v.cityAddress || '—')}</td>
      <td style="color:var(--text-secondary,#475569);">${_e(v.topic || '')}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

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
