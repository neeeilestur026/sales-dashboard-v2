/* flow-receiving.js — receive a PO; PHP purchase cost (from AP paid) + itemized shipping → landed cost.
   VAT is captured but excluded from landed/inventory (posted to Input VAT / Other Assets). */
let rcPOs = [];
let rcAP = [];
let rcCurrent = null;        // selected PO {poNo, supplier, currency, total(FC), items:[{itemNo,itemName,qty,price}]}
let rcPoTotalFC = 0;
let rcPaidPHP = 0;
let rcShip = { duties: 0, vat: 0, delivery: 0, other: 0 };
let rcSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  rcSession = requireAccountingOrAdmin();
  if (!rcSession) return;
  renderNavbar('flow-receiving');
  renderFlowNav('flow-receiving.html');
  document.getElementById('date').value = flowToday();
  await Promise.all([loadPOOptions(), loadAP()]);
  await loadReceiving();
});

async function loadPOOptions() {
  try { const r = await fetchFlow('getPurchaseOrders'); rcPOs = (r && r.data) || []; }
  catch (e) { rcPOs = []; }
  document.getElementById('loadPO').innerHTML = '<option value="">— select a purchase order —</option>' +
    rcPOs.map(p => `<option value="${flowEsc(p.poNo)}">${flowEsc(p.poNo)} — ${flowEsc(p.supplier)} (${flowMoney(p.total, p.currency)})</option>`).join('');
}

async function loadAP() {
  try { const r = await fetchFlow('getAPAging'); rcAP = (r && r.data) || []; }
  catch (e) { rcAP = []; }
}

function _paidForPO(poNo) {
  return rcAP.filter(a => String(a.poNo) === String(poNo)).reduce((s, a) => s + flowNum(a.paidPHP), 0);
}

function loadFromPO() {
  const no = document.getElementById('loadPO').value;
  const p = rcPOs.find(x => x.poNo === no);
  rcCurrent = p || null;
  rcShip = { duties: 0, vat: 0, delivery: 0, other: 0 };
  syncShipDisplay();
  if (!p) { document.getElementById('itemRows').innerHTML = ''; recalc(); return; }
  rcPoTotalFC = flowNum(p.total);
  rcPaidPHP = _paidForPO(p.poNo);
  document.getElementById('supplier').value = p.supplier;
  document.getElementById('currency').value = p.currency || 'PHP';
  // A145: landed cost comes from the AP Paid (PHP). Warn up front if nothing is paid yet (→ ₱0 cost).
  if (!(rcPaidPHP > 0)) {
    flowMsg('formMsg', `⚠ No AP payment recorded for ${p.poNo} yet — receiving now would set a ₱0 landed cost. Record the payment in AP Aging first.`, false);
  } else {
    const m = document.getElementById('formMsg'); if (m) m.style.display = 'none';
  }
  renderItems();
}

// A145: does this item code resolve to the shared 'N/A' inventory row? (blank / n/a / na / dash)
function _rcIsNA(no) { const s = String(no || '').trim().toLowerCase(); return s === '' || s === 'n/a' || s === 'na' || /^[-–—]+$/.test(s); }

function renderItems() {
  const tb = document.getElementById('itemRows');
  if (!rcCurrent) { tb.innerHTML = ''; return; }
  tb.innerHTML = (rcCurrent.items || []).map((it, i) => `
    <tr data-i="${i}">
      <td>${flowEsc(it.itemNo)} — ${flowEsc(it.itemName)}${_rcIsNA(it.itemNo) ? ' <span style="color:#b45309;font-size:0.72rem;" title="No part number — all N/A items share one inventory cost row">⚠ N/A</span>' : ''}</td>
      <td class="num"><input type="number" step="any" min="0" class="qty" value="${flowNum(it.qty)}" oninput="recalc()"></td>
      <td class="num"><input type="number" step="any" min="0" class="price" value="${flowNum(it.price)}" oninput="recalc()"></td>
      <td class="num purchasePHP">0.00</td><td class="num shipUnit">0.00</td><td class="num landed">0.00</td><td class="num totLanded">0.00</td>
    </tr>`).join('');
  recalc();
}

function recalc() {
  const invShipping = flowNum(rcShip.duties) + flowNum(rcShip.delivery) + flowNum(rcShip.other); // VAT excluded
  let grand = 0;
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const price = flowNum(tr.querySelector('.price').value);
    const qty = flowNum(tr.querySelector('.qty').value);
    const purchasePHP = rcPoTotalFC > 0 ? (rcPaidPHP * price / rcPoTotalFC) : 0;
    const shipUnit = rcPoTotalFC > 0 ? (invShipping * price / rcPoTotalFC) : 0;
    const landed = purchasePHP + shipUnit;
    const tot = landed * qty;
    const f = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tr.querySelector('.purchasePHP').textContent = f(purchasePHP);
    tr.querySelector('.shipUnit').textContent = f(shipUnit);
    tr.querySelector('.landed').textContent = f(landed);
    tr.querySelector('.totLanded').textContent = f(tot);
    grand += tot;
  });
  document.getElementById('grandTotal').textContent = grand.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Shipping mini-window ───
function syncShipDisplay() {
  const total = flowNum(rcShip.duties) + flowNum(rcShip.vat) + flowNum(rcShip.delivery) + flowNum(rcShip.other);
  document.getElementById('totalShipping').value = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function openShipModal() {
  document.getElementById('shipDuties').value = rcShip.duties || 0;
  document.getElementById('shipVat').value = rcShip.vat || 0;
  document.getElementById('shipDelivery').value = rcShip.delivery || 0;
  document.getElementById('shipOther').value = rcShip.other || 0;
  shipModalRecalc();
  document.getElementById('shipModal').classList.add('open');
}
function closeShipModal() { document.getElementById('shipModal').classList.remove('open'); }
function shipModalRecalc() {
  const t = ['shipDuties', 'shipVat', 'shipDelivery', 'shipOther']
    .reduce((s, id) => s + flowNum(document.getElementById(id).value), 0);
  document.getElementById('shipModalTotal').textContent = t.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function applyShipModal() {
  rcShip = {
    duties: flowNum(document.getElementById('shipDuties').value),
    vat: flowNum(document.getElementById('shipVat').value),
    delivery: flowNum(document.getElementById('shipDelivery').value),
    other: flowNum(document.getElementById('shipOther').value)
  };
  syncShipDisplay();
  recalc();
  closeShipModal();
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach((tr, i) => {
    const src = rcCurrent.items[i];
    items.push({ itemNo: src.itemNo, itemName: src.itemName,
      qty: flowNum(tr.querySelector('.qty').value), price: flowNum(tr.querySelector('.price').value) });
  });
  return items;
}

async function saveReceiving() {
  if (!rcCurrent) { flowMsg('formMsg', 'Select a purchase order first.', false); return; }
  const items = collectItems();
  if (!items.length) { flowMsg('formMsg', 'Nothing to receive.', false); return; }
  const btn = document.getElementById('saveBtn');
  const payload = {
    poNo: rcCurrent.poNo, supplier: rcCurrent.supplier, currency: rcCurrent.currency || 'PHP',
    date: document.getElementById('date').value, receivedBy: rcSession.name,
    duties: rcShip.duties, vat: rcShip.vat, delivery: rcShip.delivery, other: rcShip.other,
    items: JSON.stringify(items),
    clientRef: flowClientRef()                              // idempotent create (safe retry)
  };
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    let res = await postFlow('createReceiving', payload);
    // A145: the backend blocks receiving with no AP payment (a ₱0 cost basis). Offer an explicit override.
    if (!res.success && res.unpaid) {
      if (confirm(res.message + '\n\nProceed anyway with a ₱0 landed cost?')) {
        res = await postFlow('createReceiving', Object.assign({}, payload, { confirmUnpaid: true }));
      } else { flowMsg('formMsg', 'Receiving cancelled — record the AP payment first.', false); return; }
    }
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.mrNo})`, true);
    resetForm();
    await Promise.all([loadAP(), loadReceiving()]);
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Receive & Update Inventory'; }
}

function resetForm() {
  rcCurrent = null; rcPoTotalFC = 0; rcPaidPHP = 0;
  rcShip = { duties: 0, vat: 0, delivery: 0, other: 0 };
  document.getElementById('loadPO').value = '';
  document.getElementById('supplier').value = '';
  document.getElementById('currency').value = '';
  syncShipDisplay();
  document.getElementById('date').value = flowToday();
  document.getElementById('itemRows').innerHTML = '';
  document.getElementById('grandTotal').textContent = '0.00';
  document.getElementById('formMsg').style.display = 'none';
}

async function loadReceiving() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getReceiving');
    const list = (res && res.data) || [];
    if (!list.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No receiving records yet.</p>'; return; }
    c.innerHTML = `<table class="flow-table"><thead><tr><th>MR No</th><th>PO</th><th>Date</th><th>Supplier</th><th class="num">VAT (PHP)</th><th class="num">Shipping (PHP)</th><th>Items</th><th></th></tr></thead><tbody>${list.map(m => `
      <tr><td>${flowEsc(m.mrNo)}</td><td>${flowEsc(m.poNo)}</td><td>${flowDate(m.date)}</td><td>${flowEsc(m.supplier)}</td>
      <td class="num">${flowMoney(m.vat, 'PHP')}</td><td class="num">${flowMoney(m.totalShipping, 'PHP')}</td><td>${m.items.length}</td>
      <td style="white-space:nowrap;"><button class="link-btn" onclick='openDocsModal("Receiving","${flowEsc(m.mrNo)}")'>Docs</button></td></tr>`).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}
