/* ═══════════════════════════════════════════════
   po-approvals.js — PO dual-approval workflow
   Mirrors quotation-approvals.js pattern.
   Admin + Management must both approve.
   ═══════════════════════════════════════════════ */

let session = null;
let allPOs = [];
let emailPoNo = '';

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAdminOrManagement();
  if (!session) return;

  renderNavbar('po-approvals');
  await loadApprovals();
});

async function loadApprovals() {
  const container = document.getElementById('trackerContainer');
  container.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>`;
  document.getElementById('trackerCount').textContent = '';

  try {
    const res = await apiGetPORecords();
    if (!res.success) throw new Error(res.message || 'Failed to load data');
    allPOs = res.data || [];
    applyFilters();
  } catch (err) {
    console.error('PO Approvals error:', err);
    container.innerHTML = `<div class="no-results"><p>Could not load data: ${escapeHtml(err.message)}</p></div>`;
  }
}

function getFilteredRecords() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusVal = document.getElementById('statusFilter').value;
  const range = document.getElementById('dateRange') ? document.getElementById('dateRange').value : 'all';
  const tab = document.getElementById('archiveFilter') ? document.getElementById('archiveFilter').value : 'all';

  const ARCHIVE = ['Approved', 'Sent to Supplier', 'Rejected'];

  return allPOs.filter(r => {
    if (range !== 'all') {
      const d = new Date(r.date);
      if (isNaN(d)) return false;
      const cutoff = new Date();
      if (range === '7d') cutoff.setDate(cutoff.getDate() - 7);
      else if (range === '30d') cutoff.setDate(cutoff.getDate() - 30);
      else if (range === '90d') cutoff.setDate(cutoff.getDate() - 90);
      else if (range === 'year') { cutoff.setMonth(0); cutoff.setDate(1); }
      if (d < cutoff) return false;
    }
    if (tab === 'active') {
      if (ARCHIVE.includes(r.overallStatus)) return false;
    } else if (tab === 'archive') {
      if (!ARCHIVE.includes(r.overallStatus)) return false;
    }
    if (statusVal && r.overallStatus !== statusVal) return false;
    if (search) {
      const hay = [r.poNo, r.vendorName, r.referenceNo, r.createdBy].join(' ').toLowerCase();
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
  countEl.textContent = `Showing ${records.length} PO${records.length !== 1 ? 's' : ''}`;

  if (records.length === 0) {
    container.innerHTML = `<div class="no-results"><p>No PO records found.</p></div>`;
    return;
  }

  const isAdmin = session.role === 'admin';
  const isMgmt = session.role === 'management';

  let rows = records.map((r, idx) => {
    const sym = r.currency === 'USD' ? '$' : r.currency === 'EUR' ? '\u20AC' : '\u20B1';
    const amount = r.totalAmount ? `${sym}${Number(r.totalAmount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '\u2014';

    // Overall status badge
    const overallKey = (r.overallStatus || 'Pending Approval').toLowerCase();
    let overallClass = 'badge-pending-approval';
    if (overallKey === 'partially approved') overallClass = 'badge-partially-approved';
    else if (overallKey === 'approved') overallClass = 'badge-approved';
    else if (overallKey === 'rejected') overallClass = 'badge-rejected';
    else if (overallKey === 'sent to supplier') overallClass = 'badge-sent';

    // Admin approval badge
    const adminKey = (r.adminApproval || 'Pending').toLowerCase();
    let adminClass = 'badge-pending';
    if (adminKey === 'approved') adminClass = 'badge-approved';
    else if (adminKey === 'rejected') adminClass = 'badge-rejected';

    // Mgmt approval badge
    const mgmtKey = (r.mgmtApproval || 'Pending').toLowerCase();
    let mgmtClass = 'badge-pending';
    if (mgmtKey === 'approved') mgmtClass = 'badge-approved';
    else if (mgmtKey === 'rejected') mgmtClass = 'badge-rejected';

    // Action buttons (role-aware)
    let actions = '';
    if (isAdmin && adminKey === 'pending') {
      actions = `
        <button class="btn-approve" onclick="event.stopPropagation();approvePO(${idx}, 'admin', 'Approved')">Approve</button>
        <button class="btn-reject" onclick="event.stopPropagation();approvePO(${idx}, 'admin', 'Rejected')">Reject</button>`;
    } else if (isMgmt && mgmtKey === 'pending') {
      actions = `
        <button class="btn-approve" onclick="event.stopPropagation();approvePO(${idx}, 'management', 'Approved')">Approve</button>
        <button class="btn-reject" onclick="event.stopPropagation();approvePO(${idx}, 'management', 'Rejected')">Reject</button>`;
    } else if ((isAdmin || isMgmt) && r.overallStatus === 'Approved') {
      actions = `<button class="btn-send" onclick="event.stopPropagation();openEmailModal('${escapeHtml(r.poNo).replace(/'/g, "\\'")}')">Send to Supplier</button>`;
    } else {
      const decided = isAdmin ? (r.adminApproval || 'Pending') : (r.mgmtApproval || 'Pending');
      actions = `<span class="badge ${isAdmin ? adminClass : mgmtClass}">${escapeHtml(decided)}</span>`;
    }

    return `<tr style="cursor:pointer" onclick="openPreview(${idx})" title="Click to preview">
      <td style="font-weight:600;">${escapeHtml(r.createdBy)}</td>
      <td><strong>${escapeHtml(r.vendorName)}</strong>${r.vendorEmail ? `<br><span style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(r.vendorEmail)}</span>` : ''}</td>
      <td style="color:#6366f1;font-weight:600;">${escapeHtml(r.poNo)}</td>
      <td style="font-weight:600;">${amount}</td>
      <td><span class="badge ${adminClass}">${escapeHtml(r.adminApproval || 'Pending')}</span></td>
      <td><span class="badge ${mgmtClass}">${escapeHtml(r.mgmtApproval || 'Pending')}</span></td>
      <td><span class="badge ${overallClass}">${escapeHtml(r.overallStatus || 'Pending Approval')}</span></td>
      <td><div class="approval-cell">${actions}</div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="tracker-table">
      <thead>
        <tr>
          <th>Created By</th>
          <th>Vendor</th>
          <th>PO No</th>
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

  document.getElementById('previewTitle').textContent = `Purchase Order: ${r.poNo || 'Preview'}`;

  const sym = r.currency === 'USD' ? '$' : r.currency === 'EUR' ? '\u20AC' : '\u20B1';
  const amount = r.totalAmount ? `${sym}${Number(r.totalAmount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '\u2014';

  const adminKey = (r.adminApproval || 'Pending').toLowerCase();
  let adminClass = 'badge-pending';
  if (adminKey === 'approved') adminClass = 'badge-approved';
  else if (adminKey === 'rejected') adminClass = 'badge-rejected';

  const mgmtKey = (r.mgmtApproval || 'Pending').toLowerCase();
  let mgmtClass = 'badge-pending';
  if (mgmtKey === 'approved') mgmtClass = 'badge-approved';
  else if (mgmtKey === 'rejected') mgmtClass = 'badge-rejected';

  const overallKey = (r.overallStatus || 'Pending Approval').toLowerCase();
  let overallClass = 'badge-pending-approval';
  if (overallKey === 'partially approved') overallClass = 'badge-partially-approved';
  else if (overallKey === 'approved') overallClass = 'badge-approved';
  else if (overallKey === 'rejected') overallClass = 'badge-rejected';
  else if (overallKey === 'sent to supplier') overallClass = 'badge-sent';

  document.getElementById('previewDetails').innerHTML = `
    <div class="detail-row"><span class="detail-label">Created By</span><span class="detail-value">${escapeHtml(r.createdBy)}</span></div>
    <div class="detail-row"><span class="detail-label">Vendor</span><span class="detail-value">${escapeHtml(r.vendorName)}</span></div>
    <div class="detail-row"><span class="detail-label">Vendor Email</span><span class="detail-value">${r.vendorEmail ? `<a href="mailto:${escapeHtml(r.vendorEmail)}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(r.vendorEmail)}</a>` : '\u2014'}</span></div>
    <div class="detail-row"><span class="detail-label">PO No</span><span class="detail-value" style="font-weight:700;color:#6366f1;">${escapeHtml(r.poNo)}</span></div>
    <div class="detail-row"><span class="detail-label">Reference No</span><span class="detail-value">${escapeHtml(r.referenceNo || '\u2014')}</span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${escapeHtml(r.date)}</span></div>
    <div class="detail-row"><span class="detail-label">Total Amount</span><span class="detail-value" style="font-weight:700;font-size:1rem;">${amount} ${escapeHtml(r.currency)}</span></div>
    ${r.itemsSummary ? `<div class="detail-row"><span class="detail-label">Items</span><span class="detail-value" style="white-space:pre-wrap;font-size:0.78rem;">${escapeHtml(r.itemsSummary)}</span></div>` : ''}
    <hr style="border:none;border-top:1px solid var(--border,#334155);margin:0.75rem 0;">
    <div class="detail-row"><span class="detail-label">Admin Approval</span><span class="detail-value"><span class="badge ${adminClass}">${escapeHtml(r.adminApproval || 'Pending')}</span></span></div>
    <div class="detail-row"><span class="detail-label">Management Approval</span><span class="detail-value"><span class="badge ${mgmtClass}">${escapeHtml(r.mgmtApproval || 'Pending')}</span>${r.mgmtNotes ? `<br><span style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(r.mgmtNotes)}</span>` : ''}</span></div>
    <div class="detail-row"><span class="detail-label">Overall Status</span><span class="detail-value"><span class="badge ${overallClass}">${escapeHtml(r.overallStatus || 'Pending Approval')}</span></span></div>
    ${r.sentAt ? `<div class="detail-row"><span class="detail-label">Sent At</span><span class="detail-value">${escapeHtml(r.sentAt)}</span></div>` : ''}
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
      <p style="font-size:0.75rem;margin-top:0.5rem;">PDF will appear here once the PO is generated and submitted.</p>
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
  } else if (isMgmt && mgmtKey === 'pending') {
    actionBtns += `<button class="btn-approve" onclick="approveFromPreview(${idx}, 'management', 'Approved')" style="padding:0.4rem 1rem;font-size:0.82rem;">Approve</button>`;
    actionBtns += `<button class="btn-reject" onclick="approveFromPreview(${idx}, 'management', 'Rejected')" style="padding:0.4rem 1rem;font-size:0.82rem;">Reject</button>`;
  } else if ((isAdmin || isMgmt) && r.overallStatus === 'Approved') {
    actionBtns += `<button class="btn-send" onclick="openEmailModal('${escapeHtml(r.poNo).replace(/'/g,'&#39;')}')" style="padding:0.4rem 1rem;font-size:0.82rem;">Send to Supplier</button>`;
  }

  actionsEl.innerHTML = actionBtns || '<span style="color:var(--text-muted);font-size:0.82rem;">No actions available</span>';

  document.getElementById('previewOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePreview() {
  document.getElementById('previewOverlay').classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('previewPdf').innerHTML = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePreview(); closeEmailModal(); }
});

async function approveFromPreview(idx, role, decision) {
  await approvePO(idx, role, decision);
  const filtered = getFilteredRecords();
  if (filtered[idx]) {
    openPreview(idx);
  } else {
    closePreview();
  }
}

function extractDriveFileId(url) {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ─── Approval Logic ─────────────────────────────

async function approvePO(idx, role, decision) {
  const filtered = getFilteredRecords();
  const record = filtered[idx];
  if (!record) return;

  if (!confirm(`Are you sure you want to ${decision.toLowerCase()} PO ${record.poNo} for ${record.vendorName}?`)) return;

  try {
    const res = await apiApprovePO({
      poNo: record.poNo,
      approverRole: role,
      decision: decision
    });

    if (res.success) {
      if (role === 'admin') record.adminApproval = decision;
      else record.mgmtApproval = decision;
      record.overallStatus = res.overallStatus || record.overallStatus;
      record.status = res.overallStatus || record.status;
      applyFilters();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── Email Modal (Send to Supplier) ─────────────

function openEmailModal(poNo) {
  const r = allPOs.find(x => x.poNo === poNo);
  if (!r) return;
  emailPoNo = poNo;
  document.getElementById('emailTo').value = r.vendorEmail || '';
  document.getElementById('emailSubject').value = `Purchase Order ${r.poNo}`;
  document.getElementById('emailBody').value =
    `Dear ${r.vendorName},\n\n` +
    `Please find below the details of Purchase Order ${r.poNo}:\n\n` +
    `PO Number  : ${r.poNo}\n` +
    `PO Date    : ${r.date}\n` +
    (r.referenceNo ? `Reference  : ${r.referenceNo}\n` : '') +
    `Total Amount: ${r.currency} ${Number(r.totalAmount || 0).toFixed(2)}\n` +
    (r.itemsSummary ? `\nItems:\n${r.itemsSummary}\n` : '') +
    `\nPlease acknowledge receipt and confirm your availability to fulfill this order.\n\n` +
    `Best regards,\nHi-Escorp Procurement Team`;
  document.getElementById('emailModal').classList.add('open');
}

function closeEmailModal() {
  document.getElementById('emailModal').classList.remove('open');
  emailPoNo = '';
}

async function sendEmail() {
  const to      = document.getElementById('emailTo').value.trim();
  const subject = document.getElementById('emailSubject').value.trim();
  const body    = document.getElementById('emailBody').value.trim();
  if (!to)      { alert('Recipient email is required.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { alert('Please enter a valid email address.'); return; }
  if (!subject) { alert('Subject is required.'); return; }
  if (!body)    { alert('Message body is required.'); return; }
  const btn = document.getElementById('btnSend');
  btn.disabled = true;
  btn.textContent = 'Sending\u2026';
  try {
    const res = await apiSendPOEmail({ poNo: emailPoNo, to, subject, body });
    if (!res.success) throw new Error(res.message);
    alert('Email sent successfully to ' + to);
    closeEmailModal();
    closePreview();
    await loadApprovals();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Email';
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
