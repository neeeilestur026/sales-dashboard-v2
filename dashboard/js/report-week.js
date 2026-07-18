/* ═══════════════════════════════════════════════
   report-week.js — shared "This Week" section for the daily reports
   (sales / accounting / admin). Aggregates the user's flow activity,
   sent emails, and (sales) call log for a Mon–Sun week, with ◀ ▶
   navigation to browse other weeks.

   Usage: initReportWeek({ user, date: 'yyyy-MM-dd', mountId: 'weekSect',
                           modules: ['Quotation', …],   // role-relevant count tiles
                           withCalls: true })           // sales call log
   Re-call on date change (resets to the week of that date); a sequence
   token drops stale async renders. Requires flow-api.js (fetchFlow,
   flowToday) and api.js (apiFetchEmailLogToday).
   ═══════════════════════════════════════════════ */

let _rwSeq = 0;
let _rwOpts = null;      // last init opts — week navigation re-renders with these
let _rwOffset = 0;       // weeks relative to the week of the picked date (0 = that week)

function _rwEsc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

/** The 7 yyyy-MM-dd dates of the Mon–Sun week containing dateStr, shifted by offset weeks. */
function _rwWeekDates(dateStr, offset) {
  const d = new Date((dateStr || '') + 'T00:00:00');
  if (isNaN(d)) return [];
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (offset || 0) * 7);   // Mon=0 … Sun=6
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/** ◀ ▶ / reset navigation — re-renders the mounted week section for another week. */
function rwNavWeek(delta) {
  if (!_rwOpts) return;
  _rwOffset = delta === 0 ? 0 : _rwOffset + delta;
  _rwRender();
}

async function initReportWeek(opts) {
  _rwOpts = opts || {};
  _rwOffset = 0;                                   // a new date pick resets to that date's week
  return _rwRender();
}

async function _rwRender() {
  const { user, date, mountId, modules, withCalls } = _rwOpts || {};
  const mount = document.getElementById(mountId || 'weekSect');
  if (!mount || !user || !date) return;
  const seq = ++_rwSeq;
  const days = _rwWeekDates(date, _rwOffset);
  if (!days.length) return;
  const today = (typeof flowToday === 'function') ? flowToday() : date;
  const modList = Array.isArray(modules) ? modules : [];

  // Nav header: ◀ previous week · range · next ▶ (capped at the current week) · reset.
  const nextStart = _rwWeekDates(date, _rwOffset + 1)[0];
  const canNext = nextStart <= today;
  const navHtml = `
    <span style="display:inline-flex;gap:0.35rem;align-items:center;margin-left:auto;font-weight:400;">
      <button class="btn btn-sm btn-secondary" onclick="rwNavWeek(-1)" title="Previous week">◀</button>
      ${_rwOffset !== 0 ? `<button class="btn btn-sm btn-secondary" onclick="rwNavWeek(0)" title="Back to the selected date's week">↺</button>` : ''}
      <button class="btn btn-sm btn-secondary" onclick="rwNavWeek(1)" title="Next week" ${canNext ? '' : 'disabled'}>▶</button>
    </span>`;
  const titleHtml = `<div class="dr-sect-title" style="display:flex;align-items:center;gap:0.6rem;">
    📅 Week ${_rwEsc(days[0])} – ${_rwEsc(days[6])}${_rwOffset !== 0 ? ` <span class="act-chip">${_rwOffset < 0 ? _rwOffset : '+' + _rwOffset} wk</span>` : ''}${navHtml}</div>`;

  mount.innerHTML = `<div class="dr-sect">${titleHtml}<div class="dr-empty">Loading weekly summary…</div></div>`;

  // Activity ×7 in parallel (the flow read-cache absorbs repeats); skip future days.
  const actPromises = days.map(d => (d > today)
    ? Promise.resolve([])
    : fetchFlow('getActivityLog', { date: d, user })
        .then(r => ((r && r.data) || []).filter(e => e.module !== 'Call'))
        .catch(() => []));

  // Calls ×7 (sales only) — same pattern.
  const callPromises = days.map(d => (!withCalls || d > today)
    ? Promise.resolve([])
    : fetchFlow('getSalesCalls', { date: d, user })
        .then(r => (r && r.data) || [])
        .catch(() => []));

  // Emails ×7 — batched (3 at a time) so a cold week never hammers the mailbox; server
  // caches past days for an hour. Future days are skipped.
  const emailCounts = new Array(7).fill(0);
  const emailJobs = days.map((d, i) => ({ d, i })).filter(x => x.d <= today);
  async function fetchEmails() {
    if (typeof apiFetchEmailLogToday !== 'function') return;
    for (let i = 0; i < emailJobs.length; i += 3) {
      await Promise.all(emailJobs.slice(i, i + 3).map(async job => {
        try {
          const r = await apiFetchEmailLogToday(undefined, job.d);
          const emails = (r && r.success && r.emails) || [];
          emailCounts[job.i] = Array.isArray(emails) ? emails.length : 0;
        } catch (e) { /* leave 0 */ }
      }));
      if (seq !== _rwSeq) return;                       // superseded by a newer date pick
    }
  }

  const [acts, calls] = await Promise.all([Promise.all(actPromises), Promise.all(callPromises), fetchEmails()]);
  if (seq !== _rwSeq) return;

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const totalMoves = acts.reduce((s, a) => s + a.length, 0);
  const totalEmails = emailCounts.reduce((s, n) => s + n, 0);
  const totalCalls = calls.reduce((s, c) => s + c.length, 0);
  const byMod = {};
  acts.forEach(a => a.forEach(e => { byMod[e.module] = (byMod[e.module] || 0) + 1; }));
  const top = Object.entries(byMod).sort((a, b) => b[1] - a[1])[0];

  // Role-relevant weekly count tiles: Movements · [Calls] · Emails · one per opts.modules entry.
  const tiles = [
    `<div class="dr-tile"><div class="l">Movements This Week</div><div class="v">${totalMoves}</div></div>`,
    withCalls ? `<div class="dr-tile"><div class="l">Calls Made</div><div class="v">${totalCalls}</div></div>` : '',
    `<div class="dr-tile"><div class="l">Emails Sent</div><div class="v">${totalEmails}</div></div>`,
    ...modList.map(m =>
      `<div class="dr-tile"><div class="l">${_rwEsc(/y$|s$|ing$/.test(m) ? m : m + 's')}</div><div class="v">${byMod[m] || 0}</div></div>`),
    `<div class="dr-tile"><div class="l">Most Active Module</div><div class="v" style="font-size:1rem;">${top ? _rwEsc(top[0]) + ' (' + top[1] + ')' : '—'}</div></div>`,
  ].join('');

  // Per-day rows: movements · [calls] · emails · a compact module-mix chip line.
  const rows = days.map((d, i) => {
    const isSel = d === date && _rwOffset === 0, isToday = d === today, isFuture = d > today;
    const dayMods = {};
    acts[i].forEach(e => { dayMods[e.module] = (dayMods[e.module] || 0) + 1; });
    const mix = Object.entries(dayMods).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([m, n]) => `${_rwEsc(m)} ×${n}`).join(' · ');
    return `<tr style="${isSel ? 'background:var(--accent-light,#e6f4f1);font-weight:600;' : ''}">
      <td>${dayNames[i]}${isToday ? ' <span class="act-chip">today</span>' : ''}</td>
      <td>${_rwEsc(d)}</td>
      <td class="num">${isFuture ? '—' : acts[i].length}</td>
      ${withCalls ? `<td class="num">${isFuture ? '—' : calls[i].length}</td>` : ''}
      <td class="num">${isFuture ? '—' : emailCounts[i]}</td>
      <td style="font-size:0.72rem;color:var(--text-muted,#64748b);">${isFuture ? '' : (mix || '—')}</td>
    </tr>`;
  }).join('');

  mount.innerHTML = `<div class="dr-sect">${titleHtml}
    <div class="dr-summary" style="margin-bottom:0.9rem;">${tiles}</div>
    <div style="overflow-x:auto;"><table class="flow-table">
      <thead><tr><th>Day</th><th>Date</th><th class="num">Movements</th>${withCalls ? '<th class="num">Calls</th>' : ''}<th class="num">Emails Sent</th><th>Top Tasks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
