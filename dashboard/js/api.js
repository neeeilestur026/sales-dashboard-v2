/* ═══════════════════════════════════════════════
   api.js — All fetch calls to Apps Script
   ═══════════════════════════════════════════════ */

// ─── Configuration ───────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxWd3bhOWhMx0jc5CiaFKxaKDKpkQQgq-w7th4OSrB-QXpNl29L4BArzA-m8efKDDgvQA/exec';

// ─── API Cache (sessionStorage, 5-min TTL) ────────
const API_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _inflight = {}; // de-duplicate concurrent identical requests

function _cacheKey(params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return 'api_' + sorted;
}

function _cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > API_CACHE_TTL) {
      sessionStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch { return null; }
}

function _cacheSet(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* storage full — ignore */ }
}

function clearApiCache() {
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith('api_')) keys.push(k);
  }
  keys.forEach(k => sessionStorage.removeItem(k));
}

// Actions that should never be cached (mutations)
const NO_CACHE_ACTIONS = ['login', 'logout', 'submitDailyReport', 'submitAdminDailyReport', 'updateTrackerRow', 'changePassword', 'setTargets', 'addOrder', 'updateOrder', 'deleteOrder', 'addExpense', 'updateExpense', 'deleteExpense', 'addSupplierQuotation', 'updateSupplierQuotation', 'deleteSupplierQuotation', 'uploadSQDocuments', 'updateSQDriveLink', 'addClient', 'updateClient', 'deleteClient', 'addUser', 'updateUser', 'deleteUser', 'resetUserPassword', 'updatePaymentRequestStatus', 'markBillPaid', 'saveCashVoucher', 'addInventoryItem', 'updateInventoryItem', 'deleteInventoryItem', 'approveQuotation', 'updateQuotationDriveLink', 'reviseQuotation', 'updatePRPricing', 'finalizeQuotation', 'getQuotationApprovalStatus', 'createSalesOrder', 'updateSOStatus', 'deleteSalesOrder', 'uploadSODocument', 'savePORecord', 'approvePO', 'sendPOEmail', 'sendAdminEmail', 'sendAcctEmail', 'savePOPDF', 'savePRPDF', 'savePricingSubmission', 'forwardPRToPricing', 'applyPricingToPR', 'submitHRDailyReport', 'addCandidate', 'updateCandidate', 'deleteCandidate', 'addHRTask', 'updateHRTask', 'deleteHRTask', 'addEmployee', 'updateEmployee', 'deleteEmployee', 'addLeaveRequest', 'updateLeaveRequest', 'deleteLeaveRequest', 'addPerformanceReview', 'updatePerformanceReview', 'deletePerformanceReview', 'addTrainingProgram', 'updateTrainingProgram', 'deleteTrainingProgram', 'addMemo', 'updateMemo', 'deleteMemo', 'addGrievance', 'updateGrievance', 'deleteGrievance', 'addCampaign', 'updateCampaign', 'deleteCampaign', 'addContentItem', 'updateContentItem', 'deleteContentItem', 'addAccreditation', 'updateAccreditation', 'deleteAccreditation', 'submitAccountingDailyReport', 'addCollection', 'deleteCollection', 'updateCollection', 'saveProfitReport', 'updateProfitReportEntry', 'saveShipment', 'uploadShipmentDoc', 'deleteShipmentDoc', 'advanceShipmentStage', 'restoreShipmentDoc', 'migrateShipmentDocs', 'exportAuditLogCsv', 'archiveHistoryNow', 'backfillHistory', 'savePayrollEmployee', 'deletePayrollEmployee', 'savePayrollHours', 'savePayrollRegister', 'submitPayrollForApproval', 'decidePayrollApproval', 'saveBankAccount', 'addBankTransaction', 'deleteBankTransaction', 'saveDirectorPayable', 'markDirectorPayablePaid', 'unmarkDirectorPayablePaid', 'deleteDirectorPayable',
];

// Read-only actions that must always fetch fresh data (use GET, skip cache).
// Stale cache caused approved quotations to revert to "Pending" on refresh.
const NO_CACHE_READS = ['getPendingQuotations', 'getAllPRs', 'getPaymentRequests', 'getBillingRecords', 'getBillingDetail', 'getPendingPOs', 'getShipmentTimeline', 'getShipmentHistory', 'getGlobalAuditLog', 'getAuditLogFilterValues', 'getProfitReports'];

/**
 * General-purpose fetch wrapper with caching.
 * Mutations (NO_CACHE_ACTIONS) are automatically routed through POST.
 * Read-only actions use GET.
 */
async function fetchFromAPI(params, options = {}) {
  const action = params.action || '';
  const isMutation = NO_CACHE_ACTIONS.includes(action);
  const cacheable = !options.noCache && !isMutation && !NO_CACHE_READS.includes(action);
  const key = _cacheKey(params);

  // Return cached if available
  if (cacheable) {
    const cached = _cacheGet(key);
    if (cached) return cached;
    if (_inflight[key]) return _inflight[key];
  }

  // Attach session token + actor name (for per-user activity logging)
  const session = _getSessionForToken();
  if (session && session.token) {
    params.token = session.token;
  }
  if (session && session.name && !params.actorName) {
    params.actorName = session.name;
  }

  // Route mutations through POST
  if (isMutation) {
    return _postMutation(params);
  }

  // GET for read-only actions
  const query = new URLSearchParams(params).toString();
  const url = `${APPS_SCRIPT_URL}?${query}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const data = await response.json();
      if (data.authError) { _handleAuthError(); throw new Error(data.message || 'Session expired.'); }
      if (cacheable) _cacheSet(key, data);
      return data;
    } catch (error) {
      clearTimeout(timer);
      console.error('API Error:', error);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out. The server took too long to respond.');
      }
      throw new Error(error.message || 'Unable to connect to the server.');
    } finally {
      delete _inflight[key];
    }
  })();

  if (cacheable) _inflight[key] = promise;
  return promise;
}

/**
 * Internal: POST mutations to Apps Script doPost
 */
async function _postMutation(params) {
  // ── TRAINING MODE INTERCEPT ──
  // When the logged-in user has trainingMode=true, swallow mutations and
  // return a fake success so generators/UI keep working but nothing is
  // written to backend records. Exceptions stay live (login/logout,
  // daily-report submissions so management still sees trainee activity).
  try {
    const sess = _getSessionForToken();
    if (sess && sess.trainingMode === true) {
      const action = params && params.action || '';
      const ALLOW_THROUGH = ['login', 'logout', 'submitDailyReport', 'changePassword'];
      if (!ALLOW_THROUGH.includes(action)) {
        try {
          window.dispatchEvent(new CustomEvent('trainingmode:intercepted', { detail: { action } }));
        } catch (e) {}
        return {
          success: true,
          training: true,
          message: 'Training mode — this action was not saved.',
          data: []
        };
      }
    }
  } catch (e) {}

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(params)
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Server responded with status ${response.status}`);
    const data = await response.json();
    if (data.authError) { _handleAuthError(); throw new Error(data.message || 'Session expired.'); }
    return data;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') throw new Error('Request timed out. The server took too long to respond.');
    throw new Error(error.message || 'Unable to connect to the server.');
  }
}

/**
 * Handle auth errors — clear session, redirect to login
 */
function _handleAuthError() {
  localStorage.removeItem('session');
  setTimeout(() => {
    alert('Your session has expired. Please log in again.');
    window.location.href = 'index.html';
  }, 100);
}

/**
 * Read session from localStorage (lightweight — avoids circular dep with auth.js)
 */
function _getSessionForToken() {
  try {
    const raw = localStorage.getItem('session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Logout API call (fire-and-forget)
 */
async function apiLogout(token) {
  try { return await _postMutation({ action: 'logout', token }); }
  catch { return { success: false }; }
}

/**
 * POST wrapper for Apps Script doPost (PDF uploads, etc.)
 */
async function postToAPI(body) {
  // Attach session token
  const session = _getSessionForToken();
  if (session && session.token) {
    body.token = session.token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Server responded with status ${response.status}`);
    return await response.json();
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') throw new Error('Upload timed out. The file may be too large.');
    throw new Error(error.message || 'Unable to connect to the server.');
  }
}

// ─── Lazy Library Loader ─────────────────────────
const _loadedLibs = {};
function loadLib(url) {
  if (_loadedLibs[url]) return _loadedLibs[url];
  _loadedLibs[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
  return _loadedLibs[url];
}

async function loadXLSX() {
  await loadLib('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
}

async function loadJsPDF() {
  await loadLib('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await loadLib('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
}

/**
 * Login with username and password
 * @param {string} user - Username
 * @param {string} pass - Password
 * @returns {Promise<Object>} Login response
 */
async function apiLogin(user, pass) {
  return fetchFromAPI({ action: 'login', user, pass });
}

/**
 * Get document stats for an agent
 * @param {string} agentName
 * @param {Object} sheetIds - { quotationSheetId, prSheetId, poSheetId }
 * @param {string} range - 'today' | 'week' | 'month'
 * @returns {Promise<Object>} { quotations, prs, pos }
 */
async function apiGetStats(agentName, sheetIds, range) {
  return fetchFromAPI({
    action: 'getStats',
    agentName,
    quotationSheetId: sheetIds.quotationSheetId,
    prSheetId: sheetIds.prSheetId,
    poSheetId: sheetIds.poSheetId,
    range
  });
}

/**
 * Get daily trend data for charts
 * @param {string} agentName
 * @param {Object} sheetIds
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} { data: [ { date, quotations, prs, pos } ] }
 */
async function apiGetDailyTrend(agentName, sheetIds, days = 30) {
  return fetchFromAPI({
    action: 'getDailyTrend',
    agentName,
    quotationSheetId: sheetIds.quotationSheetId,
    prSheetId: sheetIds.prSheetId,
    poSheetId: sheetIds.poSheetId,
    days
  });
}

/**
 * Get client ranking by quotation count
 * @param {string} agentName
 * @param {string} quotationSheetId
 * @param {string} range - 'week' | 'month' | 'all'
 * @returns {Promise<Object>} { data: [ { client, count } ] }
 */
async function apiGetClientRanking(agentName, quotationSheetId, range = 'month') {
  return fetchFromAPI({
    action: 'getClientRanking',
    agentName,
    quotationSheetId,
    range
  });
}

/**
 * Get client tracker data (PRs + Quotations sent by agent)
 * @param {string} agentName
 * @param {Object} sheetIds - { quotationSheetId, prSheetId }
 * @returns {Promise<Object>} { data: [ { type, clientName, documentNumber, dateSent, daysSinceSent, status, amount, rfqSource } ] }
 */
async function apiGetClientTracker(agentName, sheetIds) {
  return fetchFromAPI({
    action: 'getClientTracker',
    agentName,
    quotationSheetId: sheetIds.quotationSheetId
  });
}

/**
 * Update a client tracker row (status or follow-up date)
 * @param {Object} params - { sheetId, rowIndex, status, followUpDate }
 */
async function apiUpdateTrackerRow(params) {
  return fetchFromAPI({
    action: 'updateTrackerRow',
    ...params
  });
}

/** Get today's quotation/PR counts + submission status for an agent */
async function apiGetTodayCounts(agentName, quotationSheetId, prSheetId) {
  return fetchFromAPI({ action: 'getTodayCounts', agentName, quotationSheetId, prSheetId });
}

/** Submit a daily sales report */
async function apiSubmitDailyReport(params) {
  return fetchFromAPI({ action: 'submitDailyReport', ...params });
}

/** Submit detailed (8-section) daily report. Tries new backend action first;
 *  falls back to legacy submitDailyReport on unknown-action errors or thrown
 *  network errors so the form keeps working until Apps Script is updated. */
async function apiSubmitDetailedDailyReport(params) {
  try {
    const result = await fetchFromAPI({ action: 'submitDetailedDailyReport', ...params });
    if (result && result.success) return result;
    if (result && result.message && /unknown action|not.*found|invalid action/i.test(result.message)) {
      return apiSubmitDailyReport(params);
    }
    return result;
  } catch (err) {
    return apiSubmitDailyReport(params);
  }
}

/** Get daily reports for a given date (admin) */
async function apiGetDailyReports(date) {
  return fetchFromAPI({ action: 'getDailyReports', date });
}

/** Get an agent's quotations and PRs for a specific date (admin/management drill-in) */
async function apiGetAgentDayActivity(agentName, date) {
  return fetchFromAPI({ action: 'getAgentDayActivity', agentName, date });
}

// ─── Email Log (GoDaddy IMAP via Flask) ─────────────
// These hit the Flask backend, NOT Apps Script. Flask validates the session
// against Apps Script and decrypts stored credentials server-side.

async function _flaskFetch(path, body) {
  const session = _getSessionForToken();
  const token = (session && session.token) || '';
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Session-Token': token },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify({ sessionToken: token, ...body });
  }
  const resp = await fetch(path, opts);
  return resp.json();
}

/** Save GoDaddy email + password (server tests login + encrypts before storage). */
async function apiSetupEmailCredentials(godaddyEmail, godaddyPassword) {
  return _flaskFetch('/api/email/setup', { godaddyEmail, godaddyPassword });
}

/** Test GoDaddy IMAP credentials without storing them. */
async function apiTestEmailConnection(godaddyEmail, godaddyPassword) {
  return _flaskFetch('/api/email/test', { godaddyEmail, godaddyPassword });
}

/** Fetch today's sent emails from the agent's GoDaddy mailbox. Oversight roles may pass a target
 *  `user` (activity-log name) to read that user's sent mail. */
async function apiFetchEmailLogToday(user) {
  return _flaskFetch('/api/email/today', user ? { user } : {});
}

/** Fetch a recent feed from a GoDaddy folder ('inbox' | 'sent' | 'spam'); inbox/spam classified. */
async function apiFetchEmailFeed(folder, days) {
  return _flaskFetch('/api/email/feed', { folder, days: days || 14 });
}

/** Whether the agent already has GoDaddy credentials configured. */
async function apiGetEmailStatus() {
  return _flaskFetch('/api/email/status', {});
}

/** Disconnect (clear) the agent's stored GoDaddy credentials. */
async function apiDisconnectEmail() {
  return _flaskFetch('/api/email/disconnect', {});
}

/** Submit an admin daily report */
async function apiSubmitAdminDailyReport(params) {
  return fetchFromAPI({ action: 'submitAdminDailyReport', ...params });
}

/** Get admin daily reports (optionally filter by date and/or adminName) */
async function apiGetAdminDailyReports(params = {}) {
  return fetchFromAPI({ action: 'getAdminDailyReports', ...params });
}

/** Change user password */
async function apiChangePassword(username, currentPassword, newPassword) {
  return fetchFromAPI({ action: 'changePassword', username, currentPassword, newPassword });
}

/** Get sales targets (optionally filter by month and/or agentName) */
async function apiGetTargets(month, agentName) {
  const params = { action: 'getTargets' };
  if (month) params.month = month;
  if (agentName) params.agentName = agentName;
  return fetchFromAPI(params);
}

/** Set sales targets for an agent in a given month (admin) */
async function apiSetTargets(month, agentName, quotationTarget, prTarget, callTarget) {
  return fetchFromAPI({
    action: 'setTargets', month, agentName,
    quotationTarget: String(quotationTarget),
    prTarget: String(prTarget),
    callTarget: String(callTarget)
  });
}

/** Get aggregated report summary for week or month (admin) */
async function apiGetReportSummary(range) {
  return fetchFromAPI({ action: 'getReportSummary', range });
}

/**
 * Get team summary (manager only)
 * @returns {Promise<Object>} { data: [ { name, quotations, prs, pos, total } ] }
 */
async function apiGetTeamSummary() {
  return fetchFromAPI({ action: 'getTeamSummary' });
}

/**
 * Get hot leads (admin only)
 * @returns {Promise<Object>} { data: [ { client, rfqCount, agents } ] }
 */
async function apiGetHotLeads() {
  return fetchFromAPI({ action: 'getHotLeads' });
}

// ─── Accounting API ──────────────────────────────

async function apiGetAccountingDashboard(range) {
  return fetchFromAPI({ action: 'getAccountingDashboard', range: range || 'month' });
}

async function apiGetOrders(status, client) {
  var params = { action: 'getOrders' };
  if (status) params.status = status;
  if (client) params.client = client;
  return fetchFromAPI(params);
}

async function apiGetClientProfitReport(month) {
  var params = { action: 'getClientProfitReport' };
  if (month) params.month = month;
  return fetchFromAPI(params);
}

async function apiSaveProfitReport(reportId, reportDate, entries) {
  return postToAPI({
    action: 'saveProfitReport',
    reportId: reportId,
    reportDate: reportDate,
    entries: JSON.stringify(entries)
  });
}

async function apiUpdateProfitReportEntry(reportId, soNo, entry) {
  return fetchFromAPI({
    action: 'updateProfitReportEntry',
    reportId: reportId,
    soNo: soNo,
    entry: JSON.stringify(entry)
  });
}

async function apiGetProfitReports() {
  return fetchFromAPI({ action: 'getProfitReports' });
}

async function apiAddOrder(data) {
  return fetchFromAPI({ action: 'addOrder', ...data });
}

async function apiUpdateOrder(rowIndex, field, value) {
  return fetchFromAPI({ action: 'updateOrder', rowIndex: String(rowIndex), field, value: String(value) });
}

async function apiGetExpenses(category) {
  var params = { action: 'getExpenses' };
  if (category) params.category = category;
  return fetchFromAPI(params);
}

async function apiAddExpense(data) {
  return fetchFromAPI({ action: 'addExpense', ...data });
}

// ─── Supplier Quotation APIs ───────────────────────────────

async function apiGetSupplierQuotations(supplier) {
  return fetchFromAPI({ action: 'getSupplierQuotations', supplier: supplier || '' });
}

async function apiAddSupplierQuotation(data) {
  return fetchFromAPI({ action: 'addSupplierQuotation', ...data });
}

async function apiUploadSQDocuments(data) {
  return postToAPI({ action: 'uploadSQDocuments', ...data });
}

async function apiUpdateSQDriveLink(data) {
  return postToAPI({ action: 'updateSQDriveLink', ...data });
}

async function apiListSQFolderFiles(folderUrl) {
  return fetchFromAPI({ action: 'listSQFolderFiles', folderUrl });
}

// ─── Client List APIs ────────────────────────────

async function apiGetClients(agentName, search, clientType) {
  const params = { action: 'getClients' };
  if (agentName) params.agentName = agentName;
  if (search) params.search = search;
  if (clientType) params.clientType = clientType;
  return fetchFromAPI(params);
}

async function apiAddClient(data) {
  return fetchFromAPI({ action: 'addClient', ...data });
}

async function apiUpdateClient(data) {
  return fetchFromAPI({ action: 'updateClient', ...data });
}

async function apiDeleteClient(rowIndex) {
  return fetchFromAPI({ action: 'deleteClient', rowIndex: String(rowIndex) });
}

async function apiGetClientCount(agentName) {
  return fetchFromAPI({ action: 'getClientCount', agentName });
}

/**
 * Get login activity log (admin only)
 * @param {number} limit - Max number of entries to return
 * @returns {Promise<Object>} { data: [ { timestamp, username, fullName, role } ] }
 */
async function apiGetLoginLog(limit = 100) {
  return fetchFromAPI({ action: 'getLoginLog', limit });
}

// ─── Delete/Edit Order & Expense APIs ─────────────

async function apiDeleteOrder(rowIndex) {
  return fetchFromAPI({ action: 'deleteOrder', rowIndex: String(rowIndex) });
}

async function apiDeleteExpense(rowIndex) {
  return fetchFromAPI({ action: 'deleteExpense', rowIndex: String(rowIndex) });
}

async function apiUpdateExpense(data) {
  return fetchFromAPI({ action: 'updateExpense', ...data });
}

async function apiUpdateSupplierQuotation(data) {
  return fetchFromAPI({ action: 'updateSupplierQuotation', ...data });
}

async function apiDeleteSupplierQuotation(rowIndex) {
  return fetchFromAPI({ action: 'deleteSupplierQuotation', rowIndex: String(rowIndex) });
}

// ─── Payment Request APIs ─────────────────────────

async function apiGetPaymentRequests() {
  return fetchFromAPI({ action: 'getPaymentRequests' });
}

async function apiUpdatePaymentRequestStatus(rowIndex, status) {
  return fetchFromAPI({ action: 'updatePaymentRequestStatus', rowIndex: String(rowIndex), status });
}

// ─── User Management APIs ─────────────────────────

async function apiGetUsers() {
  return fetchFromAPI({ action: 'getUsers' });
}

async function apiAddUser(data) {
  return fetchFromAPI({ action: 'addUser', ...data });
}

async function apiUpdateUser(data) {
  return fetchFromAPI({ action: 'updateUser', ...data });
}

async function apiDeleteUser(rowIndex) {
  return fetchFromAPI({ action: 'deleteUser', rowIndex: String(rowIndex) });
}

// ─── Inventory API ────────────────────────────────

async function apiGetInventory() {
  return fetchFromAPI({ action: 'getInventory' });
}

// ─── Collections (AR) API ─────────────────────────

async function apiGetCollections() {
  return fetchFromAPI({ action: 'getCollections' }, { noCache: true });
}

async function apiAddCollection(data) {
  return fetchFromAPI({ action: 'addCollection', ...data });
}

async function apiUpdateCollection(data) {
  return fetchFromAPI({ action: 'updateCollection', ...data });
}

async function apiDeleteCollection(rowIndex) {
  return fetchFromAPI({ action: 'deleteCollection', rowIndex: String(rowIndex) });
}

async function apiAddInventoryItem(data) {
  return fetchFromAPI({ action: 'addInventoryItem', ...data });
}

async function apiUpdateInventoryItem(data) {
  return fetchFromAPI({ action: 'updateInventoryItem', ...data });
}

async function apiDeleteInventoryItem(rowIndex) {
  return fetchFromAPI({ action: 'deleteInventoryItem', rowIndex: String(rowIndex) });
}

// ─── PR Tracker & Quotation Approval APIs ────────

async function apiGetAllPRs() {
  return fetchFromAPI({ action: 'getAllPRs' });
}

async function apiGetPendingQuotations() {
  return fetchFromAPI({ action: 'getPendingQuotations' });
}

async function apiApproveQuotation(data) {
  return fetchFromAPI({ action: 'approveQuotation', ...data });
}

async function apiUpdateQuotationDriveLink(data) {
  return fetchFromAPI({ action: 'updateQuotationDriveLink', ...data });
}

async function apiUploadQuotationPDF(pdfBase64, fileName, agentName) {
  return postToAPI({ action: 'saveQuotationPDF', pdfBase64, fileName, agentName });
}

async function apiSaveDailyReportPDF(pdfBase64, fileName, agentName, reportDate) {
  return postToAPI({ action: 'saveDailyReportPDF', pdfBase64, fileName, agentName, reportDate });
}

async function apiReviseQuotation(data) {
  return fetchFromAPI({ action: 'reviseQuotation', ...data });
}

async function apiGetPendingItems(params) {
  return fetchFromAPI({ action: 'getPendingItems', ...params });
}

async function apiUpdatePRPricing(params) {
  return fetchFromAPI({ action: 'updatePRPricing', ...params });
}

async function apiGetQuotationSummary(agentName) {
  return fetchFromAPI({ action: 'getQuotationSummary', agentName: agentName || '' });
}

async function apiGetQuotationApprovalStatus(sheetId, rowIndex) {
  return fetchFromAPI({ action: 'getQuotationApprovalStatus', sheetId, rowIndex });
}

async function apiFinalizeQuotation(sheetId, rowIndex) {
  return fetchFromAPI({ action: 'finalizeQuotation', sheetId, rowIndex });
}

// ─── Sales Order APIs ─────────────────────────────

async function apiGetSalesOrders(status, search) {
  const params = { action: 'getSalesOrders' };
  if (status) params.status = status;
  if (search) params.search = search;
  return fetchFromAPI(params);
}

async function apiCreateSalesOrder(data) {
  return fetchFromAPI({ action: 'createSalesOrder', ...data });
}

async function apiUpdateSOStatus(soNo, status, invoiceNo, driveFolderLink) {
  return fetchFromAPI({ action: 'updateSOStatus', soNo, status, invoiceNo: invoiceNo || '', driveFolderLink: driveFolderLink || '' });
}

async function apiUpdateSalesOrder(data) {
  return fetchFromAPI({ action: 'updateSalesOrder', ...data });
}

async function apiDeleteSalesOrder(soNo) {
  return fetchFromAPI({ action: 'deleteSalesOrder', soNo });
}

async function apiGetSOStats() {
  return fetchFromAPI({ action: 'getSOStats' });
}

async function apiUploadSODocument(soNo, customerName, fileName, fileData, mimeType) {
  return fetchFromAPI({ action: 'uploadSODocument', soNo, customerName, fileName, fileData, mimeType });
}

async function apiGetSODocuments(soNo) {
  return fetchFromAPI({ action: 'getSODocuments', soNo }, { noCache: true });
}

// ─── PO Records (Admin POs awaiting management approval) ─────
async function apiSavePORecord(p) {
  return fetchFromAPI({ action: 'savePORecord', ...p }, { noCache: true });
}
async function apiGetPORecords(p = {}) {
  return fetchFromAPI({ action: 'getPORecords', ...p }, { noCache: true });
}
async function apiApprovePO(p) {
  return fetchFromAPI({ action: 'approvePO', ...p }, { noCache: true });
}
async function apiSendPOEmail(p) {
  return fetchFromAPI({ action: 'sendPOEmail', ...p }, { noCache: true });
}
async function apiSendAdminEmail(p) {
  return fetchFromAPI({ action: 'sendAdminEmail', ...p }, { noCache: true });
}
async function apiSendAcctEmail(p) {
  return fetchFromAPI({ action: 'sendAcctEmail', ...p }, { noCache: true });
}
async function apiGetPOStats() {
  return fetchFromAPI({ action: 'getPOStats' }, { noCache: true });
}

// ─── Pricing Submissions ────────────────────────
async function apiSavePricingSubmission(p) {
  return fetchFromAPI({ action: 'savePricingSubmission', ...p }, { noCache: true });
}
async function apiGetPricingSubmissions(status) {
  const params = { action: 'getPricingSubmissions' };
  if (status) params.status = status;
  return fetchFromAPI(params, { noCache: true });
}
async function apiGetPriceHistory(clientName) {
  return fetchFromAPI({ action: 'getPriceHistory', clientName: clientName || '' }, { noCache: true });
}

async function apiGetShipments(params) {
  return fetchFromAPI({ action: 'getShipments', ...(params || {}) }, { noCache: true });
}

async function apiSaveShipment(data) {
  return fetchFromAPI({ action: 'saveShipment', ...data }, { noCache: true });
}

async function apiUploadShipmentDoc(shipmentId, status, fileName, base64, mimeType) {
  return fetchFromAPI({ action: 'uploadShipmentDoc', shipmentId, status, fileName, base64, mimeType }, { noCache: true });
}

async function apiDeleteShipmentDoc(shipmentId, status, fileId, fileName) {
  return fetchFromAPI({ action: 'deleteShipmentDoc', shipmentId, status, fileId, fileName }, { noCache: true });
}

async function apiForwardPRToPricing(p) {
  return fetchFromAPI({ action: 'forwardPRToPricing', ...p }, { noCache: true });
}
async function apiApplyPricingToPR(submissionId) {
  return fetchFromAPI({ action: 'applyPricingToPR', submissionId }, { noCache: true });
}
async function apiMarkSentToSales(submissionId) {
  return fetchFromAPI({ action: 'markSentToSales', submissionId }, { noCache: true });
}

// ─── HR-Marketing APIs ──────────────────────────

async function apiSubmitHRDailyReport(params) {
  return fetchFromAPI({ action: 'submitHRDailyReport', ...params });
}

async function apiGetHRDailyReports(params = {}) {
  return fetchFromAPI({ action: 'getHRDailyReports', ...params });
}

async function apiGetRecruitmentPipeline() {
  return fetchFromAPI({ action: 'getRecruitmentPipeline' });
}

async function apiGetRecruitmentStats() {
  return fetchFromAPI({ action: 'getRecruitmentStats' });
}

async function apiAddCandidate(data) {
  return fetchFromAPI({ action: 'addCandidate', ...data });
}

async function apiUpdateCandidate(data) {
  return fetchFromAPI({ action: 'updateCandidate', ...data });
}

async function apiDeleteCandidate(rowIndex) {
  return fetchFromAPI({ action: 'deleteCandidate', rowIndex: String(rowIndex) });
}

async function apiGetHRTasks(params = {}) {
  return fetchFromAPI({ action: 'getHRTasks', ...params });
}

async function apiGetHRTaskStats() {
  return fetchFromAPI({ action: 'getHRTaskStats' });
}

async function apiAddHRTask(data) {
  return fetchFromAPI({ action: 'addHRTask', ...data });
}

async function apiUpdateHRTask(data) {
  return fetchFromAPI({ action: 'updateHRTask', ...data });
}

async function apiDeleteHRTask(rowIndex) {
  return fetchFromAPI({ action: 'deleteHRTask', rowIndex: String(rowIndex) });
}

async function apiGetEmployees() {
  return fetchFromAPI({ action: 'getEmployees' });
}

async function apiAddEmployee(data) {
  return fetchFromAPI({ action: 'addEmployee', ...data });
}

async function apiUpdateEmployee(data) {
  return fetchFromAPI({ action: 'updateEmployee', ...data });
}

async function apiDeleteEmployee(rowIndex) {
  return fetchFromAPI({ action: 'deleteEmployee', rowIndex: String(rowIndex) });
}

async function apiGetHRSummary() {
  return fetchFromAPI({ action: 'getHRSummary' });
}

// ─── Leave & Attendance APIs ────────────────────

async function apiGetLeaveRequests(params = {}) {
  return fetchFromAPI({ action: 'getLeaveRequests', ...params });
}
async function apiAddLeaveRequest(data) {
  return fetchFromAPI({ action: 'addLeaveRequest', ...data });
}
async function apiUpdateLeaveRequest(data) {
  return fetchFromAPI({ action: 'updateLeaveRequest', ...data });
}
async function apiDeleteLeaveRequest(rowIndex) {
  return fetchFromAPI({ action: 'deleteLeaveRequest', rowIndex: String(rowIndex) });
}
async function apiGetLeaveStats() {
  return fetchFromAPI({ action: 'getLeaveStats' });
}

// ─── Performance Review APIs ────────────────────

async function apiGetPerformanceReviews(params = {}) {
  return fetchFromAPI({ action: 'getPerformanceReviews', ...params });
}
async function apiAddPerformanceReview(data) {
  return fetchFromAPI({ action: 'addPerformanceReview', ...data });
}
async function apiUpdatePerformanceReview(data) {
  return fetchFromAPI({ action: 'updatePerformanceReview', ...data });
}
async function apiDeletePerformanceReview(rowIndex) {
  return fetchFromAPI({ action: 'deletePerformanceReview', rowIndex: String(rowIndex) });
}

// ─── Training & Development APIs ────────────────

async function apiGetTrainingPrograms(params = {}) {
  return fetchFromAPI({ action: 'getTrainingPrograms', ...params });
}
async function apiAddTrainingProgram(data) {
  return fetchFromAPI({ action: 'addTrainingProgram', ...data });
}
async function apiUpdateTrainingProgram(data) {
  return fetchFromAPI({ action: 'updateTrainingProgram', ...data });
}
async function apiDeleteTrainingProgram(rowIndex) {
  return fetchFromAPI({ action: 'deleteTrainingProgram', rowIndex: String(rowIndex) });
}

// ─── Memo & Announcement APIs ───────────────────

async function apiGetMemos(params = {}) {
  return fetchFromAPI({ action: 'getMemos', ...params });
}
async function apiAddMemo(data) {
  return fetchFromAPI({ action: 'addMemo', ...data });
}
async function apiUpdateMemo(data) {
  return fetchFromAPI({ action: 'updateMemo', ...data });
}
async function apiDeleteMemo(rowIndex) {
  return fetchFromAPI({ action: 'deleteMemo', rowIndex: String(rowIndex) });
}

// ─── Grievance & Complaint APIs ─────────────────

async function apiGetGrievances(params = {}) {
  return fetchFromAPI({ action: 'getGrievances', ...params });
}
async function apiAddGrievance(data) {
  return fetchFromAPI({ action: 'addGrievance', ...data });
}
async function apiUpdateGrievance(data) {
  return fetchFromAPI({ action: 'updateGrievance', ...data });
}
async function apiDeleteGrievance(rowIndex) {
  return fetchFromAPI({ action: 'deleteGrievance', rowIndex: String(rowIndex) });
}

// ─── Marketing Campaign APIs ────────────────────

async function apiGetCampaigns(params = {}) {
  return fetchFromAPI({ action: 'getCampaigns', ...params });
}
async function apiAddCampaign(data) {
  return fetchFromAPI({ action: 'addCampaign', ...data });
}
async function apiUpdateCampaign(data) {
  return fetchFromAPI({ action: 'updateCampaign', ...data });
}
async function apiDeleteCampaign(rowIndex) {
  return fetchFromAPI({ action: 'deleteCampaign', rowIndex: String(rowIndex) });
}
async function apiGetCampaignStats() {
  return fetchFromAPI({ action: 'getCampaignStats' });
}

// ─── Content Calendar APIs ──────────────────────

async function apiGetContentCalendar(params = {}) {
  return fetchFromAPI({ action: 'getContentCalendar', ...params });
}
async function apiAddContentItem(data) {
  return fetchFromAPI({ action: 'addContentItem', ...data });
}
async function apiUpdateContentItem(data) {
  return fetchFromAPI({ action: 'updateContentItem', ...data });
}
async function apiDeleteContentItem(rowIndex) {
  return fetchFromAPI({ action: 'deleteContentItem', rowIndex: String(rowIndex) });
}

// ─── Accreditation APIs ─────────────────────────

async function apiGetAccreditations(params = {}) {
  return fetchFromAPI({ action: 'getAccreditations', ...params });
}
async function apiAddAccreditation(data) {
  return fetchFromAPI({ action: 'addAccreditation', ...data });
}
async function apiUpdateAccreditation(data) {
  return fetchFromAPI({ action: 'updateAccreditation', ...data });
}
async function apiDeleteAccreditation(rowIndex) {
  return fetchFromAPI({ action: 'deleteAccreditation', rowIndex: String(rowIndex) });
}

// ─── HR Analytics & Birthday APIs ───────────────

async function apiGetHRAnalytics(params = {}) {
  return fetchFromAPI({ action: 'getHRAnalytics', ...params });
}
async function apiGetBirthdayAnniversary() {
  return fetchFromAPI({ action: 'getBirthdayAnniversary' });
}

// ─── UI Helpers ──────────────────────────────────

/**
 * Show a loading skeleton inside a container
 * @param {string} containerId
 * @param {string} type - 'stats' | 'chart' | 'table'
 */
function showLoading(containerId, type = 'chart') {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (type === 'stats') {
    el.innerHTML = `
      <div class="stat-card">
        <div class="skeleton skeleton-text" style="width:60%"></div>
        <div class="skeleton skeleton-value"></div>
      </div>`.repeat(3);
  } else if (type === 'chart') {
    el.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading data...</span></div>`;
  } else if (type === 'table') {
    el.innerHTML = `<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading data...</span></div>`;
  }
}

/**
 * Show an error message inside a container
 * @param {string} containerId
 * @param {string} message
 */
function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <h3>Something went wrong</h3>
      <p>${message}</p>
    </div>`;
}

/**
 * Show empty state inside a container
 * @param {string} containerId
 * @param {string} title
 * @param {string} subtitle
 */
function showEmpty(containerId, title = 'No data available yet', subtitle = 'Data will appear here once activity is recorded.') {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
      </svg>
      <h3>${title}</h3>
      <p>${subtitle}</p>
    </div>`;
}

// ─── Payroll API ──────────────────────────────────────────────
function apiGetPayrollEmployees() {
  return fetchFromAPI({ action: 'getPayrollEmployees' }, { noCache: true });
}

function apiSavePayrollEmployee(data) {
  return fetchFromAPI({ action: 'savePayrollEmployee', ...data }, { noCache: true });
}

function apiDeletePayrollEmployee(id) {
  return fetchFromAPI({ action: 'deletePayrollEmployee', id }, { noCache: true });
}

function apiGetPayrollHours(period) {
  return fetchFromAPI({ action: 'getPayrollHours', period }, { noCache: true });
}

function apiSavePayrollHours(period, rows) {
  return fetchFromAPI({ action: 'savePayrollHours', period, rows: JSON.stringify(rows) }, { noCache: true });
}

function apiGetPayrollRegister(period) {
  return fetchFromAPI({ action: 'getPayrollRegister', period }, { noCache: true });
}

function apiSavePayrollRegister(period, rows) {
  return fetchFromAPI({ action: 'savePayrollRegister', period, rows: JSON.stringify(rows) }, { noCache: true });
}

function apiSubmitPayrollForApproval(payload) {
  return fetchFromAPI({
    action: 'submitPayrollForApproval',
    period: payload.period,
    cutoffLabel: payload.cutoffLabel,
    submittedBy: payload.submittedBy,
    totalsJSON: JSON.stringify(payload.totals || {}),
    snapshotHtml: payload.snapshotHtml || ''
  }, { noCache: true });
}

function apiGetPayrollApprovals(params) {
  var p = Object.assign({ action: 'getPayrollApprovals' }, params || {});
  return fetchFromAPI(p, { noCache: true });
}

function apiGetPayrollApprovalSnapshot(rowIndex) {
  return fetchFromAPI({ action: 'getPayrollApprovalSnapshot', rowIndex: rowIndex }, { noCache: true });
}

// ─── Bank Accounts API ────────────────────────────────────────
function apiGetBankAccounts() {
  return fetchFromAPI({ action: 'getBankAccounts' }, { noCache: true });
}
function apiGetBankTransactions(params) {
  return fetchFromAPI(Object.assign({ action: 'getBankTransactions' }, params || {}), { noCache: true });
}
function apiSaveBankAccount(data) {
  return fetchFromAPI(Object.assign({ action: 'saveBankAccount' }, data || {}), { noCache: true });
}
function apiAddBankTransaction(data) {
  return fetchFromAPI(Object.assign({ action: 'addBankTransaction' }, data || {}), { noCache: true });
}
function apiDeleteBankTransaction(id) {
  return fetchFromAPI({ action: 'deleteBankTransaction', id: id }, { noCache: true });
}

// ─── Director Payables API ────────────────────────────────────
function apiGetDirectorPayables(params) {
  return fetchFromAPI(Object.assign({ action: 'getDirectorPayables' }, params || {}), { noCache: true });
}
function apiSaveDirectorPayable(data) {
  return fetchFromAPI(Object.assign({ action: 'saveDirectorPayable' }, data || {}), { noCache: true });
}
function apiMarkDirectorPayablePaid(data) {
  return fetchFromAPI(Object.assign({ action: 'markDirectorPayablePaid' }, data || {}), { noCache: true });
}
function apiUnmarkDirectorPayablePaid(id) {
  return fetchFromAPI({ action: 'unmarkDirectorPayablePaid', id: id }, { noCache: true });
}
function apiDeleteDirectorPayable(id) {
  return fetchFromAPI({ action: 'deleteDirectorPayable', id: id }, { noCache: true });
}

function apiDecidePayrollApproval(rowIndex, decision, approvedBy, notes, pdfBase64) {
  return fetchFromAPI({
    action: 'decidePayrollApproval',
    rowIndex: rowIndex,
    decision: decision,
    approvedBy: approvedBy,
    notes: notes || '',
    pdfBase64: pdfBase64 || ''
  }, { noCache: true });
}

// ── Phase 1 additions: leaves / memos / financial drill / autofill ──
async function apiGetMyLeaves(employee) {
  return fetchFromAPI({ action: 'getMyLeaves', employee: employee || '' }, { noCache: true });
}

async function apiGetActiveMemosForUser(userName, role) {
  return fetchFromAPI({ action: 'getActiveMemosForUser', userName: userName || '', role: role || '' });
}

async function apiGetFinancialBreakdown(metric, range) {
  return fetchFromAPI({ action: 'getFinancialBreakdown', metric: metric, range: range || 'month' });
}

async function apiGetAdminDailyAutofill(userName, date) {
  return fetchFromAPI({ action: 'getAdminDailyAutofill', userName: userName || '', date: date || '' }, { noCache: true });
}

async function apiGetAccountingDailyAutofill(userName, date) {
  return fetchFromAPI({ action: 'getAccountingDailyAutofill', userName: userName || '', date: date || '' }, { noCache: true });
}

async function apiGetHrDailyAutofill(userName, date) {
  return fetchFromAPI({ action: 'getHrDailyAutofill', userName: userName || '', date: date || '' }, { noCache: true });
}
