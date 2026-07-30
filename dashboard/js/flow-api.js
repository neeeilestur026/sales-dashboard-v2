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

/* A158 — actions that decide or move money go through the Flask server, which validates the login
   session and stamps the caller's REAL role before forwarding. Sending actorRole from here was only
   ever advisory: the browser could claim any role it liked. Keep this list in step with SECURED_ACTIONS
   in blueprints/flow.py and _SECURED in FlowAPI.gs. */
const FLOW_SECURED_ACTIONS = [
  'approveQuotation', 'rejectQuotation', 'approvePO', 'rejectPO',
  'approvePaymentRequest', 'rejectPaymentRequest', 'markPaymentRequestPaid',
  'setMgmtPricing', 'verifyReturnToSales',
  'deleteQuotation', 'deleteSalesOrder', 'deletePurchaseOrder', 'deletePaymentRequest',
  'deleteAPEntry', 'updateAPAging', 'recordCollection', 'correctCollection',
  'voidCollection', 'voidInvoice'
];
function _flowIsSecured(action) { return FLOW_SECURED_ACTIONS.indexOf(action) !== -1; }

/* A158 — who releases the money for a given payment method. Bank/online transfers are executed by
   the director, every other method by accounting. This lived in three separate copies (the payment
   actions, the Action Center and FlowAPI); adding a method to the form would have silently routed it
   to accounting in all of them. Mirrors _PR_DIRECTOR_METHODS / _prPayOwner in FlowAPI.gs. */
const FLOW_DIRECTOR_PAY_METHODS = ['bank transfer', 'online'];
function flowPayOwner(method) {
  return FLOW_DIRECTOR_PAY_METHODS.indexOf(String(method || '').trim().toLowerCase()) !== -1
    ? 'director' : 'accounting';
}

function _flowSessionToken() {
  try { const s = JSON.parse(localStorage.getItem('session') || '{}'); return (s && s.token) || ''; }
  catch (e) { return ''; }
}

/** Route a secured mutation through Flask. Identity is resolved server-side, so actorName/actorRole
 *  are not sent — anything this function passed would be discarded anyway. */
async function _postFlowSecured(action, params) {
  const token = _flowSessionToken();
  const res = await fetch('/flow/secure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
    body: JSON.stringify({ sessionToken: token, action: action, params: params })
  });
  let data;
  try { data = await res.json(); }
  catch (e) { throw new Error('The server returned an unreadable response — refresh and check the record.'); }
  if (!res.ok && data && data.message) throw new Error(data.message);
  _flowCacheClear();
  return data;
}

async function postFlow(action, params = {}) {
  if (!_flowConfigured()) throw new Error('Flow backend not configured. Set FLOW_API_URL in js/flow-api.js.');
  if (_flowIsSecured(action)) return _postFlowSecured(action, params);
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
  else if (k === 'paid') cls = 'b-paid';                                              // A156: payment settled, proof on file
  else if (k === 'rejected') cls = 'b-rejected';
  else if (k === 'not pursued' || k === 'lost' || k === 'cancelled') cls = 'b-lost';   // A152 soft-close outcomes
  else if (k === 'sent' || k === 'closed' || k === 'quoted') cls = 'b-sent';
  return `<span class="flow-badge ${cls}">${flowEsc(s)}</span>`;
}

/** Inject the flow sub-navigation into #flowNav, highlighting `active`. */
function renderFlowNav(active) {
  const links = [
    ['flow-home.html', 'Home'],
    ['flow-lifecycle.html', 'Lifecycle'],
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
    ['flow-suppliers.html', 'Suppliers'],
    ['flow-clients.html', 'Clients'],
    ['flow-ledger.html', 'Ledger'],
    ['flow-guide.html', 'Guide'],
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
  // A147: distinguish "backend not configured" (configured=false) from a REAL Drive-save failure
  // (saveError set). Callers previously read an empty link as "not configured" and showed a green
  // success toast while the record was stranded with no PDF Link.
  let link = '', saveError = '';
  const configured = _flowConfigured();
  if (configured) {
    try {
      const b64 = await blobToBase64(blob);
      const params = Object.assign({ pdfBase64: b64, fileName: fileName || 'document.pdf' }, opts.extra || {});
      params[idKey] = idValue;
      const save = await postFlow(saveAction, params);
      if (save && save.success) link = save.link || '';
      else saveError = (save && save.message) || 'The Drive save did not complete.';
    } catch (e) { saveError = (e && e.message) || 'The Drive save failed.'; }
  }
  return { link, saveError, configured };
}

/** Remember / restore PDF document-field defaults in localStorage. */
function flowLoadDefaults(key) {
  try { return JSON.parse(localStorage.getItem('flowpdf_' + key) || '{}'); } catch (e) { return {}; }
}
function flowSaveDefaults(key, obj) {
  try { localStorage.setItem('flowpdf_' + key, JSON.stringify(obj)); } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   A181 — a pricing request's per-item breakdown, for display.

   Two pages rendered the pricing history detail (flow-pricing-request.js phDetailHtml and
   management-flow.js mfPricingDetail) and BOTH did the same thing: if a saved engine breakdown
   existed they rendered only its rows and never looked at the request's items. So a request whose
   breakdown covers fewer lines than it has items showed only those lines — PR-202607-210 displayed
   1 of its 5 items, because a later re-price saved the engine with a single row and
   setMgmtPricing replaced the whole breakdown column.

   This returns ONE ROW PER ITEM, each carrying its saved breakdown when there is one. The join is
   by line where the breakdown records one (A159 onwards) and by exact name otherwise; measured
   against all 269 live requests that resolves every stored row (25 by line, 110 by name, 0 left
   over). A breakdown row that matches no item is still returned, so nothing is ever dropped.
   ════════════════════════════════════════════════════════════════════════════ */
function _flowNormName(s) { return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim(); }

function flowPricingRows(rec) {
  rec = rec || {};
  let bd = [];
  try { bd = JSON.parse(rec.pricedItemsJson || rec.legacyItemsJson || '[]') || []; } catch (e) { bd = []; }
  if (!Array.isArray(bd)) bd = [];
  const items = Array.isArray(rec.items) ? rec.items : [];

  const used = new Array(bd.length).fill(false);
  // Claim a breakdown row at most once, so two identically-named lines cannot share one row.
  const pick = (test) => {
    for (let i = 0; i < bd.length; i++) {
      if (used[i] || !bd[i]) continue;
      if (test(bd[i])) { used[i] = true; return bd[i]; }
    }
    return null;
  };

  const rows = items.map(it => {
    const line = (it.line != null && it.line !== '') ? String(it.line) : '';
    // 1) by line — only breakdowns written since A159 carry one
    let b = line ? pick(x => x.line != null && x.line !== '' && String(x.line) === line) : null;
    // 2) by exact name — the engine stores the name it was priced under, which is the item's
    //    original (customer-supplied) description, or failing that its mapped name
    if (!b) {
      const cand = [_flowNormName(it.origItemName), _flowNormName(it.itemName)].filter(Boolean);
      if (cand.length) b = pick(x => cand.indexOf(_flowNormName(x.name)) !== -1);
    }
    return { item: it, bd: b, hasBd: !!b, orphan: false };
  });

  // Any breakdown row that belongs to no item still gets shown — it is real recorded pricing.
  bd.forEach((b, i) => { if (b && !used[i]) rows.push({ item: null, bd: b, hasBd: true, orphan: true }); });
  return rows;
}

/** True when at least one item has no recorded breakdown — the caller should say so. */
function flowPricingRowsIncomplete(rows) {
  return (rows || []).some(r => !r.hasBd && r.item);
}

/** The wide per-item breakdown table, shared by the pricing-history and management-home details.
 *  Engine-derived figures are shown ONLY where they were recorded. They are never recomputed: on
 *  PR-202607-210 the four unrecorded lines do not reconcile with their own buy prices at the
 *  request's commission and margin, so anything computed here would be an invented number on a
 *  pricing document. An unrecorded cell says so, in the cell and in a note under the table. */
function flowPricingBreakdownTable(rows) {
  const M = v => flowMoney(flowNum(v), 'PHP');
  const GAP = '<span style="color:var(--text-muted,#94a3b8);" title="Not recorded — the saved pricing breakdown does not cover this line.">—</span>';
  const cols = [
    ['modelNo', 'Model'], ['name', 'Name'], ['qty', 'Qty'], ['buyPrice', 'Buy'],
    ['landedCost', 'Landed'], ['totalCOGS', 'COGS'], ['commission', 'Comm'],
    ['profitMargin', 'Margin'], ['vat', 'VAT'], ['unitPriceVatEx', 'Unit (VAT-ex)'], ['finalPrice', 'Final'],
  ];
  /* Which columns an item can still fill without its breakdown. item.finalPrice is the VAT-EXCLUSIVE
     UNIT price (verified against every joined row), NOT the breakdown's VAT-inclusive line total, so
     it maps to 'unitPriceVatEx' and must never be dropped into 'Final'. */
  const fromItem = {
    modelNo: it => it.itemNo || it.origItemNo || '',
    name: it => it.itemName || it.origItemName || '',
    qty: it => flowNum(it.qty),
    buyPrice: it => it.supplierPrice,
    unitPriceVatEx: it => it.finalPrice,
  };

  const body = (rows || []).map(r => {
    const b = r.bd || {}, it = r.item || {};
    const tds = cols.map(([k]) => {
      let v, known;
      if (r.hasBd) { v = b[k]; known = v !== undefined && v !== null && v !== ''; }
      else if (fromItem[k]) { v = fromItem[k](it); known = v !== undefined && v !== null && v !== ''; }
      else { known = false; }
      if (k === 'modelNo' || k === 'name') return `<td>${known ? flowEsc(v) : GAP}</td>`;
      if (k === 'qty') return `<td class="num">${known ? flowNum(v) : GAP}</td>`;
      return `<td class="num">${known ? M(v) : GAP}</td>`;
    }).join('');
    const excluded = r.item && r.item.included === false;
    const tag = r.orphan
      ? ' title="This priced line no longer matches any item on the request."'
      : (excluded ? ' title="Excluded from the quotation."' : '');
    return `<tr${tag}${excluded ? ' style="opacity:0.55;"' : ''}>${tds}</tr>`;
  }).join('');

  const missing = (rows || []).filter(r => !r.hasBd && r.item).length;
  const note = missing
    ? `<div style="font-size:0.72rem;color:#b45309;margin-top:0.35rem;">⚠ ${missing} of ${(rows || []).filter(r => r.item).length} item(s)
        have no saved cost breakdown — the pricing engine was last saved covering fewer lines than the
        request has. Their buy and unit prices below are the recorded ones; the cost columns were never
        stored and are not recomputed here.</div>`
    : '';

  return `<div style="overflow-x:auto;"><table class="flow-table" style="font-size:0.76rem;">
    <thead><tr>${cols.map(([, l]) => `<th${l === 'Model' || l === 'Name' ? '' : ' class="num"'}>${l}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>${note}`;
}
