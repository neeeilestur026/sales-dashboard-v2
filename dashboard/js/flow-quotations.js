/* flow-quotations.js — quotations that load items from inventory */
let qInventory = [];
let qList = [];
let qHasSO = {};   // A145: quotationNo → true when a sales order references it (Sent-with-no-SO nudge)
let qSession = null;

let qIsOversight = false;   // admin/accounting/management/director see ALL reps, grouped
/* A191: WHO MAY SEE COST FIGURES — deliberately NOT the same set as qIsOversight.
   qIsOversight answers "may this person see everyone's quotations?" and gates the unscoped load
   (:106) and the grouped-by-rep render (:177). Admin needs both of those. It was also being used
   to gate the cost/margin breakdown, which is a different question with a different answer:
   admin must see the FINAL PRICE ONLY, never the buy price, landed cost, COGS, commission or
   margin. Reusing one flag for both is what exposed the breakdown to admin. */
let qCanSeeCosts = false;   // A191: accounting/management/director only — never admin, never sales
let qAdmin = false;         // admin: free-typed item rows (incl. new items) auto-added to inventory on save
let qCanClose = false;      // A152: the Close/Reopen actions need FlowAPI v91
let qPrByNo = {};           // A183: prNo → pricing-request record, for the approval pricing review
let qrGate = { block: false, needTick: false };   // A183: state the tick uses to re-enable Approve
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
  qCanSeeCosts = ['accounting', 'management', 'director'].indexOf(qSession.role) >= 0;   // A191
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
  /* A183/A191: the pricing behind each quotation, for the review breakdown. Fetched only for roles
     allowed to SEE cost figures — so admin and sales never pay this call and, just as importantly,
     the commission and margin never land in their sessionStorage read-cache. Best-effort: the modal
     degrades to no-breakdown. */
  if (qCanSeeCosts) { try { await qLoadPricingRefs(); } catch (e) { /* modal falls back to hasPr:false */ } }
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
    + B(`openDocsModal("Quotation","${no}")`, 'Docs');
  // Submit / re-submit while Draft or Rejected — the creator, admin, or accounting.
  if (editable && (isCreator || isAdmin || isSales || role === 'accounting'))
    a += B(`submitQuotationAction("${no}")`, st === 'Rejected' ? 'Re-submit' : 'Submit');
  /* A176 — Edit and PDF were two buttons doing different jobs on the same row, which read as
     duplication. They are now ONE surface: whoever may change the quotation gets Edit (record +
     document); everyone else gets PDF, which opens the same builder with the figures locked and
     rebuilds the document only. Never both — and never neither, because an approver staring at a
     stale PDF must always be able to regenerate it (A123 blocks Approve until they do). */
  if (editable && (isSales || isAdmin)) a += B(`editQuotation("${no}")`, 'Edit');
  else a += B(`qcOpen("${no}","document")`, 'PDF');
  if ((isSales || isAdmin) && editable) a += B(`deleteQuotation("${no}")`, 'Delete', 'del-btn');
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

/* A182: these were correct but private to this page, which is exactly why four other screens read
   q.total raw and overstated every discounted quotation. The bodies now live in flow-api.js so every
   page shares them; these stay as delegates so this page's call sites are untouched. */
function qtnGross(q) { return flowQuotationGross(q); }
function qtnTotal(q) { return flowQuotationNet(q); }

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
/** A183: prNo → pricing-request record, so the review can show the cost/margin behind a quotation. */
async function qLoadPricingRefs() {
  const r = await fetchFlow('getPricingRequests');
  qPrByNo = {};
  ((r && r.data) || []).forEach(p => { if (p && p.prNo) qPrByNo[String(p.prNo)] = p; });
}

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
        ${qPdfInfo(q).hasImages ? 'Its product photos are restored automatically.' : ''}
      </div>${regenBtn}</div>`;
  } else if (pdfState === 'unverified') {
    warn = `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:0.7rem 0.85rem;margin-bottom:0.6rem;">
      <div style="font-weight:700;color:#92400e;font-size:0.85rem;">⚠ This document can't be verified</div>
      <div style="font-size:0.8rem;color:#78350f;margin-top:0.25rem;">It was generated before change-tracking, so it may not match the figures above. Regenerate it to confirm.</div>
      ${regenBtn}</div>`;
  }
  if (fid) pv.innerHTML = warn + `<iframe src="https://drive.google.com/file/d/${fid}/preview" style="width:100%;height:440px;border:1px solid var(--border,#e2e8f0);border-radius:8px;" allowfullscreen></iframe>`;
  else if (q.pdfLink) pv.innerHTML = warn + `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn">Open PDF in Drive →</a>`;
  else pv.innerHTML = `<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">No PDF generated yet — review the details above, or <button class="link-btn" onclick="closeReviewModal();qcOpen('${flowEsc(q.quotationNo)}','document')">generate the PDF</button> first.</div>`;
  /* A183/A191: the pricing this quotation was built from. Accounting, management and director see
     the cost/margin breakdown; a loud banner fires when the quoted total no longer matches what
     management priced; and when that viewer is the approver, a tick "I've reviewed the pricing"
     gates Approve. Cost figures are shown to neither sales NOR admin.
     Consequence worth knowing: admin approving at Pending Admin gets no tick, because needTick
     depends on a review they cannot see. qrSyncApprove treats an absent tick requirement as
     satisfied, so admin can still approve — on the commercial terms, while management approves on
     the pricing. That split is the point of the change, not a gap in it. */
  const bd = document.getElementById('qrBreakdown');
  const pr = (qCanSeeCosts && q.prNo) ? qPrByNo[String(q.prNo)] : null;
  const review = pr ? flowQuotationPricingReview(q, pr) : null;
  const needTick = !!(isApprover && review && review.hasPr);
  if (bd) {
    if (review && review.hasPr) {
      bd.innerHTML =
        `<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);margin-bottom:0.3rem;">Pricing management set</div>` +
        flowDeviationBanner(review) + review.breakdownHtml +
        (needTick
          ? `<label style="display:flex;align-items:center;gap:0.45rem;margin-top:0.6rem;font-size:0.82rem;font-weight:600;cursor:pointer;">
               <input type="checkbox" id="qrTick" onchange="qrSyncApprove()"> I've reviewed the pricing above and confirm it.</label>`
          : '');
    } else if (qCanSeeCosts && q.prNo) {
      bd.innerHTML = `<div style="font-size:0.78rem;color:#b45309;">Pricing record for ${flowEsc(q.prNo)} not found — approval is governed by the server's pricing check.</div>`;
    } else {
      bd.innerHTML = '';
    }
  }

  const foot = document.getElementById('qrFoot');
  // Approving a quotation whose attached document shows different figures is the failure this guards
  // against — so Approve waits for a matching PDF. A183 adds a second, independent gate: the pricing
  // tick. Reject always stays available.
  const blockApprove = pdfState === 'stale' || pdfState === 'unverified';
  qrGate = { block: blockApprove, needTick: needTick };
  foot.innerHTML = `<button type="button" class="btn btn-secondary" onclick="closeReviewModal()">Close</button>` +
    (isApprover
      ? `<button type="button" class="btn btn-secondary" style="color:#dc2626;border-color:#fca5a5;" onclick="qrReject('${flowEsc(q.quotationNo)}')">Reject</button>` +
        `<button type="button" class="btn btn-primary" id="qrApproveBtn" onclick="qrApprove('${flowEsc(q.quotationNo)}')">Approve</button>`
      : `<span style="font-size:0.78rem;color:var(--text-muted,#64748b);margin-left:auto;">${st.indexOf('Pending') === 0 ? 'Awaiting ' + st.replace('Pending ', '') + ' approval' : ''}</span>`);
  qrSyncApprove();
  document.getElementById('qrModal').classList.add('open');
}

/** A183: keep Approve disabled until BOTH gates pass — a matching PDF (qrGate.block) and, for a
 *  from-PR quotation, the pricing tick. Rendered once; called on open and on each tick change. */
function qrSyncApprove() {
  const btn = document.getElementById('qrApproveBtn');
  if (!btn) return;
  const ticked = !qrGate.needTick || !!(document.getElementById('qrTick') || {}).checked;
  const ok = !qrGate.block && ticked;
  btn.disabled = !ok;
  btn.style.opacity = ok ? '' : '0.5';
  btn.style.cursor = ok ? '' : 'not-allowed';
  btn.title = qrGate.block
    ? 'Regenerate the PDF first — the attached document does not match the figures above.'
    : (!ticked ? 'Tick “I’ve reviewed the pricing” to approve.' : '');
}
function closeReviewModal() { document.getElementById('qrModal').classList.remove('open'); }
/** From the out-of-date banner: straight into the PDF dialog, prefilled from the stored doc fields
 *  so nothing has to be retyped (qcLoadExisting restores them). */
function qrRegenerate(no) { closeReviewModal(); qcOpen(no, 'document'); }
/* A183: the pricing tick in the modal IS the deviation acknowledgement, so approving from here passes
   acknowledgeDeviation — the server's per-line message (which is unreliable when reps rewrite item
   descriptions) is replaced by the visual banner + tick the approver just cleared. Harmless when
   nothing deviates: the server only consults it to skip the deviation gate. */
function qrApprove(no) { closeReviewModal(); _qAction('approveQuotation', no, { acknowledgeDeviation: true }); }
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
  if (typeof qcOpen !== 'function') {
    alert('The quotation builder did not load — reload the page and try again.');
    return;
  }
  qcOpen(no, 'edit');
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
