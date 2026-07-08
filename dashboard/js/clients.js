/* ═══════════════════════════════════════════════
   clients.js — Client List page logic
   ═══════════════════════════════════════════════ */

let session = null;
let allClients = [];
let editingRowIndex = null;

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAuth();
  if (!session) return;

  const isAdmin = session.role === 'admin';
  renderNavbar(isAdmin ? 'admin-clients' : 'clients');

  // Show agent filter for admin
  if (isAdmin) {
    document.getElementById('agentFilter').style.display = '';
    loadAgentFilter();
  }

  await loadClients();
});

// ─── Helpers ─────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function typeBadge(type) {
  var t = (type || 'Active').toLowerCase();
  var cls = 'type-active';
  if (t === 'inactive') cls = 'type-inactive';
  else if (t === 'prospect') cls = 'type-prospect';
  else if (t === 'vip') cls = 'type-vip';
  return '<span class="type-badge ' + cls + '">' + esc(type || 'Active') + '</span>';
}

// ─── Agent Filter (Admin) ─────────────────────────
async function loadAgentFilter() {
  try {
    var result = await apiGetTeamSummary();
    if (!result.success || !result.data) return;
    var select = document.getElementById('agentFilter');
    result.data.forEach(function(a) {
      var opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      select.appendChild(opt);
    });
  } catch (e) {}
}

// ─── Form Toggle ──────────────────────────────────
function toggleForm() {
  var section = document.getElementById('formSection');
  var label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

// ─── Load Clients ─────────────────────────────────
async function loadClients() {
  var container = document.getElementById('clientContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  var search = (document.getElementById('searchInput').value || '').trim();
  var clientType = document.getElementById('typeFilter').value;
  var agentName = '';

  if (session.role === 'admin') {
    agentName = document.getElementById('agentFilter').value;
  } else {
    agentName = session.name;
  }

  try {
    var result = await apiGetClients(agentName, search, clientType);
    if (!result.success) throw new Error(result.message || 'Failed');

    allClients = result.data || [];
    document.getElementById('clientCount').textContent = allClients.length + ' client' + (allClients.length !== 1 ? 's' : '');
    renderTable(allClients);
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

// ─── Render Table ─────────────────────────────────
function renderTable(data) {
  var container = document.getElementById('clientContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted,#64748b);">No clients found. Click "Show Form" to add one.</div>';
    return;
  }

  var isAdmin = session.role === 'admin';
  var html = '<table class="cl-table"><thead><tr>';
  if (isAdmin) html += '<th>Agent</th>';
  html += '<th>Company Name</th><th>Industry</th><th>Contact Person</th><th>Position</th><th>Mobile #</th><th>Email</th><th>Type</th><th>Date Added</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  data.forEach(function(c, idx) {
    html += '<tr>';
    if (isAdmin) html += '<td style="font-size:0.78rem;color:var(--text-muted);">' + esc(c.agentName) + '</td>';
    html += '<td style="font-weight:600;">' + esc(c.companyName) + '</td>';
    html += '<td>' + esc(c.industry) + '</td>';
    html += '<td>' + esc(c.contactPerson) + '</td>';
    html += '<td style="font-size:0.78rem;">' + esc(c.position) + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(c.mobile) + '</td>';
    html += '<td style="font-size:0.8rem;">' + esc(c.email) + '</td>';
    html += '<td>' + typeBadge(c.clientType) + '</td>';
    html += '<td style="white-space:nowrap;font-size:0.78rem;">' + esc(c.dateAdded) + '</td>';
    html += '<td style="white-space:nowrap;">';
    html += '<button class="act-btn act-edit" onclick="editClient(' + idx + ')" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
    html += '<button class="act-btn act-del" onclick="deleteClient(' + c.rowIndex + ')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Submit (Add or Update) ──────────────────────
async function submitClient(e) {
  e.preventDefault();
  var btn = document.getElementById('submitBtn');
  var msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  var data = {
    agentName: session.role === 'admin' ? (document.getElementById('agentFilter').value || session.name) : session.name,
    companyName: document.getElementById('clCompany').value.trim(),
    industry: document.getElementById('clIndustry').value.trim(),
    siteAddress: document.getElementById('clSiteAddress').value.trim(),
    tel: document.getElementById('clTel').value.trim(),
    headOffice: document.getElementById('clHeadOffice').value.trim(),
    headOfficeTel: document.getElementById('clHeadOfficeTel').value.trim(),
    contactPerson: document.getElementById('clContactPerson').value.trim(),
    position: document.getElementById('clPosition').value.trim(),
    mobile: document.getElementById('clMobile').value.trim(),
    email: document.getElementById('clEmail').value.trim(),
    clientType: document.getElementById('clType').value,
    notes: document.getElementById('clNotes').value.trim()
  };

  try {
    var result;
    if (editingRowIndex !== null) {
      data.rowIndex = editingRowIndex;
      result = await apiUpdateClient(data);
    } else {
      result = await apiAddClient(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = editingRowIndex ? 'Client updated!' : 'Client added!';

    cancelEdit();
    clearApiCache();
    await loadClients();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }

  btn.disabled = false;
}

// ─── Edit Client ──────────────────────────────────
function editClient(idx) {
  var c = allClients[idx];
  if (!c) return;

  editingRowIndex = c.rowIndex;
  document.getElementById('editRowIndex').value = c.rowIndex;
  document.getElementById('clCompany').value = c.companyName;
  document.getElementById('clIndustry').value = c.industry;
  document.getElementById('clSiteAddress').value = c.siteAddress;
  document.getElementById('clTel').value = c.tel;
  document.getElementById('clHeadOffice').value = c.headOffice;
  document.getElementById('clHeadOfficeTel').value = c.headOfficeTel;
  document.getElementById('clContactPerson').value = c.contactPerson;
  document.getElementById('clPosition').value = c.position;
  document.getElementById('clMobile').value = c.mobile;
  document.getElementById('clEmail').value = c.email;
  document.getElementById('clType').value = c.clientType || 'Active';
  document.getElementById('clNotes').value = c.notes;

  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Client';
  document.getElementById('submitBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Update Client';

  // Open form if closed
  var section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();

  // Scroll to form
  document.getElementById('formTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Cancel Edit / Clear Form ─────────────────────
function cancelEdit() {
  editingRowIndex = null;
  document.getElementById('editRowIndex').value = '';
  document.getElementById('clientForm').reset();
  document.getElementById('clType').value = 'Active';
  document.getElementById('formMsg').style.display = 'none';

  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add New Client';
  document.getElementById('submitBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Add Client';
}

// ─── Delete Client ────────────────────────────────
async function deleteClient(rowIndex) {
  if (!confirm('Are you sure you want to delete this client?')) return;

  try {
    var result = await apiDeleteClient(rowIndex);
    if (!result.success) throw new Error(result.message || 'Failed');
    clearApiCache();
    await loadClients();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── Export Excel ─────────────────────────────────
async function exportClientsExcel() {
  if (!allClients.length) return;
  await loadXLSX();

  var isAdmin = session.role === 'admin';
  var headers = isAdmin
    ? ['Agent', 'Company Name', 'Industry', 'Site Address', 'Tel #', 'Head Office', 'Head Office Tel #', 'Contact Person', 'Position', 'Mobile #', 'Email', 'Client Type', 'Date Added', 'Notes']
    : ['Company Name', 'Industry', 'Site Address', 'Tel #', 'Head Office', 'Head Office Tel #', 'Contact Person', 'Position', 'Mobile #', 'Email', 'Client Type', 'Date Added', 'Notes'];

  var rows = allClients.map(function(c) {
    var row = [c.companyName, c.industry, c.siteAddress, c.tel, c.headOffice, c.headOfficeTel, c.contactPerson, c.position, c.mobile, c.email, c.clientType, c.dateAdded, c.notes];
    if (isAdmin) row.unshift(c.agentName);
    return row;
  });

  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  XLSX.writeFile(wb, 'clients-' + new Date().toISOString().slice(0,10) + '.xlsx');
}
