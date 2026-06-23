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
  const APP_URLS = {
    quotation: '/quotation',
    pr:        '/pr'
  };

  // Set app links — use relative paths (tools are Flask blueprints on same server)
  setAppLink('prLink',        APP_URLS.pr);
  setAppLink('quotationLink', APP_URLS.quotation);

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

  // Check report submission status
  try {
    const reportResult = await apiGetTodayCounts(
      session.name,
      session.quotationSheetId || '',
      session.prSheetId || ''
    );
    const statusEl = document.getElementById('reportStatus');
    if (statusEl) {
      if (reportResult.success && reportResult.alreadySubmitted) {
        statusEl.innerHTML = '<span style="color:#22c55e;">Submitted today</span>';
      } else {
        statusEl.innerHTML = '<span style="color:#eab308;">Not yet submitted</span>';
      }
    }
  } catch (e) {
    const statusEl = document.getElementById('reportStatus');
    if (statusEl) statusEl.textContent = '—';
  }

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
        bars.push(makeProgressBar('Quotations', monthQ, t.quotationTarget, '#f97316'));
      }
      if (t.prTarget > 0) {
        bars.push(makeProgressBar('Purchase Requests', monthP, t.prTarget, '#3b82f6'));
      }

      if (bars.length > 0) {
        document.getElementById('targetBars').innerHTML = bars.join('');
        document.getElementById('targetSection').style.display = 'block';
      }
    }
  } catch (e) {
    // Target not set — no progress bars shown
  }

  // Check for overdue follow-ups
  try {
    const trackerResult = await apiGetClientTracker(session.name, {
      quotationSheetId: session.quotationSheetId
    });
    if (trackerResult.success && trackerResult.data) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const overdue = trackerResult.data.filter(r => {
        if (!r.followUpDate) return false;
        const status = (r.status || '').toLowerCase();
        if (status === 'won' || status === 'lost' || status === 'closed') return false;
        const fDate = new Date(r.followUpDate);
        fDate.setHours(0, 0, 0, 0);
        return fDate <= today;
      });
      if (overdue.length > 0) {
        document.getElementById('overdueCount').textContent = overdue.length;
        const listHtml = overdue.slice(0, 5).map(r =>
          `<div style="padding:0.25rem 0;border-bottom:1px solid #e2e8f0;">
            <strong style="color:var(--text-primary,#f1f5f9);">${r.clientName}</strong>
            <span style="color:var(--text-muted,#64748b);margin-left:0.5rem;">${r.type} — ${r.documentNumber}</span>
            <span style="color:#ef4444;margin-left:0.5rem;font-size:0.75rem;">Due: ${r.followUpDate}</span>
          </div>`
        ).join('') + (overdue.length > 5 ? `<div style="padding:0.25rem 0;color:var(--text-muted);">...and ${overdue.length - 5} more</div>` : '');
        document.getElementById('overdueList').innerHTML = listHtml;
        document.getElementById('overdueSection').style.display = 'block';
      }
    }
  } catch (e) {
    // Silently ignore
  }
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
    el.classList.add('btn-secondary');
    el.classList.remove('btn-primary');
    el.textContent = 'Not Configured';
    el.style.pointerEvents = 'none';
  }
}

function makeProgressBar(label, current, target, color) {
  const pct = Math.min(Math.round((current / target) * 100), 100);
  return `<div class="progress-row">
    <div class="progress-label">
      <span>${label}</span>
      <strong>${current} / ${target} (${pct}%)</strong>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" style="width:${pct}%;background:${color};"></div>
    </div>
  </div>`;
}
