/* ═══════════════════════════════════════════════
   admin-team.js — Team Analytics (Documents + Activity tabs)
   ═══════════════════════════════════════════════ */

let teamData = [];
let activityData = [];
let activityRange = 'week';
let activityChartInstance = null;
let activityLoaded = false;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;

  renderNavbar('admin-team');
  await Promise.all([loadTeamData(), loadHotLeads()]);
});

// ─── Tab Switching ────────────────────────────────
function switchTab(tab) {
  document.getElementById('tabBtnDocs').className = 'tab-btn' + (tab === 'documents' ? ' active' : '');
  document.getElementById('tabBtnActivity').className = 'tab-btn' + (tab === 'activity' ? ' active' : '');
  document.getElementById('tab-documents').className = 'tab-panel' + (tab === 'documents' ? ' active' : '');
  document.getElementById('tab-activity').className = 'tab-panel' + (tab === 'activity' ? ' active' : '');

  if (tab === 'activity' && !activityLoaded) {
    activityLoaded = true;
    loadActivity('week');
  }
}

// ═══════════════════════════════════════════════════
// DOCUMENTS TAB
// ═══════════════════════════════════════════════════

async function loadTeamData() {
  showLoading('leaderboardContainer', 'table');
  try {
    const result = await apiGetTeamSummary();
    if (result.success === false) {
      showError('leaderboardContainer', result.message || 'Failed to load team data');
      return;
    }
    teamData = result.data || [];
    if (teamData.length === 0) {
      showEmpty('leaderboardContainer', 'No team data', 'No agents have submitted documents yet.');
      return;
    }
    renderLeaderboard(teamData);
  } catch (err) {
    showError('leaderboardContainer', err.message);
  }
}

async function loadHotLeads() {
  showLoading('hotLeadsContainer', 'table');
  try {
    const result = await apiGetHotLeads();
    if (result.success === false) {
      showError('hotLeadsContainer', result.message || 'Failed to load hot leads');
      return;
    }
    const leads = result.data || [];
    if (leads.length === 0) {
      showEmpty('hotLeadsContainer', 'No hot leads yet', 'Clients with 3+ RFQs this month will appear here.');
      return;
    }
    renderHotLeads(leads);
  } catch (err) {
    showError('hotLeadsContainer', err.message);
  }
}

function renderLeaderboard(data) {
  const container = document.getElementById('leaderboardContainer');
  let sortCol = 'total';
  let sortDir = 'desc';

  function render() {
    const sorted = [...data].sort((a, b) => {
      if (sortCol === 'name') {
        return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      const diff = (a[sortCol] || 0) - (b[sortCol] || 0);
      return sortDir === 'desc' ? -diff : diff;
    });

    let html = `
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th class="sortable" data-col="name">Agent</th>
            <th class="sortable" data-col="quotations">Quotations</th>
            <th class="sortable" data-col="prs">PRs</th>
            <th class="sortable" data-col="pos">POs</th>
            <th>Conversion</th>
            <th class="sortable" data-col="total">Total</th>
            <th>vs Last Month</th>
          </tr>
        </thead>
        <tbody>`;

    sorted.forEach((agent, i) => {
      const rank = i + 1;
      let rankClass = '';
      if (rank === 1) rankClass = 'gold';
      else if (rank === 2) rankClass = 'silver';
      else if (rank === 3) rankClass = 'bronze';
      const highlight = rank === 1 ? ' highlight' : '';

      // Quotation target progress
      const qTarget = agent.quotationTarget || 0;
      const qCell = qTarget > 0 ? makeTargetCell(agent.quotations, qTarget, '#f97316') : `<td>${agent.quotations || 0}</td>`;

      // PR target progress
      const prTarget = agent.prTarget || 0;
      const prCell = prTarget > 0 ? makeTargetCell(agent.prs, prTarget, '#3b82f6') : `<td>${agent.prs || 0}</td>`;

      // Conversion rate (POs / Quotations)
      const convHtml = makeConversionCell(agent.pos, agent.quotations);

      // Trend vs last month
      const trendHtml = makeTrendBadge(agent.total, agent.prevTotal);

      html += `
        <tr class="${highlight}">
          <td><span class="rank-badge ${rankClass}">${rank}</span></td>
          <td style="font-weight:600;">${esc(agent.name)}</td>
          ${qCell}
          ${prCell}
          <td>${agent.pos || 0}</td>
          <td>${convHtml}</td>
          <td style="font-weight:700;color:var(--accent);">${agent.total || 0}</td>
          <td>${trendHtml}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.col === sortCol) {
        th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });

    container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) {
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          sortCol = col;
          sortDir = col === 'name' ? 'asc' : 'desc';
        }
        render();
      });
    });
  }

  render();
}

function makeTargetCell(actual, target, color) {
  const pct = Math.min(Math.round((actual / target) * 100), 100);
  return `<td class="target-cell">
    <div class="target-text"><span class="actual">${actual}</span><span class="sep"> / </span><span class="goal">${target}</span></div>
    <div class="target-bar"><div class="target-bar-fill" style="width:${pct}%;background:${color};"></div></div>
  </td>`;
}

function makeConversionCell(pos, quotations) {
  if (!quotations || quotations === 0) return '<span class="conv-rate conv-none">&mdash;</span>';
  const rate = Math.round((pos / quotations) * 100);
  let cls = 'conv-low';
  if (rate >= 30) cls = 'conv-good';
  else if (rate >= 15) cls = 'conv-mid';
  return `<span class="conv-rate ${cls}">${rate}%</span>`;
}

function makeTrendBadge(current, prev) {
  if (prev === 0 && current > 0) return '<span class="trend trend-new">NEW</span>';
  if (prev === 0 && current === 0) return '<span class="trend trend-flat">&mdash;</span>';
  const diff = current - prev;
  const pct = Math.round((diff / prev) * 100);
  if (diff > 0) return `<span class="trend trend-up">&uarr; ${pct}%</span>`;
  if (diff < 0) return `<span class="trend trend-down">&darr; ${Math.abs(pct)}%</span>`;
  return '<span class="trend trend-flat">&mdash; 0%</span>';
}

function renderHotLeads(leads) {
  const container = document.getElementById('hotLeadsContainer');
  let html = `
    <table>
      <thead>
        <tr><th>Client Name</th><th>Total RFQs</th><th>Agents Handling</th><th>Status</th></tr>
      </thead>
      <tbody>`;

  leads.forEach(lead => {
    const badgeClass = lead.rfqCount >= 5 ? 'badge-hot' : 'badge-active';
    const badgeText = lead.rfqCount >= 5 ? '\uD83D\uDD25 Hot' : '\u26A1 Active';
    html += `
      <tr>
        <td style="font-weight:600;">${esc(lead.client)}</td>
        <td style="font-weight:700;color:var(--accent);">${lead.rfqCount}</td>
        <td>${lead.agents.join(', ')}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function exportCSV() {
  if (!teamData || teamData.length === 0) return;
  const headers = ['Rank', 'Agent Name', 'Quotations', 'Q Target', 'PRs', 'PR Target', 'POs', 'Conversion %', 'Total', 'Prev Month Total', 'Trend %'];
  const rows = teamData.map((agent, i) => {
    const conv = agent.quotations > 0 ? Math.round((agent.pos / agent.quotations) * 100) : 0;
    const trend = agent.prevTotal > 0 ? Math.round(((agent.total - agent.prevTotal) / agent.prevTotal) * 100) : (agent.total > 0 ? 'NEW' : 0);
    return [
      i + 1, `"${agent.name}"`, agent.quotations || 0, agent.quotationTarget || 0,
      agent.prs || 0, agent.prTarget || 0, agent.pos || 0, conv,
      agent.total || 0, agent.prevTotal || 0, trend
    ];
  });

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `team-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════
// ACTIVITY TAB (merged from Report Summary)
// ═══════════════════════════════════════════════════

async function loadActivity(range) {
  activityRange = range;
  document.getElementById('btnWeek').className = 'toggle-btn' + (range === 'week' ? ' active' : '');
  document.getElementById('btnMonth').className = 'toggle-btn' + (range === 'month' ? ' active' : '');

  const container = document.getElementById('activityContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  document.getElementById('activityChartSection').style.display = 'none';

  try {
    const result = await apiGetReportSummary(range);
    if (!result.success) throw new Error(result.message || 'Failed');

    document.getElementById('activityRangeLabel').textContent =
      (range === 'week' ? 'Week: ' : 'Month: ') + result.startDate + ' to ' + result.endDate;

    const data = result.data || [];
    activityData = data;
    if (data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No agents found.</div>';
      return;
    }

    renderActivityTable(data);
    await renderActivityChart(data);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Error: ${err.message}</div>`;
  }
}

function renderActivityTable(data) {
  const container = document.getElementById('activityContainer');
  let totals = { days: 0, q: 0, pr: 0, leads: 0, followUp: 0, calls: 0, success: 0, fail: 0, urgent: 0 };

  let rows = data.map(a => {
    totals.days += a.daysSubmitted;
    totals.q += a.totalQuotations;
    totals.pr += a.totalPRs;
    totals.leads += a.totalLeadsEmails;
    totals.followUp += a.totalFollowUpEmails;
    totals.calls += a.totalCalls;
    totals.success += a.successfulCalls;
    totals.fail += a.unsuccessfulCalls;
    totals.urgent += a.urgentIssues;

    return `<tr>
      <td><strong>${esc(a.agentName)}</strong></td>
      <td class="${a.daysSubmitted === 0 ? 'zero' : ''}" style="text-align:center;">${a.daysSubmitted}</td>
      <td style="text-align:center;">${a.totalQuotations}</td>
      <td style="text-align:center;">${a.totalPRs}</td>
      <td style="text-align:center;">${a.totalLeadsEmails}</td>
      <td style="text-align:center;">${a.totalFollowUpEmails}</td>
      <td style="text-align:center;font-weight:600;">${a.totalCalls}</td>
      <td style="text-align:center;color:#22c55e;">${a.successfulCalls}</td>
      <td style="text-align:center;color:#ef4444;">${a.unsuccessfulCalls}</td>
      <td style="text-align:center;color:${a.urgentIssues > 0 ? '#ef4444' : 'inherit'};">${a.urgentIssues}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">
      ${data.filter(a => a.daysSubmitted > 0).length}/${data.length} agents reported
    </div>
    <table class="summary-table" id="summaryTable">
      <thead><tr>
        <th>Agent</th><th style="text-align:center;">Days</th><th style="text-align:center;">Quotations</th>
        <th style="text-align:center;">PRs</th><th style="text-align:center;">Leads Emails</th>
        <th style="text-align:center;">Follow Up</th><th style="text-align:center;">Total Calls</th>
        <th style="text-align:center;">Successful</th><th style="text-align:center;">Unsuccessful</th>
        <th style="text-align:center;">Urgent</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>TOTAL</td>
        <td style="text-align:center;">${totals.days}</td><td style="text-align:center;">${totals.q}</td>
        <td style="text-align:center;">${totals.pr}</td><td style="text-align:center;">${totals.leads}</td>
        <td style="text-align:center;">${totals.followUp}</td><td style="text-align:center;">${totals.calls}</td>
        <td style="text-align:center;">${totals.success}</td><td style="text-align:center;">${totals.fail}</td>
        <td style="text-align:center;">${totals.urgent}</td>
      </tr></tfoot>
    </table>`;
}

async function renderActivityChart(data) {
  await loadLib('https://cdn.jsdelivr.net/npm/chart.js');
  if (activityChartInstance) activityChartInstance.destroy();
  document.getElementById('activityChartSection').style.display = 'block';
  const ctx = document.getElementById('activityChart');

  activityChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.agentName),
      datasets: [
        { label: 'Quotations', data: data.map(d => d.totalQuotations), backgroundColor: 'rgba(249,115,22,0.7)', borderRadius: 4 },
        { label: 'PRs', data: data.map(d => d.totalPRs), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
        { label: 'Calls', data: data.map(d => d.totalCalls), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 4 },
        { label: 'Emails', data: data.map(d => d.totalLeadsEmails + d.totalFollowUpEmails), backgroundColor: 'rgba(168,85,247,0.7)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { family: 'Inter', size: 11 } } },
        tooltip: { backgroundColor: '#ffffff', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, cornerRadius: 8, padding: 10 }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
        y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { family: 'Inter', size: 11 }, stepSize: 1 } }
      }
    }
  });
}

async function exportActivityPDF() {
  if (!activityData.length) return;
  await loadJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');
  const rangeLabel = document.getElementById('activityRangeLabel').textContent;

  doc.setFontSize(16);
  doc.text('Hi-Escorp Report Summary', 14, 15);
  doc.setFontSize(10);
  doc.text(rangeLabel, 14, 22);

  const headers = [['Agent', 'Days', 'Quotations', 'PRs', 'Leads Emails', 'Follow Up', 'Total Calls', 'Successful', 'Unsuccessful', 'Urgent']];
  const rows = activityData.map(a => [
    a.agentName, a.daysSubmitted, a.totalQuotations, a.totalPRs,
    a.totalLeadsEmails, a.totalFollowUpEmails, a.totalCalls,
    a.successfulCalls, a.unsuccessfulCalls, a.urgentIssues
  ]);

  const t = activityData.reduce((acc, a) => {
    acc[0] += a.daysSubmitted; acc[1] += a.totalQuotations; acc[2] += a.totalPRs;
    acc[3] += a.totalLeadsEmails; acc[4] += a.totalFollowUpEmails; acc[5] += a.totalCalls;
    acc[6] += a.successfulCalls; acc[7] += a.unsuccessfulCalls; acc[8] += a.urgentIssues;
    return acc;
  }, [0,0,0,0,0,0,0,0,0]);
  rows.push(['TOTAL', ...t]);

  doc.autoTable({ head: headers, body: rows, startY: 28, theme: 'grid', headStyles: { fillColor: [249, 115, 22] } });
  doc.save(`report-summary-${activityRange}-${new Date().toISOString().slice(0,10)}.pdf`);
}

async function exportActivityExcel() {
  if (!activityData.length) return;
  await loadXLSX();
  const headers = ['Agent', 'Days Reported', 'Quotations', 'PRs', 'Leads Emails', 'Follow Up Emails', 'Total Calls', 'Successful', 'Unsuccessful', 'Urgent Issues'];
  const rows = activityData.map(a => [
    a.agentName, a.daysSubmitted, a.totalQuotations, a.totalPRs,
    a.totalLeadsEmails, a.totalFollowUpEmails, a.totalCalls,
    a.successfulCalls, a.unsuccessfulCalls, a.urgentIssues
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report Summary');
  XLSX.writeFile(wb, `report-summary-${activityRange}-${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ─── Utility ──────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
