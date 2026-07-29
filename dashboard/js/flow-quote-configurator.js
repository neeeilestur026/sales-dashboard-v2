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
let qcItems = [];                 // [{ lineKey, itemNo, itemName, qty, price, uom, origItemNo, origItemName, itemId, vat, imageDataUrl }]
let qcSeq = 0;                    // monotonic — a slow response from an older edit must never win
let qcAbort = null;
let qcTimer = null;
let qcLastUrl = '';
let qcPhotoTarget = '';
let qcQuotationNo = '';           // set once saved, so a second Finalize updates instead of duplicating
let qcFromPr = '';                // the process-flow path
let qcLocked = false;             // items display-only (fromPR)
let qcInventory = [];             // for the admin free-type datalist

const QC_VAT_PCT = 0.12;
const QC_DEBOUNCE = 500;
const QC_WAKE_AFTER = 4000;       // Render's free tier sleeps; say so rather than spin silently

document.addEventListener('DOMContentLoaded', async () => {
  qcSession = requireQuotationAccess();
  if (!qcSession) return;
  qcRole = qcSession.role;
  renderNavbar('flow-quote-configurator');

  document.getElementById('qcDate').value = (typeof flowToday === 'function')
    ? flowToday() : new Date().toISOString().slice(0, 10);

  qcPrefillDoc();
  qcBindInputs();
  document.getElementById('qcPhotoInput').addEventListener('change', qcPhotoChosen);

  const prNo = new URLSearchParams(location.search).get('fromPR');
  if (prNo) {
    await qcLoadFromPR(prNo);
  } else {
    qcAddRow();
    if (qcRole === 'admin' || qcRole === 'director') qcLoadInventory();
  }
  qcRenderTotals();
});

/* Doc fields are remembered per user by the existing quotation dialog — reuse the same store so
   nobody retypes their signature block. */
function qcPrefillDoc() {
  let d = {};
  try { d = (typeof flowLoadDefaults === 'function' ? flowLoadDefaults('quotation') : {}) || {}; } catch (e) { d = {}; }
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('qcValidity', d.validity || '30 days');
  set('qcDelivery', d.delivery || '1-3 weeks upon receipt of order');
  set('qcPayment', d.payment || '30 days upon delivery and receipt of invoice');
  set('qcWarranty', d.warranty || '1 year');
  set('qcSigName', d.sigName || qcSession.name || '');
  set('qcSigDesignation', d.sigDesignation || '');
  set('qcSigMobile', d.sigMobile || '');
  set('qcSigEmail', d.sigEmail || '');
  set('qcScope', d.scope || '');
  set('qcExclusions', d.exclusions || '');
  set('qcOptions', d.options || '');
  ['Scope', 'Excl', 'Opts'].forEach((k, i) => {
    const src = [d.scope, d.exclusions, d.options][i];
    if (src) document.getElementById('qcBlk' + k).checked = true;
  });
  qcSyncBlocks();
}

function qcBindInputs() {
  ['qcNo', 'qcDate', 'qcCustomer', 'qcSubject', 'qcDiscount', 'qcVat', 'qcTemplate', 'qcPhotos',
   'qcAddress', 'qcAttention', 'qcDesignation', 'qcEmail', 'qcRfq', 'qcValidity', 'qcDelivery',
   'qcPayment', 'qcWarranty', 'qcSigName', 'qcSigDesignation', 'qcSigMobile', 'qcSigEmail',
   'qcScope', 'qcExclusions', 'qcOptions']
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
  qcLocked = true;
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
    // Prefill the client's contact block from what admin captured on the request.
    try {
      const dj = JSON.parse(pr.docJson || '{}');
      const set = (id, v) => { const el = document.getElementById(id); if (el && v && !el.value) el.value = v; };
      set('qcAddress', dj.companyAddress); set('qcAttention', dj.contactPerson);
      set('qcDesignation', dj.designation); set('qcEmail', dj.contactEmail);
      set('qcRfq', dj.prNumberClient || dj.rfqNo);
    } catch (e) { /* a PR without a doc block is fine */ }

    qcItems = included.map(i => ({
      lineKey: qcLineKey(), itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
      qty: (typeof flowNum === 'function' ? flowNum(i.qty) : +i.qty) || 0,
      price: (typeof flowNum === 'function' ? flowNum(i.finalPrice) : +i.finalPrice) || 0,
      uom: i.uom || '', origItemNo: i.origItemNo || '', origItemName: i.origItemName || '',
      itemId: i.itemId || '', vat: i.vat || '', imageDataUrl: ''
    }));
    if (!qcItems.length) { qcMsg('That request has no included items to quote.', false); return; }

    qcRenderItems();
    qcBanner('Building the quotation for <strong>' + (typeof flowEsc === 'function' ? flowEsc(qcFromPr) : qcFromPr)
      + '</strong>. Item prices are management’s and cannot be changed here — you set the quotation number, '
      + 'subject, discount and layout. Create it first, then edit the Draft if a line really must move.');
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
  qcItems.push(Object.assign({ lineKey: qcLineKey(), itemNo: '', itemName: '', qty: 1, price: 0,
    uom: '', origItemNo: '', origItemName: '', itemId: '', vat: '', imageDataUrl: '' }, item || {}));
  qcRenderItems();
  qcOnChange();
}

function qcRemoveRow(key) {
  if (qcLocked) return;
  qcItems = qcItems.filter(i => i.lineKey !== key);
  if (!qcItems.length) qcAddRow(); else { qcRenderItems(); qcOnChange(); }
}

function qcRenderItems() {
  const esc = (typeof flowEsc === 'function') ? flowEsc : (s => String(s == null ? '' : s));
  const ro = qcLocked ? ' disabled' : '';
  const title = qcLocked ? ' title="Set by management on the purchase request"' : '';
  document.getElementById('qcItemBody').innerHTML = qcItems.map(i => `
    <tr data-key="${esc(i.lineKey)}">
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
            onclick="qcPickPhoto('${esc(i.lineKey)}')">${i.imageDataUrl ? '✓ photo' : '+ photo'}</button></td>
      <td>${qcLocked ? '' : `<button class="qc-del" onclick="qcRemoveRow('${esc(i.lineKey)}')" title="Remove line">✕</button>`}</td>
    </tr>`).join('');
  const add = document.getElementById('qcAddBtn');
  if (add) add.style.display = qcLocked ? 'none' : '';
}

function qcSet(key, field, value) {
  if (qcLocked) return;
  const it = qcItems.find(i => i.lineKey === key);
  if (!it) return;
  it[field] = (field === 'qty' || field === 'price') ? (parseFloat(value) || 0) : value;
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
    qcRenderItems();
    qcOnChange();
  } catch (e) { qcMsg('Could not read that image.', false); }
}

function qcDownscale(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxPx || h > maxPx) { const s = Math.min(maxPx / w, maxPx / h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── live totals (instant, no server) ────────────────────────────────────────
/* Mirrors build_summary_table: the discount comes off the pre-VAT subtotal, then VAT applies to the
   net. Keep these in step if that ever changes. */
function qcTotals() {
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const gross = qcItems.reduce((s, i) => s + num(i.qty) * num(i.price), 0);
  const pct = Math.min(100, Math.max(0, num(document.getElementById('qcDiscount').value)));
  const discount = gross * pct / 100;
  const net = gross - discount;
  const opt = document.getElementById('qcVat').value;
  const vat = opt === 'inclusive' ? net * QC_VAT_PCT : 0;
  return { gross, pct, discount, net, vat, grand: net + vat, opt };
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
  document.getElementById('qcTotals').innerHTML = html;
}

// ── the live document ───────────────────────────────────────────────────────

/* withImages=false for the preview. Base64 photos are hundreds of KB each and the preview re-posts on
   every pause in typing — five photos would mean ~1.5MB per keystroke burst, which is punishing on a
   free-tier server. The thumbnail placeholder shows the layout just as well; the real photos go up
   once, on Finalize. */
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
    layout: val('qcTemplate'),
    photos: showPhotos,
    items: qcItems.filter(i => (i.itemNo || i.itemName)).map(i => ({
      itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
      qty: num(i.qty), price: num(i.price),
      description: i.itemName || '',
      uom: i.uom || '',                                  // A147: never force "pc(s)"
      origItemNo: i.origItemNo || '', origItemName: i.origItemName || '',   // A86 pairing
      imageDataUrl: (showPhotos && withImages) ? (i.imageDataUrl || '') : ''
    })),
    doc: {
      address: val('qcAddress'), attention: val('qcAttention'), designation: val('qcDesignation'),
      email: val('qcEmail'), subject: val('qcSubject'), rfqNo: val('qcRfq'),
      validity: val('qcValidity'), delivery: val('qcDelivery'), payment: val('qcPayment'),
      warranty: val('qcWarranty'), sigName: val('qcSigName'), sigDesignation: val('qcSigDesignation'),
      sigMobile: val('qcSigMobile'), sigViber: val('qcSigMobile'), sigEmail: val('qcSigEmail'),
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

  try {
    const res = await fetch('/flow/quotation-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(qcPayload(false)),
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
  return JSON.stringify({
    template: val('qcTemplate'), photos: val('qcPhotos') !== 'off',
    blocks: { scope: on('qcBlkScope'), exclusions: on('qcBlkExcl'), options: on('qcBlkOpts') },
    scope: val('qcScope'), exclusions: val('qcExclusions'), options: val('qcOptions')
  });
}

async function qcFinalize() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const btn = document.getElementById('qcFinalizeBtn');
  if (!val('qcNo').trim()) { qcMsg('Quotation No is required — it is your own code, not auto-generated.', false); return; }
  if (!val('qcSubject').trim()) { qcMsg('Subject is required — it prints on the document.', false); return; }
  if (!qcFromPr && !val('qcCustomer').trim()) { qcMsg('Customer is required.', false); return; }
  const priced = qcItems.filter(i => (i.itemNo || i.itemName));
  if (!priced.length) { qcMsg('Add at least one item.', false); return; }

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
        discountPct: Math.min(100, Math.max(0, num(val('qcDiscount')))),
        clientRef: (typeof flowClientRef === 'function') ? flowClientRef() : ('QC-' + Date.now())
      };
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
        qcMsg('That request was already quoted as ' + newNo + ' — revise that quotation rather than creating another.', true);
        setTimeout(() => { location.href = 'flow-quotations.html?review=' + encodeURIComponent(newNo); }, 1600);
        return;
      }
      // layout is presentation, so it saves separately and is not blocked by the status gate
      try { await postFlow('updateQuotation', { quotationNo: newNo, layoutJson: qcLayoutJson() }); } catch (e) {}
    } else {
      const items = priced.map(i => ({
        itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
        qty: num(i.qty), price: num(i.price), uom: i.uom || '',
        origItemNo: i.origItemNo || '', origItemName: i.origItemName || '',
        itemId: i.itemId || '', vat: i.vat || '', lineKey: i.lineKey
      }));
      const common = {
        customer: val('qcCustomer').trim(), date: val('qcDate'), subject: val('qcSubject').trim(),
        discountPct: Math.min(100, Math.max(0, num(val('qcDiscount')))),
        layoutJson: qcLayoutJson(), items: JSON.stringify(items)
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
    await qcSavePdf(newNo);

    qcMsg('Quotation ' + newNo + ' saved' + (qcFromPr ? ' and ' + qcFromPr + ' is now Quoted' : '')
        + '. The PDF is filed to Drive.', true);
    setTimeout(() => { location.href = 'flow-quotations.html?review=' + encodeURIComponent(newNo); }, 1400);
  } catch (e) {
    qcMsg(e.message || 'Could not save.', false);
    btn.disabled = false; btn.textContent = 'Finalize quotation';
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
   something to compare the record against. */
async function qcSavePdf(no) {
  const payload = qcPayload(true);
  payload.quotationNo = no;
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
  const stamp = {
    v: 1, doc: payload.doc, vatOption: payload.vatOption, descMode: 'short',
    hasImages: qcItems.some(i => !!i.imageDataUrl),
    stamp: {
      customer: payload.customer, date: payload.date, subject: payload.doc.subject,
      discountPct: payload.discountPct,
      items: payload.items.map(i => [i.itemNo, i.qty, i.price].join('|'))
    }
  };
  await postFlow('saveQuotationPDF', {
    quotationNo: no, fileName: 'Quotation_' + no + '.pdf',
    pdfBase64: b64, pdfData: JSON.stringify(stamp)
  });
}
