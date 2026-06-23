/* ═══════════════════════════════════════════════
   inventory.js — Inventory Management logic
   (Reads from the same Inventory tab MRO/MI update)
   ═══════════════════════════════════════════════ */

let inventoryData = [];
let filteredData = [];
let editingRowIndex = null;
let inventorySession = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAccountingOrAdmin();
  if (!session) return;
  inventorySession = session;
  renderNavbar('inventory');
  applyInventoryPermissions();
  await loadInventory();
});

function isInventoryAdmin() {
  return inventorySession && inventorySession.role === 'admin';
}

function applyInventoryPermissions() {
  if (isInventoryAdmin()) return;
  const formToggle = document.querySelector('.form-toggle');
  const formCard = formToggle ? formToggle.closest('.chart-card') : null;
  if (formCard) formCard.style.display = 'none';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleInvForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

function resetInvForm() {
  document.getElementById('invForm').reset();
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Item';
  document.getElementById('submitBtn').textContent = 'Add Item';
  document.getElementById('formMsg').style.display = 'none';
  editingRowIndex = null;
}

function editItem(rowIndex) {
  if (!isInventoryAdmin()) return;
  const item = inventoryData.find(i => i.rowIndex === rowIndex);
  if (!item) return;

  editingRowIndex = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('invModelNo').value = item.modelNo;
  document.getElementById('invDescription').value = item.description;
  document.getElementById('invQty').value = item.qty;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Item';
  document.getElementById('submitBtn').textContent = 'Update Item';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleInvForm();
  document.getElementById('invModelNo').focus();
}

async function submitItem(e) {
  e.preventDefault();
  if (!isInventoryAdmin()) return;
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    modelNo: document.getElementById('invModelNo').value.trim(),
    description: document.getElementById('invDescription').value.trim(),
    qty: document.getElementById('invQty').value
  };

  try {
    let result;
    if (editingRowIndex !== null) {
      data.rowIndex = String(editingRowIndex);
      btn.textContent = 'Updating...';
      result = await fetchFromAPI({ action: 'updateInventoryItem', ...data });
    } else {
      btn.textContent = 'Adding...';
      result = await fetchFromAPI({ action: 'addInventoryItem', ...data });
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = result.message || 'Success!';
    resetInvForm();
    clearApiCache();
    await loadInventory();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRowIndex ? 'Update Item' : 'Add Item';
}

async function deleteItem(rowIndex, modelNo) {
  if (!isInventoryAdmin()) return;
  if (!confirm('Delete item "' + modelNo + '"? This cannot be undone.')) return;
  try {
    const result = await fetchFromAPI({ action: 'deleteInventoryItem', rowIndex: String(rowIndex) });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadInventory();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadInventory() {
  const container = document.getElementById('invContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading inventory...</span></div>';

  try {
    const result = await fetchFromAPI({ action: 'getInventory' });
    if (!result.success) throw new Error(result.message || 'Failed');
    inventoryData = result.data || [];
    updateKPIs();
    showLowStockAlert();
    filterInventory();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function updateKPIs() {
  let totalQty = 0, lowCount = 0, outCount = 0;
  inventoryData.forEach(item => {
    totalQty += item.qty;
    if (item.qty === 0) outCount++;
    else if (item.qty < 10) lowCount++;
  });
  document.getElementById('totalItems').textContent = inventoryData.length;
  document.getElementById('totalQty').textContent = totalQty.toLocaleString();
  document.getElementById('lowStockCount').textContent = lowCount;
  document.getElementById('outOfStock').textContent = outCount;
}

function showLowStockAlert() {
  const lowItems = inventoryData.filter(i => i.qty < 10 && i.qty > 0);
  const outItems = inventoryData.filter(i => i.qty === 0);
  const alertDiv = document.getElementById('lowStockAlert');
  const listDiv = document.getElementById('lowStockList');

  if (lowItems.length === 0 && outItems.length === 0) {
    alertDiv.style.display = 'none';
    return;
  }

  alertDiv.style.display = 'block';
  let html = '';
  outItems.forEach(i => {
    html += '<div style="padding:0.3rem 0;display:flex;gap:0.5rem;align-items:center;">' +
      '<span class="low-badge">OUT OF STOCK</span> <strong>' + esc(i.modelNo) + '</strong> — ' + esc(i.description) + '</div>';
  });
  lowItems.forEach(i => {
    html += '<div style="padding:0.3rem 0;display:flex;gap:0.5rem;align-items:center;">' +
      '<span class="low-badge">LOW: ' + i.qty + '</span> <strong>' + esc(i.modelNo) + '</strong> — ' + esc(i.description) + '</div>';
  });
  listDiv.innerHTML = html;
}

function filterInventory() {
  const search = (document.getElementById('invSearch').value || '').trim().toLowerCase();
  const stockFilter = document.getElementById('stockFilter').value;

  filteredData = inventoryData.filter(item => {
    if (search && (item.modelNo + ' ' + item.description).toLowerCase().indexOf(search) === -1) return false;
    if (stockFilter === 'low' && item.qty >= 10) return false;
    if (stockFilter === 'out' && item.qty !== 0) return false;
    return true;
  });

  document.getElementById('invCount').textContent = filteredData.length + ' item' + (filteredData.length !== 1 ? 's' : '');
  renderTable(filteredData);
}

function renderTable(data) {
  const container = document.getElementById('invContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted,#64748b);">No items found.</div>';
    return;
  }

  let html = '<table class="inv-table"><thead><tr>' +
    '<th>Model No.</th><th>Item Description</th><th>Stock Qty</th><th>Status</th><th>Last Updated</th>' +
    (isInventoryAdmin() ? '<th>Actions</th>' : '') +
    '</tr></thead><tbody>';

  data.forEach(item => {
    let stockClass = 'stock-ok';
    let statusText = 'In Stock';
    if (item.qty === 0) { stockClass = 'stock-low'; statusText = 'Out of Stock'; }
    else if (item.qty < 10) { stockClass = 'stock-med'; statusText = 'Low Stock'; }

    html += '<tr>' +
      '<td><strong>' + esc(item.modelNo) + '</strong></td>' +
      '<td>' + esc(item.description) + '</td>' +
      '<td class="' + stockClass + '">' + item.qty + '</td>' +
      '<td><span class="' + stockClass + '">' + statusText + '</span></td>' +
      '<td style="font-size:0.8rem;color:var(--text-muted);">' + esc(item.lastUpdated) + '</td>';

    if (isInventoryAdmin()) {
      html +=
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-sm btn-secondary" onclick="editItem(' + item.rowIndex + ')" style="margin-right:0.3rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);" onclick="deleteItem(' + item.rowIndex + ',\'' + esc(item.modelNo).replace(/'/g, "\\'") + '\')" title="Delete">Delete</button>' +
      '</td>';
    }

    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

async function exportInventoryExcel() {
  if (!filteredData.length) return;
  await loadXLSX();
  const headers = ['Model No.', 'Item Description', 'Qty', 'Status', 'Last Updated'];
  const rows = filteredData.map(i => {
    let status = 'In Stock';
    if (i.qty === 0) status = 'Out of Stock';
    else if (i.qty < 10) status = 'Low Stock';
    return [i.modelNo, i.description, i.qty, status, i.lastUpdated];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.writeFile(wb, 'inventory-' + new Date().toISOString().slice(0,10) + '.xlsx');
}
