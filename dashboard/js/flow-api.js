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

/** GET read-only action. Retries transient failures a few times with backoff. */
async function fetchFlow(action, params = {}) {
  if (!_flowConfigured()) throw new Error('Flow backend not configured. Set FLOW_API_URL in js/flow-api.js.');
  const q = new URLSearchParams(Object.assign({ action }, params)).toString();
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
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = (e.name === 'AbortError') ? new Error('Request timed out.') : new Error(e.message || 'Unable to reach the flow backend.');
      if (i < attempts - 1) { await _flowSleep(400 * (i + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('Unable to reach the flow backend.');
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

async function postFlow(action, params = {}) {
  if (!_flowConfigured()) throw new Error('Flow backend not configured. Set FLOW_API_URL in js/flow-api.js.');
  const body = Object.assign({ actorName: _flowActor(), actorRole: _flowActorRole() }, params, { action });
  const payload = JSON.stringify(body);
  const attempts = 4;
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
        // Transient redirect/load failures retry. The bulk importers dedupe server-side, so a retry
        // never double-writes; single mutations almost always 404 before the handler runs.
        if (_flowTransient(res.status) && i < attempts - 1) { lastErr = new Error(`Server responded with status ${res.status}`); await _flowSleep(500 * (i + 1)); continue; }
        throw new Error(`Server responded with status ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = (e.name === 'AbortError') ? new Error('Request timed out.') : new Error(e.message || 'Unable to reach the flow backend.');
      if (i < attempts - 1) { await _flowSleep(500 * (i + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('Unable to reach the flow backend.');
}

// ─── Shared UI helpers ───────────────────────────
function flowEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flowNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function flowMoney(v, cur) {
  const sym = { PHP: '₱', USD: '$', EUR: '€', SGD: 'S$', AUD: 'A$', JPY: '¥', GBP: '£' };
  return (sym[cur] || (cur ? cur + ' ' : '')) + flowNum(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function flowDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toISOString().slice(0, 10);
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
    ['flow-ap-aging.html', 'AP Aging'],
    ['flow-receiving.html', 'Receiving'],
    ['flow-invoices.html', 'Invoices'],
    ['flow-ar-aging.html', 'AR Aging'],
    ['flow-collections.html', 'Collections'],
    ['flow-expenses.html', 'Expenses'],
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
async function generateFlowPdf(route, payload, saveAction, idKey, idValue, fileName) {
  const res = await fetch(route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let msg = `PDF generation failed (HTTP ${res.status})`;
    try { msg = (await res.json()).message || msg; } catch (e) {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  try { window.open(URL.createObjectURL(blob), '_blank'); } catch (e) {}
  let link = '';
  if (_flowConfigured()) {
    try {
      const b64 = await blobToBase64(blob);
      const params = { pdfBase64: b64, fileName: fileName || 'document.pdf' };
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
