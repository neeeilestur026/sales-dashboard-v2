/* ═══════════════════════════════════════════════
   management-leave.js — Management leave approval queue
   ═══════════════════════════════════════════════ */

let leaveData = [];

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireManagement();
  if (!session) return;
  renderNavbar('management-leave');
  await Promise.all([loadLeaveStats(), loadLeave()]);
});

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

async function loadLeave() {
  const container = document.getElementById('leaveContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  const params = {};
  const statusVal = document.getElementById('filterStatus').value;
  if (statusVal) params.status = statusVal;
  try {
    const result = await apiGetLeaveRequests(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    leaveData = result.data || [];
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderTable() {
  const container = document.getElementById('leaveContainer');
  const search = (document.getElementById('searchInput').value || '').toLowerCase();
  const roleFilter = (document.getElementById('filterRole').value || '').toLowerCase();

  const filtered = leaveData.filter(l => {
    const empName = (l.employee || l.employeeName || '').toLowerCase();
    if (search && !empName.includes(search)) return false;
    if (roleFilter && String(l.requesterRole || '').toLowerCase() !== roleFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No matching leave requests.</div>';
    return;
  }

  let html = '<table class="leave-table"><thead><tr>' +
    '<th>Employee</th><th>Role</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Reason</th><th>Status</th><th>Approved By</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(l => {
    const statusCls = l.status === 'Approved' ? 'status-approved' : l.status === 'Rejected' ? 'status-rejected' : 'status-pending';
    const empName = l.employee || l.employeeName || '';
    html += '<tr>' +
      '<td><strong>' + esc(empName) + '</strong></td>' +
      '<td><span class="role-badge">' + esc(l.requesterRole || '—') + '</span></td>' +
      '<td>' + esc(l.type || l.leaveType) + '</td>' +
      '<td>' + esc(l.startDate) + '</td>' +
      '<td>' + esc(l.endDate) + '</td>' +
      '<td>' + esc(l.days) + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(l.reason) + '">' + esc(l.reason) + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(l.status || 'Pending') + '</span></td>' +
      '<td>' + esc(l.approvedBy) + '</td>' +
      '<td style="white-space:nowrap;">';
    if (l.status === 'Pending') {
      html += '<button class="btn btn-sm" style="background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3);margin-right:0.2rem;" onclick="approveLeave(' + l.rowIndex + ')">Approve</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="rejectLeave(' + l.rowIndex + ')">Reject</button>';
    } else {
      html += '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';
    }
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function approveLeave(rowIndex) {
  await _decide(rowIndex, 'Approved');
}

async function rejectLeave(rowIndex) {
  await _decide(rowIndex, 'Rejected');
}

async function _decide(rowIndex, status) {
  try {
    const session = getSession();
    const result = await apiUpdateLeaveRequest({
      rowIndex: String(rowIndex),
      status: status,
      approvedBy: session ? session.name : '',
      approverRole: 'management',
      approverName: session ? session.name : ''
    });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadLeaveStats(), loadLeave()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
