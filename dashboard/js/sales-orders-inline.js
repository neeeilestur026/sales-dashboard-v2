/* sales-orders-inline.js — A305 · the page's own script, moved verbatim out of sales-orders.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
/* ─── State ─────────────────────────────────────────── */
let soRecords = [];        // raw data from API
let activeFilter = 'all';  // 'all' | 'pending' | 'delivered'
let expandedRows = new Set();

/* ─── Init ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('sales-orders');
  document.getElementById('soDate').value = today();
  addItemRow(); // start with one blank item row
  await loadRecords();
});

/* ─── Helpers ───────────────────────────────────────── */
function today() { return new Date().toISOString().slice(0, 10); }
function esc(s) { return hxEsc(s); }
// For values embedded inside single-quoted onclick="fn('...')" attributes
function escQ(s) { return esc(s).replace(/'/g, '&#39;'); }
function php(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Form: toggle ──────────────────────────────────── */
function toggleForm() {
  const s = document.getElementById('formSection');
  const l = document.getElementById('toggleLabel');
  s.classList.toggle('open');
  l.textContent = s.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

// ─── Form: item rows ─────────────────────────────────
let itemCount = 0;
function addItemRow() {
  itemCount++;
  const id = itemCount;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.id = 'item-row-' + id;
  tr.innerHTML = `
    <td style="color: var(--hx-ink-3);font-size:0.78rem;padding:0.35rem 0.5rem;">${id}</td>
    <td><input type="text" id="iCode${id}" placeholder="e.g. PRD-001"></td>
    <td><input type="text" id="iDesc${id}" placeholder="Description" required></td>
    <td><input type="number" id="iQty${id}"   min="0" step="any" value="1"   oninput="calcRow(${id})" style="width:70px;"></td>
    <td><input type="number" id="iPrice${id}" min="0" step="0.01" value="0" oninput="calcRow(${id})" style="width:110px;"></td>
    <td class="amt-cell" id="iAmt${id}">₱0.00</td>
    <td><button type="button" class="rm-btn" onclick="removeItemRow(${id})">✕</button></td>`;
  tbody.appendChild(tr);
  recalcSummary();
}

function removeItemRow(id) {
  const tbody = document.getElementById('itemsBody');
  if (tbody.rows.length <= 1) return; // keep at least one
  document.getElementById('item-row-' + id).remove();
  recalcSummary();
}

function calcRow(id) {
  const qty   = parseFloat(document.getElementById('iQty'  + id).value) || 0;
  const price = parseFloat(document.getElementById('iPrice' + id).value) || 0;
  document.getElementById('iAmt' + id).textContent = php(qty * price);
  recalcSummary();
}

function getItemRows() {
  const items = [];
  const tbody = document.getElementById('itemsBody');
  for (const tr of tbody.rows) {
    const id = tr.id.replace('item-row-', '');
    const qty   = parseFloat(document.getElementById('iQty'  + id).value) || 0;
    const price = parseFloat(document.getElementById('iPrice' + id).value) || 0;
    items.push({
      productCode:        (document.getElementById('iCode' + id).value || '').trim(),
      productDescription: (document.getElementById('iDesc' + id).value || '').trim(),
      qty:   qty,
      unitPrice: price
    });
  }
  return items;
}

function recalcSummary() {
  const items = getItemRows();
  const total = items.reduce((s, it) => s + (it.qty * it.unitPrice), 0);
  const vatType = document.getElementById('soVatType').value;
  let sales, vat, grand;
  if (vatType === 'VAT Inclusive') {
    grand = total;
    vat   = total * (12 / 112);
    sales = total - vat;
    document.getElementById('sumSalesLbl').textContent = 'Sales (Net, VAT removed)';
    document.getElementById('sumVATLbl').textContent   = 'VAT (12%, included)';
    document.getElementById('sumGrandLbl').textContent = 'TOTAL AMOUNT (VAT Inclusive)';
  } else if (vatType === 'Zero Rated' || vatType === 'VAT Exempt') {
    sales = total;
    vat   = 0;
    grand = total;
    document.getElementById('sumSalesLbl').textContent = 'Sales';
    document.getElementById('sumVATLbl').textContent   = vatType === 'Zero Rated' ? 'VAT (0%)' : 'VAT (Exempt)';
    document.getElementById('sumGrandLbl').textContent = 'TOTAL AMOUNT (' + vatType + ')';
  } else {
    sales = total;
    vat   = total * 0.12;
    grand = total + vat;
    document.getElementById('sumSalesLbl').textContent = 'Sales (Net)';
    document.getElementById('sumVATLbl').textContent   = 'VAT (12%)';
    document.getElementById('sumGrandLbl').textContent = 'TOTAL AMOUNT (w/ VAT)';
  }
  document.getElementById('sumTotal').textContent = php(total);
  document.getElementById('sumSales').textContent = php(sales);
  document.getElementById('sumVAT').textContent   = php(vat);
  document.getElementById('sumGrand').textContent = php(grand);
}

function resetForm() {
  // clear header fields
  document.getElementById('soDate').value = today();
  document.getElementById('soNo').value = '';
  document.getElementById('soCustomerId').value = '';
  document.getElementById('soCustomerName').value = '';
  document.getElementById('soStatus').value = 'Pending';
  document.getElementById('soVatType').value = 'VAT Exclusive';
  document.getElementById('soInvoiceNo').value = '';
  // clear items
  document.getElementById('itemsBody').innerHTML = '';
  itemCount = 0;
  addItemRow();
  recalcSummary();
  const msg = document.getElementById('formMsg');
  msg.style.display = 'none';
}

/* ─── Form: submit ──────────────────────────────────── */
async function submitSO(e) {
  e.preventDefault();
  const btn = document.getElementById('soSubmitBtn');
  const msg = document.getElementById('formMsg');
  const items = getItemRows();

  if (!items.some(it => it.productDescription)) {
    showFormMsg('Please fill in at least one item description.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  msg.style.display = 'none';

  try {
    const _ses = (typeof getSession === 'function') ? getSession() : null;
    const result = await apiCreateSalesOrder({
      soNo:         document.getElementById('soNo').value.trim(),
      date:         document.getElementById('soDate').value,
      customerId:   document.getElementById('soCustomerId').value.trim(),
      customerName: document.getElementById('soCustomerName').value.trim(),
      status:       document.getElementById('soStatus').value,
      vatType:      document.getElementById('soVatType').value,
      invoiceNo:    document.getElementById('soInvoiceNo').value.trim(),
      items:        JSON.stringify(items),
      createdBy:    (_ses && _ses.name) || ''
    });

    if (result.success) {
      showFormMsg('Sales Order ' + result.soNo + ' saved successfully!', 'success');
      resetForm();
      clearApiCache();
      await loadRecords();
    } else {
      throw new Error(result.message || 'Failed to save');
    }
  } catch (err) {
    showFormMsg('Error: ' + err.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Save Sales Order';
}

function showFormMsg(text, type) {
  const msg = document.getElementById('formMsg');
  msg.style.display = 'block';
  msg.style.background = type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  msg.style.color = type === 'success' ? '#22c55e' : '#ef4444';
  msg.textContent = text;
}

/* ─── Records: load ─────────────────────────────────── */
async function loadRecords() {
  const container = document.getElementById('soContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const result = await apiGetSalesOrders();
    if (!result.success) throw new Error(result.message || 'Failed');
    soRecords = result.data || [];
    expandedRows.clear();
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color: var(--hx-red);">Error: ' + esc(err.message) + '</div>';
  }
}

/* ─── Records: filter + render ──────────────────────── */
function setFilter(f) {
  activeFilter = f;
  ['all','pending','delivered'].forEach(id => {
    document.getElementById('tab-' + id).classList.toggle('active', id === f);
  });
  renderTable();
}

function renderTable() {
  const search = (document.getElementById('soSearch').value || '').toLowerCase();
  const range = document.getElementById('dateRange') ? document.getElementById('dateRange').value : 'all';
  let rows = soRecords;

  // Date range filter
  if (range !== 'all') {
    rows = rows.filter(function(r) {
      var d = new Date(r.date || r.soDate);
      if (isNaN(d)) return false;
      var cutoff = new Date();
      if (range === '7d') cutoff.setDate(cutoff.getDate() - 7);
      else if (range === '30d') cutoff.setDate(cutoff.getDate() - 30);
      else if (range === '90d') cutoff.setDate(cutoff.getDate() - 90);
      else if (range === 'year') { cutoff.setMonth(0); cutoff.setDate(1); }
      return d >= cutoff;
    });
  }

  if (activeFilter === 'pending')   rows = rows.filter(r => r.status === 'Pending');
  if (activeFilter === 'delivered') rows = rows.filter(r => r.status === 'Delivered');
  if (search) rows = rows.filter(r =>
    (r.soNo || '').toLowerCase().includes(search) ||
    (r.customerName || '').toLowerCase().includes(search) ||
    (r.invoiceNo || '').toLowerCase().includes(search) ||
    (r.customerId || '').toLowerCase().includes(search)
  );

  document.getElementById('soCount').textContent =
    rows.length + ' sales order' + (rows.length !== 1 ? 's' : '');

  const container = document.getElementById('soContainer');
  if (rows.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color: var(--hx-ink-3);">No sales orders found.</div>';
    return;
  }

  let html = '<table class="so-table"><thead><tr>' +
    '<th></th><th>SO No.</th><th>Date</th><th>Customer ID</th><th>Customer Name</th>' +
    '<th style="text-align:center;">Items</th>' +
    '<th style="text-align:right;">Total Amount</th>' +
    '<th style="text-align:right;">Sales</th>' +
    '<th style="text-align:right;">VAT</th>' +
    '<th style="text-align:right;">Grand Total</th>' +
    '<th>VAT Type</th>' +
    '<th>Status</th><th>Invoice No.</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  rows.forEach(r => {
    const expanded = expandedRows.has(r.soNo);
    const badgeClass = r.status === 'Delivered' ? 'badge-delivered' : 'badge-pending';
    const expandIcon = expanded
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

    html += `<tr class="main-row" id="main-${esc(r.soNo)}">
      <td><button onclick="toggleItems('${escQ(r.soNo)}')" style="background: none;border: none;cursor:pointer;color: var(--hx-ink-3);display:flex;align-items:center;">${expandIcon}</button></td>
      <td><strong style="color: var(--hx-navy-text);">${esc(r.soNo)}</strong></td>
      <td style="white-space:nowrap;">${esc(r.date)}</td>
      <td style="font-size:0.8rem;color: var(--hx-ink-3);">${esc(r.customerId)}</td>
      <td><strong>${esc(r.customerName)}</strong></td>
      <td style="text-align:center;">
        <button onclick="toggleItems('${escQ(r.soNo)}')" style="background: var(--hx-cyan-soft);color: var(--hx-navy-text);border: none;border-radius: 999px;padding:0.15rem 0.5rem;font-size:0.72rem;font-weight:600;cursor:pointer;">${r.items ? r.items.length : 0} item${(r.items && r.items.length !== 1) ? 's' : ''}</button>
      </td>
      <td style="text-align:right;">${php(r.totalAmount)}</td>
      <td style="text-align:right;">${php(r.sales)}</td>
      <td style="text-align:right;color: var(--hx-ink-3);">${php(r.vat)}</td>
      <td style="text-align:right;font-weight:700;color: var(--hx-navy-text);">${php(r.grandTotal)}</td>
      <td><span style="font-size:0.72rem;padding:0.15rem 0.5rem;border-radius: 999px;font-weight:600;background: ${r.vatType === 'VAT Inclusive' ? 'var(--hx-navy-line)' : 'var(--hx-cyan-soft)'};color: ${r.vatType === 'VAT Inclusive' ? 'var(--hx-navy-text)' : 'var(--hx-cyan-ink)'};">${esc(r.vatType || 'VAT Exclusive')}</span></td>
      <td><span class="badge ${badgeClass}">${esc(r.status)}</span></td>
      <td style="font-size:0.8rem;">${esc(r.invoiceNo)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="openModal('${escQ(r.soNo)}','${escQ(r.status)}','${escQ(r.invoiceNo)}','${escQ(r.customerName)}')" style="font-size:0.7rem;padding:0.15rem 0.5rem;margin-right:0.25rem;">Edit</button>
        ${r.driveFolderLink ? `<button onclick="viewDocs('${escQ(r.soNo)}')" title="View Documents" style="font-size:0.7rem;padding:0.15rem 0.4rem;border-radius: 4px;border: 1px solid var(--hx-cyan-ring);background: var(--hx-cyan-soft);color: var(--hx-navy-text);cursor:pointer;margin-right:0.25rem;">Docs</button>` : ''}
        <button onclick="deleteSO('${escQ(r.soNo)}')" style="font-size:0.7rem;padding:0.15rem 0.4rem;border-radius: 4px;border: 1px solid var(--hx-red-soft);background: var(--hx-red-soft);color: var(--hx-red);cursor:pointer;">Del</button>
      </td>
    </tr>`;

    // Expandable items sub-row
    html += `<tr class="items-row ${expanded ? '' : 'hidden'}" id="items-${esc(r.soNo)}">
      <td colspan="14">
        <div class="inner">`;
    if (r.items && r.items.length > 0) {
      html += `<table style="width:100%;border-collapse: collapse;font-size:0.8rem;">
        <tr>
          <th style="text-align:left;padding:0.25rem 0.5rem;color: var(--hx-ink-3);border-bottom: 1px solid var(--hx-hair-2);">#</th>
          <th style="text-align:left;padding:0.25rem 0.5rem;color: var(--hx-ink-3);border-bottom: 1px solid var(--hx-hair-2);">Product Code</th>
          <th style="text-align:left;padding:0.25rem 0.5rem;color: var(--hx-ink-3);border-bottom: 1px solid var(--hx-hair-2);">Description</th>
          <th style="text-align:right;padding:0.25rem 0.5rem;color: var(--hx-ink-3);border-bottom: 1px solid var(--hx-hair-2);">Qty</th>
          <th style="text-align:right;padding:0.25rem 0.5rem;color: var(--hx-ink-3);border-bottom: 1px solid var(--hx-hair-2);">Unit Price</th>
          <th style="text-align:right;padding:0.25rem 0.5rem;color: var(--hx-ink-3);border-bottom: 1px solid var(--hx-hair-2);">Amount</th>
        </tr>`;
      r.items.forEach((it, idx) => {
        html += `<tr>
          <td style="padding:0.25rem 0.5rem;color: var(--hx-ink-3);">${idx + 1}</td>
          <td style="padding:0.25rem 0.5rem;">${esc(it.productCode)}</td>
          <td style="padding:0.25rem 0.5rem;">${esc(it.productDescription)}</td>
          <td style="text-align:right;padding:0.25rem 0.5rem;">${Number(it.qty).toLocaleString('en-PH')}</td>
          <td style="text-align:right;padding:0.25rem 0.5rem;">${php(it.unitPrice)}</td>
          <td style="text-align:right;padding:0.25rem 0.5rem;font-weight:600;">${php(it.amount)}</td>
        </tr>`;
      });
      html += `</table>`;
    } else {
      html += `<span style="color: var(--hx-ink-3);font-size:0.8rem;">No items.</span>`;
    }
    html += `</div></td></tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function toggleItems(soNo) {
  if (expandedRows.has(soNo)) expandedRows.delete(soNo);
  else expandedRows.add(soNo);
  renderTable();
}

/* ─── Edit Modal ────────────────────────────────────── */
let editItemCount = 0;

function editAddItemRow(prefill) {
  editItemCount++;
  const id = editItemCount;
  const tbody = document.getElementById('editItemsBody');
  const tr = document.createElement('tr');
  tr.id = 'edit-item-row-' + id;
  const p = prefill || {};
  tr.innerHTML = `
    <td style="color: var(--hx-ink-3);font-size:0.78rem;padding:0.35rem 0.5rem;">${id}</td>
    <td><input type="text" id="eCode${id}" value="${esc(p.productCode || '')}" placeholder="PRD-001"></td>
    <td><input type="text" id="eDesc${id}" value="${esc(p.productDescription || '')}" placeholder="Description"></td>
    <td><input type="number" id="eQty${id}"   min="0" step="any"  value="${Number(p.qty || 1)}"        oninput="editCalcRow(${id})" style="width:70px;"></td>
    <td><input type="number" id="ePrice${id}" min="0" step="0.01" value="${Number(p.unitPrice || 0)}" oninput="editCalcRow(${id})" style="width:110px;"></td>
    <td class="amt-cell" id="eAmt${id}">${php((p.qty || 0) * (p.unitPrice || 0))}</td>
    <td><button type="button" class="rm-btn" onclick="editRemoveItemRow(${id})">✕</button></td>`;
  tbody.appendChild(tr);
  editRecalcSummary();
}

function editRemoveItemRow(id) {
  const tbody = document.getElementById('editItemsBody');
  if (tbody.rows.length <= 1) return;
  document.getElementById('edit-item-row-' + id).remove();
  editRecalcSummary();
}

function editCalcRow(id) {
  const qty   = parseFloat(document.getElementById('eQty'   + id).value) || 0;
  const price = parseFloat(document.getElementById('ePrice' + id).value) || 0;
  document.getElementById('eAmt' + id).textContent = php(qty * price);
  editRecalcSummary();
}

function getEditItemRows() {
  const items = [];
  const tbody = document.getElementById('editItemsBody');
  for (const tr of tbody.rows) {
    const id = tr.id.replace('edit-item-row-', '');
    const qty   = parseFloat(document.getElementById('eQty'   + id).value) || 0;
    const price = parseFloat(document.getElementById('ePrice' + id).value) || 0;
    items.push({
      productCode:        (document.getElementById('eCode' + id).value || '').trim(),
      productDescription: (document.getElementById('eDesc' + id).value || '').trim(),
      qty: qty,
      unitPrice: price
    });
  }
  return items;
}

function editRecalcSummary() {
  const items = getEditItemRows();
  const total = items.reduce((s, it) => s + (it.qty * it.unitPrice), 0);
  const vatType = document.getElementById('editVatType').value;
  let sales, vat, grand;
  if (vatType === 'VAT Inclusive') {
    grand = total; vat = total * (12 / 112); sales = total - vat;
    document.getElementById('editSumSalesLbl').textContent = 'Sales (Net, VAT removed)';
    document.getElementById('editSumVATLbl').textContent   = 'VAT (12%, included)';
    document.getElementById('editSumGrandLbl').textContent = 'TOTAL (VAT Inclusive)';
  } else if (vatType === 'Zero Rated' || vatType === 'VAT Exempt') {
    sales = total; vat = 0; grand = total;
    document.getElementById('editSumSalesLbl').textContent = 'Sales';
    document.getElementById('editSumVATLbl').textContent   = vatType === 'Zero Rated' ? 'VAT (0%)' : 'VAT (Exempt)';
    document.getElementById('editSumGrandLbl').textContent = 'TOTAL (' + vatType + ')';
  } else {
    sales = total; vat = total * 0.12; grand = total + vat;
    document.getElementById('editSumSalesLbl').textContent = 'Sales (Net)';
    document.getElementById('editSumVATLbl').textContent   = 'VAT (12%)';
    document.getElementById('editSumGrandLbl').textContent = 'TOTAL (w/ VAT)';
  }
  document.getElementById('editSumTotal').textContent = php(total);
  document.getElementById('editSumSales').textContent = php(sales);
  document.getElementById('editSumVAT').textContent   = php(vat);
  document.getElementById('editSumGrand').textContent = php(grand);
}

function openModal(soNo, status, invoiceNo, customerName) {
  const rec = soRecords.find(r => r.soNo === soNo) || {};
  document.getElementById('modalSONo').value         = soNo;
  document.getElementById('modalCustomerName').value = customerName || rec.customerName || '';
  document.getElementById('modalSONoDisplay').value  = soNo;
  document.getElementById('editSoNoTitle').textContent = soNo;
  document.getElementById('editSoDate').value        = (rec.date || '').slice(0, 10);
  document.getElementById('editCustomerId').value    = rec.customerId || '';
  document.getElementById('editCustomerName').value  = customerName || rec.customerName || '';
  document.getElementById('modalStatus').value       = status || rec.status || 'Pending';
  document.getElementById('editVatType').value       = rec.vatType || 'VAT Exclusive';
  document.getElementById('modalInvoiceNo').value    = invoiceNo || rec.invoiceNo || '';
  document.getElementById('modalFiles').value = '';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('modalMsg').style.display = 'none';
  document.getElementById('uploadSection').style.display = ((status || rec.status) === 'Delivered') ? '' : 'none';

  // Repopulate items
  document.getElementById('editItemsBody').innerHTML = '';
  editItemCount = 0;
  const items = (rec.items && rec.items.length) ? rec.items : [{ productCode:'', productDescription:'', qty:1, unitPrice:0 }];
  items.forEach(editAddItemRow);

  document.getElementById('statusModal').classList.add('open');
}

function onStatusChange() {
  const status = document.getElementById('modalStatus').value;
  document.getElementById('uploadSection').style.display = (status === 'Delivered') ? '' : 'none';
}

function closeModal(e) {
  if (e.target === document.getElementById('statusModal')) {
    document.getElementById('statusModal').classList.remove('open');
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveStatus() {
  const soNo         = document.getElementById('modalSONo').value;
  const customerName = document.getElementById('editCustomerName').value.trim() || document.getElementById('modalCustomerName').value;
  const status       = document.getElementById('modalStatus').value;
  const invoiceNo    = document.getElementById('modalInvoiceNo').value.trim();
  const filesInput   = document.getElementById('modalFiles');
  const progressEl   = document.getElementById('uploadProgress');
  const msgEl        = document.getElementById('modalMsg');
  const saveBtn      = document.getElementById('editSaveBtn');
  msgEl.style.display = 'none';

  const items = getEditItemRows().filter(it => it.productDescription || it.productCode || it.qty || it.unitPrice);
  if (!items.length) {
    msgEl.style.display = 'block';
    msgEl.style.background = 'rgba(239,68,68,0.12)';
    msgEl.style.color = '#ef4444';
    msgEl.textContent = 'At least one line item is required.';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    // 1) Update all editable fields (replaces rows)
    const upd = await apiUpdateSalesOrder({
      soNo: soNo,
      date: document.getElementById('editSoDate').value,
      customerId: document.getElementById('editCustomerId').value.trim(),
      customerName: customerName,
      status: status,
      vatType: document.getElementById('editVatType').value,
      invoiceNo: invoiceNo,
      items: JSON.stringify(items)
    });
    if (!upd.success) throw new Error(upd.message || 'Failed to update');

    // 2) Upload any new files (preserves driveFolderLink update path)
    let driveFolderLink = '';
    if (filesInput.files.length > 0) {
      progressEl.style.display = 'block';
      for (const file of filesInput.files) {
        progressEl.textContent = `Uploading ${file.name}…`;
        const base64 = await fileToBase64(file);
        const upResult = await apiUploadSODocument(soNo, customerName, file.name, base64, file.type || 'application/octet-stream');
        if (!upResult.success) throw new Error('Upload failed: ' + (upResult.message || file.name));
        driveFolderLink = upResult.folderLink || driveFolderLink;
      }
      progressEl.style.display = 'none';
      if (driveFolderLink) {
        await apiUpdateSOStatus(soNo, status, invoiceNo, driveFolderLink);
      }
    }

    document.getElementById('statusModal').classList.remove('open');
    clearApiCache();
    await loadRecords();
  } catch (err) {
    progressEl.style.display = 'none';
    msgEl.style.display = 'block';
    msgEl.style.background = 'rgba(239,68,68,0.12)';
    msgEl.style.color = '#ef4444';
    msgEl.textContent = 'Error: ' + err.message;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

/* ─── Docs Mini-Window ──────────────────────────────── */
function closeDocsModal(e) {
  if (!e || e.target === document.getElementById('docsModal')) {
    document.getElementById('docsModal').classList.remove('open');
  }
}

async function viewDocs(soNo) {
  const modal    = document.getElementById('docsModal');
  const listEl   = document.getElementById('docsModalList');
  const folderEl = document.getElementById('docsModalFolderLink');
  document.getElementById('docsModalSONo').textContent = soNo;
  listEl.innerHTML = '<div style="color: var(--hx-ink-3);font-size:0.85rem;">Loading…</div>';
  folderEl.style.display = 'none';
  modal.classList.add('open');

  try {
    const result = await apiGetSODocuments(soNo);
    if (!result.success) throw new Error(result.message || 'Failed to load');

    if (result.folderLink) {
      folderEl.href = result.folderLink;
      folderEl.style.display = '';
    }

    if (!result.files || result.files.length === 0) {
      listEl.innerHTML = '<div style="color: var(--hx-ink-3);font-size:0.85rem;">No documents uploaded yet.</div>';
    } else {
      let html = '<div style="display:flex;flex-direction:column;gap:0.4rem;">';
      result.files.forEach(f => {
        const icon = f.mimeType && f.mimeType.includes('pdf') ? 'PDF' : (f.mimeType && f.mimeType.startsWith('image') ? 'IMG' : 'DOC');
        html += `<a href="${esc(f.link)}" target="_blank" style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;border-radius: 8px;background: var(--hx-cyan-soft);color: var(--hx-navy-text);text-decoration:none;font-size:0.83rem;">
          <span>${icon}</span><span>${esc(f.name)}</span>
          <span style="margin-left:auto;font-size:0.72rem;color: var(--hx-ink-3);">View ↗</span>
        </a>`;
      });
      html += '</div>';
      listEl.innerHTML = html;
    }
  } catch (err) {
    listEl.innerHTML = '<div style="color: var(--hx-red);font-size:0.85rem;">Error: ' + esc(err.message) + '</div>';
  }
}

/* ─── Delete SO ─────────────────────────────────────── */
async function deleteSO(soNo) {
  if (!confirm('Delete all rows for ' + soNo + '? This cannot be undone.')) return;
  try {
    const result = await apiDeleteSalesOrder(soNo);
    if (result.success) {
      clearApiCache();
      await loadRecords();
    } else {
      alert('Error: ' + (result.message || 'Failed to delete'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ─── Export Excel ──────────────────────────────────── */
async function exportExcel() {
  const btn = document.getElementById('exportBtn');
  btn.disabled = true;
  btn.textContent = 'Exporting...';
  try {
    await loadXLSX();
    const rows = [];
    // Header rows
    rows.push(['SO No', 'Date', 'Customer ID', 'Customer Name',
      'Product Code', 'Product Description', 'Quantity', 'Unit Price', 'Amount',
      'Total Amount', 'Sales', 'VAT', 'Total Amount (w/ VAT)', 'VAT Type', 'Status', 'Invoice No']);

    soRecords.forEach(so => {
      (so.items || []).forEach(it => {
        rows.push([
          so.soNo, so.date, so.customerId, so.customerName,
          it.productCode, it.productDescription, it.qty, it.unitPrice, it.amount,
          so.totalAmount, so.sales, so.vat, so.grandTotal, so.vatType || 'VAT Exclusive', so.status, so.invoiceNo
        ]);
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws['!cols'] = [
      {wch:16},{wch:12},{wch:14},{wch:22},
      {wch:14},{wch:28},{wch:8},{wch:12},{wch:12},
      {wch:14},{wch:12},{wch:10},{wch:18},{wch:12},{wch:14}
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Sales Orders');
    const fileName = 'SalesOrders_' + new Date().toISOString().slice(0,10) + '.xlsx';
    XLSX.writeFile(wb, fileName);
  } catch (err) {
    alert('Export error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Excel';
}
