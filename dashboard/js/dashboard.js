/* ═══════════════════════════════════════════════
   dashboard.js — Home hub logic
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireSales();
  if (!session) return;

  // Always show fresh stats on page load
  clearApiCache();

  // Render navbar and greeting
  renderNavbar('dashboard');
  document.getElementById('greeting').innerHTML = getGreeting(session.name);

  // ─── App URLs (relative paths on same Render domain) ─────
  // The legacy /quotation generator is intentionally NOT linked here: it renders the pre-redesign
  // layout and writes to its own sheet, so a quotation made there never reaches the process flow.
  // Sales create quotations at flow-quotations.html, which produces the current design.
  const APP_URLS = {
    pr: '/pr'
  };

  // Set app links — use relative paths (tools are Flask blueprints on same server)
  setAppLink('prLink', APP_URLS.pr);

  // Fetch stats
  const sheetIds = {
    quotationSheetId: session.quotationSheetId,
    prSheetId: session.prSheetId,
    poSheetId: ''
  };

  // Fetch today's stats and month's stats in parallel
  try {
    const [todayStats, monthStats] = await Promise.all([
      apiGetStats(session.name, sheetIds, 'today'),
      apiGetStats(session.name, sheetIds, 'month')
    ]);

    // Today stats
    if (todayStats && todayStats.success) {
      document.getElementById('prToday').textContent = todayStats.prs || 0;
      document.getElementById('quotationToday').textContent = todayStats.quotations || 0;
    }

    // Month stats
    if (monthStats && monthStats.success) {
      document.getElementById('monthQuotations').textContent = monthStats.quotations || 0;
      document.getElementById('monthPRs').textContent = monthStats.prs || 0;
    }
  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
    document.getElementById('prToday').textContent = '—';
    document.getElementById('quotationToday').textContent = '—';
  }

  // A407 — the report tag in the slab says where today's daily report (my-daily-report.html) stands; the one read of
  // it is js/new-daily-report-card.js, which writes #reportStatus. The old report.html is retired.

  // Load client count
  try {
    const clientResult = await apiGetClientCount(session.name);
    if (clientResult.success) {
      document.getElementById('clientCount').textContent = clientResult.count || 0;
    }
  } catch (e) {
    const el = document.getElementById('clientCount');
    if (el) el.textContent = '—';
  }

  // Load target progress
  try {
    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const targetResult = await apiGetTargets(currentMonth, session.name);

    if (targetResult.success && targetResult.data && targetResult.data.length > 0) {
      const t = targetResult.data[0];
      const monthQ = parseInt(document.getElementById('monthQuotations').textContent) || 0;
      const monthP = parseInt(document.getElementById('monthPRs').textContent) || 0;

      const bars = [];
      if (t.quotationTarget > 0) {
        bars.push(makeProgressBar('Quotations', monthQ, t.quotationTarget, 'q'));
      }
      if (t.prTarget > 0) {
        bars.push(makeProgressBar('Purchase requests', monthP, t.prTarget, 'p'));
      }

      if (bars.length > 0) {
        document.getElementById('targetBars').innerHTML = bars.join('');
        document.getElementById('targetSection').style.display = 'block';
      }
    }
  } catch (e) {
    // Target not set — no progress bars shown
  }
  // A407 — the old "Overdue follow-ups" card read the per-rep quotation sheet nothing writes any more; the follow-up
  // guide card (js/follow-up-guide-card.js) is the one follow-up list.
});

/**
 * Set an app launcher link or disable if no URL
 */
function setAppLink(elementId, url) {
  const el = document.getElementById(elementId);
  if (!el) return;

  if (url && url !== 'undefined' && url !== '') {
    el.href = url;
  } else {
    el.removeAttribute('href');
    el.classList.add('off');   // css/sales-home.css: dimmed, not clickable
    el.textContent = 'Not configured';
  }
}

/**
 * One target bar. `tone` is a class the page sheet paints: 'q' quotations (navy), 'p' purchase
 * requests (cyan). The only inline style is the width, which IS the data. The "(NN%)" text is
 * what sales-home-page.js reads to draw the ring, so its shape stays.
 */
function makeProgressBar(label, current, target, tone) {
  const pct = Math.min(Math.round((current / target) * 100), 100);
  return `<div class="progress-row">
    <div class="progress-label">
      <span>${label}</span>
      <strong>${current} / ${target} (${pct}%)</strong>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill ${tone}" style="width:${pct}%"></div>
    </div>
  </div>`;
}
