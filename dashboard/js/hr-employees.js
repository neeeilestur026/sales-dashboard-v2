/* ═══════════════════════════════════════════════
   hr-employees.js — Employee Masterlist logic
   ═══════════════════════════════════════════════ */

let employeesData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-employees');
  await loadEmployees();
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
  document.getElementById('empForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Employee';
  document.getElementById('submitBtn').textContent = 'Add Employee';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editEmployee(rowIndex) {
  const emp = employeesData.find(e => e.rowIndex === rowIndex);
  if (!emp) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('empName').value = emp.employeeName;
  document.getElementById('empPosition').value = emp.position;
  document.getElementById('empDepartment').value = emp.department;
  document.getElementById('empDateHired').value = emp.dateHired;
  document.getElementById('empBirthdate').value = emp.birthdate || '';
  document.getElementById('empOnboarding').value = emp.onboardingStatus || 'Pending';
  document.getElementById('empContact').value = emp.contactInfo;
  document.getElementById('empNotes').value = emp.notes;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Employee';
  document.getElementById('submitBtn').textContent = 'Update Employee';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitEmployee(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    employeeName: document.getElementById('empName').value.trim(),
    position: document.getElementById('empPosition').value.trim(),
    department: document.getElementById('empDepartment').value.trim(),
    dateHired: document.getElementById('empDateHired').value,
    onboardingStatus: document.getElementById('empOnboarding').value,
    contactInfo: document.getElementById('empContact').value.trim(),
    notes: document.getElementById('empNotes').value.trim(),
    birthdate: document.getElementById('empBirthdate').value
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateEmployee(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddEmployee(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadEmployees();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Employee' : 'Add Employee';
}

async function deleteEmployee(rowIndex, name) {
  if (!confirm('Delete employee "' + name + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteEmployee(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadEmployees();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadEmployees() {
  const container = document.getElementById('empContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await apiGetEmployees();
    if (!result.success) throw new Error(result.message || 'Failed');
    employeesData = result.data || [];
    document.getElementById('empCount').textContent = employeesData.length + ' employee' + (employeesData.length !== 1 ? 's' : '');
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderTable() {
  const container = document.getElementById('empContainer');
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = employeesData.filter(e => {
    if (!search) return true;
    return (e.employeeName || '').toLowerCase().includes(search) ||
           (e.position || '').toLowerCase().includes(search) ||
           (e.department || '').toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">' + (search ? 'No matching employees.' : 'No employees found.') + '</div>';
    return;
  }

  const session = getSession();
  const isAdmin = session && session.role === 'admin';

  let html = '<table class="emp-table"><thead><tr>' +
    '<th>Name</th><th>Position</th><th>Department</th><th>Date Hired</th><th>Onboarding</th><th>Contact</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(e => {
    const statusCls = e.onboardingStatus === 'Complete' ? 'status-complete' : 'status-pending';
    html += '<tr>' +
      '<td><strong>' + esc(e.employeeName) + '</strong></td>' +
      '<td>' + esc(e.position) + '</td>' +
      '<td>' + esc(e.department) + '</td>' +
      '<td>' + esc(e.dateHired) + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(e.onboardingStatus || 'Pending') + '</span></td>' +
      '<td>' + esc(e.contactInfo) + '</td>' +
      '<td style="white-space:nowrap;">';

    if (!isAdmin) {
      html += '<button class="btn btn-sm btn-secondary" onclick="editEmployee(' + e.rowIndex + ')" style="margin-right:0.3rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteEmployee(' + e.rowIndex + ',\'' + esc(e.employeeName) + '\')" title="Delete">Delete</button>';
    } else {
      html += '<span style="color:var(--text-muted);font-size:0.78rem;">View only</span>';
    }

    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
