/* ═══════════════════════════════════════════════════════════════════════════
   flow-pr-actions.js — approval + payment actions shared by the two payment-request
   pages (flow-payment-requests.js = Type 'PO', flow-other-payables.js = Type 'Other').

   A156 put both types on ONE chain:  Draft → Pending Admin → Pending Management
                                            → Pending Director → Approved → Paid

   Admin also CREATES most requests, so requiring a second admin would deadlock whenever
   only one is on duty: when an admin creates the request the backend records their
   creation as the admin sign-off and starts it at Pending Management. When ACCOUNTING
   creates it, a real admin must approve — which is where that check actually means
   something. Accounting no longer approves; it pays the non-bank methods instead.

   The buttons are driven by STATUS, so they stay correct both before and after the
   FlowAPI v92 paste: a row sitting in a legacy status still shows its approver, and the
   backend is the real gate either way. Only Mark Paid is version-gated, because
   markPaymentRequestPaid does not exist before v92.

   Depends on page globals: prSession, loadPRs().
   ═══════════════════════════════════════════════════════════════════════════ */

let prCanPay = false;                 // set by prInitPayGate() once the backend is v92

/** Bank/online transfers are executed by the director; everything else by accounting. */
function prPayOwner(method) {
  return ['bank transfer', 'online'].indexOf(String(method || '').trim().toLowerCase()) !== -1
    ? 'director' : 'accounting';
}

async function prInitPayGate() {
  try { prCanPay = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(92) : false; }
  catch (e) { prCanPay = false; }
}

/** Approve / Reject for whichever stage the request is sitting in. */
function prApprovalActions(r, B) {
  const no = flowEsc(r.prNo), st = String(r.status || 'Draft'), role = prSession.role;
  // status → who approves it. The two legacy statuses are listed so in-flight rows created
  // before v92 still show an approver instead of stranding: pre-paste the old role acts,
  // post-paste the backend maps them onto the new chain and refuses the wrong one by name.
  const OWNER = {
    'Pending Admin': ['admin'],
    'Pending Management': ['management'],
    'Pending Director': ['director'],
    'Pending Accounting': ['accounting', 'admin'],
    'Pending Final': ['management', 'director']
  };
  const owners = OWNER[st];
  if (!owners || owners.indexOf(role) < 0) return '';
  // At the legacy 'Pending Final' stage each approver signs once.
  if (st === 'Pending Final') {
    if (role === 'management' && r.mgmtApprovedBy) return '';
    if (role === 'director' && r.dirApprovedBy) return '';
  }
  return B(`prApprove("${no}")`, 'Approve') + B(`prReject("${no}")`, 'Reject', 'del-btn');
}

/** Mark Paid + Attach proof, shown only to the role that owns this payment method. */
function prPayActions(r, B) {
  const no = flowEsc(r.prNo), st = String(r.status || 'Draft');
  if (st === 'Paid') return '';
  if (st !== 'Approved' || !prCanPay) return '';
  if (prSession.role !== prPayOwner(r.paymentMethod)) return '';
  return B(`prAttachProof("${no}")`, 'Attach proof') + B(`prMarkPaid("${no}")`, 'Mark Paid');
}

function prAttachProof(no) {
  // Preset the doc type so the proof is tagged the way the backend gate looks for it.
  openDocsModal('Payment Request', no, 'Proof of payment · ' + no, 'Proof of Payment');
}

async function prMarkPaid(no) {
  const r = (typeof prList !== 'undefined' ? prList : []).find(x => String(x.prNo) === String(no)) || {};
  // Check first so the user gets the upload window instead of a bare refusal. The server gate
  // is still the real enforcement — this is only a friendlier route to it.
  if (typeof flowHasDoc === 'function' && !(await flowHasDoc('Payment Request', no, 'Proof of Payment'))) {
    alert('Attach the proof of payment for ' + no + ' before marking it paid. Opening the Docs window…');
    prAttachProof(no);
    return;
  }
  const ref = prompt('Payment reference for ' + no + ' (transfer / cheque no — optional):', '');
  if (ref === null) return;
  const label = r.paymentMethod ? (' (' + r.paymentMethod + ')') : '';
  if (!confirm('Mark ' + no + ' as PAID' + label + '?' +
      (String(r.type) === 'PO' ? '\n\nThis also records the payment on its AP Aging entry.' : ''))) return;
  try {
    const res = await postFlow('markPaymentRequestPaid', { prNo: no, paymentRef: ref });
    if (!res.success) throw new Error(res.message);
    await loadPRs();
    alert(res.message);
  } catch (e) { alert(e.message); }
}
