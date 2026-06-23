/* ═══════════════════════════════════════════════
   hr-leave.js — Leave & Attendance logic
   ═══════════════════════════════════════════════ */

let leaveData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-leave');

  // Auto-calculate days when dates change
  document.getElementById('leaveStart').addEventListener('change', calcDays);
  document.getElementById('leaveEnd').addEventListener('change', calcDays);

  await Promise.all([loadLeaveStats(), loadLeave()]);
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Auto-calculate days ── */
function calcDays() {
  const start = document.getElementById('leaveStart').value;
  const end = document.getElementById('leaveEnd').value;
  if (start && end) {
    const diff = Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
    if (diff > 0) document.getElementById('leaveDays').value = diff;
  }
}

/* ── Form toggle ── */
function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('leaveForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Leave Request';
  document.getElementById('submitBtn').textContent = 'Add Leave Request';
  document.getElementById('formMsg').style.display = 'none';
  document.getElementById('editOnlyStatus').style.display = 'none';
  document.getElementById('editOnlyApprover').style.display = 'none';
  editingRow = null;
}

function editLeave(rowIndex) {
  const item = leaveData.find(l => l.rowIndex === rowIndex);
  if (!item) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('leaveEmployee').value = item.employee || '';
  document.getElementById('leaveType').value = item.type || 'Vacation';
  document.getElementById('leaveStart').value = item.startDate || '';
  document.getElementById('leaveEnd').value = item.endDate || '';
  document.getElementById('leaveDays').value = item.days || '';
  document.getElementById('leaveReason').value = item.reason || '';
  document.getElementById('leaveStatus').value = item.status || 'Pending';
  document.getElementById('leaveApprovedBy').value = item.approvedBy || '';
  document.getElementById('leaveNotes').value = item.notes || '';

  // Show edit-only fields
  document.getElementById('editOnlyStatus').style.display = '';
  document.getElementById('editOnlyApprover').style.display = '';

  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Leave Request';
  document.getElementById('submitBtn').textContent = 'Update Leave Request';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Submit (Add/Update) ── */
async function submitLeave(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    employee: document.getElementById('leaveEmployee').value.trim(),
    type: document.getElementById('leaveType').value,
    startDate: document.getElementById('leaveStart').value,
    endDate: document.getElementById('leaveEnd').value,
    days: document.getElementById('leaveDays').value,
    reason: document.getElementById('leaveReason').value.trim(),
    notes: document.getElementById('leaveNotes').value.trim()
  };

  // Include edit-only fields when editing
  if (editingRow !== null) {
    data.status = document.getElementById('leaveStatus').value;
    data.approvedBy = document.getElementById('leaveApprovedBy').value.trim();
  }

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateLeaveRequest(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddLeaveRequest(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await Promise.all([loadLeaveStats(), loadLeave()]);
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Leave Request' : 'Add Leave Request';
}

/* ── Delete ── */
async function deleteLeave(rowIndex) {
  const item = leaveData.find(l => l.rowIndex === rowIndex);
  const name = item ? item.employee : '';
  if (!confirm('Delete leave request for "' + name + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteLeaveRequest(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadLeaveStats(), loadLeave()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ── Quick Approve / Reject ── */
async function approveLeave(rowIndex) {
  try {
    const session = getSession();
    const result = await apiUpdateLeaveRequest({
      rowIndex: String(rowIndex),
      status: 'Approved',
      approvedBy: session ? session.name : '',
      approverRole: session ? session.role : '',
      approverName: session ? session.name : ''
    });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadLeaveStats(), loadLeave()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function rejectLeave(rowIndex) {
  try {
    const session = getSession();
    const result = await apiUpdateLeaveRequest({
      rowIndex: String(rowIndex),
      status: 'Rejected',
      approvedBy: session ? session.name : '',
      approverRole: session ? session.role : '',
      approverName: session ? session.name : ''
    });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadLeaveStats(), loadLeave()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ── Load Stats ── */
async function loadLeaveStats() {
  try {
    const result = await apiGetLeaveStats();
    if (result.success && result.data) {
      document.getElementById('statPending').textContent = result.data.pending || 0;
      document.getElementById('statApproved').textContent = result.data.approved || 0;
      document.getElementById('statRejected').textContent = result.data.rejected || 0;
    }
  } catch (err) { /* ignore */ }
}

/* ── Load Leave Data ── */
async function loadLeave() {
  const container = document.getElementById('leaveContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const params = {};
  const statusVal = document.getElementById('filterStatus').value;
  const searchVal = (document.getElementById('searchInput').value || '').trim();
  if (statusVal) params.status = statusVal;
  if (searchVal) params.employee = searchVal;

  try {
    const result = await apiGetLeaveRequests(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    leaveData = result.data || [];
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

/* ── Filter (re-fetch from API) ── */
function filterLeave() {
  loadLeave();
}

/* ── Render Table ── */
function renderTable() {
  const container = document.getElementById('leaveContainer');
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = leaveData.filter(l => {
    if (!search) return true;
    return (l.employee || '').toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">' + (search ? 'No matching leave requests.' : 'No leave requests found.') + '</div>';
    return;
  }

  const session = getSession();
  const isAdmin = session && session.role === 'admin';

  let html = '<table class="leave-table"><thead><tr>' +
    '<th>Employee</th><th>Type</th><th>Start Date</th><th>End Date</th><th>Days</th><th>Status</th><th>Approved By</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(l => {
    const statusCls = l.status === 'Approved' ? 'status-approved' : l.status === 'Rejected' ? 'status-rejected' : 'status-pending';

    html += '<tr>' +
      '<td><strong>' + esc(l.employee) + '</strong></td>' +
      '<td>' + esc(l.type) + '</td>' +
      '<td>' + esc(l.startDate) + '</td>' +
      '<td>' + esc(l.endDate) + '</td>' +
      '<td>' + esc(l.days) + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(l.status || 'Pending') + '</span></td>' +
      '<td>' + esc(l.approvedBy) + '</td>' +
      '<td style="white-space:nowrap;">';

    if (isAdmin) {
      html += '<span style="color:var(--text-muted);font-size:0.78rem;">View only</span>';
    } else {
      // Quick approve/reject for pending items (HR can only approve sales)
      if (l.status === 'Pending') {
        var reqRole = String(l.requesterRole || '').toLowerCase();
        if (reqRole === 'sales' || !reqRole) {
          html += '<button class="btn btn-sm" style="background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3);margin-right:0.2rem;" onclick="approveLeave(' + l.rowIndex + ')" title="Approve">Approve</button>' +
            '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);margin-right:0.2rem;" onclick="rejectLeave(' + l.rowIndex + ')" title="Reject">Reject</button>';
        } else {
          html += '<span style="color:var(--text-muted);font-size:0.75rem;margin-right:0.4rem;" title="Management approval required for ' + esc(reqRole) + ' staff">Mgmt only</span>';
        }
      }
      html += '<button class="btn btn-sm btn-secondary" onclick="editLeave(' + l.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteLeave(' + l.rowIndex + ')" title="Delete">Del</button>';
    }

    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
