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
        /* A191: opts.noStore skips the sessionStorage write. Used where a caller needs a payload
           that carries fields the viewer may not see — admin reads getPricingRequests for six
           harmless columns, and without this the commission and margin would sit in their browser
           storage for 60s and survive navigation. It stays in memory for the call's lifetime;
           sealing that needs a role-aware projection on the server. */
        if (!opts.noStore) _flowCacheSet(q, data);
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
  // A225 — admin/accounting only, enforced server-side, so identity comes from the session.
  'createPaymentRequest', 'updatePaymentRequest',
  'setMgmtPricing', 'rejectMgmtPricing', 'verifyReturnToSales',
  'deleteQuotation', 'deleteSalesOrder', 'deletePurchaseOrder', 'deletePaymentRequest',
  // A220 — a rename re-keys fourteen sheets and every money record on the order.
  'renameSalesOrder',
  'deleteAPEntry', 'updateAPAging', 'recordCollection', 'correctCollection',
  'voidCollection', 'voidInvoice',
  // A190 — mirrors _SECURED (FlowAPI.gs) and SECURED_ACTIONS (blueprints/flow.py). If this list
  // omits an action the other two secure, the POST goes direct and the server rejects it.
  'approveWeeklyItinerary', 'rejectWeeklyItinerary',
  // A220 — reclassifying International <-> Local rewrites the document contract at four money gates.
  'setSOSupplierType',
  // A222-U — rewrites stock valuation and deletes a journal; no undo.
  'reverseReceiving',
  // A193 — bulk Drive filing. previewDriveMigration stays out: it is read-only.
  'seedClientAliases', 'runDriveMigration', 'buildDriveSkeleton',
  // A194 run-it-all wrappers + the folder setup call. The three preview/verify actions stay out:
  // they are read-only.
  'buildDriveSkeletonAll', 'runDriveMigrationAll', 'setupFlowDrive',
  'cleanupLegacyFolders', 'cleanupLegacyFoldersApply',
  // A207 — commission actions. submitCommissionRequest is secured too: it freezes what someone gets
  // paid and takes exclusive hold of the collections behind the claim.
  'submitCommissionRequest', 'approveCommissionRequest', 'rejectCommissionRequest',
  'adjustCommissionRequest', 'markCommissionReleased',
  'setCommissionRate', 'deleteCommissionRate', 'deleteCommissionRequest',
  // A211 — the rest of the commission surface. The two getters break the "reads stay direct and
  // cached" rule on purpose: getCommissionRequests with no salesperson returns every claim in the
  // company, and the only honest way to scope it is to know who is asking. A name the browser sent
  // is not that. They lose the 60s cache; the page is opened a few times a day.
  'createCommissionRequest', 'updateCommissionRequest', 'reviseCommissionRequest',
  'getCommissionRequests', 'getCommissionClaimable',
  'seedCommissionDemo', 'clearCommissionDemo',
  // A212 — the travel surface, READ included: getTravelReplenishments with no `user` returns
  // everybody's weeks, and saveTravelReplenishment decides whose name a claim is banked under.
  'getTravelReplenishments', 'saveTravelReplenishment', 'deleteTravelReplenishment',
  // A214 — the receipt photographs of somebody's week, keyed by a guessable TRAV number.
  'getTravelReceipts',
  // A212-3/4/5 — the approval chain and the float: what leaves, how much, and to whom.
  'submitTravelReplenishment', 'approveTravelReplenishment',
  'rejectTravelReplenishment', 'reviseTravelReplenishment',
  'getTravelFloats', 'setTravelFloat', 'requestTravelFloatCash',
  // A215 — rewrites the send date on up to 60 quotations off a browser-supplied actorRole.
  'runQuotationSentAtBackfill',
  // A226 — both rewrite who a purchase request belongs to, which is what the tracker filters by.
  'runPricingRequestOwnerBackfill', 'setPricingRequestSalesperson'
];
function _flowIsSecured(action) { return FLOW_SECURED_ACTIONS.indexOf(action) !== -1; }

/* A224 — who releases the money for a given payment method.
 *
 *     telegraphic transfer  →  accounting or admin
 *     everything else       →  the director
 *
 * The exact mirror of _PR_ACCOUNTING_PAY_METHODS / _prPayOwner in FlowAPI.gs, and it has to stay
 * exact: this decides whether the Mark Paid button is drawn, while the server decides whether the
 * payment is accepted. Disagreement shows a button that is refused, or hides one from the person
 * whose job it is. tests/flow/pay-ownership.js lifts BOTH copies and compares them method by method.
 *
 * A158's version returned a single role and had the rule inverted (director = bank/online). It lived
 * in three copies; this is the one, read by prPayActions, the Action Center and the pay dialog. */
const FLOW_ACCOUNTING_PAY_METHODS = ['telegraphic transfer'];
function flowPayOwner(method) {
  return FLOW_ACCOUNTING_PAY_METHODS.indexOf(String(method || '').trim().toLowerCase()) !== -1
    ? ['accounting', 'admin'] : ['director'];
}
/** Does `role` release this payment method? The question every call site actually asks. */
function flowPayOwns(method, role) { return flowPayOwner(method).indexOf(String(role || '')) !== -1; }
/** "accounting or admin" / "the director" — for telling someone why a button is not theirs. */
function flowPayOwnerLabel(method) {
  const o = flowPayOwner(method);
  return o.length > 1 ? o.slice(0, -1).join(', ') + ' or ' + o[o.length - 1] : 'the ' + o[0];
}

/* A225 — ONE PAYMENT REQUEST PER PURCHASE ORDER, the browser's copy.
 *
 * Mirrors FLOW_PR_PER_PO / _PR_DEAD_STATUSES / _prPerPOProblem in FlowAPI.gs. The server decides
 * whether the request is ACCEPTED; this decides whether the form is drawn as usable. A divergence
 * either shows a Save button the server refuses, or disables one for work that would have been fine.
 * tests/flow/pr-per-po.js lifts BOTH copies and compares their ANSWERS case by case — two lists can
 * agree with each other and both be wrong.
 *
 * 'live' — Draft / any Pending* / Approved stand against the PO. Paid and Rejected do not, which is
 *          what keeps 50% DP → Balance working. */
const FLOW_PR_PER_PO = 'live';                     // 'live' | 'ever'
const FLOW_PR_DEAD_STATUSES = ['Rejected', 'Paid'];
const FLOW_PR_DEAD_EVER = ['Rejected'];

/** rows: [{prNo, status}] already scoped to one PO and excluding the record being edited.
 *  Returns '' when a new request may be raised, else the reason, naming the request in the way. */
function flowPRPerPOProblem(poNo, rows) {
  const dead = FLOW_PR_PER_PO === 'ever' ? FLOW_PR_DEAD_EVER : FLOW_PR_DEAD_STATUSES;
  const live = (rows || []).filter(r => dead.indexOf(String(r.status || 'Draft') || 'Draft') === -1);
  if (!live.length) return '';
  const names = live.map(r => `${r.prNo} (${r.status})`).join(', ');
  return FLOW_PR_PER_PO === 'ever'
    ? `${poNo} already has a payment request — ${names}. One purchase order carries one payment request.`
    : `${poNo} already has a payment request in progress — ${names}. Finish ${live[0].prNo} `
      + `(approve and pay it, or reject it), Revise it, or delete it if it was raised by mistake.`;
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
  /* A211 — a secured READ changes nothing, so it must not wipe everyone else's cache. The Action
     Center fires three commission reads while a dozen other jobs are filling that cache; clearing it
     on each one made the page refetch itself. Writes still clear, as they always did. */
  if (!/^get/.test(action)) _flowCacheClear();
  return data;
}

/* A231 — THE READ-ONLY DOOR.
 *
 * Management was given the operational Process Flow pages (Expenses, Suppliers, Receiving, Invoices,
 * Shipments, Collections, Clients, Sales Orders) as a VIEWER. Hiding the buttons is not the control:
 * most of those writes — addExpense, updateExpense, saveSupplier, saveClient, the receiving and
 * shipment writes — are NOT in _SECURED, so the server takes the browser's word for the caller's role.
 * For those pages the page guard was the only thing standing between management and a write, and a
 * guard that admits you is no longer a guard. So the refusal lives here, at the one door all 28 of
 * those call sites go through, where a button somebody forgot to hide cannot get past it.
 *
 * WHY A PER-PAGE FLAG AND NOT `role === 'management'`: management writes through postFlow constantly
 * on the pages they already had — approveQuotation, approvePO, approvePaymentRequest, setMgmtPricing,
 * approveWeeklyItinerary. A blanket role check would refuse their actual job. Because no pre-existing
 * page sets this flag, every surface management had before is unchanged BY CONSTRUCTION rather than
 * by audit — the flag can only affect a page that opted in.
 *
 * Set through the function, not by assigning a bare name: if flow-api.js has not loaded, a call fails
 * loudly here instead of quietly creating a global that nothing reads. `var` (not `let`) so it is a
 * window property and stays inspectable from the console during verification.
 */
var _flowViewerOnly = false;
function flowSetViewerOnly(on) { _flowViewerOnly = !!on; }
function flowIsViewerOnly() { return _flowViewerOnly; }

async function postFlow(action, params = {}) {
  if (!_flowConfigured()) throw new Error('Flow backend not configured. Set FLOW_API_URL in js/flow-api.js.');
  /* Reads pass. A viewer page exists to SHOW the data, so refusing its reads would break the very
     thing the access was granted for — and a read changes nothing. Same `^get` test _postFlowSecured
     already uses at the cache-clear below, kept identical so the two cannot drift into disagreeing
     about what counts as a read. */
  if (_flowViewerOnly && !/^get/.test(action)) {
    throw new Error('Read-only view — your role (' + (_flowActorRole() || 'unknown') +
                    ') can view this page but not change it. Refused: ' + action + '.');
  }
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
  const sym = { PHP: '₱', USD: '$', EUR: '€', SGD: 'S$', AUD: 'A$', JPY: '¥', GBP: '£', AED: 'AED ' };
  return (sym[cur] || (cur ? cur + ' ' : '')) + flowNum(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** True when the DEPLOYED FlowAPI is at least version n. The Apps Script backend is redeployed by
 *  hand, so a feature can be live in the front-end before its actions exist — an unknown action
 *  answers HTTP 200 with {success:false}, never a throw. Memoized; false on any error. */
/* ── A209/A211: WHO is the commission feature open to yet? ──────────────────
   NOT a version gate, deliberately. The commission pages gate on flowVersionAtLeast(112) and the
   email tracker needs 113 — the same paste — so deploying the tracker would have switched
   commissions on with it, and every "not switched on yet" message in those files would have become
   unreachable at exactly the moment it was needed. "Is this feature finished" and "which backend is
   deployed" stopped being the same question, so they get different mechanisms.

   A211 turns A209's boolean into a ROLE LIST. Launching a feature that decides what people are paid
   should not be all-or-nothing: the two people validating it use it for real while sales keep the
   coming-soon panel. An EMPTY array is A209's full hold, one edit away; adding 'sales' is the launch.

   Synchronous and local on purpose: no fetch, no promise, no window where half the page has decided
   one way and half the other.

   A212 — back to EMPTY. Director and management walked the whole chain on demo data and the feature
   is fine; it goes back behind the hold until launch, because a half-open feature that decides pay
   is worse than a closed one. Nothing else from A211 was rolled back — every access-control fix
   stays, and re-opening is one word in this array plus one in _COMM_ROLES.

   A233 — LAUNCHED. All three roles, on the director's instruction. Sales reps can now file
   commission requests that decide what they are paid.

   THIS HALF DOES NOTHING ON ITS OWN. _COMM_ROLES in apps-script/FlowAPI.gs is the half that lets an
   action through, and it only takes effect once FlowAPI.gs is pasted AND redeployed as a new version.
   Until that happens the pages open and every commission action is refused server-side — the same
   safe failure direction the hold always had, but a broken-looking one, so the paste is not optional.

   TO CLOSE AGAIN: empty this array and _COMM_ROLES. Note that closing after launch is NOT free the
   way it was before — reps will have in-flight requests, and a closed feature strands them where
   they stand rather than losing them. */
const FLOW_COMMISSIONS_ROLES = ['director', 'management', 'sales'];

/** Is the commission feature open to this role? Mirrors _COMM_ROLES in FlowAPI.gs. */
function flowCommissionsLiveFor(role) {
  return FLOW_COMMISSIONS_ROLES.indexOf(String(role || '').trim().toLowerCase()) !== -1;
}

/** The same question where no session object is to hand — renderFlowNav is injected on 20 pages and
 *  knows nothing about who is looking at it. Reads the stored session directly. */
function flowCommissionsLive() {
  try { return flowCommissionsLiveFor(JSON.parse(localStorage.getItem('session') || '{}').role); }
  catch (e) { return false; }
}

/* A210 — the commission ladder, in the Statement of Account's own order and wording.
   Printed identically on the rep's claim, both approval panels and the payout report, so the screen
   and a printed SOA can be read side by side without translating between them. Plain text, because
   three of the four callers are alert() panels. */
function flowCommissionLadder(x, indent) {
  const p = (v) => flowMoney(v, 'PHP');
  const i = indent || '';
  const L = [];
  L.push(i + 'Collected Amount        ' + p(x.base));
  if (flowNum(x.poAmount)) {
    L.push(i + 'Less 12% VAT            −' + p(x.vatDeduction));
    L.push(i + 'Less local tax 3%       −' + p(x.localTax));
  }
  L.push(i + 'Net of Taxes            ' + p(x.netOfTaxes));
  L.push(i + 'Commission @ ' + flowNum(x.rate) + '%'.padEnd(4) + '     ' + p(x.amount));
  if (flowNum(x.commissionEwt)) L.push(i + 'Less 1% withholding     −' + p(x.commissionEwt));
  if (flowNum(x.adjustment)) {
    const a = flowNum(x.adjustment);
    L.push(i + 'Adjustment              ' + (a < 0 ? '\u2212' + p(-a) : p(a)));
  }
  L.push(i + 'NET PAYABLE             ' + p(x.netPayable));
  if (x.ladderEstimated) {
    L.push(i + '(the tax deductions were estimated — this sales order carries no value)');
  }
  return L.join('\n');
}

/** The muted "Soon" tag on a menu entry for a feature that is visible but not open yet. */
function flowSoonTag() {
  return ' <span style="font-size:0.7em;font-weight:600;opacity:0.6;letter-spacing:0.03em;">SOON</span>';
}

/** One panel, used by all three commission screens, so the promise is worded once. */
function flowComingSoonHtml(title, body) {
  return `<div style="padding:1.6rem 1.4rem;border-radius:14px;background:#f8fafc;
      border:1px solid var(--border,#e2e8f0);text-align:center;">
      <div style="font:700 1rem/1.4 'Inter',system-ui,sans-serif;color:#1e293b;">${title} — coming soon</div>
      <p style="margin:0.55rem auto 0;max-width:46ch;font:400 0.86rem/1.65 'Inter',system-ui,sans-serif;color:#64748b;">${body}</p>
      <p style="margin:0.9rem 0 0;font:500 0.78rem 'Inter',system-ui,sans-serif;color:#94a3b8;">
        We are still building this. Nothing you do elsewhere is affected.</p>
    </div>`;
}

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
/* ── A207 salary cutoffs ────────────────────────────────────────────────────
   THE definition, hoisted here from director-home.js so there is one copy rather than two that can
   drift. _buildDateRange and _payslipPeriod there now derive from these.

     Cutoff A (1st) = 26th of the PREVIOUS month → 10th of the month
     Cutoff B (2nd) = 11th → 25th of the month

   Period keys are 'YYYY-MM-A' / 'YYYY-MM-B'. Note the authoritative bucket for a commission is
   stamped SERVER-side at approval (FlowAPI.gs _commPayoutPeriod) — these are for display and for
   the payroll grid, and the two must agree to the day. */
function flowCutoffKeyFor(d) {
  const ymd = flowDate(d || new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  let y = parseInt(ymd.slice(0, 4), 10), m = parseInt(ymd.slice(5, 7), 10);
  const day = parseInt(ymd.slice(8, 10), 10);
  if (day >= 26) { m += 1; if (m === 13) { m = 1; y += 1; } return flowCutoffKey(y, m, 'A'); }
  if (day <= 10) return flowCutoffKey(y, m, 'A');
  return flowCutoffKey(y, m, 'B');
}
function flowCutoffKey(year, month, half) {
  return year + '-' + String(month).padStart(2, '0') + '-' + half;
}
/** 'YYYY-MM-A|B' → {year, month, half, from, to, label}; nulls out on anything malformed. */
function flowCutoffRange(key) {
  const m = /^(\d{4})-(\d{2})-([AB])$/.exec(String(key || ''));
  if (!m) return { year: 0, month: 0, half: '', from: '', to: '', label: String(key || '') };
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), half = m[3];
  const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'][mo - 1];
  const pad = (n) => String(n).padStart(2, '0');
  if (half === 'B') {
    return { year: y, month: mo, half: half, from: y + '-' + pad(mo) + '-11', to: y + '-' + pad(mo) + '-25',
      label: '2nd Cutoff — ' + name + ' ' + y };
  }
  let py = y, pm = mo - 1;
  if (pm === 0) { pm = 12; py -= 1; }
  return { year: y, month: mo, half: half, from: py + '-' + pad(pm) + '-26', to: y + '-' + pad(mo) + '-10',
    label: '1st Cutoff — ' + name + ' ' + y };
}
/** The cutoff after this one. '2026-08-A' → '2026-08-B' → '2026-09-A'. */
function flowCutoffNext(key) {
  const r = flowCutoffRange(key);
  if (!r.half) return '';
  if (r.half === 'A') return flowCutoffKey(r.year, r.month, 'B');
  let y = r.year, m = r.month + 1;
  if (m === 13) { m = 1; y += 1; }
  return flowCutoffKey(y, m, 'A');
}

const FLOW_CURRENCIES = ['PHP', 'USD', 'EUR', 'SGD', 'AUD', 'JPY', 'GBP', 'AED'];

/* A224 — which of those a purchase order may use, given who the supplier is.
 *
 *     'intl'   →  the foreign currencies. PHP is not offered: an international purchase is stated in
 *                 the supplier's own currency, and the peso figure is an estimate until the bank acts.
 *     'local'  →  PHP only.
 *     ''       →  everything, because the order has no supplier type and guessing is worse than
 *                 offering the full list (13 live orders are unclassified — see _soSupplierKind).
 *
 * The mirror of _poCurrencyProblem in FlowAPI.gs. This one shapes the dropdown; that one decides
 * whether the save is accepted, and it is the one that matters. */
function flowCurrenciesFor(kind) {
  if (kind === 'local') return ['PHP'];
  if (kind === 'intl') return FLOW_CURRENCIES.filter(c => c !== 'PHP');
  return FLOW_CURRENCIES.slice();
}
/** 'International' | 'Local' | anything else → the 'intl' | 'local' | '' the rules speak in. */
function flowSupplierKind(supplierType) {
  const t = String(supplierType || '').trim().toLowerCase();
  return t === 'international' ? 'intl' : (t === 'local' ? 'local' : '');
}

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
    ['flow-commissions.html', 'Commissions'],
    ['flow-travel.html', 'Travel'],
    ['flow-ap-aging.html', 'AP Aging'],
    ['flow-payments.html', 'Payment Register'],   // A223
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
  /* A209 — this strip is ROLE-BLIND and injected on 20 other flow pages, so an unmarked Commissions
     pill here would look live to every role no matter what the role navbars say. Easiest leak to
     miss in the whole feature. */
  el.innerHTML = links.map(([href, label]) => {
    const soon = (href === 'flow-commissions.html' && !flowCommissionsLive()) ? flowSoonTag() : '';
    return `<a href="${href}" class="flow-tab${href === active ? ' active' : ''}">${label}${soon}</a>`;
  }).join('');
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

/* ════════════════════════════════════════════════════════════════════════════
   A183 — the pricing review shown to management before they approve a quotation.

   A quotation carries the customer-facing prices; the pricing request it was built from carries the
   cost/margin breakdown management set. This joins the two so an approver sees the breakdown again AND
   is told, loudly, when a line's quoted price no longer matches the price management priced it at —
   the exact situation that let PR-202607-210's re-price drift go unnoticed.
   ════════════════════════════════════════════════════════════════════════════ */

/* Normalised name for matching — upper, punctuation stripped, whitespace collapsed. */
function _flowNormItem(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
// Item numbers reps leave as a placeholder — never a reliable join key.
function _flowPlaceholderNo(s) {
  const v = String(s == null ? '' : s).trim().toLowerCase();
  return v === '' || v === 'n/a' || v === 'na' || v === '-' || v === '--';
}

/* Best-effort match of a quotation line back to its pricing line. The reliable keys are tried first
   (item identity, then a NON-placeholder item number); only then an exact normalised name against the
   PR's mapped OR original description. Claim-once via the `used` set, so two lines can't share a row.
   Returns the PR item or null. When a quotation has been rewritten by the rep (item numbers blanked to
   'N/A', descriptions replaced — the PR-202607-210 case) most lines correctly return null: the join is
   simply not recoverable, and the caller falls back to the total-level check. */
function _flowMatchPrItem(prItems, qi, used) {
  const id = String(qi.itemId == null ? '' : qi.itemId).trim();
  const no = String(qi.itemNo == null ? '' : qi.itemNo).trim().toLowerCase();
  const nm = _flowNormItem(qi.itemName);
  const free = (i) => !used.has(i);
  let idx = -1;
  if (id) idx = prItems.findIndex((p, i) => free(i) && String(p.itemId || '').trim() === id);
  if (idx < 0 && !_flowPlaceholderNo(no)) {
    idx = prItems.findIndex((p, i) => free(i) && !_flowPlaceholderNo(p.itemNo) &&
      String(p.itemNo).trim().toLowerCase() === no);
  }
  if (idx < 0 && nm) {
    idx = prItems.findIndex((p, i) => free(i) &&
      (_flowNormItem(p.itemName) === nm || _flowNormItem(p.origItemName) === nm));
  }
  if (idx < 0) return null;
  used.add(idx);
  return prItems[idx];
}

/* Given a quotation and the pricing-request record it came from, build the approval review.

   The load-bearing signal is the TOTAL, not the per-line join: reps routinely rewrite item numbers and
   descriptions (blanking the codes to 'N/A'), which destroys any reliable line-to-line link — and the
   server's own per-line gate collapses on exactly that data. So the auto-flag compares the PRICED total
   (Σ included finalPrice×qty) to the QUOTED gross (Σ quoted price×qty). That reliably answers "did the
   quotation's money move from what management priced" (the ₱14,290 of manual adds on PR-202607-210),
   whatever the reps did to the descriptions. A quotation-level discount is reported SEPARATELY — it is a
   legitimate deal decision (A158), not a pricing mismatch. Per-line diffs are shown only where a line
   confidently matches, with an honest "N of M matched" count. */
function flowQuotationPricingReview(quotation, prRecord) {
  quotation = quotation || {};
  const hasPr = !!(prRecord && Array.isArray(prRecord.items) && prRecord.items.length);
  if (!hasPr) {
    return { hasPr: false, breakdownHtml: '', incomplete: false, flagged: false,
             pricedTotal: 0, quotedGross: 0, totalDelta: 0, discountPct: 0,
             perLine: [], matched: 0, total: (quotation.items || []).length };
  }
  const rows = flowPricingRows(prRecord);
  const breakdownHtml = flowPricingBreakdownTable(rows);
  const incomplete = flowPricingRowsIncomplete(rows);

  const prItems = prRecord.items || [];
  const included = prItems.filter(p => p.included === undefined || p.included === true || String(p.included) === 'true');
  const quotedGross = flowQuotationGross(quotation);
  const discountPct = flowQuotationDiscountPct(quotation);

  /* A205 — with alternatives the quotation's value is base + ONE option, but the pricing request was
     sourced for every line including the options the client will not take. Comparing the two whole
     totals would flag a large deviation on every alternative-offers quotation and train approvers to
     ignore the warning, which is worse than not having it. So the comparison is restricted to the
     lines the quotation's total is actually built from, and each option is reported separately —
     each alternative is a different deal and deserves its own margin. */
  const optGroups = flowQuotationOptions(quotation);
  const qItems = optGroups.hasOptions
    ? (quotation.items || []).filter(it => {
        const k = flowQuotationOptionKey(it);
        return !k || k === optGroups.recommended;
      })
    : (quotation.items || []);

  const _pricedFor = (lines) => {
    const seen = new Set();
    let sum = 0;
    lines.forEach(qi => {
      const src = _flowMatchPrItem(prItems, qi, seen);
      if (src) sum += flowNum(src.finalPrice) * flowNum(src.qty);
    });
    return sum;
  };
  const pricedTotal = optGroups.hasOptions
    ? _pricedFor(qItems)
    : included.reduce((s, p) => s + flowNum(p.finalPrice) * flowNum(p.qty), 0);
  const totalDelta = quotedGross - pricedTotal;

  const optionReview = optGroups.order.map(k => {
    const lines = optGroups.base.concat(optGroups.options[k]);
    const quoted = lines.reduce((s, it) => s + flowNum(it.qty) * flowNum(it.price), 0);
    const priced = _pricedFor(lines);
    return { key: k, recommended: k === optGroups.recommended, quoted, priced, delta: quoted - priced };
  });

  const used = new Set();
  const perLine = [];
  qItems.forEach(qi => {
    const src = _flowMatchPrItem(prItems, qi, used);
    if (!src) return;
    const priced = flowNum(src.finalPrice), quoted = flowNum(qi.price);
    if (Math.abs(priced - quoted) > 0.005) {
      perLine.push({ item: String(qi.itemName || qi.itemNo || ''), priced, quoted, diff: quoted - priced });
    }
  });
  const matched = used.size;

  return {
    hasPr: true, breakdownHtml, incomplete,
    pricedTotal, quotedGross, totalDelta, discountPct,
    flagged: Math.abs(totalDelta) > 0.5,
    perLine, matched, total: qItems.length,
    hasOptions: optGroups.hasOptions, recommendedOption: optGroups.recommended,
    optionReview,                                    // A205: one entry per alternative
  };
}

/* A205 — the alternatives, each priced on its own. An approver looking at a blended margin across
   mutually exclusive offers is looking at a number that describes no deal that can actually happen,
   so each option gets its own quoted / priced / margin line and the recommended one is named. Shared
   by both approval surfaces so their wording cannot drift. */
function flowOptionReviewHtml(review) {
  review = review || {};
  if (!review.hasOptions || !(review.optionReview || []).length) return '';
  const money = v => flowMoney(v, 'PHP');
  const rows = review.optionReview.map(o => {
    const pct = o.quoted ? (o.delta / o.quoted) * 100 : 0;
    return `<tr>
        <td style="padding:.25rem .4rem;font-weight:700;">Option ${flowEsc(o.key)}${o.recommended ? ' <span style="font-weight:600;color:#b91c1c;">· recommended</span>' : ''}</td>
        <td style="padding:.25rem .4rem;text-align:right;font-variant-numeric:tabular-nums;">${money(o.quoted)}</td>
        <td style="padding:.25rem .4rem;text-align:right;font-variant-numeric:tabular-nums;">${money(o.priced)}</td>
        <td style="padding:.25rem .4rem;text-align:right;font-variant-numeric:tabular-nums;${o.delta < 0 ? 'color:#b91c1c;' : ''}">${money(o.delta)}${o.quoted ? ` (${pct.toFixed(1)}%)` : ''}</td>
      </tr>`;
  }).join('');
  return `<div style="margin:.5rem 0;padding:.5rem .6rem;border:1px solid #fca5a5;border-radius:10px;background:#fff7f7;">
      <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#b91c1c;margin-bottom:.3rem;">
        Alternative offers — priced separately</div>
      <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
        <thead><tr style="color:#64748b;font-size:.7rem;text-transform:uppercase;">
          <th style="text-align:left;padding:.2rem .4rem;">Option</th>
          <th style="text-align:right;padding:.2rem .4rem;">Quoted</th>
          <th style="text-align:right;padding:.2rem .4rem;">Sourced</th>
          <th style="text-align:right;padding:.2rem .4rem;">Margin</th>
        </tr></thead><tbody>${rows}</tbody></table>
      <div style="font-size:.72rem;color:#64748b;margin-top:.3rem;">
        The client picks one. The quotation total below is built from the recommended option.</div>
    </div>`;
}

/** The loud banner for a review, or '' when there is nothing to flag. Shared by both approval surfaces
 *  so their wording can't drift. Red when the money moved from what management priced; amber-only when
 *  the totals agree but the breakdown is incomplete. */
function flowDeviationBanner(review) {
  review = review || {};
  if (!review.hasPr) return '';
  const money = v => flowMoney(v, 'PHP');
  const flagged = review.flagged;
  if (!flagged && !review.incomplete) return '';

  const parts = [];
  if (flagged) {
    const up = review.totalDelta > 0;
    parts.push(`<div style="font-weight:700;margin-bottom:0.35rem;">⚠ The quoted total does not match what management priced</div>`);
    parts.push(`<div>Priced <strong>${money(review.pricedTotal)}</strong> → quoted <strong>${money(review.quotedGross)}</strong> ` +
      `<span style="color:${up ? '#dc2626' : '#b45309'};">(${up ? '+' : ''}${money(review.totalDelta)})</span>` +
      (review.discountPct ? ` before a ${review.discountPct}% discount` : '') + `</div>`);
    if (review.perLine.length) {
      parts.push(`<div style="margin-top:0.3rem;">` + review.perLine.map(d =>
        `${flowEsc(String(d.item).slice(0, 44))}: ${money(d.priced)} → ${money(d.quoted)} ` +
        `<span style="color:${d.diff < 0 ? '#b45309' : '#dc2626'};">(${d.diff < 0 ? '' : '+'}${money(d.diff)})</span>`
      ).join('<br>') + `</div>`);
    }
    if (review.matched < review.total) {
      parts.push(`<div style="margin-top:0.3rem;color:#b45309;">Only ${review.matched} of ${review.total} line(s) ` +
        `could be matched to the pricing (the rest were re-described on the quotation) — review the breakdown below.</div>`);
    }
  } else {
    parts.push(`<div style="font-weight:700;">⚠ Review the pricing before approving</div>`);
  }
  if (review.incomplete) {
    parts.push(`<div style="margin-top:0.3rem;color:#b45309;">Some lines have no saved cost breakdown.</div>`);
  }
  return `<div style="border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.6rem;font-size:0.78rem;color:#991b1b;">${parts.join('')}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════════
   A182 — what a quotation is actually worth.

   Quotations['Total'] stores the PRE-discount line sum. The quotations page has always applied the
   discount for display (qtnGross/qtnTotal), but those were private to that page — so four other
   screens read q.total raw and overstated every discounted quotation. The sales-order dropdown was
   one of them: 2026-393-KIM-THPAL-CEJN HOSES showed ₱370,982.88 for a quotation worth ₱352,433.74,
   which is why it could not be recognised there. Promoted here, where every page can reach it.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── A205: alternative offers ──
   A line with a blank optionNo is a BASE line and is always charged. Lines sharing a non-blank
   optionNo form one mutually exclusive group — the client picks a single option, so those lines are
   never summed together. Every money figure below therefore means "base + the recommended option",
   and a quotation with no tagged lines behaves exactly as it did before this existed.

   Mirrors _quotationTotal / _quotationRecommended in FlowAPI.gs. The two must agree: the server
   writes the stored Total, the client renders it, and a divergence would show one number in a list
   and a different one on the document the client is holding. */
function flowQuotationOptionKey(it) { return String((it && it.optionNo) || '').trim(); }

/** { base:[], options:{ '1':[…] }, order:['1','2'], recommended:'1', hasOptions:bool } */
function flowQuotationOptions(q) {
  q = q || {};
  const base = [], options = {}, order = [];
  (q.items || []).forEach(it => {
    const k = flowQuotationOptionKey(it);
    if (!k) { base.push(it); return; }
    if (!options[k]) { options[k] = []; order.push(k); }
    options[k].push(it);
  });
  order.sort((a, b) => (flowNum(a) - flowNum(b)) || a.localeCompare(b));
  const sum = k => options[k].reduce((s, it) => s + flowNum(it.qty) * flowNum(it.price), 0);
  let recommended = String(q.recommendedOption || '').trim();
  // Same fallback as the server: cheapest, never the sum. Under-promising is the safe failure.
  if (order.length && !options[recommended]) {
    recommended = order.slice().sort((a, b) => sum(a) - sum(b))[0];
  }
  if (!order.length) recommended = '';
  return { base, options, order, recommended, hasOptions: order.length > 0,
           optionGross: k => (options[k] ? sum(k) : 0) };
}

/** Gross ex-VAT subtotal, preferring the stored total but self-healing from the line items when it
 *  is 0/blank (legacy rows, or a create path that did not persist it). With alternative offers the
 *  self-heal counts base lines + the recommended option ONLY — summing every option would report a
 *  quotation offering either ₱7.2M or ₱5.1M as ₱12.3M in every list, in accounting and in approval. */
function flowQuotationGross(q) {
  q = q || {};
  const stored = flowNum(q.total);
  if (stored) return stored;
  const g = flowQuotationOptions(q);
  return g.base.concat(g.hasOptions ? g.options[g.recommended] : [])
          .reduce((s, it) => s + flowNum(it.qty) * flowNum(it.price), 0);
}

/** The discount percentage, clamped — a stored 120, -5 or 'abc' must never produce a negative
 *  or NaN amount on a money screen. */
function flowQuotationDiscountPct(q) {
  return Math.max(0, Math.min(100, flowNum((q || {}).discountPct) || 0));
}

/** Net after the discount, before VAT — what the client actually pays ex-VAT, and the figure the
 *  quotation PDF prints (pdf_generators/flow_quotation_pdf.py build_summary_table). */
/* A218 — WHOSE DEAL IS IT. `createdBy` is who TYPED the quotation; on the live book one person typed
   46 of 85 while owning 27, because creating quotations is her job. The server resolves the owner
   (SCHEMA 'Salesperson' → the initials in the number → the creator) and ships it as `salesperson`.
   Read it through here so a page never re-derives ownership from a number: the browser would be
   guessing where the sheet already knows, and the two would drift.

   Falls back to `createdBy` so a page still renders against a backend older than FLOW_VERSION 123 —
   the deploy trails this repo by design, and the fallback is exactly the old behaviour. */
function flowQuotationOwner(q) {
  const o = q || {};
  return String(o.salesperson || o.createdBy || '').trim();
}

function flowQuotationNet(q) {
  return flowQuotationGross(q) * (1 - flowQuotationDiscountPct(q) / 100);
}

/** " −5% disc" for a label, '' when there is no discount. */
function flowQuotationDiscountTag(q) {
  const d = flowQuotationDiscountPct(q);
  return d > 0 ? ` · −${d}% disc` : '';
}

/* ── A208 quotation buckets ─────────────────────────────────────────────────
   ONE definition of what a pile of quotations is worth, because there were three and they disagreed:
   the KPI tile said PHP 10.7M while the counter directly below it said PHP 18.4M for the same rep on
   the same screen. The tile summed every status except Sent and Rejected — including Not Pursued,
   Lost and Cancelled — under a subtitle reading "draft + in-approval", off the raw `total` column so
   it also lost the discount clamp and A205 option-awareness. Everything now comes from
   flowQuotationRollup, so the tile, the counter and the per-rep headers are three renderings of one
   number and cannot drift apart again.

   On the status vocabulary — 'Rejected' here does NOT mean the client said no. rejectQuotation
   (FlowAPI.gs) is only reachable from Pending Admin / Pending Management, the row becomes editable
   again, and the button says "Re-submit". It is internal rework, so it belongs with the other
   not-yet-with-the-client work, never in a "lost" figure. */
const FLOW_Q_CLOSED_STATUSES = ['Not Pursued', 'Lost', 'Cancelled'];
const FLOW_Q_SENT_STATUSES = ['Sent'];
const FLOW_Q_APPROVED_STATUSES = ['Approved'];

/** q -> 'won' | 'closed' | 'sent' | 'approved' | 'internal'.
 *  `hasSO` is a { quotationNo: true } map built from getSalesOrders — "won" is not a status and
 *  never has been; it is only knowable from the sales orders. Precedence matters: an order beats
 *  whatever the quotation's own status still says.
 *  An UNRECOGNISED or blank status falls through to 'internal' on purpose — a status this code has
 *  never seen must never be counted as live pipeline. */
function flowQuotationBucket(q, hasSO) {
  const no = String((q || {}).quotationNo || '');
  if (hasSO && hasSO[no]) return 'won';
  const st = String((q || {}).status || '');
  if (FLOW_Q_CLOSED_STATUSES.indexOf(st) !== -1) return 'closed';
  if (FLOW_Q_SENT_STATUSES.indexOf(st) !== -1) return 'sent';
  if (FLOW_Q_APPROVED_STATUSES.indexOf(st) !== -1) return 'approved';
  return 'internal';
}

const FLOW_Q_BUCKETS = ['internal', 'approved', 'sent', 'won', 'closed'];

/** The single source for every quotation money figure on screen.
 *  Returns { internal, approved, sent, won, closed, all } as { n, value }, plus `top` — the largest
 *  single quotation in the `sent` bucket and its share of it, because one deal is currently 62% of
 *  the company total and a headline that hides that invites a wrong conclusion. */
function flowQuotationRollup(list, hasSO) {
  const out = { all: { n: 0, value: 0 }, top: null };
  FLOW_Q_BUCKETS.forEach(b => { out[b] = { n: 0, value: 0 }; });
  let biggest = null;
  (list || []).forEach(q => {
    const v = flowQuotationNet(q);
    const b = flowQuotationBucket(q, hasSO);
    out[b].n++; out[b].value += v;
    out.all.n++; out.all.value += v;
    if (b === 'sent' && (!biggest || v > biggest.value)) {
      biggest = { quotationNo: String(q.quotationNo || ''), customer: String(q.customer || ''), value: v };
    }
  });
  if (biggest && out.sent.value > 0) {
    biggest.share = biggest.value / out.sent.value;
    out.top = biggest;
  }
  return out;
}

/* ── A208 follow-up ─────────────────────────────────────────────────────────
   How long a quotation has been sitting with a client, and whether that is a problem yet.

   THE CLOCK RUNS ON LAST CONTACT, NOT ON FIRST SEND. A rep who sent a chase this morning must not
   still be told the quotation is nine days overdue — a tracker that nags about work you have just
   done is one people stop reading within a week.

   Three of the four things this drives need no mailbox at all: "approved but never sent",
   "sent with no sales order", and "days since sent" all come from Quotations['Sent At'], which
   sendQuotation stamps. Only reply detection needs IMAP, and when that is unavailable the state
   degrades to 'unknown' — which SUPPRESSES the nudge rather than asserting "no reply". */
const FLOW_FOLLOWUP_DEFAULTS = {
  quotationFollowUpDays: 7,
  quotationNoSODays: 14,
  approvedNotSentDays: 2
};

/** Whole days between two 'yyyy-MM-dd' dates, Manila. Negative when `from` is in the future. */
function flowDaysBetween(from, to) {
  const a = flowDate(from), b = flowDate(to || flowToday());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/** q + its email links -> { state, days, sentAt, lastContactAt, threshold, label, reason }
 *
 *  state:  'not-applicable' — draft/in-approval/closed/won: nothing to chase
 *          'not-sent'       — approved and sitting unsent
 *          'ok'             — sent recently enough
 *          'due'            — past the threshold
 *          'overdue'        — well past it
 *          'replied'        — the client came back; it is the rep's move, not a chase
 *          'unknown'        — we cannot see the mailbox, so we will not claim there was no reply
 */
function flowFollowUp(q, links, cfg, hasSO) {
  const c = Object.assign({}, FLOW_FOLLOWUP_DEFAULTS, cfg || {});
  const bucket = flowQuotationBucket(q, hasSO);
  const out = { state: 'not-applicable', days: null, sentAt: '', lastContactAt: '',
                threshold: flowNum((q || {}).followUpDays) || c.quotationFollowUpDays,
                label: '', reason: '' };

  if (bucket === 'closed' || bucket === 'won') return out;

  if (bucket === 'approved') {
    const age = flowDaysBetween(q.approvedAt || q.date, flowToday());
    if (age !== null && age >= c.approvedNotSentDays) {
      out.state = 'not-sent'; out.days = age;
      out.label = `approved ${age}d ago, not sent`;
      out.reason = 'Approved and ready, but it has not gone to the client yet.';
    }
    return out;
  }
  if (bucket !== 'sent') return out;                      // internal work is not chased

  const live = (links || []).filter(l => String(l.status || 'Active') === 'Active');
  out.sentAt = flowDate(q.sentAt) || (live.length ? flowDate(live[0].sentAt) : '');

  /* Last contact = the most recent thing that happened either way. A chase we sent counts, and so
     does a reply they sent — both mean the relationship is not stale right now. */
  let last = out.sentAt, replied = null;
  live.forEach(l => {
    const s = flowDate(l.sentAt);
    if (s && (!last || s > last)) last = s;
    const r = flowDate(l.replyAt);
    if (r && (!replied || r > replied)) replied = r;
    if (r && (!last || r > last)) last = r;
  });
  out.lastContactAt = last || '';

  if (!out.sentAt) {
    // Marked Sent but with no date — an older record from before the stamp existed.
    out.state = 'unknown';
    out.label = 'sent date unknown';
    out.reason = 'This was marked sent before the system recorded when — link its email to fix that.';
    return out;
  }

  if (replied) {
    out.state = 'replied';
    out.days = flowDaysBetween(replied, flowToday());
    out.label = `client replied ${out.days}d ago`;
    out.reason = 'The client has come back — this needs your answer, not a chase.';
    return out;
  }

  /* If the rep HAS linked an email but the reply check is stale — mailbox disconnected, password
     rotated, key changed — say so instead of asserting silence. Claiming "no reply" when we simply
     cannot see is how a tracker loses trust. */
  const checked = live.map(l => flowDate(l.replyCheckedAt)).filter(Boolean).sort();
  if (live.length && checked.length) {
    const since = flowDaysBetween(checked[checked.length - 1], flowToday());
    if (since !== null && since > 3) {
      out.state = 'unknown'; out.days = flowDaysBetween(out.lastContactAt, flowToday());
      out.label = 'reply state unknown';
      out.reason = 'We have not been able to read the mailbox recently, so we cannot tell whether the client replied.';
      return out;
    }
  }

  out.days = flowDaysBetween(out.lastContactAt, flowToday());
  if (out.days === null) { out.state = 'unknown'; return out; }
  if (out.days < out.threshold) {
    out.state = 'ok';
    out.label = `${out.days}d, no reply`;
  } else if (out.days < out.threshold * 2) {
    out.state = 'due';
    out.label = `${out.days}d, follow up`;
    out.reason = `No contact for ${out.days} days — due a follow-up.`;
  } else {
    out.state = 'overdue';
    out.label = `${out.days}d, no reply`;
    out.reason = `No contact for ${out.days} days — well past the ${out.threshold}-day mark.`;
  }
  return out;
}

/** Sent long enough ago with still no sales order — chase it or close it as lost. */
function flowNoOrderYet(q, cfg, hasSO) {
  const c = Object.assign({}, FLOW_FOLLOWUP_DEFAULTS, cfg || {});
  if (flowQuotationBucket(q, hasSO) !== 'sent') return null;
  const days = flowDaysBetween(q.sentAt, flowToday());
  if (days === null || days < c.quotationNoSODays) return null;
  return { days: days, threshold: c.quotationNoSODays };
}

/* Two rows that look like the same deal recorded twice. The house numbering is
   YYYY-NNN-<initials>-<client>-<subject>, so the deal is the YYYY-NNN prefix — but two reps do
   sometimes take the same sequence number for genuinely different clients (six such pairs live
   today), so the customer must match as well. On live data this returns exactly one pair:
   2026-273 Aboitiz hydraulic pump, once under -ADM- and once under -GL-.
   Reported only, never merged and never removed from a total — the two rows differ in amount and
   status and may be a legitimate re-quote. A person decides. */
function flowQuotationDupPairs(list) {
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[.,\-]/g, ' ')
    .replace(/\b(inc|corp|corporation|co|ltd|company|philippines|phils?)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  const groups = {};
  (list || []).forEach(q => {
    const m = /^(\d{4})-(\d{1,4})\b/.exec(String(q.quotationNo || '').trim());
    if (!m) return;
    const key = m[1] + '-' + m[2];
    (groups[key] = groups[key] || []).push(q);
  });
  const pairs = [];
  Object.keys(groups).forEach(key => {
    const byCustomer = {};
    groups[key].forEach(q => {
      const c = norm(q.customer);
      if (!c) return;
      (byCustomer[c] = byCustomer[c] || []).push(q);
    });
    Object.keys(byCustomer).forEach(c => {
      if (byCustomer[c].length > 1) pairs.push({ prefix: key, customer: byCustomer[c][0].customer, rows: byCustomer[c] });
    });
  });
  return pairs;
}

/* Unit prices with the quotation's discount folded in, for handing to a sales order.
   A182: the sales order carries no discount field — by decision, since a percentage stored alongside
   already-discounted prices invites double-application — so the prices themselves must be net.

   The net prices are deliberately NOT rounded to 2 decimals. Rounding each one breaks the total: on
   2026-393, 47768.54×0.95=45380.11 and 75892.42×0.95=72097.80 sum to 352,433.73 — a centavo under the
   352,433.74 the client was quoted — and the shortfall cannot be repaired by nudging a unit price,
   because with qty 3 a one-centavo line adjustment needs 0.0033 per unit, which rounding erases again.
   Left unrounded the identity (Σ qty·price)·(1−d) === Σ qty·(price·(1−d)) holds exactly, so the sales
   order total always equals the quotation to the centavo. A sales order that agrees with the document
   the client holds matters more than a tidy-looking unit price. */
/* A205 — `optionNo` selects which alternative the client accepted. Omit it and the recommended one
   is used, so every existing caller keeps working unchanged. Losing options are dropped here rather
   than filtered by the caller: a sales order must never carry a line the client did not buy. */
function flowQuotationNetItems(q, optionNo) {
  q = q || {};
  const pct = flowQuotationDiscountPct(q);
  const factor = 1 - pct / 100;
  const g = flowQuotationOptions(q);
  const want = g.hasOptions
    ? (g.options[String(optionNo || '').trim()] ? String(optionNo).trim() : g.recommended)
    : '';
  const chosen = (q.items || []).filter(it => {
    const k = flowQuotationOptionKey(it);
    return !k || k === want;
  });
  return chosen.map(it => ({
    itemNo: it.itemNo, itemName: it.itemName, itemId: it.itemId,
    qty: flowNum(it.qty),
    price: pct ? flowNum(it.price) * factor : flowNum(it.price),
  }));
}

/** Net ex-VAT for one specific option (base + that option), for the SO picker and the approval
 *  view, where each alternative has to be priced on its own rather than blended. */
function flowQuotationNetForOption(q, optionNo) {
  return flowQuotationNetItems(q, optionNo)
    .reduce((s, it) => s + flowNum(it.qty) * flowNum(it.price), 0);
}


/** Upload ceiling for anything filed through addDocument. Lives here rather than in flow-docs.js
 *  so pages that upload without the docs modal (the client-visit photo) can honour the same limit. */
const FLOW_DOC_MAX_MB = 10;

/* ── A190: shared week + image helpers ────────────────────────────────────────────────────────
   Both were about to be written a third time — once for the Weekly Itinerary's week navigation and
   once for the client-visit photo. The Mon–Sun helper already existed twice (report-week.js and
   team-performance.js) with byte-identical logic, which is exactly the drift team-performance.js's
   own header warns about. One definition, several callers. */

/** The Mon→Sun dates of the week containing `baseDate`, shifted by `offset` weeks.
 *  Returns [] for an unparseable date rather than today's week — a silent fallback to "this week"
 *  would quietly show the wrong seven days. */
function flowWeekDates(baseDate, offset) {
  const d = new Date(String(baseDate || '') + 'T00:00:00');
  if (isNaN(d)) return [];
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (offset || 0) * 7);   // Mon=0 … Sun=6
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon);
    x.setDate(mon.getDate() + i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/** A picked image file → a downscaled JPEG data URL. Longest edge capped at `maxPx`; never upscales.
 *  Always re-encodes to JPEG regardless of the input type, which is what keeps a 6 MB phone PNG from
 *  becoming a 6 MB base64 payload on every read-back. */
function flowDownscaleImage(file, maxPx, quality) {
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
