/* ═══════════════════════════════════════════════
   hr-reviews.js — Performance Reviews logic
   ═══════════════════════════════════════════════ */

let reviewsData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-reviews');
  await loadReviews();
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
  document.getElementById('reviewForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Review';
  document.getElementById('submitBtn').textContent = 'Add Review';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editReview(rowIndex) {
  const rev = reviewsData.find(r => r.rowIndex === rowIndex);
  if (!rev) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('revEmployee').value = rev.employeeName;
  document.getElementById('revReviewer').value = rev.reviewer;
  document.getElementById('revPeriod').value = rev.period;
  document.getElementById('revRating').value = rev.overallRating || '';
  document.getElementById('revCategories').value = rev.categoryScores || '';
  document.getElementById('revStrengths').value = rev.strengths || '';
  document.getElementById('revImprovements').value = rev.improvements || '';
  document.getElementById('revStatus').value = rev.status || 'Draft';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Review';
  document.getElementById('submitBtn').textContent = 'Update Review';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitReview(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    employeeName: document.getElementById('revEmployee').value.trim(),
    reviewer: document.getElementById('revReviewer').value.trim(),
    period: document.getElementById('revPeriod').value.trim(),
    overallRating: document.getElementById('revRating').value,
    categoryScores: document.getElementById('revCategories').value.trim(),
    strengths: document.getElementById('revStrengths').value.trim(),
    improvements: document.getElementById('revImprovements').value.trim(),
    status: document.getElementById('revStatus').value
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdatePerformanceReview(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddPerformanceReview(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadReviews();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Review' : 'Add Review';
}

async function deleteReview(rowIndex, name) {
  if (!confirm('Delete performance review for "' + name + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeletePerformanceReview(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadReviews();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadReviews() {
  const container = document.getElementById('reviewContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const params = {};
  const statusFilter = document.getElementById('filterStatus').value;
  const periodFilter = (document.getElementById('filterPeriod').value || '').trim();
  if (statusFilter) params.status = statusFilter;
  if (periodFilter) params.period = periodFilter;

  try {
    const result = await apiGetPerformanceReviews(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    reviewsData = result.data || [];
    document.getElementById('reviewCount').textContent = reviewsData.length + ' review' + (reviewsData.length !== 1 ? 's' : '');
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function filterReviews() {
  loadReviews();
}

function ratingDisplay(rating) {
  const num = parseFloat(rating);
  if (isNaN(num)) return '<span style="color:var(--text-muted,#64748b);">—</span>';
  let cls = 'rating-high';
  if (num < 2) cls = 'rating-low';
  else if (num <= 3) cls = 'rating-mid';
  return '<span class="rating-badge ' + cls + '">' + num.toFixed(1) + '</span>';
}

function renderTable() {
  const container = document.getElementById('reviewContainer');
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = reviewsData.filter(r => {
    if (search && !(r.employeeName || '').toLowerCase().includes(search) && !(r.reviewer || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">' + (search ? 'No matching reviews.' : 'No reviews found.') + '</div>';
    return;
  }

  let html = '<table class="review-table"><thead><tr>' +
    '<th>Employee</th><th>Reviewer</th><th>Period</th><th>Rating</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(r => {
    const statusCls = r.status === 'Completed' ? 'status-completed' : r.status === 'In Progress' ? 'status-progress' : 'status-draft';

    html += '<tr>' +
      '<td><strong>' + esc(r.employeeName) + '</strong></td>' +
      '<td>' + esc(r.reviewer) + '</td>' +
      '<td>' + esc(r.period) + '</td>' +
      '<td>' + ratingDisplay(r.overallRating) + '</td>' +
      '<td><span class="status-badge ' + statusCls + '">' + esc(r.status || 'Draft') + '</span></td>' +
      '<td style="white-space:nowrap;">' +
      '<button class="btn btn-sm btn-secondary" onclick="editReview(' + r.rowIndex + ')" style="margin-right:0.3rem;" title="Edit">Edit</button>' +
      '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteReview(' + r.rowIndex + ',\'' + esc(r.employeeName).replace(/'/g, "\\'") + '\')" title="Delete">Delete</button>' +
      '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
