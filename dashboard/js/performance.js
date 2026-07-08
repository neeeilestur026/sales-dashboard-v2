/* ═══════════════════════════════════════════════
   performance.js — Client Tracker for sales agents
   ═══════════════════════════════════════════════ */

let session = null;
let allRecords = [];
let revisionTargetIdx = null;
let showAllDates = false;   // false = last 3 days only

document.addEventListener('DOMContentLoaded', async () => {
  session = requireSales();
  if (!session) return;

  renderNavbar('performance');
  await loadTracker();
});

async function loadTracker() {
  const container = document.getElementById('trackerContainer');
  container.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>`;
  document.getElementById('trackerCount').textContent = '';

  try {
    const result = await apiGetClientTracker(session.name, {
      quotationSheetId: session.quotationSheetId
    });

    if (!result.success) throw new Error(result.message || 'Failed to load data');

    allRecords = result.data || [];
    applyFilters();
  } catch (err) {
    console.error('Client Tracker error:', err);
    container.innerHTML = `
      <div class="no-results">
        <p>Could not load data: ${err.message}</p>
      </div>`;
  }
}

function applyFilters() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusVal = document.getElementById('statusFilter').value;

  let filtered = allRecords.filter(r => {
    if (statusVal && r.status.toLowerCase() !== statusVal.toLowerCase()) return false;
    if (search) {
      const hay = [r.clientName, r.documentNumber, r.rfqSource].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    // Date gate: unless "show all" or user is searching, only show last 3 days
    if (!showAllDates && !search) {
      if (r.daysSinceSent > 3) return false;
    }
    return true;
  });

  renderTable(filtered);
}

/**
 * Toggle between showing last 3 days vs all records
 */
function toggleDateRange() {
  showAllDates = !showAllDates;
  const btn = document.getElementById('dateRangeBtn');
  if (btn) {
    btn.textContent = showAllDates ? 'Show Last 3 Days' : 'Show All Records';
  }
  applyFilters();
}

function renderTable(records) {
  const container = document.getElementById('trackerContainer');
  const countEl = document.getElementById('trackerCount');
  countEl.textContent = `Showing ${records.length} record${records.length !== 1 ? 's' : ''}`;

  if (records.length === 0) {
    container.innerHTML = `<div class="no-results"><p>No records match your filters.</p></div>`;
    return;
  }

  let rows = records.map((r, idx) => {
    const statusKey = (r.status || 'Pending').toLowerCase();
    let statusClass = 'badge-pending';
    if (statusKey === 'replied') statusClass = 'badge-replied';
    else if (statusKey === 'won') statusClass = 'badge-won';
    else if (statusKey === 'lost') statusClass = 'badge-lost';
    else if (statusKey === 'closed') statusClass = 'badge-closed';

    const statusOptions = `
        <option value="Pending" ${statusKey==='pending'?'selected':''}>Pending</option>
        <option value="Replied" ${statusKey==='replied'?'selected':''}>Replied</option>
        <option value="Won" ${statusKey==='won'?'selected':''}>Won</option>
        <option value="Lost" ${statusKey==='lost'?'selected':''}>Lost</option>
        <option value="Closed" ${statusKey==='closed'?'selected':''}>Closed</option>`;

    const statusDropdown = `
      <select class="status-select ${statusClass}" data-idx="${idx}" onchange="updateStatus(this)">
        ${statusOptions}
      </select>`;

    const days = r.daysSinceSent;
    let daysClass = 'days-fresh';
    if (days > 30) daysClass = 'days-stale';
    else if (days > 14) daysClass = 'days-old';
    else if (days > 7) daysClass = 'days-ok';
    const daysBadge = `<span class="days-badge ${daysClass}">${days}d ago</span>`;

    const amount = r.amount ? `₱${Number(r.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '—';
    const rfqSource = r.rfqSource || '—';

    // Approval status for quotations
    let approvalBadge = '';
    if (r.overallStatus) {
      const aKey = r.overallStatus.toLowerCase();
      let aClass = 'badge-pending';
      if (aKey === 'approved') aClass = 'badge-won';
      else if (aKey === 'rejected') aClass = 'badge-lost';
      else if (aKey === 'partially approved') aClass = 'badge-replied';
      else if (aKey === 'pending approval') aClass = 'badge-pending';
      approvalBadge = `<span class="badge ${aClass}">${escapeHtml(r.overallStatus)}</span>`;

      // Add Revise button for rejected quotations
      if (aKey === 'rejected' && r.driveLink) {
        approvalBadge += ` <button class="btn-revise" onclick="openRevisionModal(${idx})">Revise</button>`;
      }
    }

    // Auto-set follow-up to 7 days after date sent if not already set
    let followUpVal = r.followUpDate || '';
    let followUpSuggested = false;
    if (!followUpVal && r.dateSent) {
      const sent = new Date(followUpToISO(r.dateSent));
      if (!isNaN(sent)) {
        sent.setDate(sent.getDate() + 7);
        followUpVal = sent.toISOString().split('T')[0];
        followUpSuggested = true;
      }
    }
    const followUpISO = followUpToISO(followUpVal);
    const followUpInput = `<input type="date" class="followup-input${followUpSuggested ? ' followup-suggested' : ''}" value="${followUpISO}" data-idx="${idx}" data-suggested="${followUpSuggested}" onchange="updateFollowUp(this)">`;

    // Highlight if follow-up is today or overdue
    let followUpClass = '';
    if (followUpISO) {
      const fDate = new Date(followUpISO);
      const now = new Date(); now.setHours(0,0,0,0); fDate.setHours(0,0,0,0);
      if (fDate <= now) followUpClass = 'followup-due';
    }

    return `<tr>
      <td><strong>${escapeHtml(r.clientName)}</strong></td>
      <td style="color:var(--text-muted)">${escapeHtml(r.documentNumber)}</td>
      <td style="color:var(--text-muted)">${r.dateSent}</td>
      <td>${daysBadge}</td>
      <td>${statusDropdown}</td>
      <td class="${followUpClass}">${followUpInput}</td>
      <td style="color:var(--text-muted)">${amount}</td>
      <td style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(rfqSource)}</td>
      <td>${approvalBadge}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="tracker-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Document #</th>
          <th>Date Sent</th>
          <th>Age</th>
          <th>Status</th>
          <th>Follow Up</th>
          <th>Amount</th>
          <th>RFQ Source</th>
          <th>Approval</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function updateStatus(el) {
  const idx = parseInt(el.dataset.idx);
  const filtered = getFilteredRecords();
  const record = filtered[idx];
  if (!record) return;

  const newStatus = el.value;
  el.disabled = true;

  try {
    const res = await apiUpdateTrackerRow({
      sheetId: record.sheetId,
      rowIndex: record.rowIndex,
      sheetType: record.type,
      status: newStatus
    });
    if (res.success) {
      record.status = newStatus;
      el.className = 'status-select badge-' + newStatus.toLowerCase().replace(/ /g, '-');
    } else {
      alert('Failed to update: ' + (res.message || 'Unknown error'));
      el.value = record.status;
    }
  } catch (err) {
    alert('Error: ' + err.message);
    el.value = record.status;
  }
  el.disabled = false;
}

async function updateFollowUp(el) {
  const idx = parseInt(el.dataset.idx);
  const filtered = getFilteredRecords();
  const record = filtered[idx];
  if (!record) return;

  const newDate = el.value;
  el.disabled = true;

  try {
    const res = await apiUpdateTrackerRow({
      sheetId: record.sheetId,
      rowIndex: record.rowIndex,
      sheetType: record.type,
      followUpDate: newDate
    });
    if (res.success) {
      record.followUpDate = newDate;
      el.dataset.suggested = 'false';
      el.classList.remove('followup-suggested');
      const td = el.closest('td');
      if (newDate) {
        const fDate = new Date(newDate);
        const now = new Date(); now.setHours(0,0,0,0); fDate.setHours(0,0,0,0);
        td.className = fDate <= now ? 'followup-due' : '';
      } else {
        td.className = '';
      }
    } else {
      alert('Failed to update: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
  el.disabled = false;
}

function getFilteredRecords() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusVal = document.getElementById('statusFilter').value;

  return allRecords.filter(r => {
    if (statusVal && r.status.toLowerCase() !== statusVal.toLowerCase()) return false;
    if (search) {
      const hay = [r.clientName, r.documentNumber, r.rfqSource].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (!showAllDates && !search) {
      if (r.daysSinceSent > 3) return false;
    }
    return true;
  });
}

// Convert "Apr 2, 2026" or "2026-04-02" to "2026-04-02" for date input
function followUpToISO(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toISOString().split('T')[0];
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function exportTrackerExcel() {
  if (!allRecords || allRecords.length === 0) return;
  try { await loadXLSX(); } catch (e) { alert('Failed to load Excel library'); return; }
  const headers = ['Client', 'Document #', 'Date Sent', 'Days Since', 'Status', 'Follow Up', 'Amount', 'RFQ Source'];
  const rows = allRecords.map(r => [
    r.clientName, r.documentNumber, r.dateSent,
    r.daysSinceSent, r.status, r.followUpDate || '',
    r.amount || '', r.rfqSource || ''
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Client Tracker');
  XLSX.writeFile(wb, `client-tracker-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ═══════════════════════════════════════════════
   Quotation Revision Modal — for rejected quotations
   ═══════════════════════════════════════════════ */

function openRevisionModal(idx) {
  const filtered = getFilteredRecords();
  const record = filtered[idx];
  if (!record) return;

  revisionTargetIdx = idx;

  // Populate details
  const details = document.getElementById('revisionDetails');
  details.innerHTML = `
    <div class="detail-row"><span class="detail-label">Client</span><span class="detail-value">${escapeHtml(record.clientName)}</span></div>
    <div class="detail-row"><span class="detail-label">Document #</span><span class="detail-value">${escapeHtml(record.documentNumber)}</span></div>
    <div class="detail-row"><span class="detail-label">Date Sent</span><span class="detail-value">${record.dateSent}</span></div>
    <div class="detail-row"><span class="detail-label">Current Amount</span><span class="detail-value">₱${Number(record.amount || 0).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
    <div class="detail-row"><span class="detail-label">Current PDF</span><span class="detail-value"><a href="${escapeHtml(record.driveLink)}" target="_blank" style="color:#3b82f6;">View Current PDF</a></span></div>`;

  // Reset form
  document.getElementById('revisionPdfInput').value = '';
  document.getElementById('revisionAmountInput').value = '';
  document.getElementById('revisionError').style.display = 'none';
  document.getElementById('revisionProgress').style.display = 'none';
  document.getElementById('btnSubmitRevision').disabled = false;

  document.getElementById('revisionOverlay').classList.add('open');
}

function closeRevisionModal() {
  document.getElementById('revisionOverlay').classList.remove('open');
  revisionTargetIdx = null;
}

async function submitRevision() {
  const filtered = getFilteredRecords();
  const record = filtered[revisionTargetIdx];
  if (!record) return;

  const errorEl = document.getElementById('revisionError');
  const progressEl = document.getElementById('revisionProgress');
  const progressText = document.getElementById('revisionProgressText');
  const submitBtn = document.getElementById('btnSubmitRevision');
  const fileInput = document.getElementById('revisionPdfInput');
  const amountInput = document.getElementById('revisionAmountInput');

  errorEl.style.display = 'none';
  submitBtn.disabled = true;

  let pdfBase64 = null;
  let newDriveLink = record.driveLink;

  // If new PDF provided, upload it
  if (fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      errorEl.textContent = 'Please upload a PDF file.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      return;
    }

    progressEl.style.display = 'flex';
    progressText.textContent = 'Uploading new PDF...';

    try {
      pdfBase64 = await readFileAsBase64(file);
      const uploadRes = await apiUploadQuotationPDF(pdfBase64, file.name, session.name);
      if (!uploadRes.success) throw new Error(uploadRes.message || 'PDF upload failed');
      newDriveLink = uploadRes.driveLink;
    } catch (err) {
      errorEl.textContent = 'PDF upload failed: ' + err.message;
      errorEl.style.display = 'block';
      progressEl.style.display = 'none';
      submitBtn.disabled = false;
      return;
    }
  }

  // Call revise API
  progressEl.style.display = 'flex';
  progressText.textContent = 'Submitting revision...';

  try {
    const reviseData = {
      sheetId: record.sheetId,
      rowIndex: record.rowIndex,
      driveLink: newDriveLink,
      totalAmount: amountInput.value || String(record.amount || '')
    };

    const res = await apiReviseQuotation(reviseData);
    if (!res.success) throw new Error(res.message || 'Revision failed');

    progressText.textContent = 'Revision submitted!';
    setTimeout(() => {
      closeRevisionModal();
      loadTracker();
    }, 1000);
  } catch (err) {
    errorEl.textContent = 'Revision failed: ' + err.message;
    errorEl.style.display = 'block';
    progressEl.style.display = 'none';
    submitBtn.disabled = false;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
