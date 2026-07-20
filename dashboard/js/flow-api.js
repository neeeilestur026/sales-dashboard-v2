/* ═══════════════════════════════════════════════
   flow-api.js — client for the Accounting Process Flow backend (FlowAPI.gs)
   Separate from api.js so the new modules use their OWN Apps Script + Sheet,
   while login/existing pages keep using APPS_SCRIPT_URL.
   ═══════════════════════════════════════════════ */

// ─── Configuration ───────────────────────────────
// Paste the FlowAPI.gs web-app /exec URL here after deploying it.
const FLOW_API_URL = 'https://script.google.com/macros/s/AKfycbyOnYzt0M7HePi4VTEHINDaMxNi_ppvjGUyT4cSaExG-oPtjUYWZ6mcjxx9uVNgyyXY/exec';

function _flowConfigured() {
  return FLOW_API_URL && FLOW_API_URL.indexOf('REPLACE_WITH') !== 0;
}

// Apps Script intermittently bounces a request to a one-time googleusercontent URL that can
// momentarily return 404/429/5xx (or the network blips) under load. These are transient — retry them.
function _flowTransient(status) { return status === 404 || status === 408 || status === 429 || status >= 500; }
function _flowSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Read cache ─────────────────────────────────
// Apps Script GETs take 1–3s each and every page re-fetched everything on load. Reads are cached in
// sessionStorage for a short TTL (so navigating between pages reuses fresh data) and concurrent
// identical GETs share one in-flight promise (navbar notifications + page body often overlap).
// Any successful postFlow MUTATION clears the whole cache — "save → refresh list" always sees fresh data.
const _FLOW_CACHE_TTL = 60000;                 // 60s
const _FLOW_CACHE_PREFIX = 'flowCache:';
const _flowInflight = {};                      // key -> Promise (page-lifetime)

function _flowCacheGet(key) {
  try {
    const raw = sessionStorage.getItem(_FLOW_CACHE_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || (Date.now() - obj.t) > _FLOW_CACHE_TTL) return null;
    return obj.data;
  } catch (e) { return null; }
}
function _flowCacheSet(key, data) {
  try { sessionStorage.setItem(_FLOW_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), data })); }
  catch (e) { /* quota/private mode — run uncached */ }
}
function _flowCacheClear() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(_FLOW_CACHE_PREFIX) === 0) sessionStorage.removeItem(k);
    }
  } catch (e) { /* ignore */ }
}

/** GET read-only action. Cached (60s, sessionStorage) + in-flight dedupe; retries transient failures.
 *  Pass { fresh: true } as opts to bypass the cache (manual Refresh buttons). */
async function fetchFlow(action, params = {}, opts = {}) {
  if (!_flowConfigured()) throw new Error('Flow backend not configured. Set FLOW_API_URL in js/flow-api.js.');
  const q = new URLSearchParams(Object.assign({ action }, params)).toString();
  if (!opts.fresh) {
    const hit = _flowCacheGet(q);
    if (hit !== null) return hit;
    if (_flowInflight[q]) return _flowInflight[q];
  }
  const run = (async () => {
    const attempts = 4;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch(`${FLOW_API_URL}?${q}`, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) {
          if (_flowTransient(res.status) && i < attempts - 1) { lastErr = new Error(`Server responded with status ${res.status}`); await _flowSleep(400 * (i + 1)); continue; }
          throw new Error(`Server responded with status ${res.status}`);
        }
        const data = await res.json();
        _flowCacheSet(q, data);
        return data;
      } catch (e) {
        clearTimeout(timer);
        lastErr = (e.name === 'AbortError') ? new Error('Request timed out.') : new Error(e.message || 'Unable to reach the flow backend.');
        if (i < attempts - 1) { await _flowSleep(400 * (i + 1)); continue; }
        throw lastErr;
      }
    }
    throw lastErr || new Error('Unable to reach the flow backend.');
  })();
  _flowInflight[q] = run;
  try { return await run; }
  finally { delete _flowInflight[q]; }
}

/** POST mutation. Items/objects are JSON-stringified by the caller as needed. */
function _flowActor() {
  try { const s = JSON.parse(localStorage.getItem('session') || '{}'); return s && s.name || ''; }
  catch (e) { return ''; }
}
function _flowActorRole() {
  try { const s = JSON.parse(localStorage.getItem('session') || '{}'); return s && s.role || ''; }
  catch (e) { return ''; }
}

/** One-shot idempotency token for a form submission — send as `clientRef` on create-mutations so a
 *  transport retry can never double-write (the backend dedupes on it). */
function flowClientRef() {
  return 'CR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// Updates/deletes/status-sets rewrite the same row and the bulk importers dedupe server-side, so
// repeating them is harmless. Creates/appends (create*/add*/log*/record*) are NOT safe to repeat
// unless they carry a clientRef the backend dedupes on.
function _flowIdempotentAction(action) {
  return /^(update|delete|set|save|approve|reject|submit|verify|advance|reclassify|match|reset|backfill|fill|import|send)/.test(action);
}

async function postFlow(action, params = {}) {
  if (!_flowConfigured()) throw new Error('Flow backend not configured. Set FLOW_API_URL in js/flow-api.js.');
  const body = Object.assign({ actorName: _flowActor(), actorRole: _flowActorRole() }, params, { action });
  const payload = JSON.stringify(body);
  // A retried POST can double-write when the first attempt actually committed (post-commit response
  // loss, client timeout, or Google's HTML-error-page-with-200) — proven live by the A78 PR merger.
  // So: auto-retry only mutations that are idempotent by nature, or that carry a clientRef token
  // the backend dedupes on. Unprotected creates get ONE attempt and surface the error instead.
  const retriable = !!body.clientRef || _flowIdempotentAction(action);
  const attempts = retriable ? 4 : 1;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(FLOW_API_URL, {
        method: 'POST', redirect: 'follow', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain' }, body: payload
      });
      clearTimeout(timer);
      if (!res.ok) {
        if (_flowTransient(res.status) && i < attempts - 1) { lastErr = new Error(`Server responded with status ${res.status}`); await _flowSleep(500 * (i + 1)); continue; }
        throw new Error(`Server responded with status ${res.status}`);
      }
      const data = await res.json();
      _flowCacheClear();   // any mutation may invalidate any cached read
      return data;
    } catch (e) {
      clearTimeout(timer);
      lastErr = (e.name === 'AbortError')
        ? new Error('Request timed out — refresh and check the list before retrying.')
        : new Error(e.message || 'Unable to reach the flow backend.');
      if (i < attempts - 1) { await _flowSleep(500 * (i + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('Unable to reach the flow backend.');
}

// ─── Shared UI helpers ───────────────────────────
function flowEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function flowNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

/** The REAL inventory view: Stock items only (migrated old-system stocks, received goods, anything
 *  processed into a PO). Falls back to all items while the backend hasn't classified types yet
 *  (pre-v79), so no view ever goes blank. Quotation Catalog items live on the Inventory page. */
function flowStockItems(items) {
  const a = items || [];
  const typed = a.some(i => i && (i.type === 'Stock' || i.type === 'Catalog'));
  return typed ? a.filter(i => i && i.type === 'Stock') : a;
}
function flowMoney(v, cur) {
  const sym = { PHP: '₱', USD: '$', EUR: '€', SGD: 'S$', AUD: 'A$', JPY: '¥', GBP: '£' };
  return (sym[cur] || (cur ? cur + ' ' : '')) + flowNum(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** True when the DEPLOYED FlowAPI is at least version n. The Apps Script backend is redeployed by
 *  hand, so a feature can be live in the front-end before its actions exist — an unknown action
 *  answers HTTP 200 with {success:false}, never a throw. Memoized; false on any error. */
let _flowVerPromise = null;
function flowVersionAtLeast(n) {
  if (!_flowVerPromise) {
    _flowVerPromise = fetchFlow('getVersion')
      .then(r => (r && r.success) ? flowNum(r.version) : 0)
      .catch(() => 0);
  }
  return _flowVerPromise.then(v => v >= n);
}
// Timezone-safe date → 'yyyy-MM-dd'. A plain date string passes through unchanged; a Date/ISO datetime
// is formatted in PH time (Asia/Manila) so a Manila-midnight value serialized to UTC (…T16:00Z) does NOT
// truncate to the previous day.
function flowDate(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  try { return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); } catch (e) { return dt.toISOString().slice(0, 10); }
}

// Today's date in PH local time as 'yyyy-MM-dd' (use for date-input defaults instead of the UTC toISOString).
function flowToday() {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
const FLOW_CURRENCIES = ['PHP', 'USD', 'EUR', 'SGD', 'AUD', 'JPY', 'GBP'];

/** Map an approval/workflow status to a .flow-badge class + label. */
function flowStatusBadge(status) {
  const s = String(status || 'Draft');
  const k = s.toLowerCase();
  let cls = 'b-draft';
  if (k.indexOf('pending') === 0 || k === 'open') cls = 'b-pending';
  else if (k === 'approved') cls = 'b-approved';
  else if (k === 'rejected') cls = 'b-rejected';
  else if (k === 'sent' || k === 'closed' || k === 'quoted') cls = 'b-sent';
  return `<span class="flow-badge ${cls}">${flowEsc(s)}</span>`;
}

/** Inject the flow sub-navigation into #flowNav, highlighting `active`. */
function renderFlowNav(active) {
  const links = [
    ['flow-home.html', 'Home'],
    ['flow-accounting.html', 'Accounting'],
    ['flow-inventory.html', 'Inventory'],
    ['flow-quotations.html', 'Quotations'],
    ['flow-sales-orders.html', 'Sales Orders'],
    ['flow-purchase-orders.html', 'Purchase Orders'],
    ['flow-payment-requests.html', 'Payment Requests'],
    ['flow-ap-aging.html', 'AP Aging'],
    ['flow-other-payables.html', 'Other Payables'],
    ['flow-receiving.html', 'Receiving'],
    ['flow-invoices.html', 'Invoices'],
    ['flow-ar-aging.html', 'AR Aging'],
    ['flow-collections.html', 'Collections'],
    ['flow-expenses.html', 'Expenses'],
    ['flow-shipments.html', 'Shipments'],
    ['flow-ledger.html', 'Ledger'],
  ];
  const el = document.getElementById('flowNav');
  if (!el) return;
  el.innerHTML = links.map(([href, label]) =>
    `<a href="${href}" class="flow-tab${href === active ? ' active' : ''}">${label}</a>`).join('');
}

/** Standard toast/message into an element. */
function flowMsg(elId, text, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  el.style.background = ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  el.style.color = ok ? '#16a34a' : '#ef4444';
}

// ─── PDF generation helpers (Flask renders; FlowAPI stores to Drive) ─────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Read a File as a data URL (for item images / brochures). */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Generate a flow PDF (route on the same Flask origin), open it, then store it to
 * Drive via FlowAPI. Returns the Drive link (or '' if Drive save was skipped/failed).
 * route: '/flow/quotation-pdf' | '/flow/po-pdf'; saveAction: 'saveQuotationPDF' | 'savePOPDF'.
 */
async function generateFlowPdf(route, payload, saveAction, idKey, idValue, fileName, opts) {
  opts = opts || {};
  const res = await fetch(route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let msg = `PDF generation failed (HTTP ${res.status})`;
    try { msg = (await res.json()).message || msg; } catch (e) {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  // opts.background: save to Drive silently (no tab) — used for auto-save on record creation.
  if (!opts.background) { try { window.open(URL.createObjectURL(blob), '_blank'); } catch (e) {} }
  let link = '';
  if (_flowConfigured()) {
    try {
      const b64 = await blobToBase64(blob);
      const params = Object.assign({ pdfBase64: b64, fileName: fileName || 'document.pdf' }, opts.extra || {});
      params[idKey] = idValue;
      const save = await postFlow(saveAction, params);
      if (save && save.success) link = save.link || '';
    } catch (e) { /* Drive save is best-effort */ }
  }
  return { link };
}

/** Remember / restore PDF document-field defaults in localStorage. */
function flowLoadDefaults(key) {
  try { return JSON.parse(localStorage.getItem('flowpdf_' + key) || '{}'); } catch (e) { return {}; }
}
function flowSaveDefaults(key, obj) {
  try { localStorage.setItem('flowpdf_' + key, JSON.stringify(obj)); } catch (e) {}
}
