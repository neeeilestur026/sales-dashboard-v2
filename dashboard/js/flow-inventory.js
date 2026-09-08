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
  } else {
    /* A273 — collapse the form so the catalogue below owns the screen and is the only thing that
       scrolls. Read-only roles skip this: their form is hidden outright, so there is nothing to
       collapse and the list already starts high. */
    flowFormToggleInit('Add Item', () => flowFitScroll('container'), 'invFormCard');
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
  const fit = () => setTimeout(() => flowFitScroll('container'), 0);   // A273
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No items.</p>'; fit(); return; }
  /* A274 — two column sets, because the Catalog and the Stocks hold different things. Measured on
     the live 994: every one of the Catalog's 896 rows has zero balance, zero cost and zero total,
     so showing it five money columns was five columns of blanks on 90% of the table — and that,
     with 622-character descriptions, is what forced the horizontal scroll. Sales already saw a
     three-column list, so that view and the Catalog are now the same renderer. */
  const invSlim = invSession.role === 'sales';
  const actCol = invReadOnly ? '' : '<col class="c-act">';
  const actTh = invReadOnly ? '' : '<th></th>';   // read-only rows emit no <td>, so no <th> either

  const stockCols = `<colgroup><col class="c-item"><col><col class="c-onhand"><col class="c-cost">
      <col class="c-total">${actCol}</colgroup>`;
  const stockHead = `<th>Item No</th><th>Description</th><th class="num">On hand</th>
      <th>Cost / unit</th><th class="num">Total landed</th>${actTh}`;
  const listCols = `<colgroup><col class="c-item"><col>${actCol}</colgroup>`;
  const listHead = `<th>Item No</th><th>Description</th>${actTh}`;

  const group = (label, list, sub, kind) => `
    <div style="font-size:0.9rem;font-weight:700;margin:0 0 0.5rem;display:flex;align-items:center;gap:0.5rem;">
      ${label}
      <span style="font-weight:600;font-size:0.72rem;padding:0.1rem 0.5rem;border-radius:999px;background:var(--bg-inset,#eef2f6);color:var(--text-secondary,#475569);">${list.length}</span>
      ${sub ? `<span style="font-weight:500;font-size:0.75rem;color:var(--text-muted,#64748b);">${sub}</span>` : ''}
    </div>
    ${list.length
      /* A273 — do NOT wrap this table in an overflow container. `overflow-x:auto` forces overflow-y
         to auto as well, which makes the wrapper the sticky header's scroll ancestor; having no
         height limit it never scrolls, so the header stops pinning. #container already scrolls. */
      ? `<table class="flow-table inv-table">${kind === 'stock' ? stockCols : listCols}
           <thead><tr>${kind === 'stock' ? stockHead : listHead}</tr></thead>
           <tbody>${list.map(kind === 'stock' ? invStockRow : invListRow).join('')}</tbody></table>`
      : '<p style="color:var(--text-muted,#64748b);font-size:0.85rem;margin:0 0 0.5rem;">None.</p>'}`;
  const typed = rows.some(r => r.type === 'Stock' || r.type === 'Catalog');
  if (typed) {
    // Authoritative split: Stocks (real inventory — migrated old-system stocks, received goods,
    // anything that reached a Purchase Order) vs Catalog (quotation/PR items not yet purchased).
    const stock = rows.filter(r => r.type === 'Stock');
    const catalog = rows.filter(r => r.type !== 'Stock');
    const units = stock.reduce((s, r) => s + flowNum(r.balance), 0);
    c.innerHTML =
      group('📦 Stocks — on hand / purchased', stock, `${units.toLocaleString()} unit(s) on hand`, invSlim ? 'list' : 'stock') +
      `<div style="height:1.1rem;"></div>` +
      group('📋 Quotation Catalog — not yet purchased', catalog, 'items added while quoting; moved to Stocks once they reach a purchase order', 'list');
  } else {
    // Pre-classification fallback (backend not yet on v79): keep the ordered/not-ordered split.
    const notOrdered = rows.filter(r => !invIsOrdered(r));
    const ordered = rows.filter(invIsOrdered);
    c.innerHTML =
      group('🟠 Not yet ordered', notOrdered, '', 'list') +
      `<div style="height:1.1rem;"></div>` +
      group('✅ Ordered · has a purchase order', ordered, '', invSlim ? 'list' : 'stock');
  }
  fit();          // A273 — both branches above land here
}

/* A274 — one cell each for identity and description, shared by both row shapes. */
function invItemCell(r) {
  const no = String(r.itemNo || '').trim();
  // 618 of 994 items carry no real number; a muted dash reads better than the literal "N/A".
  return no && no.toUpperCase() !== 'N/A'
    ? `<td class="inv-item">${flowEsc(no)}</td>`
    : `<td class="inv-item inv-muted">—</td>`;
}

/* Clamped only when the text is long enough to need it (~2 lines at this width), so short rows are
   not given a pointer cursor and a "more" affordance that do nothing. The toggle is delegated from
   #container — 994 inline onclick attributes would be a lot of markup for one class flip. */
function invDescCell(r) {
  const d = String(r.description || '');
  const long = d.length > 120;
  return `<td><div class="inv-desc${long ? ' clamp' : ''}">${flowEsc(d)}</div>` +
    `${long ? '<span class="inv-more"></span>' : ''}</td>`;
}

function invActionsCell(r) {
  if (invReadOnly) return '';
  return `<td style="white-space:nowrap;">
      <button class="link-btn" onclick='editItem(${r.rowIndex})'>Edit</button>
      ${invCanDelete ? `<button class="link-btn del-btn" onclick='deleteItem(${r.rowIndex}, ${JSON.stringify(String(r.itemNo || ''))})' style="margin-left:0.5rem;">Delete</button>` : ''}
    </td>`;
}

/** Catalog + the sales slim view: identity only. No row here has a balance, cost or total. */
function invListRow(r) {
  return `<tr>${invItemCell(r)}${invDescCell(r)}${invActionsCell(r)}</tr>`;
}

/** Stocks: balance and cost matter, but only 10 of 98 rows carry any cost at all — so an item with
 *  none shows an empty cell rather than three zeros. */
function invStockRow(r) {
  const bal = flowNum(r.balance);
  const landed = flowNum(r.landedCost);
  const purch = flowNum(r.purchasePrice);
  const ship = flowNum(r.shippingCost);
  const total = flowNum(r.totalLanded);
  // Currency is PHP on all 994 rows today, so it gets no column — but say so inline if that changes.
  const cur = String(r.currency || 'PHP').trim();
  const curTag = cur && cur !== 'PHP' ? ` <span class="flow-badge" style="background:rgba(37,99,235,0.12);color:#1d4ed8;">${flowEsc(cur)}</span>` : '';

  const parts = [];
  if (purch) parts.push(`purchase ${flowMoney(purch, cur)}`);
  if (ship) parts.push(`shipping ${flowMoney(ship, cur)}`);
  const cost = landed || purch || ship
    ? `<div class="inv-cost"><span class="v">${flowMoney(landed || purch, cur)}</span>${curTag}
         ${parts.length ? `<span class="b">${parts.join(' · ')}</span>` : ''}</div>`
    : '<span class="inv-muted">—</span>';

  return `<tr>${invItemCell(r)}${invDescCell(r)}
    <td class="num">${bal ? bal.toLocaleString() : '<span class="inv-muted">—</span>'}</td>
    <td>${cost}</td>
    <td class="num">${total ? flowMoney(total, cur) : '<span class="inv-muted">—</span>'}</td>
    ${invActionsCell(r)}</tr>`;
}

function editItem(rowIndex) {
  const r = invData.find(x => x.rowIndex === rowIndex);
  if (!r) return;
  // A273 — the form starts collapsed, so editing must open it or the click does nothing visible.
  if (typeof flowFormToggle === 'function') flowFormToggle(true);
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
  flowFitScroll('container');        // A273 — the report just took height above the list
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

// A273 — keep the locked list sized when the window changes.
window.addEventListener('resize', () => flowFitScroll('container'));

/* A274 — expand a clamped description. Delegated so the markup stays clean across ~1,000 rows. */
document.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  // Either the clamped text itself or the "more" link beside it.
  const more = e.target.closest('.inv-more');
  const d = more ? more.previousElementSibling : e.target.closest('.inv-desc.clamp');
  if (!d || !d.classList.contains('clamp')) return;
  d.classList.toggle('open');
  flowFitScroll('container');        // the row just changed height
});
