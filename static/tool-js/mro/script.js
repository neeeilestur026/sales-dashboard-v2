// Escape HTML entities to prevent XSS
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}

// User key for per-user state isolation
function getUserKey() {
    try { return JSON.parse(localStorage.getItem('session') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
}

// Initialize Bootstrap modal
const addItemModal = new bootstrap.Modal(document.getElementById('addItemModal'));

// Show the Add Item modal and clear inputs
function showAddItemModal() {
    console.log('Opening Add Item modal');
    const inputs = ['model_no', 'item_description', 'quantity', 'item_remarks'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.value = '';
            input.classList.remove('is-invalid');
        }
    });
    addItemModal.show();

}

// Validate and add item to the backend
function addItem() {
    console.log('Adding item');
    const modelNo          = document.getElementById('model_no').value.trim();
    const itemDescriptionRaw = document.getElementById('item_description').value;
    const itemDescription  = itemDescriptionRaw.trim();
    const quantity         = parseInt(document.getElementById('quantity').value);
    const itemRemarks      = document.getElementById('item_remarks').value.trim();

    // Client-side validation (item_remarks is optional)
    let isValid = true;
    if (!modelNo) {
        document.getElementById('model_no').classList.add('is-invalid');
        isValid = false;
    } else {
        document.getElementById('model_no').classList.remove('is-invalid');
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

    if (!isValid) {
        console.error('Validation failed');
        return;
    }

    const data = {
        model_no:         modelNo,
        item_description: itemDescriptionRaw,
        quantity:         quantity,
        item_remarks:     itemRemarks,
        user_key:         getUserKey()
    };

    fetch('/mro/add_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log('Add item response:', data);
        updateOutputLog(data.output_log);
        if (data.success) {
            const tableBody = document.querySelector('#items_table tbody');
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.item.item_no}</td>
                <td>${escapeHtml(data.item.model_no)}</td>
                <td>${escapeHtml(data.item.item_description)}</td>
                <td>${data.item.quantity}</td>
                <td>${escapeHtml(data.item.item_remarks || '')}</td>
                <td><button class="btn btn-danger btn-sm" onclick="removeItem(${data.item.item_no})">Remove</button></td>
            `;
            tableBody.appendChild(row);
            addItemModal.hide();
        } else {
            alert(data.message || 'Failed to add item.');
        }
    })
    .catch(error => {
        console.error('Error adding item:', error);
        updateOutputLog(['Error: Failed to add item.']);
    });
}

// Remove an item from the table and backend
function removeItem(itemNo) {
    console.log(`Removing item ${itemNo}`);
    fetch(`/mro/remove_item/${itemNo}`, {
        method: 'POST',
        headers: { 'X-User-Key': getUserKey() }
    })
    .then(response => response.json())
    .then(data => {
        console.log('Remove item response:', data);
        updateOutputLog(data.output_log);
        if (data.success) {
            const tableBody = document.querySelector('#items_table tbody');
            tableBody.innerHTML = '';
            data.items.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${item.item_no}</td>
                    <td>${escapeHtml(item.model_no)}</td>
                    <td>${escapeHtml(item.item_description)}</td>
                    <td>${item.quantity}</td>
                    <td>${escapeHtml(item.item_remarks || '')}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="removeItem(${item.item_no})">Remove</button></td>
                `;
                tableBody.appendChild(row);
            });
        } else {
            alert('Failed to remove item.');
        }
    })
    .catch(error => {
        console.error('Error removing item:', error);
        updateOutputLog(['Error: Failed to remove item.']);
    });
}

// Generate the Materials Receiving Report PDF
let _mroGenerating = false;
function generatePurchaseOrder() {
    if (_mroGenerating) return;
    console.log('Generating Materials Receiving Report');
    const form = document.getElementById('po_form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    _mroGenerating = true;
    const btn = document.querySelector('.btn-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    const formData = new FormData(form);
    formData.append('user_key', getUserKey());
    updateOutputLog(['Generating PDF...']);

    fetch('/mro/generate', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                updateOutputLog(data.output_log || ['Error generating PDF.']);
                throw new Error(data.message || 'Failed to generate Materials Receiving Report.');
            });
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?(.+?)"?$/);
        const filename = match ? match[1] : 'Materials_Receiving.pdf';
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
        updateOutputLog(['Success: PDF downloaded.']);
    })
    .catch(err => {
        console.error('Error generating MRR:', err);
        if (err.message) updateOutputLog(['Error: ' + err.message]);
    })
    .finally(() => {
        _mroGenerating = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Generate PDF'; }
    });
}

// Reset the form and clear items
function resetForm() {
    console.log('Resetting form');
    document.getElementById('po_form').reset();
    document.querySelector('#items_table tbody').innerHTML = '';
    document.getElementById('output_log').textContent = '';
    fetch('/mro/reset_items', {
        method: 'POST',
        headers: { 'X-User-Key': getUserKey() }
    })
    .then(response => response.json())
    .then(data => {
        console.log('Reset response:', data);
        updateOutputLog(data.output_log);
    })
    .catch(error => {
        console.error('Error resetting form:', error);
        updateOutputLog(['Error: Failed to reset form.']);
    });
}

// Update the output log display
function updateOutputLog(logs) {
    const outputLog = document.getElementById('output_log');
    outputLog.textContent = logs.join('\n');
    outputLog.scrollTop = outputLog.scrollHeight;
}

// Submit to Google Sheet
function submitToGoogleSheet() {
    console.log('Submitting to Google Sheet');

    const vendorName      = document.getElementById('vendor_name').value.trim();
    const supplierPoNo    = document.getElementById('sales_invoice').value.trim();
    const supplierPoNoVal = document.getElementById('purchase_order_no') ? document.getElementById('purchase_order_no').value.trim() : '';
    const poDate          = document.getElementById('po_date').value.trim();
    const remarks      = document.getElementById('remarks') ? document.getElementById('remarks').value.trim() : '';
    const receivedBy   = document.getElementById('received_by').value.trim();

    const tableBody = document.querySelector('#items_table tbody');
    const itemCount = tableBody.querySelectorAll('tr').length;

    if (!vendorName) {
        alert('Please enter a Vendor Name in the form above.');
        return;
    }
    if (!supplierPoNo) {
        alert('Please enter a Sales Invoice in the form above.');
        return;
    }
    if (!poDate) {
        alert('Please select a Receiving Date in the form above.');
        return;
    }
    if (itemCount === 0) {
        alert('Please add at least one item.');
        return;
    }
    if (!receivedBy) {
        alert('Please enter the name of the person who Received & Checked the items.');
        document.getElementById('received_by').focus();
        return;
    }

    const data = {
        po_number:        supplierPoNo,
        purchase_order_no: supplierPoNoVal,
        vendor_name:      vendorName,
        po_date:          poDate,
        remarks:          remarks,
        received_by:      receivedBy,
        item_count:       itemCount,
        user_key:         getUserKey()
    };

    console.log('Submitting data:', data);

    fetch('/mro/submit_to_sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log('Submit to sheets response:', data);
        updateOutputLog(data.output_log);
        if (data.success) {
            alert('Successfully submitted to Google Sheet!\n\nSales Invoice: ' + supplierPoNo + '\nVendor: ' + vendorName + '\nItems: ' + itemCount);
        } else {
            alert('Failed to submit: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error submitting to sheets:', error);
        updateOutputLog(['Error: Failed to submit to Google Sheet.']);
        alert('Error: Failed to submit to Google Sheet. Check the console for details.');
    });
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    window.scrollTo(0, 0);
    console.log('Page loaded, initializing...');
    resetForm();
});
