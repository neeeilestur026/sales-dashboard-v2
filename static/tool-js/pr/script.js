// User key for per-user state isolation
function getUserKey() {
    try { return JSON.parse(localStorage.getItem('session') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
}

// Initialize Bootstrap modal
const addItemModal = new bootstrap.Modal(document.getElementById('addItemModal'));

// Tracks whether the modal is in 'add' mode (default) or 'edit' mode
// with the item_no being edited.
let _editingItemNo = null;

// Show the Add Item modal and clear inputs
function showAddItemModal() {
    _editingItemNo = null;
    _setModalTitle('Add Item');
    _setModalSubmitLabel('Add Item');
    const inputs = ['item_description', 'model_no', 'quantity', 'unit_of_measure', 'item_remarks'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.classList.remove('is-invalid');
        }
    });
    addItemModal.show();
}

function _setModalTitle(text) {
    const el = document.getElementById('addItemModalLabel');
    if (el) el.textContent = text;
}
function _setModalSubmitLabel(text) {
    const btn = document.getElementById('addItemSubmitBtn');
    if (btn) btn.textContent = text;
}

// Open the modal pre-filled for editing an existing item.
function editItem(itemNo) {
    const row = document.querySelector(`#items_table tbody tr[data-item-no="${itemNo}"]`);
    if (!row) return;
    // Cells: 0:#, 1:desc, 2:model, 3:qty, 4:unit, 5:remarks, 6:actions
    const cells = row.querySelectorAll('td');
    _editingItemNo = itemNo;
    _setModalTitle(`Edit Item #${itemNo}`);
    _setModalSubmitLabel('Save Changes');
    document.getElementById('item_description').value = cells[1].textContent;
    document.getElementById('model_no').value         = cells[2].textContent;
    document.getElementById('quantity').value         = cells[3].textContent;
    document.getElementById('unit_of_measure').value  = cells[4].textContent;
    document.getElementById('item_remarks').value     = cells[5].textContent;
    ['item_description','quantity'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('is-invalid');
    });
    addItemModal.show();
}

// Validate and add (or update) an item
function addItem() {
    const itemDescriptionRaw = document.getElementById('item_description').value;
    const itemDescription    = itemDescriptionRaw.trim();
    const modelNo            = document.getElementById('model_no').value.trim();
    const quantity           = parseInt(document.getElementById('quantity').value);
    const unitOfMeasure      = document.getElementById('unit_of_measure').value.trim();
    const itemRemarks        = document.getElementById('item_remarks').value.trim();

    let isValid = true;
    if (!itemDescription) {
        document.getElementById('item_description').classList.add('is-invalid');
        isValid = false;
    } else {
        document.getElementById('item_description').classList.remove('is-invalid');
    }
    if (isNaN(quantity) || quantity <= 0) {
        document.getElementById('quantity').classList.add('is-invalid');
        isValid = false;
    } else {
        document.getElementById('quantity').classList.remove('is-invalid');
    }

    if (!isValid) return;

    const data = {
        item_description: itemDescriptionRaw,
        model_no:         modelNo,
        quantity:         quantity,
        unit_of_measure:  unitOfMeasure,
        item_remarks:     itemRemarks,
        user_key:         getUserKey(),
    };

    const isEdit = _editingItemNo !== null;
    const url    = isEdit ? `/pr/update_item/${_editingItemNo}` : '/pr/add_item';

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .then(data => {
        updateOutputLog(data.output_log);
        if (data.success) {
            if (isEdit) {
                // Refresh table from authoritative list
                const tableBody = document.querySelector('#items_table tbody');
                tableBody.innerHTML = '';
                (data.items || []).forEach(item => appendItemRow(item));
            } else {
                appendItemRow(data.item);
            }
            _editingItemNo = null;
            addItemModal.hide();
        } else {
            alert(data.message || (isEdit ? 'Failed to update item.' : 'Failed to add item.'));
        }
    })
    .catch(() => updateOutputLog([isEdit ? 'Error: Failed to update item.' : 'Error: Failed to add item.']));
}

// Append a single item row to the table
function appendItemRow(item) {
    const tableBody = document.querySelector('#items_table tbody');
    const row = document.createElement('tr');
    row.setAttribute('data-item-no', item.item_no);
    row.innerHTML = `
        <td>${item.item_no}</td>
        <td style="text-align:left">${escapeHtml(item.item_description)}</td>
        <td>${escapeHtml(item.model_no || '')}</td>
        <td>${item.quantity}</td>
        <td>${escapeHtml(item.unit_of_measure || '')}</td>
        <td>${escapeHtml(item.item_remarks || '')}</td>
        <td style="white-space:nowrap;">
            <button type="button" class="btn btn-outline-primary btn-sm me-1" onclick="editItem(${item.item_no})">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="removeItem(${item.item_no})">Remove</button>
        </td>
    `;
    tableBody.appendChild(row);
}

// Escape HTML to prevent XSS in table display
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

// Remove an item from the backend and refresh table
function removeItem(itemNo) {
    fetch(`/pr/remove_item/${itemNo}`, { method: 'POST', headers: { 'X-User-Key': getUserKey() } })
    .then(r => r.json())
    .then(data => {
        updateOutputLog(data.output_log);
        if (data.success) {
            const tableBody = document.querySelector('#items_table tbody');
            tableBody.innerHTML = '';
            data.items.forEach(item => appendItemRow(item));
        } else {
            alert('Failed to remove item.');
        }
    })
    .catch(() => updateOutputLog(['Error: Failed to remove item.']));
}

// Generate the Purchase Request Form PDF
let _prGenerating = false;
function generatePR() {
    if (_prGenerating) return;  // Prevent double-submission

    const form = document.getElementById('pr_form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const tableBody = document.querySelector('#items_table tbody');
    if (tableBody.querySelectorAll('tr').length === 0) {
        alert('Please add at least one item before generating.');
        return;
    }

    const formData = new FormData(form);
    formData.append('user_key', getUserKey());

    // Pass session info so backend can auto-submit to Drive + Sheet
    try {
        const sess = JSON.parse(localStorage.getItem('session') || '{}');
        formData.append('created_by', sess.name || '');
        formData.append('pr_sheet_id', sess.prSheetId || '');
        if (!sess.prSheetId) {
            console.warn('generatePR: prSheetId missing from session — sheet submission will be skipped.');
        }
    } catch (_) {}

    // Disable button to prevent duplicate submissions
    _prGenerating = true;
    const btn = document.querySelector('.btn-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    updateOutputLog(['Generating PDF, uploading to Drive, and submitting to Google Sheet...']);

    fetch('/pr/generate', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                updateOutputLog(data.output_log || ['Error generating PDF.']);
                throw new Error(data.message || 'Failed to generate Purchase Request Form.');
            });
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?(.+?)"?$/);
        const filename = match ? match[1] : 'Purchase_Request.pdf';
        let prLog = null;
        try {
            const rawLog = response.headers.get('X-PR-Log');
            if (rawLog) prLog = JSON.parse(rawLog);
        } catch (_) {}
        return response.blob().then(blob => ({ blob, filename, prLog }));
    })
    .then(({ blob, filename, prLog }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (prLog && prLog.length > 0) {
            updateOutputLog(prLog);
        } else {
            updateOutputLog(['PDF downloaded successfully.']);
        }
    })
    .catch(err => {
        if (err.message) updateOutputLog(['Error: ' + err.message]);
    })
    .finally(() => {
        // Re-enable button after completion (success or failure)
        _prGenerating = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Generate PDF'; }
    });
}

// Reset the form and clear items
function resetForm() {
    document.getElementById('pr_form').reset();
    document.querySelector('#items_table tbody').innerHTML = '';
    document.getElementById('output_log').textContent = '';
    fetch('/pr/reset_items', { method: 'POST', headers: { 'X-User-Key': getUserKey() } })
    .then(r => r.json())
    .then(data => updateOutputLog(data.output_log))
    .catch(() => updateOutputLog(['Error: Failed to reset form.']));
}

// Update the output log display
function updateOutputLog(logs) {
    const outputLog = document.getElementById('output_log');
    outputLog.textContent = (logs || []).join('\n');
    outputLog.scrollTop = outputLog.scrollHeight;
}

// Submit to Google Sheet
function submitToGoogleSheet() {
    const companyName     = document.getElementById('company_name').value.trim();
    const contactPerson   = document.getElementById('contact_person').value.trim();
    const prDate          = document.getElementById('pr_date').value.trim();
    const referenceNumber = document.getElementById('reference_number').value.trim();
    const prNumberClient  = document.getElementById('pr_number_client').value.trim();
    const preparedByName  = document.getElementById('prepared_by_name').value.trim();

    const tableBody = document.querySelector('#items_table tbody');
    const itemCount = tableBody.querySelectorAll('tr').length;

    if (!companyName) {
        alert('Please enter a Company Name.');
        return;
    }
    if (!prDate) {
        alert('Please select a Date.');
        return;
    }
    if (itemCount === 0) {
        alert('Please add at least one item.');
        return;
    }

    let prSheetId = '';
    try {
        prSheetId = JSON.parse(localStorage.getItem('session') || '{}').prSheetId || '';
    } catch (_) {}

    if (!prSheetId) {
        alert('No PR Sheet ID found in your session. Please log out and log back in, or contact your admin.');
        return;
    }

    const data = {
        company_name:      companyName,
        contact_person:    contactPerson,
        reference_number:  referenceNumber,
        pr_number_client:  prNumberClient,
        pr_date:           prDate,
        prepared_by_name:  preparedByName,
        user_key:          getUserKey(),
        pr_sheet_id:       prSheetId,
    };

    fetch('/pr/submit_to_sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .then(data => {
        updateOutputLog(data.output_log);
        if (data.success) {
            alert('Successfully submitted to Google Sheet!\n\nCompany: ' + companyName + '\nItems: ' + itemCount);
        } else {
            alert('Failed to submit: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(() => {
        updateOutputLog(['Error: Failed to submit to Google Sheet.']);
        alert('Error: Failed to submit to Google Sheet.');
    });
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    window.scrollTo(0, 0);
    resetForm();
});
