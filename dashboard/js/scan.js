/* A316 — the warehouse scanner (scan.html).
 *
 * RECEIVE: pick an open purchase order, scan each box, post the receiving. The server
 * (receiveByScan) checks every line against what is still open on the PO, prices it from the PO and
 * posts it through the same createReceiving the desktop Receiving page uses — same landed cost,
 * journal, document and payment checks. A login that may count but not post (warehouse) saves the
 * count instead (saveScanCount); accounting opens the same PO and finds it filled in.
 * DISPATCH: pick a sales order, scan what leaves, save it (dispatchByScan). Record only: stock still
 * leaves at invoicing, so nothing is deducted twice.
 *
 * WHAT A SCAN MEANS. Our own labels carry HXI:<Item ID>. Anything else is a supplier barcode, looked up
 * among the barcodes already tied to the document's items; an unknown one is tied to an item once
 * (linkBarcode) and counts from then on, on every phone. A code for an item that is not on the
 * document, or one more than is still open, is refused with a buzz — and the server refuses it again.
 *
 * NOTHING IS LOST. The count is kept on the phone per document (localStorage) after every scan, so a
 * reload, a dead zone or a flat battery costs nothing; one clientRef per count makes a retry safe.
 */
(function () {
  const HTML5QR_CDN = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
  const MIN_VERSION = 158;
  const COOLDOWN_MS = 1200;           // the camera reads a code many times a second; one box, one count
  const S = { session: null, canPost: false, mode: 'receive', docs: [], doc: null, lines: [], counts: {}, codes: {},
              ref: '', pending: null, cam: null, last: { code: '', at: 0 }, ready: false };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => hxEsc(v);
  const num = (v) => hxNum(v);
  const fmt = (n) => (Math.round(num(n) * 100) / 100).toLocaleString('en-PH');
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

  /* ── feedback ─────────────────────────────────────────────────────────────────────────────── */
  let audio = null;
  function tone(ok) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = ok ? 1046 : 196; o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.08; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
    } catch (e) { /* no audio — the flash still says it */ }
    try { if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]); } catch (e) {}
  }
  function flash(text, kind) {
    const el = $('scFlash');
    if (!el) return;
    el.textContent = text;
    el.className = 'sc-flash ' + (kind || '');
  }
  function banner(text) { const b = $('scBanner'); if (!b) return; b.textContent = text || ''; b.hidden = !text; }

  /* ── the count, kept on the phone ─────────────────────────────────────────────────────────── */
  const draftKey = () => 'hx_scan_v1_' + S.mode + '_' + (S.doc ? S.doc.docNo : '');
  function saveDraft() {
    if (!S.doc) return;
    try {
      if (!Object.keys(S.counts).some(k => S.counts[k] > 0)) { localStorage.removeItem(draftKey()); return; }
      localStorage.setItem(draftKey(), JSON.stringify({ counts: S.counts, codes: S.codes, ref: S.ref, at: Date.now() }));
    } catch (e) { /* private mode — the count still lives in memory */ }
  }
  function loadDraft() {
    try { const d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); return d && d.counts ? d : null; } catch (e) { return null; }
  }
  function dropDraft() { try { localStorage.removeItem(draftKey()); } catch (e) {} }
  function ref() { if (!S.ref) S.ref = (typeof flowClientRef === 'function') ? flowClientRef() : ('CR-' + Date.now()); return S.ref; }

  /* ── what a code means on this document ───────────────────────────────────────────────────── */
  const open = (l) => Math.max(0, num(l.remaining) - num(S.counts[l.line]));
  function candidates(code) {
    const c = String(code || '').trim();
    if (/^HXI:/i.test(c)) {
      const id = c.slice(4).trim();
      return { own: true, itemId: id, lines: S.lines.filter(l => l.itemId && l.itemId === id) };
    }
    return { own: false, lines: S.lines.filter(l => (l.codes || []).indexOf(c) !== -1 || (S.codes[l.line] || []).indexOf(c) !== -1) };
  }
  /** One scan. Returns 'ok' | 'unknown' | 'notOnDoc' | 'complete' | 'ignored'. */
  function scan(code, viaCamera) {
    const c = String(code || '').trim();
    if (!c || !S.doc) return 'ignored';
    const now = Date.now();
    if (viaCamera && c === S.last.code && now - S.last.at < COOLDOWN_MS) return 'ignored';
    S.last = { code: c, at: now };
    const k = candidates(c);
    if (!k.lines.length) {
      if (k.own) { tone(false); flash(c.slice(4) + ' is not on ' + S.doc.docNo + '.', 'bad'); return 'notOnDoc'; }
      openLink(c);
      return 'unknown';
    }
    const line = k.lines.filter(l => open(l) > 0)[0];          // oldest open line first
    if (!line) { tone(false); flash(k.lines[0].name + ' is already complete on ' + S.doc.docNo + '.', 'bad'); return 'complete'; }
    add(line, 1, c);
    tone(true);
    flash(line.name + '  ·  ' + fmt(S.counts[line.line]) + ' of ' + fmt(line.remaining), 'ok');
    return 'ok';
  }
  function add(line, delta, code) {
    const next = Math.max(0, Math.min(num(line.remaining), num(S.counts[line.line]) + delta));
    S.counts[line.line] = next;
    if (code && !/^HXI:/i.test(code)) {
      const arr = S.codes[line.line] = S.codes[line.line] || [];
      if (arr.indexOf(code) === -1) arr.push(code);
    }
    saveDraft();
    renderLines();
  }

  /* ── link an unknown barcode to one of the document's items ───────────────────────────────── */
  let linkCode = '';
  function openLink(code) {
    linkCode = code;
    tone(false);
    $('scLinkText').textContent = code + ' is not known yet. Which item on ' + S.doc.docNo + ' is it? This is asked once; every phone knows it afterwards.';
    $('scLinkMsg').textContent = '';
    $('scLinkLines').innerHTML = S.lines.map(l => l.itemId
      ? `<button type="button" class="sc-link-line" data-line="${l.line}"><b>${esc(l.name)}</b><span>${esc(l.itemNo || '')} · ${fmt(open(l))} open</span></button>`
      : `<div class="sc-link-line sc-off"><b>${esc(l.name)}</b><span>Not in inventory yet; link it after it is received once.</span></div>`).join('');
    $('scLinkLines').querySelectorAll('button[data-line]').forEach(b => b.addEventListener('click', () => doLink(parseInt(b.dataset.line, 10))));
    show('scLink', true);
  }
  async function doLink(lineNo) {
    const line = S.lines.filter(l => l.line === lineNo)[0];
    if (!line) return;
    $('scLinkMsg').textContent = 'Linking…';
    try {
      const res = await postFlow('linkBarcode', { barcode: linkCode, itemId: line.itemId });
      if (!res || !res.success) { $('scLinkMsg').textContent = (res && res.message) || 'Could not link it.'; tone(false); return; }
      line.codes = (line.codes || []).concat([linkCode]);
      S.lines.filter(l => l.itemId === line.itemId).forEach(l => { if ((l.codes || []).indexOf(linkCode) === -1) l.codes = (l.codes || []).concat([linkCode]); });
      show('scLink', false);
      S.last = { code: '', at: 0 };
      scan(linkCode, false);
    } catch (e) { $('scLinkMsg').textContent = e.message || 'Could not link it.'; }
  }

  /* ── camera ───────────────────────────────────────────────────────────────────────────────── */
  async function startCam() {
    if (S.cam) return;
    flash('Starting the camera…', '');
    try {
      await loadLib(HTML5QR_CDN);
      const F = window.Html5QrcodeSupportedFormats || {};
      const formats = ['QR_CODE', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39'].map(n => F[n]).filter(v => v !== undefined);
      show('scCam', true); show('scCamIdle', false);
      const cam = new window.Html5Qrcode('scCam', { formatsToSupport: formats, verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      await cam.start({ facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.8); return { width: s, height: Math.floor(s * 0.6) }; } },
        (text) => scan(text, true), () => {});
      S.cam = cam;
      show('scCamStop', true);
      flash('Point the camera at a barcode.', '');
    } catch (e) {
      show('scCam', false); show('scCamIdle', true);
      const msg = String((e && e.message) || e || '');
      flash(/Permission|NotAllowed|denied/i.test(msg)
        ? 'Camera permission was refused. Allow the camera for this site in the phone settings, or use a Bluetooth scanner.'
        : 'The camera could not start (' + msg.slice(0, 80) + '). A Bluetooth scanner or typing still works.', 'bad');
    }
  }
  async function stopCam() {
    const cam = S.cam;
    S.cam = null;
    show('scCamStop', false); show('scCam', false); show('scCamIdle', true);
    if (cam) { try { await cam.stop(); } catch (e) {} try { cam.clear(); } catch (e) {} }
  }

  /* ── views ────────────────────────────────────────────────────────────────────────────────── */
  function view(name) {
    show('scPick', name === 'pick'); show('scWork', name === 'work'); show('scReview', name === 'review'); show('scDone', name === 'done');
    if (name !== 'work') stopCam();
    if (name === 'work') setTimeout(() => { const i = $('scCode'); if (i) i.focus(); }, 50);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function setMode(mode) {
    if (S.mode === mode && S.ready) return;
    S.mode = mode;
    ['receive', 'dispatch'].forEach(m => {
      const b = $(m === 'receive' ? 'scModeReceive' : 'scModeDispatch');
      b.classList.toggle('active', m === mode); b.setAttribute('aria-selected', String(m === mode));
    });
    $('scPickTitle').textContent = mode === 'receive' ? 'Open purchase orders' : 'Sales orders to dispatch';
    S.doc = null;
    view('pick');
    loadDocs();
  }
  async function loadDocs() {
    $('scDocs').innerHTML = '<div class="hx-empty">Loading…</div>';
    $('scPickMeta').textContent = '';
    try {
      const res = await fetchFlow('getScanDocs', { mode: S.mode }, { fresh: true });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the list.');
      S.docs = res.data || [];
      renderDocs();
    } catch (e) { $('scDocs').innerHTML = `<div class="hx-empty">${esc(e.message || 'Could not load the list.')}</div>`; }
  }
  function renderDocs() {
    const q = String($('scSearch').value || '').trim().toLowerCase();
    const list = S.docs.filter(d => !q || (d.docNo + ' ' + d.party + ' ' + (d.soNo || '')).toLowerCase().indexOf(q) !== -1);
    $('scPickMeta').textContent = S.docs.length + ' open';
    if (!list.length) {
      $('scDocs').innerHTML = `<div class="hx-empty">${S.docs.length ? 'Nothing matches.' : (S.mode === 'receive'
        ? 'No purchase order is waiting to be received.' : 'No sales order has goods waiting to leave.')}</div>`;
      return;
    }
    $('scDocs').innerHTML = list.slice(0, 80).map(d => `
      <button type="button" class="sc-doc-item" data-doc="${esc(d.docNo)}">
        <span class="sc-doc-item-no">${esc(d.docNo)}</span>
        <span class="sc-doc-item-party">${esc(d.party || '')}</span>
        <span class="sc-doc-item-meta">${esc(d.date || '')} · ${fmt(d.open)} open on ${d.lines} line${d.lines === 1 ? '' : 's'}</span>
      </button>`).join('');
    $('scDocs').querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => openDoc(b.dataset.doc)));
  }
  async function openDoc(docNo) {
    flash('', '');
    banner('');
    try {
      const res = await fetchFlow('getScanContext', { mode: S.mode, docNo: docNo }, { fresh: true });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not open ' + docNo + '.');
      S.doc = res.doc; S.lines = res.lines || []; S.pending = res.pendingCount || null;
      S.counts = {}; S.codes = {}; S.ref = '';
      const d = loadDraft();
      if (d) {
        S.counts = d.counts || {}; S.codes = d.codes || {}; S.ref = d.ref || '';
        flash('Your count from this phone was restored.', 'ok');
      } else if (S.pending && S.pending.lines && S.pending.lines.length) {
        S.pending.lines.forEach(x => { S.counts[x.line] = num(x.qty); });
        banner('Counted by ' + (S.pending.by || 'the warehouse') + (S.pending.at ? ' on ' + S.pending.at : '') +
               '. Check it, then ' + (S.canPost ? 'post it.' : 'save it again if anything changed.'));
      }
      // never keep a count above what is still open (someone may have received since)
      S.lines.forEach(l => { if (num(S.counts[l.line]) > num(l.remaining)) S.counts[l.line] = num(l.remaining); });
      if (S.mode === 'receive' && num(res.unmatchedReceived) > 0) {
        banner('Earlier receipts on ' + docNo + ' do not match its lines. Receive it from the desktop Receiving page.');
      }
      $('scDocNo').textContent = S.doc.docNo;
      $('scDocParty').textContent = (S.doc.party || '') + (S.doc.soNo ? '  ·  ' + S.doc.soNo : '');
      renderLines();
      view('work');
    } catch (e) { flash(e.message, 'bad'); banner(e.message); }
  }
  function renderLines() {
    let counted = 0, openTotal = 0;
    $('scLines').innerHTML = S.lines.map(l => {
      const c = num(S.counts[l.line]), rem = num(l.remaining), pct = rem > 0 ? Math.min(100, Math.round(c / rem * 100)) : 100;
      counted += c; openTotal += rem;
      const done = rem <= 0;
      const known = (l.codes || []).length || (S.codes[l.line] || []).length;
      return `<div class="sc-line${done ? ' sc-line-done' : c >= rem ? ' sc-line-full' : ''}" data-line="${l.line}">
        <div class="sc-line-head"><b>${esc(l.name)}</b><span class="sc-line-no">${esc(l.itemNo || '')}${known ? '' : ' · no barcode yet'}</span></div>
        <div class="sc-line-count"><span class="sc-big">${fmt(c)}</span><span> of ${fmt(rem)} ${done ? 'complete' : 'open'}</span>
          <span class="sc-line-was">${num(l.done) ? fmt(l.done) + ' of ' + fmt(l.ordered) + ' already ' + (S.mode === 'receive' ? 'received' : 'out') : ''}</span></div>
        <div class="sc-meter"><i class="sc-meter-${Math.round(pct / 10) * 10}"></i></div>
        <div class="sc-line-act">
          <button type="button" class="btn btn-sm" data-step="-1" ${c <= 0 ? 'disabled' : ''} aria-label="One less">&minus;</button>
          <button type="button" class="btn btn-sm" data-step="1" ${c >= rem ? 'disabled' : ''} aria-label="One more">+</button>
        </div>
      </div>`;
    }).join('') || '<div class="hx-empty">This document has no lines to scan.</div>';
    $('scLines').querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const ln = parseInt(b.closest('.sc-line').dataset.line, 10), line = S.lines.filter(l => l.line === ln)[0];
      if (line) add(line, parseInt(b.dataset.step, 10));
    }));
    $('scTally').innerHTML = `<b>${fmt(counted)}</b><span>of ${fmt(openTotal)}</span>`;
    $('scLinesMeta').textContent = S.lines.length + ' line' + (S.lines.length === 1 ? '' : 's');
    $('scReviewBtn').disabled = !(counted > 0);
    $('scReviewBtn').textContent = counted > 0 ? 'Review ' + fmt(counted) + ' unit' + (counted === 1 ? '' : 's') : 'Review';
    const needLabels = S.lines.filter(l => l.itemId && !(l.codes || []).length && !(S.codes[l.line] || []).length);
    const lab = $('scLabels');
    if (needLabels.length) {
      lab.href = 'labels.html?items=' + encodeURIComponent(needLabels.map(l => l.itemId + ':' +
        Math.max(1, Math.round(num(S.counts[l.line]) || num(l.remaining)))).join(','));
      lab.hidden = false;
    } else lab.hidden = true;
  }

  /* ── review and post ──────────────────────────────────────────────────────────────────────── */
  function payloadLines() {
    return S.lines.filter(l => num(S.counts[l.line]) > 0).map(l => ({ line: l.line, itemId: l.itemId, itemNo: l.itemNo,
      qty: num(S.counts[l.line]), codes: (S.codes[l.line] || []).slice(0, 5) }));
  }
  function openReview() {
    const rows = payloadLines();
    if (!rows.length) return;
    const recv = S.mode === 'receive';
    $('scReviewTitle').textContent = recv ? (S.canPost ? 'Post the receiving' : 'Save the count') : 'Save the dispatch';
    $('scReviewMeta').textContent = S.doc.docNo + ' · ' + (S.doc.party || '');
    $('scReviewLines').innerHTML = '<table class="sc-review-t"><tbody>' + rows.map(r => {
      const l = S.lines.filter(x => x.line === r.line)[0];
      return `<tr><td>${esc(l.name)}<small>${esc(l.itemNo || '')}</small></td><td class="num"><b>${fmt(r.qty)}</b> / ${fmt(l.remaining)}</td></tr>`;
    }).join('') + '</tbody></table>';
    show('scCharges', recv && S.canPost);
    show('scNotesWrap', !recv);
    $('scPost').textContent = recv ? (S.canPost ? 'Post receiving' : 'Save count') : 'Save dispatch';
    $('scMsg').textContent = ''; $('scMsg').className = 'sc-msg';
    view('review');
  }
  function msg(text, ok) { const m = $('scMsg'); m.textContent = text; m.className = 'sc-msg ' + (ok ? 'ok' : 'bad'); }
  async function post() {
    const btn = $('scPost');
    const lines = JSON.stringify(payloadLines());
    btn.disabled = true;
    try {
      let res;
      if (S.mode === 'dispatch') {
        res = await postFlow('dispatchByScan', { soNo: S.doc.docNo, lines: lines, notes: $('scNotes').value || '', clientRef: ref() });
        if (!res || !res.success) throw new Error((res && res.message) || 'Could not save the dispatch.');
        return finish('Dispatch saved', (res.dispatchNo || '') + ' records what left against ' + S.doc.docNo + '. Stock is deducted when it is invoiced.');
      }
      if (!S.canPost) {
        res = await postFlow('saveScanCount', { poNo: S.doc.docNo, lines: lines });
        if (!res || !res.success) throw new Error((res && res.message) || 'Could not save the count.');
        return finish('Count saved', res.message || 'Accounting can post it.');
      }
      const payload = { poNo: S.doc.docNo, lines: lines, date: (typeof flowToday === 'function') ? flowToday() : '',
        duties: num($('scDuties').value), vat: num($('scVat').value), delivery: num($('scDelivery').value), other: num($('scOther').value),
        clientRef: ref() };
      const extra = {};
      res = await postFlow('receiveByScan', payload);
      // The same checks the desktop Receiving page asks about, in the same order.
      if (res && !res.success && res.missingDocs && res.missingDocs.length) {
        if (!confirm(res.message + '\n\nReceive WITHOUT these documents? This is recorded against the order. ' +
                     '(Cancel, then attach them from the shipment on the desktop.)')) { msg('Not posted. Attach the documents first.', false); return; }
        extra.confirmNoDocs = true;
        res = await postFlow('receiveByScan', Object.assign({}, payload, extra));
      }
      if (res && !res.success && res.partialPay) {
        if (!confirm(res.message + '\n\nProceed with the reduced cost basis?')) { msg('Not posted. Record the balance in AP Aging first.', false); return; }
        extra.confirmPartialPay = true;
        res = await postFlow('receiveByScan', Object.assign({}, payload, extra));
      }
      if (res && !res.success && res.unpaid) {
        if (!confirm(res.message + '\n\nProceed anyway with a zero landed cost?')) { msg('Not posted. Record the AP payment first.', false); return; }
        extra.confirmUnpaid = true;
        res = await postFlow('receiveByScan', Object.assign({}, payload, extra));
      }
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not post the receiving.');
      finish('Received', res.mrNo + ' is in the process flow: inventory, landed cost and the journal are updated.');
    } catch (e) { msg(e.message || 'Something went wrong. Your count is kept on this phone.', false); }
    finally { btn.disabled = false; }
  }
  function finish(title, text) {
    dropDraft();
    S.counts = {}; S.codes = {}; S.ref = '';
    $('scDoneTitle').textContent = title;
    $('scDoneText').textContent = text;
    tone(true);
    view('done');
  }

  /* ── boot ─────────────────────────────────────────────────────────────────────────────────── */
  function wire() {
    $('scModeReceive').addEventListener('click', () => setMode('receive'));
    $('scModeDispatch').addEventListener('click', () => setMode('dispatch'));
    $('scSearch').addEventListener('input', renderDocs);
    $('scBack').addEventListener('click', () => { S.doc = null; view('pick'); loadDocs(); });
    $('scCamStart').addEventListener('click', startCam);
    $('scCamStop').addEventListener('click', stopCam);
    $('scEntry').addEventListener('submit', (e) => { e.preventDefault(); const i = $('scCode'); scan(i.value, false); i.value = ''; i.focus(); });
    $('scType').addEventListener('click', () => { const i = $('scCode'); i.setAttribute('inputmode', i.getAttribute('inputmode') === 'none' ? 'text' : 'none'); i.blur(); i.focus(); });
    $('scClear').addEventListener('click', () => { if (confirm('Clear the count for ' + S.doc.docNo + '?')) { S.counts = {}; S.codes = {}; S.ref = ''; dropDraft(); renderLines(); } });
    $('scReviewBtn').addEventListener('click', openReview);
    $('scReviewBack').addEventListener('click', () => view('work'));
    $('scPost').addEventListener('click', post);
    $('scAgain').addEventListener('click', () => { view('pick'); loadDocs(); });
    $('scLinkCancel').addEventListener('click', () => { show('scLink', false); flash('Not linked; that scan was not counted.', 'bad'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopCam(); });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    S.session = (typeof requireScanAccess === 'function') ? requireScanAccess() : null;
    if (!S.session) return;
    if (typeof renderNavbar === 'function') renderNavbar('scan');
    const role = String(S.session.role || '').toLowerCase();
    S.canPost = FLOW_SCAN_POST_ROLES.indexOf(role) !== -1;
    $('scWho').textContent = S.session.name + (S.canPost ? '' : ' · counts are posted by accounting');
    wire();
    try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/scan.html' }).catch(() => {}); } catch (e) {}
    let ok = true;
    try { ok = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(MIN_VERSION) : true; } catch (e) { ok = true; }
    if (!ok) {
      banner('The backend has not been updated for the scanner yet (needs FlowAPI ' + MIN_VERSION + '). Ask the admin to paste FlowAPI.gs.');
      document.querySelectorAll('.sc-mode').forEach(b => { b.disabled = true; });
      $('scDocs').innerHTML = '<div class="hx-empty">Scanning is off until the backend is updated.</div>';
      return;
    }
    S.ready = false;
    setMode('receive');
    S.ready = true;
  });

  window.__scan = { S, scan, candidates, add, payloadLines, saveDraft, loadDraft, draftKey, open };   // tests
})();
