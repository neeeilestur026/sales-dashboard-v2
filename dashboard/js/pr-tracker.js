/* ═══════════════════════════════════════════════
   pr-tracker.js — Admin cross-agent PR tracker
   ═══════════════════════════════════════════════ */

let session = null;
let allPRs = [];

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAdmin();
  if (!session) return;

  renderNavbar('pr-tracker');
  await loadPRs();
});

async function loadPRs() {
  const container = document.getElementById('trackerContainer');
  container.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>`;
  document.getElementById('trackerCount').textContent = '';

  try {
    const result = await apiGetAllPRs();
    if (!result.success) throw new Error(result.message || 'Failed to load data');

    allPRs = result.data || [];

    // Populate agent filter
    const agents = [...new Set(allPRs.map(r => r.agentName))].sort();
    const agentFilter = document.getElementById('agentFilter');
    const currentVal = agentFilter.value;
    agentFilter.innerHTML = '<option value="">All Agents</option>' +
      agents.map(a => `<option value="${escapeHtml(a)}"${a === currentVal ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('');

    applyFilters();
  } catch (err) {
    console.error('PR Tracker error:', err);
    container.innerHTML = `<div class="no-results"><p>Could not load data: ${err.message}</p></div>`;
  }
}

function applyFilters() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const agentVal = document.getElementById('agentFilter').value;
  const statusVal = document.getElementById('statusFilter').value;
  const range = document.getElementById('dateRange') ? document.getElementById('dateRange').value : 'all';
  const tab = document.getElementById('archiveFilter') ? document.getElementById('archiveFilter').value : 'all';

  const ARCHIVE = ['Approved', 'Rejected', 'Quoted'];

  let filtered = allPRs.filter(r => {
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
    if (tab === 'active') {
      if (ARCHIVE.includes(r.status)) return false;
    } else if (tab === 'archive') {
      if (!ARCHIVE.includes(r.status)) return false;
    }
    if (agentVal && r.agentName !== agentVal) return false;
    if (statusVal && r.status.toLowerCase() !== statusVal.toLowerCase()) return false;
    if (search) {
      const hay = [r.agentName, r.clientName, r.prNumber, r.itemDescription].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  renderTable(filtered);
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
    if (statusKey === 'for pricing') statusClass = 'badge-for-pricing';
    else if (statusKey === 'for quotation') statusClass = 'badge-for-quotation';
    else if (statusKey === 'approved') statusClass = 'badge-approved';
    else if (statusKey === 'rejected') statusClass = 'badge-rejected';

    const statusDropdown = `
      <select class="status-select ${statusClass}" data-idx="${idx}" onchange="updatePRStatus(this)">
        <option value="Pending" ${statusKey==='pending'?'selected':''}>Pending</option>
        <option value="For Pricing" ${statusKey==='for pricing'?'selected':''}>For Pricing</option>
        <option value="For Quotation" ${statusKey==='for quotation'?'selected':''}>For Quotation</option>
        <option value="Approved" ${statusKey==='approved'?'selected':''}>Approved</option>
        <option value="Rejected" ${statusKey==='rejected'?'selected':''}>Rejected</option>
      </select>`;

    const days = r.daysSinceSent;
    let daysClass = 'days-fresh';
    if (days > 30) daysClass = 'days-stale';
    else if (days > 14) daysClass = 'days-old';
    else if (days > 7) daysClass = 'days-ok';
    const daysBadge = `<span class="days-badge ${daysClass}">${days}d ago</span>`;

    let followUpVal = r.followUpDate || '';
    if (!followUpVal && r.dateSent) {
      const sent = new Date(followUpToISO(r.dateSent));
      if (!isNaN(sent)) {
        sent.setDate(sent.getDate() + 7);
        followUpVal = sent.toISOString().split('T')[0];
      }
    }
    const followUpISO = followUpToISO(followUpVal);
    const followUpInput = `<input type="date" class="followup-input" value="${followUpISO}" data-idx="${idx}" onchange="updatePRFollowUp(this)">`;

    let followUpClass = '';
    if (followUpISO) {
      const fDate = new Date(followUpISO);
      const now = new Date(); now.setHours(0,0,0,0); fDate.setHours(0,0,0,0);
      if (fDate <= now) followUpClass = 'followup-due';
    }

    return `<tr>
      <td style="font-weight:600;">${escapeHtml(r.agentName)}</td>
      <td><strong>${escapeHtml(r.clientName)}</strong></td>
      <td style="color:var(--text-muted)">${escapeHtml(r.prNumber)}</td>
      <td style="color:var(--text-muted)">${r.dateSent}</td>
      <td>${daysBadge}</td>
      <td>${statusDropdown}</td>
      <td class="${followUpClass}">${followUpInput}</td>
      <td style="color:var(--text-muted);font-size:0.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.itemDescription)}">${escapeHtml(r.itemDescription)}</td>
      <td>${r.driveLink ? '<a href="' + escapeHtml(r.driveLink) + '" target="_blank" style="color:#3b82f6;font-size:0.78rem;">View PDF</a>' : '--'}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="tracker-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Company</th>
          <th>PR Number</th>
          <th>Date</th>
          <th>Age</th>
          <th>Status</th>
          <th>Follow Up</th>
          <th>Item Description</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function getFilteredRecords() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const agentVal = document.getElementById('agentFilter').value;
  const statusVal = document.getElementById('statusFilter').value;

  return allPRs.filter(r => {
    if (agentVal && r.agentName !== agentVal) return false;
    if (statusVal && r.status.toLowerCase() !== statusVal.toLowerCase()) return false;
    if (search) {
      const hay = [r.agentName, r.clientName, r.prNumber, r.itemDescription].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

async function updatePRStatus(el) {
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
      sheetType: 'PR',
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

async function updatePRFollowUp(el) {
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
      sheetType: 'PR',
      followUpDate: newDate
    });
    if (res.success) {
      record.followUpDate = newDate;
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

async function exportPRsExcel() {
  if (!allPRs || allPRs.length === 0) return;
  await loadXLSX();
  const headers = ['Agent', 'Company', 'PR Number', 'Ref Number', 'Date', 'Days Since', 'Status', 'Follow Up', 'Item Description'];
  const rows = allPRs.map(r => [
    r.agentName, r.clientName, r.prNumber, r.refNumber, r.dateSent,
    r.daysSinceSent, r.status, r.followUpDate || '', r.itemDescription
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PR Tracker');
  XLSX.writeFile(wb, `pr-tracker-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
