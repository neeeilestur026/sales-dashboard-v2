/* flow-invoices.js — invoice/issuance from a sales order; COGS from landed cost; deduct inventory */
let ivSOs = [];
let ivInventory = [];
let ivCurrent = null;
let ivSession = null;
let ivCanVoid = false;   // A158: the void action needs FlowAPI v94

document.addEventListener('DOMContentLoaded', async () => {
  ivSession = requireAccountingOrAdmin();
  if (!ivSession) return;
  renderNavbar('flow-invoices');
  renderFlowNav('flow-invoices.html');
  // A158: voiding an invoice needs the v94 backend — gate it so it can't fail with 'Unknown action'.
  try { ivCanVoid = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(94) : false; }
  catch (e) { ivCanVoid = false; }
  document.getElementById('date').value = flowToday();
  await Promise.all([loadSOOptions(), loadInventory()]);
  await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
});

async function loadSOOptions() {
  try { const r = await fetchFlow('getSalesOrders'); ivSOs = (r && r.data) || []; }
  catch (e) { ivSOs = []; }
  // Most recent sales order first (by date, then SO number).
  ivSOs.sort((a, b) =>
    (flowDate(b.date) || '').localeCompare(flowDate(a.date) || '') ||
    String(b.soNo).localeCompare(String(a.soNo)));
  document.getElementById('loadSO').innerHTML = '<option value="">— select a sales order —</option>' +
    ivSOs.map(s => `<option value="${flowEsc(s.soNo)}">${flowEsc(s.soNo)} — ${flowEsc(s.customer)}</option>`).join('');
}

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); ivInventory = (r && r.data) || []; }
  catch (e) { ivInventory = []; }
}

/* A159: resolve the line to ONE catalogue item. Matching on itemNo alone showed the first 'N/A'
   row's cost and stock for all 92 no-part-number products — the same phantom-item bug the pickers
   had, surfacing here as a wrong "low stock" / "no cost" badge and a wrong landed cost on screen. */
function ivFind(it) {
  if (!it) return null;
  if (it.itemId) {
    const byId = ivInventory.find(x => String(x.itemId) === String(it.itemId));
    if (byId) return byId;
  }
  const byNo = ivInventory.filter(x => String(x.itemNo) === String(it.itemNo));
  if (byNo.length === 1) return byNo[0];
  if (byNo.length > 1) {                                   // shared number → disambiguate by name
    const d = String(it.itemName || '').trim().toLowerCase();
    const byDesc = byNo.filter(x => String(x.description || '').trim().toLowerCase() === d);
    if (byDesc.length === 1) return byDesc[0];
  }
  return byNo[0] || null;
}
function landedFor(it) { const i = ivFind(it); return i ? flowNum(i.landedCost) : 0; }
function onHand(it)    { const i = ivFind(it); return i ? flowNum(i.balance) : 0; }

function loadFromSO() {
  const no = document.getElementById('loadSO').value;
  const s = ivSOs.find(x => String(x.soNo) === String(no));   // migrated SOs may have numeric ids
  ivCurrent = s || null;
  if (!s) { document.getElementById('itemRows').innerHTML = ''; recalc(); return; }
  document.getElementById('soNo').value = s.soNo;
  document.getElementById('customer').value = s.customer;
  renderItems();
}

function renderItems() {
  const tb = document.getElementById('itemRows');
  if (!ivCurrent) { tb.innerHTML = ''; return; }
  tb.innerHTML = (ivCurrent.items || []).map((it, i) => {
    const stock = onHand(it);
    const warn = flowNum(it.qty) > stock ? ` <span class="flow-badge b-unpaid" title="On hand: ${stock}">low stock</span>` : '';
    // A145: a line with no landed cost books COGS 0 (usually not yet received / AP not paid) — flag it.
    const noCost = flowNum(it.qty) > 0 && !(landedFor(it) > 0)
      ? ` <span class="flow-badge b-unpaid" title="No landed cost recorded — COGS will be ₱0. Receive this item (after paying its AP) first.">no cost</span>` : '';
    return `<tr data-i="${i}">
      <td>${flowEsc(it.itemNo)} — ${flowEsc(it.itemName)}${warn}${noCost}</td>
      <td class="num"><input type="number" step="any" min="0" class="qty" value="${flowNum(it.qty)}" oninput="recalc()"></td>
      <td class="num"><input type="number" step="any" min="0" class="price" value="${flowNum(it.price)}" oninput="recalc()"></td>
      <td class="num lineSales">0.00</td>
      <td class="num">${flowMoney(landedFor(it), 'PHP')}</td>
      <td class="num lineCOGS">0.00</td></tr>`;
  }).join('');
  recalc();
}

function recalc() {
  let sales = 0, cogs = 0;
  document.querySelectorAll('#itemRows tr').forEach((tr, i) => {
    const it = ivCurrent.items[i];
    const qty = flowNum(tr.querySelector('.qty').value);
    const price = flowNum(tr.querySelector('.price').value);
    const ls = qty * price;
    const lc = qty * landedFor(it);
    tr.querySelector('.lineSales').textContent = ls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tr.querySelector('.lineCOGS').textContent = lc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    sales += ls; cogs += lc;
  });
  document.getElementById('totalSales').textContent = sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('totalCOGS').textContent = cogs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('grossProfit').textContent = (sales - cogs).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach((tr, i) => {
    const src = ivCurrent.items[i];
    items.push({ itemId: src.itemId || '', itemNo: src.itemNo, itemName: src.itemName,
      qty: flowNum(tr.querySelector('.qty').value), price: flowNum(tr.querySelector('.price').value) });
  });
  return items;
}

async function saveInvoice() {
  if (!ivCurrent) { flowMsg('formMsg', 'Select a sales order first.', false); return; }
  const items = collectItems();
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Nothing to invoice.', false); return; }
  // A145: warn before issuing lines with no landed cost — they book COGS 0 (100% gross profit).
  const noCostLines = items.filter(it => flowNum(it.qty) > 0 && !(landedFor(it) > 0)).length;
  if (noCostLines > 0 &&
      !confirm(`${noCostLines} item(s) have no landed cost — their COGS will be ₱0 (full gross profit). This usually means the goods aren't received yet. Issue the invoice anyway?`)) {
    return;
  }
  const btn = document.getElementById('saveBtn');
  const payload = {
    soNo: ivCurrent.soNo, customer, date: document.getElementById('date').value,
    invNo: document.getElementById('invNo').value.trim(),
    createdBy: ivSession.name, items: JSON.stringify(items),
    clientRef: flowClientRef()                              // idempotent create (safe retry)
  };
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    let res = await postFlow('createInvoice', payload);
    const extra = {};
    // A158: issuing more than is on hand — stock clamps at zero and the shortfall is untracked.
    if (!res.success && res.needsConfirm === 'shortStock') {
      if (!confirm(res.message)) { flowMsg('formMsg', 'Invoice cancelled — check the stock first.', false); return; }
      extra.confirmShort = true;
      res = await postFlow('createInvoice', Object.assign({}, payload, extra));
    }
    // A158: the sales order already carries an invoice — a second one bills the customer twice.
    if (!res.success && res.needsConfirm === 'alreadyInvoiced') {
      if (!confirm(res.message)) { flowMsg('formMsg', 'Invoice cancelled.', false); return; }
      extra.confirmReinvoice = true;
      res = await postFlow('createInvoice', Object.assign({}, payload, extra));
    }
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.invNo})`, true);
    resetForm();
    await loadInventory();
    await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Issue Invoice & Deduct Inventory'; }
}

function resetForm() {
  ivCurrent = null;
  document.getElementById('loadSO').value = '';
  document.getElementById('soNo').value = '';
  document.getElementById('customer').value = '';
  const ivn = document.getElementById('invNo'); if (ivn) ivn.value = '';
  document.getElementById('date').value = flowToday();
  document.getElementById('itemRows').innerHTML = '';
  ['totalSales', 'totalCOGS', 'grossProfit'].forEach(id => document.getElementById(id).textContent = '0.00');
  document.getElementById('formMsg').style.display = 'none';
}

async function loadInvoices() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getInvoices');
    const list = (res && res.data) || [];
    if (!list.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No invoices yet.</p>'; return; }
    c.innerHTML = `<table class="flow-table"><thead><tr><th>INV No</th><th>SO</th><th>Date</th><th>Customer</th><th class="num">Sales</th><th class="num">COGS</th><th class="num">Gross Profit</th><th>Items</th><th></th></tr></thead><tbody>${list.map(v => `
      <tr><td>${flowEsc(v.invNo)}</td><td>${flowEsc(v.soNo)}</td><td>${flowDate(v.date)}</td><td>${flowEsc(v.customer)}</td>
      <td class="num">${flowMoney(v.totalSales, 'PHP')}</td><td class="num">${flowMoney(v.totalCOGS, 'PHP')}</td>
      <td class="num">${flowMoney(v.totalSales - v.totalCOGS, 'PHP')}</td><td>${v.items.length}</td>
      <td style="white-space:nowrap;"><button class="link-btn" onclick='openDocsModal("Invoice","${flowEsc(v.invNo)}")'>Docs</button>${
        ivCanVoid ? `<button class="link-btn del-btn" style="margin-left:0.4rem;" onclick='voidInvoiceAction(${JSON.stringify(String(v.invNo))})'>Void</button>` : ''
      }</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

/* A158 — reverse an invoice issued in error. Refused once anything has been collected against it,
   because that payment has to be dealt with first. Puts the stock back, removes the receivable it
   raised and clears its journal, so the sale stops counting in revenue and COGS. */
async function voidInvoiceAction(invNo) {
  const reason = prompt(`Void invoice ${invNo}?\n\nStock is restored, the receivable is removed and the journal is cleared. The invoice is kept, marked voided.\n\nReason:`, '');
  if (reason === null) return;
  if (!reason.trim()) { alert('A reason is required to void an invoice.'); return; }
  try {
    const res = await postFlow('voidInvoice', { invNo, reason: reason.trim() });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not void this invoice.');
    alert(res.message);
    await loadInventory();
    await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}
