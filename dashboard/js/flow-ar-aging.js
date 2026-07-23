/* flow-ar-aging.js — receivables generated from invoices; record collections to clear them. */
let arData = [];
let arSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  arSession = requireOversight();
  if (!arSession) return;
  renderNavbar('flow-ar-aging');
  renderFlowNav('flow-ar-aging.html');
  await loadAR();
});

async function loadAR() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getARAging');
    arData = (res && res.data) || [];
    render();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function render() {
  const c = document.getElementById('container');
  if (!arData.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No receivables yet. Issue an invoice to generate one.</p>'; updateKpis(); return; }
  c.innerHTML = `<table class="flow-table flow-items" style="min-width:880px;"><thead><tr>
    <th>AR No</th><th>INV</th><th>SO</th><th>Customer</th><th class="num">Amount</th><th class="num">Collected</th>
    <th class="num">Outstanding</th><th>Status</th><th style="width:140px;">Due Date</th><th style="width:150px;">Notes</th><th></th></tr></thead>
    <tbody>${arData.map(rowHtml).join('')}</tbody></table>`;
  updateKpis();
}

function rowHtml(r) {
  const done = r.status === 'Paid';
  return `<tr data-ar="${flowEsc(r.arNo)}">
    <td>${flowEsc(r.arNo)}</td><td>${flowEsc(r.invNo)}</td><td>${flowEsc(r.soNo)}</td><td>${flowEsc(r.customer)}</td>
    <td class="num">${flowMoney(r.amountPHP, 'PHP')}</td>
    <td class="num">${flowMoney(r.collectedPHP, 'PHP')}</td>
    <td class="num">${flowMoney(r.outstanding, 'PHP')}</td>
    <td>${flowStatusBadge(r.status)}</td>
    <td><input type="date" class="f-due" value="${flowDate(r.dueDate)}"></td>
    <td><input type="text" class="f-notes" value="${flowEsc(r.notes)}"></td>
    <td style="white-space:nowrap;">
      ${done ? '' : `<button class="link-btn" onclick='openCollect("${flowEsc(r.arNo)}")'>Collect</button>`}
      <button class="link-btn" onclick="saveRow('${flowEsc(r.arNo)}', this)" style="margin-left:0.4rem;">Save</button>
      <button class="link-btn" onclick='openDocsModal("AR Aging","${flowEsc(r.arNo)}")' style="margin-left:0.4rem;">Docs</button>
    </td></tr>`;
}

function updateKpis() {
  let count = 0, out = 0, collected = 0;
  arData.forEach(r => {
    collected += flowNum(r.collectedPHP);
    if ((r.status || '').toLowerCase() !== 'paid') { count++; out += flowNum(r.outstanding); }
  });
  document.getElementById('kpiCount').textContent = count;
  document.getElementById('kpiOut').textContent = flowMoney(out, 'PHP');
  document.getElementById('kpiCollected').textContent = flowMoney(collected, 'PHP');
}

async function saveRow(arNo, btn) {
  const tr = btn.closest('tr');
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await postFlow('updateARAging', {
      arNo, dueDate: tr.querySelector('.f-due').value, notes: tr.querySelector('.f-notes').value
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'AR entry saved.', true);
    await loadAR();
  } catch (e) { flowMsg('msg', e.message, false); btn.disabled = false; btn.textContent = 'Save'; }
}

// ─── Collection modal ─────────────────────────────
function openCollect(arNo) {
  const r = arData.find(x => x.arNo === arNo);
  if (!r) return;
  document.getElementById('collectArNo').value = arNo;
  document.getElementById('collectSub').textContent = `${arNo} · ${r.customer} · outstanding ${flowMoney(r.outstanding, 'PHP')}`;
  document.getElementById('collectAmount').value = r.outstanding > 0 ? r.outstanding : '';
  document.getElementById('collectEwt').value = '';
  document.getElementById('collectDate').value = flowToday();
  document.getElementById('collectRef').value = '';
  document.getElementById('collectNotes').value = '';
  document.getElementById('collectMsg').style.display = 'none';
  collectRecalcNet();
  document.getElementById('collectModal').classList.add('open');
}
function closeCollect() { document.getElementById('collectModal').classList.remove('open'); }

function collectRecalcNet() {
  const amount = flowNum(document.getElementById('collectAmount').value);
  const ewt = flowNum(document.getElementById('collectEwt').value);
  const net = amount - ewt;
  document.getElementById('collectNet').textContent =
    `Net cash = ${flowMoney(net, 'PHP')}  (Amount ${flowMoney(amount, 'PHP')} − EWT ${flowMoney(ewt, 'PHP')})`;
}

async function submitCollection() {
  const arNo = document.getElementById('collectArNo').value;
  const amount = flowNum(document.getElementById('collectAmount').value);
  if (!(amount > 0)) { flowMsg('collectMsg', 'Enter an amount greater than zero.', false); return; }
  const btn = document.getElementById('collectBtn');
  btn.disabled = true; btn.textContent = 'Recording...';
  try {
    const res = await postFlow('recordCollection', {
      arNo, amount, ewt: flowNum(document.getElementById('collectEwt').value),
      date: document.getElementById('collectDate').value,
      method: document.getElementById('collectMethod').value,
      ref: document.getElementById('collectRef').value.trim(),
      notes: document.getElementById('collectNotes').value.trim(),
      clientRef: flowClientRef()                            // idempotent create (safe retry)
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('collectMsg', `${res.message} (status: ${res.status})`, true);
    await loadAR();
    setTimeout(closeCollect, 800);
  } catch (e) { flowMsg('collectMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Record'; }
}
