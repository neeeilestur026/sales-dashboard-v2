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
    dp.addEventListener('change', () => { mfLoadDailyReports(); _mfTwOffset = 0; mfLoadTeamWeek(); });
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
    const [r, po] = await Promise.all([
      fetchFlow('getInventory'),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] }))
    ]);
    const everything = (r && r.data) || [];
    // Show REAL inventory only (Type 'Stock'); quotation Catalog items are on the Inventory page.
    const items = flowStockItems(everything);
    const typed = items.length !== everything.length || everything.some(i => i.type === 'Stock' || i.type === 'Catalog');
    if (!items.length) { c.innerHTML = '<div class="mf-empty">No stock items.</div>'; return; }
    // Items on any Purchase Order are "ordered already".
    const orderedSet = new Set();
    ((po && po.data) || []).forEach(p => (p.items || []).forEach(it => {
      if (it && it.itemNo != null && String(it.itemNo).trim() !== '') orderedSet.add(String(it.itemNo).toLowerCase());
    }));
    const isOrdered = i => orderedSet.has(String(i.itemNo).toLowerCase());
    const orderedN = items.filter(isOrdered).length;
    const low = items.filter(i => _mfn(i.balance) <= 0);
    const rows = items.slice().sort((a, b) => _mfn(a.balance) - _mfn(b.balance)).slice(0, 20).map(i => `<tr>
      <td>${_mfe(i.itemNo)}</td><td>${_mfe(i.description)}</td>
      <td class="num"${_mfn(i.balance) <= 0 ? ' style="color:#ef4444;font-weight:700;"' : ''}>${_mfn(i.balance)}</td>
      <td class="num">${_mfm(i.landedCost)}</td><td class="num">${_mfm(i.totalLanded)}</td>
      <td>${isOrdered(i) ? '<span style="color:#16a34a;font-weight:700;">✅ PO</span>' : '<span style="color:#94a3b8;">—</span>'}</td></tr>`).join('');
    c.innerHTML = `<div class="mf-invmeta">${items.length} stock item(s)${typed ? ` · ${everything.length - items.length} catalog hidden` : ''} · ${orderedN} ordered · ${low.length} at/below zero · total value ${_mfm(items.reduce((s, i) => s + _mfn(i.totalLanded), 0))}</div>
      <div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Item No</th><th>Description</th><th class="num">Balance</th><th class="num">Landed/Unit</th><th class="num">Total Landed</th><th>Ordered?</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="margin-top:0.5rem;"><a href="flow-inventory.html" class="link-btn">View all inventory →</a></div>`;
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

// ═══ Team Weekly Report (A110/A111) — per-user ROLE-AWARE task charts for a Mon–Sun week ═══
// Data: getActivityLog ×7 (all users) + getSalesCalls ×7 + per-user sent emails (roster via
// apiFetchEmailUsers — also supplies each user's ROLE so the chart shows that role's tasks).
// PDF: the PROVEN payslip pattern (director-home _renderPayslipPdf) — self-contained HTML written
// into a hidden iframe, html2pdf CDN injected INTO the iframe, image-load gate, double-rAF,
// win.html2pdf().from(win.document.body).save(). Charts travel as data-URL <img>s.

let _mfTwOffset = 0, _mfTwSeq = 0, _mfTwUsers = null, _mfTwCharts = [], _mfTwRoles = {}, _mfTwRoster = [];
const MF_TW_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

// Each role sees ITS tasks on the chart/summary (label → counter key; keys: calls/emails/other or a module).
const MF_TW_ROLE_TASKS = {
  sales: [['Calls', 'calls'], ['Emails', 'emails'], ['Quotations', 'Quotation'],
          ['Purchase Requests', 'Pricing Request'], ['Inventory', 'Inventory'], ['Other', 'other']],
  accounting: [['Emails', 'emails'], ['Invoices', 'Invoice'], ['Receiving', 'Receiving'],
               ['Collections', 'Collection'], ['Expenses', 'Expense'], ['Sales Orders', 'Sales Order'], ['Other', 'other']],
  admin: [['Emails', 'emails'], ['Purchase Orders', 'Purchase Order'], ['Sales Orders', 'Sales Order'],
          ['Shipments', 'Shipment'], ['Payment Requests', 'Payment Request'],
          ['Pricing Requests', 'Pricing Request'], ['Other', 'other']],
  default: [['Calls', 'calls'], ['Emails', 'emails'], ['Quotations', 'Quotation'],
            ['Purchase Requests', 'Pricing Request'], ['Sales Orders', 'Sales Order'],
            ['Purchase Orders', 'Purchase Order'], ['Invoices', 'Invoice'], ['Other', 'other']],
};
function _mfTwTasksFor(name) {
  return MF_TW_ROLE_TASKS[_mfTwRoles[name] || ''] || MF_TW_ROLE_TASKS.default;
}

function _mfTwDays() {
  const base = (document.getElementById('mgmtDrDate') || {}).value || flowToday();
  const d = new Date(base + 'T00:00:00');
  if (isNaN(d)) return [];
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) + _mfTwOffset * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon); x.setDate(mon.getDate() + i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}

function mfTwNav(delta) {
  _mfTwOffset = delta === 0 ? 0 : _mfTwOffset + delta;
  mfLoadTeamWeek();
}

function _mfTwWeekAfterIsFuture(days) {
  const last = new Date(days[6] + 'T00:00:00');
  last.setDate(last.getDate() + 1);
  const nextStart = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return nextStart > flowToday();
}

async function mfLoadTeamWeek() {
  const body = document.getElementById('mfTwBody');
  if (!body) return;
  const seq = ++_mfTwSeq;
  const days = _mfTwDays();
  if (!days.length) return;
  const today = flowToday();
  const range = document.getElementById('mfTwRange');
  if (range) range.textContent = `${days[0]} – ${days[6]}${_mfTwOffset ? ` (${_mfTwOffset > 0 ? '+' : ''}${_mfTwOffset} wk)` : ''}`;
  const nextBtn = document.getElementById('mfTwNext');
  if (nextBtn) nextBtn.disabled = _mfTwWeekAfterIsFuture(days);
  const resetBtn = document.getElementById('mfTwReset');
  if (resetBtn) resetBtn.style.display = _mfTwOffset ? '' : 'none';
  const pdfBtn = document.getElementById('mfTwPdfBtn');
  if (pdfBtn) pdfBtn.disabled = true;
  body.innerHTML = '<div class="mf-empty">Loading team weekly report…</div>';

  // Roster FIRST — supplies each user's role (chart task mix) and the email usernames.
  try {
    if (typeof apiFetchEmailUsers === 'function' && !_mfTwRoster.length) {
      const ro = await apiFetchEmailUsers();
      _mfTwRoster = (ro && ro.users) || [];
    }
  } catch (e) { /* roles fall back to the generic list */ }
  _mfTwRoles = {};
  _mfTwRoster.forEach(u => { _mfTwRoles[u.fullName || u.username] = String(u.role || '').toLowerCase(); });
  if (seq !== _mfTwSeq) return;

  // Activity + calls ×7 (all users) in parallel; future days skipped.
  const [acts, calls] = await Promise.all([
    Promise.all(days.map(d => d > today ? Promise.resolve([])
      : fetchFlow('getActivityLog', { date: d }).then(r => (r && r.data) || []).catch(() => []))),
    Promise.all(days.map(d => d > today ? Promise.resolve([])
      : fetchFlow('getSalesCalls', { date: d }).then(r => (r && r.data) || []).catch(() => []))),
  ]);
  if (seq !== _mfTwSeq) return;

  // Per-user aggregation.
  const users = {};
  const U = name => users[name] = users[name] || { moves: 0, calls: 0, emails: 0,
    perDay: new Array(7).fill(0), mods: {} };
  days.forEach((d, i) => {
    acts[i].forEach(e => {
      if (e.module === 'Call') return;
      const u = U(e.user || '(unknown)');
      u.moves++; u.perDay[i]++;
      u.mods[e.module] = (u.mods[e.module] || 0) + 1;
    });
    calls[i].forEach(c => { const u = U(c.user || '(unknown)'); u.calls++; });
  });
  _mfTwUsers = { users, days };
  mfTwRender();                                   // paint activity/calls immediately

  // Emails per user — day 1 first (skip the rest of the week when not connected), 2 users at a time.
  try {
    if (typeof apiFetchEmailLogToday === 'function') {
      const roster = _mfTwRoster.filter(u => String(u.role) !== 'director');
      const pastDays = days.filter(d => d <= today);
      const jobs = roster.map(u => async () => {
        const name = u.fullName || u.username;
        if (!pastDays.length) return;
        const first = await apiFetchEmailLogToday(u.username, pastDays[0]).catch(() => null);
        if (seq !== _mfTwSeq) return;
        if (!first || first.needsSetup) return;
        U(name).emails += ((first.emails || []).length);
        for (let i = 1; i < pastDays.length; i += 3) {
          await Promise.all(pastDays.slice(i, i + 3).map(async d => {
            const r = await apiFetchEmailLogToday(u.username, d).catch(() => null);
            if (r && r.success && Array.isArray(r.emails)) U(name).emails += r.emails.length;
          }));
          if (seq !== _mfTwSeq) return;
        }
      });
      for (let i = 0; i < jobs.length; i += 2) {
        await Promise.all(jobs.slice(i, i + 2).map(j => j()));
        if (seq !== _mfTwSeq) return;
        mfTwRender();                              // progressive email fill-in
      }
    }
  } catch (e) { /* emails are best-effort — the report still stands on activity+calls */ }
  if (seq === _mfTwSeq && pdfBtn) pdfBtn.disabled = false;
}

function _mfTwCounts(u, tasks) {
  return tasks.map(([, key]) => {
    if (key === 'calls') return u.calls;
    if (key === 'emails') return u.emails;
    if (key === 'other') {
      const named = tasks.map(t => t[1]);
      return Object.entries(u.mods).reduce((s, [m, n]) => s + (named.includes(m) ? 0 : n), 0);
    }
    return u.mods[key] || 0;
  });
}

const _MF_TW_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _MF_TW_ROLE_CHIP = { sales: '#0d9488', accounting: '#7c3aed', admin: '#2563eb', management: '#b45309', director: '#b45309', marketing: '#db2777' };

function mfTwRender() {
  const body = document.getElementById('mfTwBody');
  if (!body || !_mfTwUsers) return;
  const { users, days } = _mfTwUsers;
  const names = Object.keys(users).sort((a, b) => users[b].moves - users[a].moves || a.localeCompare(b));
  if (!names.length) { body.innerHTML = '<div class="mf-empty">No team activity in this week.</div>'; return; }
  const tot = f => names.reduce((s, n) => s + users[n][f], 0);
  const totMod = m => names.reduce((s, n) => s + (users[n].mods[m] || 0), 0);

  const cards = names.map((name, i) => {
    const u = users[name];
    const role = _mfTwRoles[name] || '';
    const tasks = _mfTwTasksFor(name);
    const counts = _mfTwCounts(u, tasks);
    const roleChip = role ? `<span style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:0.15rem 0.5rem;border-radius:999px;color:#fff;background:${_MF_TW_ROLE_CHIP[role] || '#64748b'};">${_mfe(role)}</span>` : '';
    const chips = tasks.map(([label], j) =>
      `<span style="display:inline-block;padding:0.22rem 0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:999px;font-size:0.72rem;background:var(--bg-inset,#f8fafc);">${_mfe(label)}: <b>${counts[j]}</b></span>`).join(' ');
    const spark = days.map((d, j) =>
      `<span title="${_mfe(d)}" style="display:inline-block;min-width:1.7rem;text-align:center;padding:0.14rem 0.15rem;border-radius:5px;background:${u.perDay[j] ? 'var(--accent-light,#e6f4f1)' : 'var(--bg-inset,#f1f5f9)'};font-size:0.68rem;">${_MF_TW_DAYS[j].slice(0, 2)}<br><b>${u.perDay[j]}</b></span>`).join(' ');
    return `<div class="mfTw-card" style="border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.9rem;background:#fff;">
      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
        <strong style="font-size:0.95rem;">${_mfe(name)}</strong>${roleChip}
        <span style="font-size:0.75rem;color:var(--text-muted,#64748b);">${u.moves} movement(s) · ${u.calls} call(s) · ${u.emails} email(s)</span>
      </div>
      <div style="display:grid;grid-template-columns:minmax(280px,1.1fr) 1fr;gap:1rem;align-items:center;margin-top:0.7rem;">
        <div><canvas id="mfTwChart_${i}" height="160"></canvas></div>
        <div>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">${chips}</div>
          <div style="margin-top:0.6rem;display:flex;gap:0.25rem;flex-wrap:wrap;">${spark}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `<div id="mfTwSheet" style="background:#fff;">
    <div style="text-align:center;margin-bottom:0.9rem;">
      <div style="font-weight:800;font-size:1.05rem;letter-spacing:0.02em;">H.O ESTUR CORPORATION</div>
      <div style="font-size:0.82rem;color:var(--text-muted,#64748b);">Team Weekly Report · ${_mfe(days[0])} – ${_mfe(days[6])}</div>
    </div>
    <div class="dr-tiles" style="margin-bottom:0.9rem;">
      <div class="dr-tile"><div class="l">Team Members Active</div><div class="v">${names.length}</div></div>
      <div class="dr-tile"><div class="l">Movements</div><div class="v">${tot('moves')}</div></div>
      <div class="dr-tile"><div class="l">Calls</div><div class="v">${tot('calls')}</div></div>
      <div class="dr-tile"><div class="l">Emails</div><div class="v">${tot('emails')}</div></div>
      <div class="dr-tile"><div class="l">Quotations</div><div class="v">${totMod('Quotation')}</div></div>
      <div class="dr-tile"><div class="l">Purchase Requests</div><div class="v">${totMod('Pricing Request')}</div></div>
    </div>
    ${cards}
  </div>`;
  mfTwDrawCharts(names);
}

async function mfTwDrawCharts(names) {
  try {
    if (typeof loadLib === 'function') await loadLib('https://cdn.jsdelivr.net/npm/chart.js');
    if (typeof Chart === 'undefined') return;
    _mfTwCharts.forEach(c => { try { c.destroy(); } catch (e) {} });
    _mfTwCharts = [];
    names.forEach((name, i) => {
      const cv = document.getElementById('mfTwChart_' + i);
      if (!cv) return;
      const tasks = _mfTwTasksFor(name);
      _mfTwCharts.push(new Chart(cv.getContext('2d'), {
        type: 'bar',
        data: { labels: tasks.map(t => t[0]),
                datasets: [{ data: _mfTwCounts(_mfTwUsers.users[name], tasks), backgroundColor: '#0d9488' }] },
        options: { animation: false, responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { font: { size: 9 } } } } }
      }));
    });
  } catch (e) { /* charts are decorative — the count chips already carry the data */ }
}

// ── PDF: self-contained report HTML (own CSS, charts as data-URL images) ──
function _mfTwReportHtml() {
  const { users, days } = _mfTwUsers;
  const names = Object.keys(users).sort((a, b) => users[b].moves - users[a].moves || a.localeCompare(b));
  const tot = f => names.reduce((s, n) => s + users[n][f], 0);
  const totMod = m => names.reduce((s, n) => s + (users[n].mods[m] || 0), 0);
  const tiles = [
    ['Team Members Active', names.length], ['Movements', tot('moves')], ['Calls', tot('calls')],
    ['Emails', tot('emails')], ['Quotations', totMod('Quotation')], ['Purchase Requests', totMod('Pricing Request')],
  ].map(([l, v]) => `<div class="tile"><div class="l">${_mfe(l)}</div><div class="v">${v}</div></div>`).join('');

  const cards = names.map((name, i) => {
    const u = users[name];
    const role = _mfTwRoles[name] || '';
    const tasks = _mfTwTasksFor(name);
    const counts = _mfTwCounts(u, tasks);
    // chart image from the LIVE canvas (index-matched to the render order — same `names` sort)
    let chartImg = '';
    const cv = document.getElementById('mfTwChart_' + i);
    if (cv && cv.toDataURL) {
      try { chartImg = `<img src="${cv.toDataURL('image/png')}" style="width:100%;max-width:420px;">`; } catch (e) {}
    }
    const chips = tasks.map(([label], j) => `<span class="chip">${_mfe(label)}: <b>${counts[j]}</b></span>`).join(' ');
    const spark = days.map((d, j) =>
      `<span class="day${u.perDay[j] ? ' on' : ''}">${_MF_TW_DAYS[j].slice(0, 2)} <b>${u.perDay[j]}</b></span>`).join(' ');
    return `<div class="card">
      <div class="cardhead"><strong>${_mfe(name)}</strong>${role ? `<span class="role">${_mfe(role.toUpperCase())}</span>` : ''}
        <span class="meta">${u.moves} movement(s) · ${u.calls} call(s) · ${u.emails} email(s)</span></div>
      ${chartImg}
      <div class="chips">${chips}</div>
      <div class="days">${spark}</div>
    </div>`;
  }).join('');

  const css = `
    body{margin:0;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;padding:20px;width:820px;}
    .hd{text-align:center;margin-bottom:14px;}
    .hd .co{font-weight:800;font-size:17px;letter-spacing:0.03em;}
    .hd .sub{font-size:11px;color:#64748b;margin-top:2px;}
    .tiles{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
    .tile{flex:1 1 110px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;text-align:center;}
    .tile .l{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;}
    .tile .v{font-size:17px;font-weight:800;margin-top:2px;}
    .card{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid;}
    .cardhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:13px;}
    .role{font-size:8px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:#0d9488;color:#fff;}
    .meta{font-size:10px;color:#64748b;}
    .chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;}
    .chip{border:1px solid #e2e8f0;border-radius:999px;padding:3px 9px;font-size:9.5px;background:#f8fafc;}
    .days{margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;}
    .day{display:inline-block;min-width:26px;text-align:center;border-radius:5px;padding:2px 3px;font-size:8.5px;background:#f1f5f9;}
    .day.on{background:#ccfbf1;}
    .foot{margin-top:10px;font-size:9px;color:#94a3b8;text-align:center;}`;

  return `<style>${css}</style>
    <div class="hd"><div class="co">H.O ESTUR CORPORATION</div>
      <div class="sub">Team Weekly Report · ${_mfe(days[0])} – ${_mfe(days[6])}</div></div>
    <div class="tiles">${tiles}</div>
    ${cards}
    <div class="foot">Generated ${_mfe(flowToday())} · HI-ESCORP Portal</div>`;
}

// The PROVEN payslip render pattern: hidden iframe, self-contained doc, html2pdf injected INTO the
// iframe (running the parent's instance against the iframe document captures blank), image gate,
// double-rAF, then save from the iframe's own window.
function mfTwPdf() {
  if (!_mfTwUsers) return;
  const btn = document.getElementById('mfTwPdfBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Rendering…'; }
  const restore = () => { if (btn) { btn.disabled = false; btn.textContent = '📄 View / Save PDF'; } };
  const days = _mfTwUsers.days;
  const fileName = `Team_Weekly_Report_${days[0]}_${days[6]}.pdf`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:880px;height:1400px;opacity:0;border:0;z-index:-1;';
  document.body.appendChild(iframe);
  let done = false;
  const cleanup = () => { if (!done) { done = true; try { document.body.removeChild(iframe); } catch (e) {} restore(); } };

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + _mfTwReportHtml() + '</body></html>');
  doc.close();
  const win = iframe.contentWindow;

  const run = () => win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    try {
      win.html2pdf().set({
        margin: 8, filename: fileName,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: 860 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(win.document.body).save()
        .then(() => setTimeout(cleanup, 1500))
        .catch(err => { cleanup(); alert('Failed to generate the PDF: ' + (err && err.message || err)); });
    } catch (err) { cleanup(); alert('Failed to generate the PDF.'); }
  }));

  // Chart images are data URLs (instant), but gate anyway so nothing captures blank.
  const gate = () => {
    const imgs = Array.prototype.slice.call(win.document.images || []);
    const pending = imgs.filter(im => !im.complete);
    if (!pending.length) { run(); return; }
    let left = pending.length, fired = false;
    const go = () => { if (!fired) { fired = true; run(); } };
    pending.forEach(im => { im.addEventListener('load', () => { if (--left <= 0) go(); });
      im.addEventListener('error', () => { if (--left <= 0) go(); }); });
    setTimeout(go, 3000);
  };

  if (win.html2pdf) { gate(); }
  else {
    const sc = doc.createElement('script');
    sc.src = MF_TW_CDN;
    sc.onload = gate;
    sc.onerror = () => { cleanup(); alert('Could not load the PDF library — check your connection and try again.'); };
    doc.head.appendChild(sc);
  }
}
