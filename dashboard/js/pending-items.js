/* ═══════════════════════════════════════════════
   pending-items.js — PRs needing pricing + Quotations pending approval
   ═══════════════════════════════════════════════ */

let session = null;
let allPRs = [];
let allQuotations = [];
let activeTab = 'pr';

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAuth();
  if (!session) return;

  // Only sales and admin can access this page
  if (session.role !== 'sales' && session.role !== 'admin') {
    window.location.href = session.role === 'management' ? 'management-home.html' : 'accounting-home.html';
    return;
  }

  renderNavbar('pending-items');

  // Show agent filters and action buttons for admin
  if (session.role === 'admin') {
    document.getElementById('prAgentFilter').style.display = '';
    document.getElementById('qAgentFilter').style.display = '';
    document.getElementById('btnForwardPricing').style.display = '';
    document.getElementById('btnCreateSQ').style.display = '';
  }

  // Show Create Quotation button for sales agents
  if (session.role === 'sales') {
    document.getElementById('btnCreateQuotation').style.display = '';
  }

  await loadPendingItems();
});

async function loadPendingItems() {
  const prContainer = document.getElementById('prContainer');
  const qContainer = document.getElementById('qContainer');
  prContainer.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  qContainer.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    let params;
    if (session.role === 'admin') {
      params = { role: 'admin' };
    } else {
      params = {
        role: 'sales',
        agentName: session.name,
        prSheetId: session.prSheetId || '',
        quotationSheetId: session.quotationSheetId || ''
      };
    }

    const result = await apiGetPendingItems(params);
    if (!result.success) throw new Error(result.message || 'Failed to load');

    allPRs = result.data.prs || [];
    allQuotations = result.data.quotations || [];

    // Update tab counts
    document.getElementById('prCount').textContent = allPRs.length;
    document.getElementById('quotationCount').textContent = allQuotations.length;

    // Populate agent filters for admin
    if (session.role === 'admin') {
      populateAgentFilter('prAgentFilter', allPRs);
      populateAgentFilter('qAgentFilter', allQuotations);
    }

    applyPRFilters();
    applyQuotationFilters();
  } catch (err) {
    console.error('Pending items error:', err);
    prContainer.innerHTML = '<div class="no-results"><p>Error: ' + esc(err.message) + '</p></div>';
    qContainer.innerHTML = '<div class="no-results"><p>Error: ' + esc(err.message) + '</p></div>';
  }
}

function populateAgentFilter(selectId, records) {
  const select = document.getElementById(selectId);
  const agents = [...new Set(records.map(r => r.agentName).filter(Boolean))].sort();
  // Clear existing options beyond "All Agents"
  select.length = 1;
  agents.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tabPR').classList.toggle('active', tab === 'pr');
  document.getElementById('tabQuotation').classList.toggle('active', tab === 'quotation');
  document.getElementById('prSection').classList.toggle('section-hidden', tab !== 'pr');
  document.getElementById('quotationSection').classList.toggle('section-hidden', tab !== 'quotation');
}

// ─── PR Tab ──────────────────────────────────────

function applyPRFilters() {
  const search = (document.getElementById('prSearch').value || '').trim().toLowerCase();
  const agent = document.getElementById('prAgentFilter').value;
  const status = document.getElementById('prStatusFilter').value;

  const filtered = allPRs.filter(r => {
    if (agent && r.agentName !== agent) return false;
    if (status && r.status !== status) return false;
    // Hide "Quoted" PRs unless explicitly filtered for
    if (!status && r.status === 'Quoted') return false;
    if (search) {
      const hay = [r.clientName, r.prNumber, r.itemDescription, r.refNumber, r.agentName].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  renderPRTable(filtered);
}

function renderPRTable(records) {
  const container = document.getElementById('prContainer');
  const countEl = document.getElementById('prTrackerCount');
  countEl.textContent = 'Showing ' + records.length + ' item' + (records.length !== 1 ? 's' : '');

  if (records.length === 0) {
    container.innerHTML = '<div class="no-results"><p>No pending PR items.</p></div>';
    return;
  }

  const isAdmin = session.role === 'admin';
  const showQuotCheck = !isAdmin && records.some(r => r.status === 'For Quotation' && r.unitPrice);

  let rows = records.map((r, idx) => {
    const statusKey = r.status.toLowerCase().replace(/ /g, '-');
    const statusBadge = '<span class="badge badge-' + statusKey + '">' + esc(r.status) + '</span>';

    const qty = r.quantity || '';

    let unitPriceCell, totalPriceCell, checkboxCell = '', buyPriceCell = '';
    if (isAdmin) {
      // Admin checkbox for forward/SQ actions
      checkboxCell = '<td style="text-align:center;"><input type="checkbox" class="fwd-check" data-idx="' + idx + '"></td>';
      // Buy price: show from SQ (read-only) or "No SQ" label
      if (r.hasSQ) {
        buyPriceCell = '<td title="From SQ: ' + esc(r.sqSupplierCompany) + ' (' + esc(r.sqCurrency || 'PHP') + ')"><span style="color:#f97316;font-weight:600;font-size:0.82rem;">' + formatCurrency(r.sqBuyPrice, r.sqCurrency) + '</span><br><span style="font-size:0.65rem;color:#3b82f6;">SQ: ' + esc(r.sqSupplierCompany || 'Linked') + '</span></td>';
      } else {
        buyPriceCell = '<td><span style="color:var(--text-muted,#64748b);font-style:italic;font-size:0.78rem;">No SQ yet</span></td>';
      }
      unitPriceCell = r.unitPrice ? '<span class="price-display">' + formatCurrency(r.unitPrice) + '</span>' : '<span class="price-awaiting">--</span>';
      totalPriceCell = r.totalPrice ? '<span class="price-display">' + formatCurrency(r.totalPrice) + '</span>' : '<span class="price-awaiting">--</span>';
    } else {
      unitPriceCell = r.unitPrice ? '<span class="price-display">' + formatCurrency(r.unitPrice) + '</span>' : '<span class="price-awaiting">Awaiting pricing</span>';
      totalPriceCell = r.totalPrice ? '<span class="price-display">' + formatCurrency(r.totalPrice) + '</span>' : '<span class="price-awaiting">--</span>';
      if (showQuotCheck && r.status === 'For Quotation' && r.unitPrice) {
        checkboxCell = '<td style="text-align:center;"><input type="checkbox" class="quot-check" data-idx="' + idx + '" style="width:16px;height:16px;cursor:pointer;accent-color:#a855f7;"></td>';
      } else if (showQuotCheck) {
        checkboxCell = '<td></td>';
      }
    }

    return '<tr>' +
      (isAdmin || showQuotCheck ? checkboxCell : '') +
      (isAdmin ? '<td style="font-size:0.78rem;color:var(--text-muted)">' + esc(r.agentName) + '</td>' : '') +
      '<td><strong>' + esc(r.clientName) + '</strong></td>' +
      '<td style="color:var(--text-muted)">' + esc(r.prNumber) + '</td>' +
      '<td style="color:var(--text-muted);white-space:nowrap">' + esc(r.dateSent) + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="' + esc(r.itemDescription) + (r.hasSQ && r.sqSupplierDesc ? '\nSupplier: ' + esc(r.sqSupplierDesc) : '') + '">' + esc(r.itemDescription) + (r.hasSQ && r.sqSupplierDesc && r.sqSupplierDesc !== r.itemDescription ? '<br><span style="font-size:0.7rem;color:#3b82f6;" title="Supplier description">&#x2192; ' + esc(r.sqSupplierDesc) + '</span>' : '') + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.8rem">' + esc(r.modelPartNo) + '</td>' +
      '<td style="text-align:center">' + esc(String(qty)) + '</td>' +
      buyPriceCell +
      '<td>' + unitPriceCell + '</td>' +
      '<td>' + totalPriceCell + '</td>' +
      '</tr>';
  }).join('');

  container.innerHTML = '<table class="tracker-table"><thead><tr>' +
    (isAdmin || showQuotCheck ? '<th style="width:36px;"></th>' : '') +
    (isAdmin ? '<th>Agent</th>' : '') +
    '<th>Company</th><th>PR #</th><th>Date</th><th>Status</th>' +
    '<th>Item Description</th><th>Model/Part#</th><th>Qty</th>' +
    (isAdmin ? '<th>Buy Price</th>' : '') +
    '<th>Unit Price</th><th>Total Price</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ─── Create Quotation from PR (sales agent) ────

function getFilteredPRs() {
  const search = (document.getElementById('prSearch').value || '').trim().toLowerCase();
  const agent = document.getElementById('prAgentFilter').value;
  const status = document.getElementById('prStatusFilter').value;

  return allPRs.filter(r => {
    if (agent && r.agentName !== agent) return false;
    if (status && r.status !== status) return false;
    if (!status && r.status === 'Quoted') return false;
    if (search) {
      const hay = [r.clientName, r.prNumber, r.itemDescription, r.refNumber, r.agentName].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function createQuotationFromPR() {
  const checkboxes = document.querySelectorAll('.quot-check:checked');
  if (checkboxes.length === 0) {
    alert('Select at least one "For Quotation" item.');
    return;
  }

  const filtered = getFilteredPRs();
  const selected = [];
  checkboxes.forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    const r = filtered[idx];
    if (r) selected.push(r);
  });
  if (selected.length === 0) return;

  // Enforce same client
  const clients = [...new Set(selected.map(r => r.clientName))];
  if (clients.length > 1) {
    alert('All selected items must be from the same client.\nSelected clients: ' + clients.join(', '));
    return;
  }

  // Build items array matching quotation load_quotation format
  const items = selected.map((r, i) => ({
    item_no: i + 1,
    product_name: r.itemDescription || '',
    product_code: r.modelPartNo || '',
    cbm: 0,
    total_amount: parseFloat(r.unitPrice) || 0,
    quantity: parseInt(r.quantity) || 1,
    total_unit_price: parseFloat(r.totalPrice) || ((parseFloat(r.unitPrice) || 0) * (parseInt(r.quantity) || 1)),
    description: ''
  }));

  const quotationData = JSON.stringify({
    form: {
      clientName: selected[0].clientName || '',
      attention: selected[0].contactPerson || '',
      referenceRfqNo: selected[0].prNumber || '',
      principal: 'Others'
    },
    terms: {},
    items: items
  });

  sessionStorage.setItem('prQuotationData', quotationData);
  window.location.href = '/quotation/';
}

// ─── Forward to Management ──────────────────────

async function forwardSelectedToPricing() {
  const checkboxes = document.querySelectorAll('.fwd-check:checked');
  if (checkboxes.length === 0) { alert('Select at least one PR item to forward.'); return; }
  if (checkboxes.length > 20) { alert('Maximum 20 items per forward. Please select fewer items.'); return; }

  const filtered = getFilteredPRs();
  const selected = [];
  const items = [];

  checkboxes.forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    const r = filtered[idx];
    if (!r) return;
    if (!r.hasSQ) {
      alert('Item "' + (r.itemDescription || '') + '" has no Supplier Quotation. Please create an SQ first.');
      return;
    }
    selected.push({
      sheetId: r.sheetId,
      rowIndex: r.rowIndex,
      agentName: r.agentName || '',
      clientName: r.clientName || '',
      prNumber: r.prNumber || '',
      itemDescription: r.itemDescription || '',
      modelPartNo: r.modelPartNo || '',
      quantity: r.quantity || 0
    });
    items.push({
      modelPartNo: r.modelPartNo || '',
      name: r.sqSupplierDesc || r.itemDescription || '',
      buyPrice: r.sqBuyPrice || 0,
      qty: r.quantity || 0,
      cbm: 0,
      discount: 0,
      supplierDescription: r.sqSupplierDesc || '',
      supplierCompany: r.sqSupplierCompany || '',
      prItemDescription: r.itemDescription || '',
      driveFolderLink: r.sqDriveFolderLink || ''
    });
  });

  if (selected.length === 0) return;

  if (!confirm('Forward ' + selected.length + ' item(s) to management for pricing computation?')) return;

  const btn = document.getElementById('btnForwardPricing');
  btn.disabled = true;
  btn.textContent = 'Forwarding...';

  try {
    const res = await apiForwardPRToPricing({
      prRefsJson: JSON.stringify(selected),
      itemsJson: JSON.stringify(items),
      forwardedBy: session ? session.name : ''
    });
    if (res.success) {
      alert('Items forwarded to management successfully! (ID: ' + res.id + ')');
      await loadPendingItems();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Forward to Management';
  }
}

// ─── Create Supplier Quotation from PR (admin) ──

function createSupplierQuotationFromPR() {
  const checkboxes = document.querySelectorAll('.fwd-check:checked');
  if (checkboxes.length === 0) {
    alert('Select at least one PR item to create a supplier quotation.');
    return;
  }

  const filtered = getFilteredPRs();
  const selected = [];
  checkboxes.forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    const r = filtered[idx];
    if (r) selected.push(r);
  });
  if (selected.length === 0) return;

  // Enforce same PR number
  const prNumbers = [...new Set(selected.map(r => r.prNumber))];
  if (prNumbers.length > 1) {
    alert('All selected items must be from the same PR.\nSelected PRs: ' + prNumbers.join(', '));
    return;
  }

  const sqData = JSON.stringify({
    prNumber: selected[0].prNumber || '',
    prAgentName: selected[0].agentName || '',
    clientName: selected[0].clientName || '',
    items: selected.map(r => ({
      prItemDescription: r.itemDescription || '',
      quantity: r.quantity || 1,
      modelPartNo: r.modelPartNo || ''
    }))
  });

  sessionStorage.setItem('prToSQData', sqData);
  window.location.href = 'supplier-quotation.html';
}

// ─── Quotation Tab ──────────────────────────────

function applyQuotationFilters() {
  const search = (document.getElementById('qSearch').value || '').trim().toLowerCase();
  const agent = document.getElementById('qAgentFilter').value;

  const filtered = allQuotations.filter(r => {
    if (agent && r.agentName !== agent) return false;
    if (search) {
      const hay = [r.clientName, r.refNo, r.rfqNo, r.subject, r.agentName].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  renderQuotationTable(filtered);
}

function renderQuotationTable(records) {
  const container = document.getElementById('qContainer');
  const countEl = document.getElementById('qTrackerCount');
  countEl.textContent = 'Showing ' + records.length + ' quotation' + (records.length !== 1 ? 's' : '');

  if (records.length === 0) {
    container.innerHTML = '<div class="no-results"><p>No pending quotations.</p></div>';
    return;
  }

  const isAdmin = session.role === 'admin';

  let rows = records.map(r => {
    const amount = r.amount ? formatCurrency(r.amount) : '--';

    function approvalBadge(val) {
      var v = (val || 'Pending').toLowerCase();
      var cls = 'badge-pending';
      if (v === 'approved') cls = 'badge-approved';
      else if (v === 'rejected') cls = 'badge-rejected';
      return '<span class="badge ' + cls + '">' + esc(val || 'Pending') + '</span>';
    }

    var ovKey = (r.overallStatus || '').toLowerCase().replace(/ /g, '-');
    var ovClass = 'badge-pending-approval';
    if (ovKey === 'approved') ovClass = 'badge-won';
    else if (ovKey === 'rejected') ovClass = 'badge-lost';
    else if (ovKey === 'partially-approved') ovClass = 'badge-partially-approved';

    var pdfLink = r.driveLink ? '<a href="' + esc(r.driveLink) + '" target="_blank" style="color:#3b82f6;font-size:0.78rem;">View PDF</a>' : '--';

    return '<tr>' +
      (isAdmin ? '<td style="font-size:0.78rem;color:var(--text-muted)">' + esc(r.agentName) + '</td>' : '') +
      '<td><strong>' + esc(r.clientName) + '</strong></td>' +
      '<td style="color:var(--text-muted)">' + esc(r.refNo) + '</td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.subject) + '">' + esc(r.subject) + '</td>' +
      '<td style="white-space:nowrap">' + amount + '</td>' +
      '<td>' + approvalBadge(r.adminApproval) + '</td>' +
      '<td>' + approvalBadge(r.managementApproval) + '</td>' +
      '<td><span class="badge ' + ovClass + '">' + esc(r.overallStatus || 'Pending Approval') + '</span></td>' +
      '<td>' + pdfLink + '</td>' +
      '</tr>';
  }).join('');

  container.innerHTML = '<table class="tracker-table"><thead><tr>' +
    (isAdmin ? '<th>Agent</th>' : '') +
    '<th>Client</th><th>Ref No</th><th>Subject</th><th>Amount</th>' +
    '<th>Admin</th><th>Mgmt</th><th>Overall</th><th>PDF</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ─── Export ──────────────────────────────────────

async function exportPendingExcel(type) {
  try { await loadXLSX(); } catch (e) { alert('Failed to load Excel library'); return; }

  const isAdmin = session.role === 'admin';

  if (type === 'pr') {
    if (!allPRs.length) return;
    var headers = isAdmin
      ? ['Agent', 'Company', 'PR #', 'Date', 'Status', 'Item Description', 'Model/Part#', 'Qty', 'Unit Price', 'Total Price']
      : ['Company', 'PR #', 'Date', 'Status', 'Item Description', 'Model/Part#', 'Qty', 'Unit Price', 'Total Price'];
    var rows = allPRs.map(r => {
      var row = [r.clientName, r.prNumber, r.dateSent, r.status, r.itemDescription, r.modelPartNo, r.quantity, r.unitPrice || '', r.totalPrice || ''];
      if (isAdmin) row.unshift(r.agentName);
      return row;
    });
    var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending PRs');
    XLSX.writeFile(wb, 'pending-prs-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
}

// ─── Helpers ─────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatCurrency(val, currencyCode) {
  var n = Number(val);
  if (isNaN(n)) return String(val);
  var code = String(currencyCode || 'PHP').trim().toUpperCase();
  var symbolMap = {
    PHP: '\u20B1', PESO: '\u20B1',
    USD: '$', US$: '$',
    EUR: '\u20AC',
    JPY: '\u00A5', YEN: '\u00A5',
    GBP: '\u00A3',
    CNY: '\u00A5', RMB: '\u00A5',
    HKD: 'HK$',
    SGD: 'S$',
    AUD: 'A$'
  };
  var symbol = symbolMap[code] || (code + ' ');
  return symbol + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
