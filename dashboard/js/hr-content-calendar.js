/* ═══════════════════════════════════════════════
   hr-content-calendar.js — Content & Social Media Calendar logic
   ═══════════════════════════════════════════════ */

let contentData = [];
let editingRow = null;

const PLATFORM_CLASS = {
  'Facebook': 'platform-facebook',
  'Instagram': 'platform-instagram',
  'LinkedIn': 'platform-linkedin',
  'Twitter/X': 'platform-twitter',
  'Website': 'platform-website',
  'YouTube': 'platform-youtube'
};

const TYPE_CLASS = {
  'Post': 'type-post',
  'Story': 'type-story',
  'Reel': 'type-reel',
  'Article': 'type-article',
  'Video': 'type-video',
  'Infographic': 'type-infographic'
};

const STATUS_CLASS = {
  'Draft': 'status-draft',
  'Scheduled': 'status-scheduled',
  'Published': 'status-published',
  'Cancelled': 'status-cancelled'
};

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-content-calendar');
  await loadContent();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function platformBadge(platform) {
  const cls = PLATFORM_CLASS[platform] || 'platform-website';
  return '<span class="platform-badge ' + cls + '">' + esc(platform) + '</span>';
}

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetForm() {
  document.getElementById('contentForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Content';
  document.getElementById('submitBtn').textContent = 'Add Content';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editContent(rowIndex) {
  const item = contentData.find(c => c.rowIndex === rowIndex);
  if (!item) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('ccTitle').value = item.title || '';
  document.getElementById('ccType').value = item.type || 'Post';
  document.getElementById('ccPlatform').value = item.platform || 'Facebook';
  document.getElementById('ccDate').value = item.scheduledDate || '';
  document.getElementById('ccStatus').value = item.status || 'Draft';
  document.getElementById('ccContent').value = item.content || '';
  document.getElementById('ccNotes').value = item.notes || '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Content';
  document.getElementById('submitBtn').textContent = 'Update Content';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitContent(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const session = getSession();
  const data = {
    title: document.getElementById('ccTitle').value.trim(),
    type: document.getElementById('ccType').value,
    platform: document.getElementById('ccPlatform').value,
    scheduledDate: document.getElementById('ccDate').value,
    status: document.getElementById('ccStatus').value,
    content: document.getElementById('ccContent').value.trim(),
    notes: document.getElementById('ccNotes').value.trim(),
    createdBy: session ? session.fullName : ''
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateContentItem(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddContentItem(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await loadContent();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Content' : 'Add Content';
}

async function deleteContent(rowIndex) {
  const item = contentData.find(c => c.rowIndex === rowIndex);
  const title = item ? item.title : '';
  if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteContentItem(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadContent();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function publishContent(rowIndex) {
  try {
    const result = await apiUpdateContentItem({ rowIndex: String(rowIndex), status: 'Published' });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadContent();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadContent() {
  const container = document.getElementById('contentContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const params = {};
  const status = document.getElementById('filterStatus').value;
  const platform = document.getElementById('filterPlatform').value;
  if (status) params.status = status;
  if (platform) params.platform = platform;

  try {
    const result = await apiGetContentCalendar(params);
    if (!result.success) throw new Error(result.message || 'Failed');
    contentData = result.data || [];
    renderContent();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function filterContent() {
  clearApiCache();
  loadContent();
}

function renderContent() {
  const container = document.getElementById('contentContainer');
  const filterType = document.getElementById('filterType').value;

  // Apply client-side type filter
  const filtered = contentData.filter(c => {
    if (filterType && c.type !== filterType) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No content found.</div>';
    return;
  }

  // Group by scheduledDate
  const groups = {};
  filtered.forEach(c => {
    const dateKey = c.scheduledDate || 'Unscheduled';
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(c);
  });

  // Sort date keys: actual dates ascending, "Unscheduled" at the end
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === 'Unscheduled') return 1;
    if (b === 'Unscheduled') return -1;
    return a.localeCompare(b);
  });

  let html = '';
  sortedKeys.forEach(dateKey => {
    const displayDate = dateKey === 'Unscheduled' ? 'Unscheduled' : formatDateLabel(dateKey);

    html += '<div class="date-group">';
    html += '<div class="date-group-header">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ' +
      esc(displayDate) +
      '</div>';
    html += '<div class="content-cards">';

    groups[dateKey].forEach(c => {
      const platformCls = PLATFORM_CLASS[c.platform] || 'platform-website';
      const typeCls = TYPE_CLASS[c.type] || 'type-post';
      const statusCls = STATUS_CLASS[c.status] || 'status-draft';

      html += '<div class="content-card">';
      html += '<div class="content-card-header"><span class="content-card-title">' + esc(c.title) + '</span></div>';
      html += '<div class="content-card-badges">';
      html += '<span class="platform-badge ' + platformCls + '">' + esc(c.platform) + '</span>';
      html += '<span class="type-badge ' + typeCls + '">' + esc(c.type) + '</span>';
      html += '<span class="status-badge ' + statusCls + '">' + esc(c.status) + '</span>';
      html += '</div>';

      if (c.content) {
        html += '<div class="content-card-preview">' + esc(c.content) + '</div>';
      }

      html += '<div class="content-card-actions">';
      html += '<button class="btn btn-sm btn-secondary" onclick="editContent(' + c.rowIndex + ')" title="Edit">Edit</button>';

      if (c.status !== 'Published' && c.status !== 'Cancelled') {
        html += '<button class="btn btn-sm" style="background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3);" onclick="publishContent(' + c.rowIndex + ')" title="Publish">Publish</button>';
      }

      html += '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteContent(' + c.rowIndex + ')" title="Delete">Del</button>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div></div>';
  });

  container.innerHTML = html;
}

function formatDateLabel(dateStr) {
  try {
    const parts = dateStr.split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    return d.toLocaleDateString('en-US', options);
  } catch {
    return dateStr;
  }
}
