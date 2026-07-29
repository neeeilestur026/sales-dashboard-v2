/* flow-quote-configurator.js — A172 Quote Configurator (director sandbox).
 *
 * The preview on the right is the REAL PDF from /flow/quotation-pdf, not an HTML lookalike.
 * That is deliberate: a hand-built replica would run a second layout engine alongside ReportLab and
 * the two would disagree about where a page ends — so the preview would confidently lie about the
 * exact thing (an orphaned signature block) it exists to catch. Rendering the real document costs a
 * round trip; the numbers below it update instantly in JS so the page still feels live.
 */

let qcSession = null;
let qcItems = [];                 // [{ lineKey, itemNo, itemName, qty, price, imageDataUrl }]
let qcSeq = 0;                    // monotonic — a slow response from an older edit must never win
let qcAbort = null;
let qcTimer = null;
let qcLastUrl = '';               // object URL currently in the iframe (revoked on replace)
let qcPhotoTarget = -1;
let qcQuotationNo = '';           // set once finalized, so a second finalize updates instead of duplicating

const QC_VAT_PCT = 0.12;
const QC_DEBOUNCE = 500;
const QC_WAKE_AFTER = 4000;       // Render's free tier sleeps; say so rather than spin silently

document.addEventListener('DOMContentLoaded', async () => {
  qcSession = requireDirector();
  if (!qcSession) return;
  renderNavbar('flow-quote-configurator');

  document.getElementById('qcDate').value = (typeof flowToday === 'function')
    ? flowToday() : new Date().toISOString().slice(0, 10);

  qcPrefillDoc();
  qcAddRow();
  qcBindInputs();
  qcRenderTotals();

  document.getElementById('qcPhotoInput').addEventListener('change', qcPhotoChosen);
});

/* Doc fields are remembered per user by the existing quotation dialog — reuse the same store so a
   director who has generated a quotation before doesn't retype their signature block. */
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
  set('qcAddress', d.address || '');
}

function qcBindInputs() {
  ['qcNo', 'qcDate', 'qcCustomer', 'qcSubject', 'qcDiscount', 'qcVat', 'qcTemplate', 'qcPhotos',
   'qcAddress', 'qcAttention', 'qcDesignation', 'qcEmail', 'qcRfq', 'qcValidity', 'qcDelivery',
   'qcPayment', 'qcWarranty', 'qcSigName', 'qcSigDesignation', 'qcSigMobile', 'qcSigEmail']
    .forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', qcOnChange);
      el.addEventListener('change', qcOnChange);
    });
}

function qcOnChange() { qcRenderTotals(); qcSchedulePreview(); }

// ── items ───────────────────────────────────────────────────────────────────

function qcLineKey() {
  return 'LK' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

function qcAddRow(item) {
  const it = Object.assign({ lineKey: qcLineKey(), itemNo: '', itemName: '', qty: 1, price: 0, imageDataUrl: '' }, item || {});
  qcItems.push(it);
  qcRenderItems();
  qcOnChange();
}

function qcRemoveRow(key) {
  qcItems = qcItems.filter(i => i.lineKey !== key);
  if (!qcItems.length) qcAddRow(); else { qcRenderItems(); qcOnChange(); }
}

function qcRenderItems() {
  const esc = (typeof flowEsc === 'function') ? flowEsc : (s => String(s == null ? '' : s));
  document.getElementById('qcItemBody').innerHTML = qcItems.map(i => `
    <tr data-key="${esc(i.lineKey)}">
      <td><input type="text" value="${esc(i.itemNo)}" oninput="qcSet('${esc(i.lineKey)}','itemNo',this.value)"></td>
      <td><input type="text" value="${esc(i.itemName)}" oninput="qcSet('${esc(i.lineKey)}','itemName',this.value)"></td>
      <td class="num"><input type="number" min="0" step="any" value="${i.qty}" oninput="qcSet('${esc(i.lineKey)}','qty',this.value)"></td>
      <td class="num"><input type="number" min="0" step="any" value="${i.price}" oninput="qcSet('${esc(i.lineKey)}','price',this.value)"></td>
      <td><button class="btn btn-secondary btn-sm qc-photo-btn ${i.imageDataUrl ? 'qc-photo-on' : ''}"
            onclick="qcPickPhoto('${esc(i.lineKey)}')">${i.imageDataUrl ? '✓ photo' : '+ photo'}</button></td>
      <td><button class="qc-del" onclick="qcRemoveRow('${esc(i.lineKey)}')" title="Remove line">✕</button></td>
    </tr>`).join('');
}

function qcSet(key, field, value) {
  const it = qcItems.find(i => i.lineKey === key);
  if (!it) return;
  it[field] = (field === 'qty' || field === 'price') ? (parseFloat(value) || 0) : value;
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
  if (file.size > 5 * 1024 * 1024) { qcMsg('That image is over 5MB — pick a smaller one.', false); return; }
  try {
    it.imageDataUrl = await qcDownscale(file, 900, 0.85);
    qcRenderItems();
    qcOnChange();
  } catch (e) { qcMsg('Could not read that image.', false); }
}

/* Downscale before sending — a phone photo is several MB and the PDF only prints it at thumbnail size. */
function qcDownscale(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width: w, height: h } = img;
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
/* Mirrors build_summary_table in flow_quotation_pdf.py: discount comes off the pre-VAT subtotal,
   then VAT applies to the net. Keep these in step if that ever changes. */
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
  const m = (n) => (typeof flowMoney === 'function') ? flowMoney(n, 'PHP') : ('PHP ' + n.toFixed(2));
  const label = t.opt === 'inclusive' ? 'Total (VAT Inclusive)'
              : t.opt === 'zero' ? 'Total (Zero-Rated)' : 'Total (VAT Exclusive)';
  let html = `<div class="row"><span>Subtotal (VAT Exclusive)</span><span class="v">${m(t.gross)}</span></div>`;
  if (t.pct > 0) html += `<div class="row disc"><span>Less: Discount (${t.pct}%)</span><span class="v">− ${m(t.discount)}</span></div>`;
  if (t.pct > 0) html += `<div class="row"><span>Net</span><span class="v">${m(t.net)}</span></div>`;
  if (t.opt === 'inclusive') html += `<div class="row"><span>VAT (12%)</span><span class="v">${m(t.vat)}</span></div>`;
  html += `<div class="row grand"><span>${label}</span><span class="v">${m(t.grand)}</span></div>`;
  document.getElementById('qcTotals').innerHTML = html;
}

// ── the live document ───────────────────────────────────────────────────────

function qcPayload() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const num = (typeof flowNum === 'function') ? flowNum : (v => parseFloat(v) || 0);
  const showPhotos = val('qcPhotos') !== 'off';
  return {
    quotationNo: val('qcNo') || 'PREVIEW',
    customer: val('qcCustomer'),
    date: val('qcDate'),
    vatOption: val('qcVat'),
    discountPct: num(val('qcDiscount')),
    layout: val('qcTemplate'),
    photos: showPhotos,
    items: qcItems
      .filter(i => (i.itemNo || i.itemName))
      .map(i => ({
        itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
        qty: num(i.qty), price: num(i.price),
        description: i.itemName || '', uom: 'pc(s)',
        imageDataUrl: showPhotos ? (i.imageDataUrl || '') : ''
      })),
    doc: {
      address: val('qcAddress'), attention: val('qcAttention'), designation: val('qcDesignation'),
      email: val('qcEmail'), subject: val('qcSubject'), rfqNo: val('qcRfq'),
      validity: val('qcValidity'), delivery: val('qcDelivery'), payment: val('qcPayment'),
      warranty: val('qcWarranty'), sigName: val('qcSigName'), sigDesignation: val('qcSigDesignation'),
      sigMobile: val('qcSigMobile'), sigViber: val('qcSigMobile'), sigEmail: val('qcSigEmail')
    }
  };
}

function qcReady() {
  const p = qcPayload();
  return !!(p.customer && p.items.length);
}

function qcSchedulePreview() {
  clearTimeout(qcTimer);
  qcTimer = setTimeout(qcRenderPreview, QC_DEBOUNCE);
}

function qcState(text, kind) {
  document.getElementById('qcState').textContent = text;
  const dot = document.getElementById('qcDot');
  dot.className = 'qc-dot' + (kind ? ' ' + kind : '');
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

  // Render's free tier sleeps after 15 minutes — a silent 40-second spinner reads as broken.
  const wakeTimer = setTimeout(() => {
    if (seq === qcSeq && !document.getElementById('qcWake')) {
      const n = document.createElement('div');
      n.className = 'qc-wake'; n.id = 'qcWake';
      n.textContent = 'waking the server — first render after a quiet spell takes a moment';
      wrap.appendChild(n);
    }
  }, QC_WAKE_AFTER);

  try {
    const res = await fetch('/flow/quotation-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(qcPayload()),
      signal: qcAbort ? qcAbort.signal : undefined
    });
    if (seq !== qcSeq) return;                    // a newer edit already went out — discard this one
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
  const el = document.getElementById('qcMsg');
  el.innerHTML = `<div style="margin:.5rem 0 1rem;padding:.6rem .85rem;border-radius:10px;font-size:.86rem;
    background:${good ? '#ecfdf5' : '#fef2f2'};color:${good ? '#065f46' : '#991b1b'};
    border:1px solid ${good ? '#a7f3d0' : '#fecaca'};">${(typeof flowEsc === 'function' ? flowEsc(text) : text)}</div>`;
}

async function qcFinalize() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const btn = document.getElementById('qcFinalizeBtn');
  if (!val('qcNo').trim()) { qcMsg('Quotation No is required — it is your own code, not auto-generated.', false); return; }
  if (!val('qcCustomer').trim()) { qcMsg('Customer is required.', false); return; }
  if (!val('qcSubject').trim()) { qcMsg('Subject is required — it prints on the document.', false); return; }
  const priced = qcItems.filter(i => (i.itemNo || i.itemName));
  if (!priced.length) { qcMsg('Add at least one item.', false); return; }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const layoutJson = JSON.stringify({
      template: val('qcTemplate'), photos: val('qcPhotos') !== 'off',
      blocks: { scope: false, exclusions: false, options: false }
    });
    const items = priced.map(i => ({
      itemNo: i.itemNo || 'N/A', itemName: i.itemName || i.itemNo,
      qty: (typeof flowNum === 'function' ? flowNum(i.qty) : +i.qty) || 0,
      price: (typeof flowNum === 'function' ? flowNum(i.price) : +i.price) || 0,
      uom: 'pc(s)', lineKey: i.lineKey
    }));

    let res;
    if (qcQuotationNo) {
      res = await postFlow('updateQuotation', {
        quotationNo: qcQuotationNo, newQuotationNo: val('qcNo').trim(), customer: val('qcCustomer').trim(),
        date: val('qcDate'), subject: val('qcSubject').trim(),
        discountPct: (typeof flowNum === 'function' ? flowNum(val('qcDiscount')) : +val('qcDiscount')) || 0,
        layoutJson: layoutJson, items: JSON.stringify(items)
      });
    } else {
      res = await postFlow('createQuotation', {
        quotationNo: val('qcNo').trim(), customer: val('qcCustomer').trim(), date: val('qcDate'),
        subject: val('qcSubject').trim(),
        discountPct: (typeof flowNum === 'function' ? flowNum(val('qcDiscount')) : +val('qcDiscount')) || 0,
        layoutJson: layoutJson, createdBy: qcSession.name, items: JSON.stringify(items),
        clientRef: (typeof flowClientRef === 'function') ? flowClientRef() : ('QC-' + Date.now())
      });
    }
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    qcQuotationNo = val('qcNo').trim();

    // Persist the doc block so the next quotation starts prefilled.
    try {
      if (typeof flowSaveDefaults === 'function') flowSaveDefaults('quotation', qcPayload().doc);
    } catch (e) { /* a defaults failure must never block the save */ }

    qcMsg('Quotation ' + qcQuotationNo + ' saved as Approved (director-created quotations skip the '
        + 'approval chain). It now appears on the Quotations page.', true);
  } catch (e) {
    qcMsg(e.message || 'Could not save.', false);
  } finally {
    btn.disabled = false; btn.textContent = 'Finalize quotation';
  }
}
