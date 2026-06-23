/* ═══════════════════════════════════════════════
   hr-recruitment.js — Recruitment Pipeline logic
   ═══════════════════════════════════════════════ */

let pipelineData = [];
let editingRow = null;

const STAGES = ['Job Posted', 'Resume Screening', 'Initial Interview', 'Final Interview', 'Job Offer', 'Onboarding', 'Complete'];
const STAGE_CLASS = {
  'Job Posted': 'stage-posted',
  'Resume Screening': 'stage-screening',
  'Initial Interview': 'stage-initial',
  'Final Interview': 'stage-final',
  'Job Offer': 'stage-offer',
  'Onboarding': 'stage-onboarding',
  'Complete': 'stage-complete'
};

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-recruitment');
  await Promise.all([loadPipeline(), loadStats()]);
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
  document.getElementById('recForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Candidate';
  document.getElementById('submitBtn').textContent = 'Add Candidate';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editCandidate(rowIndex) {
  const c = pipelineData.find(x => x.rowIndex === rowIndex);
  if (!c) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('candName').value = c.candidateName;
  document.getElementById('candPosition').value = c.position;
  document.getElementById('candStage').value = c.stage || 'Job Posted';
  document.getElementById('candDate').value = c.dateApplied;
  document.getElementById('candHR').value = c.assignedHR;
  document.getElementById('candNotes').value = c.notes;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Candidate';
  document.getElementById('submitBtn').textContent = 'Update Candidate';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitCandidate(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    candidateName: document.getElementById('candName').value.trim(),
    position: document.getElementById('candPosition').value.trim(),
    stage: document.getElementById('candStage').value,
    dateApplied: document.getElementById('candDate').value,
    assignedHR: document.getElementById('candHR').value.trim(),
    notes: document.getElementById('candNotes').value.trim()
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateCandidate(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddCandidate(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await Promise.all([loadPipeline(), loadStats()]);
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Candidate' : 'Add Candidate';
}

async function deleteCandidate(rowIndex, name) {
  if (!confirm('Delete candidate "' + name + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteCandidate(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadPipeline(), loadStats()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function advanceStage(rowIndex, currentStage) {
  const idx = STAGES.indexOf(currentStage);
  if (idx < 0 || idx >= STAGES.length - 1) return;
  const nextStage = STAGES[idx + 1];
  try {
    const result = await apiUpdateCandidate({ rowIndex: String(rowIndex), stage: nextStage });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadPipeline(), loadStats()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadStats() {
  try {
    const result = await apiGetRecruitmentStats();
    if (!result.success || !result.data) return;
    const stats = result.data;
    const container = document.getElementById('statsRow');
    let html = '<div class="mini-stat"><div class="num">' + stats.total + '</div><div class="lbl">Total</div></div>';
    STAGES.forEach(s => {
      html += '<div class="mini-stat"><div class="num">' + (stats.byStage[s] || 0) + '</div><div class="lbl">' + s + '</div></div>';
    });
    container.innerHTML = html;
  } catch (err) { /* ignore */ }
}

async function loadPipeline() {
  const container = document.getElementById('recContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await apiGetRecruitmentPipeline();
    if (!result.success) throw new Error(result.message || 'Failed');
    pipelineData = result.data || [];
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderTable() {
  const container = document.getElementById('recContainer');
  const filterStage = document.getElementById('filterStage').value;
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = pipelineData.filter(c => {
    if (filterStage && c.stage !== filterStage) return false;
    if (search && !(c.candidateName || '').toLowerCase().includes(search) && !(c.position || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No candidates found.</div>';
    return;
  }

  const session = getSession();
  const isAdmin = session && session.role === 'admin';

  let html = '<table class="rec-table"><thead><tr>' +
    '<th>Candidate</th><th>Position</th><th>Stage</th><th>Date Applied</th><th>Assigned HR</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(c => {
    const cls = STAGE_CLASS[c.stage] || 'stage-posted';
    const stageIdx = STAGES.indexOf(c.stage);
    const canAdvance = stageIdx >= 0 && stageIdx < STAGES.length - 1;

    html += '<tr>' +
      '<td><strong>' + esc(c.candidateName) + '</strong>' + (c.notes ? '<br><span style="font-size:0.75rem;color:var(--text-muted);">' + esc(c.notes).substring(0, 60) + '</span>' : '') + '</td>' +
      '<td>' + esc(c.position) + '</td>' +
      '<td><span class="stage-badge ' + cls + '">' + esc(c.stage) + '</span></td>' +
      '<td>' + esc(c.dateApplied) + '</td>' +
      '<td>' + esc(c.assignedHR) + '</td>' +
      '<td style="white-space:nowrap;">';

    if (!isAdmin) {
      if (canAdvance) {
        html += '<button class="btn btn-sm" style="background:rgba(59,130,246,0.12);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);margin-right:0.2rem;" onclick="advanceStage(' + c.rowIndex + ',\'' + esc(c.stage) + '\')" title="Advance to next stage">Next</button>';
      }
      html += '<button class="btn btn-sm btn-secondary" onclick="editCandidate(' + c.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteCandidate(' + c.rowIndex + ',\'' + esc(c.candidateName).replace(/'/g, "\\'") + '\')" title="Delete">Del</button>';
    } else {
      html += '<span style="color:var(--text-muted);font-size:0.78rem;">View only</span>';
    }

    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
