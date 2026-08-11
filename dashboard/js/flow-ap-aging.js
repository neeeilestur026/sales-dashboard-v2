/* flow-ap-aging.js — edit PHP amount / status / payment on PO-generated payables */
let apData = [];
let apSession = null;
let apCanDelete = false;   // A145: only admin/accounting may remove a stale AP row
let apReqByNo = {};        // A224: PR No → the payment request, so the row knows its method + status

document.addEventListener('DOMContentLoaded', async () => {
  apSession = requireOversight();
  if (!apSession) return;
  apCanDelete = apSession.role === 'admin' || apSession.role === 'accounting';
  renderNavbar('flow-ap-aging');
  renderFlowNav('flow-ap-aging.html');
  /* A224 — this page now hosts the Mark Paid dialog from flow-pr-actions.js. Two things it needs:
     the version gate that file owns, and a way to reload THIS page after a payment (the file was
     written for pages that define loadPRs()). */
  if (typeof prInitPayGate === 'function') await prInitPayGate();
  window.prReload = loadAP;
  await loadAP();
});

async function loadAP() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    /* A224 — the payment requests come with the payables. The AP row already carries prNo and
       prStatus, but not the PAYMENT METHOD, and the method is what decides who may release the
       money — so without this the Pay button could not apply the same test the server applies. */
    const [res, reqs] = await Promise.all([
      fetchFlow('getAPAging'),
      fetchFlow('getPaymentRequests', { type: 'PO' }).catch(() => ({ data: [] }))
    ]);
    apData = (res && res.data) || [];
    apReqByNo = {};
    ((reqs && reqs.data) || []).forEach(r => { apReqByNo[String(r.prNo)] = r; });
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
  flowLedgerInjectCss();
  if (!apData.length) {
    c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No payables yet. Create a Purchase Order to generate one.</p>';
    updateKpis([]); return;
  }
  flowLedgerBuildPeriod(apData, 'createdAt', 'apYear', 'apMonth');
  // A157: the period filter runs on Created At — AP due dates are mostly blank, so filtering on them
  // would silently hide most of the ledger.
  const rows = flowLedgerFilterPeriod(apData, 'createdAt', 'apYear', 'apMonth');
  const { open, history } = flowLedgerSplit(rows, apIsOpen);

  const openTable = open.length
    ? `<table class="flow-table flow-items">${apHead()}<tbody>${open.map(rowHtml).join('')}${apFoot(open)}</tbody></table>`
    : '<p style="color:var(--text-muted,#64748b);">No open payables in this period.</p>';
  const histTable = history.length
    ? `<table class="flow-table flow-items">${apHead()}<tbody>${history.map(rowHtml).join('')}</tbody></table>` : '';

  c.innerHTML =
    `<div class="lv-sec-title">Open payables <span class="lv-sub">· ${open.length} listed · the totals above cover exactly these</span></div>`
    + openTable
    /* A224 — this said "paid" and summed Amount (PHP), the PAYABLE. Two different facts, and A221
       exists because they were confused for each other once already. On the live book it reported
       ₱843,010.98 of settled payments when the cash was ₱443,476.75 — ₱399,534.23 of the gap is the
       AOLAI row alone, whose payable still carries the "4"-prefixed ₱446,393.80 against ₱46,393.80
       actually paid. flow-ar-aging.js next door has always summed collectedPHP correctly. */
    + flowLedgerHistoryBlock({
        title: 'Settled payables',
        count: history.length,
        subtotalLabel: 'paid',
        subtotal: history.reduce((t, r) => t + flowNum(r.paidPHP), 0),
        tableHtml: histTable
      });
  updateKpis(open);
}

/** Still in play: anything not fully settled. */
function apIsOpen(r) { return String(r.status || '').toLowerCase() !== 'paid'; }
function apOutstanding(r) { return flowNum(r.amountPHP) - flowNum(r.paidPHP); }

function apHead() {
  return `<thead><tr>
    <th>AP No</th><th>PO</th><th>Supplier</th><th>Cur</th><th class="num">Amount (FC)</th>
    <th class="num" style="width:130px;">Amount (PHP)</th>
    <th class="num" style="width:96px;" title="Amount (PHP) ÷ Amount (FC) — nobody needs today's rate to see that ₱1,539/USD is wrong, but only if it is on screen">Implied rate</th>
    <th style="width:110px;">Status</th>
    <th style="width:140px;">Due Date</th><th class="num" style="width:120px;">Paid (PHP)</th>
    <th style="width:160px;">Notes</th><th style="width:150px;">Payment Request</th><th></th></tr></thead>`;
}

/** The on-screen proof that the Unpaid KPI is the sum of the Outstanding actually listed. */
function apFoot(open) {
  const amt = open.reduce((t, r) => t + flowNum(r.amountPHP), 0);
  const paid = open.reduce((t, r) => t + flowNum(r.paidPHP), 0);
  // A221: the Implied-rate column was inserted at index 6, so Paid moved 8 -> 9 and the span 12 -> 13.
  return flowLedgerFootRow([
    { at: 5, value: flowMoney(amt, 'PHP') },
    { at: 9, value: flowMoney(paid, 'PHP') }
  ], 13);
}

/* A221 — the implied exchange rate, shown rather than validated.
   There is no defined rate to check against: the peso value of a foreign payable is whatever the bank
   gives on the day, which is why three of the four foreign POs store a rate of 0. But a person spots
   ₱1,539/USD instantly when it is on the screen and never when it is not. Blank for PHP and for a
   zero FC amount, where the division would say nothing. */
function apImpliedRate(r) {
  const fc = flowNum(r.amountFC), php = flowNum(r.amountPHP);
  if (String(r.currency || 'PHP').toUpperCase() === 'PHP' || fc <= 0 || php <= 0) return '';
  const rate = php / fc;
  const odd = rate < 20 || rate > 200;      // the A171 sanity band, as a hint only — never a refusal
  return `<span title="₱${php.toFixed(2)} ÷ ${fc} ${flowEsc(r.currency)}"${odd
    ? ' style="color:#b91c1c;font-weight:700;"' : ''}>${rate.toFixed(2)}</span>`;
}

/* ── A224 — the request cell: the link, and Pay where it belongs ───────────────────────────────────
 *
 * ONE ACTION, TWO ENTRY POINTS. Pay here calls the SAME prMarkPaid() the payment request page calls,
 * opening the same dialog, posting the same payload to the same handler. It is not a second way to
 * pay — that is precisely what A221 spent itself removing, and a duplicated money guard is how a
 * ₱310,895.71 credit to Cash came to exist for a ₱12,447.24 obligation.
 *
 * What is solved is the hopping: the payable is where you notice the payment is due, and the request
 * is where the approval chain, the method ownership and the proof-of-payment gate all live. The
 * button carries you from one to the other without carrying the authority with it — every guard still
 * runs server-side, and the visibility test below is exactly prPayActions', so a button that appears
 * is a button the server will honour.
 *
 * The proof link answers the same question in reverse: the evidence for a payable is filed on its
 * REQUEST (markPaymentRequestPaid looks for it there and nowhere else), so this opens that window
 * rather than the payable's own — one click from the payable to the document that justifies it. */
function apRequestCell(r) {
  if (!r.prNo) return '<span style="color:var(--text-muted,#64748b);">—</span>';
  const no = flowEsc(r.prNo);
  const badge = r.prStatus
    ? ' ' + (typeof flowStatusBadge === 'function' ? flowStatusBadge(r.prStatus) : flowEsc(r.prStatus)) : '';
  let out = `<a class="link-btn" href="flow-payment-requests.html" title="Open Payment Requests">${no}</a>${badge}`;

  const req = apReqByNo[String(r.prNo)];
  const st = String((req && req.status) || r.prStatus || '');
  if (st === 'Paid') {
    out += `<button class="link-btn" style="display:block;font-size:0.68rem;"
      onclick='prAttachProof("${no}")' title="The proof of payment filed against this request">Proof</button>`;
  } else if (req && st === 'Approved' && typeof prMarkPaid === 'function'
             && typeof prPayOwns === 'function' && prPayOwns(req.paymentMethod, apSession.role)
             && (typeof prCanPay === 'undefined' || prCanPay)) {
    out += `<button class="link-btn" style="display:block;font-size:0.68rem;font-weight:700;"
      onclick='prMarkPaid("${no}")'
      title="Opens the same Mark Paid dialog as the payment request — same guards, same record">Pay</button>`;
  } else if (req && st === 'Approved' && typeof prPayOwnerLabel === 'function') {
    /* Approved but not yours. Saying whose it is beats a button that silently is not there — the
       absence of a control reads as a broken page rather than as somebody else's job. */
    out += `<div style="font-size:0.68rem;color:var(--text-muted,#64748b);">to be paid by ${flowEsc(prPayOwnerLabel(req.paymentMethod))}</div>`;
  }
  return out;
}

function rowHtml(r) {
  /* A221 — Paid (PHP) is READ-ONLY here. It used to be an ordinary number box, and that made this
     page a second way to pay a supplier with no approved request, no payment method and no proof of
     payment — the route that produced a ₱310,895.71 credit to Cash for a ₱12,447.24 obligation.
     Payment now happens on the payment request, which checks all three. The figure is still shown,
     with the requests that produced it, so the row stays explainable. */
  const settled = flowNum(r.paidPHP);
  return `<tr data-row="${r.rowIndex}" data-apno="${flowEsc(r.apNo)}">
    <td>${flowEsc(r.apNo)}</td><td>${flowEsc(r.poNo)}</td><td>${flowEsc(r.supplier)}</td><td>${flowEsc(r.currency)}</td>
    <td class="num">${flowMoney(r.amountFC, r.currency)}</td>
    <td class="num"><input type="number" step="any" min="0" class="f-php" value="${r.amountPHP || ''}" placeholder="0.00"></td>
    <td class="num">${apImpliedRate(r)}</td>
    <td><select class="f-status">${['Unpaid','Partial','Paid'].map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
    <td><input type="date" class="f-due" value="${flowDate(r.dueDate)}"></td>
    <td class="num">${settled ? flowMoney(settled, 'PHP') : '<span style="color:var(--text-muted,#64748b);">—</span>'}
      <button class="link-btn" style="display:block;font-size:0.68rem;margin-left:auto;"
        onclick='apExternalPayment("${flowEsc(r.apNo)}", ${r.rowIndex}, ${settled})'
        title="Only for a payment genuinely made outside the system — it asks for a reason and records it">outside…</button></td>
    <td><input type="text" class="f-notes" value="${flowEsc(r.notes)}"></td>
    <td>${apRequestCell(r)}</td>
    <td style="white-space:nowrap;"><button class="link-btn" onclick="saveRow(${r.rowIndex}, this)">Save</button>
    <button class="link-btn" onclick='openDocsModal("AP Aging","${flowEsc(r.apNo)}")' style="margin-left:0.4rem;">Docs</button>
    ${apCanDelete ? `<button class="link-btn del-btn" onclick='deleteAP("${flowEsc(r.apNo)}")' style="margin-left:0.4rem;">Delete</button>` : ''}</td></tr>`;
}

/* A157: every card is computed from the SAME open rows the table just rendered — one fetch, one rule.
   The aging buckets used to live in a one-shot inline script with their own fetch that never re-ran
   after a save, so they could disagree with the list underneath them. */
function updateKpis(open) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  let unpaid = 0;
  const today = new Date();
  const b = { cur: 0, b30: 0, b60: 0, b60p: 0 };
  (open || []).forEach(r => {
    const out = apOutstanding(r);
    unpaid += out;
    // Same rule as the headline (no `out <= 0` skip), so the four buckets always add back to it.
    const due = r.dueDate ? new Date(flowDate(r.dueDate)) : null;
    const days = due && !isNaN(due) ? Math.floor((today - due) / 86400000) : 0;
    if (days <= 0) b.cur += out; else if (days <= 30) b.b30 += out;
    else if (days <= 60) b.b60 += out; else b.b60p += out;
  });
  set('kpiCount', (open || []).length);
  set('kpiUnpaid', flowMoney(unpaid, 'PHP'));
  set('kpiPaid', flowMoney(apData.filter(r => !apIsOpen(r)).reduce((t, r) => t + flowNum(r.amountPHP), 0), 'PHP'));
  set('kpiCurrent', flowMoney(b.cur, 'PHP'));
  set('kpiB30', flowMoney(b.b30, 'PHP'));
  set('kpiB60', flowMoney(b.b60, 'PHP'));
  set('kpiB60p', flowMoney(b.b60p, 'PHP'));
}

function apApplyFilter() { render(); }

async function saveRow(rowIndex, btn) {
  const tr = btn.closest('tr');
  const payload = {
    rowIndex,
    // A158: the row NUMBER alone isn't a safe key — a row deleted above shifts everything up and this
    // save would land on another supplier's payable. The server refuses if they disagree.
    apNo: tr.dataset.apno || '',
    // A171 — `value || 0` used to turn a BLANK box into a real ₱0 and wipe the payable. Send
    // undefined instead: the server's `set()` skips it and leaves the stored figure alone.
    amountPHP: tr.querySelector('.f-php').value === '' ? undefined : tr.querySelector('.f-php').value,
    status: tr.querySelector('.f-status').value,
    dueDate: tr.querySelector('.f-due').value,
    // A221: paidPHP is deliberately NOT sent. It is recorded by marking the payment request paid,
    // or — for a payment genuinely made outside the system — through apExternalPayment below.
    notes: tr.querySelector('.f-notes').value
  };
  btn.disabled = true; btn.textContent = '...';
  try {
    let res = await postFlow('updateAPAging', payload);
    // A219: the backend returns needsConfirm 'apAmount' when the peso figure cannot be reconciled
    // with the payments on the PO. Nothing handled it, so it surfaced as a bare red string.
    if (!res.success && res.needsConfirm === 'apAmount') {
      if (!confirm(res.message + '\n\nSave this amount anyway?')) {
        flowMsg('msg', 'Not saved.', false); btn.disabled = false; btn.textContent = 'Save'; return;
      }
      res = await postFlow('updateAPAging', Object.assign({}, payload, { confirmAmount: true }));
    }
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', `AP entry saved.`, true);
    await loadAP();
  } catch (e) { flowMsg('msg', e.message, false); btn.disabled = false; btn.textContent = 'Save'; }
}

/* A221 — the documented exception. Payments really are made outside the system, so this is not
   sealed shut; it just stops being the silent default. It asks for the figure AND a reason, and the
   reason is stamped into the row's Notes where it stays visible afterwards. */
async function apExternalPayment(apNo, rowIndex, current) {
  const raw = prompt('Payment recorded OUTSIDE the system for ' + apNo +
    '.\n\nNormally you mark the payment request paid instead — that checks the approval, the payment ' +
    'method and the proof of payment.\n\nTotal paid (PHP) for this payable:', String(current || 0));
  if (raw === null) return;
  const amt = Number(String(raw).replace(/,/g, '').trim());
  if (!isFinite(amt) || amt < 0) { flowMsg('msg', 'That is not a valid amount.', false); return; }
  const why = (prompt('Why is this being recorded here rather than on the payment request?\n' +
    '(e.g. "paid at the bank counter 2026-07-30, OR #12345 attached")') || '').trim();
  if (!why) { flowMsg('msg', 'A reason is required — nothing was saved.', false); return; }
  try {
    let res = await postFlow('updateAPAging', {
      rowIndex, apNo, paidPHP: amt, externalPayment: true, externalPaymentReason: why,
      actorName: (apSession && apSession.name) || ''
    });
    if (!res.success && res.needsConfirm === 'apAmount') {
      if (!confirm(res.message + '\n\nRecord it anyway?')) { flowMsg('msg', 'Not saved.', false); return; }
      res = await postFlow('updateAPAging', {
        rowIndex, apNo, paidPHP: amt, externalPayment: true, externalPaymentReason: why,
        actorName: (apSession && apSession.name) || '', confirmAmount: true
      });
    }
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'Recorded against ' + apNo + ', with the reason.', true);
    await loadAP();
  } catch (e) { flowMsg('msg', e.message, false); }
}

// A145: remove a stale/duplicate AP row (the A114 cleanup, now reachable). The backend refuses when a
// payment has been recorded, so a genuine payable can't be deleted out from under a payment request.
async function deleteAP(apNo) {
  if (!confirm('Delete AP entry ' + apNo + '? Use this only to clear a stale duplicate — a payable with a recorded payment cannot be deleted.')) return;
  try {
    const res = await postFlow('deleteAPEntry', { apNo });
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'AP entry removed.', true);
    await loadAP();
  } catch (e) { flowMsg('msg', e.message, false); }
}
