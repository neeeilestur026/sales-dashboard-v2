/* ═══════════════════════════════════════════════
   hr-campaigns.js — Marketing Campaign Tracker logic
   ═══════════════════════════════════════════════ */

let campaignsData = [];
let editingRow = null;

const STATUS_CLASS = {
  'Planning': 'status-planning',
  'Active': 'status-active',
  'Paused': 'status-paused',
  'Completed': 'status-completed'
};

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-campaigns');
  await Promise.all([loadCampaignStats(), loadCampaigns()]);
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatCurrency(num) {
  const n = parseFloat(num) || 0;
  return 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('campForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Campaign';
  document.getElementById('submitBtn').textContent = 'Add Campaign';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editCampaign(rowIndex) {
  const c = campaignsData.find(x => x.rowIndex === rowIndex);
  if (!c) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('campName').value = c.campaignName || '';
  document.getElementById('campChannel').value = c.channel || '';
  document.getElementById('campStartDate').value = c.startDate || '';
  document.getElementById('campEndDate').value = c.endDate || '';
  document.getElementById('campBudget').value = c.budget || '';
  document.getElementById('campSpend').value = c.spend || '';
  document.getElementById('campLeads').value = c.leads || '';
  document.getElementById('campStatus').value = c.status || 'Planning';
  document.getElementById('campNotes').value = c.notes || '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Campaign';
  document.getElementById('submitBtn').textContent = 'Update Campaign';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitCampaign(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    campaignName: document.getElementById('campName').value.trim(),
    channel: document.getElementById('campChannel').value,
    startDate: document.getElementById('campStartDate').value,
    endDate: document.getElementById('campEndDate').value,
    budget: document.getElementById('campBudget').value,
    spend: document.getElementById('campSpend').value,
    leads: document.getElementById('campLeads').value,
    status: document.getElementById('campStatus').value,
    notes: document.getElementById('campNotes').value.trim()
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateCampaign(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddCampaign(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await Promise.all([loadCampaignStats(), loadCampaigns()]);
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Campaign' : 'Add Campaign';
}

async function deleteCampaign(rowIndex) {
  if (!confirm('Delete this campaign? This cannot be undone.')) return;
  try {
    const result = await apiDeleteCampaign(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadCampaignStats(), loadCampaigns()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadCampaignStats() {
  try {
    const result = await apiGetCampaignStats();
    if (!result.success || !result.data) return;
    const s = result.data;
    document.getElementById('statActive').textContent = s.active || 0;
    document.getElementById('statBudget').textContent = formatCurrency(s.totalBudget);
    document.getElementById('statSpend').textContent = formatCurrency(s.totalSpend);
    document.getElementById('statLeads').textContent = s.totalLeads || 0;
  } catch (err) { /* ignore */ }
}

async function loadCampaigns() {
  const container = document.getElementById('campContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const params = {};
  const status = document.getElementById('filterStatus').value;
  const channel = document.getElementById('filterChannel').value;
  if (status) params.status = status;
  if (channel) params.channel = channel;

  try {
    const result = await apiGetCampaigns(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    campaignsData = result.data || [];
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function filterCampaigns() {
  loadCampaigns();
}

function renderTable() {
  const container = document.getElementById('campContainer');

  if (campaignsData.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No campaigns found.</div>';
    return;
  }

  const session = getSession();
  const isAdmin = session && session.role === 'admin';

  let html = '<table class="camp-table"><thead><tr>' +
    '<th>Name</th><th>Channel</th><th>Start Date</th><th>End Date</th><th>Budget</th><th>Spend</th><th>Leads</th><th>ROI</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  campaignsData.forEach(c => {
    const statusCls = STATUS_CLASS[c.status] || 'status-planning';
    const budget = parseFloat(c.budget) || 0;
    const spend = parseFloat(c.spend) || 0;
    const leads = parseInt(c.leads) || 0;

    // ROI: leads per spend ratio
    let roiHtml = '<span style="color:var(--text-muted);">-</span>';
    if (spend > 0) {
      const ratio = (leads / spend).toFixed(2);
      roiHtml = '<span style="color:#22c55e;font-weight:600;">' + ratio + '</span><span style="color:var(--text-muted);font-size:0.72rem;"> leads/PHP</span>';
    }

    html += '<tr>' +
      '<td><strong>' + esc(c.campaignName) + '</strong>' +
        (c.notes ? '<br><span style="font-size:0.75rem;color:var(--text-muted);">' + esc(c.notes).substring(0, 60) + (c.notes.length > 60 ? '...' : '') + '</span>' : '') +
      '</td>' +
      '<td><span class="channel-badge">' + esc(c.channel) + '</span></td>' +
      '<td>' + esc(c.startDate) + '</td>' +
      '<td>' + esc(c.endDate) + '</td>' +
      '<td>' + formatCurrency(budget) + '</td>' +
      '<td>' + formatCurrency(spend) + '</td>' +
      '<td>' + leads + '</td>' +
      '<td>' + roiHtml + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(c.status || 'Planning') + '</span></td>' +
      '<td style="white-space:nowrap;">';

    if (!isAdmin) {
      html += '<button class="btn btn-sm btn-secondary" onclick="editCampaign(' + c.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteCampaign(' + c.rowIndex + ')" title="Delete">Del</button>';
    } else {
      html += '<span style="color:var(--text-muted);font-size:0.78rem;">View only</span>';
    }

    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
