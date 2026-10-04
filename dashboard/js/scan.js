/* A316 / A318 — the warehouse scanner (scan.html).
 *
 * RECEIVE: pick an open purchase order, scan each box, take a photo, post the receiving. The server
 * (receiveByScan) checks every line against what is still open on the PO, prices it from the PO and
 * posts it through the same createReceiving the desktop Receiving page uses — same landed cost,
 * journal, document and payment checks. A login that may count but not post (warehouse) saves the
 * count instead (saveScanCount); accounting opens the same PO and finds it filled in, photos included.
 * STOCK IN (A318): start from the item. Scan it, choose which open purchase order line it came from;
 * the basket can hold several items over several POs and posts one receiving per PO, each with its own
 * photo, through the same receiveByScan.
 * DISPATCH: pick a sales order, scan what leaves, take a photo, save it (dispatchByScan). An item that
 * is tracked piece by piece leaves by each piece's own label. Record only: stock still leaves at
 * invoicing, so nothing is deducted twice.
 * RETURN (A318): scan pieces back from site, condition and a photo (returnByScan). Record only.
 * LOOK UP (A318): scan anything and see what it is, where it is and its photos. Accounting can switch
 * an item to "Track each piece" and register the pieces already on the shelf.
 * NEW ITEM (A319, FlowAPI 160): from Stock in, an item inventory has never heard of. Photo first, then
 * name, brand, model and type; it goes on hand with no cost (accounting fills it in) and gets its label.
 *
 * WHAT A SCAN MEANS. Our labels carry an opaque code (HX + 12 characters) that means nothing outside
 * this system: the details come only from the secured reads, signed in. Older labels carry HXI:<Item ID>
 * and still scan. Anything else is a supplier barcode, looked up among the barcodes already tied to an
 * item; an unknown one is tied to an item once (linkBarcode) and counts from then on, on every phone.
 *
 * NOTHING IS LOST. The count, the pieces and the photo ids are kept on the phone per document
 * (localStorage) after every change; one clientRef per count makes a retry safe.
 */
(function () {
  const HTML5QR_CDN = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
  const MIN_VERSION = 159;
  const COOLDOWN_MS = 1200;           // the camera reads a code many times a second; one box, one count
  const MAX_PHOTOS = 4;
  const OWN_RE = /^HX[0-9A-HJKMNP-TV-Z]{12}$/;
  const MODES = ['receive', 'stockin', 'dispatch', 'return', 'lookup'];
  // A319 — mirror FlowAPI.gs _SCAN_BRANDS / _SCAN_CATEGORIES exactly (scan-contract.js compares them)
  const BRANDS = ['CEJN', 'Hydraulic Technologies Powerteam', 'RAD Torque Tools', 'Snap-on / Blue-point', 'Chicago Pneumatic', 'Others'];
  const CATEGORIES = ['Hose', 'Coupler', 'Pump', 'Cylinder', 'Jack', 'Torque wrench', 'Others'];
  const TRACK_BY_TYPE = { Pump: 1, Cylinder: 1, Jack: 1, 'Torque wrench': 1 };   // deployable equipment: one label per piece
  const NEW_KEY = 'hx_scan_v1_newitem';
  const NEW_MIN_VERSION = 160;
  const MAX_PIECES = 50;
  const S = { session: null, canPost: false, mode: 'receive', docs: [], doc: null, lines: [], counts: {}, codes: {}, assets: {},
              ref: '', pending: null, cam: null, last: { code: '', at: 0 }, ready: false, photos: {}, photoKey: '',
              stock: null, basket: [], groupRefs: {}, groupMsg: {}, inventory: null,
              outPieces: null, ret: [], view: 'pick', sheetCancel: null, reg: null, canNew: false, newItem: null, newExisting: null };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => hxEsc(v);
  const num = (v) => hxNum(v);
  const fmt = (n) => (Math.round(num(n) * 100) / 100).toLocaleString('en-PH');
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  const plural = (n, w) => fmt(n) + ' ' + w + (num(n) === 1 ? '' : 's');
  const newRef = () => (typeof flowClientRef === 'function') ? flowClientRef() : ('CR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

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
  function refuse(text) { tone(false); flash(text, 'bad'); }
  function banner(text) { const b = $('scBanner'); if (!b) return; b.textContent = text || ''; b.hidden = !text; }

  /* ── what is kept on the phone ────────────────────────────────────────────────────────────── */
  const draftKey = () => 'hx_scan_v1_' + S.mode + '_' + (S.doc ? S.doc.docNo : '');
  const okIds = (key) => (S.photos[key] || []).filter(p => p.state === 'ok').map(p => p.docId);
  function photoIdsFor(prefix) {
    const out = {};
    Object.keys(S.photos).forEach(k => { if (k.indexOf(prefix) === 0) { const ids = okIds(k); if (ids.length) out[k] = ids; } });
    return out;
  }
  function restorePhotos(saved) {
    Object.keys(saved || {}).forEach(k => { S.photos[k] = (saved[k] || []).map(id => ({ docId: id, state: 'ok', thumb: '' })); });
  }
  function storeSet(key, val) { try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function storeGet(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function saveDraft() {
    if (S.newItem) storeSet(NEW_KEY, Object.assign({}, S.newItem, { photos: okIds('new'), at: Date.now() }));   // A319
    if (S.mode === 'stockin') {
      storeSet('hx_scan_v1_stockin', S.basket.length ? { basket: S.basket, refs: S.groupRefs, photos: photoIdsFor('po:'), at: Date.now() } : null);
      return;
    }
    if (S.mode === 'return') {
      storeSet('hx_scan_v1_return', S.ret.length ? { ret: S.ret, ref: S.ref, photos: photoIdsFor('doc'), at: Date.now() } : null);
      return;
    }
    if (!S.doc) return;
    if (!Object.keys(S.counts).some(k => S.counts[k] > 0)) { storeSet(draftKey(), null); return; }
    storeSet(draftKey(), { counts: S.counts, codes: S.codes, assets: S.assets, ref: S.ref, photos: photoIdsFor('doc'), at: Date.now() });
  }
  function loadDraft() { const d = storeGet(draftKey()); return d && d.counts ? d : null; }
  function dropDraft() { storeSet(draftKey(), null); }
  function ref() { if (!S.ref) S.ref = newRef(); return S.ref; }

  /* ── photos: one upload per shot, kept by key ('doc', 'po:<PO No>', 'reg') ─────────────────── */
  function photoTarget(key) {
    if (key === 'reg') return { mode: 'register', docNo: S.reg ? S.reg.itemId : '' };
    if (key === 'new') return { mode: 'newitem', docNo: S.newItem ? S.newItem.ref : '' };
    if (key.indexOf('po:') === 0) return { mode: 'receive', docNo: key.slice(3) };
    if (S.mode === 'return') return { mode: 'return', docNo: ref() };
    return { mode: S.mode === 'dispatch' ? 'dispatch' : 'receive', docNo: S.doc ? S.doc.docNo : '' };
  }
  function photoHtml(key) {
    const list = S.photos[key] || [];
    const tiles = list.map((p, i) => `<div class="sc-thumb sc-thumb-${p.state}">
        ${p.thumb ? `<img src="${esc(p.thumb)}" alt="Photo ${i + 1}">` : '<span class="sc-thumb-saved">Saved</span>'}
        <span class="sc-thumb-state">${p.state === 'up' ? 'Uploading…' : p.state === 'bad' ? 'Failed' : ''}</span>
        <button type="button" class="sc-thumb-x" data-unphoto="${esc(key)}" data-i="${i}" aria-label="Remove photo ${i + 1}">&times;</button>
      </div>`).join('');
    const okN = list.filter(p => p.state === 'ok').length;
    return `<div class="sc-photos-head"><b>Photo proof</b><span>${okN ? okN + ' saved' : 'Required: at least one'}</span></div>
      <div class="sc-thumbs">${tiles}${list.length < MAX_PHOTOS
        ? `<button type="button" class="sc-shoot" data-shoot="${esc(key)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span>Take photo</span></button>` : ''}</div>`;
  }
  function wirePhotos(root) {
    (root || document).querySelectorAll('[data-shoot]').forEach(b => b.addEventListener('click', () => {
      S.photoKey = b.dataset.shoot;
      const inp = $('scPhotoIn'); inp.value = ''; inp.click();
    }));
    (root || document).querySelectorAll('[data-unphoto]').forEach(b => b.addEventListener('click', () => {
      const list = S.photos[b.dataset.unphoto] || [];
      list.splice(parseInt(b.dataset.i, 10), 1);
      refreshPhotos(b.dataset.unphoto); saveDraft();
    }));
  }
  function refreshPhotos(key) {
    document.querySelectorAll('.sc-photos').forEach(box => {
      if (box.dataset.key !== key) return;
      box.innerHTML = photoHtml(key);
      wirePhotos(box);
    });
    updatePostState();
  }
  const photoBlock = (key) => `<div class="sc-photos" data-key="${esc(key)}">${photoHtml(key)}</div>`;
  async function takePhotos(files) {
    const key = S.photoKey;
    if (!key) return;
    const list = S.photos[key] = S.photos[key] || [];
    const target = photoTarget(key);
    for (const file of Array.from(files || []).slice(0, MAX_PHOTOS - list.length)) {
      const p = { docId: '', state: 'up', thumb: '' };
      list.push(p);
      refreshPhotos(key);
      try {
        const data = await flowDownscaleImage(file, 1280, 0.75);
        p.thumb = data;
        refreshPhotos(key);
        const res = await postFlow('uploadScanPhoto', { mode: target.mode, docNo: target.docNo, base64: data, mimeType: 'image/jpeg' });
        if (!res || !res.success) throw new Error((res && res.message) || 'The photo did not upload.');
        p.docId = res.docId; p.state = 'ok';
      } catch (e) {
        p.state = 'bad';
        flash((e && e.message) || 'The photo did not upload. Remove it and take it again.', 'bad');
      }
      refreshPhotos(key);
      saveDraft();
    }
  }
  function photosReady(key) {
    const list = S.photos[key] || [];
    return list.some(p => p.state === 'ok') && !list.some(p => p.state === 'up');
  }
  function updatePostState() {
    const btn = $('scPost');
    if (btn && S.view === 'review') {
      btn.disabled = S.mode === 'stockin' ? !groups().some(g => photosReady('po:' + g.poNo)) : !photosReady('doc');
    }
    regState();
    if (S.view === 'newitem') newState();
  }

  /* ── Receive / Dispatch: what a code means on this document ───────────────────────────────── */
  const open = (l) => Math.max(0, num(l.remaining) - num(S.counts[l.line]));
  const pieceTaken = (assetNo) => Object.keys(S.assets).some(k => (S.assets[k] || []).indexOf(assetNo) !== -1);
  function candidates(code) {
    const c = String(code || '').trim();
    if (/^HXI:/i.test(c)) {
      const id = c.slice(4).trim();
      return { own: true, kind: 'item', itemId: id, lines: S.lines.filter(l => l.itemId && l.itemId === id) };
    }
    if (OWN_RE.test(c)) {
      for (const l of S.lines) {
        const p = (l.pieces || []).filter(x => x.code === c)[0];
        if (p) return { own: true, kind: 'piece', piece: p, lines: S.lines.filter(x => x.itemId === l.itemId) };
      }
      return { own: true, kind: 'item', lines: S.lines.filter(l => (l.labels || []).indexOf(c) !== -1) };
    }
    return { own: false, kind: 'item', lines: S.lines.filter(l => (l.codes || []).indexOf(c) !== -1 || (S.codes[l.line] || []).indexOf(c) !== -1) };
  }
  /** One scan. Returns 'ok' | 'unknown' | 'notOnDoc' | 'complete' | 'ignored' | 'piecesOnly' | 'again' | 'missing' | 'pick'. */
  function scan(code, viaCamera) {
    const c = String(code || '').trim();
    if (!c) return 'ignored';
    const now = Date.now();
    if (viaCamera && c === S.last.code && now - S.last.at < COOLDOWN_MS) return 'ignored';
    S.last = { code: c, at: now };
    if (S.mode === 'stockin') return scanStock(c);
    if (S.mode === 'return') return scanReturn(c);
    if (S.mode === 'lookup') { lookup(c); return 'ok'; }
    if (!S.doc) return 'ignored';
    const k = candidates(c);
    if (!k.lines.length) {
      if (k.own) { refuse('That label is not for anything on ' + S.doc.docNo + '.'); return 'notOnDoc'; }
      openLink(c);
      return 'unknown';
    }
    if (S.mode === 'dispatch' && k.kind === 'piece') {
      if (pieceTaken(k.piece.assetNo)) { refuse(k.piece.assetNo + ' is already counted.'); return 'again'; }
      const line = k.lines.filter(l => l.tracked && open(l) > 0)[0];
      if (!line) { refuse(k.lines[0].name + ' is already complete on ' + S.doc.docNo + '.'); return 'complete'; }
      addPiece(line, k.piece.assetNo);
      tone(true);
      flash(line.name + '  ·  ' + k.piece.assetNo + '  ·  ' + fmt(S.counts[line.line]) + ' of ' + fmt(line.remaining), 'ok');
      return 'ok';
    }
    let lines = k.lines;
    if (S.mode === 'dispatch') {
      lines = k.lines.filter(l => !l.tracked);
      if (!lines.length) { refuse(k.lines[0].name + ' is tracked piece by piece: scan each piece\'s own label.'); return 'piecesOnly'; }
    }
    const line = lines.filter(l => open(l) > 0)[0];          // oldest open line first
    if (!line) { refuse(lines[0].name + ' is already complete on ' + S.doc.docNo + '.'); return 'complete'; }
    add(line, 1, c);
    tone(true);
    flash(line.name + '  ·  ' + fmt(S.counts[line.line]) + ' of ' + fmt(line.remaining), 'ok');
    return 'ok';
  }
  function add(line, delta, code) {
    if (S.mode === 'dispatch' && line.tracked) {          // a piece line only shrinks by hand; it grows by scanning
      if (delta < 0) { (S.assets[line.line] || []).pop(); S.counts[line.line] = (S.assets[line.line] || []).length; }
      saveDraft(); renderLines();
      return;
    }
    const next = Math.max(0, Math.min(num(line.remaining), num(S.counts[line.line]) + delta));
    S.counts[line.line] = next;
    if (code && !/^HXI:/i.test(code) && !OWN_RE.test(code)) {
      const arr = S.codes[line.line] = S.codes[line.line] || [];
      if (arr.indexOf(code) === -1) arr.push(code);
    }
    saveDraft();
    renderLines();
  }
  function addPiece(line, assetNo) {
    const arr = S.assets[line.line] = S.assets[line.line] || [];
    arr.push(assetNo);
    S.counts[line.line] = arr.length;
    saveDraft();
    renderLines();
  }

  /* ── the bottom sheet ─────────────────────────────────────────────────────────────────────── */
  function sheet(title, text, body, onCancel) {
    $('scSheetTitle').textContent = title;
    $('scSheetText').textContent = text || '';
    $('scSheetBody').innerHTML = body || '';
    $('scSheetMsg').textContent = ''; $('scSheetMsg').className = 'sc-msg';
    S.sheetCancel = onCancel || null;
    show('scSheet', true);
  }
  function closeSheet() { show('scSheet', false); S.sheetCancel = null; S.reg = null; }
  function sheetMsg(text, ok) { const m = $('scSheetMsg'); m.textContent = text; m.className = 'sc-msg ' + (ok ? 'ok' : 'bad'); }

  /* ── link an unknown barcode: the document's items first, then all of inventory ───────────── */
  let linkCode = '';
  function openLink(code) {
    linkCode = code;
    tone(false);
    const docLines = (S.mode !== 'stockin' && S.doc) ? S.lines.map(l => l.itemId
      ? `<button type="button" class="sc-link-line" data-item="${esc(l.itemId)}"><b>${esc(l.name)}</b><span>${esc(l.itemNo || '')} · ${fmt(open(l))} open</span></button>`
      : `<div class="sc-link-line sc-off"><b>${esc(l.name)}</b><span>Not in inventory yet; link it after it is received once.</span></div>`).join('') : '';
    sheet('New barcode', code + ' is not known yet. Which item is it? This is asked once; every phone knows it afterwards.',
      (docLines ? `<div class="sc-link-lines">${docLines}</div><p class="sc-sub">Or search all inventory</p>` : '') +
      `<input type="search" class="sc-input" id="scFind" placeholder="Name or item number" autocomplete="off" aria-label="Search inventory">
       <div class="sc-link-lines" id="scFindList"></div>` +
      (S.mode === 'stockin' && S.canNew ? '<button type="button" class="btn btn-sm sc-link-new" id="scLinkNew">Not in inventory? Add it as a new item</button>' : ''),
      () => flash('Not linked; that scan was not counted.', 'bad'));
    $('scSheetBody').querySelectorAll('button[data-item]').forEach(b => b.addEventListener('click', () => doLink(b.dataset.item)));
    const f = $('scFind');
    if (f) f.addEventListener('input', renderFind);
    const nb = $('scLinkNew');
    if (nb) nb.addEventListener('click', () => { const c = linkCode; closeSheet(); openNewItem(c); });
    loadInventory().then(renderFind).catch(() => {});
  }
  async function loadInventory() {
    if (S.inventory) return S.inventory;
    const res = await fetchFlow('getInventory', {});
    S.inventory = ((res && res.data) || []).filter(r => r.itemId).map(r => ({ itemId: String(r.itemId), itemNo: String(r.itemNo || ''), name: String(r.description || '') }));
    return S.inventory;
  }
  function findItems(q) {
    const t = String(q || '').trim().toLowerCase();
    if (t.length < 2 || !S.inventory) return [];
    return S.inventory.filter(i => (i.name + ' ' + i.itemNo + ' ' + i.itemId).toLowerCase().indexOf(t) !== -1).slice(0, 25);
  }
  function renderFind() {
    const box = $('scFindList'), inp = $('scFind');
    if (!box || !inp) return;
    const q = inp.value;
    const hits = findItems(q);
    box.innerHTML = String(q || '').trim().length < 2 ? '' : hits.length
      ? hits.map(i => `<button type="button" class="sc-link-line" data-item="${esc(i.itemId)}"><b>${esc(i.name)}</b><span>${esc(i.itemNo)}</span></button>`).join('')
      : '<div class="hx-empty">Nothing matches.</div>';
    box.querySelectorAll('button[data-item]').forEach(b => b.addEventListener('click', () => doLink(b.dataset.item)));
  }
  async function doLink(itemId) {
    if (!itemId) return;
    sheetMsg('Linking…', true);
    try {
      const res = await postFlow('linkBarcode', { barcode: linkCode, itemId: itemId });
      if (!res || !res.success) { sheetMsg((res && res.message) || 'Could not link it.', false); tone(false); return; }
      closeSheet();
      S.last = { code: '', at: 0 };
      if (S.mode === 'stockin') {
        if (S.stock) S.stock.codes[linkCode] = itemId;
        addStockItem(itemId);
        return;
      }
      const hit = S.lines.filter(l => l.itemId === itemId);
      hit.forEach(l => { if ((l.codes || []).indexOf(linkCode) === -1) l.codes = (l.codes || []).concat([linkCode]); });
      if (hit.length) scan(linkCode, false);
      else { tone(true); flash('Linked. That item is not on ' + S.doc.docNo + ', so it was not counted here.', 'ok'); }
    } catch (e) { sheetMsg(e.message || 'Could not link it.', false); }
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
  const SCAN_VIEWS = { work: 1, stockin: 1, 'return': 1, lookup: 1 };
  function view(name) {
    S.view = name;
    show('scPick', name === 'pick');
    show('scDocBar', name === 'work');
    show('scCamCard', !!SCAN_VIEWS[name]);
    show('scLinesCard', name === 'work');
    show('scBasketCard', name === 'stockin');
    show('scRetCard', name === 'return');
    show('scLookCard', name === 'lookup');
    show('scWorkBar', name === 'work' || name === 'stockin' || name === 'return');
    show('scReview', name === 'review');
    show('scDone', name === 'done');
    show('scNew', name === 'newitem');
    show('scNewOpen', name === 'stockin' && S.canNew);
    if (!SCAN_VIEWS[name]) stopCam();
    if (SCAN_VIEWS[name]) setTimeout(() => { const i = $('scCode'); if (i) i.focus(); }, 50);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  const HINTS = {
    receive: 'Point the back camera at a barcode or our label. A Bluetooth scanner works too: scan into the box below.',
    dispatch: 'Scan what leaves. Items tracked piece by piece need each piece\'s own label.',
    stockin: 'Scan an item, then choose the purchase order it came from. Scan it again to add one more.',
    'return': 'Scan the label on each piece coming back from site.',
    lookup: 'Scan any label or barcode to see what it is and where it is.'
  };
  function setMode(mode) {
    if (S.mode === mode && S.ready) return;
    S.mode = mode;
    MODES.forEach(m => {
      const b = document.querySelector('.sc-mode[data-mode="' + m + '"]');
      if (!b) return;
      b.classList.toggle('active', m === mode); b.setAttribute('aria-selected', String(m === mode));
    });
    $('scCamHint').textContent = HINTS[mode] || '';
    S.doc = null; S.lines = []; S.counts = {}; S.codes = {}; S.assets = {}; S.ref = ''; S.photos = {};
    S.newItem = null; S.newExisting = null;            // A319 — the New item form reloads from its saved draft, photos included
    flash('', ''); banner('');
    if (mode === 'receive' || mode === 'dispatch') {
      $('scPickTitle').textContent = mode === 'receive' ? 'Open purchase orders' : 'Sales orders to dispatch';
      view('pick');
      loadDocs();
    } else if (mode === 'stockin') openStockIn();
    else if (mode === 'return') openReturn();
    else { $('scLook').innerHTML = '<div class="hx-empty">Scan any label or barcode to see what it is.</div>'; view('lookup'); }
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
      const res = await postFlow('getScanContext', { mode: S.mode, docNo: docNo });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not open ' + docNo + '.');
      S.doc = res.doc; S.lines = res.lines || []; S.pending = res.pendingCount || null;
      S.counts = {}; S.codes = {}; S.assets = {}; S.ref = ''; S.photos = {};
      const d = loadDraft();
      if (d) {
        S.counts = d.counts || {}; S.codes = d.codes || {}; S.assets = d.assets || {}; S.ref = d.ref || '';
        restorePhotos(d.photos);
        flash('Your count from this phone was restored.', 'ok');
      } else if (S.pending && S.pending.lines && S.pending.lines.length) {
        S.pending.lines.forEach(x => { S.counts[x.line] = num(x.qty); });
        restorePhotos({ doc: S.pending.photoIds || [] });
        banner('Counted by ' + (S.pending.by || 'the warehouse') + (S.pending.at ? ' on ' + S.pending.at : '') +
               '. Check it, then ' + (S.canPost ? 'post it.' : 'save it again if anything changed.'));
      }
      // never keep a count above what is still open, nor a piece that has left since
      S.lines.forEach(l => {
        if (S.mode === 'dispatch' && l.tracked) {
          const here = (l.pieces || []).map(p => p.assetNo);
          S.assets[l.line] = (S.assets[l.line] || []).filter(a => here.indexOf(a) !== -1).slice(0, num(l.remaining));
          S.counts[l.line] = S.assets[l.line].length;
        } else if (num(S.counts[l.line]) > num(l.remaining)) S.counts[l.line] = num(l.remaining);
      });
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
    const disp = S.mode === 'dispatch';
    $('scLines').innerHTML = S.lines.map(l => {
      const c = num(S.counts[l.line]), rem = num(l.remaining), pct = rem > 0 ? Math.min(100, Math.round(c / rem * 100)) : 100;
      counted += c; openTotal += rem;
      const done = rem <= 0;
      const known = (l.codes || []).length || (S.codes[l.line] || []).length || (l.labels || []).length;
      const byPiece = disp && l.tracked;
      const tag = l.tracked ? '<span class="sc-tag">Each piece</span>' : '';
      const sub = byPiece ? (l.pieces || []).length + ' in the warehouse' : (known ? '' : 'no barcode yet');
      const chips = byPiece && (S.assets[l.line] || []).length
        ? `<div class="sc-chips">${(S.assets[l.line] || []).map(a => `<span class="sc-chip">${esc(a)}</span>`).join('')}</div>` : '';
      return `<div class="sc-line${done ? ' sc-line-done' : c >= rem ? ' sc-line-full' : ''}" data-line="${l.line}">
        <div class="sc-line-head"><b>${esc(l.name)} ${tag}</b><span class="sc-line-no">${esc(l.itemNo || '')}${sub ? ' · ' + esc(sub) : ''}</span></div>
        <div class="sc-line-count"><span class="sc-big">${fmt(c)}</span><span> of ${fmt(rem)} ${done ? 'complete' : 'open'}</span>
          <span class="sc-line-was">${num(l.done) ? fmt(l.done) + ' of ' + fmt(l.ordered) + ' already ' + (S.mode === 'receive' ? 'received' : 'out') : ''}</span></div>
        <div class="sc-meter"><i class="sc-meter-${Math.round(pct / 10) * 10}"></i></div>
        ${chips}
        <div class="sc-line-act">
          <button type="button" class="btn btn-sm" data-step="-1" ${c <= 0 ? 'disabled' : ''} aria-label="One less">&minus;</button>
          ${byPiece ? '' : `<button type="button" class="btn btn-sm" data-step="1" ${c >= rem ? 'disabled' : ''} aria-label="One more">+</button>`}
        </div>
      </div>`;
    }).join('') || '<div class="hx-empty">This document has no lines to scan.</div>';
    $('scLines').querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const ln = parseInt(b.closest('.sc-line').dataset.line, 10), line = S.lines.filter(l => l.line === ln)[0];
      if (line) add(line, parseInt(b.dataset.step, 10));
    }));
    $('scTally').innerHTML = `<b>${fmt(counted)}</b><span>of ${fmt(openTotal)}</span>`;
    $('scLinesMeta').textContent = S.lines.length + ' line' + (S.lines.length === 1 ? '' : 's');
    $('scClear').textContent = 'Clear count';
    $('scReviewBtn').disabled = !(counted > 0);
    $('scReviewBtn').textContent = counted > 0 ? 'Review ' + plural(counted, 'unit') : 'Review';
    const needLabels = S.lines.filter(l => l.itemId && !(l.codes || []).length && !(S.codes[l.line] || []).length && !l.tracked);
    const lab = $('scLabels');
    if (needLabels.length && S.mode === 'receive') {
      lab.href = 'labels.html?items=' + encodeURIComponent(needLabels.map(l => l.itemId + ':' +
        Math.max(1, Math.round(num(S.counts[l.line]) || num(l.remaining)))).join(','));
      lab.hidden = false;
    } else lab.hidden = true;
  }

  /* ── Stock in: item first, then the PO line it came from ───────────────────────────────────── */
  async function openStockIn() {
    const d = storeGet('hx_scan_v1_stockin');
    S.basket = (d && d.basket) || []; S.groupRefs = (d && d.refs) || {}; S.groupMsg = {};
    S.photos = {}; restorePhotos(d && d.photos);
    renderBasket();
    view('stockin');
    if (S.basket.length) flash('Your basket from this phone was restored.', 'ok');
    try {
      const res = await postFlow('getScanContext', { mode: 'stockin' });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the item codes.');
      S.stock = { codes: res.codes || {}, names: res.items || {}, tracked: res.tracked || {} };
    } catch (e) { banner(e.message || 'Could not load the item codes.'); }
  }
  function stockItemOf(code) {
    if (/^HXI:/i.test(code)) return code.slice(4).trim();
    return (S.stock && S.stock.codes[code]) || '';
  }
  function scanStock(c) {
    if (!S.stock) { refuse('Still loading the item codes. Try again in a moment.'); return 'ignored'; }
    const itemId = stockItemOf(c);
    if (!itemId) {
      if (OWN_RE.test(c)) { refuse('That is a piece label. Pieces arrive with their purchase order, not through Stock in.'); return 'notOnDoc'; }
      openLink(c);
      return 'unknown';
    }
    return addStockItem(itemId);
  }
  const basketKey = (e) => e.poNo + '|' + e.line;
  function addStockItem(itemId) {
    const room = S.basket.filter(e => e.itemId === itemId && e.qty < e.remaining)[0];
    if (room) {
      room.qty++;
      tone(true);
      flash(room.name + '  ·  ' + fmt(room.qty) + ' from ' + room.poNo, 'ok');
      saveDraft(); renderBasket();
      return 'ok';
    }
    pickPoLine(itemId);
    return 'pick';
  }
  async function pickPoLine(itemId) {
    const name = (S.stock && S.stock.names[itemId] && S.stock.names[itemId].name) || itemId;
    sheet('Which purchase order?', name + ': choose the open purchase order line this came from.', '<div class="hx-empty">Loading…</div>',
      () => flash('Not added.', 'bad'));
    try {
      const res = await postFlow('getStockInOptions', { itemId: itemId });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the purchase orders.');
      const label = (res.item && res.item.name) || name;
      const inBasket = {};
      S.basket.forEach(e => { inBasket[basketKey(e)] = e.qty; });
      const opts = (res.options || []).map(o => Object.assign({}, o, { left: num(o.remaining) - num(inBasket[o.poNo + '|' + o.line]) })).filter(o => o.left > 0);
      if (!opts.length) {
        tone(false);
        $('scSheetBody').innerHTML = `<div class="hx-empty">No open purchase order is waiting for ${esc(label)}${(res.options || []).length ? ' beyond what is already in the basket' : ''}. ` +
          'Raise or approve its purchase order first.</div>';
        return;
      }
      $('scSheetText').textContent = label + (res.item && res.item.itemNo ? ' (' + res.item.itemNo + ')' : '') + ': choose the purchase order it came from.';
      $('scSheetBody').innerHTML = '<div class="sc-link-lines">' + opts.map((o, i) => `
        <button type="button" class="sc-link-line" data-opt="${i}">
          <b>${esc(o.poNo)} · ${esc(o.supplier || '')}</b>
          <span>${o.soNo ? 'For ' + esc(o.soNo) : 'For stock'} · ${esc(o.date || '')} · line ${o.line} · ${fmt(o.left)} of ${fmt(o.ordered)} still to receive</span>
        </button>`).join('') + '</div>';
      $('scSheetBody').querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
        const o = opts[parseInt(b.dataset.opt, 10)];
        const existing = S.basket.filter(e => basketKey(e) === o.poNo + '|' + o.line)[0];
        if (existing) existing.qty = Math.min(existing.remaining, existing.qty + 1);
        else S.basket.push({ poNo: o.poNo, line: o.line, itemId: o.itemId, itemNo: o.itemNo, name: label,
                             remaining: num(o.remaining), qty: 1, supplier: o.supplier || '', soNo: o.soNo || '',
                             tracked: !!(res.item && res.item.tracked) });
        closeSheet();
        tone(true);
        flash(label + '  ·  added from ' + o.poNo, 'ok');
        saveDraft(); renderBasket();
      }));
    } catch (e) { sheetMsg(e.message || 'Could not load the purchase orders.', false); }
  }
  function groups() {
    const by = {}, order = [];
    S.basket.forEach(e => {
      if (!by[e.poNo]) { by[e.poNo] = { poNo: e.poNo, supplier: e.supplier, soNo: e.soNo, entries: [] }; order.push(e.poNo); }
      by[e.poNo].entries.push(e);
    });
    return order.map(k => by[k]);
  }
  function renderBasket() {
    const gs = groups();
    let units = 0;
    $('scBasket').innerHTML = gs.length ? gs.map(g => `
      <div class="sc-group">
        <div class="sc-group-head"><b>${esc(g.poNo)}</b><span>${esc(g.supplier || '')} · ${g.soNo ? 'for ' + esc(g.soNo) : 'for stock'}</span></div>
        ${g.entries.map(e => { units += e.qty; return `
          <div class="sc-bline" data-key="${esc(basketKey(e))}">
            <div><b>${esc(e.name)}</b>${e.tracked ? ' <span class="sc-tag">Each piece</span>' : ''}<small>${esc(e.itemNo || '')} · line ${e.line} · ${fmt(e.remaining)} open</small></div>
            <div class="sc-line-act">
              <button type="button" class="btn btn-sm" data-bstep="-1" aria-label="One less">&minus;</button>
              <span class="sc-big">${fmt(e.qty)}</span>
              <button type="button" class="btn btn-sm" data-bstep="1" ${e.qty >= e.remaining ? 'disabled' : ''} aria-label="One more">+</button>
            </div>
          </div>`; }).join('')}
      </div>`).join('') : '<div class="hx-empty">Scan an item to start. Each one is matched to the purchase order it came from.</div>';
    $('scBasket').querySelectorAll('[data-bstep]').forEach(b => b.addEventListener('click', () => {
      const key = b.closest('.sc-bline').dataset.key, e = S.basket.filter(x => basketKey(x) === key)[0];
      if (!e) return;
      e.qty = Math.max(0, Math.min(e.remaining, e.qty + parseInt(b.dataset.bstep, 10)));
      if (!e.qty) S.basket = S.basket.filter(x => x !== e);
      saveDraft(); renderBasket();
    }));
    $('scBasketMeta').textContent = gs.length ? plural(gs.length, 'purchase order') : '';
    $('scClear').textContent = 'Clear basket';
    $('scReviewBtn').disabled = !(units > 0);
    $('scReviewBtn').textContent = units > 0 ? 'Review ' + plural(units, 'unit') : 'Review';
  }

  /* ── A319 · New item: an item inventory has never heard of ─────────────────────────────────── */
  /** "Brand Type Name", leaving out a brand or type the name already says, and a blank "Others"
   *  (the same rule as FlowAPI.gs _scanNewDescription; scan-contract.js checks the cases). */
  function newDescription(brand, category, name) {
    const n = String(name || '').trim().replace(/\s+/g, ' '), low = n.toLowerCase(), parts = [];
    [brand, category].forEach(w => {
      const t = String(w || '').trim();
      if (!t || t === 'Others' || low.indexOf(t.toLowerCase()) !== -1) return;
      parts.push(t);
    });
    parts.push(n);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  const blankNew = () => ({ ref: newRef(), name: '', brand: '', brandOther: '', model: '', category: '', categoryOther: '', qty: '1',
                            track: false, trackTouched: false, barcode: '' });
  function openNewItem(barcode) {
    if (!S.canNew) return;
    if (!S.newItem) {
      const d = storeGet(NEW_KEY);
      S.newItem = (d && d.ref) ? Object.assign(blankNew(), d) : blankNew();
      if (!(S.photos.new || []).length) S.photos.new = ((d && d.photos) || []).map(id => ({ docId: id, state: 'ok', thumb: '' }));
      delete S.newItem.photos; delete S.newItem.at;
      if (d && d.ref) flash('Your new item from this phone was restored.', 'ok');
    }
    if (barcode) S.newItem.barcode = barcode;
    S.newExisting = null;
    const n = S.newItem;
    $('scNewName').value = n.name; $('scNewBrand').value = n.brand; $('scNewBrandOther').value = n.brandOther;
    $('scNewModel').value = n.model; $('scNewCategory').value = n.category; $('scNewCategoryOther').value = n.categoryOther;
    $('scNewQty').value = n.qty; $('scNewTrack').checked = !!n.track;
    $('scNewMsg').textContent = n.barcode ? 'Barcode ' + n.barcode + ' will be linked to this item.' : ''; $('scNewMsg').className = 'sc-msg';
    $('scNewPhotoSlot').innerHTML = photoBlock('new');
    wirePhotos($('scNewPhotoSlot'));
    view('newitem');
    newState();
    loadInventory().then(newState).catch(() => {});
  }
  function readNew(e) {
    const n = S.newItem;
    if (!n) return;
    n.name = $('scNewName').value; n.brand = $('scNewBrand').value; n.brandOther = $('scNewBrandOther').value;
    n.model = $('scNewModel').value; n.categoryOther = $('scNewCategoryOther').value; n.qty = $('scNewQty').value;
    const cat = $('scNewCategory').value;
    if (e && e.target && e.target.id === 'scNewTrack') n.trackTouched = true;
    if (cat !== n.category && !n.trackTouched) $('scNewTrack').checked = !!TRACK_BY_TYPE[cat];
    n.category = cat;
    n.track = $('scNewTrack').checked;
    S.newExisting = null;
    saveDraft();
    newState();
  }
  /** Why Add is not ready yet, or '' when it is. */
  function newProblem() {
    const n = S.newItem;
    if (!n) return 'no form';
    if (!photosReady('new')) return (S.photos.new || []).some(p => p.state === 'up') ? 'Wait for the photo to upload.' : 'Take a photo of the item first.';
    if (!String(n.name || '').trim()) return 'Type the item name.';
    if (!n.brand) return 'Pick the brand.';
    if (!n.category) return 'Pick the type.';
    const q = Number(n.qty);
    if (!(q > 0)) return 'Enter how many are here.';
    if (n.track && Math.floor(q) !== q) return 'Tracked piece by piece: count whole pieces.';
    if (n.track && q > MAX_PIECES) return 'Tracked piece by piece: at most ' + MAX_PIECES + ' at a time.';
    return '';
  }
  function similarItems() {
    const n = S.newItem;
    if (!n || !S.inventory) return [];
    const model = String(n.model || '').trim().toLowerCase(), name = String(n.name || '').trim().toLowerCase();
    const words = name.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    return S.inventory.filter(i => {
      const no = i.itemNo.toLowerCase(), d = i.name.toLowerCase();
      if (model && no !== 'n/a' && no === model) return true;
      if (name.length >= 4 && d.indexOf(name) !== -1) return true;
      return words.length >= 2 && words.every(w => d.indexOf(w) !== -1);
    }).slice(0, 5);
  }
  function newState() {
    const n = S.newItem;
    if (!n || S.view !== 'newitem') return;
    show('scNewBrandOtherWrap', n.brand === 'Others');
    show('scNewCategoryOtherWrap', n.category === 'Others');
    const brand = n.brand === 'Others' ? n.brandOther : n.brand, cat = n.category === 'Others' ? n.categoryOther : n.category;
    const desc = String(n.name || '').trim() ? newDescription(brand, cat, n.name) : '';
    const model = String(n.model || '').trim();
    $('scNewPreview').textContent = desc ? 'Will be saved as: ' + desc + ' · Item No ' + (model || 'N/A') + (n.track ? ' · each piece labelled' : '') : '';
    const problem = newProblem();
    $('scNewSave').disabled = !!problem;
    $('scNewSave').title = problem;
    const list = S.newExisting ? [S.newExisting] : similarItems();
    const box = $('scNewSimilar');
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<p class="sc-sub">${S.newExisting ? 'It is already in inventory.' : 'Already in inventory?'} Tap it to use it instead.</p>` +
      '<div class="sc-link-lines">' + list.map(i => `<button type="button" class="sc-link-line" data-use="${esc(i.itemId)}"><b>${esc(i.name)}</b><span>${esc(i.itemNo || '')} · ${esc(i.itemId)}</span></button>`).join('') + '</div>' : '';
    box.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => useExisting(b.dataset.use)));
  }
  async function useExisting(itemId) {
    const n = S.newItem;
    const bc = n && n.barcode;
    S.newItem = null; S.newExisting = null; delete S.photos.new; storeSet(NEW_KEY, null);
    renderBasket(); view('stockin');
    if (bc) {
      try {
        const r = await postFlow('linkBarcode', { barcode: bc, itemId: itemId });
        if (r && r.success && S.stock) S.stock.codes[bc] = itemId;
      } catch (e) { /* the item is still added; the barcode can be linked on the next scan */ }
    }
    addStockItem(itemId);
  }
  async function saveNewItem() {
    const n = S.newItem, btn = $('scNewSave'), m = $('scNewMsg');
    if (!n || newProblem()) return;
    btn.disabled = true;
    m.textContent = 'Adding…'; m.className = 'sc-msg ok';
    try {
      const res = await postFlow('createItemByScan', { clientRef: n.ref, name: n.name, brand: n.brand, brandOther: n.brandOther, model: n.model,
        category: n.category, categoryOther: n.categoryOther, qty: String(n.qty), track: !!n.track, barcode: n.barcode || '',
        photoIds: JSON.stringify(okIds('new')) });
      if (!res || !res.success) {
        if (res && res.existing) { S.newExisting = res.existing; S.newExisting.name = S.newExisting.name || S.newExisting.itemId; }
        tone(false); m.textContent = (res && res.message) || 'Could not add the item.'; m.className = 'sc-msg bad';
        newState();
        return;
      }
      if (S.stock) {
        if (res.itemCode) S.stock.codes[res.itemCode] = res.itemId;
        if (n.barcode) S.stock.codes[n.barcode] = res.itemId;
        S.stock.names[res.itemId] = { itemNo: res.itemNo, name: res.description };
        if (n.track) S.stock.tracked[res.itemId] = 1;
      }
      if (S.inventory) S.inventory.push({ itemId: res.itemId, itemNo: res.itemNo || '', name: res.description || n.name });
      const codes = [res.itemCode].concat((res.pieces || []).map(x => x.code)).filter(Boolean);
      S.newItem = null; S.newExisting = null; delete S.photos.new; storeSet(NEW_KEY, null);
      finish('Added to inventory', res.message || (res.itemId + ' added.'), codes,
        { labelText: codes.length > 1 ? 'Print ' + codes.length + ' labels' : 'Print label', more: true, againText: 'Back to Stock in' });
    } catch (e) { tone(false); m.textContent = e.message || 'Could not add the item. The form is kept on this phone.'; m.className = 'sc-msg bad'; newState(); }
  }

  /* ── Return: pieces back from site ────────────────────────────────────────────────────────── */
  async function openReturn() {
    const d = storeGet('hx_scan_v1_return');
    S.ret = (d && d.ret) || []; S.ref = (d && d.ref) || ''; S.photos = {}; restorePhotos(d && d.photos);
    S.outPieces = null;
    renderReturn();
    view('return');
    try {
      const res = await postFlow('getScanContext', { mode: 'return' });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the pieces that are out.');
      S.outPieces = res.pieces || [];
      S.ret = S.ret.filter(a => S.outPieces.some(p => p.assetNo === a));      // drop any brought back since
      renderReturn();
      if (S.ret.length) flash('Your return from this phone was restored.', 'ok');
    } catch (e) { banner(e.message || 'Could not load the pieces that are out.'); }
  }
  function scanReturn(c) {
    if (!S.outPieces) { refuse('Still loading the pieces that are out. Try again in a moment.'); return 'ignored'; }
    const p = S.outPieces.filter(x => x.code === c || x.assetNo === c)[0];
    if (!p) { refuse(c + ' is not a piece that is out on an order.'); return 'missing'; }
    if (S.ret.indexOf(p.assetNo) !== -1) { refuse(p.assetNo + ' is already counted.'); return 'again'; }
    S.ret.push(p.assetNo);
    tone(true);
    flash(p.name + '  ·  ' + p.assetNo + ' back from ' + (p.location || 'site'), 'ok');
    saveDraft(); renderReturn();
    return 'ok';
  }
  function renderReturn() {
    const rows = S.ret.map(a => (S.outPieces || []).filter(p => p.assetNo === a)[0] || { assetNo: a, name: '', location: '' });
    $('scRetList').innerHTML = rows.length ? rows.map(p => `
      <div class="sc-line" data-asset="${esc(p.assetNo)}">
        <div class="sc-line-head"><b>${esc(p.name || p.assetNo)}</b><span class="sc-line-no">${esc(p.assetNo)} · was at ${esc(p.location || '?')}${p.since ? ' since ' + esc(String(p.since).slice(0, 10)) : ''}</span></div>
        <div class="sc-line-act"><button type="button" class="btn btn-sm" data-unret="1" aria-label="Remove ${esc(p.assetNo)}">&times;</button></div>
      </div>`).join('') : `<div class="hx-empty">${S.outPieces && !S.outPieces.length ? 'No piece is out on an order right now.' : 'Scan each piece coming back.'}</div>`;
    $('scRetList').querySelectorAll('[data-unret]').forEach(b => b.addEventListener('click', () => {
      const a = b.closest('[data-asset]').dataset.asset;
      S.ret = S.ret.filter(x => x !== a); saveDraft(); renderReturn();
    }));
    $('scRetMeta').textContent = S.outPieces ? S.outPieces.length + ' out' : '';
    $('scClear').textContent = 'Clear';
    $('scReviewBtn').disabled = !S.ret.length;
    $('scReviewBtn').textContent = S.ret.length ? 'Review ' + plural(S.ret.length, 'piece') : 'Review';
  }

  /* ── Look up ──────────────────────────────────────────────────────────────────────────────── */
  async function lookup(c) {
    $('scLook').innerHTML = '<div class="hx-empty">Looking up…</div>';
    try {
      const r = await postFlow('getScanLookup', { code: c });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not look it up.');
      if (r.kind === 'unknown') {
        tone(false);
        $('scLook').innerHTML = `<div class="sc-look-unknown"><b>Not known yet</b><p>${esc(c)} is not tied to anything. Link it while receiving or in Stock in.</p></div>`;
        return;
      }
      tone(true);
      flash('', '');
      renderLookup(r);
    } catch (e) { refuse(e.message || 'Could not look it up.'); $('scLook').innerHTML = `<div class="hx-empty">${esc(e.message || '')}</div>`; }
  }
  function renderLookup(r) {
    const it = r.item || {};
    const rows = [];
    let head = '', actions = '';
    if (r.kind === 'piece') {
      const p = r.piece;
      const st = p.status === 'Out' ? 'out' : p.status === 'In warehouse' ? 'in' : 'other';
      head = `<div class="sc-look-head"><span class="sc-look-kind">Piece</span><h2>${esc(p.assetNo)}</h2><p>${esc(it.name || '')}${it.itemNo ? ' · ' + esc(it.itemNo) : ''}</p></div>
        <div class="sc-status sc-status-${st}">${esc(p.status)}${p.status === 'Out' ? ' · ' + esc(p.location) : ''}</div>`;
      rows.push(['Last move', (p.lastRef || '') + (p.since ? ' · ' + p.since : '')], ['Received', (p.mrNo || '') + (p.receivedAt ? ' · ' + String(p.receivedAt).slice(0, 10) : '')]);
      actions = `<a class="btn btn-sm" href="labels.html?codes=${encodeURIComponent(r.code)}">Reprint label</a>`;
    } else {
      head = `<div class="sc-look-head"><span class="sc-look-kind">Item</span><h2>${esc(it.name || it.itemId)}</h2><p>${esc(it.itemNo || '')}</p></div>`;
      rows.push(['On hand', fmt(it.balance)]);
      if (it.brand) rows.push(['Brand', it.brand]);            // A319
      if (it.model) rows.push(['Model', it.model]);
      if (it.category) rows.push(['Type', it.category]);
      if (it.tracked) rows.push(['Pieces', it.piecesIn + ' in the warehouse · ' + it.piecesOut + ' out']);
      if ((it.barcodes || []).length) rows.push(['Supplier barcodes', it.barcodes.join(', ')]);
      if (r.lastScan) rows.push(['Last scanned', r.lastScan.mode.toLowerCase() + ' · ' + r.lastScan.docNo + ' · ' + r.lastScan.at]);
      actions = `<a class="btn btn-sm" href="labels.html?items=${encodeURIComponent(it.itemId + ':1')}">Print item label</a>`;
      if (S.canPost) {
        actions += `<button type="button" class="btn btn-sm" id="scTrack">${it.tracked ? 'Stop tracking each piece' : 'Track each piece'}</button>`;
        if (it.tracked) actions += `<button type="button" class="btn btn-sm btn-primary primary" id="scRegOpen">Register pieces</button>`;
      }
    }
    const hist = (r.history || []).length ? `<h3 class="sc-sub">Movements</h3><ol class="sc-hist">${r.history.map(h =>
      `<li><b>${esc(h.mode.charAt(0) + h.mode.slice(1).toLowerCase())}</b> ${esc(h.ref || h.docNo)}<span>${esc(h.at)}${h.user ? ' · ' + esc(h.user) : ''}</span></li>`).join('')}</ol>` : '';
    $('scLook').innerHTML = head + `<dl class="sc-dl">${rows.filter(x => x[1]).map(x => `<dt>${esc(x[0])}</dt><dd>${esc(x[1])}</dd>`).join('')}</dl>` +
      `<div class="sc-look-photos" id="scLookPhotos"></div>` + hist + `<div class="sc-look-act">${actions}</div>`;
    const t = $('scTrack');
    if (t) t.addEventListener('click', () => setTracking(it, !it.tracked, r.code));
    const g = $('scRegOpen');
    if (g) g.addEventListener('click', () => openRegister(it));
    if ((r.photoIds || []).length) loadPhotos(r.photoIds);
  }
  async function loadPhotos(ids) {
    const box = $('scLookPhotos');
    if (!box) return;
    box.innerHTML = '<span class="sc-hint">Loading photos…</span>';
    try {
      const res = await postFlow('getScanPhotos', { docIds: JSON.stringify(ids.slice(0, 6)) });
      const list = (res && res.success && res.data) || [];
      box.innerHTML = list.map(p => `<figure><img src="data:${esc(p.mimeType || 'image/jpeg')};base64,${esc(p.base64)}" alt="${esc(p.type)}">
        <figcaption>${esc(p.type)} · ${esc(p.at)}</figcaption></figure>`).join('');
    } catch (e) { box.innerHTML = ''; }
  }
  async function setTracking(it, on, code) {
    if (on && !confirm('Track ' + (it.name || it.itemId) + ' piece by piece?\n\nFrom now on every piece received gets its own label, and dispatching it needs each piece\'s label. Pieces already on the shelf are registered with "Register pieces".')) return;
    try {
      const res = await postFlow('setItemTracking', { itemId: it.itemId, track: on });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not change tracking.');
      flash(res.message, 'ok');
      lookup(code);
    } catch (e) { refuse(e.message); }
  }
  function openRegister(it) {
    const room = Math.max(0, Math.floor(num(it.balance)) - num(it.piecesIn));
    sheet('Register pieces', (it.name || it.itemId) + ': ' + room + ' piece' + (room === 1 ? '' : 's') + ' on the shelf ' + (room === 1 ? 'has' : 'have') +
      ' no label yet. Each one registered gets its own label to print.',
      `<label class="sc-notes">How many pieces<input type="number" inputmode="numeric" min="1" max="${room}" step="1" id="scRegQty" value="${Math.min(1, room)}"></label>
       ${'<div class="sc-photos" data-key="reg"></div>'}
       <button type="button" class="btn btn-primary" id="scRegGo" disabled>Register</button>`);
    S.reg = { itemId: it.itemId, name: it.name, room: room };
    S.photos.reg = [];
    refreshPhotos('reg');
    $('scRegQty').addEventListener('input', regState);
    $('scRegGo').addEventListener('click', doRegister);
  }
  function regState() {
    const b = $('scRegGo'), q = $('scRegQty');
    if (!b || !q || !S.reg) return;
    const n = parseInt(q.value, 10);
    b.disabled = !(n > 0 && n <= S.reg.room) || !photosReady('reg');
  }
  async function doRegister() {
    const q = parseInt($('scRegQty').value, 10), b = $('scRegGo');
    b.disabled = true;
    sheetMsg('Registering…', true);
    try {
      const res = await postFlow('registerAssets', { itemId: S.reg.itemId, qty: String(q), photoIds: JSON.stringify(okIds('reg')) });
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not register the pieces.');
      const codes = (res.assets || []).map(a => a.code);
      closeSheet();
      finish('Pieces registered', res.message, codes);
    } catch (e) { sheetMsg(e.message, false); b.disabled = false; }
  }

  /* ── review and post ──────────────────────────────────────────────────────────────────────── */
  function payloadLines() {
    return S.lines.filter(l => num(S.counts[l.line]) > 0).map(l => {
      const row = { line: l.line, itemId: l.itemId, itemNo: l.itemNo, qty: num(S.counts[l.line]), codes: (S.codes[l.line] || []).slice(0, 5) };
      if (S.mode === 'dispatch' && l.tracked) row.assets = (S.assets[l.line] || []).slice();
      return row;
    });
  }
  function reviewChrome(title, meta, postLabel) {
    $('scReviewTitle').textContent = title;
    $('scReviewMeta').textContent = meta;
    $('scPost').textContent = postLabel;
    $('scMsg').textContent = ''; $('scMsg').className = 'sc-msg';
    show('scCondWrap', S.mode === 'return');
    show('scNotesWrap', S.mode === 'dispatch' || S.mode === 'return');
    $('scNotes').placeholder = S.mode === 'return' ? 'Where it came from, what is wrong with it…' : 'Driver, plate number, who received it…';
    show('scCharges', S.mode === 'receive' && S.canPost);
  }
  function openReview() {
    if (S.mode === 'stockin') return openStockReview();
    if (S.mode === 'return') {
      if (!S.ret.length) return;
      reviewChrome('Save the return', plural(S.ret.length, 'piece'), 'Save return');
      $('scReviewLines').innerHTML = '<table class="sc-review-t"><tbody>' + S.ret.map(a => {
        const p = (S.outPieces || []).filter(x => x.assetNo === a)[0] || {};
        return `<tr><td>${esc(p.name || a)}<small>${esc(a)} · from ${esc(p.location || '?')}</small></td></tr>`;
      }).join('') + '</tbody></table>';
    } else {
      const rows = payloadLines();
      if (!rows.length) return;
      const recv = S.mode === 'receive';
      reviewChrome(recv ? (S.canPost ? 'Post the receiving' : 'Save the count') : 'Save the dispatch',
        S.doc.docNo + ' · ' + (S.doc.party || ''), recv ? (S.canPost ? 'Post receiving' : 'Save count') : 'Save dispatch');
      $('scReviewLines').innerHTML = '<table class="sc-review-t"><tbody>' + rows.map(r => {
        const l = S.lines.filter(x => x.line === r.line)[0];
        const sub = (l.itemNo || '') + (r.assets ? ' · ' + r.assets.join(', ') : '') + (recv && l.tracked ? ' · each piece gets its own label' : '');
        return `<tr><td>${esc(l.name)}<small>${esc(sub)}</small></td><td class="num"><b>${fmt(r.qty)}</b> / ${fmt(l.remaining)}</td></tr>`;
      }).join('') + '</tbody></table>';
    }
    $('scPhotoSlot').innerHTML = photoBlock('doc');
    wirePhotos($('scPhotoSlot'));
    view('review'); updatePostState();
  }
  function openStockReview() {
    const gs = groups();
    if (!gs.length) return;
    reviewChrome(S.canPost ? 'Post the stock in' : 'Save the counts', plural(gs.length, 'purchase order'), S.canPost ? 'Post all' : 'Save counts');
    $('scReviewLines').innerHTML = gs.map(g => `
      <div class="sc-group" data-po="${esc(g.poNo)}">
        <div class="sc-group-head"><b>${esc(g.poNo)}</b><span>${esc(g.supplier || '')} · ${g.soNo ? 'for ' + esc(g.soNo) : 'for stock'}</span></div>
        <table class="sc-review-t"><tbody>${g.entries.map(e => `<tr><td>${esc(e.name)}<small>${esc(e.itemNo || '')} · line ${e.line}${e.tracked ? ' · each piece gets its own label' : ''}</small></td><td class="num"><b>${fmt(e.qty)}</b> / ${fmt(e.remaining)}</td></tr>`).join('')}</tbody></table>
        ${photoBlock('po:' + g.poNo)}
        ${S.canPost ? `<details class="sc-gcharges"><summary>Charges paid on this delivery</summary><div class="sc-charges">
          <label>Customs duties<input type="number" inputmode="decimal" min="0" step="0.01" data-charge="duties" value="0"></label>
          <label>VAT<input type="number" inputmode="decimal" min="0" step="0.01" data-charge="vat" value="0"></label>
          <label>Delivery<input type="number" inputmode="decimal" min="0" step="0.01" data-charge="delivery" value="0"></label>
          <label>Other<input type="number" inputmode="decimal" min="0" step="0.01" data-charge="other" value="0"></label></div></details>` : ''}
        <div class="sc-msg ${S.groupMsg[g.poNo] ? S.groupMsg[g.poNo].kind : ''}">${esc(S.groupMsg[g.poNo] ? S.groupMsg[g.poNo].text : '')}</div>
      </div>`).join('');
    $('scPhotoSlot').innerHTML = '';
    wirePhotos($('scReviewLines'));
    view('review'); updatePostState();
  }
  function msg(text, ok) { const m = $('scMsg'); m.textContent = text; m.className = 'sc-msg ' + (ok ? 'ok' : 'bad'); }
  /** receiveByScan with the same three questions the desktop Receiving page asks, in the same order.
   *  A "no" comes back as { stopped: true }. */
  async function receiveWithChecks(payload, label) {
    const extra = {};
    let res = await postFlow('receiveByScan', payload);
    if (res && !res.success && res.missingDocs && res.missingDocs.length) {
      if (!confirm(label + res.message + '\n\nReceive WITHOUT these documents? This is recorded against the order. ' +
                   '(Cancel, then attach them from the shipment on the desktop.)')) return { success: false, stopped: true, message: 'Not posted. Attach the documents first.' };
      extra.confirmNoDocs = true;
      res = await postFlow('receiveByScan', Object.assign({}, payload, extra));
    }
    if (res && !res.success && res.partialPay) {
      if (!confirm(label + res.message + '\n\nProceed with the reduced cost basis?')) return { success: false, stopped: true, message: 'Not posted. Record the balance in AP Aging first.' };
      extra.confirmPartialPay = true;
      res = await postFlow('receiveByScan', Object.assign({}, payload, extra));
    }
    if (res && !res.success && res.unpaid) {
      if (!confirm(label + res.message + '\n\nProceed anyway with a zero landed cost?')) return { success: false, stopped: true, message: 'Not posted. Record the AP payment first.' };
      extra.confirmUnpaid = true;
      res = await postFlow('receiveByScan', Object.assign({}, payload, extra));
    }
    return res;
  }
  async function post() {
    const btn = $('scPost');
    btn.disabled = true;
    try {
      if (S.mode === 'stockin') { await postStock(); return; }
      if (S.mode === 'return') {
        const res = await postFlow('returnByScan', { assets: JSON.stringify(S.ret), photoIds: JSON.stringify(okIds('doc')),
          condition: (document.querySelector('input[name="scCond"]:checked') || {}).value || 'Good', notes: $('scNotes').value || '', clientRef: ref() });
        if (!res || !res.success) throw new Error((res && res.message) || 'Could not save the return.');
        S.ret = [];
        finish('Back in the warehouse', res.message + ' Stock is not changed; returns are a record for now.');
        return;
      }
      const lines = JSON.stringify(payloadLines()), photoIds = JSON.stringify(okIds('doc'));
      let res;
      if (S.mode === 'dispatch') {
        res = await postFlow('dispatchByScan', { soNo: S.doc.docNo, lines: lines, photoIds: photoIds, notes: $('scNotes').value || '', clientRef: ref() });
        if (!res || !res.success) throw new Error((res && res.message) || 'Could not save the dispatch.');
        finish('Dispatch saved', (res.dispatchNo || '') + ' records what left against ' + S.doc.docNo + '. Stock is deducted when it is invoiced.');
        return;
      }
      if (!S.canPost) {
        res = await postFlow('saveScanCount', { poNo: S.doc.docNo, lines: lines, photoIds: photoIds });
        if (!res || !res.success) throw new Error((res && res.message) || 'Could not save the count.');
        finish('Count saved', res.message || 'Accounting can post it.');
        return;
      }
      res = await receiveWithChecks({ poNo: S.doc.docNo, lines: lines, photoIds: photoIds, date: (typeof flowToday === 'function') ? flowToday() : '',
        duties: num($('scDuties').value), vat: num($('scVat').value), delivery: num($('scDelivery').value), other: num($('scOther').value),
        clientRef: ref() }, '');
      if (res && res.stopped) { msg(res.message, false); return; }
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not post the receiving.');
      const pieces = (res.assets || []).map(a => a.code);
      finish('Received', res.mrNo + ' is in the process flow: inventory, landed cost and the journal are updated.' +
        (pieces.length ? ' ' + plural(pieces.length, 'piece') + ' got their own label.' : ''), pieces);
    } catch (e) { msg(e.message || 'Something went wrong. Your count is kept on this phone.', false); }
    finally { if (S.view === 'review') updatePostState(); else btn.disabled = false; }
  }
  async function postStock() {
    const done = [], pieces = [];
    for (const g of groups()) {
      const key = 'po:' + g.poNo, box = document.querySelector('.sc-group[data-po="' + g.poNo + '"]');
      if (!photosReady(key)) { S.groupMsg[g.poNo] = { kind: 'bad', text: 'Take a photo of this delivery first.' }; continue; }
      const lines = JSON.stringify(g.entries.map(e => ({ line: e.line, itemId: e.itemId, itemNo: e.itemNo, qty: e.qty })));
      const gref = S.groupRefs[g.poNo] = S.groupRefs[g.poNo] || newRef();
      saveDraft();
      const field = (k) => (box && box.querySelector('[data-charge="' + k + '"]')) || null;
      const charge = (k) => num(field(k) ? field(k).value : 0);
      let res;
      try {
        if (S.canPost) {
          res = await receiveWithChecks({ poNo: g.poNo, lines: lines, photoIds: JSON.stringify(okIds(key)), clientRef: gref,
            date: (typeof flowToday === 'function') ? flowToday() : '',
            duties: charge('duties'), vat: charge('vat'), delivery: charge('delivery'), other: charge('other') }, g.poNo + ': ');
        } else {
          res = await postFlow('saveScanCount', { poNo: g.poNo, lines: lines, photoIds: JSON.stringify(okIds(key)) });
        }
      } catch (e) { res = { success: false, message: e.message || 'Could not reach the server.' }; }
      if (res && res.success) {
        done.push(g.poNo + (res.mrNo ? ' as ' + res.mrNo : ' counted'));
        (res.assets || []).forEach(a => pieces.push(a.code));
        S.basket = S.basket.filter(e => e.poNo !== g.poNo);
        delete S.groupRefs[g.poNo]; delete S.photos[key]; delete S.groupMsg[g.poNo];
      } else S.groupMsg[g.poNo] = { kind: 'bad', text: (res && res.message) || 'Not posted.' };
      saveDraft();
    }
    if (!S.basket.length) {
      finish(S.canPost ? 'Stock received' : 'Counts saved', done.join(', ') + (S.canPost ? '. Inventory, landed cost and the journal are updated.' : '. Accounting can post them.'), pieces);
      return;
    }
    renderBasket();
    openStockReview();
    if (done.length) { tone(true); msg('Done: ' + done.join(', ') + '. The rest are still here with the reason.', true); }
    else { tone(false); msg('Nothing was posted. See each purchase order below.', false); }
  }
  function finish(title, text, pieceCodes, opts) {
    opts = opts || {};
    if (S.mode === 'stockin' || S.mode === 'return') saveDraft(); else dropDraft();
    S.counts = {}; S.codes = {}; S.assets = {}; S.ref = ''; if (S.mode !== 'stockin') S.photos = {};
    $('scDoneTitle').textContent = title;
    $('scDoneText').textContent = text;
    const lab = $('scDoneLabels');
    if ((pieceCodes || []).length) { lab.href = 'labels.html?codes=' + encodeURIComponent(pieceCodes.join(',')); lab.hidden = false; }
    else lab.hidden = true;
    lab.textContent = opts.labelText || 'Print piece labels';
    $('scAgain').textContent = opts.againText || 'Scan another';
    show('scDoneMore', !!opts.more);
    tone(true);
    view('done');
  }
  function clearAll() {
    if (S.mode === 'stockin') {
      if (!S.basket.length || !confirm('Empty the basket?')) return;
      S.basket = []; S.groupRefs = {}; S.photos = {}; S.groupMsg = {}; saveDraft(); renderBasket();
    } else if (S.mode === 'return') {
      if (!S.ret.length || !confirm('Clear the pieces scanned?')) return;
      S.ret = []; S.ref = ''; S.photos = {}; saveDraft(); renderReturn();
    } else if (S.doc && confirm('Clear the count for ' + S.doc.docNo + '?')) {
      S.counts = {}; S.codes = {}; S.assets = {}; S.ref = ''; S.photos = {}; dropDraft(); renderLines();
    }
  }
  function backToScanning() {
    if (S.mode === 'stockin') { renderBasket(); view('stockin'); }
    else if (S.mode === 'return') { renderReturn(); view('return'); }
    else view('work');
  }
  function again() {
    if (S.mode === 'stockin') { renderBasket(); view('stockin'); }
    else if (S.mode === 'return') openReturn();
    else if (S.mode === 'lookup') view('lookup');
    else { view('pick'); loadDocs(); }
  }

  /* ── boot ─────────────────────────────────────────────────────────────────────────────────── */
  function wire() {
    document.querySelectorAll('.sc-mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('scSearch').addEventListener('input', renderDocs);
    $('scBack').addEventListener('click', () => { S.doc = null; view('pick'); loadDocs(); });
    $('scCamStart').addEventListener('click', startCam);
    $('scCamStop').addEventListener('click', stopCam);
    $('scEntry').addEventListener('submit', (e) => { e.preventDefault(); const i = $('scCode'); scan(i.value, false); i.value = ''; i.focus(); });
    $('scType').addEventListener('click', () => { const i = $('scCode'); i.setAttribute('inputmode', i.getAttribute('inputmode') === 'none' ? 'text' : 'none'); i.blur(); i.focus(); });
    $('scClear').addEventListener('click', clearAll);
    $('scReviewBtn').addEventListener('click', openReview);
    $('scReviewBack').addEventListener('click', backToScanning);
    $('scPost').addEventListener('click', post);
    $('scAgain').addEventListener('click', again);
    // A319 — the New item form
    $('scNewBrand').innerHTML = '<option value="">Choose…</option>' + BRANDS.map(b => `<option>${esc(b)}</option>`).join('');
    $('scNewCategory').innerHTML = '<option value="">Choose…</option>' + CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('');
    ['scNewName', 'scNewBrand', 'scNewBrandOther', 'scNewModel', 'scNewCategory', 'scNewCategoryOther', 'scNewQty', 'scNewTrack']
      .forEach(id => { $(id).addEventListener('input', readNew); $(id).addEventListener('change', readNew); });
    $('scNewOpen').addEventListener('click', () => openNewItem(''));
    $('scNewSave').addEventListener('click', saveNewItem);
    $('scNewCancel').addEventListener('click', () => { renderBasket(); view('stockin'); });
    $('scDoneMore').addEventListener('click', () => openNewItem(''));
    $('scSheetCancel').addEventListener('click', () => { const f = S.sheetCancel; closeSheet(); if (f) f(); });
    $('scPhotoIn').addEventListener('change', (e) => takePhotos(e.target.files));
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
    try { S.canNew = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(NEW_MIN_VERSION) : false; } catch (e) { S.canNew = false; }
    S.ready = false;
    setMode('receive');
    S.ready = true;
  });

  window.__scan = { S, scan, candidates, add, payloadLines, saveDraft, loadDraft, draftKey, open, groups, addStockItem,
                    scanReturn, photosReady, findItems, setMode, OWN_RE,
                    BRANDS, CATEGORIES, TRACK_BY_TYPE, newDescription, openNewItem, readNew, newProblem, similarItems, NEW_KEY };   // tests
})();
