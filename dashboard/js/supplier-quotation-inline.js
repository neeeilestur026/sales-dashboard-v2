/* supplier-quotation-inline.js — A305 · the page's own script, moved verbatim out of supplier-quotation.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
let sqRecords = [];
let lineItems = []; // {itemDescription, prItemDescription, qty, pricePerUnit, totalAmount}
let uploadFiles = []; // File objects
let editingRowIndex = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('supplier-quotation');
  document.getElementById('sqDate').value = new Date().toISOString().slice(0, 10);

  // Drag-and-drop
  var dropArea = document.getElementById('fileDropArea');
  dropArea.addEventListener('dragover', function(e) { e.preventDefault(); dropArea.classList.add('dragover'); });
  dropArea.addEventListener('dragleave', function() { dropArea.classList.remove('dragover'); });
  dropArea.addEventListener('drop', function(e) { e.preventDefault(); dropArea.classList.remove('dragover'); handleFileSelect(e.dataTransfer.files); });

  await loadRecords();

  // Check for PR-to-SQ bridge data
  var prSQData = sessionStorage.getItem('prToSQData');
  if (prSQData) {
    sessionStorage.removeItem('prToSQData');
    prefillFromPR(prSQData);
  } else {
    // Start with one empty line item
    addLineItem();
  }
});

function toggleForm() {
  const section = document.getElementById('formSection');
  const label = document.getElementById('toggleLabel');
  section.classList.toggle('open');
  label.textContent = section.classList.contains('open') ? 'Hide Form' : 'Show Form';
}

// ─── Line Items ─────────────────────────────────

function addLineItem(data) {
  var item = data || { itemDescription: '', prItemDescription: '', qty: 1, pricePerUnit: 0, totalAmount: 0 };
  lineItems.push(item);
  renderLineItems();
}

function removeLineItem(idx) {
  if (lineItems.length <= 1) { alert('At least one item is required.'); return; }
  lineItems.splice(idx, 1);
  renderLineItems();
}

function renderLineItems() {
  var tbody = document.getElementById('lineItemsBody');
  var html = '';
  for (var i = 0; i < lineItems.length; i++) {
    var it = lineItems[i];
    html += '<tr data-line-idx="' + i + '">' +
      '<td style="color: var(--text-muted);font-weight:600;">' + (i + 1) + '</td>' +
      '<td>' +
        '<textarea class="li-desc" oninput="updateLineItem(' + i + ',\'itemDescription\',this.value)" placeholder="Supplier\'s item description">' + esc(it.itemDescription) + '</textarea>' +
        (it.prItemDescription ? '<span class="pr-ref" title="Original PR description">PR: ' + esc(it.prItemDescription) + '</span>' : '') +
      '</td>' +
      '<td><input class="li-qty" type="number" min="1" value="' + (it.qty || 1) + '" oninput="updateLineItem(' + i + ',\'qty\',this.value)" onchange="calcLineTotal(' + i + ')"></td>' +
      '<td><input class="li-price" type="number" min="0" step="0.01" value="' + (it.pricePerUnit || 0) + '" oninput="updateLineItem(' + i + ',\'pricePerUnit\',this.value)" onchange="calcLineTotal(' + i + ')"></td>' +
      '<td style="text-align:right;font-weight:600;color: var(--accent);padding-top:0.6rem;">' + formatNum(it.totalAmount || 0) + '</td>' +
      '<td><button type="button" class="btn-remove-item" onclick="removeLineItem(' + i + ')">X</button></td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
  calcGrandTotal();
}

function updateLineItem(idx, field, value) {
  if (field === 'qty') lineItems[idx].qty = parseInt(value) || 1;
  else if (field === 'pricePerUnit') lineItems[idx].pricePerUnit = parseFloat(value) || 0;
  else lineItems[idx][field] = value;
}

// Defensive: force-read every line-item input from the DOM into lineItems[].
// Guards against "user typed a price then clicked Submit before blur fired"
// — without this, the change event never updated lineItems and the SQ
// would save with the previous (often zero) price.
function _commitLineItemsFromDOM() {
  var rows = document.querySelectorAll('#lineItemsBody tr[data-line-idx]');
  rows.forEach(function (tr) {
    var i = parseInt(tr.getAttribute('data-line-idx'));
    if (isNaN(i) || !lineItems[i]) return;
    var descEl = tr.querySelector('.li-desc');
    var qtyEl = tr.querySelector('.li-qty');
    var priceEl = tr.querySelector('.li-price');
    if (descEl) lineItems[i].itemDescription = descEl.value;
    if (qtyEl) lineItems[i].qty = parseInt(qtyEl.value) || 1;
    if (priceEl) lineItems[i].pricePerUnit = parseFloat(priceEl.value) || 0;
    lineItems[i].totalAmount = (lineItems[i].qty || 1) * (lineItems[i].pricePerUnit || 0);
  });
}

function calcLineTotal(idx) {
  var it = lineItems[idx];
  it.totalAmount = (parseInt(it.qty) || 1) * (parseFloat(it.pricePerUnit) || 0);
  renderLineItems();
}

function calcGrandTotal() {
  var total = 0;
  for (var i = 0; i < lineItems.length; i++) total += (lineItems[i].totalAmount || 0);
  document.getElementById('grandTotal').textContent = 'Grand Total: ' + formatNum(total);
}

// ─── File Upload ────────────────────────────────

function handleFileSelect(files) {
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f.size > 10 * 1024 * 1024) { alert(f.name + ' is too large (max 10MB).'); continue; }
    uploadFiles.push(f);
  }
  renderFileList();
}

function removeFile(idx) {
  uploadFiles.splice(idx, 1);
  renderFileList();
}

function renderFileList() {
  var ul = document.getElementById('fileList');
  if (!uploadFiles.length) { ul.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < uploadFiles.length; i++) {
    var f = uploadFiles[i];
    var size = f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB';
    html += '<li><span class="file-name">' + esc(f.name) + '</span><span class="file-size">' + size + '</span>' +
      '<button type="button" class="btn-remove-item" onclick="removeFile(' + i + ')" style="margin-left:0.5rem;">X</button></li>';
  }
  ul.innerHTML = html;
}

function readFileAsBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var result = reader.result;
      var idx = result.indexOf(',');
      resolve(idx >= 0 ? result.substring(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── PR Bridge ──────────────────────────────────

function prefillFromPR(dataStr) {
  try {
    var d = JSON.parse(dataStr);
    document.getElementById('sqPRNumber').value = d.prNumber || '';
    document.getElementById('sqPRAgentName').value = d.prAgentName || '';

    // Show PR link banner
    document.getElementById('prLinkBanner').style.display = 'block';
    document.getElementById('prLinkInfo').textContent =
      (d.prNumber || 'N/A') + ' — ' + (d.clientName || '') + (d.prAgentName ? ' (Agent: ' + d.prAgentName + ')' : '');

    // Multi-item: build line items from the items array
    lineItems = [];
    if (d.items && d.items.length) {
      var itemsHtml = '';
      for (var i = 0; i < d.items.length; i++) {
        var it = d.items[i];
        lineItems.push({
          itemDescription: '', // admin fills supplier description
          prItemDescription: it.prItemDescription || '',
          qty: parseInt(it.quantity) || 1,
          pricePerUnit: 0,
          totalAmount: 0
        });
        itemsHtml += '<div>' + (i + 1) + '. ' + esc(it.prItemDescription || '') +
          (it.modelPartNo ? ' <span style="color: var(--text-muted);">[' + esc(it.modelPartNo) + ']</span>' : '') +
          ' &times; ' + (it.quantity || 1) + '</div>';
      }
      document.getElementById('prLinkItems').innerHTML = '<strong style="color: var(--hx-cyan-ink);">Items:</strong>' + itemsHtml;
    } else {
      // Single-item fallback
      lineItems.push({
        itemDescription: '',
        prItemDescription: d.prItemDescription || '',
        qty: parseInt(d.quantity) || 1,
        pricePerUnit: 0,
        totalAmount: 0
      });
      document.getElementById('prLinkItems').innerHTML = '<strong style="color: var(--hx-cyan-ink);">Item:</strong> ' + esc(d.prItemDescription || '');
    }
    renderLineItems();

    // Auto-open form
    var section = document.getElementById('formSection');
    if (!section.classList.contains('open')) toggleForm();
  } catch (e) {
    console.error('Failed to parse PR bridge data:', e);
    addLineItem();
  }
}

// ─── Submit ─────────────────────────────────────

async function submitQuotation(e) {
  e.preventDefault();
  var btn = document.getElementById('submitBtn');
  var msg = document.getElementById('formMsg');
  msg.style.display = 'none';

  _commitLineItemsFromDOM();

  // Validate line items
  for (var i = 0; i < lineItems.length; i++) {
    if (!lineItems[i].itemDescription.trim()) {
      alert('Please fill in the supplier item description for item #' + (i + 1) + '.');
      return;
    }
    if (!lineItems[i].pricePerUnit || lineItems[i].pricePerUnit <= 0) {
      alert('Please enter a price greater than 0 for item #' + (i + 1) + '.');
      return;
    }
  }

  var supplier = document.getElementById('sqSupplier').value.trim();
  if (!supplier) { alert('Supplier company name is required.'); return; }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  var session = getSession();
  try {
    // Step 1: Save quotation rows
    var itemsJson = JSON.stringify(lineItems.map(function(it) {
      return {
        itemDescription: it.itemDescription.trim(),
        prItemDescription: it.prItemDescription || '',
        qty: String(it.qty || 1),
        pricePerUnit: String(it.pricePerUnit || 0),
        totalAmount: String(it.totalAmount || 0)
      };
    }));

    var data = {
      date: document.getElementById('sqDate').value,
      supplierCompany: supplier,
      contactPerson: document.getElementById('sqContact').value.trim(),
      contactNumber: document.getElementById('sqPhone').value.trim(),
      email: document.getElementById('sqEmail').value.trim(),
      referenceNo: document.getElementById('sqRefNo').value.trim(),
      currency: document.getElementById('sqCurrency').value,
      remarks: document.getElementById('sqRemarks').value.trim(),
      submittedBy: session ? session.name : '',
      prNumber: document.getElementById('sqPRNumber').value,
      prAgentName: document.getElementById('sqPRAgentName').value,
      itemsJson: itemsJson
    };

    var result;
    if (editingRowIndex) {
      // For edit, only single-item is supported (row-level edit)
      data.rowIndex = String(editingRowIndex);
      data.itemDescription = lineItems[0].itemDescription.trim();
      data.prItemDescription = lineItems[0].prItemDescription || '';
      data.qty = String(lineItems[0].qty || 1);
      data.pricePerUnit = String(lineItems[0].pricePerUnit || 0);
      data.totalAmount = String(lineItems[0].totalAmount || 0);
      delete data.itemsJson;
      result = await apiUpdateSupplierQuotation(data);
    } else {
      result = await apiAddSupplierQuotation(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed to save');

    var rowIndices = result.rowIndices || [];

    // Step 2: Upload files if any
    if (uploadFiles.length > 0 && rowIndices.length > 0) {
      btn.textContent = 'Uploading files...';
      var progress = document.getElementById('uploadProgress');
      progress.style.display = 'block';
      document.getElementById('uploadStatus').textContent = 'Reading files...';
      document.getElementById('uploadFill').style.width = '20%';

      var filesData = [];
      for (var f = 0; f < uploadFiles.length; f++) {
        var base64 = await readFileAsBase64(uploadFiles[f]);
        filesData.push({
          name: uploadFiles[f].name,
          base64: base64,
          mimeType: uploadFiles[f].type || 'application/octet-stream'
        });
      }

      document.getElementById('uploadStatus').textContent = 'Uploading to Drive...';
      document.getElementById('uploadFill').style.width = '50%';

      var itemDescs = lineItems.map(function(it) { return it.itemDescription.trim(); }).join(', ');
      var uploadResult = await apiUploadSQDocuments({
        prNumber: document.getElementById('sqPRNumber').value || 'General',
        supplierCompany: supplier,
        itemDescriptions: itemDescs,
        files: filesData
      });

      document.getElementById('uploadFill').style.width = '80%';

      if (uploadResult.success && uploadResult.folderUrl) {
        // Step 3: Update SQ rows with drive folder link
        document.getElementById('uploadStatus').textContent = 'Linking to records...';
        await apiUpdateSQDriveLink({
          rowIndices: JSON.stringify(rowIndices),
          driveFolderLink: uploadResult.folderUrl
        });
      }

      document.getElementById('uploadFill').style.width = '100%';
      document.getElementById('uploadStatus').textContent = 'Done!';
      setTimeout(function() { progress.style.display = 'none'; }, 1500);
    }

    msg.style.display = 'block';
    msg.style.background = 'rgba(34,197,94,0.12)';
    msg.style.color = '#22c55e';
    msg.textContent = 'Supplier quotation saved successfully!' + (uploadFiles.length > 0 ? ' Files uploaded to Drive.' : '');
    resetForm();
    await loadRecords();
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,0.12)';
    msg.style.color = '#ef4444';
    msg.textContent = 'Error: ' + err.message;
    document.getElementById('uploadProgress').style.display = 'none';
  }
  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Submit to Sheet';
}

function resetForm() {
  document.getElementById('sqForm').reset();
  document.getElementById('sqDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('formMsg').style.display = 'none';
  editingRowIndex = null;
  document.getElementById('submitBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Submit to Sheet';
  document.getElementById('sqPRNumber').value = '';
  document.getElementById('sqPRAgentName').value = '';
  document.getElementById('prLinkBanner').style.display = 'none';
  document.getElementById('prLinkItems').innerHTML = '';
  uploadFiles = [];
  renderFileList();
  lineItems = [];
  addLineItem();
}

// ─── Records Table ──────────────────────────────

async function loadRecords() {
  var container = document.getElementById('sqContainer');
  var search = (document.getElementById('sqSearch').value || '').trim();
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    var result = await apiGetSupplierQuotations(search);
    if (!result.success) throw new Error(result.message || 'Failed');

    sqRecords = result.data || [];
    document.getElementById('sqCount').textContent = sqRecords.length + ' record' + (sqRecords.length !== 1 ? 's' : '');

    if (sqRecords.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color: var(--text-muted);">No supplier quotations yet.</div>';
      return;
    }

    var html = '<table class="sq-table" style="min-width:1500px;">' +
      '<colgroup>' +
        '<col style="width:88px;">' +    // Date
        '<col style="width:140px;">' +   // Supplier
        '<col style="width:140px;">' +   // Contact
        '<col style="width:100px;">' +   // Ref No.
        '<col style="width:220px;">' +   // Item Description
        '<col style="width:90px;">' +    // PR #
        '<col style="width:200px;">' +   // PR Item
        '<col style="width:50px;">' +    // Qty
        '<col style="width:90px;">' +    // Price/Unit
        '<col style="width:100px;">' +   // Total
        '<col style="width:70px;">' +    // Currency
        '<col style="width:70px;">' +    // Docs
        '<col style="width:90px;">' +    // By
        '<col style="width:110px;">' +   // Actions
      '</colgroup>' +
      '<thead><tr>' +
      '<th>Date</th><th>Supplier</th><th>Contact</th><th>Ref No.</th>' +
      '<th>Item Description</th><th>PR #</th><th>PR Item</th><th>Qty</th><th>Price/Unit</th><th>Total</th>' +
      '<th>Currency</th><th>Docs</th><th>By</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    sqRecords.forEach(function(r) {
      var docsCell = r.driveFolderLink
        ? '<a href="' + esc(r.driveFolderLink) + '" target="_blank" style="color: var(--hx-cyan-ink);font-size:0.78rem;text-decoration:none;" title="View supporting documents"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> View</a>'
        : '<span style="color: var(--text-muted);font-size:0.72rem;">--</span>';
      html += '<tr>' +
        '<td style="white-space:nowrap;">' + esc(r.date) + '</td>' +
        '<td><strong>' + esc(r.supplierCompany) + '</strong></td>' +
        '<td style="font-size:0.8rem;">' + esc(r.contactPerson) + (r.contactNumber ? '<br>' + esc(r.contactNumber) : '') + (r.email ? '<br>' + esc(r.email) : '') + '</td>' +
        '<td>' + esc(r.referenceNo) + '</td>' +
        '<td style="font-size:0.82rem;">' + esc(r.itemDescription) + '</td>' +
        '<td style="font-size:0.78rem;color: var(--hx-cyan-ink);">' + esc(r.prNumber) + '</td>' +
        '<td style="font-size:0.78rem;" title="' + esc(r.prItemDescription) + '">' + esc(r.prItemDescription) + '</td>' +
        '<td style="text-align:center;">' + r.qty + '</td>' +
        '<td style="text-align:right;">' + formatNum(r.pricePerUnit) + '</td>' +
        '<td style="text-align:right;font-weight:600;color: var(--accent);">' + formatNum(r.totalAmount) + '</td>' +
        '<td>' + esc(r.currency) + '</td>' +
        '<td>' + docsCell + '</td>' +
        '<td style="font-size:0.78rem;color: var(--text-muted);">' + esc(r.submittedBy) + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn btn-sm btn-secondary" onclick="editQuotation(' + r.rowIndex + ')" style="margin-right:0.25rem;font-size:0.7rem;padding:0.15rem 0.4rem;">Edit</button>' +
          '<button onclick="deleteSQ(' + r.rowIndex + ')" style="font-size:0.7rem;padding:0.15rem 0.4rem;border-radius: 4px;border: 1px solid var(--hx-red-soft);background: var(--hx-red-soft);color: var(--hx-red);cursor:pointer;">Del</button>' +
        '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color: var(--hx-red);">Error: ' + esc(err.message) + '</div>';
  }
}

// ─── Edit / Delete ──────────────────────────────

function editQuotation(rowIndex) {
  var r = sqRecords.find(function(q) { return q.rowIndex === rowIndex; });
  if (!r) return;
  editingRowIndex = rowIndex;
  document.getElementById('sqDate').value = r.date;
  document.getElementById('sqRefNo').value = r.referenceNo;
  document.getElementById('sqSupplier').value = r.supplierCompany;
  document.getElementById('sqContact').value = r.contactPerson;
  document.getElementById('sqPhone').value = r.contactNumber;
  document.getElementById('sqEmail').value = r.email;
  document.getElementById('sqCurrency').value = r.currency;
  document.getElementById('sqRemarks').value = r.remarks;
  document.getElementById('sqPRNumber').value = r.prNumber || '';
  document.getElementById('sqPRAgentName').value = r.prAgentName || '';

  // Load single item into line items
  lineItems = [{
    itemDescription: r.itemDescription || '',
    prItemDescription: r.prItemDescription || '',
    qty: r.qty || 1,
    pricePerUnit: r.pricePerUnit || 0,
    totalAmount: r.totalAmount || 0
  }];
  renderLineItems();

  if (r.prNumber) {
    document.getElementById('prLinkBanner').style.display = 'block';
    document.getElementById('prLinkInfo').textContent = r.prNumber + (r.prAgentName ? ' (Agent: ' + r.prAgentName + ')' : '');
    document.getElementById('prLinkItems').innerHTML = '<strong style="color: var(--hx-cyan-ink);">PR Item:</strong> ' + esc(r.prItemDescription || '');
  } else {
    document.getElementById('prLinkBanner').style.display = 'none';
  }

  document.getElementById('submitBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Update';
  var section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
}

async function deleteSQ(rowIndex) {
  if (!confirm('Delete this supplier quotation?')) return;
  try {
    var result = await apiDeleteSupplierQuotation(rowIndex);
    if (!result.success) throw new Error(result.message || 'Failed');
    clearApiCache();
    await loadRecords();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── Helpers ────────────────────────────────────

function esc(str) { return hxEscBlank(str); }

function formatNum(n) {
  return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
