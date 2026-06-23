/* ═══════════════════════════════════════════════
   admin-reports.js — Admin view of daily sales reports
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;

  renderNavbar('admin-reports');
  setToday();
  await loadReports();
});

function setToday() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  document.getElementById('reportDate').value = `${yyyy}-${mm}-${dd}`;
}

async function loadReports() {
  const container = document.getElementById('reportsContainer');
  const dateVal = document.getElementById('reportDate').value;
  container.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>`;

  // Display friendly date
  const d = new Date(dateVal + 'T00:00:00');
  document.getElementById('dateLabel').textContent = d.toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  try {
    const result = await apiGetDailyReports(dateVal);
    if (!result.success) throw new Error(result.message || 'Failed to load reports');

    const data = result.data || [];
    lastReportData = data;
    if (data.length === 0) {
      container.innerHTML = `<div class="no-results"><p>No sales agents found.</p></div>`;
      return;
    }

    renderReportsTable(data);
  } catch (err) {
    console.error('Reports error:', err);
    container.innerHTML = `<div class="no-results"><p>Error: ${err.message}</p></div>`;
  }
}

function renderReportsTable(reports) {
  const container = document.getElementById('reportsContainer');

  let submittedCount = reports.filter(r => r.submitted).length;
  let totalAgents = reports.length;

  let rows = '';
  reports.forEach((r, idx) => {
    if (!r.submitted) {
      rows += `<tr class="not-submitted">
        <td>${escapeHtml(r.agentName)}</td>
        <td colspan="12" style="text-align:center;">Not submitted</td>
      </tr>`;
      return;
    }

    const callCount = (r.callDetails || []).length;
    const callsBtn = callCount > 0
      ? `<button class="details-btn" onclick="toggleDetails('calls-${idx}')">View (${callCount})</button>`
      : `<span class="badge-muted">None</span>`;

    const leadsCount = (r.leadsEmailDetails || []).length;
    const leadsBtn = leadsCount > 0
      ? `<button class="details-btn" onclick="toggleDetails('leads-${idx}')">View (${leadsCount})</button>`
      : `<span class="badge-muted">None</span>`;

    const followUpCount = (r.followUpEmailDetails || []).length;
    const followUpBtn = followUpCount > 0
      ? `<button class="details-btn" onclick="toggleDetails('followup-${idx}')">View (${followUpCount})</button>`
      : `<span class="badge-muted">None</span>`;

    const urgentCount = (r.urgentIssues || []).length;
    const urgentBtn = urgentCount > 0
      ? `<button class="details-btn" style="background:rgba(239,68,68,0.15);color:#ef4444;" onclick="toggleDetails('urgent-${idx}')">View (${urgentCount})</button>`
      : `<span class="badge-muted">None</span>`;

    const otherTaskText = (r.otherTask || '').trim();
    const otherTaskBtn = otherTaskText
      ? `<button class="details-btn" style="background:rgba(245,158,11,0.18);color:#b45309;" onclick="toggleDetails('other-${idx}')">View</button>`
      : `<span class="badge-muted">None</span>`;

    rows += `<tr>
      <td><strong>${escapeHtml(r.agentName)}</strong></td>
      <td style="text-align:center;">${r.quotationsSent > 0 ? `<button class="details-btn" onclick="openAgentDayActivity('${escapeHtml(r.agentName)}','quotations')">${r.quotationsSent}</button>` : `<span class="badge-muted">0</span>`}</td>
      <td style="text-align:center;">${r.prsSent > 0 ? `<button class="details-btn" onclick="openAgentDayActivity('${escapeHtml(r.agentName)}','prs')">${r.prsSent}</button>` : `<span class="badge-muted">0</span>`}</td>
      <td style="text-align:center;">${leadsBtn}</td>
      <td style="text-align:center;">${followUpBtn}</td>
      <td style="text-align:center;font-weight:600;">${r.totalCalls}</td>
      <td style="text-align:center;"><span class="badge-success">${r.successfulCalls}</span></td>
      <td style="text-align:center;"><span class="badge-fail">${r.unsuccessfulCalls}</span></td>
      <td>${callsBtn}</td>
      <td>${urgentBtn}</td>
      <td style="text-align:center;">${otherTaskBtn}</td>
    </tr>`;

    // Leads email details expandable row
    if (leadsCount > 0) {
      let miniRows = r.leadsEmailDetails.map(e => {
        return `<tr>
          <td>${escapeHtml(e.recipient || '—')}</td>
          <td>${escapeHtml(e.company || '—')}</td>
          <td>${escapeHtml(e.detail || '—')}</td>
          <td>${escapeHtml(e.type || '—')}</td>
          <td>${escapeHtml(e.response || '—')}</td>
        </tr>`;
      }).join('');

      rows += `<tr class="call-details-row" id="leads-${idx}">
        <td colspan="12">
          <div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);margin-bottom:0.35rem;text-transform:uppercase;">Leads Emails (Introduction)</div>
          <table class="mini-table">
            <thead><tr><th>Recipient</th><th>Company</th><th>Subject / Purpose</th><th>Type</th><th>Response</th></tr></thead>
            <tbody>${miniRows}</tbody>
          </table>
        </td>
      </tr>`;
    }

    // Follow up email details expandable row
    if (followUpCount > 0) {
      let miniRows = r.followUpEmailDetails.map(e => {
        return `<tr>
          <td>${escapeHtml(e.recipient || '—')}</td>
          <td>${escapeHtml(e.company || '—')}</td>
          <td>${escapeHtml(e.detail || '—')}</td>
          <td>${escapeHtml(e.type || '—')}</td>
          <td>${escapeHtml(e.response || '—')}</td>
        </tr>`;
      }).join('');

      rows += `<tr class="call-details-row" id="followup-${idx}">
        <td colspan="12">
          <div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);margin-bottom:0.35rem;text-transform:uppercase;">Follow Up Emails</div>
          <table class="mini-table">
            <thead><tr><th>Recipient</th><th>Company</th><th>Subject / Reference</th><th>Type</th><th>Response</th></tr></thead>
            <tbody>${miniRows}</tbody>
          </table>
        </td>
      </tr>`;
    }

    // Call details expandable row
    if (callCount > 0) {
      let miniRows = r.callDetails.map(c => {
        const statusBadge = c.status === 'Successful'
          ? `<span class="badge-success">Successful</span>`
          : `<span class="badge-fail">Unsuccessful</span>`;
        return `<tr>
          <td>${escapeHtml(c.time || '—')}</td>
          <td>${escapeHtml(c.contact || '—')}</td>
          <td>${escapeHtml(c.company || '—')}</td>
          <td>${escapeHtml(c.topic || '—')}</td>
          <td>${escapeHtml(c.outcome || '—')}</td>
          <td>${statusBadge}</td>
          <td>${escapeHtml(c.notes || '')}</td>
        </tr>`;
      }).join('');

      rows += `<tr class="call-details-row" id="calls-${idx}">
        <td colspan="12">
          <div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);margin-bottom:0.35rem;text-transform:uppercase;">Call Details</div>
          <table class="mini-table">
            <thead><tr><th>Time</th><th>Contact Person</th><th>Company</th><th>Topic</th><th>Outcome</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>${miniRows}</tbody>
          </table>
        </td>
      </tr>`;
    }

    // Urgent issues expandable row
    if (urgentCount > 0) {
      let miniRows = r.urgentIssues.map(issue => {
        return `<tr><td style="font-weight:600;color:#ef4444;">${escapeHtml(issue.category)}</td><td>${escapeHtml(issue.description)}</td></tr>`;
      }).join('');

      rows += `<tr class="call-details-row" id="urgent-${idx}">
        <td colspan="12">
          <div style="font-size:0.72rem;font-weight:600;color:#ef4444;margin-bottom:0.35rem;text-transform:uppercase;">Urgent Issues</div>
          <table class="mini-table">
            <thead><tr><th>Category</th><th>Description</th></tr></thead>
            <tbody>${miniRows}</tbody>
          </table>
        </td>
      </tr>`;
    }

    // Other task expandable row
    if (otherTaskText) {
      rows += `<tr class="call-details-row" id="other-${idx}">
        <td colspan="12">
          <div style="font-size:0.72rem;font-weight:600;color:#b45309;margin-bottom:0.35rem;text-transform:uppercase;">Other Task / Notes</div>
          <div style="padding:0.6rem 0.8rem;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;white-space:pre-wrap;font-size:0.85rem;line-height:1.4;">${escapeHtml(otherTaskText)}</div>
        </td>
      </tr>`;
    }
  });

  container.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">
      ${submittedCount}/${totalAgents} agents submitted
    </div>
    <table class="reports-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th style="text-align:center;">Quotations</th>
          <th style="text-align:center;">Purchase Requests</th>
          <th style="text-align:center;">Leads Emails</th>
          <th style="text-align:center;">Follow Up Emails</th>
          <th style="text-align:center;">Total Calls</th>
          <th style="text-align:center;">Successful</th>
          <th style="text-align:center;">Unsuccessful</th>
          <th>Call Details</th>
          <th>Urgent Issues</th>
          <th style="text-align:center;">Other Task</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function toggleDetails(id) {
  const row = document.getElementById(id);
  if (row) row.classList.toggle('open');
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let lastReportData = [];

async function exportReportsExcel() {
  if (!lastReportData || lastReportData.length === 0) return;
  await loadXLSX();
  const dateVal = document.getElementById('reportDate').value;
  const headers = ['Agent', 'Quotations', 'Purchase Requests', 'Leads Emails', 'Follow Up Emails', 'Total Calls', 'Successful', 'Unsuccessful', 'Other Task', 'Status'];
  const rows = lastReportData.map(r => [
    r.agentName,
    r.submitted ? r.quotationsSent : '',
    r.submitted ? r.prsSent : '',
    r.submitted ? r.leadsEmails : '',
    r.submitted ? r.followUpEmails : '',
    r.submitted ? r.totalCalls : '',
    r.submitted ? r.successfulCalls : '',
    r.submitted ? r.unsuccessfulCalls : '',
    r.submitted ? (r.otherTask || '') : '',
    r.submitted ? 'Submitted' : 'Not Submitted'
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Daily Reports');
  XLSX.writeFile(wb, `daily-reports-${dateVal}.xlsx`);
}

// ─── Agent day activity modal (quotations / PRs drill-in) ──
async function openAgentDayActivity(agentName, focus) {
  const dateVal = document.getElementById('reportDate').value;
  showAgentActivityModal(agentName, dateVal, focus, null);
  try {
    const res = await apiGetAgentDayActivity(agentName, dateVal);
    if (!res || !res.success) throw new Error(res && res.message || 'Failed to load activity');
    showAgentActivityModal(agentName, dateVal, focus, res);
  } catch (err) {
    showAgentActivityModal(agentName, dateVal, focus, { error: err.message });
  }
}

function showAgentActivityModal(agentName, dateVal, focus, data) {
  const existing = document.getElementById('agentActivityModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'agentActivityModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

  let body = '';
  if (!data) {
    body = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">Loading…</div>';
  } else if (data.error) {
    body = `<div style="padding:1rem;color:#ef4444;">Error: ${escapeHtml(data.error)}</div>`;
  } else {
    body = renderAgentActivityBody(data, focus);
  }

  modal.innerHTML =
    '<div style="background:var(--bg-card,#fff);border-radius:10px;width:min(960px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:0.85rem 1rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border,#e2e8f0);">' +
        '<strong>' + escapeHtml(agentName) + ' — ' + escapeHtml(dateVal) + '</strong>' +
        '<button onclick="document.getElementById(\'agentActivityModal\').remove()" style="background:transparent;border:1px solid var(--border,#cbd5e1);border-radius:6px;padding:4px 12px;cursor:pointer;">Close</button>' +
      '</div>' +
      '<div style="padding:1rem;overflow:auto;">' + body + '</div>' +
    '</div>';
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function renderAgentActivityBody(data, focus) {
  const quotations = data.quotations || [];
  const prs = data.prs || [];
  const initial = focus === 'prs' ? 'prs' : 'quotations';
  const tabBtn = (key, label, count) =>
    `<button class="act-tab" data-tab="${key}" onclick="switchAgentActivityTab('${key}')" style="padding:0.4rem 0.85rem;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:${key === initial ? '#3b82f6' : 'transparent'};color:${key === initial ? '#fff' : 'inherit'};cursor:pointer;font-size:0.85rem;font-weight:600;">${label} <span style="opacity:0.75;">(${count})</span></button>`;

  return `
    <div style="display:flex;gap:0.5rem;margin-bottom:0.85rem;">
      ${tabBtn('quotations', 'Quotations', quotations.length)}
      ${tabBtn('prs', 'PRs', prs.length)}
    </div>
    <div id="actPaneQuotations" style="display:${initial === 'quotations' ? 'block' : 'none'};">
      ${renderQuotationsList(quotations)}
    </div>
    <div id="actPanePrs" style="display:${initial === 'prs' ? 'block' : 'none'};">
      ${renderPRsList(prs)}
    </div>`;
}

function renderQuotationsList(rows) {
  if (!rows.length) return '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);">No quotations created on this date.</div>';
  let body = rows.map(q => {
    const pdf = q.driveLink
      ? `<a href="${escapeHtml(q.driveLink)}" target="_blank" style="color:#3b82f6;text-decoration:none;font-size:0.78rem;">View PDF</a>`
      : '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';
    const amount = q.amount === '' || q.amount == null ? '—' : Number(q.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<tr>
      <td>${escapeHtml(q.refNo)}</td>
      <td><strong>${escapeHtml(q.clientName)}</strong></td>
      <td>${escapeHtml(q.subject)}</td>
      <td style="text-align:right;">${amount}</td>
      <td>${escapeHtml(q.adminApproval)}</td>
      <td>${escapeHtml(q.managementApproval)}</td>
      <td>${escapeHtml(q.overallStatus)}</td>
      <td>${pdf}</td>
    </tr>`;
  }).join('');
  return `<table class="mini-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">
    <thead><tr style="background:#f1f5f9;"><th>Ref No</th><th>Client</th><th>Subject</th><th style="text-align:right;">Amount</th><th>Admin</th><th>Mgmt</th><th>Overall</th><th>PDF</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderPRsList(rows) {
  if (!rows.length) return '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);">No PRs sent on this date.</div>';
  let body = rows.map(p => {
    const unit = p.unitPrice === '' || p.unitPrice == null ? '—' : Number(p.unitPrice).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const total = p.totalPrice === '' || p.totalPrice == null ? '—' : Number(p.totalPrice).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<tr>
      <td>${escapeHtml(p.prNumber)}</td>
      <td><strong>${escapeHtml(p.clientName)}</strong></td>
      <td>${escapeHtml(p.itemDescription)}</td>
      <td>${escapeHtml(p.modelPartNo)}</td>
      <td style="text-align:center;">${escapeHtml(String(p.quantity))}</td>
      <td>${escapeHtml(p.status)}</td>
      <td style="text-align:right;">${unit}</td>
      <td style="text-align:right;">${total}</td>
    </tr>`;
  }).join('');
  return `<table class="mini-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">
    <thead><tr style="background:#f1f5f9;"><th>PR #</th><th>Client</th><th>Item</th><th>Model/Part#</th><th>Qty</th><th>Status</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function switchAgentActivityTab(key) {
  document.getElementById('actPaneQuotations').style.display = key === 'quotations' ? 'block' : 'none';
  document.getElementById('actPanePrs').style.display = key === 'prs' ? 'block' : 'none';
  document.querySelectorAll('#agentActivityModal .act-tab').forEach(btn => {
    const active = btn.getAttribute('data-tab') === key;
    btn.style.background = active ? '#3b82f6' : 'transparent';
    btn.style.color = active ? '#fff' : 'inherit';
  });
}
