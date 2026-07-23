/* flow-ap-aging.js — edit PHP amount / status / payment on PO-generated payables */
let apData = [];
let apSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  apSession = requireOversight();
  if (!apSession) return;
  renderNavbar('flow-ap-aging');
  renderFlowNav('flow-ap-aging.html');
  await loadAP();
});

async function loadAP() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getAPAging');
    apData = (res && res.data) || [];
    render();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function badgeClass(s) {
  s = (s || '').toLowerCase();
  if (s === 'paid') return 'b-paid';
  if (s === 'partial') return 'b-partial';
  return 'b-unpaid';
}

function render() {
  const c = document.getElementById('container');
  if (!apData.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No payables yet. Create a Purchase Order to generate one.</p>'; updateKpis(); return; }
  c.innerHTML = `<table class="flow-table flow-items"><thead><tr>
    <th>AP No</th><th>PO</th><th>Supplier</th><th>Cur</th><th class="num">Amount (FC)</th>
    <th class="num" style="width:130px;">Amount (PHP)</th><th style="width:110px;">Status</th>
    <th style="width:140px;">Due Date</th><th class="num" style="width:120px;">Paid (PHP)</th>
    <th style="width:160px;">Notes</th><th style="width:150px;">Payment Request</th><th></th></tr></thead><tbody>${apData.map(rowHtml).join('')}</tbody></table>`;
  updateKpis();
}

function rowHtml(r) {
  return `<tr data-row="${r.rowIndex}">
    <td>${flowEsc(r.apNo)}</td><td>${flowEsc(r.poNo)}</td><td>${flowEsc(r.supplier)}</td><td>${flowEsc(r.currency)}</td>
    <td class="num">${flowMoney(r.amountFC, r.currency)}</td>
    <td class="num"><input type="number" step="any" min="0" class="f-php" value="${r.amountPHP || ''}" placeholder="0.00"></td>
    <td><select class="f-status">${['Unpaid','Partial','Paid'].map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
    <td><input type="date" class="f-due" value="${flowDate(r.dueDate)}"></td>
    <td class="num"><input type="number" step="any" min="0" class="f-paid" value="${r.paidPHP || ''}" placeholder="0.00"></td>
    <td><input type="text" class="f-notes" value="${flowEsc(r.notes)}"></td>
    <td>${r.prNo ? `<a class="link-btn" href="flow-payment-requests.html" title="Open Payment Requests">${flowEsc(r.prNo)}</a>${r.prStatus ? ' ' + (typeof flowStatusBadge === 'function' ? flowStatusBadge(r.prStatus) : flowEsc(r.prStatus)) : ''}` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;"><button class="link-btn" onclick="saveRow(${r.rowIndex}, this)">Save</button>
    <button class="link-btn" onclick='openDocsModal("AP Aging","${flowEsc(r.apNo)}")' style="margin-left:0.4rem;">Docs</button></td></tr>`;
}

function updateKpis() {
  let unpaidCount = 0, unpaid = 0, paid = 0;
  apData.forEach(r => {
    if ((r.status || '').toLowerCase() === 'paid') paid += flowNum(r.amountPHP);
    else { unpaidCount++; unpaid += flowNum(r.amountPHP) - flowNum(r.paidPHP); }
  });
  document.getElementById('kpiCount').textContent = unpaidCount;
  document.getElementById('kpiUnpaid').textContent = flowMoney(unpaid, 'PHP');
  document.getElementById('kpiPaid').textContent = flowMoney(paid, 'PHP');
}

async function saveRow(rowIndex, btn) {
  const tr = btn.closest('tr');
  const payload = {
    rowIndex,
    amountPHP: tr.querySelector('.f-php').value || 0,
    status: tr.querySelector('.f-status').value,
    dueDate: tr.querySelector('.f-due').value,
    paidPHP: tr.querySelector('.f-paid').value || 0,
    notes: tr.querySelector('.f-notes').value
  };
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await postFlow('updateAPAging', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', `AP entry saved.`, true);
    await loadAP();
  } catch (e) { flowMsg('msg', e.message, false); btn.disabled = false; btn.textContent = 'Save'; }
}
