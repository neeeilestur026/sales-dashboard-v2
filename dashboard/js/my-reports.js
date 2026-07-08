/* ═══════════════════════════════════════════════
   my-reports.js — Sales Agent Report History
   ═══════════════════════════════════════════════ */

let allReports = [];
let session = null;

document.addEventListener('DOMContentLoaded', async () => {
  session = requireSales();
  if (!session) return;
  renderNavbar('my-reports');
  await loadReports();
});

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function loadReports() {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await fetchFromAPI({ action: 'getMyDailyReports', agentName: session.name });
    if (!result.success) throw new Error(result.message || 'Failed to load reports');
    allReports = result.data || [];
    renderReports(allReports);
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><p>Error: ' + esc(err.message) + '</p></div>';
  }
}

function applyFilter() {
  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;
  let filtered = allReports;
  if (from) filtered = filtered.filter(r => r.date >= from);
  if (to) filtered = filtered.filter(r => r.date <= to);
  renderReports(filtered);
}

function clearFilter() {
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  renderReports(allReports);
}

function toggleReport(idx) {
  const card = document.getElementById('rcard-' + idx);
  if (card) card.classList.toggle('open');
}

function renderReports(reports) {
  const container = document.getElementById('reportsContainer');
  if (!reports.length) {
    container.innerHTML = '<div class="empty-state">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<p>No reports found.</p></div>';
    return;
  }

  let html = '';
  reports.forEach((r, idx) => {
    html += '<div class="report-card" id="rcard-' + idx + '">' +
      '<div class="report-card-header" onclick="toggleReport(' + idx + ')">' +
        '<div style="display:flex;align-items:center;gap:0.75rem;">' +
          '<span class="date">' + esc(r.date) + '</span>' +
          '<span class="submitted-time">' + esc(r.submittedAt) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:0.75rem;">' +
          '<div class="badges">' +
            '<span class="badge-stat blue">' + r.quotationsSent + ' Quotations</span>' +
            '<span class="badge-stat orange">' + r.prsSent + ' PRs</span>' +
            '<span class="badge-stat green">' + r.totalCalls + ' Calls</span>' +
            '<span class="badge-stat blue">' + r.leadsEmails + ' Leads</span>' +
            '<span class="badge-stat blue">' + r.followUpEmails + ' Follow-ups</span>' +
          '</div>' +
          '<svg class="chevron-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</div>' +
      '</div>' +
      '<div class="report-card-body"><div class="report-card-body-inner">';

    // Leads Emails
    if (r.leadsEmailDetails && r.leadsEmailDetails.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Leads Emails (' + r.leadsEmailDetails.length + ')</div>' +
        '<table class="detail-table"><thead><tr><th>Recipient</th><th>Company</th><th>Subject / Purpose</th></tr></thead><tbody>';
      r.leadsEmailDetails.forEach(e => {
        html += '<tr><td>' + esc(e.recipient) + '</td><td>' + esc(e.company) + '</td><td>' + esc(e.detail) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Follow Up Emails
    if (r.followUpEmailDetails && r.followUpEmailDetails.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Follow Up Emails (' + r.followUpEmailDetails.length + ')</div>' +
        '<table class="detail-table"><thead><tr><th>Recipient</th><th>Company</th><th>Reference</th></tr></thead><tbody>';
      r.followUpEmailDetails.forEach(e => {
        html += '<tr><td>' + esc(e.recipient) + '</td><td>' + esc(e.company) + '</td><td>' + esc(e.detail) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Calls
    if (r.callDetails && r.callDetails.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Calls (' + r.successfulCalls + ' successful, ' + r.unsuccessfulCalls + ' unsuccessful)</div>' +
        '<table class="detail-table"><thead><tr><th>Contact</th><th>Company</th><th>Status</th></tr></thead><tbody>';
      r.callDetails.forEach(c => {
        const cls = c.status === 'Successful' ? 'success' : 'fail';
        html += '<tr><td>' + esc(c.contact) + '</td><td>' + esc(c.company) + '</td><td><span class="status-pill ' + cls + '">' + esc(c.status) + '</span></td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Outreach channels (counters)
    const linkedinN = parseInt(r.linkedinOutreach, 10) || 0;
    const smsN = parseInt(r.smsViberOutreach, 10) || 0;
    const litN = parseInt(r.literatureSent, 10) || 0;
    if (linkedinN || smsN || litN) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Outreach Channels</div>' +
        '<table class="detail-table"><tbody>' +
        '<tr><td>LinkedIn</td><td>' + linkedinN + '</td></tr>' +
        '<tr><td>SMS / Viber</td><td>' + smsN + '</td></tr>' +
        '<tr><td>Literature Sent</td><td>' + litN + '</td></tr>' +
        '</tbody></table></div>';
    }

    // Prospecting
    if (r.prospectingDetails && r.prospectingDetails.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Prospecting (' + r.prospectingDetails.length + ')</div>' +
        '<table class="detail-table"><thead><tr><th>Company</th><th>Contact</th><th>Source</th><th>Action</th><th>Notes</th></tr></thead><tbody>';
      r.prospectingDetails.forEach(p => {
        html += '<tr><td>' + esc(p.company) + '</td><td>' + esc(p.contact) + '</td><td>' + esc(p.source) + '</td><td>' + esc(p.action) + '</td><td>' + esc(p.notes) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Pipeline Activity
    if (r.pipelineDetails && r.pipelineDetails.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Pipeline Activity (' + r.pipelineDetails.length + ')</div>' +
        '<table class="detail-table"><thead><tr><th>Client</th><th>Contact</th><th>Stage</th><th>DM</th><th>BANT</th><th>Products</th><th>Notes</th></tr></thead><tbody>';
      r.pipelineDetails.forEach(p => {
        html += '<tr><td>' + esc(p.client) + '</td><td>' + esc(p.contact) + '</td><td>' + esc(p.stage) + '</td>' +
          '<td>' + (p.decisionMaker ? '✓' : '') + '</td>' +
          '<td>' + (p.bantQualified ? '✓' : '') + '</td>' +
          '<td>' + esc(p.products) + '</td><td>' + esc(p.notes) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Accreditations
    if (r.accreditationDetails && r.accreditationDetails.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">Accreditations (' + r.accreditationDetails.length + ')</div>' +
        '<table class="detail-table"><thead><tr><th>Client</th><th>Type</th><th>Document / Status</th><th>Notes</th></tr></thead><tbody>';
      r.accreditationDetails.forEach(a => {
        html += '<tr><td>' + esc(a.client) + '</td><td>' + esc(a.type) + '</td><td>' + esc(a.status) + '</td><td>' + esc(a.notes) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Urgent Issues
    if (r.urgentIssues && r.urgentIssues.length) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title" style="color:#ef4444;">Urgent Issues (' + r.urgentIssues.length + ')</div>';
      r.urgentIssues.forEach(u => {
        html += '<div class="urgent-card"><div class="cat">' + esc(u.category) + '</div><div class="desc">' + esc(u.description) + '</div></div>';
      });
      html += '</div>';
    }

    // Other Task / Notes
    if (r.otherTask && String(r.otherTask).trim()) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title" style="color:#b45309;">Other Task / Notes</div>' +
        '<div style="padding:0.6rem 0.8rem;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;white-space:pre-wrap;font-size:0.85rem;line-height:1.45;">' + esc(r.otherTask) + '</div>' +
        '</div>';
    }

    html += '</div></div></div>';
  });

  container.innerHTML = html;
}
