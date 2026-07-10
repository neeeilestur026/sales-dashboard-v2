/* ═══════════════════════════════════════════════
   report-week.js — shared "This Week" section for the daily reports
   (sales / accounting / admin). Aggregates the user's flow activity and
   sent emails for the Mon–Sun week containing the selected date.

   Usage: initReportWeek({ user, date: 'yyyy-MM-dd', mountId: 'weekSect' })
   Re-call on date change; a sequence token drops stale async renders.
   Requires flow-api.js (fetchFlow, flowToday) and api.js (apiFetchEmailLogToday).
   ═══════════════════════════════════════════════ */

let _rwSeq = 0;

function _rwEsc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

/** The 7 yyyy-MM-dd dates of the Mon–Sun week containing dateStr. */
function _rwWeekDates(dateStr) {
  const d = new Date((dateStr || '') + 'T00:00:00');
  if (isNaN(d)) return [];
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // Mon=0 … Sun=6
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}

async function initReportWeek(opts) {
  const { user, date, mountId } = opts || {};
  const mount = document.getElementById(mountId || 'weekSect');
  if (!mount || !user || !date) return;
  const seq = ++_rwSeq;
  const days = _rwWeekDates(date);
  if (!days.length) return;
  const today = (typeof flowToday === 'function') ? flowToday() : date;

  mount.innerHTML = `<div class="dr-sect">
    <div class="dr-sect-title">📅 This Week (${_rwEsc(days[0])} – ${_rwEsc(days[6])})</div>
    <div class="dr-empty">Loading weekly summary…</div></div>`;

  // Activity ×7 in parallel (the flow read-cache absorbs repeats); skip future days.
  const actPromises = days.map(d => (d > today)
    ? Promise.resolve([])
    : fetchFlow('getActivityLog', { date: d, user })
        .then(r => ((r && r.data) || []).filter(e => e.module !== 'Call'))
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

  const [acts] = await Promise.all([Promise.all(actPromises), fetchEmails()]);
  if (seq !== _rwSeq) return;

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const totalMoves = acts.reduce((s, a) => s + a.length, 0);
  const totalEmails = emailCounts.reduce((s, n) => s + n, 0);
  const byMod = {};
  acts.forEach(a => a.forEach(e => { byMod[e.module] = (byMod[e.module] || 0) + 1; }));
  const top = Object.entries(byMod).sort((a, b) => b[1] - a[1])[0];

  const rows = days.map((d, i) => {
    const isSel = d === date, isToday = d === today, isFuture = d > today;
    return `<tr style="${isSel ? 'background:var(--accent-light,#e6f4f1);font-weight:600;' : ''}">
      <td>${dayNames[i]}${isToday ? ' <span class="act-chip">today</span>' : ''}</td>
      <td>${_rwEsc(d)}</td>
      <td class="num">${isFuture ? '—' : acts[i].length}</td>
      <td class="num">${isFuture ? '—' : emailCounts[i]}</td>
    </tr>`;
  }).join('');

  mount.innerHTML = `<div class="dr-sect">
    <div class="dr-sect-title">📅 This Week (${_rwEsc(days[0])} – ${_rwEsc(days[6])})</div>
    <div class="dr-summary" style="margin-bottom:0.9rem;">
      <div class="dr-tile"><div class="l">Movements This Week</div><div class="v">${totalMoves}</div></div>
      <div class="dr-tile"><div class="l">Emails Sent This Week</div><div class="v">${totalEmails}</div></div>
      <div class="dr-tile"><div class="l">Most Active Module</div><div class="v" style="font-size:1rem;">${top ? _rwEsc(top[0]) + ' (' + top[1] + ')' : '—'}</div></div>
    </div>
    <div style="overflow-x:auto;"><table class="flow-table">
      <thead><tr><th>Day</th><th>Date</th><th class="num">Movements</th><th class="num">Emails Sent</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
