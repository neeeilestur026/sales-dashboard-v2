/* new-daily-report-card.js — A363 · the "New daily report" card on the sales, accounting, lead gen and admin homes.
 * ID-DRIVEN like my-payslip-card.js: does nothing unless #newDailyReport is on the page. One read (getProofReports for
 * today — the server returns only the person's own report) says where today stands: not started, saved, or the 4:30
 * report submitted. Hidden before FlowAPI 184 (until then the report cannot be saved). The old daily report is untouched. */
(function () {
  const CARD = 'newDailyReport';
  const KIND = { sales: 'sales', accounting: 'accounting', leadgen: 'leadgen', admin: 'admin' };
  const esc = (v) => (typeof flowEsc === 'function' ? flowEsc(v) : String(v == null ? '' : v));
  const clock = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }); };
  const nowMin = () => { const d = new Date(); return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes(); };   // Manila, UTC+8

  function render(el, row) {
    const late = nowMin() >= 16 * 60 + 30;
    const status = !row ? '<span>Not started today — the portal has already counted your records.</span>'
      : row.submittedAt ? '<span class="ok">4:30 report submitted ' + esc(clock(row.submittedAt)) + '</span>'
      : '<span class="' + (late ? 'due' : '') + '">Saved ' + esc(clock(row.updatedAt)) + ' — 4:30 report ' + (late ? 'due now' : 'due at 4:30') + '</span>';
    el.style.display = '';
    el.innerHTML = '<div class="hx-ndr-row"><div class="hx-ndr-t"><b>New daily report</b>' + status + '</div>' +
      '<a class="btn btn-sm ' + (row && row.submittedAt ? 'btn-secondary' : 'btn-primary') + '" href="my-daily-report.html">' + (row ? 'Open' : 'Start today') + '</a></div>';
  }

  async function load(el, kind) {
    try {
      if (typeof flowVersionAtLeast === 'function' && !(await flowVersionAtLeast(184))) return;
      const today = typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10);
      const r = await postFlow('getProofReports', { kind, from: today, to: today });
      if (!r || !r.success) return;
      render(el, (r.data || []).find(x => x && x.date === today) || null);
    } catch (e) { el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function') return;
    const s = getSession(), kind = s && KIND[String(s.role || '').toLowerCase()];
    if (!kind) return;
    load(el, kind);
  });
})();
