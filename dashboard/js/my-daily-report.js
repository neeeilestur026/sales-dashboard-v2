/* my-daily-report.js — A363 · the new daily report on each person's own page (my-daily-report.html).
 *
 * Neil, 22 Oct 2026: "put the daily report on each of the dashboard user, but put it as a new daily report … dont change
 * the old daily report yet". A rep gets the Sales Daily Report (js/sales-report.js), accounting, lead gen and admin their
 * role's report (js/team-report.js) — each the person's own day, saved under their name. FlowAPI 184 is what lets them
 * save and read their own report (and nobody else's); until it is pasted the page says so and shows no form. */
const MDR_KIND = { sales: 'sales', accounting: 'accounting', leadgen: 'leadgen', admin: 'admin' };
const MDR_OLD = { sales: 'report.html', accounting: 'accounting-daily-report.html', leadgen: 'leadgen-daily-report.html', admin: 'admin-daily-report.html' };

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireNewDailyReportAccess === 'function' ? requireNewDailyReportAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('my-daily-report');
  const kind = MDR_KIND[String(s.role || '').toLowerCase()];
  const old = document.getElementById('mdrOld'), note = document.getElementById('mdrNotice');
  if (old && MDR_OLD[kind]) { old.href = MDR_OLD[kind]; old.hidden = false; }
  const ready = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(184).catch(() => false) : false;
  if (!ready) {
    note.innerHTML = '<div class="dh-banner warn">Your new daily report opens with the next FlowAPI update (version 184). Your old daily report works as before meanwhile.</div>';
    return;
  }
  if (kind === 'sales') {
    document.getElementById('proof').hidden = false;
    await salesReport('proof', { own: true });
  } else {
    document.getElementById('myReport').hidden = false;
    await teamReport('myReport', kind, { own: true });
  }
});
