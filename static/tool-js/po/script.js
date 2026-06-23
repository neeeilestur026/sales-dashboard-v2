/**
 * Purchase Order Generator -- client-side script
 * All fetch URLs are prefixed with /po/ for the unified Flask blueprint.
 */

// User key for per-user state isolation
function getUserKey() {
    try { return JSON.parse(localStorage.getItem('session') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
}

// Initialize Bootstrap modal
const addItemModal = new bootstrap.Modal(document.getElementById('addItemModal'));

// Show the Add Item modal and clear inputs
function showAddItemModal() {
    const inputs = ['item_code', 'item_description', 'quantity', 'unit_price'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        input.value = '';
        input.classList.remove('is-invalid');
    });
    addItemModal.show();
}

// Validate and add item to the backend
function addItem() {
    const itemCode = document.getElementById('item_code').value.trim();
    const itemDescriptionRaw = document.getElementById('item_description').value;
    const itemDescription = itemDescriptionRaw.trim();
    const quantity = parseFloat(document.getElementById('quantity').value);
    const unitPrice = parseFloat(document.getElementById('unit_price').value);

    // Client-side validation
    let isValid = true;
    if (!itemCode) {
        document.getElementById('item_code').classList.add('is-invalid');
        isValid = false;
    } else {
        document.getElementById('item_code').classList.remove('is-invalid');
    }
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
    if (isNaN(unitPrice) || unitPrice < 0) {
        document.getElementById('unit_price').classList.add('is-invalid');
        isValid = false;
    } else {
        document.getElementById('unit_price').classList.remove('is-invalid');
    }

    if (!isValid) return;

    fetch('/po/add_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            item_code: itemCode,
            item_description: itemDescriptionRaw,
            quantity: quantity,
            unit_price: unitPrice,
            user_key: getUserKey()
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'ok') {
            renderItemsTable(data.items);
            addItemModal.hide();
        } else {
            alert(data.message || 'Failed to add item.');
        }
    })
    .catch(error => {
        console.error('Error adding item:', error);
        alert('Network error adding item.');
    });
}

// Remove an item from the table and backend
function removeItem(itemNo) {
    if (!confirm('Remove item #' + itemNo + '?')) return;

    fetch(`/po/remove_item/${itemNo}`, {
        method: 'POST',
        headers: { 'X-User-Key': getUserKey() }
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'ok') {
            renderItemsTable(data.items);
        } else {
            alert('Failed to remove item.');
        }
    })
    .catch(error => {
        console.error('Error removing item:', error);
        alert('Network error removing item.');
    });
}

// Render the items table from an array of item objects
function renderItemsTable(items) {
    const tableBody = document.querySelector('#items_table tbody');
    tableBody.innerHTML = '';

    if (!items || items.length === 0) return;

    items.forEach(item => {
        const totalAmount = (item.quantity * item.unit_price).toFixed(2);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.item_no}</td>
            <td>${escapeHtml(item.item_code)}</td>
            <td>${escapeHtml(item.item_description)}</td>
            <td>${item.quantity}</td>
            <td>${parseFloat(item.unit_price).toFixed(2)}</td>
            <td>${totalAmount}</td>
            <td><button type="button" class="btn btn-danger btn-sm" onclick="removeItem(${item.item_no})">Remove</button></td>
        `;
        tableBody.appendChild(row);
    });
}

// Generate the purchase order PDF
let _poGenerating = false;
function generatePurchaseOrder() {
    if (_poGenerating) return;  // Prevent duplicate PO submissions

    const form = document.getElementById('po_form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    // Check if there are items in the table
    const tableBody = document.querySelector('#items_table tbody');
    if (!tableBody || tableBody.querySelectorAll('tr').length === 0) {
        alert('Please add at least one item before generating.');
        return;
    }

    const formData = new FormData(form);
    formData.append('user_key', getUserKey());

    // Pass session info so backend can auto-submit to PO Approvals
    try {
        const sess = JSON.parse(localStorage.getItem('session') || '{}');
        formData.append('created_by', sess.name || '');
        formData.append('creator_role', sess.role || '');
    } catch (_) {}

    // Disable button to prevent duplicate PO submissions
    _poGenerating = true;
    const btn = document.querySelector('.btn-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    updateOutputLog(['Generating PDF and submitting to PO Approvals...']);

    fetch('/po/generate', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.message || 'Failed to generate purchase order.');
            });
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?(.+?)"?$/);
        const filename = match ? match[1] : 'Purchase_Order.pdf';
        return response.blob().then(blob => ({ blob, filename }));
    })
    .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateOutputLog(['PDF downloaded. Submitting to PO Approvals...']);
        pollSubmissionStatus(0);
    })
    .catch(err => {
        console.error('Error generating PO:', err);
        updateOutputLog(['Error: ' + err.message]);
    })
    .finally(() => {
        _poGenerating = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Generate PDF'; }
    });
}

function pollSubmissionStatus(attempts) {
    const maxAttempts = 20; // poll up to 20 times (every 3s = 60s total)
    if (attempts >= maxAttempts) {
        updateOutputLog(['Submission is taking longer than expected. Check PO Approvals in a moment.']);
        return;
    }
    setTimeout(() => {
        fetch('/po/last_submission_info?user_key=' + encodeURIComponent(getUserKey()))
            .then(r => r.json())
            .then(data => {
                if (data.status === 'pending' || data.status === 'none') {
                    updateOutputLog(['Submitting to PO Approvals... (checking)']);
                    pollSubmissionStatus(attempts + 1);
                } else if (data.status === 'success') {
                    updateOutputLog(['\u2705 ' + (data.message || 'PO saved to PO Approvals successfully.')]);
                } else {
                    updateOutputLog(['\u274C Submission error: ' + (data.message || 'Unknown error.') +
                        '\nYou can use the "Submit to Google Sheet" button below to retry.']);
                }
            })
            .catch(() => pollSubmissionStatus(attempts + 1));
    }, 3000);
}

// Reset the form and clear items
function resetForm() {
    if (!confirm('Reset all items and form fields?')) return;

    fetch('/po/reset_items', { method: 'POST', headers: { 'X-User-Key': getUserKey() } })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'ok') {
            document.getElementById('po_form').reset();
            document.querySelector('#items_table tbody').innerHTML = '';
            updateOutputLog(data.log);
        }
    })
    .catch(error => {
        console.error('Error resetting form:', error);
        alert('Network error resetting form.');
    });
}

// Submit to Google Sheet
function submitToGoogleSheet() {
    const vendorName = document.getElementById('vendor_name').value.trim();
    const poNumber = document.getElementById('po_number').value.trim();
    const poDate = document.getElementById('po_date').value.trim();

    if (!vendorName) { alert('Please enter a Vendor Name in the form above.'); return; }
    if (!poNumber)   { alert('Please enter a PO Number in the form above.'); return; }
    if (!poDate)     { alert('Please select a PO Date in the form above.'); return; }

    // Gather additional fields for the dashboard PO tracker
    const vendorEmail = (document.getElementById('vendor_email') || {}).value || '';
    const referenceNo = (document.getElementById('reference_no') || {}).value || '';
    const currency    = (document.getElementById('currency') || {}).value || 'PHP';

    // Compute total amount and items summary from the rendered table
    let totalAmount = 0;
    const itemDescriptions = [];
    const tableRows = document.querySelectorAll('#items_table tbody tr');
    tableRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
            totalAmount += parseFloat(cells[5].textContent) || 0;
            const desc = (cells[2].textContent || '').trim();
            if (desc) itemDescriptions.push(desc);
        }
    });
    const itemsSummary = itemDescriptions.join('; ');

    // Read logged-in user from dashboard session (stored in localStorage)
    let createdBy = '';
    let creatorRole = '';
    try {
        const sess = JSON.parse(localStorage.getItem('session') || '{}');
        createdBy = sess.name || '';
        creatorRole = sess.role || '';
    } catch (_) {}

    fetch('/po/submit_to_sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            po_number: poNumber,
            vendor_name: vendorName,
            po_date: poDate,
            vendor_email: vendorEmail,
            reference_no: referenceNo,
            currency: currency,
            total_amount: totalAmount,
            items_summary: itemsSummary,
            created_by: createdBy,
            creator_role: creatorRole,
            user_key: getUserKey()
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'ok') {
            alert(data.message || 'Submitted successfully.');
            updateOutputLog(data.log);
        } else {
            alert(data.message || 'Failed to submit to Google Sheet.');
        }
    })
    .catch(error => {
        console.error('Error submitting to sheets:', error);
        alert('Error: Failed to submit to Google Sheet.');
    });
}

// Update the output log display
function updateOutputLog(logEntries) {
    const outputLog = document.getElementById('output_log');
    if (!logEntries || logEntries.length === 0) {
        outputLog.textContent = 'No output yet.';
        return;
    }
    outputLog.textContent = logEntries.join('\n');
    outputLog.scrollTop = outputLog.scrollHeight;
}

// Escape HTML to prevent XSS in table cells
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text || ''));
    return div.innerHTML;
}
