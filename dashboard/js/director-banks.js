(function () {
  if (typeof requireDirector === 'function') {
    if (!requireDirector()) return;
  } else if (typeof requireAuth === 'function') {
    requireAuth();
  }

  if (typeof renderNavbar === 'function') {
    renderNavbar('director-banks');
  }

  var accounts = [];
  var currentAccountCode = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtPHP(n) {
    var v = parseFloat(n) || 0;
    return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function typePill(t) {
    var s = String(t || '').toLowerCase();
    if (s.indexOf('pr ') >= 0 || s === 'pr payment') return '<span class="pill-pr">PR Paid</span>';
    if (s.indexOf('transfer') >= 0) return '<span class="pill-xfer">Transfer</span>';
    return '<span class="pill-other">' + escapeHtml(t || '—') + '</span>';
  }

  function renderCards() {
    var grid = document.getElementById('bankCards');
    if (!grid) return;
    if (!accounts.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">No accounts.</div>';
      return;
    }
    grid.innerHTML = accounts.map(function (a) {
      var isAub = String(a.code).toUpperCase() === 'AUB';
      return '<div class="bank-card ' + (isAub ? 'aub' : '') + '">' +
        '<div class="bk-name">' + escapeHtml(a.bank || a.name) + (a.branch ? ' · ' + escapeHtml(a.branch) : '') + '</div>' +
        '<div class="bk-bal">' + fmtPHP(a.currentBalance != null ? a.currentBalance : a.balance) + '</div>' +
        '<div class="bk-sub">' + escapeHtml(a.name) + (a.accountNumber ? ' · ' + escapeHtml(a.accountNumber) : '') + '</div>' +
        '<div class="bk-actions">' +
          '<button class="bk-btn primary" onclick="openTxModal(\'' + a.code + '\',\'Deposit\')">+ Deposit</button>' +
          '<button class="bk-btn" onclick="openTxModal(\'' + a.code + '\',\'Withdrawal\')">− Withdraw</button>' +
          '<button class="bk-btn" onclick="openAcctModal(\'' + a.code + '\')">Edit</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderTabs() {
    var t = document.getElementById('bkTabs');
    if (!t) return;
    var html = '<div class="bk-tab ' + (currentAccountCode === '__ALL__' ? 'active' : '') + '" onclick="selectAccount(\'__ALL__\')">All Accounts</div>';
    html += accounts.map(function (a) {
      return '<div class="bk-tab ' + (currentAccountCode === a.code ? 'active' : '') + '" onclick="selectAccount(\'' + a.code + '\')">' +
        escapeHtml(a.name) + '</div>';
    }).join('');
    t.innerHTML = html;
  }

  window.selectAccount = function (code) {
    currentAccountCode = code;
    renderTabs();
    loadTransactions();
  };

  window.loadBanks = function () {
    var grid = document.getElementById('bankCards');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">Loading…</div>';
    return apiGetBankAccounts().then(function (res) {
      var list = (res && (res.accounts || res.data || res)) || [];
      if (!Array.isArray(list) && res && Array.isArray(res.result)) list = res.result;
      accounts = list || [];
      if (!currentAccountCode && accounts.length) currentAccountCode = '__ALL__';
      renderCards();
      renderTabs();
      // Populate transfer selects
      var from = document.getElementById('xferFrom');
      var to = document.getElementById('xferTo');
      if (from && to) {
        var opts = accounts.map(function (a) {
          return '<option value="' + a.code + '">' + escapeHtml(a.name) + ' (' + fmtPHP(a.currentBalance != null ? a.currentBalance : a.balance) + ')</option>';
        }).join('');
        from.innerHTML = opts;
        to.innerHTML = opts;
        // Default: from = a Metrobank, to = AUB
        var metro = accounts.find(function (a) { return /METRO/i.test(a.code); });
        var aub = accounts.find(function (a) { return /AUB/i.test(a.code); });
        if (metro) from.value = metro.code;
        if (aub) to.value = aub.code;
      }
      return loadTransactions();
    }).catch(function (err) {
      console.error('loadBanks failed', err);
      if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#ef4444;padding:1rem;">Failed to load accounts.</div>';
    });
  };

  window.loadTransactions = function () {
    var body = document.getElementById('bkTxBody');
    if (!body) return;
    if (!currentAccountCode) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1rem;">Select an account.</td></tr>';
      return;
    }
    var month = (document.getElementById('bkMonth') || {}).value || '';
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1rem;">Loading…</td></tr>';
    var params = { month: month };
    if (currentAccountCode !== '__ALL__') params.accountCode = currentAccountCode;
    return apiGetBankTransactions(params).then(function (res) {
      var list = (res && (res.transactions || res.data || res.result)) || [];
      if (!Array.isArray(list) && Array.isArray(res)) list = res;
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1rem;">No transactions.</td></tr>';
        return;
      }
      list.sort(function (a, b) {
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      });
      body.innerHTML = list.map(function (tx) {
        var dir = parseInt(tx.direction, 10) || 0;
        var amt = parseFloat(tx.amount) || 0;
        var cls = dir >= 0 ? 'credit' : 'debit';
        var sign = dir >= 0 ? '+' : '−';
        var acct = '';
        if (currentAccountCode === '__ALL__') {
          var a = accounts.find(function (x) { return x.code === tx.accountCode; });
          acct = ' <span style="color:var(--text-muted);font-size:0.72rem;">(' + escapeHtml(a ? a.name : tx.accountCode) + ')</span>';
        }
        var canDelete = true;
        return '<tr>' +
          '<td>' + escapeHtml(fmtDate(tx.date)) + '</td>' +
          '<td>' + typePill(tx.type) + acct + '</td>' +
          '<td>' + escapeHtml(tx.description || '') + '</td>' +
          '<td>' + escapeHtml(tx.refId || '') + '</td>' +
          '<td style="text-align:right;" class="bk-amt ' + cls + '">' + sign + fmtPHP(amt) + '</td>' +
          '<td>' + escapeHtml(tx.createdBy || '') + '</td>' +
          '<td style="text-align:right;">' + (canDelete ? '<button class="bk-btn" onclick="deleteTransaction(\'' + tx.id + '\')">✕</button>' : '') + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (err) {
      console.error('loadTransactions failed', err);
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:1rem;">Failed to load.</td></tr>';
    });
  };

  // ----- Add transaction modal -----
  window.openTxModal = function (accountCode, type) {
    document.getElementById('txAccountCode').value = accountCode || '';
    document.getElementById('txType').value = type || 'Deposit';
    document.getElementById('txAmount').value = '';
    document.getElementById('txDate').value = todayISO();
    document.getElementById('txDescription').value = '';
    var a = accounts.find(function (x) { return x.code === accountCode; });
    document.getElementById('txModalTitle').textContent = 'Add Transaction · ' + (a ? a.name : accountCode);
    document.getElementById('txModalBg').classList.add('open');
  };
  window.closeTxModal = function () {
    document.getElementById('txModalBg').classList.remove('open');
  };
  window.saveTransaction = function () {
    var accountCode = document.getElementById('txAccountCode').value;
    var type = document.getElementById('txType').value;
    var amount = parseFloat(document.getElementById('txAmount').value);
    var date = document.getElementById('txDate').value;
    var description = document.getElementById('txDescription').value;
    if (!accountCode || !type || !(amount > 0) || !date) {
      alert('Please fill in type, amount, and date.');
      return;
    }
    var direction = (type === 'Deposit' || type === 'Interest') ? 1
                  : (type === 'Withdrawal' || type === 'Fee') ? -1
                  : 1;
    var user = (typeof getCurrentUser === 'function' ? getCurrentUser() : null) || {};
    apiAddBankTransaction({
      accountCode: accountCode,
      type: type,
      direction: direction,
      amount: amount,
      date: date,
      description: description,
      createdBy: user.username || user.email || user.name || ''
    }).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || res.error || 'Save failed');
      closeTxModal();
      return loadBanks();
    }).catch(function (err) {
      alert('Save failed: ' + (err.message || err));
    });
  };

  // ----- Transfer modal -----
  window.openTransferModal = function () {
    document.getElementById('xferAmount').value = '';
    document.getElementById('xferDate').value = todayISO();
    document.getElementById('xferDesc').value = '';
    document.getElementById('xferModalBg').classList.add('open');
  };
  window.closeTransferModal = function () {
    document.getElementById('xferModalBg').classList.remove('open');
  };
  window.saveTransfer = function () {
    var fromCode = document.getElementById('xferFrom').value;
    var toCode = document.getElementById('xferTo').value;
    var amount = parseFloat(document.getElementById('xferAmount').value);
    var date = document.getElementById('xferDate').value;
    var desc = document.getElementById('xferDesc').value;
    if (!fromCode || !toCode || fromCode === toCode || !(amount > 0) || !date) {
      alert('Choose two different accounts and enter a positive amount and date.');
      return;
    }
    var user = (typeof getCurrentUser === 'function' ? getCurrentUser() : null) || {};
    apiAddBankTransaction({
      type: 'Transfer',
      fromAccountCode: fromCode,
      toAccountCode: toCode,
      amount: amount,
      date: date,
      description: desc,
      createdBy: user.username || user.email || user.name || ''
    }).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || res.error || 'Transfer failed');
      closeTransferModal();
      return loadBanks();
    }).catch(function (err) {
      alert('Transfer failed: ' + (err.message || err));
    });
  };

  // ----- Edit account modal -----
  window.openAcctModal = function (code) {
    var a = accounts.find(function (x) { return x.code === code; });
    if (!a) return;
    document.getElementById('acctCode').value = a.code;
    document.getElementById('acctName').value = a.name || '';
    document.getElementById('acctBank').value = a.bank || '';
    document.getElementById('acctBranch').value = a.branch || '';
    document.getElementById('acctNumber').value = a.accountNumber || '';
    document.getElementById('acctOpening').value = a.openingBalance || 0;
    document.getElementById('acctNotes').value = a.notes || '';
    document.getElementById('acctModalBg').classList.add('open');
  };
  window.closeAcctModal = function () {
    document.getElementById('acctModalBg').classList.remove('open');
  };
  window.saveAccount = function () {
    var data = {
      code: document.getElementById('acctCode').value,
      name: document.getElementById('acctName').value,
      bank: document.getElementById('acctBank').value,
      branch: document.getElementById('acctBranch').value,
      accountNumber: document.getElementById('acctNumber').value,
      openingBalance: parseFloat(document.getElementById('acctOpening').value) || 0,
      notes: document.getElementById('acctNotes').value
    };
    if (!data.code || !data.name) {
      alert('Name is required.');
      return;
    }
    apiSaveBankAccount(data).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || res.error || 'Save failed');
      closeAcctModal();
      return loadBanks();
    }).catch(function (err) {
      alert('Save failed: ' + (err.message || err));
    });
  };

  // ----- Delete -----
  window.deleteTransaction = function (id) {
    if (!id) return;
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    apiDeleteBankTransaction(id).then(function (res) {
      if (res && res.success === false) throw new Error(res.error || 'Delete failed');
      return loadBanks();
    }).catch(function (err) {
      alert('Delete failed: ' + (err.message || err));
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    // Close modals when clicking the backdrop
    ['txModalBg', 'xferModalBg', 'acctModalBg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function (e) {
        if (e.target === el) el.classList.remove('open');
      });
    });
    loadBanks();
  });
})();
