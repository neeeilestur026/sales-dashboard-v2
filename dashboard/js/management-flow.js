/* ═══════════════════════════════════════════════
   management-flow.js — flow-native pieces of the redesigned management dashboard:
   • Financial KPI strip      (getInvoices/getAPAging/getInventory/getSalesOrders)
   • Approvals strip          (pending Quotations + POs → approve/reject)
   • Auto Daily Reports       (getActivityLog grouped by user — no submission)
   • Inventory snapshot       (getInventory)
   Namespaced mf* to avoid clashing with the production management-home.js globals.
   ═══════════════════════════════════════════════ */

function _mfe(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _mfm(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }
function _mfn(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

let mfPrByNo = {};   // A183: prNo → pricing record, for the quotation approval review
let mfQByNo = {};    // A183: quotationNo → quotation
let mfrGate = { needTick: false };   // A183: whether the review tick gates Approve

document.addEventListener('DOMContentLoaded', () => {
  if (typeof _flowConfigured === 'function' && !_flowConfigured()) return;
  if (document.getElementById('mgmtKpiGrid')) mfLoadKpis();
  if (document.getElementById('mgmtLifecycleHealth')) mfLoadLifecycleHealth();
  if (document.getElementById('mgmtApprovals')) mfLoadApprovals();
  if (document.getElementById('mgmtInvBody')) mfLoadInventory();
  if (document.getElementById('mgmtPrBody')) {
    const ps = document.getElementById('mgmtPrSearch'), pf = document.getElementById('mgmtPrFilter');
    if (ps) ps.addEventListener('input', mfRenderPricing);
    if (pf) pf.addEventListener('change', mfRenderPricing);
    mfLoadPricing();
  }
  const dp = document.getElementById('mgmtDrDate');
  if (dp) {
    dp.value = flowToday();
    dp.addEventListener('change', () => { mfLoadDailyReports(); mfTwNav(0); });
    const s = document.getElementById('mgmtDrSearch');
    if (s) s.addEventListener('input', mfRenderDailyReports);
    mfLoadDailyReports();
    if (document.getElementById('mfTwBody')) mfLoadTeamWeek();   // Team Weekly Report (A110)
  }
});

// ── Financial KPI strip ──
async function mfLoadKpis() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  try {
    const [inv, ap, stock, so] = await Promise.all([
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getAPAging').catch(() => ({ data: [] })),
      fetchFlow('getInventory').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
    ]);
    const invs = (inv && inv.data) || [], aps = (ap && ap.data) || [], items = (stock && stock.data) || [], sos = (so && so.data) || [];
    const sales = invs.reduce((s, v) => s + _mfn(v.totalSales), 0);
    const cogs = invs.reduce((s, v) => s + _mfn(v.totalCOGS), 0);
    const apOut = aps.filter(a => (a.status || '').toLowerCase() !== 'paid').reduce((s, a) => s + (_mfn(a.amountPHP) - _mfn(a.paidPHP)), 0);
    const invVal = flowStockItems(items).reduce((s, i) => s + _mfn(i.totalLanded), 0);   // real stocks only
    set('mgmtKpiRevenue', _mfm(sales));
    set('mgmtKpiCogs', _mfm(cogs));
    set('mgmtKpiGp', _mfm(sales - cogs));
    set('mgmtKpiNet', _mfm(sales - cogs)); // gross; net of expenses shown in the income statement
    set('mgmtKpiAp', _mfm(apOut));
    set('mgmtKpiInv', _mfm(invVal));
    set('mgmtKpiSo', String(sos.length));
  } catch (e) { /* leave dashes */ }
}

// ── A151: Lifecycle Health — where every Sales Order sits in its end-to-end journey ──
async function mfLoadLifecycleHealth() {
  const c = document.getElementById('mgmtLifecycleHealth');
  if (!c) return;
  c.innerHTML = '<div class="mf-empty">Loading lifecycle health…</div>';
  try {
    const [so, po, rc, iv, ar] = await Promise.all([
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getReceiving').catch(() => ({ data: [] })),
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getARAging').catch(() => ({ data: [] })),
    ]);
    const sos = (so && so.data) || [];
    const S = v => String(v == null ? '' : v);
    const hasPO = {}; ((po && po.data) || []).forEach(p => { if (p.soNo) hasPO[S(p.soNo)] = true; });
    const rcSO = {}; ((rc && rc.data) || []).forEach(m => { if (m.soNo) rcSO[S(m.soNo)] = true; });
    const invSO = {}; ((iv && iv.data) || []).forEach(v => { if (v.soNo) invSO[S(v.soNo)] = true; });
    const arBySO = {}; ((ar && ar.data) || []).forEach(a => { if (a.soNo) (arBySO[S(a.soNo)] = arBySO[S(a.soNo)] || []).push(a); });
    let noPO = 0, recvNotInv = 0, notCollected = 0, closed = 0;
    sos.forEach(s => {
      const id = S(s.soNo);
      if (!hasPO[id]) noPO++;
      if (rcSO[id] && !invSO[id]) recvNotInv++;
      const ars = arBySO[id] || [];
      if (invSO[id] && ars.length) {
        const out = ars.reduce((t, a) => t + (a.outstanding != null ? _mfn(a.outstanding) : _mfn(a.amountPHP) - _mfn(a.collectedPHP)), 0);
        if (out > 0.5) notCollected++; else closed++;
      }
    });
    const tile = (v, l, col) => `<div class="mf-lh-tile"><div class="mf-lh-v" style="color:${col || 'inherit'}">${v}</div><div class="mf-lh-l">${l}</div></div>`;
    c.innerHTML = `<div class="mf-lh">
      ${tile(sos.length, 'Sales Orders')}
      ${tile(noPO, 'No PO yet', noPO ? '#b45309' : '')}
      ${tile(recvNotInv, 'Received, not invoiced', recvNotInv ? '#b45309' : '')}
      ${tile(notCollected, 'Invoiced, uncollected', notCollected ? '#ef4444' : '')}
      ${tile(closed, 'Closed (collected)', '#16a34a')}
    </div><div style="margin-top:.4rem;"><a href="flow-lifecycle.html" style="color:var(--accent,#4f46e5);font-weight:600;">Open the SO Lifecycle Tracker →</a></div>`;
  } catch (e) { c.innerHTML = '<div class="mf-empty">Could not load lifecycle health.</div>'; }
}

// ── Approvals strip (pending Quotations + POs) ──
async function mfLoadApprovals() {
  const c = document.getElementById('mgmtApprovals');
  c.innerHTML = '<div class="mf-empty">Loading approvals…</div>';
  try {
    const [q, po, pr, prq, itn] = await Promise.all([
      fetchFlow('getQuotations').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getPaymentRequests').catch(() => ({ data: [] })),
      fetchFlow('getPricingRequests').catch(() => ({ data: [] })),   // A183: pricing behind each quotation
      fetchFlow('getWeeklyItineraries').catch(() => ({ data: [] })),  // A190: reps' weekly plans
    ]);
    // A183: prNo → pricing record + quotationNo → quotation, so the review modal can join them.
    mfPrByNo = {}; ((prq && prq.data) || []).forEach(p => { if (p && p.prNo) mfPrByNo[String(p.prNo)] = p; });
    mfQByNo = {}; ((q && q.data) || []).forEach(x => { if (x && x.quotationNo) mfQByNo[String(x.quotationNo)] = x; });
    const quotes = ((q && q.data) || []).filter(x => x.status === 'Pending Management');
    const pos = ((po && po.data) || []).filter(x => x.status === 'Pending Management');
    // Payment requests awaiting management. A156 put BOTH types on the one Admin → Management →
    // Director chain, so the type no longer decides the status — filtering PO-vs-Other separately
    // (as this did) made every new Other-type request invisible here while the navbar bell counted
    // it. `Pending Final` is the legacy status, still honoured for requests already in flight.
    const prs = ((pr && pr.data) || []).filter(x =>
      x.status === 'Pending Management' ||
      (x.status === 'Pending Final' && !x.mgmtApprovedBy));
    /* A190 — weekly itineraries. Management is the SECOND approver: the director signs off first,
       so anything still at Pending Director is not management's to act on yet and is deliberately
       not listed here. */
    const itins = ((itn && itn.data) || []).filter(x => x.status === 'Pending Management');
    if (!quotes.length && !pos.length && !prs.length && !itins.length) { c.innerHTML = '<div class="mf-empty">✓ Nothing pending your approval.</div>'; return; }
    const qTot = x => _mfn(x.total) || (x.items || []).reduce((s, it) => s + _mfn(it.qty) * _mfn(it.price), 0);
    const qRows = quotes.map(x => `<tr>
      <td><span class="flow-badge b-pending">Quotation</span></td>
      <td>${_mfe(x.quotationNo)}</td><td>${_mfe(x.customer)}</td>
      <td class="num">${_mfm(qTot(x))}</td>
      <td class="num" style="white-space:nowrap;">
        <button class="link-btn" onclick="mfOpenReview('${_mfe(x.quotationNo)}')">Review &amp; approve</button>
        <button class="link-btn del-btn" onclick="mfReject('rejectQuotation','${_mfe(x.quotationNo)}','quotationNo')">Reject</button></td></tr>`).join('');
    const pRows = pos.map(x => `<tr>
      <td><span class="flow-badge b-pending">Purchase Order</span></td>
      <td>${_mfe(x.poNo)}</td><td>${_mfe(x.supplier)}</td>
      <td class="num">${_mfm(x.total)} ${_mfe(x.currency || '')}</td>
      <td class="num" style="white-space:nowrap;">
        <button class="link-btn" onclick="mfApprove('approvePO','${_mfe(x.poNo)}','poNo')">Approve</button>
        <button class="link-btn del-btn" onclick="mfReject('rejectPO','${_mfe(x.poNo)}','poNo')">Reject</button></td></tr>`).join('');
    const prRows = prs.map(x => `<tr>
      <td><span class="flow-badge b-pending">Payment Req</span></td>
      <td>${_mfe(x.prNo)}</td><td>${_mfe(x.payee || x.supplier)}</td>
      <td class="num">${_mfm(x.amount)}</td>
      <td class="num" style="white-space:nowrap;">
        <button class="link-btn" onclick="mfApprove('approvePaymentRequest','${_mfe(x.prNo)}','prNo')">Approve</button>
        <button class="link-btn del-btn" onclick="mfReject('rejectPaymentRequest','${_mfe(x.prNo)}','prNo')">Reject</button></td></tr>`).join('');
    const iRows = itins.map(x => `<tr>
      <td><span class="flow-badge b-pending">Itinerary</span></td>
      <td>${_mfe(x.itineraryNo)}</td><td>${_mfe(x.user)}</td>
      <td class="num">${(x.items || []).length} visit(s)<div style="font-size:0.7rem;color:var(--text-muted,#64748b);">${_mfe(x.weekStart)} – ${_mfe(x.weekEnd)}</div></td>
      <td class="num" style="white-space:nowrap;">
        <button class="link-btn" onclick="mfViewItinerary('${_mfe(x.itineraryNo)}')">View plan</button>
        <button class="link-btn" onclick="mfApprove('approveWeeklyItinerary','${_mfe(x.itineraryNo)}','itineraryNo')">Approve</button>
        <button class="link-btn del-btn" onclick="mfReject('rejectWeeklyItinerary','${_mfe(x.itineraryNo)}','itineraryNo')">Reject</button></td></tr>`).join('');
    mfItinByNo = {}; itins.forEach(x => { mfItinByNo[String(x.itineraryNo)] = x; });
    c.innerHTML = `<div style="overflow-x:auto;"><table class="flow-table">
      <thead><tr><th>Type</th><th>No</th><th>Party</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${qRows}${pRows}${prRows}${iRows}</tbody></table></div>`;
  } catch (e) { c.innerHTML = `<div class="mf-empty" style="color:#ef4444;">${_mfe(e.message)}</div>`; }
}

/* A183: the quotation review modal — management must SEE the pricing breakdown and TICK before
   approving. Reuses the shared flow-api.js builder so it is byte-identical to the quotations page. */
function mfOpenReview(no) {
  const q = mfQByNo[String(no)];
  if (!q) { mfApprove('approveQuotation', no, 'quotationNo'); return; }   // fallback: no data, let the server gate govern
  const pr = q.prNo ? mfPrByNo[String(q.prNo)] : null;
  const review = pr ? flowQuotationPricingReview(q, pr) : null;
  const needTick = !!(review && review.hasPr);
  document.getElementById('mfrTitle').textContent = q.quotationNo;
  document.getElementById('mfrSub').innerHTML = `${_mfe(q.customer)} · ${_mfm(_mfn(q.total) || (q.items || []).reduce((s, it) => s + _mfn(it.qty) * _mfn(it.price), 0))}`;
  const itemsTable = `<div style="overflow-x:auto;"><table class="flow-table" style="font-size:0.8rem;"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th></tr></thead><tbody>` +
    (q.items || []).map(it => `<tr><td>${_mfe(it.itemNo)} ${_mfe(it.itemName)}</td><td class="num">${_mfn(it.qty)}</td><td class="num">${_mfm(_mfn(it.price))}</td></tr>`).join('') +
    `</tbody></table></div>`;
  const pricing = review && review.hasPr
    ? `<div style="margin-top:0.9rem;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:0.3rem;">Pricing management set</div>` +
      flowDeviationBanner(review) + flowOptionReviewHtml(review) + review.breakdownHtml +
      `<label style="display:flex;align-items:center;gap:0.45rem;margin-top:0.6rem;font-size:0.82rem;font-weight:600;cursor:pointer;">
         <input type="checkbox" id="mfrTick" onchange="mfSyncApprove()"> I've reviewed the pricing above and confirm it.</label>`
    : (q.prNo ? `<div style="margin-top:0.6rem;font-size:0.78rem;color:#b45309;">Pricing record for ${_mfe(q.prNo)} not found — approval is governed by the server's pricing check.</div>` : '');
  document.getElementById('mfrBody').innerHTML = itemsTable + pricing;
  mfrGate = { needTick: needTick };
  document.getElementById('mfrFoot').innerHTML =
    `<button class="btn btn-secondary" onclick="mfCloseReview()">Close</button>` +
    `<button class="btn btn-primary" id="mfrApproveBtn" onclick="mfCloseReview();mfApprove('approveQuotation','${_mfe(no)}','quotationNo',{acknowledgeDeviation:true})">Approve</button>`;
  mfSyncApprove();
  document.getElementById('mfReviewModal').style.display = 'flex';
}
function mfCloseReview() { document.getElementById('mfReviewModal').style.display = 'none'; }
function mfSyncApprove() {
  const btn = document.getElementById('mfrApproveBtn');
  if (!btn) return;
  const ticked = !mfrGate.needTick || !!(document.getElementById('mfrTick') || {}).checked;
  btn.disabled = !ticked;
  btn.style.opacity = ticked ? '' : '0.5';
  btn.style.cursor = ticked ? '' : 'not-allowed';
  btn.title = ticked ? '' : 'Tick “I’ve reviewed the pricing” to approve.';
}

async function mfApprove(action, no, key, extra) {
  try {
    let r = await postFlow(action, Object.assign({ [key]: no }, extra || {}));
    // A183: was a dead-end — the server's deviation gate returns needsConfirm and this just alerted a
    // confusing error, so management could not approve a deviating quotation from their own page.
    if (!r.success && r.needsConfirm === 'prDeviation') {
      if (!confirm(r.message)) return;
      r = await postFlow(action, Object.assign({ [key]: no, acknowledgeDeviation: true }, extra || {}));
    }
    if (!r.success) throw new Error(r.message);
    mfLoadApprovals(); mfLoadKpis();
  } catch (e) { alert(e.message); }
}
async function mfReject(action, no, key) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  try {
    const r = await postFlow(action, { [key]: no, reason });
    if (!r.success) throw new Error(r.message);
    mfLoadApprovals();
  } catch (e) { alert(e.message); }
}

// ── Inventory snapshot (flow) ──
async function mfLoadInventory() {
  const c = document.getElementById('mgmtInvBody');
  c.innerHTML = '<div class="mf-empty">Loading inventory…</div>';
  try {
    const r = await fetchFlow('getInventory');
    const everything = (r && r.data) || [];
    // Show REAL inventory only (Type 'Stock'); quotation Catalog items are on the Inventory page.
    const items = flowStockItems(everything);
    const typed = items.length !== everything.length || everything.some(i => i.type === 'Stock' || i.type === 'Catalog');
    if (!items.length) { c.innerHTML = '<div class="mf-empty">No stock items.</div>'; return; }
    // Compact card: KPI chips → on-hand table (running-low first, fixed-height scroll) →
    // zero-balance records collapsed. The card height stays bounded whatever the item count.
    const onHand = items.filter(i => _mfn(i.balance) > 0).sort((a, b) => _mfn(a.balance) - _mfn(b.balance));
    const zero = items.filter(i => !(_mfn(i.balance) > 0));
    const units = onHand.reduce((s, i) => s + _mfn(i.balance), 0);
    const value = items.reduce((s, i) => s + _mfn(i.totalLanded), 0);
    const lowN = onHand.filter(i => _mfn(i.balance) < 10).length;
    const chip = (l, v, color) => `<div class="mf-invkpi"><div class="l">${l}</div><div class="v"${color ? ` style="color:${color};"` : ''}>${v}</div></div>`;
    const rowHtml = i => `<tr>
      <td>${_mfe(i.itemNo)}</td><td>${_mfe(i.description)}</td>
      <td class="num"${_mfn(i.balance) > 0 && _mfn(i.balance) < 10 ? ' style="color:#d97706;font-weight:700;"' : ''}>${_mfn(i.balance)}</td>
      <td class="num">${_mfm(i.landedCost)}</td><td class="num">${_mfm(i.totalLanded)}</td></tr>`;
    const tbl = list => `<div class="mf-invscroll"><table class="flow-table"><thead><tr>
      <th>Item No</th><th>Description</th><th class="num">Qty</th><th class="num">Landed/Unit</th><th class="num">Value</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody></table></div>`;
    c.innerHTML = `
      <div class="mf-invkpis">
        ${chip('On Hand', onHand.length)}
        ${chip('Units', units.toLocaleString())}
        ${chip('Stock Value', _mfm(value))}
        ${chip('Running Low', lowN, lowN ? '#d97706' : null)}
        ${chip('Zero Balance', zero.length, zero.length ? '#94a3b8' : null)}
      </div>
      ${onHand.length ? tbl(onHand) : '<div class="mf-empty">Nothing on hand.</div>'}
      ${zero.length ? `<details style="margin-top:0.55rem;">
        <summary style="cursor:pointer;font-size:0.78rem;color:var(--text-muted,#64748b);font-weight:600;">📋 Stock records at zero balance (${zero.length}) — purchased/ordered items, none on hand</summary>
        <div style="margin-top:0.45rem;">${tbl(zero)}</div>
      </details>` : ''}
      <div class="mf-invmeta" style="margin:0.55rem 0 0;">${items.length} stock item(s)${typed ? ` · ${everything.length - items.length} catalog hidden` : ''} · <a href="flow-inventory.html" class="link-btn">View all inventory →</a></div>`;
  } catch (e) { c.innerHTML = `<div class="mf-empty" style="color:#ef4444;">${_mfe(e.message)}</div>`; }
}

// ── Pricing History (all Pricing Requests incl. migrated legacy history) ──
let mfPricing = [];

async function mfLoadPricing() {
  const c = document.getElementById('mgmtPrBody');
  c.innerHTML = '<div class="mf-empty">Loading pricing history…</div>';
  try {
    const r = await fetchFlow('getPricingRequests');
    mfPricing = (r && r.data) || [];
    mfRenderPricing();
  } catch (e) { c.innerHTML = `<div class="mf-empty" style="color:#ef4444;">${_mfe(e.message)}</div>`; }
}

function mfRenderPricing() {
  const c = document.getElementById('mgmtPrBody');
  if (!c) return;
  const q = (document.getElementById('mgmtPrSearch') || {}).value || '';
  const f = (document.getElementById('mgmtPrFilter') || {}).value || '';
  const qq = q.trim().toLowerCase();
  let list = mfPricing.slice();
  if (f === 'Migrated') list = list.filter(p => String(p.status) === 'Migrated');
  else if (f === 'active') list = list.filter(p => String(p.status) !== 'Migrated');
  if (qq) list = list.filter(p => (String(p.prNo) + ' ' + (p.customer || '') + ' ' + (p.items || []).map(i => i.principal).join(' ') + ' ' + (p.requestedBy || '')).toLowerCase().includes(qq));
  // newest first by date/PR no
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.prNo).localeCompare(String(a.prNo)));

  const meta = document.getElementById('mgmtPrMeta');
  const migCount = mfPricing.filter(p => String(p.status) === 'Migrated').length;
  if (meta) meta.textContent = `${mfPricing.length} request(s) · ${migCount} migrated · Process Flow`;

  if (!list.length) { c.innerHTML = '<div class="mf-empty">No pricing requests match.</div>'; return; }
  const rows = list.map((p, i) => {
    const migrated = String(p.status) === 'Migrated';
    const badge = migrated ? '<span class="flow-badge" style="background:rgba(13,148,136,0.14);color:#0f766e;">Migrated</span>'
      : `<span class="flow-badge">${_mfe(p.status === 'Returned to Sales' ? 'For Quotation' : (p.status || '—'))}</span>`;
    const principals = [...new Set((p.items || []).map(it => it.principal).filter(Boolean))].join(', ') || '—';
    return `<tr class="mf-prrow" onclick="mfTogglePricing(${i})" style="cursor:pointer;">
        <td><strong>${_mfe(p.prNo)}</strong>${p.legacyId ? `<div style="font-size:0.68rem;color:var(--text-muted,#64748b);">${_mfe(p.legacyId)}</div>` : ''}</td>
        <td>${_mfe(_mfPrDate(p.date))}</td>
        <td>${_mfe(p.customer || '—')}</td>
        <td>${_mfe(principals)}</td>
        <td>${_mfe(p.requestedBy || '—')}</td>
        <td class="num">${(p.items || []).length}</td>
        <td>${badge}</td>
        <td class="num"><button type="button" class="mf-prexp" id="mfPrBtn${i}">▸</button></td>
      </tr>
      <tr id="mfPrDetail${i}" style="display:none;"><td colspan="8" style="background:var(--bg-inset,#f8fafc);">${mfPricingDetail(p)}</td></tr>`;
  }).join('');
  c.innerHTML = `<table class="flow-table"><thead><tr>
    <th>PR No</th><th>Date</th><th>Customer</th><th>Principal(s)</th><th>By</th><th class="num">Items</th><th>Status</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function _mfPrDate(d) { return (typeof flowDate === 'function') ? (flowDate(d) || d || '') : (d || ''); }

function mfPricingDetail(p) {
  const head = `<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin:0.4rem 0;">
    Destination: <strong>${_mfe(p.destination || '—')}</strong> · Commission: <strong>${_mfn(p.commission)}%</strong> · Margin: <strong>${_mfn(p.margin)}%</strong>${p.legacyId ? ' · <em>legacy pricing history</em>' : ''}</div>`;
  /* A181: this held its own copy of the breakdown table and the same fault as the pricing-history
     page — it rendered the saved breakdown rows ALONE, hiding every item the breakdown did not cover.
     Both now go through the shared join in flow-api.js, so the two views can no longer disagree. */
  const rows = flowPricingRows(p);
  if (rows.some(x => x.hasBd)) return head + flowPricingBreakdownTable(rows);
  const items = p.items || [];
  if (!items.length) return head + '<div class="mf-empty">No item detail.</div>';
  const body = items.map(it => `<tr>
    <td>${_mfe(it.itemNo || '—')}</td><td>${_mfe(it.itemName || '—')}</td>
    <td class="num">${_mfn(it.qty)}</td><td>${_mfe(it.principal || '—')}</td>
    <td class="num">${_mfm(_mfn(it.supplierPrice))}</td><td class="num">${_mfm(_mfn(it.finalPrice))}</td></tr>`).join('');
  return head + `<div style="overflow-x:auto;"><table class="flow-table" style="font-size:0.78rem;">
    <thead><tr><th>Item No</th><th>Name</th><th class="num">Qty</th><th>Principal</th><th class="num">Supplier Price</th><th class="num">Final Price</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function mfTogglePricing(i) {
  const row = document.getElementById('mfPrDetail' + i), btn = document.getElementById('mfPrBtn' + i);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▸' : '▾';
}

// ── Auto Daily Reports (ported from all-daily-reports.js) ──
let mfDrEntries = [], mfDrNotes = {}, mfDrSubs = {};
let mfDrEmails = {}, mfDrRosterError = '', mfDrEmailsLoading = false, mfDrEmailSeq = 0;
const MF_MODULE_ORDER = ['Pricing Request', 'Quotation', 'Sales Order', 'Purchase Order', 'AP Aging', 'Receiving', 'Invoice', 'Inventory', 'Marketing', 'Call', 'Document'];
function _mfModClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _mfTime(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function _mfIsDoc(a) { return ['Created', 'Issued', 'Received', 'Added'].includes(a); }

async function mfLoadDailyReports() {
  const date = document.getElementById('mgmtDrDate').value;
  const meta = document.getElementById('mgmtDrMeta');
  if (meta) meta.textContent = `For ${date} · auto-collected from Process Flow activity`;
  // A155: prime the request-number → client/supplier name map so legacy blank-ref
  // "Client saved" rows can be titled with the client they belong to (idempotent).
  if (typeof flowPrimeRefNames === 'function') await flowPrimeRefNames();
  try {
    const res = await fetchFlow('getActivityLog', { date });
    mfDrEntries = (res && res.data) || [];
  } catch (e) {
    mfDrEntries = [];
    document.getElementById('mgmtDrBody').innerHTML = `<div class="mf-empty">${_mfe(e.message)}</div>`;
  }
  mfDrNotes = {};
  const users = Array.from(new Set(mfDrEntries.map(e => e.user).filter(Boolean)));
  await Promise.all(users.map(u =>
    fetchFlow('getDailyNote', { date, user: u }).then(r => { if (r && r.notes) mfDrNotes[u] = r.notes; }).catch(() => {})
  ));
  // What each person actually SUBMITTED for the day (vs what the system merely recorded).
  mfDrSubs = {};
  try {
    const sr = await fetchFlow('getDailyReports', { date });
    if (sr && sr.success) (sr.data || []).forEach(x => { mfDrSubs[String(x.user).trim()] = x; });
  } catch (e) { /* pre-v81 backend — the day simply shows as unsubmitted */ }
  // Each user's sent emails — fetched after activity so the cards paint immediately, then fill in.
  mfDrEmails = {}; mfDrEmailsLoading = true;
  mfRenderDailyReports();
  await mfLoadAllEmails(++mfDrEmailSeq);
  mfDrEmailsLoading = false;
  mfRenderDailyReports();
}

// Per-user sent emails for the team report — mirrors all-daily-reports.js: roster → own-first warmup →
// batches of 3 (GoDaddy throttles concurrent IMAP logins from one IP), repainting after each batch.
async function mfLoadAllEmails(seq) {
  mfDrEmails = {}; mfDrRosterError = '';
  if (typeof apiFetchEmailUsers !== 'function' || typeof apiFetchEmailLogToday !== 'function') return;
  let list = [];
  try {
    const r = await apiFetchEmailUsers();
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the user list.');
    list = r.users || [];
  } catch (e) { mfDrRosterError = e.message || 'Could not load the user list.'; return; }
  const targets = list.filter(u => String(u.role || '').toLowerCase() !== 'director');
  const date = document.getElementById('mgmtDrDate').value;
  const fetchOne = (u) => {
    const uname = u.username || u.fullName || u.name;                 // creds keyed by login username
    const disp = u.fullName || u.name || u.username;                  // cards keyed by display name
    if (!uname) return Promise.resolve();
    return apiFetchEmailLogToday(uname, date).then(r => {
      if (r && r.success) mfDrEmails[disp] = { emails: r.emails || [], needsSetup: !!r.needsSetup, reconnect: !!r.reconnect };
      else mfDrEmails[disp] = { emails: [], needsSetup: !!(r && r.needsSetup), error: (r && r.message) || 'load failed' };
    }).catch(e => { mfDrEmails[disp] = { emails: [], needsSetup: false, error: e.message || 'load failed' }; });
  };
  try { await apiFetchEmailLogToday(undefined, date); } catch (e) { /* warm-up only */ }
  for (let i = 0; i < targets.length; i += 3) {
    await Promise.all(targets.slice(i, i + 3).map(fetchOne));
    if (seq !== undefined && seq !== mfDrEmailSeq) return;   // superseded by a newer load (date change)
    mfRenderDailyReports();
  }
}

function mfEmailHtml(name) {
  const date = document.getElementById('mgmtDrDate').value;
  const head = `<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);margin:0.6rem 0 0.3rem;">✉️ Sent Emails — ${_mfe(date)}</div>`;
  const rec = mfDrEmails[name];
  if (!rec) {
    if (mfDrRosterError) return head + `<div class="mf-empty" style="font-size:0.8rem;color:#b45309;">Sent emails unavailable — ${_mfe(mfDrRosterError)}</div>`;
    if (mfDrEmailsLoading) return head + `<div class="mf-empty" style="font-size:0.8rem;">Loading sent emails…</div>`;
    return head + `<div class="mf-empty" style="font-size:0.8rem;">—</div>`;
  }
  if (rec.needsSetup) {
    const why = rec.reconnect ? `${_mfe(name)} needs to reconnect their mailbox.` : `${_mfe(name)} hasn't connected their mailbox.`;
    return head + `<div class="mf-empty" style="font-size:0.8rem;">${why}</div>`;
  }
  if (rec.error) return head + `<div class="mf-empty" style="font-size:0.8rem;color:#b45309;">Couldn't load (${_mfe(rec.error)}) — retrying on the next refresh.</div>`;
  const emails = rec.emails || [];
  if (!emails.length) return head + `<div class="mf-empty" style="font-size:0.8rem;">No emails sent on ${_mfe(date)}.</div>`;
  return head + `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Time</th><th>To</th><th>Subject</th></tr></thead>
    <tbody>${emails.map(m => `<tr><td>${_mfe(m.sentAt || m.time || '')}</td><td>${_mfe(m.recipient || '')}</td><td>${_mfe(m.subject || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

function mfRenderDailyReports() {
  if (typeof flowRenderInjectCss === 'function') flowRenderInjectCss();
  const sEl = document.getElementById('mgmtDrSearch');
  const q = (sEl ? sEl.value : '').trim().toLowerCase();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Group by user, then collapse EACH user's raw actions into DISTINCT tasks (one per record).
  const byUser = {};
  mfDrEntries.forEach(e => { const u = e.user || 'Unknown'; (byUser[u] = byUser[u] || []).push(e); });
  const userTasks = {};
  Object.keys(byUser).forEach(u => { const t = flowRollupActivity(byUser[u]); userTasks[u] = { tasks: t, counts: flowActivityCounts(t) }; });

  let orgTasks = 0, orgDocs = 0, orgPdfs = 0, orgSales = 0;
  Object.keys(userTasks).forEach(u => { const c = userTasks[u].counts; orgTasks += c.tasks; orgDocs += c.docs; orgPdfs += c.pdfs; orgSales += flowTaskAmount(userTasks[u].tasks, 'Invoice'); });
  set('mgmtDrUsers', Object.keys(byUser).filter(u => u && u !== 'Unknown').length);
  set('mgmtDrMovements', orgTasks);
  set('mgmtDrDocs', orgDocs);
  set('mgmtDrSales', _mfm(orgSales));
  set('mgmtDrPdfs', orgPdfs);

  let names = Object.keys(byUser).sort((a, b) => a.localeCompare(b));
  Object.keys(mfDrNotes).forEach(u => { if (!byUser[u]) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  Object.keys(mfDrSubs).forEach(u => { if (!byUser[u]) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  Object.keys(mfDrEmails).forEach(u => { if (!byUser[u] && (mfDrEmails[u].emails || []).length) { byUser[u] = []; userTasks[u] = { tasks: [], counts: flowActivityCounts([]) }; names.push(u); } });
  names = Array.from(new Set(names));
  if (q) names = names.filter(n => n.toLowerCase().includes(q));

  const cont = document.getElementById('mgmtDrBody');
  if (!names.length) { cont.innerHTML = '<div class="mf-empty">No activity recorded for this day.</div>'; return; }

  // Team productivity comparison (distinct tasks per user, sorted high→low).
  const prodRows = names.map(function (n) {
    const c = userTasks[n].counts;
    const top = Object.keys(c.byModule).sort(function (a, b) { return c.byModule[b] - c.byModule[a]; }).slice(0, 3).map(function (m) { return _mfe(m) + ' ' + c.byModule[m]; }).join(' · ');
    const em = (mfDrEmails[n] && (mfDrEmails[n].emails || []).length) || 0;
    return { name: n, tasks: c.tasks, top: top, emails: em, submitted: !!mfDrSubs[String(n).trim()] };
  }).sort(function (a, b) { return b.tasks - a.tasks || a.name.localeCompare(b.name); });
  const max = Math.max(1, prodRows[0] ? prodRows[0].tasks : 1);
  const prodHtml = '<div class="dr-sect-title" style="margin-bottom:0.5rem;">Team Productivity — Today</div>'
    + '<div style="overflow-x:auto;margin-bottom:1rem;"><table class="flow-table"><thead><tr><th>User</th><th class="num">Tasks</th><th>Output</th><th style="width:26%;"></th><th class="num">Emails</th><th>Submitted</th></tr></thead><tbody>'
    + prodRows.map(function (r) {
      return '<tr><td style="font-weight:600;">' + _mfe(r.name) + '</td><td class="num" style="font-weight:700;">' + r.tasks + '</td>'
        + '<td style="font-size:0.78rem;color:var(--text-secondary,#475569);">' + (r.top || '—') + '</td>'
        + '<td><div style="height:8px;border-radius:999px;background:var(--bg-inset,#f1f5f9);overflow:hidden;"><div style="height:100%;width:' + Math.round(r.tasks / max * 100) + '%;background:var(--accent,#4f46e5);"></div></div></td>'
        + '<td class="num">' + (r.emails || '') + '</td>'
        + '<td>' + (r.submitted ? '<span style="color:#15803d;font-weight:700;">✓</span>' : '<span style="color:#b45309;">—</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  cont.innerHTML = prodHtml + names.map((name, i) => {
    const ut = userTasks[name], tasks = ut.tasks, c = ut.counts;
    const note = mfDrNotes[name];
    const modChips = Object.keys(c.byModule).sort((a, b) => (MF_MODULE_ORDER.indexOf(a) + 1 || 99) - (MF_MODULE_ORDER.indexOf(b) + 1 || 99))
      .map(m => `<span class="mod-badge ${_mfModClass(m)}">${_mfe(m)} ${c.byModule[m]}</span>`).join('');
    const sub = mfDrSubs[String(name).trim()];
    const emCount = (mfDrEmails[name] && (mfDrEmails[name].emails || []).length) || 0;
    const emChip = emCount ? ` · ✉️ ${emCount} sent` : '';
    const subChip = sub
      ? ` · <span style="color:${sub.status === 'Reviewed' ? '#0d9488' : '#15803d'};">✓ submitted ${_mfe(_mfTime(sub.submittedAt))}${sub.status === 'Reviewed' ? ' · reviewed' : ''}</span>`
      : ' · <span style="color:#b45309;">not submitted</span>';
    return `<details class="urep"${i === 0 ? ' open' : ''}>
      <summary><span class="uname">${_mfe(name)}</span>
        <span class="ustat">${c.tasks} task(s) · ${c.docs} doc(s)${emChip}${note ? ' · 📝 note' : ''}${subChip}</span></summary>
      <div class="urep-body">
        ${modChips ? `<div class="umods">${modChips}</div>` : ''}
        ${flowRenderTaskCards(tasks, { moduleOrder: MF_MODULE_ORDER, emptyText: 'No movements (note only).' })}
        ${mfEmailHtml(name)}
        ${mfSubmissionHtml(sub)}
        ${note ? `<div class="urep-note"><strong>Notes:</strong> ${_mfe(note)}</div>` : ''}
      </div>
    </details>`;
  }).join('');
}

/** What the person wrote when they submitted, plus management's acknowledgement control. */
function mfSubmissionHtml(sub) {
  if (!sub) return '';
  const part = (label, text) => text
    ? `<div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#0d9488;margin-top:0.4rem;">${label}</div>
       <div style="font-size:0.84rem;white-space:pre-wrap;">${_mfe(text)}</div>` : '';
  const body = part('Highlights', sub.highlights) + part('Blockers', sub.blockers) + part('Plan', sub.plan);
  const review = sub.status === 'Reviewed'
    ? `<span style="font-size:0.75rem;color:#0d9488;font-weight:700;">✓ Reviewed by ${_mfe(sub.reviewedBy)}${sub.reviewNote ? ` — ${_mfe(sub.reviewNote)}` : ''}</span>`
    : `<button class="link-btn" onclick="mfReviewReport('${_mfe(sub.reportNo)}')">Mark reviewed</button>`;
  return `<div style="margin-top:0.7rem;border-left:3px solid var(--accent,#0d9488);background:var(--bg-inset,#f8fafc);padding:0.6rem 0.85rem;border-radius:0 8px 8px 0;">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
      <strong style="font-size:0.8rem;">Daily report submitted</strong>
      <span style="font-size:0.75rem;color:var(--text-muted,#64748b);">${_mfe(_mfTime(sub.submittedAt))}${_mfn(sub.submitCount) > 1 ? ` · updated ${_mfn(sub.submitCount)}×` : ''}</span>
      <span style="margin-left:auto;">${review}</span>
    </div>
    ${body || '<div style="font-size:0.82rem;color:var(--text-muted,#94a3b8);font-style:italic;">Submitted with no written notes.</div>'}
  </div>`;
}

async function mfReviewReport(reportNo) {
  const note = prompt('Optional comment for this report:', '');
  if (note === null) return;
  try {
    const r = await postFlow('reviewDailyReport', { reportNo, reviewNote: note });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not mark reviewed.');
    mfLoadDailyReports();
  } catch (e) { alert(e.message); }
}

// ═══ Team Weekly Report — delegated to the shared team-performance module ═══
// The renderer/aggregation/PDF now live in js/team-performance.js so the management home and the
// HR-accessible Team Performance page are ONE implementation. These wrappers keep the inline
// onclick="mfTwNav(...)" / onclick="mfTwPdf()" attributes in management-home.html working.

function mfTwNav(delta) { if (typeof tpNavWeek === 'function') tpNavWeek(delta); }
function mfTwPdf() { if (typeof tpTeamPdf === 'function') tpTeamPdf(); }

function mfLoadTeamWeek() {
  if (typeof initTeamPerformance !== 'function') return;
  initTeamPerformance({
    mountId: 'mfTwBody', rangeId: 'mfTwRange', nextBtnId: 'mfTwNext',
    resetBtnId: 'mfTwReset', pdfBtnId: 'mfTwPdfBtn',
    // A function so the management date picker keeps driving which week is shown.
    baseDate: () => (document.getElementById('mgmtDrDate') || {}).value || flowToday(),
    mode: 'compact', withEmails: true, withSubmissions: true,
    chartIdPrefix: 'mfTwChart_',        // unchanged canvas ids — nothing else on the page shifts
  });
}


/* A190 — read the plan before approving it. Approving a week of visits sight-unseen is the same
   failure the A183 pricing review was built to stop. */
let mfItinByNo = {};

function mfViewItinerary(no) {
  const it = mfItinByNo[String(no)];
  if (!it) return;
  const rows = (it.items || []).slice().sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.plannedTime || '').localeCompare(String(b.plannedTime || '')));
  const body = rows.length ? rows.map(r => `<tr>
      <td>${_mfe(r.day || '')}<div style="font-size:0.7rem;color:#64748b;">${_mfe(r.date || '')}</div></td>
      <td>${_mfe(r.plannedTime || '—')}</td>
      <td><strong>${_mfe(r.company || '—')}</strong><div style="font-size:0.72rem;color:#64748b;">${_mfe(r.personToMeet || '')}</div></td>
      <td>${_mfe(r.cityArea || '—')}</td>
      <td>${_mfe(r.purpose || '')}</td>
      <td>${_mfe(r.agenda || '')}</td>
      <td>${_mfe(r.expectedOutcome || '')}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;padding:1rem;color:#64748b;">No planned visits.</td></tr>';

  const el = document.createElement('div');
  el.className = 'flow-modal-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:3000;overflow-y:auto;padding:2rem 1rem;';
  el.innerHTML = `<div class="flow-modal" style="max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;padding:1.2rem 1.4rem;">
    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.8rem;">
      <h3 style="margin:0;font-size:1rem;">${_mfe(it.itineraryNo)} — ${_mfe(it.user)}</h3>
      <span style="font-size:0.8rem;color:#64748b;">${_mfe(it.weekStart)} – ${_mfe(it.weekEnd)}</span>
      <button class="btn btn-sm btn-secondary" style="margin-left:auto;">Close</button>
    </div>
    ${it.objectives ? `<p style="margin:0 0 0.5rem;font-size:0.85rem;"><strong>Objectives:</strong> ${_mfe(it.objectives)}</p>` : ''}
    ${it.notes ? `<p style="margin:0 0 0.5rem;font-size:0.85rem;color:#64748b;">${_mfe(it.notes)}</p>` : ''}
    <p style="margin:0 0 0.7rem;font-size:0.78rem;color:#15803d;">Director approved${it.dirApprovedBy ? ' by ' + _mfe(it.dirApprovedBy) : ''}${it.dirApprovedAt ? ' on ' + _mfe(it.dirApprovedAt) : ''}.</p>
    <div style="overflow-x:auto;"><table class="flow-table"><thead><tr>
      <th>Day</th><th>Time</th><th>Company / who</th><th>City / area</th><th>Purpose</th><th>Agenda</th><th>Expected outcome</th>
    </tr></thead><tbody>${body}</tbody></table></div>
  </div>`;
  const close = () => el.remove();
  el.querySelector('button').addEventListener('click', close);
  el.addEventListener('click', ev => { if (ev.target === el) close(); });
  document.body.appendChild(el);
}
