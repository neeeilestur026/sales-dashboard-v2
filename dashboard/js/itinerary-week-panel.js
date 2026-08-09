/* A216 — this week's field plans, as a panel on a home page.
 *
 * The director is the FIRST approver of a weekly itinerary (_ITIN_STAGES, FlowAPI.gs:5743), so their
 * home is where a plan waiting on them should appear — and, just as importantly, where a rep who
 * went out with no plan at all should. The approvals queue below can only ever show what was
 * submitted; it is structurally incapable of showing the rep who submitted nothing, which on the one
 * live week is half the sales team.
 *
 * Same engine as management-itinerary.html (itinerary-week.js), so the panel and the page can never
 * disagree about who is behind — the A208 lesson, where three copies of one KPI differed by eight
 * million pesos on a single screen.
 *
 * Read-only. Every decision still happens on the full page or the approvals queue.
 */

async function itineraryWeekPanel(containerId) {
  const el = document.getElementById(containerId || 'iwpPanel');
  if (!el || typeof itineraryWeek !== 'function') return;

  el.innerHTML = '<div class="iwp-empty">Reading this week\'s plans…</div>';
  const week = flowWeekDates(flowToday(), 0);
  const today = flowToday();
  const role = String((getSession() || {}).role || '').toLowerCase();

  let model;
  try {
    const [itins, visitPacks, roster] = await Promise.all([
      fetchFlow('getWeeklyItineraries', {}).then(r => (r && r.data) || []),
      Promise.all(week.map(d => d > today ? Promise.resolve([])
        : fetchFlow('getClientVisits', { date: d }).then(r => (r && r.data) || []).catch(() => []))),
      (typeof apiGetUsers === 'function'
        ? apiGetUsers().then(r => (r && r.data) || []).catch(() => []) : Promise.resolve([]))
    ]);
    model = itineraryWeek(week, itins, visitPacks.reduce((a, b) => a.concat(b), []), roster,
                          { viewerRole: role });
  } catch (e) {
    el.innerHTML = '<div class="iwp-empty">Could not read the itineraries — ' + flowEsc(e.message) + '</div>';
    return;
  }

  const t = model.totals;
  const link = '<a class="iwp-go" href="management-itinerary.html">Open the week →</a>';

  if (!model.reps.length) {
    el.innerHTML = '<div class="iwp-empty">Nobody is in the field this week.</div>' + link;
    return;
  }

  const alerts = [];
  if (t.needsYou) alerts.push(`<div class="iwp-alert warn"><b>${t.needsYou} plan${t.needsYou === 1 ? '' : 's'}
    need${t.needsYou === 1 ? 's' : ''} your approval.</b></div>`);
  if (t.noPlanButVisited) alerts.push(`<div class="iwp-alert bad"><b>${t.noPlanButVisited}
    rep${t.noPlanButVisited === 1 ? '' : 's'} went out with no approved plan.</b></div>`);

  el.innerHTML =
    `<div class="iwp-head">${flowEsc(model.weekStart)} – ${flowEsc(model.weekEnd)} ·
       <b>${t.plansFiled} of ${t.reps}</b> filed · ${t.planned} planned stop${t.planned === 1 ? '' : 's'} ·
       ${t.logged} visit${t.logged === 1 ? '' : 's'} logged</div>` +
    alerts.join('') +
    model.reps.map(r => {
      const c = r.counts;
      const line = r.itinerary ? `${c.planned} planned · ${c.logged} logged`
                 : (c.logged ? `${c.logged} visit${c.logged === 1 ? '' : 's'} against no plan`
                             : 'nothing this week');
      return `<div class="iwp-row">
          <span class="dot d-${r.bucket}"></span>
          <span class="who">${flowEsc(r.rep)}</span>
          <span class="st b-${r.bucket}">${flowEsc(IWP_LABEL[r.bucket])}</span>
          <span class="n">${flowEsc(line)}</span>
        </div>`;
    }).join('') +
    `<div class="iwp-foot">${link}</div>`;
}

const IWP_LABEL = { 'needs-you': 'Waiting on you', 'no-plan': 'No plan filed', 'pending': 'Under review',
                    'draft': 'Draft', 'rejected': 'Sent back', 'approved': 'Approved', 'idle': 'Nothing filed' };

/** The styles travel with the module, so a page adopts the panel with one div and one script rather
 *  than a block of CSS it then has to keep in step. */
(function iwpStyle() {
  if (typeof document === 'undefined' || document.getElementById('iwpCss')) return;
  const s = document.createElement('style');
  s.id = 'iwpCss';
  s.textContent = `
    .iwp-head { font-size:.82rem; color:var(--text-secondary,#475569); margin-bottom:.5rem; }
    .iwp-empty { padding:.7rem 0; color:var(--text-muted,#64748b); font-size:.85rem; }
    .iwp-alert { padding:.4rem .65rem; border-radius:9px; font-size:.78rem; line-height:1.5;
      border-left:3px solid; margin-bottom:.4rem; }
    .iwp-alert.warn { background:#fffbeb; border-color:#f59e0b; color:#92400e; }
    .iwp-alert.bad  { background:#fef2f2; border-color:#ef4444; color:#991b1b; }
    .iwp-row { display:flex; align-items:baseline; gap:.5rem; padding:.26rem 0;
      border-top:1px solid var(--border,#e2e8f0); font-size:.8rem; }
    .iwp-row:first-of-type { border-top:0; }
    .iwp-row .dot { width:7px; height:7px; border-radius:50%; flex:none; align-self:center; }
    .iwp-row .who { font-weight:700; color:var(--text-primary,#0f172a); min-width:132px; }
    .iwp-row .st { font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
    .iwp-row .n { margin-left:auto; color:var(--text-muted,#64748b); font-variant-numeric:tabular-nums; }
    /* Same colour per state as the full page, so one state never looks like two things. */
    .iwp-row .b-needs-you,.iwp-row .b-no-plan,.iwp-row .b-pending,.iwp-row .b-draft,
    .iwp-row .b-rejected,.iwp-row .b-approved,.iwp-row .b-idle { white-space:nowrap; }
    .b-needs-you { color:#b45309; } .d-needs-you { background:#f59e0b; }
    .b-no-plan   { color:#b91c1c; } .d-no-plan   { background:#ef4444; }
    .b-pending   { color:#4f46e5; } .d-pending   { background:#6366f1; }
    .b-draft     { color:#64748b; } .d-draft     { background:#94a3b8; }
    .b-rejected  { color:#b91c1c; } .d-rejected  { background:#ef4444; }
    .b-approved  { color:#047857; } .d-approved  { background:#10b981; }
    .b-idle      { color:#94a3b8; } .d-idle      { background:#cbd5e1; }
    .iwp-foot { margin-top:.5rem; font-size:.8rem; }
    .iwp-go { color:var(--accent-dark,#0f766e); font-weight:600; text-decoration:none; }
    @media (max-width:760px) {
      .iwp-row { flex-wrap:wrap; }
      .iwp-row .n { margin-left:0; width:100%; }
    }`;
  document.head.appendChild(s);
})();
