/* admin-targets-inline.js — A305 · the page's own script, moved verbatim out of admin-targets.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
let allAgents = [];

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('admin-targets');

  // Set current month
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('targetMonth').value = `${yyyy}-${mm}`;

  await loadTargets();
  await loadTargetHistory();
});

async function loadTargets() {
  const container = document.getElementById('targetsContainer');
  const month = document.getElementById('targetMonth').value;
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    // Get team summary to find all agents, and get existing targets
    const [teamResult, targetResult] = await Promise.all([
      apiGetTeamSummary(),
      apiGetTargets(month)
    ]);

    if (!teamResult.success) throw new Error('Failed to load agents');

    allAgents = teamResult.data || [];
    const targets = {};
    if (targetResult.success && targetResult.data) {
      targetResult.data.forEach(t => {
        targets[t.agentName.toLowerCase()] = t;
      });
    }

    // Also get current month actuals
    let rows = '';
    allAgents.forEach((agent, idx) => {
      const t = targets[agent.name.toLowerCase()] || {};
      const qTarget = t.quotationTarget || 0;
      const prTarget = t.prTarget || 0;
      const callTarget = t.callTarget || 0;

      rows += `<tr>
        <td><strong>${escapeHtml(agent.name)}</strong></td>
        <td><input type="number" id="qt-${idx}" value="${qTarget}" min="0"></td>
        <td style="text-align:center;">${agent.quotations || 0}</td>
        <td><input type="number" id="pt-${idx}" value="${prTarget}" min="0"></td>
        <td style="text-align:center;">${agent.prs || 0}</td>
        <td><input type="number" id="ct-${idx}" value="${callTarget}" min="0"></td>
        <td>
          <button class="save-btn" onclick="saveTarget(${idx})">Save</button>
          <span id="msg-${idx}" class="status-msg"></span>
        </td>
      </tr>`;
    });

    container.innerHTML = `
      <table class="targets-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Quotation Target</th>
            <th style="text-align:center;">Actual</th>
            <th>PR Target</th>
            <th style="text-align:center;">Actual</th>
            <th>Call Target</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color: var(--text-muted);">Error: ${err.message}</div>`;
  }
}

async function saveTarget(idx) {
  const agent = allAgents[idx];
  const month = document.getElementById('targetMonth').value;
  const qt = parseInt(document.getElementById('qt-' + idx).value) || 0;
  const pt = parseInt(document.getElementById('pt-' + idx).value) || 0;
  const ct = parseInt(document.getElementById('ct-' + idx).value) || 0;
  const msgEl = document.getElementById('msg-' + idx);
  msgEl.textContent = 'Saving...';
  msgEl.className = 'status-msg';

  try {
    const result = await apiSetTargets(month, agent.name, qt, pt, ct);
    if (result.success) {
      msgEl.textContent = 'Saved!';
      msgEl.className = 'status-msg success';
    } else {
      msgEl.textContent = result.message || 'Failed';
      msgEl.className = 'status-msg error';
    }
  } catch (err) {
    msgEl.textContent = 'Error';
    msgEl.className = 'status-msg error';
  }

  setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

function escapeHtml(str) { return hxEscBlank(str); }

let historyChartInstance = null;
async function loadTargetHistory() {
  try {
    // Get all targets (no month filter) to find last 6 months
    const result = await apiGetTargets('');
    if (!result.success || !result.data || result.data.length === 0) return;

    // Group by month
    const monthMap = {};
    result.data.forEach(t => {
      if (!monthMap[t.month]) monthMap[t.month] = { qTarget: 0, prTarget: 0 };
      monthMap[t.month].qTarget += t.quotationTarget;
      monthMap[t.month].prTarget += t.prTarget;
    });

    const months = Object.keys(monthMap).sort().slice(-6);
    if (months.length < 2) return;

    // For each month, we only have targets. Show target totals as the chart.
    const qTargets = months.map(m => monthMap[m].qTarget);
    const prTargets = months.map(m => monthMap[m].prTarget);
    const labels = months.map(m => {
      const [y, mo] = m.split('-');
      return new Date(y, mo - 1).toLocaleString('en', { month: 'short', year: '2-digit' });
    });

    document.getElementById('historySection').style.display = 'block';
    await loadLib(CHART_JS_CDN);   // A301: Chart.js loads on demand, like every other chart page
    if (historyChartInstance) historyChartInstance.destroy();

    historyChartInstance = new Chart(document.getElementById('historyChart'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Team Quotation Target', data: qTargets, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', fill: true, tension: 0.3, pointRadius: 4 },
          { label: 'Team PR Target', data: prTargets, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
          tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, cornerRadius: 8 }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
          y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' } }
        }
      }
    });
  } catch (e) {
    // Silently fail — chart just won't show
  }
}
