/* flow-invoices.js — invoice/issuance from a sales order; COGS from landed cost; deduct inventory */
let ivSOs = [];
let ivInventory = [];
let ivCurrent = null;
let ivSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  ivSession = requireAccountingOrAdmin();
  if (!ivSession) return;
  renderNavbar('flow-invoices');
  renderFlowNav('flow-invoices.html');
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
  await Promise.all([loadSOOptions(), loadInventory()]);
  await loadInvoices();
});

async function loadSOOptions() {
  try { const r = await fetchFlow('getSalesOrders'); ivSOs = (r && r.data) || []; }
  catch (e) { ivSOs = []; }
  document.getElementById('loadSO').innerHTML = '<option value="">— select a sales order —</option>' +
    ivSOs.map(s => `<option value="${flowEsc(s.soNo)}">${flowEsc(s.soNo)} — ${flowEsc(s.customer)}</option>`).join('');
}

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); ivInventory = (r && r.data) || []; }
  catch (e) { ivInventory = []; }
}

function landedFor(itemNo) {
  const i = ivInventory.find(x => String(x.itemNo) === String(itemNo));
  return i ? flowNum(i.landedCost) : 0;
}
function onHand(itemNo) {
  const i = ivInventory.find(x => String(x.itemNo) === String(itemNo));
  return i ? flowNum(i.balance) : 0;
}

function loadFromSO() {
  const no = document.getElementById('loadSO').value;
  const s = ivSOs.find(x => x.soNo === no);
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
    const stock = onHand(it.itemNo);
    const warn = flowNum(it.qty) > stock ? ` <span class="flow-badge b-unpaid" title="On hand: ${stock}">low stock</span>` : '';
    return `<tr data-i="${i}">
      <td>${flowEsc(it.itemNo)} — ${flowEsc(it.itemName)}${warn}</td>
      <td class="num"><input type="number" step="any" min="0" class="qty" value="${flowNum(it.qty)}" oninput="recalc()"></td>
      <td class="num"><input type="number" step="any" min="0" class="price" value="${flowNum(it.price)}" oninput="recalc()"></td>
      <td class="num lineSales">0.00</td>
      <td class="num">${flowMoney(landedFor(it.itemNo), 'PHP')}</td>
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
    const lc = qty * landedFor(it.itemNo);
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
    items.push({ itemNo: src.itemNo, itemName: src.itemName,
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
  const btn = document.getElementById('saveBtn');
  const payload = {
    soNo: ivCurrent.soNo, customer, date: document.getElementById('date').value,
    createdBy: ivSession.name, items: JSON.stringify(items)
  };
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await postFlow('createInvoice', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.invNo})`, true);
    resetForm();
    await loadInventory();
    await loadInvoices();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Issue Invoice & Deduct Inventory'; }
}

function resetForm() {
  ivCurrent = null;
  document.getElementById('loadSO').value = '';
  document.getElementById('soNo').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
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
      <td style="white-space:nowrap;"><button class="link-btn" onclick='openDocsModal("Invoice","${flowEsc(v.invNo)}")'>Docs</button></td></tr>`).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}
