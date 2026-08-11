/* ═══════════════════════════════════════════════
   flow-docs.js — reusable per-record document attachments.
   openDocsModal(module, refNo, title) lets any flow page attach / list / remove
   supporting documents for a specific record, stored via the FlowAPI Documents
   registry (Drive-backed). Depends on flow-api.js (fetchFlow/postFlow/fileToDataURL/flowEsc/flowMsg).
   ═══════════════════════════════════════════════ */

let _docsCtx = { module: '', refNo: '' };
/* A190: FLOW_DOC_MAX_MB moved to flow-api.js. The client-visit photo picker needs the same limit,
   and report.html loads flow-api.js but not this file — declaring it in both places would be a
   const redeclaration and break every page that loads the pair. */

function _docsModalEl() {
  let el = document.getElementById('flowDocsModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'flowDocsModal';
  /* flow.css:49-50 makes .flow-modal-overlay display:none and only .open reveals it, so the
     class alone builds an invisible modal. */
  el.className = 'flow-modal-overlay open';
  el.innerHTML = `
    <div class="flow-modal" style="max-width:620px;">
      <h3>Documents</h3>
      <div class="sub" id="flowDocsSub">—</div>
      <div id="flowDocsList" style="margin:0.75rem 0;"></div>
      <div class="group-title">Attach a document</div>
      <div class="flow-form">
        <div class="full"><label>Files (multiple allowed · max ${FLOW_DOC_MAX_MB}MB each)</label><input type="file" id="flowDocsFile" multiple></div>
        <!-- A195: a picker, not free text. 71 of 234 stored documents had no type at all, which is
             why nothing could be checked; and the gates' own "attach a document" prompts opened this
             box untyped, so a compliance upload could not satisfy the rule that demanded it. The
             options come from the server's own rule table, so the two can never disagree. -->
        <div class="full"><label>Type <span style="font-weight:400;color:var(--text-muted,#64748b);">— pick the document this is</span></label>
          <select id="flowDocsType" onchange="_flowDocsTypeChanged()"><option value="">— select —</option></select>
          <input type="text" id="flowDocsTypeOther" placeholder="Describe the document" style="display:none;margin-top:0.35rem;">
        </div>
      </div>
      <div id="flowDocsMsg" class="flow-msg" style="display:none;"></div>
      <div class="flow-modal-foot">
        <button type="button" class="btn btn-secondary" onclick="closeDocsModal()">Close</button>
        <button type="button" class="btn btn-primary" id="flowDocsAddBtn" onclick="flowDocsUpload()">Attach</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

/* A195: the rule table, fetched once and shared. It is the SAME list the server gates on, so the
   picker can never offer a type no rule recognises, nor omit one a gate demands. */
let _flowDocRules = null;
async function _flowDocRulesLoad() {
  if (_flowDocRules) return _flowDocRules;
  try {
    const r = await fetchFlow('getDocRules', {});
    _flowDocRules = (r && r.rules) || [];
  } catch (e) { _flowDocRules = []; }   // a backend without the action must not block attaching
  return _flowDocRules;
}

function _flowDocsTypeChanged() {
  const sel = document.getElementById('flowDocsType');
  const other = document.getElementById('flowDocsTypeOther');
  if (!sel || !other) return;
  const isOther = sel.value === '__other__';
  other.style.display = isOther ? '' : 'none';
  if (!isOther) other.value = '';
  else other.focus();
}

/** The type the user actually chose — the picker, or the free-text box behind "Other". */
function _flowDocsChosenType() {
  const sel = document.getElementById('flowDocsType');
  if (!sel) return '';
  if (sel.value === '__other__') return (document.getElementById('flowDocsTypeOther') || {}).value || '';
  return sel.value || '';
}

/** Fill the picker with the types that make sense for this record, plus Other.
 *  kind (optional): 'intl' | 'local' | '' — the order's supplier type. A220: without it the picker
 *  offered FAN/SAD/TAN and a forwarder's final invoice on a LOCAL purchase, merely suffixed
 *  "(international)". Suffixing is not filtering; the rule engine does not want those documents and
 *  the supplier cannot produce them. An UNKNOWN kind still shows everything — never fewer options
 *  than the user might legitimately need. */
async function _flowDocsFillTypes(module, presetType, kind) {
  const sel = document.getElementById('flowDocsType');
  if (!sel) return;
  const rules = await _flowDocRulesLoad();
  const seen = {}, opts = [];
  rules.forEach(r => {
    if (module && r.module && r.module !== module) return;
    if (kind && r.applies && r.applies !== 'both' && r.applies !== kind) return;
    if (seen[r.type]) return;
    seen[r.type] = true;
    opts.push({ v: r.type, l: r.label + (r.applies === 'intl' ? ' (international)' : r.applies === 'local' ? ' (local)' : '') });
  });
  // A preset the rules do not carry must still be selectable — never silently drop a gate's demand.
  if (presetType && !seen[presetType]) opts.unshift({ v: presetType, l: presetType });
  sel.innerHTML = '<option value="">— select —</option>' +
    opts.map(o => `<option value="${flowEsc(o.v)}">${flowEsc(o.l)}</option>`).join('') +
    '<option value="__other__">Other…</option>';
  if (presetType) sel.value = presetType;
  _flowDocsTypeChanged();
}

// presetType (optional): lock the Doc Type field to a controlled value (e.g. "Supplier Quotation")
// so an upload from a required-attachment gate carries the exact docType the gate matches on.
// kind (optional, A220): the order's supplier type, so the picker offers only documents that order
// can actually have. Omitted means "unknown" and everything is offered, as before.
function openDocsModal(module, refNo, title, presetType, kind) {
  if (!refNo) { return; }
  _docsCtx = { module: module || '', refNo: String(refNo) };
  const el = _docsModalEl();
  el.querySelector('h3').textContent = 'Documents';
  document.getElementById('flowDocsSub').textContent =
    `${module ? module + ' · ' : ''}${title ? title : refNo}`;
  document.getElementById('flowDocsMsg').style.display = 'none';
  const f = document.getElementById('flowDocsFile'); if (f) f.value = '';
  const other = document.getElementById('flowDocsTypeOther');
  if (other) { other.value = ''; other.style.display = 'none'; }
  const t = document.getElementById('flowDocsType');
  if (t) {
    t.disabled = !!presetType;                       // a gate's demand is not up for negotiation
    t.style.background = presetType ? 'var(--bg-inset,#eef2f6)' : '';
  }
  _flowDocsFillTypes(module || '', presetType || '', kind || '');
  el.classList.add('open');
  flowDocsRefresh();
}

/* A195: a money gate refused for want of a document. Take the user straight to the shipment's Docs
   window with the first missing type preselected, instead of leaving them with an error to decode.
   Shared, because receiving, invoicing and collection all refuse the same way. */
async function flowOpenShipmentDocs(poNoOrSoNo, missingLabels) {
  try {
    const r = await fetchFlow('getShipments', {}, { fresh: true });
    const rows = (r && r.data) || [];
    const key = String(poNoOrSoNo || '');
    /* A220 — the caller passes a PO number (receiving does: rcCurrent.poNo) but Shipments['PO No'] is
       BLANK on every live row, and a PO number is not an SO number, so both matches missed and the
       one recovery path from a doc-gate refusal dead-ended in an alert. Resolve the PO to its sales
       order first, which is the join the rest of the system already uses. */
    let ship = rows.find(s => String(s.poNo || '') === key) || rows.find(s => String(s.soNo || '') === key);
    if (!ship) {
      const po = await fetchFlow('getPurchaseOrders', {}).catch(() => null);
      const hitPo = ((po && po.data) || []).find(p => String(p.poNo || '') === key);
      if (hitPo && hitPo.soNo) ship = rows.find(s => String(s.soNo || '') === String(hitPo.soNo));
    }
    if (!ship) { alert('Missing: ' + (missingLabels || []).join('; ')); return; }
    // Map the first missing label back to its rule so the picker opens on the right type.
    const rules = await _flowDocRulesLoad();
    const first = (missingLabels || [])[0] || '';
    const hit = rules.find(x => x.label === first);
    openDocsModal('Shipment', ship.shipmentId, 'Shipment · ' + ship.shipmentId,
                  hit ? hit.type : '', ship.supplierKind || '');
  } catch (e) { alert('Missing: ' + (missingLabels || []).join('; ')); }
}

// Reusable gate helper: does this record already carry a document (optionally of a given Doc Type,
// case-insensitive)? Used by the required-attachment gates on PR sourcing / PO / payment requests.
/** A158: a PDF the system generated FROM the record is not a supporting document — the submit gates
 *  ask for evidence someone attached (a supplier invoice, a proforma), so those rows are excluded
 *  from the untyped check. Mirrors _isGeneratedDoc in FlowAPI.gs. */
function flowIsGeneratedDoc(d) {
  return String((d && d.docType) || '').trim().toLowerCase().indexOf('generated pdf') === 0;
}

/** A178: a quotation's item photos are archived as documents so a regenerate can reproduce them, but
 *  they are managed on the item rows in the builder (attach / ✕ remove) — not here. Listing them would
 *  bury the real attachments under a photo-LK1234.jpg per line, and offer a second, easy-to-miss way to
 *  change the document. flowHasDoc still sees them, since no gate ever asks for this type. */
function flowIsItemPhotoDoc(d) {
  return String((d && d.docType) || '').trim().toLowerCase() === 'item photo';
}

async function flowHasDoc(module, refNo, type) {
  try {
    const res = await fetchFlow('getDocuments', { module, refNo: String(refNo) });
    const docs = (res && res.data) || [];
    if (!type) return docs.some(d => !flowIsGeneratedDoc(d));
    const t = String(type).toLowerCase();
    return docs.some(d => String(d.docType || '').toLowerCase() === t);
  } catch (e) { return false; }
}

function closeDocsModal() {
  const el = document.getElementById('flowDocsModal');
  if (el) el.classList.remove('open');
}

async function flowDocsRefresh() {
  const list = document.getElementById('flowDocsList');
  list.innerHTML = '<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">Loading…</div>';
  try {
    const res = await fetchFlow('getDocuments', { module: _docsCtx.module, refNo: _docsCtx.refNo });
    const docs = ((res && res.data) || []).filter(d => !flowIsItemPhotoDoc(d));
    if (!docs.length) {
      list.innerHTML = '<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">No documents attached yet.</div>';
      return;
    }
    list.innerHTML = `<table class="flow-table"><thead><tr><th>File</th><th>Type</th><th>By</th><th></th></tr></thead><tbody>${docs.map(d => `
      <tr>
        <td>${d.link ? `<a href="${flowEsc(d.link)}" target="_blank" class="link-btn">${flowEsc(d.fileName || 'document')}</a>` : flowEsc(d.fileName || 'document')}</td>
        <td>${flowEsc(d.docType || '—')}</td>
        <td>${flowEsc(d.uploadedBy || '—')}</td>
        <td style="white-space:nowrap;"><button class="link-btn del-btn" onclick='flowDocsDelete("${flowEsc(d.docId)}")'>Remove</button></td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    list.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;">${flowEsc(e.message)}</div>`;
  }
}

async function flowDocsUpload() {
  const fileEl = document.getElementById('flowDocsFile');
  const files = fileEl && fileEl.files ? Array.from(fileEl.files) : [];
  if (!files.length) { flowMsg('flowDocsMsg', 'Choose at least one file.', false); return; }
  const tooBig = files.find(f => f.size > FLOW_DOC_MAX_MB * 1024 * 1024);
  if (tooBig) { flowMsg('flowDocsMsg', `"${tooBig.name}" is too large (max ${FLOW_DOC_MAX_MB}MB each).`, false); return; }
  // A195: a typed document is the whole point — an untyped one satisfies no rule and is what
  // produced 71 unclassifiable rows. Asked for, not silently accepted.
  const docType = _flowDocsChosenType().trim();
  if (!docType) { flowMsg('flowDocsMsg', 'Choose what this document is, so it counts towards the order\'s checklist.', false); return; }
  const btn = document.getElementById('flowDocsAddBtn');
  btn.disabled = true;
  let done = 0;
  const failures = [];
  try {
    for (const file of files) {
      btn.textContent = `Attaching ${done + 1}/${files.length}…`;
      try {
        const dataUrl = await fileToDataURL(file);
        const base64 = String(dataUrl).split(',')[1] || '';
        const res = await postFlow('addDocument', {
          module: _docsCtx.module, refNo: _docsCtx.refNo, docType,
          fileName: file.name, fileBase64: base64, mimeType: file.type || 'application/octet-stream'
        });
        if (!res.success) throw new Error(res.message);
        done++;
      } catch (e) { failures.push(`${file.name}: ${e.message}`); }
    }
    fileEl.value = ''; document.getElementById('flowDocsType').value = '';
    await flowDocsRefresh();
    if (failures.length) flowMsg('flowDocsMsg', `Attached ${done}/${files.length}. Failed: ${failures.join('; ')}`, false);
    else flowMsg('flowDocsMsg', `${done} document${done === 1 ? '' : 's'} attached.`, true);
  } catch (e) {
    flowMsg('flowDocsMsg', e.message, false);
  } finally { btn.disabled = false; btn.textContent = 'Attach'; }
}

async function flowDocsDelete(docId) {
  if (!confirm('Remove this document?')) return;
  try {
    const res = await postFlow('deleteDocument', { docId });
    if (!res.success) throw new Error(res.message);
    await flowDocsRefresh();
  } catch (e) { flowMsg('flowDocsMsg', e.message, false); }
}
