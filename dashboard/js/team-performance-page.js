/* ═══════════════════════════════════════════════
   team-performance-page.js — the standalone Team Performance page.
   A thin mount over the shared team-performance module: management/director/admin see the full
   view; HR sees the same people-performance data with money hidden.
   ═══════════════════════════════════════════════ */

let tpPageSession = null;

document.addEventListener('DOMContentLoaded', () => {
  tpPageSession = requirePerformanceAccess();      // hr | management | director | admin
  if (!tpPageSession) return;
  renderNavbar('team-performance');

  const isHR = tpPageSession.role === 'hr';
  document.getElementById('tpMeta').textContent =
    `Weekly performance per person · ${isHR ? 'activity and reporting only' : 'all recorded activity'} · viewing as ${tpPageSession.name}`;

  const mount = () => initTeamPerformance({
    mountId: 'tpBody', rangeId: 'tpRange', nextBtnId: 'tpNextBtn',
    resetBtnId: 'tpResetBtn', pdfBtnId: 'tpPdfBtn',
    baseDate: () => flowToday(),
    mode: 'full', withEmails: true, withSubmissions: true, withPersonPdf: true,
    hideAmounts: isHR,          // HR gets people performance, not the company's money
  });

  document.getElementById('tpRefresh').addEventListener('click', mount);
  document.getElementById('tpPrint').addEventListener('click', () => window.print());
  document.getElementById('tpPdfBtn').addEventListener('click', () => tpTeamPdf());
  // Filters re-render from cached data — no refetch.
  document.getElementById('tpRoleFilter').addEventListener('change', () => tpRender());
  document.getElementById('tpSearch').addEventListener('input', () => tpRender());

  mount();
  // Deliberately no auto-poll: all-daily-reports.html already fans IMAP out to every user every
  // 180s, and a second polling page risks GoDaddy's per-IP throttling. Refresh is manual.
});
