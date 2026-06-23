/* ═══════════════════════════════════════════════
   hr-memos.js — Memos & Announcements logic
   ═══════════════════════════════════════════════ */

let memosData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-memos');
  await loadMemos();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Form Toggle / Reset ─────────────────────────

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('memoForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('memoTarget').value = 'All';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Memo';
  document.getElementById('submitBtn').textContent = 'Add Memo';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

// ─── Edit Memo ───────────────────────────────────

function editMemo(rowIndex) {
  const m = memosData.find(x => x.rowIndex === rowIndex);
  if (!m) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('memoTitle').value = m.title || '';
  document.getElementById('memoContent').value = m.content || '';
  document.getElementById('memoType').value = m.type || 'Memo';
  document.getElementById('memoPriority').value = m.priority || 'Normal';
  document.getElementById('memoTarget').value = m.target || 'All';
  document.getElementById('memoStatus').value = m.status || 'Active';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Memo';
  document.getElementById('submitBtn').textContent = 'Update Memo';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Submit Memo (Add / Update) ──────────────────

async function submitMemo(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const session = getSession();
  const data = {
    title: document.getElementById('memoTitle').value.trim(),
    content: document.getElementById('memoContent').value.trim(),
    type: document.getElementById('memoType').value,
    priority: document.getElementById('memoPriority').value,
    target: document.getElementById('memoTarget').value.trim() || 'All',
    status: document.getElementById('memoStatus').value,
    createdBy: session ? session.fullName || session.name : ''
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateMemo(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddMemo(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadMemos();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Memo' : 'Add Memo';
}

// ─── Delete Memo ─────────────────────────────────

async function deleteMemo(rowIndex) {
  const m = memosData.find(x => x.rowIndex === rowIndex);
  const title = m ? m.title : '';
  if (!confirm('Delete memo "' + title + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteMemo(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadMemos();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── Archive Memo (quick status change) ──────────

async function archiveMemo(rowIndex) {
  try {
    const result = await apiUpdateMemo({ rowIndex: String(rowIndex), status: 'Archived' });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadMemos();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── Filter Memos ────────────────────────────────

function filterMemos() {
  loadMemos();
}

// ─── Load Memos ──────────────────────────────────

async function loadMemos() {
  const container = document.getElementById('memoContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const params = {};
  const filterType = document.getElementById('filterType').value;
  const filterStatus = document.getElementById('filterStatus').value;
  if (filterType) params.type = filterType;
  if (filterStatus) params.status = filterStatus;

  try {
    const result = await apiGetMemos(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    memosData = result.data || [];
    renderMemos();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

// ─── Render Memo Cards ───────────────────────────

function renderMemos() {
  const container = document.getElementById('memoContainer');
  const filterPriority = document.getElementById('filterPriority').value;

  const filtered = memosData.filter(m => {
    if (filterPriority && m.priority !== filterPriority) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No memos found.</div>';
    return;
  }

  const typeClass = { 'Memo': 'type-memo', 'Announcement': 'type-announcement', 'Policy Update': 'type-policy' };
  const priorityClass = { 'Low': 'priority-low', 'Normal': 'priority-normal', 'High': 'priority-high', 'Urgent': 'priority-urgent' };

  let html = '<div class="memo-grid">';

  filtered.forEach((m, idx) => {
    const tCls = typeClass[m.type] || 'type-memo';
    const pCls = priorityClass[m.priority] || 'priority-normal';
    const contentText = esc(m.content || '');
    const isLong = (m.content || '').length > 200;
    const contentId = 'memo-content-' + idx;

    html += '<div class="memo-card">';

    // Header: title + badges
    html += '<div class="memo-card-header">';
    html += '<h4 class="memo-card-title">' + esc(m.title) + '</h4>';
    html += '<div class="memo-card-badges">';
    html += '<span class="type-badge ' + tCls + '">' + esc(m.type) + '</span>';
    html += '<span class="priority-badge ' + pCls + '">' + esc(m.priority) + '</span>';
    html += '</div></div>';

    // Content (truncated if long)
    html += '<div class="memo-card-content ' + (isLong ? 'truncated' : '') + '" id="' + contentId + '">' + contentText.replace(/\n/g, '<br>') + '</div>';
    if (isLong) {
      html += '<button class="memo-toggle-btn" onclick="toggleContent(' + idx + ')">Read more</button>';
    }

    // Target
    if (m.target) {
      html += '<div class="memo-target">Target: <strong>' + esc(m.target) + '</strong></div>';
    }

    // Meta
    html += '<div class="memo-card-meta">';
    if (m.createdBy) html += '<span>By: ' + esc(m.createdBy) + '</span>';
    if (m.createdAt) html += '<span>' + esc(m.createdAt) + '</span>';
    if (m.status === 'Archived') html += '<span style="color:#94a3b8;font-weight:600;">Archived</span>';
    html += '</div>';

    // Actions
    html += '<div class="memo-card-actions">';
    html += '<button class="btn btn-sm btn-secondary" onclick="editMemo(' + m.rowIndex + ')" title="Edit">Edit</button>';
    if (m.status !== 'Archived') {
      html += '<button class="btn btn-sm" style="background:rgba(100,116,139,0.12);color:#94a3b8;border:1px solid rgba(100,116,139,0.3);" onclick="archiveMemo(' + m.rowIndex + ')" title="Archive">Archive</button>';
    }
    html += '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteMemo(' + m.rowIndex + ')" title="Delete">Delete</button>';
    html += '</div>';

    html += '</div>'; // .memo-card
  });

  html += '</div>'; // .memo-grid
  container.innerHTML = html;
}

// ─── Toggle Content Expand/Collapse ──────────────

function toggleContent(idx) {
  const el = document.getElementById('memo-content-' + idx);
  if (!el) return;
  const btn = el.nextElementSibling;
  if (el.classList.contains('truncated')) {
    el.classList.remove('truncated');
    el.classList.add('expanded');
    if (btn) btn.textContent = 'Show less';
  } else {
    el.classList.remove('expanded');
    el.classList.add('truncated');
    if (btn) btn.textContent = 'Read more';
  }
}
