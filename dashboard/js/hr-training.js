/* ═══════════════════════════════════════════════
   hr-training.js — Training & Development logic
   ═══════════════════════════════════════════════ */

let trainingData = [];
let editingRow = null;

const STATUS_CLASS = {
  'Scheduled': 'status-scheduled',
  'In Progress': 'status-inprogress',
  'Completed': 'status-completed'
};

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-training');
  await loadTraining();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('trnForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Training Program';
  document.getElementById('submitBtn').textContent = 'Add Program';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editTraining(rowIndex) {
  const t = trainingData.find(x => x.rowIndex === rowIndex);
  if (!t) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('trnTitle').value = t.title || '';
  document.getElementById('trnType').value = t.type || '';
  document.getElementById('trnInstructor').value = t.instructor || '';
  document.getElementById('trnDate').value = t.date || '';
  document.getElementById('trnDuration').value = t.duration || '';
  document.getElementById('trnDepartment').value = t.department || '';
  document.getElementById('trnStatus').value = t.status || 'Scheduled';
  document.getElementById('trnAttendees').value = t.attendees || '';
  document.getElementById('trnNotes').value = t.notes || '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Training Program';
  document.getElementById('submitBtn').textContent = 'Update Program';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitTraining(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    title: document.getElementById('trnTitle').value.trim(),
    type: document.getElementById('trnType').value,
    instructor: document.getElementById('trnInstructor').value.trim(),
    date: document.getElementById('trnDate').value,
    duration: document.getElementById('trnDuration').value.trim(),
    department: document.getElementById('trnDepartment').value.trim(),
    status: document.getElementById('trnStatus').value,
    attendees: document.getElementById('trnAttendees').value.trim(),
    notes: document.getElementById('trnNotes').value.trim()
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateTrainingProgram(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddTrainingProgram(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadTraining();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Program' : 'Add Program';
}

async function deleteTraining(rowIndex) {
  if (!confirm('Delete this training program? This cannot be undone.')) return;
  try {
    const result = await apiDeleteTrainingProgram(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadTraining();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadTraining() {
  const container = document.getElementById('trnContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const params = {};
    const filterStatus = document.getElementById('filterStatus').value;
    const filterType = document.getElementById('filterType').value;
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.type = filterType;

    const result = await apiGetTrainingPrograms(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    trainingData = result.data || [];
    updateStats();
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function updateStats() {
  const container = document.getElementById('statsRow');
  let scheduled = 0, inProgress = 0, completed = 0;
  trainingData.forEach(t => {
    if (t.status === 'Scheduled') scheduled++;
    else if (t.status === 'In Progress') inProgress++;
    else if (t.status === 'Completed') completed++;
  });

  container.innerHTML =
    '<div class="mini-stat"><div class="num" style="color:#3b82f6;">' + scheduled + '</div><div class="lbl">Scheduled</div></div>' +
    '<div class="mini-stat"><div class="num" style="color:#eab308;">' + inProgress + '</div><div class="lbl">In Progress</div></div>' +
    '<div class="mini-stat"><div class="num" style="color:#22c55e;">' + completed + '</div><div class="lbl">Completed</div></div>';
}

function filterTraining() {
  clearApiCache();
  loadTraining();
}

function renderTable() {
  const container = document.getElementById('trnContainer');

  if (trainingData.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No training programs found.</div>';
    return;
  }

  const session = getSession();
  const isAdmin = session && session.role === 'admin';

  let html = '<table class="trn-table"><thead><tr>' +
    '<th>Title</th><th>Type</th><th>Instructor</th><th>Date</th><th>Duration</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  trainingData.forEach(t => {
    const statusCls = STATUS_CLASS[t.status] || 'status-scheduled';

    html += '<tr>' +
      '<td><strong>' + esc(t.title) + '</strong>' +
        (t.department ? '<br><span style="font-size:0.75rem;color:var(--text-muted);">' + esc(t.department) + '</span>' : '') +
      '</td>' +
      '<td><span class="type-badge">' + esc(t.type) + '</span></td>' +
      '<td>' + esc(t.instructor) + '</td>' +
      '<td>' + esc(t.date) + '</td>' +
      '<td>' + esc(t.duration) + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(t.status || 'Scheduled') + '</span></td>' +
      '<td style="white-space:nowrap;">';

    if (!isAdmin) {
      html += '<button class="btn btn-sm btn-secondary" onclick="editTraining(' + t.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteTraining(' + t.rowIndex + ')" title="Delete">Del</button>';
    } else {
      html += '<span style="color:var(--text-muted);font-size:0.78rem;">View only</span>';
    }

    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
