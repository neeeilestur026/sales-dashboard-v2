/* ═══════════════════════════════════════════════
   email-setup.js — GoDaddy IMAP credential setup
   ═══════════════════════════════════════════════ */

(async function init() {
  const session = requireAuth();
  if (!session) return;
  renderNavbar('email-setup');

  await refreshStatus();
})();

async function refreshStatus() {
  const statusBox = document.getElementById('statusBox');
  const disconnectBtn = document.getElementById('disconnectBtn');
  try {
    const r = await apiGetEmailStatus();
    if (r.success && r.configured) {
      statusBox.innerHTML = '<div class="status-card">Connected as <strong>' + escapeHtml(r.godaddyEmail || '') + '</strong>. You can update credentials below or disconnect.</div>';
      document.getElementById('godaddyEmail').value = r.godaddyEmail || '';
      disconnectBtn.style.display = '';
    } else {
      statusBox.innerHTML = '';
      disconnectBtn.style.display = 'none';
    }
  } catch (err) {
    statusBox.innerHTML = '';
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _readForm() {
  return {
    addr: (document.getElementById('godaddyEmail').value || '').trim(),
    pwd: document.getElementById('godaddyPassword').value || '',
  };
}

function _setMsg(text, kind) {
  const msg = document.getElementById('formMsg');
  msg.textContent = text;
  msg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

async function testConnection() {
  const { addr, pwd } = _readForm();
  if (!addr || !pwd) { _setMsg('Enter email and password first.', 'error'); return; }
  const btn = document.getElementById('testBtn');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  _setMsg('Connecting to GoDaddy IMAP...', 'info');
  try {
    const r = await apiTestEmailConnection(addr, pwd);
    _setMsg(r.message || (r.success ? 'Connection successful.' : 'Connection failed.'), r.success ? 'success' : 'error');
  } catch (err) {
    _setMsg('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

async function saveCredentials() {
  const { addr, pwd } = _readForm();
  if (!addr || !pwd) { _setMsg('Enter email and password first.', 'error'); return; }
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  _setMsg('Verifying and encrypting credentials...', 'info');
  try {
    const r = await apiSetupEmailCredentials(addr, pwd);
    if (r.success) {
      _setMsg('Connected. Email Log will auto-populate on your next daily report.', 'success');
      document.getElementById('godaddyPassword').value = '';
      await refreshStatus();
    } else {
      _setMsg(r.message || 'Failed to save.', 'error');
    }
  } catch (err) {
    _setMsg('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Connect';
  }
}

async function disconnect() {
  if (!confirm('Disconnect your GoDaddy mailbox? Your daily report will no longer auto-populate.')) return;
  const btn = document.getElementById('disconnectBtn');
  btn.disabled = true;
  try {
    const r = await apiDisconnectEmail();
    if (r.success) {
      _setMsg('Disconnected.', 'success');
      document.getElementById('godaddyEmail').value = '';
      document.getElementById('godaddyPassword').value = '';
      await refreshStatus();
    } else {
      _setMsg(r.message || 'Failed to disconnect.', 'error');
    }
  } catch (err) {
    _setMsg('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
