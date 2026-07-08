/* ═══════════════════════════════════════════════
   hr-tasks.js — Task Tracker logic
   ═══════════════════════════════════════════════ */

let tasksData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-tasks');
  await Promise.all([loadTasks(), loadStats()]);
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('taskForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Task';
  document.getElementById('submitBtn').textContent = 'Add Task';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editTask(rowIndex) {
  const task = tasksData.find(t => t.rowIndex === rowIndex);
  if (!task) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('taskTitle').value = task.title;
  document.getElementById('taskType').value = task.type || 'HR';
  document.getElementById('taskAssigned').value = task.assignedTo;
  document.getElementById('taskStatus').value = task.status || 'Pending';
  document.getElementById('taskDue').value = task.dueDate;
  document.getElementById('taskNotes').value = task.notes;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Task';
  document.getElementById('submitBtn').textContent = 'Update Task';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitTask(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const session = getSession();
  const data = {
    title: document.getElementById('taskTitle').value.trim(),
    type: document.getElementById('taskType').value,
    assignedTo: document.getElementById('taskAssigned').value.trim(),
    status: document.getElementById('taskStatus').value,
    dueDate: document.getElementById('taskDue').value,
    notes: document.getElementById('taskNotes').value.trim(),
    createdBy: session ? session.fullName : ''
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateHRTask(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddHRTask(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await Promise.all([loadTasks(), loadStats()]);
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Task' : 'Add Task';
}

async function deleteTask(rowIndex, title) {
  if (!confirm('Delete task "' + title + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteHRTask(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadTasks(), loadStats()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function quickStatus(rowIndex, newStatus) {
  try {
    const result = await apiUpdateHRTask({ rowIndex: String(rowIndex), status: newStatus });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadTasks(), loadStats()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadStats() {
  try {
    const result = await apiGetHRTaskStats();
    if (result.success && result.data) {
      document.getElementById('statTotal').textContent = result.data.total || 0;
      document.getElementById('statPending').textContent = result.data.pending || 0;
      document.getElementById('statProgress').textContent = result.data.inProgress || 0;
      document.getElementById('statCompleted').textContent = result.data.completed || 0;
      document.getElementById('statOverdue').textContent = result.data.overdue || 0;
    }
  } catch (err) { /* ignore */ }
}

async function loadTasks() {
  const container = document.getElementById('taskContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await apiGetHRTasks();
    if (!result.success) throw new Error(result.message || 'Failed');
    tasksData = result.data || [];
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderTable() {
  const container = document.getElementById('taskContainer');
  const filterType = document.getElementById('filterType').value;
  const filterStatus = document.getElementById('filterStatus').value;
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = tasksData.filter(t => {
    if (filterType && t.type !== filterType) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    if (search && !(t.title || '').toLowerCase().includes(search) && !(t.assignedTo || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No tasks found.</div>';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  let html = '<table class="task-table"><thead><tr>' +
    '<th>Title</th><th>Type</th><th>Assigned To</th><th>Status</th><th>Due Date</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(t => {
    const statusCls = t.status === 'Completed' ? 'status-completed' : t.status === 'In Progress' ? 'status-progress' : 'status-pending';
    const typeCls = t.type === 'Marketing' ? 'type-marketing' : 'type-hr';
    const isOverdue = t.status !== 'Completed' && t.dueDate && t.dueDate < today;

    html += '<tr>' +
      '<td><strong>' + esc(t.title) + '</strong>' + (t.notes ? '<br><span style="font-size:0.75rem;color:var(--text-muted);">' + esc(t.notes).substring(0, 60) + '</span>' : '') + '</td>' +
      '<td><span class="type-badge ' + typeCls + '">' + esc(t.type) + '</span></td>' +
      '<td>' + esc(t.assignedTo) + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(t.status) + '</span></td>' +
      '<td' + (isOverdue ? ' class="overdue"' : '') + '>' + esc(t.dueDate) + (isOverdue ? ' (overdue)' : '') + '</td>' +
      '<td style="white-space:nowrap;">';

    // Quick status buttons
    if (t.status === 'Pending') {
      html += '<button class="btn btn-sm btn-secondary" onclick="quickStatus(' + t.rowIndex + ',\'In Progress\')" style="margin-right:0.2rem;" title="Start">Start</button>';
    }
    if (t.status !== 'Completed') {
      html += '<button class="btn btn-sm" style="background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3);margin-right:0.2rem;" onclick="quickStatus(' + t.rowIndex + ',\'Completed\')" title="Complete">Done</button>';
    }

    html += '<button class="btn btn-sm btn-secondary" onclick="editTask(' + t.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
      '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteTask(' + t.rowIndex + ',\'' + esc(t.title).replace(/'/g, "\\'") + '\')" title="Delete">Del</button>' +
      '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
