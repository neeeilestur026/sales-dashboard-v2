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
  const dp = document.getElementById('mgmtDrDate');
  if (dp) {
    dp.value = new Date().toISOString().slice(0, 10);
    dp.addEventListener('change', mfLoadDailyReports);
    const s = document.getElementById('mgmtDrSearch');
    if (s) s.addEventListener('input', mfRenderDailyReports);
    mfLoadDailyReports();
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
    const invVal = items.reduce((s, i) => s + _mfn(i.totalLanded), 0);
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
    const qRows = quotes.map(x => `<tr>
      <td><span class="flow-badge b-pending">Quotation</span></td>
      <td>${_mfe(x.quotationNo)}</td><td>${_mfe(x.customer)}</td>
      <td class="num">${_mfm(x.total)}</td>
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
    const items = (r && r.data) || [];
    if (!items.length) { c.innerHTML = '<div class="mf-empty">No inventory items.</div>'; return; }
    const low = items.filter(i => _mfn(i.balance) <= 0);
    const rows = items.slice().sort((a, b) => _mfn(a.balance) - _mfn(b.balance)).slice(0, 20).map(i => `<tr>
      <td>${_mfe(i.itemNo)}</td><td>${_mfe(i.description)}</td>
      <td class="num"${_mfn(i.balance) <= 0 ? ' style="color:#ef4444;font-weight:700;"' : ''}>${_mfn(i.balance)}</td>
      <td class="num">${_mfm(i.landedCost)}</td><td class="num">${_mfm(i.totalLanded)}</td></tr>`).join('');
    c.innerHTML = `<div class="mf-invmeta">${items.length} item(s) · ${low.length} at/below zero · total value ${_mfm(items.reduce((s, i) => s + _mfn(i.totalLanded), 0))}</div>
      <div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Item No</th><th>Description</th><th class="num">Balance</th><th class="num">Landed/Unit</th><th class="num">Total Landed</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="margin-top:0.5rem;"><a href="flow-inventory.html" class="link-btn">View all inventory →</a></div>`;
  } catch (e) { c.innerHTML = `<div class="mf-empty" style="color:#ef4444;">${_mfe(e.message)}</div>`; }
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
