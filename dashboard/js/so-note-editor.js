/* ═══════════════════════════════════════════════
   so-note-editor.js — a free-text note against one sales order (A191).

   The sibling of so-cost-editor.js and built the same way: a self-injecting overlay, so a host page
   needs no markup — it just loads the file. Opened from the Revenue & Net Profit report on both the
   Accounting and Admin dashboards; the note is then readable wherever that order appears to
   oversight.

   Saves through saveSONotes, which upserts into its own SONotes sheet. Deliberately NOT a column on
   SOCostDetails: a cost row does not exist for every order, and saveSOCostDetails rewrites a
   fixed-width array — so-cost-editor.js would post a record with no note and wipe it on the next
   cost edit.
   ═══════════════════════════════════════════════ */

let _sneSoNo = null;
let _sneOnSaved = null;
const SNE_MAX = 2000;   // a note, not a document — keeps the report table readable

function _snee(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

function _sneEl() {
  let el = document.getElementById('soNoteEditorModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'soNoteEditorModal';
  /* flow.css:49-50 makes .flow-modal-overlay display:none and only .open reveals it, so the
     class alone builds an invisible modal. */
  el.className = 'flow-modal-overlay open';
  el.innerHTML = `
    <div class="flow-modal" style="max-width:560px;">
      <h3>Note on this sales order</h3>
      <div class="sub" id="sneSub">—</div>
      <div style="margin-top:0.6rem;">
        <textarea id="sneText" rows="7" maxlength="${SNE_MAX}"
          style="width:100%;box-sizing:border-box;padding:0.55rem 0.65rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:0.86rem;font-family:inherit;resize:vertical;"
          placeholder="Anything the team should know about this order — a costing assumption, a client agreement, why a figure looks the way it does."></textarea>
        <div style="display:flex;gap:0.6rem;align-items:center;margin-top:0.3rem;">
          <span style="font-size:0.72rem;color:var(--text-muted,#64748b);" id="sneCount"></span>
          <span style="font-size:0.72rem;color:var(--text-muted,#64748b);margin-left:auto;" id="sneWho"></span>
        </div>
      </div>
      <div id="sneMsg" class="flow-msg" style="display:none;"></div>
      <div class="flow-modal-foot">
        <button type="button" class="btn btn-secondary" onclick="closeSoNoteEditor()">Cancel</button>
        <button type="button" class="btn btn-primary" id="sneSaveBtn" onclick="_sneSave()">Save note</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#sneText').addEventListener('input', _sneCount);
  return el;
}

function _sneCount() {
  const t = document.getElementById('sneText');
  const c = document.getElementById('sneCount');
  if (t && c) c.textContent = `${t.value.length} / ${SNE_MAX}`;
}

/**
 * openSoNoteEditor({ soNo, customer, date }, onSaved)
 * Fetches the current note fresh — the report's cached copy may be up to 60s stale, and overwriting
 * someone else's note with a stale value is the one failure mode that loses work here.
 */
async function openSoNoteEditor(ctx, onSaved) {
  ctx = ctx || {};
  if (!ctx.soNo) return;
  _sneSoNo = String(ctx.soNo);
  _sneOnSaved = typeof onSaved === 'function' ? onSaved : null;

  const el = _sneEl();
  el.classList.add('open');
  document.getElementById('sneSub').textContent =
    [ctx.soNo, ctx.customer, ctx.date].filter(Boolean).join(' · ');
  const box = document.getElementById('sneText');
  const who = document.getElementById('sneWho');
  const msg = document.getElementById('sneMsg');
  msg.style.display = 'none';
  box.value = ''; box.disabled = true; who.textContent = 'Loading…';

  try {
    const r = await fetchFlow('getSONotes', { soNo: _sneSoNo }, { fresh: true });
    const rec = ((r && r.data) || [])[0];
    box.value = (rec && rec.notes) || '';
    who.textContent = rec && rec.updatedBy
      ? `Last saved by ${rec.updatedBy}${rec.updatedAt ? ' · ' + rec.updatedAt : ''}` : 'No note yet';
  } catch (e) {
    // A backend that does not carry SONotes yet must not block writing one.
    box.value = '';
    who.textContent = 'No note yet';
  }
  box.disabled = false;
  _sneCount();
  box.focus();
}

function closeSoNoteEditor() {
  const el = document.getElementById('soNoteEditorModal');
  if (el) el.classList.remove('open');
  _sneSoNo = null;
}

async function _sneSave() {
  if (!_sneSoNo) return;
  const btn = document.getElementById('sneSaveBtn');
  const text = document.getElementById('sneText').value.trim();
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveSONotes', { soNo: _sneSoNo, notes: text });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not save the note.');
    const cb = _sneOnSaved;
    closeSoNoteEditor();
    if (cb) cb(res);
  } catch (e) {
    flowMsg('sneMsg', e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Save note';
  }
}
