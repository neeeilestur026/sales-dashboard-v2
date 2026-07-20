/* ═══════════════════════════════════════════════
   report-submit.js — the shared "Submit Daily Report" card for the sales, accounting and admin
   daily reports.

   The activity log says what the SYSTEM recorded; submitting says what the PERSON stands behind.
   The card therefore shows the frozen counters read-only (they are the system's numbers, not typed)
   and asks only for the narrative: highlights, blockers, tomorrow's plan.

   Usage — from each page's load(), never from its 60s poller:
     initReportSubmit({ user, role, date, mountId: 'submitSect', chipId: 'drSubmitChip',
                        getSnapshot: () => ({ entries, calls, emails, notes, metrics, amount }) })
     reportSubmitRefreshSnapshot()   // cheap; call after render()/loadEmails()/loadCalls()

   POLLER SAFETY (the requirement that would otherwise bite users daily): the refresh helper only
   rewrites individual <span>s. It must never touch mount.innerHTML — a repaint while someone is
   mid-sentence destroys focus and caret position. A dirty latch additionally protects typed text
   from a re-init of the same date.
   ═══════════════════════════════════════════════ */

const RS_MIN_VERSION = 81;                       // FlowAPI version that has submitDailyReport
const RS_DOC_ACTIONS = ['Created', 'Issued', 'Received', 'Added'];

let _rsOpts = null;
let _rsRecord = null;        // the day's existing submission, if any
let _rsDirty = false;        // true once the user types — protects against re-init overwrites
let _rsAvailable = null;     // null = unknown, true/false once the version gate resolves
let _rsBusy = false;

function _rsEsc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _rsNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _rsVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _rsSet(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

/** Derive the frozen counters from the page's raw state — one implementation, not three. */
function _rsSnapshot() {
  const raw = (_rsOpts && typeof _rsOpts.getSnapshot === 'function') ? (_rsOpts.getSnapshot() || {}) : {};
  const entries = raw.entries || [];
  const counts = {};
  entries.forEach(e => { const m = e.module || 'Other'; counts[m] = (counts[m] || 0) + 1; });
  return {
    movements: entries.length,
    calls: _rsNum(raw.calls),
    emails: _rsNum(raw.emails),
    docs: entries.filter(e => RS_DOC_ACTIONS.indexOf(e.action) >= 0).length,
    pdfs: entries.filter(e => e.action === 'PDF Saved').length,
    amount: _rsNum(raw.amount),
    counts: counts,
    metrics: raw.metrics || {},
    notes: raw.notes || '',
  };
}

function _rsTime(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Status line — rendered into both the card banner and the header chip. */
function _rsStatusHtml() {
  if (_rsAvailable === false) {
    return '<span style="color:var(--text-muted,#64748b);">Report submission becomes available after the next backend update.</span>';
  }
  if (!_rsRecord) {
    return '<span style="color:#b45309;font-weight:600;">● Not yet submitted</span>';
  }
  const n = _rsNum(_rsRecord.submitCount);
  const upd = n > 1 ? ` · updated ${n}×` : '';
  const rev = _rsRecord.reviewedBy
    ? ` · <span style="color:#0d9488;">reviewed by ${_rsEsc(_rsRecord.reviewedBy)}</span>`
    : '';
  return `<span style="color:#15803d;font-weight:600;">✓ Submitted ${_rsEsc(_rsTime(_rsRecord.submittedAt))}</span>` +
         `<span style="color:var(--text-muted,#64748b);">${upd}${rev}</span>`;
}

/** Snapshot chips — the numbers that will be recorded, straight from the system. */
function _rsChipsHtml() {
  const s = _rsSnapshot();
  const chip = (l, v) => `<span style="display:inline-flex;gap:0.3rem;align-items:baseline;padding:0.2rem 0.55rem;
    border-radius:999px;background:var(--bg-inset,#f1f5f9);font-size:0.75rem;">
    <b style="font-size:0.85rem;">${v}</b><span style="color:var(--text-muted,#64748b);">${l}</span></span>`;
  let out = chip('movements', s.movements) + chip('calls', s.calls) + chip('emails', s.emails) +
            chip('documents', s.docs) + chip('PDFs', s.pdfs);
  if (s.amount > 0 && typeof flowMoney === 'function') out += chip('invoiced', flowMoney(s.amount, 'PHP'));
  return out;
}

/** Surgical update — spans only. NEVER re-renders the mount (see the poller-safety note above). */
function reportSubmitRefreshSnapshot() {
  if (!_rsOpts) return;
  _rsSet('rsChips', _rsChipsHtml());
  _rsSet('rsStatus', _rsStatusHtml());
  const chip = document.getElementById(_rsOpts.chipId || 'drSubmitChip');
  if (chip) chip.innerHTML = _rsStatusHtml();
}

async function initReportSubmit(opts) {
  const mount = document.getElementById((opts && opts.mountId) || 'submitSect');
  if (!mount || !opts || !opts.user) return;
  const sameDay = _rsOpts && _rsOpts.date === opts.date;
  const keepTyped = sameDay && _rsDirty;             // don't clobber a half-written entry
  const typed = keepTyped
    ? { h: _rsVal('rsHighlights'), b: _rsVal('rsBlockers'), p: _rsVal('rsPlan') }
    : null;
  _rsOpts = opts;
  if (!sameDay) _rsDirty = false;

  if (_rsAvailable === null) {
    try { _rsAvailable = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(RS_MIN_VERSION) : false; }
    catch (e) { _rsAvailable = false; }
  }

  // Load any existing submission for this (user, date). An unknown action answers success:false —
  // never a throw — so check the flag rather than relying on catch.
  _rsRecord = null;
  if (_rsAvailable) {
    try {
      const r = await fetchFlow('getDailyReports', { date: opts.date, user: opts.user });
      if (r && r.success && r.data && r.data.length) _rsRecord = r.data[0];
    } catch (e) { /* leave unsubmitted */ }
  }

  const dis = _rsAvailable ? '' : ' disabled';
  mount.innerHTML = `
    <div class="dr-sect">
      <div class="dr-sect-title">Daily Report Submission
        <span class="pill" id="rsStatus" style="background:transparent;padding:0;margin-left:auto;">${_rsStatusHtml()}</span>
      </div>
      <div style="font-size:0.78rem;color:var(--text-muted,#64748b);margin-bottom:0.45rem;">
        These figures are recorded automatically from your activity — they are what management will see.
      </div>
      <div id="rsChips" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.8rem;">${_rsChipsHtml()}</div>
      <div class="no-print" style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
        <div><label style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">What did you accomplish today?</label>
          <textarea id="rsHighlights" class="notes-area" style="min-height:80px;" placeholder="Key wins, deals moved, work completed..."></textarea></div>
        <div><label style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Blockers / support needed</label>
          <textarea id="rsBlockers" class="notes-area" style="min-height:80px;" placeholder="Anything holding you back..."></textarea></div>
      </div>
      <div class="no-print" style="margin-top:0.55rem;">
        <label style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Plan for tomorrow</label>
        <input type="text" id="rsPlan" class="form-input" style="width:100%;" placeholder="Optional">
      </div>
      <div class="no-print" style="display:flex;align-items:center;gap:0.6rem;margin-top:0.7rem;">
        <button class="btn btn-primary btn-sm" id="rsSubmitBtn"${dis}>${_rsRecord ? 'Update Submission' : 'Submit Daily Report'}</button>
        <span id="rsMsg" style="font-size:0.75rem;color:var(--text-muted,#64748b);"></span>
      </div>
    </div>`;

  const h = document.getElementById('rsHighlights'), b = document.getElementById('rsBlockers'), p = document.getElementById('rsPlan');
  if (typed) { h.value = typed.h; b.value = typed.b; p.value = typed.p; }
  else if (_rsRecord) { h.value = _rsRecord.highlights || ''; b.value = _rsRecord.blockers || ''; p.value = _rsRecord.plan || ''; }
  [h, b, p].forEach(el => el.addEventListener('input', () => { _rsDirty = true; }));
  document.getElementById('rsSubmitBtn').addEventListener('click', _rsSubmit);
  reportSubmitRefreshSnapshot();
}

async function _rsSubmit() {
  if (!_rsOpts || _rsBusy) return;
  const btn = document.getElementById('rsSubmitBtn'), msg = document.getElementById('rsMsg');
  const s = _rsSnapshot();
  _rsBusy = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Submitting…';
  msg.textContent = '';
  try {
    const res = await postFlow('submitDailyReport', {
      date: _rsOpts.date, user: _rsOpts.user, role: _rsOpts.role || '',
      movements: s.movements, calls: s.calls, emails: s.emails, docs: s.docs, pdfs: s.pdfs,
      amount: s.amount, countsJson: JSON.stringify(s.counts), metricsJson: JSON.stringify(s.metrics),
      highlights: _rsVal('rsHighlights'), blockers: _rsVal('rsBlockers'), plan: _rsVal('rsPlan'),
      notes: s.notes,
      clientRef: 'RS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not submit.');
    _rsDirty = false;
    const r = await fetchFlow('getDailyReports', { date: _rsOpts.date, user: _rsOpts.user }, { fresh: true });
    _rsRecord = (r && r.success && r.data && r.data.length) ? r.data[0] : null;
    btn.textContent = 'Update Submission';
    msg.innerHTML = `<span style="color:#15803d;">${_rsEsc(res.message)}</span>`;
    reportSubmitRefreshSnapshot();
  } catch (e) {
    btn.textContent = label;
    msg.innerHTML = `<span style="color:#ef4444;">${_rsEsc(e.message)}</span>`;
  } finally {
    _rsBusy = false;
    btn.disabled = false;
  }
}
