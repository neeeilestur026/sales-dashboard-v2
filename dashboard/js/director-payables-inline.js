/* director-payables-inline.js — A305 · the page's own script, moved verbatim out of director-payables.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
(function () {
  var session = (typeof requireDirector === 'function') ? requireDirector() : null;
  if (typeof requireDirector === 'function' && !session) return;
  if (typeof renderNavbar === 'function') renderNavbar('director-payables');

  var allPayables = [];
  var bankAccounts = [];
  var activeStatus = 'all';

  function esc(s) { return hxEsc(s); }
  function php(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dateVal(o) { return new Date(o.dueDate || o.createdAt || 0); }
  function fmtDate(d) {
    if (!d) return '';
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isOverdue(p) {
    if (p.status === 'Paid') return false;
    if (!p.dueDate) return false;
    return p.dueDate < todayISO();
  }

  function populateYears(rows) {
    var sel = document.getElementById('dpYear');
    var years = {};
    rows.forEach(function (r) {
      var d = dateVal(r);
      if (!isNaN(d.getTime())) years[d.getFullYear()] = true;
    });
    var cur = sel.value;
    var list = Object.keys(years).sort(function (a, b) { return b - a; });
    sel.innerHTML = '<option value="">All</option>' + list.map(function (y) {
      return '<option value="' + y + '"' + (y === cur ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
  }

  function setActiveTab() {
    ['All', 'Unpaid', 'Paid'].forEach(function (s) {
      var el = document.getElementById('tab' + s);
      if (el) el.classList.toggle('active', activeStatus === (s === 'All' ? 'all' : s));
    });
  }

  window.setStatus = function (s) { activeStatus = s; setActiveTab(); applyFilters(); };
  window.clearAllFilters = function () {
    document.getElementById('dpSearch').value = '';
    document.getElementById('dpMonth').value = '';
    document.getElementById('dpYear').value = '';
    activeStatus = 'all'; setActiveTab(); applyFilters();
  };

  window.applyFilters = function () {
    var search = (document.getElementById('dpSearch').value || '').toLowerCase().trim();
    var month = document.getElementById('dpMonth').value || '';
    var year = document.getElementById('dpYear').value || '';
    var filtered = allPayables.filter(function (p) {
      if (activeStatus !== 'all' && String(p.status || 'Unpaid') !== activeStatus) return false;
      var d = dateVal(p);
      if (!isNaN(d.getTime())) {
        if (month) {
          var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          if (ym !== month) return false;
        }
        if (year && String(d.getFullYear()) !== String(year)) return false;
      } else if (month || year) { return false; }
      if (search) {
        var hay = ((p.payee || '') + ' ' + (p.description || '') + ' ' + (p.category || '') + ' ' + (p.notes || '')).toLowerCase();
        if (hay.indexOf(search) < 0) return false;
      }
      return true;
    });
    renderKpis(filtered);
    renderTable(filtered);
  };

  function renderKpis(rows) {
    var unpaidCount = 0, unpaidTotal = 0, overdueCount = 0, paidTotal = 0;
    rows.forEach(function (p) {
      var amt = Number(p.amount || 0);
      if (p.status === 'Paid') paidTotal += amt;
      else {
        unpaidCount++;
        unpaidTotal += amt;
        if (isOverdue(p)) overdueCount++;
      }
    });
    document.getElementById('kpiUnpaidCount').textContent = unpaidCount;
    document.getElementById('kpiUnpaidTotal').textContent = php(unpaidTotal);
    document.getElementById('kpiOverdue').textContent = overdueCount;
    document.getElementById('kpiPaid').textContent = php(paidTotal);
  }

  function bankNameFor(code) {
    var a = bankAccounts.find(function (x) { return x.code === code; });
    return a ? a.name : code;
  }

  function renderTable(rows) {
    var body = document.getElementById('dpBody');
    var count = document.getElementById('dpCount');
    count.textContent = 'Showing ' + rows.length + ' payable' + (rows.length === 1 ? '' : 's');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;color: var(--hx-ink-3);padding:1.5rem;">No payables match these filters.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (p) {
      var paid = p.status === 'Paid';
      var overdue = isOverdue(p);
      var rowCls = paid ? 'row-paid' : (overdue ? 'row-overdue' : '');
      var badge = paid ? '<span class="badge badge-paid">Paid</span>'
                : overdue ? '<span class="badge badge-overdue">Overdue</span>'
                : '<span class="badge badge-unpaid">Unpaid</span>';
      var dateLine = p.dueDate
        ? '<div>' + esc(fmtDate(p.dueDate)) + '</div><div style="font-size:0.7rem;color: var(--hx-ink-3);">added ' + esc(fmtDate(p.createdAt)) + '</div>'
        : '<div style="color: var(--hx-ink-3);">— no due —</div><div style="font-size:0.7rem;color: var(--hx-ink-3);">added ' + esc(fmtDate(p.createdAt)) + '</div>';
      var bankCell = paid
        ? esc(bankNameFor(p.bankAccountCode)) + (p.paidAt ? '<div style="font-size:0.7rem;color: var(--hx-ink-3);">' + esc(fmtDate(p.paidAt)) + '</div>' : '')
        : '<span style="color: var(--hx-ink-3);">—</span>';
      var actions = paid
        ? '<button class="dp-btn warn" onclick="unmarkPaid(\'' + p.id + '\')">Unpay</button>' +
          '<button class="dp-btn danger" onclick="deletePayable(\'' + p.id + '\')">✕</button>'
        : '<button class="dp-btn success" onclick="openPayModal(\'' + p.id + '\')">Mark Paid</button>' +
          '<button class="dp-btn" onclick="openEditModal(\'' + p.id + '\')">Edit</button>' +
          '<button class="dp-btn danger" onclick="deletePayable(\'' + p.id + '\')">✕</button>';

      return '<tr class="' + rowCls + '">' +
        '<td class="nowrap">' + dateLine + '</td>' +
        '<td class="wrap"><strong>' + esc(p.payee) + '</strong></td>' +
        '<td class="wrap">' + esc(p.category || '—') + '</td>' +
        '<td class="wrap">' + esc(p.description || '') + '</td>' +
        '<td class="nowrap" style="text-align:right;font-weight:700;">' + php(p.amount) + '</td>' +
        '<td class="nowrap">' + badge + '</td>' +
        '<td class="nowrap">' + bankCell + '</td>' +
        '<td class="nowrap"><div class="dp-actions">' + actions + '</div></td>' +
        '</tr>';
    }).join('');
  }

  // ----- Modals -----
  window.openAddModal = function () {
    document.getElementById('addModalTitle').textContent = 'Add Payable';
    document.getElementById('payableId').value = '';
    document.getElementById('fPayee').value = '';
    document.getElementById('fAmount').value = '';
    document.getElementById('fDueDate').value = '';
    document.getElementById('fCategory').value = '';
    document.getElementById('fDescription').value = '';
    document.getElementById('fNotes').value = '';
    document.getElementById('addModalBg').classList.add('open');
  };
  window.openEditModal = function (id) {
    var p = allPayables.find(function (x) { return x.id === id; });
    if (!p) return;
    document.getElementById('addModalTitle').textContent = 'Edit Payable';
    document.getElementById('payableId').value = p.id;
    document.getElementById('fPayee').value = p.payee || '';
    document.getElementById('fAmount').value = p.amount || '';
    document.getElementById('fDueDate').value = p.dueDate || '';
    document.getElementById('fCategory').value = p.category || '';
    document.getElementById('fDescription').value = p.description || '';
    document.getElementById('fNotes').value = p.notes || '';
    document.getElementById('addModalBg').classList.add('open');
  };
  window.closeAddModal = function () { document.getElementById('addModalBg').classList.remove('open'); };

  window.savePayable = function () {
    var data = {
      id: document.getElementById('payableId').value || '',
      payee: document.getElementById('fPayee').value.trim(),
      amount: parseFloat(document.getElementById('fAmount').value),
      dueDate: document.getElementById('fDueDate').value,
      category: document.getElementById('fCategory').value.trim(),
      description: document.getElementById('fDescription').value,
      notes: document.getElementById('fNotes').value
    };
    if (!data.payee || !(data.amount > 0)) { alert('Payee and amount are required.'); return; }
    apiSaveDirectorPayable(data).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || 'Save failed');
      closeAddModal();
      return loadPayables();
    }).catch(function (err) { alert('Save failed: ' + (err.message || err)); });
  };

  window.openPayModal = function (id) {
    var p = allPayables.find(function (x) { return x.id === id; });
    if (!p) return;
    document.getElementById('payPayableId').value = id;
    document.getElementById('paySummary').textContent = p.payee + ' — ' + php(p.amount) + (p.description ? '  ·  ' + p.description : '');
    var sel = document.getElementById('payBankAccount');
    sel.innerHTML = bankAccounts.map(function (a) {
      var bal = (a.currentBalance != null ? a.currentBalance : a.balance) || 0;
      return '<option value="' + a.code + '">' + esc(a.name) + ' (bal: ' + php(bal) + ')</option>';
    }).join('');
    // Default: AUB
    var aub = bankAccounts.find(function (a) { return /AUB/i.test(a.code); });
    if (aub) sel.value = aub.code;
    document.getElementById('payModalBg').classList.add('open');
  };
  window.closePayModal = function () { document.getElementById('payModalBg').classList.remove('open'); };
  window.confirmPay = function () {
    var id = document.getElementById('payPayableId').value;
    var bankAccountCode = document.getElementById('payBankAccount').value;
    if (!id || !bankAccountCode) { alert('Choose a bank account.'); return; }
    var user = (typeof getCurrentUser === 'function' ? getCurrentUser() : null) || {};
    apiMarkDirectorPayablePaid({
      id: id,
      bankAccountCode: bankAccountCode,
      paidBy: user.username || user.email || user.name || ''
    }).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || 'Mark Paid failed');
      closePayModal();
      return loadPayables();
    }).catch(function (err) { alert('Mark Paid failed: ' + (err.message || err)); });
  };

  window.unmarkPaid = function (id) {
    if (!confirm('Reverse this payment? The bank debit will be removed.')) return;
    apiUnmarkDirectorPayablePaid(id).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || 'Unmark failed');
      return loadPayables();
    }).catch(function (err) { alert('Unmark failed: ' + (err.message || err)); });
  };

  window.deletePayable = function (id) {
    if (!confirm('Delete this payable? If it was paid, the bank debit will also be removed.')) return;
    apiDeleteDirectorPayable(id).then(function (res) {
      if (res && res.success === false) throw new Error(res.message || 'Delete failed');
      return loadPayables();
    }).catch(function (err) { alert('Delete failed: ' + (err.message || err)); });
  };

  window.loadPayables = function () {
    var body = document.getElementById('dpBody');
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color: var(--hx-ink-3);padding:1.5rem;">Loading…</td></tr>';
    return Promise.all([
      apiGetDirectorPayables(),
      apiGetBankAccounts()
    ]).then(function (results) {
      var pRes = results[0], bRes = results[1];
      if (!pRes || !pRes.success) throw new Error((pRes && pRes.message) || 'Failed to load payables');
      allPayables = pRes.data || [];
      bankAccounts = (bRes && (bRes.data || bRes.accounts || [])) || [];
      populateYears(allPayables);
      setActiveTab();
      applyFilters();
    }).catch(function (err) {
      console.error('loadPayables failed', err);
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;color: var(--hx-red);padding:1.5rem;">Failed to load payables.</td></tr>';
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    ['addModalBg', 'payModalBg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function (e) {
        if (e.target === el) el.classList.remove('open');
      });
    });
    loadPayables();
  });
})();
