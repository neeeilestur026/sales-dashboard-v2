/* flow-shipments.js — flow-native Shipment Monitoring (25-stage timeline; a local order uses 13 of them).
   Shipments are auto-created when a Sales Order is created; flow-matched stages
   auto-advance from the flow (PO/AP/Receiving). Reuses stage-meta.js + the
   Documents registry (module='Shipment', refNo=shipmentId, docType=stageKey). */

let shSession = null;
let shViewer = false;     // A231: management looks, does not touch
let shList = [];
let shDocs = [];          // documents for the open shipment
let shCurrent = null;     // open shipment timeline payload

const SH_DOC_MAX_MB = 10;

document.addEventListener('DOMContentLoaded', () => {
  shSession = requireFlowOperations();                  // A231 — management admitted as a viewer
  if (!shSession) return;
  shViewer = isFlowViewerRole(shSession);
  flowSetViewerOnly(shViewer);
  renderNavbar('flow-shipments');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-shipments.html');
  document.getElementById('shSearch').addEventListener('input', renderShipments);
  document.getElementById('shStatus').addEventListener('change', renderShipments);
  loadShipments();
});

async function loadShipments() {
  const c = document.getElementById('shList');
  c.innerHTML = '<div class="dr-empty">Loading…</div>';
  try {
    const r = await fetchFlow('getShipments');
    shList = (r && r.data) || [];
    // newest first
    shList.sort((a, b) => (flowDate(b.createdAt) || '').localeCompare(flowDate(a.createdAt) || '') ||
      String(b.shipmentId).localeCompare(String(a.shipmentId)));
    renderShipments();
  } catch (e) { c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`; }
}

function renderShipments() {
  const c = document.getElementById('shList');
  const q = (document.getElementById('shSearch').value || '').trim().toLowerCase();
  const st = document.getElementById('shStatus').value;
  const rows = shList.filter(s => {
    if (st && (s.status || 'Pending') !== st) return false;
    if (q && !((s.shipmentId + ' ' + (s.soNo || '') + ' ' + (s.customer || '')).toLowerCase().includes(q))) return false;
    return true;
  });
  document.getElementById('shMeta').textContent = `${rows.length} of ${shList.length} shipment${shList.length === 1 ? '' : 's'}`;
  if (!shList.length) { c.innerHTML = '<div class="dr-empty">No shipments yet. Create a Sales Order to start one.</div>'; return; }
  if (!rows.length) { c.innerHTML = '<div class="dr-empty">No shipments match the filters.</div>'; return; }
  c.innerHTML = `<table class="flow-table"><thead><tr><th>Shipment</th><th>SO</th><th>Customer</th><th>Type</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody>${rows.map(s => {
    // A220: the progress total is now the stages this ORDER actually has — 13 for a local purchase,
    // 25 for an international one. It used to be 25 for everything, so every local shipment read as
    // permanently half-finished against steps it could never complete.
    const p = s.progress || { done: 0, total: 0 };
    const pct = p.total ? Math.round((p.done + (p.skipped || 0)) / p.total * 100) : 0;
    return `<tr>
      <td>${flowEsc(s.shipmentId)}</td>
      <td>${flowEsc(s.soNo || '—')}</td>
      <td>${flowEsc(s.customer || '—')}</td>
      <td>${shKindBadge(s.supplierKind)}</td>
      <td><span class="flow-badge b-open">${flowEsc(s.status || 'Pending')}</span></td>
      <td><span class="sh-prog"><span class="sh-bar"><span style="width:${pct}%;"></span></span><span style="font-size:0.74rem;color:var(--text-muted,#64748b);">${p.done}/${p.total}</span></span></td>
      <td><button class="link-btn" onclick='shOpen("${flowEsc(s.shipmentId)}")'>Timeline</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

// ─── Timeline modal ───────────────────────────────
async function shOpen(shipmentId) {
  document.getElementById('shOverlay').style.display = 'block';
  document.getElementById('shTlTitle').textContent = shipmentId;
  document.getElementById('shTlSub').textContent = 'Loading…';
  document.getElementById('shTlBody').innerHTML = '<div class="dr-empty">Loading…</div>';
  try {
    const [tl, docs] = await Promise.all([
      fetchFlow('getShipmentTimeline', { shipmentId }),
      fetchFlow('getDocuments', { module: 'Shipment', refNo: shipmentId }).catch(() => ({ data: [] })),
    ]);
    if (!tl.success) throw new Error(tl.message);
    shCurrent = tl;
    shDocs = (docs && docs.data) || [];
    shRenderTimeline();
  } catch (e) {
    document.getElementById('shTlBody').innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}
function shClose() { document.getElementById('shOverlay').style.display = 'none'; shCurrent = null; }

function shStageMeta(key) { return _SM_LIFECYCLE_STAGES.find(s => s.key === key) || { key, label: key, owner: '—', docLabel: null }; }

/* A220 — the supplier type, which until now was invisible on every shipment surface even though it
   decides how many documents the order needs. 'unclassified' is shown as itself, not guessed: 13 of
   the 106 live orders have no type, and assuming Local would silently drop document requirements. */
function shKindBadge(kind) {
  if (kind === 'intl')  return '<span class="flow-badge b-open">International</span>';
  if (kind === 'local') return '<span class="flow-badge b-done">Local</span>';
  return '<span class="flow-badge b-pending" title="No supplier type set — all stages shown">Unclassified</span>';
}

function shRenderTimeline() {
  const s = shCurrent.shipment;
  const kind = shCurrent.supplierKind || '';
  // A220: hidden stages are still RETURNED — the server never filters them away, so their stored
  // state survives a reclassification and comes straight back if the order is switched again.
  const tl = shCurrent.timeline.filter(t => t.applies !== false);
  const hiddenWithWork = shCurrent.timeline.filter(t => t.applies === false && t.status !== 'pending');
  const byKey = {}; tl.forEach(t => byKey[t.key] = t);
  document.getElementById('shTlTitle').textContent = `${s.shipmentId} · ${s.customer || ''}`;
  const done = tl.filter(t => t.status === 'done').length;
  document.getElementById('shTlSub').textContent = `SO ${s.soNo || '—'} · ${done}/${tl.length} stages complete`;

  // edit header
  const opt = (v, cur) => `<option${v === cur ? ' selected' : ''}>${v}</option>`;
  const kindOpt = (v, l) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`;
  let html = `<div class="sh-editgrid">
    <div><label>Supplier Type</label><select id="shKind" onchange="shSaveKind()">
      ${kindOpt('', '— Unclassified —')}${kindOpt('intl', 'International')}${kindOpt('local', 'Local')}
    </select></div>
    <div><label>Mode</label><select id="shMode"><option value=""></option>${['AIR', 'SEA', 'LOCAL'].map(v => opt(v, s.mode)).join('')}</select></div>
    <div><label>Status</label><select id="shStatusEdit">${['Pending', 'In Transit', 'Arrived', 'Delivered'].map(v => opt(v, s.status)).join('')}</select></div>
    <div><label>ETD</label><input type="date" id="shEtd" value="${flowEsc(flowDate(s.etd) || '')}"></div>
    <div><label>ETA</label><input type="date" id="shEta" value="${flowEsc(flowDate(s.eta) || '')}"></div>
    <div><label>AWB / Tracking</label><input type="text" id="shAwb" value="${flowEsc(s.awb || '')}"></div>
    <div><label>Principal</label><input type="text" id="shPrincipal" value="${flowEsc(s.principal || '')}"></div>
    <div style="grid-column:1/-1;"><label>Remarks</label><input type="text" id="shRemarks" value="${flowEsc(s.remarks || '')}"></div>
  </div>
  <div class="flow-actions" style="margin:-0.3rem 0 0.6rem;">${shViewer ? '' : `<button class="btn btn-sm btn-primary" onclick="shSaveHeader()">Save details</button>`}<span id="shHeadMsg" style="font-size:0.76rem;color:var(--text-muted,#64748b);"></span></div>`;

  if (kind === 'local') {
    html += `<div class="sh-kindnote">Local purchase — paid, then delivered to the office. The proforma,
      forwarder, customs and bank-memo stages do not apply and are hidden.
      ${hiddenWithWork.length ? `<b>${hiddenWithWork.length} hidden stage(s) still hold recorded work</b>
        (${hiddenWithWork.map(t => flowEsc(shStageMeta(t.key).label)).join(', ')}) — nothing was deleted;
        switch back to International to see them again.` : ''}</div>`;
  } else if (!kind) {
    html += `<div class="sh-kindnote">No supplier type set on ${flowEsc(s.soNo || 'this order')}, so all
      stages are shown. Set it above — a local purchase needs two documents at receiving where an
      international one needs seven.</div>`;
  }

  // phases + stage cards
  _SM_PHASES.forEach((ph, pi) => {
    // A220: a phase whose every stage is international drops out entirely on a local order —
    // 'Documents' and 'Logistics' both do. An empty phase heading would be worse than none.
    const stages = ph.stages.filter(key => byKey[key]);
    if (!stages.length) return;
    html += `<div class="sh-phase"><div class="sh-phase-h">${_SM_PHASE_ICONS[pi] || ''} ${flowEsc(ph.name)}</div>`;
    stages.forEach(key => {
      const t = byKey[key];
      const meta = shStageMeta(key);
      const label = smStageLabel(key, kind);   // a local transfer is a bank transfer, not a TT
      const ownerCls = _SM_OWNER_BADGE_CLASS[meta.owner] || 'sm-owner-admin';
      const stageDocs = shDocs.filter(d => String(d.docType) === key);
      const dot = t.status === 'done' ? '✓' : (t.status === 'skipped' ? '–' : '');
      const acts = (t.autoderived || shViewer)
        ? `<span class="sh-meta">${t.autoderived ? 'auto from flow' : ''}</span>`
        : `<div class="sh-stage-acts">
             ${t.status !== 'done' ? `<button onclick="shStage('${key}','done')">Done</button>` : ''}
             ${t.status !== 'skipped' ? `<button onclick="shStage('${key}','skipped')">Skip</button>` : ''}
             ${t.status !== 'pending' ? `<button onclick="shStage('${key}','pending')">Reset</button>` : ''}
           </div>`;
      html += `<div class="sh-stage ${t.status}">
        <div class="sh-stage-top">
          <span class="sh-dot ${t.status}">${dot}</span>
          <span class="sh-stage-label">${flowEsc(label)}</span>
          <span class="sm-owner-badge ${ownerCls}">${flowEsc(meta.owner)}</span>
          ${t.autoderived ? '<span class="sh-auto">AUTO</span>' : ''}
          ${acts}
        </div>
        ${meta.docLabel ? `<div class="sh-stage-doc">📎 ${flowEsc(meta.docLabel)}</div>` : ''}
        ${stageDocs.map(d => `<div class="sh-docrow">${d.link ? `<a href="${flowEsc(d.link)}" target="_blank" class="link-btn">${flowEsc(d.fileName || 'document')}</a>` : flowEsc(d.fileName || 'document')}${shViewer ? '' : `<button class="link-btn del-btn" onclick='shDelDoc("${flowEsc(d.docId)}")'>✕</button>`}</div>`).join('')}
        ${shViewer ? '' : `<div class="sh-docrow"><input type="file" multiple id="shFile_${key}"><button class="btn btn-sm btn-secondary" onclick="shUpload('${key}')">Attach</button></div>`}
        ${t.completedAt ? `<div class="sh-meta">${t.status === 'skipped' ? 'Skipped' : 'Done'} ${flowEsc(t.completedAt)}${t.completedBy ? ' · ' + flowEsc(t.completedBy) : ''}${t.skippedReason ? ' · ' + flowEsc(t.skippedReason) : ''}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
  });

  document.getElementById('shTlBody').innerHTML = html;
  /* A231 — DISABLE the header fields rather than hide them. Supplier type, mode, status, ETD, ETA,
     AWB and principal are the shipment's actual state; a viewer needs to READ them, and hiding the
     grid to remove the edit affordance would take the information with it. Disabled shows the value
     and refuses the edit. The Save button is already gone, and shSaveKind cannot fire from a
     disabled select. */
  if (shViewer) {
    document.querySelectorAll('#shTlBody .sh-editgrid input, #shTlBody .sh-editgrid select')
      .forEach(el => { el.disabled = true; });
  }
}

async function shStage(stageKey, stageStatus) {
  let skippedReason = '';
  if (stageStatus === 'skipped') {
    skippedReason = prompt('Reason for skipping this stage (optional):', '') || '';
  }
  try {
    const r = await postFlow('advanceShipmentStage', { shipmentId: shCurrent.shipment.shipmentId, stageKey, stageStatus, skippedReason });
    if (!r.success) throw new Error(r.message);
    await shOpen(shCurrent.shipment.shipmentId);
    loadShipments();
    if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}

/* A220 — reclassify the ORDER from the shipment page.
 *
 * This deliberately does NOT go through updateSalesOrder: that function treats an omitted `items` as
 * an empty list and deletes every line on the order. setSOSupplierType writes two cells.
 *
 * The confirm is not a formality. Switching to Local hides the international stages, and if any of
 * them already carry a tick or a document the server refuses once and names them — nothing is ever
 * deleted, but somebody should see what is about to stop being on screen. */
async function shSaveKind() {
  const sel = document.getElementById('shKind');
  const soNo = shCurrent.shipment.soNo;
  const want = sel.value;
  const was = shCurrent.supplierKind || '';
  if (want === was) return;
  const msg = document.getElementById('shHeadMsg');
  if (!soNo) { sel.value = was; msg.textContent = 'This shipment has no sales order to classify.'; return; }
  const label = want === 'intl' ? 'International' : want === 'local' ? 'Local' : '';

  const send = async (confirmHide) => postFlow('setSOSupplierType', { soNo, supplierType: label, confirmHide });
  msg.textContent = 'Saving…';
  try {
    let r = await send(false);
    if (!r.success && r.needsConfirm === 'hideStages') {
      if (!confirm(r.message)) { sel.value = was; msg.textContent = 'Left as ' + (was || 'unclassified') + '.'; return; }
      r = await send(true);
    }
    if (!r.success) throw new Error(r.message);
    msg.textContent = r.message;
    await shOpen(shCurrent.shipment.shipmentId);   // re-read: the stage set itself has changed
    loadShipments();
  } catch (e) { sel.value = was; msg.textContent = e.message; }
}

async function shSaveHeader() {
  const id = shCurrent.shipment.shipmentId;
  const msg = document.getElementById('shHeadMsg');
  msg.textContent = 'Saving…';
  try {
    const r = await postFlow('updateShipment', {
      shipmentId: id,
      mode: document.getElementById('shMode').value, status: document.getElementById('shStatusEdit').value,
      etd: document.getElementById('shEtd').value, eta: document.getElementById('shEta').value,
      awb: document.getElementById('shAwb').value.trim(), principal: document.getElementById('shPrincipal').value.trim(),
      remarks: document.getElementById('shRemarks').value.trim(),
    });
    if (!r.success) throw new Error(r.message);
    msg.textContent = 'Saved.';
    loadShipments();
    if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { msg.textContent = e.message; }
}

async function shUpload(stageKey) {
  const id = shCurrent.shipment.shipmentId;
  const el = document.getElementById('shFile_' + stageKey);
  const files = el && el.files ? Array.from(el.files) : [];
  if (!files.length) { alert('Choose at least one file.'); return; }
  const tooBig = files.find(f => f.size > SH_DOC_MAX_MB * 1024 * 1024);
  if (tooBig) { alert(`"${tooBig.name}" is too large (max ${SH_DOC_MAX_MB}MB each).`); return; }
  try {
    for (const file of files) {
      const dataUrl = await fileToDataURL(file);
      const base64 = String(dataUrl).split(',')[1] || '';
      const r = await postFlow('addDocument', {
        module: 'Shipment', refNo: id, docType: stageKey,
        fileName: file.name, fileBase64: base64, mimeType: file.type || 'application/octet-stream'
      });
      if (!r.success) throw new Error(r.message);
    }
    await shOpen(id);
  } catch (e) { alert(e.message); }
}

async function shDelDoc(docId) {
  if (!confirm('Remove this document?')) return;
  try {
    const r = await postFlow('deleteDocument', { docId });
    if (!r.success) throw new Error(r.message);
    await shOpen(shCurrent.shipment.shipmentId);
  } catch (e) { alert(e.message); }
}
