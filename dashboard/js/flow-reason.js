/* A331 — the one "this needs a reason" dialog, shared by every page that saves orders, invoices or payments.

   When a save breaks a safeguard (EWT off, billing above the order, a cheque already used…) FlowAPI 169
   answers { success:false, needsReason:'rule,rule', problems:[{rule, ref, expected, entered, message}] }
   and writes nothing. This shows what was expected and what was entered, asks why, and the page resends
   the SAME payload (same clientRef) with overrideReason. The reason lands on the Overrides sheet, which
   the Month check lists, so an override is a recorded decision rather than a click-through.

     flowAskReason(res)            → Promise<string|null>   the reason typed, or null if cancelled
     flowWithReason(res, resend)   → if res needs a reason, ask, then return resend({ overrideReason });
                                     otherwise return res unchanged. Fits the pages' existing confirm loops.

   Needs flow-api.js (flowEsc, flowMoney) and flow.css (.flow-modal-overlay). */

const FLOW_REASON_MIN = 10;   // the server refuses shorter (_sgResolve)

const FLOW_REASON_RULES = {
  ewtMissing:         'No EWT entered',
  ewtMismatch:        'EWT is not what the customer’s rate gives',
  overCollect:        'More than the balance due',
  zeroReceivable:     'Nothing is due on this invoice',
  duplicatePayment:   'This looks like a payment already recorded',
  duplicateReference: 'This cheque or reference was already used',
  overBilling:        'Billing goes above the sales order total',
  duplicateInvoice:   'This looks like an invoice already raised',
  reinvoice:          'This sales order is already invoiced',
  vatTypeMismatch:    'The VAT type differs from the sales order',
  unknownCustomer:    'The customer is not on the Clients list',
  bulkImport:         'Bulk import of payments'
};

function _flowReasonVal(v) {
  if (v === '' || v == null) return '—';
  return typeof v === 'number' ? flowMoney(v, 'PHP') : String(v);
}

function _flowReasonEl() {
  let el = document.getElementById('flowReasonModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'flowReasonModal';
  el.className = 'flow-modal-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'flowReasonTitle');
  el.innerHTML = `
    <div class="flow-modal" style="max-width:560px;">
      <h3 id="flowReasonTitle">This needs a reason</h3>
      <div class="sub">Nothing has been saved yet. Check the figures below. If they are right, say why and save; the reason is recorded and shown on the Month check.</div>
      <div id="flowReasonList"></div>
      <div class="flow-form" style="margin-top:.75rem;">
        <div class="full">
          <label for="flowReasonText">Reason <span style="font-weight:400;color:var(--hx-ink-3);">— at least ${FLOW_REASON_MIN} characters, e.g. “2307 to follow”, “withheld on gross per the 2307”</span></label>
          <textarea id="flowReasonText" rows="3" maxlength="300" style="width:100%;"></textarea>
          <div id="flowReasonCount" style="font-size:12px;color:var(--hx-ink-3);margin-top:.25rem;"></div>
        </div>
      </div>
      <div class="flow-modal-foot">
        <button type="button" class="btn btn-secondary" id="flowReasonCancel">Don’t save</button>
        <button type="button" class="btn btn-primary primary" id="flowReasonOk" disabled>Save with this reason</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function flowAskReason(res) {
  const el = _flowReasonEl();
  const problems = (res && res.problems && res.problems.length) ? res.problems
    : [{ rule: String((res && res.needsReason) || ''), message: (res && res.message) || '' }];
  document.getElementById('flowReasonList').innerHTML = problems.map(p => {
    const showFig = !(p.expected === undefined && p.entered === undefined);
    return `<div style="border:1px solid var(--hx-glass-line);border-radius:var(--hx-r-md, 10px);padding:.6rem .75rem;margin-top:.5rem;">
      <div style="font-weight:700;">${flowEsc(FLOW_REASON_RULES[p.rule] || p.rule || 'Check this')}${p.ref ? ` <span style="font-weight:400;color:var(--hx-ink-3);">· ${flowEsc(p.ref)}</span>` : ''}</div>
      ${showFig ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:.15rem .75rem;margin-top:.35rem;font-variant-numeric:tabular-nums;">
        <span style="color:var(--hx-ink-3);">Expected</span><span>${flowEsc(_flowReasonVal(p.expected))}</span>
        <span style="color:var(--hx-ink-3);">Entered</span><span>${flowEsc(_flowReasonVal(p.entered))}</span></div>` : ''}
      <div style="font-size:12.5px;color:var(--hx-ink-2, var(--hx-ink-3));margin-top:.35rem;">${flowEsc(p.message || '')}</div>
    </div>`;
  }).join('');
  const txt = document.getElementById('flowReasonText');
  const okBtn = document.getElementById('flowReasonOk');
  const cancel = document.getElementById('flowReasonCancel');
  const count = document.getElementById('flowReasonCount');
  txt.value = '';
  const refresh = () => {
    const n = txt.value.trim().length;
    okBtn.disabled = n < FLOW_REASON_MIN;
    // never empty: the line keeps its height, so the buttons do not jump as the reason is typed
    count.textContent = n < FLOW_REASON_MIN ? (FLOW_REASON_MIN - n) + ' more characters needed' : 'Recorded with your name when you save.';
  };
  refresh();
  const back = document.activeElement;
  el.classList.add('open');
  setTimeout(() => txt.focus(), 30);
  return new Promise(resolve => {
    const done = (val) => {
      el.classList.remove('open');
      txt.oninput = okBtn.onclick = cancel.onclick = el.onkeydown = el.onclick = null;
      if (back && back.focus) try { back.focus(); } catch (e) { /* the opener may be gone */ }
      resolve(val);
    };
    txt.oninput = refresh;
    okBtn.onclick = () => { if (!okBtn.disabled) done(txt.value.trim()); };
    cancel.onclick = () => done(null);
    el.onclick = (e) => { if (e.target === el) done(null); };
    el.onkeydown = (e) => { if (e.key === 'Escape') done(null); };
  });
}

/* res came back from a save. If it needs a reason, ask; resend(extra) must post the same payload plus
   extra and return the new response. A cancelled dialog returns a plain refusal the page can show. */
async function flowWithReason(res, resend) {
  if (!res || res.success || !res.needsReason) return res;
  const reason = await flowAskReason(res);
  if (!reason) return { success: false, cancelled: true, message: 'Not saved. ' + (res.message || '') };
  return resend({ overrideReason: reason });
}
