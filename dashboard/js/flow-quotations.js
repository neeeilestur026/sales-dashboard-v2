/* flow-quotations.js — quotations that load items from inventory */
let qInventory = [];
let qList = [];
let qHasSO = {};   // A145: quotationNo → true when a sales order references it (Sent-with-no-SO nudge)
let qSession = null;

let qIsOversight = false;   // admin/accounting/management/director see ALL reps, grouped
let qAdmin = false;         // admin: free-typed item rows (incl. new items) auto-added to inventory on save
let qCanClose = false;      // A152: the Close/Reopen actions need FlowAPI v91
const Q_CLOSED = ['Not Pursued', 'Lost', 'Cancelled'];   // A152 soft-close outcomes

/* A175 — one quotation page. The Quote Configurator (flow-quote-configurator.js) is the CREATE half
 * above; everything below — the list, review, approval, close/reopen — is this file's.
 *
 * The boot order is deliberate and load-bearing. The old boot set `#date` and called `addRow()`
 * BEFORE loadQuotations(), unguarded, inside an async handler: the moment the create form went away
 * those lines threw, the throw aborted the rest of the handler, and the history sat on its "Loading…"
 * spinner forever with all four KPIs blank — a dead list caused entirely by the create half. So the
 * history loads FIRST, and every create-side call sits behind its own try/catch. Nothing in the
 * builder can stop the list from rendering.
 */
document.addEventListener('DOMContentLoaded', async () => {
  qSession = requireQuotationAccess();
  if (!qSession) return;
  qIsOversight = qSession.role !== 'sales';
  qAdmin = qSession.role === 'admin';
  renderNavbar('flow-quotations');
  // Only admin/accounting can open the rest of the flow — show the sub-nav to them.
  if (qSession.role === 'admin' || qSession.role === 'accounting') renderFlowNav('flow-quotations.html');

  const params = new URLSearchParams(location.search);

  // ── the history, first and unconditionally ────────────────────────────────
  try {
    await loadQuotations();
    if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) {
    const c = document.getElementById('listContainer');
    if (c) c.innerHTML = `<p style="color:#ef4444;">Could not load quotations — ${flowEsc(e.message || 'unknown error')}</p>`;
  }
  // Deep-link: ?review=<quotationNo> opens the review modal directly (e.g. from the admin dashboard).
  const reviewNo = params.get('review');
  if (reviewNo) { try { openReviewModal(reviewNo); } catch (e) { /* the list still stands */ } }

  // ── the create half — guarded, so a fault here costs the builder, not the list ──
  try {
    await loadInventory();                       // still needed by the PDF dialog's descriptions
    if (typeof qcInit === 'function') qcInit({ session: qSession });
    // Deep-link: ?fromPR=<prNo> opens the builder with that returned request's final-priced items.
    const fromPr = params.get('fromPR');
    if (fromPr && typeof qcLoadFromPR === 'function') {
      qcToggleCreate(true);
      await qcLoadFromPR(fromPr);
    }
  } catch (e) {
    console.error('Quote builder failed to start:', e);
    const msg = document.getElementById('qcMsg');
    if (msg) msg.innerHTML = '<div style="margin:.5rem 0 1rem;padding:.6rem .85rem;border-radius:10px;font-size:.86rem;' +
      'background:#fef2f2;color:#991b1b;border:1px solid #fecaca;">The quotation builder could not start — reload the page. ' +
      'The list below is unaffected.</div>';
  }
});

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); qInventory = (r && r.data) || []; }
  catch (e) { qInventory = []; }
}

// Read a discount-% input, clamped to 0–100 (blank/invalid → 0).
function qDiscountVal(id) {
  const el = document.getElementById(id);
  const n = flowNum(el && el.value);
  return Math.max(0, Math.min(100, n || 0));
}

/** Overwrite (or insert) the qList entry with the values we KNOW were just saved. The refetch after
 *  a write can serve the pre-save record (Sheets read-after-write staleness), and that stale response
 *  is cached for 60s — so the saved values are authoritative here (same class of fix as the A80
 *  pdfLink patch). Recomputes line totals + the gross total; clears the flow cache so the stale
 *  response can't resurface on the next page load. `oldNo` handles a rename (replace in place). */
function qPatchLocal(no, saved, oldNo) {
  let i = qList.findIndex(q => String(q.quotationNo) === String(no));
  if (i < 0 && oldNo) i = qList.findIndex(q => String(q.quotationNo) === String(oldNo));
  const base = i >= 0 ? qList[i] : { quotationNo: no, status: 'Draft', createdBy: qSession.name, items: [] };
  const rec = Object.assign({}, base, saved, { quotationNo: no });
  if (saved.items) {
    rec.items = saved.items.map(it => Object.assign({}, it, { lineTotal: flowNum(it.qty) * flowNum(it.price) }));
    rec.total = rec.items.reduce((s, it) => s + it.lineTotal, 0);
  }
  if (i >= 0) qList[i] = rec; else qList.push(rec);
  try { _flowCacheClear(); } catch (e) { /* cache clear is best-effort */ }
  qBuildMonthOptions();
  renderQuotationList();
}

async function loadQuotations() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    // Sales see only their own; oversight roles (admin/accounting/management/director) see all.
    const params = qIsOversight ? {} : { createdBy: qSession.name };
    const [res, soRes] = await Promise.all([
      fetchFlow('getQuotations', params),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),   // A145: which quotations became SOs
    ]);
    qList = (res && res.data) || [];
    qHasSO = {};
    ((soRes && soRes.data) || []).forEach(s => { if (s.quotationNo) qHasSO[String(s.quotationNo)] = true; });
    try { qCanClose = await flowVersionAtLeast(91); } catch (e) { qCanClose = false; }  // A152: Close/Reopen need v91
    if (!qList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No quotations yet.</p>'; return; }
    qBuildMonthOptions();
    renderQuotationList();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

/** 'yyyy-MM' of the month a quotation was created in. */
function qMonthKey(q) { return String(flowDate(q.date) || '').slice(0, 7); }

const Q_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function qMonthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${Q_MONTH_NAMES[+m[2] - 1]} ${m[1]}` : key;
}

/** Month options built from the quotations actually present, newest first. */
function qBuildMonthOptions() {
  const sel = document.getElementById('qMonthFilter');
  if (!sel) return;
  const counts = {};
  qList.forEach(q => { const k = qMonthKey(q); if (k) counts[k] = (counts[k] || 0) + 1; });
  const keys = Object.keys(counts).sort().reverse();
  const keep = sel.value;
  sel.innerHTML = `<option value="">All months</option>` +
    keys.map(k => `<option value="${k}">${qMonthLabel(k)} (${counts[k]})</option>`).join('');
  if (keep && keys.indexOf(keep) >= 0) sel.value = keep;    // survive a refresh
}

/** Filter by month + free text, then render. Old quotations keep every action — the filter only
 *  narrows which rows are shown, never what can be done with them. */
function renderQuotationList() {
  const c = document.getElementById('listContainer');
  if (!c) return;
  const month = (document.getElementById('qMonthFilter') || {}).value || '';
  const term = ((document.getElementById('qSearch') || {}).value || '').trim().toLowerCase();
  // A152: status filter — Active (default, hides closed), Closed (win/loss review), or All.
  const sview = (document.getElementById('qStatusFilter') || {}).value || 'active';
  let rows = qList;
  if (sview === 'active') rows = rows.filter(q => Q_CLOSED.indexOf(String(q.status)) === -1);
  else if (sview === 'closed') rows = rows.filter(q => Q_CLOSED.indexOf(String(q.status)) !== -1);
  if (month) rows = rows.filter(q => qMonthKey(q) === month);
  if (term) {
    rows = rows.filter(q => [q.quotationNo, q.customer, q.subject, q.createdBy]
      .some(v => String(v == null ? '' : v).toLowerCase().includes(term)));
  }
  // Newest first so the most recent work is at the top of whichever month is selected.
  rows = rows.slice().sort((a, b) => String(flowDate(b.date)).localeCompare(String(flowDate(a.date))) ||
    String(b.quotationNo).localeCompare(String(a.quotationNo)));

  const count = document.getElementById('qListCount');
  if (count) {
    const total = rows.reduce((s, q) => s + qtnTotal(q), 0);
    count.textContent = rows.length
      ? `${rows.length} of ${qList.length} quotation(s) · ${flowMoney(total, 'PHP')}`
      : `0 of ${qList.length} quotation(s)`;
  }
  if (!rows.length) {
    c.innerHTML = `<p style="color:var(--text-muted,#64748b);">No quotations match this filter${
      month ? ` — nothing in ${flowEsc(qMonthLabel(month))}` : ''}.</p>`;
    return;
  }
  c.innerHTML = qIsOversight ? renderGroupedByRep(rows) : renderQuotationTable(rows);
}

function quotationActions(q) {
  const no = flowEsc(q.quotationNo);
  const role = qSession.role, st = q.status || 'Draft';
  const isSales = role === 'sales', isAdmin = role === 'admin';
  const isCreator = String(q.createdBy) === String(qSession.name);
  const editable = st === 'Draft' || st === 'Rejected';
  // Approved/Sent are finished states — the way back in is Revise (audited, and re-enters approval),
  // never a silent Edit. The backend enforces the same rule.
  const reopenable = st === 'Sent' || st === 'Approved';
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.5rem;">${label}</button>`;
  // Everyone can Review (read-only details + PDF). Approvers get Approve/Reject inside the modal.
  let a = `<button class="link-btn" onclick='openReviewModal("${no}")'>Review</button>`
    + B(`openPdfModal("${no}")`, 'PDF') + B(`openDocsModal("Quotation","${no}")`, 'Docs');
  // Submit / re-submit while Draft or Rejected — the creator, admin, or accounting.
  if (editable && (isCreator || isAdmin || isSales || role === 'accounting'))
    a += B(`submitQuotationAction("${no}")`, st === 'Rejected' ? 'Re-submit' : 'Submit');
  if ((isSales || isAdmin) && editable) a += B(`editQuotation("${no}")`, 'Edit') + B(`deleteQuotation("${no}")`, 'Delete', 'del-btn');
  // Client came back asking for a different price? Reopen it — creator, sales or admin.
  if (reopenable && (isCreator || isSales || isAdmin)) a += B(`reviseQuotationAction("${no}")`, 'Revise');
  // A145: Send-to-Client is offered to the CREATOR and to admin/management/director — not sales-only —
  // so an admin- or management-created quotation doesn't strand at Approved with no one able to send it.
  const canSend = isCreator || isSales || isAdmin || role === 'management' || role === 'director';
  if (canSend && st === 'Approved') a += B(`sendQuotationAction("${no}")`, 'Send to Client');
  // A152: close a quotation the client never pursued (soft) — or reopen a closed one.
  const closed = Q_CLOSED.indexOf(st) !== -1;
  const canClose = isCreator || isSales || isAdmin || role === 'management' || role === 'director';
  const wonHasSO = qHasSO[String(q.quotationNo)];   // pursued into an SO → can't be "not pursued"
  if (qCanClose && canClose) {
    if (closed) a += B(`reopenQuotationAction("${no}")`, 'Reopen', 'reopen-btn');
    else if (!wonHasSO) a += B(`openCloseModal("${no}")`, 'Close', 'del-btn');
  }
  return a;
}

// Total shown even if the stored Total is 0/blank (self-heals from the line items on the client).
// Gross ex-VAT subtotal (Σ qty×price), preferring the stored total.
function qtnGross(q) {
  return flowNum(q.total) || (q.items || []).reduce((s, it) => s + flowNum(it.qty) * flowNum(it.price), 0);
}
// Net after the discount (before VAT) — what the client actually pays ex-VAT.
function qtnTotal(q) {
  const d = Math.max(0, Math.min(100, flowNum(q.discountPct) || 0));
  return qtnGross(q) * (1 - d / 100);
}

function quotationRow(q) {
  const st = q.status || 'Draft';
  const noteTip = (st === 'Rejected' && q.approvalNote) ? ` title="Reason: ${flowEsc(q.approvalNote)}"` : '';
  const noteLine = (st === 'Rejected' && q.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(q.approvalNote)}</div>` : '';
  // A145: a Sent quotation with no sales order yet — nudge to create the SO.
  const soNudge = (st === 'Sent' && !qHasSO[String(q.quotationNo)])
    ? ` <span class="flow-badge" style="background:rgba(245,158,11,0.14);color:#b45309;" title="Sent to the client but no sales order created yet">no SO</span>` : '';
  return `<tr><td>${flowEsc(q.quotationNo)}${soNudge}</td><td>${flowDate(q.date)}</td><td>${flowEsc(q.customer)}</td>
    <td${noteTip}>${flowStatusBadge(st)}${noteLine}</td>
    <td class="num">${flowMoney(qtnTotal(q), 'PHP')}${flowNum(q.discountPct) > 0 ? `<div style="font-size:0.68rem;color:#0f766e;">−${flowNum(q.discountPct)}% disc</div>` : ''}</td><td>${q.items.length}</td>
    <td>${q.pdfLink ? `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn"${qPdfState(q) === 'fresh'
        ? ' title="The saved PDF matches this quotation."'
        : ` style="color:#b91c1c;" title="${qPdfState(q) === 'stale'
            ? 'This saved PDF no longer matches the quotation — click PDF to regenerate.'
            : 'This PDF predates change-tracking, so it can\'t be confirmed to match — click PDF to regenerate.'}"`
      }>${qPdfState(q) === 'fresh' ? '' : '⚠ '}View saved</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;">${quotationActions(q)}</td></tr>`;
}

// ─── Approval actions ─────────────────────────────
async function _qAction(action, no, extra) {
  try {
    let res = await postFlow(action, Object.assign({ quotationNo: no }, extra || {}));
    /* A158: the quotation's prices differ from what management set on the pricing request. Discounting
       to win a deal is legitimate, so this is surfaced for an explicit decision rather than blocked —
       the point is that an approver can no longer sign it off without being told. */
    if (!res.success && res.needsConfirm === 'prDeviation') {
      if (!confirm(res.message)) return;
      res = await postFlow(action, Object.assign({ quotationNo: no, acknowledgeDeviation: true }, extra || {}));
    }
    if (!res.success) throw new Error(res.message);
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}
function submitQuotationAction(no) {
  if (!confirm('Submit quotation ' + no + ' for approval?')) return;
  _qAction('submitQuotationApproval', no);
}
function approveQuotationAction(no) { _qAction('approveQuotation', no); }
function rejectQuotationAction(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  _qAction('rejectQuotation', no, { reason });
}
function sendQuotationAction(no) {
  if (!confirm('Mark quotation ' + no + ' as sent to the client?')) return;
  _qAction('sendQuotation', no);
}

// A152: close a not-pursued quotation (soft). A small modal lets the user pick the outcome + a reason.
function openCloseModal(no) {
  document.getElementById('qCloseNo').textContent = no;
  document.getElementById('qCloseModal').dataset.no = no;
  document.getElementById('qCloseOutcome').value = 'Not Pursued';
  document.getElementById('qCloseReason').value = '';
  document.getElementById('qCloseModal').style.display = 'flex';
}
function closeCloseModal() { document.getElementById('qCloseModal').style.display = 'none'; }
async function confirmCloseQuotation() {
  const modal = document.getElementById('qCloseModal');
  const no = modal.dataset.no;
  const outcome = document.getElementById('qCloseOutcome').value;
  const reason = document.getElementById('qCloseReason').value.trim();
  const btn = document.getElementById('qCloseConfirmBtn');
  btn.disabled = true; btn.textContent = 'Closing…';
  try {
    const res = await postFlow('closeQuotation', { quotationNo: no, outcome, reason });
    if (!res.success) throw new Error(res.message);
    closeCloseModal();
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Close quotation'; }
}
function reopenQuotationAction(no) {
  if (!confirm(`Reopen ${no}?\n\nIt returns to Draft so you can revise and re-send it (the client came back).`)) return;
  _qAction('reopenQuotation', no);
}

/** Reopen an Approved/Sent quotation and drop the user straight into the edit form, so revising is
 *  one action rather than "unlock, then go find it again". Re-priced quotations go back through
 *  approval before they can be re-sent. */
async function reviseQuotationAction(no) {
  if (!confirm(`Reopen ${no} for revision?\n\nIt returns to Draft so you can change the items, prices or discount. It will need approval again before it can be sent.`)) return;
  const reason = prompt('Reason for the revision (optional — e.g. "client requested re-pricing"):', '');
  if (reason === null) return;
  try {
    const r = await postFlow('reviseQuotation', { quotationNo: no, reason });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not reopen this quotation.');
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
    editQuotation(no);            // land in the form, prefilled and ready to re-price
  } catch (e) { alert(e.message); }
}

// ─── Review modal (see details + PDF before approving) ─────────────
function openReviewModal(no) {
  const q = qList.find(x => String(x.quotationNo) === String(no));
  if (!q) return;
  const role = qSession.role, st = q.status || 'Draft';
  const isApprover = (role === 'admin' && st === 'Pending Admin') ||
    ((role === 'management' || role === 'director') && st === 'Pending Management');
  document.getElementById('qrTitle').textContent = q.quotationNo;
  document.getElementById('qrSub').innerHTML =
    `${flowEsc(q.customer)} · ${flowDate(q.date)} · ${flowStatusBadge(st)} · by ${flowEsc(q.createdBy || '—')}`;
  const items = q.items || [];
  const qDisc = Math.max(0, Math.min(100, flowNum(q.discountPct) || 0));
  const discRows = qDisc > 0
    ? `<tr><td colspan="3">Subtotal</td><td class="num">${flowMoney(qtnGross(q), 'PHP')}</td></tr>
       <tr style="color:#0f766e;"><td colspan="3">Less: Discount (${flowNum(q.discountPct)}%)</td><td class="num">− ${flowMoney(qtnGross(q) * qDisc / 100, 'PHP')}</td></tr>` : '';
  document.getElementById('qrItems').innerHTML = `<table class="flow-table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead><tbody>${items.map(it => `<tr><td>${flowEsc(it.itemNo)} ${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, 'PHP')}</td><td class="num">${flowMoney(flowNum(it.qty) * flowNum(it.price), 'PHP')}</td></tr>`).join('')}${discRows}<tr style="font-weight:700;background:var(--bg-inset,#f8fafc);"><td colspan="3">Total${qDisc > 0 ? ' (after discount, before VAT)' : ''}</td><td class="num">${flowMoney(qtnTotal(q), 'PHP')}</td></tr></tbody></table>`;
  const pv = document.getElementById('qrPdf');
  const fid = q.pdfLink ? ((q.pdfLink.match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1]) : null;
  // The panel below is a FILE saved on Drive, not a live render — say so loudly when it no longer
  // matches the figures above, because that mismatch is exactly what an approver must not miss.
  const pdfState = qPdfState(q);
  const regenBtn = `<button class="btn btn-sm btn-primary" style="margin-top:0.5rem;" onclick="qrRegenerate('${flowEsc(q.quotationNo)}')">Regenerate PDF</button>`;
  let warn = '';
  if (pdfState === 'stale') {
    const was = qPdfSavedTotals(q);
    warn = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-left:4px solid #dc2626;border-radius:8px;padding:0.7rem 0.85rem;margin-bottom:0.6rem;">
      <div style="font-weight:700;color:#b91c1c;font-size:0.85rem;">⚠ This document is out of date</div>
      <div style="font-size:0.8rem;color:#7f1d1d;margin-top:0.25rem;">
        It shows <b>${flowMoney(was.net, 'PHP')}</b>${was.discountPct ? ` (${was.discountPct}% discount)` : ''} —
        the quotation is now <b>${flowMoney(qtnTotal(q), 'PHP')}</b>${flowNum(q.discountPct) ? ` (${flowNum(q.discountPct)}% discount)` : ''}.
        ${qPdfInfo(q).hasImages ? 'Re-attach the product photo when regenerating.' : ''}
      </div>${regenBtn}</div>`;
  } else if (pdfState === 'unverified') {
    warn = `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:0.7rem 0.85rem;margin-bottom:0.6rem;">
      <div style="font-weight:700;color:#92400e;font-size:0.85rem;">⚠ This document can't be verified</div>
      <div style="font-size:0.8rem;color:#78350f;margin-top:0.25rem;">It was generated before change-tracking, so it may not match the figures above. Regenerate it to confirm.</div>
      ${regenBtn}</div>`;
  }
  if (fid) pv.innerHTML = warn + `<iframe src="https://drive.google.com/file/d/${fid}/preview" style="width:100%;height:440px;border:1px solid var(--border,#e2e8f0);border-radius:8px;" allowfullscreen></iframe>`;
  else if (q.pdfLink) pv.innerHTML = warn + `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn">Open PDF in Drive →</a>`;
  else pv.innerHTML = `<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">No PDF generated yet — review the details above, or <button class="link-btn" onclick="closeReviewModal();openPdfModal('${flowEsc(q.quotationNo)}')">generate the PDF</button> first.</div>`;
  const foot = document.getElementById('qrFoot');
  // Approving a quotation whose attached document shows different figures is the failure this guards
  // against — so Approve waits for a matching PDF. Reject always stays available.
  const blockApprove = pdfState === 'stale' || pdfState === 'unverified';
  const approveBtn = blockApprove
    ? `<button type="button" class="btn btn-primary" disabled style="opacity:0.5;cursor:not-allowed;" title="Regenerate the PDF first — the attached document does not match the figures above.">Approve</button>`
    : `<button type="button" class="btn btn-primary" onclick="qrApprove('${flowEsc(q.quotationNo)}')">Approve</button>`;
  foot.innerHTML = `<button type="button" class="btn btn-secondary" onclick="closeReviewModal()">Close</button>` +
    (isApprover
      ? `<button type="button" class="btn btn-secondary" style="color:#dc2626;border-color:#fca5a5;" onclick="qrReject('${flowEsc(q.quotationNo)}')">Reject</button>` + approveBtn
      : `<span style="font-size:0.78rem;color:var(--text-muted,#64748b);margin-left:auto;">${st.indexOf('Pending') === 0 ? 'Awaiting ' + st.replace('Pending ', '') + ' approval' : ''}</span>`);
  document.getElementById('qrModal').classList.add('open');
}
function closeReviewModal() { document.getElementById('qrModal').classList.remove('open'); }
/** From the out-of-date banner: straight into the PDF dialog, prefilled from the stored doc fields
 *  so nothing has to be retyped (openPdfModal restores them). */
function qrRegenerate(no) { closeReviewModal(); openPdfModal(no); }
function qrApprove(no) { closeReviewModal(); _qAction('approveQuotation', no); }
function qrReject(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  closeReviewModal();
  _qAction('rejectQuotation', no, { reason });
}

function renderQuotationTable(rows) {
  return `<table class="flow-table"><thead><tr><th>Quotation No</th><th>Date</th><th>Customer</th><th>Status</th><th class="num">Total</th><th>Items</th><th>PDF</th><th></th></tr></thead><tbody>${rows.map(quotationRow).join('')}</tbody></table>`;
}

// Oversight: group the (filtered) quotations into collapsible sections (one per Created By).
function renderGroupedByRep(rows) {
  const groups = {};
  (rows || qList).forEach(q => { const k = q.createdBy || 'Unassigned'; (groups[k] = groups[k] || []).push(q); });
  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  return names.map((name, i) => {
    const rows = groups[name];
    const total = rows.reduce((s, q) => s + qtnTotal(q), 0);
    return `<details class="rep-group"${i === 0 ? ' open' : ''}>
      <summary><span class="rep-name">${flowEsc(name)}</span>
        <span class="rep-meta">${rows.length} quotation(s) · ${flowMoney(total, 'PHP')}</span></summary>
      <div style="overflow-x:auto;margin-top:0.5rem;">${renderQuotationTable(rows)}</div>
    </details>`;
  }).join('');
}

/** A175 — Edit (and Revise, which calls this) now opens the Configurator above with the record
 *  loaded, so the surface that creates a quotation is also the one that revises it. The whole
 *  quotation number stays editable — changing it RENAMES the record (items, SO link and attached
 *  docs follow; the backend rejects duplicates). */
function editQuotation(no) {
  const q = qList.find(x => String(x.quotationNo) === String(no));
  if (!q) return;
  if (typeof qcLoadExisting !== 'function') {
    alert('The quotation builder did not load — reload the page and try again.');
    return;
  }
  qcToggleCreate(true);
  qcLoadExisting(q);
}

async function deleteQuotation(no) {
  if (!confirm('Delete quotation ' + no + '?')) return;
  try {
    const res = await postFlow('deleteQuotation', { quotationNo: no });
    if (!res.success) throw new Error(res.message);
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}

// ─── Saved-PDF freshness ──────────────────────────
// The row's PDF is a file on Drive; it only changes when someone regenerates. These helpers record
// what a PDF was rendered from, so the UI can tell whether the saved document still matches.

/** Everything that changes the document's contents, as a comparable object. */
function qPdfStamp(q, vatOption) {
  return {
    customer: String(q.customer || ''), date: flowDate(q.date) || '',
    subject: String(q.subject || ''), discountPct: flowNum(q.discountPct) || 0,
    vatOption: vatOption || '',
    items: (q.items || []).map(it => `${it.itemNo}|${flowNum(it.qty)}|${flowNum(it.price)}`)
  };
}

/** 'none' (no PDF) · 'fresh' · 'stale' (proven different) · 'unverified' (PDF predates stamping). */
function qPdfState(q) {
  if (!q || !q.pdfLink) return 'none';
  let data = null;
  try { data = q.pdfData ? JSON.parse(q.pdfData) : null; } catch (e) { data = null; }
  if (!data || !data.stamp) return 'unverified';
  const now = qPdfStamp(q, data.stamp.vatOption || data.vatOption || '');
  return JSON.stringify(now) === JSON.stringify(data.stamp) ? 'fresh' : 'stale';
}
function qPdfInfo(q) { try { return q.pdfData ? (JSON.parse(q.pdfData) || {}) : {}; } catch (e) { return {}; } }

/** What the saved document shows, for the out-of-date banner (from its own stamp). */
function qPdfSavedTotals(q) {
  const s = (qPdfInfo(q).stamp) || {};
  const gross = (s.items || []).reduce((t, x) => {
    const f = String(x).split('|'); return t + flowNum(f[1]) * flowNum(f[2]);
  }, 0);
  const d = Math.max(0, Math.min(100, flowNum(s.discountPct) || 0));
  return { gross, discountPct: d, net: gross * (1 - d / 100) };
}

// ─── PDF generation ───────────────────────────────
let pdfQuote = null;            // the quotation being printed
const pdfImages = {};           // row INDEX → data URL (itemNo keying collided on duplicate/N-A numbers)

function openPdfModal(no) {
  const q = qList.find(x => x.quotationNo === no);
  if (!q) return;
  pdfQuote = q;
  Object.keys(pdfImages).forEach(k => delete pdfImages[k]);
  document.getElementById('pdfQuotationNo').value = q.quotationNo;
  document.getElementById('pdfModalSub').textContent = `${q.quotationNo} · ${q.customer} · ${q.items.length} item(s)`;
  // Prefill from the subject typed at creation (stored on the record); still editable + required.
  document.getElementById('pdfSubject').value = q.subject || '';
  // Discount % prefilled from the record (editable — lets a rejected quote be re-priced at regen time).
  const pd = document.getElementById('pdfDiscount'); if (pd) pd.value = flowNum(q.discountPct) || '';
  // Summary blocks are cleared first: a blank means "omit the block", and the prefills below skip
  // empty values — without this a previous quotation's scope would linger in the open modal.
  ['Scope', 'Exclusions', 'Options'].forEach(f => {
    const el = document.getElementById('pdf' + f); if (el) el.value = '';
  });
  // restore remembered defaults (terms, signatory, summary blocks)
  const d = flowLoadDefaults('quotation');
  ['Address', 'Attention', 'Designation', 'Email', 'Validity', 'Delivery', 'Payment', 'Warranty',
   'SigName', 'SigDesignation', 'SigViber', 'SigMobile', 'SigEmail',
   'Scope', 'Exclusions', 'Options'].forEach(f => {
    const el = document.getElementById('pdf' + f);
    if (el && d[f] !== undefined && d[f] !== '') el.value = d[f];
  });
  // This quotation's OWN fields from its last PDF beat the browser-wide defaults, so regenerating
  // after a re-price reproduces the same document (incl. RFQ No, which defaults never carried).
  const prev = qPdfInfo(q);
  if (prev.doc) {
    [['address', 'Address'], ['attention', 'Attention'], ['designation', 'Designation'],
     ['email', 'Email'], ['rfqNo', 'RfqNo'], ['note', 'Note'], ['validity', 'Validity'],
     ['delivery', 'Delivery'], ['payment', 'Payment'], ['warranty', 'Warranty'],
     ['sigName', 'SigName'], ['sigDesignation', 'SigDesignation'], ['sigViber', 'SigViber'],
     ['sigMobile', 'SigMobile'], ['sigEmail', 'SigEmail'],
     ['scope', 'Scope'], ['exclusions', 'Exclusions'], ['options', 'Options']].forEach(([k, id]) => {
      const el = document.getElementById('pdf' + id);
      if (el && prev.doc[k]) el.value = prev.doc[k];
    });
    // (Subject deliberately NOT restored — the record's current subject wins.)
    const vs = document.getElementById('pdfVat'); if (vs && prev.vatOption) vs.value = prev.vatOption;
    const dm = document.getElementById('pdfDescMode'); if (dm && prev.descMode) dm.value = prev.descMode;
  }
  // A145: prefill the RFQ line from the client's own RFQ number carried from the pricing request
  // (only when nothing more specific was restored above) so it isn't re-typed and prints on the PDF.
  const rfqEl = document.getElementById('pdfRfqNo');
  if (rfqEl && !rfqEl.value && q.clientRefNo) rfqEl.value = q.clientRefNo;
  // A regenerated document must re-attach any product photo — it was never stored.
  const imgWarn = document.getElementById('pdfImgWarn');
  if (imgWarn) {
    const needsPhoto = prev.hasImages && qPdfState(q) !== 'fresh';
    imgWarn.style.display = needsPhoto ? 'block' : 'none';
    imgWarn.textContent = needsPhoto
      ? '⚠ The previous PDF had a product photo attached. Photos are not stored — re-attach it below, or the new document will not have it.' : '';
  }
  // item image pickers
  document.getElementById('pdfItems').innerHTML = (q.items || []).map((it, i) => `
    <div class="pdf-item-row">
      <span class="grow">${flowEsc(it.itemNo)} — ${flowEsc(it.itemName)} · ${flowNum(it.qty)} × ${flowMoney(it.price, 'PHP')}</span>
      <span class="img-state" id="pdfImgState${i}" style="font-size:0.72rem;white-space:nowrap;"></span>
      <input type="file" accept="image/png,image/jpeg,image/webp" onchange="pickPdfImage(this, ${i})">
    </div>`).join('');
  const br = document.getElementById('pdfBrochures'); if (br) br.value = '';
  document.getElementById('pdfModalMsg').style.display = 'none';
  document.getElementById('pdfModal').classList.add('open');
}

function closePdfModal() { document.getElementById('pdfModal').classList.remove('open'); }

async function pickPdfImage(input, idx) {
  const file = input.files && input.files[0];
  const tag = document.getElementById('pdfImgState' + idx);
  if (!file) { delete pdfImages[idx]; if (tag) tag.textContent = ''; return; }
  if (file.size > 25 * 1024 * 1024) {
    delete pdfImages[idx]; input.value = '';
    flowMsg('pdfModalMsg', 'Image too large (max 25MB): ' + file.name, false);
    if (tag) { tag.textContent = '✗ too large'; tag.style.color = '#dc2626'; }
    return;
  }
  try {
    // Downscale in the browser (the PDF thumbnail is tiny) — phone photos of any size now work,
    // and the old silent 5MB rejection that left PDFs without their attached images is gone.
    pdfImages[idx] = await _downscaleImage(file, 900, 0.85);
    if (tag) { tag.textContent = '✓ image attached'; tag.style.color = '#15803d'; }
  } catch (e) {
    delete pdfImages[idx]; input.value = '';
    flowMsg('pdfModalMsg', 'Could not read image "' + file.name + '" — ' + (e.message || 'unsupported format (use JPG/PNG)'), false);
    if (tag) { tag.textContent = '✗ failed'; tag.style.color = '#dc2626'; }
  }
}

// Resize any picked image to ≤maxDim px and re-encode as JPEG (canvas). Rejects on undecodable files.
function _downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // flatten PNG transparency onto white
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported or corrupted image')); };
    img.src = url;
  });
}

async function submitPdf() {
  if (!pdfQuote) return;
  const btn = document.getElementById('pdfGenBtn');
  const g = id => document.getElementById('pdf' + id).value.trim();
  if (!g('Subject')) {
    flowMsg('pdfModalMsg', 'Subject is required — type the quotation subject before generating.', false);
    document.getElementById('pdfSubject').focus();
    return;
  }
  const doc = {
    address: g('Address'), attention: g('Attention'), designation: g('Designation'), email: g('Email'),
    subject: g('Subject'), rfqNo: g('RfqNo'), note: g('Note'),
    plantSite: (pdfQuote && pdfQuote.plantSite) || '',   // A145: plant-site destination carried from the PR
    validity: g('Validity'), delivery: g('Delivery'), payment: g('Payment'), warranty: g('Warranty'),
    sigName: g('SigName'), sigDesignation: g('SigDesignation'), sigViber: g('SigViber'),
    sigMobile: g('SigMobile'), sigEmail: g('SigEmail'), descMode: document.getElementById('pdfDescMode').value,
    // Summary blocks — one bullet per line; the server splits and renders them (blank = block omitted)
    scope: g('Scope'), exclusions: g('Exclusions'), options: g('Options')
  };
  flowSaveDefaults('quotation', {
    Address: doc.address, Attention: doc.attention, Designation: doc.designation, Email: doc.email,
    Validity: doc.validity, Delivery: doc.delivery, Payment: doc.payment, Warranty: doc.warranty,
    SigName: doc.sigName, SigDesignation: doc.sigDesignation, SigViber: doc.sigViber,
    SigMobile: doc.sigMobile, SigEmail: doc.sigEmail,
    Scope: doc.scope, Exclusions: doc.exclusions, Options: doc.options
  });
  // The number SHOWN on the PDF (title chip + filename) is editable in the dialog; the Drive-link
  // row write below stays keyed on the real record number so the quotation row still gets its link.
  const displayNo = (document.getElementById('pdfQuotationNo').value || '').trim() || pdfQuote.quotationNo;
  // optional PDF attachments → appended by the server after the quotation's last page
  const brFiles = Array.from((document.getElementById('pdfBrochures') || {}).files || []);
  let brochures = [];
  try { brochures = await Promise.all(brFiles.map(fileToDataURL)); }
  catch (e) { flowMsg('pdfModalMsg', 'Could not read an attached PDF — ' + e.message, false); return; }
  const payload = {
    quotationNo: displayNo, customer: pdfQuote.customer, date: flowDate(pdfQuote.date),
    vatOption: document.getElementById('pdfVat').value, discountPct: qDiscountVal('pdfDiscount'),
    descMode: doc.descMode, doc, brochures,
    items: (pdfQuote.items || []).map((it, i) => {
      // Match on itemNo AND name so N/A-numbered items don't grab another N/A row's description.
      const inv = qInventory.find(x => String(x.itemNo) === String(it.itemNo) && String(x.description) === String(it.itemName));
      return {
        itemNo: it.itemNo, itemName: it.itemName, qty: it.qty, price: it.price,
        uom: it.uom || '',   // A147: carry the real unit onto the PDF (else it forces "pc(s)")
        origItemNo: it.origItemNo || '', origItemName: it.origItemName || '',  // requested vs offered
        description: (inv && inv.description) || it.itemName || '',  // multi-line desc from inventory
        imageDataUrl: pdfImages[i] || ''
      };
    })
  };
  btn.disabled = true; btn.textContent = 'Generating...';
  // Record what this PDF is rendered from, so the saved document can be checked against the record
  // later (and refreshed automatically when that can be done without losing an attached photo).
  const hasImages = (pdfQuote.items || []).some((it, i) => !!pdfImages[i]);
  const pdfData = JSON.stringify({
    v: 1, doc, vatOption: payload.vatOption, descMode: doc.descMode, hasImages,
    stamp: qPdfStamp(Object.assign({}, pdfQuote, { discountPct: payload.discountPct }), payload.vatOption)
  });
  try {
    const { link, saveError, configured } = await generateFlowPdf('/flow/quotation-pdf', payload, 'saveQuotationPDF',
      'quotationNo', pdfQuote.quotationNo, `Quotation_${displayNo}.pdf`, { extra: { pdfData } });
    if (link) {
      flowMsg('pdfModalMsg', 'PDF generated and saved to Drive.', true);
    } else if (!configured) {
      flowMsg('pdfModalMsg', 'PDF generated (Drive save skipped — backend not configured).', true);
    } else {
      // A147: real save failure — say so honestly instead of the misleading "not configured".
      flowMsg('pdfModalMsg', 'PDF generated, but the Drive save failed' + (saveError ? ' (' + saveError + ')' : '') + ' — reopen and Generate again to retry.', false);
    }
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
    // The list refetch can lag the write (Sheets read-after-write) — patch what we know when the save
    // actually produced a Drive link. On a failed save there is no saved PDF, so nothing to patch.
    if (link) { qPatchLocal(pdfQuote.quotationNo, { pdfLink: link, pdfData, discountPct: payload.discountPct }); setTimeout(closePdfModal, 900); }
  } catch (e) {
    flowMsg('pdfModalMsg', e.message, false);
  } finally { btn.disabled = false; btn.textContent = 'Generate & Save'; }
}
