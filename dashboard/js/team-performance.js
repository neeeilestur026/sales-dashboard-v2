/* ═══════════════════════════════════════════════
   team-performance.js — per-person weekly performance for a Mon–Sun week, mountable by BOTH the
   management home (compact) and the Team Performance page management/HR share (full).

   Extracted from the management-only Team Weekly Report so a second consumer doesn't become a
   second copy — this codebase already carries one duplicated per-user report renderer, and a third
   would make every fix a three-way mirror.

   Data: getActivityLog ×7 (all users) + getSalesCalls ×7 + per-user sent emails (roster via
   apiFetchEmailUsers, which also supplies each user's ROLE so the chart shows that role's tasks)
   + the week's submitted daily reports (compliance + narrative).

   Options:
     mountId                              required container
     rangeId, nextBtnId, resetBtnId, pdfBtnId   optional chrome
     baseDate      string OR () => string  the anchor date (a function lets the host's date picker drive it)
     mode          'compact' | 'full'      full adds the team table, per-person submissions and PDF buttons
     withEmails, withSubmissions, withPersonPdf
     hideAmounts                           HR view — never render money
     chartIdPrefix                         defaults 'tpChart_'
   ═══════════════════════════════════════════════ */

let _tpOpts = null;
let _tpOffset = 0, _tpSeq = 0;
let _tpData = null;                 // { users, days, today }
let _tpCharts = [], _tpChartImg = {};   // chart images keyed by NAME — never by index (see below)
let _tpOrder = [];                  // the single source of render order
let _tpRoles = {}, _tpRoster = [];
let _tpReports = {};                // name → { date → submission }
let _tpPrevRate = null;             // A156: last week's submission rate — the ONE real delta on the ribbon

/** One normalization for every name key. ActivityLog 'User', the roster's fullName and
 *  DailyReports 'User' all originate from session.name; any drift splits one person into two cards. */
function _tpKey(n) { return String(n == null ? '' : n).trim(); }
function _tpe(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _tpn(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// Each role sees ITS tasks on the chart/summary (label → counter key; keys: calls/emails/other or a module).
const TP_ROLE_TASKS = {
  sales: [['Calls', 'calls'], ['Emails', 'emails'], ['Quotations', 'Quotation'],
          ['Purchase Requests', 'Pricing Request'], ['Inventory', 'Inventory'], ['Other', 'other']],
  accounting: [['Emails', 'emails'], ['Invoices', 'Invoice'], ['Receiving', 'Receiving'],
               ['Collections', 'Collection'], ['Expenses', 'Expense'], ['Sales Orders', 'Sales Order'], ['Other', 'other']],
  admin: [['Emails', 'emails'], ['Purchase Orders', 'Purchase Order'], ['Sales Orders', 'Sales Order'],
          ['Shipments', 'Shipment'], ['Payment Requests', 'Payment Request'],
          ['Pricing Requests', 'Pricing Request'], ['Other', 'other']],
  default: [['Calls', 'calls'], ['Emails', 'emails'], ['Quotations', 'Quotation'],
            ['Purchase Requests', 'Pricing Request'], ['Sales Orders', 'Sales Order'],
            ['Purchase Orders', 'Purchase Order'], ['Invoices', 'Invoice'], ['Other', 'other']],
};
const _TP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _TP_ROLE_CHIP = { sales: '#0d9488', accounting: '#7c3aed', admin: '#2563eb',
  management: '#b45309', director: '#b45309', marketing: '#db2777', hr: '#0891b2' };
const _TP_DOC_ACTIONS = ['Created', 'Issued', 'Received', 'Added'];

function _tpRoleOf(name) { return _tpRoles[_tpKey(name)] || ''; }
function _tpTasksFor(name) { return TP_ROLE_TASKS[_tpRoleOf(name)] || TP_ROLE_TASKS.default; }
function _tpPrefix() { return (_tpOpts && _tpOpts.chartIdPrefix) || 'tpChart_'; }
function _tpBaseDate() {
  const b = _tpOpts && _tpOpts.baseDate;
  const v = (typeof b === 'function') ? b() : b;
  return v || (typeof flowToday === 'function' ? flowToday() : '');
}

function _tpWeekDates(baseDate, offset) {
  const d = new Date(String(baseDate || '') + 'T00:00:00');
  if (isNaN(d)) return [];
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (offset || 0) * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon); x.setDate(mon.getDate() + i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}

function _tpWeekAfterIsFuture(days) {
  const last = new Date(days[6] + 'T00:00:00');
  last.setDate(last.getDate() + 1);
  const nextStart = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return nextStart > flowToday();
}

function tpNavWeek(delta) {
  _tpOffset = delta === 0 ? 0 : _tpOffset + delta;
  tpLoad();
}

function initTeamPerformance(opts) {
  _tpOpts = opts || {};
  _tpOffset = 0;
  return tpLoad();
}

async function tpLoad() {
  const body = document.getElementById(_tpOpts && _tpOpts.mountId);
  if (!body) return;
  const seq = ++_tpSeq;
  const days = _tpWeekDates(_tpBaseDate(), _tpOffset);
  if (!days.length) return;
  const today = flowToday();

  const range = document.getElementById(_tpOpts.rangeId);
  if (range) range.textContent = `${days[0]} – ${days[6]}${_tpOffset ? ` (${_tpOffset > 0 ? '+' : ''}${_tpOffset} wk)` : ''}`;
  const nextBtn = document.getElementById(_tpOpts.nextBtnId);
  if (nextBtn) nextBtn.disabled = _tpWeekAfterIsFuture(days);
  const resetBtn = document.getElementById(_tpOpts.resetBtnId);
  if (resetBtn) resetBtn.style.display = _tpOffset ? '' : 'none';
  const pdfBtn = document.getElementById(_tpOpts.pdfBtnId);
  if (pdfBtn) pdfBtn.disabled = true;
  body.innerHTML = '<div class="mf-empty dr-empty">Loading team weekly report…</div>';

  // Roster FIRST — supplies each user's role (chart task mix) and the email usernames.
  try {
    if (typeof apiFetchEmailUsers === 'function' && !_tpRoster.length) {
      const ro = await apiFetchEmailUsers();
      _tpRoster = (ro && ro.users) || [];
    }
  } catch (e) { /* roles fall back to the generic list */ }
  _tpRoles = {};
  _tpRoster.forEach(u => { _tpRoles[_tpKey(u.fullName || u.username)] = String(u.role || '').toLowerCase(); });
  if (seq !== _tpSeq) return;

  // Activity + calls ×7 (all users) in parallel; future days skipped.
  const [acts, calls] = await Promise.all([
    Promise.all(days.map(d => d > today ? Promise.resolve([])
      : fetchFlow('getActivityLog', { date: d }).then(r => (r && r.data) || []).catch(() => []))),
    Promise.all(days.map(d => d > today ? Promise.resolve([])
      : fetchFlow('getSalesCalls', { date: d }).then(r => (r && r.data) || []).catch(() => []))),
  ]);
  if (seq !== _tpSeq) return;

  // Submitted daily reports for the week (compliance + the narrative each person wrote).
  _tpReports = {};
  if (_tpOpts.withSubmissions !== false) {
    try {
      const sr = await fetchFlow('getDailyReports', { start: days[0], end: days[6] });
      if (sr && sr.success) (sr.data || []).forEach(s => {
        const k = _tpKey(s.user);
        (_tpReports[k] = _tpReports[k] || {})[s.date] = s;
      });
    } catch (e) { /* pre-v81 backend — compliance simply shows as none */ }
    if (seq !== _tpSeq) return;

    // A156: last week's submission rate for the ribbon's only comparison. One extra call, so the
    // figure is real; the comp's other "▲" deltas would each cost seven more fetches and are
    // therefore not shown at all rather than invented.
    _tpPrevRate = null;
    if (_tpOpts.mode === 'full') {
      try {
        const prev = _tpWeekDates(_tpBaseDate(), _tpOffset - 1);
        const pr = await fetchFlow('getDailyReports', { start: prev[0], end: prev[6] });
        if (pr && pr.success) {
          const seen = {};
          (pr.data || []).forEach(s2 => { (seen[_tpKey(s2.user)] = seen[_tpKey(s2.user)] || {})[s2.date] = 1; });
          const people = Object.keys(seen);
          const elapsedPrev = prev.filter(d => d <= today).length;
          const of = people.length * elapsedPrev;
          const done = people.reduce((n, u) => n + Object.keys(seen[u]).length, 0);
          if (of > 0) _tpPrevRate = Math.round((done / of) * 100);
        }
      } catch (e) { /* no prior data — the ribbon shows "vs last week —" */ }
      if (seq !== _tpSeq) return;
    }
  }

  // Per-user aggregation.
  const users = {};
  const U = name => users[name] = users[name] || { moves: 0, calls: 0, emails: 0, docs: 0, pdfs: 0,
    amount: 0, perDay: new Array(7).fill(0), perDayCalls: new Array(7).fill(0), mods: {} };
  days.forEach((d, i) => {
    // A148: dedup within (user, day) — collapse each user's raw actions on day i into DISTINCT tasks,
    // so a record touched several times counts once (true productivity, not raw action volume).
    const dayByUser = {};
    acts[i].forEach(e => { if (e.module === 'Call') return; const k = _tpKey(e.user) || '(unknown)'; (dayByUser[k] = dayByUser[k] || []).push(e); });
    Object.keys(dayByUser).forEach(name => {
      const tasks = (typeof flowRollupActivity === 'function') ? flowRollupActivity(dayByUser[name]) : dayByUser[name];
      const u = U(name);
      u.moves += tasks.length; u.perDay[i] += tasks.length;
      tasks.forEach(t => {
        u.mods[t.module] = (u.mods[t.module] || 0) + 1;
        if (t.verbs && t.verbs.some(v => _TP_DOC_ACTIONS.indexOf(v) >= 0)) u.docs++;
        if (t.verbs && t.verbs.indexOf('PDF Saved') >= 0) u.pdfs++;
        if (t.module === 'Invoice') u.amount += _tpn(t.amount);
      });
    });
    calls[i].forEach(c => { const u = U(_tpKey(c.user) || '(unknown)'); u.calls++; u.perDayCalls[i]++; });
  });
  // People who submitted a report but logged no system activity still belong in the report.
  Object.keys(_tpReports).forEach(n => { if (n) U(n); });
  _tpData = { users, days, today };
  tpRender();                                        // paint activity/calls immediately

  // Emails per user — day 1 first (skip the rest of the week when not connected), 2 users at a time.
  if (_tpOpts.withEmails !== false) {
    try {
      if (typeof apiFetchEmailLogToday === 'function') {
        const pastDays = days.filter(d => d <= today);
        // Warm the server's session cache with one own-mailbox call before fanning out: the
        // unbounded version raced a cold validateSession and produced spurious 401s.
        if (pastDays.length) await apiFetchEmailLogToday(undefined, pastDays[0]).catch(() => null);
        if (seq !== _tpSeq) return;
        const roster = _tpRoster.filter(u => String(u.role) !== 'director');
        const jobs = roster.map(u => async () => {
          const name = _tpKey(u.fullName || u.username);
          if (!pastDays.length) return;
          const first = await apiFetchEmailLogToday(u.username, pastDays[0]).catch(() => null);
          if (seq !== _tpSeq) return;
          if (!first || first.needsSetup) return;    // mailbox not connected — skip the whole week
          U(name).emails += ((first.emails || []).length);
          for (let i = 1; i < pastDays.length; i += 3) {
            await Promise.all(pastDays.slice(i, i + 3).map(async d => {
              const r = await apiFetchEmailLogToday(u.username, d).catch(() => null);
              if (r && r.success && Array.isArray(r.emails)) U(name).emails += r.emails.length;
            }));
            if (seq !== _tpSeq) return;
          }
        });
        for (let i = 0; i < jobs.length; i += 2) {
          await Promise.all(jobs.slice(i, i + 2).map(j => j()));
          if (seq !== _tpSeq) return;
          tpRender();                                // progressive email fill-in
        }
      }
    } catch (e) { /* emails are best-effort — the report still stands on activity+calls */ }
  }
  if (seq === _tpSeq && pdfBtn) pdfBtn.disabled = false;
}

function _tpCounts(u, tasks) {
  return tasks.map(([, key]) => {
    if (key === 'calls') return u.calls;
    if (key === 'emails') return u.emails;
    if (key === 'other') {
      const named = tasks.map(t => t[1]);
      return Object.keys(u.mods).reduce((s, m) => s + (named.indexOf(m) >= 0 ? 0 : u.mods[m]), 0);
    }
    return u.mods[key] || 0;
  });
}

/** Submission compliance for one person over the week's elapsed days. */
function _tpCompliance(name, days, today) {
  const past = days.filter(d => d <= today);
  const recs = _tpReports[_tpKey(name)] || {};
  return { done: past.filter(d => recs[d]).length, of: past.length };
}

/** Names after the page's role/search filters, in the single render order. */
function _tpVisibleNames() {
  const { users } = _tpData;
  _tpOrder = Object.keys(users).sort((a, b) => users[b].moves - users[a].moves || a.localeCompare(b));
  let names = _tpOrder;
  const roleSel = document.getElementById('tpRoleFilter');
  const search = document.getElementById('tpSearch');
  if (roleSel && roleSel.value) names = names.filter(n => _tpRoleOf(n) === roleSel.value);
  if (search && search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    names = names.filter(n => n.toLowerCase().indexOf(q) >= 0);
  }
  return names;
}

function tpRender() {
  // The standalone page uses the comp layout; management-home's embedded block keeps the compact
  // card list it has always had, so this refactor cannot disturb that page.
  if (_tpOpts && _tpOpts.mode === 'full') return tpRenderFull();
  return tpRenderCompact();
}

function tpRenderCompact() {
  const body = document.getElementById(_tpOpts && _tpOpts.mountId);
  if (!body || !_tpData) return;
  const { users, days, today } = _tpData;
  const full = false;
  const hide = !!_tpOpts.hideAmounts;

  // ONE ordering, reused by the render, the charts and every PDF. (The predecessor re-derived this
  // sort inside its PDF builder and then looked charts up by index — a sort change would silently
  // put one person's chart on another person's report.)
  _tpOrder = Object.keys(users).sort((a, b) => users[b].moves - users[a].moves || a.localeCompare(b));
  let names = _tpOrder;

  // Optional page-level filters (full mode only).
  const roleSel = document.getElementById('tpRoleFilter');
  const search = document.getElementById('tpSearch');
  if (roleSel && roleSel.value) names = names.filter(n => _tpRoleOf(n) === roleSel.value);
  if (search && search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    names = names.filter(n => n.toLowerCase().indexOf(q) >= 0);
  }
  if (!names.length) { body.innerHTML = '<div class="mf-empty dr-empty">No team activity in this week.</div>'; return; }

  const tot = f => names.reduce((s, n) => s + _tpn(users[n][f]), 0);
  const totMod = m => names.reduce((s, n) => s + (users[n].mods[m] || 0), 0);
  const comp = names.reduce((acc, n) => {
    const c = _tpCompliance(n, days, today);
    acc.done += c.done; acc.of += c.of; return acc;
  }, { done: 0, of: 0 });

  const cards = names.map((name) => {
    const u = users[name];
    const role = _tpRoleOf(name);
    const tasks = _tpTasksFor(name);
    const counts = _tpCounts(u, tasks);
    const c = _tpCompliance(name, days, today);
    const idx = _tpOrder.indexOf(name);
    const roleChip = role ? `<span style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:0.15rem 0.5rem;border-radius:999px;color:#fff;background:${_TP_ROLE_CHIP[role] || '#64748b'};">${_tpe(role)}</span>` : '';
    const compChip = `<span style="font-size:0.68rem;font-weight:700;padding:0.15rem 0.5rem;border-radius:999px;
      background:${c.done >= c.of && c.of ? '#dcfce7' : '#fef3c7'};color:${c.done >= c.of && c.of ? '#15803d' : '#b45309'};">
      ${c.done}/${c.of} report${c.of === 1 ? '' : 's'}</span>`;
    const chips = tasks.map(([label], j) =>
      `<span style="display:inline-block;padding:0.22rem 0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:999px;font-size:0.72rem;background:var(--bg-inset,#f8fafc);">${_tpe(label)}: <b>${counts[j]}</b></span>`).join(' ');
    const spark = days.map((d, j) =>
      `<span title="${_tpe(d)}" style="display:inline-block;min-width:1.7rem;text-align:center;padding:0.14rem 0.15rem;border-radius:5px;background:${u.perDay[j] ? 'var(--accent-light,#e6f4f1)' : 'var(--bg-inset,#f1f5f9)'};font-size:0.68rem;">${_TP_DAYS[j].slice(0, 2)}<br><b>${u.perDay[j]}</b></span>`).join(' ');

    // Full mode also shows what the person actually wrote — the point of collecting submissions.
    let subs = '';
    if (full) {
      const recs = _tpReports[_tpKey(name)] || {};
      const dates = days.filter(d => d <= today && recs[d]);
      subs = dates.length ? `<details style="margin-top:0.7rem;">
        <summary style="cursor:pointer;font-size:0.75rem;font-weight:700;color:var(--text-secondary,#475569);">📝 Submitted notes (${dates.length})</summary>
        <div style="margin-top:0.5rem;">${dates.map(d => {
          const r = recs[d];
          const part = (l, t) => t ? `<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;color:#0d9488;margin-top:0.35rem;">${l}</div><div style="font-size:0.78rem;white-space:pre-wrap;">${_tpe(t)}</div>` : '';
          return `<div style="border-left:3px solid var(--accent,#0d9488);background:var(--bg-inset,#f8fafc);padding:0.5rem 0.7rem;border-radius:0 7px 7px 0;margin-bottom:0.45rem;">
            <div style="font-size:0.75rem;font-weight:700;">${_tpe(d)}
              ${r.status === 'Reviewed' ? `<span style="font-weight:600;color:#0d9488;">· reviewed by ${_tpe(r.reviewedBy)}</span>` : ''}</div>
            ${part('Highlights', r.highlights) + part('Blockers', r.blockers) + part('Plan', r.plan)
              || '<div style="font-size:0.78rem;color:var(--text-muted,#94a3b8);font-style:italic;">Submitted with no written notes.</div>'}
          </div>`;
        }).join('')}</div></details>` : '';
    }
    const pdfBtn = (full && _tpOpts.withPersonPdf !== false)
      ? `<button class="btn btn-sm btn-secondary no-print" style="margin-left:auto;" onclick="tpPersonPdf('${_tpe(name).replace(/'/g, '&#39;')}')">📄 PDF</button>` : '';

    return `<div class="mfTw-card" style="border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;background:#fff;">
      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
        <strong style="font-size:0.95rem;">${_tpe(name)}</strong>${roleChip}${compChip}
        <span style="font-size:0.75rem;color:var(--text-muted,#64748b);">${u.moves} movement(s) · ${u.calls} call(s) · ${u.emails} email(s)</span>
        ${pdfBtn}
      </div>
      <div style="display:grid;grid-template-columns:minmax(280px,1.1fr) 1fr;gap:1rem;align-items:center;margin-top:0.7rem;">
        <div><canvas id="${_tpPrefix()}${idx}" height="160"></canvas></div>
        <div>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">${chips}</div>
          <div style="margin-top:0.6rem;display:flex;gap:0.25rem;flex-wrap:wrap;">${spark}</div>
        </div>
      </div>
      ${subs}
    </div>`;
  }).join('');

  // Full mode leads with a comparison table — otherwise comparing two people means paging cards.
  const teamTable = full ? `<div style="overflow-x:auto;margin-bottom:1rem;">
    <table class="flow-table"><thead><tr><th>Person</th><th>Role</th><th class="num">Movements</th>
      <th class="num">Calls</th><th class="num">Emails</th><th class="num">Docs</th><th class="num">Reports</th></tr></thead>
    <tbody>${names.map(n => {
      const u = users[n], c = _tpCompliance(n, days, today);
      return `<tr><td>${_tpe(n)}</td><td>${_tpe(_tpRoleOf(n) || '—')}</td>
        <td class="num">${u.moves}</td><td class="num">${u.calls}</td><td class="num">${u.emails}</td>
        <td class="num">${u.docs}</td>
        <td class="num"${c.done < c.of ? ' style="color:#b45309;font-weight:700;"' : ''}>${c.done}/${c.of}</td></tr>`;
    }).join('')}</tbody></table></div>` : '';

  const pct = comp.of ? Math.round((comp.done / comp.of) * 100) : 0;
  body.innerHTML = `<div id="tpSheet" style="background:#fff;">
    <div style="text-align:center;margin-bottom:0.9rem;">
      <div style="font-weight:800;font-size:1.05rem;letter-spacing:0.02em;">H.O ESTUR CORPORATION</div>
      <div style="font-size:0.82rem;color:var(--text-muted,#64748b);">Team Weekly Report · ${_tpe(days[0])} – ${_tpe(days[6])}</div>
    </div>
    <div class="dr-tiles" style="margin-bottom:0.9rem;">
      <div class="dr-tile"><div class="l">Team Members Active</div><div class="v">${names.length}</div></div>
      <div class="dr-tile"><div class="l">Movements</div><div class="v">${tot('moves')}</div></div>
      <div class="dr-tile"><div class="l">Calls</div><div class="v">${tot('calls')}</div></div>
      <div class="dr-tile"><div class="l">Emails</div><div class="v">${tot('emails')}</div></div>
      <div class="dr-tile"><div class="l">Quotations</div><div class="v">${totMod('Quotation')}</div></div>
      <div class="dr-tile"><div class="l">Purchase Requests</div><div class="v">${totMod('Pricing Request')}</div></div>
      <div class="dr-tile"><div class="l">Reports Submitted</div><div class="v"${pct < 100 ? ' style="color:#b45309;"' : ''}>${comp.done}/${comp.of}</div></div>
    </div>
    ${teamTable}
    ${cards}
  </div>`;
  _tpDrawCharts(names);
}

/* ═══════════════════════════════════════════════════════════════════════════
   A156 — the standalone page's comp layout: KPI ribbon, person cards, roll-up table.
   Every figure below is computed from data already on screen; nothing is estimated. The one
   comparison shown is the submission rate vs last week, which costs a single extra
   getDailyReports call. The comp's "avg activities ▲" delta is deliberately NOT reproduced:
   it would need another seven activity fetches, and a made-up number is worse than none.
   ═══════════════════════════════════════════════════════════════════════════ */
const _TP_ROLE_LABEL = { sales: 'Sales', accounting: 'Accounting', admin: 'Admin',
  marketing: 'Marketing', management: 'Management', director: 'Director', hr: 'HR' };

function _tpInitials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}
function _tpSet(id, v) { const el = document.getElementById(id); if (el) el.innerHTML = v; }

function tpRenderFull() {
  const body = document.getElementById(_tpOpts && _tpOpts.mountId);
  if (!body || !_tpData) return;
  const { users, days, today } = _tpData;
  const names = _tpVisibleNames();

  // ── KPI ribbon ────────────────────────────────────────────────────────────
  const comp = names.reduce((a, n) => {
    const c = _tpCompliance(n, days, today);
    a.done += c.done; a.of += c.of; return a;
  }, { done: 0, of: 0 });
  const atRisk = names.filter(n => { const c = _tpCompliance(n, days, today); return c.of && c.done < c.of; }).length;
  const moves = names.reduce((s, n) => s + _tpn(users[n].moves), 0);
  const elapsed = days.filter(d => d <= today).length || 1;
  const pct = comp.of ? Math.round((comp.done / comp.of) * 100) : 0;
  const roles = new Set(names.map(n => _tpRoleOf(n)).filter(Boolean));

  _tpSet('tpKpiRate', pct + '%');
  const delta = document.getElementById('tpKpiRateDelta');
  if (delta) {
    if (_tpPrevRate === null) { delta.textContent = 'vs last week —'; delta.className = 'd'; }
    else {
      const diff = pct - _tpPrevRate;
      delta.textContent = (diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '') + Math.abs(diff) + '% vs last week';
      delta.className = 'd' + (diff > 0 ? ' up' : diff < 0 ? ' down' : '');
    }
  }
  _tpSet('tpKpiPeople', String(names.length));
  _tpSet('tpKpiPeopleSub', 'across ' + roles.size + ' role' + (roles.size === 1 ? '' : 's'));
  _tpSet('tpKpiSubmitted', String(comp.done));
  _tpSet('tpKpiSubmittedSub', 'of ' + comp.of + ' expected');
  _tpSet('tpKpiMissed', String(Math.max(0, comp.of - comp.done)));
  _tpSet('tpKpiMissedSub', atRisk + ' ' + (atRisk === 1 ? 'person' : 'people') + ' at risk');
  _tpSet('tpKpiAvg', (moves / elapsed).toFixed(1));
  _tpSet('tpKpiAvgSub', 'over ' + elapsed + ' day' + (elapsed === 1 ? '' : 's'));
  const meta = document.getElementById('tpSheetMeta');
  if (meta) meta.textContent = `${names.length} ${names.length === 1 ? 'person' : 'people'} · ${roles.size} role${roles.size === 1 ? '' : 's'} · week of ${days[0]} – ${days[6]}`;

  if (!names.length) { body.innerHTML = '<div class="mf-empty dr-empty">No team activity in this week.</div>'; return; }

  // ── Person cards ──────────────────────────────────────────────────────────
  const cards = names.map(name => {
    const u = users[name];
    const c = _tpCompliance(name, days, today);
    const taskDefs = _tpTasksFor(name);
    const counts = _tpCounts(u, taskDefs);
    const good = c.of && c.done >= c.of;
    const bad = c.of && c.done <= c.of / 2;
    const badge = `<span class="badge" style="background:${good ? '#dcfce7' : bad ? '#fee2e2' : '#fef3c7'};color:${good ? '#15803d' : bad ? '#b91c1c' : '#b45309'};">${c.done} / ${c.of}</span>`;
    // The four tiles follow the person's ROLE, so a rep shows PRs/Quotes/Calls/Emails while
    // accounting shows invoices/payments — the same mix the weekly chart uses.
    const stats = taskDefs.slice(0, 4).map((t, j) =>
      `<div class="pstat"><div class="n">${counts[j]}</div><div class="k">${_tpe(t[0])}</div></div>`).join('');
    const recs = _tpReports[_tpKey(name)] || {};
    const dayBoxes = days.map((d, j) => {
      const future = d > today;
      const done = !!recs[d];
      return `<div class="pday"><div class="box" style="background:${future ? '#f1f5f9' : done ? '#dcfce7' : '#fee2e2'};color:${future ? '#94a3b8' : done ? '#15803d' : '#b91c1c'};">${future ? '·' : done ? '✓' : '—'}</div><div class="lab">${_TP_DAYS[j]}</div></div>`;
    }).join('');
    const safe = _tpe(name).replace(/'/g, '&#39;');
    return `<div class="pcard" role="button" tabindex="0" title="Open ${_tpe(name)}'s full week"
        onclick="tpOpenPerson('${safe}')" onkeypress="if(event.key==='Enter')tpOpenPerson('${safe}')">
      <div class="pcard-head"><span class="pav">${_tpe(_tpInitials(name))}</span>
        <div style="flex:1;min-width:0;"><div class="pname">${_tpe(name)}</div>
          <div class="prole">${_tpe(_TP_ROLE_LABEL[_tpRoleOf(name)] || _tpRoleOf(name) || '—')}</div></div>
        ${badge}</div>
      <div class="pstats">${stats}</div>
      <div class="pdays">${dayBoxes}</div>
    </div>`;
  }).join('');

  // ── Roll-up table ─────────────────────────────────────────────────────────
  const rows = names.map(n => {
    const u = users[n], c = _tpCompliance(n, days, today);
    const consistency = c.of ? Math.round((c.done / c.of) * 100) : 0;
    const barColor = consistency >= 80 ? '' : consistency >= 60 ? 'background:#f59e0b;' : 'background:#dc2626;';
    return `<tr><td style="font-weight:700;">${_tpe(n)}</td>
      <td style="color:#8b93a1;">${_tpe(_TP_ROLE_LABEL[_tpRoleOf(n)] || _tpRoleOf(n) || '—')}</td>
      <td class="n"${c.done < c.of ? ' style="color:#b91c1c;font-weight:700;"' : ''}>${c.done} / ${c.of}</td>
      <td class="n">${u.moves}</td><td class="n">${(u.moves / elapsed).toFixed(1)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;"><div class="bar" style="flex:1;"><i style="width:${consistency}%;${barColor}"></i></div>
        <span style="font-weight:700;font-size:11px;color:${consistency >= 60 ? '#8b93a1' : '#b91c1c'};">${consistency}%</span></div></td></tr>`;
  }).join('');

  body.innerHTML = `
    <div class="pgrid">${cards}</div>
    <div style="border:1px solid #e2e6ec;border-radius:14px;overflow:hidden;overflow-x:auto;margin-top:16px;">
      <table class="ptable">
        <thead><tr><th>Person</th><th>Role</th><th class="n">Days Submitted</th><th class="n">Activities</th>
          <th class="n">Avg / Day</th><th>Consistency</th></tr></thead>
        <tbody>${rows}
          <tr class="tot"><td colspan="2">Team Total</td><td class="n">${comp.done} / ${comp.of}</td>
            <td class="n">${moves}</td><td class="n">${(moves / elapsed).toFixed(1)}</td><td>${pct}%</td></tr>
        </tbody>
      </table>
    </div>
    <!-- Charts still render (off-screen) so the per-person and team PDFs keep their graph, and the
         detail window can show it — the comp's card has no room for one. -->
    <div id="tpChartFarm" aria-hidden="true" style="position:absolute;left:-99999px;top:0;width:420px;">
      ${names.map(n => `<canvas id="${_tpPrefix()}${_tpOrder.indexOf(n)}" height="160" width="380"></canvas>`).join('')}
    </div>`;
  _tpDrawCharts(names);
}

/* ── Per-person detail: the full week behind a card ───────────────────────── */
function tpOpenPerson(name) {
  if (!_tpData || !_tpData.users[name]) return;
  const m = _tpPersonModel(name);
  const hide = !!_tpOpts.hideAmounts;
  const chart = _tpChartImg[name]
    ? `<img src="${_tpChartImg[name]}" alt="" style="width:100%;max-width:420px;border:1px solid #eef1f5;border-radius:10px;">`
    : '<div class="mf-empty">Chart unavailable — the counts below carry the same data.</div>';

  const tiles = [['Movements', m.totals.moves], ['Calls', m.totals.calls], ['Emails', m.totals.emails],
    ['Documents', m.totals.docs], ['PDFs', m.totals.pdfs],
    ['Reports', m.totals.submitted + ' / ' + m.totals.reportableDays]]
    .concat(hide ? [] : [[m.totals.amountLabel, flowMoney(m.totals.amount, 'PHP')]])
    .map(([k, v]) => `<div class="pstat"><div class="n">${_tpe(v)}</div><div class="k">${_tpe(k)}</div></div>`).join('');

  const taskRows = m.tasks.map(([l, v]) => `<tr><td>${_tpe(l)}</td><td class="n">${v}</td></tr>`).join('');
  const dayRows = m.days.map(d => `<tr><td>${_tpe(d.dayName)}</td><td>${_tpe(d.date)}</td>
    <td class="n">${d.future ? '—' : d.moves}</td><td class="n">${d.future ? '—' : d.calls}</td>
    <td>${d.future ? '<span style="color:#94a3b8;">upcoming</span>'
      : d.submitted ? '<span style="color:#15803d;font-weight:700;">✓ submitted</span>'
                    : '<span style="color:#b91c1c;font-weight:700;">— missed</span>'}</td></tr>`).join('');

  const part = (l, t) => t ? `<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;color:#4f46e5;margin-top:0.4rem;">${l}</div><div style="font-size:0.82rem;white-space:pre-wrap;">${_tpe(t)}</div>` : '';
  const subs = (m.submissions || []).length
    ? m.submissions.map(r => `<div style="border-left:3px solid #4f46e5;background:#f8fafc;padding:0.55rem 0.75rem;border-radius:0 8px 8px 0;margin-bottom:0.5rem;">
        <div style="font-size:0.78rem;font-weight:700;">${_tpe(r.date)}
          ${r.status === 'Reviewed' ? `<span style="font-weight:600;color:#0d9488;"> · reviewed by ${_tpe(r.reviewedBy)}</span>` : ''}</div>
        ${part('Highlights', r.highlights) + part('Blockers', r.blockers) + part('Plan', r.plan)
          || '<div style="font-size:0.8rem;color:#94a3b8;font-style:italic;">Submitted with no written notes.</div>'}
      </div>`).join('')
    : '<div class="mf-empty">No daily reports submitted this week.</div>';

  const safe = _tpe(name).replace(/'/g, '&#39;');
  const ov = document.getElementById('tpPersonOverlay');
  const bd = document.getElementById('tpPersonBody');
  const ti = document.getElementById('tpPersonTitle');
  if (!ov || !bd) return;
  if (ti) ti.textContent = `${name} · ${m.weekStart} – ${m.weekEnd}`;
  bd.innerHTML = `
    <div class="pstats" style="border-radius:12px;overflow:hidden;">${tiles}</div>
    <div class="tp-detail-grid">
      <div>${chart}</div>
      <div style="overflow-x:auto;"><table class="ptable"><thead><tr><th>Task</th><th class="n">This week</th></tr></thead>
        <tbody>${taskRows}</tbody></table></div>
    </div>
    <h4 class="tp-detail-h">Day by day</h4>
    <div style="overflow-x:auto;"><table class="ptable"><thead><tr><th>Day</th><th>Date</th><th class="n">Activities</th><th class="n">Calls</th><th>Daily report</th></tr></thead>
      <tbody>${dayRows}</tbody></table></div>
    <h4 class="tp-detail-h">What they reported</h4>
    ${subs}
    <div style="margin-top:1rem;display:flex;gap:0.5rem;">
      <button class="btn btn-sm btn-secondary no-print" onclick="tpPersonPdf('${safe}')">📄 Weekly PDF</button>
      <button class="btn btn-sm btn-secondary no-print" onclick="tpClosePerson()">Close</button>
    </div>`;
  ov.classList.add('open');
}
function tpClosePerson() {
  const ov = document.getElementById('tpPersonOverlay');
  if (ov) ov.classList.remove('open');
}

async function _tpDrawCharts(names) {
  try {
    if (typeof loadLib === 'function') await loadLib('https://cdn.jsdelivr.net/npm/chart.js');
    if (typeof Chart === 'undefined') return;
    _tpCharts.forEach(c => { try { c.destroy(); } catch (e) {} });
    _tpCharts = [];
    names.forEach((name) => {
      const idx = _tpOrder.indexOf(name);
      const cv = document.getElementById(_tpPrefix() + idx);
      if (!cv) return;
      const tasks = _tpTasksFor(name);
      _tpCharts.push(new Chart(cv.getContext('2d'), {
        type: 'bar',
        data: { labels: tasks.map(t => t[0]),
                datasets: [{ data: _tpCounts(_tpData.users[name], tasks), backgroundColor: '#0d9488' }] },
        options: { animation: false, responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { font: { size: 9 } } } } }
      }));
      // Capture BY NAME so a PDF can never pair one person with another's chart.
      requestAnimationFrame(() => { try { _tpChartImg[name] = cv.toDataURL('image/png'); } catch (e) {} });
    });
  } catch (e) { /* charts are decorative — the count chips already carry the data */ }
}

/* ── PDF models ──────────────────────────────────────────────────────────── */
function _tpPersonModel(name) {
  const { users, days, today } = _tpData;
  const u = users[name];
  const tasks = _tpTasksFor(name);
  const counts = _tpCounts(u, tasks);
  const c = _tpCompliance(name, days, today);
  const recs = _tpReports[_tpKey(name)] || {};
  return {
    name, role: _tpRoleOf(name), weekStart: days[0], weekEnd: days[6], generatedAt: flowToday(),
    hideAmounts: !!_tpOpts.hideAmounts,
    totals: { moves: u.moves, calls: u.calls, emails: u.emails, docs: u.docs, pdfs: u.pdfs,
      amount: u.amount, amountLabel: 'Invoiced', submitted: c.done, reportableDays: c.of },
    tasks: tasks.map((t, j) => [t[0], counts[j]]),
    chartImg: _tpChartImg[name] || '',
    days: days.map((d, j) => ({ date: d, dayName: _TP_DAYS[j], moves: u.perDay[j],
      calls: u.perDayCalls[j], emails: 0, submitted: !!recs[d], future: d > today })),
    submissions: Object.keys(recs).map(k => recs[k]),
  };
}

/** One person's week — what HR and management hand to a person or file for a review. */
function tpPersonPdf(name) {
  if (!_tpData || !_tpData.users[name] || typeof flowReportPdf !== 'function') return;
  const d = _tpData;
  flowReportPdf({
    html: flowPersonWeekHtml(_tpPersonModel(name)), scale: 3,
    filename: `Weekly_Performance_${String(name).replace(/[^A-Za-z0-9]+/g, '_')}_${d.days[0]}_${d.days[6]}.pdf`,
  }).catch(err => alert('PDF failed: ' + err.message));
}

/** The whole team's week — comparison table first, then one person per page. */
function tpTeamPdf() {
  if (!_tpData || typeof flowReportPdf !== 'function') return;
  const { users, days, today } = _tpData;
  const names = _tpOrder.filter(n => users[n]);
  const people = names.map(_tpPersonModel);
  const org = people.reduce((a, p) => {
    a.moves += p.totals.moves; a.calls += p.totals.calls; a.emails += p.totals.emails;
    a.docs += p.totals.docs; a.submitted += p.totals.submitted; a.reportableDays += p.totals.reportableDays;
    return a;
  }, { moves: 0, calls: 0, emails: 0, docs: 0, submitted: 0, reportableDays: 0 });
  const btn = document.getElementById(_tpOpts.pdfBtnId);
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Rendering…'; }
  flowReportPdf({
    html: flowTeamWeekHtml({ weekStart: days[0], weekEnd: days[6], generatedAt: flowToday(),
      hideAmounts: !!_tpOpts.hideAmounts, orgTotals: org, people }),
    scale: 2, quality: 0.92,            // N chart images at scale 3 is a memory risk on modest laptops
    filename: `Team_Weekly_Report_${days[0]}_${days[6]}.pdf`,
  }).catch(err => alert('PDF failed: ' + err.message))
    .then(() => { if (btn) { btn.disabled = false; btn.textContent = label; } });
}
