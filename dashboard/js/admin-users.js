/* ═══════════════════════════════════════════════
   admin-users.js — User Management logic
   ═══════════════════════════════════════════════ */

let usersData = [];
let editingRow = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('admin-users');
  await loadUsers();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toggleUserForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetUserForm() {
  document.getElementById('userForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('usrPassword').required = true;
  document.getElementById('usrPassword').placeholder = 'Min 6 characters';
  document.getElementById('usrUsername').disabled = false;
  var tm = document.getElementById('usrTrainingMode'); if (tm) tm.checked = false;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add User';
  document.getElementById('submitBtn').textContent = 'Add User';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editUser(rowIndex) {
  const user = usersData.find(u => u.rowIndex === rowIndex);
  if (!user) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('usrUsername').value = user.username;
  document.getElementById('usrUsername').disabled = true;
  document.getElementById('usrPassword').value = '';
  document.getElementById('usrPassword').required = false;
  document.getElementById('usrPassword').placeholder = 'Leave blank to keep current';
  document.getElementById('usrFullName').value = user.fullName;
  document.getElementById('usrRole').value = user.role;
  var tm = document.getElementById('usrTrainingMode'); if (tm) tm.checked = !!user.trainingMode;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit User';
  document.getElementById('submitBtn').textContent = 'Update User';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleUserForm();
}

async function submitUser(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    username: document.getElementById('usrUsername').value.trim(),
    password: document.getElementById('usrPassword').value,
    fullName: document.getElementById('usrFullName').value.trim(),
    role: document.getElementById('usrRole').value,
    trainingMode: !!(document.getElementById('usrTrainingMode') && document.getElementById('usrTrainingMode').checked)
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await fetchFromAPI({ action: 'updateUser', ...data });
    } else {
      if (!data.password || data.password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }
      btn.textContent = 'Adding...';
      result = await fetchFromAPI({ action: 'addUser', ...data });
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetUserForm();
    clearApiCache();
    await loadUsers();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update User' : 'Add User';
}

async function resetPassword(rowIndex, username) {
  if (!confirm('Reset password for ' + username + '? A temporary password will be generated.')) return;
  try {
    const result = await fetchFromAPI({ action: 'resetUserPassword', rowIndex: String(rowIndex) });
    if (!result.success) throw new Error(result.message);
    var tempPw = result.tempPassword || '(check with admin)';
    alert('Password reset successfully.\n\nTemporary password: ' + tempPw + '\n\nPlease share this with the user securely.');
    clearApiCache();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteUser(rowIndex, username) {
  if (!confirm('Delete user "' + username + '"? This cannot be undone.')) return;
  try {
    const result = await fetchFromAPI({ action: 'deleteUser', rowIndex: String(rowIndex) });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadUsers();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadUsers() {
  const container = document.getElementById('usrContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await fetchFromAPI({ action: 'getUsers' });
    if (!result.success) throw new Error(result.message || 'Failed');
    usersData = result.data || [];
    document.getElementById('usrCount').textContent = usersData.length + ' user' + (usersData.length !== 1 ? 's' : '');
    renderUsersTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderUsersTable() {
  const container = document.getElementById('usrContainer');
  if (usersData.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No users found.</div>';
    return;
  }

  let html = '<table class="usr-table"><thead><tr>' +
    '<th>Username</th><th>Full Name</th><th>Role</th><th>Training</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  usersData.forEach(u => {
    const roleCls = u.role === 'admin' ? 'role-admin' : u.role === 'accounting' ? 'role-accounting' : u.role === 'management' ? 'role-management' : u.role === 'director' ? 'role-director' : u.role === 'hr' ? 'role-hr' : 'role-sales';
    const trainBadge = u.trainingMode
      ? '<span class="role-badge" style="background:linear-gradient(90deg,#f59e0b,#f97316);color:#ffffff;font-weight:700;letter-spacing:0.03em;box-shadow:0 1px 3px rgba(245,158,11,0.4);">TRAINING MODE</span>'
      : '<span style="color:var(--text-muted,#64748b);font-size:0.8rem;">—</span>';
    const inlineTag = u.trainingMode
      ? ' <span style="display:inline-block;margin-left:0.4rem;padding:0.1rem 0.45rem;border-radius:999px;font-size:0.65rem;font-weight:700;background:#fef3c7;color:#b45309;border:1px solid #fbbf24;vertical-align:middle;">TRAINING</span>'
      : '';
    const rowStyle = u.trainingMode ? ' style="background:rgba(254,243,199,0.35);"' : '';
    html += '<tr' + rowStyle + '>' +
      '<td><strong>' + esc(u.username) + '</strong>' + inlineTag + '</td>' +
      '<td>' + esc(u.fullName) + '</td>' +
      '<td><span class="role-badge ' + roleCls + '">' + esc(u.role) + '</span></td>' +
      '<td>' + trainBadge + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-sm btn-secondary" onclick="editUser(' + u.rowIndex + ')" style="margin-right:0.3rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm btn-secondary" onclick="resetPassword(' + u.rowIndex + ',\'' + esc(u.username) + '\')" style="margin-right:0.3rem;" title="Reset Password">Reset PW</button>' +
        (u.role !== 'admin' ? '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteUser(' + u.rowIndex + ',\'' + esc(u.username) + '\')" title="Delete">Delete</button>' : '') +
      '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
