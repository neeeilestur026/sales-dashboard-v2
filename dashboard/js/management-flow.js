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

document.addEventListener('DOMContentLoaded', () => {
  if (typeof _flowConfigured === 'function' && !_flowConfigured()) return;
  if (document.getElementById('mgmtKpiGrid')) mfLoadKpis();
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

// ── Approvals strip (pending Quotations + POs) ──
async function mfLoadApprovals() {
  const c = document.getElementById('mgmtApprovals');
  c.innerHTML = '<div class="mf-empty">Loading approvals…</div>';
  try {
    const [q, po, pr] = await Promise.all([
      fetchFlow('getQuotations').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getPaymentRequests').catch(() => ({ data: [] })),
    ]);
    const quotes = ((q && q.data) || []).filter(x => x.status === 'Pending Management');
    const pos = ((po && po.data) || []).filter(x => x.status === 'Pending Management');
    // Payment requests awaiting management: PO type at Pending Management; Other type at Pending Final (Mgmt not yet signed).
    const prs = ((pr && pr.data) || []).filter(x =>
      (x.type === 'PO' && x.status === 'Pending Management') ||
      (x.type === 'Other' && x.status === 'Pending Final' && !x.mgmtApprovedBy));
    if (!quotes.length && !pos.length && !prs.length) { c.innerHTML = '<div class="mf-empty">✓ Nothing pending your approval.</div>'; return; }
    const qTot = x => _mfn(x.total) || (x.items || []).reduce((s, it) => s + _mfn(it.qty) * _mfn(it.price), 0);
    const qRows = quotes.map(x => `<tr>
      <td><span class="flow-badge b-pending">Quotation</span></td>
      <td>${_mfe(x.quotationNo)}</td><td>${_mfe(x.customer)}</td>
      <td class="num">${_mfm(qTot(x))}</td>
      <td class="num" style="white-space:nowrap;">
        <button class="link-btn" onclick="mfApprove('approveQuotation','${_mfe(x.quotationNo)}','quotationNo')">Approve</button>
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
    c.innerHTML = `<div style="overflow-x:auto;"><table class="flow-table">
      <thead><tr><th>Type</th><th>No</th><th>Party</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${qRows}${pRows}${prRows}</tbody></table></div>`;
  } catch (e) { c.innerHTML = `<div class="mf-empty" style="color:#ef4444;">${_mfe(e.message)}</div>`; }
}

async function mfApprove(action, no, key) {
  try {
    const r = await postFlow(action, { [key]: no });
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
  // Prefer the full engine breakdown — legacy (migrated) or the new priced breakdown; else the flow items.
  let legacy = null;
  const bdJson = p.legacyItemsJson || p.pricedItemsJson;
  if (bdJson) { try { legacy = JSON.parse(bdJson); } catch (e) { legacy = null; } }
  const head = `<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin:0.4rem 0;">
    Destination: <strong>${_mfe(p.destination || '—')}</strong> · Commission: <strong>${_mfn(p.commission)}%</strong> · Margin: <strong>${_mfn(p.margin)}%</strong>${p.legacyId ? ' · <em>legacy pricing history</em>' : ''}</div>`;
  if (legacy && legacy.length) {
    const cols = [['modelNo', 'Model'], ['name', 'Name'], ['qty', 'Qty'], ['buyPrice', 'Buy'], ['landedCost', 'Landed'], ['totalCOGS', 'COGS'], ['commission', 'Comm'], ['profitMargin', 'Margin'], ['vat', 'VAT'], ['unitPriceVatEx', 'Unit (VAT-ex)'], ['finalPrice', 'Final']];
    const body = legacy.map(it => '<tr>' + cols.map(([k]) => {
      if (k === 'modelNo' || k === 'name') return `<td>${_mfe(it[k] || '—')}</td>`;
      if (k === 'qty') return `<td class="num">${_mfn(it[k])}</td>`;
      return `<td class="num">${_mfm(_mfn(it[k]))}</td>`;
    }).join('') + '</tr>').join('');
    return head + `<div style="overflow-x:auto;"><table class="flow-table" style="font-size:0.76rem;">
      <thead><tr>${cols.map(([, l]) => `<th${l === 'Model' || l === 'Name' ? '' : ' class="num"'}>${l}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }
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
let mfDrEntries = [], mfDrNotes = {};
const MF_MODULE_ORDER = ['Pricing Request', 'Quotation', 'Sales Order', 'Purchase Order', 'AP Aging', 'Receiving', 'Invoice', 'Inventory', 'Marketing', 'Call', 'Document'];
function _mfModClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _mfTime(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function _mfIsDoc(a) { return ['Created', 'Issued', 'Received', 'Added'].includes(a); }

async function mfLoadDailyReports() {
  const date = document.getElementById('mgmtDrDate').value;
  const meta = document.getElementById('mgmtDrMeta');
  if (meta) meta.textContent = `For ${date} · auto-collected from Process Flow activity`;
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
  mfRenderDailyReports();
}

function mfRenderDailyReports() {
  const sEl = document.getElementById('mgmtDrSearch');
  const q = (sEl ? sEl.value : '').trim().toLowerCase();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const allUsers = Array.from(new Set(mfDrEntries.map(e => e.user).filter(Boolean)));
  const sumAmt = pred => mfDrEntries.filter(pred).reduce((s, e) => s + _mfn(e.amount), 0);
  set('mgmtDrUsers', allUsers.length);
  set('mgmtDrMovements', mfDrEntries.length);
  set('mgmtDrDocs', mfDrEntries.filter(e => _mfIsDoc(e.action)).length);
  set('mgmtDrSales', _mfm(sumAmt(e => e.module === 'Invoice' && e.action === 'Issued')));
  set('mgmtDrPdfs', mfDrEntries.filter(e => e.action === 'PDF Saved').length);

  const byUser = {};
  mfDrEntries.forEach(e => { const u = e.user || 'Unknown'; (byUser[u] = byUser[u] || []).push(e); });
  let names = Object.keys(byUser).sort((a, b) => a.localeCompare(b));
  Object.keys(mfDrNotes).forEach(u => { if (!byUser[u]) { byUser[u] = []; names.push(u); } });
  if (q) names = names.filter(n => n.toLowerCase().includes(q));

  const cont = document.getElementById('mgmtDrBody');
  if (!names.length) { cont.innerHTML = '<div class="mf-empty">No activity recorded for this day.</div>'; return; }
  cont.innerHTML = names.map((name, i) => {
    const rows = byUser[name] || [];
    const docs = rows.filter(e => _mfIsDoc(e.action)).length;
    const note = mfDrNotes[name];
    const byMod = {};
    rows.forEach(e => { byMod[e.module] = (byMod[e.module] || 0) + 1; });
    const modChips = MF_MODULE_ORDER.filter(m => byMod[m]).concat(Object.keys(byMod).filter(m => !MF_MODULE_ORDER.includes(m)))
      .map(m => `<span class="mod-badge ${_mfModClass(m)}">${_mfe(m)} ${byMod[m]}</span>`).join('');
    const tl = rows.length ? rows.map(e => `<tr>
        <td>${_mfe(_mfTime(e.timestamp))}</td>
        <td><span class="mod-badge ${_mfModClass(e.module)}">${_mfe(e.module)}</span></td>
        <td><span class="act-chip">${_mfe(e.action)}</span></td>
        <td>${_mfe(e.refNo)}</td>
        <td style="color:var(--text-secondary);">${_mfe(e.summary)}</td>
        <td class="num">${e.amount ? _mfm(e.amount) : ''}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="mf-empty">No movements (note only).</td></tr>';
    return `<details class="urep"${i === 0 ? ' open' : ''}>
      <summary><span class="uname">${_mfe(name)}</span>
        <span class="ustat">${rows.length} movement(s) · ${docs} doc(s)${note ? ' · 📝 note' : ''}</span></summary>
      <div class="urep-body">
        ${modChips ? `<div class="umods">${modChips}</div>` : ''}
        <div style="overflow-x:auto;"><table class="flow-table">
          <thead><tr><th>Time</th><th>Module</th><th>Action</th><th>Reference</th><th>Detail</th><th class="num">Amount</th></tr></thead>
          <tbody>${tl}</tbody></table></div>
        ${note ? `<div class="urep-note"><strong>Notes:</strong> ${_mfe(note)}</div>` : ''}
      </div>
    </details>`;
  }).join('');
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
