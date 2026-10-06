/* admin-summary-inline.js — A305 · the page's own script, moved verbatim out of admin-summary.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
let currentRange = 'week';
let lastData = [];
let chartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('admin-summary');
  await loadSummary('week');
});

async function loadSummary(range) {
  currentRange = range;
  document.getElementById('btnWeek').className = 'toggle-btn' + (range === 'week' ? ' active' : '');
  document.getElementById('btnMonth').className = 'toggle-btn' + (range === 'month' ? ' active' : '');

  const container = document.getElementById('summaryContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  document.getElementById('chartSection').style.display = 'none';

  try {
    const result = await apiGetReportSummary(range);
    if (!result.success) throw new Error(result.message || 'Failed');

    document.getElementById('rangeLabel').textContent =
      (range === 'week' ? 'Week: ' : 'Month: ') + result.startDate + ' to ' + result.endDate;

    const data = result.data || [];
    lastData = data;
    if (data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color: var(--text-muted);">No agents found.</div>';
      return;
    }

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
        <td style="text-align:center;color: var(--hx-ok);">${a.successfulCalls}</td>
        <td style="text-align:center;color: var(--hx-red);">${a.unsuccessfulCalls}</td>
        <td style="text-align:center;color: ${a.urgentIssues > 0 ? 'var(--hx-red)' : 'inherit'};">${a.urgentIssues}</td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <div style="font-size:0.8rem;color: var(--text-muted);margin-bottom:0.75rem;">
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

    renderChart(data);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color: var(--text-muted);">Error: ${err.message}</div>`;
  }
}

async function renderChart(data) {
  await loadLib(CHART_JS_CDN);
  if (chartInstance) chartInstance.destroy();
  document.getElementById('chartSection').style.display = 'block';
  const ctx = document.getElementById('summaryChart');

  chartInstance = new Chart(ctx, {
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
        tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, cornerRadius: 8, padding: 10 }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
        y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { family: 'Inter', size: 11 }, stepSize: 1 } }
      }
    }
  });
}

async function exportPDF() {
  if (!lastData.length) return;
  await loadJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');
  const rangeLabel = document.getElementById('rangeLabel').textContent;

  doc.setFontSize(16);
  doc.text('Hi-Escorp Report Summary', 14, 15);
  doc.setFontSize(10);
  doc.text(rangeLabel, 14, 22);

  const headers = [['Agent', 'Days', 'Quotations', 'PRs', 'Leads Emails', 'Follow Up', 'Total Calls', 'Successful', 'Unsuccessful', 'Urgent']];
  const rows = lastData.map(a => [
    a.agentName, a.daysSubmitted, a.totalQuotations, a.totalPRs,
    a.totalLeadsEmails, a.totalFollowUpEmails, a.totalCalls,
    a.successfulCalls, a.unsuccessfulCalls, a.urgentIssues
  ]);

  // Add totals row
  const t = lastData.reduce((acc, a) => {
    acc[0] += a.daysSubmitted; acc[1] += a.totalQuotations; acc[2] += a.totalPRs;
    acc[3] += a.totalLeadsEmails; acc[4] += a.totalFollowUpEmails; acc[5] += a.totalCalls;
    acc[6] += a.successfulCalls; acc[7] += a.unsuccessfulCalls; acc[8] += a.urgentIssues;
    return acc;
  }, [0,0,0,0,0,0,0,0,0]);
  rows.push(['TOTAL', ...t]);

  doc.autoTable({ head: headers, body: rows, startY: 28, theme: 'grid', headStyles: { fillColor: [249, 115, 22] } });
  doc.save(`report-summary-${currentRange}-${hxToday()}.pdf`);
}

async function exportExcel() {
  if (!lastData.length) return;
  await loadXLSX();
  const headers = ['Agent', 'Days Reported', 'Quotations', 'PRs', 'Leads Emails', 'Follow Up Emails', 'Total Calls', 'Successful', 'Unsuccessful', 'Urgent Issues'];
  const rows = lastData.map(a => [
    a.agentName, a.daysSubmitted, a.totalQuotations, a.totalPRs,
    a.totalLeadsEmails, a.totalFollowUpEmails, a.totalCalls,
    a.successfulCalls, a.unsuccessfulCalls, a.urgentIssues
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report Summary');
  XLSX.writeFile(wb, `report-summary-${currentRange}-${hxToday()}.xlsx`);
}

function esc(str) { return hxEscBlank(str); }
