/* flow-payment-requests.js — Type 'PO' supplier payment requests (PRF).
   Load a PO → request supplier payment. Approval: Admin → Management → Director, then marked Paid
   with proof by the director (bank/online transfers) or accounting (every other method).
   Reuses the legacy PRF PDF via /flow/payment-request-pdf. */

let prSession = null, prCanCreate = false, prPOs = [], prList = [], prAP = {}, prAPCount = {};
let prAPPaid = {};   // A158: per-PO paid-to-date
/* A180: open requests are kept as ROWS, not a per-PO total, because the amount calculator has to be
   able to exclude the request currently being edited. A pre-summed map cannot answer "what is left
   ignoring this record", and without that a revised request counts its own amount against itself —
   remaining reads 0 and the record becomes uneditable. Mirrors the server's
   _poRemainingPayable(poNo, excludePrNo). */
let prOpenReqRows = [];   // [{ poNo, prNo, amount }]
let prSuppliers = {};   // A145: supplier name (lower) → master record, for bank-detail prefill

document.addEventListener('DOMContentLoaded', async () => {
  prSession = requireOversight();           // admin/accounting/management/director
  if (!prSession) return;
  prCanCreate = prSession.role === 'admin' || prSession.role === 'accounting';
  renderNavbar('flow-payment-requests');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-payment-requests.html');
  if (!prCanCreate) document.getElementById('formCard').style.display = 'none';
  else {
    document.getElementById('dueDate').value = '';
    prWatchAmount();          // A180: an overtyped amount marks the portion 'Custom'
    // A224: once someone picks a method deliberately, nothing defaults over it again.
    const _pm = document.getElementById('paymentMethod');
    if (_pm) _pm.addEventListener('change', () => { prMethodTouched = true; });
    await Promise.all([loadPOOptions(), loadSuppliers()]);
    prSyncPortionUi();        // start disabled — no PO is loaded yet
    await Promise.all([prCheckPortionBackend(), prCheckPerPOBackend()]);
    prSyncCreateGate();       // A225: the version gate has resolved, so apply it
  }
  await prInitPayGate();   // A156: Mark Paid only once the backend is v92
  await loadPRs();
});

// A145: supplier master → auto-fill bank details on the payment request.
async function loadSuppliers() {
  prSuppliers = {};
  try {
    const r = await fetchFlow('getSuppliers');
    ((r && r.data) || []).forEach(s => { prSuppliers[String(s.supplier).toLowerCase()] = s; });
  } catch (e) { /* prefill is best-effort */ }
}

async function loadPOOptions() {
  try {
    const [po, ap, reqs] = await Promise.all([
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getAPAging').catch(() => ({ data: [] })),
      fetchFlow('getPaymentRequests').catch(() => ({ data: [] })),
    ]);
    prPOs = (po && po.data) || [];
    prAP = {};
    prAPCount = {};
    prAPPaid = {};
    prOpenReqRows = [];
    ((ap && ap.data) || []).forEach(a => {
      const k = String(a.poNo);
      prAP[k] = (prAP[k] || 0) + (flowNum(a.amountPHP) || 0) - 0;
      prAPPaid[k] = (prAPPaid[k] || 0) + flowNum(a.paidPHP);
      // Count only entries carrying an amount — a zeroed/annotated stale row shouldn't warn.
      if (flowNum(a.amountPHP) > 0) prAPCount[k] = (prAPCount[k] || 0) + 1;
    });
    // A158: what other live requests have already claimed on each PO, so the deposit → balance flow
    // defaults to the REMAINING amount instead of re-requesting the whole payable.
    ((reqs && reqs.data) || []).forEach(r => {
      const st = String(r.status || '');
      if (String(r.type) !== 'PO' || st === 'Rejected' || st === 'Paid') return;
      // A225: `status` rides along for the one-per-PO gate. The filter above already excludes exactly
      // the pair the rule treats as finished, so no second pass and no second fetch is needed.
      prOpenReqRows.push({ poNo: String(r.poNo), prNo: String(r.prNo), status: st, amount: flowNum(r.amount) });
    });
    /* A225 — mark a PO that already carries a live request, so the refusal is visible BEFORE the
       form is filled in. ANNOTATE, never `disabled`: a blocked PO must stay selectable so
       loadFromPO can explain why and name the record. The reasoning at prPortionBlocked below
       applies verbatim — a disabled control with no explanation reads as a broken page. */
    const openOn = poNo => prOpenReqRows.filter(r => r.poNo === String(poNo))[0];
    document.getElementById('loadPO').innerHTML = '<option value="">— select a purchase order —</option>' +
      prPOs.slice().sort((a, b) => (flowDate(b.date) || '').localeCompare(flowDate(a.date) || ''))
        .map(p => {
          const live = openOn(p.poNo);
          return `<option value="${flowEsc(p.poNo)}">${flowEsc(p.poNo)} — ${flowEsc(p.supplier)} (${flowEsc(p.currency)} ${flowNum(p.total).toLocaleString()})`
            + (live ? ` · ${flowEsc(live.prNo)} open` : '') + '</option>';
        }).join('');
  } catch (e) { /* leave empty */ }
}

/** A158: payable − already paid − what other live requests have claimed. A PO is usually settled in
 *  one payment, but when a deposit has gone out the balance request must default to what is LEFT.
 *  A180: excludePrNo leaves ONE request out of the "already claimed" total — pass the record being
 *  edited, or its own amount counts against itself and every edit sees remaining 0. */
function prRemaining(poNo, excludePrNo) {
  const k = String(poNo), skip = String(excludePrNo || '');
  const amount = prAP[k] || 0, paid = prAPPaid[k] || 0;
  const open = prOpenReqRows.reduce((t, r) =>
    (r.poNo === k && r.prNo !== skip) ? t + r.amount : t, 0);
  return { amount, paid, open, remaining: amount - paid - open };
}

/* ══════════════════════════════════════════════════════════════════════════
   A180 — the payment portion: which slice of the PO this request is.
   A PO is often settled 50% down, 50% on delivery. Before this, the only number the form offered was
   the whole remaining payable, so a down payment meant knowing to overtype half by hand — which is
   how PRF-2026-69 and -70 came to be filed for 100% of their POs.
   ══════════════════════════════════════════════════════════════════════════ */
const PR_PORTIONS = ['50% DP', 'Balance', 'Full'];
const prRound2 = v => Math.round(v * 100) / 100;

/** What each portion is worth on a PO. 50% DP is half the FULL payable — that is what "50% DP of the
 *  purchase order" means, and it stays right no matter how many requests came before. Balance is the
 *  RESIDUAL, never half again: on an odd payable (34,146.01) a DP rounds to 17,073.01, so a balance
 *  computed as half would oversubscribe by a centavo and the server's +0.005 cap would refuse it. */
function prPortionAmount(poNo, portion, excludePrNo) {
  const rem = prRemaining(poNo, excludePrNo);
  if (portion === '50% DP') return prRound2(rem.amount / 2);
  if (portion === 'Full') return prRound2(rem.amount);
  if (portion === 'Balance') return prRound2(Math.max(0, rem.remaining));
  return null;
}

/* ── A225 — one live payment request per purchase order ───────────────────────────────────────────
 *
 * The browser's half of the rule. The server refuses the save; this stops someone filling in a whole
 * form first. `prOpenReqRows` already holds exactly the right rows — it is built from a fetch that
 * filters on the same Rejected/Paid pair — so there is no extra call.
 *
 * `prPerPOGateLive` is the version gate. Below FlowAPI v129 the dropdown annotation still shows (it
 * is true either way) but Save is never disabled: between the Render deploy and the Apps Script paste
 * the page must not refuse work the server would happily accept. */
let prPerPOGateLive = false;

async function prCheckPerPOBackend() {
  try { prPerPOGateLive = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(129) : false; }
  catch (e) { prPerPOGateLive = false; }
}

/** Why a NEW request cannot be raised on this PO — '' when it can. */
function prPerPOBlocked(poNo, excludePrNo) {
  if (typeof flowPRPerPOProblem !== 'function') return '';
  const skip = String(excludePrNo || '');
  return flowPRPerPOProblem(poNo, prOpenReqRows.filter(
    r => r.poNo === String(poNo) && r.prNo !== skip));
}

/* Disable Save, with the reason visible, when the loaded PO already carries a live request.
 *
 * Called from loadFromPO, prEdit AND resetForm. prEdit is the one that matters: it sets
 * loadPO.value directly and deliberately never calls loadFromPO, so without re-running the gate
 * here, picking a blocked PO and then clicking Edit on another record would leave Save dead with no
 * visible reason. EDITING IS NEVER GATED — the server's guard is on create only, because the PO
 * cannot be changed by an edit at all. */
function prSyncCreateGate() {
  const btn = document.getElementById('saveBtn');
  const poNo = (document.getElementById('loadPO') || {}).value || '';
  const editing = (document.getElementById('prNo') || {}).value || '';
  const reason = (!editing && poNo && prPerPOGateLive) ? prPerPOBlocked(poNo, editing) : '';
  if (btn) {
    btn.disabled = !!reason;
    btn.title = reason || '';
    btn.style.opacity = reason ? '0.5' : '';
  }
  return reason;
}

/** Why a portion can't be used on this PO — '' when it can. The reason is shown, never swallowed:
 *  a disabled button with no explanation reads as a broken page. */
function prPortionBlocked(poNo, portion, excludePrNo) {
  /* A225 FIRST: when the PO already carries a live request the real cause is that, not the
     arithmetic. Without this the buttons would go grey saying "nothing is left on this PO", which is
     both true and the wrong explanation. */
  if (!excludePrNo) {
    const perPO = prPerPOBlocked(poNo, excludePrNo);
    if (perPO) return perPO;
  }
  const rem = prRemaining(poNo, excludePrNo);
  if (!(rem.amount > 0)) {
    return 'This PO has no payable in AP Aging yet, so there is nothing to take a portion of.';
  }
  // The A144 duplicate-AP case. Create refuses outright; the EDIT path has no such stop, so the
  // calculator must not quietly halve a doubled sum (the PRF-2026-63 incident).
  if ((prAPCount[String(poNo)] || 0) > 1) {
    return 'This PO has more than one AP entry with an amount — the payable would be their sum. ' +
           'Resolve the duplicate in AP Aging before choosing a portion.';
  }
  // Nothing left at all — one honest reason for all three, rather than "only ₱0.00 is still owed".
  if (!(rem.remaining > 0)) {
    return 'Nothing is left on this PO — it is already fully paid or requested.';
  }
  const want = prPortionAmount(poNo, portion, excludePrNo);
  if (want > rem.remaining + 0.005) {
    return `Only ${flowMoney(Math.max(0, rem.remaining), 'PHP')} is still owed on this PO, ` +
           `but ${portion === '50% DP' ? 'a 50% down payment' : 'the full payment'} would be ` +
           `${flowMoney(want, 'PHP')}.`;
  }
  return '';
}

/** Paint the buttons from the hidden field, and enable/disable each against what the PO still owes. */
function prSyncPortionUi() {
  const group = document.getElementById('prPortionGroup');
  if (!group) return;
  const poNo = document.getElementById('loadPO').value;
  const active = document.getElementById('paymentPortion').value;
  const editing = document.getElementById('prNo').value || '';
  PR_PORTIONS.forEach(portion => {
    const btn = group.querySelector(`[data-portion="${portion}"]`);
    if (!btn) return;
    const blocked = poNo ? prPortionBlocked(poNo, portion, editing) : 'Load a purchase order first.';
    btn.disabled = !!blocked;
    btn.setAttribute('aria-pressed', active === portion ? 'true' : 'false');
    btn.title = blocked || `${portion} — ${flowMoney(prPortionAmount(poNo, portion, editing) || 0, 'PHP')}`;
  });
}

/** A button click: set the portion AND the amount it implies. */
function prPickPortion(portion) {
  const poNo = document.getElementById('loadPO').value;
  if (!poNo) return;
  const editing = document.getElementById('prNo').value || '';
  if (prPortionBlocked(poNo, portion, editing)) return;
  document.getElementById('paymentPortion').value = portion;
  document.getElementById('amount').value = prPortionAmount(poNo, portion, editing);
  prSyncPortionUi();
  prRefreshBreakdown(poNo, editing);
}

/** Set the portion without touching the amount — for restoring a saved record. */
function prSetPortion(portion) {
  document.getElementById('paymentPortion').value =
    PR_PORTIONS.indexOf(portion) === -1 && portion !== 'Custom' ? '' : portion;
  prSyncPortionUi();
}

/* Hand-editing the amount means the portion no longer describes it. 'Custom' is kept DISTINCT from
   '': '' means nothing was chosen (a legacy row, an Other payable) and prints nothing on the PDF,
   while 'Custom' means deliberately hand-set and still prints the total and balance. Programmatic
   .value writes do not fire 'input', so our own writes above can't trip this. */
function prWatchAmount() {
  const amt = document.getElementById('amount');
  if (!amt || amt._prWatched) return;
  amt._prWatched = true;
  amt.addEventListener('input', () => {
    const active = document.getElementById('paymentPortion').value;
    if (!active || active === 'Custom') return;
    const poNo = document.getElementById('loadPO').value;
    const editing = document.getElementById('prNo').value || '';
    const want = prPortionAmount(poNo, active, editing);
    if (want === null || Math.abs(flowNum(amt.value) - want) > 0.005) prSetPortion('Custom');
  });
}

/** The payable breakdown under the amount, including what each portion would be worth. */
function prRefreshBreakdown(poNo, excludePrNo) {
  const bd = document.getElementById('apBreakdown');
  if (!bd) return;
  const rem = prRemaining(poNo, excludePrNo);
  bd.style.display = rem.amount > 0 ? '' : 'none';
  if (!(rem.amount > 0)) { bd.innerHTML = ''; return; }
  bd.innerHTML = `Payable ${flowMoney(rem.amount, 'PHP')}` +
    (rem.paid > 0 ? ` · paid ${flowMoney(rem.paid, 'PHP')}` : '') +
    (rem.open > 0 ? ` · other open requests ${flowMoney(rem.open, 'PHP')}` : '') +
    ` → <strong>remaining ${flowMoney(Math.max(0, rem.remaining), 'PHP')}</strong>` +
    `<br>50% DP ${flowMoney(prRound2(rem.amount / 2), 'PHP')} · ` +
    `balance ${flowMoney(Math.max(0, prRound2(rem.remaining)), 'PHP')} · ` +
    `full ${flowMoney(prRound2(rem.amount), 'PHP')}`;
}

/* The portion is stored by FlowAPI v101. Below that the buttons still work — they are a useful amount
   calculator either way — but the label itself would be dropped on save, so say so rather than let it
   vanish silently. Mirrors prInitPayGate's shape (flow-pr-actions.js:31). */
async function prCheckPortionBackend() {
  const note = document.getElementById('prPortionNote');
  if (!note) return;
  let okv = false;
  try { okv = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(101) : false; }
  catch (e) { okv = false; }
  note.style.display = okv ? 'none' : '';
  note.innerHTML = okv ? '' :
    '⚠ The buttons still calculate the amount, but the backend has not been updated to v101 yet, ' +
    'so which portion you picked will not be recorded or printed on the PRF.';
}

/* A222 — which currency is this request denominated in?
 *
 * A foreign purchase is owed in the supplier's currency: the obligation is USD 202, exactly, and the
 * peso is whatever the bank charges on the day. The form used to type pesos and the server used to
 * force 'PHP', so the peso estimate was recorded as though it were the debt. The box now follows the
 * ORDER, and the payload says so explicitly — without that the server would take the PO's currency
 * while the user was still typing pesos, and record a USD 119,083 obligation on an SGD order. */
function prPOCurrency(poNo) {
  const p = prPOs.find(x => String(x.poNo) === String(poNo));
  return String((p && p.currency) || 'PHP').toUpperCase();
}

/** Repaint the amount label, and show the peso estimate beside a foreign amount. */
function prSyncCurrencyUi(poNo) {
  const cur = prPOCurrency(poNo);
  const lbl = document.getElementById('amountLabel');
  const note = document.getElementById('prFxNote');
  if (lbl) lbl.textContent = 'Amount (' + cur + ') *';
  if (!note) return;
  if (cur === 'PHP') { note.style.display = 'none'; note.textContent = ''; return; }
  const p = prPOs.find(x => String(x.poNo) === String(poNo)) || {};
  const amt = flowNum(document.getElementById('amount').value);
  const totFC = flowNum(p.total), estPHP = flowNum(p.totalPHP);
  // Pro-rated from the ORDER's own estimate so the request can never imply a different rate from it.
  const est = (totFC > 0 && estPHP > 0 && amt > 0) ? (estPHP * amt / totFC)
            : (flowNum(p.exchangeRate) > 0 && amt > 0 ? amt * flowNum(p.exchangeRate) : 0);
  note.style.display = '';
  note.innerHTML = est > 0
    ? `This is the amount owed in <b>${flowEsc(cur)}</b>. Estimated cost <b>≈ ${flowMoney(est, 'PHP')}</b> ` +
      `— an estimate only; the real peso figure is recorded when the payment is marked paid.` +
      (p.fxBasis ? ` <span style="opacity:.8;">(${flowEsc(p.fxBasis)})</span>` : '')
    : `This is the amount owed in <b>${flowEsc(cur)}</b>. The order carries no peso estimate, so none is shown — ` +
      `the real figure is recorded when the payment is marked paid.`;
}

/* ── A224 — the payment method, defaulted rather than locked ──────────────────────────────────────
 *
 * The company's own description is "usually telegraphic transfer" for international suppliers and
 * "almost every time bank transfer or online" for local ones. Both of those words matter: a LOCK
 * would block the genuine exception instead of flagging it, so this only chooses the opening value
 * and leaves the select fully editable.
 *
 * It reads the PURCHASE ORDER'S CURRENCY rather than the sales order's supplier type, and that is
 * deliberate. A224 makes the currency follow the supplier type, so on any order that has one they say
 * the same thing — but the currency is a property of the order in front of you, already loaded here,
 * and it keeps working for a restock PO with no sales order and for the 13 orders nobody has
 * classified. A USD purchase is a wire whether or not anyone has ticked a box.
 *
 * The supplier master still wins where it names a method, because a specific supplier's known
 * arrangement beats a rule of thumb. And a deliberate choice beats both — see prMethodTouched. */
let prMethodTouched = false;

/** Match a stored free-text method onto one of the select's options, case-insensitively.
 *  The sheet holds whatever was typed; `select.value = 'bank transfer'` matches no option and would
 *  silently blank the control, which is how a request reaches Mark Paid with no method at all. */
function prMethodOption(v) {
  const sel = document.getElementById('paymentMethod');
  const want = String(v || '').trim().toLowerCase();
  if (!sel || !want) return '';
  const hit = Array.from(sel.options).find(o => String(o.value).trim().toLowerCase() === want);
  return hit ? hit.value : '';
}

/** Telegraphic Transfer for a foreign order, Bank Transfer for a peso one. */
function prDefaultMethod(poNo) {
  return prPOCurrency(poNo) !== 'PHP' ? 'Telegraphic Transfer' : 'Bank Transfer';
}

function loadFromPO() {
  const no = document.getElementById('loadPO').value;
  const p = prPOs.find(x => String(x.poNo) === String(no));
  if (!p) return;
  document.getElementById('payee').value = p.supplier || '';
  const editing = document.getElementById('prNo').value || '';
  const rem = prRemaining(no, editing);
  /* A180: default to the portion that NAMES what the amount box has always shown here — the whole
     remaining payable. On a virgin PO that is 'Full'; once anything is paid or requested it is
     'Balance'. So the default behaviour is unchanged and the buttons merely label it. */
  const dflt = (rem.paid > 0 || rem.open > 0) ? 'Balance' : 'Full';
  const picked = prPortionBlocked(no, dflt, editing) ? '' : dflt;
  document.getElementById('paymentPortion').value = picked;
  /* A222 — prefill in the currency the box is now labelled in. prRemaining reads APAging's peso
     columns, so on a foreign order it returns pesos; dropping that into a box labelled USD would
     seed the obligation at ~60x. The foreign remainder needs no rate: it is the order's own FC total
     less every non-Rejected request already raised against it, in the same currency. */
  const curNow = prPOCurrency(no);
  let seed = rem.remaining;
  if (curNow !== 'PHP') {
    const claimed = (prList || []).filter(x => String(x.poNo) === String(no)
        && String(x.prNo) !== String(editing)
        && String(x.status) !== 'Rejected'
        && String(x.currency || 'PHP').toUpperCase() === curNow)
      .reduce((t, x) => t + flowNum(x.amount), 0);
    seed = flowNum(p.total) - claimed;
  }
  document.getElementById('amount').value = seed > 0 ? prRound2(seed) : '';
  prRefreshBreakdown(no, editing);
  prSyncPortionUi();
  prSyncCurrencyUi(no);            // A222: the box must say which currency is being typed
  document.getElementById('purpose').value = `Supplier payment for ${p.poNo}` + (p.soNo ? ` (SO ${p.soNo})` : '');
  // A145: prefill bank details from the supplier master (only into blank fields — never clobber a typed value).
  const sup = prSuppliers[String(p.supplier || '').toLowerCase()];
  if (sup) {
    const fill = (id, v) => { const el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
    fill('bankName', sup.bankName); fill('accountName', sup.accountName);
    fill('accountNumber', sup.accountNumber);
    /* A224 — `fill('paymentMethod', ...)` was here and NEVER ONCE FIRED. A <select> always reports its
       first option as its value, so `!el.value` is never true for it: the bank fields prefilled and
       the method silently did not, for every request ever raised on this page. It is handled below
       instead, where the supplier's method and the supplier-type default can be ranked properly. */
  }
  /* A224 — the opening value: a deliberate pick wins, then the supplier master, then the rule. */
  const msel = document.getElementById('paymentMethod');
  if (msel && !prMethodTouched) {
    msel.value = (sup && prMethodOption(sup.paymentMethod)) || prDefaultMethod(no);
  }
  // Duplicate-AP guard (the PRF-2026-63 incident): the amount is the SUM of every AP entry for this
  // PO — if more than one carries an amount, say so loudly instead of silently doubling.
  const warn = document.getElementById('apDupWarn');
  if (warn) {
    const n = prAPCount[String(no)] || 0;
    const msgs = [];
    /* A225 FIRST and styled as a refusal, not an amber FYI — it is the reason Save is disabled, so it
       has to be the first thing read. The AP-duplicate and already-partly-paid notes stay below it. */
    const perPO = prSyncCreateGate();
    if (perPO) msgs.push(`<span style="color:#b91c1c;">🚫 ${flowEsc(perPO)}</span>`);
    if (n > 1) msgs.push(`⚠ ${n} AP entries found for this PO — the payable above is their SUM. Check AP Aging for stale duplicates before submitting; the portion buttons stay disabled until it is resolved.`);
    // A158: a second request on the same PO is legitimate (deposit → balance) but worth flagging,
    // since re-requesting the full payable is exactly how a PO gets paid twice.
    /* A180: it no longer necessarily "covers the remainder" — that is now a choice. State a FACT
       rather than which button is selected: this text is rendered once on load, so naming the
       current selection would go stale the moment the user picks a different portion. */
    if (rem.paid > 0 || rem.open > 0) {
      msgs.push(`ℹ This PO already has ${rem.paid > 0 ? flowMoney(rem.paid, 'PHP') + ' paid' : ''}` +
        `${rem.paid > 0 && rem.open > 0 ? ' and ' : ''}` +
        `${rem.open > 0 ? flowMoney(rem.open, 'PHP') + ' requested' : ''} — ` +
        (picked ? 'pick Balance for just what is left, or 50% DP for half the whole PO.'
                : 'nothing is left to request, so no portion can be chosen.'));
    }
    warn.style.display = msgs.length ? '' : 'none';
    warn.innerHTML = msgs.join('<br>');
  }
}

async function savePR() {
  const poNo = document.getElementById('loadPO').value;
  if (!poNo) { flowMsg('formMsg', 'Select a purchase order.', false); return; }
  const amount = flowNum(document.getElementById('amount').value);
  if (!(amount > 0)) { flowMsg('formMsg', 'Enter an amount greater than zero.', false); return; }
  const editing = document.getElementById('prNo').value;
  // A144 duplicate-AP hard stop (was a soft warning): the amount is the SUM of every amount-bearing AP
  // row for this PO — a stale second row doubles it. Refuse to create until AP Aging is cleaned up.
  if (!editing && (prAPCount[String(poNo)] || 0) > 1) {
    flowMsg('formMsg', `This PO has ${prAPCount[String(poNo)]} AP entries with an amount — the payable would be their sum. Remove the stale duplicate in AP Aging first.`, false);
    return;
  }
  /* A225 — the last-line mirror. prOpenReqRows is a page-load snapshot, so this catches a form left
     open while somebody else raised a request on the same PO. The server still has the final word;
     this only saves the round trip and gives the same wording. Create path only — an edit cannot move
     a request onto another PO, and the server refuses that separately. */
  if (!editing) {
    const perPO = prPerPOBlocked(poNo, editing);
    if (perPO) { flowMsg('formMsg', perPO, false); return; }
  }
  /* A158: never let a request ask for more than is still owed — the server enforces the same cap.
     A180: this now runs on the EDIT path too, since updatePaymentRequest finally caps as well. The
     record being edited is excluded, or its own amount counts against itself and every edit fails. */
  {
    const rem = prRemaining(poNo, editing);
    if (rem.amount > 0 && amount > rem.remaining + 0.005) {
      flowMsg('formMsg', `That exceeds what is still owed on ${poNo}: payable ${flowMoney(rem.amount, 'PHP')}` +
        (rem.paid > 0 ? ` less paid ${flowMoney(rem.paid, 'PHP')}` : '') +
        (rem.open > 0 ? ` less other open requests ${flowMoney(rem.open, 'PHP')}` : '') +
        ` = ${flowMoney(Math.max(0, rem.remaining), 'PHP')} remaining.`, false);
      return;
    }
  }
  const payload = {
    prNo: editing || (document.getElementById('prNoInput').value || '').trim(),
    type: 'PO', poNo, payee: document.getElementById('payee').value.trim(), amount,
    /* A222 — send the currency EXPLICITLY. The server adopts the PO's currency for a PO-type
       request, so a payload that stays silent would have the amount stored under the order's
       currency while the user was still typing pesos — recording a USD 119,083 obligation on an
       SGD order. Sending it means the two can never disagree about what was typed. */
    currency: prPOCurrency(poNo),
    paymentPortion: document.getElementById('paymentPortion').value,   // A180
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
  if (!editing) payload.clientRef = flowClientRef();   // A145: idempotent create (safe retry)
  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow(editing ? 'updatePaymentRequest' : 'createPaymentRequest', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message}`, true);
    // A145: self-populate the supplier master with any newly-typed bank details (best-effort, non-blocking).
    if (payload.payee && (payload.bankName || payload.accountNumber || payload.accountName || payload.paymentMethod)) {
      const prev = prSuppliers[String(payload.payee).toLowerCase()] || {};
      postFlow('saveSupplier', {
        supplier: payload.payee,
        bankName: payload.bankName || prev.bankName || '',
        accountName: payload.accountName || prev.accountName || '',
        accountNumber: payload.accountNumber || prev.accountNumber || '',
        paymentMethod: payload.paymentMethod || prev.paymentMethod || '',
        currency: payload.currency || prev.currency || ''
      }).catch(() => {});
    }
    resetForm();
    // A180: loadPOOptions too — the AP/open-request maps are built once at page load, so without this
    // the portion buttons would keep calculating from a payable that this very save just changed.
    await Promise.all([loadPRs(), loadSuppliers(), loadPOOptions()]);
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Payment Request'; }
}

function resetForm() {
  ['prNo', 'loadPO', 'payee', 'amount', 'bankName', 'accountName', 'accountNumber', 'department', 'prNoInput', 'purpose', 'remarks', 'dueDate', 'paymentPortion'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pni = document.getElementById('prNoInput'); if (pni) pni.disabled = false;
  document.getElementById('formTitle').textContent = 'New Payment Request (Purchase Order)';
  document.getElementById('formMsg').style.display = 'none';
  // A180: clear the pressed state and re-disable the group — no PO is loaded any more.
  const bd = document.getElementById('apBreakdown'); if (bd) { bd.style.display = 'none'; bd.innerHTML = ''; }
  /* A224: a fresh form takes the default again. Without this, editing one request would make its
     method stick to every request raised afterwards in the same session. */
  prMethodTouched = false;
  prSyncPortionUi();
  prSyncCreateGate();    // A225: no PO loaded any more, so Save is free again
}

async function loadPRs() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getPaymentRequests', { type: 'PO' });
    prList = (res && res.data) || [];
    renderPRs();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

/** Still in play: everything before it is paid or rejected. */
function prIsOpen(r) {
  const st = String(r.status || 'Draft');
  return st !== 'Paid' && st !== 'Rejected';
}
/* A180: the column count lived as a bare `8` in the footer call while the headers lived here — exactly
   the pair that rots when a column is added. Derive one from the other. Portion sits AFTER Amount, so
   the footer's total stays at index 3 and only the span moves. */
const PR_COLS = 9;

function prHead() {
  return `<thead><tr><th>PR No</th><th>PO</th><th>Payee</th><th class="num">Amount</th><th>Portion</th><th>Status</th><th>Approvals</th><th>PDF</th><th></th></tr></thead>`;
}

/** A180: which slice of the PO this request is. '' on every pre-A180 row — an em-dash, never a guess. */
function prPortionCell(r) {
  const p = String(r.paymentPortion || '');
  if (!p) return '<span style="color:var(--text-muted,#64748b);">—</span>';
  const total = flowNum(r.poTotal);
  const label = p === 'Custom' ? 'Partial' : p;
  const tip = total > 0 ? ` title="of ${flowEsc(flowMoney(total, 'PHP'))} payable"` : '';
  const tone = p === 'Full' ? '#0f766e' : '#b45309';
  return `<span${tip} style="font-size:0.72rem;font-weight:700;color:${tone};border:1px solid currentColor;` +
         `border-radius:999px;padding:1px 7px;white-space:nowrap;">${flowEsc(label)}</span>`;
}
function prApplyFilter() { renderPRs(); }

/* A157: open requests up top with a totals footer, settled/rejected ones collapsed below — and every
   KPI computed from the open rows this very render just listed. The cards used to come from a separate
   one-shot fetch that never re-ran, so approving or paying a request left them stale. */
function renderPRs() {
  const c = document.getElementById('listContainer');
  if (!c) return;
  flowLedgerInjectCss();
  if (!prList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No payment requests yet.</p>'; prUpdateKpis([]); return; }
  flowLedgerBuildPeriod(prList, 'createdAt', 'prYear', 'prMonth');
  const rows = flowLedgerFilterPeriod(prList, 'createdAt', 'prYear', 'prMonth');
  const { open, history } = flowLedgerSplit(rows, prIsOpen);

  const openTable = open.length
    ? `<table class="flow-table">${prHead()}<tbody>${open.map(prRow).join('')}${flowLedgerFootRow([{ at: 3, value: flowMoney(open.reduce((t, r) => t + flowNum(r.amount), 0), 'PHP') }], PR_COLS)}</tbody></table>`
    : '<p style="color:var(--text-muted,#64748b);">No open payment requests in this period.</p>';
  const histTable = history.length
    ? `<table class="flow-table">${prHead()}<tbody>${history.map(prRow).join('')}</tbody></table>` : '';

  c.innerHTML =
    `<div class="lv-sec-title">Open requests <span class="lv-sub">· ${open.length} listed · the totals above cover exactly these</span></div>`
    + openTable
    + flowLedgerHistoryBlock({
        title: 'Paid & rejected requests',
        count: history.length,
        subtotalLabel: 'paid',
        subtotal: history.filter(r => String(r.status) === 'Paid').reduce((t, r) => t + flowNum(r.amount), 0),
        tableHtml: histTable
      });
  prUpdateKpis(open);
}

function prUpdateKpis(open) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const st = r => String(r.status || '').toLowerCase();
  // A156 put both types on Admin → Management → Director; the old tiles only covered two of the three,
  // so anything sitting at Pending Admin was counted nowhere.
  set('kpiAdmin', (open || []).filter(r => st(r) === 'pending admin' || st(r) === 'pending accounting').length);
  set('kpiMgmt', (open || []).filter(r => st(r) === 'pending management' || st(r) === 'pending final').length);
  set('kpiDir', (open || []).filter(r => st(r) === 'pending director').length);
  set('kpiApproved', (open || []).filter(r => st(r) === 'approved').length);
  set('kpiOpenVal', flowMoney((open || []).reduce((t, r) => t + flowNum(r.amount), 0), 'PHP'));
  const sub = document.getElementById('kpiOpenValSub');
  if (sub) sub.textContent = (open || []).length + ' open request(s)';
  set('kpiPaidCount', prList.filter(r => String(r.status) === 'Paid').length);
}

function prRow(r) {
  const st = r.status || 'Draft';
  const note = (st === 'Rejected' && r.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(r.approvalNote)}</div>` : '';
  // A156: three sign-offs then payment — show how far along it is, not just the status word.
  const appr = [r.adminApprovedBy ? 'Admin ✓' : (r.acctApprovedBy ? 'Acct ✓' : ''),
    r.mgmtApprovedBy ? 'Mgmt ✓' : '', r.dirApprovedBy ? 'Dir ✓' : '',
    r.paidBy ? 'Paid ✓' : '']
    .filter(Boolean).join(' · ') || '<span style="color:var(--text-muted,#64748b);">—</span>';
  return `<tr><td>${flowEsc(r.prNo)}</td><td>${flowEsc(r.poNo)}</td><td>${flowEsc(r.payee)}</td>
    <td class="num">${flowMoney(r.amount, 'PHP')}</td><td>${prPortionCell(r)}</td>
    <td>${flowStatusBadge(st)}${note}</td>
    <td style="font-size:0.74rem;color:var(--text-secondary,#475569);">${appr}</td>
    <td>${r.pdfLink ? `<a href="${flowEsc(r.pdfLink)}" target="_blank" class="link-btn">View</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;">${prActions(r)}</td></tr>`;
}

function prActions(r) {
  const no = flowEsc(r.prNo), st = r.status || 'Draft', role = prSession.role;
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.4rem;">${label}</button>`;
  let a = `<button class="link-btn" onclick='prGenPdf("${no}")'>PDF</button>` + B(`openDocsModal("Payment Request","${no}")`, 'Docs');
  const editable = st === 'Draft' || st === 'Rejected';
  if (prCanCreate) {
    if (editable) {
      a += B(`prSubmit("${no}")`, 'Submit');
      a += B(`prEdit("${no}")`, 'Edit');
      a += B(`prDelete("${no}")`, 'Delete', 'del-btn');
    } else if (st !== 'Paid') {
      // A158: Edit used to render at every status but the server refuses it once the request is in
      // flight — so a wrong bank account on an approved PRF had no way out short of a sheet edit.
      // Revise is that way out: it reopens to Draft and clears the approvals, exactly as the
      // Other-payables page has always done.
      a += B(`prRevise("${no}")`, 'Revise');
    }
  }
  a += prApprovalActions(r, B);
  a += prPayActions(r, B);
  return a;
}

async function _prAct(action, no, extra) {
  try { const res = await postFlow(action, Object.assign({ prNo: no }, extra || {})); if (!res.success) throw new Error(res.message); await loadPRs(); }
  catch (e) { alert(e.message); }
}
async function prSubmit(no) {
  // A144: require a supporting document before the payment request advances to approval.
  if (typeof flowHasDoc === 'function' && !(await flowHasDoc('Payment Request', no))) {
    alert('Attach a supporting document before submitting ' + no + '. Opening the Docs window…');
    // A195: preset the type — this prompt used to open the box untyped (see flow-purchase-orders.js).
    openDocsModal('Payment Request', no, 'Supporting documents · ' + no, 'proof of payment');
    return;
  }
  if (confirm('Submit ' + no + ' for approval (Admin → Management → Director)?')) _prAct('submitPaymentRequest', no);
}
function prApprove(no) { _prAct('approvePaymentRequest', no); }
function prReject(no) { const reason = prompt('Reason for rejecting ' + no + ' (optional):', ''); if (reason === null) return; _prAct('rejectPaymentRequest', no, { reason }); }
function prDelete(no) { if (confirm('Delete payment request ' + no + '?')) _prAct('deletePaymentRequest', no); }

/* A158: the way back into a submitted or approved request. Editing one in flight is refused by the
   server — deliberately, since silently rewriting an approved payment's bank account is exactly the
   thing approvals exist to prevent — so correcting one means reopening it and re-approving. */
async function prRevise(no) {
  if (!confirm(`Reopen ${no} for revision?\n\nIt returns to Draft and ALL approvals (Admin, Management, Director) are cleared — it must be approved again before payment.`)) return;
  const reason = prompt('Reason for the revision (optional — e.g. "wrong account number"):', '');
  if (reason === null) return;
  try {
    const res = await postFlow('revisePaymentRequest', { prNo: no, reason });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not reopen this payment request.');
    await loadPRs();
    prEdit(no);                 // land in the form, prefilled and ready to correct
  } catch (e) { alert(e.message); }
}

function prEdit(no) {
  const r = prList.find(x => x.prNo === no); if (!r) return;
  document.getElementById('prNo').value = r.prNo;
  document.getElementById('loadPO').value = r.poNo;
  document.getElementById('payee').value = r.payee || '';
  document.getElementById('amount').value = r.amount || '';
  document.getElementById('bankName').value = r.bankName || '';
  document.getElementById('accountName').value = r.accountName || '';
  document.getElementById('accountNumber').value = r.accountNumber || '';
  /* A224: through the case-insensitive matcher, and the record's OWN method is a deliberate choice —
     it must survive the loadPO select being set beside it. `r.paymentMethod` is free text from the
     sheet, so assigning it raw could match no option and blank the control. */
  document.getElementById('paymentMethod').value =
    prMethodOption(r.paymentMethod) || prDefaultMethod(r.poNo);
  prMethodTouched = true;
  document.getElementById('department').value = r.department || '';
  document.getElementById('dueDate').value = flowDate(r.dueDate) || '';
  document.getElementById('purpose').value = r.purpose || '';
  document.getElementById('remarks').value = r.remarks || '';
  const pni = document.getElementById('prNoInput'); pni.value = r.prNo; pni.disabled = true;
  /* A180: restore the saved portion WITHOUT recomputing the amount — deliberately consistent with the
     loadPO line above, which sets the select but never calls loadFromPO(). The breakdown is refreshed
     though (it used to be left stale here), so the editor can see the payable while re-choosing, and
     it excludes this record so its own amount doesn't read as already claimed. */
  prSetPortion(r.paymentPortion || '');
  prRefreshBreakdown(r.poNo, r.prNo);
  /* A225 — MUST run here. prEdit sets loadPO.value directly and deliberately never calls loadFromPO,
     so without this, picking a blocked PO and then clicking Edit on another record would leave Save
     disabled with no visible reason. Editing always re-enables: #prNo is set by now, and the gate
     returns early for an edit. */
  prSyncCreateGate();
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
      // A180: from the RECORD, not recomputed — the payable is snapshotted at save time, and a
      // management/director viewer never loads the AP maps, so computing it here would print a blank.
      paymentPortion: r.paymentPortion || '', poTotal: r.poTotal || '', poPaidBefore: r.poPaidBefore || '',
      // A222: the peso estimate, printed under a foreign obligation and labelled as an estimate.
      amountPHPEst: r.amountPHPEst || '',
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
