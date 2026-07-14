/* flow-sales-orders.js — sales orders that load from a quotation */
let soQuotations = [];
let soList = [];
let soCds = {};        // soNo → SOCostDetails record (for the COGS column + Costs editor prefill)
let soSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  soSession = requireAccountingOrAdmin();
  if (!soSession) return;
  renderNavbar('flow-sales-orders');
  renderFlowNav('flow-sales-orders.html');
  document.getElementById('date').value = flowToday();
  await loadQuotationOptions();
  addRow();
  await loadSOs();
});

async function loadQuotationOptions() {
  try {
    const r = await fetchFlow('getQuotations');
    soQuotations = (r && r.data) || [];
  } catch (e) { soQuotations = []; }
  document.getElementById('loadQuotation').innerHTML =
    '<option value="">— select a quotation —</option>' + soQuotations.map(q =>
      `<option value="${flowEsc(q.quotationNo)}">${flowEsc(q.quotationNo)} — ${flowEsc(q.customer)} (${flowMoney(q.total, 'PHP')})</option>`).join('');
}

function loadFromQuotation() {
  const no = document.getElementById('loadQuotation').value;
  const q = soQuotations.find(x => x.quotationNo === no);
  if (!q) return;
  document.getElementById('quotationNo').value = q.quotationNo;
  document.getElementById('customer').value = q.customer;
  document.getElementById('itemRows').innerHTML = '';
  (q.items || []).forEach(it => addRow({ itemNo: it.itemNo, itemName: it.itemName, qty: it.qty, price: it.price }));
  if (!q.items || !q.items.length) addRow();
  recalc();
}

function addRow(item) {
  const tb = document.getElementById('itemRows');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="itemNo" value="${item ? flowEsc(item.itemNo) : ''}" placeholder="Item No" style="width:38%;display:inline-block;">
        <input type="text" class="itemName" value="${item ? flowEsc(item.itemName) : ''}" placeholder="Description" style="width:60%;display:inline-block;"></td>
    <td class="num"><input type="number" step="any" min="0" class="qty" value="${item ? flowNum(item.qty) : 0}" oninput="recalc()"></td>
    <td class="num"><input type="number" step="any" min="0" class="price" value="${item ? flowNum(item.price) : 0}" oninput="recalc()"></td>
    <td class="num lineTotal">0.00</td>
    <td><button type="button" class="link-btn del-btn" onclick="this.closest('tr').remove();recalc();">✕</button></td>`;
  tb.appendChild(tr);
  recalc();
}

function recalc() {
  let total = 0;
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const qty = flowNum(tr.querySelector('.qty').value);
    const price = flowNum(tr.querySelector('.price').value);
    const lt = qty * price;
    tr.querySelector('.lineTotal').textContent = lt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    total += lt;
  });
  document.getElementById('grandTotal').textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

async function saveSO() {
  const items = collectItems();
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Add at least one item.', false); return; }
  const btn = document.getElementById('saveBtn');
  let soNo = document.getElementById('soNo').value;
  // Creating: the SO No must be typed manually (it is the client's PO number) and be unique.
  if (!soNo) {
    const typed = (document.getElementById('soNoInput').value || '').trim();
    if (!typed) {
      flowMsg('formMsg', 'SO No is required — type the client\'s PO number.', false);
      document.getElementById('soNoInput').focus();
      return;
    }
    if (soList.some(x => String(x.soNo).toLowerCase() === typed.toLowerCase())) {
      flowMsg('formMsg', 'SO No "' + typed + '" already exists — open it with Edit instead.', false);
      document.getElementById('soNoInput').focus();
      return;
    }
    soNo = '';   // stays empty so the create/update branch below is unchanged
    var soNoTyped = typed;
  }
  const payload = {
    soNo: soNo || soNoTyped, quotationNo: document.getElementById('quotationNo').value, customer,
    date: document.getElementById('date').value, status: document.getElementById('status').value,
    supplierType: document.getElementById('soSupplierType').value,
    createdBy: soSession.name, items: JSON.stringify(items)
  };
  if (!soNo) payload.clientRef = flowClientRef();          // idempotent create (safe retry)
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await postFlow(soNo ? 'updateSalesOrder' : 'createSalesOrder', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.soNo || soNo})`, true);
    resetForm();
    await loadSOs();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Sales Order'; }
}

function resetForm() {
  document.getElementById('soNo').value = '';
  const ni = document.getElementById('soNoInput');
  if (ni) { ni.value = ''; ni.disabled = false; }
  document.getElementById('quotationNo').value = '';
  document.getElementById('loadQuotation').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('status').value = 'Open';
  const st = document.getElementById('soSupplierType'); if (st) st.value = '';
  document.getElementById('date').value = flowToday();
  document.getElementById('itemRows').innerHTML = '';
  document.getElementById('formTitle').textContent = 'New Sales Order';
  document.getElementById('formMsg').style.display = 'none';
  addRow();
}

async function loadSOs() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const [res, cdRes] = await Promise.all([
      fetchFlow('getSalesOrders'),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
    ]);
    soList = (res && res.data) || [];
    soCds = {};
    ((cdRes && cdRes.data) || []).forEach(cd => { soCds[String(cd.soNo)] = cd; });
    // Most recent sales order first (by date, then SO number).
    soList.sort((a, b) =>
      (flowDate(b.date) || '').localeCompare(flowDate(a.date) || '') ||
      String(b.soNo).localeCompare(String(a.soNo)));
    buildSOFilters();
    renderSOs();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function buildSOFilters() {
  // Year options from SO dates (newest first) + All years.
  const years = new Set();
  soList.forEach(s => { const y = (flowDate(s.date) || '').slice(0, 4); if (y) years.add(y); });
  const ySel = document.getElementById('soYear');
  if (ySel && !ySel.dataset.bound) {
    ['soSearch', 'soYear', 'soMonth', 'soCustomer'].forEach(id => {
      const el = document.getElementById(id); if (el) el.addEventListener('input', renderSOs);
    });
    ySel.dataset.bound = '1';
  }
  if (ySel) {
    const cur = ySel.value;
    ySel.innerHTML = '<option value="">All years</option>' +
      Array.from(years).sort((a, b) => b.localeCompare(a)).map(y => `<option value="${y}">${y}</option>`).join('');
    ySel.value = cur;
  }
  // Customer options.
  const custs = Array.from(new Set(soList.map(s => s.customer).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  const cSel = document.getElementById('soCustomer');
  if (cSel) {
    const cur = cSel.value;
    cSel.innerHTML = '<option value="">All customers</option>' +
      custs.map(c => `<option value="${flowEsc(c)}">${flowEsc(c)}</option>`).join('');
    cSel.value = cur;
  }
}

// International / Local supplier label badge (blank → em dash).
function soTypeBadge(t) {
  const v = String(t || '');
  if (v === 'International') return '<span class="flow-badge" style="background:rgba(37,99,235,0.12);color:#1d4ed8;">International</span>';
  if (v === 'Local') return '<span class="flow-badge" style="background:rgba(100,116,139,0.14);color:#475569;">Local</span>';
  return '<span style="color:var(--text-muted,#64748b);">—</span>';
}

function renderSOs() {
  const c = document.getElementById('listContainer');
  const q = (document.getElementById('soSearch').value || '').trim().toLowerCase();
  const y = document.getElementById('soYear').value;
  const m = document.getElementById('soMonth').value;
  const cust = document.getElementById('soCustomer').value;
  const rows = soList.filter(s => {
    const d = flowDate(s.date) || '';
    if (y && d.slice(0, 4) !== y) return false;
    if (m && d.slice(5, 7) !== m) return false;
    if (cust && String(s.customer) !== cust) return false;
    if (q && !((s.soNo + ' ' + (s.quotationNo || '') + ' ' + (s.customer || '')).toLowerCase().includes(q))) return false;
    return true;
  });
  const meta = document.getElementById('soFilterMeta');
  if (meta) meta.textContent = `${rows.length} of ${soList.length} sales order${soList.length === 1 ? '' : 's'}`;
  if (!soList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No sales orders yet.</p>'; return; }
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No sales orders match the filters.</p>'; return; }
  c.innerHTML = `<table class="flow-table"><thead><tr><th>SO No</th><th>Quotation</th><th>Date</th><th>Customer</th><th>Status</th><th>Supplier</th><th class="num">Total</th><th class="num">COGS</th><th>Items</th><th></th></tr></thead><tbody>${rows.map(s => `
    <tr><td>${flowEsc(s.soNo)}</td><td>${flowEsc(s.quotationNo)}</td><td>${flowDate(s.date)}</td><td>${flowEsc(s.customer)}</td>
    <td><span class="flow-badge b-open">${flowEsc(s.status)}</span></td><td>${soTypeBadge(s.supplierType)}</td><td class="num">${flowMoney(s.total, 'PHP')}</td><td class="num">${soCogsCell(s)}</td><td>${s.items.length}</td>
    <td style="white-space:nowrap;"><button class="link-btn" onclick='soEditCost("${flowEsc(s.soNo)}")'>Costs</button>
    <button class="link-btn" onclick='openDocsModal("Sales Order","${flowEsc(s.soNo)}")' style="margin-left:0.5rem;">Docs</button>
    <button class="link-btn" onclick='editSO("${flowEsc(s.soNo)}")' style="margin-left:0.5rem;">Edit</button>
    <button class="link-btn del-btn" onclick='deleteSO("${flowEsc(s.soNo)}")' style="margin-left:0.5rem;">Delete</button></td></tr>`).join('')}</tbody></table>`;
}

function editSO(no) {
  // String-compare: migrated SOs have numeric SO numbers (stored as numbers by Sheets),
  // while `no` arrives as a string from the inline onclick — strict === would miss them.
  const s = soList.find(x => String(x.soNo) === String(no));
  if (!s) return;
  document.getElementById('soNo').value = s.soNo;
  const ni = document.getElementById('soNoInput');
  if (ni) { ni.value = s.soNo; ni.disabled = true; }   // the SO number is the record key — not renameable here
  document.getElementById('quotationNo').value = s.quotationNo || '';
  document.getElementById('customer').value = s.customer;
  document.getElementById('date').value = flowDate(s.date);
  document.getElementById('status').value = s.status || 'Open';
  document.getElementById('soSupplierType').value = s.supplierType || '';
  document.getElementById('formTitle').textContent = 'Edit ' + s.soNo;
  document.getElementById('itemRows').innerHTML = '';
  (s.items || []).forEach(addRow);
  if (!s.items || !s.items.length) addRow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSO(no) {
  if (!confirm('Delete sales order ' + no + '?')) return;
  try {
    const res = await postFlow('deleteSalesOrder', { soNo: no });
    if (!res.success) throw new Error(res.message);
    await loadSOs();
  } catch (e) { alert(e.message); }
}


// ─── Cost breakdown (COGS column + inline editor) ─────────────────────────────
// COGS cell: the recorded Total COGS, or an amber "no cost" badge (same gap the audits flag).
function soCogsCell(s) {
  const cd = soCds[String(s.soNo)];
  if (!cd) return '<span class="flow-badge" style="background:rgba(245,158,11,0.14);color:#b45309;">no cost</span>';
  const gp = flowNum(cd.sales) - flowNum(cd.totalCOGS);
  return `<span title="Gross profit ₱${gp.toLocaleString('en-US', { minimumFractionDigits: 2 })}">${flowMoney(cd.totalCOGS, 'PHP')}</span>`;
}

// Open the shared cost editor (so-cost-editor.js) for any SO — historical or new.
// Prefills from the existing cost record; otherwise a blank record seeded from the SO
// (sales = SO total, type from the Supplier label). Saving upserts SOCostDetails,
// recomputes COGS, regenerates the SO's migrated invoice/receiving and re-syncs the label.
function soEditCost(no) {
  if (typeof openSoCostEditor !== 'function') { alert('Cost editor not loaded.'); return; }
  const s = soList.find(x => String(x.soNo) === String(no));
  if (!s) return;
  const cd = soCds[String(no)];
  const prefill = cd ? {
    soNo: String(s.soNo), customer: s.customer, date: flowDate(s.date), sales: cd.sales,
    cogsType: cd.cogsType || 'local', shippingCompany: cd.shippingCompany || '',
    purchaseOfGoods: cd.purchaseOfGoods, bankChargeCOGS: cd.bankChargeCOGS,
    dutiesAndTaxes: cd.dutiesAndTaxes, bankChargeShipping: cd.bankChargeShipping,
    shippingCost: cd.shippingCost, localCharges: cd.localCharges,
    deliveryToOffice: cd.deliveryToOffice, deliveryToClient: cd.deliveryToClient,
  } : {
    soNo: String(s.soNo), customer: s.customer, date: flowDate(s.date), sales: flowNum(s.total),
    cogsType: s.supplierType === 'International' ? 'international' : 'local', shippingCompany: '',
    purchaseOfGoods: 0, bankChargeCOGS: 0, dutiesAndTaxes: 0, bankChargeShipping: 0,
    shippingCost: 0, localCharges: 0, deliveryToOffice: 0, deliveryToClient: 0,
  };
  openSoCostEditor(prefill, () => loadSOs());
}
