/* flow-inventory.js — costed inventory CRUD */
let invData = [];
let invSession = null;
let invCanDelete = false;   // only admin/accounting may remove items; sales can add/edit only
let invOrderedSet = new Set();   // Item Nos that appear in any Purchase Order (= "ordered already")

document.addEventListener('DOMContentLoaded', async () => {
  invSession = requireInventoryAccess();
  if (!invSession) return;
  invCanDelete = invSession.role === 'admin' || invSession.role === 'accounting';
  renderNavbar('flow-inventory');
  // Sales can't open the rest of the flow — only show the flow sub-nav to admin/accounting.
  if (invCanDelete) renderFlowNav('flow-inventory.html');
  if (invSession.role === 'sales') {
    const note = document.getElementById('salesNote');
    if (note) note.style.display = '';
  }
  document.getElementById('currency').innerHTML = FLOW_CURRENCIES.map(c => `<option>${c}</option>`).join('');
  await loadInventory();
});

async function loadInventory() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    // Inventory + Purchase Orders in parallel; an item is "ordered already" when its Item No is on any PO.
    const [inv, po] = await Promise.all([
      fetchFlow('getInventory'),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] }))
    ]);
    invData = (inv && inv.data) || [];
    invOrderedSet = new Set();
    ((po && po.data) || []).forEach(p => (p.items || []).forEach(it => {
      if (it && it.itemNo != null && String(it.itemNo).trim() !== '') invOrderedSet.add(String(it.itemNo).toLowerCase());
    }));
    render();
  } catch (e) {
    c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

function invIsOrdered(r) { return invOrderedSet.has(String(r.itemNo).toLowerCase()); }

function render() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const rows = invData.filter(r => !q || String(r.itemNo).toLowerCase().includes(q) || String(r.description).toLowerCase().includes(q));
  const c = document.getElementById('container');
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No items.</p>'; return; }
  // Sales see a simple identifier list (no sensitive cost columns); admin/accounting see the full costed table.
  const invSlim = invSession.role === 'sales';
  const head = invSlim
    ? `<th>Item No</th><th>Description</th><th></th>`
    : `<th>Item No</th><th>Description</th><th class="num">Balance</th><th class="num">Purchase/Unit</th>
       <th class="num">Shipping/Unit</th><th class="num">Landed/Unit</th><th class="num">Total Landed</th><th>Cur</th><th></th>`;
  // Two groups: not-ordered first (actionable), then ordered (already has a purchase order).
  const notOrdered = rows.filter(r => !invIsOrdered(r));
  const ordered = rows.filter(invIsOrdered);
  const group = (label, list) => `
    <div style="font-size:0.9rem;font-weight:700;margin:0 0 0.5rem;display:flex;align-items:center;gap:0.5rem;">
      ${label}
      <span style="font-weight:600;font-size:0.72rem;padding:0.1rem 0.5rem;border-radius:999px;background:var(--bg-inset,#eef2f6);color:var(--text-secondary,#475569);">${list.length}</span>
    </div>
    ${list.length
      ? `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr>${head}</tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>`
      : '<p style="color:var(--text-muted,#64748b);font-size:0.85rem;margin:0 0 0.5rem;">None.</p>'}`;
  c.innerHTML =
    group('🟠 Not yet ordered', notOrdered) +
    `<div style="height:1.1rem;"></div>` +
    group('✅ Ordered · has a purchase order', ordered);
}

function rowHtml(r) {
  const actions = `<td style="white-space:nowrap;">
      <button class="link-btn" onclick='editItem(${r.rowIndex})'>Edit</button>
      ${invCanDelete ? `<button class="link-btn del-btn" onclick='deleteItem(${r.rowIndex})' style="margin-left:0.5rem;">Delete</button>` : ''}
    </td>`;
  if (invSession.role === 'sales') {
    return `<tr><td>${flowEsc(r.itemNo)}</td><td>${flowEsc(r.description)}</td>${actions}</tr>`;
  }
  return `<tr>
    <td>${flowEsc(r.itemNo)}</td><td>${flowEsc(r.description)}</td>
    <td class="num">${flowNum(r.balance).toLocaleString()}</td>
    <td class="num">${flowMoney(r.purchasePrice, r.currency)}</td>
    <td class="num">${flowMoney(r.shippingCost, r.currency)}</td>
    <td class="num">${flowMoney(r.landedCost, r.currency)}</td>
    <td class="num">${flowMoney(r.totalLanded, r.currency)}</td>
    <td>${flowEsc(r.currency)}</td>
    <td style="white-space:nowrap;">
      <button class="link-btn" onclick='editItem(${r.rowIndex})'>Edit</button>
      ${invCanDelete ? `<button class="link-btn del-btn" onclick='deleteItem(${r.rowIndex})' style="margin-left:0.5rem;">Delete</button>` : ''}
    </td></tr>`;
}

function editItem(rowIndex) {
  const r = invData.find(x => x.rowIndex === rowIndex);
  if (!r) return;
  document.getElementById('rowIndex').value = r.rowIndex;
  document.getElementById('itemNo').value = r.itemNo;
  document.getElementById('description').value = r.description;
  document.getElementById('balance').value = r.balance;
  document.getElementById('purchasePrice').value = r.purchasePrice;
  document.getElementById('shippingCost').value = r.shippingCost;
  document.getElementById('currency').value = r.currency || 'PHP';
  document.getElementById('formTitle').textContent = 'Edit Item ' + r.itemNo;
  document.getElementById('submitBtn').textContent = 'Save Changes';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  document.getElementById('invForm').reset();
  document.getElementById('rowIndex').value = '';
  document.getElementById('formTitle').textContent = 'Add Item';
  document.getElementById('submitBtn').textContent = 'Add Item';
  document.getElementById('formMsg').style.display = 'none';
}

async function submitItem(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const rowIndex = document.getElementById('rowIndex').value;
  const payload = {
    rowIndex,
    itemNo: document.getElementById('itemNo').value.trim(),
    description: document.getElementById('description').value.trim(),
    balance: document.getElementById('balance').value || 0,
    purchasePrice: document.getElementById('purchasePrice').value || 0,
    shippingCost: document.getElementById('shippingCost').value || 0,
    currency: document.getElementById('currency').value
  };
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await postFlow(rowIndex ? 'updateInventoryItem' : 'addInventoryItem', payload);
    if (!res.success) throw new Error(res.message || 'Failed.');
    flowMsg('formMsg', res.message, true);
    resetForm();
    await loadInventory();
  } catch (err) {
    flowMsg('formMsg', err.message, false);
  } finally {
    btn.disabled = false;
  }
}

async function deleteItem(rowIndex) {
  if (!confirm('Delete this item?')) return;
  try {
    const res = await postFlow('deleteInventoryItem', { rowIndex });
    if (!res.success) throw new Error(res.message || 'Failed.');
    await loadInventory();
  } catch (err) { alert(err.message); }
}
