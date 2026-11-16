/* ═══════════════════════════════════════════════
   hr-recruitment.js — Recruitment Pipeline logic
   ═══════════════════════════════════════════════ */

let pipelineData = [];
let editingRow = null;

const STAGES = ['Job Posted', 'Resume Screening', 'Initial Interview', 'Final Interview', 'Job Offer', 'Onboarding', 'Complete'];
const STAGE_CLASS = {
  'Job Posted': 'stage-posted',
  'Resume Screening': 'stage-screening',
  'Initial Interview': 'stage-initial',
  'Final Interview': 'stage-final',
  'Job Offer': 'stage-offer',
  'Onboarding': 'stage-onboarding',
  'Complete': 'stage-complete'
};

let hrSession = null;      // A186 — so the form can default Assigned HR to whoever is logged in

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  hrSession = session;
  const hrField = document.getElementById('candHR');
  if (hrField && !hrField.value) hrField.value = session.name || '';
  renderNavbar('hr-recruitment');
  await Promise.all([loadPipeline(), loadStats(), loadEvals()]);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && evalOpenKey) closeEvalForms(); });
});

function esc(str) { return hxEscBlank(str); }


function resetForm() {
  document.getElementById('recForm').reset();
  document.getElementById('editRowIndex').value = '';
  // A186 — form.reset() empties Assigned HR, and a blank there is what used to hide the candidate
  // from every daily report. Default it back to the person filling the form in.
  const hrField = document.getElementById('candHR');
  if (hrField && hrSession) hrField.value = hrSession.name || '';
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Candidate';
  document.getElementById('submitBtn').textContent = 'Add Candidate';
  document.getElementById('formMsg').style.display = 'none';
  editingRow = null;
}

function editCandidate(rowIndex) {
  const c = pipelineData.find(x => x.rowIndex === rowIndex);
  if (!c) return;

  editingRow = rowIndex;
  document.getElementById('editRowIndex').value = rowIndex;
  document.getElementById('candName').value = c.candidateName;
  document.getElementById('candPosition').value = c.position;
  document.getElementById('candStage').value = c.stage || 'Job Posted';
  document.getElementById('candDate').value = c.dateApplied;
  document.getElementById('candHR').value = c.assignedHR;
  document.getElementById('candNotes').value = c.notes;
  document.getElementById('formTitle').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Candidate';
  document.getElementById('submitBtn').textContent = 'Update Candidate';

  const section = document.getElementById('formSection');
  if (!section.classList.contains('open')) toggleForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitCandidate(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  btn.disabled = true;
  msg.style.display = 'none';

  const data = {
    candidateName: document.getElementById('candName').value.trim(),
    position: document.getElementById('candPosition').value.trim(),
    stage: document.getElementById('candStage').value,
    dateApplied: document.getElementById('candDate').value,
    assignedHR: document.getElementById('candHR').value.trim(),
    notes: document.getElementById('candNotes').value.trim(),
    actorName: (hrSession && hrSession.name) || ''      // A186 — credits the daily report
  };

  try {
    let result;
    if (editingRow !== null) {
      data.rowIndex = String(editingRow);
      btn.textContent = 'Updating...';
      result = await apiUpdateCandidate(data);
    } else {
      btn.textContent = 'Adding...';
      result = await apiAddCandidate(data);
    }

    if (!result.success) throw new Error(result.message || 'Failed');

    msg.style.display = 'block';
    msg.style.background = 'var(--hx-ok-soft)';
    msg.style.color = 'var(--hx-ok)';
    msg.textContent = result.message || 'Success!';
    resetForm();
    clearApiCache();
    await Promise.all([loadPipeline(), loadStats()]);
  } catch (err) {
    msg.style.display = 'block';
    msg.style.background = 'var(--hx-red-soft)';
    msg.style.color = 'var(--hx-red)';
    msg.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = editingRow ? 'Update Candidate' : 'Add Candidate';
}

async function deleteCandidate(rowIndex, name) {
  if (!confirm('Delete candidate "' + name + '"? This cannot be undone.')) return;
  try {
    const result = await apiDeleteCandidate(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadPipeline(), loadStats()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function advanceStage(rowIndex, currentStage) {
  const idx = STAGES.indexOf(currentStage);
  if (idx < 0 || idx >= STAGES.length - 1) return;
  const nextStage = STAGES[idx + 1];
  try {
    // A186 — actorName is what puts this into the mover's daily report. Advancing a stage is the
    // most common recruitment action and used to send nothing identifying anyone, so the work
    // was invisible unless the candidate happened to be assigned to that exact person.
    const result = await apiUpdateCandidate({ rowIndex: String(rowIndex), stage: nextStage,
                                              actorName: (hrSession && hrSession.name) || '' });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await Promise.all([loadPipeline(), loadStats()]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadStats() {
  try {
    const result = await apiGetRecruitmentStats();
    if (!result.success || !result.data) return;
    const stats = result.data;
    const container = document.getElementById('statsRow');
    let html = '<div class="mini-stat"><div class="num">' + stats.total + '</div><div class="lbl">Total</div></div>';
    STAGES.forEach(s => {
      html += '<div class="mini-stat"><div class="num">' + (stats.byStage[s] || 0) + '</div><div class="lbl">' + s + '</div></div>';
    });
    container.innerHTML = html;
  } catch (err) { /* ignore */ }
}

async function loadPipeline() {
  const container = document.getElementById('recContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await apiGetRecruitmentPipeline();
    if (!result.success) throw new Error(result.message || 'Failed');
    pipelineData = result.data || [];
    renderTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--hx-red);">Error: ' + esc(err.message) + '</div>';
  }
}

function renderTable() {
  const container = document.getElementById('recContainer');
  const filterStage = document.getElementById('filterStage').value;
  const search = (document.getElementById('searchInput').value || '').toLowerCase();

  const filtered = pipelineData.filter(c => {
    if (filterStage && c.stage !== filterStage) return false;
    if (search && !(c.candidateName || '').toLowerCase().includes(search) && !(c.position || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--hx-ink-3);">No candidates found.</div>';
    return;
  }

  const session = getSession();
  const isAdmin = session && session.role === 'admin';

  let html = '<table class="rec-table"><thead><tr>' +
    '<th>Candidate</th><th>Position</th><th>Stage</th><th>Date Applied</th><th>Assigned HR</th>' + (evalReady ? '<th>Evaluation</th>' : '') + '<th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(c => {
    const cls = STAGE_CLASS[c.stage] || 'stage-posted';
    const stageIdx = STAGES.indexOf(c.stage);
    const canAdvance = stageIdx >= 0 && stageIdx < STAGES.length - 1;

    html += '<tr>' +
      '<td><strong>' + esc(c.candidateName) + '</strong>' + (c.notes ? '<br><span style="font-size:0.75rem;color:var(--hx-ink-3);">' + esc(c.notes).substring(0, 60) + '</span>' : '') + '</td>' +
      '<td>' + esc(c.position) + '</td>' +
      '<td><span class="stage-badge ' + cls + '">' + esc(c.stage) + '</span></td>' +
      '<td>' + esc(c.dateApplied) + '</td>' +
      '<td>' + esc(c.assignedHR) + '</td>' +
      (evalReady ? '<td>' + evalChip(c) + '</td>' : '') +   // A400
      '<td style="white-space:nowrap;">';

    if (!isAdmin) {
      if (canAdvance) {
        html += '<button class="btn btn-sm" style="background:var(--hx-cyan-soft);color:var(--hx-cyan-ink);border:1px solid var(--hx-cyan-ring);margin-right:0.2rem;" onclick="advanceStage(' + c.rowIndex + ',\'' + esc(c.stage) + '\')" title="Advance to next stage">Next</button>';
      }
      html += '<button class="btn btn-sm btn-secondary" onclick="editCandidate(' + c.rowIndex + ')" style="margin-right:0.2rem;" title="Edit">Edit</button>' +
        '<button class="btn btn-sm" style="background:var(--hx-red-soft);color:var(--hx-red);border:1px solid var(--hx-red-line);" onclick="deleteCandidate(' + c.rowIndex + ',' + esc(JSON.stringify(String(c.candidateName || ''))) + ')" title="Delete">Del</button>';   // A325 — an escaped ' decodes back before the handler runs; a JSON string survives it
    } else {
      html += '<span style="color:var(--hx-ink-3);font-size:0.78rem;">View only</span>';
    }

    html += '</td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

/* ── A400 — evaluation forms (Neil, 16 Nov 2026: "an option to upload evaluation form under the recruitment") ──────────
   Each candidate can carry one or more evaluation forms (say one per interview), kept as private Drive files by FlowAPI
   201. A candidate here is addressed by a row number that shifts on every delete, so a form is filed under the
   candidate's key: C + the yyyyMMddHHmmss they were added, Philippine time (Created At is set once and never edited).
   A form whose key no longer matches anyone falls back to the candidate of the same name. Before FlowAPI 201 is
   pasted the read is refused and the page looks exactly as it did (no Evaluation column). */
let evalForms = {};            // candidate key → [form, …], oldest first
let evalReady = false;
let evalMay = { edit: false };
let evalStages = STAGES.slice();
let evalOpenKey = '';
let evalTrigger = null;
const EVAL_MAX = 10 * 1024 * 1024;
const EVAL_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
const EVAL_MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** 'C' + yyyyMMddHHmmss (Philippine time) from Created At, in either shape Code.gs hands it over:
 *  "2026-05-06 17:25:20" or "Wed May 06 2026 17:25:20 GMT+0800 (Philippine Standard Time)". '' when unreadable. */
function recCandKey(createdAt) {
  const s = String(createdAt || '').trim();
  const p2 = (n) => String(n).padStart(2, '0');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m && !/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return 'C' + m.slice(1, 7).join('');
  m = s.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})(?: GMT([+-])(\d{2})(\d{2}))?/);
  let utc;
  if (m && EVAL_MONTHS[m[1]]) {
    const off = m[7] ? (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) : 480;   // no zone given: Philippine time
    utc = Date.UTC(Number(m[3]), EVAL_MONTHS[m[1]] - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6])) - off * 60000;
  } else {
    utc = Date.parse(s);
    if (isNaN(utc)) return '';
  }
  const d = new Date(utc + 8 * 3600000);                                                    // Philippine time, no daylight saving
  return 'C' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds());
}

async function loadEvals() {
  let r = null;
  try { r = await postFlow('getCandidateEvals', {}); } catch (e) { r = null; }
  if (!r || !r.success) { evalReady = false; if (pipelineData.length) renderTable(); return; }
  evalForms = {};
  (r.data || []).forEach(f => { (evalForms[f.candidateKey] = evalForms[f.candidateKey] || []).push(f); });
  evalMay = r.may || { edit: false };
  if (Array.isArray(r.stages) && r.stages.length) evalStages = r.stages;
  evalReady = true;
  if (pipelineData.length) renderTable();
  if (evalOpenKey) _evalDraw();
}

/** A candidate's forms: by key, then any form whose key matches no candidate but whose name is this candidate's. */
function evalFormsFor(c) {
  const key = recCandKey(c.createdAt);
  const own = (key && evalForms[key]) || [];
  const keys = {};
  pipelineData.forEach(x => { const k = recCandKey(x.createdAt); if (k) keys[k] = true; });
  const nm = String(c.candidateName || '').trim().toLowerCase();
  const strays = [];
  Object.keys(evalForms).forEach(k => {
    if (keys[k]) return;
    evalForms[k].forEach(f => { if (nm && String(f.candidate || '').trim().toLowerCase() === nm) strays.push(f); });
  });
  return own.concat(strays);
}

function evalChip(c) {
  const key = recCandKey(c.createdAt);
  if (!key) return '<span style="color:var(--hx-ink-3);" title="This candidate has no date added, so a form cannot be filed">—</span>';
  const n = evalFormsFor(c).length;
  const ico = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  if (n) return '<button type="button" class="rec-eval-chip" onclick="openEvalForms(' + c.rowIndex + ', this)" aria-label="' + esc(n + ' evaluation form' + (n === 1 ? '' : 's') + ' for ' + c.candidateName) + '">' + ico + n + (n === 1 ? ' form' : ' forms') + '</button>';
  if (!evalMay.edit) return '<span style="color:var(--hx-ink-3);">—</span>';
  return '<button type="button" class="rec-eval-chip add" onclick="openEvalForms(' + c.rowIndex + ', this)" aria-label="' + esc('Add an evaluation form for ' + c.candidateName) + '">+ Add form</button>';
}

function openEvalForms(rowIndex, trigger) {
  const c = pipelineData.find(x => x.rowIndex === rowIndex);
  if (!c) return;
  evalOpenKey = recCandKey(c.createdAt);
  if (!evalOpenKey) return;
  evalTrigger = trigger || null;
  const st = document.getElementById('evalStage');
  st.innerHTML = evalStages.map(x => '<option' + (x === c.stage ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  document.getElementById('evalNote').value = '';
  _evalMsg('');
  _evalDraw();
  document.getElementById('evalModal').classList.add('open');
  const first = document.getElementById(evalMay.edit ? 'evalPick' : 'evalClose');
  setTimeout(() => { if (first) first.focus(); }, 30);
}

function closeEvalForms() {
  document.getElementById('evalModal').classList.remove('open');
  evalOpenKey = '';
  if (evalTrigger && document.body.contains(evalTrigger)) evalTrigger.focus();
  evalTrigger = null;
}

function _evalCandidate() { return pipelineData.find(x => recCandKey(x.createdAt) === evalOpenKey) || null; }

function _evalKind(f) {
  const t = String(f.fileType || '');
  if (t === 'application/pdf') return 'PDF';
  if (/^image\//.test(t)) return 'IMG';
  if (/wordprocessing/.test(t)) return 'DOC';
  if (/spreadsheet/.test(t)) return 'XLS';
  if (/presentation/.test(t)) return 'PPT';
  return 'TXT';
}

/** "16 Nov 2026", Philippine time, the same in every browser. */
function _evalWhen(iso) {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return '';
  const d = new Date(t + 8 * 3600000);
  return d.getUTCDate() + ' ' + Object.keys(EVAL_MONTHS)[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function _evalDraw() {
  const c = _evalCandidate();
  if (!c) return;
  document.getElementById('evalTitle').textContent = 'Evaluation forms — ' + (c.candidateName || 'candidate');
  document.getElementById('evalSub').textContent = [c.position, c.stage].filter(Boolean).join(' · ');
  const forms = evalFormsFor(c);
  document.getElementById('evalList').innerHTML = forms.map(f =>
    '<li class="rec-eval-item"><span class="rec-eval-ico" aria-hidden="true">' + _evalKind(f) + '</span>' +
    '<div><button type="button" class="rec-eval-file" onclick="openEvalFile(' + esc(JSON.stringify(f.evalNo)) + ')">' + esc(f.fileName || 'Evaluation form') + '</button>' +
    '<div class="rec-eval-meta">' + esc([f.stage, 'added ' + _evalWhen(f.uploadedAt) + (f.uploadedBy ? ' by ' + f.uploadedBy : ''), f.note].filter(Boolean).join(' · ')) + '</div></div>' +
    (evalMay.edit ? '<button type="button" class="link-btn rec-eval-btn" onclick="archiveEvalForm(' + esc(JSON.stringify(f.evalNo)) + ', false)">Archive</button>' : '<span></span>') +
    '</li>').join('');
  document.getElementById('evalEmpty').hidden = forms.length > 0;
  document.getElementById('evalEmpty').textContent = evalMay.edit ? 'No evaluation form on file yet. Upload the one filled in after the interview.' : 'No evaluation form on file yet.';
  document.getElementById('evalAdd').hidden = !evalMay.edit;
}

function _evalMsg(text, tone) {
  const m = document.getElementById('evalMsg');
  if (!m) return;
  m.className = 'rec-eval-msg' + (tone === 'bad' ? ' bad' : '');
  m.innerHTML = tone === 'busy' ? '<span class="spinner" aria-hidden="true"></span><span>' + esc(text) + '</span>' : esc(text);
}

function _evalToast(text, tone) { if (typeof window.hxToast === 'function') window.hxToast(text, { tone: tone || 'ok' }); }

function evalFileProblem(file) {
  if (!file) return 'Choose a file.';
  if (EVAL_TYPES.indexOf(String(file.type || '').toLowerCase()) < 0) return 'Upload a PDF, a Word, Excel or PowerPoint file, or a photo of the form.';
  if (file.size > EVAL_MAX) return 'The file is too large: keep it under 10 MB.';
  return '';
}

async function uploadEvalForm(inp) {
  const file = inp.files && inp.files[0];
  const c = _evalCandidate();
  inp.value = '';
  if (!c || !file) return;
  const bad = evalFileProblem(file);
  if (bad) { _evalMsg(bad, 'bad'); return; }
  const btn = document.getElementById('evalPick');
  btn.disabled = true;
  _evalMsg('Uploading ' + file.name + '…', 'busy');
  try {
    const isImg = /^image\/(jpeg|png|webp)$/.test(file.type) && typeof flowDownscaleImage === 'function';
    const url = isImg ? await flowDownscaleImage(file, 1600, 0.82) : await fileToDataURL(file);
    const r = await postFlow('saveCandidateEval', {
      candidateKey: recCandKey(c.createdAt), candidate: c.candidateName, position: c.position || '',
      stage: document.getElementById('evalStage').value, note: document.getElementById('evalNote').value.trim(),
      fileBase64: String(url).replace(/^data:[^,]*,/, ''), fileName: isImg ? file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' : file.name,
      mimeType: isImg ? 'image/jpeg' : file.type,
      clientRef: typeof flowClientRef === 'function' ? flowClientRef() : String(Date.now())
    });
    if (!r || !r.success) throw new Error((r && r.message) || 'The form was not added.');
    _evalMsg('');
    document.getElementById('evalNote').value = '';
    _evalToast(r.message || 'Evaluation form added.', 'ok');
    await loadEvals();
  } catch (e) {
    _evalMsg(String((e && e.message) || e), 'bad');
  }
  btn.disabled = false;
}

async function archiveEvalForm(evalNo, restore) {
  let r = null;
  try { r = await postFlow('archiveCandidateEval', { evalNo: evalNo, restore: !!restore }); } catch (e) { r = { success: false, message: String(e.message || e) }; }
  if (!r || !r.success) { _evalToast((r && r.message) || 'Not changed.', 'bad'); return; }
  if (!restore && typeof window.hxSnackbar === 'function') window.hxSnackbar('Evaluation form archived.', { action: 'Undo', onAction: () => archiveEvalForm(evalNo, true) });
  else _evalToast(restore ? 'Evaluation form is back.' : 'Archived.', 'ok');
  await loadEvals();
}

/** Open a form: the window opens on the press (so it is not blocked), then the file arrives in it. */
async function openEvalFile(evalNo) {
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  let r = null;
  try { r = await postFlow('getCandidateEvalFile', { evalNo: evalNo }); } catch (e) { r = { success: false, message: String(e.message || e) }; }
  if (!(r && r.success) || r.missing) { if (w) w.close(); _evalToast((r && r.message) || 'The form could not be opened.', 'bad'); return; }
  const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
  if (w && /^(image\/|application\/pdf|text\/)/.test(r.mimeType)) { w.location.href = url; return; }
  if (w) w.close();
  const a = document.createElement('a');
  a.href = url; a.download = r.fileName || 'evaluation';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
