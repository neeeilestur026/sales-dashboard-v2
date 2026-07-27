/* flow-inventory.js — costed inventory CRUD */
let invData = [];
let invSession = null;
let invCanDelete = false;   // only admin/accounting may remove items; sales can add/edit only
let invReadOnly = false;    // management/director can view only (no add/edit/delete)
let invOrderedSet = new Set();   // Item Nos that appear in any Purchase Order (= "ordered already")

document.addEventListener('DOMContentLoaded', async () => {
  invSession = requireInventoryAccess();
  if (!invSession) return;
  invCanDelete = invSession.role === 'admin' || invSession.role === 'accounting';
  invReadOnly = invSession.role === 'management' || invSession.role === 'director';
  renderNavbar('flow-inventory');
  // Sales can't open the rest of the flow — only show the flow sub-nav to admin/accounting.
  if (invCanDelete) renderFlowNav('flow-inventory.html');
  if (invSession.role === 'sales') {
    const note = document.getElementById('salesNote');
    if (note) note.style.display = '';
  }
  // Management/director view read-only — hide the add/edit form entirely.
  if (invReadOnly) {
    const form = document.getElementById('invFormCard');
    if (form) form.style.display = 'none';
  }
  document.getElementById('currency').innerHTML = FLOW_CURRENCIES.map(c => `<option>${c}</option>`).join('');
  // Admin/accounting classify items (Stock vs Catalog); sales adds are always Catalog (quoting items).
  if (invCanDelete) document.getElementById('invTypeWrap').style.display = '';
  // A159: the duplicate report needs the v95 backend — hide the button until it's live.
  if (invCanDelete) {
    (typeof flowVersionAtLeast === 'function' ? flowVersionAtLeast(95) : Promise.resolve(false))
      .then(ok => { const b = document.getElementById('dupBtn'); if (b && ok) b.style.display = ''; })
      .catch(() => {});
  }
  await loadInventory(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
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
  const group = (label, list, sub) => `
    <div style="font-size:0.9rem;font-weight:700;margin:0 0 0.5rem;display:flex;align-items:center;gap:0.5rem;">
      ${label}
      <span style="font-weight:600;font-size:0.72rem;padding:0.1rem 0.5rem;border-radius:999px;background:var(--bg-inset,#eef2f6);color:var(--text-secondary,#475569);">${list.length}</span>
      ${sub ? `<span style="font-weight:500;font-size:0.75rem;color:var(--text-muted,#64748b);">${sub}</span>` : ''}
    </div>
    ${list.length
      ? `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr>${head}</tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>`
      : '<p style="color:var(--text-muted,#64748b);font-size:0.85rem;margin:0 0 0.5rem;">None.</p>'}`;
  const typed = rows.some(r => r.type === 'Stock' || r.type === 'Catalog');
  if (typed) {
    // Authoritative split: Stocks (real inventory — migrated old-system stocks, received goods,
    // anything that reached a Purchase Order) vs Catalog (quotation/PR items not yet purchased).
    const stock = rows.filter(r => r.type === 'Stock');
    const catalog = rows.filter(r => r.type !== 'Stock');
    const units = stock.reduce((s, r) => s + flowNum(r.balance), 0);
    c.innerHTML =
      group('📦 Stocks — on hand / purchased', stock, `${units.toLocaleString()} unit(s) on hand`) +
      `<div style="height:1.1rem;"></div>` +
      group('📋 Quotation Catalog — not yet purchased', catalog, 'items added while quoting; moved to Stocks once they reach a purchase order');
  } else {
    // Pre-classification fallback (backend not yet on v79): keep the ordered/not-ordered split.
    const notOrdered = rows.filter(r => !invIsOrdered(r));
    const ordered = rows.filter(invIsOrdered);
    c.innerHTML =
      group('🟠 Not yet ordered', notOrdered) +
      `<div style="height:1.1rem;"></div>` +
      group('✅ Ordered · has a purchase order', ordered);
  }
}

function rowHtml(r) {
  // Read-only (management/director): no action buttons.
  const actions = invReadOnly ? '<td></td>' : `<td style="white-space:nowrap;">
      <button class="link-btn" onclick='editItem(${r.rowIndex})'>Edit</button>
      ${invCanDelete ? `<button class="link-btn del-btn" onclick='deleteItem(${r.rowIndex}, ${JSON.stringify(String(r.itemNo || ''))})' style="margin-left:0.5rem;">Delete</button>` : ''}
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
    ${actions}</tr>`;
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
  document.getElementById('invType').value = (r.type === 'Catalog') ? 'Catalog' : 'Stock';
  // A158: editing — offer the explicit stock-adjustment opt-in (hidden when adding a new item).
  const adjWrap = document.getElementById('adjustBalanceWrap');
  const adj = document.getElementById('adjustBalance');
  if (adjWrap) adjWrap.style.display = '';
  if (adj) adj.checked = false;
  document.getElementById('formTitle').textContent = 'Edit Item ' + r.itemNo;
  document.getElementById('submitBtn').textContent = 'Save Changes';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  document.getElementById('invForm').reset();
  document.getElementById('rowIndex').value = '';
  const adjWrap = document.getElementById('adjustBalanceWrap');
  if (adjWrap) adjWrap.style.display = 'none';    // A158: adding, not adjusting
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
  // Only admin/accounting see the Type control; sales adds fall to the backend Catalog default.
  if (invCanDelete) payload.type = document.getElementById('invType').value;
  /* A158: on an EDIT the stored balance wins unless the user is deliberately adjusting stock — the form
     value is whatever was on screen when it loaded, so writing it back absolutely could roll back a
     receiving that landed in between. */
  if (rowIndex) {
    const adj = document.getElementById('adjustBalance');
    payload.adjustBalance = !!(adj && adj.checked);
  }
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await postFlow(rowIndex ? 'updateInventoryItem' : 'addInventoryItem', payload);
    if (!res.success) throw new Error(res.message || 'Failed.');
    flowMsg('formMsg', res.message, true);
    resetForm();
    await loadInventory(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (err) {
    flowMsg('formMsg', err.message, false);
  } finally {
    btn.disabled = false;
  }
}

async function deleteItem(rowIndex, itemNo) {
  if (!confirm('Delete this item?')) return;
  try {
    // A158: send the item number too — deleting by row position alone removes whatever has since
    // shifted into that slot if another user changed the list.
    const res = await postFlow('deleteInventoryItem', { rowIndex, itemNo: itemNo || '' });
    if (!res.success) throw new Error(res.message || 'Failed.');
    await loadInventory(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (err) { alert(err.message); }
}


/* A159 — items are auto-added when someone quotes an unlisted product, so near-duplicate entries
   accumulate (e.g. the same hex-key set entered twice). This reports them, grouped by normalised
   description; merging stays a human decision because it moves stock balances and cost history. */
async function findDuplicates() {
  const box = document.getElementById('dupReport');
  if (!box) return;
  box.style.display = '';
  box.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Scanning...</span></div>';
  try {
    const r = await fetchFlow('findDuplicateInventory');
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not scan the catalogue.');
    const groups = (r.data || []);
    if (!groups.length) {
      box.innerHTML = '<p style="color:var(--text-muted,#64748b);padding:0.6rem 0;">No likely duplicates found — every item has a distinct description.</p>';
      return;
    }
    box.innerHTML = `
      <div style="margin:0.6rem 0 1rem;padding:0.8rem 1rem;border:1px solid var(--border,#334155);border-radius:10px;">
        <div style="font-weight:600;margin-bottom:0.5rem;">
          ${groups.length} possible duplicate${groups.length === 1 ? '' : ' groups'} · ${r.items} item${r.items === 1 ? '' : 's'}
        </div>
        <p style="color:var(--text-muted,#64748b);font-size:0.85rem;margin:0 0 0.7rem;">
          Same description, separate records. Nothing is merged automatically — merging moves stock and
          cost history, so decide per group and edit or delete the extra record yourself.
        </p>
        <table class="flow-table" style="min-width:640px;"><thead><tr>
          <th>Description</th><th>Item No</th><th>Item ID</th><th class="num">Balance</th><th class="num">Landed/Unit</th><th>Type</th>
        </tr></thead><tbody>${groups.map(g => g.items.map((it, k) => `
          <tr${k === 0 ? ' style="border-top:2px solid var(--border,#334155);"' : ''}>
            <td>${k === 0 ? flowEsc(it.description || '') : ''}</td>
            <td>${flowEsc(it.itemNo || '')}</td>
            <td style="font-family:monospace;font-size:0.8rem;color:var(--text-muted,#64748b);">${flowEsc(it.itemId || '—')}</td>
            <td class="num">${flowNum(it.balance)}</td>
            <td class="num">${flowMoney(it.landedCost, 'PHP')}</td>
            <td>${flowEsc(it.type || '')}</td>
          </tr>`).join('')).join('')}</tbody></table>
      </div>`;
  } catch (e) {
    box.innerHTML = `<p style="color:#ef4444;padding:0.6rem 0;">${flowEsc(e.message)}</p>`;
  }
}
