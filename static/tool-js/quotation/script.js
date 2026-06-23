/**
 * Quotation Generator - Frontend Script
 * All fetch URLs prefixed with /quotation/
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentItems = [];
let productCodes = {};       // { "CEJN": ["code1","code2",...], ... }

function getUserKey() {
    try { return JSON.parse(localStorage.getItem('session') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
}
let productPriceTypes = {};  // { "CEJN": { "code1": "numeric", "code2": "POR" }, ... }
let savedTerms = {
    validity: "30 days",
    delivery: "",
    payment: "",
    warranty: ""
};
let revisionContext = null;              // { sheetId, rowIndex } when revising
let cachedRejectedQuotations = [];
let pendingDestination = "";             // set by loadRejectedQuotation, applied after loadData()
let pendingApprovalContext = JSON.parse(sessionStorage.getItem('pendingApprovalContext') || 'null');
// shape: { sheetId, rowIndex, refNo, status } or null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function appendLog(msg) {
    const el = document.getElementById("outputLog");
    if (el) {
        el.textContent += "\n" + msg;
        el.scrollTop = el.scrollHeight;
    }
}

function setLog(lines) {
    const el = document.getElementById("outputLog");
    if (el && Array.isArray(lines)) {
        el.textContent = lines.join("\n");
        el.scrollTop = el.scrollHeight;
    }
}

function formatPHP(num) {
    return Number(num).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Load Data (triggered on principal change)
// ---------------------------------------------------------------------------
function loadData() {
    const principal = document.getElementById("principal").value;
    if (!principal) return;

    appendLog("Loading data for " + principal + "...");

    fetch("/quotation/load_data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principal: principal })
    })
    .then(r => r.json())
    .then(data => {
        if (data.output_log) setLog(data.output_log);

        // Populate destinations
        const destSelect = document.getElementById("destination");
        destSelect.innerHTML = '<option value="">-- Select Destination --</option>';
        if (data.destinations) {
            data.destinations.forEach(d => {
                const opt = document.createElement("option");
                opt.value = d;
                opt.textContent = d;
                destSelect.appendChild(opt);
            });
        }

        // Store product codes + price types
        if (data.product_codes) productCodes = data.product_codes;
        if (data.product_price_types) productPriceTypes = data.product_price_types;

        // Apply pending destination (set during revision load)
        if (pendingDestination) {
            destSelect.value = pendingDestination;
            pendingDestination = "";
        }

        appendLog("Data loaded successfully.");
    })
    .catch(err => {
        appendLog("ERROR loading data: " + err);
    });
}

// ---------------------------------------------------------------------------
// Add Item Modal
// ---------------------------------------------------------------------------
function showAddItemModal() {
    // Reset fields
    document.getElementById("inputMode").value = "excel";
    document.getElementById("productCodeSearch").value = "";
    document.getElementById("selectedProductCode").value = "";
    document.getElementById("manualProductCode").value = "";
    document.getElementById("productName").value = "";
    document.getElementById("cbm").value = "0.01";
    document.getElementById("quantity").value = "1";
    document.getElementById("productPrice").value = "";
    document.getElementById("itemDescription").value = "";
    document.getElementById("itemImage").value = "";

    updateInputMode();

    const modal = new bootstrap.Modal(document.getElementById("addItemModal"));
    modal.show();
}

function updateInputMode() {
    const mode = document.getElementById("inputMode").value;
    const dropdownContainer = document.getElementById("productCodeDropdownContainer");
    const manualContainer = document.getElementById("manualProductCodeContainer");
    const priceInput = document.getElementById("productPrice");

    if (mode === "excel") {
        dropdownContainer.classList.remove("d-none");
        manualContainer.classList.add("d-none");
        priceInput.placeholder = "Auto from Excel";
    } else {
        dropdownContainer.classList.add("d-none");
        manualContainer.classList.remove("d-none");
        priceInput.placeholder = "Enter price";
    }
}

// ---------------------------------------------------------------------------
// Product Code Dropdown
// ---------------------------------------------------------------------------
function populateProductCodesDropdown(query) {
    const principal = document.getElementById("principal").value;
    const menu = document.getElementById("productCodeDropdownMenu");
    menu.innerHTML = "";

    if (!principal || !productCodes[principal]) return;

    const codes = productCodes[principal];
    const filtered = query
        ? codes.filter(c => c.toLowerCase().includes(query.toLowerCase()))
        : codes;

    renderDropdownItems(filtered.slice(0, 50), menu);
}

function renderDropdownItems(items, menu) {
    items.forEach(code => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "dropdown-item";
        a.href = "#";
        a.textContent = code;
        a.onclick = function(e) {
            e.preventDefault();
            selectProductCode(code);
        };
        li.appendChild(a);
        menu.appendChild(li);
    });
}

function selectProductCode(code) {
    document.getElementById("productCodeSearch").value = code;
    document.getElementById("selectedProductCode").value = code;

    // Check if POR
    const principal = document.getElementById("principal").value;
    const priceInput = document.getElementById("productPrice");
    if (productPriceTypes[principal] && productPriceTypes[principal][code] === "POR") {
        priceInput.placeholder = "POR - enter price manually";
        priceInput.required = true;
    } else {
        priceInput.placeholder = "Auto from Excel";
        priceInput.required = false;
        priceInput.value = "";
    }

    updateProductPriceInput();
}

function updateProductPriceInput() {
    const principal = document.getElementById("principal").value;
    const code = document.getElementById("selectedProductCode").value;
    const priceContainer = document.getElementById("productPriceContainer");
    const priceInput = document.getElementById("productPrice");
    const mode = document.getElementById("inputMode").value;

    if (mode === "manual" || principal === "Others") {
        priceInput.disabled = false;
        priceInput.placeholder = "Enter price";
        return;
    }

    if (productPriceTypes[principal] && productPriceTypes[principal][code] === "POR") {
        priceInput.disabled = false;
        priceInput.placeholder = "POR - enter price";
    } else {
        priceInput.disabled = false;
        priceInput.placeholder = "Auto from Excel";
    }
}

// ---------------------------------------------------------------------------
// Add Item (submit)
// ---------------------------------------------------------------------------
function addItem() {
    const mode = document.getElementById("inputMode").value;
    const principal = document.getElementById("principal").value;
    const destination = document.getElementById("destination").value;

    let productCode = "";
    if (mode === "excel") {
        productCode = document.getElementById("selectedProductCode").value || document.getElementById("productCodeSearch").value;
    } else {
        productCode = document.getElementById("manualProductCode").value;
    }

    const productName = document.getElementById("productName").value;
    const cbm = document.getElementById("cbm").value;
    const quantity = document.getElementById("quantity").value;
    const productPrice = document.getElementById("productPrice").value;
    const description = document.getElementById("itemDescription").value;
    const imageFile = document.getElementById("itemImage").files[0];

    if (!principal) { alert("Please select a principal first."); return; }
    if (!destination) { alert("Please select a destination."); return; }
    if (!productCode && mode === "excel") { alert("Please select a product code."); return; }

    const formData = new FormData();
    formData.append("product_code", productCode);
    formData.append("cbm", cbm);
    formData.append("quantity", quantity);
    formData.append("principal", principal);
    formData.append("destination", destination);
    formData.append("input_mode", mode);
    formData.append("product_name", productName);
    formData.append("description", description);
    formData.append("user_key", getUserKey());
    if (productPrice) formData.append("product_price", productPrice);
    if (imageFile) formData.append("item_image", imageFile);

    appendLog("Adding item...");

    fetch("/quotation/add_item", {
        method: "POST",
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        if (data.output_log) setLog(data.output_log);
        if (data.success) {
            currentItems = data.items;
            refreshItemsTable();
            bootstrap.Modal.getInstance(document.getElementById("addItemModal")).hide();
            appendLog(data.message || "Item added.");
        } else {
            alert(data.message || "Failed to add item.");
        }
    })
    .catch(err => {
        appendLog("ERROR: " + err);
    });
}

// ---------------------------------------------------------------------------
// Refresh Items Table
// ---------------------------------------------------------------------------
function refreshItemsTable() {
    const tbody = document.getElementById("itemsTableBody");
    tbody.innerHTML = "";

    if (!currentItems || currentItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No items added yet.</td></tr>';
        return;
    }

    currentItems.forEach(item => {
        const tr = document.createElement("tr");
        const hasImage = item.image_data_url ? '<span style="color:#22c55e;font-size:0.7rem;">&#10003; Image</span>' : '';
        const imageBtn = '<button class="btn btn-sm btn-outline-secondary mt-1" onclick="attachItemImage(' + item.item_no + ')" title="Attach image">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Image</button>';
        tr.innerHTML = `
            <td>${item.item_no}</td>
            <td>${item.product_name || ""}</td>
            <td>${item.product_code || ""}</td>
            <td>${item.quantity}</td>
            <td class="text-end">${formatPHP(item.total_amount)}</td>
            <td class="text-end">${formatPHP(item.total_unit_price)}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditItemModal(${item.item_no})">Edit</button>
                <button class="btn btn-sm btn-outline-danger" onclick="removeItem(${item.item_no})">Remove</button>
                ${imageBtn}
                ${hasImage}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ---------------------------------------------------------------------------
// Edit Item
// ---------------------------------------------------------------------------
function openEditItemModal(itemNo) {
    const item = currentItems.find(i => i.item_no === itemNo);
    if (!item) return;

    document.getElementById("editItemNo").value = item.item_no;
    document.getElementById("editProductName").value = item.product_name || "";
    document.getElementById("editProductCode").value = item.product_code || "";
    document.getElementById("editUnitPrice").value = item.total_amount || 0;
    document.getElementById("editQuantity").value = item.quantity || 1;
    document.getElementById("editDescription").value = item.description || "";

    const modal = new bootstrap.Modal(document.getElementById("editItemModal"));
    modal.show();
}

function applyEditItem() {
    const itemNo = parseInt(document.getElementById("editItemNo").value);
    const payload = {
        item_no: itemNo,
        product_name: document.getElementById("editProductName").value,
        product_code: document.getElementById("editProductCode").value,
        total_amount: parseFloat(document.getElementById("editUnitPrice").value) || 0,
        quantity: parseInt(document.getElementById("editQuantity").value) || 1,
        total_unit_price: (parseFloat(document.getElementById("editUnitPrice").value) || 0) * (parseInt(document.getElementById("editQuantity").value) || 1),
        description: document.getElementById("editDescription").value,
        user_key: getUserKey()
    };

    fetch("/quotation/update_item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        if (data.output_log) setLog(data.output_log);
        if (data.success) {
            currentItems = data.items;
            refreshItemsTable();
            bootstrap.Modal.getInstance(document.getElementById("editItemModal")).hide();
            appendLog("Item #" + itemNo + " updated.");
        } else {
            alert(data.message || "Failed to update item.");
        }
    })
    .catch(err => appendLog("ERROR: " + err));
}

// ---------------------------------------------------------------------------
// Attach Image to Item (works in both new and revision mode)
// ---------------------------------------------------------------------------
function attachItemImage(itemNo) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            alert('Image must be under 5MB.');
            return;
        }
        const formData = new FormData();
        formData.append('item_no', itemNo);
        formData.append('item_image', file);
        formData.append('user_key', getUserKey());

        fetch('/quotation/attach_item_image', {
            method: 'POST',
            body: formData
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                currentItems = data.items;
                refreshItemsTable();
                appendLog('Image attached to item #' + itemNo + '.');
            } else {
                alert(data.message || 'Failed to attach image.');
            }
        })
        .catch(err => appendLog('ERROR attaching image: ' + err));
    };
    input.click();
}

// ---------------------------------------------------------------------------
// Remove Item
// ---------------------------------------------------------------------------
function removeItem(itemNo) {
    if (!confirm("Remove item #" + itemNo + "?")) return;

    fetch("/quotation/remove_item/" + itemNo, {
        method: "POST",
        headers: { "X-User-Key": getUserKey() }
    })
    .then(r => r.json())
    .then(data => {
        if (data.output_log) setLog(data.output_log);
        if (data.success) {
            currentItems = data.items;
            refreshItemsTable();
            appendLog("Item #" + itemNo + " removed.");
        } else {
            alert(data.message || "Failed to remove item.");
        }
    })
    .catch(err => appendLog("ERROR: " + err));
}

// ---------------------------------------------------------------------------
// Clear Items
// ---------------------------------------------------------------------------
function clearItems() {
    if (!confirm("Clear ALL items?")) return;

    fetch("/quotation/clear_items", {
        method: "POST",
        headers: { "X-User-Key": getUserKey() }
    })
    .then(r => r.json())
    .then(data => {
        if (data.output_log) setLog(data.output_log);
        currentItems = [];
        refreshItemsTable();
        appendLog("All items cleared.");
    })
    .catch(err => appendLog("ERROR: " + err));
}

// ---------------------------------------------------------------------------
// Terms Modal
// ---------------------------------------------------------------------------
function showTermsModal() {
    document.getElementById("termsValidity").value = savedTerms.validity;
    document.getElementById("termsDelivery").value = savedTerms.delivery;
    document.getElementById("termsPayment").value = savedTerms.payment;

    // Set warranty select
    const w = savedTerms.warranty;
    const wSelect = document.getElementById("termsWarrantySelect");
    const wCustom = document.getElementById("termsWarrantyCustom");
    if (w === "1 year" || w === "2 years") {
        wSelect.value = w;
        wCustom.classList.add("d-none");
    } else if (w) {
        wSelect.value = "custom";
        wCustom.value = w;
        wCustom.classList.remove("d-none");
    } else {
        wSelect.value = "";
        wCustom.classList.add("d-none");
    }

    const modal = new bootstrap.Modal(document.getElementById("termsModal"));
    modal.show();
}

function toggleWarrantyInput() {
    const sel = document.getElementById("termsWarrantySelect").value;
    const customEl = document.getElementById("termsWarrantyCustom");
    if (sel === "custom") {
        customEl.classList.remove("d-none");
    } else {
        customEl.classList.add("d-none");
    }
}

function submitTerms() {
    savedTerms.validity = document.getElementById("termsValidity").value;
    savedTerms.delivery = document.getElementById("termsDelivery").value;
    savedTerms.payment = document.getElementById("termsPayment").value;

    const wSel = document.getElementById("termsWarrantySelect").value;
    if (wSel === "custom") {
        savedTerms.warranty = document.getElementById("termsWarrantyCustom").value;
    } else {
        savedTerms.warranty = wSel;
    }

    bootstrap.Modal.getInstance(document.getElementById("termsModal")).hide();
    appendLog("Terms saved.");
}

// ---------------------------------------------------------------------------
// Generate Quotation
// ---------------------------------------------------------------------------
let _quotationGenerating = false;
function generateQuotation() {
    if (_quotationGenerating) return;  // Prevent double-submission

    if (!currentItems || currentItems.length === 0) {
        alert("Please add at least one item before generating.");
        return;
    }

    // ── Required field validation ────────────────────────────
    const required = [
        { id: 'clientName',       label: 'Client Name' },
        { id: 'clientAddress',    label: 'Client Address' },
        { id: 'attention',        label: 'Attention' },
        { id: 'subject',          label: 'Subject' },
        { id: 'referenceNo',      label: 'Reference No' },
        { id: 'quotationDate',    label: 'Quotation Date' },
        { id: 'sigName',          label: 'Signature Name' },
        { id: 'sigDesignation',   label: 'Signature Designation' },
        { id: 'principal',        label: 'Principal' },
        { id: 'destination',      label: 'Destination' },
    ];
    const missing = [];
    required.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        const empty = !el.value.trim();
        el.classList.toggle('is-invalid', empty);
        if (empty) missing.push(f.label);
    });
    if (missing.length > 0) {
        setLog(['⚠ Cannot generate — the following required fields are blank:', ...missing.map(m => '  • ' + m)]);
        document.getElementById('outputLog').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }

    // ── Terms & Conditions validation ────────────────────────
    const termsErrors = [];
    if (!savedTerms.validity.trim()) termsErrors.push('Validity');
    if (!savedTerms.payment.trim())  termsErrors.push('Payment Terms');
    if (!savedTerms.warranty.trim()) termsErrors.push('Warranty');
    if (termsErrors.length > 0) {
        setLog(['⚠ Cannot generate — the following Terms & Conditions fields are blank:', ...termsErrors.map(m => '  • ' + m), 'Open the Terms & Conditions panel to fill them in.']);
        document.getElementById('outputLog').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }
    // ── End validation ───────────────────────────────────────

    const userSession = JSON.parse(localStorage.getItem('session') || '{}');
    const agentName = (userSession.name || '').trim();
    const quotationSheetId = (userSession.quotationSheetId || '').trim();
    const prSheetId = (userSession.prSheetId || '').trim();

    const formData = new FormData();

    // Client details
    formData.append('client_name', document.getElementById("clientName").value);
    formData.append('client_address', document.getElementById("clientAddress").value);
    formData.append('attention', document.getElementById("attention").value);
    formData.append('designation', document.getElementById("clientDesignation").value);
    formData.append('email', document.getElementById("clientEmail").value);
    formData.append('subject', document.getElementById("subject").value);
    formData.append('reference_no', document.getElementById("referenceNo").value);
    formData.append('reference_rfq_no', document.getElementById("referenceRfqNo").value);
    formData.append('quotation_date', document.getElementById("quotationDate").value);

    // Signature
    formData.append('sig_name', document.getElementById("sigName").value);
    formData.append('sig_designation', document.getElementById("sigDesignation").value);
    formData.append('sig_viber', document.getElementById("sigViber").value);
    formData.append('sig_mobile', document.getElementById("sigMobile").value);
    formData.append('sig_email', document.getElementById("sigEmail").value);

    // Terms
    formData.append('validity', savedTerms.validity);
    formData.append('delivery', savedTerms.delivery);
    formData.append('payment', savedTerms.payment);
    formData.append('warranty', savedTerms.warranty);

    // Options
    formData.append('principal', document.getElementById("principal").value);
    formData.append('destination', document.getElementById("destination").value);
    formData.append('vat_option', document.getElementById("vatOption").value);
    formData.append('discount_percentage', document.getElementById("discountPercentage").value);
    formData.append('desc_mode', document.getElementById("descMode").value);
    formData.append('note', document.getElementById("note").value);

    // Auto-submit fields
    formData.append('agent_name', agentName);
    formData.append('quotation_sheet_id', quotationSheetId);
    formData.append('pr_sheet_id', prSheetId);
    formData.append('creator_role', (userSession.role || '').trim());
    formData.append('user_key', getUserKey());

    // If in revision mode, include revision context as JSON string
    if (revisionContext) {
        formData.append('revision_context', JSON.stringify({
            sheetId: revisionContext.sheetId,
            rowIndex: revisionContext.rowIndex,
        }));
    }

    // Attach brochure PDF files
    const brochureInput = document.getElementById('brochure_file');
    if (brochureInput && brochureInput.files.length > 0) {
        for (let i = 0; i < brochureInput.files.length; i++) {
            formData.append('brochure_file', brochureInput.files[i]);
        }
    }

    // Disable generate button to prevent duplicate submissions
    _quotationGenerating = true;
    const genBtn = document.querySelector('button[onclick="generateQuotation()"]');
    if (genBtn) { genBtn.disabled = true; genBtn.textContent = 'Generating...'; }

    appendLog("Generating quotation PDF...");

    fetch("/quotation/generate", {
        method: "POST",
        body: formData
    })
    .then(response => {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            return response.json().then(data => {
                if (data.output_log) setLog(data.output_log);
                throw new Error(data.message || "Failed to generate quotation.");
            });
        }
        if (!response.ok) throw new Error("Server error: " + response.status);
        const disposition = response.headers.get("content-disposition") || "";
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        const filename = match ? match[1].replace(/['"]/g, "") : "Quotation.pdf";
        return response.blob().then(blob => ({ blob, filename }));
    })
    .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        appendLog("Success: Quotation PDF downloaded — " + filename);

        // Fetch submission info (sheetId, rowIndex) from server
        return fetch('/quotation/last_submission_info?user_key=' + encodeURIComponent(getUserKey())).then(r => r.json());
    })
    .then(info => {
        if (info && info.success) {
            pendingApprovalContext = {
                sheetId: info.sheetId,
                rowIndex: info.rowIndex,
                refNo: info.refNo || '',
                status: 'Pending Approval',
            };
            sessionStorage.setItem('pendingApprovalContext', JSON.stringify(pendingApprovalContext));
            appendLog("Success: Quotation submitted for approval automatically.");
        }
        // Clear revision context if it was set
        if (revisionContext) {
            revisionContext = null;
            document.getElementById('revisionBanner').classList.add('d-none');
            document.getElementById('referenceNo').readOnly = false;
        }
        updateSubmitButtonState();
    })
    .catch(err => {
        appendLog("ERROR: " + err);
        alert("Error generating quotation. Check the output log.");
    })
    .finally(() => {
        // Re-enable button after completion (success or failure)
        _quotationGenerating = false;
        if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Generate Quotation'; }
    });
}

// ---------------------------------------------------------------------------
// Submit to Google Sheet (FINALIZE approved quotation)
// ---------------------------------------------------------------------------
function submitToGoogleSheet() {
    if (!pendingApprovalContext) {
        alert('No quotation pending. Generate a quotation first.');
        return;
    }
    if (pendingApprovalContext.status !== 'Approved') {
        alert('This quotation is not yet approved. Current status: ' + (pendingApprovalContext.status || 'Unknown'));
        return;
    }

    if (!confirm('Finalize this approved quotation? This will mark it as "Finalized" in the sheet.')) return;

    appendLog('Finalizing approved quotation...');

    fetch('/quotation/submit_to_sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sheetId: pendingApprovalContext.sheetId,
            rowIndex: pendingApprovalContext.rowIndex,
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            alert('Quotation finalized successfully!');
            pendingApprovalContext = null;
            sessionStorage.removeItem('pendingApprovalContext');
            updateSubmitButtonState();
            appendLog('Success: Quotation finalized.');
        } else {
            alert('Failed to finalize: ' + (data.message || 'Unknown error'));
            appendLog('Error: ' + (data.message || 'Finalization failed'));
        }
    })
    .catch(err => {
        appendLog('ERROR: ' + err);
        alert('Error finalizing. Check the output log.');
    });
}

// ---------------------------------------------------------------------------
// Approval Status Checking
// ---------------------------------------------------------------------------
function updateSubmitButtonState() {
    const statusEl = document.getElementById('approvalStatus');
    const submitBtn = document.getElementById('submitBtn');
    const checkBtn = document.getElementById('checkStatusBtn');

    if (!statusEl || !submitBtn) return;

    if (!pendingApprovalContext) {
        statusEl.innerHTML = '<p style="color:#64748b;margin:0;">Generate a quotation first to submit for approval.</p>';
        submitBtn.disabled = true;
        submitBtn.className = 'btn btn-secondary w-100';
        submitBtn.textContent = 'Submit to Google Sheet';
        if (checkBtn) checkBtn.style.display = 'none';
        return;
    }

    const s = pendingApprovalContext.status || '';
    if (s === 'Pending Approval' || s === 'Pending') {
        statusEl.innerHTML = '<p style="color:#eab308;margin:0;font-weight:600;">&#9203; Pending Approval</p>' +
            '<p style="color:#94a3b8;margin:0.25rem 0 0;font-size:0.8rem;">Ref: ' + (pendingApprovalContext.refNo || '—') + '</p>';
        submitBtn.disabled = true;
        submitBtn.className = 'btn btn-secondary w-100';
        submitBtn.textContent = 'Awaiting Approval...';
        if (checkBtn) checkBtn.style.display = '';
    } else if (s === 'Approved') {
        statusEl.innerHTML = '<p style="color:#22c55e;margin:0;font-weight:600;">&#10004; Approved</p>' +
            '<p style="color:#94a3b8;margin:0.25rem 0 0;font-size:0.8rem;">Ref: ' + (pendingApprovalContext.refNo || '—') + '</p>';
        submitBtn.disabled = false;
        submitBtn.className = 'btn btn-success w-100';
        submitBtn.textContent = 'Finalize & Submit to Google Sheet';
        if (checkBtn) checkBtn.style.display = '';
    } else if (s === 'Rejected') {
        statusEl.innerHTML = '<p style="color:#ef4444;margin:0;font-weight:600;">&#10008; Rejected</p>' +
            '<p style="color:#94a3b8;margin:0.25rem 0 0;font-size:0.8rem;">Load the rejected quotation below to revise and resubmit.</p>';
        submitBtn.disabled = true;
        submitBtn.className = 'btn btn-secondary w-100';
        submitBtn.textContent = 'Rejected — Revise Required';
        if (checkBtn) checkBtn.style.display = 'none';
        // Clear context since they need to revise
        pendingApprovalContext = null;
        sessionStorage.removeItem('pendingApprovalContext');
    } else {
        statusEl.innerHTML = '<p style="color:#eab308;margin:0;">Status: ' + s + '</p>';
        submitBtn.disabled = true;
        submitBtn.className = 'btn btn-secondary w-100';
        submitBtn.textContent = 'Awaiting Approval...';
        if (checkBtn) checkBtn.style.display = '';
    }
}

function checkApprovalStatus() {
    if (!pendingApprovalContext || !pendingApprovalContext.sheetId) {
        alert('No pending quotation to check.');
        return;
    }

    appendLog('Checking approval status...');
    const params = new URLSearchParams({
        sheetId: pendingApprovalContext.sheetId,
        rowIndex: pendingApprovalContext.rowIndex,
    });

    fetch('/quotation/check_approval_status?' + params)
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            const overall = (data.overallStatus || '').trim();
            const admin = (data.adminApproval || '').trim();
            const mgmt = (data.mgmtApproval || '').trim();

            if (overall === 'Approved') {
                pendingApprovalContext.status = 'Approved';
            } else if (overall === 'Rejected') {
                pendingApprovalContext.status = 'Rejected';
            } else {
                pendingApprovalContext.status = 'Pending Approval';
            }

            sessionStorage.setItem('pendingApprovalContext', JSON.stringify(pendingApprovalContext));
            updateSubmitButtonState();
            appendLog('Approval status: Admin=' + (admin || 'Pending') + ', Mgmt=' + (mgmt || 'Pending') + ', Overall=' + (overall || 'Pending'));
        } else {
            appendLog('Warning: Could not check status — ' + (data.message || ''));
        }
    })
    .catch(err => {
        appendLog('ERROR checking status: ' + err);
    });
}

// ---------------------------------------------------------------------------
// Revision Workflow — Load, Edit, Resubmit Rejected Quotations
// ---------------------------------------------------------------------------

function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
}

function fetchRejectedQuotations() {
    const userSession = JSON.parse(localStorage.getItem('session') || '{}');
    const quotationSheetId = (userSession.quotationSheetId || '').trim();

    if (!quotationSheetId) {
        alert('No Quotation Sheet ID found. Please log in or contact your admin.');
        return;
    }

    // Show modal with loading state
    document.getElementById('rejectedQuotationsLoading').classList.remove('d-none');
    document.getElementById('rejectedQuotationsTable').classList.add('d-none');
    document.getElementById('rejectedQuotationsEmpty').classList.add('d-none');
    const modal = new bootstrap.Modal(document.getElementById('rejectedQuotationsModal'));
    modal.show();

    fetch('/quotation/get_rejected?quotation_sheet_id=' + encodeURIComponent(quotationSheetId))
    .then(r => r.json())
    .then(result => {
        document.getElementById('rejectedQuotationsLoading').classList.remove('d-none');
        document.getElementById('rejectedQuotationsLoading').classList.add('d-none');

        if (!result.success || !result.data || result.data.length === 0) {
            document.getElementById('rejectedQuotationsEmpty').classList.remove('d-none');
            return;
        }

        cachedRejectedQuotations = result.data;
        // Store the sheetId from the response for use in revision context
        const sheetId = result.sheetId || quotationSheetId;

        const tbody = document.getElementById('rejectedQuotationsBody');
        tbody.innerHTML = '';

        result.data.forEach((q, idx) => {
            // Attach sheetId to each entry for later use
            q.sheetId = sheetId;

            const tr = document.createElement('tr');
            const hasData = q.quotationData && q.quotationData.trim() !== '';
            tr.innerHTML = `
                <td>${q.date || ''}</td>
                <td>${q.refNo || ''}</td>
                <td>${q.clientName || ''}</td>
                <td>${q.subject || ''}</td>
                <td class="text-end">${q.amount ? formatPHP(q.amount) : '\u2014'}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-primary"
                            onclick="loadRejectedQuotation(${idx})"
                            ${!hasData ? 'disabled title="No saved data (pre-feature submission)"' : ''}>
                        Load
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('rejectedQuotationsTable').classList.remove('d-none');
    })
    .catch(err => {
        document.getElementById('rejectedQuotationsLoading').classList.add('d-none');
        alert('Error loading rejected quotations: ' + err);
    });
}

function loadRejectedQuotation(idx) {
    const q = cachedRejectedQuotations[idx];
    if (!q || !q.quotationData) {
        alert('No saved quotation data available for this entry.');
        return;
    }

    if (currentItems.length > 0 && !confirm('Loading will replace current items and form fields. Continue?')) {
        return;
    }

    // Send JSON to Flask to populate server-side quotation_items
    fetch('/quotation/load_quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotationData: q.quotationData, user_key: getUserKey() })
    })
    .then(r => r.json())
    .then(data => {
        if (!data.success) {
            alert('Failed to load: ' + (data.message || 'Unknown error'));
            return;
        }

        // Server-side items loaded; update frontend
        currentItems = data.items;
        refreshItemsTable();

        // Parse JSON to populate form fields
        let qdata;
        try { qdata = JSON.parse(q.quotationData); } catch (e) { qdata = {}; }
        const form = qdata.form || {};
        const terms = qdata.terms || {};

        // Client fields
        _setVal('clientName', form.clientName);
        _setVal('clientAddress', form.clientAddress);
        _setVal('attention', form.attention);
        _setVal('clientDesignation', form.clientDesignation);
        _setVal('clientEmail', form.clientEmail);
        _setVal('subject', form.subject);
        _setVal('referenceNo', form.referenceNo);
        _setVal('referenceRfqNo', form.referenceRfqNo);
        _setVal('quotationDate', form.quotationDate);

        // Signature fields
        _setVal('sigName', form.sigName);
        _setVal('sigDesignation', form.sigDesignation);
        _setVal('sigViber', form.sigViber);
        _setVal('sigMobile', form.sigMobile);
        _setVal('sigEmail', form.sigEmail);

        // Options
        _setVal('discountPercentage', form.discountPercentage);
        _setVal('vatOption', form.vatOption);
        _setVal('descMode', form.descMode);
        _setVal('note', form.note);

        // Principal + destination (async: loadData must finish before destination can be set)
        if (form.principal) {
            _setVal('principal', form.principal);
            pendingDestination = form.destination || '';
            loadData();  // will apply pendingDestination once destinations are loaded
        }

        // Terms
        savedTerms.validity = terms.validity || '';
        savedTerms.delivery = terms.delivery || '';
        savedTerms.payment = terms.payment || '';
        savedTerms.warranty = terms.warranty || '';

        // Set revision context
        revisionContext = {
            sheetId: q.sheetId,
            rowIndex: q.rowIndex,
        };

        // Show revision banner
        document.getElementById('revisionBanner').classList.remove('d-none');

        // Close modal
        bootstrap.Modal.getInstance(document.getElementById('rejectedQuotationsModal')).hide();

        if (data.output_log) setLog(data.output_log);
        appendLog('Revision mode active. Edit items and form fields, then Generate PDF and Submit.');
    })
    .catch(err => {
        appendLog('ERROR: ' + err);
        alert('Error loading quotation.');
    });
}

function cancelRevision() {
    revisionContext = null;
    document.getElementById('revisionBanner').classList.add('d-none');
    appendLog('Revision mode cancelled.');
}

// ---------------------------------------------------------------------------
// Load PR items into quotation (from pending-items "Create Quotation" flow)
// ---------------------------------------------------------------------------
function loadPRQuotationItems(quotationDataStr) {
    fetch('/quotation/load_quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotationData: quotationDataStr, user_key: getUserKey() })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (!data.success) {
            appendLog('Failed to load PR items: ' + (data.message || 'Unknown error'));
            return;
        }

        currentItems = data.items;
        refreshItemsTable();

        // Parse form data to populate fields
        var qdata;
        try { qdata = JSON.parse(quotationDataStr); } catch (e) { qdata = {}; }
        var form = qdata.form || {};

        _setVal('clientName', form.clientName);
        _setVal('attention', form.attention);
        _setVal('referenceRfqNo', form.referenceRfqNo);

        // Set principal to "Others" and load destinations
        if (form.principal) {
            _setVal('principal', form.principal);
            loadData();
        }

        // Set today's date
        var today = new Date().toISOString().slice(0, 10);
        _setVal('quotationDate', today);

        if (data.output_log) setLog(data.output_log);
        appendLog('Loaded ' + currentItems.length + ' item(s) from Purchase Request. Select a destination, review items, and generate the quotation.');
    })
    .catch(function(err) {
        appendLog('ERROR loading PR items: ' + err);
    });
}

// ---------------------------------------------------------------------------
// On page load — restore approval status UI
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
    if (pendingApprovalContext) {
        updateSubmitButtonState();
    }

    // Check for PR-to-Quotation data from pending items
    var prData = sessionStorage.getItem('prQuotationData');
    if (prData) {
        sessionStorage.removeItem('prQuotationData');
        loadPRQuotationItems(prData);
    }

    // Clear validation highlights when user fills in a required field
    ['clientName','clientAddress','attention','subject','referenceNo','quotationDate',
     'sigName','sigDesignation','principal','destination'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', function() { el.classList.remove('is-invalid'); });
        if (el) el.addEventListener('change', function() { el.classList.remove('is-invalid'); });
    });

    // Auto-save Terms modal values whenever the modal closes (even via X / backdrop)
    var termsModalEl = document.getElementById('termsModal');
    if (termsModalEl) {
        termsModalEl.addEventListener('hide.bs.modal', function() {
            savedTerms.validity = document.getElementById("termsValidity").value;
            savedTerms.delivery = document.getElementById("termsDelivery").value;
            savedTerms.payment  = document.getElementById("termsPayment").value;
            var wSel = document.getElementById("termsWarrantySelect").value;
            if (wSel === "custom") {
                savedTerms.warranty = document.getElementById("termsWarrantyCustom").value;
            } else {
                savedTerms.warranty = wSel;
            }
        });
    }
});
