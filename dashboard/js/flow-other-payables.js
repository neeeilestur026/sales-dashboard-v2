/* flow-other-payables.js — Type 'Other' payment requests for expenses / other payables.
   Manual entry (no PO). Approval: Accounting → then both Management and Director.
   Reuses the legacy PRF PDF via /flow/payment-request-pdf. */

let prSession = null, prCanCreate = false, prList = [];

document.addEventListener('DOMContentLoaded', async () => {
  prSession = requireOversight();           // admin/accounting/management/director
  if (!prSession) return;
  prCanCreate = prSession.role === 'admin' || prSession.role === 'accounting';
  renderNavbar('flow-other-payables');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-other-payables.html');
  if (!prCanCreate) document.getElementById('formCard').style.display = 'none';
  await loadPRs();
});

async function savePR() {
  const payee = document.getElementById('payee').value.trim();
  const amount = flowNum(document.getElementById('amount').value);
  if (!payee) { flowMsg('formMsg', 'Payee is required.', false); return; }
  if (!(amount > 0)) { flowMsg('formMsg', 'Enter an amount greater than zero.', false); return; }
  const editing = document.getElementById('prNo').value;
  const payload = {
    prNo: editing || (document.getElementById('prNoInput').value || '').trim(),
    type: 'Other', payee, amount,
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
  ['prNo', 'payee', 'amount', 'bankName', 'accountName', 'accountNumber', 'department', 'prNoInput', 'purpose', 'remarks', 'dueDate'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pni = document.getElementById('prNoInput'); if (pni) pni.disabled = false;
  document.getElementById('formTitle').textContent = 'New Payment Request (Other Payables)';
  document.getElementById('formMsg').style.display = 'none';
}

async function loadPRs() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getPaymentRequests', { type: 'Other' });
    prList = (res && res.data) || [];
    if (!prList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No payment requests yet.</p>'; return; }
    c.innerHTML = `<table class="flow-table"><thead><tr><th>PR No</th><th>Payee</th><th>Purpose</th><th class="num">Amount</th><th>Status</th><th>Approvals</th><th>PDF</th><th></th></tr></thead><tbody>${prList.map(prRow).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function prRow(r) {
  const st = r.status || 'Draft';
  const note = (st === 'Rejected' && r.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(r.approvalNote)}</div>` : '';
  const appr = [r.acctApprovedBy ? 'Acct ✓' : '', r.mgmtApprovedBy ? 'Mgmt ✓' : '', r.dirApprovedBy ? 'Dir ✓' : '']
    .filter(Boolean).join(' · ') || '<span style="color:var(--text-muted,#64748b);">—</span>';
  return `<tr><td>${flowEsc(r.prNo)}</td><td>${flowEsc(r.payee)}</td><td>${flowEsc(r.purpose)}</td>
    <td class="num">${flowMoney(r.amount, 'PHP')}</td><td>${flowStatusBadge(st)}${note}</td>
    <td style="font-size:0.74rem;color:var(--text-secondary,#475569);">${appr}</td>
    <td>${r.pdfLink ? `<a href="${flowEsc(r.pdfLink)}" target="_blank" class="link-btn">View</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;">${prActions(r)}</td></tr>`;
}

function prActions(r) {
  const no = flowEsc(r.prNo), st = r.status || 'Draft', role = prSession.role;
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.4rem;">${label}</button>`;
  let a = `<button class="link-btn" onclick='prGenPdf("${no}")'>PDF</button>` + B(`openDocsModal("Payment Request","${no}")`, 'Docs');
  const editable = st === 'Draft' || st === 'Rejected';
  if (prCanCreate && editable) a += B(`prSubmit("${no}")`, 'Submit') + B(`prEdit("${no}")`, 'Edit') + B(`prDelete("${no}")`, 'Delete', 'del-btn');
  // Accounting approves first; then management and director each approve at Pending Final.
  if (role === 'accounting' && st === 'Pending Accounting') a += B(`prApprove("${no}")`, 'Approve') + B(`prReject("${no}")`, 'Reject', 'del-btn');
  if (st === 'Pending Final') {
    if (role === 'management' && !r.mgmtApprovedBy) a += B(`prApprove("${no}")`, 'Approve (Mgmt)') + B(`prReject("${no}")`, 'Reject', 'del-btn');
    if (role === 'director' && !r.dirApprovedBy) a += B(`prApprove("${no}")`, 'Approve (Dir)') + B(`prReject("${no}")`, 'Reject', 'del-btn');
  }
  return a;
}

async function _prAct(action, no, extra) {
  try { const res = await postFlow(action, Object.assign({ prNo: no }, extra || {})); if (!res.success) throw new Error(res.message); await loadPRs(); }
  catch (e) { alert(e.message); }
}
function prSubmit(no) { if (confirm('Submit ' + no + ' for approval (Accounting → Management & Director)?')) _prAct('submitPaymentRequest', no); }
function prApprove(no) { _prAct('approvePaymentRequest', no); }
function prReject(no) { const reason = prompt('Reason for rejecting ' + no + ' (optional):', ''); if (reason === null) return; _prAct('rejectPaymentRequest', no, { reason }); }
function prDelete(no) { if (confirm('Delete payment request ' + no + '?')) _prAct('deletePaymentRequest', no); }

function prEdit(no) {
  const r = prList.find(x => x.prNo === no); if (!r) return;
  document.getElementById('prNo').value = r.prNo;
  document.getElementById('payee').value = r.payee || '';
  document.getElementById('amount').value = r.amount || '';
  document.getElementById('bankName').value = r.bankName || '';
  document.getElementById('accountName').value = r.accountName || '';
  document.getElementById('accountNumber').value = r.accountNumber || '';
  document.getElementById('paymentMethod').value = r.paymentMethod || 'Bank Transfer';
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
      purpose: r.purpose, payee: r.payee, bankName: r.bankName, accountName: r.accountName,
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
