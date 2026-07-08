/* ═══════════════════════════════════════════════
   hr-accreditations.js — Accreditation & Compliance Tracker logic
   ═══════════════════════════════════════════════ */

let accreditationsData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-accreditations');
  await loadAccreditations();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Form toggle / reset ───────────────────── */

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('accForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Accreditation';
  document.getElementById('submitBtn').textContent = 'Add Accreditation';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

/* ── Edit ───────────────────────────────────── */

function editAccreditation(rowIndex) {
  const acc = accreditationsData.find(a => a.rowIndex === rowIndex);
  if (!acc) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('accName').value = acc.name;
  document.getElementById('accIssuingBody').value = acc.issuingBody;
  document.getElementById('accDateIssued').value = acc.dateIssued || '';
  document.getElementById('accExpiryDate').value = acc.expiryDate || '';
  document.getElementById('accStatus').value = acc.status || 'Active';
  document.getElementById('accDocLink').value = acc.docLink || '';
  document.getElementById('accNotes').value = acc.notes || '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Accreditation';
  document.getElementById('submitBtn').textContent = 'Update Accreditation';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Submit (add / update) ──────────────────── */

async function submitAccreditation(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    name: document.getElementById('accName').value.trim(),
    issuingBody: document.getElementById('accIssuingBody').value.trim(),
    dateIssued: document.getElementById('accDateIssued').value,
    expiryDate: document.getElementById('accExpiryDate').value,
    status: document.getElementById('accStatus').value,
    docLink: document.getElementById('accDocLink').value.trim(),
    notes: document.getElementById('accNotes').value.trim()
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateAccreditation(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddAccreditation(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadAccreditations();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Accreditation' : 'Add Accreditation';
}

/* ── Delete ─────────────────────────────────── */

async function deleteAccreditation(rowIndex, name) {
  if (!confirm('Delete accreditation "' + name + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteAccreditation(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadAccreditations();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ── Expiry status computation ──────────────── */

function computeExpiryStatus(expiryDate) {
  if (!expiryDate) return 'Active';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate + 'T00:00:00');
  if (isNaN(expiry.getTime())) return 'Active';

  const diffMs = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Expired';
  if (diffDays <= 30) return 'Expiring Soon';
  return 'Active';
}

/* ── Load data & compute stats ──────────────── */

async function loadAccreditations() {
  const container = document.getElementById('accContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await apiGetAccreditations();
    if (!result.success) throw new Error(result.message || 'Failed');
    accreditationsData = (result.data || []).map(a => {
      a._computedStatus = computeExpiryStatus(a.expiryDate);
      return a;
    });
    updateStats();
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function updateStats() {
  let active = 0, expiring = 0, expired = 0;
  accreditationsData.forEach(a => {
    const s = a._computedStatus;
    if (s === 'Active') active++;
    else if (s === 'Expiring Soon') expiring++;
    else if (s === 'Expired') expired++;
  });
  document.getElementById('statActive').textContent = active;
  document.getElementById('statExpiring').textContent = expiring;
  document.getElementById('statExpired').textContent = expired;
}

/* ── Filter by status dropdown ──────────────── */

function filterAccreditations() {
  renderTable();
}

/* ── Render table ───────────────────────────── */

function renderTable() {
  const container = document.getElementById('accContainer');
  const filterStatus = document.getElementById('filterStatus').value;
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = accreditationsData.filter(a => {
    // Status filter uses computed status (includes "Expiring Soon")
    if (filterStatus) {
      const displayStatus = a._computedStatus === 'Expiring Soon' ? 'Expiring Soon' : (a.status || 'Active');
      if (filterStatus === 'Expiring Soon') {
        if (a._computedStatus !== 'Expiring Soon') return false;
      } else if (displayStatus !== filterStatus && a._computedStatus !== filterStatus) {
        return false;
      }
    }
    if (search && !(a.name || '').toLowerCase().includes(search) && !(a.issuingBody || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">' + (search || filterStatus ? 'No matching accreditations.' : 'No accreditations found.') + '</div>';
    return;
  }

  let html = '<table class="acc-table"><thead><tr>' +
    '<th>Name</th><th>Issuing Body</th><th>Date Issued</th><th>Expiry Date</th><th>Status</th><th>Document</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(a => {
    const computed = a._computedStatus;
    let badgeCls, badgeLabel;

    if (computed === 'Expired') {
      badgeCls = 'status-expired';
      badgeLabel = 'Expired';
    } else if (computed === 'Expiring Soon') {
      badgeCls = 'status-expiring';
      badgeLabel = 'Expiring Soon';
    } else if (a.status === 'Pending') {
      badgeCls = 'status-pending';
      badgeLabel = 'Pending';
    } else {
      badgeCls = 'status-active';
      badgeLabel = 'Active';
    }

    const rowCls = computed === 'Expiring Soon' ? ' class="row-expiring"' : computed === 'Expired' ? ' class="row-expired"' : '';

    const docCell = a.docLink
      ? '<a class="doc-link" href="' + esc(a.docLink) + '" target="_blank" rel="noopener noreferrer">View</a>'
      : '<span style="color:var(--text-muted);font-size:0.78rem;">--</span>';

    html += '<tr' + rowCls + '>' +
      '<td><strong>' + esc(a.name) + '</strong>' + (a.notes ? '<br><span style="font-size:0.75rem;color:var(--text-muted);">' + esc(a.notes).substring(0, 60) + '</span>' : '') + '</td>' +
      '<td>' + esc(a.issuingBody) + '</td>' +
      '<td>' + esc(a.dateIssued) + '</td>' +
      '<td>' + esc(a.expiryDate) + '</td>' +
      '<td><span class="status-badge ' + badgeCls + '">' + badgeLabel + '</span></td>' +
      '<td>' + docCell + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-sm btn-secondary" onclick="editAccreditation(' + a.rowIndex + ')" style="margin-right:0.3rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteAccreditation(' + a.rowIndex + ',\'' + esc(a.name).replace(/'/g, "\\'") + '\')" title="Delete">Del</button>' +
      '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
