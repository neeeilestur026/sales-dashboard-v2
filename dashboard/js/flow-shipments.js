/* flow-shipments.js — flow-native Shipment Monitoring (21-stage timeline).
   Shipments are auto-created when a Sales Order is created; flow-matched stages
   auto-advance from the flow (PO/AP/Receiving). Reuses stage-meta.js + the
   Documents registry (module='Shipment', refNo=shipmentId, docType=stageKey). */

let shSession = null;
let shList = [];
let shDocs = [];          // documents for the open shipment
let shCurrent = null;     // open shipment timeline payload

const SH_DOC_MAX_MB = 10;

document.addEventListener('DOMContentLoaded', () => {
  shSession = requireAccountingOrAdmin();
  if (!shSession) return;
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
  c.innerHTML = `<table class="flow-table"><thead><tr><th>Shipment</th><th>SO</th><th>Customer</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody>${rows.map(s => {
    const p = s.progress || { done: 0, total: 21 };
    const pct = p.total ? Math.round((p.done + (p.skipped || 0)) / p.total * 100) : 0;
    return `<tr>
      <td>${flowEsc(s.shipmentId)}</td>
      <td>${flowEsc(s.soNo || '—')}</td>
      <td>${flowEsc(s.customer || '—')}</td>
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

function shRenderTimeline() {
  const s = shCurrent.shipment;
  const tl = shCurrent.timeline;
  const byKey = {}; tl.forEach(t => byKey[t.key] = t);
  document.getElementById('shTlTitle').textContent = `${s.shipmentId} · ${s.customer || ''}`;
  const done = tl.filter(t => t.status === 'done').length;
  document.getElementById('shTlSub').textContent = `SO ${s.soNo || '—'} · ${done}/${tl.length} stages complete`;

  // edit header
  const opt = (v, cur) => `<option${v === cur ? ' selected' : ''}>${v}</option>`;
  let html = `<div class="sh-editgrid">
    <div><label>Mode</label><select id="shMode"><option value=""></option>${['AIR', 'SEA', 'LOCAL'].map(v => opt(v, s.mode)).join('')}</select></div>
    <div><label>Status</label><select id="shStatusEdit">${['Pending', 'In Transit', 'Arrived', 'Delivered'].map(v => opt(v, s.status)).join('')}</select></div>
    <div><label>ETD</label><input type="date" id="shEtd" value="${flowEsc(flowDate(s.etd) || '')}"></div>
    <div><label>ETA</label><input type="date" id="shEta" value="${flowEsc(flowDate(s.eta) || '')}"></div>
    <div><label>AWB / Tracking</label><input type="text" id="shAwb" value="${flowEsc(s.awb || '')}"></div>
    <div><label>Principal</label><input type="text" id="shPrincipal" value="${flowEsc(s.principal || '')}"></div>
    <div style="grid-column:1/-1;"><label>Remarks</label><input type="text" id="shRemarks" value="${flowEsc(s.remarks || '')}"></div>
  </div>
  <div class="flow-actions" style="margin:-0.3rem 0 0.6rem;"><button class="btn btn-sm btn-primary" onclick="shSaveHeader()">Save details</button><span id="shHeadMsg" style="font-size:0.76rem;color:var(--text-muted,#64748b);"></span></div>`;

  // phases + stage cards
  _SM_PHASES.forEach((ph, pi) => {
    html += `<div class="sh-phase"><div class="sh-phase-h">${_SM_PHASE_ICONS[pi] || ''} ${flowEsc(ph.name)}</div>`;
    ph.stages.forEach(key => {
      const t = byKey[key]; if (!t) return;
      const meta = shStageMeta(key);
      const ownerCls = _SM_OWNER_BADGE_CLASS[meta.owner] || 'sm-owner-admin';
      const stageDocs = shDocs.filter(d => String(d.docType) === key);
      const dot = t.status === 'done' ? '✓' : (t.status === 'skipped' ? '–' : '');
      const acts = t.autoderived
        ? `<span class="sh-meta">auto from flow</span>`
        : `<div class="sh-stage-acts">
             ${t.status !== 'done' ? `<button onclick="shStage('${key}','done')">Done</button>` : ''}
             ${t.status !== 'skipped' ? `<button onclick="shStage('${key}','skipped')">Skip</button>` : ''}
             ${t.status !== 'pending' ? `<button onclick="shStage('${key}','pending')">Reset</button>` : ''}
           </div>`;
      html += `<div class="sh-stage ${t.status}">
        <div class="sh-stage-top">
          <span class="sh-dot ${t.status}">${dot}</span>
          <span class="sh-stage-label">${flowEsc(meta.label)}</span>
          <span class="sm-owner-badge ${ownerCls}">${flowEsc(meta.owner)}</span>
          ${t.autoderived ? '<span class="sh-auto">AUTO</span>' : ''}
          ${acts}
        </div>
        ${meta.docLabel ? `<div class="sh-stage-doc">📎 ${flowEsc(meta.docLabel)}</div>` : ''}
        ${stageDocs.map(d => `<div class="sh-docrow">${d.link ? `<a href="${flowEsc(d.link)}" target="_blank" class="link-btn">${flowEsc(d.fileName || 'document')}</a>` : flowEsc(d.fileName || 'document')}<button class="link-btn del-btn" onclick='shDelDoc("${flowEsc(d.docId)}")'>✕</button></div>`).join('')}
        <div class="sh-docrow"><input type="file" multiple id="shFile_${key}"><button class="btn btn-sm btn-secondary" onclick="shUpload('${key}')">Attach</button></div>
        ${t.completedAt ? `<div class="sh-meta">${t.status === 'skipped' ? 'Skipped' : 'Done'} ${flowEsc(t.completedAt)}${t.completedBy ? ' · ' + flowEsc(t.completedBy) : ''}${t.skippedReason ? ' · ' + flowEsc(t.skippedReason) : ''}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
  });

  document.getElementById('shTlBody').innerHTML = html;
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
  } catch (e) { alert(e.message); }
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
