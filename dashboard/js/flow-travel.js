/* A214 — Travel Allowance, the rep's page.
 *
 * A week of legs on the left, the real generated pack on the right, re-rendered as you type.
 *
 * The preview machinery is lifted from the Quote Configurator on purpose — same debounce, same
 * monotonic sequence, same AbortController, same never-blank busy state — because a rep who has used
 * one should not have to learn the other, and because those four guards were each added to fix a
 * real race there.
 *
 * ONE DELIBERATE DIFFERENCE: the configurator waits for a customer and a priced item before it
 * renders anything, since a quotation with no customer is not a document. A travel report with no
 * legs IS one — it is the blank form the rep is about to fill in — so this renders from page load and
 * the rep watches their first leg appear on page 2.
 */

let tvSession = null;
let tvOffset = -1;               // weeks relative to today; the report is filed for the week just gone
let tvRecord = null;
let tvLegs = [];
let tvSeqCounter = 0;
let tvReady = false;

/* Preview state — see the header note. */
let tvSeq = 0;
let tvAbort = null;
let tvTimer = null;
let tvLastUrl = '';
/* Receipts are stripped from previews, EXCEPT the first render after the set changes. A rep who
   attaches a photo and sees an empty slot concludes it did not work — the same reasoning as A178's
   qcPreviewPhotos, and cleared the same way: on a successfully PAINTED render, never in `finally`,
   so a render aborted by the next keystroke does not consume the one chance to show it. */
let tvPreviewReceipts = false;
let tvRcptTarget = null;
/* seq -> Doc ID, read back from Drive at load. The item row's Receipt Doc ID column is the same
   information, but this map is what the sweep acts on: it only ever holds ids this session actually
   SAW, so a failed read can never make the sweep delete something. */
let tvReceiptDocs = {};

const TV_DEBOUNCE = 500;
const TV_WAKE_AFTER = 4000;
const TV_MIN_FLOW_VERSION = 118;   // A214 — getTravelReceipts arrived with 118
const TV_KINDS = ['Transport', 'Meals', 'Load', 'Tips/Porterage', 'Parking/Toll', 'Other'];
/* The sum of every attached receipt, not each one. FLOW_DOC_MAX_MB caps a single file and nothing
   caps the total — but the 16MB limit is on the WHOLE request and base64 inflates by a third, so
   four large photos 413 before a byte reaches the generator. */
const TV_MAX_TOTAL_MB = 8;

document.addEventListener('DOMContentLoaded', async () => {
  tvSession = requireAuth();
  if (!tvSession) return;
  renderNavbar('flow-travel');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-travel.html');

  document.getElementById('tvPrev').addEventListener('click', () => { tvOffset--; tvLoad(); });
  document.getElementById('tvNext').addEventListener('click', () => { tvOffset++; tvLoad(); });
  document.getElementById('tvLast').addEventListener('click', () => { tvOffset = -1; tvLoad(); });
  document.getElementById('tvAdd').addEventListener('click', tvAddLeg);
  document.getElementById('tvSave').addEventListener('click', () => tvSave(false));
  document.getElementById('tvPrefill').addEventListener('click', tvPrefill);
  document.getElementById('tvRcptInput').addEventListener('change', tvReceiptChosen);
  ['tvPosition', 'tvFloat', 'tvPurpose'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', tvOnChange); el.addEventListener('change', tvOnChange); }
  });

  /* The backend is pasted by hand, so this page can be live before its actions exist. The PDF and
     the preview do NOT depend on it — they are pure server-side rendering — so the document still
     draws while saving is unavailable, and the banner says which half is missing. */
  tvReady = (typeof flowVersionAtLeast === 'function')
    ? await flowVersionAtLeast(TV_MIN_FLOW_VERSION) : false;
  if (!tvReady) {
    document.getElementById('tvGateCard').style.display = '';
    document.getElementById('tvGateMsg').innerHTML =
      '<b>Saving is not switched on yet.</b><br>The backend still has to be updated before a travel ' +
      'report can be stored. You can still build the document and see it below — nothing you type ' +
      'here is kept until that is done.';
    document.getElementById('tvSave').disabled = true;
    document.getElementById('tvPrefill').disabled = true;
  }
  await tvLoad();
});

function tvWeek() {
  return (typeof flowWeekDates === 'function') ? flowWeekDates(flowToday(), tvOffset) : [];
}
function tvWho() { return String((tvSession && tvSession.name) || ''); }
function tvNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

async function tvLoad() {
  const wk = tvWeek();
  const el = document.getElementById('tvRange');
  if (el) el.textContent = wk.length ? (wk[0] + '  –  ' + wk[6]) : '—';

  tvRecord = null;
  tvLegs = [];
  tvSeqCounter = 0;
  tvReceiptDocs = {};
  if (tvReady && wk.length) {
    try {
      const res = await postFlow('getTravelReplenishments', { weekStart: wk[0] });
      const rows = (res && res.data) || [];
      tvRecord = rows.filter(r => String(r.weekStart) === wk[0])[0] || null;
    } catch (e) { /* a page that cannot read still has to let the rep type */ }
  }
  if (tvRecord) {
    tvLegs = (tvRecord.items || []).map(i => ({
      seq: i.seq, date: i.date, kind: i.kind || 'Transport', description: i.description,
      departureTime: i.departureTime, arrivalTime: i.arrivalTime, means: i.means,
      amount: i.amount, hasReceipt: !!i.hasReceipt, receiptDocId: i.receiptDocId || '',
      dataUrl: ''
    }));
    tvSeqCounter = tvLegs.reduce((m, l) => Math.max(m, tvNum(l.seq)), 0);
    document.getElementById('tvPosition').value = tvRecord.position || '';
    document.getElementById('tvPurpose').value = tvRecord.purpose || '';
    document.getElementById('tvFloat').value = tvRecord.floatAmount || '';
    await tvLoadReceipts();
  }
  tvChip();
  tvRenderLegs();
  tvSchedulePreview();
}

/* A214 — the photographs, as BYTES. getDocuments would be one call cheaper and would hand back a
   Drive link, which serves HTML and renders as a broken image — the dead end getVisitPhotos records.
   A report still has to open when this fails, so every path here is swallowed: the rep sees "attach"
   on a leg whose photo could not be read, which is honest and recoverable. */
async function tvLoadReceipts() {
  if (!tvReady || !tvRecord || !tvRecord.travNo) return;
  let rows = [];
  try {
    const rp = await postFlow('getTravelReceipts', { travNo: tvRecord.travNo });
    rows = (rp && rp.data) || [];
  } catch (e) { return; }

  let painted = false;
  rows.forEach(r => {
    const seq = tvNum(r.seq);
    if (!seq) return;                                   // unattributable — leave it for the sweep
    const l = tvLegs.filter(x => tvNum(x.seq) === seq)[0];
    tvReceiptDocs[seq] = r.docId;
    if (r.missing) {
      /* The Documents row survives but the file behind it does not. Clear the leg so the rep is
         asked for it again, and leave the id in the map so the next save clears the dead row. */
      if (l) { l.dataUrl = ''; l.receiptDocId = ''; l.hasReceipt = false; }
      return;
    }
    if (!l || !r.base64) return;
    l.dataUrl = 'data:' + (r.mimeType || 'image/jpeg') + ';base64,' + r.base64;
    l.receiptDocId = r.docId;
    l.rcptDirty = false;
    painted = true;
  });
  // The first preview of a reopened week should show its photographs, not their placeholders.
  if (painted) tvPreviewReceipts = true;
}

function tvChip() {
  const c = document.getElementById('tvStatus');
  const st = (tvRecord && tvRecord.status) || 'Draft';
  c.textContent = st;
  c.className = 'tv-chip ' + (st === 'Approved' ? 'approved'
    : st === 'Rejected' ? 'rejected' : st.indexOf('Pending') === 0 ? 'pending' : 'draft');
  const locked = !!(tvRecord && ['Draft', 'Rejected', ''].indexOf(st) < 0);
  ['tvAdd', 'tvSave', 'tvPrefill'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = locked || !tvReady;
  });
}

function tvEditable() {
  const st = (tvRecord && tvRecord.status) || 'Draft';
  return ['Draft', 'Rejected', ''].indexOf(st) >= 0;
}

function tvRenderLegs() {
  const body = document.getElementById('tvLegBody');
  const wk = tvWeek();
  const dis = tvEditable() ? '' : ' disabled';
  body.innerHTML = tvLegs.map((l, i) => `
    <tr data-i="${i}">
      <td><input type="date" data-f="date" value="${flowEsc(l.date || '')}"
                 min="${flowEsc(wk[0] || '')}" max="${flowEsc(wk[6] || '')}"${dis}></td>
      <td><input data-f="description" value="${flowEsc(l.description || '')}" placeholder="Residence to Terminal"${dis}></td>
      <td><input data-f="departureTime" value="${flowEsc(l.departureTime || '')}" placeholder="7:30 AM"${dis}></td>
      <td><input data-f="arrivalTime" value="${flowEsc(l.arrivalTime || '')}" placeholder="7:40 AM"${dis}></td>
      <td><input data-f="means" value="${flowEsc(l.means || '')}" placeholder="Tricycle"${dis}></td>
      <td class="num"><input data-f="amount" type="number" step="0.01" value="${l.amount || ''}"${dis}></td>
      <td><button class="btn btn-sm tv-rcpt${l.dataUrl || l.receiptDocId ? ' on' : ''}"
                  onclick="tvPickReceipt(${i})"${dis}>${l.dataUrl || l.receiptDocId ? '✓ photo' : 'attach'}</button></td>
      <td><button class="tv-del" onclick="tvDelLeg(${i})" title="Remove"${dis}>&times;</button></td>
    </tr>`).join('') ||
    '<tr><td colspan="8" style="padding:1rem;color:var(--text-muted,#64748b);font-size:.85rem;">' +
    'No legs yet — add one, or fill them in from the visits you logged this week.</td></tr>';

  body.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', ev => {
      const tr = ev.target.closest('tr');
      const l = tvLegs[Number(tr.getAttribute('data-i'))];
      if (!l) return;
      const f = ev.target.getAttribute('data-f');
      l[f] = (f === 'amount') ? tvNum(ev.target.value) : ev.target.value;
      tvOnChange();
    });
  });
  tvRenderTotals();
}

/* The same three projections the backend and the PDF compute, so the rep sees now what the approver
   will see later. THE TWO PAGE SUBTOTALS ARE NEVER ADDED: a tricycle is a trip AND has no receipt. */
function tvRenderTotals() {
  const t = tvLegs.reduce((s, l) => s + tvNum(l.amount), 0);
  const trans = tvLegs.filter(l => (l.kind || 'Transport') === 'Transport')
    .reduce((s, l) => s + tvNum(l.amount), 0);
  const noR = tvLegs.filter(l => !(l.dataUrl || l.receiptDocId))
    .reduce((s, l) => s + tvNum(l.amount), 0);
  const flt = tvNum(document.getElementById('tvFloat').value);
  const rem = Math.max(0, flt - t), adv = Math.max(0, t - flt);
  const m = v => flowMoney(v, 'PHP');
  document.getElementById('tvTotals').innerHTML =
    `<div class="row"><span>On the itinerary page (trips)</span><span class="v">${m(trans)}</span></div>
     <div class="row"><span>On the certification page (no receipt)</span><span class="v">${m(noR)}</span></div>
     <div class="row grand"><span>Total spent — what you are claiming</span><span class="v">${m(t)}</span></div>
     <div class="row"><span>Float held</span><span class="v">${m(flt)}</span></div>
     <div class="row${adv ? ' over' : ''}"><span>${adv ? 'You advanced' : 'Remaining in your float'}</span>
       <span class="v">${m(adv || rem)}</span></div>`;
}

function tvAddLeg() {
  if (!tvEditable()) return;
  const wk = tvWeek();
  tvLegs.push({ seq: ++tvSeqCounter, date: wk[0] || '', kind: 'Transport', description: '',
                departureTime: '', arrivalTime: '', means: '', amount: 0,
                hasReceipt: false, receiptDocId: '', dataUrl: '' });
  tvRenderLegs();
  tvOnChange();
}

function tvDelLeg(i) {
  if (!tvEditable()) return;
  tvLegs.splice(i, 1);
  tvRenderLegs();
  tvPreviewReceipts = true;          // the receipt set changed with it
  tvOnChange();
}

/* Prefill is a SKELETON and the copy says so. ClientVisits carries no departure time, no transport
   and no fare, so one visit yields one stop — not the four to eight hops a real trip has. A rep who
   trusts it files an itinerary that ends at the client's door with no way home. */
async function tvPrefill() {
  const wk = tvWeek();
  if (!wk.length) return;
  try {
    const res = await fetchFlow('getClientVisits', { user: tvWho() }, { fresh: true });
    const mine = ((res && res.data) || []).filter(v => wk.indexOf(String(v.date).slice(0, 10)) >= 0);
    if (!mine.length) { flowMsg('tvMsg', 'No client visits logged for this week yet.', false); return; }
    mine.forEach(v => {
      tvLegs.push({ seq: ++tvSeqCounter, date: String(v.date).slice(0, 10), kind: 'Transport',
        description: 'to ' + [v.company, v.cityAddress].filter(Boolean).join(', '),
        departureTime: '', arrivalTime: v.time || '', means: '', amount: 0,
        hasReceipt: false, receiptDocId: '', dataUrl: '' });
    });
    tvRenderLegs();
    tvOnChange();
    flowMsg('tvMsg', 'Added a stop for each visit you logged — fill in the legs and fares around ' +
      'them, including the journey home.', true);
  } catch (e) { flowMsg('tvMsg', e.message, false); }
}

function tvPickReceipt(i) {
  if (!tvEditable()) return;
  tvRcptTarget = i;
  document.getElementById('tvRcptInput').value = '';
  document.getElementById('tvRcptInput').click();
}

async function tvReceiptChosen(ev) {
  const file = ev.target.files && ev.target.files[0];
  const l = tvLegs[tvRcptTarget];
  if (!file || !l) return;
  const maxMb = (typeof FLOW_DOC_MAX_MB !== 'undefined') ? FLOW_DOC_MAX_MB : 10;
  if (file.size > maxMb * 1024 * 1024) {
    flowMsg('tvMsg', 'That photo is over ' + maxMb + 'MB — retake it at a lower resolution.', false);
    return;
  }
  try {
    /* 1400px, not the configurator's 900: a receipt is READ at half a page in the annex, where 900
       is legible as a thumbnail but not as a document. */
    l.dataUrl = await flowDownscaleImage(file, 1400, 0.72);
    l.hasReceipt = true;
    l.rcptDirty = true;          // only a dirty leg is re-uploaded; a read-back one is left alone
    const total = tvLegs.reduce((s, x) => s + (x.dataUrl ? x.dataUrl.length : 0), 0);
    if (total > TV_MAX_TOTAL_MB * 1024 * 1024) {
      l.dataUrl = ''; l.hasReceipt = false; l.rcptDirty = false;
      flowMsg('tvMsg', 'Those receipts come to more than ' + TV_MAX_TOTAL_MB + 'MB together, which ' +
        'the server will refuse. Remove one before adding this.', false);
      tvRenderLegs();
      return;
    }
    tvPreviewReceipts = true;
    tvRenderLegs();
    tvOnChange();
  } catch (e) { flowMsg('tvMsg', 'Could not read that image.', false); }
}

function tvPayload(withReceipts) {
  const wk = tvWeek();
  return {
    travNo: (tvRecord && tvRecord.travNo) || '',
    date: flowToday(),
    weekStart: wk[0] || '', weekEnd: wk[6] || '',
    user: tvWho(),
    position: document.getElementById('tvPosition').value || '',
    purpose: document.getElementById('tvPurpose').value || '',
    durationLabel: (tvRecord && tvRecord.durationLabel) || '',
    floatAmount: tvNum(document.getElementById('tvFloat').value),
    status: (tvRecord && tvRecord.status) || '',
    acctApprovedBy: (tvRecord && tvRecord.acctApprovedBy) || '',
    dirApprovedBy: (tvRecord && tvRecord.dirApprovedBy) || '',
    overspendReason: (tvRecord && tvRecord.overspendReason) || '',
    items: tvLegs.map(l => ({
      seq: l.seq, date: l.date, kind: l.kind || 'Transport', description: l.description,
      departureTime: l.departureTime, arrivalTime: l.arrivalTime, means: l.means,
      amount: tvNum(l.amount), hasReceipt: !!(l.dataUrl || l.receiptDocId),
      receiptDocId: l.receiptDocId || ''
    })),
    /* The seq always goes; the BYTES only on the one render after the set changed. That keeps the
       annex's page count honest in every preview while sending megabytes almost never. */
    receipts: tvLegs.filter(l => l.dataUrl || l.receiptDocId)
      .map(l => ({ seq: l.seq, dataUrl: withReceipts ? (l.dataUrl || '') : '' }))
  };
}

function tvOnChange() { tvRenderTotals(); tvSchedulePreview(); }
function tvSchedulePreview() { clearTimeout(tvTimer); tvTimer = setTimeout(tvRenderPreview, TV_DEBOUNCE); }
function tvState(text, kind) {
  document.getElementById('tvState').textContent = text;
  document.getElementById('tvDot').className = 'tv-dot' + (kind ? ' ' + kind : '');
}

async function tvRenderPreview() {
  const seq = ++tvSeq;
  if (tvAbort) { try { tvAbort.abort(); } catch (e) {} }
  tvAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

  const wrap = document.getElementById('tvFrameWrap');
  wrap.classList.add('busy');
  tvState('rendering…', 'busy');

  const wake = setTimeout(() => {
    if (seq === tvSeq && !document.getElementById('tvWake')) {
      const n = document.createElement('div');
      n.className = 'tv-wake'; n.id = 'tvWake';
      n.textContent = 'waking the server — the first render after a quiet spell takes a moment';
      wrap.appendChild(n);
    }
  }, TV_WAKE_AFTER);

  const withReceipts = tvPreviewReceipts;
  try {
    const res = await fetch('/flow/travel-allowance-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tvPayload(withReceipts)),
      signal: tvAbort ? tvAbort.signal : undefined
    });
    if (seq !== tvSeq) return;                    // a newer edit went out — discard this one
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (e) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (seq !== tvSeq) return;
    const url = URL.createObjectURL(blob);
    document.getElementById('tvFrame').src = url;
    if (tvLastUrl) URL.revokeObjectURL(tvLastUrl);   // never the one on screen
    tvLastUrl = url;
    document.getElementById('tvEmpty').style.display = 'none';
    if (withReceipts) tvPreviewReceipts = false;     // it actually reached the pane — one shot spent
    tvState('up to date', '');
  } catch (e) {
    if (e && e.name === 'AbortError') return;        // superseded, not a failure
    if (seq !== tvSeq) return;
    tvState('preview failed — ' + (e.message || 'unknown'), 'err');
  } finally {
    clearTimeout(wake);
    const w = document.getElementById('tvWake'); if (w) w.remove();
    if (seq === tvSeq) wrap.classList.remove('busy');
  }
}

function tvWriteRecord(wk) {
  return postFlow('saveTravelReplenishment', {
    weekStart: wk[0],
    position: document.getElementById('tvPosition').value || '',
    purpose: document.getElementById('tvPurpose').value || '',
    items: JSON.stringify(tvLegs.map(l => ({
      seq: l.seq, date: l.date, kind: l.kind || 'Transport', description: l.description,
      departureTime: l.departureTime, arrivalTime: l.arrivalTime, means: l.means,
      amount: tvNum(l.amount), hasReceipt: !!(l.dataUrl || l.receiptDocId),
      receiptDocId: l.receiptDocId || ''
    })))
  });
}

async function tvSave(quiet) {
  if (!tvReady || !tvEditable()) return;
  const wk = tvWeek();
  try {
    const res = await tvWriteRecord(wk);
    if (!res.success) throw new Error(res.message);

    /* The photographs are filed AFTER the record, so a Drive hiccup can never cost the rep what they
       typed — the A178 ordering. A failure here is reported, not thrown: the week is already saved. */
    const warn = await tvSyncReceipts(res.travNo);

    /* The Doc IDs only exist once the upload has happened, so the column is written back in a second
       pass. It is an optimisation either way — getTravelReceipts reads the FILE NAME — which is
       exactly why this pass is allowed to fail quietly. */
    let rewrite = false;
    tvLegs.forEach(l => {
      const id = tvReceiptDocs[tvNum(l.seq)] || '';
      if (String(l.receiptDocId || '') !== String(id)) { l.receiptDocId = id; rewrite = true; }
      l.rcptDirty = false;
    });
    if (rewrite) { try { await tvWriteRecord(wk); } catch (e) {} }

    if (!quiet) flowMsg('tvMsg', res.message + (warn ? ' — ' + warn : ''), !warn);
    await tvLoad();
  } catch (e) { flowMsg('tvMsg', e.message, false); }
}

/* A214 — keep Drive in step with the legs.
   Keyed on the leg SEQ through the file name receipt-<seq>.jpg, which is what getTravelReceipts
   parses back out. Idempotent by construction: a photo read back from Drive and not touched this
   session is neither dirty nor unseen, so a save with no photo changes performs zero Drive writes. */
async function tvSyncReceipts(travNo) {
  if (!travNo) return '';
  let warn = '';
  const seen = {};
  const jobs = [];

  tvLegs.forEach(l => {
    const seq = tvNum(l.seq);
    if (!seq) return;                       // an unnumbered leg has nothing to file the photo under
    if (!l.dataUrl && !l.receiptDocId) return;
    seen[seq] = true;
    if (l.dataUrl && l.rcptDirty) jobs.push({ put: seq, dataUrl: l.dataUrl, old: tvReceiptDocs[seq] });
  });

  /* A leg whose photo was replaced, or that was deleted outright, would otherwise leave its file on
     Drive forever with nothing able to reach it. This is the only branch here that deletes anything,
     and it can only ever act on ids THIS session read back — see tvReceiptDocs. */
  Object.keys(tvReceiptDocs).forEach(k => {
    if (!seen[k]) jobs.push({ del: k, old: tvReceiptDocs[k] });
  });
  if (!jobs.length) return '';

  for (let n = 0; n < jobs.length; n++) {
    const j = jobs[n];
    try {
      if (j.put) {
        const mime = (String(j.dataUrl).match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
        const b64 = String(j.dataUrl).split(',')[1] || '';
        const r = await postFlow('addDocument', {
          module: 'Travel Replenishment', refNo: travNo, docType: 'Travel Receipt',
          fileName: 'receipt-' + j.put + '.' + (mime === 'image/png' ? 'png' : 'jpg'),
          fileBase64: b64, mimeType: mime
        });
        if (!r || !r.success) { warn = 'a receipt photo could not be filed'; continue; }
        tvReceiptDocs[j.put] = r.docId;
        // Add first, delete second — never the reverse. The worst case is a duplicate, which
        // getTravelReceipts collapses to the newest and the next save sweeps.
        if (j.old) await postFlow('deleteDocument', { docId: j.old });
      } else {
        await postFlow('deleteDocument', { docId: j.old });
        delete tvReceiptDocs[j.del];
      }
    } catch (e) { warn = 'a receipt photo could not be filed'; }
  }
  return warn;
}
