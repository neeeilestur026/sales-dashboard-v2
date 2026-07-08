/* ═══════════════════════════════════════════════
   admin-login-log.js — Login log viewer logic
   ═══════════════════════════════════════════════ */

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;

  renderNavbar('admin-login-log');
  await loadLoginLog(100);
});

/**
 * Load and display login activity log
 */
async function loadLoginLog(limit = 100) {
  // Update active filter button
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes(String(limit)) || (limit >= 500 && btn.textContent === 'All')) {
      btn.classList.add('active');
    }
  });

  showLoading('loginLogContainer', 'table');

  try {
    const result = await apiGetLoginLog(limit);

    if (result.success === false) {
      showError('loginLogContainer', result.message || 'Failed to load login log');
      return;
    }

    const logs = result.data || [];

    if (logs.length === 0) {
      showEmpty('loginLogContainer', 'No login activity yet', 'Login events will appear here once users start signing in.');
      return;
    }

    renderLoginLog(logs);
  } catch (err) {
    showError('loginLogContainer', err.message);
  }
}

/**
 * Render the login log table
 */
function renderLoginLog(logs) {
  const container = document.getElementById('loginLogContainer');

  let html = `
    <table>
      <thead>
        <tr>
          <th>Date & Time</th>
          <th>Username</th>
          <th>Full Name</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>`;

  logs.forEach(log => {
    const badgeClass = log.role === 'admin' ? 'badge-hot' : log.role === 'management' ? 'badge-warm' : log.role === 'accounting' ? 'badge-new' : 'badge-active';
    const badgeText = log.role === 'admin' ? 'Admin' : log.role === 'management' ? 'Management' : log.role === 'accounting' ? 'Accounting' : 'Sales';

    html += `
      <tr>
        <td>${esc(log.timestamp)}</td>
        <td>${esc(log.username)}</td>
        <td style="font-weight:600;">${esc(log.fullName)}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
