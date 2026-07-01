/* flow-purchase-orders.js — POs that load from a sales order; auto-create AP entry */
let poSOs = [];
let poInventory = [];
let poList = [];
let poSession = null;

let poCanCreate = false;   // admin/accounting create POs; management/director are approvers only

document.addEventListener('DOMContentLoaded', async () => {
  poSession = requireQuotationAccess();   // admin/accounting/management/director (+ sales bounced below)
  if (!poSession) return;
  if (poSession.role === 'sales') { window.location.href = 'dashboard.html'; return; }
  poCanCreate = poSession.role === 'admin' || poSession.role === 'accounting';
  renderNavbar('flow-purchase-orders');
  renderFlowNav('flow-purchase-orders.html');
  if (!poCanCreate) {
    // Management/director: approval-only view — hide the create form.
    const card = document.getElementById('formTitle');
    if (card && card.closest('.chart-card')) card.closest('.chart-card').style.display = 'none';
  } else {
    document.getElementById('date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('currency').innerHTML = FLOW_CURRENCIES.map(c => `<option>${c}</option>`).join('');
    document.getElementById('currency').addEventListener('change', recalc);
    await Promise.all([loadSOOptions(), loadInventory()]);
    addRow();
  }
  await loadPOs();
});

// Most recent sales order first (by date, then SO number).
function soNewestFirst(list) {
  return (list || []).slice().sort((a, b) =>
    (flowDate(b.date) || '').localeCompare(flowDate(a.date) || '') ||
    String(b.soNo).localeCompare(String(a.soNo)));
}

async function loadSOOptions() {
  try { const r = await fetchFlow('getSalesOrders'); poSOs = soNewestFirst((r && r.data) || []); }
  catch (e) { poSOs = []; }
  document.getElementById('loadSO').innerHTML = '<option value="">— none (Restock PO) —</option>' +
    poSOs.map(s => `<option value="${flowEsc(s.soNo)}">${flowEsc(s.soNo)} — ${flowEsc(s.customer)}</option>`).join('');
}

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); poInventory = (r && r.data) || []; }
  catch (e) { poInventory = []; }
  const dl = document.getElementById('poInvList');
  if (dl) dl.innerHTML = poInventory.map(i =>
    `<option value="${flowEsc(i.itemNo)}">${flowEsc(i.itemNo)} — ${flowEsc(i.description)}</option>`).join('');
}

function loadFromSO() {
  const no = document.getElementById('loadSO').value;
  const s = poSOs.find(x => String(x.soNo) === String(no));   // migrated SOs may have numeric ids
  if (!s) return;
  document.getElementById('soNo').value = s.soNo;
  document.getElementById('itemRows').innerHTML = '';
  (s.items || []).forEach(it => {
    // Carry the full Sales Order qty into the PO (editable — reduce manually if only ordering a shortfall).
    addRow({ itemNo: it.itemNo, itemName: it.itemName, qty: flowNum(it.qty), price: 0 });
  });
  if (!s.items || !s.items.length) addRow();
  recalc();
}

function addRow(item) {
  const tb = document.getElementById('itemRows');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="itemNo" list="poInvList" value="${item ? flowEsc(item.itemNo) : ''}" placeholder="Item No" style="width:38%;display:inline-block;" oninput="poFillItem(this)">
        <input type="text" class="itemName" value="${item ? flowEsc(item.itemName) : ''}" placeholder="Description" style="width:60%;display:inline-block;"></td>
    <td class="num"><input type="number" step="any" min="0" class="qty" value="${item ? flowNum(item.qty) : 0}" oninput="recalc()"></td>
    <td class="num"><input type="number" step="any" min="0" class="price" value="${item ? flowNum(item.price) : 0}" oninput="recalc()"></td>
    <td class="num lineTotal">0.00</td>
    <td class="num lineTotalPHP">0.00</td>
    <td><button type="button" class="link-btn del-btn" onclick="this.closest('tr').remove();recalc();">✕</button></td>`;
  tb.appendChild(tr);
  recalc();
}

// When an item-no matches an inventory item (e.g. picked from the datalist), auto-fill its
// description. Manual/new items are left as typed. (Stock is added later at Materials Receiving.)
function poFillItem(input) {
  const match = poInventory.find(x => String(x.itemNo) === input.value.trim());
  if (!match) return;
  const nameInput = input.closest('tr').querySelector('.itemName');
  if (nameInput && !nameInput.value.trim()) nameInput.value = match.description || '';
}

function poFxRate() {
  const cur = document.getElementById('currency').value;
  if (cur === 'PHP') return 1;
  const r = flowNum(document.getElementById('fxRate').value);
  return r > 0 ? r : 0;
}

function recalc() {
  const cur = document.getElementById('currency').value;
  const isFx = cur !== 'PHP';
  // Show the FX-rate field + PHP total only for foreign currencies.
  const fxWrap = document.getElementById('fxRateWrap');
  if (fxWrap) fxWrap.style.display = isFx ? '' : 'none';
  const phpWrap = document.getElementById('grandTotalPHPwrap');
  if (phpWrap) phpWrap.style.display = isFx ? '' : 'none';
  const rate = poFxRate();
  let total = 0, totalPHP = 0;
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const qty = flowNum(tr.querySelector('.qty').value);
    const price = flowNum(tr.querySelector('.price').value);
    const lt = qty * price;
    const ltPHP = lt * rate;
    tr.querySelector('.lineTotal').textContent = lt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const phpCell = tr.querySelector('.lineTotalPHP');
    if (phpCell) phpCell.textContent = isFx ? ltPHP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    total += lt; totalPHP += ltPHP;
  });
  document.getElementById('grandTotal').textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('curLabel').textContent = cur;
  const gpHP = document.getElementById('grandTotalPHP');
  if (gpHP) gpHP.textContent = totalPHP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** PHP estimate of the whole PO = Σ(qty×price) × rate (or FC total when currency is PHP). */
function poTotalPHP() {
  const rate = poFxRate();
  let total = 0;
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    total += flowNum(tr.querySelector('.qty').value) * flowNum(tr.querySelector('.price').value);
  });
  return total * rate;
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const itemNo = tr.querySelector('.itemNo').value.trim();
    if (!itemNo) return;
    items.push({
      itemNo, itemName: tr.querySelector('.itemName').value.trim(),
      qty: flowNum(tr.querySelector('.qty').value), price: flowNum(tr.querySelector('.price').value)
    });
  });
  return items;
}

async function savePO() {
  const items = collectItems();
  const supplier = document.getElementById('supplier').value.trim();
  if (!supplier) { flowMsg('formMsg', 'Supplier is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Add at least one item.', false); return; }
  const btn = document.getElementById('saveBtn');
  const poNo = document.getElementById('poNo').value;
  const payload = {
    poNo, soNo: document.getElementById('soNo').value, supplier,
    currency: document.getElementById('currency').value, date: document.getElementById('date').value,
    exchangeRate: poFxRate(), totalPHP: poTotalPHP(),
    createdBy: poSession.name, items: JSON.stringify(items)
  };
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await postFlow(poNo ? 'updatePurchaseOrder' : 'createPurchaseOrder', payload);
    if (!res.success) throw new Error(res.message);
    let msg = `${res.message} (${res.poNo || poNo})`;
    if (res.apNo) msg += ` · AP entry ${res.apNo} created`;
    flowMsg('formMsg', msg, true);
    resetForm();
    await loadPOs();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Purchase Order'; }
}

function resetForm() {
  document.getElementById('poNo').value = '';
  document.getElementById('soNo').value = '';
  document.getElementById('loadSO').value = '';
  document.getElementById('supplier').value = '';
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
  const fx = document.getElementById('fxRate'); if (fx) fx.value = '';
  document.getElementById('itemRows').innerHTML = '';
  document.getElementById('formTitle').textContent = 'New Purchase Order';
  document.getElementById('formMsg').style.display = 'none';
  addRow();
}

async function loadPOs() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getPurchaseOrders');
    poList = (res && res.data) || [];
    if (!poList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No purchase orders yet.</p>'; return; }
    c.innerHTML = `<table class="flow-table"><thead><tr><th>PO No</th><th>SO</th><th>Date</th><th>Supplier</th><th>Cur</th><th class="num">Total (FC)</th><th>Status</th><th>Items</th><th>PDF</th><th></th></tr></thead><tbody>${poList.map(p => {
      const st = p.status || 'Draft';
      const noteTip = (st === 'Rejected' && p.approvalNote) ? ` title="Reason: ${flowEsc(p.approvalNote)}"` : '';
      const noteLine = (st === 'Rejected' && p.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(p.approvalNote)}</div>` : '';
      const soCell = p.soNo ? flowEsc(p.soNo) : '<span class="flow-badge b-pending" title="Purchase order without a sales order — for restocking stock">Restock</span>';
      return `<tr><td>${flowEsc(p.poNo)}</td><td>${soCell}</td><td>${flowDate(p.date)}</td><td>${flowEsc(p.supplier)}</td>
      <td>${flowEsc(p.currency)}</td><td class="num">${flowMoney(p.total, p.currency)}</td>
      <td${noteTip}>${flowStatusBadge(st)}${noteLine}</td><td>${p.items.length}</td>
      <td>${p.pdfLink ? `<a href="${flowEsc(p.pdfLink)}" target="_blank" class="link-btn">View</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
      <td style="white-space:nowrap;">${poActions(p)}</td></tr>`;
    }).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function poActions(p) {
  const no = flowEsc(p.poNo);
  const role = poSession.role, st = p.status || 'Draft';
  const isMgmt = role === 'management' || role === 'director';
  const editable = st === 'Draft' || st === 'Rejected';
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.5rem;">${label}</button>`;
  let a = `<button class="link-btn" onclick='openPdfModal("${no}")'>PDF</button>` + B(`openDocsModal("Purchase Order","${no}")`, 'Docs');
  if (isMgmt && st === 'Pending Management') a += B(`approvePOAction("${no}")`, 'Approve') + B(`rejectPOAction("${no}")`, 'Reject', 'del-btn');
  if (poCanCreate && editable) a += B(`submitPOAction("${no}")`, 'Submit') + B(`editPO("${no}")`, 'Edit') + B(`deletePO("${no}")`, 'Delete', 'del-btn');
  else if (poCanCreate) a += B(`editPO("${no}")`, 'Edit');
  return a;
}

// ─── PO approval actions ─────────────────────────
async function _poAction(action, no, extra) {
  try {
    const res = await postFlow(action, Object.assign({ poNo: no }, extra || {}));
    if (!res.success) throw new Error(res.message);
    await loadPOs();
  } catch (e) { alert(e.message); }
}
function submitPOAction(no) {
  if (!confirm('Submit purchase order ' + no + ' for management approval?')) return;
  _poAction('submitPOApproval', no);
}
function approvePOAction(no) { _poAction('approvePO', no); }
function rejectPOAction(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  _poAction('rejectPO', no, { reason });
}

function editPO(no) {
  const p = poList.find(x => x.poNo === no);
  if (!p) return;
  document.getElementById('poNo').value = p.poNo;
  document.getElementById('soNo').value = p.soNo || '';
  document.getElementById('supplier').value = p.supplier;
  document.getElementById('currency').value = p.currency || 'PHP';
  document.getElementById('date').value = flowDate(p.date);
  document.getElementById('formTitle').textContent = 'Edit ' + p.poNo;
  document.getElementById('itemRows').innerHTML = '';
  (p.items || []).forEach(addRow);
  if (!p.items || !p.items.length) addRow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deletePO(no) {
  if (!confirm('Delete purchase order ' + no + ' and its AP entry?')) return;
  try {
    const res = await postFlow('deletePurchaseOrder', { poNo: no });
    if (!res.success) throw new Error(res.message);
    await loadPOs();
  } catch (e) { alert(e.message); }
}

// ─── PDF generation ───────────────────────────────
let pdfPO = null;

function openPdfModal(no) {
  const p = poList.find(x => x.poNo === no);
  if (!p) return;
  pdfPO = p;
  document.getElementById('pdfPoNo').value = p.poNo;
  document.getElementById('pdfModalSub').textContent = `${p.poNo} · ${p.supplier} · ${p.currency} · ${p.items.length} item(s)`;
  document.getElementById('pdfReferenceNo').value = p.soNo || '';
  document.getElementById('pdfBrochures').value = '';
  // restore remembered defaults (vendor boilerplate, invoice contact, payment terms)
  const d = flowLoadDefaults('po');
  ['VendorAddress', 'VendorContact', 'VendorEmail', 'VendorTin', 'PaymentTerms', 'DateNeeded',
   'InvoiceContact', 'InvoiceEmail'].forEach(f => {
    const el = document.getElementById('pdf' + f);
    if (el && d[f] !== undefined && d[f] !== '') el.value = d[f];
  });
  document.getElementById('pdfModalMsg').style.display = 'none';
  document.getElementById('pdfModal').classList.add('open');
}

function closePdfModal() { document.getElementById('pdfModal').classList.remove('open'); }

async function submitPdf() {
  if (!pdfPO) return;
  const btn = document.getElementById('pdfGenBtn');
  const g = id => document.getElementById('pdf' + id).value.trim();
  const doc = {
    vendorAddress: g('VendorAddress'), vendorContact: g('VendorContact'), vendorEmail: g('VendorEmail'),
    vendorTin: g('VendorTin'), paymentTerms: g('PaymentTerms'), dateNeeded: g('DateNeeded'),
    invoiceContact: g('InvoiceContact'), invoiceEmail: g('InvoiceEmail'), referenceNo: g('ReferenceNo'),
    descriptionType: document.getElementById('pdfDescriptionType').value
  };
  flowSaveDefaults('po', {
    VendorAddress: doc.vendorAddress, VendorContact: doc.vendorContact, VendorEmail: doc.vendorEmail,
    VendorTin: doc.vendorTin, PaymentTerms: doc.paymentTerms, DateNeeded: doc.dateNeeded,
    InvoiceContact: doc.invoiceContact, InvoiceEmail: doc.invoiceEmail
  });
  // optional brochures → base64
  const files = Array.from(document.getElementById('pdfBrochures').files || []);
  let brochures = [];
  try { brochures = await Promise.all(files.map(fileToDataURL)); } catch (e) {}
  const payload = {
    poNo: pdfPO.poNo, soNo: pdfPO.soNo, supplier: pdfPO.supplier, currency: pdfPO.currency,
    date: flowDate(pdfPO.date), doc, brochures,
    items: (pdfPO.items || []).map(it => ({ itemNo: it.itemNo, itemName: it.itemName, qty: it.qty, price: it.price }))
  };
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const { link } = await generateFlowPdf('/flow/po-pdf', payload, 'savePOPDF',
      'poNo', pdfPO.poNo, `Purchase_Order_${pdfPO.poNo}.pdf`);
    flowMsg('pdfModalMsg', link ? 'PDF generated and saved to Drive.' : 'PDF generated (Drive save skipped — backend not configured).', true);
    await loadPOs();
    if (link) setTimeout(closePdfModal, 900);
  } catch (e) {
    flowMsg('pdfModalMsg', e.message, false);
  } finally { btn.disabled = false; btn.textContent = 'Generate & Save'; }
}
