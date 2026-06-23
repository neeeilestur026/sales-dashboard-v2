/* ═══════════════════════════════════════════════
   leave-request.js — Sales Leave Request
   ═══════════════════════════════════════════════ */

let session = null;

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAuth();
  if (!session) return;
  renderNavbar('leave-request');
  document.getElementById('leaveEmployee').value = session.name;
  await loadMyLeaves();
});

function calcDays() {
  const start = document.getElementById('leaveStart').value;
  const end = document.getElementById('leaveEnd').value;
  if (start && end) {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const diff = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
    document.getElementById('leaveDays').value = diff > 0 ? diff : '';
  }
}

async function submitLeave(e) {
  e.preventDefault();
  const msgEl = document.getElementById('formMsg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';

  const employee = session.name;
  const leaveType = document.getElementById('leaveType').value;
  const startDate = document.getElementById('leaveStart').value;
  const endDate = document.getElementById('leaveEnd').value;
  const days = document.getElementById('leaveDays').value;
  const reason = document.getElementById('leaveReason').value.trim();

  if (!startDate || !endDate) {
    msgEl.textContent = 'Please select start and end dates.';
    msgEl.className = 'form-msg error';
    return;
  }
  if (new Date(endDate) < new Date(startDate)) {
    msgEl.textContent = 'End date must be after start date.';
    msgEl.className = 'form-msg error';
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const result = await apiAddLeaveRequest({
      employee: employee,
      type: leaveType,
      startDate: startDate,
      endDate: endDate,
      days: days,
      reason: reason
    });

    if (result.success) {
      const pdfLink = result.pdfUrl
        ? ' <a href="' + result.pdfUrl + '" target="_blank" style="color:#3b82f6;text-decoration:underline;">View PDF</a>'
        : '';
      msgEl.innerHTML = 'Leave request submitted successfully!' + pdfLink;
      msgEl.className = 'form-msg success';
      document.getElementById('leaveForm').reset();
      document.getElementById('leaveEmployee').value = session.name;
      await loadMyLeaves();
    } else {
      msgEl.textContent = result.message || 'Failed to submit.';
      msgEl.className = 'form-msg error';
    }
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    msgEl.className = 'form-msg error';
  }

  btn.disabled = false;
  btn.textContent = 'Submit Leave Request';
}

async function loadMyLeaves() {
  const container = document.getElementById('leaveContainer');
  try {
    const result = await apiGetLeaveRequests({ employee: session.name });
    if (!result.success) throw new Error(result.message || 'Failed to load');
    const leaves = result.data || [];
    renderLeaveTable(leaves);
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderLeaveTable(leaves) {
  const container = document.getElementById('leaveContainer');
  if (leaves.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No leave requests yet.</div>';
    return;
  }

  // Sort by created date descending
  leaves.sort(function(a, b) {
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  let rows = leaves.map(function(l) {
    const statusClass = (l.status || 'Pending').toLowerCase();
    return '<tr>' +
      '<td>' + esc(l.type || l.leaveType || '') + '</td>' +
      '<td style="white-space:nowrap">' + esc(l.startDate) + '</td>' +
      '<td style="white-space:nowrap">' + esc(l.endDate) + '</td>' +
      '<td style="text-align:center">' + esc(String(l.days || '')) + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(l.reason) + '">' + esc(l.reason || '') + '</td>' +
      '<td><span class="status-badge status-' + statusClass + '">' + esc(l.status || 'Pending') + '</span></td>' +
      '<td style="color:var(--text-muted);font-size:0.78rem;">' + esc(l.approvedBy || '--') + '</td>' +
      '</tr>';
  }).join('');

  container.innerHTML = '<table class="leave-table"><thead><tr>' +
    '<th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Reason</th><th>Status</th><th>Approved By</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
