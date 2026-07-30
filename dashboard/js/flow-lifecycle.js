/* flow-lifecycle.js — A151 unified per-SO Lifecycle Tracker.
   One place to see each Sales Order end-to-end: Pricing Request → Quotation → SO → PO →
   Payment Request → AP → Receiving → Shipment → Invoice → AR → Collection, plus every document
   and what's missing / what's next. Read-only (track + nudge). Reuses the flow-accounting join. */

let llData = {};
let llModels = [];
let llSession = null;
let llFilter = { q: '', gaps: false, nodocs: false, year: '', status: '' };
const llExpanded = {};   // soNo → getSOLifecycle result (lazy-loaded on expand)

// The business lifecycle, in order. op:true = "operational" stage a migrated/imported SO legitimately
// skips (shown grey, not a red gap); op:false = a stage every real SO should reach.
const LL_STAGES = [
  { key: 'pr',     label: 'Pricing Req',    op: true },
  { key: 'quote',  label: 'Quotation',      op: true },
  { key: 'so',     label: 'Sales Order',    op: false },
  { key: 'po',     label: 'Purchase Order', op: true },
  { key: 'payreq', label: 'Payment Req',    op: true },
  { key: 'ap',     label: 'AP Aging',       op: true },
  { key: 'recv',   label: 'Receiving',      op: false },
  { key: 'ship',   label: 'Shipment',       op: true },
  { key: 'inv',    label: 'Invoice',        op: false },
  { key: 'ar',     label: 'AR Aging',       op: false },
  { key: 'coll',   label: 'Collection',     op: false },
];

document.addEventListener('DOMContentLoaded', async () => {
  llSession = requireOversight();
  if (!llSession) return;
  renderNavbar('flow-lifecycle');
  renderFlowNav('flow-lifecycle.html');
  llSetupUI();
  await loadAll();
});

/** Admin/accounting get a one-time Setup & Backfill toolbar, gated on the v90 backend. */
async function llSetupUI() {
  const role = llSession.role;
  if (role !== 'admin' && role !== 'accounting') return;
  const card = document.getElementById('llSetupCard');
  const warn = document.getElementById('llSetupWarn');
  if (!card) return;
  card.style.display = '';
  let ok = false;
  try { ok = await flowVersionAtLeast(90); } catch (e) { ok = false; }
  ['llBtnFolder', 'llBtnShip', 'llBtnPdf', 'llBtnAr'].forEach(id => {
    const b = document.getElementById(id); if (b) b.disabled = !ok;
  });
  if (warn) warn.textContent = ok
    ? 'These are safe to re-run (idempotent). Pin your company Drive folder first so PDFs never depend on the script account, then run each backfill once.'
    : 'Available after the FlowAPI backend is updated to v90 (paste the new FlowAPI.gs and redeploy).';
}

async function llSetFolder() {
  const id = (document.getElementById('llFolderId').value || '').trim();
  const msg = document.getElementById('llSetupMsg');
  if (!id) { msg.textContent = 'Enter the folder ID first.'; msg.style.color = '#ef4444'; return; }
  msg.textContent = 'Setting…'; msg.style.color = '';
  try {
    const r = await postFlow('setFlowDriveFolder', { folderId: id });
    msg.textContent = (r && r.message) || 'Done.'; msg.style.color = r && r.success ? '#16a34a' : '#ef4444';
  } catch (e) { msg.textContent = e.message; msg.style.color = '#ef4444'; }
}

async function llBackfill(action, label) {
  const msg = document.getElementById('llSetupMsg');
  if (!confirm('Run ' + label + ' backfill now? This is idempotent (safe to re-run).')) return;
  msg.textContent = 'Running ' + label + '…'; msg.style.color = '';
  try {
    const r = await postFlow(action, {});
    msg.textContent = (r && r.message) || 'Done.'; msg.style.color = r && r.success ? '#16a34a' : '#ef4444';
    await loadAll();
  } catch (e) { msg.textContent = e.message; msg.style.color = '#ef4444'; }
}

async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading lifecycle…</span></div>';
  try {
    const [sos, quotes, prs, pos, aps, payreqs, recs, invs, ars, cols, ships] = await Promise.all([
      fetchFlow('getSalesOrders'), fetchFlow('getQuotations'), fetchFlow('getPricingRequests'),
      fetchFlow('getPurchaseOrders'), fetchFlow('getAPAging'), fetchFlow('getPaymentRequests'),
      fetchFlow('getReceiving'), fetchFlow('getInvoices'), fetchFlow('getARAging'),
      fetchFlow('getCollections'), fetchFlow('getShipments'),
    ]);
    const D = r => (r && r.data) || [];
    llData = { sos: D(sos), quotes: D(quotes), prs: D(prs), pos: D(pos), aps: D(aps),
      payreqs: D(payreqs), recs: D(recs), invs: D(invs), ars: D(ars), cols: D(cols), ships: D(ships) };
    buildModels();
    buildYearOptions();
    render();
  } catch (e) {
    c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

const _S = v => String(v == null ? '' : v);
function _isMigrated(so) {
  const by = _S(so.createdBy).toLowerCase();
  return by.indexOf('migrat') !== -1 || by.indexOf('manual (edited)') !== -1 || by.indexOf('backfill') !== -1;
}
function _year(d) { const m = _S(d).match(/(20\d\d)/); return m ? m[1] : ''; }

/** Assemble a full per-SO model joining every stage. */
function buildModels() {
  const prByNo = {}; llData.prs.forEach(p => { prByNo[_S(p.prNo)] = p; });
  llModels = llData.sos.map(so => {
    const soNo = _S(so.soNo);
    const quote = llData.quotes.find(q => _S(q.quotationNo) === _S(so.quotationNo)) || null;
    const pr = quote && quote.prNo ? (prByNo[_S(quote.prNo)] || null) : null;
    const pos = llData.pos.filter(p => _S(p.soNo) === soNo);
    const poSet = new Set(pos.map(p => _S(p.poNo)));
    const aps = llData.aps.filter(a => poSet.has(_S(a.poNo)));
    const payreqs = llData.payreqs.filter(p => _S(p.soNo) === soNo || poSet.has(_S(p.poNo)));
    const recs = llData.recs.filter(r => _S(r.soNo) === soNo || poSet.has(_S(r.poNo)));
    const invs = llData.invs.filter(v => _S(v.soNo) === soNo);
    const invSet = new Set(invs.map(v => _S(v.invNo)));
    const ars = llData.ars.filter(a => _S(a.soNo) === soNo || invSet.has(_S(a.invNo)));
    const arSet = new Set(ars.map(a => _S(a.arNo)));
    const cols = llData.cols.filter(c => _S(c.soNo) === soNo || arSet.has(_S(c.arNo)) || invSet.has(_S(c.invNo)));
    const ship = llData.ships.find(s => _S(s.soNo) === soNo) || null;

    const totalSales = invs.reduce((s, v) => s + flowNum(v.totalSales), 0);
    const totalCOGS = invs.reduce((s, v) => s + flowNum(v.totalCOGS), 0);
    const arOutstanding = ars.reduce((s, a) => s + (a.outstanding != null ? flowNum(a.outstanding) : flowNum(a.amountPHP) - flowNum(a.collectedPHP)), 0);
    const arCollected = ars.reduce((s, a) => s + flowNum(a.collectedPHP), 0);
    const apOutstanding = aps.filter(a => _S(a.status).toLowerCase() !== 'paid')
      .reduce((s, a) => s + (flowNum(a.amountPHP) - flowNum(a.paidPHP)), 0);

    const present = {
      pr: !!pr, quote: !!quote, so: true, po: pos.length > 0, payreq: payreqs.length > 0,
      ap: aps.length > 0, recv: recs.length > 0, ship: !!ship, inv: invs.length > 0,
      ar: ars.length > 0, coll: ars.length > 0 && arOutstanding <= 0.5,
    };
    const migrated = _isMigrated(so);
    // Next action = first non-present stage (skip operational stages for migrated SOs).
    let next = '';
    for (const st of LL_STAGES) {
      if (present[st.key]) continue;
      if (migrated && st.op) continue;
      next = st.label; break;
    }
    // A "gap" = a native SO missing a stage it should have reached given how far it got.
    const reachedIdx = LL_STAGES.reduce((mx, st, i) => present[st.key] ? i : mx, 0);
    let gap = false;
    if (!migrated) {
      for (let i = 0; i <= reachedIdx; i++) if (!present[LL_STAGES[i].key]) { gap = true; break; }
    }

    return { so, soNo, migrated, quote, pr, pos, aps, payreqs, recs, invs, ars, cols, ship,
      totalSales, totalCOGS, grossProfit: totalSales - totalCOGS, apOutstanding, arOutstanding, arCollected,
      present, next, gap, reachedIdx };
  });
}

function buildYearOptions() {
  const years = Array.from(new Set(llData.sos.map(s => _year(s.date)).filter(Boolean))).sort().reverse();
  const sel = document.getElementById('llYear');
  if (sel) sel.innerHTML = '<option value="">All years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function _filtered() {
  return llModels.filter(m => {
    if (llFilter.year && _year(m.so.date) !== llFilter.year) return false;
    if (llFilter.status && _S(m.so.status) !== llFilter.status) return false;
    if (llFilter.gaps && !m.gap) return false;
    if (llFilter.q) {
      const hay = [m.soNo, m.so.customer, m.so.quotationNo, ...m.pos.map(p => p.poNo)].join(' ').toLowerCase();
      if (hay.indexOf(llFilter.q) === -1) return false;
    }
    return true;
  });
}

function llApplyFilters() {
  llFilter.q = (document.getElementById('llSearch').value || '').toLowerCase().trim();
  llFilter.year = document.getElementById('llYear').value;
  llFilter.status = document.getElementById('llStatus').value;
  llFilter.gaps = document.getElementById('llGaps').checked;
  render();
}

function render() {
  const models = _filtered();
  // KPI strip (over ALL models, not the filter)
  const total = llModels.length;
  const gaps = llModels.filter(m => m.gap).length;
  const closed = llModels.filter(m => m.present.coll).length;
  const uninvoiced = llModels.filter(m => !m.present.inv).length;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('kSo', total); set('kGaps', gaps); set('kClosed', closed); set('kUninv', uninvoiced);

  const c = document.getElementById('container');
  if (!models.length) { c.innerHTML = '<p class="acc-muted">No sales orders match.</p>'; return; }
  c.innerHTML = models.map(llCard).join('');
}

function _chip(m, st) {
  const on = m.present[st.key];
  if (on) return `<span class="ll-chip ok" title="${st.label}: done">✓ ${st.label}</span>`;
  if (m.migrated && st.op) return `<span class="ll-chip na" title="${st.label}: n/a (imported record)">– ${st.label}</span>`;
  const isNext = m.next === st.label;
  return `<span class="ll-chip ${isNext ? 'next' : 'miss'}" title="${st.label}: ${isNext ? 'next step' : 'missing'}">${isNext ? '➜' : '✗'} ${st.label}</span>`;
}

function llCard(m) {
  const s = m.so;
  const strip = LL_STAGES.map(st => _chip(m, st)).join('');
  const stageLabel = m.present.coll ? 'Closed'
    : (m.next ? 'Next: ' + m.next : (m.migrated ? 'Imported record' : 'In progress'));
  return `<div class="ll-so" id="ll-${flowEsc(m.soNo)}">
    <div class="ll-head" onclick="llToggle('${flowEsc(m.soNo)}')">
      <div class="ll-head-top">
        <div><span class="lbl">Sales Order</span><span class="so-no">${flowEsc(m.soNo)}</span></div>
        <div><span class="lbl">Customer</span>${flowEsc(s.customer)}</div>
        <div><span class="lbl">Date</span>${flowDate(s.date)}</div>
        <div><span class="lbl">Sales</span>${m.totalSales ? flowMoney(m.totalSales, 'PHP') : '<span class="acc-muted">—</span>'}</div>
        <div>${m.migrated ? '<span class="ll-badge mig">Imported · financial only</span>' : flowStatusBadge(s.status)}</div>
        <div class="ll-next ${m.gap ? 'gap' : (m.present.coll ? 'done' : '')}">${flowEsc(stageLabel)}${m.gap ? ' · ⚠ gap' : ''}</div>
        <div class="acc-chevron acc-muted">▶</div>
      </div>
      <div class="ll-strip">${strip}</div>
    </div>
    <div class="ll-body" id="llbody-${flowEsc(m.soNo)}"></div>
  </div>`;
}

async function llToggle(soNo) {
  const el = document.getElementById('ll-' + soNo);
  if (!el) return;
  const open = el.classList.toggle('open');
  if (!open) return;
  const body = document.getElementById('llbody-' + soNo);
  const m = llModels.find(x => x.soNo === soNo);
  if (!m) return;
  // Financial + chain detail render immediately from the already-joined model.
  body.innerHTML = llBody(m) + '<div class="acc-sec"><h4>Documents & Timeline</h4><div id="lldt-' + flowEsc(soNo) + '" class="acc-muted">Loading documents & lifecycle timeline…</div></div>';
  // Lazily fetch the aggregate documents + full timeline (one round-trip).
  if (llExpanded[soNo]) { llRenderDT(soNo, llExpanded[soNo]); return; }
  try {
    const r = await fetchFlow('getSOLifecycle', { soNo });
    llExpanded[soNo] = r || {};
    llRenderDT(soNo, llExpanded[soNo]);
  } catch (e) {
    const dt = document.getElementById('lldt-' + soNo);
    if (dt) dt.innerHTML = '<span style="color:#ef4444;">Could not load documents/timeline: ' + flowEsc(e.message) + '</span>';
  }
}

function _line(label, val) { return `<div class="acc-muted" style="font-size:0.82rem;margin:0.2rem 0;"><strong style="color:var(--text-primary,#f1f5f9);">${label}</strong> ${val}</div>`; }

function llBody(m) {
  let h = '';
  // Origin: Pricing Request
  h += `<div class="acc-sec"><h4>Pricing Request</h4>`;
  if (m.pr) h += _line(flowEsc(m.pr.prNo), `${flowEsc(m.pr.customer)} · ${flowStatusBadge(m.pr.status)} · requested by ${flowEsc(m.pr.requestedBy)}${m.pr.pdfLink ? ` · <a href="${flowEsc(m.pr.pdfLink)}" target="_blank" class="link-btn">PDF</a>` : ''}`);
  else h += `<div class="acc-muted">No linked pricing request${m.quote ? ' (quotation created directly or legacy).' : '.'}</div>`;
  h += `</div>`;

  // Quotation
  h += `<div class="acc-sec"><h4>Quotation</h4>`;
  if (m.quote) h += _line(flowEsc(m.quote.quotationNo), `${flowDate(m.quote.date)} · ${flowStatusBadge(m.quote.status)} · ${flowMoney(flowQuotationNet(m.quote), 'PHP')}${flowQuotationDiscountTag(m.quote)}${m.quote.pdfLink ? ` · <a href="${flowEsc(m.quote.pdfLink)}" target="_blank" class="link-btn">PDF</a>` : ''}`);
  else h += `<div class="acc-muted">No source quotation linked.</div>`;
  h += `</div>`;

  // Procurement (PO → AP → Payment Request → Receiving)
  h += `<div class="acc-sec"><h4>Procurement & Payment</h4>`;
  if (!m.pos.length) h += `<div class="acc-muted">No purchase orders raised.</div>`;
  else m.pos.forEach(p => {
    h += _line(flowEsc(p.poNo), `${flowEsc(p.supplier)} · ${flowEsc(p.currency)} ${flowMoney(p.total, p.currency)} · ${flowStatusBadge(p.status)}${p.pdfLink ? ` · <a href="${flowEsc(p.pdfLink)}" target="_blank" class="link-btn">PDF</a>` : ''}`);
    const aps = m.aps.filter(a => _S(a.poNo) === _S(p.poNo));
    aps.forEach(a => h += `<div class="acc-sub acc-muted" style="font-size:0.78rem;">AP ${flowEsc(a.apNo)} · ${flowMoney(a.amountPHP, 'PHP')} · paid ${flowMoney(a.paidPHP, 'PHP')} · ${flowStatusBadge(a.status)}${a.prNo ? ` · PRF ${flowEsc(a.prNo)}` : ''}</div>`);
  });
  m.payreqs.forEach(pr => h += `<div class="acc-sub acc-muted" style="font-size:0.78rem;">Payment Request ${flowEsc(pr.prNo)} · ${flowEsc(pr.payee || pr.supplier)} · ${flowMoney(pr.amount, pr.currency)} · ${flowStatusBadge(pr.status)}${pr.pdfLink ? ` · <a href="${flowEsc(pr.pdfLink)}" target="_blank" class="link-btn">PDF</a>` : ''}</div>`);
  m.recs.forEach(r => h += `<div class="acc-sub acc-muted" style="font-size:0.78rem;">Receiving ${flowEsc(r.mrNo)} · ${flowDate(r.date)} · shipping ${flowMoney(r.totalShipping, 'PHP')}</div>`);
  h += `</div>`;

  // Sales close (Invoice → AR → Collection)
  h += `<div class="acc-sec"><h4>Invoice → Receivable → Collection</h4>`;
  if (!m.invs.length) h += `<div class="acc-muted">Not yet invoiced.</div>`;
  else m.invs.forEach(v => h += _line(flowEsc(v.invNo), `${flowDate(v.date)} · Sales ${flowMoney(v.totalSales, 'PHP')} · COGS ${flowMoney(v.totalCOGS, 'PHP')}`));
  m.ars.forEach(a => h += `<div class="acc-sub acc-muted" style="font-size:0.78rem;">AR ${flowEsc(a.arNo)} · ${flowMoney(a.amountPHP, 'PHP')} · collected ${flowMoney(a.collectedPHP, 'PHP')} · ${flowStatusBadge(a.status)} · due ${flowDate(a.dueDate)}</div>`);
  m.cols.forEach(c => h += `<div class="acc-sub acc-muted" style="font-size:0.78rem;">Collection ${flowEsc(c.collectionNo)} · ${flowDate(c.date)} · ${flowMoney(c.amount, 'PHP')}${c.method ? ' · ' + flowEsc(c.method) : ''}</div>`);
  h += `</div>`;

  // Summary
  h += `<div class="acc-sec"><h4>Summary</h4><div class="acc-summary">
    <span><small>Sales</small>${flowMoney(m.totalSales, 'PHP')}</span>
    <span><small>COGS</small>${flowMoney(m.totalCOGS, 'PHP')}</span>
    <span><small>Gross Profit</small>${flowMoney(m.grossProfit, 'PHP')}</span>
    <span><small>AP Outstanding</small>${flowMoney(m.apOutstanding, 'PHP')}</span>
    <span><small>AR Outstanding</small>${flowMoney(m.arOutstanding, 'PHP')}</span></div></div>`;
  return h;
}

/** Render the aggregate Documents panel + full 24-stage timeline (from getSOLifecycle). */
function llRenderDT(soNo, r) {
  const el = document.getElementById('lldt-' + soNo);
  if (!el) return;
  const docs = (r && r.documents) || [];
  const timeline = (r && r.timeline) || [];

  // Documents grouped by module
  let dh = '';
  if (!docs.length) dh = '<div class="acc-muted">No documents attached anywhere on this order\'s chain. <span style="color:#f59e0b;">⚠ Attach supporting documents at each step to keep the record complete.</span></div>';
  else {
    const byMod = {};
    docs.forEach(d => { (byMod[d.module] = byMod[d.module] || []).push(d); });
    dh = '<div class="ll-docs">' + Object.keys(byMod).map(mod =>
      `<div class="ll-docmod"><div class="ll-docmod-h">${flowEsc(mod)} <span class="acc-muted">(${byMod[mod].length})</span></div>` +
      byMod[mod].map(d => `<a href="${flowEsc(d.link)}" target="_blank" class="ll-doclink">📄 ${flowEsc(d.docType || d.fileName || 'document')}</a>`).join('') +
      `</div>`).join('') + '</div>';
  }

  // Timeline grouped by phase
  let th = '';
  if (!timeline.length) th = '<div class="acc-muted">No lifecycle timeline yet — run "Backfill lifecycle rows" (admin) so imported orders get one.</div>';
  else {
    const stByKey = {}; timeline.forEach(t => { stByKey[t.key] = t; });
    th = '<div class="ll-tl">' + _SM_PHASES.map(ph => {
      const rows = ph.stages.map(k => {
        const meta = _SM_LIFECYCLE_STAGES.find(x => x.key === k) || { label: k };
        const t = stByKey[k] || { status: 'pending', autoderived: false };
        const dot = t.status === 'done' ? '✓' : (t.status === 'skipped' ? '»' : '○');
        const cls = t.status === 'done' ? 'done' : (t.status === 'skipped' ? 'skip' : 'todo');
        return `<div class="ll-tlrow ${cls}"><span class="dot">${dot}</span><span class="lab">${flowEsc(meta.label)}</span>${t.autoderived ? '<span class="auto">auto</span>' : ''}</div>`;
      }).join('');
      return `<div class="ll-tlphase"><div class="ll-tlphase-h">${flowEsc(ph.name)}</div>${rows}</div>`;
    }).join('') + '</div>';
  }

  el.innerHTML = `<div class="ll-dt"><div><div class="ll-subh">Attached documents (whole chain)</div>${dh}</div>
    <div><div class="ll-subh">Lifecycle timeline</div>${th}
    <div style="margin-top:.5rem;"><a href="flow-shipments.html" class="link-btn">Open in Shipment Monitoring to update stages →</a></div></div></div>`;
}

function llToggleSection() {}   // reserved
