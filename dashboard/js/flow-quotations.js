/* flow-quotations.js — quotations that load items from inventory */
let qInventory = [];
let qList = [];
let qSession = null;

let qIsOversight = false;   // admin/accounting/management/director see ALL reps, grouped
let qReturnedPRs = [];      // sales: PRs Returned to Sales, loadable into a quotation
let qFromPr = '';           // when set, Save creates the quotation from this PR (carries mgmt final prices)
let qAdmin = false;         // admin: free-typed item rows (incl. new items) auto-added to inventory on save

document.addEventListener('DOMContentLoaded', async () => {
  qSession = requireQuotationAccess();
  if (!qSession) return;
  qIsOversight = qSession.role !== 'sales';
  qAdmin = qSession.role === 'admin';
  renderNavbar('flow-quotations');
  // Only admin/accounting can open the rest of the flow — show the sub-nav to them.
  if (qSession.role === 'admin' || qSession.role === 'accounting') renderFlowNav('flow-quotations.html');
  // Admin: switch the item table to free-typed rows (Item No · Description · …) so brand-new items
  // can be quoted directly and auto-added to inventory on save (no PR/management pricing needed).
  if (qAdmin) {
    const head = document.getElementById('itemHead');
    if (head) head.innerHTML = '<tr><th style="width:18%;">Item No</th><th style="width:30%;">Description</th>' +
      '<th class="num" style="width:12%;">Quoted Qty</th><th class="num" style="width:16%;">Quoted Price</th>' +
      '<th class="num" style="width:16%;">Line Total</th><th></th></tr>';
    const nib = document.getElementById('newItemBtn'); if (nib) nib.style.display = 'none';
  }
  document.getElementById('date').value = flowToday();
  await loadInventory();
  addRow();
  await loadQuotations();
  // Sales: offer to load a Returned-to-Sales PR (with its management final prices) into the form.
  if (qSession.role === 'sales') await loadReturnedPRs();
  const params = new URLSearchParams(location.search);
  // Deep-link: ?review=<quotationNo> opens the review modal directly (e.g. from the admin dashboard).
  const reviewNo = params.get('review');
  if (reviewNo) openReviewModal(reviewNo);
  // Deep-link: ?fromPR=<prNo> pre-loads that returned PR's final-priced items for review + create.
  const fromPr = params.get('fromPR');
  if (fromPr) loadFromPR(fromPr);
});

// ─── Load a Returned-to-Sales Pricing Request into the quotation form ─────────────
async function loadReturnedPRs() {
  const wrap = document.getElementById('fromPrWrap'), sel = document.getElementById('fromPrSelect');
  if (!wrap || !sel) return;
  try {
    const r = await fetchFlow('getPricingRequests', { requestedBy: qSession.name });
    qReturnedPRs = ((r && r.data) || []).filter(p => p.status === 'Returned to Sales');
  } catch (e) { qReturnedPRs = []; }
  sel.innerHTML = '<option value="">— load a returned Purchase Request —</option>' +
    qReturnedPRs.map(p => `<option value="${flowEsc(p.prNo)}">${flowEsc(p.prNo)} — ${flowEsc(p.customer || '')}</option>`).join('');
  wrap.style.display = qReturnedPRs.length ? 'block' : 'none';
}

// Pre-fill the form from a returned PR: customer + a row per included item priced at its Final Price.
// Save then routes through createQuotationFromPR (uses the PR's stored management finals + flips it to Quoted).
async function loadFromPR(prNo) {
  let pr = qReturnedPRs.find(p => String(p.prNo) === String(prNo));
  if (!pr) {
    try {
      const r = await fetchFlow('getPricingRequests', { requestedBy: qSession.name });
      pr = ((r && r.data) || []).find(p => String(p.prNo) === String(prNo));
    } catch (e) { /* ignore */ }
  }
  if (!pr) { flowMsg('formMsg', 'Purchase Request ' + prNo + ' not found or not returned to you.', false); return; }
  const included = (pr.items || []).filter(i => i.included);
  document.getElementById('customer').value = pr.customer || '';
  document.getElementById('itemRows').innerHTML = '';
  included.forEach(addPrRow);
  if (!included.length) addRow();
  qFromPr = String(pr.prNo);
  const sel = document.getElementById('fromPrSelect'); if (sel) sel.value = qFromPr;
  const banner = document.getElementById('fromPrBanner');
  banner.style.display = 'block';
  banner.innerHTML = `Loaded from <b>${flowEsc(pr.prNo)}</b> — management final prices shown below. Review, then <b>Save Quotation</b> to create it.`;
  document.getElementById('formTitle').textContent = 'Quotation from ' + pr.prNo;
  recalc();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// A form row for a PR item priced at its Final Price; injects a select option for non-inventory items.
function addPrRow(it) {
  // addRow keys inventory rows by rowIndex and injects a raw option for non-inventory items (like PR lines).
  addRow({ itemNo: it.itemNo, itemName: it.itemName, qty: flowNum(it.qty), price: flowNum(it.finalPrice),
           origItemNo: it.origItemNo || '', origItemName: it.origItemName || '' });
}

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); qInventory = (r && r.data) || []; }
  catch (e) { qInventory = []; }
  qFillDatalist();
}

// Admin: populate the item-no autocomplete from inventory (Item No — Description).
function qFillDatalist() {
  const dl = document.getElementById('qInvList');
  if (!dl || !qAdmin) return;
  dl.innerHTML = qInventory.map(i =>
    `<option value="${flowEsc(i.itemNo)}">${flowEsc(i.itemNo)} — ${flowEsc(i.description)}</option>`).join('');
}

// Admin: when the typed item-no matches an inventory item, auto-fill its description.
function onItemNoType(inp) {
  const inv = qInventory.find(i => String(i.itemNo).toLowerCase() === String(inp.value).trim().toLowerCase());
  if (inv) {
    const desc = inp.closest('tr').querySelector('.i-desc');
    if (desc && !desc.value.trim()) desc.value = inv.description || '';
  }
}

// Option value = inventory rowIndex (UNIQUE). Keying on itemNo was broken because many items share
// itemNo "N/A" — every N/A pick resolved to the first N/A row (a phantom item).
function itemOptions(selectedRowIndex) {
  return '<option value="">— select item —</option>' + qInventory.map(i =>
    `<option value="${flowEsc(i.rowIndex)}"${String(i.rowIndex) === String(selectedRowIndex) ? ' selected' : ''}>${flowEsc(i.itemNo)} — ${flowEsc(i.description)}</option>`).join('');
}
// The inventory rowIndex whose itemNo AND description match a saved/loaded item (for pre-selection); '' if none.
function invRowKey(item) {
  if (!item) return '';
  const m = qInventory.find(i => String(i.itemNo) === String(item.itemNo || '') &&
    String(i.description) === String(item.itemName || item.description || ''));
  return m ? String(m.rowIndex) : '';
}

function addRow(item) {
  const tb = document.getElementById('itemRows');
  const tr = document.createElement('tr');
  // Preserve the requested-vs-offered pairing (A86) across edits: PR-derived items carry the
  // client's ORIGINAL code/description; stamp them on the row so collectItems round-trips them.
  if (item && (item.origItemNo || item.origItemName)) {
    tr.dataset.origNo = item.origItemNo || '';
    tr.dataset.origName = item.origItemName || '';
  }
  if (qAdmin) {
    // Free-typed row: Item No (with inventory autocomplete) · Description · Qty · Price · Line Total.
    tr.innerHTML = `
      <td><input type="text" class="i-no" list="qInvList" value="${item ? flowEsc(item.itemNo) : ''}" oninput="onItemNoType(this)" placeholder="Item No"></td>
      <td><input type="text" class="i-desc" value="${item ? flowEsc(item.itemName || item.description) : ''}" placeholder="Description"></td>
      <td class="num"><input type="number" step="any" min="0" value="${item ? flowNum(item.qty) : 0}" oninput="recalc()"></td>
      <td class="num"><input type="number" step="any" min="0" value="${item ? flowNum(item.price) : 0}" oninput="recalc()"></td>
      <td class="num lineTotal">0.00</td>
      <td><button type="button" class="link-btn del-btn" onclick="this.closest('tr').remove();recalc();">✕</button></td>`;
  } else {
    tr.innerHTML = `
      <td><select onchange="onItemPick(this)">${itemOptions(invRowKey(item))}</select></td>
      <td class="num"><input type="number" step="any" min="0" value="${item ? flowNum(item.qty) : 0}" oninput="recalc()"></td>
      <td class="num"><input type="number" step="any" min="0" value="${item ? flowNum(item.price) : 0}" oninput="recalc()"></td>
      <td class="num lineTotal">0.00</td>
      <td><button type="button" class="link-btn del-btn" onclick="this.closest('tr').remove();recalc();">✕</button></td>`;
    // A saved/loaded item not found in inventory (e.g. a PR final-priced line or a since-deleted item):
    // keep it as a raw option carrying its own data so collectItems preserves it instead of dropping it.
    if (item && !invRowKey(item) && (item.itemNo || item.itemName || item.description)) {
      const sel = tr.querySelector('select');
      const opt = document.createElement('option');
      opt.value = 'raw';
      opt.dataset.no = item.itemNo || '';
      opt.dataset.name = item.itemName || item.description || '';
      opt.textContent = (item.itemNo ? item.itemNo + ' — ' : '') + (item.itemName || item.description || '');
      opt.selected = true;
      sel.appendChild(opt);
    }
  }
  tb.appendChild(tr);
  recalc();
}

function onItemPick(sel) { recalc(); }

function recalc() {
  let total = 0;
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    // qty/price are the two number inputs immediately before the .lineTotal cell (layout-agnostic).
    const nums = tr.querySelectorAll('input[type="number"]');
    const qty = flowNum(nums[0] ? nums[0].value : 0);
    const price = flowNum(nums[1] ? nums[1].value : 0);
    const lt = qty * price;
    tr.querySelector('.lineTotal').textContent = lt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    total += lt;
  });
  document.getElementById('grandTotal').textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const nums = tr.querySelectorAll('input[type="number"]');
    const qty = flowNum(nums[0] ? nums[0].value : 0);
    const price = flowNum(nums[1] ? nums[1].value : 0);
    const orig = { origItemNo: tr.dataset.origNo || '', origItemName: tr.dataset.origName || '' };
    if (qAdmin) {
      const itemNo = (tr.querySelector('.i-no').value || '').trim();
      const desc = (tr.querySelector('.i-desc').value || '').trim();
      if (!itemNo && !desc) return;                        // skip empty row
      items.push({ itemNo: itemNo || 'N/A', itemName: desc || itemNo || 'N/A', qty, price, ...orig });
    } else {
      const sel = tr.children[0].querySelector('select');
      const key = sel.value;                                 // rowIndex of the picked inventory row, or "raw"
      if (!key) return;
      if (key === 'raw') {                                   // non-inventory line (PR item / since-deleted)
        const opt = sel.options[sel.selectedIndex];
        const no = (opt && opt.dataset.no) || '';
        const nm = (opt && opt.dataset.name) || '';
        if (!no && !nm) return;
        items.push({ itemNo: no || 'N/A', itemName: nm || no || 'N/A', qty, price, ...orig });
        return;
      }
      const inv = qInventory.find(i => String(i.rowIndex) === String(key));
      if (!inv) return;
      items.push({ itemNo: inv.itemNo, itemName: inv.description, qty, price, ...orig });
    }
  });
  return items;
}

function toggleNewItem() {
  const b = document.getElementById('newItemBox');
  b.style.display = b.style.display === 'none' ? 'block' : 'none';
}

async function createInventoryItem() {
  const payload = {
    itemNo: document.getElementById('niItemNo').value.trim(),
    description: document.getElementById('niDesc').value.trim(),
    balance: document.getElementById('niBal').value || 0,
    purchasePrice: document.getElementById('niPP').value || 0,
    shippingCost: document.getElementById('niSC').value || 0,
    currency: 'PHP'
  };
  if (!payload.itemNo || !payload.description) { flowMsg('niMsg', 'Item No and Description required.', false); return; }
  try {
    const res = await postFlow('addInventoryItem', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('niMsg', 'Added to inventory.', true);
    await loadInventory();
    document.querySelectorAll('#itemRows select').forEach(sel => {
      const cur = sel.value; sel.innerHTML = itemOptions(cur);
    });
    document.getElementById('niItemNo').value = '';
    document.getElementById('niDesc').value = '';
  } catch (e) { flowMsg('niMsg', e.message, false); }
}

// The quotation number is the company's OWN code and the subject shows on the PDF —
// both must be typed on every create (no auto-numbering, no auto-subject).
function qRequireManualFields() {
  const noEl = document.getElementById('quotationNoInput');
  const typedNo = (noEl.value || '').trim();
  if (!typedNo) {
    flowMsg('formMsg', 'Quotation No is required — type your own quotation code.', false);
    noEl.focus();
    return null;
  }
  const subEl = document.getElementById('subjectInput');
  const subject = ((subEl && subEl.value) || '').trim();
  if (!subject) {
    flowMsg('formMsg', 'Subject is required — type the quotation subject.', false);
    if (subEl) subEl.focus();
    return null;
  }
  return { typedNo, subject };
}

// Read a discount-% input, clamped to 0–100 (blank/invalid → 0).
function qDiscountVal(id) {
  const el = document.getElementById(id);
  const n = flowNum(el && el.value);
  return Math.max(0, Math.min(100, n || 0));
}

async function saveQuotation() {
  // Loaded from a returned PR: create via createQuotationFromPR so the management final prices are
  // applied and the PR flips to Quoted; then open the new quotation's review.
  if (qFromPr && !document.getElementById('quotationNo').value) {
    const manual = qRequireManualFields();
    if (!manual) return;
    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
      const res = await postFlow('createQuotationFromPR',
        { prNo: qFromPr, quotationNo: manual.typedNo, subject: manual.subject, discountPct: qDiscountVal('discountInput') });
      if (!res.success) throw new Error(res.message);
      window.location.href = 'flow-quotations.html?review=' + encodeURIComponent(res.quotationNo || '');
      return;
    } catch (e) {
      flowMsg('formMsg', e.message, false);
      btn.disabled = false; btn.textContent = 'Save Quotation';
      return;
    }
  }
  const items = collectItems();
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Add at least one item.', false); return; }
  const btn = document.getElementById('saveBtn');
  const editingNo = document.getElementById('quotationNo').value;      // hidden edit-key
  const manual = qRequireManualFields();                               // required on create AND edit
  if (!manual) return;
  const customNo = manual.typedNo;
  if (!editingNo) {
    // Duplicate check against the FULL list — sales' own qList holds only their quotations.
    try {
      const all = await fetchFlow('getQuotations', {});
      const clash = ((all && all.data) || [])
        .some(q => String(q.quotationNo).toLowerCase() === customNo.toLowerCase());
      if (clash) {
        flowMsg('formMsg', `Quotation No "${customNo}" already exists — open it with Edit instead.`, false);
        document.getElementById('quotationNoInput').focus();
        return;
      }
    } catch (e) { /* offline check is best-effort; the server rejects duplicates too */ }
  }
  const payload = {
    quotationNo: editingNo || customNo,                                // the typed code on create
    customer, date: document.getElementById('date').value,
    subject: manual.subject,
    discountPct: qDiscountVal('discountInput'),                        // % off the total, before VAT
    createdBy: qSession.name, items: JSON.stringify(items)
  };
  if (!editingNo) payload.clientRef = flowClientRef();                 // idempotent create (safe retry)
  // Editing with a changed number → RENAME the record (whole string editable).
  if (editingNo && customNo && customNo !== editingNo) payload.newQuotationNo = customNo;
  // Admin creating a new quotation: save as an editable Draft (bypasses PR/management pricing).
  if (qAdmin && !editingNo) payload.status = 'Draft';
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await postFlow(editingNo ? 'updateQuotation' : 'createQuotation', payload);
    if (!res.success) throw new Error(res.message);
    let extra = '';
    // Admin: auto-add any brand-new items to inventory (balance 0). Ignore "already exists".
    if (qAdmin && !editingNo) {
      let added = 0;
      for (const it of items) {
        const exists = qInventory.some(i => String(i.itemNo).toLowerCase() === String(it.itemNo).toLowerCase());
        if (exists) continue;
        try {
          const inv = await postFlow('addInventoryItem', {
            itemNo: it.itemNo, description: it.itemName || it.itemNo, balance: 0, currency: 'PHP'
          });
          if (inv.success) added++;
        } catch (e) { /* best-effort */ }
      }
      if (added) { extra = ` · ${added} new item(s) added to inventory`; await loadInventory(); }
    }
    flowMsg('formMsg', `${res.message} (${res.quotationNo || payload.quotationNo})${extra}`, true);
    resetForm();
    await loadQuotations();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Quotation'; }
}

function resetForm() {
  document.getElementById('quotationNo').value = '';
  const qni = document.getElementById('quotationNoInput'); if (qni) { qni.value = ''; qni.disabled = false; }
  const subj = document.getElementById('subjectInput'); if (subj) subj.value = '';
  const disc = document.getElementById('discountInput'); if (disc) disc.value = '';
  document.getElementById('customer').value = '';
  document.getElementById('date').value = flowToday();
  document.getElementById('itemRows').innerHTML = '';
  document.getElementById('formTitle').textContent = 'New Quotation';
  document.getElementById('formMsg').style.display = 'none';
  // clear any Returned-to-Sales PR load
  qFromPr = '';
  const b = document.getElementById('fromPrBanner'); if (b) b.style.display = 'none';
  const s = document.getElementById('fromPrSelect'); if (s) s.value = '';
  addRow();
}

async function loadQuotations() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    // Sales see only their own; oversight roles (admin/accounting/management/director) see all.
    const params = qIsOversight ? {} : { createdBy: qSession.name };
    const res = await fetchFlow('getQuotations', params);
    qList = (res && res.data) || [];
    if (!qList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No quotations yet.</p>'; return; }
    c.innerHTML = qIsOversight ? renderGroupedByRep() : renderQuotationTable(qList);
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function quotationActions(q) {
  const no = flowEsc(q.quotationNo);
  const role = qSession.role, st = q.status || 'Draft';
  const isSales = role === 'sales', isAdmin = role === 'admin';
  const isCreator = String(q.createdBy) === String(qSession.name);
  const editable = st === 'Draft' || st === 'Rejected';
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.5rem;">${label}</button>`;
  // Everyone can Review (read-only details + PDF). Approvers get Approve/Reject inside the modal.
  let a = `<button class="link-btn" onclick='openReviewModal("${no}")'>Review</button>`
    + B(`openPdfModal("${no}")`, 'PDF') + B(`openDocsModal("Quotation","${no}")`, 'Docs');
  // Submit / re-submit while Draft or Rejected — the creator, admin, or accounting.
  if (editable && (isCreator || isAdmin || isSales || role === 'accounting'))
    a += B(`submitQuotationAction("${no}")`, st === 'Rejected' ? 'Re-submit' : 'Submit');
  if ((isSales || isAdmin) && editable) a += B(`editQuotation("${no}")`, 'Edit') + B(`deleteQuotation("${no}")`, 'Delete', 'del-btn');
  else if (isAdmin) a += B(`editQuotation("${no}")`, 'Edit');
  if (isSales && st === 'Approved') a += B(`sendQuotationAction("${no}")`, 'Send to Client');
  return a;
}

// Total shown even if the stored Total is 0/blank (self-heals from the line items on the client).
// Gross ex-VAT subtotal (Σ qty×price), preferring the stored total.
function qtnGross(q) {
  return flowNum(q.total) || (q.items || []).reduce((s, it) => s + flowNum(it.qty) * flowNum(it.price), 0);
}
// Net after the discount (before VAT) — what the client actually pays ex-VAT.
function qtnTotal(q) {
  const d = Math.max(0, Math.min(100, flowNum(q.discountPct) || 0));
  return qtnGross(q) * (1 - d / 100);
}

function quotationRow(q) {
  const st = q.status || 'Draft';
  const noteTip = (st === 'Rejected' && q.approvalNote) ? ` title="Reason: ${flowEsc(q.approvalNote)}"` : '';
  const noteLine = (st === 'Rejected' && q.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(q.approvalNote)}</div>` : '';
  return `<tr><td>${flowEsc(q.quotationNo)}</td><td>${flowDate(q.date)}</td><td>${flowEsc(q.customer)}</td>
    <td${noteTip}>${flowStatusBadge(st)}${noteLine}</td>
    <td class="num">${flowMoney(qtnTotal(q), 'PHP')}${flowNum(q.discountPct) > 0 ? `<div style="font-size:0.68rem;color:#0f766e;">−${flowNum(q.discountPct)}% disc</div>` : ''}</td><td>${q.items.length}</td>
    <td>${q.pdfLink ? `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn">View</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;">${quotationActions(q)}</td></tr>`;
}

// ─── Approval actions ─────────────────────────────
async function _qAction(action, no, extra) {
  try {
    const res = await postFlow(action, Object.assign({ quotationNo: no }, extra || {}));
    if (!res.success) throw new Error(res.message);
    await loadQuotations();
  } catch (e) { alert(e.message); }
}
function submitQuotationAction(no) {
  if (!confirm('Submit quotation ' + no + ' for approval?')) return;
  _qAction('submitQuotationApproval', no);
}
function approveQuotationAction(no) { _qAction('approveQuotation', no); }
function rejectQuotationAction(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  _qAction('rejectQuotation', no, { reason });
}
function sendQuotationAction(no) {
  if (!confirm('Mark quotation ' + no + ' as sent to the client?')) return;
  _qAction('sendQuotation', no);
}

// ─── Review modal (see details + PDF before approving) ─────────────
function openReviewModal(no) {
  const q = qList.find(x => String(x.quotationNo) === String(no));
  if (!q) return;
  const role = qSession.role, st = q.status || 'Draft';
  const isApprover = (role === 'admin' && st === 'Pending Admin') ||
    ((role === 'management' || role === 'director') && st === 'Pending Management');
  document.getElementById('qrTitle').textContent = q.quotationNo;
  document.getElementById('qrSub').innerHTML =
    `${flowEsc(q.customer)} · ${flowDate(q.date)} · ${flowStatusBadge(st)} · by ${flowEsc(q.createdBy || '—')}`;
  const items = q.items || [];
  const qDisc = Math.max(0, Math.min(100, flowNum(q.discountPct) || 0));
  const discRows = qDisc > 0
    ? `<tr><td colspan="3">Subtotal</td><td class="num">${flowMoney(qtnGross(q), 'PHP')}</td></tr>
       <tr style="color:#0f766e;"><td colspan="3">Less: Discount (${flowNum(q.discountPct)}%)</td><td class="num">− ${flowMoney(qtnGross(q) * qDisc / 100, 'PHP')}</td></tr>` : '';
  document.getElementById('qrItems').innerHTML = `<table class="flow-table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead><tbody>${items.map(it => `<tr><td>${flowEsc(it.itemNo)} ${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, 'PHP')}</td><td class="num">${flowMoney(flowNum(it.qty) * flowNum(it.price), 'PHP')}</td></tr>`).join('')}${discRows}<tr style="font-weight:700;background:var(--bg-inset,#f8fafc);"><td colspan="3">Total${qDisc > 0 ? ' (after discount, before VAT)' : ''}</td><td class="num">${flowMoney(qtnTotal(q), 'PHP')}</td></tr></tbody></table>`;
  const pv = document.getElementById('qrPdf');
  const fid = q.pdfLink ? ((q.pdfLink.match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1]) : null;
  if (fid) pv.innerHTML = `<iframe src="https://drive.google.com/file/d/${fid}/preview" style="width:100%;height:440px;border:1px solid var(--border,#e2e8f0);border-radius:8px;" allowfullscreen></iframe>`;
  else if (q.pdfLink) pv.innerHTML = `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn">Open PDF in Drive →</a>`;
  else pv.innerHTML = `<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">No PDF generated yet — review the details above, or <button class="link-btn" onclick="closeReviewModal();openPdfModal('${flowEsc(q.quotationNo)}')">generate the PDF</button> first.</div>`;
  const foot = document.getElementById('qrFoot');
  foot.innerHTML = `<button type="button" class="btn btn-secondary" onclick="closeReviewModal()">Close</button>` +
    (isApprover
      ? `<button type="button" class="btn btn-secondary" style="color:#dc2626;border-color:#fca5a5;" onclick="qrReject('${flowEsc(q.quotationNo)}')">Reject</button>
         <button type="button" class="btn btn-primary" onclick="qrApprove('${flowEsc(q.quotationNo)}')">Approve</button>`
      : `<span style="font-size:0.78rem;color:var(--text-muted,#64748b);margin-left:auto;">${st.indexOf('Pending') === 0 ? 'Awaiting ' + st.replace('Pending ', '') + ' approval' : ''}</span>`);
  document.getElementById('qrModal').classList.add('open');
}
function closeReviewModal() { document.getElementById('qrModal').classList.remove('open'); }
function qrApprove(no) { closeReviewModal(); _qAction('approveQuotation', no); }
function qrReject(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  closeReviewModal();
  _qAction('rejectQuotation', no, { reason });
}

function renderQuotationTable(rows) {
  return `<table class="flow-table"><thead><tr><th>Quotation No</th><th>Date</th><th>Customer</th><th>Status</th><th class="num">Total</th><th>Items</th><th>PDF</th><th></th></tr></thead><tbody>${rows.map(quotationRow).join('')}</tbody></table>`;
}

// Oversight: group all reps' quotations into collapsible sections (one per Created By).
function renderGroupedByRep() {
  const groups = {};
  qList.forEach(q => { const k = q.createdBy || 'Unassigned'; (groups[k] = groups[k] || []).push(q); });
  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  return names.map((name, i) => {
    const rows = groups[name];
    const total = rows.reduce((s, q) => s + qtnTotal(q), 0);
    return `<details class="rep-group"${i === 0 ? ' open' : ''}>
      <summary><span class="rep-name">${flowEsc(name)}</span>
        <span class="rep-meta">${rows.length} quotation(s) · ${flowMoney(total, 'PHP')}</span></summary>
      <div style="overflow-x:auto;margin-top:0.5rem;">${renderQuotationTable(rows)}</div>
    </details>`;
  }).join('');
}

function editQuotation(no) {
  const q = qList.find(x => x.quotationNo === no);
  if (!q) return;
  document.getElementById('quotationNo').value = q.quotationNo;
  // The whole quotation number is editable on edit — changing it RENAMES the record
  // (items, SO link, and attached docs follow; backend rejects duplicates).
  const qni = document.getElementById('quotationNoInput'); if (qni) { qni.value = q.quotationNo; qni.disabled = false; }
  document.getElementById('customer').value = q.customer;
  const subj = document.getElementById('subjectInput'); if (subj) subj.value = q.subject || '';
  const disc = document.getElementById('discountInput'); if (disc) disc.value = flowNum(q.discountPct) || '';
  document.getElementById('date').value = flowDate(q.date);
  document.getElementById('formTitle').textContent = 'Edit ' + q.quotationNo;
  document.getElementById('itemRows').innerHTML = '';
  (q.items || []).forEach(addRow);
  if (!q.items || !q.items.length) addRow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteQuotation(no) {
  if (!confirm('Delete quotation ' + no + '?')) return;
  try {
    const res = await postFlow('deleteQuotation', { quotationNo: no });
    if (!res.success) throw new Error(res.message);
    await loadQuotations();
  } catch (e) { alert(e.message); }
}

// ─── PDF generation ───────────────────────────────
let pdfQuote = null;            // the quotation being printed
const pdfImages = {};           // row INDEX → data URL (itemNo keying collided on duplicate/N-A numbers)

function openPdfModal(no) {
  const q = qList.find(x => x.quotationNo === no);
  if (!q) return;
  pdfQuote = q;
  Object.keys(pdfImages).forEach(k => delete pdfImages[k]);
  document.getElementById('pdfQuotationNo').value = q.quotationNo;
  document.getElementById('pdfModalSub').textContent = `${q.quotationNo} · ${q.customer} · ${q.items.length} item(s)`;
  // Prefill from the subject typed at creation (stored on the record); still editable + required.
  document.getElementById('pdfSubject').value = q.subject || '';
  // Discount % prefilled from the record (editable — lets a rejected quote be re-priced at regen time).
  const pd = document.getElementById('pdfDiscount'); if (pd) pd.value = flowNum(q.discountPct) || '';
  // restore remembered defaults (terms, signatory)
  const d = flowLoadDefaults('quotation');
  ['Address', 'Attention', 'Designation', 'Email', 'Validity', 'Delivery', 'Payment', 'Warranty',
   'SigName', 'SigDesignation', 'SigViber', 'SigMobile', 'SigEmail'].forEach(f => {
    const el = document.getElementById('pdf' + f);
    if (el && d[f] !== undefined && d[f] !== '') el.value = d[f];
  });
  // item image pickers
  document.getElementById('pdfItems').innerHTML = (q.items || []).map((it, i) => `
    <div class="pdf-item-row">
      <span class="grow">${flowEsc(it.itemNo)} — ${flowEsc(it.itemName)} · ${flowNum(it.qty)} × ${flowMoney(it.price, 'PHP')}</span>
      <span class="img-state" id="pdfImgState${i}" style="font-size:0.72rem;white-space:nowrap;"></span>
      <input type="file" accept="image/png,image/jpeg,image/webp" onchange="pickPdfImage(this, ${i})">
    </div>`).join('');
  const br = document.getElementById('pdfBrochures'); if (br) br.value = '';
  document.getElementById('pdfModalMsg').style.display = 'none';
  document.getElementById('pdfModal').classList.add('open');
}

function closePdfModal() { document.getElementById('pdfModal').classList.remove('open'); }

async function pickPdfImage(input, idx) {
  const file = input.files && input.files[0];
  const tag = document.getElementById('pdfImgState' + idx);
  if (!file) { delete pdfImages[idx]; if (tag) tag.textContent = ''; return; }
  if (file.size > 25 * 1024 * 1024) {
    delete pdfImages[idx]; input.value = '';
    flowMsg('pdfModalMsg', 'Image too large (max 25MB): ' + file.name, false);
    if (tag) { tag.textContent = '✗ too large'; tag.style.color = '#dc2626'; }
    return;
  }
  try {
    // Downscale in the browser (the PDF thumbnail is tiny) — phone photos of any size now work,
    // and the old silent 5MB rejection that left PDFs without their attached images is gone.
    pdfImages[idx] = await _downscaleImage(file, 900, 0.85);
    if (tag) { tag.textContent = '✓ image attached'; tag.style.color = '#15803d'; }
  } catch (e) {
    delete pdfImages[idx]; input.value = '';
    flowMsg('pdfModalMsg', 'Could not read image "' + file.name + '" — ' + (e.message || 'unsupported format (use JPG/PNG)'), false);
    if (tag) { tag.textContent = '✗ failed'; tag.style.color = '#dc2626'; }
  }
}

// Resize any picked image to ≤maxDim px and re-encode as JPEG (canvas). Rejects on undecodable files.
function _downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // flatten PNG transparency onto white
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported or corrupted image')); };
    img.src = url;
  });
}

async function submitPdf() {
  if (!pdfQuote) return;
  const btn = document.getElementById('pdfGenBtn');
  const g = id => document.getElementById('pdf' + id).value.trim();
  if (!g('Subject')) {
    flowMsg('pdfModalMsg', 'Subject is required — type the quotation subject before generating.', false);
    document.getElementById('pdfSubject').focus();
    return;
  }
  const doc = {
    address: g('Address'), attention: g('Attention'), designation: g('Designation'), email: g('Email'),
    subject: g('Subject'), rfqNo: g('RfqNo'), note: g('Note'),
    validity: g('Validity'), delivery: g('Delivery'), payment: g('Payment'), warranty: g('Warranty'),
    sigName: g('SigName'), sigDesignation: g('SigDesignation'), sigViber: g('SigViber'),
    sigMobile: g('SigMobile'), sigEmail: g('SigEmail'), descMode: document.getElementById('pdfDescMode').value
  };
  flowSaveDefaults('quotation', {
    Address: doc.address, Attention: doc.attention, Designation: doc.designation, Email: doc.email,
    Validity: doc.validity, Delivery: doc.delivery, Payment: doc.payment, Warranty: doc.warranty,
    SigName: doc.sigName, SigDesignation: doc.sigDesignation, SigViber: doc.sigViber,
    SigMobile: doc.sigMobile, SigEmail: doc.sigEmail
  });
  // The number SHOWN on the PDF (title chip + filename) is editable in the dialog; the Drive-link
  // row write below stays keyed on the real record number so the quotation row still gets its link.
  const displayNo = (document.getElementById('pdfQuotationNo').value || '').trim() || pdfQuote.quotationNo;
  // optional PDF attachments → appended by the server after the quotation's last page
  const brFiles = Array.from((document.getElementById('pdfBrochures') || {}).files || []);
  let brochures = [];
  try { brochures = await Promise.all(brFiles.map(fileToDataURL)); }
  catch (e) { flowMsg('pdfModalMsg', 'Could not read an attached PDF — ' + e.message, false); return; }
  const payload = {
    quotationNo: displayNo, customer: pdfQuote.customer, date: flowDate(pdfQuote.date),
    vatOption: document.getElementById('pdfVat').value, discountPct: qDiscountVal('pdfDiscount'),
    descMode: doc.descMode, doc, brochures,
    items: (pdfQuote.items || []).map((it, i) => {
      // Match on itemNo AND name so N/A-numbered items don't grab another N/A row's description.
      const inv = qInventory.find(x => String(x.itemNo) === String(it.itemNo) && String(x.description) === String(it.itemName));
      return {
        itemNo: it.itemNo, itemName: it.itemName, qty: it.qty, price: it.price,
        origItemNo: it.origItemNo || '', origItemName: it.origItemName || '',  // requested vs offered
        description: (inv && inv.description) || it.itemName || '',  // multi-line desc from inventory
        imageDataUrl: pdfImages[i] || ''
      };
    })
  };
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const { link } = await generateFlowPdf('/flow/quotation-pdf', payload, 'saveQuotationPDF',
      'quotationNo', pdfQuote.quotationNo, `Quotation_${displayNo}.pdf`);
    flowMsg('pdfModalMsg', link ? 'PDF generated and saved to Drive.' : 'PDF generated (Drive save skipped — backend not configured).', true);
    await loadQuotations();
    if (link) setTimeout(closePdfModal, 900);
  } catch (e) {
    flowMsg('pdfModalMsg', e.message, false);
  } finally { btn.disabled = false; btn.textContent = 'Generate & Save'; }
}
