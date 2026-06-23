/*
  ═══════════════════════════════════════════════
  MASTER SALES DASHBOARD — Google Apps Script Backend
  ═══════════════════════════════════════════════

  DEPLOYMENT STEPS:
  1. Open Google Apps Script at script.google.com
  2. Paste this Code.gs content
  3. Replace USERS_SHEET_ID with your actual Users Google Sheet ID
  4. Click Deploy → New Deployment → Web App
  5. Set "Execute as" → Me
  6. Set "Who has access" → Anyone
  7. Click Deploy and copy the Web App URL
  8. Paste that URL into js/api.js as the APPS_SCRIPT_URL constant
  9. Upload the frontend files to a GitHub repo
  10. Enable GitHub Pages under repo Settings → Pages → main branch

  SHEET STRUCTURE:
  - Users Sheet: Username | Password (Base64) | Role (admin/sales) | Full Name |
    Quotation Sheet ID | PR Sheet ID | PO Sheet ID |
    App URL - Quotation | App URL - PR | App URL - PO |
    MRO Sheet ID | App URL - MRO
  - Login Tracker Sheet (separate): Timestamp | Username | Full Name | Role
  - PO Sheet: Date | Agent Name | Client Name | PO Number | Amount | Status
  - PR Sheet: Date | Agent Name | Client Name | PR Number | Items Requested | Status
  - Quotation Sheet: Date | Agent Name | Client Name | Quotation Number | Amount | Status | RFQ Source

  SETTING UP THE DAILY TRIGGER:
  After deploying, run setupDailyTrigger() once from the script editor
  to create the 5 PM daily activity alert.
*/

// ─── Configuration ───────────────────────────────────────────
var USERS_SHEET_ID = '';
var LOGIN_TRACKER_SHEET_ID = ''; // Create a separate Google Sheet for login logs
var MANAGER_EMAIL = 'manager@company.com'; // fallback admin email
var INVENTORY_SHEET_ID_FOR_VIEWER = ''; // ← Paste your INVENTORY_SHEET_ID here (same spreadsheet MRO/MI use)
var QUOTATION_SUMMARY_SHEET_ID = ''; // ← Paste the shared Quotation Summary Sheet ID here
var MRO_SHEET_ID = ''; // Central Materials Receiving sheet
var COLLECTIONS_SHEET_ID = ''; // Collections (AR) sheet
var COLLECTIONS_SHEET_GID = 1313077456; // GID of the Collections tab
var SO_DRIVE_FOLDER_ID = ''; // Sales Order documents root folder

// ─── Shared Retry Helper ────────────────────────────────────
/**
 * Retry a function up to maxAttempts times with linear backoff.
 * @param {function} fn - The function to execute (must return a value)
 * @param {number} maxAttempts - Max retries (default 3)
 * @param {number} delayMs - Base delay in ms between attempts (default 1000)
 * @returns {*} Result of fn()
 */
function withRetry(fn, maxAttempts, delayMs) {
  maxAttempts = maxAttempts || 3;
  delayMs = delayMs || 1000;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      Utilities.sleep(delayMs * attempt);
    }
  }
}

// ─── Session Management ─────────────────────────────────────

function _getOrCreateSessionsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) {
    sheet = ss.insertSheet('Sessions');
    sheet.appendRow(['Token', 'Username', 'FullName', 'Role', 'CreatedAt', 'ExpiresAt']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  return sheet;
}

function generateSessionToken(username, fullName, role) {
  var token = Utilities.getUuid();
  var now = new Date();
  var expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 8 hours

  var sessionData = JSON.stringify({
    username: username,
    fullName: fullName,
    role: role,
    createdAt: now.getTime()
  });

  // Write to CacheService (max 21600s = 6 hours)
  CacheService.getScriptCache().put('session_' + token, sessionData, 21600);

  // Write to Sessions sheet (durable, covers 6-8 hour gap)
  _getOrCreateSessionsSheet().appendRow([
    token, username, fullName, role, now.toISOString(), expiresAt.toISOString()
  ]);

  return token;
}

function validateSession(token) {
  if (!token) return null;

  // 1. Try CacheService first (fast path)
  var cached = CacheService.getScriptCache().get('session_' + token);
  if (cached) return JSON.parse(cached);

  // 2. Fall back to Sessions sheet
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === token) {
      var expiresAt = new Date(data[i][5]);
      if (new Date() > expiresAt) {
        sheet.deleteRow(i + 1);
        return null;
      }
      return {
        username: String(data[i][1]),
        fullName: String(data[i][2]),
        role: String(data[i][3]),
        createdAt: new Date(data[i][4]).getTime()
      };
    }
  }
  return null;
}

function invalidateSession(token) {
  if (!token) return;
  CacheService.getScriptCache().remove('session_' + token);

  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === token) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

function handleLogout(params) {
  invalidateSession(String(params.token || ''));
  return { success: true, message: 'Logged out.' };
}

function cleanupExpiredSessions() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  for (var i = data.length - 1; i >= 1; i--) {
    if (now > new Date(data[i][5])) sheet.deleteRow(i + 1);
  }
}

// ─── Entry Point ─────────────────────────────────────────────
function doGet(e) {
  var params = e.parameter;
  var action = params.action;
  var result;

  // Session validation (skip for login)
  if (action !== 'login') {
    var token = params.token || '';
    if (token) {
      var session = validateSession(token);
      if (!session) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: 'Session expired or invalid. Please log in again.', authError: true })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }
    // No token = grace period for old clients (remove after transition)
  }

  try {
    switch (action) {
      case 'login':
        result = handleLogin(params.user, params.pass);
        break;
      case 'getStats':
        result = handleGetStats(params);
        break;
      case 'getDailyTrend':
        result = handleGetDailyTrend(params);
        break;
      case 'getClientRanking':
        result = handleGetClientRanking(params);
        break;
      case 'getTeamSummary':
        result = handleGetTeamSummary();
        break;
      case 'getHotLeads':
        result = handleGetHotLeads();
        break;
      case 'getDailyActivityAlert':
        result = handleDailyActivityAlert();
        break;
      case 'getLoginLog':
        result = handleGetLoginLog(params);
        break;
      case 'getClientTracker':
        result = handleGetClientTracker(params);
        break;
      case 'updateTrackerRow':
        result = handleUpdateTrackerRow(params);
        break;
      case 'getTodayCounts':
        result = handleGetTodayCounts(params);
        break;
      case 'submitDailyReport':
        result = handleSubmitDailyReport(params);
        break;
      case 'getDailyReports':
        result = handleGetDailyReports(params);
        break;
      case 'getAgentDayActivity':
        result = handleGetAgentDayActivity(params);
        break;
      case 'changePassword':
        result = handleChangePassword(params);
        break;
      case 'getTargets':
        result = handleGetTargets(params);
        break;
      case 'setTargets':
        result = handleSetTargets(params);
        break;
      case 'getReportSummary':
        result = handleGetReportSummary(params);
        break;
      case 'getAccountingDashboard':
        result = handleGetAccountingDashboard(params);
        break;
      case 'getClientProfitReport':
        result = handleGetClientProfitReport(params);
        break;
      case 'getProfitReports':
        result = handleGetProfitReports(params);
        break;
      case 'getOrders':
        result = handleGetOrders(params);
        break;
      case 'addOrder':
        result = handleAddOrder(params);
        break;
      case 'updateOrder':
        result = handleUpdateOrder(params);
        break;
      case 'getExpenses':
        result = handleGetExpenses(params);
        break;
      case 'addExpense':
        result = handleAddExpense(params);
        break;
      case 'saveProfitReport':
        result = handleSaveProfitReport(params);
        break;
      case 'getSupplierQuotations':
        result = handleGetSupplierQuotations(params);
        break;
      case 'listSQFolderFiles':
        result = handleListSQFolderFiles(params);
        break;
      case 'addSupplierQuotation':
        result = handleAddSupplierQuotation(params);
        break;
      case 'getClients':
        result = handleGetClients(params);
        break;
      case 'addClient':
        result = handleAddClient(params);
        break;
      case 'updateClient':
        result = handleUpdateClient(params);
        break;
      case 'deleteClient':
        result = handleDeleteClient(params);
        break;
      case 'getClientCount':
        result = handleGetClientCount(params);
        break;
      case 'addPaymentRequest':
        result = handleAddPaymentRequest(params);
        break;
      case 'getPaymentRequests':
        result = handleGetPaymentRequests(params);
        break;
      case 'updatePaymentRequestStatus':
        result = handleUpdatePaymentRequestStatus(params);
        break;
      case 'getBillingRecords':
        result = handleGetBillingRecords(params);
        break;
      case 'getBillingDetail':
        result = handleGetBillingDetail(params);
        break;
      case 'getInventory':
        result = handleGetInventory(params);
        break;
      case 'getCollections':
        result = handleGetCollections(params);
        break;
      case 'getUsers':
        result = handleGetUsers(params);
        break;
      case 'addUser':
        result = handleAddUser(params);
        break;
      case 'updateUser':
        result = handleUpdateUser(params);
        break;
      case 'deleteUser':
        result = handleDeleteUser(params);
        break;
      case 'resetUserPassword':
        result = handleResetUserPassword(params);
        break;
      case 'deleteOrder':
        result = handleDeleteOrder(params);
        break;
      case 'deleteExpense':
        result = handleDeleteExpense(params);
        break;
      case 'updateExpense':
        result = handleUpdateExpense(params);
        break;
      case 'updateSupplierQuotation':
        result = handleUpdateSupplierQuotation(params);
        break;
      case 'deleteSupplierQuotation':
        result = handleDeleteSupplierQuotation(params);
        break;
      case 'addInventoryItem':
        result = handleAddInventoryItem(params);
        break;
      case 'updateInventoryItem':
        result = handleUpdateInventoryItem(params);
        break;
      case 'deleteInventoryItem':
        result = handleDeleteInventoryItem(params);
        break;
      case 'getAllPRs':
        result = handleGetAllPRs(params);
        break;
      case 'getPendingQuotations':
        result = handleGetPendingQuotations(params);
        break;
      case 'approveQuotation':
        result = handleApproveQuotation(params);
        break;
      case 'updateQuotationDriveLink':
        result = handleUpdateQuotationDriveLink(params);
        break;
      case 'reviseQuotation':
        result = handleReviseQuotation(params);
        break;
      case 'getMyRejectedQuotations':
        result = handleGetMyRejectedQuotations(params);
        break;
      case 'getPendingItems':
        result = handleGetPendingItems(params);
        break;
      case 'updatePRPricing':
        result = handleUpdatePRPricing(params);
        break;
      case 'getQuotationSummary':
        result = handleGetQuotationSummary(params);
        break;
      case 'getQuotationApprovalStatus':
        result = handleGetQuotationApprovalStatus(params);
        break;
      case 'finalizeQuotation':
        result = handleFinalizeQuotation(params);
        break;
      case 'getNextQuotationNumber':
        result = handleGetNextQuotationNumber(params);
        break;
      case 'submitAdminDailyReport':
        result = handleSubmitAdminDailyReport(params);
        break;
      case 'getAdminDailyReports':
        result = handleGetAdminDailyReports(params);
        break;
      case 'getSalesOrders':
        result = handleGetSalesOrders(params);
        break;
      case 'createSalesOrder':
        result = handleCreateSalesOrder(params);
        break;
      case 'updateSOStatus':
        result = handleUpdateSOStatus(params);
        break;
      case 'updateSalesOrder':
        result = handleUpdateSalesOrder(params);
        break;
      case 'deleteSalesOrder':
        result = handleDeleteSalesOrder(params);
        break;
      case 'getSOStats':
        result = handleGetSOStats();
        break;
      case 'getSODocuments':
        result = handleGetSODocuments(params);
        break;
      case 'savePORecord':
        result = handleSavePORecord(params);
        break;
      case 'getPORecords':
        result = handleGetPORecords(params);
        break;
      case 'approvePO':
        result = handleApprovePO(params);
        break;
      case 'sendPOEmail':
        result = handleSendPOEmail(params);
        break;
      case 'sendAdminEmail':
        result = handleSendAdminEmail(params);
        break;
      case 'sendAcctEmail':
        result = handleSendAcctEmail(params);
        break;
      case 'getPOStats':
        result = handleGetPOStats();
        break;
      case 'savePricingSubmission':
        result = handleSavePricingSubmission(params);
        break;
      case 'getPricingSubmissions':
        result = handleGetPricingSubmissions(params);
        break;
      case 'getPriceHistory':
        result = handleGetPriceHistory(params);
        break;
      case 'getShipments':
        result = handleGetShipments(params);
        break;
      case 'saveShipment':
        result = handleSaveShipment(params);
        break;
      case 'uploadShipmentDoc':
        result = handleUploadShipmentDoc(params);
        break;
      case 'deleteShipmentDoc':
        result = handleDeleteShipmentDoc(params);
        break;
      case 'forwardPRToPricing':
        result = handleForwardPRToPricing(params);
        break;
      case 'applyPricingToPR':
        result = handleApplyPricingToPR(params);
        break;
      case 'markSentToSales':
        result = handleMarkSentToSales(params);
        break;

      // HR-Marketing
      case 'getHRDailyReports':
        result = handleGetHRDailyReports(params);
        break;
      case 'getRecruitmentPipeline':
        result = handleGetRecruitmentPipeline(params);
        break;
      case 'getRecruitmentStats':
        result = handleGetRecruitmentStats(params);
        break;
      case 'getHRTasks':
        result = handleGetHRTasks(params);
        break;
      case 'getHRTaskStats':
        result = handleGetHRTaskStats(params);
        break;
      case 'getEmployees':
        result = handleGetEmployees(params);
        break;
      case 'getHRSummary':
        result = handleGetHRSummary(params);
        break;

      // Leave & Attendance
      case 'getLeaveRequests':
        result = handleGetLeaveRequests(params);
        break;
      case 'getLeaveStats':
        result = handleGetLeaveStats(params);
        break;

      // Performance Reviews
      case 'getPerformanceReviews':
        result = handleGetPerformanceReviews(params);
        break;

      // Training
      case 'getTrainingPrograms':
        result = handleGetTrainingPrograms(params);
        break;

      // Memos
      case 'getMemos':
        result = handleGetMemos(params);
        break;

      // Grievances
      case 'getGrievances':
        result = handleGetGrievances(params);
        break;

      // Marketing Campaigns
      case 'getCampaigns':
        result = handleGetCampaigns(params);
        break;
      case 'getCampaignStats':
        result = handleGetCampaignStats(params);
        break;

      // Content Calendar
      case 'getContentCalendar':
        result = handleGetContentCalendar(params);
        break;

      // Accreditations
      case 'getAccreditations':
        result = handleGetAccreditations(params);
        break;

      // HR Analytics
      case 'getHRAnalytics':
        result = handleGetHRAnalytics(params);
        break;
      case 'getBirthdayAnniversary':
        result = handleGetBirthdayAnniversary(params);
        break;

      // New: My Daily Reports (sales agent history)
      case 'getMyDailyReports':
        result = handleGetMyDailyReports(params);
        break;

      // New: Quotation approval notifications for sales
      case 'getMyQuotationNotifications':
        result = handleGetMyQuotationNotifications(params);
        break;
      case 'getMyNotifications':
        result = handleGetMyNotifications(params);
        break;
      case 'getEmployeeHistory':
        result = handleGetEmployeeHistory(params);
        break;
      case 'getCampaignLeadsSummary':
        result = handleGetCampaignLeadsSummary(params);
        break;

      // New: Link PR to Quotation by RFQ
      case 'linkPRToQuotation':
        result = handleLinkPRToQuotation(params);
        break;

      // New: Accounting Daily Report
      case 'submitAccountingDailyReport':
        result = handleSubmitAccountingDailyReport(params);
        break;
      case 'getAccountingDailyReports':
        result = handleGetAccountingDailyReports(params);
        break;

      // New: All daily reports for management
      case 'getAllDailyReports':
        result = handleGetAllDailyReports(params);
        break;

      // MRO/MI Queue
      case 'getAllMROs':
        result = handleGetAllMROs(params);
        break;
      case 'getAllMIs':
        result = handleGetAllMIs(params);
        break;

      case 'getManagementInsights':
        result = handleGetManagementInsights(params);
        break;

      // Payroll
      case 'getPayrollEmployees':
        result = handleGetPayrollEmployees();
        break;
      case 'savePayrollEmployee':
        result = handleSavePayrollEmployee(params);
        break;
      case 'deletePayrollEmployee':
        result = handleDeletePayrollEmployee(params);
        break;
      case 'getPayrollHours':
        result = handleGetPayrollHours(params);
        break;
      case 'savePayrollHours':
        result = handleSavePayrollHours(params);
        break;
      case 'getPayrollRegister':
        result = handleGetPayrollRegister(params);
        break;
      case 'savePayrollRegister':
        result = handleSavePayrollRegister(params);
        break;
      case 'get13thMonthPay':
        result = handleGet13thMonthPay(params);
        break;
      case 'getBankAccounts':
        result = handleGetBankAccounts();
        break;
      case 'getBankTransactions':
        result = handleGetBankTransactions(params);
        break;
      case 'getDirectorPayables':
        result = handleGetDirectorPayables(params);
        break;
      case 'getPayrollApprovals':
        result = handleGetPayrollApprovals(params);
        break;
      case 'getPayrollApprovalSnapshot':
        result = handleGetPayrollApprovalSnapshot(params);
        break;
      case 'submitPayrollForApproval':
        result = handleSubmitPayrollForApproval(params);
        break;
      case 'decidePayrollApproval':
        result = handleDecidePayrollApproval(params);
        break;

      case 'getShipmentTimeline':
        result = handleGetShipmentTimeline(params);
        break;

      case 'getDocsByShipment':
        result = handleGetDocsByShipment(params);
        break;
      case 'getDocsByType':
        result = handleGetDocsByType(params);
        break;
      case 'getDocsByClient':
        result = handleGetDocsByClient(params);
        break;
      case 'getAuditTrail':
        result = handleGetAuditTrail(params);
        break;
      case 'getShipmentHistory':
        result = handleGetShipmentHistory(params);
        break;
      case 'getGlobalAuditLog':
        result = handleGetGlobalAuditLog(params);
        break;
      case 'getAuditLogFilterValues':
        result = handleGetAuditLogFilterValues(params);
        break;

      case 'validateSession':
        result = handleValidateSession(params);
        break;
      case 'setEmailCredentials':
        result = handleSetEmailCredentials(params);
        break;
      case 'getEmailCredentialsForBackend':
        result = handleGetEmailCredentialsForBackend(params);
        break;
      case 'getMyLeaves':
        result = handleGetMyLeaves(params);
        break;
      case 'getActiveMemosForUser':
        result = handleGetActiveMemosForUser(params);
        break;
      case 'getFinancialBreakdown':
        result = handleGetFinancialBreakdown(params);
        break;
      case 'getAdminDailyAutofill':
        result = handleGetAdminDailyAutofill(params);
        break;
      case 'getAccountingDailyAutofill':
        result = handleGetAccountingDailyAutofill(params);
        break;
      case 'getHrDailyAutofill':
        result = handleGetHrDailyAutofill(params);
        break;

      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, message: 'Server error: ' + err.message };
  }

  var output = ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ─── ACTION: validateSession (for Flask backend) ─────────────
function handleValidateSession(params) {
  var token = String(params.token || '');
  var session = validateSession(token);
  if (!session) return { success: true, valid: false };
  return {
    success: true,
    valid: true,
    username: session.username,
    name: session.fullName,
    role: session.role
  };
}

// ─── Email credential storage (Fernet-encrypted blob) ────────
function _emailCredsColumnIndex_(usersSheet) {
  var header = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
  for (var c = 0; c < header.length; c++) {
    if (String(header[c]).trim() === 'godaddyCredsEnc') return c;
  }
  // Auto-create header at end
  var newCol = header.length + 1;
  usersSheet.getRange(1, newCol).setValue('godaddyCredsEnc');
  return newCol - 1;
}

function _findUserRowByUsername_(usersSheet, username) {
  var data = usersSheet.getDataRange().getValues();
  var target = String(username || '').trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function handleSetEmailCredentials(params) {
  var sharedSecret = PropertiesService.getScriptProperties().getProperty('INTERNAL_SHARED_SECRET');
  if (!sharedSecret || String(params.sharedSecret || '') !== sharedSecret) {
    return { success: false, message: 'Forbidden' };
  }
  var token = String(params.token || '');
  var session = validateSession(token);
  if (!session) return { success: false, message: 'Invalid session' };

  var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
  var found = _findUserRowByUsername_(usersSheet, session.username);
  if (!found) return { success: false, message: 'User not found' };

  var colIdx = _emailCredsColumnIndex_(usersSheet);
  usersSheet.getRange(found.rowIndex, colIdx + 1).setValue(String(params.encBlob || ''));
  return { success: true };
}

function handleGetEmailCredentialsForBackend(params) {
  var sharedSecret = PropertiesService.getScriptProperties().getProperty('INTERNAL_SHARED_SECRET');
  if (!sharedSecret || String(params.sharedSecret || '') !== sharedSecret) {
    return { success: false, message: 'Forbidden' };
  }
  var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
  var found = _findUserRowByUsername_(usersSheet, params.username);
  if (!found) return { success: false, message: 'User not found' };

  var colIdx = _emailCredsColumnIndex_(usersSheet);
  var encBlob = String(found.row[colIdx] || '');
  return { success: true, encBlob: encBlob };
}

// ─── ACTION: login ───────────────────────────────────────────
function handleLogin(user, pass) {
  if (!user || !pass) {
    return { success: false, message: 'Username and password are required' };
  }

  // Rate limiting: 5 attempts per 15 minutes per username
  var cacheKey = 'login_attempts_' + user.trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var attemptsRaw = cache.get(cacheKey);
  var attempts = attemptsRaw ? parseInt(attemptsRaw) : 0;

  if (attempts >= 5) {
    return { success: false, message: 'Too many login attempts. Please wait 15 minutes and try again.' };
  }

  var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
  var data = sheet.getDataRange().getValues();

  // Skip header row
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var username = String(row[0]).trim();
    var password = String(row[1]).trim();
    var role = String(row[2]).trim().toLowerCase();
    var fullName = String(row[3]).trim();
    var quotationSheetId = String(row[4]).trim();
    var prSheetId = String(row[5]).trim();
    var poSheetId = String(row[6]).trim();
    var appUrlQuotation = String(row[7]).trim();
    var appUrlPR = String(row[8]).trim();
    var appUrlPO = String(row[9]).trim();
    var mroSheetId = String(row[10]).trim();
    var appUrlMRO = String(row[11]).trim();
    var trainingModeRaw = row[12];
    var trainingMode = (trainingModeRaw === true || String(trainingModeRaw).trim().toLowerCase() === 'true' || String(trainingModeRaw).trim() === '1');

    if (username === user.trim()) {
      // Decode Base64 password and compare
      var decodedPassword = Utilities.newBlob(
        Utilities.base64Decode(password)
      ).getDataAsString();

      if (decodedPassword === pass) {
        // Reset rate limit on successful login
        cache.remove(cacheKey);
        logLogin(username, fullName, role);

        // Generate session token
        var token = generateSessionToken(username, fullName, role);

        return {
          success: true,
          token: token,
          name: fullName,
          role: role,
          username: username,
          quotationSheetId: quotationSheetId,
          prSheetId: prSheetId,
          poSheetId: poSheetId,
          mroSheetId: mroSheetId,
          appUrls: {
            quotation: appUrlQuotation,
            pr: appUrlPR,
            po: appUrlPO,
            mro: appUrlMRO
          },
          trainingMode: trainingMode
        };
      } else {
        // Increment failed attempts (expires in 900 seconds = 15 min)
        cache.put(cacheKey, String(attempts + 1), 900);
        var remaining = 4 - attempts;
        var msg = remaining > 0
          ? 'Invalid credentials. ' + remaining + ' attempt(s) remaining.'
          : 'Too many login attempts. Please wait 15 minutes and try again.';
        return { success: false, message: msg };
      }
    }
  }

  // User not found — still increment to prevent username enumeration
  cache.put(cacheKey, String(attempts + 1), 900);
  return { success: false, message: 'Invalid credentials' };
}

// ─── ACTION: getStats ────────────────────────────────────────
function handleGetStats(params) {
  var agentName = params.agentName;
  var quotationSheetId = params.quotationSheetId;
  var prSheetId = params.prSheetId;
  var poSheetId = params.poSheetId;
  var range = params.range || 'month';

  var dateRange = getDateRange(range);

  var quotations = countDocuments(quotationSheetId, agentName, dateRange);
  var prs = countPRDocuments(prSheetId, dateRange);
  var pos = countDocuments(poSheetId, agentName, dateRange);

  return {
    success: true,
    quotations: quotations,
    prs: prs,
    pos: pos
  };
}

// ─── ACTION: getDailyTrend ───────────────────────────────────
function handleGetDailyTrend(params) {
  var agentName = params.agentName;
  var quotationSheetId = params.quotationSheetId;
  var prSheetId = params.prSheetId;
  var poSheetId = params.poSheetId;
  var days = parseInt(params.days) || 30;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build date map for last N days
  var dateMap = {};
  for (var d = days - 1; d >= 0; d--) {
    var date = new Date(today);
    date.setDate(date.getDate() - d);
    var key = formatDate(date);
    dateMap[key] = { date: key, quotations: 0, prs: 0, pos: 0 };
  }

  var startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (days - 1));
  var dateRange = { start: startDate, end: new Date() };

  // Count quotations per day
  countDocumentsPerDay(quotationSheetId, agentName, dateRange, dateMap, 'quotations');
  countPRDocumentsPerDay(prSheetId, dateRange, dateMap, 'prs');
  countDocumentsPerDay(poSheetId, agentName, dateRange, dateMap, 'pos');

  // Convert map to sorted array
  var result = [];
  var keys = Object.keys(dateMap).sort();
  for (var i = 0; i < keys.length; i++) {
    result.push(dateMap[keys[i]]);
  }

  return { success: true, data: result };
}

// ─── ACTION: getClientRanking ────────────────────────────────
function handleGetClientRanking(params) {
  var agentName = params.agentName;
  var quotationSheetId = params.quotationSheetId;
  var range = params.range || 'month';

  var dateRange = getDateRange(range);

  try {
    var sheet = SpreadsheetApp.openById(quotationSheetId).getSheets()[0];
    var data = sheet.getDataRange().getValues();
  } catch (err) {
    return { success: true, data: [] };
  }

  var clientCount = {};

  for (var i = 1; i < data.length; i++) {
    var rowDate = parseSheetDate(data[i][0]);
    var rowAgent = String(data[i][1]).trim();
    var clientName = String(data[i][2]).trim();

    if (!rowDate || !clientName) continue;
    if (agentName && rowAgent.toLowerCase() !== agentName.toLowerCase()) continue;
    if (rowDate < dateRange.start || rowDate > dateRange.end) continue;

    clientCount[clientName] = (clientCount[clientName] || 0) + 1;
  }

  // Sort and return top 10
  var sorted = Object.keys(clientCount).map(function(client) {
    return { client: client, count: clientCount[client] };
  }).sort(function(a, b) {
    return b.count - a.count;
  }).slice(0, 10);

  return { success: true, data: sorted };
}

// ─── ACTION: getTeamSummary ──────────────────────────────────
function handleGetTeamSummary() {
  var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
  var usersData = usersSheet.getDataRange().getValues();
  var dateRange = getDateRange('month');
  var allTimeRange = getDateRange('all');

  // Last month range for trend comparison
  var now = new Date();
  var lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  lastMonthStart.setHours(0, 0, 0, 0);
  var lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  lastMonthEnd.setHours(23, 59, 59, 999);
  var lastMonthRange = { start: lastMonthStart, end: lastMonthEnd };

  // Load targets for current month
  var currentMonth = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  var targetMap = {};
  try {
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var targetSheet = ss.getSheetByName('Sales Targets');
    if (targetSheet) {
      var tData = targetSheet.getDataRange().getValues();
      for (var t = 1; t < tData.length; t++) {
        var tMonth = String(tData[t][0]).trim();
        var tAgent = String(tData[t][1]).trim().toLowerCase();
        if (tMonth === currentMonth) {
          targetMap[tAgent] = {
            quotationTarget: parseInt(tData[t][2]) || 0,
            prTarget: parseInt(tData[t][3]) || 0,
            callTarget: parseInt(tData[t][4]) || 0
          };
        }
      }
    }
  } catch (e) {}

  var teamData = [];

  for (var i = 1; i < usersData.length; i++) {
    var role = String(usersData[i][2]).trim().toLowerCase();
    if (role !== 'sales') continue;

    var fullName = String(usersData[i][3]).trim();
    var quotationSheetId = String(usersData[i][4]).trim();
    var prSheetId = String(usersData[i][5]).trim();
    var poSheetId = String(usersData[i][6]).trim();

    var quotations = countDocuments(quotationSheetId, fullName, dateRange);
    var quotationsTotal = countDocuments(quotationSheetId, fullName, allTimeRange);
    var prs = countPRDocuments(prSheetId, dateRange);
    var pos = countDocuments(poSheetId, fullName, dateRange);

    // Last month for trend
    var prevQuotations = countDocuments(quotationSheetId, fullName, lastMonthRange);
    var prevPRs = countPRDocuments(prSheetId, lastMonthRange);
    var prevPOs = countDocuments(poSheetId, fullName, lastMonthRange);

    var targets = targetMap[fullName.toLowerCase()] || { quotationTarget: 0, prTarget: 0, callTarget: 0 };

    teamData.push({
      name: fullName,
      quotations: quotations,
      quotationsTotal: quotationsTotal,
      prs: prs,
      pos: pos,
      total: quotations + prs + pos,
      prevTotal: prevQuotations + prevPRs + prevPOs,
      quotationTarget: targets.quotationTarget,
      prTarget: targets.prTarget,
      callTarget: targets.callTarget
    });
  }

  // Sort by total descending
  teamData.sort(function(a, b) {
    return b.total - a.total;
  });

  return { success: true, data: teamData };
}

// ─── ACTION: getHotLeads ─────────────────────────────────────
function handleGetHotLeads() {
  var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
  var usersData = usersSheet.getDataRange().getValues();
  var dateRange = getDateRange('month');

  var clientMap = {}; // { clientName: { count: N, agents: Set } }

  for (var i = 1; i < usersData.length; i++) {
    var role = String(usersData[i][2]).trim().toLowerCase();
    if (role === 'admin') continue;

    var agentName = String(usersData[i][3]).trim();
    var quotationSheetId = String(usersData[i][4]).trim();

    try {
      var sheet = SpreadsheetApp.openById(quotationSheetId).getSheets()[0];
      var data = sheet.getDataRange().getValues();
    } catch (err) {
      continue;
    }

    for (var j = 1; j < data.length; j++) {
      var rowDate = parseSheetDate(data[j][0]);
      var clientName = String(data[j][2]).trim();

      if (!rowDate || !clientName) continue;
      if (rowDate < dateRange.start || rowDate > dateRange.end) continue;

      if (!clientMap[clientName]) {
        clientMap[clientName] = { count: 0, agents: [] };
      }
      clientMap[clientName].count++;
      if (clientMap[clientName].agents.indexOf(agentName) === -1) {
        clientMap[clientName].agents.push(agentName);
      }
    }
  }

  // Filter clients with 3+ RFQs
  var hotLeads = [];
  var clients = Object.keys(clientMap);
  for (var k = 0; k < clients.length; k++) {
    var entry = clientMap[clients[k]];
    if (entry.count >= 3) {
      hotLeads.push({
        client: clients[k],
        rfqCount: entry.count,
        agents: entry.agents
      });
    }
  }

  hotLeads.sort(function(a, b) {
    return b.rfqCount - a.rfqCount;
  });

  return { success: true, data: hotLeads };
}

// ─── ACTION: getDailyActivityAlert ───────────────────────────
function handleDailyActivityAlert() {
  var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
  var usersData = usersSheet.getDataRange().getValues();
  var todayRange = getDateRange('today');

  var inactiveAgents = [];
  var teamTotals = { quotations: 0, prs: 0, pos: 0 };

  for (var i = 1; i < usersData.length; i++) {
    var role = String(usersData[i][2]).trim().toLowerCase();
    if (role === 'admin') continue;

    var fullName = String(usersData[i][3]).trim();
    var quotationSheetId = String(usersData[i][4]).trim();
    var prSheetId = String(usersData[i][5]).trim();
    var poSheetId = String(usersData[i][6]).trim();

    var q = countDocuments(quotationSheetId, fullName, todayRange);
    var p = countPRDocuments(prSheetId, todayRange);
    var o = countDocuments(poSheetId, fullName, todayRange);

    teamTotals.quotations += q;
    teamTotals.prs += p;
    teamTotals.pos += o;

    if (q + p + o === 0) {
      inactiveAgents.push({ name: fullName });
    }
  }

  // Send reminder emails to inactive agents
  for (var j = 0; j < inactiveAgents.length; j++) {
    try {
      // Note: You'd need email column in Users sheet for this to work.
      // For now, we log the inactive agent.
      Logger.log('Inactive agent: ' + inactiveAgents[j].name);
    } catch (err) {
      Logger.log('Email error: ' + err.message);
    }
  }

  // Send manager summary
  try {
    var managerRow = null;
    for (var m = 1; m < usersData.length; m++) {
      if (String(usersData[m][2]).trim().toLowerCase() === 'admin') {
        managerRow = usersData[m];
        break;
      }
    }

    if (managerRow) {
      var subject = 'Daily Sales Team Summary — ' + formatDate(new Date());
      var body = 'Team Totals Today:\n' +
        '- Quotations: ' + teamTotals.quotations + '\n' +
        '- PRs: ' + teamTotals.prs + '\n' +
        '- POs: ' + teamTotals.pos + '\n\n' +
        'Inactive Agents: ' + (inactiveAgents.length > 0
          ? inactiveAgents.map(function(a) { return a.name; }).join(', ')
          : 'None — all agents were active today!');

      MailApp.sendEmail(MANAGER_EMAIL, subject, body);
    }
  } catch (err) {
    Logger.log('Manager email error: ' + err.message);
  }

  return {
    success: true,
    inactiveAgents: inactiveAgents,
    teamTotals: teamTotals
  };
}

// ─── Trigger Setup (run once manually) ───────────────────────
function setupDailyTrigger() {
  // Delete existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runDailyAlert') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create new daily trigger at 5 PM
  ScriptApp.newTrigger('runDailyAlert')
    .timeBased()
    .atHour(17)
    .everyDays(1)
    .create();

  Logger.log('Daily trigger set for 5 PM');
}

function runDailyAlert() {
  handleDailyActivityAlert();
}

// ─── Helper: Count documents in a sheet ──────────────────────
function countDocuments(sheetId, agentName, dateRange) {
  if (!sheetId || sheetId === 'undefined' || sheetId === '') return 0;

  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var data = sheet.getDataRange().getValues();
  } catch (err) {
    return 0;
  }

  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var rowDate = parseSheetDate(data[i][0]);
    var rowAgent = String(data[i][1]).trim();

    if (!rowDate) continue;
    if (agentName && rowAgent.toLowerCase() !== agentName.toLowerCase()) continue;
    if (rowDate < dateRange.start || rowDate > dateRange.end) continue;

    count++;
  }

  return count;
}

// ─── Helper: Count documents per day ─────────────────────────
function countDocumentsPerDay(sheetId, agentName, dateRange, dateMap, field) {
  if (!sheetId || sheetId === 'undefined' || sheetId === '') return;

  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var data = sheet.getDataRange().getValues();
  } catch (err) {
    return;
  }

  for (var i = 1; i < data.length; i++) {
    var rowDate = parseSheetDate(data[i][0]);
    var rowAgent = String(data[i][1]).trim();

    if (!rowDate) continue;
    if (agentName && rowAgent.toLowerCase() !== agentName.toLowerCase()) continue;
    if (rowDate < dateRange.start || rowDate > dateRange.end) continue;

    var key = formatDate(rowDate);
    if (dateMap[key]) {
      dateMap[key][field]++;
    }
  }
}

// ─── Helper: Count PR documents (date in col E, index 4; per-agent sheet) ──
function countPRDocuments(sheetId, dateRange) {
  if (!sheetId || sheetId === 'undefined' || sheetId === '') return 0;

  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var data = sheet.getDataRange().getValues();
  } catch (err) {
    return 0;
  }

  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var rowDate = parseSheetDate(data[i][4]); // PR date is in column E (index 4)
    if (!rowDate) continue;
    if (rowDate < dateRange.start || rowDate > dateRange.end) continue;
    count++;
  }
  return count;
}

// ─── Helper: Count PR documents per day ────────────────────────
function countPRDocumentsPerDay(sheetId, dateRange, dateMap, field) {
  if (!sheetId || sheetId === 'undefined' || sheetId === '') return;

  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var data = sheet.getDataRange().getValues();
  } catch (err) {
    return;
  }

  for (var i = 1; i < data.length; i++) {
    var rowDate = parseSheetDate(data[i][4]); // PR date is in column E (index 4)
    if (!rowDate) continue;
    if (rowDate < dateRange.start || rowDate > dateRange.end) continue;
    var key = formatDate(rowDate);
    if (dateMap[key]) {
      dateMap[key][field]++;
    }
  }
}

// ─── Helper: Get date range from filter ──────────────────────
function getDateRange(range) {
  var now = new Date();
  var start = new Date();
  var end = new Date();

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  switch (range) {
    case 'today':
      // start and end are already today
      break;
    case 'week':
      var dayOfWeek = start.getDay();
      var diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday start
      start.setDate(start.getDate() - diff);
      break;
    case 'month':
      start.setDate(1);
      break;
    case 'all':
      start = new Date(2000, 0, 1);
      break;
    default:
      start.setDate(1); // default to month
  }

  return { start: start, end: end };
}

// ─── Helper: Parse sheet date ────────────────────────────────
function parseSheetDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    var d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  var str = String(value).trim();
  var parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  return null;
}

// ─── Helper: Format date as YYYY-MM-DD ───────────────────────
function formatDate(date) {
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var d = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + d;
}

// ─── Helper: Format date+time as YYYY-MM-DD HH:MM:SS ─────────
function formatDateTime(date) {
  if (!(date instanceof Date)) return String(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// ─── Helper: Log login to Login Tracker Sheet ──────────────────
function logLogin(username, fullName, role) {
  try {
    if (!LOGIN_TRACKER_SHEET_ID || LOGIN_TRACKER_SHEET_ID === '') return;
    var sheet = SpreadsheetApp.openById(LOGIN_TRACKER_SHEET_ID).getSheets()[0];
    sheet.appendRow([new Date(), username, fullName, role]);
  } catch (err) {
    Logger.log('Login tracker error: ' + err.message);
  }
}

// ─── ACTION: getLoginLog ─────────────────────────────────────
function handleGetLoginLog(params) {
  try {
    if (!LOGIN_TRACKER_SHEET_ID || LOGIN_TRACKER_SHEET_ID === '') {
      return { success: false, message: 'Login tracker sheet not configured' };
    }

    var sheet = SpreadsheetApp.openById(LOGIN_TRACKER_SHEET_ID).getSheets()[0];
    var data = sheet.getDataRange().getValues();
    var limit = parseInt(params.limit) || 100;
    var logs = [];

    // Read in reverse order (newest first), skip header
    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      logs.push({
        timestamp: formatDateTime(row[0]),
        username: String(row[1]).trim(),
        fullName: String(row[2]).trim(),
        role: String(row[3]).trim()
      });
      if (logs.length >= limit) break;
    }

    return { success: true, data: logs };
  } catch (err) {
    return { success: false, message: 'Unable to read login log: ' + err.message };
  }
}

// ─── ACTION: getClientTracker ───────────────────────────────
function handleGetClientTracker(params) {
  var agentName = params.agentName;
  var quotationSheetId = params.quotationSheetId;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var documents = [];

  // Read Quotation Sheet only (PRs are on the Pending Items page)
  // Columns: Date | Agent Name | Reference No | RFQ No. | Subject | Client | Contact Person | Email | Total Amount | Status | Follow Up Date
  if (quotationSheetId && quotationSheetId !== 'undefined' && quotationSheetId !== '') {
    try {
      var qSheet = SpreadsheetApp.openById(quotationSheetId).getSheets()[0];
      var qData = qSheet.getDataRange().getValues();
      for (var i = 1; i < qData.length; i++) {
        var rowAgent = String(qData[i][1]).trim();
        if (agentName && rowAgent.toLowerCase() !== agentName.toLowerCase()) continue;
        var rowDate = parseSheetDate(qData[i][0]);
        if (!rowDate) continue;
        var daysSince = Math.floor((today - rowDate) / (1000 * 60 * 60 * 24));
        var status = String(qData[i][9] || '').trim() || 'Pending';
        var followUpDate = '';
        if (qData[i][10]) {
          var fDate = parseSheetDate(qData[i][10]);
          if (fDate) followUpDate = formatDate(fDate);
        }
        documents.push({
          type: 'Quotation',
          clientName: String(qData[i][5]).trim(),
          documentNumber: String(qData[i][2]).trim(),
          dateSent: formatDate(rowDate),
          daysSinceSent: daysSince,
          status: status,
          amount: qData[i][8] || '',
          rfqSource: String(qData[i][3]).trim() || '',
          followUpDate: followUpDate,
          driveLink: String(qData[i][11] || '').trim(),
          adminApproval: String(qData[i][12] || '').trim(),
          managementApproval: String(qData[i][13] || '').trim(),
          overallStatus: String(qData[i][14] || '').trim(),
          sheetId: quotationSheetId,
          rowIndex: i + 1
        });
      }
    } catch (err) { /* skip if sheet not accessible */ }
  }

  // Sort by date descending (most recent first)
  documents.sort(function(a, b) {
    return a.daysSinceSent - b.daysSinceSent;
  });

  return { success: true, data: documents };
}

// ─── ACTION: updateTrackerRow ───────────────────────────────
function handleUpdateTrackerRow(params) {
  try {
    var sheetId = params.sheetId;
    var rowIndex = parseInt(params.rowIndex);
    var status = params.status || '';
    var followUpDate = params.followUpDate || '';
    var sheetType = params.sheetType || 'Quotation';

    if (!sheetId || !rowIndex) {
      return { success: false, message: 'Missing sheetId or rowIndex' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];

    if (sheetType === 'Quotation') {
      // Status = col J (10), Follow Up = col K (11)
      if (status) sheet.getRange(rowIndex, 10).setValue(status);
      if (followUpDate) sheet.getRange(rowIndex, 11).setValue(followUpDate);
    } else {
      // PR: Status = col K (11), Follow Up = col L (12)
      if (status) sheet.getRange(rowIndex, 11).setValue(status);
      if (followUpDate) sheet.getRange(rowIndex, 12).setValue(followUpDate);
    }

    return { success: true, message: 'Updated successfully' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getAllPRs (admin cross-agent view) ────────────
function handleGetAllPRs(params) {
  try {
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var allPRs = [];

    for (var i = 1; i < usersData.length; i++) {
      var role = String(usersData[i][2]).trim().toLowerCase();
      if (role !== 'sales' && role !== 'admin') continue;

      var agentName = String(usersData[i][3]).trim();
      var prSheetId = String(usersData[i][5]).trim();
      if (!prSheetId || prSheetId === 'undefined') continue;

      try {
        var pSheet = SpreadsheetApp.openById(prSheetId).getSheets()[0];
        var pData = pSheet.getDataRange().getValues();
        for (var j = 1; j < pData.length; j++) {
          var prDate = parseSheetDate(pData[j][4]);
          if (!prDate) continue;
          var daysSince = Math.floor((today - prDate) / (1000 * 60 * 60 * 24));
          var status = String(pData[j][10] || '').trim() || 'Pending';
          var followUp = '';
          if (pData[j][11]) {
            var fDate = parseSheetDate(pData[j][11]);
            if (fDate) followUp = formatDate(fDate);
          }
          allPRs.push({
            agentName: agentName,
            clientName: String(pData[j][0]).trim(),
            contactPerson: String(pData[j][1]).trim(),
            prNumber: String(pData[j][3]).trim(),
            refNumber: String(pData[j][2]).trim(),
            dateSent: formatDate(prDate),
            daysSinceSent: daysSince,
            itemDescription: String(pData[j][5]).trim(),
            status: status,
            followUpDate: followUp,
            driveLink: String(pData[j][14] || '').trim(),
            sheetId: prSheetId,
            rowIndex: j + 1
          });
        }
      } catch (err) { /* skip inaccessible sheets */ }
    }

    allPRs.sort(function(a, b) { return a.daysSinceSent - b.daysSinceSent; });
    return { success: true, data: allPRs };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getPendingQuotations (admin/management approval view) ──
function handleGetPendingQuotations(params) {
  try {
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var pending = [];

    for (var i = 1; i < usersData.length; i++) {
      var role = String(usersData[i][2]).trim().toLowerCase();
      // Include admin-generated quotations so they appear on the approval page
      if (role !== 'sales' && role !== 'admin') continue;

      var agentName = String(usersData[i][3]).trim();
      var qSheetId = String(usersData[i][4]).trim();
      if (!qSheetId || qSheetId === 'undefined') continue;

      try {
        var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
        var qData = qSheet.getDataRange().getValues();
        for (var j = 1; j < qData.length; j++) {
          var overallStatus = String(qData[j][14] || '').trim();
          var finalizeStatus = String(qData[j][9] || '').trim(); // Col J
          // Skip rejected, and Approved+already-Finalized ones
          if (overallStatus === 'Rejected') continue;
          if (overallStatus === 'Approved' && finalizeStatus === 'Finalized') continue;

          var rowDate = parseSheetDate(qData[j][0]);
          pending.push({
            agentName: agentName,
            clientName: String(qData[j][5]).trim(),
            contactPerson: String(qData[j][6]).trim(),
            email: String(qData[j][7]).trim(),
            refNo: String(qData[j][2]).trim(),
            rfqNo: String(qData[j][3]).trim(),
            subject: String(qData[j][4]).trim(),
            amount: qData[j][8] || '',
            dateSent: rowDate ? formatDate(rowDate) : '',
            driveLink: String(qData[j][11] || '').trim(),
            adminApproval: String(qData[j][12] || '').trim() || 'Pending',
            managementApproval: String(qData[j][13] || '').trim() || 'Pending',
            overallStatus: overallStatus || 'Pending Approval',
            finalizeStatus: finalizeStatus,
            sheetId: qSheetId,
            rowIndex: j + 1
          });
        }
      } catch (err) { /* skip inaccessible sheets */ }
    }

    // Sort by date descending (newest first)
    pending.sort(function(a, b) {
      return new Date(b.dateSent) - new Date(a.dateSent);
    });

    return { success: true, data: pending };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: approveQuotation ──────────────────────────────
function handleApproveQuotation(params) {
  try {
    var sheetId = params.sheetId;
    var rowIndex = parseInt(params.rowIndex);
    var approverRole = (params.approverRole || '').toLowerCase();
    var decision = params.decision; // 'Approved' or 'Rejected'

    if (!sheetId || !rowIndex || !approverRole || !decision) {
      return { success: false, message: 'Missing required parameters' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];

    // Admin writes col M (13), Management writes col N (14)
    if (approverRole === 'admin') {
      sheet.getRange(rowIndex, 13).setValue(decision);
      if (decision === 'Rejected' && params.reason) {
        sheet.getRange(rowIndex, 17).setValue(params.reason); // col Q = Admin Rejection Reason
      }
    } else if (approverRole === 'management') {
      sheet.getRange(rowIndex, 14).setValue(decision);
      if (decision === 'Rejected' && params.reason) {
        sheet.getRange(rowIndex, 18).setValue(params.reason); // col R = Mgmt Rejection Reason
      }
    } else {
      return { success: false, message: 'Invalid approver role' };
    }

    // Recalculate Overall Status in col O (15)
    var adminVal = String(sheet.getRange(rowIndex, 13).getValue() || '').trim() || 'Pending';
    var mgmtVal = String(sheet.getRange(rowIndex, 14).getValue() || '').trim() || 'Pending';

    var overall = 'Pending Approval';
    if (adminVal === 'Rejected' || mgmtVal === 'Rejected') {
      overall = 'Rejected';
    } else if (adminVal === 'Approved' && mgmtVal === 'Approved') {
      overall = 'Approved';
    } else if (adminVal === 'Approved' || mgmtVal === 'Approved') {
      overall = 'Partially Approved';
    }
    sheet.getRange(rowIndex, 15).setValue(overall);

    // When fully approved by both, move PDF from Pending to agent's folder
    if (overall === 'Approved') {
      try {
        var driveLink = String(sheet.getRange(rowIndex, 12).getValue() || '').trim();
        var agentName = String(sheet.getRange(rowIndex, 2).getValue() || '').trim();
        if (driveLink && agentName) {
          _moveQuotationToApproved(driveLink, agentName);
        }
      } catch (moveErr) {
        Logger.log('Move file error: ' + moveErr.message);
        // Non-fatal — approval status is still recorded even if move fails
      }
    }

    // Notify sales agent on final approval/rejection
    if (overall === 'Approved' || overall === 'Rejected') {
      var agentName = String(sheet.getRange(rowIndex, 2).getValue()).trim();
      var refNo = String(sheet.getRange(rowIndex, 3).getValue()).trim();
      if (agentName) {
        _addNotification(agentName, 'quotation_' + overall.toLowerCase(),
          'Quotation ' + overall,
          'Quotation ' + refNo + ' ' + overall.toLowerCase() + (overall === 'Rejected' && params.reason ? ': ' + params.reason : ''), '');
      }
    }

    return { success: true, message: 'Quotation ' + decision.toLowerCase(), overallStatus: overall };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateQuotationDriveLink ──────────────────────
function handleUpdateQuotationDriveLink(params) {
  try {
    var sheetId = params.sheetId;
    var rowIndex = parseInt(params.rowIndex) || 0;
    var driveLink = params.driveLink || '';
    var creatorRole = (params.creatorRole || '').toLowerCase();
    var refNo = (params.refNo || '').trim();

    if (!sheetId) {
      return { success: false, message: 'Missing sheetId' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];

    // If rowIndex is 0 or missing, try to find the row by refNo (col C = index 2)
    if (!rowIndex || rowIndex < 2) {
      if (refNo) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][2]).trim() === refNo) {
            rowIndex = i + 1; // 1-based row index
            break;
          }
        }
      }
      // Final fallback: use the last row
      if (!rowIndex || rowIndex < 2) {
        rowIndex = sheet.getLastRow();
      }
    }

    // Col L (12) = Drive Link, M (13) = Admin Approval, N (14) = Mgmt Approval, O (15) = Overall
    sheet.getRange(rowIndex, 12).setValue(driveLink);
    if (!String(sheet.getRange(rowIndex, 13).getValue()).trim()) {
      // Admin-created quotations are auto-approved on the admin side; only mgmt approval is needed
      sheet.getRange(rowIndex, 13).setValue(creatorRole === 'admin' ? 'Approved' : 'Pending');
    }
    if (!String(sheet.getRange(rowIndex, 14).getValue()).trim()) {
      sheet.getRange(rowIndex, 14).setValue('Pending');
    }
    if (!String(sheet.getRange(rowIndex, 15).getValue()).trim()) {
      sheet.getRange(rowIndex, 15).setValue(creatorRole === 'admin' ? 'Partially Approved' : 'Pending Approval');
    }

    return { success: true, message: 'Drive link saved', rowIndex: rowIndex };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: reviseQuotation (agent resubmits rejected quotation) ──
function handleReviseQuotation(params) {
  try {
    var sheetId = params.sheetId;
    var rowIndex = parseInt(params.rowIndex);
    var driveLink = params.driveLink || '';
    var totalAmount = params.totalAmount || '';

    if (!sheetId || !rowIndex) {
      return { success: false, message: 'Missing sheetId or rowIndex' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];

    // Only allow revision of rejected quotations
    var currentOverall = String(sheet.getRange(rowIndex, 15).getValue()).trim();
    if (currentOverall !== 'Rejected') {
      return { success: false, message: 'Only rejected quotations can be revised. Current status: ' + currentOverall };
    }

    // Update summary columns if provided
    if (params.refNo) sheet.getRange(rowIndex, 3).setValue(params.refNo);
    if (params.rfqNo) sheet.getRange(rowIndex, 4).setValue(params.rfqNo);
    if (params.subject) sheet.getRange(rowIndex, 5).setValue(params.subject);
    if (params.clientName) sheet.getRange(rowIndex, 6).setValue(params.clientName);
    if (params.attention) sheet.getRange(rowIndex, 7).setValue(params.attention);
    if (params.clientEmail) sheet.getRange(rowIndex, 8).setValue(params.clientEmail);

    // Update total amount if changed
    if (totalAmount) {
      sheet.getRange(rowIndex, 9).setValue(totalAmount);
    }

    // Update drive link if a new PDF was uploaded
    if (driveLink) {
      sheet.getRange(rowIndex, 12).setValue(driveLink);
    }

    // Update quotation data JSON (column P = 16)
    if (params.quotationData) {
      sheet.getRange(rowIndex, 16).setValue(params.quotationData);
    }

    // Force-reset all approval columns
    // Admin-created quotations re-auto-approve the admin side on revision
    var creatorRole = (params.creatorRole || '').toLowerCase();
    sheet.getRange(rowIndex, 13).setValue(creatorRole === 'admin' ? 'Approved' : 'Pending'); // Admin Approval
    sheet.getRange(rowIndex, 14).setValue('Pending');                                         // Mgmt Approval
    sheet.getRange(rowIndex, 15).setValue(creatorRole === 'admin' ? 'Partially Approved' : 'Pending Approval'); // Overall

    return { success: true, message: 'Quotation revised and resubmitted for approval' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getMyRejectedQuotations (agent loads own rejected quotations) ──
function handleGetMyRejectedQuotations(params) {
  try {
    var sheetId = params.sheetId;
    if (!sheetId) {
      return { success: false, message: 'Missing sheetId' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, data: [] };
    }

    var data = sheet.getRange(2, 1, lastRow - 1, 16).getValues(); // A through P
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var overallStatus = String(data[i][14] || '').trim(); // col O (index 14)
      if (overallStatus !== 'Rejected') continue;

      var rowDate = data[i][0]; // col A
      var formattedDate = '';
      if (rowDate instanceof Date) {
        formattedDate = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        formattedDate = String(rowDate || '');
      }

      results.push({
        rowIndex: i + 2, // 1-based, skip header
        date: formattedDate,
        refNo: String(data[i][2] || ''),       // col C
        rfqNo: String(data[i][3] || ''),       // col D
        subject: String(data[i][4] || ''),     // col E
        clientName: String(data[i][5] || ''),  // col F
        amount: data[i][8] || '',              // col I
        driveLink: String(data[i][11] || ''),  // col L
        quotationData: String(data[i][15] || '') // col P
      });
    }

    return { success: true, data: results, sheetId: sheetId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getPendingItems (PRs needing pricing + quotations pending approval) ──
function handleGetPendingItems(params) {
  try {
    var role = (params.role || 'sales').toLowerCase();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var prs = [];
    var quotations = [];

    if (role === 'admin') {
      // Admin: iterate all sales users
      var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
      var usersData = usersSheet.getDataRange().getValues();

      for (var i = 1; i < usersData.length; i++) {
        var uRole = String(usersData[i][2]).trim().toLowerCase();
        if (uRole !== 'sales' && uRole !== 'admin') continue;
        var agentName = String(usersData[i][3]).trim();
        var prSheetId = String(usersData[i][5]).trim();
        var qSheetId = String(usersData[i][4]).trim();

        // PRs
        if (prSheetId && prSheetId !== 'undefined') {
          try {
            var pSheet = SpreadsheetApp.openById(prSheetId).getSheets()[0];
            var pData = pSheet.getDataRange().getValues();
            for (var j = 1; j < pData.length; j++) {
              var st = String(pData[j][10] || '').trim();
              if (st === 'Approved' || st === 'Rejected') continue;
              var prDate = parseSheetDate(pData[j][4]);
              prs.push({
                agentName: agentName,
                clientName: String(pData[j][0]).trim(),
                contactPerson: String(pData[j][1]).trim(),
                refNumber: String(pData[j][2]).trim(),
                prNumber: String(pData[j][3]).trim(),
                dateSent: prDate ? formatDate(prDate) : '',
                daysSinceSent: prDate ? Math.floor((today - prDate) / 86400000) : 0,
                itemDescription: String(pData[j][5]).trim(),
                modelPartNo: String(pData[j][6] || '').trim(),
                quantity: pData[j][7] || '',
                unit: String(pData[j][8] || '').trim(),
                remarks: String(pData[j][9] || '').trim(),
                status: st || 'Pending',
                unitPrice: pData[j][12] || '',
                totalPrice: pData[j][13] || '',
                sheetId: prSheetId,
                rowIndex: j + 1
              });
            }
          } catch (err) { /* skip */ }
        }

        // Quotations
        if (qSheetId && qSheetId !== 'undefined') {
          try {
            var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
            var qData = qSheet.getDataRange().getValues();
            for (var k = 1; k < qData.length; k++) {
              var ov = String(qData[k][14] || '').trim();
              if (ov === 'Approved' || ov === 'Rejected') continue;
              var qDate = parseSheetDate(qData[k][0]);
              quotations.push({
                agentName: agentName,
                clientName: String(qData[k][5]).trim(),
                refNo: String(qData[k][2]).trim(),
                rfqNo: String(qData[k][3]).trim(),
                subject: String(qData[k][4]).trim(),
                amount: qData[k][8] || '',
                dateSent: qDate ? formatDate(qDate) : '',
                driveLink: String(qData[k][11] || '').trim(),
                adminApproval: String(qData[k][12] || '').trim() || 'Pending',
                managementApproval: String(qData[k][13] || '').trim() || 'Pending',
                overallStatus: ov || 'Pending Approval',
                sheetId: qSheetId,
                rowIndex: k + 1
              });
            }
          } catch (err) { /* skip */ }
        }
      }
    } else {
      // Sales: single agent
      var prSheetId = (params.prSheetId || '').trim();
      var qSheetId = (params.quotationSheetId || '').trim();
      var agentName = (params.agentName || '').trim();

      if (prSheetId && prSheetId !== 'undefined') {
        try {
          var pSheet = SpreadsheetApp.openById(prSheetId).getSheets()[0];
          var pData = pSheet.getDataRange().getValues();
          for (var j = 1; j < pData.length; j++) {
            var st = String(pData[j][10] || '').trim();
            if (st === 'Approved' || st === 'Rejected') continue;
            var prDate = parseSheetDate(pData[j][4]);
            prs.push({
              agentName: agentName,
              clientName: String(pData[j][0]).trim(),
              contactPerson: String(pData[j][1]).trim(),
              refNumber: String(pData[j][2]).trim(),
              prNumber: String(pData[j][3]).trim(),
              dateSent: prDate ? formatDate(prDate) : '',
              daysSinceSent: prDate ? Math.floor((today - prDate) / 86400000) : 0,
              itemDescription: String(pData[j][5]).trim(),
              modelPartNo: String(pData[j][6] || '').trim(),
              quantity: pData[j][7] || '',
              unit: String(pData[j][8] || '').trim(),
              remarks: String(pData[j][9] || '').trim(),
              status: st || 'Pending',
              unitPrice: pData[j][12] || '',
              totalPrice: pData[j][13] || '',
              sheetId: prSheetId,
              rowIndex: j + 1
            });
          }
        } catch (err) { /* skip */ }
      }

      if (qSheetId && qSheetId !== 'undefined') {
        try {
          var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
          var qData = qSheet.getDataRange().getValues();
          for (var k = 1; k < qData.length; k++) {
            var ov = String(qData[k][14] || '').trim();
            if (ov === 'Approved' || ov === 'Rejected') continue;
            var qDate = parseSheetDate(qData[k][0]);
            quotations.push({
              agentName: agentName,
              clientName: String(qData[k][5]).trim(),
              refNo: String(qData[k][2]).trim(),
              rfqNo: String(qData[k][3]).trim(),
              subject: String(qData[k][4]).trim(),
              amount: qData[k][8] || '',
              dateSent: qDate ? formatDate(qDate) : '',
              driveLink: String(qData[k][11] || '').trim(),
              adminApproval: String(qData[k][12] || '').trim() || 'Pending',
              managementApproval: String(qData[k][13] || '').trim() || 'Pending',
              overallStatus: ov || 'Pending Approval',
              sheetId: qSheetId,
              rowIndex: k + 1
            });
          }
        } catch (err) { /* skip */ }
      }
    }

    // Enrich PRs with linked Supplier Quotation data.
    // We previously used `prNumber|itemDescription` as a single key and the
    // last SQ row won. That collapsed multiple SQs for the same PR (e.g. two
    // line items, or two competing supplier quotes) into one price, so two
    // distinct SQ rows in the sheet showed identical prices in the portal.
    // Fix: group SQs by PR number (preserving sheet order) and assign them
    // to PR rows — first by exact item-description match, then positionally
    // for any leftovers. Each SQ row is consumed once.
    try {
      var sqSheet = _supplierQuotationsSheet();
      var sqData = sqSheet.getDataRange().getValues();
      var sqByPR = {}; // prNumber → array of SQ records (newest first)
      // Iterate sheet rows in reverse so newest SQs (highest row index) sit
      // at the front of each bucket and win the first-match scan below.
      // Without this, creating/updating an SQ for a PR that already had an
      // earlier SQ row would leave the pending-items page showing the older
      // (stale) price, because the first matching row in sheet order won.
      for (var s = sqData.length - 1; s >= 1; s--) {
        var sqPR = String(sqData[s][13] || '').trim();
        if (!sqPR) continue;
        if (!sqByPR[sqPR]) sqByPR[sqPR] = [];
        sqByPR[sqPR].push({
          buyPrice: parseFloat(sqData[s][8]) || 0,
          supplierDesc: String(sqData[s][6] || '').trim(),
          supplierCompany: String(sqData[s][1] || '').trim(),
          currency: String(sqData[s][10] || 'PHP').trim(),
          driveFolderLink: String(sqData[s][16] || '').trim(),
          prItemDesc: String(sqData[s][14] || '').trim(),
          _used: false
        });
      }
      function _normDesc(v) { return String(v || '').trim().toLowerCase(); }
      // Pass 1 — exact description match (per PR group)
      for (var p1 = 0; p1 < prs.length; p1++) {
        var pr = prs[p1];
        var bucket = sqByPR[pr.prNumber];
        if (!bucket) continue;
        var prDesc = _normDesc(pr.itemDescription);
        if (!prDesc) continue;
        for (var b = 0; b < bucket.length; b++) {
          if (bucket[b]._used) continue;
          if (_normDesc(bucket[b].prItemDesc) === prDesc) {
            bucket[b]._used = true;
            pr.hasSQ = true;
            pr.sqBuyPrice = bucket[b].buyPrice;
            pr.sqSupplierDesc = bucket[b].supplierDesc;
            pr.sqSupplierCompany = bucket[b].supplierCompany;
            pr.sqCurrency = bucket[b].currency;
            pr.sqDriveFolderLink = bucket[b].driveFolderLink;
            break;
          }
        }
      }
      // Pass 2 — positional fallback for unmatched PR rows
      for (var p2 = 0; p2 < prs.length; p2++) {
        if (prs[p2].hasSQ) continue;
        var bucket2 = sqByPR[prs[p2].prNumber];
        if (!bucket2) continue;
        for (var b2 = 0; b2 < bucket2.length; b2++) {
          if (bucket2[b2]._used) continue;
          bucket2[b2]._used = true;
          prs[p2].hasSQ = true;
          prs[p2].sqBuyPrice = bucket2[b2].buyPrice;
          prs[p2].sqSupplierDesc = bucket2[b2].supplierDesc;
          prs[p2].sqSupplierCompany = bucket2[b2].supplierCompany;
          prs[p2].sqCurrency = bucket2[b2].currency;
          prs[p2].sqDriveFolderLink = bucket2[b2].driveFolderLink;
          break;
        }
      }
    } catch (sqErr) { /* SQ lookup failed — continue without enrichment */ }

    // Deduplicate PRs — use rowIndex + sheetId to identify true duplicates only.
    // Previous key (refNumber|prNumber|itemDescription) dropped legitimate items
    // when a PR had two rows with the same description (e.g. same item, different qty).
    var seen = {};
    prs = prs.filter(function(pr) {
      var key = pr.sheetId + '|' + pr.rowIndex;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    prs.sort(function(a, b) { return a.daysSinceSent - b.daysSinceSent; });
    return { success: true, data: { prs: prs, quotations: quotations } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updatePRPricing (admin sets unit price on a PR item) ──
function handleUpdatePRPricing(params) {
  try {
    var sheetId = params.sheetId;
    var rowIndex = parseInt(params.rowIndex);
    var unitPrice = parseFloat(params.unitPrice);

    if (!sheetId || !rowIndex || isNaN(unitPrice)) {
      return { success: false, message: 'Missing sheetId, rowIndex, or unitPrice' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    // Write unit price to col M (13)
    sheet.getRange(rowIndex, 13).setValue(unitPrice);
    // Read quantity from col H (8)
    var qty = parseFloat(sheet.getRange(rowIndex, 8).getValue()) || 0;
    var totalPrice = qty * unitPrice;
    // Write total price to col N (14)
    sheet.getRange(rowIndex, 14).setValue(totalPrice);

    return { success: true, totalPrice: totalPrice };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getQuotationApprovalStatus ─────────────────────
function handleGetQuotationApprovalStatus(params) {
  try {
    var sheetId = params.sheetId || '';
    var rowIndex = parseInt(params.rowIndex);
    if (!sheetId || !rowIndex) {
      return { success: false, message: 'sheetId and rowIndex are required.' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var row = sheet.getRange(rowIndex, 1, 1, 16).getValues()[0];

    return {
      success: true,
      adminApproval: String(row[12] || '').trim(),
      mgmtApproval: String(row[13] || '').trim(),
      overallStatus: String(row[14] || '').trim()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: finalizeQuotation ──────────────────────────────
function handleFinalizeQuotation(params) {
  try {
    var sheetId = params.sheetId || '';
    var rowIndex = parseInt(params.rowIndex);
    if (!sheetId || !rowIndex) {
      return { success: false, message: 'sheetId and rowIndex are required.' };
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var row = sheet.getRange(rowIndex, 1, 1, 16).getValues()[0];
    var overallStatus = String(row[14] || '').trim();

    if (overallStatus !== 'Approved') {
      return { success: false, message: 'Cannot finalize — quotation is not approved (current status: ' + overallStatus + ').' };
    }

    // Write "Finalized" to Status col J (1-based col 10)
    sheet.getRange(rowIndex, 10).setValue('Finalized');
    return { success: true, message: 'Quotation finalized successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getQuotationSummary ────────────────────────────
// Aggregates from all agent quotation sheets + optional static summary sheet.
function handleGetQuotationSummary(params) {
  try {
    var agentFilter = (params.agentName || '').trim().toLowerCase();
    var results = [];
    var tz = Session.getScriptTimeZone();

    // ── 1. Pull from every agent's individual quotation sheet ──
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();

    for (var i = 1; i < usersData.length; i++) {
      var role = String(usersData[i][2]).trim().toLowerCase();
      if (role !== 'sales' && role !== 'admin') continue;

      var agentName = String(usersData[i][3]).trim();
      if (agentFilter && agentName.toLowerCase() !== agentFilter) continue;

      var qSheetId = String(usersData[i][4]).trim();
      if (!qSheetId || qSheetId === 'undefined') continue;

      try {
        var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
        var qData = qSheet.getDataRange().getValues();

        for (var j = 1; j < qData.length; j++) {
          var row = qData[j];
          var clientName = String(row[5] || '').trim();
          if (!clientName) continue;

          var dateSent = parseSheetDate(row[0]);
          var month = dateSent
            ? Utilities.formatDate(dateSent, tz, 'yyyy-MM')
            : '';
          var dateSentFmt = dateSent
            ? Utilities.formatDate(dateSent, tz, 'yyyy-MM-dd')
            : '';

          results.push({
            month:       month,
            dueDate:     dateSentFmt,
            agentName:   agentName,
            companyName: clientName,
            prNo:        String(row[2] || '').trim(),
            quotationNo: String(row[3] || '').trim(),
            product:     '',
            description: String(row[4] || '').trim(),
            amount:      row[8] || '',
            total:       row[8] || '',
            poNo:        '',
            poAmount:    '',
            remarks:     String(row[14] || '').trim(),
            rowIndex:    j + 1
          });
        }
      } catch (err) { /* skip inaccessible sheets */ }
    }

    // ── 2. Also include rows from the static summary sheet (manual entries) ──
    if (QUOTATION_SUMMARY_SHEET_ID) {
      try {
        var sumSheet = SpreadsheetApp.openById(QUOTATION_SUMMARY_SHEET_ID).getSheets()[0];
        var sumData = sumSheet.getDataRange().getValues();

        for (var s = 1; s < sumData.length; s++) {
          var sAgent = String(sumData[s][2] || '').trim();
          if (agentFilter && sAgent.toLowerCase() !== agentFilter) continue;

          var sDue = sumData[s][1];
          var sDueFmt = '';
          if (sDue instanceof Date) {
            sDueFmt = Utilities.formatDate(sDue, tz, 'yyyy-MM-dd');
          } else {
            sDueFmt = String(sDue || '');
          }

          results.push({
            month:       String(sumData[s][0] || ''),
            dueDate:     sDueFmt,
            agentName:   sAgent,
            companyName: String(sumData[s][3] || '').trim(),
            prNo:        String(sumData[s][4] || '').trim(),
            quotationNo: String(sumData[s][5] || '').trim(),
            product:     String(sumData[s][6] || '').trim(),
            description: String(sumData[s][7] || '').trim(),
            amount:      sumData[s][8] || '',
            total:       sumData[s][9] || '',
            poNo:        String(sumData[s][10] || '').trim(),
            poAmount:    sumData[s][11] || '',
            remarks:     String(sumData[s][12] || '').trim(),
            rowIndex:    s + 1
          });
        }
      } catch (err) { /* skip if sheet inaccessible */ }
    }

    // Sort newest first by month descending
    results.sort(function(a, b) {
      return b.month.localeCompare(a.month);
    });

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: submitAdminDailyReport ─────────────────────────
function handleSubmitAdminDailyReport(params) {
  try {
    var adminName = params.adminName || '';
    if (!adminName) {
      return { success: false, message: 'Admin name is required.' };
    }

    var poStatus = params.poStatus || '[]';
    var internationalShipment = params.internationalShipment || '[]';
    var localShipment = params.localShipment || '[]';
    var deliveryForClient = params.deliveryForClient || '[]';
    var pendingInquiry = params.pendingInquiry || '[]';
    var receivedQuotation = params.receivedQuotation || '[]';
    var otherTasks = params.otherTasks || '[]';
    var snapshotData = params.snapshotData || '';
    var notes = params.notes || '';

    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var sheet = ss.getSheetByName('Admin Daily Reports');

    if (!sheet) {
      sheet = ss.insertSheet('Admin Daily Reports');
      sheet.appendRow([
        'Date', 'Admin Name', 'PO Status', 'International Shipment', 'Local Shipment',
        'Delivery for Client', 'Pending Inquiry', 'Received Quotation', 'Other Tasks', 'Submitted At',
        'Snapshot Data', 'Notes'
      ]);
    } else {
      // Ensure new columns exist (idempotent migration)
      var headerRow = sheet.getRange(1, 1, 1, Math.max(12, sheet.getLastColumn())).getValues()[0];
      if (sheet.getLastColumn() < 11) sheet.getRange(1, 11).setValue('Snapshot Data');
      if (sheet.getLastColumn() < 12) sheet.getRange(1, 12).setValue('Notes');
    }

    // Duplicate check
    var todayStr = formatDate(new Date());
    var rData = sheet.getDataRange().getValues();
    for (var i = 1; i < rData.length; i++) {
      var parsedDate = parseSheetDate(rData[i][0]);
      var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();
      var rowAdmin = String(rData[i][1]).trim();
      if (rowDate === todayStr && rowAdmin.toLowerCase() === adminName.toLowerCase()) {
        return { success: false, message: 'You have already submitted a report for today.' };
      }
    }

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([
      todayStr, adminName, poStatus, internationalShipment, localShipment,
      deliveryForClient, pendingInquiry, receivedQuotation, otherTasks, now,
      snapshotData, notes
    ]);

    return { success: true, message: 'Admin daily report submitted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getAdminDailyReports ───────────────────────────
function handleGetAdminDailyReports(params) {
  try {
    var filterAdmin = params.adminName || '';
    var filterDate = params.date || '';

    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var sheet = ss.getSheetByName('Admin Daily Reports');

    // Build reports map from submitted data
    var reports = {};
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var parsedDate = parseSheetDate(data[i][0]);
        var rowDate = parsedDate ? formatDate(parsedDate) : String(data[i][0]).trim();
        var rowAdmin = String(data[i][1]).trim();

        if (filterAdmin && rowAdmin.toLowerCase() !== filterAdmin.toLowerCase()) continue;
        if (filterDate && rowDate !== filterDate) continue;

        reports[rowAdmin.toLowerCase()] = {
          date: rowDate,
          adminName: rowAdmin,
          submitted: true,
          poStatus: String(data[i][2] || '[]'),
          internationalShipment: String(data[i][3] || '[]'),
          localShipment: String(data[i][4] || '[]'),
          deliveryForClient: String(data[i][5] || '[]'),
          pendingInquiry: String(data[i][6] || '[]'),
          receivedQuotation: String(data[i][7] || '[]'),
          otherTasks: String(data[i][8] || '[]'),
          submittedAt: String(data[i][9] || ''),
          snapshotData: String(data[i][10] || ''),
          notes: String(data[i][11] || '')
        };
      }
    }

    // When called without adminName filter (from getAllDailyReports),
    // build a full list of all admin users with submitted/not-submitted status
    if (!filterAdmin) {
      var usersSheet = ss.getSheets()[0];
      var usersData = usersSheet.getDataRange().getValues();
      var results = [];
      for (var j = 1; j < usersData.length; j++) {
        var role = String(usersData[j][2]).trim().toLowerCase();
        if (role !== 'admin') continue;
        var fullName = String(usersData[j][3]).trim();
        var key = fullName.toLowerCase();
        if (reports[key]) {
          results.push(reports[key]);
        } else {
          results.push({ adminName: fullName, submitted: false });
        }
      }
      return { success: true, data: results };
    }

    // When called with adminName filter (from admin dashboard), return matched reports
    var results = [];
    for (var k in reports) {
      results.push(reports[k]);
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── doPost: Mutations + PDF upload ─────────────────────────
function doPost(e) {
  var result;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || '';

    // Session validation (skip for login)
    if (action !== 'login' && action !== 'validateSession' && action !== '') {
      var token = body.token || '';
      if (token) {
        var session = validateSession(token);
        if (!session) {
          return ContentService.createTextOutput(
            JSON.stringify({ success: false, message: 'Session expired or invalid. Please log in again.', authError: true })
          ).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }

    switch (action) {
      // Auth
      case 'login':
        result = handleLogin(body.user, body.pass);
        break;
      case 'logout':
        result = handleLogout(body);
        break;

      // Reports
      case 'submitDailyReport':
        result = handleSubmitDailyReport(body);
        break;
      case 'submitAdminDailyReport':
        result = handleSubmitAdminDailyReport(body);
        break;
      case 'submitAccountingDailyReport':
        result = handleSubmitAccountingDailyReport(body);
        break;
      case 'markNotificationsRead':
        result = handleMarkNotificationsRead(body);
        break;
      case 'updateTrackerRow':
        result = handleUpdateTrackerRow(body);
        break;

      // Auth/Settings
      case 'changePassword':
        result = handleChangePassword(body);
        break;
      case 'setTargets':
        result = handleSetTargets(body);
        break;

      // Accounting
      case 'addOrder':
        result = handleAddOrder(body);
        break;
      case 'updateOrder':
        result = handleUpdateOrder(body);
        break;
      case 'deleteOrder':
        result = handleDeleteOrder(body);
        break;
      case 'addExpense':
        result = handleAddExpense(body);
        break;
      case 'deleteExpense':
        result = handleDeleteExpense(body);
        break;
      case 'updateExpense':
        result = handleUpdateExpense(body);
        break;

      // Supplier Quotations
      case 'addSupplierQuotation':
        result = handleAddSupplierQuotation(body);
        break;
      case 'updateSupplierQuotation':
        result = handleUpdateSupplierQuotation(body);
        break;
      case 'deleteSupplierQuotation':
        result = handleDeleteSupplierQuotation(body);
        break;
      case 'uploadSQDocuments':
        result = handleUploadSQDocuments(body);
        break;
      case 'updateSQDriveLink':
        result = handleUpdateSQDriveLink(body);
        break;

      // Clients
      case 'addClient':
        result = handleAddClient(body);
        break;
      case 'updateClient':
        result = handleUpdateClient(body);
        break;
      case 'deleteClient':
        result = handleDeleteClient(body);
        break;

      // Users
      case 'addUser':
        result = handleAddUser(body);
        break;
      case 'updateUser':
        result = handleUpdateUser(body);
        break;
      case 'deleteUser':
        result = handleDeleteUser(body);
        break;
      case 'resetUserPassword':
        result = handleResetUserPassword(body);
        break;

      // Payment Requests
      case 'addPaymentRequest':
        result = handleAddPaymentRequest(body);
        break;
      case 'updatePaymentRequestStatus':
        result = handleUpdatePaymentRequestStatus(body);
        break;
      case 'markBillPaid':
        result = handleMarkBillPaid(body);
        break;
      case 'saveCashVoucher':
        result = handleSaveCashVoucher(body);
        break;
      // Inventory
      case 'addInventoryItem':
        result = handleAddInventoryItem(body);
        break;
      case 'updateInventoryItem':
        result = handleUpdateInventoryItem(body);
        break;
      case 'deleteInventoryItem':
        result = handleDeleteInventoryItem(body);
        break;

      // Collections
      case 'addCollection':
        result = handleAddCollection(body);
        break;
      case 'deleteCollection':
        result = handleDeleteCollection(body);
        break;
      case 'updateCollection':
        result = handleUpdateCollection(body);
        break;

      // Quotations
      case 'approveQuotation':
        result = handleApproveQuotation(body);
        break;
      case 'updateQuotationDriveLink':
        result = handleUpdateQuotationDriveLink(body);
        break;
      case 'reviseQuotation':
        result = handleReviseQuotation(body);
        break;
      case 'finalizeQuotation':
        result = handleFinalizeQuotation(body);
        break;
      case 'getQuotationApprovalStatus':
        result = handleGetQuotationApprovalStatus(body);
        break;

      // PRs
      case 'updatePRPricing':
        result = handleUpdatePRPricing(body);
        break;
      case 'savePRPDF':
        result = handleSavePRPDF(body);
        break;
      case 'savePRToSheet':
        result = handleSavePRToSheet(body);
        break;
      case 'savePaymentRequestPDF':
        result = handleSavePaymentRequestPDF(body);
        break;
      case 'savePaymentRequestAttachment':
        result = handleSavePaymentRequestAttachment(body);
        break;
      case 'saveMROPDF':
        result = handleSaveMROPDF(body);
        break;
      case 'saveMIPDF':
        result = handleSaveMIPDF(body);
        break;

      // Sales Orders
      case 'createSalesOrder':
        result = handleCreateSalesOrder(body);
        break;
      case 'updateSOStatus':
        result = handleUpdateSOStatus(body);
        break;
      case 'updateSalesOrder':
        result = handleUpdateSalesOrder(body);
        break;
      case 'deleteSalesOrder':
        result = handleDeleteSalesOrder(body);
        break;
      case 'uploadSODocument':
        result = handleUploadSODocument(body);
        break;

      // POs
      case 'savePORecord':
        result = handleSavePORecord(body);
        break;
      case 'savePOPDF':
        result = handleSavePOPDF(body);
        break;
      case 'approvePO':
        result = handleApprovePO(body);
        break;
      case 'sendPOEmail':
        result = handleSendPOEmail(body);
        break;
      case 'sendAdminEmail':
        result = handleSendAdminEmail(body);
        break;
      case 'sendAcctEmail':
        result = handleSendAcctEmail(body);
        break;

      // Pricing
      case 'savePricingSubmission':
        result = handleSavePricingSubmission(body);
        break;
      case 'getPriceHistory':
        result = handleGetPriceHistory(body);
        break;
      case 'getShipments':
        result = handleGetShipments(body);
        break;
      case 'saveShipment':
        result = handleSaveShipment(body);
        break;
      case 'uploadShipmentDoc':
        result = handleUploadShipmentDoc(body);
        break;
      case 'deleteShipmentDoc':
        result = handleDeleteShipmentDoc(body);
        break;
      case 'forwardPRToPricing':
        result = handleForwardPRToPricing(body);
        break;
      case 'applyPricingToPR':
        result = handleApplyPricingToPR(body);
        break;
      case 'markSentToSales':
        result = handleMarkSentToSales(body);
        break;

      // PDF Upload (existing)
      case 'saveQuotationPDF':
        result = handleSaveQuotationPDF(body);
        break;

      case 'saveDailyReportPDF':
        result = handleSaveDailyReportPDF(body);
        break;

      // Profit Report
      case 'saveProfitReport':
        result = handleSaveProfitReport(body);
        break;

      case 'updateProfitReportEntry':
        result = handleUpdateProfitReportEntry(body);
        break;

      case 'submitHRDailyReport':
        result = handleSubmitHRDailyReport(body);
        break;
      case 'addCandidate':
        result = handleAddCandidate(body);
        break;
      case 'updateCandidate':
        result = handleUpdateCandidate(body);
        break;
      case 'deleteCandidate':
        result = handleDeleteCandidate(body);
        break;
      case 'addHRTask':
        result = handleAddHRTask(body);
        break;
      case 'updateHRTask':
        result = handleUpdateHRTask(body);
        break;
      case 'deleteHRTask':
        result = handleDeleteHRTask(body);
        break;
      case 'addEmployee':
        result = handleAddEmployee(body);
        break;
      case 'updateEmployee':
        result = handleUpdateEmployee(body);
        break;
      case 'deleteEmployee':
        result = handleDeleteEmployee(body);
        break;

      // Leave & Attendance
      case 'addLeaveRequest':
        result = handleAddLeaveRequest(body);
        break;
      case 'updateLeaveRequest':
        result = handleUpdateLeaveRequest(body);
        break;
      case 'deleteLeaveRequest':
        result = handleDeleteLeaveRequest(body);
        break;

      // Performance Reviews
      case 'addPerformanceReview':
        result = handleAddPerformanceReview(body);
        break;
      case 'updatePerformanceReview':
        result = handleUpdatePerformanceReview(body);
        break;
      case 'deletePerformanceReview':
        result = handleDeletePerformanceReview(body);
        break;

      // Training
      case 'addTrainingProgram':
        result = handleAddTrainingProgram(body);
        break;
      case 'updateTrainingProgram':
        result = handleUpdateTrainingProgram(body);
        break;
      case 'deleteTrainingProgram':
        result = handleDeleteTrainingProgram(body);
        break;

      // Memos
      case 'addMemo':
        result = handleAddMemo(body);
        break;
      case 'updateMemo':
        result = handleUpdateMemo(body);
        break;
      case 'deleteMemo':
        result = handleDeleteMemo(body);
        break;

      // Grievances
      case 'addGrievance':
        result = handleAddGrievance(body);
        break;
      case 'updateGrievance':
        result = handleUpdateGrievance(body);
        break;
      case 'deleteGrievance':
        result = handleDeleteGrievance(body);
        break;

      // Marketing Campaigns
      case 'addCampaign':
        result = handleAddCampaign(body);
        break;
      case 'updateCampaign':
        result = handleUpdateCampaign(body);
        break;
      case 'deleteCampaign':
        result = handleDeleteCampaign(body);
        break;

      // Content Calendar
      case 'addContentItem':
        result = handleAddContentItem(body);
        break;
      case 'updateContentItem':
        result = handleUpdateContentItem(body);
        break;
      case 'deleteContentItem':
        result = handleDeleteContentItem(body);
        break;

      // Accreditations
      case 'addAccreditation':
        result = handleAddAccreditation(body);
        break;
      case 'updateAccreditation':
        result = handleUpdateAccreditation(body);
        break;
      case 'deleteAccreditation':
        result = handleDeleteAccreditation(body);
        break;

      // Payroll
      case 'savePayrollEmployee':
        result = handleSavePayrollEmployee(body);
        break;
      case 'deletePayrollEmployee':
        result = handleDeletePayrollEmployee(body);
        break;
      case 'savePayrollHours':
        result = handleSavePayrollHours(body);
        break;
      case 'savePayrollRegister':
        result = handleSavePayrollRegister(body);
        break;
      case 'submitPayrollForApproval':
        result = handleSubmitPayrollForApproval(body);
        break;
      case 'decidePayrollApproval':
        result = handleDecidePayrollApproval(body);
        break;
      case 'saveBankAccount':
        result = handleSaveBankAccount(body);
        break;
      case 'addBankTransaction':
        result = handleAddBankTransaction(body);
        break;
      case 'deleteBankTransaction':
        result = handleDeleteBankTransaction(body);
        break;
      case 'saveDirectorPayable':
        result = handleSaveDirectorPayable(body);
        break;
      case 'markDirectorPayablePaid':
        result = handleMarkDirectorPayablePaid(body);
        break;
      case 'unmarkDirectorPayablePaid':
        result = handleUnmarkDirectorPayablePaid(body);
        break;
      case 'deleteDirectorPayable':
        result = handleDeleteDirectorPayable(body);
        break;

      case 'advanceShipmentStage':
        result = handleAdvanceShipmentStage(body);
        break;

      case 'restoreShipmentDoc':
        result = handleRestoreShipmentDoc(body);
        break;
      case 'migrateShipmentDocs':
        result = handleMigrateShipmentDocs(body);
        break;
      case 'exportAuditLogCsv':
        result = handleExportAuditLogCsv(body);
        break;
      case 'backfillHistory':
        result = handleBackfillHistory(body);
        break;
      case 'archiveHistoryNow':
        archiveOldHistoryEvents();
        result = { success: true, message: 'Archival job triggered.' };
        break;

      case 'validateSession':
        result = handleValidateSession(body);
        break;
      case 'setEmailCredentials':
        result = handleSetEmailCredentials(body);
        break;
      case 'getEmailCredentialsForBackend':
        result = handleGetEmailCredentialsForBackend(body);
        break;

      default:
        result = { success: false, message: 'Unknown POST action: ' + action };
    }
  } catch (err) {
    result = { success: false, message: 'POST error: ' + err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── ACTION: getNextQuotationNumber (atomic counter) ────────
function handleGetNextQuotationNumber(params) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var currentYear = new Date().getFullYear();
    var counterSheet = ss.getSheetByName('Counters');
    if (!counterSheet) {
      counterSheet = ss.insertSheet('Counters');
      counterSheet.appendRow(['Year', 'QuotationCount']);
      counterSheet.appendRow([currentYear, 182]);
    }
    var data = counterSheet.getDataRange().getValues();
    var storedYear = parseInt(data[1][0]) || 0;
    var count = parseInt(data[1][1]) || 0;

    if (storedYear !== currentYear) {
      count = 1;
      counterSheet.getRange(2, 1).setValue(currentYear);
    } else {
      count = count + 1;
    }
    counterSheet.getRange(2, 2).setValue(count);

    return { success: true, year: currentYear, count: count };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ─── Save Daily Report PDF to Google Drive ─────────────────
function handleSaveDailyReportPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'daily-report.pdf';
    var agentName = body.agentName || '';
    var reportDate = body.reportDate || '';

    if (!base64Data) return { success: false, message: 'No PDF data provided' };
    if (!agentName || !reportDate) return { success: false, message: 'agentName and reportDate required' };

    var rootFolder = _getOrCreateDailyReportsFolder();
    var agentFolder = _getOrCreateSubFolder(rootFolder, agentName);

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = agentFolder.createFile(blob);
    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/preview';

    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSaveDailyReportPDF: setAccess failed: ' + accessErr.message);
    }

    // Write link back to row (column O = index 15)
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var sheet = ss.getSheetByName('Daily Reports');
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var parsed = parseSheetDate(data[i][0]);
        var rowDate = parsed ? formatDate(parsed) : String(data[i][0]).trim();
        var rowAgent = String(data[i][1]).trim().toLowerCase();
        if (rowDate === reportDate && rowAgent === agentName.toLowerCase()) {
          sheet.getRange(i + 1, 15).setValue(driveLink);
          break;
        }
      }
    }

    return { success: true, driveLink: driveLink, fileId: file.getId() };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function _getOrCreateDailyReportsFolder() {
  var folders = DriveApp.getFoldersByName('Daily Reports');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('Daily Reports');
}

// ─── Save Quotation PDF to Google Drive ────────────────────
function handleSaveQuotationPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'quotation.pdf';

    if (!base64Data) {
      return { success: false, message: 'No PDF data provided' };
    }

    // All new submissions go into Quotations/Pending/ until approved
    var rootFolder = _getOrCreateQuotationsFolder();
    var pendingFolder = _getOrCreateSubFolder(rootFolder, 'Pending');

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = pendingFolder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    // setAccess may fail due to domain/org policy — log but don't block the link
    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSaveQuotationPDF: setAccess failed (file still saved): ' + accessErr.message);
    }

    return {
      success: true,
      driveLink: driveLink,
      fileId: file.getId()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Move an approved PDF from Pending to the agent's own folder
function _moveQuotationToApproved(driveLink, agentName) {
  // Extract file ID from URL: .../file/d/FILE_ID/... or ?id=FILE_ID
  var fileId = '';
  var match = driveLink.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    fileId = match[1];
  } else {
    match = driveLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
  }
  if (!fileId) return;

  var file = DriveApp.getFileById(fileId);
  var rootFolder = _getOrCreateQuotationsFolder();
  var pendingFolder = _getOrCreateSubFolder(rootFolder, 'Pending');
  var userFolder = _getOrCreateSubFolder(rootFolder, agentName);

  userFolder.addFile(file);
  pendingFolder.removeFile(file);
}

function _getOrCreateQuotationsFolder() {
  var folders = DriveApp.getFoldersByName('Quotations');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('Quotations');
}

function _getOrCreateSubFolder(parent, name) {
  var subs = parent.getFoldersByName(name);
  return subs.hasNext() ? subs.next() : parent.createFolder(name);
}

// ─── Sales Order Drive Folder Helper ────────────────────────
// Returns (creating if needed): Sales Order root / Customer Name / SO No
function _getSODocFolder(customerName, soNo) {
  var root = DriveApp.getFolderById(SO_DRIVE_FOLDER_ID);
  var customerFolder = _getOrCreateSubFolder(root, customerName);
  return _getOrCreateSubFolder(customerFolder, soNo);
}

// ─── Supplier Quotation Drive Functions ─────────────────────

function _getOrCreateSQFolder() {
  // Use the dedicated Supplier Quotations folder
  return DriveApp.getFolderById('1BErT7gQCwOgDSq6mt4PPdEeQQtJ-PWCI');
}

function handleUploadSQDocuments(body) {
  try {
    var prNumber = body.prNumber || 'Unknown-PR';
    var supplierCompany = body.supplierCompany || 'Unknown-Supplier';
    var itemDescriptions = body.itemDescriptions || '';
    var files = body.files; // array of {name, base64, mimeType}

    if (!files || !files.length) {
      return { success: false, message: 'No files provided.' };
    }

    // Build folder path: Supplier Quotations / {PR Number} / {Supplier - Items}
    var rootFolder = _getOrCreateSQFolder();
    var prFolder = _getOrCreateSubFolder(rootFolder, prNumber);
    // Truncate subfolder name to avoid Drive limits
    var subName = supplierCompany + ' - ' + (itemDescriptions.length > 60 ? itemDescriptions.substring(0, 60) + '...' : itemDescriptions);
    subName = subName.replace(/[\/\\:*?"<>|]/g, '_'); // sanitize
    var supplierFolder = _getOrCreateSubFolder(prFolder, subName);

    var uploaded = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var decoded = Utilities.base64Decode(f.base64);
      var blob = Utilities.newBlob(decoded, f.mimeType || 'application/pdf', f.name || 'document');
      var file = supplierFolder.createFile(blob);
      try {
        file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (accessErr) {
        Logger.log('handleUploadSQDocuments: file setAccess failed: ' + accessErr.message);
      }
      uploaded.push({ name: f.name, url: file.getUrl() });
    }

    // Set folder sharing too so management can browse
    try {
      supplierFolder.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleUploadSQDocuments: folder setAccess failed: ' + accessErr.message);
    }

    return {
      success: true,
      folderUrl: supplierFolder.getUrl(),
      files: uploaded
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleListSQFolderFiles(params) {
  try {
    var folderUrl = params.folderUrl || '';
    var match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (!match) return { success: false, message: 'Invalid folder URL.' };
    var folderId = match[1];
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFiles();
    var result = [];
    while (files.hasNext()) {
      var f = files.next();
      result.push({
        name: f.getName(),
        id: f.getId(),
        mimeType: f.getMimeType(),
        url: f.getUrl()
      });
    }
    return { success: true, files: result, folderName: folder.getName() };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateSQDriveLink(body) {
  try {
    var rowIndices = body.rowIndices;
    // rowIndices may arrive as a JSON string from the client
    if (typeof rowIndices === 'string') {
      try { rowIndices = JSON.parse(rowIndices); } catch (_) {}
    }
    var driveFolderLink = body.driveFolderLink || '';
    if (!rowIndices || !rowIndices.length) return { success: false, message: 'No rows specified.' };

    var sheet = _supplierQuotationsSheet();
    for (var i = 0; i < rowIndices.length; i++) {
      var row = parseInt(rowIndices[i]);
      if (row >= 2) {
        sheet.getRange(row, 17).setValue(driveFolderLink); // col Q
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── PO Drive Functions ─────────────────────────────────────

function _getOrCreatePOFolder() {
  try {
    return DriveApp.getFolderById('1Q5O1zXrpX-51h4RLHiYZPbfcZFsaw1F3');
  } catch (e) {
    Logger.log('_getOrCreatePOFolder: folder by ID failed, falling back to name: ' + e.message);
    var folders = DriveApp.getFoldersByName('Purchase Orders');
    if (folders.hasNext()) return folders.next();
    return DriveApp.createFolder('Purchase Orders');
  }
}

function handleSavePOPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'po.pdf';

    if (!base64Data) {
      return { success: false, message: 'No PDF data provided' };
    }

    var rootFolder = _getOrCreatePOFolder();
    var pendingFolder = _getOrCreateSubFolder(rootFolder, 'Pending');

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = pendingFolder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    // setAccess may fail due to domain/org policy — log but don't block the link
    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSavePOPDF: setAccess failed (file still saved): ' + accessErr.message);
    }

    return {
      success: true,
      driveLink: driveLink,
      fileId: file.getId()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function _movePOToApproved(driveLink, creatorName) {
  var fileId = '';
  var match = driveLink.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    fileId = match[1];
  } else {
    match = driveLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
  }
  if (!fileId) return;

  var file = DriveApp.getFileById(fileId);
  var rootFolder = _getOrCreatePOFolder();
  var pendingFolder = _getOrCreateSubFolder(rootFolder, 'Pending');
  var approvedFolder = _getOrCreateSubFolder(rootFolder, 'Approved');

  approvedFolder.addFile(file);
  pendingFolder.removeFile(file);
}

// ═══════════════════════════════════════════════════════════════
// PURCHASE REQUEST Google Drive helpers
// ═══════════════════════════════════════════════════════════════

function _getOrCreatePRFolder() {
  var folders = DriveApp.getFoldersByName('Purchase Request');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('Purchase Request');
}

function handleSavePRPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'pr.pdf';
    var agentName = body.creatorName || 'Unknown';

    if (!base64Data) {
      return { success: false, message: 'No PDF data provided' };
    }

    var rootFolder = _getOrCreatePRFolder();
    var agentFolder = _getOrCreateSubFolder(rootFolder, agentName);

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = agentFolder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSavePRPDF: setAccess failed (file still saved): ' + accessErr.message);
    }

    return {
      success: true,
      driveLink: driveLink,
      fileId: file.getId()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Payment Request Drive Functions ──────────────────────

function _getOrCreatePaymentRequestsFolder() {
  try {
    return DriveApp.getFolderById('1KxxhhzDGslVOd8avPfrgK0OvipfrAl6J');
  } catch (e) {
    Logger.log('_getOrCreatePaymentRequestsFolder: folder by ID failed, falling back to name: ' + e.message);
    var folders = DriveApp.getFoldersByName('Payment Requests');
    if (folders.hasNext()) return folders.next();
    return DriveApp.createFolder('Payment Requests');
  }
}

function handleSavePaymentRequestPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'payment_request.pdf';
    var creatorName = body.creatorName || 'Unknown';

    if (!base64Data) {
      return { success: false, message: 'No PDF data provided' };
    }

    // Save into requester subfolder inside the Payment Requests folder
    var rootFolder = _getOrCreatePaymentRequestsFolder();
    var folder = _getOrCreateSubFolder(rootFolder, creatorName);

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = folder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSavePaymentRequestPDF: setAccess failed (file still saved): ' + accessErr.message);
    }

    return {
      success: true,
      driveLink: driveLink,
      fileId: file.getId()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleSavePaymentRequestAttachment(body) {
  try {
    var base64Data = body.fileBase64;
    var fileName = body.fileName || 'attachment';
    var mimeType = body.mimeType || 'application/octet-stream';
    var prNumber = body.prNumber || 'Unknown';
    var creatorName = body.creatorName || '';

    if (!base64Data) {
      return { success: false, message: 'No file data provided' };
    }

    var rootFolder = _getOrCreatePaymentRequestsFolder();
    // Use requester subfolder (same folder as the PDF) if creatorName is provided;
    // fall back to a PR-number folder for legacy calls without creatorName.
    var subFolder = creatorName
      ? _getOrCreateSubFolder(rootFolder, creatorName)
      : _getOrCreateSubFolder(rootFolder, 'Attachments - ' + prNumber);

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, mimeType, fileName);
    var file = subFolder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSavePaymentRequestAttachment: setAccess failed: ' + accessErr.message);
    }

    return { success: true, driveLink: driveLink, fileId: file.getId() };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── MRO Drive Functions ──────────────────────────────────

function _getOrCreateMROFolder() {
  var folders = DriveApp.getFoldersByName('Materials Receiving');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('Materials Receiving');
}

function handleSaveMROPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'mro.pdf';
    var creatorName = body.creatorName || 'Unknown';

    if (!base64Data) {
      return { success: false, message: 'No PDF data provided' };
    }

    var rootFolder = _getOrCreateMROFolder();
    var creatorFolder = _getOrCreateSubFolder(rootFolder, creatorName);

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = creatorFolder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSaveMROPDF: setAccess failed (file still saved): ' + accessErr.message);
    }

    _addNotification('admin', 'mro_submitted', 'New MRO',
      creatorName + ' submitted a Materials Receiving document.', '');

    _logActivity(_resolveActor(body) || creatorName, 'added', 'mro', fileName,
      'MRO ' + fileName, 0);

    return {
      success: true,
      driveLink: driveLink,
      fileId: file.getId()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── MI Drive Functions ───────────────────────────────────

function _getOrCreateMIFolder() {
  var folders = DriveApp.getFoldersByName('Materials Issuance');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('Materials Issuance');
}

function handleSaveMIPDF(body) {
  try {
    var base64Data = body.pdfBase64;
    var fileName = body.fileName || 'mi.pdf';
    var creatorName = body.creatorName || 'Unknown';

    if (!base64Data) {
      return { success: false, message: 'No PDF data provided' };
    }

    var rootFolder = _getOrCreateMIFolder();
    var creatorFolder = _getOrCreateSubFolder(rootFolder, creatorName);

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
    var file = creatorFolder.createFile(blob);

    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    try {
      file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (accessErr) {
      Logger.log('handleSaveMIPDF: setAccess failed (file still saved): ' + accessErr.message);
    }

    _addNotification('admin', 'mi_submitted', 'New MI',
      creatorName + ' submitted a Materials Issuance document.', '');

    _logActivity(_resolveActor(body) || creatorName, 'added', 'mi', fileName,
      'MI ' + fileName, 0);

    return {
      success: true,
      driveLink: driveLink,
      fileId: file.getId()
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: savePRToSheet — append PR rows to agent's sheet ──
function handleSavePRToSheet(body) {
  try {
    var sheetId = body.sheetId;
    var rows = body.rows;

    if (!sheetId) return { success: false, message: 'No sheetId provided' };
    if (!rows || !rows.length) return { success: false, message: 'No rows provided' };

    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheets()[0];

    for (var i = 0; i < rows.length; i++) {
      sheet.appendRow(rows[i]);
    }

    return { success: true, message: 'Appended ' + rows.length + ' row(s)' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getTodayCounts ─────────────────────────────────
function handleGetTodayCounts(params) {
  try {
    var agentName = params.agentName;
    var quotationSheetId = params.quotationSheetId || '';
    var prSheetId = params.prSheetId || '';
    var todayRange = getDateRange('today');

    var quotations = countDocuments(quotationSheetId, agentName, todayRange);
    var prs = countPRDocuments(prSheetId, todayRange);

    // Check if already submitted today
    var alreadySubmitted = false;
    var todayStr = formatDate(new Date());
    try {
      var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
      var reportSheet = ss.getSheetByName('Daily Reports');
      if (reportSheet) {
        var rData = reportSheet.getDataRange().getValues();
        for (var i = 1; i < rData.length; i++) {
          var parsedDate = parseSheetDate(rData[i][0]);
          var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();
          var rowAgent = String(rData[i][1]).trim();
          if (rowDate === todayStr && rowAgent.toLowerCase() === agentName.toLowerCase()) {
            alreadySubmitted = true;
            break;
          }
        }
      }
    } catch (e) { /* ignore */ }

    return { success: true, quotations: quotations, prs: prs, alreadySubmitted: alreadySubmitted };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: submitDailyReport ──────────────────────────────
function handleSubmitDailyReport(params) {
  try {
    var agentName = params.agentName || '';
    var quotationsSent = parseInt(params.quotationsSent) || 0;
    var prsSent = parseInt(params.prsSent) || 0;
    var leadsEmails = parseInt(params.leadsEmails) || 0;
    var followUpEmails = parseInt(params.followUpEmails) || 0;
    var totalCalls = parseInt(params.totalCalls) || 0;
    var successfulCalls = parseInt(params.successfulCalls) || 0;
    var unsuccessfulCalls = parseInt(params.unsuccessfulCalls) || 0;
    var callDetails = params.callDetails || '[]';
    var leadsEmailDetails = params.leadsEmailDetails || '[]';
    var followUpEmailDetails = params.followUpEmailDetails || '[]';
    var urgentIssues = params.urgentIssues || '[]';
    var otherTask = params.otherTask || '';

    if (!agentName) {
      return { success: false, message: 'Agent name is required.' };
    }

    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var reportSheet = ss.getSheetByName('Daily Reports');

    if (!reportSheet) {
      reportSheet = ss.insertSheet('Daily Reports');
      reportSheet.appendRow([
        'Date', 'Agent Name', 'Quotations Sent', 'PRs Sent', 'Leads Emails', 'Follow Up Emails',
        'Total Calls', 'Successful Calls', 'Unsuccessful Calls',
        'Call Details', 'Leads Email Details', 'Follow Up Email Details', 'Urgent Issues', 'Submitted At', 'PDF Link', 'Other Task'
      ]);
    } else {
      // Migrate existing sheet to include "Other Task" column (col 16) if missing
      var hdrLastCol = reportSheet.getLastColumn();
      if (hdrLastCol < 16) {
        reportSheet.getRange(1, 16).setValue('Other Task');
      }
    }

    // Duplicate check
    var todayStr = formatDate(new Date());
    var rData = reportSheet.getDataRange().getValues();
    for (var i = 1; i < rData.length; i++) {
      var parsedDate = parseSheetDate(rData[i][0]);
      var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();
      var rowAgent = String(rData[i][1]).trim();
      if (rowDate === todayStr && rowAgent.toLowerCase() === agentName.toLowerCase()) {
        return { success: false, message: 'You have already submitted a report for today.' };
      }
    }

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    reportSheet.appendRow([
      todayStr, agentName, quotationsSent, prsSent, leadsEmails, followUpEmails,
      totalCalls, successfulCalls, unsuccessfulCalls,
      callDetails, leadsEmailDetails, followUpEmailDetails, urgentIssues, now, '', otherTask
    ]);

    // Email admin if there are urgent issues
    try {
      var parsedUrgent = JSON.parse(urgentIssues);
      if (parsedUrgent && parsedUrgent.length > 0) {
        var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
        var usersData = usersSheet.getDataRange().getValues();
        for (var ai = 1; ai < usersData.length; ai++) {
          if (String(usersData[ai][2]).trim().toLowerCase() === 'admin') {
            // Try to get admin email from column index 12 (if exists), otherwise use MANAGER_EMAIL
            var adminEmail = MANAGER_EMAIL;
            if (usersData[ai].length > 12 && String(usersData[ai][12]).trim()) {
              adminEmail = String(usersData[ai][12]).trim();
            }
            var issueList = parsedUrgent.map(function(u) {
              return '- [' + u.category + '] ' + u.description;
            }).join('\n');
            var subject = 'URGENT: ' + agentName + ' reported ' + parsedUrgent.length + ' urgent issue(s) — ' + todayStr;
            var body = 'Agent: ' + agentName + '\nDate: ' + todayStr + '\n\nUrgent Issues:\n' + issueList +
              '\n\nPlease review in the Hi-Escorp Portal.';
            MailApp.sendEmail(adminEmail, subject, body);
            break;
          }
        }
      }
    } catch (emailErr) {
      Logger.log('Urgent email error: ' + emailErr.message);
    }

    return { success: true, message: 'Daily report submitted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: changePassword ─────────────────────────────────
function handleChangePassword(params) {
  try {
    var username = params.username || '';
    var currentPassword = params.currentPassword || '';
    var newPassword = params.newPassword || '';

    if (!username || !currentPassword || !newPassword) {
      return { success: false, message: 'All fields are required.' };
    }

    if (newPassword.length < 6) {
      return { success: false, message: 'New password must be at least 6 characters.' };
    }

    var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var rowUsername = String(data[i][0]).trim();
      if (rowUsername !== username.trim()) continue;

      var storedPassword = String(data[i][1]).trim();
      var decodedPassword = Utilities.newBlob(
        Utilities.base64Decode(storedPassword)
      ).getDataAsString();

      if (decodedPassword !== currentPassword) {
        return { success: false, message: 'Current password is incorrect.' };
      }

      // Encode new password as Base64 and save
      var newEncoded = Utilities.base64Encode(
        Utilities.newBlob(newPassword).getBytes()
      );
      sheet.getRange(i + 1, 2).setValue(newEncoded);

      return { success: true, message: 'Password changed successfully.' };
    }

    return { success: false, message: 'User not found.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getTargets ─────────────────────────────────────
function handleGetTargets(params) {
  try {
    var month = params.month || ''; // YYYY-MM format
    var agentName = params.agentName || '';
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var targetSheet = ss.getSheetByName('Sales Targets');

    if (!targetSheet) {
      return { success: true, data: [] };
    }

    var data = targetSheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var rowMonth = String(data[i][0]).trim();
      var rowAgent = String(data[i][1]).trim();
      if (month && rowMonth !== month) continue;
      if (agentName && rowAgent.toLowerCase() !== agentName.toLowerCase()) continue;

      results.push({
        month: rowMonth,
        agentName: rowAgent,
        quotationTarget: parseInt(data[i][2]) || 0,
        prTarget: parseInt(data[i][3]) || 0,
        callTarget: parseInt(data[i][4]) || 0
      });
    }

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: setTargets ─────────────────────────────────────
function handleSetTargets(params) {
  try {
    var month = params.month || '';
    var agentName = params.agentName || '';
    var quotationTarget = parseInt(params.quotationTarget) || 0;
    var prTarget = parseInt(params.prTarget) || 0;
    var callTarget = parseInt(params.callTarget) || 0;

    if (!month || !agentName) {
      return { success: false, message: 'Month and agent name are required.' };
    }

    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var targetSheet = ss.getSheetByName('Sales Targets');

    if (!targetSheet) {
      targetSheet = ss.insertSheet('Sales Targets');
      targetSheet.appendRow(['Month', 'Agent Name', 'Quotation Target', 'PR Target', 'Call Target']);
    }

    // Check if target already exists for this month+agent
    var data = targetSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var rowMonth = String(data[i][0]).trim();
      var rowAgent = String(data[i][1]).trim();
      if (rowMonth === month && rowAgent.toLowerCase() === agentName.toLowerCase()) {
        // Update existing row
        targetSheet.getRange(i + 1, 3).setValue(quotationTarget);
        targetSheet.getRange(i + 1, 4).setValue(prTarget);
        targetSheet.getRange(i + 1, 5).setValue(callTarget);
        return { success: true, message: 'Targets updated for ' + agentName + '.' };
      }
    }

    // Insert new row
    targetSheet.appendRow([month, agentName, quotationTarget, prTarget, callTarget]);
    return { success: true, message: 'Targets set for ' + agentName + '.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getReportSummary ───────────────────────────────
function handleGetReportSummary(params) {
  try {
    var range = params.range || 'month'; // 'week' or 'month'
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);

    // Get all sales agents
    var usersSheet = ss.getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var agents = [];
    for (var i = 1; i < usersData.length; i++) {
      var role = String(usersData[i][2]).trim().toLowerCase();
      if (role === 'admin') continue;
      agents.push(String(usersData[i][3]).trim());
    }

    // Calculate date range
    var now = new Date();
    var startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    var endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    if (range === 'week') {
      var dayOfWeek = startDate.getDay();
      var diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startDate.setDate(startDate.getDate() - diff);
    } else {
      startDate.setDate(1);
    }

    var startStr = formatDate(startDate);
    var endStr = formatDate(endDate);

    // Read daily reports
    var reportSheet = ss.getSheetByName('Daily Reports');
    var agentSummary = {};

    // Initialize all agents
    for (var a = 0; a < agents.length; a++) {
      agentSummary[agents[a].toLowerCase()] = {
        agentName: agents[a],
        daysSubmitted: 0,
        totalQuotations: 0,
        totalPRs: 0,
        totalLeadsEmails: 0,
        totalFollowUpEmails: 0,
        totalCalls: 0,
        successfulCalls: 0,
        unsuccessfulCalls: 0,
        urgentIssues: 0
      };
    }

    if (reportSheet) {
      var rData = reportSheet.getDataRange().getValues();
      for (var j = 1; j < rData.length; j++) {
        var parsedDate = parseSheetDate(rData[j][0]);
        var rowDateStr = parsedDate ? formatDate(parsedDate) : String(rData[j][0]).trim();
        if (rowDateStr < startStr || rowDateStr > endStr) continue;

        var agentName = String(rData[j][1]).trim();
        var key = agentName.toLowerCase();
        if (!agentSummary[key]) continue;

        agentSummary[key].daysSubmitted++;
        agentSummary[key].totalQuotations += parseInt(rData[j][2]) || 0;
        agentSummary[key].totalPRs += parseInt(rData[j][3]) || 0;
        agentSummary[key].totalLeadsEmails += parseInt(rData[j][4]) || 0;
        agentSummary[key].totalFollowUpEmails += parseInt(rData[j][5]) || 0;
        agentSummary[key].totalCalls += parseInt(rData[j][6]) || 0;
        agentSummary[key].successfulCalls += parseInt(rData[j][7]) || 0;
        agentSummary[key].unsuccessfulCalls += parseInt(rData[j][8]) || 0;

        var urgentRaw = String(rData[j][12] || '[]');
        try {
          var urgentArr = JSON.parse(urgentRaw);
          agentSummary[key].urgentIssues += urgentArr.length;
        } catch (e) {}
      }
    }

    // Convert to array
    var result = [];
    for (var k = 0; k < agents.length; k++) {
      result.push(agentSummary[agents[k].toLowerCase()]);
    }

    return {
      success: true,
      data: result,
      range: range,
      startDate: startStr,
      endDate: endStr
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getAgentDayActivity ─────────────────────────────
// Returns the quotation rows and PR rows an agent created on a given date.
// Used by admin/management daily-report tables so they can drill into the
// actual quotations/PRs behind the count cells.
function handleGetAgentDayActivity(params) {
  try {
    var agentName = String(params.agentName || '').trim();
    var dateStr = String(params.date || '').trim() || formatDate(new Date());
    if (!agentName) return { success: false, message: 'agentName required' };

    // Find the agent's quotation/PR sheet IDs in the Users sheet
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var quotationSheetId = '';
    var prSheetId = '';
    for (var u = 1; u < usersData.length; u++) {
      var rowAgent = String(usersData[u][3] || '').trim();
      if (rowAgent.toLowerCase() === agentName.toLowerCase()) {
        quotationSheetId = String(usersData[u][4] || '').trim();
        prSheetId = String(usersData[u][5] || '').trim();
        break;
      }
    }

    var quotations = [];
    if (quotationSheetId && quotationSheetId !== 'undefined') {
      try {
        var qSheet = SpreadsheetApp.openById(quotationSheetId).getSheets()[0];
        var qData = qSheet.getDataRange().getValues();
        for (var i = 1; i < qData.length; i++) {
          var qDate = parseSheetDate(qData[i][0]);
          if (!qDate) continue;
          if (formatDate(qDate) !== dateStr) continue;
          quotations.push({
            date: formatDate(qDate),
            agentName: String(qData[i][1] || '').trim(),
            refNo: String(qData[i][2] || '').trim(),
            rfqNo: String(qData[i][3] || '').trim(),
            subject: String(qData[i][4] || '').trim(),
            clientName: String(qData[i][5] || '').trim(),
            amount: qData[i][8] || '',
            driveLink: String(qData[i][11] || '').trim(),
            adminApproval: String(qData[i][12] || '').trim() || 'Pending',
            managementApproval: String(qData[i][13] || '').trim() || 'Pending',
            overallStatus: String(qData[i][14] || '').trim() || 'Pending Approval'
          });
        }
      } catch (qErr) { /* skip */ }
    }

    var prs = [];
    if (prSheetId && prSheetId !== 'undefined') {
      try {
        var pSheet = SpreadsheetApp.openById(prSheetId).getSheets()[0];
        var pData = pSheet.getDataRange().getValues();
        for (var j = 1; j < pData.length; j++) {
          var pDate = parseSheetDate(pData[j][4]);
          if (!pDate) continue;
          if (formatDate(pDate) !== dateStr) continue;
          prs.push({
            date: formatDate(pDate),
            clientName: String(pData[j][0] || '').trim(),
            contactPerson: String(pData[j][1] || '').trim(),
            refNumber: String(pData[j][2] || '').trim(),
            prNumber: String(pData[j][3] || '').trim(),
            itemDescription: String(pData[j][5] || '').trim(),
            modelPartNo: String(pData[j][6] || '').trim(),
            quantity: pData[j][7] || '',
            unit: String(pData[j][8] || '').trim(),
            status: String(pData[j][10] || '').trim() || 'Pending',
            unitPrice: pData[j][12] || '',
            totalPrice: pData[j][13] || ''
          });
        }
      } catch (pErr) { /* skip */ }
    }

    return {
      success: true,
      date: dateStr,
      agentName: agentName,
      quotations: quotations,
      prs: prs
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getDailyReports ────────────────────────────────
function handleGetDailyReports(params) {
  try {
    var requestedDate = params.date || formatDate(new Date());
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);

    // Get all sales agents
    var usersSheet = ss.getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var agents = [];
    for (var i = 1; i < usersData.length; i++) {
      var role = String(usersData[i][2]).trim().toLowerCase();
      if (role !== 'sales') continue;
      agents.push(String(usersData[i][3]).trim());
    }

    // Get reports for requested date
    var reportSheet = ss.getSheetByName('Daily Reports');
    var reports = {};
    if (reportSheet) {
      var rData = reportSheet.getDataRange().getValues();
      for (var j = 1; j < rData.length; j++) {
        var parsedDate = parseSheetDate(rData[j][0]);
        var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[j][0]).trim();
        if (rowDate !== requestedDate) continue;
        var agentName = String(rData[j][1]).trim();
        var callDetailsRaw = String(rData[j][9] || '[]');
        var callDetails = [];
        try { callDetails = JSON.parse(callDetailsRaw); } catch (e) { callDetails = []; }
        var leadsEmailDetailsRaw = String(rData[j][10] || '[]');
        var leadsEmailDetailsParsed = [];
        try { leadsEmailDetailsParsed = JSON.parse(leadsEmailDetailsRaw); } catch (e) { leadsEmailDetailsParsed = []; }
        var followUpEmailDetailsRaw = String(rData[j][11] || '[]');
        var followUpEmailDetailsParsed = [];
        try { followUpEmailDetailsParsed = JSON.parse(followUpEmailDetailsRaw); } catch (e) { followUpEmailDetailsParsed = []; }
        var urgentIssuesRaw = String(rData[j][12] || '[]');
        var urgentIssuesParsed = [];
        try { urgentIssuesParsed = JSON.parse(urgentIssuesRaw); } catch (e) { urgentIssuesParsed = []; }

        reports[agentName.toLowerCase()] = {
          agentName: agentName,
          submitted: true,
          quotationsSent: parseInt(rData[j][2]) || 0,
          prsSent: parseInt(rData[j][3]) || 0,
          leadsEmails: parseInt(rData[j][4]) || 0,
          followUpEmails: parseInt(rData[j][5]) || 0,
          totalCalls: parseInt(rData[j][6]) || 0,
          successfulCalls: parseInt(rData[j][7]) || 0,
          unsuccessfulCalls: parseInt(rData[j][8]) || 0,
          callDetails: callDetails,
          leadsEmailDetails: leadsEmailDetailsParsed,
          followUpEmailDetails: followUpEmailDetailsParsed,
          urgentIssues: urgentIssuesParsed,
          submittedAt: String(rData[j][13] || ''),
          pdfLink: String(rData[j][14] || ''),
          otherTask: String(rData[j][15] || '')
        };
      }
    }

    // Build result: all agents with their report or "not submitted"
    var result = [];
    for (var k = 0; k < agents.length; k++) {
      var key = agents[k].toLowerCase();
      if (reports[key]) {
        result.push(reports[key]);
      } else {
        result.push({ agentName: agents[k], submitted: false });
      }
    }

    return { success: true, data: result, date: requestedDate };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════
// ACCOUNTING MODULE
// ═══════════════════════════════════════════════════════
// Orders tab columns:
//   A=Order Date | B=Order # | C=Type | D=Client | E=Product | F=Qty | G=Selling Price (PHP)
//   H=Supplier | I=Purchase Cost (orig) | J=Currency | K=Exchange Rate | L=Purchase Cost (PHP)
//   M=Shipping Method | N=Shipping Cost | O=Duties & Taxes | P=Delivery Method | Q=Delivery Cost
//   R=Payment Terms | S=Due Date | T=Amount Received | U=Client Pay Status | V=Supplier Pay Status
//   W=Order Status | X=Notes
// Expenses tab columns:
//   A=Date | B=Category | C=Order # | D=Client | E=Description
//   F=Toll | G=Fuel | H=Meals | I=Load Balance | J=Other Amount | K=Total | L=Notes

function _getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function _ordersSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Orders', [
    'Order Date','Order #','Type','Client','Product Description','Qty','Selling Price (PHP)',
    'Supplier','Purchase Cost','Currency','Exchange Rate','Purchase Cost (PHP)',
    'Shipping Method','Shipping Cost (PHP)','Duties & Taxes (PHP)','Delivery Method','Delivery Cost (PHP)',
    'Payment Terms','Due Date','Amount Received (PHP)','Client Payment Status','Supplier Payment Status',
    'Order Status','Notes'
  ]);
}

function _expensesSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Expenses', [
    'Date','Category','Order #','Client','Description',
    'Toll','Fuel','Meals','Load Balance','Other Amount','Total','Notes'
  ]);
}

function _parseOrderRow(row, idx) {
  return {
    date: row[0] ? formatDate(parseSheetDate(row[0]) || new Date()) : '',
    orderNumber: String(row[1] || '').trim(),
    type: String(row[2] || '').trim(),
    client: String(row[3] || '').trim(),
    product: String(row[4] || '').trim(),
    qty: parseInt(row[5]) || 0,
    sellingPrice: parseFloat(row[6]) || 0,
    supplier: String(row[7] || '').trim(),
    purchaseCost: parseFloat(row[8]) || 0,
    currency: String(row[9] || 'PHP').trim(),
    exchangeRate: parseFloat(row[10]) || 1,
    purchaseCostPHP: parseFloat(row[11]) || 0,
    shippingMethod: String(row[12] || '').trim(),
    shippingCost: parseFloat(row[13]) || 0,
    dutiesTaxes: parseFloat(row[14]) || 0,
    deliveryMethod: String(row[15] || '').trim(),
    deliveryCost: parseFloat(row[16]) || 0,
    paymentTerms: String(row[17] || '').trim(),
    dueDate: row[18] ? formatDate(parseSheetDate(row[18]) || new Date()) : '',
    amountReceived: parseFloat(row[19]) || 0,
    clientPayStatus: String(row[20] || 'Pending').trim(),
    supplierPayStatus: String(row[21] || 'Pending').trim(),
    orderStatus: String(row[22] || 'Processing').trim(),
    notes: String(row[23] || '').trim(),
    rowIndex: idx
  };
}

// ─── ACTION: getAccountingDashboard ─────────────────
function handleGetAccountingDashboard(params) {
  try {
    var range = params.range || 'month';

    // Read orders
    var sheet = _ordersSheet();
    var oData = sheet.getDataRange().getValues();
    var allOrders = [];
    for (var i = 1; i < oData.length; i++) {
      if (!oData[i][0]) continue;
      allOrders.push(_parseOrderRow(oData[i], i + 1));
    }

    // Read expenses
    var eSheet = _expensesSheet();
    var eData = eSheet.getDataRange().getValues();
    var allExpenses = [];
    for (var j = 1; j < eData.length; j++) {
      if (!eData[j][0]) continue;
      allExpenses.push({
        date: formatDate(parseSheetDate(eData[j][0]) || new Date()),
        category: String(eData[j][1] || '').trim(),
        total: parseFloat(eData[j][10]) || 0
      });
    }

    // Date filter
    var now = new Date();
    var startDate = new Date();
    startDate.setHours(0,0,0,0);
    var endStr = null;
    if (range === 'month') { startDate.setDate(1); }
    else if (range === 'quarter') { startDate.setMonth(startDate.getMonth() - 2); startDate.setDate(1); }
    else if (range === 'year') { startDate.setMonth(0); startDate.setDate(1); }
    else if (/^\d{4}-\d{2}$/.test(range)) {
      var rParts = range.split('-');
      var rYear = parseInt(rParts[0]), rMon = parseInt(rParts[1]) - 1;
      startDate = new Date(rYear, rMon, 1);
      endStr = formatDate(new Date(rYear, rMon + 1, 0));
    } else { startDate = new Date(2000, 0, 1); }
    var startStr = formatDate(startDate);

    var orders = allOrders.filter(function(o) { return o.date >= startStr && (!endStr || o.date <= endStr); });
    var expenses = allExpenses.filter(function(e) { return e.date >= startStr && (!endStr || e.date <= endStr); });

    // KPIs
    var totalRevenue = 0, totalCOGS = 0, totalShipping = 0, totalDuties = 0, totalDelivery = 0;
    var totalReceivables = 0, totalPayables = 0;
    var aging = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    var payablesAging = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    var statusCount = {};
    var clientRev = {};

    orders.forEach(function(o) {
      totalRevenue += o.sellingPrice;
      totalCOGS += o.purchaseCostPHP;
      totalShipping += o.shippingCost;
      totalDuties += o.dutiesTaxes;
      totalDelivery += o.deliveryCost;

      var balance = o.sellingPrice - o.amountReceived;
      if (balance > 0 && o.clientPayStatus !== 'Paid') {
        totalReceivables += balance;
        if (o.dueDate) {
          var daysOver = Math.floor((now - (parseSheetDate(o.dueDate) || now)) / 86400000);
          if (daysOver <= 0) aging.current += balance;
          else if (daysOver <= 30) aging.d30 += balance;
          else if (daysOver <= 60) aging.d60 += balance;
          else if (daysOver <= 90) aging.d90 += balance;
          else aging.over90 += balance;
        } else { aging.current += balance; }
      }
      if (o.supplierPayStatus !== 'Paid') {
        totalPayables += o.purchaseCostPHP;
        var orderDate = parseSheetDate(o.date) || now;
        var pDaysOver = Math.floor((now - orderDate) / 86400000);
        if (pDaysOver <= 0) payablesAging.current += o.purchaseCostPHP;
        else if (pDaysOver <= 30) payablesAging.d30 += o.purchaseCostPHP;
        else if (pDaysOver <= 60) payablesAging.d60 += o.purchaseCostPHP;
        else if (pDaysOver <= 90) payablesAging.d90 += o.purchaseCostPHP;
        else payablesAging.over90 += o.purchaseCostPHP;
      }

      statusCount[o.orderStatus] = (statusCount[o.orderStatus] || 0) + 1;
      clientRev[o.client] = (clientRev[o.client] || 0) + o.sellingPrice;
    });

    var totalOtherExp = 0;
    var expByCat = {};
    expenses.forEach(function(e) {
      totalOtherExp += e.total;
      expByCat[e.category || 'Uncategorized'] = (expByCat[e.category || 'Uncategorized'] || 0) + e.total;
    });

    var totalExpenses = totalCOGS + totalShipping + totalDuties + totalDelivery + totalOtherExp;
    var grossProfit = totalRevenue - totalCOGS;
    var netProfit = totalRevenue - totalExpenses;

    // Monthly P&L (last 6 months)
    var monthly = [];
    for (var m = 5; m >= 0; m--) {
      var mStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
      var mEnd = new Date(now.getFullYear(), now.getMonth() - m + 1, 0);
      var mStartStr = formatDate(mStart);
      var mEndStr = formatDate(mEnd);
      var mRev = 0, mCost = 0;
      allOrders.forEach(function(o) {
        if (o.date >= mStartStr && o.date <= mEndStr) {
          mRev += o.sellingPrice;
          mCost += o.purchaseCostPHP + o.shippingCost + o.dutiesTaxes + o.deliveryCost;
        }
      });
      allExpenses.forEach(function(e) {
        if (e.date >= mStartStr && e.date <= mEndStr) mCost += e.total;
      });
      monthly.push({
        month: mStartStr.substring(0, 7),
        revenue: mRev,
        expenses: mCost,
        profit: mRev - mCost
      });
    }

    // Top clients
    var topClients = Object.keys(clientRev).map(function(c) {
      return { client: c, revenue: clientRev[c] };
    }).sort(function(a,b) { return b.revenue - a.revenue; }).slice(0, 10);

    // Cash flow — last 30 days (from all orders, not date-filtered)
    var cashFlow = [];
    for (var d = 29; d >= 0; d--) {
      var cfDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      var cfKey = formatDate(cfDate);
      var cashIn = 0, cashOut = 0;
      allOrders.forEach(function(o) {
        if (o.date === cfKey) {
          cashIn += o.amountReceived || 0;
          cashOut += o.purchaseCostPHP + o.shippingCost + o.dutiesTaxes + o.deliveryCost;
        }
      });
      allExpenses.forEach(function(e) {
        if (e.date === cfKey) cashOut += e.total;
      });
      cashFlow.push({ date: cfKey, cashIn: cashIn, cashOut: cashOut });
    }

    // SO-based total revenue from Sales Orders sheet
    var soSheet = _salesOrdersSheet();
    var soRaw = soSheet.getDataRange().getValues();
    var soTotalRevenue = 0;
    var soSeen = {};
    for (var si = 1; si < soRaw.length; si++) {
      var soNo = String(soRaw[si][0] || '').trim();
      if (!soNo || soSeen[soNo]) continue;
      soSeen[soNo] = true;
      var soDateStr = formatDate(parseSheetDate(soRaw[si][1]) || new Date());
      if (soDateStr >= startStr && (!endStr || soDateStr <= endStr)) {
        soTotalRevenue += parseFloat(soRaw[si][12]) || 0;
      }
    }

    return {
      success: true,
      summary: {
        totalRevenue: totalRevenue,
        totalCOGS: totalCOGS,
        grossProfit: grossProfit,
        grossMargin: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0,
        totalShipping: totalShipping,
        totalDuties: totalDuties,
        totalDelivery: totalDelivery,
        totalOtherExpenses: totalOtherExp,
        totalExpenses: totalExpenses,
        netProfit: netProfit,
        netMargin: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0,
        totalReceivables: totalReceivables,
        totalPayables: totalPayables,
        aging: aging,
        payablesAging: payablesAging,
        ordersByStatus: statusCount,
        expenseByCategory: expByCat
      },
      monthly: monthly,
      cashFlow: cashFlow,
      topClients: topClients,
      totalOrders: orders.length,
      soTotalRevenue: soTotalRevenue,
      range: range
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getOrders ──────────────────────────────
function handleGetOrders(params) {
  try {
    var sheet = _ordersSheet();
    var data = sheet.getDataRange().getValues();
    var status = (params.status || '').trim();
    var client = (params.client || '').trim().toLowerCase();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var o = _parseOrderRow(data[i], i + 1);
      if (status && o.orderStatus !== status) continue;
      if (client && o.client.toLowerCase().indexOf(client) === -1) continue;
      results.push(o);
    }
    results.reverse(); // newest first
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: addOrder ───────────────────────────────
function handleAddOrder(params) {
  try {
    var sheet = _ordersSheet();
    var purchaseCost = parseFloat(params.purchaseCost) || 0;
    var exchangeRate = parseFloat(params.exchangeRate) || 1;
    var purchaseCostPHP = purchaseCost * exchangeRate;
    var sellingPrice = parseFloat(params.sellingPrice) || 0;

    // Calculate due date from payment terms
    var dueDate = '';
    var terms = (params.paymentTerms || '').trim();
    if (terms) {
      var daysMatch = terms.match(/(\d+)\s*[Dd]ays?/);
      if (daysMatch) {
        var dd = new Date();
        dd.setDate(dd.getDate() + parseInt(daysMatch[1]));
        dueDate = formatDate(dd);
      } else if (params.dueDate) {
        dueDate = params.dueDate;
      }
    } else if (params.dueDate) {
      dueDate = params.dueDate;
    }

    sheet.appendRow([
      params.orderDate || formatDate(new Date()),
      params.orderNumber || '',
      params.type || 'Local',
      params.client || '',
      params.product || '',
      parseInt(params.qty) || 1,
      sellingPrice,
      params.supplier || '',
      purchaseCost,
      params.currency || 'PHP',
      exchangeRate,
      purchaseCostPHP,
      params.shippingMethod || '',
      parseFloat(params.shippingCost) || 0,
      parseFloat(params.dutiesTaxes) || 0,
      params.deliveryMethod || '',
      parseFloat(params.deliveryCost) || 0,
      terms,
      dueDate,
      parseFloat(params.amountReceived) || 0,
      params.clientPayStatus || 'Pending',
      params.supplierPayStatus || 'Pending',
      params.orderStatus || 'Processing',
      params.notes || ''
    ]);
    _writeCreatedBy(sheet, params.createdBy);

    _logActivity(_resolveActor(params), 'added', 'order',
      params.orderNumber || '',
      'Order ' + (params.orderNumber || '') + ' — ' + (params.client || '') + ' — ' + (params.product || ''),
      sellingPrice);

    return { success: true, message: 'Order added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateOrder ────────────────────────────
function handleUpdateOrder(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex) return { success: false, message: 'Missing rowIndex' };

    var sheet = _ordersSheet();
    var field = params.field || '';
    var value = params.value || '';

    // Map field to column index (1-based)
    var colMap = {
      amountReceived: 20,
      clientPayStatus: 21,
      supplierPayStatus: 22,
      orderStatus: 23,
      shippingCost: 14,
      dutiesTaxes: 15,
      deliveryCost: 17,
      notes: 24
    };

    if (!colMap[field]) return { success: false, message: 'Invalid field: ' + field };

    var numFields = ['amountReceived', 'shippingCost', 'dutiesTaxes', 'deliveryCost'];
    if (numFields.indexOf(field) !== -1) value = parseFloat(value) || 0;

    sheet.getRange(rowIndex, colMap[field]).setValue(value);

    // Get order # for activity log
    var orderNo = '';
    try { orderNo = String(sheet.getRange(rowIndex, 2).getValue() || ''); } catch (_) {}
    _logActivity(_resolveActor(params), 'updated', 'order', orderNo,
      'Order ' + orderNo + ' — ' + field + ' → ' + value,
      numFields.indexOf(field) !== -1 ? value : 0);

    return { success: true, message: 'Order updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getExpenses ────────────────────────────
function handleGetExpenses(params) {
  try {
    var sheet = _expensesSheet();
    var data = sheet.getDataRange().getValues();
    var category = (params.category || '').trim();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var cat = String(data[i][1] || '').trim();
      if (category && cat !== category) continue;
      results.push({
        date: formatDate(parseSheetDate(data[i][0]) || new Date()),
        category: cat,
        orderRef: String(data[i][2] || '').trim(),
        client: String(data[i][3] || '').trim(),
        description: String(data[i][4] || '').trim(),
        toll: parseFloat(data[i][5]) || 0,
        fuel: parseFloat(data[i][6]) || 0,
        meals: parseFloat(data[i][7]) || 0,
        loadBalance: parseFloat(data[i][8]) || 0,
        otherAmount: parseFloat(data[i][9]) || 0,
        total: parseFloat(data[i][10]) || 0,
        notes: String(data[i][11] || '').trim(),
        rowIndex: i + 1
      });
    }
    results.reverse();
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: addExpense ─────────────────────────────
function handleAddExpense(params) {
  try {
    var sheet = _expensesSheet();
    var toll = parseFloat(params.toll) || 0;
    var fuel = parseFloat(params.fuel) || 0;
    var meals = parseFloat(params.meals) || 0;
    var loadBalance = parseFloat(params.loadBalance) || 0;
    var otherAmount = parseFloat(params.otherAmount) || 0;
    var total = toll + fuel + meals + loadBalance + otherAmount;

    sheet.appendRow([
      params.date || formatDate(new Date()),
      params.category || 'Miscellaneous',
      params.orderRef || '',
      params.client || '',
      params.description || '',
      toll, fuel, meals, loadBalance, otherAmount, total,
      params.notes || ''
    ]);
    _writeCreatedBy(sheet, params.createdBy);

    _logActivity(_resolveActor(params), 'added', 'expense',
      params.orderRef || '',
      (params.category || 'Misc') + ' — ' + (params.description || params.client || ''),
      total);

    return { success: true, message: 'Expense recorded.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════
// SUPPLIER QUOTATIONS
// ═══════════════════════════════════════════════════════
// Columns: Date | Supplier Company | Contact Person | Contact # | Email |
//          Reference No | Item Description | Qty | Price per Unit | Total Amount |
//          Currency | Remarks | Submitted By

function _supplierQuotationsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = _getOrCreateSheet(ss, 'Supplier Quotations', [
    'Date', 'Supplier Company Name', 'Contact Person', 'Contact #', 'Email',
    'Reference No.', 'Item Description', 'Qty', 'Price per Unit', 'Total Amount',
    'Currency', 'Remarks', 'Submitted By', 'PR Number', 'PR Item Description', 'PR Agent Name',
    'Drive Folder Link'
  ]);
  // Migrate existing sheets to 17-col
  var lastCol = sheet.getLastColumn();
  if (lastCol < 17) {
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (lastCol < 14 || String(headers[13] || '').trim() !== 'PR Number') {
      sheet.getRange(1, 14).setValue('PR Number');
    }
    if (lastCol < 15) sheet.getRange(1, 15).setValue('PR Item Description');
    if (lastCol < 16) sheet.getRange(1, 16).setValue('PR Agent Name');
    if (lastCol < 17) sheet.getRange(1, 17).setValue('Drive Folder Link');
  }
  return sheet;
}

function handleGetSupplierQuotations(params) {
  try {
    var sheet = _supplierQuotationsSheet();
    var data = sheet.getDataRange().getValues();
    var supplier = (params.supplier || '').trim().toLowerCase();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var row = {
        date: formatDate(parseSheetDate(data[i][0]) || new Date()),
        supplierCompany: String(data[i][1] || '').trim(),
        contactPerson: String(data[i][2] || '').trim(),
        contactNumber: String(data[i][3] || '').trim(),
        email: String(data[i][4] || '').trim(),
        referenceNo: String(data[i][5] || '').trim(),
        itemDescription: String(data[i][6] || '').trim(),
        qty: parseInt(data[i][7]) || 0,
        pricePerUnit: parseFloat(data[i][8]) || 0,
        totalAmount: parseFloat(data[i][9]) || 0,
        currency: String(data[i][10] || 'PHP').trim(),
        remarks: String(data[i][11] || '').trim(),
        submittedBy: String(data[i][12] || '').trim(),
        prNumber: String(data[i][13] || '').trim(),
        prItemDescription: String(data[i][14] || '').trim(),
        prAgentName: String(data[i][15] || '').trim(),
        driveFolderLink: String(data[i][16] || '').trim(),
        rowIndex: i + 1
      };
      if (supplier && row.supplierCompany.toLowerCase().indexOf(supplier) === -1) continue;
      results.push(row);
    }
    results.reverse();
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddSupplierQuotation(params) {
  try {
    var sheet = _supplierQuotationsSheet();
    var date = params.date || formatDate(new Date());

    // Multi-item support: if itemsJson is provided, add one row per item
    if (params.itemsJson) {
      var items = JSON.parse(params.itemsJson);
      if (!items.length) return { success: false, message: 'No items provided.' };
      var rowIndices = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var qty = parseInt(it.qty) || 0;
        var price = parseFloat(it.pricePerUnit) || 0;
        var total = parseFloat(it.totalAmount) || (qty * price);
        sheet.appendRow([
          date,
          params.supplierCompany || '',
          params.contactPerson || '',
          params.contactNumber || '',
          params.email || '',
          params.referenceNo || '',
          it.itemDescription || '',
          qty,
          price,
          total,
          params.currency || 'PHP',
          params.remarks || '',
          params.submittedBy || '',
          params.prNumber || '',
          it.prItemDescription || '',
          params.prAgentName || '',
          '' // Drive Folder Link (set after upload)
        ]);
        rowIndices.push(sheet.getLastRow());
      }
      return { success: true, message: items.length + ' item(s) saved.', rowIndices: rowIndices };
    }

    // Single-item fallback (backward compatible)
    var qty = parseInt(params.qty) || 0;
    var pricePerUnit = parseFloat(params.pricePerUnit) || 0;
    var totalAmount = parseFloat(params.totalAmount) || (qty * pricePerUnit);

    sheet.appendRow([
      date,
      params.supplierCompany || '',
      params.contactPerson || '',
      params.contactNumber || '',
      params.email || '',
      params.referenceNo || '',
      params.itemDescription || '',
      qty,
      pricePerUnit,
      totalAmount,
      params.currency || 'PHP',
      params.remarks || '',
      params.submittedBy || '',
      params.prNumber || '',
      params.prItemDescription || '',
      params.prAgentName || '',
      '' // Drive Folder Link
    ]);

    return { success: true, message: 'Supplier quotation saved.', rowIndices: [sheet.getLastRow()] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════
// CLIENT LIST
// ═══════════════════════════════════════════════════

function _clientsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Clients', [
    'Agent Name', 'Company Name', 'Industry', 'Site Address', 'Tel #',
    'Head Office', 'Head Office Tel #', 'Contact Person', 'Position',
    'Mobile #', 'Email', 'Client Type', 'Date Added', 'Notes'
  ]);
}

function handleGetClients(params) {
  try {
    var sheet = _clientsSheet();
    var data = sheet.getDataRange().getValues();
    var agentName = (params.agentName || '').trim().toLowerCase();
    var search = (params.search || '').trim().toLowerCase();
    var clientType = (params.clientType || '').trim();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      if (!data[i][1]) continue; // skip empty company name
      var row = {
        agentName: String(data[i][0] || '').trim(),
        companyName: String(data[i][1] || '').trim(),
        industry: String(data[i][2] || '').trim(),
        siteAddress: String(data[i][3] || '').trim(),
        tel: String(data[i][4] || '').trim(),
        headOffice: String(data[i][5] || '').trim(),
        headOfficeTel: String(data[i][6] || '').trim(),
        contactPerson: String(data[i][7] || '').trim(),
        position: String(data[i][8] || '').trim(),
        mobile: String(data[i][9] || '').trim(),
        email: String(data[i][10] || '').trim(),
        clientType: String(data[i][11] || 'Active').trim(),
        dateAdded: formatDate(parseSheetDate(data[i][12]) || new Date()),
        notes: String(data[i][13] || '').trim(),
        rowIndex: i + 1
      };

      // Filter by agent
      if (agentName && row.agentName.toLowerCase() !== agentName) continue;
      // Filter by client type
      if (clientType && row.clientType !== clientType) continue;
      // Filter by search
      if (search) {
        var haystack = (row.companyName + ' ' + row.contactPerson + ' ' + row.industry + ' ' + row.email).toLowerCase();
        if (haystack.indexOf(search) === -1) continue;
      }

      results.push(row);
    }

    results.reverse();
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddClient(params) {
  try {
    var sheet = _clientsSheet();
    sheet.appendRow([
      params.agentName || '',
      params.companyName || '',
      params.industry || '',
      params.siteAddress || '',
      params.tel || '',
      params.headOffice || '',
      params.headOfficeTel || '',
      params.contactPerson || '',
      params.position || '',
      params.mobile || '',
      params.email || '',
      params.clientType || 'Active',
      formatDate(new Date()),
      params.notes || ''
    ]);
    return { success: true, message: 'Client added successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateClient(params) {
  try {
    var sheet = _clientsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var existingRow = sheet.getRange(rowIndex, 1, 1, 14).getValues()[0];
    var dateAdded = existingRow[12] || formatDate(new Date());

    sheet.getRange(rowIndex, 1, 1, 14).setValues([[
      params.agentName || existingRow[0],
      params.companyName || existingRow[1],
      params.industry || existingRow[2],
      params.siteAddress || existingRow[3],
      params.tel || existingRow[4],
      params.headOffice || existingRow[5],
      params.headOfficeTel || existingRow[6],
      params.contactPerson || existingRow[7],
      params.position || existingRow[8],
      params.mobile || existingRow[9],
      params.email || existingRow[10],
      params.clientType || existingRow[11] || 'Active',
      dateAdded,
      params.notes || existingRow[13]
    ]]);

    return { success: true, message: 'Client updated successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteClient(params) {
  try {
    var sheet = _clientsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };
    sheet.deleteRow(rowIndex);
    return { success: true, message: 'Client deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetClientCount(params) {
  try {
    var sheet = _clientsSheet();
    var data = sheet.getDataRange().getValues();
    var agentName = (params.agentName || '').trim().toLowerCase();
    var count = 0;
    for (var i = 1; i < data.length; i++) {
      if (!data[i][1]) continue;
      if (agentName && String(data[i][0]).trim().toLowerCase() !== agentName) continue;
      count++;
    }
    return { success: true, count: count };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Payment Request ──────────────────────────────────────────

function _paymentRequestsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = ss.getSheetByName('PaymentRequests');
  if (!sheet) {
    sheet = ss.insertSheet('PaymentRequests');
    sheet.appendRow([
      'Request Date', 'PR Number', 'Requested By', 'Department', 'Purpose', 'Priority',
      'Payee Name', 'Payee Type', 'Bank Name', 'Bank Branch', 'Account Name', 'Account Number',
      'Payment Method', 'Currency', 'Amount', 'Due Date', 'Remarks', 'Supporting Docs',
      'Submitted At', 'Drive Link', 'Status', 'Admin Approval', 'Mgmt Approval', 'Attachment Links',
      'Billing Status', 'Paid At', 'Paid By', 'Payment Slip Link', 'Cash Voucher Link', 'CV Number'
    ]);
    sheet.getRange(1, 1, 1, 30).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // Ensure Attachment Links header exists in col 24 for existing sheets
    if (sheet.getLastColumn() < 24 || !String(sheet.getRange(1, 24).getValue()).trim()) {
      sheet.getRange(1, 24).setValue('Attachment Links').setFontWeight('bold');
    }
    // Ensure billing columns 25-30 exist
    var billingHeaders = ['Billing Status', 'Paid At', 'Paid By', 'Payment Slip Link', 'Cash Voucher Link', 'CV Number'];
    for (var bh = 0; bh < billingHeaders.length; bh++) {
      var col = 25 + bh;
      if (sheet.getLastColumn() < col || !String(sheet.getRange(1, col).getValue()).trim()) {
        sheet.getRange(1, col).setValue(billingHeaders[bh]).setFontWeight('bold');
      }
    }
  }
  return sheet;
}

function handleAddPaymentRequest(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var now = new Date();

    // Deduplication: if prNumber already exists, update the driveLink only (don't append a new row)
    var prNumber = params.prNumber || '';
    if (prNumber) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][1]).trim() === prNumber.trim()) {
          // Row exists — update driveLink (col 20) and attachmentLinks (col 24) if better values provided
          if (params.driveLink && !String(data[i][19]).trim()) {
            sheet.getRange(i + 1, 20).setValue(params.driveLink);
          }
          if (params.attachmentLinks && !(data[i].length > 23 && String(data[i][23]).trim())) {
            sheet.getRange(i + 1, 24).setValue(params.attachmentLinks);
          }
          return { success: true, message: 'Payment request already exists; fields updated if needed.' };
        }
      }
    }

    sheet.appendRow([
      params.requestDate || '',
      params.prNumber || '',
      params.requestedBy || '',
      params.department || '',
      params.purpose || '',
      params.priority || '',
      params.payeeName || '',
      params.payeeType || '',
      params.bankName || '',
      params.bankBranch || '',
      params.accountName || '',
      params.accountNumber || '',
      params.paymentMethod || '',
      params.currency || 'PHP',
      params.amount || '',
      params.dueDate || '',
      params.remarks || '',
      params.supportingDocs || '',
      now.toISOString(),
      params.driveLink || '',
      '', // Status
      '', // adminApproval
      '', // mgmtApproval
      params.attachmentLinks || ''  // Attachment Links
    ]);
    return { success: true, message: 'Payment request saved.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetPaymentRequests(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][1] && !data[i][6]) continue; // skip empty rows
      var adminApproval = (data[i].length > 21 ? String(data[i][21] || '').trim() : '') || 'Pending';
      var mgmtApproval = (data[i].length > 22 ? String(data[i][22] || '').trim() : '') || 'Pending';

      // Derive overall status from approval columns
      var status = 'Pending';
      if (data[i].length > 20 && String(data[i][20]).trim()) {
        status = String(data[i][20]).trim();
      }
      // If new dual-approval columns exist, recalculate
      if (adminApproval !== 'Pending' || mgmtApproval !== 'Pending') {
        if (adminApproval === 'Rejected' || mgmtApproval === 'Rejected') {
          status = 'Rejected';
        } else if (adminApproval === 'Approved' && mgmtApproval === 'Approved') {
          status = 'Approved';
        } else {
          status = 'Pending Approval';
        }
      }
      // Backward compat: old rows without driveLink
      if (status === 'Pending' && data[i].length > 19 && String(data[i][19]).trim()) {
        var val19 = String(data[i][19]).trim();
        if (['Pending', 'Approved', 'Paid', 'Rejected'].indexOf(val19) !== -1) {
          status = val19;
        }
      }
      results.push({
        rowIndex: i + 1,
        requestDate: data[i][0] ? (function() { try { return Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch(e) { return String(data[i][0]); } })() : '',
        prNumber: data[i][1] || '',
        requestedBy: data[i][2] || '',
        department: data[i][3] || '',
        purpose: data[i][4] || '',
        priority: data[i][5] || '',
        payeeName: data[i][6] || '',
        payeeType: data[i][7] || '',
        bankName: data[i][8] || '',
        bankBranch: data[i][9] || '',
        accountName: data[i][10] || '',
        accountNumber: data[i][11] || '',
        paymentMethod: data[i][12] || '',
        currency: data[i][13] || '',
        amount: data[i][14] || '',
        dueDate: data[i][15] ? (function() { try { return Utilities.formatDate(new Date(data[i][15]), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch(e) { return String(data[i][15]); } })() : '',
        remarks: data[i][16] || '',
        supportingDocs: data[i][17] || '',
        submittedAt: data[i][18] || '',
        driveLink: String(data[i][19] || '').trim(),
        status: status,
        adminApproval: adminApproval,
        mgmtApproval: mgmtApproval,
        attachmentLinks: data[i].length > 23 ? String(data[i][23] || '').trim() : '',
        billingStatus: data[i].length > 24 ? (String(data[i][24] || '').trim() || 'Unpaid') : 'Unpaid',
        paidAt: data[i].length > 25 ? (data[i][25] ? (function() { try { return new Date(data[i][25]).toISOString(); } catch(e) { return String(data[i][25]); } })() : '') : '',
        paidBy: data[i].length > 26 ? String(data[i][26] || '').trim() : '',
        paymentSlipLink: data[i].length > 27 ? String(data[i][27] || '').trim() : ''
      });
    }
    return { success: true, data: results.reverse() };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updatePaymentRequestStatus (dual approval) ─────────────
function handleUpdatePaymentRequestStatus(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };

    // Ensure headers exist for new columns
    var headers = sheet.getRange(1, 1, 1, 23).getValues()[0];
    if (!headers[19] || String(headers[19]).trim() !== 'DriveLink') sheet.getRange(1, 20).setValue('DriveLink');
    if (!headers[20] || String(headers[20]).trim() !== 'Status') sheet.getRange(1, 21).setValue('Status');
    if (!headers[21] || String(headers[21]).trim() !== 'AdminApproval') sheet.getRange(1, 22).setValue('AdminApproval');
    if (!headers[22] || String(headers[22]).trim() !== 'MgmtApproval') sheet.getRange(1, 23).setValue('MgmtApproval');

    var approverRole = (params.approverRole || '').toLowerCase();
    var decision = params.decision || params.status || 'Pending';

    if (approverRole === 'admin' || approverRole === 'accounting') {
      sheet.getRange(rowIndex, 22).setValue(decision); // AdminApproval col
    } else if (approverRole === 'management') {
      sheet.getRange(rowIndex, 23).setValue(decision); // MgmtApproval col
    } else {
      // Legacy: direct status set
      sheet.getRange(rowIndex, 21).setValue(decision);
      return { success: true, message: 'Status updated to ' + decision };
    }

    // Recalculate overall status
    var adminA = String(sheet.getRange(rowIndex, 22).getValue() || '').trim() || 'Pending';
    var mgmtA = String(sheet.getRange(rowIndex, 23).getValue() || '').trim() || 'Pending';
    var overall;
    if (adminA === 'Rejected' || mgmtA === 'Rejected') {
      overall = 'Rejected';
    } else if (adminA === 'Approved' && mgmtA === 'Approved') {
      overall = 'Approved';
    } else if (adminA === 'Pending' && mgmtA === 'Pending') {
      overall = 'Pending';
    } else {
      overall = 'Pending Approval';
    }
    sheet.getRange(rowIndex, 21).setValue(overall);

    // Notify requester
    var requestedBy = String(sheet.getRange(rowIndex, 3).getValue()).trim();
    if (requestedBy && (overall === 'Approved' || overall === 'Rejected')) {
      _addNotification(requestedBy, 'payment_' + overall.toLowerCase(),
        'Payment ' + overall, 'Your payment request has been ' + overall.toLowerCase() + '.', '');
    }

    return { success: true, message: 'Approval updated. Overall: ' + overall };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── BILLING ──────────────────────────────────────────────────────────

function _billingRowToObj(row, rowIndex) {
  var adminApproval = String(row[21] || '').trim() || 'Pending';
  var mgmtApproval  = String(row[22] || '').trim() || 'Pending';
  var billingStatus = String(row.length > 24 ? row[24] || '' : '').trim() || 'Unpaid';
  return {
    rowIndex:        rowIndex,
    requestDate:     row[0] ? (function(){ try { return Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch(e){ return String(row[0]); } })() : '',
    prNumber:        String(row[1]  || '').trim(),
    requestedBy:     String(row[2]  || '').trim(),
    department:      String(row[3]  || '').trim(),
    purpose:         String(row[4]  || '').trim(),
    priority:        String(row[5]  || '').trim(),
    payeeName:       String(row[6]  || '').trim(),
    payeeType:       String(row[7]  || '').trim(),
    bankName:        String(row[8]  || '').trim(),
    bankBranch:      String(row[9]  || '').trim(),
    accountName:     String(row[10] || '').trim(),
    accountNumber:   String(row[11] || '').trim(),
    paymentMethod:   String(row[12] || '').trim(),
    currency:        String(row[13] || '').trim(),
    amount:          row[14] || '',
    dueDate:         row[15] ? (function(){ try { return Utilities.formatDate(new Date(row[15]), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch(e){ return String(row[15]); } })() : '',
    remarks:         String(row[16] || '').trim(),
    supportingDocs:  String(row[17] || '').trim(),
    submittedAt:     String(row[18] || '').trim(),
    driveLink:       String(row[19] || '').trim(),
    status:          String(row[20] || '').trim(),
    adminApproval:   adminApproval,
    mgmtApproval:    mgmtApproval,
    attachmentLinks: String(row.length > 23 ? row[23] || '' : '').trim(),
    billingStatus:   billingStatus,
    paidAt:          String(row.length > 25 ? row[25] || '' : '').trim(),
    paidBy:          String(row.length > 26 ? row[26] || '' : '').trim(),
    paymentSlipLink: String(row.length > 27 ? row[27] || '' : '').trim(),
    cashVoucherLink: String(row.length > 28 ? row[28] || '' : '').trim(),
    cvNumber:        String(row.length > 29 ? row[29] || '' : '').trim()
  };
}

function handleGetBillingRecords(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][1] && !data[i][6]) continue;
      var mgmtApproval = String(data[i].length > 22 ? data[i][22] || '' : '').trim();
      if (mgmtApproval !== 'Approved') continue;
      results.push(_billingRowToObj(data[i], i + 1));
    }
    // newest first
    results.reverse();
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleMarkBillPaid(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };
    var bankAccountCode = String((params && params.bankAccountCode) || '').trim();
    if (!bankAccountCode) return { success: false, message: 'Bank account required.' };

    var now = new Date().toISOString();
    var paidBy = params.paidBy || '';
    var paymentSlipLink = params.paymentSlipLink || '';

    // Ensure columns 31 (Bank Account Code) and 32 (Bank Tx ID) exist
    if (sheet.getLastColumn() < 31 || !String(sheet.getRange(1, 31).getValue()).trim()) {
      sheet.getRange(1, 31).setValue('Bank Account Code').setFontWeight('bold');
    }
    if (sheet.getLastColumn() < 32 || !String(sheet.getRange(1, 32).getValue()).trim()) {
      sheet.getRange(1, 32).setValue('Bank Tx ID').setFontWeight('bold');
    }

    // Read amount/currency/payee/PR# from the row for the bank transaction
    var rowVals = sheet.getRange(rowIndex, 1, 1, 32).getValues()[0];
    var prNumber = String(rowVals[1] || '');
    var payee    = String(rowVals[6] || '');
    var currency = String(rowVals[13] || 'PHP');
    var amount   = parseFloat(rowVals[14]) || 0;
    var existingTxId = String(rowVals[31] || '');

    if (existingTxId) {
      return { success: false, message: 'PR already has bank transaction ' + existingTxId + '.' };
    }
    if (amount <= 0) {
      return { success: false, message: 'PR amount is zero — refusing to post bank transaction.' };
    }

    var bankTxId = _appendBankTransaction({
      accountCode: bankAccountCode,
      type: 'Payment Request Paid',
      direction: -1,
      amount: amount,
      currency: currency,
      description: 'PR ' + prNumber + ' — ' + payee,
      refType: 'PaymentRequest',
      refId: prNumber || ('row:' + rowIndex),
      createdBy: paidBy,
      date: now
    });

    sheet.getRange(rowIndex, 21).setValue('Paid');   // workflow Status
    sheet.getRange(rowIndex, 25).setValue('Paid');   // Billing Status
    sheet.getRange(rowIndex, 26).setValue(now);
    sheet.getRange(rowIndex, 27).setValue(paidBy);
    if (paymentSlipLink) sheet.getRange(rowIndex, 28).setValue(paymentSlipLink);
    sheet.getRange(rowIndex, 31).setValue(bankAccountCode);
    sheet.getRange(rowIndex, 32).setValue(bankTxId);

    return { success: true, message: 'Marked as paid.', bankTxId: bankTxId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleSaveCashVoucher(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };
    if (params.cashVoucherLink) sheet.getRange(rowIndex, 29).setValue(params.cashVoucherLink);
    if (params.cvNumber)        sheet.getRange(rowIndex, 30).setValue(params.cvNumber);
    return { success: true, message: 'Cash voucher saved.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetBillingDetail(params) {
  try {
    var sheet = _paymentRequestsSheet();
    var prNumber = (params.prNumber || '').trim();
    if (!prNumber) return { success: false, message: 'prNumber required.' };
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').trim() === prNumber) {
        return { success: true, data: _billingRowToObj(data[i], i + 1) };
      }
    }
    return { success: false, message: 'Record not found.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════

function _getInventorySheet() {
  var sheetId = INVENTORY_SHEET_ID_FOR_VIEWER;
  if (!sheetId) throw new Error('INVENTORY_SHEET_ID_FOR_VIEWER is not configured in Code.gs');
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('Inventory');
  if (!sheet) {
    sheet = ss.insertSheet('Inventory');
    sheet.appendRow(['Model No.', 'Item Description', 'Current Qty', 'Last Updated']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function handleGetInventory(params) {
  try {
    var sheet = _getInventorySheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      results.push({
        modelNo: String(data[i][0] || '').trim(),
        description: String(data[i][1] || '').trim(),
        qty: parseInt(data[i][2]) || 0,
        lastUpdated: data[i][3] ? Utilities.formatDate(new Date(data[i][3]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : '',
        rowIndex: i + 1
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddInventoryItem(params) {
  try {
    if (!params.modelNo || !params.description) throw new Error('Model No. and Description are required.');
    var sheet = _getInventorySheet();
    var qty = parseInt(params.qty) || 0;
    sheet.appendRow([params.modelNo.trim(), params.description.trim(), qty, new Date()]);
    _logActivity(_resolveActor(params), 'added', 'inventory', params.modelNo,
      params.modelNo + ' — ' + params.description + ' (qty ' + qty + ')', qty);
    return { success: true, message: 'Item added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateInventoryItem(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) throw new Error('Invalid row.');
    var sheet = _getInventorySheet();
    var modelNo = params.modelNo ? String(params.modelNo).trim() : '';
    var description = params.description ? String(params.description).trim() : '';
    if (!modelNo || !description) throw new Error('Model No and Description are required.');
    var qty = parseInt(params.qty) || 0;
    sheet.getRange(row, 1).setValue(modelNo);
    sheet.getRange(row, 2).setValue(description);
    sheet.getRange(row, 3).setValue(qty);
    sheet.getRange(row, 4).setValue(new Date());
    _logActivity(_resolveActor(params), 'updated', 'inventory', modelNo,
      modelNo + ' — ' + description + ' (qty ' + qty + ')', qty);
    return { success: true, message: 'Item updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteInventoryItem(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) throw new Error('Invalid row.');
    var sheet = _getInventorySheet();
    var modelNo = '';
    try { modelNo = String(sheet.getRange(row, 1).getValue() || ''); } catch (_) {}
    sheet.deleteRow(row);
    _logActivity(_resolveActor(params), 'deleted', 'inventory', modelNo, modelNo + ' deleted', 0);
    return { success: true, message: 'Item deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════

function handleGetUsers(params) {
  try {
    var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      results.push({
        rowIndex: i + 1,
        username: String(data[i][0]).trim(),
        fullName: String(data[i][3]).trim(),
        role: String(data[i][2]).trim().toLowerCase(),
        trainingMode: (data[i][12] === true || String(data[i][12]).trim().toLowerCase() === 'true' || String(data[i][12]).trim() === '1')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddUser(params) {
  try {
    var username = (params.username || '').trim();
    var password = params.password || '';
    var fullName = (params.fullName || '').trim();
    var role = (params.role || 'sales').trim().toLowerCase();

    if (!username || !password || !fullName) {
      return { success: false, message: 'Username, password, and full name are required.' };
    }
    if (password.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters.' };
    }

    var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var data = sheet.getDataRange().getValues();

    // Check for duplicate username
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === username.toLowerCase()) {
        return { success: false, message: 'Username already exists.' };
      }
    }

    var encodedPassword = Utilities.base64Encode(Utilities.newBlob(password).getBytes());
    var trainingMode = (params.trainingMode === true || String(params.trainingMode).toLowerCase() === 'true');
    sheet.appendRow([username, encodedPassword, role, fullName, '', '', '', '', '', '', '', '', trainingMode ? 'TRUE' : 'FALSE']);

    return { success: true, message: 'User "' + username + '" added successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateUser(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var fullName = (params.fullName || '').trim();
    var role = (params.role || '').trim().toLowerCase();
    var password = params.password || '';

    var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];

    if (fullName) sheet.getRange(rowIndex, 4).setValue(fullName);
    if (role) sheet.getRange(rowIndex, 3).setValue(role);
    if (password && password.length >= 6) {
      var encodedPassword = Utilities.base64Encode(Utilities.newBlob(password).getBytes());
      sheet.getRange(rowIndex, 2).setValue(encodedPassword);
    }
    if (typeof params.trainingMode !== 'undefined') {
      var tm = (params.trainingMode === true || String(params.trainingMode).toLowerCase() === 'true');
      sheet.getRange(rowIndex, 13).setValue(tm ? 'TRUE' : 'FALSE');
    }

    return { success: true, message: 'User updated successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteUser(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var role = String(sheet.getRange(rowIndex, 3).getValue()).trim().toLowerCase();
    if (role === 'admin') return { success: false, message: 'Cannot delete admin users.' };

    sheet.deleteRow(rowIndex);
    return { success: true, message: 'User deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleResetUserPassword(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    // Generate random 10-char alphanumeric password
    var chars = '';
    var tempPassword = '';
    for (var i = 0; i < 10; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    var encodedPassword = Utilities.base64Encode(Utilities.newBlob(tempPassword).getBytes());
    sheet.getRange(rowIndex, 2).setValue(encodedPassword);

    return { success: true, message: 'Password reset successfully.', tempPassword: tempPassword };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteOrder ─────────────────────────
function handleDeleteOrder(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };
    var sheet = _ordersSheet();
    if (rowIndex > sheet.getLastRow()) return { success: false, message: 'Row does not exist.' };
    var orderNo = ''; var client = ''; var amt = 0;
    try {
      var r = sheet.getRange(rowIndex, 1, 1, 7).getValues()[0];
      orderNo = String(r[1] || ''); client = String(r[3] || ''); amt = parseFloat(r[6]) || 0;
    } catch (_) {}
    sheet.deleteRow(rowIndex);
    _logActivity(_resolveActor(params), 'deleted', 'order', orderNo, 'Order ' + orderNo + ' — ' + client, amt);
    return { success: true, message: 'Order deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteExpense ───────────────────────
function handleDeleteExpense(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };
    var sheet = _expensesSheet();
    if (rowIndex > sheet.getLastRow()) return { success: false, message: 'Row does not exist.' };
    var cat = ''; var amt = 0; var desc = '';
    try {
      var r = sheet.getRange(rowIndex, 1, 1, 12).getValues()[0];
      cat = String(r[1] || ''); desc = String(r[4] || ''); amt = parseFloat(r[10]) || 0;
    } catch (_) {}
    sheet.deleteRow(rowIndex);
    _logActivity(_resolveActor(params), 'deleted', 'expense', '', (cat || 'Expense') + ' — ' + desc, amt);
    return { success: true, message: 'Expense deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateExpense(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };
    var sheet = _expensesSheet();
    if (rowIndex > sheet.getLastRow()) return { success: false, message: 'Row does not exist.' };

    var toll = parseFloat(params.toll) || 0;
    var fuel = parseFloat(params.fuel) || 0;
    var meals = parseFloat(params.meals) || 0;
    var loadBalance = parseFloat(params.loadBalance) || 0;
    var otherAmount = parseFloat(params.otherAmount) || 0;
    var total = toll + fuel + meals + loadBalance + otherAmount;

    sheet.getRange(rowIndex, 1, 1, 12).setValues([[
      params.date || formatDate(new Date()),
      params.category || 'Miscellaneous',
      params.orderRef || '',
      params.client || '',
      params.description || '',
      toll, fuel, meals, loadBalance, otherAmount, total,
      params.notes || ''
    ]]);

    _logActivity(_resolveActor(params), 'updated', 'expense',
      params.orderRef || '',
      (params.category || 'Misc') + ' — ' + (params.description || params.client || ''),
      total);

    return { success: true, message: 'Expense updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateSupplierQuotation ─────────────
function handleUpdateSupplierQuotation(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };

    var sheet = _supplierQuotationsSheet();
    var qty = parseInt(params.qty) || 0;
    var pricePerUnit = parseFloat(params.pricePerUnit) || 0;
    var totalAmount = parseFloat(params.totalAmount) || (qty * pricePerUnit);

    sheet.getRange(rowIndex, 1, 1, 17).setValues([[
      params.date || formatDate(new Date()),
      params.supplierCompany || '',
      params.contactPerson || '',
      params.contactNumber || '',
      params.email || '',
      params.referenceNo || '',
      params.itemDescription || '',
      qty,
      pricePerUnit,
      totalAmount,
      params.currency || 'PHP',
      params.remarks || '',
      params.submittedBy || '',
      params.prNumber || '',
      params.prItemDescription || '',
      params.prAgentName || '',
      params.driveFolderLink || ''
    ]]);

    return { success: true, message: 'Supplier quotation updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteSupplierQuotation ──────────────
function handleDeleteSupplierQuotation(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row.' };
    var sheet = _supplierQuotationsSheet();
    sheet.deleteRow(rowIndex);
    return { success: true, message: 'Supplier quotation deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// PO RECORDS (Admin-generated POs awaiting management approval)
// Sheet: PO No | Date | Vendor Name | Vendor Email | Total Amount |
//   Currency | Reference No | Items Summary | Status |
//   Mgmt Approval | Mgmt Notes | Created By | Sent At
// ═══════════════════════════════════════════════════════════════

function _poRecordsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'PO Records', [
    'PO No', 'Date', 'Vendor Name', 'Vendor Email', 'Total Amount',
    'Currency', 'Reference No', 'Items Summary',
    'Status', 'Mgmt Approval', 'Mgmt Notes', 'Created By', 'Sent At',
    'Drive Link', 'Admin Approval', 'Overall Status'
  ]);
}

// ─── RECOVERY: backfill a PO row from an orphan PDF in Drive ───
// Use when a PDF made it to the Purchase Orders folder but the corresponding
// PO Records row was never appended (e.g. async savePORecord network failure).
// Run this manually from the Apps Script editor.
function recoverOrphanPOFromDrive(opts) {
  opts = opts || {};
  var fileName   = String(opts.fileName   || '').trim();
  var poNo       = String(opts.poNo       || '').trim();
  var vendorName = String(opts.vendorName || '').trim();
  if (!fileName || !poNo || !vendorName) {
    return { success: false, message: 'fileName, poNo and vendorName are required.' };
  }

  // Locate the PDF — PO PDFs live in subfolders (Pending / Approved / Rejected)
  // of the PO root folder. Search the root and every subfolder.
  var rootFolder;
  try {
    rootFolder = _getOrCreatePOFolder();
  } catch (e) {
    return { success: false, message: 'Could not open PO root folder: ' + e.message };
  }
  var foundFile = null;
  var foundLocation = '';
  // Recursive search — PDF may be nested several levels deep
  // (e.g. PO root / Pending / Pending / file.pdf)
  function _searchFolder(folder, pathPrefix, depth) {
    if (foundFile || depth > 6) return;
    var hits = folder.getFilesByName(fileName);
    if (hits.hasNext()) {
      foundFile = hits.next();
      foundLocation = pathPrefix;
      return;
    }
    var subs = folder.getFolders();
    while (subs.hasNext() && !foundFile) {
      var sub = subs.next();
      _searchFolder(sub, pathPrefix + '/' + sub.getName(), depth + 1);
    }
  }
  _searchFolder(rootFolder, rootFolder.getName(), 0);
  if (!foundFile) return { success: false, message: 'PDF "' + fileName + '" not found in PO root folder or any subfolder.' };
  var driveLink = 'https://drive.google.com/file/d/' + foundFile.getId() + '/view';
  var fileDate  = Utilities.formatDate(foundFile.getDateCreated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  Logger.log('recoverOrphanPOFromDrive: located "' + fileName + '" in ' + foundLocation);

  // Try to extract Total Amount from the PDF via OCR (Drive advanced service).
  var extractedAmount = 0;
  var extractedItems  = '';
  try {
    var parsed = _extractPOAmountFromPDF(foundFile.getId());
    if (parsed && parsed.amount > 0) {
      extractedAmount = parsed.amount;
      Logger.log('recoverOrphanPOFromDrive: extracted amount ' + extractedAmount + ' from PDF');
    }
    if (parsed && parsed.itemsSummary) extractedItems = parsed.itemsSummary;
  } catch (ocrErr) {
    Logger.log('recoverOrphanPOFromDrive: OCR failed — ' + ocrErr.message + ' (enable Drive API advanced service if needed)');
  }

  var sheet = _poRecordsSheet();
  var data  = sheet.getDataRange().getValues();
  // If row exists, update missing fields in-place instead of refusing.
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === poNo) {
      var rowIdx = i + 1;
      var existingAmt = parseFloat(data[i][4]) || 0;
      var existingItems = String(data[i][7] || '').trim();
      var updates = [];
      if (existingAmt <= 0 && (opts.totalAmount || extractedAmount)) {
        var amtToSet = parseFloat(opts.totalAmount) || extractedAmount;
        sheet.getRange(rowIdx, 5).setValue(amtToSet);
        updates.push('amount=' + amtToSet);
      }
      if ((!existingItems || /Recovered from Drive PDF/i.test(existingItems)) && (opts.itemsSummary || extractedItems)) {
        var itemsToSet = opts.itemsSummary || extractedItems;
        sheet.getRange(rowIdx, 8).setValue(itemsToSet);
        updates.push('itemsSummary');
      }
      return {
        success: true,
        message: updates.length
          ? 'Row for PO ' + poNo + ' updated: ' + updates.join(', ')
          : 'A row for PO No "' + poNo + '" already exists at sheet row ' + rowIdx + ' (no missing fields to fill).'
      };
    }
  }

  return handleSavePORecord({
    poNo:         poNo,
    date:         opts.date         || fileDate,
    vendorName:   vendorName,
    vendorEmail:  opts.vendorEmail  || '',
    totalAmount:  opts.totalAmount  || extractedAmount || 0,
    currency:     opts.currency     || 'PHP',
    referenceNo:  opts.referenceNo  || '',
    itemsSummary: opts.itemsSummary || extractedItems || '(Recovered from Drive PDF — please update amount/items)',
    createdBy:    opts.createdBy    || 'recovery',
    driveLink:    driveLink,
    creatorRole:  opts.creatorRole  || ''
  });
}

// Convert a PDF in Drive to a Google Doc (with OCR), then parse out the
// Total Amount and a short items summary. Requires the Drive advanced
// service (Services > + > Drive) to be enabled in the Apps Script project.
function _extractPOAmountFromPDF(fileId) {
  if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.copy) {
    throw new Error('Drive advanced service not enabled.');
  }
  var copy = Drive.Files.copy(
    { title: '__po_ocr_' + fileId, mimeType: 'application/vnd.google-apps.document' },
    fileId,
    { ocr: true, ocrLanguage: 'en' }
  );
  var docId = copy.id;
  var text  = '';
  try {
    text = DocumentApp.openById(docId).getBody().getText() || '';
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  }
  if (!text) return null;

  // Find a "Total" line (Total, Grand Total, Total Amount, TOTAL PHP, etc.)
  // Grab the largest currency-like number on or near that line.
  var amount = 0;
  var lines = text.split(/\r?\n/);
  var moneyRe = /(?:PHP|USD|₱|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+\.[0-9]{2})/g;
  for (var i = 0; i < lines.length; i++) {
    if (/\b(grand\s+total|total\s+amount|total\s+due|total)\b/i.test(lines[i])) {
      var scanLines = [lines[i], lines[i+1] || '', lines[i+2] || ''];
      for (var k = 0; k < scanLines.length; k++) {
        var m, best = 0;
        moneyRe.lastIndex = 0;
        while ((m = moneyRe.exec(scanLines[k])) !== null) {
          var v = parseFloat(m[1].replace(/,/g, ''));
          if (isFinite(v) && v > best) best = v;
        }
        if (best > amount) amount = best;
      }
    }
  }

  // Items summary: first 3 non-empty lines after an "Item" / "Description" header
  var itemsSummary = '';
  for (var j = 0; j < lines.length; j++) {
    if (/\b(description|item\s*description|particulars)\b/i.test(lines[j])) {
      var picked = [];
      for (var n = j + 1; n < lines.length && picked.length < 3; n++) {
        var ln = lines[n].trim();
        if (ln && !/^\s*(qty|unit|amount|total|subtotal)/i.test(ln)) picked.push(ln);
      }
      if (picked.length) itemsSummary = picked.join(' | ');
      break;
    }
  }

  return { amount: amount, itemsSummary: itemsSummary };
}

// One-shot recovery for the KorWeld PO that was missing from PO Approval.
// Run this once from the Apps Script editor (Run menu > recoverKorWeldPO).
// After it succeeds, open the PO Records sheet and update Total Amount,
// Vendor Email, and Items Summary with the correct values from the PDF.
function recoverKorWeldPO(amountOverride) {
  var opts = {
    fileName:   'Purchase_Order_KorWeld_Inc_Manila_2026-26_KORWELD.pdf',
    poNo:       '2026-26 KORWELD',
    vendorName: 'KorWeld Inc Manila',
    currency:   'PHP'
  };
  if (amountOverride && parseFloat(amountOverride) > 0) {
    opts.totalAmount = parseFloat(amountOverride);
  }
  var res = recoverOrphanPOFromDrive(opts);
  Logger.log(JSON.stringify(res));
  return res;
}

// ─── ACTION: savePORecord ────────────────────────────────────
function handleSavePORecord(params) {
  try {
    var poNo        = params.poNo        || '';
    var date        = params.date        || formatDate(new Date());
    var vendorName  = params.vendorName  || '';
    var vendorEmail = params.vendorEmail || '';
    var totalAmount = parseFloat(params.totalAmount) || 0;
    var currency    = params.currency    || 'PHP';
    var referenceNo = params.referenceNo || '';
    var itemsSummary = params.itemsSummary || '';
    var createdBy   = params.createdBy   || '';
    var driveLink   = params.driveLink   || '';
    var creatorRole = (params.creatorRole || '').toLowerCase();

    if (!poNo)       return { success: false, message: 'PO No is required.' };
    if (!vendorName) return { success: false, message: 'Vendor Name is required.' };

    var sheet = _poRecordsSheet();

    // Check for duplicate PO No
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === poNo) {
        return { success: false, message: 'PO No ' + poNo + ' already exists.' };
      }
    }

    var adminApproval = (creatorRole === 'admin') ? 'Approved' : 'Pending';
    var overallStatus = (creatorRole === 'admin') ? 'Partially Approved' : 'Pending Approval';

    sheet.appendRow([
      poNo, date, vendorName, vendorEmail, totalAmount,
      currency, referenceNo, itemsSummary,
      'Pending', 'Pending', '', createdBy, '',
      driveLink, adminApproval, overallStatus
    ]);

    // Auto-create a shipment tracking record linked to this PO
    _autoCreateShipment(poNo, date, vendorName, referenceNo, itemsSummary);

    return { success: true, message: 'PO record saved.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getPORecords ────────────────────────────────────
function handleGetPORecords(params) {
  try {
    var sheet = _poRecordsSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var statusFilter = params.status || '';
    var search = (params.search || '').toLowerCase();

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var poNo = String(row[0]);
      if (!poNo) continue;
      var rec = {
        poNo:        poNo,
        date:        (row[1] instanceof Date) ? formatDate(row[1]) : String(row[1] || ''),
        vendorName:  row[2],
        vendorEmail: row[3],
        totalAmount: row[4],
        currency:    row[5],
        referenceNo: row[6],
        itemsSummary: row[7],
        status:      row[8],
        mgmtApproval: row[9],
        mgmtNotes:   row[10],
        createdBy:   row[11],
        sentAt:      (row[12] instanceof Date) ? formatDateTime(row[12]) : String(row[12] || ''),
        driveLink:      String(row[13] || ''),
        adminApproval:  String(row[14] || '').trim() || 'Pending',
        overallStatus:  String(row[15] || '').trim() || 'Pending Approval',
        rowIndex:    i + 1
      };
      if (statusFilter && rec.status !== statusFilter) continue;
      if (search) {
        var haystack = (rec.poNo + rec.vendorName + rec.referenceNo).toLowerCase();
        if (haystack.indexOf(search) < 0) continue;
      }
      rows.push(rec);
    }

    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: approvePO ───────────────────────────────────────
// params: poNo, approverRole ('admin'|'management'), decision ('Approved'|'Rejected'), notes
// Backward compat: if params.approval is set and no approverRole, treat as management
function handleApprovePO(params) {
  try {
    var poNo = params.poNo || '';
    var role = (params.approverRole || '').toLowerCase();
    var decision = params.decision || params.approval || '';
    var notes = params.notes || '';

    if (!poNo)     return { success: false, message: 'Missing PO No.' };
    if (!decision) return { success: false, message: 'Missing approval decision.' };
    // Default to management if no role specified (backward compat)
    if (!role) role = 'management';

    var sheet = _poRecordsSheet();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== poNo) continue;
      var row = i + 1;

      if (role === 'admin') {
        // Admin Approval → col 15 (O)
        sheet.getRange(row, 15).setValue(decision);
      } else {
        // Management Approval → col 10 (J), Notes → col 11 (K)
        sheet.getRange(row, 10).setValue(decision);
        sheet.getRange(row, 11).setValue(notes);
      }

      // Re-read the row to compute overall
      var updated = sheet.getRange(row, 1, 1, 16).getValues()[0];
      var adminVal = String(updated[14] || '').trim() || 'Pending';
      var mgmtVal  = String(updated[9] || '').trim() || 'Pending';

      var overall;
      if (adminVal === 'Rejected' || mgmtVal === 'Rejected') {
        overall = 'Rejected';
      } else if (adminVal === 'Approved' && mgmtVal === 'Approved') {
        overall = 'Approved';
      } else if (adminVal === 'Approved' || mgmtVal === 'Approved') {
        overall = 'Partially Approved';
      } else {
        overall = 'Pending Approval';
      }

      // Write Overall Status to col 16 (P) and sync Status col 9 (I)
      sheet.getRange(row, 16).setValue(overall);
      sheet.getRange(row, 9).setValue(overall);

      // Notify PO creator
      var creatorName = String(updated[11] || '').trim();
      if (creatorName && (overall === 'Approved' || overall === 'Rejected')) {
        _addNotification(creatorName, 'po_' + overall.toLowerCase(),
          'PO ' + overall, 'Your PO ' + poNo + ' has been ' + overall.toLowerCase() + '.', '');
      }

      // When fully approved, move PDF from Pending to creator folder
      if (overall === 'Approved') {
        var driveLink   = String(updated[13] || '');
        var creatorName = String(updated[11] || '');
        if (driveLink) {
          try { _movePOToApproved(driveLink, creatorName); } catch (e) {
            Logger.log('PO Drive move error: ' + e.message);
          }
        }
      }

      return { success: true, message: 'PO ' + poNo + ' — ' + decision + '.', overallStatus: overall };
    }
    return { success: false, message: 'PO not found.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: sendPOEmail ─────────────────────────────────────
// params: poNo, to, subject, body
function handleSendPOEmail(params) {
  try {
    var poNo    = params.poNo    || '';
    var to      = params.to      || '';
    var subject = params.subject || '';
    var body    = params.body    || '';
    if (!to)      return { success: false, message: 'Recipient email is required.' };
    if (!subject) return { success: false, message: 'Subject is required.' };
    if (!body)    return { success: false, message: 'Message body is required.' };

    GmailApp.sendEmail(to, subject, body);

    // Mark as Sent in sheet
    if (poNo) {
      var sheet = _poRecordsSheet();
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === poNo) {
          sheet.getRange(i + 1, 9).setValue('Sent to Supplier');  // Status
          sheet.getRange(i + 1, 13).setValue(formatDateTime(new Date())); // Sent At
          sheet.getRange(i + 1, 16).setValue('Sent to Supplier'); // Overall Status
          break;
        }
      }
    }

    return { success: true, message: 'Email sent to ' + to };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: sendAdminEmail ──────────────────────────────────
// params: ref, type ('followup' | 'inquiry'), to, subject, body
function handleSendAdminEmail(params) {
  try {
    var to      = params.to      || '';
    var subject = params.subject || '';
    var body    = params.body    || '';
    if (!to)      return { success: false, message: 'Recipient email is required.' };
    if (!subject) return { success: false, message: 'Subject is required.' };
    if (!body)    return { success: false, message: 'Message body is required.' };
    GmailApp.sendEmail(to, subject, body);
    return { success: true, message: 'Email sent to ' + to };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: sendAcctEmail ───────────────────────────────────
// params: ref, type ('followup' | 'collection'), to, subject, body
function handleSendAcctEmail(params) {
  try {
    var to      = params.to      || '';
    var subject = params.subject || '';
    var body    = params.body    || '';
    if (!to)      return { success: false, message: 'Recipient email is required.' };
    if (!subject) return { success: false, message: 'Subject is required.' };
    if (!body)    return { success: false, message: 'Message body is required.' };
    GmailApp.sendEmail(to, subject, body);
    return { success: true, message: 'Email sent to ' + to };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getPOStats ──────────────────────────────────────
function handleGetPOStats() {
  try {
    var sheet = _poRecordsSheet();
    var data = sheet.getDataRange().getValues();
    var pending = 0, partial = 0, approved = 0, sent = 0, rejected = 0;
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][8]);
      if (status === 'Pending Approval' || status === 'Pending') pending++;
      else if (status === 'Partially Approved') partial++;
      else if (status === 'Approved')    approved++;
      else if (status === 'Sent to Supplier') sent++;
      else if (status === 'Rejected')    rejected++;
    }
    return { success: true, pending: pending, partial: partial, approved: approved, sent: sent, rejected: rejected };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
// Sheet: SO No | Date | Customer ID | Customer Name |
//   Product Code | Product Description | Quantity | Unit Price | Amount |
//   Total Amount | Sales | VAT | Total Amount (w/ VAT) | Status | Invoice No
// ═══════════════════════════════════════════════════════════════

function _salesOrdersSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Sales Orders', [
    'SO No', 'Date', 'Customer ID', 'Customer Name',
    'Product Code', 'Product Description', 'Quantity', 'Unit Price', 'Amount',
    'Total Amount', 'Sales', 'VAT', 'Total Amount (w/ VAT)',
    'Status', 'Invoice No', 'Drive Folder Link', 'VAT Type'
  ]);
}

function _nextSONumber() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = _salesOrdersSheet();
    var now = new Date();
    var mm = ('0' + (now.getMonth() + 1)).slice(-2);
    var yyyy = now.getFullYear();
    var prefix = 'SO-' + yyyy + mm + '-';
    var data = sheet.getDataRange().getValues();
    var max = 0;
    for (var i = 1; i < data.length; i++) {
      var soNo = String(data[i][0]);
      if (soNo.indexOf(prefix) === 0) {
        var seq = parseInt(soNo.replace(prefix, '')) || 0;
        if (seq > max) max = seq;
      }
    }
    return prefix + ('00' + (max + 1)).slice(-3);
  } finally {
    lock.releaseLock();
  }
}

// ─── ACTION: getSalesOrders ──────────────────────────────────
function handleGetSalesOrders(params) {
  try {
    var sheet = _salesOrdersSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var soMap = {};
    var soOrder = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var soNo = String(row[0]);
      if (!soNo) continue;
      if (!soMap[soNo]) {
        soMap[soNo] = {
          soNo: soNo,
          date: (row[1] instanceof Date) ? formatDate(row[1]) : String(row[1] || ''),
          customerId: row[2],
          customerName: row[3],
          totalAmount: row[9],
          sales: row[10],
          vat: row[11],
          grandTotal: row[12],
          status: row[13],
          invoiceNo: row[14],
          driveFolderLink: String(row[15] || ''),
          vatType: String(row[16] || 'VAT Exclusive'),
          items: []
        };
        soOrder.push(soNo);
      }
      soMap[soNo].items.push({
        productCode: row[4],
        productDescription: row[5],
        qty: row[6],
        unitPrice: row[7],
        amount: row[8],
        rowIndex: i + 1
      });
    }

    var statusFilter = params.status || '';
    var search = (params.search || '').toLowerCase();
    var result = soOrder.map(function(k) { return soMap[k]; });
    if (statusFilter) result = result.filter(function(s) { return s.status === statusFilter; });
    if (search) result = result.filter(function(s) {
      return s.soNo.toLowerCase().indexOf(search) >= 0 ||
             s.customerName.toLowerCase().indexOf(search) >= 0 ||
             String(s.invoiceNo || '').toLowerCase().indexOf(search) >= 0;
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: createSalesOrder ────────────────────────────────
function handleCreateSalesOrder(params) {
  try {
    var sheet = _salesOrdersSheet();
    var soNo = params.soNo || _nextSONumber();
    var date = params.date || formatDate(new Date());
    var customerId = params.customerId || '';
    var customerName = params.customerName || '';
    var status = params.status || 'Pending';
    var invoiceNo = params.invoiceNo || '';
    var vatType = params.vatType || 'VAT Exclusive';
    var items = JSON.parse(params.items || '[]');
    if (!items.length) return { success: false, message: 'At least one item is required.' };

    var totalAmount = 0;
    var rows = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var qty = parseFloat(item.qty) || 0;
      var unitPrice = parseFloat(item.unitPrice) || 0;
      var amount = qty * unitPrice;
      totalAmount += amount;
      rows.push([
        soNo, date, customerId, customerName,
        item.productCode || '', item.productDescription || '',
        qty, unitPrice, amount,
        0, 0, 0, 0, // totals filled below
        status, invoiceNo, '', vatType
      ]);
    }

    var sales, vat, grandTotal;
    if (vatType === 'VAT Inclusive') {
      grandTotal = totalAmount;
      vat        = totalAmount * (12 / 112);
      sales      = totalAmount - vat;
    } else if (vatType === 'Zero Rated' || vatType === 'VAT Exempt') {
      sales      = totalAmount;
      vat        = 0;
      grandTotal = totalAmount;
    } else {
      sales      = totalAmount;
      vat        = totalAmount * 0.12;
      grandTotal = totalAmount + vat;
    }

    for (var j = 0; j < rows.length; j++) {
      rows[j][9]  = totalAmount;
      rows[j][10] = sales;
      rows[j][11] = vat;
      rows[j][12] = grandTotal;
      sheet.appendRow(rows[j]);
      _writeCreatedBy(sheet, params.createdBy);
    }

    _logActivity(_resolveActor(params), 'added', 'sales_order', soNo,
      'SO ' + soNo + ' — ' + (params.customerName || ''), grandTotal);

    return { success: true, message: 'Sales Order ' + soNo + ' created.', soNo: soNo };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── AUTO-CREATE Shipment when PO is created ─────────────────
function _autoCreateShipment(poNo, date, principal, clientsPO, item) {
  try {
    var sheet = _shipmentSheet();
    var newId = 'SHM-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') +
                '-' + String(Math.floor(Math.random() * 9000) + 1000);
    sheet.appendRow([
      newId,
      poNo,             // PO No (was SO No)
      '',               // Client (fill in manually)
      clientsPO || '',  // Clients PO = referenceNo from PO
      poNo,             // HI-ESCORP PO = the PO No itself
      principal || '',  // Principal = vendor name
      item || '',       // Item = items summary
      '',               // Mode
      '', '', '',       // Shipment Date, ETD, ETA
      '', '',           // AWB, Logistics
      '', '', '', '', '', // Freight-In, Import Duties, Brokerage, Handling, Delivery Expense
      '',               // Date Arrived
      '', '', '', '',   // Total Amount, Amount Paid, Balance, Date of Payment
      '', '',           // Payment Status, Payment Method
      '', '',           // Sales Invoice, Delivery Receipt
      'Pending', '', date
    ]);
  } catch (e) {
    // Non-critical — silently ignore
  }
}

// ─── ACTION: updateSOStatus ──────────────────────────────────
function handleUpdateSOStatus(params) {
  try {
    var sheet = _salesOrdersSheet();
    var soNo = params.soNo || '';
    var status = params.status || '';
    var invoiceNo = params.invoiceNo;
    var driveFolderLink = params.driveFolderLink || '';
    if (!soNo) return { success: false, message: 'Missing SO No.' };

    var data = sheet.getDataRange().getValues();
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === soNo) {
        if (status) sheet.getRange(i + 1, 14).setValue(status);
        if (invoiceNo !== undefined && invoiceNo !== null) sheet.getRange(i + 1, 15).setValue(invoiceNo);
        if (driveFolderLink) sheet.getRange(i + 1, 16).setValue(driveFolderLink);
        updated++;
      }
    }
    if (!updated) return { success: false, message: 'SO not found.' };
    _logActivity(_resolveActor(params), 'updated', 'sales_order', soNo,
      'SO ' + soNo + ' status → ' + status, 0);
    return { success: true, message: 'Status updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteSalesOrder ────────────────────────────────
// ─── ACTION: updateSalesOrder ────────────────────────────────
// Full replacement of all rows for a given SO No — replaces every detail
// (date, customer, vatType, status, invoice, items). Drive folder link and
// existing "Created By" are preserved when present.
function handleUpdateSalesOrder(params) {
  try {
    var sheet = _salesOrdersSheet();
    var soNo = String(params.soNo || '').trim();
    if (!soNo) return { success: false, message: 'Missing SO No.' };

    var items = JSON.parse(params.items || '[]');
    if (!items.length) return { success: false, message: 'At least one item is required.' };

    var date         = params.date         || formatDate(new Date());
    var customerId   = params.customerId   || '';
    var customerName = params.customerName || '';
    var status       = params.status       || 'Pending';
    var invoiceNo    = params.invoiceNo    || '';
    var vatType      = params.vatType      || 'VAT Exclusive';

    // Capture existing drive link + createdBy from any matching row
    var data = sheet.getDataRange().getValues();
    var existingDriveLink = '';
    var existingCreatedBy = '';
    var createdByCol = _getCreatedByColIdx(sheet); // 0-based
    var rowsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === soNo) {
        if (!existingDriveLink && data[i][15]) existingDriveLink = String(data[i][15]);
        if (createdByCol >= 0 && !existingCreatedBy && data[i][createdByCol]) {
          existingCreatedBy = String(data[i][createdByCol]);
        }
        rowsToDelete.push(i + 1);
      }
    }
    if (!rowsToDelete.length) return { success: false, message: 'SO not found.' };

    // Delete bottom-up
    for (var d = rowsToDelete.length - 1; d >= 0; d--) sheet.deleteRow(rowsToDelete[d]);

    // Compute totals
    var totalAmount = 0;
    var rows = [];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var qty = parseFloat(it.qty) || 0;
      var unitPrice = parseFloat(it.unitPrice) || 0;
      var amount = qty * unitPrice;
      totalAmount += amount;
      rows.push([
        soNo, date, customerId, customerName,
        it.productCode || '', it.productDescription || '',
        qty, unitPrice, amount,
        0, 0, 0, 0,
        status, invoiceNo, existingDriveLink, vatType
      ]);
    }

    var sales, vat, grandTotal;
    if (vatType === 'VAT Inclusive') {
      grandTotal = totalAmount;
      vat        = totalAmount * (12 / 112);
      sales      = totalAmount - vat;
    } else if (vatType === 'Zero Rated' || vatType === 'VAT Exempt') {
      sales      = totalAmount;
      vat        = 0;
      grandTotal = totalAmount;
    } else {
      sales      = totalAmount;
      vat        = totalAmount * 0.12;
      grandTotal = totalAmount + vat;
    }

    for (var r = 0; r < rows.length; r++) {
      rows[r][9]  = totalAmount;
      rows[r][10] = sales;
      rows[r][11] = vat;
      rows[r][12] = grandTotal;
      sheet.appendRow(rows[r]);
      _writeCreatedBy(sheet, existingCreatedBy); // preserve original creator
    }

    _logActivity(_resolveActor(params), 'updated', 'sales_order', soNo,
      'SO ' + soNo + ' edited — ' + (customerName || ''), grandTotal);

    return { success: true, message: 'Sales Order ' + soNo + ' updated.', soNo: soNo };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteSalesOrder(params) {
  try {
    var sheet = _salesOrdersSheet();
    var soNo = params.soNo || '';
    if (!soNo) return { success: false, message: 'Missing SO No.' };

    var data = sheet.getDataRange().getValues();
    var rowsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === soNo) rowsToDelete.push(i + 1);
    }
    for (var j = rowsToDelete.length - 1; j >= 0; j--) {
      sheet.deleteRow(rowsToDelete[j]);
    }
    _logActivity(_resolveActor(params), 'deleted', 'sales_order', soNo, 'SO ' + soNo + ' deleted', 0);
    return { success: true, message: 'Sales Order deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: uploadSODocument ────────────────────────────────
// Uploads a file to Drive: Sales Order root / Customer Name / SO No /
// Also writes the folder link back to column 16 of every matching row.
function handleUploadSODocument(params) {
  try {
    var soNo         = (params.soNo || '').trim();
    var customerName = (params.customerName || '').trim();
    var fileName     = (params.fileName || 'document').trim();
    var fileData     = params.fileData || '';
    var mimeType     = params.mimeType || 'application/octet-stream';

    if (!soNo || !customerName || !fileData) {
      return { success: false, message: 'soNo, customerName and fileData are required.' };
    }

    // Sanitize folder names (Drive dislikes / \ : * ? " < > |)
    var safeName = customerName.replace(/[\/\\:*?"<>|]/g, '_');
    var safeSONo = soNo.replace(/[\/\\:*?"<>|]/g, '_');

    var folder = _getSODocFolder(safeName, safeSONo);
    var folderLink = 'https://drive.google.com/drive/folders/' + folder.getId();

    // Decode and upload
    var decoded = Utilities.base64Decode(fileData);
    var blob = Utilities.newBlob(decoded, mimeType, fileName);
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    var driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    // Persist folder link in sheet (col 16) for all rows of this SO
    var sheet = _salesOrdersSheet();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === soNo) {
        sheet.getRange(i + 1, 16).setValue(folderLink);
      }
    }

    return { success: true, driveLink: driveLink, folderLink: folderLink };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getSODocuments ───────────────────────────────────
// Returns the Drive folder link and a list of files for a given SO.
function handleGetSODocuments(params) {
  try {
    var soNo = (params.soNo || '').trim();
    if (!soNo) return { success: false, message: 'Missing soNo.' };

    // Read the stored folder link from the sheet
    var sheet = _salesOrdersSheet();
    var data = sheet.getDataRange().getValues();
    var folderLink = '';
    var folderId = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === soNo) {
        folderLink = String(data[i][15] || '');
        break;
      }
    }

    if (!folderLink) return { success: true, folderLink: '', files: [] };

    // Extract folder ID from the link
    var match = folderLink.match(/[-\w]{25,}/);
    if (match) folderId = match[0];

    var files = [];
    if (folderId) {
      try {
        var folder = DriveApp.getFolderById(folderId);
        var fileIter = folder.getFiles();
        while (fileIter.hasNext()) {
          var f = fileIter.next();
          files.push({
            name: f.getName(),
            link: 'https://drive.google.com/file/d/' + f.getId() + '/view',
            mimeType: f.getMimeType()
          });
        }
      } catch (e) { /* folder may not be accessible */ }
    }

    return { success: true, folderLink: folderLink, files: files };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getSOStats ───────────────────────────────────────
function handleGetSOStats() {
  try {
    var sheet = _salesOrdersSheet();
    var data = sheet.getDataRange().getValues();
    var pending = {}, delivered = {}, total = {};
    var totalRevenue = 0;
    for (var i = 1; i < data.length; i++) {
      var soNo = String(data[i][0]);
      var status = String(data[i][13]);
      if (!soNo) continue;
      if (!total[soNo]) {
        total[soNo] = true;
        totalRevenue += parseFloat(data[i][12]) || 0;
      }
      if (status === 'Pending') pending[soNo] = true;
      else if (status === 'Delivered') delivered[soNo] = true;
    }
    return {
      success: true,
      pending: Object.keys(pending).length,
      delivered: Object.keys(delivered).length,
      total: Object.keys(total).length,
      totalRevenue: totalRevenue
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════
// PRICING SUBMISSIONS
// ═══════════════════════════════════════════════

function _pricingSubmissionsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheetName = 'Pricing Submissions';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['ID', 'Date', 'Submitted By', 'Principal', 'Destination', 'Items JSON', 'Status',
                     'PR Refs JSON', 'Forwarded By', 'Updated Date', 'Commission Pct', 'Margin Pct']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }
  return sheet;
}

function _priceHistorySheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheetName = 'Price History';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['Date', 'Client', 'Model No', 'Item Name', 'Principal', 'Destination',
                     'Unit Price (VAT-Ex)', 'Commission Pct', 'Margin Pct', 'Submission ID']);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }
  return sheet;
}

function handleGetPriceHistory(params) {
  try {
    var sheet = _priceHistorySheet();
    var data = sheet.getDataRange().getValues();
    var clientFilter = String(params.clientName || '').trim().toLowerCase();
    var records = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (clientFilter && String(row[1] || '').toLowerCase() !== clientFilter) continue;
      records.push({
        date:           String(row[0]),
        client:         String(row[1]),
        modelNo:        String(row[2]),
        itemName:       String(row[3]),
        principal:      String(row[4]),
        destination:    String(row[5]),
        unitPriceVatEx: parseFloat(row[6]) || 0,
        commissionPct:  String(row[7]),
        marginPct:      String(row[8]),
        submissionId:   String(row[9])
      });
    }
    // Return most recent record per modelNo (records in chronological order → last wins)
    var byModel = {};
    records.forEach(function(r) { byModel[r.modelNo] = r; });
    var out = [];
    for (var k in byModel) out.push(byModel[k]);
    return { success: true, data: out };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleSavePricingSubmission(params) {
  try {
    var sheet = _pricingSubmissionsSheet();
    var now = new Date();
    var dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    var existingId = String(params.existingId || '');

    // If existingId provided, find and update that row in-place
    if (existingId) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === existingId) {
          var rowNum = i + 1;
          // Determine status: if Forwarded, set to Priced; otherwise preserve old status
          var oldStatus = String(data[i][6] || '');
          var newStatus = (oldStatus === 'Forwarded') ? 'Priced' : String(params.status || oldStatus || 'Pending');
          sheet.getRange(rowNum, 3).setValue(String(params.submittedBy || data[i][2]));
          sheet.getRange(rowNum, 4).setValue(String(params.principal || ''));
          sheet.getRange(rowNum, 5).setValue(String(params.destination || ''));
          sheet.getRange(rowNum, 6).setValue(String(params.itemsJson || '[]'));
          sheet.getRange(rowNum, 7).setValue(newStatus);
          sheet.getRange(rowNum, 10).setValue(dateStr); // Updated Date
          if (params.commissionPct) sheet.getRange(rowNum, 11).setValue(String(params.commissionPct));
          if (params.marginPct) sheet.getRange(rowNum, 12).setValue(String(params.marginPct));
          _writePriceHistory(params, dateStr, existingId);
          return { success: true, id: existingId, updated: true };
        }
      }
      return { success: false, message: 'Submission ' + existingId + ' not found' };
    }

    // New submission
    var id = 'PRC-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    var status = String(params.status || 'Priced');

    sheet.appendRow([
      id,
      dateStr,
      String(params.submittedBy || ''),
      String(params.principal || ''),
      String(params.destination || ''),
      String(params.itemsJson || '[]'),
      status,
      String(params.prRefsJson || ''),
      String(params.forwardedBy || ''),
      dateStr,
      String(params.commissionPct || ''),
      String(params.marginPct || '')
    ]);

    _writePriceHistory(params, dateStr, id);
    return { success: true, id: id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function _writePriceHistory(params, dateStr, submissionId) {
  try {
    var items = [];
    try { items = JSON.parse(String(params.itemsJson || '[]')); } catch(e) {}
    // Only write items that have a final unit price (i.e., management has priced them)
    var pricedItems = items.filter(function(it) { return parseFloat(it.unitPriceVatEx) > 0; });
    if (!pricedItems.length) return;
    var prRefs = [];
    try { prRefs = JSON.parse(String(params.prRefsJson || '[]')); } catch(e) {}
    var clientName = prRefs.length > 0 ? String(prRefs[0].clientName || '') : '';
    var histSheet = _priceHistorySheet();
    pricedItems.forEach(function(it) {
      histSheet.appendRow([
        dateStr,
        clientName,
        String(it.modelNo || ''),
        String(it.name || ''),
        String(params.principal || ''),
        String(params.destination || ''),
        parseFloat(it.unitPriceVatEx) || 0,
        String(params.commissionPct || ''),
        String(params.marginPct || ''),
        String(submissionId || '')
      ]);
    });
  } catch(e) {}
}

function handleGetPricingSubmissions(params) {
  try {
    var sheet = _pricingSubmissionsSheet();
    var data = sheet.getDataRange().getValues();
    var statusFilter = String(params.status || '').trim();
    var records = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      var rowStatus = String(row[6] || 'Pending');
      if (statusFilter && rowStatus !== statusFilter) continue;
      records.push({
        id: String(row[0]),
        date: String(row[1]),
        submittedBy: String(row[2]),
        principal: String(row[3]),
        destination: String(row[4]),
        itemsJson: String(row[5]),
        status: rowStatus,
        prRefsJson: String(row[7] || ''),
        forwardedBy: String(row[8] || ''),
        updatedDate: String(row[9] || ''),
        commissionPct: String(row[10] || ''),
        marginPct: String(row[11] || ''),
        rowIndex: i + 1
      });
    }
    records.reverse();
    return { success: true, data: records };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: forwardPRToPricing (admin forwards PR items to management) ──
function handleForwardPRToPricing(params) {
  try {
    var prRefsJson = String(params.prRefsJson || '[]');
    var forwardedBy = String(params.forwardedBy || '');
    var itemsJson = String(params.itemsJson || '[]');
    var principal = String(params.principal || '');
    var destination = String(params.destination || '');

    if (!forwardedBy) return { success: false, message: 'forwardedBy is required' };

    var refs = JSON.parse(prRefsJson);
    if (!refs.length) return { success: false, message: 'No PR items to forward' };
    if (refs.length > 20) return { success: false, message: 'Maximum 20 items per submission' };

    // Update each PR item's status to "For Pricing" in their respective sheets
    for (var r = 0; r < refs.length; r++) {
      try {
        var prSheet = SpreadsheetApp.openById(refs[r].sheetId).getSheets()[0];
        var rowIdx = parseInt(refs[r].rowIndex);
        prSheet.getRange(rowIdx, 11).setValue('For Pricing'); // Col K (11) = Status
      } catch (e) { /* skip if sheet access fails */ }
    }

    var sheet = _pricingSubmissionsSheet();
    var now = new Date();
    var id = 'PRC-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    var dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

    sheet.appendRow([
      id,
      dateStr,
      '',         // Submitted By (management fills on submit)
      principal,
      destination,
      itemsJson,  // items with buyPrice from admin
      'Forwarded',
      prRefsJson,
      forwardedBy,
      '',         // Updated Date
      '',         // Commission Pct
      ''          // Margin Pct
    ]);

    // Notify sales agents whose PRs were forwarded
    var notifiedAgents = {};
    for (var n = 0; n < refs.length; n++) {
      var sid = String(refs[n].sheetId || '');
      if (sid && !notifiedAgents[sid]) {
        notifiedAgents[sid] = true;
        var agentName = _getAgentNameByPRSheetId(sid);
        if (agentName) {
          _addNotification(agentName, 'pr_for_pricing', 'PR Forwarded for Pricing',
            'Your purchase request items have been forwarded for pricing.', '');
        }
      }
    }

    return { success: true, id: id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: applyPricingToPR (admin applies priced submission back to PR sheets) ──
function handleApplyPricingToPR(params) {
  try {
    var submissionId = String(params.submissionId || '');
    if (!submissionId) return { success: false, message: 'submissionId is required' };

    var sheet = _pricingSubmissionsSheet();
    var data = sheet.getDataRange().getValues();
    var targetRow = -1;
    var row;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === submissionId) {
        targetRow = i + 1;
        row = data[i];
        break;
      }
    }
    if (targetRow === -1) return { success: false, message: 'Submission not found' };

    var status = String(row[6] || '');
    if (status !== 'Priced') return { success: false, message: 'Submission must be in Priced status to apply' };

    var prRefsJson = String(row[7] || '');
    if (!prRefsJson) return { success: false, message: 'No PR references in this submission' };

    var prRefs = JSON.parse(prRefsJson);
    var items = JSON.parse(String(row[5] || '[]'));

    var applied = 0;
    var errors = [];
    for (var j = 0; j < prRefs.length; j++) {
      var ref = prRefs[j];
      try {
        var prSheet = SpreadsheetApp.openById(ref.sheetId).getSheets()[0];
        var rowIdx = parseInt(ref.rowIndex);
        // Match item by index (prRefs and items are parallel arrays)
        var item = items[j];
        if (!item) { errors.push('Item #' + (j + 1) + ': no matching pricing data'); continue; }
        var unitPriceVatEx = parseFloat(item.unitPriceVatEx || 0);
        if (unitPriceVatEx <= 0) { errors.push('Item #' + (j + 1) + ': unit price is zero or invalid'); continue; }
        // Write unit price (VAT exclusive) to col M (13)
        prSheet.getRange(rowIdx, 13).setValue(unitPriceVatEx);
        // Read quantity from col H (8)
        var qty = parseFloat(prSheet.getRange(rowIdx, 8).getValue()) || 0;
        var totalPrice = qty * unitPriceVatEx;
        // Write total price to col N (14)
        prSheet.getRange(rowIdx, 14).setValue(totalPrice);
        // Update status to "For Quotation" in col K (11)
        prSheet.getRange(rowIdx, 11).setValue('For Quotation');
        applied++;
      } catch (e) {
        errors.push('Row ' + (ref.rowIndex || '?') + ': ' + e.message);
      }
    }

    // Update status to Applied
    sheet.getRange(targetRow, 7).setValue('Applied');
    var now = new Date();
    sheet.getRange(targetRow, 10).setValue(Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));

    // Notify sales agents whose PRs were priced
    var notifiedAgents = {};
    for (var na = 0; na < prRefs.length; na++) {
      var sid = String(prRefs[na].sheetId || '');
      if (sid && !notifiedAgents[sid]) {
        notifiedAgents[sid] = true;
        var agentName = _getAgentNameByPRSheetId(sid);
        if (agentName) {
          _addNotification(agentName, 'pr_priced', 'PR Pricing Applied',
            'Your purchase request items have been priced and are ready for quotation.', '');
        }
      }
    }

    return { success: true, applied: applied, errors: errors };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: markSentToSales (admin confirms pricing has been forwarded to sales agent) ──
function handleMarkSentToSales(params) {
  try {
    var submissionId = String(params.submissionId || '');
    if (!submissionId) return { success: false, message: 'submissionId is required' };

    var sheet = _pricingSubmissionsSheet();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === submissionId) {
        var curStatus = String(data[i][6]);
        if (curStatus !== 'Applied' && curStatus !== 'Priced' && curStatus !== 'Pending') {
          return { success: false, message: 'Submission must be Pending, Priced, or Applied before forwarding to sales' };
        }
        sheet.getRange(i + 1, 7).setValue('Sent to Sales');
        var now = new Date();
        sheet.getRange(i + 1, 10).setValue(Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));

        // Notify sales agents
        var prRefsJson2 = String(data[i][7] || '');
        if (prRefsJson2) {
          try {
            var prRefs2 = JSON.parse(prRefsJson2);
            var notifiedAgents = {};
            for (var na = 0; na < prRefs2.length; na++) {
              var sid = String(prRefs2[na].sheetId || '');
              if (sid && !notifiedAgents[sid]) {
                notifiedAgents[sid] = true;
                var agentName = _getAgentNameByPRSheetId(sid);
                if (agentName) {
                  _addNotification(agentName, 'pr_sent_to_sales', 'PR Ready',
                    'Your priced purchase request items are ready. Check your pending items.', '');
                }
              }
            }
          } catch (e2) { /* ignore parse errors */ }
        }

        return { success: true };
      }
    }
    return { success: false, message: 'Submission not found' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// HR-MARKETING MODULE
// ═══════════════════════════════════════════════════════════════

// ─── Sheet Helpers ────────────────────────────────────────────

function _hrDailyReportsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'HR Daily Reports', [
    'Date', 'HR Name', 'Recruitment Activity', 'Onboarding Activity',
    'Employee Admin', 'Marketing Activity', 'Submitted At'
  ]);
}

function _recruitmentSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Recruitment Pipeline', [
    'Candidate Name', 'Position', 'Stage', 'Date Applied',
    'Assigned HR', 'Notes', 'Created At', 'Updated At'
  ]);
}

function _hrTasksSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'HR Tasks', [
    'Title', 'Type', 'Assigned To', 'Status', 'Due Date',
    'Notes', 'Completed Date', 'Created At', 'Created By'
  ]);
}

function _employeesSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Employee Masterlist', [
    'Employee Name', 'Position', 'Department', 'Date Hired',
    'Onboarding Status', 'Contact Info', 'Notes', 'Created At', 'Updated At', 'Birthdate', 'Leave Balance'
  ]);
}

// ─── Notifications sheet + helper ──────────────────────────────
function _notificationsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Notifications', [
    'ID', 'Date', 'Recipient', 'Type', 'Title', 'Message', 'Link', 'Read', 'Created At'
  ]);
}

function _getAgentNameByPRSheetId(prSheetId) {
  try {
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var data = usersSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === prSheetId) return String(data[i][3]).trim();
    }
  } catch (e) { Logger.log('_getAgentNameByPRSheetId error: ' + e.message); }
  return '';
}

function _addNotification(recipient, type, title, message, link) {
  try {
    var sheet = _notificationsSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var id = Utilities.getUuid();
    sheet.appendRow([id, formatDate(new Date()), recipient, type, title, message, link || '', 'FALSE', now]);
  } catch (e) {
    Logger.log('_addNotification error: ' + e.message);
  }
}

function handleGetMyNotifications(params) {
  try {
    var username = (params.username || '').trim().toLowerCase();
    var role = (params.role || '').trim().toLowerCase();
    if (!username && !role) return { success: true, data: [] };

    var sheet = _notificationsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][7]).trim() === 'TRUE') continue; // already read
      var recipient = String(data[i][2]).trim().toLowerCase();
      if (recipient !== username && recipient !== role) continue;

      results.push({
        id: String(data[i][0]),
        date: String(data[i][1]),
        type: String(data[i][3]),
        title: String(data[i][4]),
        message: String(data[i][5]),
        link: String(data[i][6]),
        createdAt: String(data[i][8])
      });
    }

    // Sort by date desc, limit 50
    results.sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
    results = results.slice(0, 50);

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleMarkNotificationsRead(params) {
  try {
    var username = (params.username || '').trim().toLowerCase();
    if (!username) return { success: false, message: 'Missing username.' };

    var sheet = _notificationsSheet();
    var data = sheet.getDataRange().getValues();
    var count = 0;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][7]).trim() === 'TRUE') continue;
      var recipient = String(data[i][2]).trim().toLowerCase();
      if (recipient !== username) continue;
      sheet.getRange(i + 1, 8).setValue('TRUE');
      count++;
    }

    return { success: true, message: count + ' notification(s) marked as read.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: submitHRDailyReport ──────────────────────────────
function handleSubmitHRDailyReport(params) {
  try {
    var hrName = params.hrName || '';
    if (!hrName) return { success: false, message: 'HR name is required.' };

    var recruitmentActivity = params.recruitmentActivity || '[]';
    var onboardingActivity = params.onboardingActivity || '[]';
    var employeeAdmin = params.employeeAdmin || '[]';
    var marketingActivity = params.marketingActivity || '[]';
    var otherTasks = params.otherTasks || '[]';
    var otherTaskParagraph = params.otherTaskParagraph || '';
    var snapshotData = params.snapshotData || '';
    var notes = params.notes || '';

    var sheet = _hrDailyReportsSheet();
    if (sheet.getLastColumn() < 10) sheet.getRange(1, 10).setValue('Snapshot Data');
    if (sheet.getLastColumn() < 11) sheet.getRange(1, 11).setValue('Notes');

    // Duplicate check
    var todayStr = formatDate(new Date());
    var rData = sheet.getDataRange().getValues();
    for (var i = 1; i < rData.length; i++) {
      var parsedDate = parseSheetDate(rData[i][0]);
      var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();
      var rowName = String(rData[i][1]).trim();
      if (rowDate === todayStr && rowName.toLowerCase() === hrName.toLowerCase()) {
        return { success: false, message: 'You have already submitted a report for today.' };
      }
    }

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([todayStr, hrName, recruitmentActivity, onboardingActivity, employeeAdmin, marketingActivity, otherTasks, otherTaskParagraph, now, snapshotData, notes]);

    return { success: true, message: 'HR daily report submitted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getHRDailyReports ────────────────────────────────
function handleGetHRDailyReports(params) {
  try {
    var filterName = params.hrName || '';
    var filterDate = params.date || '';

    var sheet = _hrDailyReportsSheet();
    var data = sheet.getDataRange().getValues();
    var reports = {};

    for (var i = 1; i < data.length; i++) {
      var parsedDate = parseSheetDate(data[i][0]);
      var rowDate = parsedDate ? formatDate(parsedDate) : String(data[i][0]).trim();
      var rowName = String(data[i][1]).trim();

      if (filterName && rowName.toLowerCase() !== filterName.toLowerCase()) continue;
      if (filterDate && rowDate !== filterDate) continue;

      reports[rowName.toLowerCase()] = {
        rowIndex: i + 1,
        date: rowDate,
        hrName: rowName,
        submitted: true,
        recruitmentActivity: String(data[i][2] || '[]'),
        onboardingActivity: String(data[i][3] || '[]'),
        employeeAdmin: String(data[i][4] || '[]'),
        marketingActivity: String(data[i][5] || '[]'),
        otherTasks: String(data[i][6] || '[]'),
        otherTaskParagraph: String(data[i][7] || ''),
        submittedAt: String(data[i][8] || data[i][6] || ''),
        snapshotData: String(data[i][9] || ''),
        notes: String(data[i][10] || '')
      };
    }

    // When called without filter (from getAllDailyReports), return all HR users
    if (!filterName) {
      var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
      var usersSheet = ss.getSheets()[0];
      var usersData = usersSheet.getDataRange().getValues();
      var results = [];
      for (var j = 1; j < usersData.length; j++) {
        var role = String(usersData[j][2]).trim().toLowerCase();
        if (role !== 'hr') continue;
        var fullName = String(usersData[j][3]).trim();
        var key = fullName.toLowerCase();
        if (reports[key]) {
          results.push(reports[key]);
        } else {
          results.push({ hrName: fullName, submitted: false });
        }
      }
      return { success: true, data: results };
    }

    var results = [];
    for (var k in reports) { results.push(reports[k]); }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getRecruitmentPipeline ───────────────────────────
function handleGetRecruitmentPipeline(params) {
  try {
    var sheet = _recruitmentSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var appliedDate = parseSheetDate(data[i][3]);
      results.push({
        rowIndex: i + 1,
        candidateName: String(data[i][0] || '').trim(),
        position: String(data[i][1] || '').trim(),
        stage: String(data[i][2] || '').trim(),
        dateApplied: appliedDate ? formatDate(appliedDate) : String(data[i][3] || '').trim(),
        assignedHR: String(data[i][4] || '').trim(),
        notes: String(data[i][5] || '').trim(),
        createdAt: String(data[i][6] || ''),
        updatedAt: String(data[i][7] || '')
      });
    }

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: addCandidate ─────────────────────────────────────
function handleAddCandidate(params) {
  try {
    var name = (params.candidateName || '').trim();
    if (!name) return { success: false, message: 'Candidate name is required.' };

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var sheet = _recruitmentSheet();
    sheet.appendRow([
      name,
      (params.position || '').trim(),
      params.stage || 'Job Posted',
      (params.dateApplied || formatDate(new Date())),
      (params.assignedHR || '').trim(),
      (params.notes || '').trim(),
      now, now
    ]);

    return { success: true, message: 'Candidate added successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateCandidate ──────────────────────────────────
function handleUpdateCandidate(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = _recruitmentSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    if (params.candidateName !== undefined) sheet.getRange(rowIndex, 1).setValue(params.candidateName);
    if (params.position !== undefined) sheet.getRange(rowIndex, 2).setValue(params.position);
    if (params.stage !== undefined) sheet.getRange(rowIndex, 3).setValue(params.stage);
    if (params.dateApplied !== undefined) sheet.getRange(rowIndex, 4).setValue(params.dateApplied);
    if (params.assignedHR !== undefined) sheet.getRange(rowIndex, 5).setValue(params.assignedHR);
    if (params.notes !== undefined) sheet.getRange(rowIndex, 6).setValue(params.notes);
    sheet.getRange(rowIndex, 8).setValue(now); // Updated At

    // Auto-create employee when candidate reaches Onboarding or Complete stage
    if (params.stage === 'Onboarding' || params.stage === 'Complete') {
      try {
        var candidateName = String(sheet.getRange(rowIndex, 1).getValue()).trim();
        var position = String(sheet.getRange(rowIndex, 2).getValue()).trim();
        if (candidateName) {
          var empSheet = _employeesSheet();
          var empData = empSheet.getDataRange().getValues();
          var exists = false;
          for (var e = 1; e < empData.length; e++) {
            if (String(empData[e][0]).trim().toLowerCase() === candidateName.toLowerCase()) { exists = true; break; }
          }
          if (!exists) {
            var todayStr = formatDate(new Date());
            empSheet.appendRow([candidateName, position, '', todayStr, 'Onboarding', '', 'Auto-created from recruitment', now, now, '', 15]);
          }
        }
      } catch (autoErr) { Logger.log('Auto-create employee error: ' + autoErr.message); }
    }

    return { success: true, message: 'Candidate updated successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteCandidate ──────────────────────────────────
function handleDeleteCandidate(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = _recruitmentSheet();
    sheet.deleteRow(rowIndex);

    return { success: true, message: 'Candidate deleted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getRecruitmentStats ──────────────────────────────
function handleGetRecruitmentStats(params) {
  try {
    var sheet = _recruitmentSheet();
    var data = sheet.getDataRange().getValues();
    var stats = { total: 0, byStage: {} };
    var stages = ['Job Posted', 'Resume Screening', 'Initial Interview', 'Final Interview', 'Job Offer', 'Onboarding', 'Complete'];

    stages.forEach(function(s) { stats.byStage[s] = 0; });

    for (var i = 1; i < data.length; i++) {
      stats.total++;
      var stage = String(data[i][2] || '').trim();
      if (stats.byStage[stage] !== undefined) {
        stats.byStage[stage]++;
      }
    }

    return { success: true, data: stats };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getHRTasks ───────────────────────────────────────
function handleGetHRTasks(params) {
  try {
    var filterStatus = params.status || '';
    var filterType = params.type || '';
    var filterAssigned = params.assignedTo || '';

    var sheet = _hrTasksSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][3] || '').trim();
      var type = String(data[i][1] || '').trim();
      var assigned = String(data[i][2] || '').trim();

      if (filterStatus && status.toLowerCase() !== filterStatus.toLowerCase()) continue;
      if (filterType && type.toLowerCase() !== filterType.toLowerCase()) continue;
      if (filterAssigned && assigned.toLowerCase() !== filterAssigned.toLowerCase()) continue;

      var dueDate = parseSheetDate(data[i][4]);
      var completedDate = parseSheetDate(data[i][6]);

      results.push({
        rowIndex: i + 1,
        title: String(data[i][0] || '').trim(),
        type: type,
        assignedTo: assigned,
        status: status,
        dueDate: dueDate ? formatDate(dueDate) : String(data[i][4] || '').trim(),
        notes: String(data[i][5] || '').trim(),
        completedDate: completedDate ? formatDate(completedDate) : String(data[i][6] || '').trim(),
        createdAt: String(data[i][7] || ''),
        createdBy: String(data[i][8] || '').trim()
      });
    }

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: addHRTask ────────────────────────────────────────
function handleAddHRTask(params) {
  try {
    var title = (params.title || '').trim();
    if (!title) return { success: false, message: 'Task title is required.' };

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var sheet = _hrTasksSheet();
    sheet.appendRow([
      title,
      params.type || 'HR',
      (params.assignedTo || '').trim(),
      params.status || 'Pending',
      (params.dueDate || '').trim(),
      (params.notes || '').trim(),
      '', // Completed Date
      now,
      (params.createdBy || '').trim()
    ]);

    return { success: true, message: 'Task added successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateHRTask ─────────────────────────────────────
function handleUpdateHRTask(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = _hrTasksSheet();

    if (params.title !== undefined) sheet.getRange(rowIndex, 1).setValue(params.title);
    if (params.type !== undefined) sheet.getRange(rowIndex, 2).setValue(params.type);
    if (params.assignedTo !== undefined) sheet.getRange(rowIndex, 3).setValue(params.assignedTo);
    if (params.status !== undefined) {
      sheet.getRange(rowIndex, 4).setValue(params.status);
      // Auto-set completed date
      if (params.status === 'Completed') {
        var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        sheet.getRange(rowIndex, 7).setValue(now);
      }
    }
    if (params.dueDate !== undefined) sheet.getRange(rowIndex, 5).setValue(params.dueDate);
    if (params.notes !== undefined) sheet.getRange(rowIndex, 6).setValue(params.notes);

    return { success: true, message: 'Task updated successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteHRTask ─────────────────────────────────────
function handleDeleteHRTask(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = _hrTasksSheet();
    sheet.deleteRow(rowIndex);

    return { success: true, message: 'Task deleted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getHRTaskStats ───────────────────────────────────
function handleGetHRTaskStats(params) {
  try {
    var sheet = _hrTasksSheet();
    var data = sheet.getDataRange().getValues();
    var stats = { total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0, byType: { HR: 0, Marketing: 0 } };
    var today = formatDate(new Date());

    for (var i = 1; i < data.length; i++) {
      stats.total++;
      var status = String(data[i][3] || '').trim();
      var type = String(data[i][1] || '').trim();

      if (status === 'Pending') stats.pending++;
      else if (status === 'In Progress') stats.inProgress++;
      else if (status === 'Completed') stats.completed++;

      if (type === 'HR') stats.byType.HR++;
      else if (type === 'Marketing') stats.byType.Marketing++;

      // Check overdue
      if (status !== 'Completed') {
        var dueDate = parseSheetDate(data[i][4]);
        if (dueDate && formatDate(dueDate) < today) {
          stats.overdue++;
        }
      }
    }

    return { success: true, data: stats };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getEmployees ─────────────────────────────────────
function handleGetEmployees(params) {
  try {
    var sheet = _employeesSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var hireDate = parseSheetDate(data[i][3]);
      results.push({
        rowIndex: i + 1,
        employeeName: String(data[i][0] || '').trim(),
        position: String(data[i][1] || '').trim(),
        department: String(data[i][2] || '').trim(),
        dateHired: hireDate ? formatDate(hireDate) : String(data[i][3] || '').trim(),
        onboardingStatus: String(data[i][4] || '').trim(),
        contactInfo: String(data[i][5] || '').trim(),
        notes: String(data[i][6] || '').trim(),
        createdAt: String(data[i][7] || ''),
        updatedAt: String(data[i][8] || ''),
        birthdate: String(data[i][9] || '')
      });
    }

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: addEmployee ──────────────────────────────────────
function handleAddEmployee(params) {
  try {
    var name = (params.employeeName || '').trim();
    if (!name) return { success: false, message: 'Employee name is required.' };

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var sheet = _employeesSheet();
    sheet.appendRow([
      name,
      (params.position || '').trim(),
      (params.department || '').trim(),
      (params.dateHired || '').trim(),
      params.onboardingStatus || 'Pending',
      (params.contactInfo || '').trim(),
      (params.notes || '').trim(),
      now, now,
      (params.birthdate || '').trim()
    ]);

    return { success: true, message: 'Employee added successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateEmployee ───────────────────────────────────
function handleUpdateEmployee(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = _employeesSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    if (params.employeeName !== undefined) sheet.getRange(rowIndex, 1).setValue(params.employeeName);
    if (params.position !== undefined) sheet.getRange(rowIndex, 2).setValue(params.position);
    if (params.department !== undefined) sheet.getRange(rowIndex, 3).setValue(params.department);
    if (params.dateHired !== undefined) sheet.getRange(rowIndex, 4).setValue(params.dateHired);
    if (params.onboardingStatus !== undefined) sheet.getRange(rowIndex, 5).setValue(params.onboardingStatus);
    if (params.contactInfo !== undefined) sheet.getRange(rowIndex, 6).setValue(params.contactInfo);
    if (params.notes !== undefined) sheet.getRange(rowIndex, 7).setValue(params.notes);
    if (params.birthdate !== undefined) sheet.getRange(rowIndex, 10).setValue(params.birthdate);
    sheet.getRange(rowIndex, 9).setValue(now); // Updated At

    return { success: true, message: 'Employee updated successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteEmployee ───────────────────────────────────
function handleDeleteEmployee(params) {
  try {
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'Invalid row index.' };

    var sheet = _employeesSheet();
    sheet.deleteRow(rowIndex);

    return { success: true, message: 'Employee deleted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getHRSummary ─────────────────────────────────────
function handleGetHRSummary(params) {
  try {
    // Recruitment stats
    var recSheet = _recruitmentSheet();
    var recData = recSheet.getDataRange().getValues();
    var openPositions = 0;
    var onboarding = 0;
    for (var i = 1; i < recData.length; i++) {
      var stage = String(recData[i][2] || '').trim();
      if (stage !== 'Complete') openPositions++;
      if (stage === 'Onboarding') onboarding++;
    }

    // Task stats
    var taskSheet = _hrTasksSheet();
    var taskData = taskSheet.getDataRange().getValues();
    var tasksCompleted = 0;
    var tasksPending = 0;
    for (var j = 1; j < taskData.length; j++) {
      var status = String(taskData[j][3] || '').trim();
      if (status === 'Completed') tasksCompleted++;
      else tasksPending++;
    }

    // Employee count
    var empSheet = _employeesSheet();
    var empData = empSheet.getDataRange().getValues();
    var totalEmployees = Math.max(empData.length - 1, 0);

    return {
      success: true,
      data: {
        openPositions: openPositions,
        onboarding: onboarding,
        tasksCompleted: tasksCompleted,
        tasksPending: tasksPending,
        totalEmployees: totalEmployees
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  10 NEW HR FEATURES — Sheet Helpers
// ═══════════════════════════════════════════════════════════════

function _leaveRequestsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Leave Requests', [
    'Employee', 'Type', 'Start Date', 'End Date', 'Days', 'Reason', 'Status', 'Approved By', 'Notes', 'Created At'
  ]);
}

function _performanceReviewsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Performance Reviews', [
    'Employee', 'Reviewer', 'Period', 'Rating', 'Category Scores', 'Strengths', 'Areas for Improvement', 'Status', 'Created At', 'Updated At'
  ]);
}

function _trainingSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Training Programs', [
    'Title', 'Type', 'Instructor', 'Date', 'Duration', 'Department', 'Attendees', 'Status', 'Notes', 'Created At'
  ]);
}

function _memosSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Memos', [
    'Title', 'Content', 'Type', 'Priority', 'Created By', 'Target', 'Status', 'Created At'
  ]);
}

function _grievancesSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Grievances', [
    'Subject', 'Description', 'Submitted By', 'Anonymous', 'Category', 'Status', 'Assigned To', 'Resolution', 'Created At', 'Resolved At'
  ]);
}

function _campaignsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Marketing Campaigns', [
    'Name', 'Channel', 'Start Date', 'End Date', 'Budget', 'Spend', 'Leads', 'Status', 'Notes', 'Created By', 'Created At', 'Updated At'
  ]);
}

function _contentCalendarSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Content Calendar', [
    'Title', 'Type', 'Platform', 'Scheduled Date', 'Status', 'Content', 'Notes', 'Created By', 'Created At'
  ]);
}

function _accreditationsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Accreditations', [
    'Name', 'Issuing Body', 'Date Issued', 'Expiry Date', 'Status', 'Document Link', 'Notes', 'Created At', 'Updated At'
  ]);
}

// ═══════════════════════════════════════════════════════════════
//  LEAVE & ATTENDANCE HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetLeaveRequests(params) {
  try {
    var sheet = _leaveRequestsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterEmployee = (params.employee || '').toLowerCase();
    var filterStatus = (params.status || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var emp = String(data[i][0] || '');
      var status = String(data[i][6] || '');
      if (filterEmployee && emp.toLowerCase() !== filterEmployee) continue;
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      var requesterRole = '';
      try { requesterRole = _lookupUserRole(emp) || ''; } catch (e) { requesterRole = ''; }
      results.push({
        rowIndex: i + 1,
        employee: emp,
        type: String(data[i][1] || ''),
        startDate: String(data[i][2] || ''),
        endDate: String(data[i][3] || ''),
        days: Number(data[i][4]) || 0,
        reason: String(data[i][5] || ''),
        status: status,
        approvedBy: String(data[i][7] || ''),
        notes: String(data[i][8] || ''),
        createdAt: String(data[i][9] || ''),
        requesterRole: requesterRole
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetLeaveStats(params) {
  try {
    var sheet = _leaveRequestsSheet();
    var data = sheet.getDataRange().getValues();
    var pending = 0, approved = 0, rejected = 0;
    for (var i = 1; i < data.length; i++) {
      var s = String(data[i][6] || '').trim();
      if (s === 'Pending') pending++;
      else if (s === 'Approved') approved++;
      else if (s === 'Rejected') rejected++;
    }
    return { success: true, data: { pending: pending, approved: approved, rejected: rejected, total: data.length - 1 } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddLeaveRequest(params) {
  try {
    if (!params.employee || !params.type || !params.startDate || !params.endDate) {
      return { success: false, message: 'Employee, type, start date, and end date are required.' };
    }
    var sheet = _leaveRequestsSheet();
    var now = new Date();

    // Generate PDF and upload to Drive (per-user subfolder).
    var pdfUrl = '';
    try {
      var up = _uploadLeaveRequestPdfToDrive(params);
      if (up && up.success) pdfUrl = up.url;
    } catch (e) { Logger.log('Leave PDF upload failed: ' + e.message); }

    var notes = params.notes || '';
    if (pdfUrl) notes = notes ? (notes + ' | PDF: ' + pdfUrl) : ('PDF: ' + pdfUrl);

    sheet.appendRow([
      params.employee, params.type, params.startDate, params.endDate,
      Number(params.days) || 1, params.reason || '', 'Pending', '',
      notes, Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss')
    ]);
    return { success: true, message: 'Leave request submitted.', pdfUrl: pdfUrl };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateLeaveRequest(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _leaveRequestsSheet();

    // Role-gated approval: only HR or Management can approve sales;
    // only Management can approve non-sales requests.
    if (params.status === 'Approved' || params.status === 'Rejected') {
      var approverRole = String(params.approverRole || '').toLowerCase();
      if (approverRole) {
        var existingEmp = String(sheet.getRange(row, 1).getValue() || '').trim();
        var empName = params.employee || existingEmp;
        var requesterRole = _lookupUserRole(empName);
        var allowed = false;
        if (requesterRole === 'sales') {
          allowed = (approverRole === 'hr' || approverRole === 'management');
        } else {
          allowed = (approverRole === 'management');
        }
        if (!allowed) {
          return { success: false, message: 'Not authorized to approve this request.' };
        }
      }
    }

    if (params.employee) sheet.getRange(row, 1).setValue(params.employee);
    if (params.type) sheet.getRange(row, 2).setValue(params.type);
    if (params.startDate) sheet.getRange(row, 3).setValue(params.startDate);
    if (params.endDate) sheet.getRange(row, 4).setValue(params.endDate);
    if (params.days) sheet.getRange(row, 5).setValue(Number(params.days));
    if (params.reason !== undefined) sheet.getRange(row, 6).setValue(params.reason);
    if (params.status) sheet.getRange(row, 7).setValue(params.status);
    if (params.approvedBy) sheet.getRange(row, 8).setValue(params.approvedBy);
    if (params.notes !== undefined) sheet.getRange(row, 9).setValue(params.notes);

    // Leave balance decrement on approval + notification
    if (params.status === 'Approved' || params.status === 'Rejected') {
      var empName = params.employee || String(sheet.getRange(row, 1).getValue()).trim();
      var days = Number(params.days || sheet.getRange(row, 5).getValue()) || 0;

      if (params.status === 'Approved' && empName && days > 0) {
        try {
          var empSheet = _employeesSheet();
          var empData = empSheet.getDataRange().getValues();
          for (var e = 1; e < empData.length; e++) {
            if (String(empData[e][0]).trim().toLowerCase() === empName.toLowerCase()) {
              var currentBalance = Number(empData[e][10]) || 0;
              empSheet.getRange(e + 1, 11).setValue(currentBalance - days);
              break;
            }
          }
        } catch (balErr) { Logger.log('Leave balance error: ' + balErr.message); }
      }

      _addNotification(empName, 'leave_' + params.status.toLowerCase(),
        'Leave ' + params.status,
        'Your leave request (' + days + ' day(s)) has been ' + params.status.toLowerCase() + '.', '');
    }
    return { success: true, message: 'Leave request updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteLeaveRequest(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _leaveRequestsSheet().deleteRow(row);
    return { success: true, message: 'Leave request deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getEmployeeHistory ─────────────────────────────────
function handleGetEmployeeHistory(params) {
  try {
    var empName = (params.employeeName || '').trim();
    if (!empName) return { success: false, message: 'Employee name required.' };
    var nameLower = empName.toLowerCase();

    // Grievances
    var grievances = [];
    try {
      var gSheet = _grievancesSheet();
      var gData = gSheet.getDataRange().getValues();
      for (var i = 1; i < gData.length; i++) {
        if (String(gData[i][2]).trim().toLowerCase() !== nameLower) continue;
        grievances.push({
          subject: String(gData[i][0]), description: String(gData[i][1]),
          category: String(gData[i][4]), status: String(gData[i][5]),
          resolution: String(gData[i][7]), createdAt: String(gData[i][8])
        });
      }
    } catch (e) {}

    // Memos targeting this employee or 'All'
    var memos = [];
    try {
      var mSheet = _memosSheet();
      var mData = mSheet.getDataRange().getValues();
      for (var j = 1; j < mData.length; j++) {
        var target = String(mData[j][5]).trim().toLowerCase();
        if (target !== nameLower && target !== 'all') continue;
        memos.push({
          title: String(mData[j][0]), content: String(mData[j][1]),
          type: String(mData[j][2]), priority: String(mData[j][3]),
          createdBy: String(mData[j][4]), createdAt: String(mData[j][7])
        });
      }
    } catch (e) {}

    // Leave requests
    var leaves = [];
    try {
      var lSheet = _leaveRequestsSheet();
      var lData = lSheet.getDataRange().getValues();
      for (var k = 1; k < lData.length; k++) {
        if (String(lData[k][0]).trim().toLowerCase() !== nameLower) continue;
        leaves.push({
          type: String(lData[k][1]), startDate: String(lData[k][2]),
          endDate: String(lData[k][3]), days: Number(lData[k][4]) || 0,
          reason: String(lData[k][5]), status: String(lData[k][6])
        });
      }
    } catch (e) {}

    // Training programs
    var training = [];
    try {
      var tSheet = _trainingSheet();
      var tData = tSheet.getDataRange().getValues();
      for (var t = 1; t < tData.length; t++) {
        var attendeesRaw = String(tData[t][6] || '');
        var attendees = [];
        try { attendees = JSON.parse(attendeesRaw); } catch (e) {
          attendees = attendeesRaw.split(',').map(function(s) { return s.trim(); });
        }
        var found = false;
        for (var a = 0; a < attendees.length; a++) {
          if (String(attendees[a]).trim().toLowerCase() === nameLower) { found = true; break; }
        }
        if (!found) continue;
        training.push({
          title: String(tData[t][0]), type: String(tData[t][1]),
          instructor: String(tData[t][2]), date: String(tData[t][3]),
          department: String(tData[t][5]), status: String(tData[t][7])
        });
      }
    } catch (e) {}

    return { success: true, grievances: grievances, memos: memos, leaves: leaves, training: training };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  PERFORMANCE REVIEWS HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetPerformanceReviews(params) {
  try {
    var sheet = _performanceReviewsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterEmp = (params.employee || '').toLowerCase();
    var filterStatus = (params.status || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var emp = String(data[i][0] || '');
      var status = String(data[i][7] || '');
      if (filterEmp && emp.toLowerCase() !== filterEmp) continue;
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      results.push({
        rowIndex: i + 1,
        employee: emp,
        reviewer: String(data[i][1] || ''),
        period: String(data[i][2] || ''),
        rating: Number(data[i][3]) || 0,
        categoryScores: String(data[i][4] || ''),
        strengths: String(data[i][5] || ''),
        areasForImprovement: String(data[i][6] || ''),
        status: status,
        createdAt: String(data[i][8] || ''),
        updatedAt: String(data[i][9] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddPerformanceReview(params) {
  try {
    if (!params.employee || !params.reviewer || !params.period) {
      return { success: false, message: 'Employee, reviewer, and period are required.' };
    }
    var sheet = _performanceReviewsSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.employee, params.reviewer, params.period,
      Number(params.rating) || 0, params.categoryScores || '',
      params.strengths || '', params.areasForImprovement || '',
      params.status || 'Draft', now, now
    ]);
    return { success: true, message: 'Performance review added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdatePerformanceReview(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _performanceReviewsSheet();
    if (params.employee) sheet.getRange(row, 1).setValue(params.employee);
    if (params.reviewer) sheet.getRange(row, 2).setValue(params.reviewer);
    if (params.period) sheet.getRange(row, 3).setValue(params.period);
    if (params.rating !== undefined) sheet.getRange(row, 4).setValue(Number(params.rating));
    if (params.categoryScores !== undefined) sheet.getRange(row, 5).setValue(params.categoryScores);
    if (params.strengths !== undefined) sheet.getRange(row, 6).setValue(params.strengths);
    if (params.areasForImprovement !== undefined) sheet.getRange(row, 7).setValue(params.areasForImprovement);
    if (params.status) sheet.getRange(row, 8).setValue(params.status);
    sheet.getRange(row, 10).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss'));
    return { success: true, message: 'Performance review updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeletePerformanceReview(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _performanceReviewsSheet().deleteRow(row);
    return { success: true, message: 'Performance review deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  TRAINING & DEVELOPMENT HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetTrainingPrograms(params) {
  try {
    var sheet = _trainingSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterStatus = (params.status || '').toLowerCase();
    var filterType = (params.type || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][7] || '');
      var type = String(data[i][1] || '');
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      if (filterType && type.toLowerCase() !== filterType) continue;
      results.push({
        rowIndex: i + 1,
        title: String(data[i][0] || ''),
        type: type,
        instructor: String(data[i][2] || ''),
        date: String(data[i][3] || ''),
        duration: String(data[i][4] || ''),
        department: String(data[i][5] || ''),
        attendees: (function() { var raw = String(data[i][6] || ''); try { return JSON.parse(raw); } catch(e) { return raw ? raw.split(',').map(function(s){return s.trim();}) : []; } })(),
        status: status,
        notes: String(data[i][8] || ''),
        createdAt: String(data[i][9] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddTrainingProgram(params) {
  try {
    if (!params.title || !params.type) {
      return { success: false, message: 'Title and type are required.' };
    }
    var sheet = _trainingSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.title, params.type, params.instructor || '',
      params.date || '', params.duration || '', params.department || '',
      params.attendees || '', params.status || 'Scheduled',
      params.notes || '', now
    ]);
    return { success: true, message: 'Training program added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateTrainingProgram(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _trainingSheet();
    if (params.title) sheet.getRange(row, 1).setValue(params.title);
    if (params.type) sheet.getRange(row, 2).setValue(params.type);
    if (params.instructor !== undefined) sheet.getRange(row, 3).setValue(params.instructor);
    if (params.date) sheet.getRange(row, 4).setValue(params.date);
    if (params.duration !== undefined) sheet.getRange(row, 5).setValue(params.duration);
    if (params.department) sheet.getRange(row, 6).setValue(params.department);
    if (params.attendees !== undefined) {
      var att = params.attendees;
      sheet.getRange(row, 7).setValue(Array.isArray(att) ? JSON.stringify(att) : att);
    }
    if (params.status) sheet.getRange(row, 8).setValue(params.status);
    if (params.notes !== undefined) sheet.getRange(row, 9).setValue(params.notes);
    return { success: true, message: 'Training program updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteTrainingProgram(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _trainingSheet().deleteRow(row);
    return { success: true, message: 'Training program deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  MEMO & ANNOUNCEMENT HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetMemos(params) {
  try {
    var sheet = _memosSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterType = (params.type || '').toLowerCase();
    var filterStatus = (params.status || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var type = String(data[i][2] || '');
      var status = String(data[i][6] || '');
      if (filterType && type.toLowerCase() !== filterType) continue;
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      results.push({
        rowIndex: i + 1,
        title: String(data[i][0] || ''),
        content: String(data[i][1] || ''),
        type: type,
        priority: String(data[i][3] || ''),
        createdBy: String(data[i][4] || ''),
        target: String(data[i][5] || ''),
        status: status,
        createdAt: String(data[i][7] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddMemo(params) {
  try {
    if (!params.title || !params.content) {
      return { success: false, message: 'Title and content are required.' };
    }
    var sheet = _memosSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.title, params.content, params.type || 'Memo',
      params.priority || 'Normal', params.createdBy || '',
      params.target || 'All', params.status || 'Active', now
    ]);
    return { success: true, message: 'Memo created.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateMemo(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _memosSheet();
    if (params.title) sheet.getRange(row, 1).setValue(params.title);
    if (params.content !== undefined) sheet.getRange(row, 2).setValue(params.content);
    if (params.type) sheet.getRange(row, 3).setValue(params.type);
    if (params.priority) sheet.getRange(row, 4).setValue(params.priority);
    if (params.target) sheet.getRange(row, 6).setValue(params.target);
    if (params.status) sheet.getRange(row, 7).setValue(params.status);
    return { success: true, message: 'Memo updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteMemo(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _memosSheet().deleteRow(row);
    return { success: true, message: 'Memo deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  GRIEVANCE & COMPLAINT HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetGrievances(params) {
  try {
    var sheet = _grievancesSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterStatus = (params.status || '').toLowerCase();
    var filterCategory = (params.category || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][5] || '');
      var category = String(data[i][4] || '');
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      if (filterCategory && category.toLowerCase() !== filterCategory) continue;
      results.push({
        rowIndex: i + 1,
        subject: String(data[i][0] || ''),
        description: String(data[i][1] || ''),
        submittedBy: String(data[i][2] || ''),
        anonymous: String(data[i][3] || ''),
        category: category,
        status: status,
        assignedTo: String(data[i][6] || ''),
        resolution: String(data[i][7] || ''),
        createdAt: String(data[i][8] || ''),
        resolvedAt: String(data[i][9] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddGrievance(params) {
  try {
    if (!params.subject || !params.description) {
      return { success: false, message: 'Subject and description are required.' };
    }
    var sheet = _grievancesSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.subject, params.description, params.submittedBy || '',
      params.anonymous || 'No', params.category || 'General',
      'Open', params.assignedTo || '', '', now, ''
    ]);
    return { success: true, message: 'Grievance submitted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateGrievance(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _grievancesSheet();
    if (params.subject) sheet.getRange(row, 1).setValue(params.subject);
    if (params.description !== undefined) sheet.getRange(row, 2).setValue(params.description);
    if (params.category) sheet.getRange(row, 5).setValue(params.category);
    if (params.status) sheet.getRange(row, 6).setValue(params.status);
    if (params.assignedTo !== undefined) sheet.getRange(row, 7).setValue(params.assignedTo);
    if (params.resolution !== undefined) sheet.getRange(row, 8).setValue(params.resolution);
    if (params.status === 'Resolved') {
      sheet.getRange(row, 10).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss'));
    }
    return { success: true, message: 'Grievance updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteGrievance(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _grievancesSheet().deleteRow(row);
    return { success: true, message: 'Grievance deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  MARKETING CAMPAIGN HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetCampaigns(params) {
  try {
    var sheet = _campaignsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterStatus = (params.status || '').toLowerCase();
    var filterChannel = (params.channel || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][7] || '');
      var channel = String(data[i][1] || '');
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      if (filterChannel && channel.toLowerCase() !== filterChannel) continue;
      results.push({
        rowIndex: i + 1,
        name: String(data[i][0] || ''),
        channel: channel,
        startDate: String(data[i][2] || ''),
        endDate: String(data[i][3] || ''),
        budget: Number(data[i][4]) || 0,
        spend: Number(data[i][5]) || 0,
        leads: Number(data[i][6]) || 0,
        status: status,
        notes: String(data[i][8] || ''),
        createdBy: String(data[i][9] || ''),
        createdAt: String(data[i][10] || ''),
        updatedAt: String(data[i][11] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetCampaignStats(params) {
  try {
    var sheet = _campaignsSheet();
    var data = sheet.getDataRange().getValues();
    var active = 0, completed = 0, totalBudget = 0, totalSpend = 0, totalLeads = 0;
    for (var i = 1; i < data.length; i++) {
      var s = String(data[i][7] || '').trim();
      if (s === 'Active') active++;
      else if (s === 'Completed') completed++;
      totalBudget += Number(data[i][4]) || 0;
      totalSpend += Number(data[i][5]) || 0;
      totalLeads += Number(data[i][6]) || 0;
    }
    return { success: true, data: { active: active, completed: completed, total: data.length - 1, totalBudget: totalBudget, totalSpend: totalSpend, totalLeads: totalLeads } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddCampaign(params) {
  try {
    if (!params.name || !params.channel) {
      return { success: false, message: 'Name and channel are required.' };
    }
    var sheet = _campaignsSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.name, params.channel, params.startDate || '', params.endDate || '',
      Number(params.budget) || 0, Number(params.spend) || 0, Number(params.leads) || 0,
      params.status || 'Planning', params.notes || '', params.createdBy || '', now, now
    ]);
    return { success: true, message: 'Campaign added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateCampaign(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _campaignsSheet();
    if (params.name) sheet.getRange(row, 1).setValue(params.name);
    if (params.channel) sheet.getRange(row, 2).setValue(params.channel);
    if (params.startDate) sheet.getRange(row, 3).setValue(params.startDate);
    if (params.endDate) sheet.getRange(row, 4).setValue(params.endDate);
    if (params.budget !== undefined) sheet.getRange(row, 5).setValue(Number(params.budget));
    if (params.spend !== undefined) sheet.getRange(row, 6).setValue(Number(params.spend));
    if (params.leads !== undefined) sheet.getRange(row, 7).setValue(Number(params.leads));
    if (params.status) sheet.getRange(row, 8).setValue(params.status);
    if (params.notes !== undefined) sheet.getRange(row, 9).setValue(params.notes);
    sheet.getRange(row, 12).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss'));
    return { success: true, message: 'Campaign updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteCampaign(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _campaignsSheet().deleteRow(row);
    return { success: true, message: 'Campaign deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  CONTENT & SOCIAL MEDIA CALENDAR HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetContentCalendar(params) {
  try {
    var sheet = _contentCalendarSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterStatus = (params.status || '').toLowerCase();
    var filterPlatform = (params.platform || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][4] || '');
      var platform = String(data[i][2] || '');
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      if (filterPlatform && platform.toLowerCase() !== filterPlatform) continue;
      results.push({
        rowIndex: i + 1,
        title: String(data[i][0] || ''),
        type: String(data[i][1] || ''),
        platform: platform,
        scheduledDate: String(data[i][3] || ''),
        status: status,
        content: String(data[i][5] || ''),
        notes: String(data[i][6] || ''),
        createdBy: String(data[i][7] || ''),
        createdAt: String(data[i][8] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddContentItem(params) {
  try {
    if (!params.title || !params.type || !params.platform) {
      return { success: false, message: 'Title, type, and platform are required.' };
    }
    var sheet = _contentCalendarSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.title, params.type, params.platform, params.scheduledDate || '',
      params.status || 'Draft', params.content || '', params.notes || '',
      params.createdBy || '', now
    ]);
    return { success: true, message: 'Content item added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateContentItem(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _contentCalendarSheet();
    if (params.title) sheet.getRange(row, 1).setValue(params.title);
    if (params.type) sheet.getRange(row, 2).setValue(params.type);
    if (params.platform) sheet.getRange(row, 3).setValue(params.platform);
    if (params.scheduledDate) sheet.getRange(row, 4).setValue(params.scheduledDate);
    if (params.status) sheet.getRange(row, 5).setValue(params.status);
    if (params.content !== undefined) sheet.getRange(row, 6).setValue(params.content);
    if (params.notes !== undefined) sheet.getRange(row, 7).setValue(params.notes);
    return { success: true, message: 'Content item updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteContentItem(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _contentCalendarSheet().deleteRow(row);
    return { success: true, message: 'Content item deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getCampaignLeadsSummary ────────────────────────────
function handleGetCampaignLeadsSummary(params) {
  try {
    var campaignSheet = _campaignsSheet();
    var cData = campaignSheet.getDataRange().getValues();

    // Collect all client names from agents' quotation sheets
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var allClients = {};
    for (var u = 1; u < usersData.length; u++) {
      var role = String(usersData[u][2]).trim().toLowerCase();
      if (role === 'admin' || role === 'management') continue;
      var agentName = String(usersData[u][3]).trim();
      var qSheetId = String(usersData[u][4]).trim();
      if (!qSheetId) continue;
      try {
        var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
        var qData = qSheet.getDataRange().getValues();
        for (var q = 1; q < qData.length; q++) {
          var clientName = String(qData[q][5] || '').trim().toLowerCase();
          if (clientName && !allClients[clientName]) {
            allClients[clientName] = agentName;
          }
        }
      } catch (e) {}
    }

    var campaigns = [];
    for (var c = 1; c < cData.length; c++) {
      var leadsRaw = String(cData[c][6] || '');
      var leads = [];
      try { leads = JSON.parse(leadsRaw); } catch (e) {
        leads = leadsRaw ? leadsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
      }

      var matchedClients = 0;
      var leadDetails = leads.map(function(lead) {
        var leadLower = String(lead).toLowerCase();
        var agent = allClients[leadLower] || '';
        if (agent) matchedClients++;
        return { name: lead, matched: !!agent, agent: agent };
      });

      campaigns.push({
        name: String(cData[c][0] || ''),
        channel: String(cData[c][1] || ''),
        status: String(cData[c][7] || ''),
        leadCount: leads.length,
        matchedClients: matchedClients,
        leads: leadDetails
      });
    }

    return { success: true, campaigns: campaigns };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  ACCREDITATION & COMPLIANCE HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetAccreditations(params) {
  try {
    var sheet = _accreditationsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    var filterStatus = (params.status || '').toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][4] || '');
      if (filterStatus && status.toLowerCase() !== filterStatus) continue;
      results.push({
        rowIndex: i + 1,
        name: String(data[i][0] || ''),
        issuingBody: String(data[i][1] || ''),
        dateIssued: String(data[i][2] || ''),
        expiryDate: String(data[i][3] || ''),
        status: status,
        documentLink: String(data[i][5] || ''),
        notes: String(data[i][6] || ''),
        createdAt: String(data[i][7] || ''),
        updatedAt: String(data[i][8] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddAccreditation(params) {
  try {
    if (!params.name || !params.issuingBody) {
      return { success: false, message: 'Name and issuing body are required.' };
    }
    var sheet = _accreditationsSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    sheet.appendRow([
      params.name, params.issuingBody, params.dateIssued || '',
      params.expiryDate || '', params.status || 'Active',
      params.documentLink || '', params.notes || '', now, now
    ]);
    return { success: true, message: 'Accreditation added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateAccreditation(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    var sheet = _accreditationsSheet();
    if (params.name) sheet.getRange(row, 1).setValue(params.name);
    if (params.issuingBody) sheet.getRange(row, 2).setValue(params.issuingBody);
    if (params.dateIssued) sheet.getRange(row, 3).setValue(params.dateIssued);
    if (params.expiryDate) sheet.getRange(row, 4).setValue(params.expiryDate);
    if (params.status) sheet.getRange(row, 5).setValue(params.status);
    if (params.documentLink !== undefined) sheet.getRange(row, 6).setValue(params.documentLink);
    if (params.notes !== undefined) sheet.getRange(row, 7).setValue(params.notes);
    sheet.getRange(row, 9).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss'));
    return { success: true, message: 'Accreditation updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteAccreditation(params) {
  try {
    var row = parseInt(params.rowIndex);
    if (!row || row < 2) return { success: false, message: 'Invalid row index.' };
    _accreditationsSheet().deleteRow(row);
    return { success: true, message: 'Accreditation deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  HR ANALYTICS & BIRTHDAY/ANNIVERSARY HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleGetHRAnalytics(params) {
  try {
    var period = params.period || 'month';
    var now = new Date();

    // Employee stats
    var empSheet = _employeesSheet();
    var empData = empSheet.getDataRange().getValues();
    var totalEmp = Math.max(empData.length - 1, 0);
    var deptCounts = {};
    for (var i = 1; i < empData.length; i++) {
      var dept = String(empData[i][2] || 'Unassigned').trim();
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    }

    // Recruitment funnel
    var recSheet = _recruitmentSheet();
    var recData = recSheet.getDataRange().getValues();
    var stageCounts = {};
    for (var j = 1; j < recData.length; j++) {
      var stage = String(recData[j][2] || '').trim();
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }

    // Leave stats
    var leaveSheet = _leaveRequestsSheet();
    var leaveData = leaveSheet.getDataRange().getValues();
    var leavePending = 0, leaveApproved = 0;
    for (var k = 1; k < leaveData.length; k++) {
      var ls = String(leaveData[k][6] || '').trim();
      if (ls === 'Pending') leavePending++;
      else if (ls === 'Approved') leaveApproved++;
    }

    // Task completion
    var taskSheet = _hrTasksSheet();
    var taskData = taskSheet.getDataRange().getValues();
    var tDone = 0, tTotal = Math.max(taskData.length - 1, 0);
    for (var m = 1; m < taskData.length; m++) {
      if (String(taskData[m][3] || '').trim() === 'Completed') tDone++;
    }

    // Campaign stats
    var campSheet = _campaignsSheet();
    var campData = campSheet.getDataRange().getValues();
    var activeCampaigns = 0, totalLeads = 0;
    for (var n = 1; n < campData.length; n++) {
      if (String(campData[n][7] || '').trim() === 'Active') activeCampaigns++;
      totalLeads += Number(campData[n][6]) || 0;
    }

    // Grievance stats
    var gSheet = _grievancesSheet();
    var gData = gSheet.getDataRange().getValues();
    var openGrievances = 0;
    for (var p = 1; p < gData.length; p++) {
      var gs = String(gData[p][5] || '').trim();
      if (gs === 'Open' || gs === 'Under Investigation') openGrievances++;
    }

    return {
      success: true,
      data: {
        totalEmployees: totalEmp,
        departmentBreakdown: deptCounts,
        recruitmentFunnel: stageCounts,
        leavePending: leavePending,
        leaveApproved: leaveApproved,
        taskCompletion: { done: tDone, total: tTotal },
        activeCampaigns: activeCampaigns,
        totalLeads: totalLeads,
        openGrievances: openGrievances
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetBirthdayAnniversary(params) {
  try {
    var sheet = _employeesSheet();
    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var currentMonth = now.getMonth();
    var currentDay = now.getDate();
    var upcoming = [];

    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][0] || '');
      var dateHired = data[i][3];
      var birthdate = data[i][8]; // Column I — Birthdate

      // Check work anniversary
      if (dateHired) {
        var hd = new Date(dateHired);
        if (!isNaN(hd.getTime())) {
          var hMonth = hd.getMonth();
          var hDay = hd.getDate();
          var daysDiff = ((hMonth - currentMonth) * 30) + (hDay - currentDay);
          if (daysDiff >= 0 && daysDiff <= 30) {
            var years = now.getFullYear() - hd.getFullYear();
            upcoming.push({ name: name, type: 'Anniversary', date: (hMonth + 1) + '/' + hDay, detail: years + ' year(s)', daysAway: daysDiff });
          }
        }
      }

      // Check birthday
      if (birthdate) {
        var bd = new Date(birthdate);
        if (!isNaN(bd.getTime())) {
          var bMonth = bd.getMonth();
          var bDay = bd.getDate();
          var bDiff = ((bMonth - currentMonth) * 30) + (bDay - currentDay);
          if (bDiff >= 0 && bDiff <= 30) {
            upcoming.push({ name: name, type: 'Birthday', date: (bMonth + 1) + '/' + bDay, detail: '', daysAway: bDiff });
          }
        }
      }
    }

    upcoming.sort(function(a, b) { return a.daysAway - b.daysAway; });
    return { success: true, data: upcoming };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════
// NEW HANDLERS: My Daily Reports, Quotation Notifications,
//               PR-Quotation Linkage, Accounting Report,
//               All Daily Reports Aggregation
// ═══════════════════════════════════════════════════════

// ─── ACTION: getMyDailyReports (sales agent's own report history) ──
function handleGetMyDailyReports(params) {
  try {
    var agentName = params.agentName || '';
    if (!agentName) return { success: false, message: 'agentName required' };

    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var reportSheet = ss.getSheetByName('Daily Reports');
    if (!reportSheet) return { success: true, data: [] };

    var rData = reportSheet.getDataRange().getValues();
    var reports = [];

    for (var i = 1; i < rData.length; i++) {
      var rowAgent = String(rData[i][1]).trim();
      if (rowAgent.toLowerCase() !== agentName.toLowerCase()) continue;

      var parsedDate = parseSheetDate(rData[i][0]);
      var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();

      var callDetails = [];
      try { callDetails = JSON.parse(String(rData[i][9] || '[]')); } catch (e) {}
      var leadsEmailDetails = [];
      try { leadsEmailDetails = JSON.parse(String(rData[i][10] || '[]')); } catch (e) {}
      var followUpEmailDetails = [];
      try { followUpEmailDetails = JSON.parse(String(rData[i][11] || '[]')); } catch (e) {}
      var urgentIssues = [];
      try { urgentIssues = JSON.parse(String(rData[i][12] || '[]')); } catch (e) {}

      reports.push({
        date: rowDate,
        quotationsSent: parseInt(rData[i][2]) || 0,
        prsSent: parseInt(rData[i][3]) || 0,
        leadsEmails: parseInt(rData[i][4]) || 0,
        followUpEmails: parseInt(rData[i][5]) || 0,
        totalCalls: parseInt(rData[i][6]) || 0,
        successfulCalls: parseInt(rData[i][7]) || 0,
        unsuccessfulCalls: parseInt(rData[i][8]) || 0,
        callDetails: callDetails,
        leadsEmailDetails: leadsEmailDetails,
        followUpEmailDetails: followUpEmailDetails,
        urgentIssues: urgentIssues,
        submittedAt: String(rData[i][13] || ''),
        otherTask: String(rData[i][15] || '')
      });
    }

    // Sort by date descending
    reports.sort(function(a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : 0; });

    return { success: true, data: reports };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getMyQuotationNotifications (recently approved/rejected) ──
function handleGetMyQuotationNotifications(params) {
  try {
    var agentName = params.agentName || '';
    var qSheetId = params.quotationSheetId || '';
    if (!qSheetId) return { success: true, data: [] };

    var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
    var qData = qSheet.getDataRange().getValues();
    var notifications = [];
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    for (var j = 1; j < qData.length; j++) {
      var overallStatus = String(qData[j][14] || '').trim();
      if (overallStatus !== 'Approved' && overallStatus !== 'Rejected') continue;

      var rowDate = parseSheetDate(qData[j][0]);
      if (!rowDate || rowDate < cutoff) continue;

      notifications.push({
        refNo: String(qData[j][2]).trim(),
        clientName: String(qData[j][5]).trim(),
        status: overallStatus,
        date: formatDate(rowDate),
        amount: qData[j][8] || '',
        rejectionReason: String(qData[j][16] || '').trim() || String(qData[j][17] || '').trim()
      });
    }

    return { success: true, data: notifications };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: linkPRToQuotation (auto-update PR status by RFQ match) ──
function handleLinkPRToQuotation(params) {
  try {
    var rfqNo = String(params.rfqNo || '').trim();
    var prSheetId = params.prSheetId || '';
    var quotationRef = params.quotationRef || '';
    if (!rfqNo || !prSheetId) return { success: false, message: 'rfqNo and prSheetId required' };

    var pSheet = SpreadsheetApp.openById(prSheetId).getSheets()[0];
    var pData = pSheet.getDataRange().getValues();
    var updated = 0;

    for (var j = 1; j < pData.length; j++) {
      var rowRef = String(pData[j][2] || '').trim(); // col C = RFQ/reference number
      if (rowRef.toLowerCase() !== rfqNo.toLowerCase()) continue;

      var currentStatus = String(pData[j][10] || '').trim();
      // Don't overwrite if already Approved or Quoted
      if (currentStatus === 'Approved' || currentStatus === 'Quoted') continue;

      pSheet.getRange(j + 1, 11).setValue('Quoted'); // col K = status (index 10, 1-based = 11)
      updated++;
    }

    return { success: true, updatedCount: updated, quotationRef: quotationRef };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: submitAccountingDailyReport ──────────────────────
function handleSubmitAccountingDailyReport(params) {
  try {
    var accountantName = params.accountantName || '';
    if (!accountantName) return { success: false, message: 'Accountant name is required.' };

    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var sheet = ss.getSheetByName('Accounting Daily Reports');

    if (!sheet) {
      sheet = ss.insertSheet('Accounting Daily Reports');
      sheet.appendRow([
        'Date', 'Accountant Name', 'Payments Processed', 'Invoices Issued',
        'Collections Received', 'Bank Reconciliation', 'Expenses Processed',
        'Other Tasks', 'Submitted At', 'Snapshot Data', 'Notes'
      ]);
    } else {
      if (sheet.getLastColumn() < 10) sheet.getRange(1, 10).setValue('Snapshot Data');
      if (sheet.getLastColumn() < 11) sheet.getRange(1, 11).setValue('Notes');
    }

    var snapshotData = params.snapshotData || '';
    var notes = params.notes || '';

    // Duplicate check
    var todayStr = formatDate(new Date());
    var rData = sheet.getDataRange().getValues();
    for (var i = 1; i < rData.length; i++) {
      var parsedDate = parseSheetDate(rData[i][0]);
      var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();
      var rowName = String(rData[i][1]).trim();
      if (rowDate === todayStr && rowName.toLowerCase() === accountantName.toLowerCase()) {
        return { success: false, message: 'You have already submitted a report for today.' };
      }
    }

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([
      todayStr, accountantName,
      params.paymentsProcessed || '[]',
      params.invoicesIssued || '[]',
      params.collectionsReceived || '[]',
      params.bankReconciliation || '',
      params.expensesProcessed || '[]',
      params.otherTasks || '',
      now,
      snapshotData,
      notes
    ]);

    return { success: true, message: 'Accounting daily report submitted successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getAccountingDailyReports ────────────────────────
function handleGetAccountingDailyReports(params) {
  try {
    var filterDate = params.date || '';
    var filterName = params.accountantName || '';
    var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
    var sheet = ss.getSheetByName('Accounting Daily Reports');

    var reports = {};
    if (sheet) {
      var rData = sheet.getDataRange().getValues();
      for (var i = 1; i < rData.length; i++) {
        var parsedDate = parseSheetDate(rData[i][0]);
        var rowDate = parsedDate ? formatDate(parsedDate) : String(rData[i][0]).trim();
        var rowName = String(rData[i][1]).trim();

        if (filterDate && rowDate !== filterDate) continue;
        if (filterName && rowName.toLowerCase() !== filterName.toLowerCase()) continue;

        var payments = [];
        try { payments = JSON.parse(String(rData[i][2] || '[]')); } catch (e) {}
        var invoices = [];
        try { invoices = JSON.parse(String(rData[i][3] || '[]')); } catch (e) {}
        var collections = [];
        try { collections = JSON.parse(String(rData[i][4] || '[]')); } catch (e) {}
        var expenses = [];
        try { expenses = JSON.parse(String(rData[i][6] || '[]')); } catch (e) {}

        reports[rowName.toLowerCase()] = {
          date: rowDate,
          accountantName: rowName,
          submitted: true,
          paymentsProcessed: payments,
          invoicesIssued: invoices,
          collectionsReceived: collections,
          bankReconciliation: String(rData[i][5] || ''),
          expensesProcessed: expenses,
          otherTasks: String(rData[i][7] || ''),
          submittedAt: String(rData[i][8] || ''),
          snapshotData: String(rData[i][9] || ''),
          notes: String(rData[i][10] || '')
        };
      }
    }

    // When called without filter (from getAllDailyReports), return all accounting users
    if (!filterName) {
      var usersSheet = ss.getSheets()[0];
      var usersData = usersSheet.getDataRange().getValues();
      var results = [];
      for (var j = 1; j < usersData.length; j++) {
        var role = String(usersData[j][2]).trim().toLowerCase();
        if (role !== 'accounting') continue;
        var fullName = String(usersData[j][3]).trim();
        var key = fullName.toLowerCase();
        if (reports[key]) {
          results.push(reports[key]);
        } else {
          results.push({ accountantName: fullName, submitted: false });
        }
      }
      return { success: true, data: results };
    }

    var results = [];
    for (var k in reports) { results.push(reports[k]); }
    return { success: true, data: reports };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getAllDailyReports (management dashboard aggregation) ──
function handleGetAllDailyReports(params) {
  try {
    var requestedDate = params.date || formatDate(new Date());

    // Sales reports
    var salesResult = handleGetDailyReports({ date: requestedDate });
    var salesData = salesResult.success ? salesResult.data : [];

    // Admin reports
    var adminResult = handleGetAdminDailyReports({ date: requestedDate });
    var adminData = adminResult.success ? adminResult.data : [];

    // HR reports
    var hrResult = handleGetHRDailyReports({ date: requestedDate });
    var hrData = hrResult.success ? hrResult.data : [];

    // Accounting reports
    var accountingResult = handleGetAccountingDailyReports({ date: requestedDate });
    var accountingData = accountingResult.success ? accountingResult.data : [];

    return {
      success: true,
      date: requestedDate,
      sales: { data: salesData },
      admin: { data: adminData },
      hr: { data: hrData },
      accounting: { data: accountingData }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════
// MRO/MI QUEUE — Admin read-only view
// ═══════════════════════════════════════════════════

function handleGetAllMROs(params) {
  try {
    if (!MRO_SHEET_ID) throw new Error('MRO_SHEET_ID is not configured in Code.gs');
    var ss = SpreadsheetApp.openById(MRO_SHEET_ID);
    var sheet = ss.getSheets()[0]; // first tab
    var data = sheet.getDataRange().getValues();
    var display = sheet.getDataRange().getDisplayValues();
    var allRows = [];

    for (var j = 1; j < data.length; j++) {
      if (!data[j][0] && !data[j][2]) continue; // skip blank rows
      allRows.push({
        vendorName: String(data[j][0] || ''),
        receivingDate: data[j][1] ? (function(v) { try { return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch(e) { return String(v); } })(data[j][1]) : '',
        salesInvoice: display[j][2] || '',
        purchaseOrderNo: display[j][3] || '',
        modelNo: display[j][4] || '',
        itemDescription: String(data[j][5] || ''),
        quantity: data[j][6] || 0,
        remarks: String(data[j][7] || ''),
        receivedBy: String(data[j][8] || ''),
        driveLink: String(data[j][9] || '')
      });
    }

    allRows.sort(function(a, b) { return (b.receivingDate || '').localeCompare(a.receivingDate || ''); });
    return { success: true, data: allRows };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleGetAllMIs(params) {
  try {
    var ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID_FOR_VIEWER);
    var sheet = ss.getSheetByName('Issuance');
    if (!sheet) return { success: true, data: [] };

    var data = sheet.getDataRange().getValues();
    var display = sheet.getDataRange().getDisplayValues();
    var allRows = [];
    for (var j = 1; j < data.length; j++) {
      if (!data[j][0] && !data[j][2]) continue;
      allRows.push({
        issuanceDate: data[j][0] ? (function() { try { return Utilities.formatDate(new Date(data[j][0]), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch(e) { return String(data[j][0]); } })() : '',
        recipientName: String(data[j][1] || ''),
        issuanceNo: display[j][2] || '',
        requisitionNo: display[j][3] || '',
        modelNo: display[j][4] || '',
        itemDescription: String(data[j][5] || ''),
        quantity: data[j][6] || 0,
        remarks: String(data[j][7] || ''),
        issuedBy: String(data[j][8] || ''),
        driveLink: String(data[j][9] || '')
      });
    }

    allRows.sort(function(a, b) { return (b.issuanceDate || '').localeCompare(a.issuanceDate || ''); });
    return { success: true, data: allRows };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════
// COLLECTIONS (Accounts Receivable)
// ═══════════════════════════════════════════════════

function _getCollectionsSheet() {
  var ss = SpreadsheetApp.openById(COLLECTIONS_SHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === COLLECTIONS_SHEET_GID) return sheets[i];
  }
  return sheets[0]; // fallback to first sheet
}

function _fmtDate(val) {
  if (!val) return '';
  try {
    return Utilities.formatDate(new Date(val), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) { return String(val); }
}

function _stripPeso(val) {
  return parseFloat(String(val || '').replace(/[₱,\s]/g, '')) || 0;
}

function handleGetCollections(params) {
  try {
    var sheet = _getCollectionsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[0] && !r[2] && !r[4]) continue; // skip blank rows
      results.push({
        rowIndex: i + 1,
        invoiceNo:      String(r[0] || ''),
        drNo:           String(r[1] || ''),
        date:           _fmtDate(r[2]),
        customerId:     String(r[3] || ''),
        companyName:    String(r[4] || ''),
        poNo:           String(r[5] || ''),
        dateReceived:   _fmtDate(r[6]),
        paymentTerms:   String(r[7] || ''),
        invoiceAmount:  _stripPeso(r[8]),
        netOfVat:       _stripPeso(r[9]),
        vat:            _stripPeso(r[10]),
        ewt:            _stripPeso(r[11]),
        totalAmountDue: _stripPeso(r[12]),
        dueDate:        _fmtDate(r[13]),
        dateCollected:  _fmtDate(r[14]),
        amountReceived: _stripPeso(r[15]),
        soNo:             String(r[17] || ''),
        siDate:           _fmtDate(r[18]),
        lastFollowUpDate: _fmtDate(r[19]),
        remarks:          String(r[20] || ''),
        notes:            String(r[21] || '')
      });
    }
    results.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleAddCollection(params) {
  try {
    var sheet = _getCollectionsSheet();
    var invoiceAmt = parseFloat(params.invoiceAmount) || 0;
    var netOfVat   = parseFloat(params.netOfVat)      || (invoiceAmt ? Math.round(invoiceAmt / 1.12 * 100) / 100 : 0);
    var vat        = parseFloat(params.vat)           || (invoiceAmt - netOfVat);
    var ewt        = parseFloat(params.ewt)           || (netOfVat * 0.01);
    var totalDue   = parseFloat(params.totalAmountDue) || (invoiceAmt - ewt);
    sheet.appendRow([
      params.invoiceNo      || '',
      params.drNo           || '',
      params.date           || '',
      params.customerId     || '',
      params.companyName    || '',
      params.poNo           || '',
      params.dateReceived   || '',
      params.paymentTerms   || '',
      invoiceAmt,
      netOfVat,
      vat,
      ewt,
      totalDue,
      params.dueDate        || '',
      params.dateCollected  || '',
      parseFloat(params.amountReceived) || 0,
      '',
      params.soNo             || '',
      params.siDate           || '',
      params.lastFollowUpDate || '',
      params.remarks          || '',
      params.notes            || ''
    ]);
    _writeCreatedBy(sheet, params.createdBy);
    _logActivity(_resolveActor(params), 'added', 'collection',
      params.invoiceNo || '',
      'Invoice ' + (params.invoiceNo || '—') + ' — ' + (params.companyName || ''),
      invoiceAmt);
    return { success: true, message: 'Collection record added.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleDeleteCollection(params) {
  try {
    var sheet = _getCollectionsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) throw new Error('Invalid row index.');
    var inv = ''; var co = ''; var amt = 0;
    try {
      var r = sheet.getRange(rowIndex, 1, 1, 16).getValues()[0];
      inv = String(r[0] || ''); co = String(r[4] || ''); amt = _stripPeso(r[8]);
    } catch (_) {}
    sheet.deleteRow(rowIndex);
    _logActivity(_resolveActor(params), 'deleted', 'collection', inv, 'Invoice ' + inv + ' — ' + co, amt);
    return { success: true, message: 'Record deleted.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function handleUpdateCollection(params) {
  try {
    var sheet = _getCollectionsSheet();
    var rowIndex = parseInt(params.rowIndex);
    if (!rowIndex || rowIndex < 2) throw new Error('Invalid row index.');

    var COLS = 22; // A..V
    var existing = sheet.getRange(rowIndex, 1, 1, COLS).getValues()[0];

    function pick(key, idx, isNum) {
      if (params[key] === undefined || params[key] === null || params[key] === '') return existing[idx];
      return isNum ? (parseFloat(params[key]) || 0) : params[key];
    }

    var hasAmt = params.invoiceAmount !== undefined && params.invoiceAmount !== '';
    var invoiceAmt = hasAmt ? (parseFloat(params.invoiceAmount) || 0) : _stripPeso(existing[8]);
    var netOfVat   = (params.netOfVat !== undefined && params.netOfVat !== '') ? parseFloat(params.netOfVat)
                      : (hasAmt ? Math.round(invoiceAmt / 1.12 * 100) / 100 : _stripPeso(existing[9]));
    var vat        = (params.vat !== undefined && params.vat !== '') ? parseFloat(params.vat)
                      : (hasAmt ? (invoiceAmt - netOfVat) : _stripPeso(existing[10]));
    var ewt        = (params.ewt !== undefined && params.ewt !== '') ? parseFloat(params.ewt)
                      : (hasAmt ? (netOfVat * 0.01) : _stripPeso(existing[11]));
    var totalDue   = (params.totalAmountDue !== undefined && params.totalAmountDue !== '') ? parseFloat(params.totalAmountDue)
                      : (hasAmt ? (invoiceAmt - ewt) : _stripPeso(existing[12]));

    var row = [
      pick('invoiceNo', 0),
      pick('drNo', 1),
      pick('date', 2),
      pick('customerId', 3),
      pick('companyName', 4),
      pick('poNo', 5),
      pick('dateReceived', 6),
      pick('paymentTerms', 7),
      invoiceAmt, netOfVat, vat, ewt, totalDue,
      pick('dueDate', 13),
      pick('dateCollected', 14),
      pick('amountReceived', 15, true),
      existing[16] || '',
      pick('soNo', 17),
      pick('siDate', 18),
      pick('lastFollowUpDate', 19),
      pick('remarks', 20),
      pick('notes', 21)
    ];
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);

    // Classify update: AR Aging follow-up if lastFollowUpDate or remarks changed,
    // otherwise generic update.
    var action = 'updated';
    var entityType = 'collection';
    var isFollowUp = (params.lastFollowUpDate && params.lastFollowUpDate !== _fmtDate(existing[19])) ||
                     (params.remarks && params.remarks !== existing[20]);
    if (isFollowUp && (!hasAmt || invoiceAmt === _stripPeso(existing[8]))) {
      action = 'followed_up';
      entityType = 'ar_aging';
    }
    _logActivity(_resolveActor(params), action, entityType,
      row[0] || '',
      'Invoice ' + (row[0] || '—') + ' — ' + (row[4] || ''),
      invoiceAmt);

    return { success: true, message: 'Collection record updated.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getManagementInsights (aggregated data for management dashboard) ──
function handleGetManagementInsights(params) {
  try {
    var now = new Date();
    var result = {
      success: true,
      activeSessions: 0,
      rejectionAnalysis: [],
      totalRejected: 0
    };

    // 1. Active Sessions — count non-expired sessions
    try {
      var sessSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Sessions');
      if (sessSheet) {
        var sessData = sessSheet.getDataRange().getValues();
        for (var s = 1; s < sessData.length; s++) {
          var expiresAt = new Date(sessData[s][5]);
          if (expiresAt > now) result.activeSessions++;
        }
      }
    } catch (e) { /* Sessions sheet may not exist yet */ }

    // 2. Rejection Analysis — iterate all agents' quotation sheets
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var usersData = usersSheet.getDataRange().getValues();
    var reasonCounts = {};

    for (var i = 1; i < usersData.length; i++) {
      var role = String(usersData[i][2]).trim().toLowerCase();
      if (role !== 'sales' && role !== 'admin') continue;
      var qSheetId = String(usersData[i][4]).trim();
      if (!qSheetId || qSheetId === 'undefined') continue;

      try {
        var qSheet = SpreadsheetApp.openById(qSheetId).getSheets()[0];
        var lastRow = qSheet.getLastRow();
        if (lastRow < 2) continue;
        var qData = qSheet.getRange(2, 1, lastRow - 1, 19).getValues();
        for (var j = 0; j < qData.length; j++) {
          var overallStatus = String(qData[j][14] || '').trim();
          if (overallStatus !== 'Rejected') continue;
          result.totalRejected++;
          var reason = String(qData[j][16] || '').trim() || String(qData[j][17] || '').trim() || 'No reason given';
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        }
      } catch (e) { /* skip inaccessible sheets */ }
    }

    // Convert to sorted array
    result.rejectionAnalysis = Object.keys(reasonCounts).map(function(r) {
      return { reason: r, count: reasonCounts[r] };
    }).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);

    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getClientProfitReport ──────────────────────────────
function handleGetClientProfitReport(params) {
  try {
    var month = String(params.month || ''); // 'YYYY-MM'
    var sheet = _ordersSheet();
    var data = sheet.getDataRange().getValues();
    var orders = [];

    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var o = _parseOrderRow(data[i], i + 1);
      if (month && !o.date.startsWith(month)) continue;

      var totalCOGS = o.purchaseCostPHP + o.shippingCost + o.dutiesTaxes + o.deliveryCost;
      var grossProfit = o.sellingPrice - totalCOGS;

      orders.push({
        date:            o.date,
        orderNumber:     o.orderNumber,
        client:          o.client,
        sales:           o.sellingPrice,
        purchaseCostPHP: o.purchaseCostPHP,
        shippingCost:    o.shippingCost,
        dutiesTaxes:     o.dutiesTaxes,
        deliveryCost:    o.deliveryCost,
        totalCOGS:       totalCOGS,
        grossProfit:     grossProfit
      });
    }

    var totalGrossProfit = orders.reduce(function(s, o) { return s + o.grossProfit; }, 0);
    return { success: true, data: orders, totalGrossProfit: totalGrossProfit };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Profit Reports sheet ────────────────────────────────────────
function _profitReportsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Profit Reports', [
    'Report ID', 'Report Date', 'Client', 'SO No', 'Sales',
    'COGS Type', 'Purchase of Goods', 'Bank Svc Charge (COGS)',
    'Duties & Taxes', 'Bank Svc Charge (Shipping)',
    'Shipping Company', 'Shipping Cost', 'Local Charges',
    'Delivery to Office', 'Delivery to Client',
    'Total COGS', 'Gross Profit', 'SO Date'
  ]);
}

// ─── ACTION: saveProfitReport ────────────────────────────────────
function handleSaveProfitReport(params) {
  try {
    var sheet = _profitReportsSheet();
    var reportId   = params.reportId   || Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMMdd-HHmmss');
    var reportDate = params.reportDate || formatDate(new Date());
    var entries    = JSON.parse(params.entries || '[]');

    entries.forEach(function(e) {
      sheet.appendRow([
        reportId, reportDate, e.customerName, e.soNo,
        parseFloat(e.sales)                    || 0,
        e.cogsType || 'local',
        parseFloat(e.purchaseOfGoods)          || 0,
        parseFloat(e.bankServiceChargeCOGS)    || 0,
        parseFloat(e.dutiesAndTaxes)           || 0,
        parseFloat(e.bankServiceChargeShipping)|| 0,
        e.shippingCompany || '',
        parseFloat(e.shippingCost)             || 0,
        parseFloat(e.localCharges)             || 0,
        parseFloat(e.deliveryToOffice)         || 0,
        parseFloat(e.deliveryToClient)         || 0,
        parseFloat(e.totalCOGS)               || 0,
        parseFloat(e.grossProfit)             || 0,
        e.soDate || reportDate
      ]);
    });

    _logActivity(_resolveActor(params), 'added', 'profit_report', reportId,
      'Profit Report ' + reportId + ' — ' + entries.length + ' entries', 0);

    return { success: true, reportId: reportId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: getProfitReports ────────────────────────────────────
function handleGetProfitReports(params) {
  try {
    var sheet = _profitReportsSheet();
    var data  = sheet.getDataRange().getValues();
    var map   = {};
    var order = [];

    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var id = String(data[i][0]);
      if (!map[id]) {
        map[id] = { reportId: id, reportDate: String(data[i][1]), entries: [] };
        order.push(id);
      }
      map[id].entries.push({
        customerName:             String(data[i][2]  || ''),
        soNo:                     String(data[i][3]  || ''),
        sales:                    parseFloat(data[i][4])  || 0,
        cogsType:                 String(data[i][5]  || 'local'),
        purchaseOfGoods:          parseFloat(data[i][6])  || 0,
        bankServiceChargeCOGS:    parseFloat(data[i][7])  || 0,
        dutiesAndTaxes:           parseFloat(data[i][8])  || 0,
        bankServiceChargeShipping:parseFloat(data[i][9])  || 0,
        shippingCompany:          String(data[i][10] || ''),
        shippingCost:             parseFloat(data[i][11]) || 0,
        localCharges:             parseFloat(data[i][12]) || 0,
        deliveryToOffice:         parseFloat(data[i][13]) || 0,
        deliveryToClient:         parseFloat(data[i][14]) || 0,
        totalCOGS:                parseFloat(data[i][15]) || 0,
        grossProfit:              parseFloat(data[i][16]) || 0,
        soDate:                   String(data[i][17] || data[i][1] || '')
      });
    }

    // newest first
    var sorted = order.reverse().map(function(id) { return map[id]; });

    // Deduplicate: for each soNo, keep only the best entry across all reports.
    // "Best" = has actual COGS data (totalCOGS > 0). If multiple have COGS data,
    // keep the one from the newest report. If all are zero, keep the newest.
    // The entry stays in whichever report originally contained it — we just remove
    // the duplicate occurrences from older/inferior reports.

    // Step 1: find the "winning" reportId for each soNo
    var soWinner = {}; // soNo -> reportId that should display it
    sorted.forEach(function(report) {
      report.entries.forEach(function(e) {
        var key = e.soNo;
        if (!key) return;
        if (!soWinner[key]) {
          // First time we see this SO (sorted newest-first), tentatively assign it
          soWinner[key] = { reportId: report.reportId, hasCogs: e.totalCOGS > 0 };
        } else if (!soWinner[key].hasCogs && e.totalCOGS > 0) {
          // Current winner has no COGS but this older entry does — upgrade to this one
          soWinner[key] = { reportId: report.reportId, hasCogs: true };
        }
        // Otherwise: keep the already-assigned winner (newer or has COGS)
      });
    });

    // Step 2: filter each report to only the entries it "won"
    var result = [];
    sorted.forEach(function(report) {
      var uniqueEntries = report.entries.filter(function(e) {
        return e.soNo && soWinner[e.soNo] && soWinner[e.soNo].reportId === report.reportId;
      });
      if (uniqueEntries.length > 0) {
        result.push({ reportId: report.reportId, reportDate: report.reportDate, entries: uniqueEntries });
      }
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: updateProfitReportEntry ─────────────────────────────
function handleUpdateProfitReportEntry(params) {
  try {
    var sheet    = _profitReportsSheet();
    var data     = sheet.getDataRange().getValues();
    var reportId = String(params.reportId || '');
    var soNo     = String(params.soNo     || '');
    var e        = JSON.parse(params.entry || '{}');

    var cogs = (parseFloat(e.purchaseOfGoods) || 0) +
               (parseFloat(e.deliveryToOffice) || 0) +
               (parseFloat(e.deliveryToClient) || 0);
    if (e.cogsType === 'international') {
      cogs += (parseFloat(e.bankServiceChargeCOGS)    || 0) +
              (parseFloat(e.dutiesAndTaxes)           || 0) +
              (parseFloat(e.bankServiceChargeShipping)|| 0) +
              (parseFloat(e.shippingCost)             || 0) +
              (parseFloat(e.localCharges)             || 0);
    }
    var grossProfit = (parseFloat(e.sales) || 0) - cogs;
    var updated = 0;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== reportId || String(data[i][3]) !== soNo) continue;
      var row = i + 1;
      sheet.getRange(row, 5).setValue(parseFloat(e.sales)                    || 0);
      sheet.getRange(row, 6).setValue(e.cogsType || 'local');
      sheet.getRange(row, 7).setValue(parseFloat(e.purchaseOfGoods)          || 0);
      sheet.getRange(row, 8).setValue(parseFloat(e.bankServiceChargeCOGS)    || 0);
      sheet.getRange(row, 9).setValue(parseFloat(e.dutiesAndTaxes)           || 0);
      sheet.getRange(row,10).setValue(parseFloat(e.bankServiceChargeShipping)|| 0);
      sheet.getRange(row,11).setValue(e.shippingCompany || '');
      sheet.getRange(row,12).setValue(parseFloat(e.shippingCost)             || 0);
      sheet.getRange(row,13).setValue(parseFloat(e.localCharges)             || 0);
      sheet.getRange(row,14).setValue(parseFloat(e.deliveryToOffice)         || 0);
      sheet.getRange(row,15).setValue(parseFloat(e.deliveryToClient)         || 0);
      sheet.getRange(row,16).setValue(cogs);
      sheet.getRange(row,17).setValue(grossProfit);
      sheet.getRange(row,18).setValue(e.soDate || '');
      updated++;
    }
    _logActivity(_resolveActor(params), 'updated', 'profit_report', reportId,
      'SO ' + soNo + ' — ' + (e.customerName || '') + ' (report ' + reportId + ')',
      parseFloat(e.sales) || 0);
    return { success: true, updated: updated };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SHIPMENT MONITORING
// ═══════════════════════════════════════════════════════════════

function _shipmentSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sh = ss.getSheetByName('Shipment Monitoring');
  if (!sh) {
    sh = ss.insertSheet('Shipment Monitoring');
    sh.appendRow([
      'Shipment ID', 'PO No', 'Client', 'Clients PO', 'HI-ESCORP PO',
      'Principal', 'Item', 'Mode', 'Shipment Date', 'ETD', 'ETA',
      'AWB', 'Logistics', 'Freight-In', 'Import Duties', 'Customs/Brokerage',
      'Handling', 'Delivery Expense', 'Date Arrived',
      'Total Amount', 'Amount Paid', 'Balance', 'Date of Payment',
      'Payment Status', 'Payment Method',
      'Sales Invoice', 'Delivery Receipt',
      'Status', 'Remarks', 'Created Date', 'Linked SOs', 'Documents', 'Stages'
    ]);
  } else {
    // Ensure Linked SOs column exists for older sheets
    var existingHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf('Linked SOs') < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('Linked SOs');
    }
    // Ensure Documents column exists
    existingHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf('Documents') < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('Documents');
    }
    // Ensure Stages column exists
    existingHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf('Stages') < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('Stages');
    }
  }
  return sh;
}

// ─── ACTION: getShipments ────────────────────────────────────
function handleGetShipments(params) {
  try {
    var sheet = _shipmentSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var headers = data[0].map(function(h) { return String(h).trim(); });
    var filterPoNo   = String(params.poNo   || '').toLowerCase();
    var filterStatus = String(params.status || '').toLowerCase();
    var filterClient = String(params.client || '').toLowerCase();

    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[1]) continue;

      var rec = {};
      headers.forEach(function(h, idx) { rec[h] = row[idx]; });

      if (filterPoNo   && String(rec['PO No']  || '').toLowerCase().indexOf(filterPoNo)   < 0) continue;
      if (filterStatus && String(rec['Status'] || '').toLowerCase().indexOf(filterStatus) < 0) continue;
      if (filterClient && String(rec['Client'] || '').toLowerCase().indexOf(filterClient) < 0) continue;

      var dateCols = ['Shipment Date','ETD','ETA','Date Arrived','Date of Payment','Created Date'];
      dateCols.forEach(function(col) {
        if (rec[col] instanceof Date) rec[col] = formatDate(rec[col]);
        else rec[col] = String(rec[col] || '');
      });

      results.push({
        shipmentId:      String(rec['Shipment ID']        || ''),
        poNo:            String(rec['PO No']              || ''),
        client:          String(rec['Client']             || ''),
        clientsPO:       String(rec['Clients PO']         || ''),
        hiescorpPO:      String(rec['HI-ESCORP PO']       || ''),
        principal:       String(rec['Principal']          || ''),
        item:            String(rec['Item']               || ''),
        mode:            String(rec['Mode']               || ''),
        shipmentDate:    String(rec['Shipment Date']      || ''),
        etd:             String(rec['ETD']                || ''),
        eta:             String(rec['ETA']                || ''),
        awb:             String(rec['AWB']                || ''),
        logistics:       String(rec['Logistics']          || ''),
        freightIn:       rec['Freight-In']                || '',
        importDuties:    rec['Import Duties']             || '',
        brokerage:       rec['Customs/Brokerage']         || '',
        handling:        rec['Handling']                  || '',
        deliveryExpense: rec['Delivery Expense']          || '',
        dateArrived:     String(rec['Date Arrived']       || ''),
        totalAmount:     rec['Total Amount']              || '',
        amountPaid:      rec['Amount Paid']               || '',
        balance:         rec['Balance']                   || '',
        dateOfPayment:   String(rec['Date of Payment']    || ''),
        paymentStatus:   String(rec['Payment Status']     || ''),
        paymentMethod:   String(rec['Payment Method']     || ''),
        salesInvoice:    String(rec['Sales Invoice']      || ''),
        deliveryReceipt: String(rec['Delivery Receipt']   || ''),
        status:          String(rec['Status']             || 'Pending'),
        remarks:         String(rec['Remarks']            || ''),
        createdDate:     String(rec['Created Date']       || ''),
        linkedSOs:       String(rec['Linked SOs']         || ''),
        documents:       String(rec['Documents']          || '{}'),
        stages:          String(rec['Stages']             || '{}')
      });
    }

    results.sort(function(a, b) {
      return String(b.createdDate).localeCompare(String(a.createdDate));
    });

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: saveShipment ────────────────────────────────────
function handleSaveShipment(params) {
  try {
    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var shipmentId = String(params.shipmentId || '').trim();
    var dateStr = formatDate(new Date());

    function colIdx(name) { return headers.indexOf(name); }  // 0-based
    function colNo(name)  { return colIdx(name) + 1; }       // 1-based for getRange

    var fields = {
      'Mode':              params.mode            || '',
      'Shipment Date':     params.shipmentDate    || '',
      'ETD':               params.etd             || '',
      'ETA':               params.eta             || '',
      'AWB':               params.awb             || '',
      'Logistics':         params.logistics       || '',
      'Freight-In':        params.freightIn       || '',
      'Import Duties':     params.importDuties    || '',
      'Customs/Brokerage': params.brokerage       || '',
      'Handling':          params.handling        || '',
      'Delivery Expense':  params.deliveryExpense || '',
      'Date Arrived':      params.dateArrived     || '',
      'Total Amount':      params.totalAmount     || '',
      'Amount Paid':       params.amountPaid      || '',
      'Balance':           params.balance         || '',
      'Date of Payment':   params.dateOfPayment   || '',
      'Payment Status':    params.paymentStatus   || '',
      'Payment Method':    params.paymentMethod   || '',
      'Sales Invoice':     params.salesInvoice    || '',
      'Delivery Receipt':  params.deliveryReceipt || '',
      'Status':            params.status          || 'Pending',
      'Remarks':           params.remarks         || '',
      'Clients PO':        params.clientsPO       || '',
      'HI-ESCORP PO':      params.hiescorpPO      || '',
      'Principal':         params.principal       || '',
      'Item':              params.item            || '',
      'Linked SOs':        params.linkedSOs       || ''
    };

    if (shipmentId) {
      // Update existing record — diff fields first
      var updated = false;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === shipmentId) {
          var rowNum = i + 1;

          // Capture old values for history diff
          var histEvents = [];
          var changedFields = [];
          Object.keys(fields).forEach(function(name) {
            var c = colIdx(name);
            if (c < 0) return;
            var oldVal = String(data[i][c]).trim();
            var newVal = String(fields[name]).trim();
            if (oldVal !== newVal) {
              changedFields.push(name);
              histEvents.push({
                shipmentId: shipmentId,
                eventType:  'FIELD_CHANGE',
                fieldName:  _HISTORY_FIELD_MAP[name] || name,
                oldValue:   oldVal,
                newValue:   newVal,
                actorName:  String(params.user || _resolveActor(params) || ''),
                source:     'ui_edit',
              });
            }
            sheet.getRange(rowNum, c + 1).setValue(fields[name]);
          });

          updated = true;
          // Record history events after successful write
          if (histEvents.length) _recordHistoryEventsBatch(histEvents);
          // Activity log (per-user daily report)
          if (changedFields.length) {
            var clientName = String(data[i][2] || params.client || '');
            var poNoVal = String(data[i][1] || params.poNo || '');
            var totalAmt = parseFloat(params.totalAmount || data[i][19]) || 0;
            var summary = 'Updated ' + changedFields.slice(0, 4).join(', ') +
              (changedFields.length > 4 ? ' +' + (changedFields.length - 4) + ' more' : '') +
              (clientName ? ' · ' + clientName : '') +
              (poNoVal ? ' · PO ' + poNoVal : '');
            _logActivity(_resolveActor(params) || String(params.user || ''),
              'updated', 'shipment', shipmentId, summary, totalAmt);
          }
          break;
        }
      }
      if (!updated) return { success: false, message: 'Shipment not found.' };
    } else {
      // Create new
      var newId = 'SHM-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') +
                  '-' + String(Math.floor(Math.random() * 9000) + 1000);
      sheet.appendRow([
        newId,
        params.poNo           || '',
        params.client         || '',
        fields['Clients PO'],
        fields['HI-ESCORP PO'],
        fields['Principal'],
        fields['Item'],
        fields['Mode'],
        fields['Shipment Date'],
        fields['ETD'],
        fields['ETA'],
        fields['AWB'],
        fields['Logistics'],
        fields['Freight-In'],
        fields['Import Duties'],
        fields['Customs/Brokerage'],
        fields['Handling'],
        fields['Delivery Expense'],
        fields['Date Arrived'],
        fields['Total Amount'],
        fields['Amount Paid'],
        fields['Balance'],
        fields['Date of Payment'],
        fields['Payment Status'],
        fields['Payment Method'],
        fields['Sales Invoice'],
        fields['Delivery Receipt'],
        fields['Status'],
        fields['Remarks'],
        dateStr,
        fields['Linked SOs'],
        '{}',   // Documents — populated via uploadShipmentDoc
        '{}'    // Stages — populated via advanceShipmentStage
      ]);
      shipmentId = newId;
      // Record creation event
      recordHistoryEvent({
        shipmentId:  shipmentId,
        eventType:   'SHIPMENT_CREATED',
        actorName:   String(params.user || _resolveActor(params) || ''),
        clientName:  String(params.client || ''),
        linkedPOs:   String(params.poNo  || ''),
        source:      'ui_edit',
        contextNote: 'Shipment created',
      });
      // Activity log
      var createSummary = 'Created shipment' +
        (params.client ? ' · ' + params.client : '') +
        (params.poNo ? ' · PO ' + params.poNo : '') +
        (params.mode ? ' · ' + params.mode : '');
      _logActivity(_resolveActor(params) || String(params.user || ''),
        'created', 'shipment', shipmentId, createSummary,
        parseFloat(params.totalAmount) || 0);
    }

    return { success: true, message: 'Shipment saved.', shipmentId: shipmentId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── SHIPMENT DOCUMENT STORAGE — Drive + DocumentIndex ──────
//
// Folder hierarchy (LAZY — stage folders created on first upload):
//   HI-ESCORP Shipments/
//   └── {YEAR}/
//       └── {MM}-{MonthName}/
//           └── {SHM-ID} — {Client} — {Mode}/
//               ├── 01_Order / stage-01_sales-order / …
//               ├── 02_Payment / …
//               ├── 03_Documents / …
//               ├── 04_Logistics / …
//               ├── 05_Delivery / …
//               └── _Deleted/          ← soft-deleted files land here
//
// Files are renamed on upload:
//   {shipmentId}_stage-{NN}_{shortCode}_{date}_{originalName}
//
// Every upload/delete is recorded in the DocumentIndex sheet.

var SHIPMENT_DOCS_FOLDER_ID = '';

// Stage → { num, shortCode, slug, phase } for 21 stages
var STAGE_DEFS_EXT = {
  'so_received':             { num: 1,  shortCode: 'SO',   slug: 'sales-order',        phase: 1 },
  'po_created':              { num: 2,  shortCode: 'PO',   slug: 'purchase-order',     phase: 1 },
  'po_approved':             { num: 3,  shortCode: 'POA',  slug: 'po-approval',        phase: 1 },
  'po_sent':                 { num: 4,  shortCode: 'POS',  slug: 'po-sent',            phase: 1 },
  'proforma_received':       { num: 5,  shortCode: 'PI',   slug: 'proforma-invoice',   phase: 2 },
  'prf_created':             { num: 6,  shortCode: 'PRF',  slug: 'prf-created',        phase: 2 },
  'prf_approved':            { num: 7,  shortCode: 'PRFA', slug: 'prf-approved',       phase: 2 },
  'tt_sent':                 { num: 8,  shortCode: 'TT',   slug: 'tt-sent',            phase: 2 },
  'tt_forwarded':            { num: 9,  shortCode: 'TTF',  slug: 'tt-forwarded',       phase: 2 },
  'shipping_docs_received':  { num: 10, shortCode: 'PL',   slug: 'packing-list',       phase: 3 },
  'forwarder_quotes':        { num: 11, shortCode: 'FQ',   slug: 'forwarder-quotes',   phase: 3 },
  'forwarder_approved':      { num: 12, shortCode: 'FA',   slug: 'forwarder-approved', phase: 3 },
  'booked':                  { num: 13, shortCode: 'AWB',  slug: 'awb-booked',         phase: 4 },
  'pickup':                  { num: 14, shortCode: 'PU',   slug: 'pickup',             phase: 4 },
  'in_transit':              { num: 15, shortCode: 'IT',   slug: 'in-transit',         phase: 4 },
  'customs_clearance':       { num: 16, shortCode: 'CC',   slug: 'customs-clearance',  phase: 4 },
  'fan_sad_tan':             { num: 17, shortCode: 'CD',   slug: 'customs-docs',       phase: 4 },
  'debit_memo':              { num: 18, shortCode: 'BDM',  slug: 'bank-debit-memo',    phase: 5 },
  'forwarder_final_invoice': { num: 19, shortCode: 'FFI',  slug: 'forwarder-invoice',  phase: 5 },
  'local_charges':           { num: 20, shortCode: 'LC',   slug: 'local-charges',      phase: 5 },
  'delivered':               { num: 21, shortCode: 'DEL',  slug: 'delivered',          phase: 5 },
};

var PHASE_FOLDERS = ['01_Order','02_Payment','03_Documents','04_Logistics','05_Delivery'];
var MONTH_NAMES   = ['January','February','March','April','May','June','July',
                     'August','September','October','November','December'];
var DOC_INDEX_SHEET_NAME = 'DocumentIndex';

// ─── Folder helpers ──────────────────────────────────────────

// Returns (creating if needed) the stage folder inside the new hierarchy.
// shipmentRec: { shipmentId, client, mode, shipmentDate }
function _getShipmentStageFolder(shipmentId, stageKey, client, mode, shipmentDate) {
  var stageDef = STAGE_DEFS_EXT[stageKey];
  if (!stageDef) throw new Error('Unknown stage key: ' + stageKey);

  var root = DriveApp.getFolderById(SHIPMENT_DOCS_FOLDER_ID);

  // Year / Month
  var d    = shipmentDate ? new Date(shipmentDate) : new Date();
  var year = String(d.getFullYear());
  var mon  = String(d.getMonth() + 1);
  if (mon.length < 2) mon = '0' + mon;
  var monthLabel = mon + '-' + MONTH_NAMES[d.getMonth()];

  var yearFolder  = _getOrCreateSubFolder(root,       year);
  var monthFolder = _getOrCreateSubFolder(yearFolder, monthLabel);

  // Shipment folder: "SHM-001 — ClientName — AIR"
  var safeClient = (client || 'Unknown').trim();
  var safeMode   = (mode   || 'SEA').trim().toUpperCase();
  var shipFolderName = shipmentId + ' \u2014 ' + safeClient + ' \u2014 ' + safeMode;
  var shipFolder = _getOrCreateSubFolder(monthFolder, shipFolderName);

  // Phase folder (01_Order etc.)
  var phaseFolder = _getOrCreateSubFolder(shipFolder, PHASE_FOLDERS[stageDef.phase - 1]);

  // Stage folder (lazy) — stage-01_sales-order etc.
  var nn          = stageDef.num < 10 ? '0' + stageDef.num : String(stageDef.num);
  var stageFolderName = 'stage-' + nn + '_' + stageDef.slug;
  return _getOrCreateSubFolder(phaseFolder, stageFolderName);
}

// Returns (creating if needed) the _Deleted folder under the shipment folder.
function _getDeletedFolder(shipmentId, client, mode, shipmentDate) {
  var root = DriveApp.getFolderById(SHIPMENT_DOCS_FOLDER_ID);
  var d    = shipmentDate ? new Date(shipmentDate) : new Date();
  var year = String(d.getFullYear());
  var mon  = String(d.getMonth() + 1);
  if (mon.length < 2) mon = '0' + mon;
  var monthLabel = mon + '-' + MONTH_NAMES[d.getMonth()];

  var yearFolder  = _getOrCreateSubFolder(root,       year);
  var monthFolder = _getOrCreateSubFolder(yearFolder, monthLabel);

  var safeClient    = (client || 'Unknown').trim();
  var safeMode      = (mode   || 'SEA').trim().toUpperCase();
  var shipFolderName = shipmentId + ' \u2014 ' + safeClient + ' \u2014 ' + safeMode;
  var shipFolder    = _getOrCreateSubFolder(monthFolder, shipFolderName);
  return _getOrCreateSubFolder(shipFolder, '_Deleted');
}

// Builds the stored filename: SHM-001_stage-13_AWB_2026-04-29_orig.pdf
function _buildStoredFilename(shipmentId, stageKey, originalName) {
  var stageDef = STAGE_DEFS_EXT[stageKey] || { num: 0, shortCode: 'DOC' };
  var nn   = stageDef.num < 10 ? '0' + stageDef.num : String(stageDef.num);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  // Sanitise original name: keep alphanum, dots, hyphens, underscores
  var safeName = (originalName || 'document').replace(/[^a-zA-Z0-9.\-_]/g, '_');
  return shipmentId + '_stage-' + nn + '_' + stageDef.shortCode + '_' + today + '_' + safeName;
}

// ─── DocumentIndex helpers ───────────────────────────────────

function _docIndexSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DOC_INDEX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DOC_INDEX_SHEET_NAME);
    sheet.appendRow([
      'doc_id','shipment_id','linked_po_numbers','client_name',
      'stage_number','stage_short_code','phase_number',
      'filename_stored','filename_original','drive_file_id',
      'drive_url','preview_url','thumbnail_url','mime_type',
      'file_size_bytes','uploaded_by','uploaded_at',
      'deleted_at','deleted_by'
    ]);
    sheet.getRange(1,1,1,19).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Append one row to DocumentIndex. Returns the doc_id used.
function _writeDocIndex(rec) {
  var docId   = rec.doc_id || Utilities.getUuid();
  var stageDef = STAGE_DEFS_EXT[rec.stage_key] || { num: 0, shortCode: '', phase: 0 };
  _docIndexSheet().appendRow([
    docId,
    rec.shipment_id       || '',
    rec.linked_po_numbers || '',
    rec.client_name       || '',
    stageDef.num,
    stageDef.shortCode,
    stageDef.phase,
    rec.filename_stored   || '',
    rec.filename_original || '',
    rec.drive_file_id     || '',
    rec.drive_url         || '',
    rec.preview_url       || '',
    rec.thumbnail_url     || '',
    rec.mime_type         || '',
    rec.file_size_bytes   || 0,
    rec.uploaded_by       || '',
    rec.uploaded_at       || new Date().toISOString(),
    '',  // deleted_at
    '',  // deleted_by
  ]);
  return docId;
}

// Soft-delete: set deleted_at / deleted_by for rows matching drive_file_id.
function _softDeleteDocIndex(fileId, deletedBy) {
  var sheet  = _docIndexSheet();
  var data   = sheet.getDataRange().getValues();
  var now    = new Date().toISOString();
  var colFileId   = 9;  // 0-indexed column J = drive_file_id
  var colDelAt    = 17; // column R = deleted_at
  var colDelBy    = 18; // column S = deleted_by
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colFileId]) === fileId && !data[i][colDelAt]) {
      sheet.getRange(i + 1, colDelAt + 1).setValue(now);
      sheet.getRange(i + 1, colDelBy + 1).setValue(deletedBy || '');
    }
  }
}

// Restore: clear deleted_at/deleted_by for a file.
function _restoreDocIndex(fileId) {
  var sheet = _docIndexSheet();
  var data  = sheet.getDataRange().getValues();
  var colFileId = 9;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colFileId]) === fileId) {
      sheet.getRange(i + 1, 18).setValue('');
      sheet.getRange(i + 1, 19).setValue('');
    }
  }
}

// ─── ACTION: uploadShipmentDoc ───────────────────────────────
function handleUploadShipmentDoc(body) {
  try {
    var shipmentId = body.shipmentId || '';
    var stageKey   = body.status     || body.stageKey || 'pending'; // 'status' = stageKey per legacy naming
    var fileName   = body.fileName   || 'document';
    var base64Data = body.base64     || '';
    var mimeType   = body.mimeType   || 'application/pdf';
    var uploadedBy = body.user       || '';

    if (!shipmentId) return { success: false, message: 'Missing shipmentId.' };
    if (!base64Data) return { success: false, message: 'No file data.' };

    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var docsCol = headers.indexOf('Documents');
    if (docsCol < 0) return { success: false, message: 'Documents column not found.' };

    // Find shipment row — collect metadata for folder naming
    var rowNum = -1, currentDocs = {}, client = '', mode = '', shipmentDate = '', linkedSOs = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === shipmentId) {
        rowNum = i + 1;
        try { currentDocs = JSON.parse(String(data[i][docsCol] || '{}')); } catch(e) { currentDocs = {}; }
        // Column indices (0-based): C=2 client, H=7 mode, I=8 shipmentDate, AE=30 linkedSOs
        client       = String(data[i][2]  || '');
        mode         = String(data[i][7]  || 'SEA');
        shipmentDate = String(data[i][8]  || '');
        linkedSOs    = String(data[i][30] || '');
        break;
      }
    }
    if (rowNum < 0) return { success: false, message: 'Shipment not found.' };

    // Enforce max 5 per stage
    var existing = currentDocs[stageKey] || [];
    if (existing.length >= 5) return { success: false, message: 'Max 5 files per stage reached.' };

    // Get the new-style stage folder (lazily created)
    var folder;
    try {
      folder = _getShipmentStageFolder(shipmentId, stageKey, client, mode, shipmentDate);
    } catch(e) {
      // Fallback to legacy folder on unknown stage key
      folder = _getShipmentDocFolder(shipmentId, stageKey);
    }

    // Build stored filename and upload
    var storedName = _buildStoredFilename(shipmentId, stageKey, fileName);
    var decoded    = Utilities.base64Decode(base64Data);
    var blob       = Utilities.newBlob(decoded, mimeType, storedName);
    var file       = folder.createFile(blob);
    try { file.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}

    var fileId     = file.getId();
    var fileUrl    = file.getUrl();
    var previewUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';

    // Write to DocumentIndex
    try {
      _writeDocIndex({
        shipment_id:       shipmentId,
        linked_po_numbers: linkedSOs,
        client_name:       client,
        stage_key:         stageKey,
        filename_stored:   storedName,
        filename_original: fileName,
        drive_file_id:     fileId,
        drive_url:         fileUrl,
        preview_url:       previewUrl,
        thumbnail_url:     '',  // populated by scheduled refresh (requires Advanced Drive API)
        mime_type:         mimeType,
        file_size_bytes:   decoded.length,
        uploaded_by:       uploadedBy,
        uploaded_at:       new Date().toISOString(),
      });
    } catch(idxErr) {
      // Index write failure is logged but doesn't abort the upload
      Logger.log('DocumentIndex write failed: ' + idxErr.message);
    }

    // Append to legacy Documents JSON (backward compat — keep for one release)
    existing.push({ name: storedName, fileId: fileId, url: fileUrl, previewUrl: previewUrl, originalName: fileName });
    currentDocs[stageKey] = existing;
    sheet.getRange(rowNum, docsCol + 1).setValue(JSON.stringify(currentDocs));

    // Record history
    var sdUploadStageNum = SHIPMENT_STAGE_DEFS.map(function(d){ return d.key; }).indexOf(stageKey) + 1;
    recordHistoryEvent({
      shipmentId:  shipmentId,
      eventType:   'DOC_UPLOAD',
      stageNumber: sdUploadStageNum > 0 ? sdUploadStageNum : null,
      docId:       fileId,
      newValue:    storedName,
      actorName:   uploadedBy,
      source:      'ui_edit',
      contextNote: 'Size: ' + decoded.length + ' bytes',
    });

    // Activity log
    _logActivity(_resolveActor(body) || uploadedBy, 'doc_uploaded',
      'shipment', shipmentId,
      'Uploaded ' + fileName + ' (stage ' + (sdUploadStageNum > 0 ? sdUploadStageNum : stageKey) + ')' +
      (client ? ' · ' + client : ''), 0);

    return { success: true, fileId: fileId, url: fileUrl, previewUrl: previewUrl, name: storedName, originalName: fileName, documents: currentDocs };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: deleteShipmentDoc (soft delete) ─────────────────
function handleDeleteShipmentDoc(body) {
  try {
    var shipmentId = body.shipmentId || '';
    var stageKey   = body.status     || body.stageKey || '';
    var fileId     = body.fileId     || '';
    var fileName   = body.fileName   || '';
    var deletedBy  = body.user       || '';
    if (!shipmentId || !fileId) return { success: false, message: 'Missing params.' };

    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var docsCol = headers.indexOf('Documents');
    if (docsCol < 0) return { success: false, message: 'Documents column not found.' };

    var client = '', mode = '', shipmentDate = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === shipmentId) {
        var rowNum = i + 1;
        var docs   = {};
        try { docs = JSON.parse(String(data[i][docsCol] || '{}')); } catch(e) {}
        client       = String(data[i][2] || '');
        mode         = String(data[i][7] || 'SEA');
        shipmentDate = String(data[i][8] || '');

        // Remove from legacy JSON
        if (docs[stageKey]) {
          docs[stageKey] = docs[stageKey].filter(function(f) { return f.fileId !== fileId; });
        }
        sheet.getRange(rowNum, docsCol + 1).setValue(JSON.stringify(docs));

        // Soft delete: move to _Deleted folder (DON'T trash)
        try {
          var deletedFolder = _getDeletedFolder(shipmentId, client, mode, shipmentDate);
          var driveFile     = DriveApp.getFileById(fileId);
          driveFile.moveTo(deletedFolder);
        } catch(moveErr) {
          Logger.log('Soft-delete move failed for ' + fileId + ': ' + moveErr.message);
          // Do NOT abort — index update still proceeds
        }

        // Mark deleted in DocumentIndex
        try { _softDeleteDocIndex(fileId, deletedBy); } catch(idxErr) {
          Logger.log('DocumentIndex soft-delete failed: ' + idxErr.message);
        }

        // Record history
        var sdDelStageNum = SHIPMENT_STAGE_DEFS.map(function(d){ return d.key; }).indexOf(stageKey) + 1;
        recordHistoryEvent({
          shipmentId:  shipmentId,
          eventType:   'DOC_DELETE',
          stageNumber: sdDelStageNum > 0 ? sdDelStageNum : null,
          docId:       fileId,
          oldValue:    fileName || fileId,
          actorName:   deletedBy,
          source:      'ui_edit',
          contextNote: 'Soft-deleted (moved to _Deleted folder)',
        });

        // Activity log
        _logActivity(_resolveActor(body) || deletedBy, 'doc_deleted',
          'shipment', shipmentId,
          'Deleted ' + (fileName || fileId) + ' (stage ' + (sdDelStageNum > 0 ? sdDelStageNum : stageKey) + ')' +
          (client ? ' · ' + client : ''), 0);

        return { success: true, documents: docs };
      }
    }
    return { success: false, message: 'Shipment not found.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: restoreShipmentDoc (admin only) ──────────────────
function handleRestoreShipmentDoc(body) {
  try {
    var shipmentId = body.shipmentId || '';
    var stageKey   = body.stageKey   || body.status || '';
    var fileId     = body.fileId     || '';
    if (!shipmentId || !fileId) return { success: false, message: 'Missing params.' };

    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var docsCol = headers.indexOf('Documents');
    var client = '', mode = '', shipmentDate = '', rowNum = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === shipmentId) {
        rowNum       = i + 1;
        client       = String(data[i][2] || '');
        mode         = String(data[i][7] || 'SEA');
        shipmentDate = String(data[i][8] || '');
        break;
      }
    }
    if (rowNum < 0) return { success: false, message: 'Shipment not found.' };

    // Move file back to its original stage folder
    try {
      var stageFolder = _getShipmentStageFolder(shipmentId, stageKey, client, mode, shipmentDate);
      DriveApp.getFileById(fileId).moveTo(stageFolder);
    } catch(e) { Logger.log('Restore move failed: ' + e.message); }

    // Restore in index
    try { _restoreDocIndex(fileId); } catch(e) {}

    // Re-append to legacy JSON if not already there
    if (docsCol >= 0) {
      var docs = {};
      try { docs = JSON.parse(String(data[rowNum - 1][docsCol] || '{}')); } catch(e) {}
      var existing = docs[stageKey] || [];
      if (!existing.some(function(f){ return f.fileId === fileId; })) {
        existing.push({ fileId: fileId, url: DriveApp.getFileById(fileId).getUrl(),
                        previewUrl: 'https://drive.google.com/file/d/' + fileId + '/preview',
                        name: body.fileName || fileId });
        docs[stageKey] = existing;
        sheet.getRange(rowNum, docsCol + 1).setValue(JSON.stringify(docs));
      }
    }

    // Record history
    var sdRestoreStageNum = SHIPMENT_STAGE_DEFS.map(function(d){ return d.key; }).indexOf(stageKey) + 1;
    recordHistoryEvent({
      shipmentId:  shipmentId,
      eventType:   'DOC_RESTORE',
      stageNumber: sdRestoreStageNum > 0 ? sdRestoreStageNum : null,
      docId:       fileId,
      newValue:    body.fileName || fileId,
      actorName:   String(body.user || ''),
      source:      'ui_edit',
      contextNote: 'Restored from _Deleted folder',
    });

    return { success: true };
  } catch(err) {
    return { success: false, message: err.message };
  }
}

// ─── QUERY 1: getDocsByShipment ──────────────────────────────
function handleGetDocsByShipment(params) {
  try {
    var shipmentId = params.shipmentId || '';
    if (!shipmentId) return { success: false, message: 'Missing shipmentId.' };
    var sheet = _docIndexSheet();
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var r = _docIndexRowToObj(data[i], hdrs);
      if (r.shipment_id === shipmentId && !r.deleted_at) results.push(r);
    }
    // Group by phase → stage
    var grouped = {};
    results.forEach(function(r) {
      var p = r.phase_number;
      var s = r.stage_number;
      if (!grouped[p]) grouped[p] = {};
      if (!grouped[p][s]) grouped[p][s] = [];
      grouped[p][s].push(r);
    });
    return { success: true, docs: results, grouped: grouped };
  } catch(err) { return { success: false, message: err.message }; }
}

// ─── QUERY 2: getDocsByType ──────────────────────────────────
function handleGetDocsByType(params) {
  try {
    var shortCode = (params.stageShortCode || '').toUpperCase();
    var startDate = params.startDate || '';
    var endDate   = params.endDate   || '';
    var clientFilter = (params.clientFilter || '').toLowerCase();
    if (!shortCode) return { success: false, message: 'Missing stageShortCode.' };
    var sheet = _docIndexSheet();
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var r = _docIndexRowToObj(data[i], hdrs);
      if (r.stage_short_code !== shortCode) continue;
      if (r.deleted_at) continue;
      if (clientFilter && r.client_name.toLowerCase().indexOf(clientFilter) < 0) continue;
      if (startDate && r.uploaded_at < startDate) continue;
      if (endDate   && r.uploaded_at > endDate + 'Z') continue;
      results.push(r);
    }
    return { success: true, docs: results };
  } catch(err) { return { success: false, message: err.message }; }
}

// ─── QUERY 3: getDocsByClient ─────────────────────────────────
function handleGetDocsByClient(params) {
  try {
    var clientName = (params.clientName || '').toLowerCase();
    var startDate  = params.startDate   || '';
    var endDate    = params.endDate     || '';
    if (!clientName) return { success: false, message: 'Missing clientName.' };
    var sheet = _docIndexSheet();
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var r = _docIndexRowToObj(data[i], hdrs);
      if (r.client_name.toLowerCase().indexOf(clientName) < 0) continue;
      if (r.deleted_at) continue;
      if (startDate && r.uploaded_at < startDate) continue;
      if (endDate   && r.uploaded_at > endDate + 'Z') continue;
      results.push(r);
    }
    // Group by shipment then phase
    var grouped = {};
    results.forEach(function(r) {
      var sid = r.shipment_id;
      if (!grouped[sid]) grouped[sid] = {};
      var p = r.phase_number;
      if (!grouped[sid][p]) grouped[sid][p] = [];
      grouped[sid][p].push(r);
    });
    return { success: true, docs: results, grouped: grouped };
  } catch(err) { return { success: false, message: err.message }; }
}

// ─── QUERY 4: getAuditTrail ───────────────────────────────────
function handleGetAuditTrail(params) {
  try {
    var startDate      = params.startDate     || '';
    var endDate        = params.endDate       || '';
    var uploadedBy     = (params.uploadedBy   || '').toLowerCase();
    var stageNumber    = params.stageNumber   ? Number(params.stageNumber) : 0;
    var includeDeleted = params.includeDeleted === true || params.includeDeleted === 'true';
    var sheet = _docIndexSheet();
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var r = _docIndexRowToObj(data[i], hdrs);
      if (!includeDeleted && r.deleted_at) continue;
      if (startDate   && r.uploaded_at < startDate) continue;
      if (endDate     && r.uploaded_at > endDate + 'Z') continue;
      if (uploadedBy  && r.uploaded_by.toLowerCase().indexOf(uploadedBy) < 0) continue;
      if (stageNumber && Number(r.stage_number) !== stageNumber) continue;
      if (r.deleted_at) r._deleted = true;
      results.push(r);
    }
    results.sort(function(a, b) { return (b.uploaded_at || '').localeCompare(a.uploaded_at || ''); });
    return { success: true, docs: results };
  } catch(err) { return { success: false, message: err.message }; }
}

// Helper: map a DocumentIndex data row to an object
function _docIndexRowToObj(row, hdrs) {
  var obj = {};
  for (var c = 0; c < hdrs.length; c++) {
    obj[String(hdrs[c])] = row[c] !== undefined ? String(row[c]) : '';
  }
  return obj;
}

// ─── MIGRATION (dry-run first) ────────────────────────────────
// POST body: { dryRun: true|false, startToken: 0 }
// Processes ~50 shipments at a time to stay within 6-min limit.
// Returns { success, processed, skipped, errors, nextToken }
function handleMigrateShipmentDocs(body) {
  var dryRun     = body.dryRun !== false && body.dryRun !== 'false';
  var startToken = parseInt(body.startToken || 0, 10) || 0;
  var BATCH      = 50;
  var log = [];

  try {
    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var docsCol = headers.indexOf('Documents');
    if (docsCol < 0) return { success: false, message: 'Documents column not found.' };

    var rows = data.slice(1); // skip header
    var end  = Math.min(startToken + BATCH, rows.length);
    var processed = 0, skipped = 0, errors = 0;

    for (var i = startToken; i < end; i++) {
      var row        = rows[i];
      var shipmentId = String(row[0] || '');
      if (!shipmentId) { skipped++; continue; }
      var client       = String(row[2] || '');
      var mode         = String(row[7] || 'SEA');
      var shipmentDate = String(row[8] || '');
      var linkedSOs    = String(row[30] || '');
      var docsJson     = {};
      try { docsJson = JSON.parse(String(row[docsCol] || '{}')); } catch(e) {}

      Object.keys(docsJson).forEach(function(stageKey) {
        var files = docsJson[stageKey] || [];
        files.forEach(function(f) {
          if (!f.fileId) return;
          var newName = _buildStoredFilename(shipmentId, stageKey, f.name || f.fileId);
          log.push({
            dryRun:     dryRun,
            shipmentId: shipmentId,
            fileId:     f.fileId,
            oldName:    f.name,
            newName:    newName,
            action:     'rename+move+index',
          });
          if (!dryRun) {
            try {
              var driveFile = DriveApp.getFileById(f.fileId);
              var stageFolder = _getShipmentStageFolder(shipmentId, stageKey, client, mode, shipmentDate);
              driveFile.setName(newName);
              driveFile.moveTo(stageFolder);
              _writeDocIndex({
                shipment_id:       shipmentId,
                linked_po_numbers: linkedSOs,
                client_name:       client,
                stage_key:         stageKey,
                filename_stored:   newName,
                filename_original: f.name || '',
                drive_file_id:     f.fileId,
                drive_url:         driveFile.getUrl(),
                preview_url:       'https://drive.google.com/file/d/' + f.fileId + '/preview',
                thumbnail_url:     '',
                mime_type:         driveFile.getMimeType(),
                file_size_bytes:   driveFile.getSize(),
                uploaded_by:       'migration',
                uploaded_at:       new Date().toISOString(),
              });
              processed++;
            } catch(fileErr) {
              log.push({ error: fileErr.message, fileId: f.fileId });
              errors++;
            }
          } else {
            processed++;
          }
        });
      });
    }

    var nextToken = end < rows.length ? end : null;
    return {
      success: true, dryRun: dryRun,
      processed: processed, skipped: skipped, errors: errors,
      nextToken: nextToken, log: log,
      message: dryRun
        ? 'DRY RUN complete — no changes made. Review log then run with dryRun:false.'
        : 'Migration batch complete.',
    };
  } catch(err) {
    return { success: false, message: err.message };
  }
}

// Legacy folder helper (kept for fallback on unknown stage keys)
function _getShipmentDocFolder(shipmentId, status) {
  var root = DriveApp.getFolderById(SHIPMENT_DOCS_FOLDER_ID);
  var shipFolder = _getOrCreateSubFolder(root, shipmentId);
  return _getOrCreateSubFolder(shipFolder, status);
}



// ═══════════════════════════════════════════════════════════════
// SHIPMENT TIMELINE — Stage management
// ═══════════════════════════════════════════════════════════════

var SHIPMENT_STAGE_DEFS = [
  { key: 'so_received',             label: 'Sales Order Received',          owner: 'Sales',     autoDerive: true  },
  { key: 'po_created',              label: 'Purchase Order Created',        owner: 'Admin',     autoDerive: true  },
  { key: 'po_approved',             label: 'PO Approved',                   owner: 'Sir Larry', autoDerive: true  },
  { key: 'po_sent',                 label: 'PO Sent to Supplier',           owner: 'Admin',     autoDerive: true  },
  { key: 'proforma_received',       label: 'Proforma / Order Confirmation', owner: 'Supplier',  autoDerive: false },
  { key: 'prf_created',             label: 'Payment Request Created',       owner: 'Acct',      autoDerive: true  },
  { key: 'prf_approved',            label: 'PRF Approved',                  owner: 'Sir Larry', autoDerive: true  },
  { key: 'tt_sent',                 label: 'Telegraphic Transfer Sent',     owner: 'Acct',      autoDerive: false },
  { key: 'tt_forwarded',            label: 'TT Forwarded to Supplier',      owner: 'Admin',     autoDerive: false },
  { key: 'shipping_docs_received',  label: 'Shipping Docs Received',        owner: 'Supplier',  autoDerive: false },
  { key: 'forwarder_quotes',        label: 'Forwarder Quotations',          owner: 'Admin',     autoDerive: false },
  { key: 'forwarder_approved',      label: 'Forwarder Approved',            owner: 'Sir Larry', autoDerive: false },
  { key: 'booked',                  label: 'Booked (Waybill / AWB)',        owner: 'Admin',     autoDerive: true  },
  { key: 'pickup',                  label: 'Picked Up by Forwarder',        owner: 'Forwarder', autoDerive: false },
  { key: 'in_transit',              label: 'In Transit',                    owner: '—',         autoDerive: true  },
  { key: 'customs_clearance',       label: 'Customs Clearance',             owner: 'Broker',    autoDerive: false },
  { key: 'fan_sad_tan',             label: 'FAN / SAD / TAN (Customs Docs)',owner: 'Broker',    autoDerive: false },
  { key: 'debit_memo',              label: 'Bank Debit Memo',               owner: 'Bank',      autoDerive: false },
  { key: 'forwarder_final_invoice', label: 'Forwarder Final Invoice',       owner: 'Forwarder', autoDerive: false },
  { key: 'local_charges',           label: 'Local Charges',                 owner: 'Forwarder', autoDerive: false },
  { key: 'delivered',               label: 'Delivered',                     owner: 'Admin',     autoDerive: true  }
];

function _buildStageTimeline(shipmentRec, poRec, prRec, stagesJson, docsJson) {
  var stages = stagesJson || {};
  var docs   = docsJson   || {};

  var shipStatus = String(shipmentRec.status || '');
  var poStatus   = poRec ? String(poRec.overallStatus || '') : '';
  var poSentAt   = poRec ? String(poRec.sentAt        || '') : '';
  var prAdminApp = prRec ? String(prRec.adminApproval || '') : '';
  var prMgmtApp  = prRec ? String(prRec.mgmtApproval  || '') : '';

  // Auto-derive: only fill if stage is not already manually set
  function autoDone(key, condition, note) {
    if (!condition) return;
    if (stages[key] && stages[key].status !== 'pending' && !stages[key].autoderived) return;
    stages[key] = stages[key] || {};
    stages[key].status          = 'done';
    stages[key].autoderived     = true;
    stages[key].autoderivedNote = note;
  }

  autoDone('so_received',  String(shipmentRec.linkedSOs || '').trim() !== '',              'Linked SOs present');
  autoDone('po_created',   poRec !== null,                                                 'PO record exists');
  autoDone('po_approved',  poStatus === 'Fully Approved',                                  'PO Overall Status = Fully Approved');
  autoDone('po_sent',      poSentAt !== '',                                                'PO Sent At is set');
  autoDone('prf_created',  prRec !== null,                                                 'Payment Request linked');
  autoDone('prf_approved', prAdminApp === 'Approved' && prMgmtApp === 'Approved',          'PRF Admin + Mgmt Approved');

  // STATUS MODEL: (b) Status is fully independent of stage completion.
  // The Status dropdown (Pending / In Transit / etc.) is manually set by admin in the Edit modal.
  // Stages 'in_transit' and 'delivered' are NOT auto-derived from Status — they must be
  // manually marked Done in the Timeline modal.
  // Only 'booked' still auto-derives (from the AWB field being set).
  autoDone('booked', String(shipmentRec.awb || '').trim() !== '', 'AWB field is set');

  return SHIPMENT_STAGE_DEFS.map(function(def) {
    var st = stages[def.key] || {};
    return {
      key:             def.key,
      label:           def.label,
      owner:           def.owner,
      autoDerive:      def.autoDerive,
      status:          st.status          || 'pending',
      completedAt:     st.completedAt     || '',
      completedBy:     st.completedBy     || '',
      notes:           st.notes           || '',
      autoderived:     st.autoderived     || false,
      autoderivedNote: st.autoderivedNote || '',
      skippedReason:   st.skippedReason   || '',
      docs:            docs[def.key]      || []
    };
  });
}

// ─── ACTION: getShipmentTimeline ─────────────────────────────
function handleGetShipmentTimeline(params) {
  try {
    var shipmentId = String(params.shipmentId || '').trim();
    if (!shipmentId) return { success: false, message: 'Missing shipmentId.' };

    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });

    var shipmentRec = null;
    var stagesRaw   = '{}';
    var docsRaw     = '{}';

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== shipmentId) continue;
      var rec = {};
      headers.forEach(function(h, idx) { rec[h] = data[i][idx]; });

      function fmtD(v) { return v instanceof Date ? formatDate(v) : String(v || ''); }

      shipmentRec = {
        shipmentId: String(rec['Shipment ID'] || ''),
        poNo:       String(rec['PO No']       || ''),
        client:     String(rec['Client']      || ''),
        principal:  String(rec['Principal']   || ''),
        item:       String(rec['Item']        || ''),
        mode:       String(rec['Mode']        || ''),
        status:     String(rec['Status']      || 'Pending'),
        awb:        String(rec['AWB']         || ''),
        linkedSOs:  String(rec['Linked SOs']  || ''),
        eta:        fmtD(rec['ETA']),
        etd:        fmtD(rec['ETD']),
        shipmentDate: fmtD(rec['Shipment Date']),
        dateArrived:  fmtD(rec['Date Arrived'])
      };
      var si = headers.indexOf('Stages');
      var di = headers.indexOf('Documents');
      stagesRaw = si >= 0 ? String(data[i][si] || '{}') : '{}';
      docsRaw   = di >= 0 ? String(data[i][di] || '{}') : '{}';
      break;
    }
    if (!shipmentRec) return { success: false, message: 'Shipment not found.' };

    var stagesJson = {}; try { stagesJson = JSON.parse(stagesRaw); } catch(e) {}
    var docsJson   = {}; try { docsJson   = JSON.parse(docsRaw);   } catch(e) {}

    // Fetch linked PO record
    var poRec = null;
    if (shipmentRec.poNo) {
      var poSheet = _poRecordsSheet();
      var poData  = poSheet.getDataRange().getValues();
      var poHdrs  = poData[0].map(function(h) { return String(h).trim(); });
      for (var k = 1; k < poData.length; k++) {
        if (String(poData[k][0]) !== shipmentRec.poNo) continue;
        var pr = {};
        poHdrs.forEach(function(h, idx) { pr[h] = poData[k][idx]; });
        poRec = {
          poNo:          String(pr['PO No']          || ''),
          overallStatus: String(pr['Overall Status'] || ''),
          adminApproval: String(pr['Admin Approval'] || ''),
          mgmtApproval:  String(pr['Mgmt Approval']  || ''),
          sentAt:        String(pr['Sent At']         || '')
        };
        break;
      }
    }

    // Fetch linked Payment Request (match PO No in Purpose field)
    var prRec = null;
    if (shipmentRec.poNo) {
      var prSheet = _paymentRequestsSheet();
      var prData  = prSheet.getDataRange().getValues();
      for (var m = 1; m < prData.length; m++) {
        var purpose = String(prData[m][4] || '');
        if (purpose.indexOf(shipmentRec.poNo) < 0) continue;
        prRec = {
          prNumber:      String(prData[m][1]  || ''),
          adminApproval: String(prData[m][21] || '').trim() || 'Pending',
          mgmtApproval:  String(prData[m][22] || '').trim() || 'Pending',
          status:        String(prData[m][20] || '').trim() || 'Pending'
        };
        break;
      }
    }

    var timeline = _buildStageTimeline(shipmentRec, poRec, prRec, stagesJson, docsJson);

    return {
      success:  true,
      shipment: shipmentRec,
      poRecord: poRec,
      prRecord: prRec,
      timeline: timeline
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── ACTION: advanceShipmentStage ───────────────────────────
function handleAdvanceShipmentStage(body) {
  try {
    var shipmentId    = String(body.shipmentId  || '').trim();
    var stageKey      = String(body.stageKey    || '').trim();
    var action        = String(body.stageStatus || '').trim(); // 'done' | 'skipped' | 'pending'
    var notes         = String(body.notes       || '').trim();
    var user          = String(body.user        || '').trim();
    var skippedReason = String(body.skippedReason || '').trim().slice(0, 200);

    if (!shipmentId || !stageKey || !action) {
      return { success: false, message: 'Missing required params (shipmentId, stageKey, action).' };
    }

    var validKeys = SHIPMENT_STAGE_DEFS.map(function(d) { return d.key; });
    if (validKeys.indexOf(stageKey) < 0) {
      return { success: false, message: 'Invalid stage key: ' + stageKey };
    }
    if (['done', 'skipped', 'pending'].indexOf(action) < 0) {
      return { success: false, message: 'Invalid action. Must be done, skipped, or pending.' };
    }

    var sheet   = _shipmentSheet();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var stagesCol = headers.indexOf('Stages');
    if (stagesCol < 0) return { success: false, message: 'Stages column not found.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== shipmentId) continue;
      var rowNum = i + 1;
      var stages = {};
      try { stages = JSON.parse(String(data[i][stagesCol] || '{}')); } catch(e) {}

      // Capture old status for history
      var oldStatus = (stages[stageKey] || {}).status || 'pending';

      if (!stages[stageKey]) stages[stageKey] = {};
      stages[stageKey].status      = action;
      stages[stageKey].autoderived = false;
      if (notes) stages[stageKey].notes = notes;

      if (action === 'skipped' && skippedReason) {
        stages[stageKey].skippedReason = skippedReason;
      } else if (action !== 'skipped') {
        delete stages[stageKey].skippedReason;
      }

      if (action === 'done' || action === 'skipped') {
        stages[stageKey].completedAt = formatDate(new Date());
        stages[stageKey].completedBy = user;
      } else {
        delete stages[stageKey].completedAt;
        delete stages[stageKey].completedBy;
      }

      sheet.getRange(rowNum, stagesCol + 1).setValue(JSON.stringify(stages));

      // Record history event
      var stageNum = SHIPMENT_STAGE_DEFS.map(function(d){ return d.key; }).indexOf(stageKey) + 1;
      var evtType  = action === 'done'    ? 'STAGE_DONE'
                   : action === 'skipped' ? 'STAGE_SKIPPED'
                   : 'STAGE_RESET';
      var ctxNote  = action === 'skipped' && skippedReason ? skippedReason
                   : notes || '';
      recordHistoryEvent({
        shipmentId:  shipmentId,
        eventType:   evtType,
        stageNumber: stageNum > 0 ? stageNum : null,
        oldValue:    oldStatus,
        newValue:    action,
        actorName:   user,
        source:      'ui_edit',
        contextNote: ctxNote,
      });

      // Activity log (per-user daily report)
      var stageLabel = (SHIPMENT_STAGE_DEFS[stageNum - 1] && SHIPMENT_STAGE_DEFS[stageNum - 1].label) || stageKey;
      var stageSummary = 'Stage ' + (stageNum > 0 ? stageNum + ' ' : '') + stageLabel +
        ' → ' + action + (ctxNote ? ' · ' + String(ctxNote).slice(0, 80) : '');
      _logActivity(_resolveActor(body) || user, 'stage_' + action,
        'shipment', shipmentId, stageSummary, 0);

      // Record STAGE_NOTE separately if notes were changed
      if (notes && oldStatus === action) {
        recordHistoryEvent({
          shipmentId:  shipmentId,
          eventType:   'STAGE_NOTE',
          stageNumber: stageNum > 0 ? stageNum : null,
          newValue:    notes,
          actorName:   user,
          source:      'ui_edit',
        });
      }

      return { success: true, stages: stages };
    }
    return { success: false, message: 'Shipment not found.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SHIPMENT HISTORY — Audit Trail System
// ═══════════════════════════════════════════════════════════════

// ── Column order (17) ────────────────────────────────────────
var _HISTORY_HEADERS = [
  'event_id','shipment_id','event_timestamp','event_type','event_category',
  'field_name','old_value','new_value','stage_number','doc_id',
  'actor_email','actor_name','actor_role','source','context_note',
  'client_name','linked_po_numbers'
];

// event_type → event_category
var _HISTORY_CATEGORIES = {
  FIELD_CHANGE:      'field',
  STAGE_DONE:        'stage',    STAGE_SKIPPED:   'stage',
  STAGE_RESET:       'stage',    STAGE_NOTE:      'stage',
  DOC_UPLOAD:        'document', DOC_DELETE:      'document',
  DOC_RESTORE:       'document', DOC_RENAME:      'document',
  DOC_MOVE:          'document',
  SHIPMENT_CREATED:  'lifecycle',SHIPMENT_CLOSED: 'lifecycle',
  SHIPMENT_ARCHIVED: 'lifecycle',PHASE_COMPLETED: 'lifecycle',
  AUTO_DERIVATION:   'system',   CORRECTION:      'field',
  MANUAL_EDIT:       'system',
};

// Sheet column header → snake_case field_name for FIELD_CHANGE events
var _HISTORY_FIELD_MAP = {
  'Mode':              'mode',
  'Shipment Date':     'shipment_date',
  'ETD':               'etd',
  'ETA':               'eta',
  'AWB':               'awb',
  'Logistics':         'logistics_company',
  'Freight-In':        'freight_in',
  'Import Duties':     'import_duties',
  'Customs/Brokerage': 'customs_brokerage',
  'Handling':          'handling',
  'Delivery Expense':  'delivery_expense',
  'Date Arrived':      'date_arrived',
  'Total Amount':      'total_amount',
  'Amount Paid':       'amount_paid',
  'Balance':           'balance',
  'Date of Payment':   'date_of_payment',
  'Payment Status':    'payment_status',
  'Payment Method':    'payment_method',
  'Sales Invoice':     'sales_invoice',
  'Delivery Receipt':  'delivery_receipt',
  'Status':            'status',
  'Remarks':           'remarks',
  'Clients PO':        'clients_po',
  'HI-ESCORP PO':      'hiescorp_po',
  'Principal':         'principal',
  'Item':              'item',
  'Linked SOs':        'linked_sales_orders',
};

// ── Sheet accessors ──────────────────────────────────────────

function _historySheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'ShipmentHistory', _HISTORY_HEADERS);
}

function _historyArchiveSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'ShipmentHistoryArchive', _HISTORY_HEADERS);
}

function _historyFailuresSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'HistoryWriteFailures', [
    'failed_at','shipment_id','event_type','error_message','opts_json'
  ]);
}

function _historySettingsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sh = ss.getSheetByName('Settings');
  if (!sh) {
    sh = ss.insertSheet('Settings');
    sh.appendRow(['setting_key','value','notes']);
    sh.appendRow(['history_active_retention_days', '365', 'Days to keep events in active sheet']);
    sh.appendRow(['history_archive_retention_days', '2555', 'Days to keep in archive (~7 years)']);
    sh.appendRow(['history_archive_enabled', 'TRUE', 'Move old events to archive sheet']);
    sh.appendRow(['history_purge_enabled', 'FALSE', 'Delete archive rows after archive retention']);
    sh.appendRow(['history_tracking_start', new Date().toISOString(), 'Date history tracking began (Option B)']);
  }
  return sh;
}

function _historyRetentionSettings() {
  try {
    var sh   = _historySettingsSheet();
    var data = sh.getDataRange().getValues();
    var map  = {};
    for (var i = 1; i < data.length; i++) {
      map[String(data[i][0]).trim()] = String(data[i][1]).trim();
    }
    return {
      activeRetentionDays:  parseInt(map['history_active_retention_days']  || '365'),
      archiveRetentionDays: parseInt(map['history_archive_retention_days'] || '2555'),
      archiveEnabled:       (map['history_archive_enabled']  || 'TRUE').toUpperCase() === 'TRUE',
      purgeEnabled:         (map['history_purge_enabled']    || 'FALSE').toUpperCase() === 'TRUE',
      trackingStart:        map['history_tracking_start'] || '',
    };
  } catch(e) {
    return { activeRetentionDays: 365, archiveRetentionDays: 2555, archiveEnabled: true, purgeEnabled: false, trackingStart: '' };
  }
}

// ── Core recorder ────────────────────────────────────────────

function recordHistoryEvent(opts) {
  try {
    var shipmentId  = String(opts.shipmentId  || '').trim();
    var eventType   = String(opts.eventType   || '').trim();
    if (!shipmentId || !eventType) return null;

    var now         = new Date().toISOString();
    var eventId     = Utilities.getUuid();
    var category    = _HISTORY_CATEGORIES[eventType] || 'system';

    // Denormalize client + POs
    var clientName  = String(opts.clientName  || '').trim();
    var linkedPOs   = String(opts.linkedPOs   || '').trim();
    if (!clientName || !linkedPOs) {
      try {
        var sh   = _shipmentSheet();
        var rows = sh.getDataRange().getValues();
        var hdrs = rows[0].map(function(h){ return String(h).trim(); });
        var cIdx = hdrs.indexOf('Client');
        var pIdx = hdrs.indexOf('PO No');
        for (var r = 1; r < rows.length; r++) {
          if (String(rows[r][0]).trim() === shipmentId) {
            if (!clientName) clientName = String(rows[r][cIdx] || '');
            if (!linkedPOs)  linkedPOs  = String(rows[r][pIdx] || '');
            break;
          }
        }
      } catch(ex) { /* non-fatal */ }
    }

    var row = [
      eventId,
      shipmentId,
      now,
      eventType,
      category,
      String(opts.fieldName    || ''),
      String(opts.oldValue     || ''),
      String(opts.newValue     || ''),
      opts.stageNumber != null ? String(opts.stageNumber) : '',
      String(opts.docId        || ''),
      String(opts.actorEmail   || ''),
      String(opts.actorName    || opts.actor || ''),
      String(opts.actorRole    || ''),
      String(opts.source       || 'ui_edit'),
      String(opts.contextNote  || ''),
      clientName,
      linkedPOs,
    ];

    _historySheet().appendRow(row);
    return eventId;

  } catch(err) {
    // Never throw — log failure and continue
    try {
      _historyFailuresSheet().appendRow([
        new Date().toISOString(),
        String(opts.shipmentId || ''),
        String(opts.eventType  || ''),
        err.message,
        JSON.stringify(opts).slice(0, 500)
      ]);
    } catch(e2) { /* genuinely can't do anything */ }
    return null;
  }
}

// Batch variant — builds rows in memory, single sheet write
function _recordHistoryEventsBatch(eventsArr) {
  if (!eventsArr || !eventsArr.length) return;
  try {
    var now = new Date();
    var sh  = _historySheet();

    // Fetch shipment denorm data once if there are events that need it
    var denormCache = {};
    try {
      var smSh  = _shipmentSheet();
      var smRows = smSh.getDataRange().getValues();
      var smHdrs = smRows[0].map(function(h){ return String(h).trim(); });
      var cIdx   = smHdrs.indexOf('Client');
      var pIdx   = smHdrs.indexOf('PO No');
      for (var r = 1; r < smRows.length; r++) {
        var sid = String(smRows[r][0]).trim();
        if (sid) denormCache[sid] = { client: String(smRows[r][cIdx] || ''), po: String(smRows[r][pIdx] || '') };
      }
    } catch(e) { /* non-fatal */ }

    var rows = eventsArr.map(function(opts) {
      var shipmentId = String(opts.shipmentId || '').trim();
      var dn = denormCache[shipmentId] || { client: '', po: '' };
      return [
        Utilities.getUuid(),
        shipmentId,
        opts.timestamp || now.toISOString(),
        String(opts.eventType  || ''),
        _HISTORY_CATEGORIES[opts.eventType] || 'system',
        String(opts.fieldName  || ''),
        String(opts.oldValue   || ''),
        String(opts.newValue   || ''),
        opts.stageNumber != null ? String(opts.stageNumber) : '',
        String(opts.docId      || ''),
        String(opts.actorEmail || ''),
        String(opts.actorName  || opts.actor || ''),
        String(opts.actorRole  || ''),
        String(opts.source     || 'ui_edit'),
        String(opts.contextNote|| ''),
        String(opts.clientName || dn.client),
        String(opts.linkedPOs  || dn.po),
      ];
    });

    if (rows.length === 1) {
      sh.appendRow(rows[0]);
    } else {
      var lastRow = sh.getLastRow();
      sh.getRange(lastRow + 1, 1, rows.length, _HISTORY_HEADERS.length).setValues(rows);
    }
  } catch(err) {
    try {
      _historyFailuresSheet().appendRow([
        new Date().toISOString(), '', 'BATCH',
        err.message, JSON.stringify(eventsArr).slice(0, 500)
      ]);
    } catch(e2) {}
  }
}

// ── Row → object helper ──────────────────────────────────────

function _historyRowToObj(row) {
  var h = _HISTORY_HEADERS;
  var obj = {};
  for (var i = 0; i < h.length; i++) obj[h[i]] = row[i] != null ? String(row[i]) : '';
  return obj;
}

// ── Query: per-shipment history ──────────────────────────────

function handleGetShipmentHistory(params) {
  try {
    var shipmentId  = String(params.shipmentId || '').trim();
    if (!shipmentId) return { success: false, message: 'shipmentId required.' };

    var page        = Math.max(1, parseInt(params.page     || '1'));
    var pageSize    = Math.min(200, Math.max(1, parseInt(params.pageSize || '50')));
    var hideSystem  = params.hideSystem !== 'false' && params.hideSystem !== false;
    var eventTypes  = params.eventTypes
      ? (Array.isArray(params.eventTypes) ? params.eventTypes : String(params.eventTypes).split(',').map(function(s){ return s.trim(); }))
      : [];
    var dateFrom    = String(params.dateFrom || '').trim();
    var dateTo      = String(params.dateTo   || '').trim();
    var actor       = String(params.actor    || '').trim().toLowerCase();

    var settings    = _historyRetentionSettings();

    // Collect matching events from relevant sheets
    var allEvents = _queryHistorySheets(shipmentId, dateFrom, dateTo, settings);

    // Apply filters
    allEvents = allEvents.filter(function(e) {
      if (hideSystem && e.event_category === 'system') return false;
      if (eventTypes.length && eventTypes.indexOf(e.event_type) < 0) return false;
      if (actor && (e.actor_name || '').toLowerCase().indexOf(actor) < 0) return false;
      return true;
    });

    // Sort newest first
    allEvents.sort(function(a, b) {
      return String(b.event_timestamp).localeCompare(String(a.event_timestamp));
    });

    var totalCount = allEvents.length;
    var start      = (page - 1) * pageSize;
    var pageEvents = allEvents.slice(start, start + pageSize);

    return {
      success: true,
      events: pageEvents,
      totalCount: totalCount,
      page: page,
      pageSize: pageSize,
      hasMore: (start + pageSize) < totalCount,
      trackingStart: settings.trackingStart,
    };
  } catch(err) {
    return { success: false, message: 'Error: ' + err.message };
  }
}

// ── Query: global audit log ──────────────────────────────────

function handleGetGlobalAuditLog(params) {
  try {
    var dateFrom = String(params.dateFrom || '').trim();
    if (!dateFrom) return { success: false, message: 'dateFrom is required for the global audit log. Please specify a date range.' };

    var dateTo      = String(params.dateTo      || '').trim();
    var client      = String(params.client      || '').trim().toLowerCase();
    var shipmentId  = String(params.shipmentId  || '').trim();
    var fieldName   = String(params.fieldName   || '').trim().toLowerCase();
    var actor       = String(params.actor       || '').trim().toLowerCase();
    var eventTypes  = params.eventTypes
      ? (Array.isArray(params.eventTypes) ? params.eventTypes : String(params.eventTypes).split(',').map(function(s){ return s.trim(); }))
      : [];
    var page        = Math.max(1, parseInt(params.page     || '1'));
    var pageSize    = Math.min(200, Math.max(1, parseInt(params.pageSize || '100')));
    var settings    = _historyRetentionSettings();

    var allEvents = _queryHistorySheets(null, dateFrom, dateTo, settings);

    allEvents = allEvents.filter(function(e) {
      if (client     && (e.client_name || '').toLowerCase().indexOf(client)   < 0) return false;
      if (shipmentId && e.shipment_id !== shipmentId)                             return false;
      if (fieldName  && (e.field_name  || '').toLowerCase().indexOf(fieldName) < 0) return false;
      if (actor      && (e.actor_name  || '').toLowerCase().indexOf(actor)    < 0) return false;
      if (eventTypes.length && eventTypes.indexOf(e.event_type) < 0)              return false;
      return true;
    });

    allEvents.sort(function(a, b) {
      return String(b.event_timestamp).localeCompare(String(a.event_timestamp));
    });

    var totalCount  = allEvents.length;
    var start       = (page - 1) * pageSize;
    var pageEvents  = allEvents.slice(start, start + pageSize);

    return {
      success: true,
      events: pageEvents,
      totalCount: totalCount,
      page: page,
      pageSize: pageSize,
      hasMore: (start + pageSize) < totalCount,
    };
  } catch(err) {
    return { success: false, message: 'Error: ' + err.message };
  }
}

// Shared sheet reader used by both query functions
function _queryHistorySheets(shipmentIdFilter, dateFrom, dateTo, settings) {
  var events = [];
  var sheets = [_historySheet()];

  // Include archive if the date range extends back
  if (dateFrom) {
    var dfMs     = new Date(dateFrom).getTime();
    var cutoffMs = Date.now() - (settings.activeRetentionDays * 86400000);
    if (dfMs < cutoffMs) sheets.push(_historyArchiveSheet());
  }

  sheets.forEach(function(sh) {
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return;
    var hdrs = data[0].map(function(h){ return String(h).trim(); });
    var tsIdx  = hdrs.indexOf('event_timestamp');
    var sidIdx = hdrs.indexOf('shipment_id');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue; // skip empty rows

      // shipment filter
      if (shipmentIdFilter && String(row[sidIdx]).trim() !== shipmentIdFilter) continue;

      // date filter
      if (dateFrom || dateTo) {
        var ts = String(row[tsIdx] || '');
        if (dateFrom && ts < dateFrom) continue;
        if (dateTo   && ts > dateTo + 'T23:59:59Z') continue;
      }

      var obj = {};
      for (var j = 0; j < hdrs.length; j++) {
        obj[hdrs[j]] = row[j] != null ? String(row[j]) : '';
      }
      events.push(obj);
    }
  });

  return events;
}

// ── Query: filter values for dropdowns ──────────────────────

function handleGetAuditLogFilterValues(params) {
  var cacheKey = 'audit_filter_values_v1';
  var cache    = CacheService.getScriptCache();
  var cached   = cache.get(cacheKey);
  if (cached) {
    try { return { success: true, data: JSON.parse(cached) }; } catch(e) {}
  }

  try {
    var sh   = _historySheet();
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: { clients: [], actors: [], eventTypes: [] } };

    var hdrs     = data[0].map(function(h){ return String(h).trim(); });
    var cIdx     = hdrs.indexOf('client_name');
    var aIdx     = hdrs.indexOf('actor_name');
    var etIdx    = hdrs.indexOf('event_type');

    var clients  = {}, actors = {}, eventTypes = {};
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var c = String(data[i][cIdx] || '').trim();
      var a = String(data[i][aIdx] || '').trim();
      var t = String(data[i][etIdx]|| '').trim();
      if (c) clients[c]    = 1;
      if (a) actors[a]     = 1;
      if (t) eventTypes[t] = 1;
    }

    var result = {
      clients:    Object.keys(clients).sort(),
      actors:     Object.keys(actors).sort(),
      eventTypes: Object.keys(eventTypes).sort(),
    };

    cache.put(cacheKey, JSON.stringify(result), 900); // 15 min
    return { success: true, data: result };
  } catch(err) {
    return { success: false, message: err.message };
  }
}

// ── CSV export ───────────────────────────────────────────────

function handleExportAuditLogCsv(body) {
  try {
    var r = handleGetGlobalAuditLog(Object.assign({}, body, { pageSize: 5000, page: 1 }));
    if (!r.success) return r;

    var rows = [_HISTORY_HEADERS.join(',')];
    r.events.forEach(function(e) {
      var line = _HISTORY_HEADERS.map(function(h) {
        var v = String(e[h] || '').replace(/"/g,'""');
        return '"' + v + '"';
      }).join(',');
      rows.push(line);
    });

    return { success: true, csv: rows.join('\r\n'), rowCount: r.events.length };
  } catch(err) {
    return { success: false, message: err.message };
  }
}

// ── Archival job ─────────────────────────────────────────────

function archiveOldHistoryEvents() {
  var props    = PropertiesService.getScriptProperties();
  var settings = _historyRetentionSettings();
  if (!settings.archiveEnabled) return;

  var cutoff = new Date(Date.now() - settings.activeRetentionDays * 86400000).toISOString();
  var sh     = _historySheet();
  var data   = sh.getDataRange().getValues();
  if (data.length < 2) return;

  var hdrs   = data[0].map(function(h){ return String(h).trim(); });
  var tsIdx  = hdrs.indexOf('event_timestamp');

  // Find rows to move (oldest first to avoid row-shift issues)
  var toMove = [];
  for (var i = 1; i < data.length; i++) {
    var ts = String(data[i][tsIdx] || '');
    if (ts && ts < cutoff) toMove.push({ rowNum: i + 1, data: data[i] });
  }

  if (!toMove.length) return;

  var BATCH = 200;
  var processed = parseInt(props.getProperty('archive_progress') || '0');
  var batch     = toMove.slice(processed, processed + BATCH);

  // Write to archive
  var archSh    = _historyArchiveSheet();
  var archData  = batch.map(function(r){ return r.data; });
  archSh.getRange(archSh.getLastRow() + 1, 1, archData.length, _HISTORY_HEADERS.length).setValues(archData);

  // Delete from active (delete rows from bottom to top to preserve indices)
  var rowNums = batch.map(function(r){ return r.rowNum; }).sort(function(a,b){ return b-a; });
  rowNums.forEach(function(rn){ sh.deleteRow(rn); });

  // Check if archive needs year-bucketing
  _historyMaybeRotateArchive(archSh, settings);

  var newProgress = processed + batch.length;
  if (newProgress >= toMove.length) {
    props.deleteProperty('archive_progress');
  } else {
    props.setProperty('archive_progress', String(newProgress));
    // Re-trigger for next batch
    ScriptApp.newTrigger('archiveOldHistoryEvents').timeBased().after(1000).create();
  }
}

function _historyMaybeRotateArchive(archSh, settings) {
  try {
    if (archSh.getLastRow() < 100000) return;
    var ss      = SpreadsheetApp.openById(USERS_SHEET_ID);
    var data    = archSh.getDataRange().getValues();
    var hdrs    = data[0].map(function(h){ return String(h).trim(); });
    var tsIdx   = hdrs.indexOf('event_timestamp');
    var yearMap = {};

    for (var i = 1; i < data.length; i++) {
      var ts = String(data[i][tsIdx] || '');
      if (!ts) continue;
      var yr = ts.substring(0, 4);
      if (!yearMap[yr]) yearMap[yr] = [];
      yearMap[yr].push(data[i]);
    }

    // Move oldest year to a bucketed sheet
    var years = Object.keys(yearMap).sort();
    if (years.length < 2) return; // keep at least 2 years active
    var yr    = years[0];
    var shName= 'ShipmentHistoryArchive_' + yr;
    var yrSh  = _getOrCreateSheet(ss, shName, _HISTORY_HEADERS);
    var rows  = yearMap[yr];
    if (rows.length) {
      yrSh.getRange(yrSh.getLastRow() + 1, 1, rows.length, _HISTORY_HEADERS.length).setValues(rows);
    }

    // Delete those rows from main archive (bottom-up by row index)
    var toDelete = [];
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][tsIdx] || '').substring(0, 4) === yr) toDelete.push(j + 1);
    }
    toDelete.sort(function(a,b){ return b-a; }).forEach(function(rn){ archSh.deleteRow(rn); });

    // Purge if enabled
    if (settings.purgeEnabled) {
      var purgeCutoff = new Date(Date.now() - settings.archiveRetentionDays * 86400000).toISOString();
      var yrData = yrSh.getDataRange().getValues();
      var yrHdrs = yrData[0].map(function(h){ return String(h).trim(); });
      var yrTsIdx= yrHdrs.indexOf('event_timestamp');
      var purgeRows = [];
      for (var k = 1; k < yrData.length; k++) {
        if (String(yrData[k][yrTsIdx] || '') < purgeCutoff) purgeRows.push(k + 1);
      }
      purgeRows.sort(function(a,b){ return b-a; }).forEach(function(rn){ yrSh.deleteRow(rn); });
    }
  } catch(e) { /* non-fatal */ }
}

// ── Install archival trigger ─────────────────────────────────

function _installHistoryArchiveTrigger() {
  // Remove existing daily triggers for this function to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'archiveOldHistoryEvents') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('archiveOldHistoryEvents')
    .timeBased().everyDays(1).atHour(2).create();
}

// ── onEdit installable trigger — best-effort manual edit detection ──

function onShipmentSheetEdit(e) {
  try {
    var sh = e.source.getActiveSheet();
    if (sh.getName() !== 'Shipment Monitoring') return;
    var range   = e.range;
    var rowNum  = range.getRow();
    if (rowNum < 2) return; // header row

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function(h){ return String(h).trim(); });
    var colNum  = range.getColumn();
    var colName = headers[colNum - 1] || '';
    var fieldName = _HISTORY_FIELD_MAP[colName] || colName;

    var shipmentId = String(sh.getRange(rowNum, 1).getValue()).trim();
    if (!shipmentId) return;

    recordHistoryEvent({
      shipmentId:  shipmentId,
      eventType:   'MANUAL_EDIT',
      fieldName:   fieldName,
      oldValue:    String(e.oldValue || ''),
      newValue:    String(e.value    || ''),
      actorEmail:  String((e.user && e.user.getEmail()) || ''),
      actorName:   String((e.user && e.user.getEmail()) || 'unknown'),
      actorRole:   'unknown',
      source:      'manual_sheet_edit',
      contextNote: 'Manual sheet edit detected by onEdit trigger',
    });
  } catch(err) { /* never block the edit */ }
}

// ── Backfill (Option B — no-op) ─────────────────────────────

function handleBackfillHistory(body) {
  return {
    success: false,
    message: 'Backfill not applicable — this system uses Option B (empty start). History is recorded from deployment day onward.',
    trackingStart: _historyRetentionSettings().trackingStart,
  };
}

// ═══════════════════════════════════════════════════════════════
// PAYROLL SYSTEM
// ═══════════════════════════════════════════════════════════════

function _payrollEmployeesSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Payroll Employees', [
    'Last Name', 'First Name', 'Daily Rate', 'Other Income', 'HDMF Amount', 'Status'
  ]);
}
function _payrollHoursSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Payroll Hours', [
    'Period', 'Employee', 'Date', 'Day Type', 'Hours'
  ]);
}
function _payrollRegisterSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Payroll Register', [
    'Period', 'Employee', 'Basic Pay', 'Holiday Pay', 'OT Pay',
    'Other Income', 'Gross Pay', 'Pag-IBIG', 'SSS', 'PhilHealth',
    'Advances', 'WTax', 'Total Deductions', 'Net Pay'
  ]);
}
function _payrollApprovalsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Payroll Approvals', [
    'Period', 'Cutoff Label', 'Submitted By', 'Submitted At',
    'Status', 'Approved By', 'Decided At', 'Notes',
    'Totals JSON', 'Snapshot HTML'
  ]);
}

function handleGetPayrollEmployees() {
  try {
    var sheet = _payrollEmployeesSheet();
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[1]) continue;
      var dr = parseFloat(row[2]) || 0;
      results.push({ id: i, lastName: String(row[0]||''), firstName: String(row[1]||''),
        name: String(row[0]||'') + ', ' + String(row[1]||''),
        dailyRate: dr, hourlyRate: dr > 0 ? dr/8 : 0,
        otherIncome: parseFloat(row[3])||0, hdmfAmount: parseFloat(row[4])||0,
        status: String(row[5]||'Active') });
    }
    return { success: true, data: results };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleSavePayrollEmployee(params) {
  try {
    var sheet = _payrollEmployeesSheet();
    var data  = sheet.getDataRange().getValues();
    var id    = parseInt(params.id) || 0;
    var row   = [params.lastName||'', params.firstName||'',
      parseFloat(params.dailyRate)||0, parseFloat(params.otherIncome)||0,
      parseFloat(params.hdmfAmount)||0, params.status||'Active'];
    if (id > 0 && id < data.length) sheet.getRange(id+1,1,1,row.length).setValues([row]);
    else sheet.appendRow(row);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleDeletePayrollEmployee(params) {
  try {
    var id = parseInt(params.id)||0;
    if (id < 1) return { success: false, message: 'Invalid ID.' };
    _payrollEmployeesSheet().deleteRow(id+1);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleGetPayrollHours(params) {
  try {
    var period = String(params.period||'');
    var sheet  = _payrollHoursSheet();
    var data   = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (period && String(row[0]) !== period) continue;
      var dv = row[2];
      var dateStr = (dv instanceof Date) ? formatDate(dv) : String(dv||'');
      results.push({ period: String(row[0]), employee: String(row[1]||''),
        date: dateStr, dayType: String(row[3]||'Regular'), hours: parseFloat(row[4])||0 });
    }
    return { success: true, data: results };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleSavePayrollHours(params) {
  try {
    var period = String(params.period||'');
    var rows   = JSON.parse(params.rows||'[]');
    if (!period) return { success: false, message: 'Period required.' };
    var sheet = _payrollHoursSheet();
    var data  = sheet.getDataRange().getValues();
    for (var i = data.length; i >= 2; i--) { if (String(data[i-1][0]) === period) sheet.deleteRow(i); }
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var hrs = parseFloat(r.hours)||0;
      if (!hrs) continue;
      sheet.appendRow([period, r.employee, r.date, r.dayType||'Regular', hrs]);
    }
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleGetPayrollRegister(params) {
  try {
    var period = String(params.period||'');
    var sheet  = _payrollRegisterSheet();
    var data   = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (period && String(row[0]) !== period) continue;
      results.push({ period: String(row[0]), employee: String(row[1]||''),
        basicPay: parseFloat(row[2])||0, holidayPay: parseFloat(row[3])||0,
        otPay: parseFloat(row[4])||0, otherIncome: parseFloat(row[5])||0,
        grossPay: parseFloat(row[6])||0, pagibig: parseFloat(row[7])||0,
        sss: parseFloat(row[8])||0, philhealth: parseFloat(row[9])||0,
        advances: parseFloat(row[10])||0, wtax: parseFloat(row[11])||0,
        totalDeductions: parseFloat(row[12])||0, netPay: parseFloat(row[13])||0 });
    }
    return { success: true, data: results };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleSavePayrollRegister(params) {
  try {
    var period = String(params.period||'');
    var rows   = JSON.parse(params.rows||'[]');
    if (!period) return { success: false, message: 'Period required.' };
    var sheet = _payrollRegisterSheet();
    var data  = sheet.getDataRange().getValues();
    for (var i = data.length; i >= 2; i--) { if (String(data[i-1][0]) === period) sheet.deleteRow(i); }
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var basic=parseFloat(r.basicPay)||0, hol=parseFloat(r.holidayPay)||0,
          ot=parseFloat(r.otPay)||0, other=parseFloat(r.otherIncome)||0,
          gross=basic+hol+ot+other,
          pag=parseFloat(r.pagibig)||0, sss=parseFloat(r.sss)||0,
          phic=parseFloat(r.philhealth)||0, adv=parseFloat(r.advances)||0,
          wtax=parseFloat(r.wtax)||0, totDed=pag+sss+phic+adv+wtax;
      sheet.appendRow([period,r.employee,basic,hol,ot,other,gross,pag,sss,phic,adv,wtax,totDed,gross-totDed]);
    }
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// BANK ACCOUNTS — three fixed accounts seeded on first use.
// AUB is the payables account (PR payments auto-debit it).
// Metrobank Zabarte + SJDM receive client payments and fund AUB.
// ═══════════════════════════════════════════════════════════════
function _bankAccountsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  var sheet = _getOrCreateSheet(ss, 'Bank Accounts', [
    'Code', 'Name', 'Bank', 'Branch', 'Account Number', 'Currency',
    'Opening Balance', 'Notes', 'Active', 'Created At'
  ]);
  // Seed the three accounts the business uses if the sheet is empty.
  if (sheet.getLastRow() < 2) {
    var now = new Date().toISOString();
    sheet.appendRow(['METRO_ZAB', 'Metrobank Zabarte', 'Metrobank', 'Zabarte', '', 'PHP', 0, 'Client deposits + AUB funding source', 'Yes', now]);
    sheet.appendRow(['METRO_SJDM', 'Metrobank SJDM',   'Metrobank', 'SJDM',    '', 'PHP', 0, 'Client deposits + AUB funding source', 'Yes', now]);
    sheet.appendRow(['AUB',        'AUB',              'AUB',       '',        '', 'PHP', 0, 'Payables, expenses, salaries — auto-debited by PR Paid', 'Yes', now]);
  }
  return sheet;
}

function _bankTransactionsSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Bank Transactions', [
    'ID', 'Date', 'Account Code', 'Type', 'Direction', 'Amount', 'Currency',
    'Description', 'Ref Type', 'Ref ID', 'Paired ID', 'Created By', 'Created At'
  ]);
  // Direction: 1 = credit (money in), -1 = debit (money out)
  // Paired ID links the two legs of a Transfer transaction.
}

// Internal — append a single transaction. Returns the new ID.
function _appendBankTransaction(t) {
  var sheet = _bankTransactionsSheet();
  var id = Utilities.getUuid();
  var date = t.date || new Date().toISOString();
  var direction = (t.direction === 1 || t.direction === -1) ? t.direction : -1;
  sheet.appendRow([
    id,
    date,
    String(t.accountCode || ''),
    String(t.type || 'Adjustment'),
    direction,
    Math.abs(parseFloat(t.amount) || 0),
    String(t.currency || 'PHP'),
    String(t.description || ''),
    String(t.refType || ''),
    String(t.refId || ''),
    String(t.pairedId || ''),
    String(t.createdBy || ''),
    new Date().toISOString()
  ]);
  return id;
}

function handleGetBankAccounts() {
  try {
    var accSheet = _bankAccountsSheet();
    var accData = accSheet.getDataRange().getValues();
    var txSheet = _bankTransactionsSheet();
    var txData = txSheet.getDataRange().getValues();

    // Sum signed transactions per account code
    var balances = {};
    var counts = {};
    for (var t = 1; t < txData.length; t++) {
      var code = String(txData[t][2] || '');
      if (!code) continue;
      var dir = parseFloat(txData[t][4]) || 0;
      var amt = parseFloat(txData[t][5]) || 0;
      balances[code] = (balances[code] || 0) + dir * amt;
      counts[code] = (counts[code] || 0) + 1;
    }

    var results = [];
    for (var i = 1; i < accData.length; i++) {
      var row = accData[i];
      if (!row[0]) continue;
      var code = String(row[0]);
      var opening = parseFloat(row[6]) || 0;
      results.push({
        rowIndex: i + 1,
        code: code,
        name: String(row[1] || ''),
        bank: String(row[2] || ''),
        branch: String(row[3] || ''),
        accountNumber: String(row[4] || ''),
        currency: String(row[5] || 'PHP'),
        openingBalance: opening,
        notes: String(row[7] || ''),
        active: String(row[8] || 'Yes') === 'Yes',
        currentBalance: opening + (balances[code] || 0),
        transactionCount: counts[code] || 0
      });
    }
    return { success: true, data: results };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleGetBankTransactions(params) {
  try {
    var accountCode = String((params && params.accountCode) || '');
    var month       = String((params && params.month) || ''); // YYYY-MM
    var limit       = parseInt((params && params.limit) || 0, 10);

    var sheet = _bankTransactionsSheet();
    var data = sheet.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      var code = String(row[2] || '');
      if (accountCode && code !== accountCode) continue;
      var dateRaw = row[1];
      var dateStr = (dateRaw instanceof Date) ? dateRaw.toISOString() : String(dateRaw || '');
      if (month && dateStr.indexOf(month) !== 0) continue;
      out.push({
        id: String(row[0] || ''),
        date: dateStr,
        accountCode: code,
        type: String(row[3] || ''),
        direction: parseFloat(row[4]) || 0,
        amount: parseFloat(row[5]) || 0,
        currency: String(row[6] || 'PHP'),
        description: String(row[7] || ''),
        refType: String(row[8] || ''),
        refId: String(row[9] || ''),
        pairedId: String(row[10] || ''),
        createdBy: String(row[11] || ''),
        createdAt: (row[12] instanceof Date) ? row[12].toISOString() : String(row[12] || '')
      });
    }
    // Newest first
    out.sort(function (a, b) { return (a.date < b.date) ? 1 : (a.date > b.date) ? -1 : 0; });
    if (limit > 0) out = out.slice(0, limit);
    return { success: true, data: out };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleSaveBankAccount(params) {
  try {
    var sheet = _bankAccountsSheet();
    var data = sheet.getDataRange().getValues();
    var code = String(params.code || '').trim();
    if (!code) return { success: false, message: 'Account code required.' };
    var found = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === code) { found = i + 1; break; }
    }
    var row = [
      code,
      String(params.name || ''),
      String(params.bank || ''),
      String(params.branch || ''),
      String(params.accountNumber || ''),
      String(params.currency || 'PHP'),
      parseFloat(params.openingBalance) || 0,
      String(params.notes || ''),
      (String(params.active) === 'false' || params.active === false) ? 'No' : 'Yes',
      (found > 0 ? (data[found - 1][9] || new Date().toISOString()) : new Date().toISOString())
    ];
    if (found > 0) {
      sheet.getRange(found, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleAddBankTransaction(params) {
  try {
    var type   = String(params.type || 'Adjustment');
    var amount = Math.abs(parseFloat(params.amount) || 0);
    if (amount <= 0) return { success: false, message: 'Amount must be > 0.' };
    var createdBy   = String(params.createdBy || '');
    var description = String(params.description || '');
    var date        = String(params.date || new Date().toISOString());
    var currency    = String(params.currency || 'PHP');

    // Transfer: produce two paired rows (debit from, credit to)
    if (type === 'Transfer') {
      var from = String(params.fromAccountCode || '');
      var to   = String(params.toAccountCode || '');
      if (!from || !to) return { success: false, message: 'Transfer requires from + to.' };
      if (from === to) return { success: false, message: 'Cannot transfer to the same account.' };
      var pairId = Utilities.getUuid();
      _appendBankTransaction({
        accountCode: from, type: 'Transfer Out', direction: -1, amount: amount, currency: currency,
        description: description || ('Transfer to ' + to), date: date, pairedId: pairId, createdBy: createdBy,
        refType: 'TransferTo', refId: to
      });
      _appendBankTransaction({
        accountCode: to, type: 'Transfer In', direction: 1, amount: amount, currency: currency,
        description: description || ('Transfer from ' + from), date: date, pairedId: pairId, createdBy: createdBy,
        refType: 'TransferFrom', refId: from
      });
      return { success: true };
    }

    // Single-leg transaction
    var accountCode = String(params.accountCode || '');
    if (!accountCode) return { success: false, message: 'Account code required.' };

    // Direction defaults: Deposit/Adjustment-In = credit; Withdrawal/Fee = debit.
    var direction;
    if (params.direction === 1 || params.direction === -1 || params.direction === '1' || params.direction === '-1') {
      direction = parseInt(params.direction, 10);
    } else if (/deposit|funding|credit|in/i.test(type)) {
      direction = 1;
    } else {
      direction = -1;
    }

    _appendBankTransaction({
      accountCode: accountCode, type: type, direction: direction, amount: amount,
      currency: currency, description: description, date: date, createdBy: createdBy,
      refType: String(params.refType || ''), refId: String(params.refId || '')
    });
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleDeleteBankTransaction(params) {
  try {
    var id = String(params.id || '').trim();
    if (!id) return { success: false, message: 'ID required.' };
    var sheet = _bankTransactionsSheet();
    var data = sheet.getDataRange().getValues();
    // Also delete paired leg of any Transfer
    var pairedId = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { pairedId = String(data[i][10] || ''); break; }
    }
    // Delete bottom-up to keep indices valid
    for (var j = data.length; j >= 2; j--) {
      var rid = String(data[j - 1][0]);
      var rpaired = String(data[j - 1][10] || '');
      if (rid === id || (pairedId && (rid === pairedId || rpaired === pairedId))) {
        sheet.deleteRow(j);
      }
    }
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// DIRECTOR PAYABLES — personal payables/payments outside the
// formal Payment Request system. When marked Paid, the chosen
// bank account is auto-debited via _appendBankTransaction.
// ═══════════════════════════════════════════════════════════════
function _directorPayablesSheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Director Payables', [
    'ID', 'Created At', 'Due Date', 'Payee', 'Category', 'Description',
    'Amount', 'Currency', 'Status', 'Paid At', 'Paid By', 'Bank Account', 'Bank Tx ID', 'Notes'
  ]);
}

function handleGetDirectorPayables(params) {
  try {
    var sheet = _directorPayablesSheet();
    var data = sheet.getDataRange().getValues();
    var status = String((params && params.status) || '');
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      var rec = {
        id: String(row[0] || ''),
        createdAt: (row[1] instanceof Date) ? row[1].toISOString() : String(row[1] || ''),
        dueDate:   (row[2] instanceof Date) ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(row[2] || ''),
        payee: String(row[3] || ''),
        category: String(row[4] || ''),
        description: String(row[5] || ''),
        amount: parseFloat(row[6]) || 0,
        currency: String(row[7] || 'PHP'),
        status: String(row[8] || 'Unpaid'),
        paidAt: (row[9] instanceof Date) ? row[9].toISOString() : String(row[9] || ''),
        paidBy: String(row[10] || ''),
        bankAccountCode: String(row[11] || ''),
        bankTxId: String(row[12] || ''),
        notes: String(row[13] || ''),
        rowIndex: i + 1
      };
      if (status && rec.status !== status) continue;
      out.push(rec);
    }
    out.sort(function (a, b) {
      var ad = a.dueDate || a.createdAt, bd = b.dueDate || b.createdAt;
      return (ad < bd) ? 1 : (ad > bd) ? -1 : 0;
    });
    return { success: true, data: out };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleSaveDirectorPayable(params) {
  try {
    var sheet = _directorPayablesSheet();
    var data = sheet.getDataRange().getValues();
    var id = String((params && params.id) || '').trim();
    var amount = parseFloat(params.amount) || 0;
    if (amount <= 0) return { success: false, message: 'Amount must be > 0.' };
    var payee = String(params.payee || '').trim();
    if (!payee) return { success: false, message: 'Payee is required.' };

    var foundRow = -1;
    if (id) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === id) { foundRow = i + 1; break; }
      }
    }

    if (foundRow > 0) {
      // Update — preserve status/paid fields
      var existing = data[foundRow - 1];
      sheet.getRange(foundRow, 3, 1, 6).setValues([[
        String(params.dueDate || ''),
        payee,
        String(params.category || ''),
        String(params.description || ''),
        amount,
        String(params.currency || existing[7] || 'PHP')
      ]]);
      if (params.notes !== undefined) sheet.getRange(foundRow, 14).setValue(String(params.notes || ''));
      return { success: true, id: id };
    }

    var newId = Utilities.getUuid();
    sheet.appendRow([
      newId,
      new Date().toISOString(),
      String(params.dueDate || ''),
      payee,
      String(params.category || ''),
      String(params.description || ''),
      amount,
      String(params.currency || 'PHP'),
      'Unpaid',
      '', '', '', '',
      String(params.notes || '')
    ]);
    return { success: true, id: newId };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleMarkDirectorPayablePaid(params) {
  try {
    var id = String((params && params.id) || '').trim();
    var bankAccountCode = String((params && params.bankAccountCode) || '').trim();
    if (!id) return { success: false, message: 'ID required.' };
    if (!bankAccountCode) return { success: false, message: 'Bank account required.' };
    var sheet = _directorPayablesSheet();
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { rowIdx = i + 1; break; }
    }
    if (rowIdx < 0) return { success: false, message: 'Payable not found.' };
    var row = data[rowIdx - 1];
    if (String(row[8] || '') === 'Paid') return { success: false, message: 'Already marked Paid.' };

    var amount = parseFloat(row[6]) || 0;
    var currency = String(row[7] || 'PHP');
    var payee = String(row[3] || '');
    var description = String(row[5] || '');
    var paidBy = String((params && params.paidBy) || '');
    var paidAt = new Date().toISOString();

    var bankTxId = _appendBankTransaction({
      accountCode: bankAccountCode,
      type: 'Payable Paid',
      direction: -1,
      amount: amount,
      currency: currency,
      description: 'Payable: ' + payee + (description ? ' — ' + description : ''),
      refType: 'DirectorPayable',
      refId: id,
      createdBy: paidBy,
      date: paidAt
    });

    sheet.getRange(rowIdx, 9, 1, 5).setValues([[
      'Paid', paidAt, paidBy, bankAccountCode, bankTxId
    ]]);
    return { success: true, bankTxId: bankTxId };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleUnmarkDirectorPayablePaid(params) {
  try {
    var id = String((params && params.id) || '').trim();
    if (!id) return { success: false, message: 'ID required.' };
    var sheet = _directorPayablesSheet();
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { rowIdx = i + 1; break; }
    }
    if (rowIdx < 0) return { success: false, message: 'Payable not found.' };
    var bankTxId = String(data[rowIdx - 1][12] || '');
    // Reverse the bank debit
    if (bankTxId) {
      try {
        var txSheet = _bankTransactionsSheet();
        var txData = txSheet.getDataRange().getValues();
        for (var j = txData.length; j >= 2; j--) {
          if (String(txData[j - 1][0]) === bankTxId) { txSheet.deleteRow(j); break; }
        }
      } catch (e) {}
    }
    sheet.getRange(rowIdx, 9, 1, 5).setValues([[ 'Unpaid', '', '', '', '' ]]);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

function handleDeleteDirectorPayable(params) {
  try {
    var id = String((params && params.id) || '').trim();
    if (!id) return { success: false, message: 'ID required.' };
    var sheet = _directorPayablesSheet();
    var data = sheet.getDataRange().getValues();
    for (var i = data.length; i >= 2; i--) {
      if (String(data[i - 1][0]) === id) {
        var bankTxId = String(data[i - 1][12] || '');
        if (bankTxId) {
          try {
            var txSheet = _bankTransactionsSheet();
            var txData = txSheet.getDataRange().getValues();
            for (var j = txData.length; j >= 2; j--) {
              if (String(txData[j - 1][0]) === bankTxId) { txSheet.deleteRow(j); break; }
            }
          } catch (e) {}
        }
        sheet.deleteRow(i);
        return { success: true };
      }
    }
    return { success: false, message: 'Payable not found.' };
  } catch (e) { return { success: false, message: e.message }; }
}
// Computes per-employee 13th month pay for a given calendar year.
// Formula (PH DOLE): total basic salary earned in the year ÷ 12.
// Inactive/resigned employees are still computed — their total basic pay
// already reflects only what they earned before going inactive, so dividing
// by 12 yields the correct prorated entitlement.
function handleGet13thMonthPay(params) {
  try {
    var year = parseInt((params && params.year) || new Date().getFullYear(), 10);
    if (!year || year < 2000) year = new Date().getFullYear();
    var yearPrefix = String(year) + '-';

    // Build employee master map keyed by "LAST, FIRST" (matches Payroll Register's Employee field)
    var empSheet = _payrollEmployeesSheet();
    var empData  = empSheet.getDataRange().getValues();
    var empMap   = {};
    var empOrder = [];
    for (var i = 1; i < empData.length; i++) {
      var er = empData[i];
      if (!er[0] && !er[1]) continue;
      var key = String(er[0]||'') + ', ' + String(er[1]||'');
      empMap[key] = {
        lastName: String(er[0]||''),
        firstName: String(er[1]||''),
        name: key,
        dailyRate: parseFloat(er[2])||0,
        status: String(er[5]||'Active'),
        totalBasicPay: 0,
        monthsWorked: {},  // dedupe by YYYY-MM
        periodsCount: 0
      };
      empOrder.push(key);
    }

    // Aggregate Basic Pay from Payroll Register for the target year
    var regSheet = _payrollRegisterSheet();
    var regData  = regSheet.getDataRange().getValues();
    for (var r = 1; r < regData.length; r++) {
      var row = regData[r];
      var period = String(row[0]||'');
      if (!period || period.indexOf(yearPrefix) !== 0) continue;
      var emp = String(row[1]||'');
      if (!emp) continue;
      var basic = parseFloat(row[2])||0;
      // Employee may exist in register without master record — include them anyway
      if (!empMap[emp]) {
        var parts = emp.split(',');
        empMap[emp] = {
          lastName: (parts[0]||'').trim(),
          firstName: (parts[1]||'').trim(),
          name: emp,
          dailyRate: 0,
          status: 'Unknown',
          totalBasicPay: 0,
          monthsWorked: {},
          periodsCount: 0
        };
        empOrder.push(emp);
      }
      empMap[emp].totalBasicPay += basic;
      empMap[emp].periodsCount  += 1;
      // Track unique months — period format is "YYYY-MM-A" or "YYYY-MM-B"
      var ym = period.substring(0, 7);
      empMap[emp].monthsWorked[ym] = true;
    }

    var results = [];
    for (var k = 0; k < empOrder.length; k++) {
      var e = empMap[empOrder[k]];
      var monthsCount = Object.keys(e.monthsWorked).length;
      results.push({
        lastName: e.lastName,
        firstName: e.firstName,
        name: e.name,
        status: e.status,
        dailyRate: e.dailyRate,
        totalBasicPay: Math.round(e.totalBasicPay * 100) / 100,
        monthsWorked: monthsCount,
        periodsCount: e.periodsCount,
        thirteenthMonth: Math.round((e.totalBasicPay / 12) * 100) / 100
      });
    }

    // Sort: active first, then by last name
    results.sort(function(a, b) {
      var sa = (a.status||'').toLowerCase() === 'active' ? 0 : 1;
      var sb = (b.status||'').toLowerCase() === 'active' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (a.lastName||'').localeCompare(b.lastName||'');
    });

    return { success: true, year: year, data: results };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── Payroll Approval workflow ──────────────────────────────────
function handleSubmitPayrollForApproval(params) {
  try {
    var period       = String(params.period || '').trim();
    var cutoffLabel  = String(params.cutoffLabel || '').trim();
    var submittedBy  = String(params.submittedBy || '').trim();
    var totalsJSON   = String(params.totalsJSON || '{}');
    var snapshotHtml = String(params.snapshotHtml || '');
    if (!period || !submittedBy) return { success: false, message: 'period and submittedBy required.' };
    var sheet = _payrollApprovalsSheet();
    // Replace any prior pending submission for the same period
    var data = sheet.getDataRange().getValues();
    for (var i = data.length; i >= 2; i--) {
      if (String(data[i-1][0]) === period && String(data[i-1][4]) === 'For Approval') {
        sheet.deleteRow(i);
      }
    }
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([period, cutoffLabel, submittedBy, now, 'For Approval', '', '', '', totalsJSON, snapshotHtml]);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleGetPayrollApprovals(params) {
  try {
    var status = String((params && params.status) || '').trim();
    var includeSnapshot = String((params && params.includeSnapshot) || '') === '1';
    var sheet = _payrollApprovalsSheet();
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (status && String(row[4]) !== status) continue;
      var totals = {};
      try { totals = JSON.parse(row[8] || '{}'); } catch(e) {}
      var rec = {
        rowIndex: i + 1,
        period: String(row[0] || ''),
        cutoffLabel: String(row[1] || ''),
        submittedBy: String(row[2] || ''),
        submittedAt: String(row[3] || ''),
        status: String(row[4] || ''),
        approvedBy: String(row[5] || ''),
        decidedAt: String(row[6] || ''),
        notes: String(row[7] || ''),
        totals: totals
      };
      if (includeSnapshot) rec.snapshotHtml = String(row[9] || '');
      out.push(rec);
    }
    return { success: true, data: out };
  } catch(e) { return { success: false, message: e.message }; }
}

function handleGetPayrollApprovalSnapshot(params) {
  try {
    var rowIndex = parseInt(params.rowIndex, 10);
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'rowIndex required.' };
    var sheet = _payrollApprovalsSheet();
    var row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
    return {
      success: true,
      data: {
        rowIndex: rowIndex,
        period: String(row[0] || ''),
        cutoffLabel: String(row[1] || ''),
        submittedBy: String(row[2] || ''),
        submittedAt: String(row[3] || ''),
        status: String(row[4] || ''),
        snapshotHtml: String(row[9] || '')
      }
    };
  } catch(e) { return { success: false, message: e.message }; }
}

var PAYROLL_APPROVED_DRIVE_FOLDER_ID = '';

function _monthNameFromPeriod(period) {
  // period e.g. "2026-05" or "05/2026"
  var m = String(period).match(/(\d{4})-(\d{2})/);
  var monthIdx, year;
  if (m) { year = m[1]; monthIdx = parseInt(m[2], 10) - 1; }
  else {
    var m2 = String(period).match(/(\d{1,2})\D+(\d{4})/);
    if (!m2) return { name: String(period), year: '' };
    monthIdx = parseInt(m2[1], 10) - 1; year = m2[2];
  }
  var names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return { name: names[monthIdx] || '', year: year };
}

function _getOrCreateMonthSubfolder(parent, monthName, year) {
  var name = monthName + ' ' + year;
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function _uploadPayrollPdfToDrive(period, cutoffLabel, snapshotHtml, pdfBase64) {
  try {
    var mp = _monthNameFromPeriod(period);
    if (!mp.name) return { success: false, message: 'cannot parse period' };
    var cutoff = /B|2nd/i.test(cutoffLabel) ? '2nd Cutoff' : '1st Cutoff';
    var parent = DriveApp.getFolderById(PAYROLL_APPROVED_DRIVE_FOLDER_ID);
    var subfolder = _getOrCreateMonthSubfolder(parent, mp.name, mp.year);
    var fileName = 'HI-ESCORP Payroll \u2014 ' + mp.name + ' ' + mp.year + ' ' + cutoff;

    // Preferred path: client supplied a fully rendered PDF — upload as-is so the
    // file in Drive matches what the portal renders (no Google Doc conversion).
    if (pdfBase64) {
      try {
        var bytes = Utilities.base64Decode(pdfBase64);
        var pdfBlob = Utilities.newBlob(bytes, 'application/pdf', fileName + '.pdf');
        var pdfFile = subfolder.createFile(pdfBlob);
        try { pdfFile.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
        return { success: true, fileId: pdfFile.getId(), url: pdfFile.getUrl(), folderName: subfolder.getName(), fileName: fileName, source: 'client-pdf' };
      } catch (e) {
        Logger.log('uploadPayrollPdf client-pdf failed, falling back: ' + e.message);
        // fall through to HTML conversion fallback
      }
    }

    if (!snapshotHtml) return { success: false, message: 'no snapshot' };
    var htmlBlob = Utilities.newBlob(snapshotHtml, 'text/html', fileName + '.html');
    // Fallback: convert HTML → Google Doc → PDF using Drive Advanced Service v3.
    var tempDoc = Drive.Files.create(
      { name: fileName + ' (tmp)', mimeType: 'application/vnd.google-apps.document' },
      htmlBlob
    );
    var pdfBlob2 = DriveApp.getFileById(tempDoc.id).getAs('application/pdf').setName(fileName + '.pdf');
    var pdfFile2 = subfolder.createFile(pdfBlob2);
    DriveApp.getFileById(tempDoc.id).setTrashed(true);
    try { pdfFile2.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
    return { success: true, fileId: pdfFile2.getId(), url: pdfFile2.getUrl(), folderName: subfolder.getName(), fileName: fileName, source: 'html-converted' };
  } catch (e) {
    Logger.log('uploadPayrollPdf: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ─── Leave Request PDF upload ───────────────────────────────
var LEAVE_REQUESTS_DRIVE_FOLDER_ID = '';

function _sanitizeFolderName(name) {
  return String(name || 'Unknown').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'Unknown';
}

function _getOrCreateUserSubfolder(parent, userName) {
  var safe = _sanitizeFolderName(userName);
  var it = parent.getFoldersByName(safe);
  if (it.hasNext()) return it.next();
  return parent.createFolder(safe);
}

function _buildLeaveRequestHtml(p) {
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var submitted = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a');
  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;}' +
    'h1{margin:0 0 4px 0;font-size:22px;}' +
    '.sub{color:#555;font-size:12px;margin-bottom:18px;}' +
    'table{border-collapse:collapse;width:100%;font-size:13px;}' +
    'th,td{border:1px solid #999;padding:8px 10px;text-align:left;vertical-align:top;}' +
    'th{background:#f1f5f9;width:30%;}' +
    '.reason{white-space:pre-wrap;}' +
    '.foot{margin-top:24px;font-size:11px;color:#666;}' +
    '</style></head><body>' +
    '<h1>HiEscorp — Leave Request</h1>' +
    '<div class="sub">Submitted: ' + esc(submitted) + '</div>' +
    '<table>' +
    '<tr><th>Employee</th><td>' + esc(p.employee) + '</td></tr>' +
    '<tr><th>Leave Type</th><td>' + esc(p.type) + '</td></tr>' +
    '<tr><th>Start Date</th><td>' + esc(p.startDate) + '</td></tr>' +
    '<tr><th>End Date</th><td>' + esc(p.endDate) + '</td></tr>' +
    '<tr><th>Number of Days</th><td>' + esc(p.days || 1) + '</td></tr>' +
    '<tr><th>Reason</th><td class="reason">' + esc(p.reason || '—') + '</td></tr>' +
    '<tr><th>Status</th><td>Pending Approval</td></tr>' +
    '</table>' +
    '<div class="foot">This document is auto-generated by the HiEscorp CRM upon leave-request submission.</div>' +
    '</body></html>';
}

function _uploadLeaveRequestPdfToDrive(params) {
  try {
    var employee = String(params.employee || '').trim();
    if (!employee) return { success: false, message: 'employee required' };
    var parent = DriveApp.getFolderById(LEAVE_REQUESTS_DRIVE_FOLDER_ID);
    var subfolder = _getOrCreateUserSubfolder(parent, employee);
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
    var typeSlug = _sanitizeFolderName(params.type || 'Leave');
    var fileName = 'LeaveRequest-' + _sanitizeFolderName(employee) + '-' + stamp + '-' + typeSlug;
    var html = _buildLeaveRequestHtml(params);
    var htmlBlob = Utilities.newBlob(html, 'text/html', fileName + '.html');
    var tempDoc = Drive.Files.create(
      { name: fileName + ' (tmp)', mimeType: 'application/vnd.google-apps.document' },
      htmlBlob
    );
    var pdfBlob = DriveApp.getFileById(tempDoc.id).getAs('application/pdf').setName(fileName + '.pdf');
    var pdfFile = subfolder.createFile(pdfBlob);
    DriveApp.getFileById(tempDoc.id).setTrashed(true);
    try { pdfFile.setAccess(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return { success: true, fileId: pdfFile.getId(), url: pdfFile.getUrl(), folderName: subfolder.getName(), fileName: fileName };
  } catch (e) {
    Logger.log('uploadLeaveRequestPdf: ' + e.message);
    return { success: false, message: e.message };
  }
}

function handleDecidePayrollApproval(params) {
  try {
    var rowIndex   = parseInt(params.rowIndex, 10);
    var decision   = String(params.decision || '').trim();   // 'Approved' or 'Rejected'
    var approvedBy = String(params.approvedBy || '').trim();
    var notes      = String(params.notes || '').trim();
    if (!rowIndex || rowIndex < 2) return { success: false, message: 'rowIndex required.' };
    if (decision !== 'Approved' && decision !== 'Rejected') return { success: false, message: 'invalid decision.' };
    if (!approvedBy) return { success: false, message: 'approvedBy required.' };
    var sheet = _payrollApprovalsSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(rowIndex, 5).setValue(decision);
    sheet.getRange(rowIndex, 6).setValue(approvedBy);
    sheet.getRange(rowIndex, 7).setValue(now);
    if (notes) sheet.getRange(rowIndex, 8).setValue(notes);

    var uploadInfo = null;
    if (decision === 'Approved') {
      var row = sheet.getRange(rowIndex, 1, 1, 10).getValues()[0];
      var period = String(row[0] || '');
      var cutoffLabel = String(row[1] || '');
      var snapshotHtml = String(row[9] || '');
      var pdfBase64 = String(params.pdfBase64 || '');
      uploadInfo = _uploadPayrollPdfToDrive(period, cutoffLabel, snapshotHtml, pdfBase64);
      if (uploadInfo && uploadInfo.success) {
        var existingNotes = String(sheet.getRange(rowIndex, 8).getValue() || '');
        var driveNote = 'PDF: ' + uploadInfo.url;
        sheet.getRange(rowIndex, 8).setValue(existingNotes ? (existingNotes + ' | ' + driveNote) : driveNote);
      }
    }
    return { success: true, upload: uploadInfo };
  } catch(e) { return { success: false, message: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 1 ADDITIONS — Leaves / Memos / Financial drill / Autofill
// ═══════════════════════════════════════════════════════════════

function _lookupUserRole(name) {
  if (!name) return '';
  try {
    var usersSheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheets()[0];
    var data = usersSheet.getDataRange().getValues();
    var key = String(name).trim().toLowerCase();
    for (var i = 1; i < data.length; i++) {
      var uname = String(data[i][0] || '').trim().toLowerCase();
      var fullName = String(data[i][3] || '').trim().toLowerCase();
      if (uname === key || fullName === key) {
        return String(data[i][2] || '').trim().toLowerCase();
      }
    }
  } catch (e) { Logger.log('lookupUserRole: ' + e.message); }
  return '';
}

function _todayManilaISO() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _rowDateMatches(val, dateISO) {
  if (!val) return false;
  try {
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d.getTime())) {
      // Try parse "MM/dd/yyyy" or "yyyy-MM-dd"
      var s = String(val);
      if (s.indexOf(dateISO) === 0) return true;
      return false;
    }
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') === dateISO;
  } catch (e) { return false; }
}

// ─── getMyLeaves ─────────────────────────────────────────────
function handleGetMyLeaves(params) {
  try {
    var emp = String(params.employee || params.employeeName || '').trim();
    if (!emp) return { success: true, data: [] };
    var sheet = _leaveRequestsSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim().toLowerCase() !== emp.toLowerCase()) continue;
      results.push({
        rowIndex: i + 1,
        employee: String(data[i][0] || ''),
        type: String(data[i][1] || ''),
        startDate: String(data[i][2] || ''),
        endDate: String(data[i][3] || ''),
        days: Number(data[i][4]) || 0,
        reason: String(data[i][5] || ''),
        status: String(data[i][6] || ''),
        approvedBy: String(data[i][7] || ''),
        notes: String(data[i][8] || ''),
        createdAt: String(data[i][9] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── getActiveMemosForUser ───────────────────────────────────
function handleGetActiveMemosForUser(params) {
  try {
    var role = String(params.role || '').toLowerCase();
    var sheet = _memosSheet();
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][6] || '').toLowerCase();
      if (status !== 'active') continue;
      var target = String(data[i][5] || 'All').toLowerCase();
      var matches = (target === 'all' || target === '' || target === role ||
        target.indexOf(role) !== -1);
      if (!matches) continue;
      results.push({
        rowIndex: i + 1,
        title: String(data[i][0] || ''),
        content: String(data[i][1] || ''),
        type: String(data[i][2] || ''),
        priority: String(data[i][3] || ''),
        createdBy: String(data[i][4] || ''),
        target: String(data[i][5] || ''),
        status: String(data[i][6] || ''),
        createdAt: String(data[i][7] || '')
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── getFinancialBreakdown ───────────────────────────────────
function handleGetFinancialBreakdown(params) {
  try {
    var metric = String(params.metric || '').toLowerCase();
    var range  = String(params.range  || 'month');

    // Build date window (mirror handleGetAccountingDashboard)
    var now = new Date();
    var startDate = new Date(); startDate.setHours(0,0,0,0);
    var endStr = null;
    if (range === 'month')   { startDate.setDate(1); }
    else if (range === 'quarter') { startDate.setMonth(startDate.getMonth()-2); startDate.setDate(1); }
    else if (range === 'year') { startDate.setMonth(0); startDate.setDate(1); }
    else if (/^\d{4}-\d{2}$/.test(range)) {
      var p = range.split('-');
      startDate = new Date(parseInt(p[0]), parseInt(p[1])-1, 1);
      endStr = formatDate(new Date(parseInt(p[0]), parseInt(p[1]), 0));
    } else { startDate = new Date(2000,0,1); }
    var startStr = formatDate(startDate);
    function inRange(ds) { return ds >= startStr && (!endStr || ds <= endStr); }

    if (metric === 'revenue' || metric === 'cogs' || metric === 'grossprofit' ||
        metric === 'expenses' || metric === 'netprofit') {
      var oSheet = _ordersSheet();
      var oData = oSheet.getDataRange().getValues();
      var orders = [];
      for (var i = 1; i < oData.length; i++) {
        if (!oData[i][0]) continue;
        orders.push(_parseOrderRow(oData[i], i+1));
      }
      var filteredOrders = orders.filter(function(o){ return inRange(o.date); });

      var revRows = filteredOrders.map(function(o){
        return { date: o.date, ref: o.orderNumber || '', client: o.client || '', amount: o.sellingPrice || 0 };
      }).filter(function(r){ return r.amount > 0; });
      var revTotal = revRows.reduce(function(s,r){ return s + r.amount; }, 0);

      var cogsRows = filteredOrders.map(function(o){
        return { date: o.date, ref: o.orderNumber || '', supplier: o.supplier || '', amount: o.purchaseCostPHP || 0 };
      }).filter(function(r){ return r.amount > 0; });
      var cogsTotal = cogsRows.reduce(function(s,r){ return s + r.amount; }, 0);

      if (metric === 'revenue') return { success: true, metric: 'revenue', rows: revRows, total: revTotal };
      if (metric === 'cogs') return { success: true, metric: 'cogs', rows: cogsRows, total: cogsTotal };
      if (metric === 'grossprofit') {
        return { success: true, metric: 'grossProfit',
          revenue: { rows: revRows, total: revTotal },
          cogs: { rows: cogsRows, total: cogsTotal },
          total: revTotal - cogsTotal };
      }

      // Expenses (includes COGS-adjacent: shipping/duties/delivery from orders + Expenses sheet)
      var eSheet = _expensesSheet();
      var eData = eSheet.getDataRange().getValues();
      var expRows = [];
      var expTotal = 0;
      for (var j = 1; j < eData.length; j++) {
        if (!eData[j][0]) continue;
        var ed = formatDate(parseSheetDate(eData[j][0]) || new Date());
        if (!inRange(ed)) continue;
        var amt = parseFloat(eData[j][10]) || 0;
        expRows.push({ date: ed, category: String(eData[j][1] || ''), client: String(eData[j][3] || ''),
          description: String(eData[j][4] || ''), amount: amt });
        expTotal += amt;
      }
      filteredOrders.forEach(function(o){
        if (o.shippingCost > 0) { expRows.push({ date: o.date, category: 'Shipping', client: o.client, description: o.orderNumber, amount: o.shippingCost }); expTotal += o.shippingCost; }
        if (o.dutiesTaxes > 0) { expRows.push({ date: o.date, category: 'Duties & Taxes', client: o.client, description: o.orderNumber, amount: o.dutiesTaxes }); expTotal += o.dutiesTaxes; }
        if (o.deliveryCost > 0) { expRows.push({ date: o.date, category: 'Delivery', client: o.client, description: o.orderNumber, amount: o.deliveryCost }); expTotal += o.deliveryCost; }
      });
      var totalCOGSplusExp = cogsTotal + expTotal;
      if (metric === 'expenses') return { success: true, metric: 'expenses', rows: expRows, cogs: { rows: cogsRows, total: cogsTotal }, total: totalCOGSplusExp };

      // netProfit
      return { success: true, metric: 'netProfit',
        revenue: { rows: revRows, total: revTotal },
        cogs: { rows: cogsRows, total: cogsTotal },
        expenses: { rows: expRows, total: expTotal },
        total: revTotal - cogsTotal - expTotal };
    }

    if (metric === 'ar' || metric === 'receivables') {
      var oSheet2 = _ordersSheet();
      var oData2 = oSheet2.getDataRange().getValues();
      var arRows = [];
      var arTotal = 0;
      for (var k = 1; k < oData2.length; k++) {
        if (!oData2[k][0]) continue;
        var o2 = _parseOrderRow(oData2[k], k+1);
        var bal = (o2.sellingPrice || 0) - (o2.amountReceived || 0);
        if (bal > 0 && o2.clientPayStatus !== 'Paid') {
          arRows.push({ date: o2.date, orderNo: o2.orderNumber, client: o2.client,
            sellingPrice: o2.sellingPrice, amountReceived: o2.amountReceived, balance: bal,
            dueDate: o2.dueDate || '', status: o2.clientPayStatus || '' });
          arTotal += bal;
        }
      }
      return { success: true, metric: 'ar', rows: arRows, total: arTotal };
    }

    if (metric === 'payables') {
      var oSheet3 = _ordersSheet();
      var oData3 = oSheet3.getDataRange().getValues();
      var payRows = [];
      var payTotal = 0;
      for (var m = 1; m < oData3.length; m++) {
        if (!oData3[m][0]) continue;
        var o3 = _parseOrderRow(oData3[m], m+1);
        if (o3.supplierPayStatus !== 'Paid' && o3.purchaseCostPHP > 0) {
          payRows.push({ date: o3.date, orderNo: o3.orderNumber, supplier: o3.supplier || '',
            amount: o3.purchaseCostPHP, status: o3.supplierPayStatus || '' });
          payTotal += o3.purchaseCostPHP;
        }
      }
      return { success: true, metric: 'payables', rows: payRows, total: payTotal };
    }

    return { success: false, message: 'Unknown metric: ' + metric };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── getAdminDailyAutofill ───────────────────────────────────
function handleGetAdminDailyAutofill(params) {
  try {
    var userName = String(params.userName || '').trim();
    var dateISO  = String(params.date || _todayManilaISO());
    var userLC   = userName.toLowerCase();
    var out = { date: dateISO, purchaseOrders: [], salesOrders: [], paymentRequests: [],
      supplierQuotations: [], shipments: [], pricingSubmissions: [], quotationApprovals: [] };

    // PO Records (col 0:poNo, 1:date, 2:vendor, 4:amount, 11:createdBy)
    try {
      var po = _poRecordsSheet().getDataRange().getValues();
      for (var i = 1; i < po.length; i++) {
        if (!po[i][0]) continue;
        if (!_rowDateMatches(po[i][1], dateISO)) continue;
        if (userLC && String(po[i][11]||'').trim().toLowerCase() !== userLC) continue;
        out.purchaseOrders.push({ poNo: String(po[i][0]||''), vendor: String(po[i][2]||''),
          amount: parseFloat(po[i][4])||0, status: String(po[i][15]||po[i][8]||'') });
      }
    } catch(e) {}

    // Sales Orders (no createdBy → include all of today)
    try {
      var so = _salesOrdersSheet().getDataRange().getValues();
      var seenSO = {};
      for (var j = 1; j < so.length; j++) {
        var soNo = String(so[j][0]||'');
        if (!soNo || seenSO[soNo]) continue;
        if (!_rowDateMatches(so[j][1], dateISO)) continue;
        seenSO[soNo] = true;
        out.salesOrders.push({ soNo: soNo, customer: String(so[j][3]||''),
          amount: parseFloat(so[j][12]||so[j][9])||0, status: String(so[j][13]||'') });
      }
    } catch(e) {}

    // PaymentRequests (col 0:reqDate, 1:PR#, 2:requestedBy, 6:payee, 14:amount, 20:status)
    try {
      var pr = _paymentRequestsSheet().getDataRange().getValues();
      for (var k = 1; k < pr.length; k++) {
        if (!pr[k][1]) continue;
        if (!_rowDateMatches(pr[k][0], dateISO)) continue;
        if (userLC && String(pr[k][2]||'').trim().toLowerCase() !== userLC) continue;
        out.paymentRequests.push({ prNo: String(pr[k][1]||''), payee: String(pr[k][6]||''),
          amount: parseFloat(pr[k][14])||0, status: String(pr[k][20]||'Pending') });
      }
    } catch(e) {}

    // Supplier Quotations (col 0:date, 1:supplier, 9:totalAmount, 12:submittedBy)
    try {
      var sq = _supplierQuotationsSheet().getDataRange().getValues();
      for (var n = 1; n < sq.length; n++) {
        if (!sq[n][0]) continue;
        if (!_rowDateMatches(sq[n][0], dateISO)) continue;
        if (userLC && String(sq[n][12]||'').trim().toLowerCase() !== userLC) continue;
        out.supplierQuotations.push({ supplier: String(sq[n][1]||''),
          item: String(sq[n][6]||''), amount: parseFloat(sq[n][9])||0,
          prNumber: String(sq[n][13]||'') });
      }
    } catch(e) {}

    // Shipments — pull per-user activity from Daily Activity log first;
    // fall back to today's shipment rows when log is empty (e.g. legacy data).
    try {
      var actSheet = _dailyActivitySheet();
      var act = actSheet.getDataRange().getValues();
      var seenShipAct = false;
      for (var a = 1; a < act.length; a++) {
        if (String(act[a][1] || '') !== dateISO) continue;
        if (String(act[a][4] || '').toLowerCase() !== 'shipment') continue;
        if (userLC && String(act[a][2] || '').trim().toLowerCase() !== userLC) continue;
        seenShipAct = true;
        out.shipments.push({
          shipmentId: String(act[a][5] || ''),
          action:     String(act[a][3] || ''),
          summary:    String(act[a][6] || ''),
          amount:     parseFloat(act[a][7]) || 0,
          timestamp:  String(act[a][0] || '')
        });
      }

      // Fallback: include today's shipment rows when no activity-log entries
      // exist for this user (covers shipments created before logging existed
      // and any rows touched outside the UI flow).
      if (!seenShipAct) {
        var sh = _shipmentSheet().getDataRange().getValues();
        for (var s = 1; s < sh.length; s++) {
          if (!sh[s][0]) continue;
          var hitSh = _rowDateMatches(sh[s][29], dateISO) || _rowDateMatches(sh[s][8], dateISO) || _rowDateMatches(sh[s][18], dateISO);
          if (!hitSh) continue;
          out.shipments.push({
            shipmentId: String(sh[s][0]||''), poNo: String(sh[s][1]||''),
            client: String(sh[s][2]||''), item: String(sh[s][6]||''),
            mode: String(sh[s][7]||''), eta: _fmtDate(sh[s][10]),
            status: String(sh[s][27]||'')
          });
        }
      }
    } catch(e) {}

    // Pricing Submissions (col 1:Date, 2:Submitted By, 3:Principal, 4:Destination, 6:Status)
    // Show ALL pricing submissions for the day in admin daily report, not just the
    // logged-in user's — pricing is a team-visible activity.
    try {
      var ps = _pricingSubmissionsSheet().getDataRange().getValues();
      for (var p = 1; p < ps.length; p++) {
        if (!ps[p][0]) continue;
        var hitPs = _rowDateMatches(ps[p][1], dateISO) || _rowDateMatches(ps[p][9], dateISO);
        if (!hitPs) continue;
        out.pricingSubmissions.push({ id: String(ps[p][0]||''),
          submittedBy: String(ps[p][2]||''),
          principal: String(ps[p][3]||''), destination: String(ps[p][4]||''),
          status: String(ps[p][6]||'') });
      }
    } catch(e) {}

    return { success: true, data: out };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── getAccountingDailyAutofill ──────────────────────────────
function _ensureCreatedByCol(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol >= 1) {
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim().toLowerCase() === 'created by') return i + 1;
    }
  }
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue('Created By').setFontWeight('bold');
  return newCol;
}
function _writeCreatedBy(sheet, createdBy) {
  if (!createdBy) return;
  try {
    var col = _ensureCreatedByCol(sheet);
    var row = sheet.getLastRow();
    if (row >= 2) sheet.getRange(row, col).setValue(String(createdBy));
  } catch (e) {}
}
function _getCreatedByColIdx(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim().toLowerCase() === 'created by') return i;
  }
  return -1;
}
function _userMatches(rowVal, userLC) {
  if (!userLC) return true;
  return String(rowVal || '').trim().toLowerCase() === userLC;
}

// ─── DAILY ACTIVITY LOG ─────────────────────────────────────
// Per-user log of accounting actions (create/update/delete). Drives the
// per-user Accounting Daily Report so each user sees only what they did.
// Schema: Timestamp | Date | User | Action | EntityType | EntityId | Summary | Amount
function _dailyActivitySheet() {
  var ss = SpreadsheetApp.openById(USERS_SHEET_ID);
  return _getOrCreateSheet(ss, 'Daily Activity', [
    'Timestamp', 'Date', 'User', 'Action', 'Entity Type', 'Entity Id', 'Summary', 'Amount'
  ]);
}

// Log an activity. Silently swallows errors so logging never breaks the
// underlying handler. `user` may be empty (anonymous) — still logged.
function _logActivity(user, action, entityType, entityId, summary, amount) {
  try {
    var sheet = _dailyActivitySheet();
    var now = new Date();
    sheet.appendRow([
      now.toISOString(),
      _todayManilaISO(),
      String(user || '').trim(),
      String(action || ''),
      String(entityType || ''),
      String(entityId || ''),
      String(summary || ''),
      Number(amount || 0)
    ]);
  } catch (err) {
    try { Logger.log('_logActivity failed: ' + err.message); } catch (_) {}
  }
}

// Resolve the acting user's name from request params, falling back to other
// known user fields used by various handlers.
function _resolveActor(params) {
  if (!params) return '';
  return String(
    params.actorName || params.createdBy || params.paidBy || params.userName ||
    params.creatorName || params.user || ''
  ).trim();
}

function handleGetAccountingDailyAutofill(params) {
  try {
    var userName = String(params.userName || params.actorName || '').trim();
    var dateISO  = String(params.date || _todayManilaISO());
    var userLC   = userName.toLowerCase();
    var out = {
      date: dateISO,
      orders: [], expenses: [], collections: [], paymentRequests: [], salesOrders: [],
      profitReports: [], inventory: [], mro: [], mi: [], arAging: []
    };

    // Primary source: Daily Activity log (per-user, per-date). Each entity type
    // gets its own bucket so the frontend can render sections.
    try {
      var actSheet = _dailyActivitySheet();
      var act = actSheet.getDataRange().getValues();
      for (var a = 1; a < act.length; a++) {
        var rDate  = String(act[a][1] || '');
        var rUser  = String(act[a][2] || '').trim().toLowerCase();
        var rAct   = String(act[a][3] || '');
        var rType  = String(act[a][4] || '');
        var rId    = String(act[a][5] || '');
        var rSum   = String(act[a][6] || '');
        var rAmt   = parseFloat(act[a][7]) || 0;
        if (rDate !== dateISO) continue;
        if (userLC && rUser !== userLC) continue;
        var entry = { action: rAct, id: rId, summary: rSum, amount: rAmt };
        switch (rType) {
          case 'order':          out.orders.push(entry); break;
          case 'expense':        out.expenses.push(entry); break;
          case 'collection':     out.collections.push(entry); break;
          case 'sales_order':    out.salesOrders.push(entry); break;
          case 'profit_report':  out.profitReports.push(entry); break;
          case 'inventory':      out.inventory.push(entry); break;
          case 'mro':            out.mro.push(entry); break;
          case 'mi':             out.mi.push(entry); break;
          case 'ar_aging':       out.arAging.push(entry); break;
          case 'payment_request':out.paymentRequests.push(entry); break;
        }
      }
    } catch(e) {}

    // Payment Requests are not (yet) emitted to the activity log; fall back to
    // direct sheet filtering by requestedBy / paidBy so accounting still sees
    // PR work they did today.
    if (out.paymentRequests.length === 0) {
      try {
        var pr = _paymentRequestsSheet().getDataRange().getValues();
        for (var m = 1; m < pr.length; m++) {
          if (!pr[m][1]) continue;
          var paidAt = pr[m][25];
          var submitted = pr[m][18];
          var submittedToday = _rowDateMatches(submitted, dateISO);
          var paidToday = _rowDateMatches(paidAt, dateISO);
          if (!submittedToday && !paidToday) continue;
          if (userLC) {
            var requestedBy = String(pr[m][2] || '').trim().toLowerCase();
            var paidBy      = String(pr[m][26] || '').trim().toLowerCase();
            var mine = (submittedToday && requestedBy === userLC) ||
                       (paidToday && paidBy === userLC);
            if (!mine) continue;
          }
          out.paymentRequests.push({
            action: paidToday ? 'marked_paid' : 'submitted',
            id: String(pr[m][1]||''),
            summary: 'PR ' + String(pr[m][1]||'') + ' — ' + String(pr[m][6]||''),
            amount: parseFloat(pr[m][14])||0
          });
        }
      } catch(e) {}
    }

    return { success: true, data: out };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── getHrDailyAutofill ──────────────────────────────────────
function handleGetHrDailyAutofill(params) {
  try {
    var userName = String(params.userName || '').trim();
    var dateISO  = String(params.date || _todayManilaISO());
    var userLC   = userName.toLowerCase();
    var out = { date: dateISO, recruitment: [], hrTasks: [], onboarding: [],
      memos: [], campaigns: [], content: [] };

    // Recruitment Pipeline (col 3:dateApplied, 4:assignedHR, 7:updatedAt)
    try {
      var rec = _recruitmentSheet().getDataRange().getValues();
      for (var i = 1; i < rec.length; i++) {
        if (!rec[i][0]) continue;
        var hit = _rowDateMatches(rec[i][3], dateISO) || _rowDateMatches(rec[i][7], dateISO) || _rowDateMatches(rec[i][6], dateISO);
        if (!hit) continue;
        if (userLC && String(rec[i][4]||'').trim().toLowerCase() !== userLC) continue;
        out.recruitment.push({ name: String(rec[i][0]||''), position: String(rec[i][1]||''),
          stage: String(rec[i][2]||''), notes: String(rec[i][5]||'') });
      }
    } catch(e) {}

    // HR Tasks (col 2:assignedTo, 4:dueDate, 6:completedDate, 7:createdAt, 8:createdBy)
    try {
      var tk = _hrTasksSheet().getDataRange().getValues();
      for (var j = 1; j < tk.length; j++) {
        if (!tk[j][0]) continue;
        var hit2 = _rowDateMatches(tk[j][4], dateISO) || _rowDateMatches(tk[j][6], dateISO) || _rowDateMatches(tk[j][7], dateISO);
        if (!hit2) continue;
        if (userLC && String(tk[j][2]||'').trim().toLowerCase() !== userLC &&
            String(tk[j][8]||'').trim().toLowerCase() !== userLC) continue;
        out.hrTasks.push({ title: String(tk[j][0]||''), type: String(tk[j][1]||''),
          status: String(tk[j][3]||''), notes: String(tk[j][5]||'') });
      }
    } catch(e) {}

    // Employees onboarding (col 8:updatedAt)
    try {
      var em = _employeesSheet().getDataRange().getValues();
      for (var k = 1; k < em.length; k++) {
        if (!em[k][0]) continue;
        if (!_rowDateMatches(em[k][8], dateISO) && !_rowDateMatches(em[k][3], dateISO)) continue;
        out.onboarding.push({ name: String(em[k][0]||''), position: String(em[k][1]||''),
          status: String(em[k][4]||''), notes: String(em[k][6]||'') });
      }
    } catch(e) {}

    // Memos (col 4:createdBy, 7:createdAt)
    try {
      var mm = _memosSheet().getDataRange().getValues();
      for (var m = 1; m < mm.length; m++) {
        if (!mm[m][0]) continue;
        if (!_rowDateMatches(mm[m][7], dateISO)) continue;
        if (userLC && String(mm[m][4]||'').trim().toLowerCase() !== userLC) continue;
        out.memos.push({ title: String(mm[m][0]||''), type: String(mm[m][2]||''),
          target: String(mm[m][5]||''), priority: String(mm[m][3]||'') });
      }
    } catch(e) {}

    // Marketing Campaigns (col 9:createdBy, 10:createdAt, 11:updatedAt)
    try {
      var cp = _campaignsSheet().getDataRange().getValues();
      for (var n = 1; n < cp.length; n++) {
        if (!cp[n][0]) continue;
        var hit3 = _rowDateMatches(cp[n][10], dateISO) || _rowDateMatches(cp[n][11], dateISO) || _rowDateMatches(cp[n][2], dateISO);
        if (!hit3) continue;
        if (userLC && String(cp[n][9]||'').trim().toLowerCase() !== userLC) continue;
        out.campaigns.push({ name: String(cp[n][0]||''), channel: String(cp[n][1]||''),
          status: String(cp[n][7]||''), notes: String(cp[n][8]||'') });
      }
    } catch(e) {}

    // Content Calendar (col 7:createdBy, 8:createdAt, 3:scheduledDate)
    try {
      var cc = _contentCalendarSheet().getDataRange().getValues();
      for (var p = 1; p < cc.length; p++) {
        if (!cc[p][0]) continue;
        var hit4 = _rowDateMatches(cc[p][8], dateISO) || _rowDateMatches(cc[p][3], dateISO);
        if (!hit4) continue;
        if (userLC && String(cc[p][7]||'').trim().toLowerCase() !== userLC) continue;
        out.content.push({ title: String(cc[p][0]||''), platform: String(cc[p][2]||''),
          status: String(cc[p][4]||''), notes: String(cc[p][6]||'') });
      }
    } catch(e) {}

    return { success: true, data: out };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
