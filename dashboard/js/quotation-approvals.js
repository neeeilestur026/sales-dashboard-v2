/* ═══════════════════════════════════════════════
   quotation-approvals.js — Approval workflow
   Admin-created quotations need only management approval.
   Approved quotations can be finalized directly from this page.
   ═══════════════════════════════════════════════ */

let session = null;
let allQuotations = [];

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAdminOrManagement();
  if (!session) return;

  renderNavbar('quotation-approvals');
  await loadApprovals();
});

async function loadApprovals() {
  const container = document.getElementById('trackerContainer');
  container.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>`;
  document.getElementById('trackerCount').textContent = '';

  try {
    const result = await apiGetPendingQuotations();
    if (!result.success) throw new Error(result.message || 'Failed to load data');

    allQuotations = result.data || [];
    applyFilters();
  } catch (err) {
    console.error('Quotation Approvals error:', err);
    container.innerHTML = `<div class="no-results"><p>Could not load data: ${escapeHtml(err.message)}</p></div>`;
  }
}

function getFilteredRecords() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusVal = document.getElementById('statusFilter').value;
  const range = document.getElementById('dateRange') ? document.getElementById('dateRange').value : 'all';
  const tab = document.getElementById('archiveFilter') ? document.getElementById('archiveFilter').value : 'all';

  const ARCHIVE = ['Rejected'];
  const FINALIZED = ['Finalized'];

  return allQuotations.filter(r => {
    // Date range filter
    if (range !== 'all') {
      const d = new Date(r.dateSent);
      if (isNaN(d)) return false;
      const cutoff = new Date();
      if (range === '7d') cutoff.setDate(cutoff.getDate() - 7);
      else if (range === '30d') cutoff.setDate(cutoff.getDate() - 30);
      else if (range === '90d') cutoff.setDate(cutoff.getDate() - 90);
      else if (range === 'year') { cutoff.setMonth(0); cutoff.setDate(1); }
      if (d < cutoff) return false;
    }
    // Active/Archive filter
    if (tab === 'active') {
      if (ARCHIVE.includes(r.overallStatus) || FINALIZED.includes(r.finalizeStatus)) return false;
    } else if (tab === 'archive') {
      if (!ARCHIVE.includes(r.overallStatus) && !FINALIZED.includes(r.finalizeStatus)) return false;
    }
    if (statusVal && r.overallStatus !== statusVal) return false;
    if (search) {
      const hay = [r.agentName, r.clientName, r.refNo, r.rfqNo, r.subject].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function applyFilters() {
  renderTable(getFilteredRecords());
}

function renderTable(records) {
  const container = document.getElementById('trackerContainer');
  const countEl = document.getElementById('trackerCount');
  countEl.textContent = `Showing ${records.length} quotation${records.length !== 1 ? 's' : ''}`;

  if (records.length === 0) {
    container.innerHTML = `<div class="no-results"><p>No quotations found.</p></div>`;
    return;
  }

  const isAdmin = session.role === 'admin';
  const isMgmt = session.role === 'management';

  let rows = records.map((r, idx) => {
    const amount = r.amount ? `₱${Number(r.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '—';

    // Overall status badge
    const overallKey = (r.overallStatus || 'Pending Approval').toLowerCase();
    let overallClass = 'badge-pending-approval';
    if (overallKey === 'partially approved') overallClass = 'badge-partially-approved';
    else if (overallKey === 'approved') overallClass = 'badge-approved';
    else if (overallKey === 'rejected') overallClass = 'badge-rejected';

    // Admin approval badge
    const adminKey = (r.adminApproval || 'Pending').toLowerCase();
    let adminClass = 'badge-pending';
    if (adminKey === 'approved') adminClass = 'badge-approved';
    else if (adminKey === 'rejected') adminClass = 'badge-rejected';

    // Mgmt approval badge
    const mgmtKey = (r.managementApproval || 'Pending').toLowerCase();
    let mgmtClass = 'badge-pending';
    if (mgmtKey === 'approved') mgmtClass = 'badge-approved';
    else if (mgmtKey === 'rejected') mgmtClass = 'badge-rejected';

    // Action buttons (role-aware)
    let actions = '';
    if (isAdmin && adminKey === 'pending') {
      actions = `
        <button class="btn-approve" onclick="event.stopPropagation();approveQuotation(${idx}, 'admin', 'Approved')">Approve</button>
        <button class="btn-reject" onclick="event.stopPropagation();approveQuotation(${idx}, 'admin', 'Rejected')">Reject</button>`;
    } else if (isAdmin && r.overallStatus === 'Approved' && r.finalizeStatus !== 'Finalized') {
      actions = `<button class="btn-approve" style="background:#6366f1;border-color:#6366f1;" onclick="event.stopPropagation();finalizeQuotation(${idx})">Finalize</button>`;
    } else if (isMgmt && mgmtKey === 'pending') {
      actions = `
        <button class="btn-approve" onclick="event.stopPropagation();approveQuotation(${idx}, 'management', 'Approved')">Approve</button>
        <button class="btn-reject" onclick="event.stopPropagation();approveQuotation(${idx}, 'management', 'Rejected')">Reject</button>`;
    } else {
      const decided = isAdmin ? r.adminApproval : r.managementApproval;
      actions = `<span class="badge ${isAdmin ? adminClass : mgmtClass}">${escapeHtml(decided || 'Pending')}</span>`;
    }

    return `<tr style="cursor:pointer" onclick="openPreview(${idx})" title="Click to preview">
      <td style="font-weight:600;">${escapeHtml(r.agentName)}</td>
      <td><strong>${escapeHtml(r.clientName)}</strong></td>
      <td style="color:var(--text-muted)">${escapeHtml(r.refNo)}</td>
      <td style="color:var(--text-muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.subject)}">${escapeHtml(r.subject)}</td>
      <td style="font-weight:600;">${amount}</td>
      <td><span class="badge ${adminClass}">${escapeHtml(r.adminApproval || 'Pending')}</span></td>
      <td><span class="badge ${mgmtClass}">${escapeHtml(r.managementApproval || 'Pending')}</span></td>
      <td><span class="badge ${overallClass}">${escapeHtml(r.overallStatus || 'Pending Approval')}</span></td>
      <td><div class="approval-cell">${actions}</div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="tracker-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Client</th>
          <th>Ref No</th>
          <th>Subject</th>
          <th>Amount</th>
          <th>Admin</th>
          <th>Mgmt</th>
          <th>Overall</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Preview Modal ──────────────────────────────

function openPreview(idx) {
  const filtered = getFilteredRecords();
  const r = filtered[idx];
  if (!r) return;

  const isAdmin = session.role === 'admin';
  const isMgmt = session.role === 'management';

  // Title
  document.getElementById('previewTitle').textContent = `Quotation: ${r.refNo || r.rfqNo || 'Preview'}`;

  // Details panel
  const amount = r.amount ? `₱${Number(r.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '—';

  const adminKey = (r.adminApproval || 'Pending').toLowerCase();
  let adminClass = 'badge-pending';
  if (adminKey === 'approved') adminClass = 'badge-approved';
  else if (adminKey === 'rejected') adminClass = 'badge-rejected';

  const mgmtKey = (r.managementApproval || 'Pending').toLowerCase();
  let mgmtClass = 'badge-pending';
  if (mgmtKey === 'approved') mgmtClass = 'badge-approved';
  else if (mgmtKey === 'rejected') mgmtClass = 'badge-rejected';

  const overallKey = (r.overallStatus || 'Pending Approval').toLowerCase();
  let overallClass = 'badge-pending-approval';
  if (overallKey === 'partially approved') overallClass = 'badge-partially-approved';
  else if (overallKey === 'approved') overallClass = 'badge-approved';
  else if (overallKey === 'rejected') overallClass = 'badge-rejected';

  document.getElementById('previewDetails').innerHTML = `
    <div class="detail-row"><span class="detail-label">Agent</span><span class="detail-value">${escapeHtml(r.agentName)}</span></div>
    <div class="detail-row"><span class="detail-label">Client</span><span class="detail-value">${escapeHtml(r.clientName)}</span></div>
    <div class="detail-row"><span class="detail-label">Contact Person</span><span class="detail-value">${escapeHtml(r.contactPerson || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${r.email ? `<a href="mailto:${escapeHtml(r.email)}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(r.email)}</a>` : '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Reference No</span><span class="detail-value">${escapeHtml(r.refNo)}</span></div>
    <div class="detail-row"><span class="detail-label">RFQ No</span><span class="detail-value">${escapeHtml(r.rfqNo)}</span></div>
    <div class="detail-row"><span class="detail-label">Subject</span><span class="detail-value">${escapeHtml(r.subject)}</span></div>
    <div class="detail-row"><span class="detail-label">Total Amount</span><span class="detail-value" style="font-weight:700;font-size:1rem;">${amount}</span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${escapeHtml(r.dateSent)}</span></div>
    <hr style="border:none;border-top:1px solid var(--border,#334155);margin:0.75rem 0;">
    <div class="detail-row"><span class="detail-label">Admin Approval</span><span class="detail-value"><span class="badge ${adminClass}">${escapeHtml(r.adminApproval || 'Pending')}</span></span></div>
    <div class="detail-row"><span class="detail-label">Management Approval</span><span class="detail-value"><span class="badge ${mgmtClass}">${escapeHtml(r.managementApproval || 'Pending')}</span></span></div>
    <div class="detail-row"><span class="detail-label">Overall Status</span><span class="detail-value"><span class="badge ${overallClass}">${escapeHtml(r.overallStatus || 'Pending Approval')}</span></span></div>
  `;

  // PDF Embed
  const pdfContainer = document.getElementById('previewPdf');
  if (r.driveLink) {
    const fileId = extractDriveFileId(r.driveLink);
    if (fileId) {
      pdfContainer.innerHTML = `<iframe src="https://drive.google.com/file/d/${fileId}/preview" allowfullscreen></iframe>`;
    } else {
      pdfContainer.innerHTML = `<div class="no-pdf">
        <p>Could not embed PDF.</p>
        <a href="${escapeHtml(r.driveLink)}" target="_blank" class="pdf-link" style="font-size:0.9rem;">Open PDF in new tab</a>
      </div>`;
    }
  } else {
    pdfContainer.innerHTML = `<div class="no-pdf">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>No PDF uploaded yet.</p>
      <p style="font-size:0.75rem;margin-top:0.5rem;">The PDF uploads in the background — it may take up to a minute after generation.</p>
      <button onclick="refreshPdfPreview(${idx})" style="margin-top:0.75rem;padding:0.35rem 0.85rem;font-size:0.78rem;border-radius:6px;border:1px solid var(--border,#334155);background:transparent;color:var(--text,#e2e8f0);cursor:pointer;">
        ↻ Refresh PDF
      </button>
    </div>`;
  }

  // Action buttons in modal footer
  const actionsEl = document.getElementById('previewActions');
  let actionBtns = '';

  if (r.driveLink) {
    actionBtns += `<a href="${escapeHtml(r.driveLink)}" target="_blank" class="btn-preview" style="text-decoration:none;">Open PDF in new tab</a>`;
  }

  if (isAdmin && adminKey === 'pending') {
    actionBtns += `<button class="btn-approve" onclick="approveFromPreview(${idx}, 'admin', 'Approved')" style="padding:0.4rem 1rem;font-size:0.82rem;">Approve</button>`;
    actionBtns += `<button class="btn-reject" onclick="approveFromPreview(${idx}, 'admin', 'Rejected')" style="padding:0.4rem 1rem;font-size:0.82rem;">Reject</button>`;
  } else if (isAdmin && r.overallStatus === 'Approved' && r.finalizeStatus !== 'Finalized') {
    actionBtns += `<button class="btn-approve" style="background:#6366f1;border-color:#6366f1;padding:0.4rem 1rem;font-size:0.82rem;" onclick="finalizeFromPreview(${idx})">Finalize</button>`;
  } else if (isMgmt && mgmtKey === 'pending') {
    actionBtns += `<button class="btn-approve" onclick="approveFromPreview(${idx}, 'management', 'Approved')" style="padding:0.4rem 1rem;font-size:0.82rem;">Approve</button>`;
    actionBtns += `<button class="btn-reject" onclick="approveFromPreview(${idx}, 'management', 'Rejected')" style="padding:0.4rem 1rem;font-size:0.82rem;">Reject</button>`;
  }

  actionsEl.innerHTML = actionBtns || '<span style="color:var(--text-muted);font-size:0.82rem;">No actions available</span>';

  // Show modal
  document.getElementById('previewOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePreview() {
  document.getElementById('previewOverlay').classList.remove('open');
  document.body.style.overflow = '';
  // Clear iframe to stop loading
  document.getElementById('previewPdf').innerHTML = '';
}

async function refreshPdfPreview(idx) {
  // Reload approval data then re-open the preview at the same index
  try {
    const result = await apiGetPendingQuotations();
    if (result.success) {
      allQuotations = result.data || [];
      applyFilters();
    }
  } catch (_) {}
  const filtered = getFilteredRecords();
  if (filtered[idx]) openPreview(idx);
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePreview();
});

async function approveFromPreview(idx, role, decision) {
  await approveQuotation(idx, role, decision);
  // Re-open with updated data
  const filtered = getFilteredRecords();
  if (filtered[idx]) {
    openPreview(idx);
  } else {
    closePreview();
  }
}

function extractDriveFileId(url) {
  if (!url) return null;
  // Match /d/FILE_ID/ or id=FILE_ID
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ─── Approval Logic ─────────────────────────────

async function approveQuotation(idx, role, decision) {
  const filtered = getFilteredRecords();
  const record = filtered[idx];
  if (!record) return;

  if (!confirm(`Are you sure you want to ${decision.toLowerCase()} this quotation for ${record.clientName}?`)) return;

  // Disable all approval buttons to prevent double-submit
  document.querySelectorAll('.btn-approve, .btn-reject').forEach(b => b.disabled = true);

  try {
    const res = await apiApproveQuotation({
      sheetId: record.sheetId,
      rowIndex: record.rowIndex,
      approverRole: role,
      decision: decision
    });

    if (res.success) {
      if (role === 'admin') record.adminApproval = decision;
      else record.managementApproval = decision;
      record.overallStatus = res.overallStatus || record.overallStatus;
      applyFilters();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    document.querySelectorAll('.btn-approve, .btn-reject').forEach(b => b.disabled = false);
  }
}

// ─── Finalize Logic ─────────────────────────────

async function finalizeQuotation(idx) {
  const record = getFilteredRecords()[idx];
  if (!record) return;
  if (!confirm(`Finalize quotation ${record.refNo || record.rfqNo || ''} for ${record.clientName}?`)) return;
  try {
    const res = await apiFinalizeQuotation(record.sheetId, record.rowIndex);
    if (res.success) {
      record.finalizeStatus = 'Finalized';
      applyFilters();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function finalizeFromPreview(idx) {
  await finalizeQuotation(idx);
  closePreview();
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
