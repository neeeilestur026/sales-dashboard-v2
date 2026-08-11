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

   A224: also loaded by flow-ap-aging.html, so every page global it once assumed (prSession, prList,
   loadPRs) now goes through a resolver — see prActor / prFindRow / prReloadHost.
   ═══════════════════════════════════════════════════════════════════════════ */

let prCanPay = false;                 // set by prInitPayGate() once the backend is v92

/** A224 — telegraphic transfers are released by accounting or admin; everything else by the director.
 *  Delegates to the single shared rule in flow-api.js so the four copies can't drift. */
function prPayOwns(method, role) {
  if (typeof flowPayOwns === 'function') return flowPayOwns(method, role);
  return String(method || '').trim().toLowerCase() === 'telegraphic transfer'
    ? (role === 'accounting' || role === 'admin') : (role === 'director');
}
function prPayOwnerLabel(method) {
  if (typeof flowPayOwnerLabel === 'function') return flowPayOwnerLabel(method);
  return String(method || '').trim().toLowerCase() === 'telegraphic transfer'
    ? 'accounting or admin' : 'the director';
}

async function prInitPayGate() {
  try { prCanPay = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(92) : false; }
  catch (e) { prCanPay = false; }
}

/* ── A224 — the page globals this file used to assume ──────────────────────────────────────────
 *
 * It was written for two pages that both define `prSession`, `prList` and `loadPRs()`. A224 adds a
 * THIRD host — flow-ap-aging.html, where Pay opens this same dialog — and that page has none of them.
 * A bare reference to an undeclared global is a ReferenceError, so it would not degrade: the button
 * would open a dialog that could not submit.
 *
 * Every page global is therefore read through a resolver. The host's own value wins where it exists,
 * so nothing changes on the two original pages; where it does not, the resolver goes to the source —
 * the session from getSession(), the request from the server by number, the reload from whatever the
 * host registered. Including the file is now enough. */
function prActor() {
  if (typeof prSession !== 'undefined' && prSession) return prSession;
  return (typeof getSession === 'function' && getSession()) || {};
}
/** The request row, from the host page's list if it has one, else fetched by number. */
async function prFindRow(no) {
  if (typeof prList !== 'undefined' && Array.isArray(prList)) {
    const hit = prList.filter(r => String(r.prNo) === String(no))[0];
    if (hit) return hit;
  }
  const r = await fetchFlow('getPaymentRequests', {}, { fresh: true });
  return ((r && r.data) || []).filter(x => String(x.prNo) === String(no))[0] || null;
}
/** Reload whatever the host shows. A page that wants its own refresh sets window.prReload. */
async function prReloadHost() {
  if (typeof window !== 'undefined' && typeof window.prReload === 'function') return window.prReload();
  if (typeof loadPRs === 'function') return loadPRs();
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

/** Mark Paid + Attach proof, shown only to a role that owns this payment method.
 *  A224: the membership test must be the same one markPaymentRequestPaid applies, or the button
 *  appears for someone the server will refuse — see prPayOwns. */
function prPayActions(r, B) {
  const no = flowEsc(r.prNo), st = String(r.status || 'Draft');
  if (st === 'Paid') return '';
  if (st !== 'Approved' || !prCanPay) return '';
  if (!prPayOwns(r.paymentMethod, prActor().role)) return '';
  return B(`prAttachProof("${no}")`, 'Attach proof') + B(`prMarkPaid("${no}")`, 'Mark Paid');
}

function prAttachProof(no) {
  // Preset the doc type so the proof is tagged the way the backend gate looks for it.
  openDocsModal('Payment Request', no, 'Proof of payment · ' + no, 'Proof of Payment');
}


/* ══════════════════════════════════════════════════════════════════════════════════════════════
 *  A223 — Mark Paid as a FORM, not a stack of prompts.
 *
 *  A222 recorded the right figures through four sequential prompt() boxes. It worked, but you could
 *  not see what you had already typed, could not correct an earlier answer without cancelling the
 *  whole thing, and only learned the exchange rate you were committing to in a confirm() at the end.
 *  This is the screen someone uses every time money leaves the company, so it shows all four fields
 *  at once and derives the consequences live, BEFORE the commit rather than after it.
 *
 *  Built in JS and appended to <body> rather than written into a page, because this file is loaded by
 *  flow-payment-requests.html, flow-other-payables.html and — since A224 — flow-ap-aging.html. Page
 *  markup would have to be duplicated three times and would then drift. Same approach as
 *  so-cost-editor.js. It is also what makes "one action, two entry points" literally true: Pay on an
 *  AP row and Mark Paid on the request open the SAME dialog and post the SAME payload.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

let _pmpRow = null;                                   // the request currently open in the dialog

function _pmpEl() {
  let el = document.getElementById('pmpModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'pmpModal';
  /* flow.css makes .flow-modal-overlay display:none and ONLY .open reveals it — the class alone
     builds an invisible dialog, which is how a button once became silently dead. */
  el.className = 'flow-modal-overlay';
  el.innerHTML = `
    <div class="flow-modal" style="max-width:560px;" role="dialog" aria-modal="true" aria-labelledby="pmpTitle">
      <h3 id="pmpTitle">Mark Paid</h3>
      <div class="sub" id="pmpSub">—</div>
      <div class="sub" id="pmpOwner" style="margin-top:0.25rem;"></div>

      <div id="pmpFx">
        <div class="group-title">What the bank actually did</div>
        <div class="flow-form">
          <div><label>Actual debited (PHP) *</label><input type="number" step="0.01" min="0" id="pmpDebited" oninput="_pmpRecalc()"></div>
          <div><label>Bank charge (PHP)</label><input type="number" step="0.01" min="0" id="pmpCharge" placeholder="0.00" oninput="_pmpRecalc()"></div>
          <div><label>Value date <span style="font-weight:400;color:var(--text-muted,#64748b);">(the bank's date)</span></label><input type="date" id="pmpValueDate"></div>
        </div>
        <div class="sub" id="pmpDerived" style="margin-top:0.5rem;"></div>
      </div>

      <div class="group-title">Reference</div>
      <div class="flow-form">
        <div class="full"><label>Payment reference <span style="font-weight:400;color:var(--text-muted,#64748b);">(transfer / cheque no)</span></label><input type="text" id="pmpRef" placeholder="optional"></div>
      </div>

      <div class="group-title">Proof of payment</div>
      <div id="pmpProof" class="sub">—</div>

      <div id="pmpMsg" class="flow-msg" style="display:none;"></div>
      <div class="flow-modal-foot">
        <button type="button" class="btn btn-secondary" onclick="_pmpClose()">Cancel</button>
        <button type="button" class="btn btn-primary" id="pmpBtn" onclick="_pmpSubmit()">Mark Paid</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', ev => { if (ev.target === el) _pmpClose(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && el.classList.contains('open')) _pmpClose();
  });
  return el;
}

function _pmpClose() { const el = document.getElementById('pmpModal'); if (el) el.classList.remove('open'); }

/* The whole reason this is a form: settles / rate / difference recomputed on every keystroke, so the
   rate being committed is visible while it can still be corrected. */
function _pmpRecalc() {
  const r = _pmpRow || {};
  const out = document.getElementById('pmpDerived');
  if (!out) return;
  const debited = flowNum(document.getElementById('pmpDebited').value);
  const charge = flowNum(document.getElementById('pmpCharge').value);
  const fc = flowNum(r.amount);
  const est = flowNum(r.amountPHPEst);
  if (!(debited > 0)) { out.innerHTML = 'Enter what the bank debited to see the rate this records.'; return; }
  if (charge > debited) { out.innerHTML = '<b style="color:#b91c1c;">The charge cannot exceed what was debited.</b>'; return; }
  const settles = debited - charge;
  const rate = fc > 0 ? settles / fc : 0;
  const diff = est > 0 ? settles - est : null;
  out.innerHTML =
    `Settles <b>${flowMoney(settles, 'PHP')}</b> against ${fc} ${flowEsc(r.currency || '')}`
    + (charge > 0 ? ` &middot; the ${flowMoney(charge, 'PHP')} charge is our cost and does <b>not</b> reduce what the supplier is owed` : '')
    + (rate > 0 ? `<br>Realised rate <b>&#8369;${rate.toFixed(2)}/${flowEsc(r.currency || '')}</b>` : '')
    + (diff === null ? '' :
        ` &middot; ${Math.abs(diff) < 0.005 ? 'exactly the estimate'
          : `<b>${flowMoney(Math.abs(diff), 'PHP')} ${diff > 0 ? 'more' : 'less'}</b> than the ${flowMoney(est, 'PHP')} estimated`}`);
}

async function _pmpProofCheck(no) {
  const box = document.getElementById('pmpProof');
  const btn = document.getElementById('pmpBtn');
  box.innerHTML = 'Checking…';
  let has = true;
  if (typeof flowHasDoc === 'function') has = await flowHasDoc('Payment Request', no, 'Proof of Payment');
  /* The server refuses without it regardless — this only stops someone filling the whole form and
     being turned away at the end, which is what the old pre-flight alert did. */
  box.innerHTML = has
    ? '<span style="color:#15803d;">&#10003; Proof of payment is attached.</span>'
    : '<span style="color:#b91c1c;">No proof of payment attached — it is required.</span> '
      + `<button type="button" class="link-btn" onclick="prAttachProof('${flowEsc(no)}')">Attach it</button> `
      + `<button type="button" class="link-btn" onclick="_pmpProofCheck('${flowEsc(no)}')">Re-check</button>`;
  if (btn) { btn.disabled = !has; btn.style.opacity = has ? '' : '0.5'; }
  return has;
}

async function prMarkPaid(no) {
  // A224: the host page's list where there is one, else fetched by number — so AP Aging can open
  // the identical dialog without keeping a second copy of the payment requests.
  const r = (await prFindRow(no)) || {};
  if (!r.prNo) { alert('Could not load payment request ' + no + '.'); return; }
  _pmpRow = r;
  const el = _pmpEl();
  const cur = String(r.currency || 'PHP').toUpperCase();
  const isFx = cur !== 'PHP';

  document.getElementById('pmpTitle').textContent = 'Mark Paid · ' + no;
  document.getElementById('pmpSub').innerHTML = isFx
    ? `Owed <b>${flowNum(r.amount)} ${flowEsc(cur)}</b> to ${flowEsc(r.payee || r.supplier || '')}`
      + (flowNum(r.amountPHPEst) > 0 ? ` &middot; estimated ${flowMoney(r.amountPHPEst, 'PHP')} <i>(an estimate only)</i>` : '')
      + (r.paymentMethod ? ` &middot; ${flowEsc(r.paymentMethod)}` : '')
    : `${flowMoney(r.amount, 'PHP')} to ${flowEsc(r.payee || r.supplier || '')}`
      + (r.paymentMethod ? ` &middot; ${flowEsc(r.paymentMethod)}` : '');

  /* A224 — say WHO releases this payment method, at the moment the rule applies. It was invisible:
     the only sign of it was a Mark Paid button that quietly failed to appear, which reads as a broken
     page rather than as "this one is not yours". */
  const own = document.getElementById('pmpOwner');
  if (own) {
    const mine = prPayOwns(r.paymentMethod, prActor().role);
    own.innerHTML = r.paymentMethod
      ? `${flowEsc(r.paymentMethod)} payments are released by <b>${flowEsc(prPayOwnerLabel(r.paymentMethod))}</b>.`
        + (mine ? '' : ' <span style="color:#b91c1c;">The server will refuse this from your role.</span>')
      : '<span style="color:#b91c1c;">No payment method is set on this request — the server will refuse it.</span>';
  }

  /* A PHP obligation has no rate to record, so the whole block is hidden and the dialog behaves
     exactly as it did before A222 — reference, confirm, done. */
  document.getElementById('pmpFx').style.display = isFx ? '' : 'none';
  document.getElementById('pmpDebited').value = isFx && flowNum(r.amountPHPEst) > 0 ? flowNum(r.amountPHPEst).toFixed(2) : '';
  document.getElementById('pmpCharge').value = '';
  document.getElementById('pmpValueDate').value = flowToday();
  document.getElementById('pmpRef').value = '';
  document.getElementById('pmpMsg').style.display = 'none';
  _pmpRecalc();
  el.classList.add('open');
  _pmpProofCheck(no);
}

async function _pmpSubmit() {
  const r = _pmpRow || {};
  const no = String(r.prNo || '');
  const btn = document.getElementById('pmpBtn');
  const isFx = String(r.currency || 'PHP').toUpperCase() !== 'PHP';
  const payload = { prNo: no, paymentRef: document.getElementById('pmpRef').value.trim() };

  if (isFx) {
    const debited = flowNum(document.getElementById('pmpDebited').value);
    const charge = flowNum(document.getElementById('pmpCharge').value);
    if (!(debited > 0)) { flowMsg('pmpMsg', 'Enter the pesos the bank actually debited.', false); return; }
    if (charge > debited) { flowMsg('pmpMsg', 'The bank charge cannot exceed what was debited.', false); return; }
    payload.actualDebitedPHP = debited;
    payload.bankChargePHP = charge;
    payload.valueDate = document.getElementById('pmpValueDate').value;
  }

  btn.disabled = true; btn.textContent = 'Marking paid…';
  try {
    const res = await postFlow('markPaymentRequestPaid', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('pmpMsg', res.message, true);
    await prReloadHost();                        // A224: whichever page opened this
    setTimeout(_pmpClose, 1200);
  } catch (e) {
    flowMsg('pmpMsg', e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Mark Paid';
  }
}
