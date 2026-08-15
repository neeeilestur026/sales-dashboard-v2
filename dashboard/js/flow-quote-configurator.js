/* flow-quote-configurator.js — A172/A173 Quote Configurator.
 *
 * The preview on the right is the REAL PDF from /flow/quotation-pdf, not an HTML lookalike.
 * A replica would mean two independent layout engines — ReportLab measuring flowables in points and a
 * browser measuring CSS — and they do not agree about where a page ends. The preview would then be
 * confidently wrong about the orphaned signature block it exists to catch. Rendering the real
 * document costs a round trip; the totals update instantly in JS so the page still feels live.
 *
 * TWO MODES:
 *   free    — the rep builds the lines (director/admin). Items are editable.
 *   fromPR  — ?fromPR=<prNo>, the process-flow path. Lines come from the purchase request at
 *             management's Final Price and are DISPLAY-ONLY, because createQuotationFromPR rebuilds
 *             every line server-side from PricingRequestItems and ignores whatever the browser sends.
 *             Editable fields there would silently discard the rep's work.
 */

let qcSession = null;
let qcRole = '';
let qcRecommended = '';        // A205 — which option the stored total is built from
/* A205 — alternative offers stay INERT until the whole chain supports them: FlowAPI.gs v111 for the
   Option No column, and a PDF generator that renders options as alternatives. Ungated, a user could
   tag two options and get a document that quietly SUMS them — the exact overstatement this feature
   exists to prevent, shipped as a feature. Off means the column is hidden and every line is an
   ordinary charged item: precisely today's behaviour. */
let qcOptionsEnabled = false;
let qcItems = [];                 // [{ lineKey, itemNo, itemName, qty, price, uom, origItemNo, origItemName, itemId, vat, imageDataUrl }]
let qcSeq = 0;                    // monotonic — a slow response from an older edit must never win
let qcAbort = null;
let qcTimer = null;
let qcLastUrl = '';
let qcPhotoTarget = '';
let qcQuotationNo = '';           // set once saved, so a second Finalize updates instead of duplicating
/* A241 — which document design this record renders in. A quotation that predates the redesign keeps
   design 1 until someone edits it, so a client's copy never silently restyles itself; a new one, and
   any record saved from here, is design 2. Read from layoutJson.v on load, stamped by qcLayoutJson()
   on save. */
let qcDesignVersion = 2;

/* A242 — WHICH DESIGN THE LIVE PREVIEW RENDERS AT, and why it is not simply qcDesignVersion.
 *
 * Reported as "the group feature doesn't work": a rep opened an existing quotation, typed a Group on
 * a line, and the preview showed no band. Nothing was broken — the record predated A241, so
 * qcDesignVersion loaded as 1, and design 1 has no bands at all. But qcLayoutJson() stamps v:2 on
 * EVERY save, so the moment they pressed Finalize the document would have banded. The preview was
 * showing a design the save was never going to produce.
 *
 * So the rule is: preview what the save will write.
 *   • 'document' mode regenerates a PDF that has already gone out and must reproduce it faithfully
 *     (qcRegenerateOnly), so it keeps the version the record was stored at.
 *   • 'edit' mode always saves v:2, so it always previews 2.
 */
function qcPreviewDesign() {
  return (qcMode === 'document') ? qcDesignVersion : 2;
}
let qcFromPr = '';                // the process-flow path
let qcLocked = false;             // items display-only (fromPR, and A176 document mode)
/* A242 — line selection on the fromPR path. `qcPartial` says the rows carry PR-line state; the
   CHECKBOXES only appear once the backend is known to understand a `lines` parameter, because an
   older one ignores it and quotes everything — a rep would tick 3 and send 5 to a client. Set async
   below; until it resolves the column stays hidden and the save sends no selection, which is exactly
   the old behaviour. */
let qcPartial = false;
let qcPartialUI = false;
/* THE LINES THIS QUOTATION WILL ACTUALLY CARRY. One definition, read by the total, the live preview
   and the layout blob alike — if any of them disagreed, the rep would approve a figure the document
   does not show. Off the fromPR path it is simply every row, which is what it has always been. */
function qcQuotedItems() {
  return (qcPartial && qcPartialUI) ? qcItems.filter(i => !i.prTaken && i.qtSel) : qcItems;
}
if (typeof flowVersionAtLeast === 'function') {
  flowVersionAtLeast(136).then(v => {
    qcPartialUI = !!v;
    if (qcPartialUI && qcPartial && typeof qcRenderItems === 'function') qcRenderItems();
  }).catch(() => { qcPartialUI = false; });
}
let qcInventory = [];             // for the admin free-type datalist
/* A178 — item photos. `qcPhotoDocs` is what Drive already holds (lineKey -> docId) and `qcPhotoDirty`
   is what changed in THIS session; together they are the idempotence rule — stored and not dirty means
   the save skips it, so an unedited regenerate issues no writes at all. `qcPhotoFailed` is the safety
   catch: if the read-back could not run we must REFUSE to file, because the new PDF would silently
   replace a good one with a photo-less copy. */
let qcPhotoDocs = {};
let qcPhotoDirty = {};
let qcPhotoLoad = null;           // the in-flight read-back — every save awaits it first
let qcPhotoFailed = false;
let qcPreviewPhotos = false;      // include images in the NEXT completed preview render, once
/* A176 — one surface, two modes:
     'edit'     the record is Draft/Rejected and the viewer may change it. Finalize writes the
                record (updateQuotation / createQuotation) AND files the PDF.
     'document' anything else. The money is locked to the record and the button only re-renders and
                re-files the PDF — it never calls updateQuotation, so the A119 status gate is never
                hit and ANY role can refresh the document at ANY status. That is what keeps the A123
                approve-gate escapable: an approver facing a stale/unverified PDF has no Edit and
                could not use one anyway. */
let qcMode = 'edit';

const QC_VAT_PCT = 0.12;
const QC_DEBOUNCE = 500;
const QC_WAKE_AFTER = 4000;       // Render's free tier sleeps; say so rather than spin silently

/* A175 — this module no longer owns a page of its own: it is the create half of flow-quotations.html.
   It therefore has NO DOMContentLoaded handler, no auth guard and no navbar call — the host page does
   the auth check once and calls qcInit() from inside its own boot, AFTER the history has rendered, so
   a fault in here can never stop the quotation list from loading. */
function qcInit(opts) {
  qcSession = (opts && opts.session) || null;
  if (!qcSession) {
    try { qcSession = JSON.parse(localStorage.getItem('session') || '{}'); } catch (e) { qcSession = {}; }
  }
  qcRole = qcSession.role || '';

  const d = document.getElementById('qcDate');
  if (d) d.value = (typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10);

  qcPrefillDoc();
  qcBindInputs();
  const photo = document.getElementById('qcPhotoInput');
  if (photo) photo.addEventListener('change', qcPhotoChosen);

  qcAddRow();
  if (qcRole === 'admin' || qcRole === 'director') qcLoadInventory();
  qcRenderTotals();
}

/* Show/hide the create half. Collapsed on a plain visit so the history is the landing view; opened by
   the New Quotation buttons, by ?fromPR=, and by Edit/Revise. */
function qcToggleCreate(open) {
  const sec = document.getElementById('qcCreate');
  if (!sec) return false;
  const show = (open === undefined) ? sec.hasAttribute('hidden') : !!open;
  if (show) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', '');
  const btn = document.getElementById('qcToggleBtn');
  if (btn) btn.textContent = show ? '▲ Hide' : '+ New Quotation';
  if (show) {
    qcRenderItems();            // re-measure now that the section is laid out
    qcSchedulePreview();
    try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* older browsers */ }
  }
  return show;
}

/* Clear the builder back to a blank quotation (leaves the remembered doc defaults in place). */
function qcResetForm() {
  qcQuotationNo = '';
  qcDesignVersion = 2;          // A241 — a brand-new quotation is born on the new design
  qcFromPr = '';
  qcLocked = false;
  qcMode = 'edit';
  qcItems = [];
  qcPhotoDocs = {}; qcPhotoDirty = {}; qcPhotoLoad = null; qcPhotoFailed = false; qcPreviewPhotos = false;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('qcNo', ''); set('qcCustomer', ''); set('qcSubject', ''); set('qcDiscount', 0);
  set('qcDate', (typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10));
  set('qcNote', ''); set('qcPlantSite', '');
  qcFillSalespeople();
  /* A178 — these three selects are RESTORED by qcLoadExisting but were never reset, so they leaked
     into the next quotation: after viewing one saved with photos off, every later save silently
     blanked its images. qcVat leaking matters most — it is inside the A123 freshness stamp, so the
     wrong VAT option would be stamped onto a brand-new quotation. Safe here because qcLoadExisting
     resets FIRST and restores afterwards. */
  set('qcPhotos', 'on'); set('qcVat', 'inclusive'); set('qcDescMode', 'long');
  const br = document.getElementById('qcBrochures'); if (br) br.value = '';
  const msg = document.getElementById('qcMsg'); if (msg) msg.innerHTML = '';
  const title = document.getElementById('formTitle'); if (title) title.textContent = 'New Quotation';
  const btn = document.getElementById('qcFinalizeBtn'); if (btn) btn.disabled = false;
  qcSyncLock();
  qcAddRow();                   // renders + reschedules the preview
}

/* Start a brand-new quotation: clear whatever was loaded, then open the builder. */
function qcNewQuotation() {
  qcResetForm();
  qcToggleCreate(true);
}

/* A176 — the single opener the history row uses, for both jobs.
   mode 'edit'     → change the quotation (Draft/Rejected, sales/admin).
   mode 'document' → regenerate/refile its PDF only, at any status, for any role. */
function qcOpen(no, mode, record) {
  const q = record || (typeof qList !== 'undefined'
    ? qList.find(x => String(x.quotationNo) === String(no)) : null);
  if (!q) { alert('Quotation ' + no + ' is not in the list — hit Refresh and try again.'); return; }
  qcMode = (mode === 'document') ? 'document' : 'edit';
  qcToggleCreate(true);
  qcLoadExisting(q);
}

/* Lock/unlock the commercial half. In document mode the figures MUST match the record — a document
   that disagrees with its own record is exactly what A123 flags as out of date, and on a Pending
   quotation that blocks its own approval. Prices change through Edit/Revise, which re-enter approval. */
function qcSyncLock() {
  const lockMoney = (qcMode === 'document');   // NOT qcLocked — ?fromPR locks only the item rows
  ['qcNo', 'qcDate', 'qcCustomer', 'qcDiscount', 'qcVat'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = lockMoney;
    el.title = lockMoney ? 'Locked to the saved quotation — use Edit or Revise to change the figures.' : '';
  });
  const btn = document.getElementById('qcFinalizeBtn');
  if (btn) {
    btn.textContent = (qcMode === 'document') ? 'Regenerate & file PDF' : 'Finalize quotation';
    /* A178 — refuse rather than destroy. If the archived photos could not be read back, filing now
       would replace a good document with a photo-less copy, and the rep would have no way to tell. */
    if (qcPhotoFailed) {
      btn.disabled = true;
      btn.title = 'The saved product photos could not be read back — filing now would produce a '
                + 'document without them. Reload the page and reopen this quotation.';
    } else if (btn.title && btn.title.indexOf('product photos') === 0) {
      btn.title = '';
    }
  }
  const hint = document.getElementById('qcModeHint');
  if (hint) hint.style.display = (qcMode === 'document') ? '' : 'none';
}

/* Edit/Revise from the history: load a saved quotation into the builder so the same surface that
   creates a document also revises it. Finalize then routes through updateQuotation. */
function qcLoadExisting(q) {
  if (!q) return;
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const dt = (typeof flowDate === 'function') ? flowDate : (v => String(v || '').slice(0, 10));
  const mode = qcMode;            // qcResetForm clears it — the caller's choice must survive the wipe
  qcResetForm();
  qcMode = mode;
  qcQuotationNo = String(q.quotationNo || '');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); };
  set('qcNo', q.quotationNo);
  set('qcDate', dt(q.date));
  set('qcCustomer', q.customer);
  set('qcSubject', q.subject);
  set('qcDiscount', num(q.discountPct) || 0);

  // Layout JSON (A172) — restore the template, photo switch and the three summary blocks.
  let lay = {}; try { lay = q.layoutJson ? (JSON.parse(q.layoutJson) || {}) : {}; } catch (e) { lay = {}; }
  qcDesignVersion = Number(lay.v) || 1;   // A241 — absent means this record predates the redesign
  if (lay.photos === false) set('qcPhotos', 'off');
  const blocks = lay.blocks || {};
  [['qcBlkScope', 'scope', 'qcScope'], ['qcBlkExcl', 'exclusions', 'qcExclusions'],
   ['qcBlkOpts', 'options', 'qcOptions']].forEach(([cb, key, ta]) => {
    const on = !!(blocks[key] || lay[key]);
    const c = document.getElementById(cb); if (c) c.checked = on;
    if (lay[key]) set(ta, lay[key]);
  });
  qcSyncBlocks();

  // Document fields from the record's last PDF stamp, so regenerating reproduces the same document.
  let prev = {}; try { prev = q.pdfData ? (JSON.parse(q.pdfData) || {}) : {}; } catch (e) { prev = {}; }
  if (prev.doc) {
    [['address', 'qcAddress'], ['attention', 'qcAttention'], ['designation', 'qcDesignation'],
     ['email', 'qcEmail'], ['rfqNo', 'qcRfq'], ['validity', 'qcValidity'], ['delivery', 'qcDelivery'],
     ['payment', 'qcPayment'], ['warranty', 'qcWarranty'], ['sigName', 'qcSigName'],
     ['sigDesignation', 'qcSigDesignation'], ['sigViber', 'qcSigViber'], ['sigMobile', 'qcSigMobile'],
     ['sigEmail', 'qcSigEmail'], ['note', 'qcNote'], ['plantSite', 'qcPlantSite']]
      .forEach(([k, id]) => { if (prev.doc[k]) set(id, prev.doc[k]); });
    if (prev.vatOption) set('qcVat', prev.vatOption);
    if (prev.descMode) set('qcDescMode', prev.descMode);
  }
  if (!document.getElementById('qcRfq').value && q.clientRefNo) set('qcRfq', q.clientRefNo);
  /* A178 — plant site precedence: the last filed document wins, then the stored column. The document
     is what the client received, and it is the only one of the two that an edit here can update
     (updateQuotation does not write the Plant Site column), so preferring the column would silently
     revert a rep's correction the next time they opened the quotation. */
  if (!document.getElementById('qcPlantSite').value && q.plantSite) set('qcPlantSite', q.plantSite);
  // A218 — show whose deal it is. `salesperson` is resolved server-side (the column, then the
  // initials in the number, then the creator), so a legacy quotation already reads correctly.
  qcFillSalespeople(q.salesperson || q.createdBy || '');

  qcItems = (q.items || []).map(it => ({
    lineKey: it.lineKey || qcLineKey(),
    itemNo: it.itemNo || 'N/A', itemName: it.itemName || it.itemNo || '',
    qty: num(it.qty), price: num(it.price), uom: it.uom || '',
    origItemNo: it.origItemNo || '', origItemName: it.origItemName || '',
    itemId: it.itemId || '', vat: it.vat || '', imageDataUrl: '',
    optionNo: String(it.optionNo || '').trim(),            // A205
    scope: ''                                              // A235 — filled from layoutJson just below
  }));
  /* A235 — put each item's scope of supply back on its line. It is NOT in `q.items`: QuotationItems
     has no scope column and deliberately never will (adding one is the width trap that has bitten
     this codebase five times, and no total, sales order or commission reads scope). It lives in the
     Layout JSON blob the configurator already round-trips, keyed by Line Key. */
  const qcScopeStore = Array.isArray(lay.itemScopes) ? lay.itemScopes : [];
  if (qcScopeStore.length) {
    // A240 — the WHOLE entry is carried now (scope, blocks, hidden flag), not just the scope string,
    // so the three travel together through both the identity path and the positional fallback below.
    const byKey = {};
    qcScopeStore.forEach(e => { if (e && e.k) byKey[String(e.k)] = e; });
    /* Positional fallback, and only under two conditions at once. createQuotationFromPR rebuilds every
       line server-side from PricingRequestItems and assigns NEW Line Keys, so the keys stored on that
       first save match nothing and identity alone would drop the scope the rep had already typed.
       Requiring that NO key matched and that the counts agree is what stops the fallback ever
       shuffling scope between items on an ordinary edit, where identity is available and correct. */
    const anyKeyHit = qcItems.some(i => byKey[String(i.lineKey)] !== undefined);
    const alignable = !anyKeyHit && qcScopeStore.length === qcItems.length;
    qcItems.forEach((it, idx) => {
      const hit = byKey[String(it.lineKey)];
      const e = (hit !== undefined) ? hit : (alignable ? (qcScopeStore[idx] || {}) : {});
      it.scope = String(e.s || '');
      it.blocks = (Array.isArray(e.blocks) ? e.blocks : [])
                    .map(b => ({ t: String((b || {}).t || ''), b: String((b || {}).b || '') }));
      it.hidePrice = !!e.hide;
      it.group = String(e.g || '');                                   // A241
    });
  }
  // A205: restore which option the stored total was built from, so reopening and re-saving does not
  // silently re-target the total to the cheapest.
  qcRecommended = String(q.recommendedOption || '').trim();
  if (qcRecommended && !qcItems.some(i => i.optionNo === qcRecommended)) qcRecommended = '';
  if (!qcItems.length) qcItems = [{ lineKey: qcLineKey(), itemNo: '', itemName: '', qty: 1, price: 0,
    uom: '', origItemNo: '', origItemName: '', itemId: '', vat: '', imageDataUrl: '', optionNo: '',
    scope: '' }];                                          // A235
  // Document mode locks the figures (items included) but leaves the photo buttons live, because the
  // document half of the builder is where photos are managed.
  qcLocked = (qcMode === 'document');
  qcRenderItems();
  qcSyncLock();
  /* A178 — put the saved product photos back on their lines. Fire-and-forget on purpose: this function
     is called straight from inline onclick attributes in flow-quotations.js, so making it async would
     un-await it at every one of those call sites. qcSavePdf awaits qcPhotoLoad instead. */
  if (qcQuotationNo) qcPhotoLoad = qcLoadPhotos(qcQuotationNo);

  const esc = (typeof flowEsc === 'function') ? flowEsc : (s => String(s == null ? '' : s));
  const title = document.getElementById('formTitle');
  const savedDate = dt(q.date);
  const today = (typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10);
  if (qcMode === 'document') {
    if (title) title.textContent = 'Document — ' + qcQuotationNo;
    /* A179 — document mode CANNOT move the date: it never calls updateQuotation (that is what lets an
       approver refile a document for a quotation they may not edit), and the freshness check compares
       the document's stamp against the record both here and in Apps Script — where a mismatch is a hard
       refusal to approve. Printing today while the record said otherwise would make the quotation
       permanently unapprovable, so say plainly which date it will carry. */
    qcBanner('Rebuilding the document for <strong>' + esc(qcQuotationNo) + '</strong> (' + esc(q.status || 'Draft')
      + '). The figures are locked to the saved quotation; change the terms, signatory or summary blocks, '
      + 'then <strong>Regenerate &amp; file PDF</strong>. Nothing about the quotation itself is altered — '
      + 'it keeps its saved date, <strong>' + esc(savedDate) + '</strong>. To date it today, use Edit '
      + '(Draft or Rejected) or Revise (Approved or Sent).');
  } else {
    if (title) title.textContent = 'Edit ' + qcQuotationNo;
    /* A179 — you are re-issuing it now, so it carries today's date. Done here rather than silently at
       save time so the rep can see it in the Date field and put the old one back if they only came to
       fix a typo. */
    let dateNote = '';
    if (savedDate && savedDate !== today) {
      set('qcDate', today);
      dateNote = ' Dated <strong>' + esc(today) + '</strong> because you are re-issuing it now — set the '
               + 'Date field back to ' + esc(savedDate) + ' if it should keep its original date.';
    }
    qcBanner('Editing <strong>' + esc(qcQuotationNo)
      + '</strong>. Finalize saves the changes and refiles the PDF — a re-priced quotation goes back '
      + 'through approval before it can be sent.' + dateNote);
  }
  if (qcRole === 'admin' || qcRole === 'director') qcLoadInventory();
  qcOnChange();
}

/* A178 — put a quotation's archived item photos back on their lines.

   The server half has existed since A172 (v99) and nothing ever called it, which is the whole bug:
   every regenerate rebuilt the document from lines whose photo had been blanked, and filed that
   photo-less PDF over the good one in Drive. A123's stale-PDF banner pushes users down exactly that
   path, so the damage was routine rather than rare.

   Photos are ordinary Documents rows (module Quotation, docType 'Item Photo') with the line key in the
   filename — the same store getQuotationPhotos reads. */
async function qcLoadPhotos(no) {
  qcPhotoDocs = {}; qcPhotoDirty = {}; qcPhotoFailed = false;
  const btn = document.getElementById('qcFinalizeBtn');
  // Hold the save shut while Drive is being read. getQuotationPhotos fetches one blob per photo, so
  // this window is seconds long on a photo-heavy quotation — and a Regenerate inside it would file a
  // document missing the very photos still in flight.
  if (btn) { btn.disabled = true; btn.textContent = 'Loading photos…'; }
  try {
    const r = await fetchFlow('getQuotationPhotos', { quotationNo: no }, { fresh: true });
    const dupes = [];
    ((r && r.data) || []).forEach(d => {
      const k = String(d.lineKey || '');
      if (!k) return;                       // a filename _photoLineKey could not parse
      // addDocument carries no idempotency token and postFlow does not retry it, so a response lost
      // after the write leaves a second row for one line. Sheet order is append order: newest wins.
      if (qcPhotoDocs[k]) dupes.push(qcPhotoDocs[k].docId);
      qcPhotoDocs[k] = { docId: d.docId };
      const it = qcItems.find(i => String(i.lineKey) === k);
      if (it) it.imageDataUrl = 'data:' + (d.mimeType || 'image/jpeg') + ';base64,' + d.base64;
    });
    dupes.forEach(id => { postFlow('deleteDocument', { docId: id }).catch(() => {}); });
    qcPreviewPhotos = true;                 // show them once, so the rep can see they are really there
    qcRenderItems();
    qcOnChange();
  } catch (e) {
    qcPhotoFailed = true;
    qcMsg('The saved product photos could not be read back, so filing a new PDF now would lose them. '
        + 'Reload the page and reopen this quotation, or re-attach each photo by hand.', false);
  } finally {
    if (btn) btn.disabled = false;
    qcSyncLock();                           // restores the mode-correct label, or keeps the hard stop
  }
}

/* Doc fields are remembered per user. A176 — read BOTH key casings: the retired PDF dialog saved
   `Validity`/`SigName`, this builder saves `validity`/`sigName`. Without the fallback every rep would
   silently lose their remembered signature block the day the dialog went away. */
function qcPrefillDoc() {
  let d = {};
  try { d = (typeof flowLoadDefaults === 'function' ? flowLoadDefaults('quotation') : {}) || {}; } catch (e) { d = {}; }
  const pick = k => d[k] || d[k.charAt(0).toUpperCase() + k.slice(1)] || '';
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('qcAddress', pick('address'));
  set('qcAttention', pick('attention'));
  set('qcDesignation', pick('designation'));
  set('qcEmail', pick('email'));
  set('qcValidity', pick('validity') || '30 days');
  set('qcDelivery', pick('delivery') || '1-3 weeks upon receipt of order');
  set('qcPayment', pick('payment') || '30 days upon delivery and receipt of invoice');
  set('qcWarranty', pick('warranty') || '1 year');
  set('qcSigName', pick('sigName') || qcSession.name || '');
  set('qcSigDesignation', pick('sigDesignation'));
  set('qcSigViber', pick('sigViber'));
  set('qcSigMobile', pick('sigMobile'));
  set('qcSigEmail', pick('sigEmail'));
  set('qcScope', pick('scope'));
  set('qcExclusions', pick('exclusions'));
  set('qcOptions', pick('options'));
  ['Scope', 'Excl', 'Opts'].forEach((k, i) => {
    const src = [pick('scope'), pick('exclusions'), pick('options')][i];
    if (src) document.getElementById('qcBlk' + k).checked = true;
  });
  qcSyncBlocks();
}

function qcBindInputs() {
  ['qcNo', 'qcDate', 'qcCustomer', 'qcSubject', 'qcDiscount', 'qcVat', 'qcPhotos', 'qcDescMode',
   'qcAddress', 'qcAttention', 'qcDesignation', 'qcEmail', 'qcRfq', 'qcPlantSite', 'qcValidity', 'qcDelivery',
   'qcPayment', 'qcWarranty', 'qcSigName', 'qcSigDesignation', 'qcSigViber', 'qcSigMobile',
   'qcSigEmail', 'qcNote', 'qcScope', 'qcExclusions', 'qcOptions']
    .forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', qcOnChange);
      el.addEventListener('change', qcOnChange);
    });
  ['qcBlkScope', 'qcBlkExcl', 'qcBlkOpts'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { qcSyncBlocks(); qcOnChange(); });
  });
  // A178: turning photos back on is a photo-set change, so let the next preview carry the images.
  const ph = document.getElementById('qcPhotos');
  if (ph) ph.addEventListener('change', () => { qcPreviewPhotos = true; });
}

function qcSyncBlocks() {
  const pair = [['qcBlkScope', 'qcScopeWrap'], ['qcBlkExcl', 'qcExclWrap'], ['qcBlkOpts', 'qcOptsWrap']];
  pair.forEach(([cb, wrap]) => {
    const on = document.getElementById(cb).checked;
    document.getElementById(wrap).style.display = on ? '' : 'none';
  });
}

function qcOnChange() { qcRenderTotals(); qcSchedulePreview(); }

// ── the process-flow path ───────────────────────────────────────────────────

/* ?fromPR=<prNo>. The rep contributes only the quotation number, subject, discount and the layout —
   every line is management's, at management's price. */
async function qcLoadFromPR(prNo) {
  qcFromPr = String(prNo);
  qcMode = 'edit';          // the rep still contributes the number, subject, discount and layout
  qcLocked = true;          // ...but every line is management's, rebuilt server-side
  qcSyncLock();
  try {
    const scoped = qcRole === 'sales' ? { requestedBy: qcSession.name } : {};
    let res = await fetchFlow('getPricingRequests', scoped);
    let pr = ((res && res.data) || []).find(p => String(p.prNo) === qcFromPr);
    if (!pr && qcRole === 'sales') {                      // admin-raised PRs aren't in the scoped list
      res = await fetchFlow('getPricingRequests', {});
      pr = ((res && res.data) || []).find(p => String(p.prNo) === qcFromPr);
    }
    if (!pr) { qcMsg('Purchase Request ' + qcFromPr + ' was not found, or is not returned to you.', false); return; }

    document.getElementById('qcCustomer').value = pr.customer || '';
    const subj = document.getElementById('qcSubject');
    const included = (pr.items || []).filter(i => i.included);
    if (!subj.value) {
      const first = (included[0] && (included[0].itemName || included[0].itemNo)) || '';
      subj.value = (pr.customer || '') + (first ? ' — ' + first : '');
    }
    /* A178 — the plant site admin captured at sourcing. It sits OUTSIDE the docJson try below because
       it is a top-level PR field: a request whose doc block is malformed must still carry its
       destination. Without this the first PDF a client receives — the one built right here — had no
       Plant Site row at all, and it only reappeared if someone later reopened and regenerated. */
    const psEl = document.getElementById('qcPlantSite');
    if (psEl && !psEl.value && pr.plantSite) psEl.value = pr.plantSite;

    // Prefill the client's contact block from what admin captured on the request.
    try {
      const dj = JSON.parse(pr.docJson || '{}');
      const set = (id, v) => { const el = document.getElementById(id); if (el && v && !el.value) el.value = v; };
      set('qcAddress', dj.companyAddress); set('qcAttention', dj.contactPerson);
      set('qcDesignation', dj.designation); set('qcEmail', dj.contactEmail);
      set('qcRfq', dj.prNumberClient || dj.rfqNo);
    } catch (e) { /* a PR without a doc block is fine */ }

    /* A242 — WHICH LINES ARE STILL AVAILABLE, and which are already out on another quotation.
       flowPrRemaining is the same rule the server applies, so a line offered here is a line the
       server will accept. `quotable` was decided server-side (it needs the quotations' statuses,
       which this page never fetches). */
    const rem = (typeof flowPrRemaining === 'function') ? flowPrRemaining(pr, {})
                                                        : { open: included, ready: included, unpriced: [], quoted: [] };
    const readyLines = {}; rem.ready.forEach(i => { readyLines[String(i.line)] = 1; });
    const openLines = {};  rem.open.forEach(i => { openLines[String(i.line)] = 1; });

    qcItems = included.map(i => ({
      lineKey: qcLineKey(), optionNo: '', itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
      qty: (typeof flowNum === 'function' ? flowNum(i.qty) : +i.qty) || 0,
      price: (typeof flowNum === 'function' ? flowNum(i.finalPrice) : +i.finalPrice) || 0,
      uom: i.uom || '', origItemNo: i.origItemNo || '', origItemName: i.origItemName || '',
      itemId: i.itemId || '', vat: i.vat || '', imageDataUrl: '', scope: '',  // A235
      /* A242 — the PR line this row came from, and its state. `prLine` is what travels back to the
         server as the selection; without it the server would have to re-derive which row is which
         by name, the very matching this codebase has been bitten by before. */
      prLine: (typeof flowNum === 'function' ? flowNum(i.line) : +i.line) || 0,
      prQuotedOn: String(i.quotedOn || ''),
      prTaken: !openLines[String(i.line)],
      prPriced: !!readyLines[String(i.line)],
      // Pre-ticked = priced AND still available. An unpriced line can be ticked, but loudly.
      qtSel: !!readyLines[String(i.line)]
    }));
    if (!qcItems.length) { qcMsg('That request has no included items to quote.', false); return; }

    qcPartial = true;
    qcRenderItems();

    /* Say what this quotation will contain BEFORE the rep presses anything. A partial quotation is
       a deliberate act; discovering afterwards that two lines did not go is how a client ends up
       waiting on an item nobody remembers. */
    const bits = [];
    if (rem.quoted.length) bits.push(rem.quoted.length + ' item(s) are already on a quotation and cannot be re-sent');
    if (rem.unpriced.length) bits.push(rem.unpriced.length + ' item(s) have no price yet and are left unticked');
    qcBanner('Building the quotation for <strong>' + (typeof flowEsc === 'function' ? flowEsc(qcFromPr) : qcFromPr)
      + '</strong>. Item prices are management’s and cannot be changed here — you set the quotation number, '
      + 'subject, discount and layout. Create it first, then edit the Draft if a line really must move.'
      + (bits.length
          ? '<br><strong>' + rem.ready.length + ' of ' + included.length + ' item(s) are ticked to go on this quotation.</strong> '
            + bits.join('; ') + '. Whatever you leave behind stays on the request and can be quoted later.'
          : ''));
    qcOnChange();
  } catch (e) {
    qcMsg('Could not load ' + qcFromPr + ' — ' + (e.message || 'unknown error'), false);
  }
}

function qcBanner(html) {
  const el = document.getElementById('qcMsg');
  el.innerHTML = '<div style="margin:.5rem 0 1rem;padding:.65rem .9rem;border-radius:10px;font-size:.86rem;'
    + 'background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe;">' + html + '</div>';
}

async function qcLoadInventory() {
  try {
    const r = await fetchFlow('getInventory');
    qcInventory = (r && r.data) || [];
    const dl = document.getElementById('qcInvList');
    if (dl) dl.innerHTML = qcInventory.map(i =>
      `<option value="${(typeof flowEsc === 'function' ? flowEsc(i.itemNo) : i.itemNo)}">${(typeof flowEsc === 'function' ? flowEsc(i.description) : i.description)}</option>`).join('');
  } catch (e) { /* the datalist is a convenience, not a requirement */ }
}

// ── items ───────────────────────────────────────────────────────────────────

function qcLineKey() {
  return 'LK' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

function qcAddRow(item) {
  qcItems.push(Object.assign({ lineKey: qcLineKey(), itemNo: '', itemName: '', qty: 1, price: 0, optionNo: '',
    uom: '', origItemNo: '', origItemName: '', itemId: '', vat: '', imageDataUrl: '',
    scope: '' }, item || {}));                             // A235
  qcRenderItems();
  qcOnChange();
}

function qcRemoveRow(key) {
  if (qcLocked) return;
  qcItems = qcItems.filter(i => i.lineKey !== key);
  if (!qcItems.length) qcAddRow(); else { qcRenderItems(); qcOnChange(); }
}

/** A205 — option groups present in the current draft, cheapest-first ordering handled by the caller. */
function qcOptionGroups() {
  if (!qcOptionsEnabled) return [];
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const g = {};
  qcItems.forEach(i => {
    const k = String(i.optionNo || '').trim();
    if (!k) return;
    (g[k] = g[k] || { key: k, lines: [], gross: 0 }).lines.push(i);
    g[k].gross += num(i.qty) * num(i.price);
  });
  return Object.keys(g).sort((a, b) => (num(a) - num(b)) || a.localeCompare(b)).map(k => g[k]);
}

function qcSetRecommended(key) {
  if (qcLocked) return;
  qcRecommended = String(key || '').trim();
  qcRenderItems();
  qcOnChange();
}

function qcRenderItems() {
  const esc = (typeof flowEsc === 'function') ? flowEsc : (s => String(s == null ? '' : s));
  const ro = qcLocked ? ' disabled' : '';
  const title = qcLocked ? ' title="Set by management on the purchase request"' : '';
  /* A205 — the Option cell. Blank keeps the line an ordinary charged item; a number puts it in a
     mutually exclusive group. The ★ marks which option the stored total is built from, so it only
     appears once a line is actually tagged. */
  const optCell = (i) => {
    if (!qcOptionsEnabled) return '';
    const cur = String(i.optionNo || '').trim();
    const opts = ['', '1', '2', '3', '4', '5']
      .map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v ? 'Opt ' + v : '—'}</option>`).join('');
    const star = cur
      ? `<button type="button" class="qc-del qc-rec${qcRecommended === cur ? ' on' : ''}"
           style="margin-left:.25rem;${qcRecommended === cur ? 'color:#b45309;' : 'color:#cbd5e1;'}"
           onclick="qcSetRecommended('${esc(cur)}')"
           title="${qcRecommended === cur ? 'This option is the one the quotation total is built from' : 'Make this the recommended option'}">★</button>`
      : '';
    return `<td><select${ro}${title} onchange="qcSet('${esc(i.lineKey)}','optionNo',this.value)"
              style="width:100%;box-sizing:border-box;">${opts}</select>${star}</td>`;
  };
  /* A242 — the "goes on this quotation" tick. Only on the fromPR path, and only against a backend
     that honours it. A line already out on another quotation is shown, disabled, with the number it
     went out on: hiding it would leave the rep wondering where an item went, and it is the clearest
     possible statement of what a partial quotation already covered. */
  const selCell = (i) => {
    if (!(qcPartial && qcPartialUI)) return '';
    if (i.prTaken) {
      return `<td class="num" title="Already quoted on ${esc(i.prQuotedOn)}">
                <span style="font-size:.68rem;color:#94a3b8;white-space:nowrap;">✓ ${esc(i.prQuotedOn)}</span></td>`;
    }
    const warn = i.prPriced ? '' : ' title="Management has not priced this item — it would print as free."';
    return `<td class="num"><input type="checkbox"${i.qtSel ? ' checked' : ''}${warn}
              onchange="qcSetSel('${esc(i.lineKey)}',this.checked)">
            ${i.prPriced ? '' : '<div style="font-size:.62rem;color:#b45309;">no price</div>'}</td>`;
  };
  document.getElementById('qcItemBody').innerHTML = qcItems.map(i => `
    <tr data-key="${esc(i.lineKey)}"${(qcPartial && qcPartialUI && (i.prTaken || !i.qtSel)) ? ' style="opacity:.55;"' : ''}>
      ${selCell(i)}
      ${optCell(i)}
      <td><input type="text" list="qcInvList" value="${esc(i.itemNo)}"${ro}${title}
            oninput="qcSet('${esc(i.lineKey)}','itemNo',this.value)"></td>
      <td><input type="text" value="${esc(i.itemName)}"${ro}${title}
            oninput="qcSet('${esc(i.lineKey)}','itemName',this.value)">
          ${i.origItemNo || i.origItemName ? `<div style="font-size:.7rem;color:#64748b;margin-top:.2rem;">
            requested: ${esc(i.origItemNo || '')} ${esc(i.origItemName || '')}</div>` : ''}</td>
      <td class="num"><input type="number" min="0" step="any" value="${i.qty}"${ro}${title}
            oninput="qcSet('${esc(i.lineKey)}','qty',this.value)"></td>
      <td class="num"><input type="number" min="0" step="any" value="${i.price}"${ro}${title}
            oninput="qcSet('${esc(i.lineKey)}','price',this.value)"></td>
      <td><button class="btn btn-secondary btn-sm qc-photo-btn ${i.imageDataUrl ? 'qc-photo-on' : ''}"
            onclick="qcPickPhoto('${esc(i.lineKey)}')">${i.imageDataUrl ? '✓ photo' : '+ photo'}</button>${
          i.imageDataUrl ? `<button class="qc-del" style="margin-left:.3rem;"
            onclick="qcClearPhoto('${esc(i.lineKey)}')" title="Remove this photo">✕</button>` : ''}</td>
      <!-- A235 — a BUTTON, not an inline textarea: a textarea per row would wreck the layout the
           moment anyone typed a real scope. A236 — but its own CELL. Sharing the photo cell put two
           nowrap pills in a column sized for one, so the scope button overhung the remove button by
           84px and covered it completely. -->
      <td><button class="btn btn-secondary btn-sm qc-scope-btn ${qcLineMark(i) ? 'qc-scope-on' : ''}"
            onclick="qcOpenScope('${esc(i.lineKey)}')"
            title="Scope of supply, note blocks and price visibility for this line">${
            qcLineMark(i) || '+ details'}</button></td>
      <td>${qcLocked ? '' : `<button class="qc-del" onclick="qcRemoveRow('${esc(i.lineKey)}')" title="Remove line">✕</button>`}</td>
    </tr>`).join('');
  /* A205 — the header cell has to follow the gate too. The <th> is static markup, so leaving it
     visible while the body renders one fewer <td> shifts every cell under the wrong heading. */
  const thOpt = document.getElementById('qcThOption');
  if (thOpt) thOpt.style.display = qcOptionsEnabled ? '' : 'none';
  // A242 — same rule for the selection column, and for the same reason.
  const thPick = document.getElementById('qcThPick');
  if (thPick) thPick.style.display = (qcPartial && qcPartialUI) ? '' : 'none';
  const add = document.getElementById('qcAddBtn');
  if (add) add.style.display = qcLocked ? 'none' : '';
}

/* ── A235: scope of supply, per item ───────────────────────────────────────────────────────────
   Printed under THAT item's description on the PDF. Separate from the document-level Scope block,
   which stays for what is true of the whole offer (delivery, warranty, commissioning). */

let qcScopeKey = null;                                  // the line currently open in the editor

/** Entries in one item's scope — what the row button counts. Blank lines never count, so an
 *  accidental trailing newline does not light the button up as though scope had been written. */
function qcScopeCount(it) {
  return String((it || {}).scope || '').split('\n').filter(s => s.trim()).length;
}

/** A240 — what the row button says. It has to fit a column sized for one short pill (A236: a wider
 *  control here overhung the ✕ and covered it), so the parts are terse and the count comes first.
 *  Empty string means nothing is set, and the caller prints "+ details". */
function qcLineMark(it) {
  const n = qcScopeCount(it);
  const b = (Array.isArray((it || {}).blocks) ? it.blocks : []).length;
  const parts = [];
  if (n) parts.push('✓ ' + n);
  if (b) parts.push(b + ' note' + (b === 1 ? '' : 's'));
  if ((it || {}).hidePrice) parts.push('₱ hidden');
  if (String((it || {}).group || '').trim()) parts.push('▦ grouped');   // A241
  return parts.join(' · ');
}

/* A240 — the blocks being edited, held apart from qcItems until Save so Cancel really cancels.
   The row button counts scope entries AND blocks AND the hidden flag, so the rep can see from the
   table that a line carries something without opening it. */
let qcBlkDraft = [];

function qcOpenScope(key) {
  const it = qcItems.find(i => String(i.lineKey) === String(key));
  if (!it) return;
  qcScopeKey = key;
  const name = (it.itemName || it.itemNo || 'this item');
  document.getElementById('qcScopeItem').textContent = name;
  const box = document.getElementById('qcScopeText');
  box.value = String(it.scope || '');
  box.readOnly = !!qcLocked;
  document.getElementById('qcScopeSave').style.display = qcLocked ? 'none' : '';
  // A241 — the group and the unit. The unit selector always carries the line's CURRENT value even
  // when it is not one of ours (A147: a real unit from the pricing request is never overwritten),
  // so opening this modal on an old line and pressing Cancel cannot rewrite it.
  const grp = document.getElementById('qcGroup');
  grp.value = String(it.group || '');
  grp.readOnly = !!qcLocked;
  const uom = document.getElementById('qcUom');
  uom.innerHTML = (typeof flowUomOptions === 'function') ? flowUomOptions(it.uom) : '';
  uom.disabled = !!qcLocked;
  document.getElementById('qcUomCustom').style.display = 'none';
  document.getElementById('qcUomCustom').value = '';
  // Deep copy: editing the draft must not reach qcItems until Save.
  qcBlkDraft = (Array.isArray(it.blocks) ? it.blocks : [])
                 .map(b => ({ t: String((b || {}).t || ''), b: String((b || {}).b || '') }));
  qcRenderBlocks();
  const hide = document.getElementById('qcHidePrice');
  hide.checked = !!it.hidePrice;
  hide.disabled = !!qcLocked;
  document.getElementById('qcBlkAdd').style.display = qcLocked ? 'none' : '';
  qcScopeTick();
  document.getElementById('qcScopeOverlay').classList.add('open');
  if (!qcLocked) box.focus();
}

/** One editor per block: a free-text heading and its body. Rendered from qcBlkDraft each time so
 *  add and remove cannot leave the DOM and the array disagreeing about which block is which. */
function qcRenderBlocks() {
  const host = document.getElementById('qcBlkList');
  if (!host) return;
  // `esc` is function-local in qcRenderItems, not a global — the same line, for the same reason.
  const esc = (typeof flowEsc === 'function') ? flowEsc : (s => String(s == null ? '' : s));
  const ro = qcLocked ? ' readonly' : '';
  host.innerHTML = qcBlkDraft.map((b, i) => `
    <div class="qc-blk" style="border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:.5rem;margin-top:.4rem;">
      <div style="display:flex;gap:.4rem;align-items:center;">
        <input type="text" value="${esc(b.t)}"${ro} style="flex:1;"
               placeholder="FACTORY ACCEPTANCE TEST — ITEMS 01 &amp; 02"
               oninput="qcBlkSet(${i},'t',this.value)">
        ${qcLocked ? '' : `<button class="qc-del" onclick="qcDelBlock(${i})" title="Remove this block">✕</button>`}
      </div>
      <textarea${ro} rows="3" style="margin-top:.35rem;width:100%;"
        placeholder="Leave a blank line between paragraphs."
        oninput="qcBlkSet(${i},'b',this.value)">${esc(b.b)}</textarea>
    </div>`).join('') ||
    '<div class="qc-scope-count">No note blocks on this line.</div>';
}

/** A241 — "Custom…" swaps the picker for a free-text box. The vocabulary makes the common unit one
 *  click; it does not become a cage, because the units a supplier quotes in are not ours to limit. */
function qcUomPick(v) {
  const box = document.getElementById('qcUomCustom');
  box.style.display = (v === '__custom__') ? '' : 'none';
  if (v === '__custom__') box.focus();
}

function qcUomValue() {
  const sel = String(document.getElementById('qcUom').value || '');
  if (sel !== '__custom__') return sel;
  return String(document.getElementById('qcUomCustom').value || '').trim();
}

function qcBlkSet(i, field, value) {
  if (qcLocked) return;
  if (qcBlkDraft[i]) qcBlkDraft[i][field] = String(value || '');
}

function qcAddBlock() {
  if (qcLocked) return;
  qcBlkDraft.push({ t: '', b: '' });
  qcRenderBlocks();
}

function qcDelBlock(i) {
  if (qcLocked) return;
  qcBlkDraft.splice(i, 1);
  qcRenderBlocks();
}

/** Live count while typing, so a rep can see the block growing without saving to find out. */
function qcScopeTick() {
  const n = String(document.getElementById('qcScopeText').value || '')
              .split('\n').filter(s => s.trim()).length;
  document.getElementById('qcScopeCount').textContent =
    n ? (n + (n === 1 ? ' entry' : ' entries') + ' — each prints on its own line under the item')
      : 'No entries yet. One inclusion per line.';
}

function qcCloseScope() {
  document.getElementById('qcScopeOverlay').classList.remove('open');
  qcScopeKey = null;
}

function qcSaveScope() {
  if (qcLocked) return qcCloseScope();
  const it = qcItems.find(i => String(i.lineKey) === String(qcScopeKey));
  if (it) {
    it.scope = String(document.getElementById('qcScopeText').value || '');
    // A240 — a block with neither a heading nor a body is a row the rep added and left empty; it
    // would print as a blank gap under the item. Drop it here rather than teach the renderer to.
    it.blocks = qcBlkDraft.map(b => ({ t: String(b.t || '').trim(), b: String(b.b || '') }))
                          .filter(b => b.t || b.b.trim());
    it.hidePrice = !!document.getElementById('qcHidePrice').checked;
    it.group = String(document.getElementById('qcGroup').value || '').trim();
    it.uom = qcUomValue();
    qcRenderItems();
    qcOnChange();                                       // refresh the live preview
  }
  qcCloseScope();
}

/* A242 — ticking a line on or off this quotation. Deliberately NOT gated on qcLocked: the lock says
   management owns the PRICES, which is still true; choosing which of them go out today is the rep's
   call and is the whole point of the feature. */
function qcSetSel(key, on) {
  const it = qcItems.find(i => i.lineKey === key);
  if (!it || it.prTaken) return;
  it.qtSel = !!on;
  qcRenderItems();
  qcOnChange();
}

function qcSet(key, field, value) {
  if (qcLocked) return;
  const it = qcItems.find(i => i.lineKey === key);
  if (!it) return;
  it[field] = (field === 'qty' || field === 'price') ? (parseFloat(value) || 0) : value;
  if (field === 'optionNo' && qcOptionsEnabled) {
    it.optionNo = String(value || '').trim();
    // A205: a recommendation pointing at a group that no longer exists would silently re-target the
    // total, so drop it and let the guard ask again rather than pick for the user.
    if (qcRecommended && !qcItems.some(x => String(x.optionNo || '').trim() === qcRecommended)) qcRecommended = '';
    qcRenderItems();
  }
  if (field === 'itemNo') {                       // A159: stamp the permanent id on an exact pick
    const inv = qcInventory.find(x => String(x.itemNo) === String(value));
    it.itemId = inv ? (inv.itemId || '') : '';
    if (inv && !it.itemName) { it.itemName = inv.description || ''; qcRenderItems(); }
  }
  qcOnChange();
}

function qcPickPhoto(key) {
  qcPhotoTarget = key;
  const el = document.getElementById('qcPhotoInput');
  el.value = '';
  el.click();
}

async function qcPhotoChosen(ev) {
  const file = ev.target.files && ev.target.files[0];
  const it = qcItems.find(i => i.lineKey === qcPhotoTarget);
  if (!file || !it) return;
  if (file.size > 10 * 1024 * 1024) { qcMsg('That image is over 10MB — pick a smaller one.', false); return; }
  try {
    it.imageDataUrl = await qcDownscale(file, 900, 0.85);
    qcPhotoDirty[String(it.lineKey)] = true;   // A178: this one needs archiving on the next save
    qcPreviewPhotos = true;                    // ...and showing in the preview, once
    qcRenderItems();
    qcOnChange();
    /* A178 — a photo needs a line key to be filed under, and quotations written before A172 have none.
       Mint them at the moment a photo is actually attached, so quotations nobody photographs are never
       touched. Awaited here (not at save time) so the row already carries its real key. */
    await qcEnsureLineKeys();
  } catch (e) { qcMsg('Could not read that image.', false); }
}

/* A178 — drop a line's photo. Deliberately NOT gated on qcLocked: the photo buttons stay live while
   the figures are locked, because document mode is where photos are managed. The Drive file is trashed
   by the next save, not here, so an accidental click costs nothing until the document is refiled. */
function qcClearPhoto(key) {
  const it = qcItems.find(i => i.lineKey === key);
  if (!it || !it.imageDataUrl) return;
  it.imageDataUrl = '';
  qcPhotoDirty[String(key)] = true;
  qcPreviewPhotos = true;
  qcRenderItems();
  qcOnChange();
}

/* A190: the implementation moved to flowDownscaleImage in flow-api.js so the client-visit photo
   uses the same one. Behaviour is unchanged — same 900px / 0.85 JPEG re-encode. */
function qcDownscale(file, maxPx, quality) { return flowDownscaleImage(file, maxPx, quality); }

// ── live totals (instant, no server) ────────────────────────────────────────
/* Mirrors build_summary_table: the discount comes off the pre-VAT subtotal, then VAT applies to the
   net. Keep these in step if that ever changes. */
function qcTotals() {
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  /* A205 — base lines + the recommended option only. Summing every alternative here would show the
     person quoting a total the client can never be charged, and it is the figure that gets stored. */
  const groups = qcOptionGroups();
  const rec = (groups.length && !groups.some(g => g.key === qcRecommended))
    ? groups.slice().sort((a, b) => a.gross - b.gross)[0].key   // same cheapest fallback as both engines
    : qcRecommended;
  /* The gate check is NOT redundant. With options off, qcOptionGroups() is empty so `rec` is '', and
     a line still carrying a stale optionNo would fail the `k !== rec` test and be DROPPED from the
     total — understating the quotation instead of overstating it. Off means every line is a base
     line, full stop. */
  // A242: only the ticked lines. A total that included the two items being left behind would be a
  // figure the client's document never shows, and it is the figure that gets stored.
  const gross = qcQuotedItems().reduce((s, i) => {
    const k = qcOptionsEnabled ? String(i.optionNo || '').trim() : '';
    return (k && k !== rec) ? s : s + num(i.qty) * num(i.price);
  }, 0);
  const pct = Math.min(100, Math.max(0, num(document.getElementById('qcDiscount').value)));
  const discount = gross * pct / 100;
  const net = gross - discount;
  const opt = document.getElementById('qcVat').value;
  const vat = opt === 'inclusive' ? net * QC_VAT_PCT : 0;
  return { gross, pct, discount, net, vat, grand: net + vat, opt, groups, rec };
}

function qcRenderTotals() {
  const t = qcTotals();
  const m = n => (typeof flowMoney === 'function') ? flowMoney(n, 'PHP') : ('PHP ' + n.toFixed(2));
  const label = t.opt === 'inclusive' ? 'Total (VAT Inclusive)'
              : t.opt === 'zero' ? 'Total (Zero-Rated)' : 'Total (VAT Exclusive)';
  let html = `<div class="row"><span>Subtotal (VAT Exclusive)</span><span class="v">${m(t.gross)}</span></div>`;
  if (t.pct > 0) {
    html += `<div class="row disc"><span>Less: Discount (${t.pct}%)</span><span class="v">− ${m(t.discount)}</span></div>`;
    html += `<div class="row"><span>Net</span><span class="v">${m(t.net)}</span></div>`;
  }
  if (t.opt === 'inclusive') html += `<div class="row"><span>VAT (12%)</span><span class="v">${m(t.vat)}</span></div>`;
  html += `<div class="row grand"><span>${label}</span><span class="v">${m(t.grand)}</span></div>`;
  /* A205 — the alternatives, each priced on its own. Shown BELOW the total so it is obvious the
     total is one of them rather than all of them, which is the misreading that costs money. */
  if (t.groups.length) {
    html += `<div class="row" style="margin-top:.5rem;border-top:1px dashed #cbd5e1;padding-top:.4rem;">
      <span style="font-weight:700;color:#b91c1c;">Alternative offers</span>
      <span class="v" style="font-size:.72rem;color:#64748b;">client picks one · not cumulative</span></div>`;
    t.groups.forEach(g => {
      const vat = g.gross * QC_VAT_PCT;
      const on = g.key === t.rec;
      html += `<div class="row"><span>${on ? '★ ' : ''}Option ${g.key}${on ? ' (in the total above)' : ''}</span>
        <span class="v">${m(g.gross)}</span></div>`;
      html += `<div class="row" style="font-size:.72rem;color:#64748b;"><span>&nbsp;&nbsp;+ VAT 12% ${m(vat)} → VAT-inc</span>
        <span class="v">${m(g.gross + vat)}</span></div>`;
    });
    if (!qcRecommended) {
      html += `<div class="row" style="color:#b45309;font-size:.74rem;"><span>⚠ No option marked ★ —
        the cheapest is being used. Pick one before finalising.</span><span class="v"></span></div>`;
    }
    const lonely = t.groups.filter(g => g.lines.length === 1 && t.groups.length === 1);
    if (lonely.length) {
      html += `<div class="row" style="color:#b45309;font-size:.74rem;"><span>⚠ Only one option group —
        an alternative needs something to be an alternative to.</span><span class="v"></span></div>`;
    }
  }
  document.getElementById('qcTotals').innerHTML = html;
}

// ── the live document ───────────────────────────────────────────────────────

/* withImages=false for keystroke-driven previews. Base64 photos are hundreds of KB each and the preview
   re-posts on every pause in typing — five photos would mean ~1.5MB per keystroke burst, which is
   punishing on a free-tier server.
   A178: but a rep who attached a photo and saw only a placeholder concluded it had not worked, so
   qcRenderPreview passes true for the FIRST render after the photo set changes (qcPreviewPhotos) and
   false thereafter. The real save always passes true. */
function qcPayload(withImages) {
  const val = id => (document.getElementById(id) || {}).value || '';
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const on = id => document.getElementById(id).checked;
  const showPhotos = val('qcPhotos') !== 'off';
  return {
    quotationNo: val('qcNo') || 'PREVIEW',
    customer: val('qcCustomer'),
    date: val('qcDate'),
    vatOption: val('qcVat'),
    discountPct: Math.min(100, Math.max(0, num(val('qcDiscount')))),
    // A176: the renderer gates the per-item description sub-lines on desc_mode != "short". This used
    // to go unsent, so the route defaulted to "short" and every quotation built here silently lost
    // its multi-line descriptions. It now follows the selector, which defaults to Full.
    descMode: val('qcDescMode') || 'long',
    photos: showPhotos,
    designVersion: qcPreviewDesign(),                           // A241 / A242 — see the helper
    recommendedOption: qcOptionsEnabled ? qcRecommended : '',   // A205
    items: qcQuotedItems().filter(i => (i.itemNo || i.itemName)).map(i => ({   // A242: the ticked lines
      itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
      qty: num(i.qty), price: num(i.price),
      optionNo: String(i.optionNo || '').trim(),           // A205

      description: i.itemName || '',
      uom: i.uom || '',                                  // A147: never force "pc(s)"
      origItemNo: i.origItemNo || '', origItemName: i.origItemName || '',   // A86 pairing
      // A235 — this item's own scope of supply, printed under its description. Rides the item in
      // the payload rather than a QuotationItems column: that sheet is 13 wide and every positional
      // writer must match it, so a 14th column is the width trap that bit A186/A193/A205/A215/A218.
      // The payload is embedded in the PDF and round-trips by lineKey, which is already the item's
      // stable identity.
      scope: i.scope || '',
      // A240 — the note blocks and the hidden-price flag ride the same way, for the same reason.
      // `hidePrice` suppresses only the two money cells: the price is still in this payload and
      // total_ex_vat still sums it, so nothing downstream of the display changes.
      blocks: Array.isArray(i.blocks) ? i.blocks : [],
      hidePrice: !!i.hidePrice,
      group: String(i.group || ''),                      // A241 — the section band this line joins
      imageDataUrl: (showPhotos && withImages) ? (i.imageDataUrl || '') : ''
    })),
    doc: {
      address: val('qcAddress'), attention: val('qcAttention'), designation: val('qcDesignation'),
      email: val('qcEmail'), subject: val('qcSubject'), rfqNo: val('qcRfq'),
      note: val('qcNote'),                                 // prints on the final page (Full format)
      plantSite: val('qcPlantSite'),                       // A178: a plain document field, like the RFQ no
      descMode: val('qcDescMode') || 'long',
      validity: val('qcValidity'), delivery: val('qcDelivery'), payment: val('qcPayment'),
      warranty: val('qcWarranty'), sigName: val('qcSigName'), sigDesignation: val('qcSigDesignation'),
      sigMobile: val('qcSigMobile'), sigViber: val('qcSigViber') || val('qcSigMobile'),
      sigEmail: val('qcSigEmail'),
      // A173: the route reads these ONLY from doc — a top-level copy is silently ignored.
      scope: on('qcBlkScope') ? val('qcScope') : '',
      exclusions: on('qcBlkExcl') ? val('qcExclusions') : '',
      options: on('qcBlkOpts') ? val('qcOptions') : ''
    }
  };
}

function qcReady() {
  const p = qcPayload(false);
  return !!(p.customer && p.items.length);
}

function qcSchedulePreview() {
  clearTimeout(qcTimer);
  qcTimer = setTimeout(qcRenderPreview, QC_DEBOUNCE);
}

function qcState(text, kind) {
  document.getElementById('qcState').textContent = text;
  document.getElementById('qcDot').className = 'qc-dot' + (kind ? ' ' + kind : '');
}

async function qcRenderPreview() {
  if (!qcReady()) {
    document.getElementById('qcEmpty').style.display = '';
    qcState('waiting for a customer and an item', '');
    return;
  }
  const seq = ++qcSeq;
  if (qcAbort) { try { qcAbort.abort(); } catch (e) {} }
  qcAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

  const wrap = document.getElementById('qcFrameWrap');
  wrap.classList.add('busy');
  qcState('rendering…', 'busy');

  const wakeTimer = setTimeout(() => {
    if (seq === qcSeq && !document.getElementById('qcWake')) {
      const n = document.createElement('div');
      n.className = 'qc-wake'; n.id = 'qcWake';
      n.textContent = 'waking the server — the first render after a quiet spell takes a moment';
      wrap.appendChild(n);
    }
  }, QC_WAKE_AFTER);

  /* A178 — the preview normally strips photos, because a ~150KB image re-posted on every pause in
     typing is wasted bandwidth. But a rep who attached a photo and saw a placeholder concluded it had
     not worked. So include the images on the FIRST render after the photo set changes, then go back to
     stripping. The flag is cleared on success, not here — a render aborted by the next keystroke must
     not consume the one chance to show it. */
  const withImages = qcPreviewPhotos;

  try {
    const res = await fetch('/flow/quotation-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(qcPayload(withImages)),
      signal: qcAbort ? qcAbort.signal : undefined
    });
    if (seq !== qcSeq) return;                    // a newer edit went out — discard this one
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (e) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (seq !== qcSeq) return;
    const url = URL.createObjectURL(blob);
    document.getElementById('qcFrame').src = url;
    if (qcLastUrl) URL.revokeObjectURL(qcLastUrl);
    qcLastUrl = url;
    document.getElementById('qcEmpty').style.display = 'none';
    if (withImages) qcPreviewPhotos = false;      // it actually reached the pane — one shot spent
    qcState('up to date', '');
  } catch (e) {
    if (e && e.name === 'AbortError') return;     // superseded, not a failure
    if (seq !== qcSeq) return;
    qcState('preview failed — ' + (e.message || 'unknown'), 'err');
  } finally {
    clearTimeout(wakeTimer);
    const w = document.getElementById('qcWake'); if (w) w.remove();
    if (seq === qcSeq) wrap.classList.remove('busy');
  }
}

// ── finalize ────────────────────────────────────────────────────────────────

function qcMsg(text, good) {
  document.getElementById('qcMsg').innerHTML =
    `<div style="margin:.5rem 0 1rem;padding:.6rem .85rem;border-radius:10px;font-size:.86rem;
      background:${good ? '#ecfdf5' : '#fef2f2'};color:${good ? '#065f46' : '#991b1b'};
      border:1px solid ${good ? '#a7f3d0' : '#fecaca'};">${(typeof flowEsc === 'function' ? flowEsc(text) : text)}</div>`;
}

function qcLayoutJson() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const on = id => document.getElementById(id).checked;
  const lay = {
    // A176: the Template selector is gone — neither the Flask route nor the ReportLab renderer has
    // ever read `layout`, so it promised something it never did. Re-add it when A172-P4 is built.
    template: 'full', photos: val('qcPhotos') !== 'off',
    blocks: { scope: on('qcBlkScope'), exclusions: on('qcBlkExcl'), options: on('qcBlkOpts') },
    scope: val('qcScope'), exclusions: val('qcExclusions'), options: val('qcOptions')
  };
  /* A235 — per-item scope of supply. Stored in item ORDER and keyed by Line Key: the key is what an
     ordinary edit re-attaches by, the order is what the from-PR path falls back to when the server
     re-keys the lines (see qcLoadExisting). The key is omitted entirely when no item carries scope,
     so every quotation without it stores exactly the string it stored before A235.
     A236 — the SAME filter qcFinalize applies before saving `items`. It used to map every row,
     including the empty one the form always leaves at the bottom, so the stored list was one longer
     than the saved items. Keys still matched on an ordinary edit, but on the from-PR path the server
     re-keys every line and ORDER is the only thing holding the scope — and the fallback is disabled
     when the counts disagree. That silently dropped scope typed before the first save. */
  /* A240 — the same entry now carries the note blocks and the hidden-price flag. `hide` and `blocks`
     are written ONLY when set, so an entry that carries nothing new is byte-identical to the A236
     one and a quotation saved before A240 reloads unchanged. */
  /* A242 — ON THE fromPR PATH THE BLOB MUST DESCRIBE ONLY THE LINES BEING QUOTED, in the order the
     server will rebuild them. This is A236 repeating with a new cause. The entries are keyed by
     lineKey, but the server re-keys every line on this path, so ORDER is the only thing that holds
     scope to its item — and qcLoadExisting refuses the positional fallback unless the stored count
     equals the item count (:256). Emitting all 5 entries for a 3-line quotation would therefore not
     mis-attach the scope; it would silently DISCARD every scope, note, hidden-price flag and group
     the rep typed, at the moment they reopen the record. */
  const scopes = qcQuotedItems().filter(i => (i.itemNo || i.itemName)).map(i => {
    const e = { k: String(i.lineKey || ''), s: String(i.scope || '') };
    const blocks = (Array.isArray(i.blocks) ? i.blocks : [])
                     .map(b => ({ t: String((b || {}).t || ''), b: String((b || {}).b || '') }))
                     .filter(b => b.t || b.b.trim());
    if (blocks.length) e.blocks = blocks;
    if (i.hidePrice) e.hide = true;
    if (String(i.group || '').trim()) e.g = String(i.group).trim();   // A241
    return e;
  });
  if (scopes.some(e => e.s.trim() || e.blocks || e.hide || e.g)) lay.itemScopes = scopes;
  /* A241 — the DESIGN STAMP. Saving is what marks a record as "edited", and an edited record moves
     to the new document design; everything untouched keeps the look its client already has. Written
     unconditionally on save, so a quotation created today is design 2 from birth. */
  lay.v = 2;
  return JSON.stringify(lay);
}

async function qcFinalize() {
  // A176 — document mode never writes the record; it only rebuilds and refiles the PDF.
  if (qcMode === 'document') return qcRegenerateOnly();
  const val = id => (document.getElementById(id) || {}).value || '';
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const btn = document.getElementById('qcFinalizeBtn');
  if (!val('qcNo').trim()) { qcMsg('Quotation No is required — it is your own code, not auto-generated.', false); return; }
  if (!val('qcSubject').trim()) { qcMsg('Subject is required — it prints on the document.', false); return; }
  if (!qcFromPr && !val('qcCustomer').trim()) { qcMsg('Customer is required.', false); return; }
  const priced = qcItems.filter(i => (i.itemNo || i.itemName));
  if (!priced.length) { qcMsg('Add at least one item.', false); return; }
  /* A205 — with alternatives on the document, the stored total is base + ONE option, so which option
     is not a detail the system may decide quietly: it changes the value carried into approval, the
     sales order and the pipeline. Block rather than guess. */
  const qcGroups = qcOptionGroups();
  if (qcGroups.length && !qcRecommended) {
    qcMsg('Mark one option with ★ — it decides the quotation total that goes to approval and the sales order.', false);
    return;
  }
  if (qcGroups.length === 1) {
    qcMsg('Option ' + qcGroups[0].key + ' is the only option — either add another alternative, or clear the Option tag so it is an ordinary line.', false);
    return;
  }
  /* A235 — the Layout JSON is ONE Google Sheets cell and a cell holds at most 50,000 characters. Past
     that the write fails inside Apps Script with an opaque error, after the rep has pressed Finalize
     and while their typing is the thing that gets lost. Refuse here instead, naming the cause, while
     the text is still on screen to shorten. Nothing is truncated silently. */
  const qcLay = qcLayoutJson();
  if (qcLay.length > 45000) {
    // A240 — the note blocks ride the same cell, so they are already inside this measurement; the
    // message names them so a rep who blew the limit with a long note is not told to shorten scope.
    qcMsg('The scope of supply, note blocks and summary text are too long to store — ' +
          qcLay.length.toLocaleString() +
          ' characters against a 45,000 limit. Shorten the longest item scope or note and save again.',
          false);
    return;
  }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let res, newNo;

    if (qcFromPr && !qcQuotationNo) {
      /* The process-flow path. Exactly five keys — the server rebuilds every line from
         PricingRequestItems at management's Final Price and carries itemId / uom / vat /
         origItemNo / origItemName / plantSite / the client RFQ, then flips the PR to Quoted.
         Sending items here would be ignored, so we don't pretend otherwise. */
      const base = {
        prNo: qcFromPr, quotationNo: val('qcNo').trim(), subject: val('qcSubject').trim(),
        layoutJson: qcLayoutJson(),
        discountPct: Math.min(100, Math.max(0, num(val('qcDiscount')))),
        clientRef: (typeof flowClientRef === 'function') ? flowClientRef() : ('QC-' + Date.now())
      };
      /* A242 — WHICH lines. Sent only when the backend understands it (qcPartialUI); an older one
         ignores the key and quotes everything still open, which is why the checkboxes are hidden in
         that case rather than shown and silently disregarded. The server re-derives availability and
         refuses anything already out, so this is a request, not an instruction. */
      if (qcPartial && qcPartialUI) {
        const picked = qcQuotedItems().map(i => i.prLine);
        if (!picked.length) {
          qcMsg('Tick at least one item to put on this quotation.', false);
          btn.disabled = false; btn.textContent = 'Finalize quotation'; return;
        }
        base.lines = JSON.stringify(picked);
      }
      res = await postFlow('createQuotationFromPR', base);
      // A158: a ₱0 line is a real freebie, not a mistake — confirm, then repeat with the override.
      if (res && !res.success && res.needsConfirm === 'zeroPrice') {
        if (!confirm(res.message + '\n\nCreate the quotation with those items as free?')) {
          btn.disabled = false; btn.textContent = 'Finalize quotation'; return;
        }
        res = await postFlow('createQuotationFromPR', Object.assign({}, base, { confirmZero: true }));
      }
      if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
      newNo = res.quotationNo;
      if (res.duplicate) {
        /* A242 — this no longer means "the request is Quoted"; it means EVERY ITEM on it is out
           already. A request with items still outstanding never lands here. */
        qcMsg(res.message || ('Every item on that request is already quoted (' + newNo + ').'), true);
        btn.disabled = false; btn.textContent = 'Finalize quotation';
        await qcAfterSave(newNo);
        return;
      }
      // A174: layout now rides along on the create above. It used to be a follow-up
      // updateQuotation call, and that call deleted every line of the quotation it had just made.
    } else {
      const items = priced.map(i => ({
        itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
        qty: num(i.qty), price: num(i.price), uom: i.uom || '',
        origItemNo: i.origItemNo || '', origItemName: i.origItemName || '',
        itemId: i.itemId || '', vat: i.vat || '', lineKey: i.lineKey,
        optionNo: String(i.optionNo || '').trim()          // A205
      }));
      const common = {
        customer: val('qcCustomer').trim(), date: val('qcDate'), subject: val('qcSubject').trim(),
        discountPct: Math.min(100, Math.max(0, num(val('qcDiscount')))),
        // A178: createQuotation already stores this in the Plant Site column; updateQuotation ignores
        // it today, which is why the read-back prefers the document's own stamp over the column.
        plantSite: val('qcPlantSite').trim(),
        recommendedOption: qcOptionsEnabled ? qcRecommended : '',   // A205 — decides the stored Total
        layoutJson: qcLayoutJson(), items: JSON.stringify(items),
        // A218 — WHOSE deal. Sent on both paths; createQuotation stores it, and an edit can correct
        // an attribution that was wrong (there was no correction path at all before this).
        salesperson: (val('qcSalesperson') || qcSession.name)
      };
      if (qcQuotationNo) {
        res = await postFlow('updateQuotation', Object.assign({ quotationNo: qcQuotationNo,
          newQuotationNo: val('qcNo').trim() }, common));
        newNo = val('qcNo').trim();
      } else {
        res = await postFlow('createQuotation', Object.assign({ quotationNo: val('qcNo').trim(),
          createdBy: qcSession.name,
          clientRef: (typeof flowClientRef === 'function') ? flowClientRef() : ('QC-' + Date.now())
        }, common));
        newNo = val('qcNo').trim();
      }
      if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
      // A63: an item the rep typed that isn't in inventory becomes a Catalog record at balance 0.
      if (qcRole === 'admin' || qcRole === 'director') await qcAutoAddItems(items);
    }

    qcQuotationNo = newNo;
    try { if (typeof flowSaveDefaults === 'function') flowSaveDefaults('quotation', qcPayload(false).doc); } catch (e) {}

    btn.textContent = 'Generating PDF…';
    const photoWarn = await qcSavePdf(newNo);

    qcMsg('Quotation ' + newNo + ' saved' + (qcFromPr ? ' and ' + qcFromPr + ' is now Quoted' : '')
        + '. The PDF is filed to Drive.'
        + (photoWarn ? ' Note: ' + photoWarn + ' — the document itself is fine.' : ''), true);
    btn.disabled = false; btn.textContent = 'Finalize quotation';
    await qcAfterSave(newNo);
  } catch (e) {
    qcMsg(e.message || 'Could not save.', false);
    btn.disabled = false; btn.textContent = 'Finalize quotation';
  }
}

/* A175 — the history is on this same page now, so a finished quotation refreshes the list in place
   and opens its review, instead of reloading the whole page to get there. */
async function qcAfterSave(no) {
  try {
    if (typeof loadQuotations === 'function') await loadQuotations();
    if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { /* the list has its own error state */ }
  qcResetForm();
  qcToggleCreate(false);
  try { if (typeof openReviewModal === 'function') openReviewModal(no); } catch (e) { /* review is a bonus */ }
}

/* A176 — the document half of the old PDF dialog: re-render this quotation's PDF and refile it,
   touching nothing else. No updateQuotation, so the A119 status gate is never hit and this works at
   any status for any role — which is what lets an approver clear the A123 stale/unverified block on
   a Pending quotation they are not allowed to edit. */
async function qcRegenerateOnly() {
  const btn = document.getElementById('qcFinalizeBtn');
  if (!qcQuotationNo) { qcMsg('No quotation is loaded.', false); return; }
  btn.disabled = true; btn.textContent = 'Generating PDF…';
  try {
    const photoWarn = await qcSavePdf(qcQuotationNo);
    qcMsg('The document for ' + qcQuotationNo + ' has been rebuilt and filed to Drive.'
        + (photoWarn ? ' Note: ' + photoWarn + ' — the document itself is fine.' : ''), true);
    btn.disabled = false; btn.textContent = 'Regenerate & file PDF';
    await qcAfterSave(qcQuotationNo);
  } catch (e) {
    qcMsg(e.message || 'Could not regenerate the document.', false);
    btn.disabled = false; btn.textContent = 'Regenerate & file PDF';
  }
}

async function qcAutoAddItems(items) {
  const known = new Set(qcInventory.map(i => String(i.itemNo || '').toLowerCase()));
  for (const it of items) {
    const no = String(it.itemNo || '').toLowerCase();
    if (!no || no === 'n/a' || known.has(no)) continue;
    try {
      await postFlow('addInventoryItem', { itemNo: it.itemNo, description: it.itemName,
        balance: 0, currency: 'PHP', type: 'Catalog' });
    } catch (e) { /* "already exists" is fine */ }
  }
}

/* Render the real document with photos and file it to Drive, stamped so A123's staleness check has
   something to compare the record against.

   A173 — build BOTH from the saved record, never from the browser's copy. On the from-PR path the
   server rebuilds every line itself from PricingRequestItems and dates the quotation with its own
   clock, so the browser's version can differ in the item fields it carries (uom, the requested-vs-
   offered pair) and almost certainly differs in date format. Stamping the browser's version would
   describe something the record does not contain — and A123 compares the two, so a brand-new
   quotation would be flagged out of date and its approval blocked on the spot. */
async function qcSavePdf(no) {
  /* A178 — never build the document while the archived photos are still loading, and never build it
     at all if that load failed. Both cases would file a PDF missing photos the record really has,
     over the top of the good one. The button is already gated; this closes the programmatic path. */
  if (qcPhotoLoad) { try { await qcPhotoLoad; } catch (e) { /* qcLoadPhotos already reported it */ } }
  if (qcPhotoFailed) {
    throw new Error('Refusing to refile the PDF — the saved product photos could not be read back, so '
      + 'the new document would lose them. Reload the page and reopen this quotation.');
  }

  const payload = qcPayload(true);
  payload.quotationNo = no;

  // Attach-PDFs ride only on the real save — they are base64 documents, far too heavy for a preview
  // that re-posts on every pause in typing. The server appends them after the quotation's last page.
  const brFiles = Array.from((document.getElementById('qcBrochures') || {}).files || []);
  if (brFiles.length && typeof fileToDataURL === 'function') {
    try { payload.brochures = await Promise.all(brFiles.map(fileToDataURL)); }
    catch (e) { throw new Error('Could not read an attached PDF — ' + (e.message || 'unsupported file')); }
  }

  /* A179 — declared HERE, not down beside the stamp where they used to live. The record's date has
     to be formatted the moment it is read (below), and a `const` referenced above its declaration is
     in its temporal dead zone — that throws a ReferenceError, and since this function is awaited by
     both qcFinalize and qcRegenerateOnly it would break every save and every regenerate. Having them
     early also retires the inline `typeof flowNum === 'function' ? …` forms that only existed because
     `num` was not yet in scope. */
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const dt = (typeof flowDate === 'function') ? flowDate : (d => String(d || '').slice(0, 10));

  let rec = null;
  try {
    const r = await fetchFlow('getQuotations', {}, { fresh: true });
    rec = ((r && r.data) || []).find(q => String(q.quotationNo) === String(no)) || null;
  } catch (e) { /* fall back to the local copy below */ }

  /* A178 — re-attaching the photos to the record's lines. Two bugs lived here:
       · the fallback array was COMPACTED (only rows that had a photo), so on the ?fromPR path — where
         the server mints its own line keys and every keyed lookup misses — a photo on row 3 of 3 was
         filed onto row 1;
       · it read raw qcItems rather than the filtered set actually written, so a single blank row
         above a photographed one shifted everything by one even on a direct create.
     The server owns the keys, so match on those first and fall back to the i-th ROW, never the i-th
     photo — and only when the two lists genuinely correspond. */
  const priced = qcItems.filter(i => (i.itemNo || i.itemName));
  const recKeys = rec ? (rec.items || []).map(it => String(it.lineKey || '')) : [];
  const alignable = !!rec && recKeys.length === priced.length && recKeys.every(k => !!k);
  if (rec) {
    const photoByKey = {};
    priced.forEach(i => { if (i.imageDataUrl) photoByKey[String(i.lineKey)] = i.imageDataUrl; });
    payload.customer = rec.customer || payload.customer;
    /* A179 — format it. Sheets hands back a Manila-midnight datetime, so the raw value is an ISO
       timestamp ('2026-07-28T16:00:00.000Z'); the route prints the string it is given, so the client's
       document read "Date 2026-07-28T16:00:00.000Z" — with a time, and a day early. */
    payload.date = dt(rec.date) || payload.date;
    payload.discountPct = num(rec.discountPct) || 0;
    payload.doc.subject = rec.subject || payload.doc.subject;
    /* A205 — regenerating from the STORED record, so the options come from the record too. Miss this
       and the filed PDF silently loses its alternative-offers layout, leaving the copy in Drive
       different from the one the client was shown. */
    payload.recommendedOption = String(rec.recommendedOption || '').trim();
    /* A240 — the three per-line facts that do NOT live in QuotationItems: this item's scope of
       supply, its note blocks, and whether its price prints. They ride in Layout JSON, so rebuilding
       payload.items from `rec.items` alone drops all three — the filed and reviewed PDF loses the
       scope blocks entirely and prints every hidden price. That is the SAME failure the A205 comment
       two lines above records, in the same function, for the same reason.

       Sourced from the RECORD's own layout first, which is what this function is documented to do
       (A173: build from the saved record, never the browser's copy) and is correct here because the
       save that precedes this call has already written it. The browser's line is the fallback, by key
       and then by position — identical to the photo logic below, and it is what covers the ?fromPR
       path, where the server mints its own line keys and every keyed lookup misses. */
    const layByKey = {};
    try {
      const _lay = JSON.parse(rec.layoutJson || '{}');
      (Array.isArray(_lay.itemScopes) ? _lay.itemScopes : []).forEach(e => {
        if (e && e.k) layByKey[String(e.k)] = e;
      });
      /* A241 — the design comes from the RECORD, not from this browser's state. Regenerating an old
         quotation must reproduce the document its client already holds, even if the tab happens to
         have a newer one loaded; the save that precedes a finalize has already stamped v:2, so the
         freshly-saved case reads 2 from here anyway. */
      payload.designVersion = Number(_lay.v) || 1;
    } catch (e) { /* a record with no or broken layout simply has no per-line detail */ }
    const localByKey = {};
    priced.forEach(i => { localByKey[String(i.lineKey)] = i; });

    payload.items = (rec.items || []).map((it, i) => {
      const lay = layByKey[String(it.lineKey)];
      const loc = localByKey[String(it.lineKey)] || (alignable ? priced[i] : null);
      return {
        itemNo: it.itemNo || 'N/A', itemName: it.itemName || it.itemNo,
        qty: num(it.qty) || 0,
        price: num(it.price) || 0,
        description: it.itemName || '',
        uom: it.uom || '',
        optionNo: String(it.optionNo || '').trim(),           // A205
        // A86: the pairing the customer sees — what they asked for, then OUR OFFER
        origItemNo: it.origItemNo || '', origItemName: it.origItemName || '',
        scope: lay ? String(lay.s || '') : String((loc && loc.scope) || ''),
        group: lay ? String(lay.g || '') : String((loc && loc.group) || ''),   // A241
        blocks: lay ? (Array.isArray(lay.blocks) ? lay.blocks : [])
                    : ((loc && Array.isArray(loc.blocks)) ? loc.blocks : []),
        hidePrice: lay ? !!lay.hide : !!(loc && loc.hidePrice),
        imageDataUrl: photoByKey[String(it.lineKey)]
                      || (alignable ? (priced[i].imageDataUrl || '') : '')
      };
    });
  }
  const res = await fetch('/flow/quotation-pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('The quotation saved, but the PDF could not be generated. Open it and use Generate PDF.');
  const blob = await res.blob();
  const b64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
  /* A173 — this MUST be byte-identical to what flow-quotations.js `qPdfStamp` builds, because
     `qPdfState` compares the two with JSON.stringify. That makes both the KEY ORDER and the exact
     value formatting load-bearing: a raw date instead of flowDate(), or a missing vatOption, and
     every quotation created here is flagged stale the moment it is saved — which blocks its
     approval. Key order below deliberately mirrors qPdfStamp field for field.
     A179 — `num`/`dt` are declared above the record fetch now; see the note there. */
  const src = rec || { customer: payload.customer, date: payload.date, subject: payload.doc.subject,
                       discountPct: payload.discountPct, items: payload.items.map(i => ({
                         itemNo: i.itemNo, qty: i.qty, price: i.price })) };
  const stamp = {
    v: 1, doc: payload.doc, vatOption: payload.vatOption, descMode: payload.descMode || 'long',
    /* A178 — same rows the document was built from. Its MEANING changed too: it used to warn "you
       must re-attach these by hand", which is no longer true now that photos are archived and read
       back. The stamp's shape and key order are untouched, so A123's comparison is unaffected. */
    hasImages: priced.some(i => !!i.imageDataUrl),
    stamp: {
      customer: String(src.customer || ''), date: dt(src.date) || '',
      subject: String(src.subject || ''), discountPct: num(src.discountPct) || 0,
      vatOption: payload.vatOption || '',
      items: (src.items || []).map(it => `${it.itemNo}|${num(it.qty)}|${num(it.price)}`)
    }
  };
  await postFlow('saveQuotationPDF', {
    quotationNo: no, fileName: 'Quotation_' + no + '.pdf',
    pdfBase64: b64, pdfData: JSON.stringify(stamp)
  });

  /* A178 — archive the photos AFTER the document is filed, so a Drive hiccup here can never cost the
     deliverable. Returns a warning string for the caller to append to its success message. */
  try { return await qcSyncPhotos(no, recKeys, priced, alignable); }
  catch (e) { return 'a product photo could not be archived'; }
}

/* A178 — keep Drive in step with the item rows, so reopening this quotation reproduces its document.

   Idempotent by construction: a photo that was read back from Drive and not touched this session has
   an entry in qcPhotoDocs and none in qcPhotoDirty, so it is skipped — an unedited regenerate performs
   zero writes while the bytes still ride into the PDF. */
async function qcSyncPhotos(no, recKeys, priced, alignable) {
  let warn = '';
  let badKey = false;
  const jobs = [];
  const seen = {};

  priced.forEach((row, i) => {
    // The server's key wins when the two lists correspond — on the ?fromPR path the browser's keys
    // were never stored, so filing under them would orphan the photo on the next reopen.
    const k = String((alignable && recKeys[i]) || row.lineKey || '');
    if (!k) return;                      // a legacy line with no key at all: nothing to file it under
    /* _photoLineKey parses /^photo-([A-Za-z0-9]+)\./ back out of the filename, so a key carrying a
       dash or an underscore would upload fine and then be unreadable forever. Refuse instead. */
    if (!/^[A-Za-z0-9]+$/.test(k)) { badKey = true; return; }
    seen[k] = true;
    const stored = qcPhotoDocs[k];
    const dirty = !!qcPhotoDirty[String(row.lineKey)] || !!qcPhotoDirty[k];
    if (row.imageDataUrl && (!stored || dirty)) {
      jobs.push({ put: k, dataUrl: row.imageDataUrl, old: stored && stored.docId });
    } else if (!row.imageDataUrl && stored) {
      jobs.push({ del: k, old: stored.docId });
    }
  });

  /* A178 — a line that was deleted (or dropped on an edit) leaves its photo on Drive forever, and a
     later quotation could never reach it. Sweep those, but ONLY when the record and the rows provably
     correspond: acting on a stale or partial `rec` here would trash photos that are still in use. This
     is the one branch in the change that deletes anything, so it is the most heavily guarded. */
  if (alignable) {
    Object.keys(qcPhotoDocs).forEach(k => {
      if (!seen[k]) jobs.push({ del: k, old: qcPhotoDocs[k].docId });
    });
  }

  if (!jobs.length) return badKey ? 'a line has an unusable line key, so its photo was not archived' : '';

  const btn = document.getElementById('qcFinalizeBtn');
  const label = btn ? btn.textContent : '';
  for (let n = 0; n < jobs.length; n++) {
    const j = jobs[n];
    if (btn) btn.textContent = 'Filing photo ' + (n + 1) + ' of ' + jobs.length + '…';
    try {
      if (j.put) {
        const mime = (String(j.dataUrl).match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
        const b64 = String(j.dataUrl).split(',')[1] || '';
        const r = await postFlow('addDocument', {
          module: 'Quotation', refNo: no, docType: 'Item Photo',
          fileName: 'photo-' + j.put + '.' + (mime === 'image/png' ? 'png' : 'jpg'),
          fileBase64: b64, mimeType: mime
        });
        if (!r || !r.success) { warn = 'a product photo could not be archived'; continue; }
        qcPhotoDocs[j.put] = { docId: r.docId };
        qcPhotoDirty[j.put] = false;
        /* Add first, delete second — never the reverse. If the add failed after a delete, the line
           would have no photo on Drive at all; this way the worst case is a duplicate, which the next
           reopen trashes. */
        if (j.old) await postFlow('deleteDocument', { docId: j.old });
      } else {
        await postFlow('deleteDocument', { docId: j.old });
        delete qcPhotoDocs[j.del];
      }
    } catch (e) { warn = 'a product photo could not be archived'; }
  }
  if (btn && label) btn.textContent = label;
  if (badKey && !warn) warn = 'a line has an unusable line key, so its photo was not archived';
  return warn;
}

/* A178 — legacy quotations (56 of 57 live ones) have item rows with no Line Key, and the key is what a
   photo is filed under. Rather than write to every old record on sight, mint the keys only when a rep
   actually attaches a photo to one. reorderQuotationItems is the purpose-built action for it: it mints
   missing keys in place, is idempotent, and rewrites rows column-for-column from the schema so it
   cannot drop a column. Passing the CURRENT order makes it a key-backfill and nothing more. */
async function qcEnsureLineKeys() {
  if (!qcQuotationNo) return false;              // a brand-new quotation gets its keys on create
  let stored = [];
  try {
    const r = await fetchFlow('getQuotations', {}, { fresh: true });
    const rec = ((r && r.data) || []).find(q => String(q.quotationNo) === String(qcQuotationNo));
    stored = (rec && rec.items) || [];
  } catch (e) { return false; }
  if (!stored.length || stored.every(it => String(it.lineKey || '').trim())) return false;
  try {
    const order = stored.map(it => String(it.lineKey || '')).filter(Boolean);
    const res = await postFlow('reorderQuotationItems', {
      quotationNo: qcQuotationNo, order: JSON.stringify(order.length ? order : ['__mint__'])
    });
    if (!res || !res.success) return false;
    // Re-read so the browser's rows carry the keys that were just persisted.
    const r2 = await fetchFlow('getQuotations', {}, { fresh: true });
    const rec2 = ((r2 && r2.data) || []).find(q => String(q.quotationNo) === String(qcQuotationNo));
    const keys = ((rec2 && rec2.items) || []).map(it => String(it.lineKey || ''));
    if (keys.length === qcItems.length && keys.every(Boolean)) {
      qcItems.forEach((row, i) => {
        const oldKey = String(row.lineKey);
        if (oldKey !== keys[i]) {
          if (qcPhotoDirty[oldKey]) { qcPhotoDirty[keys[i]] = true; delete qcPhotoDirty[oldKey]; }
          row.lineKey = keys[i];
        }
      });
      qcRenderItems();
    }
    return true;
  } catch (e) { return false; }
}


/* A218 — who can a quotation belong to.
 *
 * The roster comes from the user directory rather than a hard-coded list, so a new hire needs no
 * code change. `pick` is the owner to select; the signed-in user is the default, which is right for
 * the common case of filing your own deal. The current value is always present as an option even if
 * the roster call fails or that person has since left — otherwise opening an old quotation would
 * silently reassign it to whoever happens to be first in the list on the next save. */
async function qcFillSalespeople(pick) {
  const sel = document.getElementById('qcSalesperson');
  if (!sel) return;
  const want = String(pick || qcSession.name || '');
  let names = [];
  try {
    const r = await apiGetUsers();
    names = ((r && r.data) || [])
      .filter(u => ['sales', 'admin', 'director', 'management'].indexOf(String(u.role || '').toLowerCase()) !== -1)
      .map(u => String(u.name || u.fullName || u.username || '').trim())
      .filter(Boolean);
  } catch (e) { names = []; }
  [qcSession.name, want].forEach(n => { if (n && names.indexOf(n) === -1) names.push(n); });
  names = Array.from(new Set(names)).sort();
  sel.innerHTML = names.map(n =>
    `<option value="${flowEsc(n)}"${n === want ? ' selected' : ''}>${flowEsc(n)}</option>`).join('');
}
