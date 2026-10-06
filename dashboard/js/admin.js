/* ═══════════════════════════════════════════════
   admin.js — Admin home hub logic
   ═══════════════════════════════════════════════ */


document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;

  clearApiCache();

  // Render navbar and greeting
  renderNavbar('admin-home');
  document.getElementById('greeting').innerHTML = getGreeting(session.name);

  // Load recent activity feed from the Process Flow movement log (today)
  try {
    const today = flowToday();   // Manila-local (toISOString is UTC → shows yesterday before 8 AM PH)
    const res = await fetchFlow('getActivityLog', { date: today });
    const entries = (res && res.data) || [];
    const feedEl = document.getElementById('activityFeed');
    const icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    if (!entries.length) {
      feedEl.innerHTML = '<div class="ad-empty">No flow activity today.</div>';
    } else {
      feedEl.innerHTML = entries.slice(0, 20).map(e => {
        const t = (() => { const d = new Date(e.timestamp); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); })();
        const who = e.user ? `<strong>${esc(e.user)}</strong> ` : '';
        return `<div class="feedrow">
          <span class="fi">${icon}</span>
          <div class="ft">${who}${esc(e.action)} <strong>${esc(e.module)}</strong>${e.refNo ? ' · ' + esc(e.refNo) : ''}</div>
          <span class="fw">${t}</span>
        </div>`;
      }).join('');
    }
  } catch (err) {
    const feedEl = document.getElementById('activityFeed');
    if (feedEl) feedEl.innerHTML = '<div class="ad-empty">Could not load activity.</div>';
  }

  // Load task overview (non-blocking — runs after activity feed)
  loadTaskOverview();

  // Load inventory snapshot (non-blocking)
  loadInventorySnapshot();
});

// ---------------------------------------------------------------------------
// Task Overview
// ---------------------------------------------------------------------------

// Tab state
const _taskLoaded = {};

// Process-flow task tabs (Shipments retained from the production subsystem).
const _TASK_TABS = ['qt','so','po','ap','rc','iv','pr','sm'];

function switchTaskTab(tab) {
  _TASK_TABS.forEach(t => {
    const btn   = document.getElementById('tabTask' + t.charAt(0).toUpperCase() + t.slice(1));
    const panel = document.getElementById('taskPanel' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? '' : 'none';
  });
  if (!_taskLoaded[tab]) {
    _taskLoaded[tab] = true;
    _loadTaskPanel(tab);
  }
}

// Open the shared documents modal for a flow record.
function _docsBtn(module, ref) {
  return `<button class="link-btn" onclick='openDocsModal("${module}","${esc(ref)}")'>Docs</button>`;
}
function _pdfCell(link) {
  return link ? `<a href="${esc(link)}" target="_blank" class="link-btn">View</a>` : '<span class="hx-dim">—</span>';
}
function _isOpenStatus(s) { return !/(closed|paid|delivered|done|quoted|cancel|complete)/i.test(String(s || '')); }

// Per-tab loaders read the new Process Flow (FlowAPI) backend. Each row gets a
// Docs button (shared modal) so documents are tracked against the record.
async function _loadTaskPanel(tab) {
  if (tab === 'sm') { await _loadSmPanel(); return; }  // Shipments — retained production subsystem
  const wrapId = { qt: 'qtTableWrap', so: 'soTableWrap', po: 'poTableWrap', ap: 'apTableWrap',
                   rc: 'rcTableWrap', iv: 'ivTableWrap', pr: 'prTableWrap' }[tab];
  if (!wrapId) return;
  const wrap = document.getElementById(wrapId);
  try {
    if (tab === 'qt') {
      const r = await fetchFlow('getQuotations');
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No quotations yet.') : _tableHtml(
        ['Quotation', 'Date', 'Customer', 'Status', 'Total', 'Items', 'PDF', ''],
        rows.map(q => [
          `<span class="ref">${esc(q.quotationNo)}</span>`, esc(flowDate(q.date)), esc(q.customer),
          // A182: the NET value — q.total is the pre-discount line sum, so a discounted quotation read high here.
          _badge(q.status), `<span class="amt">${flowMoney(flowQuotationNet(q), 'PHP')}</span>${flowQuotationDiscountTag(q)}`, String((q.items || []).length),
          _pdfCell(q.pdfLink), _docsBtn('Quotation', q.quotationNo),
        ]));
    } else if (tab === 'so') {
      const r = await fetchFlow('getSalesOrders');
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No sales orders yet.') : _tableHtml(
        ['SO No', 'Quotation', 'Date', 'Customer', 'Status', 'Total', 'Items', ''],
        rows.map(s => [
          `<span class="ref">${esc(s.soNo)}</span>`, esc(s.quotationNo), esc(flowDate(s.date)), esc(s.customer),
          _badge(s.status), `<span class="amt">${flowMoney(s.total, 'PHP')}</span>`, String((s.items || []).length),
          _docsBtn('Sales Order', s.soNo),
        ]));
    } else if (tab === 'po') {
      const r = await fetchFlow('getPurchaseOrders');
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No purchase orders yet.') : _tableHtml(
        ['PO No', 'SO', 'Date', 'Supplier', 'Cur', 'Total (FC)', 'Status', 'PDF', ''],
        rows.map(p => [
          `<span class="ref">${esc(p.poNo)}</span>`, esc(p.soNo), esc(flowDate(p.date)), esc(p.supplier),
          esc(p.currency), `<span class="amt">${flowMoney(p.total, p.currency)}</span>`, _badge(p.status),
          _pdfCell(p.pdfLink), _docsBtn('Purchase Order', p.poNo),
        ]));
    } else if (tab === 'ap') {
      const r = await fetchFlow('getAPAging');
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No payables yet.') : _tableHtml(
        ['AP No', 'PO', 'Supplier', 'Amount (PHP)', 'Paid', 'Outstanding', 'Status', 'Due', ''],
        rows.map(a => {
          const out = (flowNum(a.amountPHP) - flowNum(a.paidPHP));
          return [
            `<span class="ref">${esc(a.apNo)}</span>`, esc(a.poNo), esc(a.supplier),
            `<span class="amt">${flowMoney(a.amountPHP, 'PHP')}</span>`,
            `<span class="amt">${flowMoney(a.paidPHP, 'PHP')}</span>`,
            `<span class="amt">${flowMoney(out, 'PHP')}</span>`, _badge(a.status), esc(flowDate(a.dueDate)),
            _docsBtn('AP Aging', a.apNo),
          ];
        }));
    } else if (tab === 'rc') {
      const r = await fetchFlow('getReceiving');
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No receiving records yet.') : _tableHtml(
        ['MR No', 'PO', 'Date', 'Supplier', 'Shipping (PHP)', 'Items', ''],
        rows.map(m => [
          `<span class="ref">${esc(m.mrNo)}</span>`, esc(m.poNo), esc(flowDate(m.date)), esc(m.supplier),
          `<span class="amt">${flowMoney(m.totalShipping, 'PHP')}</span>`, String((m.items || []).length),
          _docsBtn('Receiving', m.mrNo),
        ]));
    } else if (tab === 'iv') {
      const r = await fetchFlow('getInvoices');
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No invoices yet.') : _tableHtml(
        ['INV No', 'SO', 'Date', 'Customer', 'Sales', 'COGS', 'Gross Profit', ''],
        rows.map(v => [
          `<span class="ref">${esc(v.invNo)}</span>`, esc(v.soNo), esc(flowDate(v.date)), esc(v.customer),
          `<span class="amt">${flowMoney(v.totalSales, 'PHP')}</span>`,
          `<span class="amt">${flowMoney(v.totalCOGS, 'PHP')}</span>`,
          `<span class="amt">${flowMoney(flowNum(v.totalSales) - flowNum(v.totalCOGS), 'PHP')}</span>`,
          _docsBtn('Invoice', v.invNo),
        ]));
    } else if (tab === 'pr') {
      // A191: noStore — admin renders six safe columns from this, but the payload also carries
      // commission %, margin % and the cost breakdown, which must not linger in their storage.
      const r = await fetchFlow('getPricingRequests', {}, { noStore: true });
      const rows = ((r && r.data) || []).slice(0, 50);
      wrap.innerHTML = rows.length === 0 ? _emptyMsg('No purchase requests yet.') : _tableHtml(
        ['PR No', 'Date', 'Requested By', 'Customer', 'Status', 'Items', ''],
        rows.map(p => [
          `<span class="ref">${esc(p.prNo)}</span>`, esc(flowDate(p.date)), esc(p.requestedBy), esc(p.customer),
          _badge(p.status), String((p.items || []).length), _docsBtn('Pricing Request', p.prNo),
        ]));
    }
  } catch (err) {
    if (wrap) wrap.innerHTML = _emptyMsg('Failed to load data: ' + esc(err && err.message || err));
  }
}

function _setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

async function loadTaskOverview() {
  // 4 comp KPI cards + per-tab count badges, computed from the Process Flow backend.
  try {
    const [qt, so, po, ap, rc, iv, pr] = await Promise.allSettled([
      fetchFlow('getQuotations'), fetchFlow('getSalesOrders'), fetchFlow('getPurchaseOrders'),
      fetchFlow('getAPAging'), fetchFlow('getReceiving'), fetchFlow('getInvoices'),
      fetchFlow('getPricingRequests', {}, { noStore: true }),   // A191 — counted only, never cached
    ]);
    const data = (r) => (r.status === 'fulfilled' && r.value && r.value.data) ? r.value.data : [];
    const qRows = data(qt), sRows = data(so), pRows = data(po), aRows = data(ap),
          rRows = data(rc), vRows = data(iv), prRows = data(pr);

    // Tab count badges (.ct)
    _setText('tcQt', qRows.length);
    _setText('tcSo', sRows.length);
    _setText('tcPo', pRows.length);
    _setText('tcAp', aRows.filter(a => (a.status || '').toLowerCase() !== 'paid').length);
    _setText('tcRc', rRows.length);
    _setText('tcIv', vRows.length);
    _setText('tcPr', prRows.length);

    // 4 KPI cards — this-month volume + pending approvals
    const ym = String(flowToday()).slice(0, 7);
    const inMonth = (d) => String(flowDate(d) || '').slice(0, 7) === ym;
    _setText('kpiQt', qRows.filter(q => inMonth(q.date)).length);
    _setText('kpiPr', prRows.filter(p => inMonth(p.date)).length);
    _setText('kpiPo', pRows.filter(p => inMonth(p.date)).length);
    _setText('kpiPoOpen', pRows.filter(p => _isOpenStatus(p.status)).length);
    const pendingQ  = qRows.filter(q => String(q.status) === 'Pending Admin').length;
    const pendingPr = prRows.filter(p => ['Requested', 'Sourcing'].includes(String(p.status))).length;
  } catch (err) {
    console.error('loadTaskOverview (flow) stats error:', err);
  }

  // Load the default (first) tab — Quotations
  _taskLoaded['qt'] = true;
  _loadTaskPanel('qt');

  // Shipments tab count (production subsystem, retained) — non-blocking
  apiGetShipments().then(r => {
    if (r && r.success && r.data) _setText('tcSm', r.data.length);
  }).catch(() => {});
}

// ── Helpers ──────────────────────────────────────────────

function esc(s) { return hxEsc(s); }

function fmtPHP(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _badge(status) {
  const s = String(status || '').toLowerCase().trim();
  let cls = 'sbadge-default';
  if (s.includes('pending') || s.includes('open') || s.includes('unpaid') || s.includes('requested')) cls = 'sbadge-pending';
  else if (s.includes('partial') || s.includes('sourcing') || s.includes('await') || s.includes('mgmt') || s.includes('verif')) cls = 'sbadge-awaiting';
  else if (s.includes('approv') || s.includes('quoted') || s.includes('returned')) cls = 'sbadge-approved';
  else if (s.includes('reject') || s.includes('cancel')) cls = 'sbadge-rejected';
  else if (s.includes('sent'))   cls = 'sbadge-sent';
  else if (s.includes('paid') || s.includes('closed') || s.includes('issued') || s.includes('received')) cls = 'sbadge-paid';
  else if (s.includes('deliver')) cls = 'sbadge-delivered';
  return `<span class="sbadge ${cls}">${esc(status)}</span>`;
}

function _tableHtml(headers, rows) {
  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(cols => `<tr>${cols.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="task-tbl"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function _emptyMsg(msg) {
  return `<div class="ad-empty">${msg}</div>`;
}

// ---------------------------------------------------------------------------
// Inventory Snapshot
// ---------------------------------------------------------------------------

async function loadInventorySnapshot() {
  const wrap = document.getElementById('invSnapshotWrap');
  try {
    // Inventory + POs: flag items that already have a purchase order ("ordered already").
    const [r, po] = await Promise.all([
      fetchFlow('getInventory'),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] }))
    ]);
    const everything = (r && r.data) || [];
    // The home snapshot shows REAL inventory only (Type 'Stock' — migrated stocks / received /
    // PO-processed items); quotation Catalog items live on the Inventory page's own section.
    const all = flowStockItems(everything);
    const typed = all.length !== everything.length || everything.some(it => it.type === 'Stock' || it.type === 'Catalog');
    const orderedSet = new Set();
    ((po && po.data) || []).forEach(p => (p.items || []).forEach(it => {
      if (it && it.itemNo != null && String(it.itemNo).trim() !== '') orderedSet.add(String(it.itemNo).toLowerCase());
    }));
    const isOrdered = it => orderedSet.has(String(it.itemNo).toLowerCase());
    if (all.length === 0) {
      wrap.innerHTML = _emptyMsg('No stock items found.');
      return;
    }
    const orderedN = all.filter(isOrdered).length;
    const rows = all.slice(0, 30);
    wrap.innerHTML =
      `<div class="ad-inv-meta">${typed ? `${all.length} stock item(s) · ${everything.length - all.length} catalog hidden` : `${orderedN} ordered · ${all.length - orderedN} not ordered`}</div>` +
      _tableHtml(
        ['Item No', 'Description', 'Balance', 'Landed/Unit', 'Ordered?'],
        rows.map(item => [
          `<span class="ref">${esc(item.itemNo || '—')}</span>`,
          esc(item.description || '—'),
          `<span class="amt">${flowNum(item.balance).toLocaleString()}</span>`,
          `<span class="amt">${flowMoney(item.landedCost, item.currency)}</span>`,
          isOrdered(item) ? '<span class="hx-pos">PO</span>' : '<span class="hx-dim">—</span>',
        ])
      );
  } catch (err) {
    if (wrap) wrap.innerHTML = _emptyMsg('Failed to load inventory.');
  }
}

// ---------------------------------------------------------------------------
// Shipment Monitoring
// ---------------------------------------------------------------------------

let _smAllRows = [];

async function _loadSmPanel() {
  const wrap = document.getElementById('smTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="ad-loading"><div class="spinner"></div></div>';
  try {
    const r = await apiGetShipments();
    _smAllRows = (r.success && r.data) ? r.data : [];
    _renderSmTable(_smAllRows);
  } catch (err) {
    wrap.innerHTML = _emptyMsg('Failed to load shipments.');
  }
}

function applySmFilter() {
  const status = (document.getElementById('smStatusFilter') || {}).value || '';
  const filtered = status
    ? _smAllRows.filter(s => (s.status || '') === status)
    : _smAllRows;
  _renderSmTable(filtered);
}

function _smBadge(status) { return hxSmBadge(status); }

function _smStageDots(row) {
  let stages = {}, docs = {};
  try { stages = JSON.parse(row.stages    || '{}'); } catch(e) {}
  try { docs   = JSON.parse(row.documents || '{}'); } catch(e) {}

  // A stage counts as done if stages JSON says done/skipped, OR it has documents (legacy fallback)
  const stDone = key => {
    const st = stages[key] || {};
    if (st.status === 'done' || st.status === 'skipped') return st.status;
    if ((docs[key] || []).length > 0) return 'done';
    return 'pending';
  };

  let totalDone = 0;
  const dots = _SM_PHASES.map((phase, pi) => {
    const done    = phase.stages.filter(k => stDone(k) === 'done').length;
    const skipped = phase.stages.filter(k => stDone(k) === 'skipped').length;
    totalDone += done;
    const complete = (done + skipped) === phase.stages.length;
    const partial  = (done + skipped) > 0;
    const cls = complete ? 'done' : partial ? 'partial' : '';
    return `<i class="${cls}" title="Phase ${pi+1}: ${phase.name} (${done}/${phase.stages.length})"></i>`;
  }).join('');

  // Classed dots; css/shipments.css paints them.
  return `<div class="sm-dots">${dots}</div><div class="sm-dots-n">${totalDone}/${_SM_LIFECYCLE_STAGES.length}</div>`;
}

function _renderSmTable(rows) {
  const wrap = document.getElementById('smTableWrap');
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = _emptyMsg('No shipments found.');
    return;
  }
  const slice = rows.slice(0, 50);
  const ths = ['Shipment ID','PO #','Client','Mode','ETD','ETA','Status','Stages','Actions'].map(h => `<th>${h}</th>`).join('');
  const trs = slice.map(s => {
    const idx = _smAllRows.indexOf(s);
    return `<tr>
      <td><span class="ref">${esc(s.shipmentId || '—')}</span></td>
      <td><span class="ref">${esc(s.poNo || '—')}</span></td>
      <td>${esc(s.client || '—')}</td>
      <td>${s.mode ? `<span class="sbadge sbadge-default">${esc(s.mode)}</span>` : '<span class="hx-dim">—</span>'}</td>
      <td>${esc(s.etd || '—')}</td>
      <td>${esc(s.eta || '—')}</td>
      <td>${_smBadge(s.status || 'Pending')}</td>
      <td>${_smStageDots(s)}</td>
      <td><span class="sm-act">
        <button type="button" onclick="openSmTimeline(${JSON.stringify(idx)})">Timeline</button>
        <button type="button" onclick="openSmModal(${JSON.stringify(idx)})">Edit</button>
      </span></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="task-tbl"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function _smDateVal(str) {
  if (!str) return '';
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

let _smPendingSOs = [];   // cache of pending SOs for the picker

async function openSmModal(idx) {
  const s = _smAllRows[idx];
  if (!s) return;
  document.getElementById('smEditId').value       = s.shipmentId || '';
  document.getElementById('smEditPoNo').value     = s.poNo || '';
  document.getElementById('smEditClient').value   = s.client || '';
  document.getElementById('smEditSubtitle').textContent = `${s.shipmentId || 'New'} · PO ${s.poNo || '—'} · ${s.client || '—'}`;
  document.getElementById('smEditStatus').value       = s.status || 'Pending';
  document.getElementById('smEditMode').value         = s.mode || '';
  document.getElementById('smEditClientsPO').value    = s.clientsPO || '';
  document.getElementById('smEditHiPO').value         = s.hiescorpPO || '';
  document.getElementById('smEditPrincipal').value    = s.principal || '';
  document.getElementById('smEditItem').value         = s.item || '';
  document.getElementById('smEditShipmentDate').value = _smDateVal(s.shipmentDate);
  document.getElementById('smEditETD').value          = _smDateVal(s.etd);
  document.getElementById('smEditETA').value          = _smDateVal(s.eta);
  document.getElementById('smEditAWB').value          = s.awb || '';
  document.getElementById('smEditLogistics').value    = s.logistics || '';
  document.getElementById('smEditDateArrived').value  = _smDateVal(s.dateArrived);
  document.getElementById('smEditSalesInvoice').value    = s.salesInvoice || '';
  document.getElementById('smEditTotalAmount').value  = s.totalAmount || '';
  document.getElementById('smEditAmountPaid').value   = s.amountPaid || '';
  document.getElementById('smEditDatePayment').value  = _smDateVal(s.dateOfPayment);
  document.getElementById('smEditPaymentStatus').value  = s.paymentStatus || '';
  document.getElementById('smEditPaymentMethod').value  = s.paymentMethod || '';
  document.getElementById('smEditDeliveryReceipt').value = s.deliveryReceipt || '';
  document.getElementById('smEditRemarks').value      = s.remarks || '';
  document.getElementById('smEditMsg').textContent    = '';

  // Store current index so "View Timeline" button inside the edit modal can open it
  _smTlShipmentIdx = idx;

  // Parse already-linked SOs
  const linked = (s.linkedSOs || '').split(',').map(x => x.trim()).filter(Boolean);
  const isStocking = linked.length === 1 && linked[0] === 'FOR_STOCKING';
  document.getElementById('smEditForStocking').checked = isStocking;

  // Load pending SOs into the picker
  await _loadSmSoPicker(linked, isStocking);

  document.getElementById('smEditOverlay').style.display = '';
}

async function _loadSmSoPicker(preSelected, isStocking) {
  const listEl   = document.getElementById('smSoCheckList');
  const pickerWrap = document.getElementById('smSoPickerWrap');
  listEl.innerHTML = '<div class="sm-picker-empty">Loading…</div>';

  try {
    if (!_smPendingSOs.length) {
      const r = await apiGetSalesOrders('Pending');
      // Deduplicate by soNo (SO has multiple rows per item)
      const seen = {};
      (r.success && r.data ? r.data : []).forEach(so => {
        if (so.soNo && !seen[so.soNo]) {
          seen[so.soNo] = true;
          _smPendingSOs.push({ soNo: so.soNo, customerName: so.customerName || so.customerId || '—' });
        }
      });
    }
  } catch (e) { /* ignore */ }

  pickerWrap.style.opacity = isStocking ? '0.4' : '1';
  pickerWrap.style.pointerEvents = isStocking ? 'none' : '';
  document.getElementById('smSoSearch').value = '';

  _smRenderSoChecks(_smPendingSOs, preSelected);
}

function _smRenderSoChecks(sos, preSelected) {
  const listEl = document.getElementById('smSoCheckList');
  if (!sos.length) {
    listEl.innerHTML = '<div class="sm-picker-empty">No pending sales orders found.</div>';
    _smUpdateChips();
    return;
  }
  listEl.innerHTML = sos.map(so => {
    const checked = preSelected && preSelected.includes(so.soNo) ? 'checked' : '';
    return `<label>
      <input type="checkbox" class="sm-so-cb" value="${esc(so.soNo)}" ${checked} onchange="_smUpdateChips()">
      <b>${esc(so.soNo)}</b>
      <span>${esc(so.customerName)}</span>
    </label>`;
  }).join('');
  _smUpdateChips();
}

function smFilterSOs() {
  const q = (document.getElementById('smSoSearch').value || '').toLowerCase();
  const filtered = q
    ? _smPendingSOs.filter(s => s.soNo.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q))
    : _smPendingSOs;
  // Preserve current checked state
  const checked = Array.from(document.querySelectorAll('.sm-so-cb:checked')).map(cb => cb.value);
  _smRenderSoChecks(filtered, checked);
}

function _smUpdateChips() {
  const checked = Array.from(document.querySelectorAll('.sm-so-cb:checked')).map(cb => cb.value);
  const chips = document.getElementById('smSoChips');
  if (!chips) return;
  chips.innerHTML = checked.map(soNo =>
    `<span class="sm-chip">
      ${esc(soNo)}
      <span onclick="smRemoveSO('${esc(soNo)}')" title="Remove">×</span>
    </span>`
  ).join('');
}

function smRemoveSO(soNo) {
  const cb = document.querySelector(`.sm-so-cb[value="${CSS.escape(soNo)}"]`);
  if (cb) { cb.checked = false; _smUpdateChips(); }
}

function smToggleStocking(chk) {
  const pickerWrap = document.getElementById('smSoPickerWrap');
  pickerWrap.style.opacity      = chk.checked ? '0.4' : '1';
  pickerWrap.style.pointerEvents = chk.checked ? 'none' : '';
  if (chk.checked) {
    document.querySelectorAll('.sm-so-cb:checked').forEach(cb => { cb.checked = false; });
    _smUpdateChips();
  }
}

function _smGetLinkedSOs() {
  if (document.getElementById('smEditForStocking').checked) return 'FOR_STOCKING';
  const checked = Array.from(document.querySelectorAll('.sm-so-cb:checked')).map(cb => cb.value);
  return checked.join(',');
}

function closeSmModal() {
  document.getElementById('smEditOverlay').style.display = 'none';
  _smPendingSOs = [];  // clear cache so next open re-fetches
  _smModalSwitchTab('details'); // reset to Details tab
}

async function saveSmEdit() {
  const msg = document.getElementById('smEditMsg');
  msg.textContent = 'Saving…';
  try {
    const payload = {
      shipmentId:      document.getElementById('smEditId').value,
      poNo:            document.getElementById('smEditPoNo').value,
      client:          document.getElementById('smEditClient').value,
      status:          document.getElementById('smEditStatus').value,
      mode:            document.getElementById('smEditMode').value,
      clientsPO:       document.getElementById('smEditClientsPO').value,
      hiescorpPO:      document.getElementById('smEditHiPO').value,
      principal:       document.getElementById('smEditPrincipal').value,
      item:            document.getElementById('smEditItem').value,
      shipmentDate:    document.getElementById('smEditShipmentDate').value,
      etd:             document.getElementById('smEditETD').value,
      eta:             document.getElementById('smEditETA').value,
      awb:             document.getElementById('smEditAWB').value,
      logistics:       document.getElementById('smEditLogistics').value,
      dateArrived:     document.getElementById('smEditDateArrived').value,
      salesInvoice:    document.getElementById('smEditSalesInvoice').value,
      totalAmount:     document.getElementById('smEditTotalAmount').value,
      amountPaid:      document.getElementById('smEditAmountPaid').value,
      dateOfPayment:   document.getElementById('smEditDatePayment').value,
      paymentStatus:   document.getElementById('smEditPaymentStatus').value,
      paymentMethod:   document.getElementById('smEditPaymentMethod').value,
      deliveryReceipt: document.getElementById('smEditDeliveryReceipt').value,
      remarks:         document.getElementById('smEditRemarks').value,
      linkedSOs:       _smGetLinkedSOs(),
    };
    const r = await apiSaveShipment(payload);
    if (r && r.success) {
      msg.style.color = 'var(--hx-ok)';
      msg.textContent = 'Saved!';
      setTimeout(() => {
        closeSmModal();
        // Refresh the shipment panel
        _taskLoaded['sm'] = false;
        _smAllRows = [];
        _loadSmPanel();
      }, 700);
    } else {
      msg.style.color = 'var(--hx-red)';
      msg.textContent = r.message || 'Save failed.';
    }
  } catch (err) {
    msg.style.color = 'var(--hx-red)';
    msg.textContent = 'Error: ' + err.message;
  }
}

// ---------------------------------------------------------------------------
// Shipment Documents
// ---------------------------------------------------------------------------

function smViewDoc(previewUrl, driveUrl, name) {
  document.getElementById('smPdfTitle').textContent   = name || 'Document';
  document.getElementById('smPdfOpenLink').href       = driveUrl || '#';
  document.getElementById('smPdfFrame').src           = previewUrl || '';
  const overlay = document.getElementById('smPdfOverlay');
  overlay.style.display = 'flex';
}

function smClosePdf() {
  document.getElementById('smPdfOverlay').style.display = 'none';
  document.getElementById('smPdfFrame').src = '';
}

function _smFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Shipment Lifecycle Timeline Modal
// ---------------------------------------------------------------------------
// Constants (_SM_LIFECYCLE_STAGES, _SM_PHASES, _SM_OWNER_ROLES,
// _SM_OWNER_BADGE_CLASS, _SM_PHASE_ICONS) are defined in stage-meta.js
// which is loaded before this file.

let _smTlData         = null;
let _smTlCurrentStage = '';    // which stage row is expanded
let _smTlShipmentIdx  = -1;
let _smTlOpenPhases   = new Set(); // which phase indices are expanded

// ── Open / Close ─────────────────────────────────────────────

async function openSmTimeline(idx) {
  const s = _smAllRows[idx];
  if (!s) return;
  _smTlShipmentIdx  = idx;
  _smTlData         = null;
  _smTlCurrentStage = '';

  const overlay = document.getElementById('smTlOverlay');
  overlay.style.display = '';
  document.getElementById('smTlContent').innerHTML = '<div style="padding:3rem;text-align:center;"><div class="spinner"></div></div>';
  document.getElementById('smTlRibbon').innerHTML  = '<div style="height:52px;"></div>';
  document.getElementById('smTlHeader').textContent   = s.shipmentId || '—';
  document.getElementById('smTlSubtitle').textContent = `PO ${s.poNo || '—'} · ${s.client || '—'}`;
  document.getElementById('smTlStatusBadge').innerHTML = _smBadge(s.status || 'Pending');

  try {
    const r = await fetchFromAPI({ action: 'getShipmentTimeline', shipmentId: s.shipmentId });
    if (r && r.success) {
      _smTlData = r;
      // Default: expand the phase that contains the first pending stage
      _smTlOpenPhases = new Set();
      const apiMap = {};
      r.timeline.forEach(st => { apiMap[st.key] = st; });
      let activated = false;
      for (let pi = 0; pi < _SM_PHASES.length; pi++) {
        const hasPending = _SM_PHASES[pi].stages.some(k => !['done','skipped'].includes((apiMap[k] || {}).status));
        if (hasPending) { _smTlOpenPhases.add(pi); activated = true; break; }
      }
      if (!activated) _smTlOpenPhases.add(_SM_PHASES.length - 1);
      _smTlRender();
    } else {
      document.getElementById('smTlContent').innerHTML = `<div style="padding:2rem;text-align:center;color:var(--hx-red);">${esc(r.message || 'Failed to load.')}</div>`;
    }
  } catch (err) {
    document.getElementById('smTlContent').innerHTML = `<div style="padding:2rem;text-align:center;color:var(--hx-red);">Error: ${esc(err.message)}</div>`;
  }
}

function closeSmTimeline() {
  document.getElementById('smTlOverlay').style.display = 'none';
  _smTlData = null; _smTlCurrentStage = ''; _smTlOpenPhases = new Set();
}

// ── Render ───────────────────────────────────────────────────

function _smTlRender() {
  if (!_smTlData || !_smTlData.timeline) return;

  const apiMap = {};
  _smTlData.timeline.forEach(st => { apiMap[st.key] = st; });

  // Find first pending stage (for 'next' highlight and next-up card)
  let nextKey = null;
  for (const def of _SM_LIFECYCLE_STAGES) {
    if (!['done','skipped'].includes((apiMap[def.key] || {}).status)) { nextKey = def.key; break; }
  }

  // ── Phase ribbon ──────────────────────────────────────────
  document.getElementById('smTlRibbon').innerHTML = _smTlRenderRibbon(apiMap);

  // ── Content: next-up card + phase list ───────────────────
  let html = _smTlRenderNextUp(apiMap, nextKey);

  _SM_PHASES.forEach((phase, pi) => {
    const phaseDefs    = _SM_LIFECYCLE_STAGES.filter(def => phase.stages.includes(def.key));
    const phaseDone    = phaseDefs.filter(def => (apiMap[def.key] || {}).status === 'done').length;
    const phaseSkipped = phaseDefs.filter(def => (apiMap[def.key] || {}).status === 'skipped').length;
    const phaseTotal   = phaseDefs.length;
    const allComplete  = (phaseDone + phaseSkipped) === phaseTotal;
    const anyDone      = (phaseDone + phaseSkipped) > 0;
    const isOpen       = _smTlOpenPhases.has(pi);

    const hdrState  = allComplete ? 'done' : isOpen ? 'open' : anyDone ? 'partial' : 'pending';
    const cntColor  = allComplete ? 'var(--hx-ok)' : anyDone ? 'var(--hx-warn)' : 'var(--hx-ink-3)';
    const lblColor  = allComplete ? 'var(--hx-ink)' : 'var(--hx-ink-2)';
    const numBg     = allComplete ? 'var(--hx-ok-soft)' : 'var(--hx-inset)';
    const numBorder = allComplete ? 'var(--hx-ok-line)' : 'var(--hx-hair)';

    html += `<div class="sm-tl-phase-wrap" id="smTlPhase${pi}">
      <div class="sm-tl-phase-hdr ${hdrState}" onclick="smTlTogglePhase(${pi})"
           role="button" tabindex="0" aria-expanded="${isOpen}"
           aria-label="Phase ${pi+1}: ${esc(phase.name)}, ${phaseDone}/${phaseTotal} complete"
           onkeydown="if(event.key==='Enter'||event.key===' ')smTlTogglePhase(${pi})">
        <div class="sm-tl-phase-left">
          <div class="sm-tl-phase-num" style="background:${numBg};color:${cntColor};border:1px solid ${numBorder};">
            ${allComplete ? '✓' : _SM_PHASE_ICONS[pi]}
          </div>
          <span class="sm-tl-phase-name" style="color:${lblColor};">Phase ${pi + 1}: ${esc(phase.name)}</span>
        </div>
        <div class="sm-tl-phase-right">
          <span class="sm-tl-phase-cnt" style="color:${cntColor};">${phaseDone}/${phaseTotal}</span>
          <span class="sm-tl-phase-chevron">${isOpen ? '▾' : '▸'}</span>
        </div>
      </div>`;

    if (isOpen) {
      const bodyState = allComplete ? 'done' : anyDone ? 'partial' : '';
      html += `<div class="sm-tl-phase-body ${bodyState}">`;
      phaseDefs.forEach((def, si) => {
        html += _smTlRenderStageRow(def, apiMap[def.key] || { status: 'pending', docs: [] }, nextKey, apiMap);
      });
      html += '</div>';
    }

    html += '</div>';
  });

  document.getElementById('smTlContent').innerHTML = html;
}

function smTlTogglePhase(pi) {
  if (_smTlOpenPhases.has(pi)) _smTlOpenPhases.delete(pi); else _smTlOpenPhases.add(pi);
  _smTlRender();
}

function smTlScrollToPhase(pi) {
  // Open the phase if not open, then scroll to it
  _smTlOpenPhases.add(pi);
  _smTlRender();
  const el = document.getElementById('smTlPhase' + pi);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function smTlToggleStage(key) {
  _smTlCurrentStage = (_smTlCurrentStage === key) ? '' : key;
  _smTlRender();
}

// ── Phase Ribbon ─────────────────────────────────────────────

function _smTlRenderRibbon(apiMap) {
  const total    = _SM_LIFECYCLE_STAGES.length;
  const totalDone = _SM_LIFECYCLE_STAGES.filter(d => ['done','skipped'].includes((apiMap[d.key]||{}).status)).length;

  let html = '<div class="sm-tl-ribbon" role="tablist">';
  _SM_PHASES.forEach((phase, pi) => {
    const defs    = _SM_LIFECYCLE_STAGES.filter(d => phase.stages.includes(d.key));
    const done    = defs.filter(d => ['done','skipped'].includes((apiMap[d.key]||{}).status)).length;
    const allDone = done === defs.length;
    const partial = done > 0 && !allDone;
    const pct     = Math.round(done / defs.length * 100);
    const cls     = allDone ? 'done' : partial ? 'partial' : '';
    html += `<button class="sm-tl-ribbon-seg ${cls}" onclick="smTlScrollToPhase(${pi})"
      role="tab" tabindex="0"
      aria-label="Phase ${pi+1}: ${esc(phase.name)}, ${done} of ${defs.length} complete"
      title="Phase ${pi+1}: ${esc(phase.name)} — ${done}/${defs.length}">
      <div class="sm-tl-ribbon-fill" style="width:${pct}%"></div>
      <span class="sm-tl-ribbon-icon">${_SM_PHASE_ICONS[pi]}</span>
      <span class="sm-tl-ribbon-label">${esc(phase.name)}</span>
      <span class="sm-tl-ribbon-count">${done}/${defs.length}</span>
    </button>`;
  });
  html += '</div>';
  html += `<div class="sm-tl-ribbon-overall">${totalDone} / ${total} stages complete</div>`;
  return html;
}

// ── Next-Up Callout Card ──────────────────────────────────────

function _smTlRenderNextUp(apiMap, nextKey) {
  if (!nextKey) {
    return `<div class="sm-tl-next-up done">
      <div class="sm-tl-next-up-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="sm-tl-next-up-body">
        <div class="sm-tl-next-up-kicker">All complete</div>
        <div class="sm-tl-next-up-stage"><strong>All ${_SM_LIFECYCLE_STAGES.length} stages done!</strong></div>
        <div class="sm-tl-next-up-sub">This shipment has completed all lifecycle stages.</div>
      </div>
    </div>`;
  }

  const def  = _SM_LIFECYCLE_STAGES.find(d => d.key === nextKey);
  if (!def) return '';

  const meta     = (typeof _SM_STAGE_META !== 'undefined' && _SM_STAGE_META[nextKey]) || {};
  const requires = meta.requires || [];
  const blocked  = requires.some(rk => !['done','skipped'].includes((apiMap[rk]||{}).status));

  const phaseIdx = _SM_PHASES.findIndex(p => p.stages.includes(nextKey));
  const phaseLabel = phaseIdx >= 0 ? `Phase ${phaseIdx+1}: ${_SM_PHASES[phaseIdx].name}` : '';
  const ownerCls = _SM_OWNER_BADGE_CLASS[def.owner] || 'sm-owner-admin';

  const icon = blocked
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  const cls  = blocked ? 'blocked' : '';
  const kicker = blocked ? 'Waiting on prerequisites' : 'Next up';

  return `<div class="sm-tl-next-up ${cls}" role="status">
    <div class="sm-tl-next-up-icon">${icon}</div>
    <div class="sm-tl-next-up-body">
      <div class="sm-tl-next-up-kicker">${kicker}</div>
      <div class="sm-tl-next-up-stage">
        <strong>${esc(def.label)}</strong>
        <span class="sm-owner-badge ${ownerCls}">${esc(def.owner)}</span>
        ${def.autoDerive ? '<span class="auto-badge">AUTO</span>' : ''}
      </div>
      <div class="sm-tl-next-up-sub">${phaseLabel}${blocked ? ' — complete the required stages below first (advisory)' : ''}</div>
    </div>
  </div>`;
}

// ── Stage Card Row ────────────────────────────────────────────

function _smTlRenderStageRow(def, apiStage, nextKey, apiMap) {
  const status     = apiStage.status || 'pending';
  const isAuto     = apiStage.autoderived || false;
  const docs       = apiStage.docs || [];
  const isOpen     = _smTlCurrentStage === def.key;
  const globalIdx  = _SM_LIFECYCLE_STAGES.indexOf(def);

  // Determine card visual state
  const meta     = (typeof _SM_STAGE_META !== 'undefined' && _SM_STAGE_META[def.key]) || {};
  const requires = meta.requires || [];
  const isBlocked = status === 'pending' && requires.some(rk => !['done','skipped'].includes((apiMap[rk]||{}).status));
  const isNext    = def.key === nextKey;

  let cardState, dotState;
  if (status === 'done')    { cardState = 'done';    dotState = 'done';    }
  else if (status === 'skipped') { cardState = 'skipped'; dotState = 'skipped'; }
  else if (isBlocked)       { cardState = 'blocked'; dotState = 'blocked'; }
  else if (isNext)          { cardState = 'next';    dotState = 'next';    }
  else                       { cardState = 'pending'; dotState = 'pending'; }

  const dotContent = status === 'done' ? '✓' : status === 'skipped' ? '–' : isBlocked ? '!' : (globalIdx + 1);

  const dateNote   = status !== 'pending' && apiStage.completedAt
    ? `${esc(apiStage.completedAt)}${apiStage.completedBy ? ' · ' + esc(apiStage.completedBy) : ''}` : '';
  const skipReason = status === 'skipped' && apiStage.skippedReason ? apiStage.skippedReason : '';
  const ownerCls   = _SM_OWNER_BADGE_CLASS[def.owner] || 'sm-owner-admin';

  return `<div class="sm-tl-card ${cardState}${isOpen ? ' open' : ''}" id="smCard_${def.key}">
    <div class="sm-tl-card-hdr" onclick="smTlToggleStage('${def.key}')"
         role="button" tabindex="0" aria-expanded="${isOpen}"
         aria-label="${esc(def.label)}, ${status}"
         onkeydown="if(event.key==='Enter'||event.key===' ')smTlToggleStage('${def.key}')">
      <div class="sm-tl-card-dot ${dotState}">${dotContent}</div>
      <div class="sm-tl-card-main">
        <div class="sm-tl-card-label">${esc(def.label)}</div>
        <div class="sm-tl-card-meta">
          <span class="sm-owner-badge ${ownerCls}">${esc(def.owner)}</span>
          ${isAuto ? '<span class="auto-badge">AUTO</span>' : ''}
          ${skipReason ? `<span style="color:var(--hx-warn);font-style:italic;font-size:0.64rem;">– ${esc(skipReason)}</span>` : ''}
        </div>
        ${dateNote ? `<div class="sm-tl-card-date">${dateNote}</div>` : ''}
      </div>
      <div class="sm-tl-card-right">
        ${docs.length > 0 ? `<span class="doc-badge">${docs.length}</span>` : ''}
        ${isBlocked ? '<span class="blocked-icon" title="Prerequisites not yet met (advisory)">⚠</span>' : ''}
        <span style="font-size:0.7rem;color:var(--hx-ink-3);">${isOpen ? '▾' : '▸'}</span>
      </div>
    </div>
    ${isOpen ? `<div class="sm-tl-detail">${_smTlStageDetail(def, apiStage, apiMap)}</div>` : ''}
  </div>`;
}

// ── Stage Detail Panel (6 sections) ──────────────────────────

function _smTlStageDetail(def, apiStage, apiMap) {
  const status = apiStage.status || 'pending';
  const docs   = apiStage.docs   || [];
  const isAuto = apiStage.autoderived || false;
  const meta   = (typeof _SM_STAGE_META !== 'undefined' && _SM_STAGE_META[def.key]) || {};
  /* A325 — getShipmentTimeline's shipment carries only a dozen header fields; the payment, logistics
     and cost fields the stages list live on the getShipments row. Lay that row underneath (the
     timeline's own, fresher values win) or they all read "— not yet set —". */
  const tlShip = (_smTlData && _smTlData.shipment) || {};
  const ship   = Object.assign({}, _smAllRows.find(r => r.shipmentId === tlShip.shipmentId) || {}, tlShip);
  let html = '';

  // ── A: Description ─────────────────────────────────────
  if (meta.description) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">About this stage</div>
      <div style="font-size:0.76rem;color:var(--hx-ink-2);line-height:1.5;">${esc(meta.description)}</div>
      ${isAuto && apiStage.autoderivedNote
        ? `<div style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem;">
            <span class="auto-badge">AUTO</span>
            <span style="font-size:0.7rem;color:var(--hx-ink-3);">${esc(apiStage.autoderivedNote)}</span>
           </div>`
        : ''}
    </div>`;
  }

  // ── Auto note (if no description but has auto note) ──
  if (!meta.description && isAuto && apiStage.autoderivedNote) {
    html += `<div class="sm-tl-detail-section" style="display:flex;align-items:center;gap:0.35rem;">
      <span class="auto-badge">AUTO</span>
      <span style="font-size:0.73rem;color:var(--hx-ink-3);">${esc(apiStage.autoderivedNote)}</span>
    </div>`;
  }

  // Skip reason
  if (status === 'skipped' && apiStage.skippedReason) {
    html += `<div class="sm-tl-detail-section">
      <div style="font-size:0.76rem;color:var(--hx-warn);background:var(--hx-warn-soft);border:1px solid var(--hx-warn-line);border-radius:5px;padding:0.4rem 0.6rem;">
        <strong>Skip reason:</strong> ${esc(apiStage.skippedReason)}
      </div>
    </div>`;
  }

  // ── B: Fields ──────────────────────────────────────────
  if (meta.fields && meta.fields.length > 0) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Fields at this stage</div>
      <table class="sm-tl-fields">`;
    meta.fields.forEach(f => {
      let val = ship[f.field];
      // Also try snake_case variant
      if (val === undefined || val === null || val === '') {
        const snaked = f.field.replace(/([A-Z])/g, '_$1').toLowerCase();
        val = ship[snaked];
      }
      const hasVal = val !== undefined && val !== null && String(val).trim() !== '';
      let displayVal = hasVal ? esc(String(val)) : '';

      if (hasVal && f.format === 'currency' && !isNaN(parseFloat(val))) {
        displayVal = '₱ ' + parseFloat(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const valClass  = hasVal ? 'fv' : 'fv empty';
      const valText   = hasVal ? displayVal : '— not yet set —';
      const setNowBtn = !hasVal
        ? `<button class="sm-set-now" onclick="closeSmTimeline();openSmModal(_smTlShipmentIdx);" title="Open Edit modal to set this field">+ Set now</button>`
        : '';

      html += `<tr>
        <td class="fl">${esc(f.label)}</td>
        <td class="${valClass}">${valText}${setNowBtn}</td>
      </tr>`;
    });
    html += '</table></div>';
  }

  // ── C: Dependencies ────────────────────────────────────
  const requires = meta.requires || [];
  const unlocks  = meta.unlocks  || [];
  if (requires.length > 0 || unlocks.length > 0) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Stage dependencies <span style="font-size:0.6rem;font-weight:400;font-style:italic;text-transform:none;letter-spacing:0;">(advisory)</span></div>
      <div class="sm-dep-chips">`;

    requires.forEach(rk => {
      const rDef = _SM_LIFECYCLE_STAGES.find(d => d.key === rk);
      if (!rDef) return;
      const rSt  = (apiMap && apiMap[rk]) ? apiMap[rk].status : 'pending';
      const cls  = rSt === 'done' ? 'done' : rSt === 'skipped' ? 'skipped' : 'blocked';
      const icon = rSt === 'done' ? '✓' : rSt === 'skipped' ? '–' : '○';
      html += `<span class="sm-dep-chip ${cls}" onclick="smTlScrollToStage('${rk}')" title="Required: ${esc(rDef.label)}" tabindex="0" role="button"
               onkeydown="if(event.key==='Enter')smTlScrollToStage('${rk}')">
                 ${icon} ${esc(rDef.label)}
               </span>`;
    });

    if (unlocks.length > 0) {
      if (requires.length > 0) html += `<span style="font-size:0.65rem;color:var(--hx-ink-3);align-self:center;">→ unlocks:</span>`;
      unlocks.forEach(uk => {
        const uDef = _SM_LIFECYCLE_STAGES.find(d => d.key === uk);
        if (!uDef) return;
        const uSt  = (apiMap && apiMap[uk]) ? apiMap[uk].status : 'pending';
        const cls  = uSt === 'done' ? 'done' : uSt === 'skipped' ? 'skipped' : '';
        html += `<span class="sm-dep-chip ${cls}" onclick="smTlScrollToStage('${uk}')" title="Unlocks: ${esc(uDef.label)}" tabindex="0" role="button"
                 onkeydown="if(event.key==='Enter')smTlScrollToStage('${uk}')">
                   ↓ ${esc(uDef.label)}
                 </span>`;
      });
    }

    html += '</div></div>';
  }

  // ── D: Documents ──────────────────────────────────────
  html += `<div class="sm-tl-detail-section">
    <div class="sm-tl-section-label">Documents</div>`;

  if (docs.length) {
    html += '<div>';
    // A325 — onclick args are JSON strings, then HTML-escaped. The browser decodes &#39; back to '
    // before the handler runs, so a file named "Client's PO.pdf" used to end the string: dead button.
    docs.forEach(f => {
      html += `<div class="sm-doc-file">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="sm-doc-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <button class="sm-tl-btn" onclick="smViewDoc(${esc(JSON.stringify(String(f.previewUrl || '')))},${esc(JSON.stringify(String(f.url || '')))},${esc(JSON.stringify(String(f.name || '')))})"
          style="background:var(--hx-navy-soft);border-color:var(--hx-navy-line);color:var(--hx-navy-text);font-weight:400;" aria-label="View ${esc(f.name)}">View</button>
        <button class="sm-tl-btn" onclick="smTlDeleteDoc(${esc(JSON.stringify(String(f.fileId || '')))},'${def.key}',${esc(JSON.stringify(String(f.name || '')))})"
          style="background:var(--hx-red-soft);border-color:var(--hx-red-line);color:var(--hx-red);font-weight:400;" aria-label="Remove ${esc(f.name)}">×</button>
      </div>`;
    });
    html += '</div>';
  } else if (def.docLabel) {
    html += `<div style="font-size:0.73rem;color:var(--hx-ink-3);font-style:italic;">Expected: ${esc(def.docLabel)}</div>`;
  } else {
    html += `<div style="font-size:0.73rem;color:var(--hx-ink-3);">No documents attached.</div>`;
  }

  if (docs.length < 5) {
    html += `<label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;padding:0.3rem 0.6rem;border:1px dashed var(--hx-navy-line);border-radius:5px;background:var(--hx-navy-soft);margin-top:0.4rem;" tabindex="0" role="button">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span style="font-size:0.73rem;color:var(--hx-navy-text);">Upload document <span style="color:var(--hx-ink-3);font-weight:400;">(${5 - docs.length} slot${docs.length === 4 ? '' : 's'} left)</span></span>
      <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" style="display:none;" onchange="smTlUploadDoc(this,'${def.key}')" aria-label="Upload document for ${esc(def.label)}">
    </label>`;
  } else {
    html += `<div style="font-size:0.72rem;color:var(--hx-ink-3);margin-top:0.4rem;">Max 5 files reached.</div>`;
  }
  html += '</div>';

  // ── E: Activity / completion log ──────────────────────
  if (status !== 'pending') {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Activity</div>
      <div style="font-size:0.73rem;color:var(--hx-ink-2);line-height:1.55;">`;
    if (apiStage.completedAt || apiStage.completedBy) {
      const verb = status === 'skipped' ? 'Skipped' : 'Completed';
      html += `<div>• ${verb}${apiStage.completedAt ? ' on <strong>' + esc(apiStage.completedAt) + '</strong>' : ''}${apiStage.completedBy ? ' by <strong>' + esc(apiStage.completedBy) + '</strong>' : ''}</div>`;
    }
    if (apiStage.notes) {
      html += `<div style="margin-top:0.25rem;padding:0.35rem 0.5rem;background:var(--hx-inset);border-radius:4px;border:1px solid var(--hx-hair);">
        ${esc(apiStage.notes)}
      </div>`;
    }
    html += '</div></div>';
  }

  // ── F: Actions ──────────────────────────────────────────
  const session    = requireAdmin();
  const userRole   = session ? (session.role || '') : '';
  const ownerRoles = _SM_OWNER_ROLES[def.owner] || [];
  const needsWarn  = ownerRoles.length > 0 && !ownerRoles.includes(userRole);
  const warnTitle  = needsWarn ? ` title="This stage is normally handled by ${esc(def.owner)}. You can still proceed."` : '';

  html += `<div class="sm-tl-detail-section">
    <div class="sm-tl-section-label">Actions</div>
    <div class="sm-tl-actions">`;
  if (status !== 'done')
    html += `<button class="sm-tl-btn done-btn" onclick="smTlMarkStage('${def.key}','done')"${warnTitle} aria-label="Mark ${esc(def.label)} done">✓ Mark Done</button>`;
  if (status !== 'skipped')
    html += `<button class="sm-tl-btn skip-btn" onclick="smTlSkipStage('${def.key}')"${warnTitle} aria-label="Skip ${esc(def.label)}">– Skip</button>`;
  if (status !== 'pending')
    html += `<button class="sm-tl-btn reset-btn" onclick="smTlMarkStage('${def.key}','pending')" aria-label="Reset ${esc(def.label)}">↺ Reset</button>`;
  if (needsWarn)
    html += `<span style="font-size:0.68rem;color:var(--hx-ink-3);align-self:center;">— owned by ${esc(def.owner)}</span>`;
  html += '</div></div>';

  return html;
}

// ── Scroll to a stage (opens its phase if collapsed) ─────────

function smTlScrollToStage(key) {
  const phaseIdx = _SM_PHASES.findIndex(p => p.stages.includes(key));
  if (phaseIdx >= 0) _smTlOpenPhases.add(phaseIdx);
  _smTlCurrentStage = key;
  _smTlRender();
  const el = document.getElementById('smCard_' + key);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Stage actions ─────────────────────────────────────────────

function smTlSkipStage(stageKey) {
  const reason = (prompt('Reason for skipping this stage (required, max 200 chars):') || '').trim();
  if (!reason) { alert('A reason is required to skip a stage.'); return; }
  if (reason.length > 200) { alert('Reason must be 200 characters or fewer.'); return; }

  const def       = _SM_LIFECYCLE_STAGES.find(d => d.key === stageKey);
  const session   = requireAdmin();
  const userRole  = session ? (session.role || '') : '';
  const ownerRoles = _SM_OWNER_ROLES[def ? def.owner : ''] || [];
  const needsWarn  = ownerRoles.length > 0 && !ownerRoles.includes(userRole);
  if (needsWarn && !confirm(`This stage is normally handled by ${def.owner}. Are you sure you want to skip it?`)) return;

  smTlMarkStage(stageKey, 'skipped', reason);
}

async function smTlMarkStage(stageKey, stageAction, reason) {
  if (!_smTlData || !_smTlData.shipment) return;
  const shipmentId = _smTlData.shipment.shipmentId;
  const session    = requireAdmin();

  if (stageAction !== 'skipped' && stageAction !== 'pending') {
    const def      = _SM_LIFECYCLE_STAGES.find(d => d.key === stageKey);
    const userRole = session ? (session.role || '') : '';
    const ownerRoles = _SM_OWNER_ROLES[def ? def.owner : ''] || [];
    if (ownerRoles.length > 0 && !ownerRoles.includes(userRole)) {
      if (!confirm(`This stage is normally handled by ${def.owner}. Proceed anyway?`)) return;
    }
  }

  try {
    const payload = { action: 'advanceShipmentStage', shipmentId, stageKey, stageStatus: stageAction, user: session ? session.name : '' };
    if (reason) payload.skippedReason = reason;
    const r = await fetchFromAPI(payload);
    if (r && r.success) {
      const reload = await fetchFromAPI({ action: 'getShipmentTimeline', shipmentId });
      if (reload && reload.success) { _smTlData = reload; _smTlRender(); }
    } else { alert(r.message || 'Failed to update stage.'); }
  } catch (err) { alert('Error: ' + err.message); }
}

async function smTlUploadDoc(input, stageKey) {
  if (!input.files || !input.files[0] || !_smTlData) return;
  const file = input.files[0];
  const shipmentId = _smTlData.shipment.shipmentId;
  const uploadLabel = input.closest('label');
  if (uploadLabel) uploadLabel.innerHTML = '<span style="font-size:0.73rem;color:var(--hx-ink-3);">Uploading…</span>';
  try {
    const base64 = await _smFileToBase64(file);
    const r = await apiUploadShipmentDoc(shipmentId, stageKey, file.name, base64, file.type || 'application/octet-stream');
    if (r && r.success) {
      const reload = await fetchFromAPI({ action: 'getShipmentTimeline', shipmentId });
      if (reload && reload.success) { _smTlData = reload; _smTlRender(); return; }
    } else { alert(r.message || 'Upload failed.'); }
  } catch (err) { alert('Upload error: ' + err.message); }
  _smTlRender();
  input.value = '';
}

async function smTlDeleteDoc(fileId, stageKey, fileName) {
  if (!confirm('Remove this file?') || !_smTlData) return;
  const shipmentId = _smTlData.shipment.shipmentId;
  try {
    const r = await apiDeleteShipmentDoc(shipmentId, stageKey, fileId, fileName || '');
    if (r && r.success) {
      const reload = await fetchFromAPI({ action: 'getShipmentTimeline', shipmentId });
      if (reload && reload.success) { _smTlData = reload; _smTlRender(); return; }
    } else { alert(r.message || 'Delete failed.'); }
  } catch (err) { alert('Error: ' + err.message); }
}

// ════════════════════════════════════════════════════════════
// SHIPMENT EDIT MODAL — HISTORY TAB
// ════════════════════════════════════════════════════════════

let _smEditTab        = 'details';
let _smHistoryPage    = 1;
let _smHistoryTotal   = 0;
let _smHistoryShipId  = null;
const _SM_HIST_PAGE_SIZE = 50;

function _smModalSwitchTab(tab) {
  _smEditTab = tab;
  const details = document.getElementById('smEditTabDetails');
  const history = document.getElementById('smEditTabHistory');
  const btnD    = document.getElementById('smEditTabBtnDetails');
  const btnH    = document.getElementById('smEditTabBtnHistory');
  if (!details || !history) return;
  if (tab === 'history') {
    details.style.display = 'none';
    history.style.display = 'flex';
    btnD.classList.remove('active');
    btnH.classList.add('active');
    const shipId = document.getElementById('smEditId') ? document.getElementById('smEditId').value : null;
    if (shipId && shipId !== _smHistoryShipId) {
      _smHistoryShipId = shipId;
      _smHistoryPage   = 1;
      _smHistoryLoad(1);
    }
  } else {
    history.style.display = 'none';
    details.style.display = 'block';
    btnH.classList.remove('active');
    btnD.classList.add('active');
  }
}

async function _smHistoryLoad(page) {
  const listEl  = document.getElementById('smHistoryList');
  const pagerEl = document.getElementById('smHistoryPager');
  if (!listEl) return;
  const shipId = _smHistoryShipId || (document.getElementById('smEditId') && document.getElementById('smEditId').value);
  if (!shipId) { listEl.innerHTML = '<div class="sm-hist-empty">No shipment loaded.</div>'; return; }
  _smHistoryShipId = shipId;
  _smHistoryPage   = page;
  listEl.innerHTML = '<div class="sm-hist-empty" style="padding:1.5rem 0;">Loading…</div>';
  if (pagerEl) pagerEl.style.display = 'none';
  try {
    const params = {
      action:     'getShipmentHistory',
      shipmentId: shipId,
      page:       page,
      pageSize:   _SM_HIST_PAGE_SIZE,
      hideSystem: document.getElementById('smHistHideSystem') && document.getElementById('smHistHideSystem').checked ? 'true' : 'false',
    };
    const df = document.getElementById('smHistDateFrom');
    const dt = document.getElementById('smHistDateTo');
    const et = document.getElementById('smHistEventType');
    const ac = document.getElementById('smHistActor');
    if (df && df.value) params.dateFrom    = df.value;
    if (dt && dt.value) params.dateTo      = dt.value;
    if (et && et.value) params.eventTypes  = et.value;
    if (ac && ac.value) params.actor       = ac.value.trim();
    const r = await fetchFromAPI(params);
    if (!r || !r.success) { listEl.innerHTML = '<div class="sm-hist-empty">Failed to load history.</div>'; return; }
    _smHistoryTotal = r.totalCount || 0;
    const events    = r.events || [];
    if (!events.length) {
      let html = '<div class="sm-hist-empty">No events found';
      html += (params.dateFrom || params.dateTo || params.eventTypes || params.actor) ? ' for the current filters.' : ' yet.';
      html += '</div>';
      if (r.trackingStart) html += `<div class="sm-hist-tracking-banner">History tracking began on ${_smFmtDate(r.trackingStart)}. Events before this date were not recorded.</div>`;
      listEl.innerHTML = html;
      return;
    }
    let html = '';
    events.forEach(function(ev) { html += _smHistoryRenderEvent(ev); });
    if (r.trackingStart && page === 1 && !r.hasMore) {
      html += `<div class="sm-hist-tracking-banner">History tracking began on ${_smFmtDate(r.trackingStart)}. Events before this date were not recorded.</div>`;
    }
    listEl.innerHTML = html;
    // Pager
    if (pagerEl) {
      const total     = _smHistoryTotal;
      const totalPages = Math.ceil(total / _SM_HIST_PAGE_SIZE);
      if (totalPages > 1) {
        pagerEl.style.display = 'flex';
        const prevBtn = document.getElementById('smHistPrevBtn');
        const nextBtn = document.getElementById('smHistNextBtn');
        const info    = document.getElementById('smHistPageInfo');
        if (prevBtn) prevBtn.disabled = (page <= 1);
        if (nextBtn) nextBtn.disabled = !r.hasMore;
        if (info)    info.textContent = `Page ${page} of ${totalPages} (${total} events)`;
      }
    }
  } catch (err) {
    listEl.innerHTML = `<div class="sm-hist-empty">Error: ${_esc(err.message)}</div>`;
  }
}

function _smHistoryClearFilters() {
  const df = document.getElementById('smHistDateFrom');
  const dt = document.getElementById('smHistDateTo');
  const et = document.getElementById('smHistEventType');
  const ac = document.getElementById('smHistActor');
  const hs = document.getElementById('smHistHideSystem');
  if (df) df.value = '';
  if (dt) dt.value = '';
  if (et) et.value = '';
  if (ac) ac.value = '';
  if (hs) hs.checked = true;
  _smHistoryLoad(1);
}

function _smHistoryRenderEvent(ev) {
  const cat      = ev.event_category || 'system';
  const I = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const iconMap  = {
    field: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    stage: I('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    document: I('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    lifecycle: I('<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>'),
    system: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>')
  };
  const icon     = iconMap[cat] || '•';
  const sentence = _smEventToSentence(ev);
  const rel      = _smRelativeTime(ev.event_timestamp);
  const ts       = ev.event_timestamp ? ev.event_timestamp.replace('T',' ').slice(0,16) : '';
  const actor    = ev.actor_name || ev.actor_email || '';
  let meta = `<span title="${_esc(ts)}">${_esc(rel)}</span>`;
  if (actor) meta += ` · <span class="sm-hist-actor">${_esc(actor)}</span>`;
  if (ev.source === 'auto') meta += ` · <span style="font-size:0.62rem;color:var(--hx-navy-text);">auto</span>`;
  let diffHtml = '';
  if (ev.event_type === 'FIELD_CHANGE' && (ev.old_value || ev.new_value)) {
    diffHtml = `<div class="sm-hist-diff">`;
    if (ev.old_value) diffHtml += `<span class="sm-hist-old">${_esc(ev.old_value)}</span><span class="sm-hist-arrow">→</span>`;
    if (ev.new_value) diffHtml += `<span class="sm-hist-new">${_esc(ev.new_value)}</span>`;
    diffHtml += `</div>`;
  }
  return `<div class="sm-hist-event">
    <div class="sm-hist-icon ${_esc(cat)}">${icon}</div>
    <div class="sm-hist-body">
      <div class="sm-hist-sentence">${sentence}</div>
      ${diffHtml}
      <div class="sm-hist-meta">${meta}</div>
    </div>
  </div>`;
}

const _SM_FIELD_LABELS = {
  status:            'status',
  mode:              'shipping mode',
  etd:               'ETD',
  eta:               'ETA',
  shipment_date:     'shipment date',
  awb:               'AWB / tracking number',
  logistics_company: 'logistics company',
  date_arrived:      'date arrived',
  total_amount:      'total amount',
  amount_paid:       'amount paid',
  date_of_payment:   'date of payment',
  payment_status:    'payment status',
  payment_method:    'payment method',
  sales_invoice:     'sales invoice number',
  delivery_receipt:  'delivery receipt number',
  remarks:           'remarks',
  principal:         'principal / supplier',
  item:              'item description',
  clients_po:        "client's PO number",
  hi_po:             'HI-ESCORP PO number',
  linked_sos:        'linked sales orders',
};

function _smEventToSentence(ev) {
  const who   = ev.actor_name ? `<strong>${_esc(ev.actor_name)}</strong>` : 'Someone';
  const sNum  = ev.stage_number ? ` (stage ${ev.stage_number})` : '';
  const stKey = ev.new_value || ev.field_name || '';
  switch (ev.event_type) {
    case 'SHIPMENT_CREATED':   return `${who} created this shipment`;
    case 'SHIPMENT_CLOSED':    return `${who} closed this shipment`;
    case 'SHIPMENT_ARCHIVED':  return `${who} archived this shipment`;
    case 'FIELD_CHANGE': {
      const label = _SM_FIELD_LABELS[ev.field_name] || (ev.field_name || 'a field').replace(/_/g,' ');
      if (!ev.old_value && ev.new_value) return `${who} set the ${_esc(label)} to <strong>${_esc(ev.new_value)}</strong>`;
      if (ev.old_value && !ev.new_value) return `${who} cleared the ${_esc(label)}`;
      return `${who} changed the ${_esc(label)}`;
    }
    case 'STAGE_DONE':    return `${who} marked stage${sNum} complete`;
    case 'STAGE_SKIPPED': {
      const reason = ev.context_note ? `: "${_esc(ev.context_note)}"` : '';
      return `${who} skipped stage${sNum}${reason}`;
    }
    case 'STAGE_RESET':   return `${who} reset stage${sNum} to pending`;
    case 'STAGE_NOTE':    return `${who} added a note to stage${sNum}`;
    case 'DOC_UPLOAD':    return `${who} uploaded <strong>${_esc(ev.new_value || 'a file')}</strong> to stage${sNum}`;
    case 'DOC_DELETE':    return `${who} removed <strong>${_esc(ev.old_value || 'a file')}</strong> from stage${sNum}`;
    case 'DOC_RESTORE':   return `${who} restored <strong>${_esc(ev.new_value || 'a file')}</strong> to stage${sNum}`;
    case 'AUTO_DERIVATION': return `System auto-derived stage${sNum} as <strong>${_esc(stKey)}</strong>`;
    case 'CORRECTION':    return `${who} corrected a field directly in the sheet`;
    case 'MANUAL_EDIT':   return `${who} edited the sheet directly`;
    default:              return `${who} performed ${_esc(ev.event_type || 'an action')}`;
  }
}

function _smRelativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return Math.floor(s / 60) + 'm ago';
  if (s < 86400)     return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000)   return Math.floor(s / 86400) + 'd ago';
  if (s < 31536000)  return Math.floor(s / 2592000) + 'mo ago';
  return Math.floor(s / 31536000) + 'yr ago';
}

function _smFmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }); }
  catch(_) { return iso.slice(0,10); }
}

function _esc(str) { return hxEsc(str); }

