/* flow-payment-requests.js — Type 'PO' supplier payment requests (PRF).
   Load a PO → request supplier payment. Approval: Director → Management.
   Reuses the legacy PRF PDF via /flow/payment-request-pdf. */

let prSession = null, prCanCreate = false, prPOs = [], prList = [], prAP = {};

document.addEventListener('DOMContentLoaded', async () => {
  prSession = requireOversight();           // admin/accounting/management/director
  if (!prSession) return;
  prCanCreate = prSession.role === 'admin' || prSession.role === 'accounting';
  renderNavbar('flow-payment-requests');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-payment-requests.html');
  if (!prCanCreate) document.getElementById('formCard').style.display = 'none';
  else { document.getElementById('dueDate').value = ''; await loadPOOptions(); }
  await loadPRs();
});

async function loadPOOptions() {
  try {
    const [po, ap] = await Promise.all([
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getAPAging').catch(() => ({ data: [] })),
    ]);
    prPOs = (po && po.data) || [];
    prAP = {};
    ((ap && ap.data) || []).forEach(a => {
      const k = String(a.poNo);
      prAP[k] = (prAP[k] || 0) + (flowNum(a.amountPHP) || 0) - 0;
    });
    document.getElementById('loadPO').innerHTML = '<option value="">— select a purchase order —</option>' +
      prPOs.slice().sort((a, b) => (flowDate(b.date) || '').localeCompare(flowDate(a.date) || ''))
        .map(p => `<option value="${flowEsc(p.poNo)}">${flowEsc(p.poNo)} — ${flowEsc(p.supplier)} (${flowEsc(p.currency)} ${flowNum(p.total).toLocaleString()})</option>`).join('');
  } catch (e) { /* leave empty */ }
}

function loadFromPO() {
  const no = document.getElementById('loadPO').value;
  const p = prPOs.find(x => String(x.poNo) === String(no));
  if (!p) return;
  document.getElementById('payee').value = p.supplier || '';
  const php = prAP[String(no)] || 0;
  document.getElementById('amount').value = php > 0 ? php : '';
  document.getElementById('purpose').value = `Supplier payment for ${p.poNo}` + (p.soNo ? ` (SO ${p.soNo})` : '');
}

async function savePR() {
  const poNo = document.getElementById('loadPO').value;
  if (!poNo) { flowMsg('formMsg', 'Select a purchase order.', false); return; }
  const amount = flowNum(document.getElementById('amount').value);
  if (!(amount > 0)) { flowMsg('formMsg', 'Enter an amount greater than zero.', false); return; }
  const editing = document.getElementById('prNo').value;
  const payload = {
    prNo: editing || (document.getElementById('prNoInput').value || '').trim(),
    type: 'PO', poNo, payee: document.getElementById('payee').value.trim(), amount,
    purpose: document.getElementById('purpose').value.trim(),
    department: document.getElementById('department').value.trim(),
    bankName: document.getElementById('bankName').value.trim(),
    accountName: document.getElementById('accountName').value.trim(),
    accountNumber: document.getElementById('accountNumber').value.trim(),
    paymentMethod: document.getElementById('paymentMethod').value,
    dueDate: document.getElementById('dueDate').value,
    remarks: document.getElementById('remarks').value.trim(),
    createdBy: prSession.name,
  };
  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow(editing ? 'updatePaymentRequest' : 'createPaymentRequest', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message}`, true);
    resetForm();
    await loadPRs();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Payment Request'; }
}

function resetForm() {
  ['prNo', 'loadPO', 'payee', 'amount', 'bankName', 'accountName', 'accountNumber', 'department', 'prNoInput', 'purpose', 'remarks', 'dueDate'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pni = document.getElementById('prNoInput'); if (pni) pni.disabled = false;
  document.getElementById('formTitle').textContent = 'New Payment Request (Purchase Order)';
  document.getElementById('formMsg').style.display = 'none';
}

async function loadPRs() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getPaymentRequests', { type: 'PO' });
    prList = (res && res.data) || [];
    if (!prList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No payment requests yet.</p>'; return; }
    c.innerHTML = `<table class="flow-table"><thead><tr><th>PR No</th><th>PO</th><th>Payee</th><th class="num">Amount</th><th>Status</th><th>PDF</th><th></th></tr></thead><tbody>${prList.map(prRow).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function prRow(r) {
  const st = r.status || 'Draft';
  const note = (st === 'Rejected' && r.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(r.approvalNote)}</div>` : '';
  return `<tr><td>${flowEsc(r.prNo)}</td><td>${flowEsc(r.poNo)}</td><td>${flowEsc(r.payee)}</td>
    <td class="num">${flowMoney(r.amount, 'PHP')}</td><td>${flowStatusBadge(st)}${note}</td>
    <td>${r.pdfLink ? `<a href="${flowEsc(r.pdfLink)}" target="_blank" class="link-btn">View</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;">${prActions(r)}</td></tr>`;
}

function prActions(r) {
  const no = flowEsc(r.prNo), st = r.status || 'Draft', role = prSession.role;
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.4rem;">${label}</button>`;
  let a = `<button class="link-btn" onclick='prGenPdf("${no}")'>PDF</button>` + B(`openDocsModal("Payment Request","${no}")`, 'Docs');
  const editable = st === 'Draft' || st === 'Rejected';
  if (prCanCreate) {
    if (editable) a += B(`prSubmit("${no}")`, 'Submit');
    a += B(`prEdit("${no}")`, 'Edit');                          // editable at any status
    if (editable) a += B(`prDelete("${no}")`, 'Delete', 'del-btn');
  }
  if (role === 'director' && st === 'Pending Director') a += B(`prApprove("${no}")`, 'Approve') + B(`prReject("${no}")`, 'Reject', 'del-btn');
  if (role === 'management' && st === 'Pending Management') a += B(`prApprove("${no}")`, 'Approve') + B(`prReject("${no}")`, 'Reject', 'del-btn');
  return a;
}

async function _prAct(action, no, extra) {
  try { const res = await postFlow(action, Object.assign({ prNo: no }, extra || {})); if (!res.success) throw new Error(res.message); await loadPRs(); }
  catch (e) { alert(e.message); }
}
function prSubmit(no) { if (confirm('Submit ' + no + ' for approval (Director → Management)?')) _prAct('submitPaymentRequest', no); }
function prApprove(no) { _prAct('approvePaymentRequest', no); }
function prReject(no) { const reason = prompt('Reason for rejecting ' + no + ' (optional):', ''); if (reason === null) return; _prAct('rejectPaymentRequest', no, { reason }); }
function prDelete(no) { if (confirm('Delete payment request ' + no + '?')) _prAct('deletePaymentRequest', no); }

function prEdit(no) {
  const r = prList.find(x => x.prNo === no); if (!r) return;
  document.getElementById('prNo').value = r.prNo;
  document.getElementById('loadPO').value = r.poNo;
  document.getElementById('payee').value = r.payee || '';
  document.getElementById('amount').value = r.amount || '';
  document.getElementById('bankName').value = r.bankName || '';
  document.getElementById('accountName').value = r.accountName || '';
  document.getElementById('accountNumber').value = r.accountNumber || '';
  document.getElementById('paymentMethod').value = r.paymentMethod || 'Telegraphic Transfer';
  document.getElementById('department').value = r.department || '';
  document.getElementById('dueDate').value = flowDate(r.dueDate) || '';
  document.getElementById('purpose').value = r.purpose || '';
  document.getElementById('remarks').value = r.remarks || '';
  const pni = document.getElementById('prNoInput'); pni.value = r.prNo; pni.disabled = true;
  document.getElementById('formTitle').textContent = 'Edit ' + r.prNo;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function prGenPdf(no) {
  const r = prList.find(x => x.prNo === no); if (!r) return;
  try {
    const payload = {
      prNo: r.prNo, requestDate: flowDate(r.createdAt), requestedBy: r.createdBy, department: r.department,
      purpose: r.purpose, payee: r.payee, supplier: r.supplier, bankName: r.bankName, accountName: r.accountName,
      accountNumber: r.accountNumber, paymentMethod: r.paymentMethod, currency: r.currency, amount: r.amount,
      dueDate: flowDate(r.dueDate), remarks: r.remarks,
    };
    const resp = await fetch('/flow/payment-request-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.message || 'PDF generation failed.'); }
    const blob = await resp.blob();
    window.open(URL.createObjectURL(blob), '_blank');
    const b64 = await blobToBase64(blob);
    await postFlow('savePaymentRequestPDF', { prNo: r.prNo, pdfBase64: b64, fileName: 'Payment_Request_' + r.prNo + '.pdf' }).catch(() => {});
    loadPRs();
  } catch (e) { alert(e.message); }
}
