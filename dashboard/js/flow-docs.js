/* ═══════════════════════════════════════════════
   flow-docs.js — reusable per-record document attachments.
   openDocsModal(module, refNo, title) lets any flow page attach / list / remove
   supporting documents for a specific record, stored via the FlowAPI Documents
   registry (Drive-backed). Depends on flow-api.js (fetchFlow/postFlow/fileToDataURL/flowEsc/flowMsg).
   ═══════════════════════════════════════════════ */

let _docsCtx = { module: '', refNo: '' };
const FLOW_DOC_MAX_MB = 10;

function _docsModalEl() {
  let el = document.getElementById('flowDocsModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'flowDocsModal';
  el.className = 'flow-modal-overlay';
  el.innerHTML = `
    <div class="flow-modal" style="max-width:620px;">
      <h3>Documents</h3>
      <div class="sub" id="flowDocsSub">—</div>
      <div id="flowDocsList" style="margin:0.75rem 0;"></div>
      <div class="group-title">Attach a document</div>
      <div class="flow-form">
        <div class="full"><label>Files (multiple allowed · max ${FLOW_DOC_MAX_MB}MB each)</label><input type="file" id="flowDocsFile" multiple></div>
        <div class="full"><label>Type / label (optional)</label><input type="text" id="flowDocsType" placeholder="e.g. Proforma, Packing List, Commercial Invoice"></div>
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

function openDocsModal(module, refNo, title) {
  if (!refNo) { return; }
  _docsCtx = { module: module || '', refNo: String(refNo) };
  const el = _docsModalEl();
  el.querySelector('h3').textContent = 'Documents';
  document.getElementById('flowDocsSub').textContent =
    `${module ? module + ' · ' : ''}${title ? title : refNo}`;
  document.getElementById('flowDocsMsg').style.display = 'none';
  const f = document.getElementById('flowDocsFile'); if (f) f.value = '';
  const t = document.getElementById('flowDocsType'); if (t) t.value = '';
  el.classList.add('open');
  flowDocsRefresh();
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
    const docs = (res && res.data) || [];
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
  const docType = document.getElementById('flowDocsType').value.trim();
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
