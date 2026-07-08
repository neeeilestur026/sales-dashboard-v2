/* ═══════════════════════════════════════════════
   hr-grievances.js — Grievances & Complaints logic
   ═══════════════════════════════════════════════ */

let grievancesData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-grievances');

  // Auto-fill Submitted By with session name
  const nameField = document.getElementById('grvSubmittedBy');
  if (session.fullName) nameField.value = session.fullName;

  await loadGrievances();
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
  document.getElementById('grievanceForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Submit Grievance';
  document.getElementById('submitBtn').textContent = 'Submit Grievance';
  document.getElementById('formMsg').style.display = 'none';

  // Hide edit-only fields
  document.querySelectorAll('.edit-only').forEach(el => el.classList.remove('visible'));

  // Re-fill submitted by
  const session = getSession();
  if (session && session.fullName) {
    document.getElementById('grvSubmittedBy').value = session.fullName;
  }

  editingRow = null;
}

function editGrievance(rowIndex) {
  const g = grievancesData.find(item => item.rowIndex === rowIndex);
  if (!g) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('grvSubject').value = g.subject;
  document.getElementById('grvDescription').value = g.description;
  document.getElementById('grvSubmittedBy').value = g.submittedBy;
  document.getElementById('grvAnonymous').checked = (g.anonymous === 'Yes');
  document.getElementById('grvCategory').value = g.category || 'General';
  document.getElementById('grvStatus').value = g.status || 'Open';
  document.getElementById('grvAssignedTo').value = g.assignedTo || '';
  document.getElementById('grvResolution').value = g.resolution || '';

  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Grievance';
  document.getElementById('submitBtn').textContent = 'Update Grievance';

  // Show edit-only fields
  document.querySelectorAll('.edit-only').forEach(el => el.classList.add('visible'));

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitGrievance(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const session = getSession();
  const data = {
    subject: document.getElementById('grvSubject').value.trim(),
    description: document.getElementById('grvDescription').value.trim(),
    submittedBy: document.getElementById('grvSubmittedBy').value.trim(),
    anonymous: document.getElementById('grvAnonymous').checked ? 'Yes' : 'No',
    category: document.getElementById('grvCategory').value,
    createdBy: session ? session.fullName : ''
  };

  // Include edit-only fields when editing
  if (editingRow !== null) {
    data.status = document.getElementById('grvStatus').value;
    data.assignedTo = document.getElementById('grvAssignedTo').value.trim();
    data.resolution = document.getElementById('grvResolution').value.trim();
  }

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateGrievance(data);
    } else {
      btn.textContent = 'Submitting...';
      result = await apiAddGrievance(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadGrievances();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Grievance' : 'Submit Grievance';
}

async function deleteGrievance(rowIndex) {
  if (!confirm('Delete this grievance? This cannot be undone.')) return;
  try {
    const result = await apiDeleteGrievance(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadGrievances();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadGrievances() {
  const container = document.getElementById('grievanceContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const params = {};
  const filterStatus = document.getElementById('filterStatus').value;
  const filterCategory = document.getElementById('filterCategory').value;
  if (filterStatus) params.status = filterStatus;
  if (filterCategory) params.category = filterCategory;

  try {
    const result = await apiGetGrievances(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    grievancesData = result.data || [];
    updateStats();
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function filterGrievances() {
  loadGrievances();
}

function updateStats() {
  let open = 0, investigation = 0, resolved = 0, dismissed = 0;
  grievancesData.forEach(g => {
    switch (g.status) {
      case 'Open': open++; break;
      case 'Under Investigation': investigation++; break;
      case 'Resolved': resolved++; break;
      case 'Dismissed': dismissed++; break;
    }
  });
  document.getElementById('statOpen').textContent = open;
  document.getElementById('statInvestigation').textContent = investigation;
  document.getElementById('statResolved').textContent = resolved;
  document.getElementById('statDismissed').textContent = dismissed;
}

function getStatusClass(status) {
  switch (status) {
    case 'Open': return 'status-open';
    case 'Under Investigation': return 'status-investigation';
    case 'Resolved': return 'status-resolved';
    case 'Dismissed': return 'status-dismissed';
    default: return 'status-open';
  }
}

function getCategoryClass(category) {
  switch (category) {
    case 'Workplace': return 'cat-workplace';
    case 'Harassment': return 'cat-harassment';
    case 'Compensation': return 'cat-compensation';
    case 'Policy': return 'cat-policy';
    case 'General': return 'cat-general';
    default: return 'cat-general';
  }
}

function renderTable() {
  const container = document.getElementById('grievanceContainer');

  if (grievancesData.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No grievances found.</div>';
    return;
  }

  let html = '<table class="grv-table"><thead><tr>' +
    '<th>#</th><th>Subject</th><th>Category</th><th>Submitted By</th><th>Status</th><th>Assigned To</th><th>Created</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  grievancesData.forEach(g => {
    const statusCls = getStatusClass(g.status);
    const catCls = getCategoryClass(g.category);
    const displayName = g.anonymous === 'Yes' ? 'Anonymous' : esc(g.submittedBy);

    html += '<tr>' +
      '<td>' + g.rowIndex + '</td>' +
      '<td><strong>' + esc(g.subject) + '</strong>' +
        (g.description ? '<br><span style="font-size:0.75rem;color:var(--text-muted);">' + esc(g.description).substring(0, 80) + (g.description.length > 80 ? '...' : '') + '</span>' : '') +
      '</td>' +
      '<td><span class="cat-badge ' + catCls + '">' + esc(g.category) + '</span></td>' +
      '<td>' + displayName + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(g.status) + '</span></td>' +
      '<td>' + esc(g.assignedTo) + '</td>' +
      '<td>' + esc(g.createdDate) + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-sm btn-secondary" onclick="editGrievance(' + g.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteGrievance(' + g.rowIndex + ')" title="Delete">Del</button>' +
      '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
