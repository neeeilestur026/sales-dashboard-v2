/* ═══════════════════════════════════════════════
   auth.js — Login, logout, session management
   ═══════════════════════════════════════════════ */

const SESSION_KEY = 'session';

/**
 * Get current session from localStorage
 * @returns {Object|null} Parsed session object or null
 */
function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.name || !session.role) return null;

    // Check session expiry (8 hours)
    if (session.loginTime) {
      const elapsed = Date.now() - session.loginTime;
      const EIGHT_HOURS = 8 * 60 * 60 * 1000;
      if (elapsed > EIGHT_HOURS) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Save session data to localStorage
 * @param {Object} data - Agent/manager session data from login
 */
function saveSession(data) {
  data.loginTime = Date.now();
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

/**
 * Require authentication — redirect to login if no session
 * Call on every protected page load.
 */
function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

function _homeForRole(role) {
  if (role === 'admin') return 'admin.html';
  if (role === 'accounting') return 'accounting-home.html';
  if (role === 'management') return 'management-home.html';
  if (role === 'director') return 'director-home.html';
  if (role === 'hr') return 'hr-home.html';
  if (role === 'marketing') return 'marketing-home.html';
  return 'dashboard.html';
}

/**
 * Require admin role — redirect others to their home page
 */
function requireAdmin() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'admin') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require sales role — redirect others to their home page
 */
function requireSales() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'sales') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require accounting role — redirect others to their home page
 */
function requireAccounting() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'accounting') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require accounting or admin role — shared pages
 */
function requireAccountingOrAdmin() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'admin' && session.role !== 'accounting') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require quotation access — sales (own only) plus all oversight roles
 * (admin, accounting, management, director) who see/edit every rep's quotations.
 */
function requireQuotationAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['admin', 'accounting', 'management', 'director', 'sales'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require access to the Pricing/Purchase Request flow — sales (own only) plus all
 * oversight roles (admin, accounting, management, director).
 */
function requirePricingFlowAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['admin', 'accounting', 'management', 'director', 'sales'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require Product Finder access — sales and admin are the people who take the customer call and
 * can start a Purchase Request; director keeps access for oversight. Management/accounting are
 * deliberately OUT: they have no navbar link to it and cannot use the Purchase Request form the
 * finder hands off to, so admitting them would only strand them on a dead-end page.
 */
function requireProductFinderAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['sales', 'admin', 'director'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require inventory access — sales can add/edit (delete is hidden for sales in the UI);
 * admin & accounting retain full access including delete.
 */
function requireInventoryAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['admin', 'accounting', 'sales', 'management', 'director'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;   // management/director are read-only viewers (handled in flow-inventory.js)
}

/**
 * Require management role — redirect others to their home page
 */
function requireManagement() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'management') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require an oversight role (admin, accounting, management, director) — used by the
 * all-users daily-reports view and the accounting summary. Sales is redirected home.
 */
function requireOversight() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['admin', 'accounting', 'management', 'director'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require access to the team performance view (HR, management, director, admin).
 * Deliberately NOT requireOversight: that guard also gates the accounting summary and the balance
 * sheet, so widening it would hand HR the company's P&L. HR sees people performance, not financials
 * (the page passes hideAmounts for the hr role).
 */
function requirePerformanceAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['hr', 'management', 'director', 'admin'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require marketing-dashboard access — the marketing user (full edit) plus
 * director / management / admin (read-only oversight). Others go to their home.
 */
function requireMarketingAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['marketing', 'director', 'management', 'admin'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/** Require the marketing role exactly (own daily report). Oversight roles use all-daily-reports. */
function requireMarketing() {
  const session = getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  if (session.role !== 'marketing') { window.location.href = _homeForRole(session.role); return null; }
  return session;
}

/**
 * Require director role — redirect others to their home page
 */
function requireDirector() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'director') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require admin or management role — shared approval pages
 */
function requireAdminOrManagement() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'admin' && session.role !== 'management') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * A191 — pages that expose COST figures: buy price, landed cost, COGS, commission % and margin %.
 *
 * Deliberately excludes admin. Admin sources supplier prices and approves quotations on commercial
 * terms, but must only ever see the FINAL price — never the margin the company makes on it. Sales is
 * excluded for the same reason, one level further out.
 *
 * Named for the thing it protects rather than the roles it lists, so the next page that renders a
 * margin has an obvious guard to reach for instead of inventing another role tuple.
 */
function requirePricingCostAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (['accounting', 'management', 'director'].indexOf(session.role) < 0) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require HR role
 */
function requireHR() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'hr') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Require HR or admin role
 */
function requireHROrAdmin() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (session.role !== 'hr' && session.role !== 'admin' && session.role !== 'management') {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
}

/**
 * Logout — clear session and redirect to login
 */
function logout() {
  // Invalidate server-side session (fire-and-forget)
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.token) apiLogout(s.token);
    }
  } catch {}
  localStorage.removeItem(SESSION_KEY);
  window.location.href = 'index.html';
}

/**
 * Build the navigation bar HTML and inject it
 * @param {string} activePage - Current page identifier
 */
/* A209 — a menu entry for something that is visible but not open yet. Kept visible rather than
   hidden so people can see the feature is being built; the page behind it explains what it will do
   and does nothing else. flow-api.js owns the flag, and defends against load order.
   A211 — asked per role: the tag disappears for the roles the feature is actually open to, and the
   three navbars below each pass their own session's role rather than sharing one global answer. */
function _soon(role) {
  return (typeof flowCommissionsLiveFor === 'function' && !flowCommissionsLiveFor(role)
    && typeof flowSoonTag === 'function') ? flowSoonTag() : '';
}

function renderNavbar(activePage) {
  const session = getSession();
  if (!session) return;

  const initials = session.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  const brandText = session.role === 'admin' ? 'Admin Dashboard' : session.role === 'accounting' ? 'Accounting Dashboard' : session.role === 'management' ? 'Management Dashboard' : session.role === 'director' ? 'Director Dashboard' : session.role === 'hr' ? 'HR-Marketing Dashboard' : session.role === 'marketing' ? 'Marketing Dashboard' : 'Sales Dashboard';

  let navLinks = '';
  if (session.role === 'admin') {
    const salesPages = ['admin-team', 'admin-clients', 'admin-reports', 'admin-targets', 'admin-daily-report'];
    const sysPages = ['admin-users', 'admin-login-log', 'change-password'];
    const salesActive = salesPages.includes(activePage);
    const sysActive = sysPages.includes(activePage);

    navLinks = `
      <a href="admin.html" class="${activePage === 'admin-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${salesActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Sales
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="admin-team.html" class="${activePage === 'admin-team' ? 'active' : ''}">Team Analytics</a>
          <a href="clients.html" class="${activePage === 'admin-clients' ? 'active' : ''}">Client List</a>
          <a href="admin-reports.html" class="${activePage === 'admin-reports' ? 'active' : ''}">Daily Reports</a>
          <a href="admin-daily-report.html" class="${activePage === 'admin-daily-report' ? 'active' : ''}">Admin Daily Report</a>
          <a href="admin-targets.html" class="${activePage === 'admin-targets' ? 'active' : ''}">Sales Targets</a>
        </div>
      </div>
      <a href="payment-requests.html" class="${activePage === 'payment-requests' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        Payment Requests
      </a>
      <a href="accounting.html" class="${activePage === 'accounting' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Accounting
      </a>
      <a href="marketing-home.html" class="${activePage === 'marketing-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        Marketing
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${((activePage || '').indexOf('flow') === 0 || activePage === 'product-finder') ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
          Process Flow
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-home.html" class="${activePage === 'flow-home' ? 'active' : ''}">Overview</a>
          <a href="product-finder.html" class="${activePage === 'product-finder' ? 'active' : ''}">Product Finder</a>
          <a href="flow-lifecycle.html" class="${activePage === 'flow-lifecycle' ? 'active' : ''}">SO Lifecycle Tracker</a>
          <a href="flow-accounting.html" class="${activePage === 'flow-accounting' ? 'active' : ''}">Accounting</a>
          <a href="flow-pricing-request.html" class="${activePage === 'flow-pricing-request' ? 'active' : ''}">Purchase Requests</a>
          <a href="purchase-request-tracker.html" class="${activePage === 'purchase-request-tracker' ? 'active' : ''}">PR Tracker</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotations</a>
          <a href="quotation-board.html" class="${activePage === 'quotation-board' ? 'active' : ''}">Quotation Board</a>
          <a href="client-tracker.html" class="${activePage === 'client-tracker' ? 'active' : ''}">Client Tracker</a>
          <a href="admin-import-quotation.html" class="${activePage === 'admin-import-quotation' ? 'active' : ''}">Import Quotation</a>
          <a href="flow-sales-orders.html" class="${activePage === 'flow-sales-orders' ? 'active' : ''}">Sales Orders</a>
          <a href="flow-purchase-orders.html" class="${activePage === 'flow-purchase-orders' ? 'active' : ''}">Purchase Orders</a>
          <a href="flow-payment-requests.html" class="${activePage === 'flow-payment-requests' ? 'active' : ''}">Payment Requests</a>
          <a href="flow-ap-aging.html" class="${activePage === 'flow-ap-aging' ? 'active' : ''}">AP Aging</a>
          <a href="flow-payments.html" class="${activePage === 'flow-payments' ? 'active' : ''}">Payment Register</a>
          <a href="flow-other-payables.html" class="${activePage === 'flow-other-payables' ? 'active' : ''}">Other Payables</a>
          <a href="flow-receiving.html" class="${activePage === 'flow-receiving' ? 'active' : ''}">Materials Receiving</a>
          <a href="flow-invoices.html" class="${activePage === 'flow-invoices' ? 'active' : ''}">Invoices</a>
          <a href="flow-ar-aging.html" class="${activePage === 'flow-ar-aging' ? 'active' : ''}">AR Aging</a>
          <a href="flow-collections.html" class="${activePage === 'flow-collections' ? 'active' : ''}">Collections</a>
          <a href="flow-expenses.html" class="${activePage === 'flow-expenses' ? 'active' : ''}">Expenses</a>
          <a href="flow-suppliers.html" class="${activePage === 'flow-suppliers' ? 'active' : ''}">Suppliers</a>
          <a href="flow-clients.html" class="${activePage === 'flow-clients' ? 'active' : ''}">Clients</a>
          <a href="flow-shipments.html" class="${activePage === 'flow-shipments' ? 'active' : ''}">Shipments</a>
          <a href="flow-ledger.html" class="${activePage === 'flow-ledger' ? 'active' : ''}">General Ledger</a>
          <a href="flow-guide.html" class="${activePage === 'flow-guide' ? 'active' : ''}">Process Guide</a>
          <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">Accounting Summary</a>
          <a href="balance-sheet.html" class="${activePage === 'balance-sheet' ? 'active' : ''}">Balance Sheet</a>
          <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">All Daily Reports</a>
          <a href="team-performance.html" class="${activePage === 'team-performance' ? 'active' : ''}">Team Performance</a>
        </div>
      </div>
      <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Leave Request
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${sysActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.39 1.14H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09c-.62.09-1.13.54-1.39 1.14z"/></svg>
          System
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="email-setup.html" class="${activePage === 'email-setup' ? 'active' : ''}">Email Setup</a>
          <a href="admin-users.html" class="${activePage === 'admin-users' ? 'active' : ''}">User Management</a>
          <a href="admin-login-log.html" class="${activePage === 'admin-login-log' ? 'active' : ''}">Login Log</a>
          <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">Change Password</a>
        </div>
      </div>`;
  } else if (session.role === 'accounting') {
    const flowActive = (activePage || '').indexOf('flow') === 0 || activePage === 'management-sales-orders';
    const reportsActive = ['accounting-daily-report', 'payment-requests'].includes(activePage);
    const acctMenuActive = ['email-setup', 'change-password'].includes(activePage);
    navLinks = `
      <a href="accounting-home.html" class="${activePage === 'accounting-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${flowActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
          Process Flow
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-lifecycle.html" class="${activePage === 'flow-lifecycle' ? 'active' : ''}">SO Lifecycle Tracker</a>
          <a href="flow-accounting.html" class="${activePage === 'flow-accounting' ? 'active' : ''}">Accounting</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotations</a>
          <a href="quotation-board.html" class="${activePage === 'quotation-board' ? 'active' : ''}">Quotation Board</a>
          <a href="client-tracker.html" class="${activePage === 'client-tracker' ? 'active' : ''}">Client Tracker</a>
          <a href="flow-sales-orders.html" class="${activePage === 'flow-sales-orders' ? 'active' : ''}">Sales Orders</a>
          <a href="management-sales-orders.html" class="${activePage === 'management-sales-orders' ? 'active' : ''}">Sales Orders — All</a>
          <a href="flow-purchase-orders.html" class="${activePage === 'flow-purchase-orders' ? 'active' : ''}">Purchase Orders</a>
          <a href="flow-payment-requests.html" class="${activePage === 'flow-payment-requests' ? 'active' : ''}">Payment Requests</a>
          <a href="flow-ap-aging.html" class="${activePage === 'flow-ap-aging' ? 'active' : ''}">AP Aging</a>
          <a href="flow-payments.html" class="${activePage === 'flow-payments' ? 'active' : ''}">Payment Register</a>
          <a href="flow-other-payables.html" class="${activePage === 'flow-other-payables' ? 'active' : ''}">Other Payables</a>
          <a href="flow-travel.html" class="${activePage === 'flow-travel' ? 'active' : ''}">Travel Allowance</a>
          <a href="flow-receiving.html" class="${activePage === 'flow-receiving' ? 'active' : ''}">Receiving</a>
          <a href="flow-invoices.html" class="${activePage === 'flow-invoices' ? 'active' : ''}">Invoices</a>
          <a href="flow-ar-aging.html" class="${activePage === 'flow-ar-aging' ? 'active' : ''}">AR Aging</a>
          <a href="flow-collections.html" class="${activePage === 'flow-collections' ? 'active' : ''}">Collections</a>
          <a href="flow-expenses.html" class="${activePage === 'flow-expenses' ? 'active' : ''}">Expenses</a>
          <a href="flow-suppliers.html" class="${activePage === 'flow-suppliers' ? 'active' : ''}">Suppliers</a>
          <a href="flow-clients.html" class="${activePage === 'flow-clients' ? 'active' : ''}">Clients</a>
          <a href="flow-shipments.html" class="${activePage === 'flow-shipments' ? 'active' : ''}">Shipments</a>
          <a href="flow-ledger.html" class="${activePage === 'flow-ledger' ? 'active' : ''}">General Ledger</a>
          <a href="flow-guide.html" class="${activePage === 'flow-guide' ? 'active' : ''}">Process Guide</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${reportsActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Reports
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="accounting-daily-report.html" class="${activePage === 'accounting-daily-report' ? 'active' : ''}">My Daily Report</a>
          <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">All Daily Reports</a>
          <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">Accounting Summary</a>
          <a href="balance-sheet.html" class="${activePage === 'balance-sheet' ? 'active' : ''}">Balance Sheet</a>
          <a href="payment-requests.html" class="${activePage === 'payment-requests' ? 'active' : ''}">Payment Requests</a>
        </div>
      </div>
      <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Leave Request
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${acctMenuActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.39 1.14H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09c-.62.09-1.13.54-1.39 1.14z"/></svg>
          Account
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="email-setup.html" class="${activePage === 'email-setup' ? 'active' : ''}">Email Setup</a>
          <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">Change Password</a>
        </div>
      </div>`;
  } else if (session.role === 'management') {
    const mApprPages = ['flow-quotations', 'flow-purchase-orders', 'flow-payment-requests', 'flow-other-payables', 'flow-pricing-request', 'management-leave', 'flow-commissions', 'commission-payout-report', 'management-itinerary', 'quotation-board', 'client-tracker', 'purchase-request-tracker'];   // A207 · A216 · A217 · A226
    const mFinPages = ['accounting-summary', 'balance-sheet', 'flow-inventory', 'management-sales-orders', 'flow-ap-aging', 'flow-ar-aging', 'flow-lifecycle', 'flow-payments'];   // A223
    const mAcctPages = ['leave-request', 'change-password'];
    const mApprActive = mApprPages.includes(activePage) ? 'active' : '';
    const mFinActive = mFinPages.includes(activePage) ? 'active' : '';
    const mAcctActive = mAcctPages.includes(activePage) ? 'active' : '';
    navLinks = `
      <a href="management-home.html" class="${activePage === 'management-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${mApprActive}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Approvals
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotation Approvals</a>
          <a href="quotation-board.html" class="${activePage === 'quotation-board' ? 'active' : ''}">Quotation Board</a>
          <a href="client-tracker.html" class="${activePage === 'client-tracker' ? 'active' : ''}">Client Tracker</a>
          <a href="flow-purchase-orders.html" class="${activePage === 'flow-purchase-orders' ? 'active' : ''}">PO Approvals</a>
          <a href="flow-payment-requests.html" class="${activePage === 'flow-payment-requests' ? 'active' : ''}">Payment Requests</a>
          <a href="flow-other-payables.html" class="${activePage === 'flow-other-payables' ? 'active' : ''}">Other Payables</a>
          <a href="flow-pricing-request.html" class="${activePage === 'flow-pricing-request' ? 'active' : ''}">Pricing Requests</a>
          <a href="purchase-request-tracker.html" class="${activePage === 'purchase-request-tracker' ? 'active' : ''}">PR Tracker</a>
          <a href="management-leave.html" class="${activePage === 'management-leave' ? 'active' : ''}">Leave Approvals</a>
          <a href="management-itinerary.html" class="${activePage === 'management-itinerary' ? 'active' : ''}">Weekly Itineraries</a>
          <a href="commission-payout-report.html" class="${activePage === 'commission-payout-report' ? 'active' : ''}">Sales Commissions${_soon(session.role)}</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${mFinActive}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Financials
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-lifecycle.html" class="${activePage === 'flow-lifecycle' ? 'active' : ''}">SO Lifecycle Tracker</a>
          <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">Accounting Summary</a>
          <a href="balance-sheet.html" class="${activePage === 'balance-sheet' ? 'active' : ''}">Balance Sheet</a>
          <a href="flow-ap-aging.html" class="${activePage === 'flow-ap-aging' ? 'active' : ''}">AP Aging</a>
          <a href="flow-payments.html" class="${activePage === 'flow-payments' ? 'active' : ''}">Payment Register</a>
          <a href="flow-ar-aging.html" class="${activePage === 'flow-ar-aging' ? 'active' : ''}">AR Aging</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
          <a href="management-sales-orders.html" class="${activePage === 'management-sales-orders' ? 'active' : ''}">Sales Orders</a>
        </div>
      </div>
      <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Daily Reports
      </a>
      <a href="team-performance.html" class="${activePage === 'team-performance' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Team Performance
      </a>
      <a href="marketing-home.html" class="${activePage === 'marketing-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        Marketing
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${mAcctActive}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Account
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">Request Leave</a>
          <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">Change Password</a>
        </div>
      </div>`;
  } else if (session.role === 'director') {
    const dirPayablesActive = ['flow-payment-requests', 'flow-other-payables', 'director-expenses', 'flow-commissions', 'commission-payout-report', 'commission-rates', 'flow-travel', 'flow-payments'].includes(activePage);   // A207 · A212 · A223
    const dirReportsActive = ['director-sales-orders', 'accounting-summary', 'balance-sheet'].includes(activePage);
    const dirTeamActive = ['all-daily-reports', 'team-performance', 'management-itinerary'].includes(activePage);   // A216
    const dirAcctActive = ['director-emails', 'email-setup', 'change-password', 'pf-admin'].includes(activePage);
    // A175: one quotation page — the builder and the history live together on flow-quotations.html.
    const dirQuoteActive = ['flow-quotations', 'quotation-board', 'client-tracker'].includes(activePage);   // A217
    navLinks = `
      <a href="director-home.html" class="${activePage === 'director-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <a href="product-finder.html" class="${activePage === 'product-finder' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Product Finder
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${dirQuoteActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Quotations
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">All Quotations</a>
          <a href="quotation-board.html" class="${activePage === 'quotation-board' ? 'active' : ''}">Quotation Board</a>
          <a href="client-tracker.html" class="${activePage === 'client-tracker' ? 'active' : ''}">Client Tracker</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${dirPayablesActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Payables
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-payment-requests.html" class="${activePage === 'flow-payment-requests' ? 'active' : ''}">Payment Requests</a>
          <a href="flow-other-payables.html" class="${activePage === 'flow-other-payables' ? 'active' : ''}">Other Payables</a>
          <a href="flow-payments.html" class="${activePage === 'flow-payments' ? 'active' : ''}">Payment Register</a>
          <a href="director-expenses.html" class="${activePage === 'director-expenses' ? 'active' : ''}">Expenses</a>
          <a href="flow-travel.html" class="${activePage === 'flow-travel' ? 'active' : ''}">Travel Allowance</a>
          <a href="commission-payout-report.html" class="${activePage === 'commission-payout-report' ? 'active' : ''}">Commissions for Payroll${_soon(session.role)}</a>
          <a href="commission-rates.html" class="${activePage === 'commission-rates' ? 'active' : ''}">Commission Rates${_soon(session.role)}</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${dirReportsActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Reports
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="director-sales-orders.html" class="${activePage === 'director-sales-orders' ? 'active' : ''}">Sales Orders</a>
          <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">Accounting Summary</a>
          <a href="balance-sheet.html" class="${activePage === 'balance-sheet' ? 'active' : ''}">Balance Sheet</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${dirTeamActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Team
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">Daily Reports</a>
          <a href="management-itinerary.html" class="${activePage === 'management-itinerary' ? 'active' : ''}">Weekly Itineraries</a>
          <a href="team-performance.html" class="${activePage === 'team-performance' ? 'active' : ''}">Team Performance</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${dirAcctActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>
          Account
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="director-emails.html" class="${activePage === 'director-emails' ? 'active' : ''}">Email</a>
          <a href="email-setup.html" class="${activePage === 'email-setup' ? 'active' : ''}">Connect Email</a>
          <a href="pf-admin.html" class="${activePage === 'pf-admin' ? 'active' : ''}">PF Data Admin</a>
          <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">Change Password</a>
        </div>
      </div>`;
  } else if (session.role === 'marketing') {
    const acctActive = ['email-setup', 'change-password'].includes(activePage);
    navLinks = `
      <a href="marketing-home.html" class="${activePage === 'marketing-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Dashboard
      </a>
      <a href="marketing-daily-report.html" class="${activePage === 'marketing-daily-report' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Daily Report
      </a>
      <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Leave Request
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${acctActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Account
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="email-setup.html" class="${activePage === 'email-setup' ? 'active' : ''}">Email Setup</a>
          <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">Change Password</a>
        </div>
      </div>`;
  } else if (session.role === 'hr') {
    navLinks = `
      <a href="hr-home.html" class="${activePage === 'hr-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <a href="hr-employees.html" class="${activePage === 'hr-employees' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Employees
      </a>
      <a href="hr-recruitment.html" class="${activePage === 'hr-recruitment' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        Recruitment
      </a>
      <a href="hr-leave.html" class="${activePage === 'hr-leave' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Leave
      </a>
      <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Request Leave
      </a>
      <a href="hr-tasks.html" class="${activePage === 'hr-tasks' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Tasks
      </a>
      <a href="hr-daily-report.html" class="${activePage === 'hr-daily-report' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Daily Report
      </a>
      <a href="team-performance.html" class="${activePage === 'team-performance' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Team Performance
      </a>
      <a href="hr-analytics.html" class="${activePage === 'hr-analytics' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Analytics
      </a>
      <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Change Password
      </a>`;
  } else {
    const workActive = ['product-finder', 'flow-pricing-request', 'flow-quotations', 'flow-inventory', 'weekly-itinerary', 'flow-travel', 'flow-commissions', 'sales-emails', 'quotation-board', 'client-tracker', 'purchase-request-tracker'].includes(activePage);   // A190 · A207 · A208 · A214 · A217 · A226
    const clientsActive = ['clients', 'performance', 'pending-items', 'quotation-summary'].includes(activePage);
    const reportsActive = ['report', 'my-reports'].includes(activePage);
    const accountActive = ['email-setup', 'change-password'].includes(activePage);
    navLinks = `
      <a href="dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${workActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
          Work
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="product-finder.html" class="${activePage === 'product-finder' ? 'active' : ''}">Product Finder</a>
          <a href="flow-pricing-request.html" class="${activePage === 'flow-pricing-request' ? 'active' : ''}">Purchase Requests</a>
          <a href="purchase-request-tracker.html" class="${activePage === 'purchase-request-tracker' ? 'active' : ''}">PR Tracker</a>
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotations</a>
          <a href="quotation-board.html" class="${activePage === 'quotation-board' ? 'active' : ''}">Quotation Board</a>
          <a href="client-tracker.html" class="${activePage === 'client-tracker' ? 'active' : ''}">Client Tracker</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
          <a href="weekly-itinerary.html" class="${activePage === 'weekly-itinerary' ? 'active' : ''}">Weekly Itinerary</a>
          <a href="flow-travel.html" class="${activePage === 'flow-travel' ? 'active' : ''}">Travel Allowance</a>
          <a href="flow-commissions.html" class="${activePage === 'flow-commissions' ? 'active' : ''}">Commission Requests${_soon(session.role)}</a>
          <a href="sales-emails.html" class="${activePage === 'sales-emails' ? 'active' : ''}">My Emails</a>
          <a href="flow-guide.html" class="${activePage === 'flow-guide' ? 'active' : ''}">Process Guide</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${clientsActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Clients
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="clients.html" class="${activePage === 'clients' ? 'active' : ''}">Client List</a>
          <a href="performance.html" class="${activePage === 'performance' ? 'active' : ''}">Client Tracker</a>
          <a href="pending-items.html" class="${activePage === 'pending-items' ? 'active' : ''}">Pending Items</a>
          <a href="quotation-summary.html" class="${activePage === 'quotation-summary' ? 'active' : ''}">Quotation Summary</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${reportsActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Reports
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="report.html" class="${activePage === 'report' ? 'active' : ''}">Daily Report</a>
          <a href="my-reports.html" class="${activePage === 'my-reports' ? 'active' : ''}">My Reports</a>
        </div>
      </div>
      <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Leave Request
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${accountActive ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>
          Account
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="email-setup.html" class="${activePage === 'email-setup' ? 'active' : ''}">Connect Email</a>
          <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">Change Password</a>
        </div>
      </div>`;
  }

  const nav = document.getElementById('navbar');
  if (!nav) return;

  nav.innerHTML = `
    <div class="navbar-brand">
      <img src="images/logo-nav.png" alt="Hi-Escorp">
    </div>
    <button class="mobile-menu-toggle" onclick="document.getElementById('navLinks').classList.toggle('open')" aria-label="Menu">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <nav class="navbar-nav" id="navLinks">
      ${navLinks}
    </nav>
    <div class="navbar-user">
      <div class="notif-bell" id="notifBell" onclick="toggleNotifDropdown()" title="Notifications" style="position:relative;cursor:pointer;margin-right:0.5rem;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span id="notifBadge" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;width:16px;height:16px;border-radius:50%;align-items:center;justify-content:center;"></span>
      </div>
      <div id="notifDropdown" style="display:none;position:absolute;top:52px;right:60px;width:320px;max-height:400px;overflow-y:auto;background:var(--surface,#ffffff);border:1px solid var(--border,#334155);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);z-index:9999;padding:0.5rem 0;">
        <div style="padding:0.5rem 1rem;font-size:0.82rem;font-weight:700;color:var(--text-primary,#f1f5f9);border-bottom:1px solid var(--border,#334155);">Notifications</div>
        <div id="notifList" style="padding:0.25rem 0;font-size:0.8rem;color:var(--text-secondary,#94a3b8);">
          <div style="padding:0.75rem 1rem;text-align:center;color:var(--text-muted);">Loading...</div>
        </div>
      </div>
      <span class="navbar-user-name">${session.name}</span>
      <div class="navbar-user-avatar">${initials}</div>
      <button class="btn btn-ghost btn-sm" onclick="logout()" title="Logout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
    </div>
  `;

  // Prefetch pages on nav link hover
  const _prefetched = {};
  nav.querySelectorAll('.navbar-nav a[href]').forEach(link => {
    link.addEventListener('mouseenter', () => {
      const href = link.getAttribute('href');
      if (!href || _prefetched[href]) return;
      _prefetched[href] = true;
      const prefetchLink = document.createElement('link');
      prefetchLink.rel = 'prefetch';
      prefetchLink.href = href;
      document.head.appendChild(prefetchLink);
    }, { once: true });
  });

  // Dropdown toggle for mobile (touch devices)
  nav.querySelectorAll('.nav-dropdown-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = btn.closest('.nav-dropdown');
      // Close other dropdowns
      nav.querySelectorAll('.nav-dropdown.open').forEach(d => {
        if (d !== dd) d.classList.remove('open');
      });
      dd.classList.toggle('open');
    });
  });
}

/**
 * Get time-based greeting
 * @param {string} name - User's first name or full name
 * @returns {string} Greeting string
 */
function getGreeting(name) {
  return `Welcome to Hi-Escorp, <span>${name}</span>!`;
}

// ─── Notification System ──────────────────────────
let _notifOpen = false;

function toggleNotifDropdown() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  _notifOpen = !_notifOpen;
  dd.style.display = _notifOpen ? 'block' : 'none';
  if (_notifOpen) loadNotifications();
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const dd = document.getElementById('notifDropdown');
  const bell = document.getElementById('notifBell');
  if (!dd || !bell) return;
  if (!bell.contains(e.target) && !dd.contains(e.target)) {
    _notifOpen = false;
    dd.style.display = 'none';
  }
});

// ── A146: Unified per-role Action Center ────────────────────────────────────
// One live-computed worklist ("what needs YOU right now"), derived from the same FlowAPI getters the
// homes already call. Feeds BOTH the navbar bell (loadNotifications) and the home strip (flowActionsStrip).
// Items are NAVIGATIONAL (link to the page where you act) — no approve wiring duplicated here. Nothing
// persists: an item disappears the moment its underlying status changes. Returns [{icon,color,text,link}].
async function flowComputeActions(session) {
  const items = [];
  if (!session || typeof fetchFlow !== 'function') return items;
  const role = String(session.role || '').toLowerCase();
  const add = (icon, color, text, link) => items.push({ icon, color, text, link });
  const isMgmt = role === 'management', isDir = role === 'director';
  const isAdmin = role === 'admin', isAcct = role === 'accounting', isSales = role === 'sales';
  // "Past due" only when a due date is set and is before today (precise, low-noise).
  const _pastDue = (d) => {
    if (!d) return false;
    try { const s = (typeof flowDate === 'function') ? flowDate(d) : String(d).slice(0, 10);
      const t = (typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10);
      return s && s < t; } catch (e) { return false; }
  };
  /* A171 — a nudge is only a nudge if someone can still act on it. A delivered or closed record has
     nothing left to do, and one untouched for months is history. Without these the strip filled with
     long-finished work and buried the things that genuinely needed her. */
  const _actionable = (status) => !/deliver|closed|complete|cancel|void|paid|quoted|rejected/i.test(String(status || ''));
  const _stale = (d, days) => {
    if (!d) return false;
    try {
      const then = new Date((typeof flowDate === 'function') ? flowDate(d) : String(d).slice(0, 10));
      const now = new Date((typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10));
      return !isNaN(then) && (now - then) / 86400000 > days;
    } catch (e) { return false; }
  };
  const jobs = [];

  // Low stock — oversight roles (existing behaviour). Real stocks only; "low" = 0 < balance < 10.
  if (isAdmin || isAcct || isMgmt || isDir) {
    jobs.push(fetchFlow('getInventory').then(r => {
      const stockOnly = (typeof flowStockItems === 'function') ? flowStockItems((r && r.data) || []) : ((r && r.data) || []);
      const low = stockOnly.filter(i => { const b = parseFloat(i.balance) || 0; return b > 0 && b < 10; });
      if (low.length) add('inventory', '#ef4444', low.length + ' item(s) running low on stock', 'flow-inventory.html');
    }).catch(() => {}));
  }

  // Quotations awaiting MY approval.
  if (isAdmin || isMgmt || isDir) {
    const stage = isAdmin ? 'Pending Admin' : 'Pending Management';
    jobs.push(fetchFlow('getQuotations').then(r => {
      const n = ((r && r.data) || []).filter(q => q.status === stage).length;
      if (n) add('report', '#f97316', n + ' quotation(s) awaiting your approval', 'flow-quotations.html');
    }).catch(() => {}));
  }
  /* A190 — weekly itineraries. The director is the FIRST approver and management the second, so
     each role is shown only its own stage; surfacing the other tier's queue trains people to
     ignore the list. A rep sees their own plan coming back rejected. */
  if (isDir || isMgmt) {
    const stage = isDir ? 'Pending Director' : 'Pending Management';
    jobs.push(fetchFlow('getWeeklyItineraries').then(r => {
      const n = ((r && r.data) || []).filter(x => x.status === stage).length;
      if (n) add('report', '#f97316', n + ' weekly itinerar' + (n === 1 ? 'y' : 'ies') + ' awaiting your approval',
                 isDir ? 'director-home.html' : 'management-home.html');
    }).catch(() => {}));
  }
  if (isSales) {
    jobs.push(fetchFlow('getWeeklyItineraries', { user: session.name }).then(r => {
      const mine = ((r && r.data) || []).filter(x => x.status === 'Rejected').length;
      if (mine) add('report', '#ef4444', mine + ' weekly itinerar' + (mine === 1 ? 'y was' : 'ies were') + ' sent back', 'weekly-itinerary.html');
    }).catch(() => {}));
  }

  /* A209 — for a role commissions are not open to yet, no nudge and no bell count. Deliberately
     SILENT rather than marked "Soon": a nudge saying "3 requests awaiting your approval" is about
     real pending work, and there cannot be any. It would also still increment the bell.
     A211 — now asked per role, so the director and management nudges below come alive while sales
     stay silent. The three reads are POSTs from here on: getCommissionRequests is secured, and the
     rep's `salesperson` filter is applied server-side from the session, not from this name. */
  const _commLive = (typeof flowCommissionsLiveFor !== 'function') || flowCommissionsLiveFor(session.role);

  /* A208 — the same picture across the team, for the two tiers who chase it. One fetch, no mailbox. */
  if (isMgmt || isDir) {
    jobs.push(Promise.all([
      fetchFlow('getQuotations').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getQuotationEmails').catch(() => ({ data: [] })),
      fetchFlow('getFlowSettings').catch(() => ({ data: null })),
    ]).then(([q, so, le, cf]) => {
      if (typeof flowFollowUp !== 'function') return;
      const rows = (q && q.data) || [];
      const hasSO = {}; ((so && so.data) || []).forEach(s => { if (s.quotationNo) hasSO[String(s.quotationNo)] = true; });
      const cfg = (cf && cf.data) || null;
      const links = {};
      ((le && le.data) || []).forEach(l => { const k = String(l.quotationNo || ''); if (k) (links[k] = links[k] || []).push(l); });
      let chase = 0, value = 0;
      rows.forEach(x => {
        const fu = flowFollowUp(x, links[String(x.quotationNo)] || [], cfg, hasSO);
        if (fu.state === 'due' || fu.state === 'overdue') { chase++; value += (typeof flowQuotationNet === 'function' ? flowQuotationNet(x) : 0); }
      });
      if (chase) add('report', '#b45309', chase + ' quotation(s) across the team past follow-up' +
        (value ? ' (\u20b1' + Math.round(value).toLocaleString() + ')' : ''), 'flow-quotations.html');
    }).catch(() => {}));
  }

  // Purchase orders awaiting management/director approval.
  if (isMgmt || isDir) {
    jobs.push(fetchFlow('getPurchaseOrders').then(r => {
      const n = ((r && r.data) || []).filter(p => p.status === 'Pending Management').length;
      if (n) add('report', '#f97316', n + ' purchase order(s) awaiting your approval', 'flow-purchase-orders.html');
    }).catch(() => {}));
  }
  // Management: pricing requests waiting for final prices (previously unsurfaced on any home).
  if (isMgmt || isDir) {
    jobs.push(fetchFlow('getPricingRequests').then(r => {
      const n = ((r && r.data) || []).filter(p => p.status === 'For Mgmt Pricing').length;
      if (n) add('report', '#6366f1', n + ' pricing request(s) waiting for your final pricing', 'flow-pricing-request.html');
    }).catch(() => {}));
  }
  /* Admin: the whole pricing queue admin actually owns. A192 added the second and third counts —
     admin previously got nudged only about sourcing, so a request it had verified and returned sat
     unquoted with nothing anywhere pointing at it. One fetch covers all three. */
  if (isAdmin) {
    jobs.push(fetchFlow('getPricingRequests').then(r => {
      const rows = (r && r.data) || [];
      const src = rows.filter(p => p.status === 'Requested' || p.status === 'Sourcing').length;
      if (src) add('report', '#6366f1', src + ' pricing request(s) waiting to be sourced', 'flow-pricing-request.html');
      const ver = rows.filter(p => p.status === 'Mgmt Priced').length;
      if (ver) add('report', '#f97316', ver + ' priced request(s) awaiting your verification', 'flow-pricing-request.html');
      /* Deliberately unscoped: a returned request nobody has quoted is admin's problem whoever
         raised it, and that oversight is exactly what was missing. Sales keeps its own scoped
         nudge for the ones raised in their name. */
      const rts = rows.filter(p => p.status === 'Returned to Sales').length;
      if (rts) add('report', '#22c55e', rts + ' priced request(s) still waiting to be quoted', 'flow-pricing-request.html');
    }).catch(() => {}));
  }
  /* A207 commissions. Three separate nudges because three different people have three different
     jobs here, and each is shown only the one they can actually act on — surfacing the other tier's
     queue is what trains people to ignore the list. */
  if (_commLive && (isDir || isMgmt)) {
    const mine = isDir ? 'Pending Director' : 'Pending Management';
    jobs.push(postFlow('getCommissionRequests', { status: mine }).then(r => {
      const rows = (r && r.data) || [];
      if (rows.length) {
        const value = rows.reduce((t, x) => t + (parseFloat(x.netPayable) || 0), 0);
        add('report', '#f97316', rows.length + ' commission request(s) awaiting your approval'
            + (value ? ' (\u20b1' + Math.round(value).toLocaleString() + ')' : ''),
            isDir ? 'director-home.html' : 'management-home.html');
      }
    }).catch(() => {}));
  }
  /* The director again, wearing the payroll hat: approved commissions still to be keyed into a
     cutoff. Without this an approved claim can sit unpaid indefinitely — nothing else chases it. */
  if (_commLive && isDir) {
    jobs.push(postFlow('getCommissionRequests', { status: 'Approved' }).then(r => {
      const rows = ((r && r.data) || []).filter(x => !x.releasedAt);
      if (rows.length) {
        const value = rows.reduce((t, x) => t + (parseFloat(x.netPayable) || 0), 0);
        add('urgent', '#ef4444', rows.length + ' approved commission(s) to include in the next cutoff'
            + (value ? ' (\u20b1' + Math.round(value).toLocaleString() + ')' : ''),
            'commission-payout-report.html');
      }
    }).catch(() => {}));
  }
  /* A212 — travel allowance. The approver sees only what is at THEIR stage: a week sitting with the
     other signatory is not theirs to chase, and counting it would make the badge permanently wrong.
     getTravelReplenishments is session-scoped server-side, so a rep asking gets only their own. */
  if (isAcct || isDir) {
    const myStage = isAcct ? 'Pending Accounting' : 'Pending Director';
    jobs.push(postFlow('getTravelReplenishments', { status: myStage }).then(r => {
      const rows = (r && r.data) || [];
      if (rows.length) {
        const value = rows.reduce((t, x) => t + (parseFloat(x.totalSpent) || 0), 0);
        add('urgent', '#ef4444', rows.length + ' travel report(s) waiting for your signature'
            + (value ? ' (₱' + Math.round(value).toLocaleString() + ')' : ''),
            'flow-travel.html');
      }
    }).catch(() => {}));
  }
  /* The rep: a week sent back is a dead end unless somebody says so. */
  if (isSales) {
    jobs.push(postFlow('getTravelReplenishments', { status: 'Rejected' }).then(r => {
      const rows = (r && r.data) || [];
      if (rows.length) add('report', '#b45309', rows.length + ' travel report(s) sent back to you',
                           'flow-travel.html');
    }).catch(() => {}));
  }
  /* The rep: a rejected claim is a dead end unless someone tells them. Scoped to their own name. */
  if (_commLive && isSales) {
    jobs.push(postFlow('getCommissionRequests', { status: 'Rejected' }).then(r => {
      const rows = (r && r.data) || [];
      if (rows.length) add('report', '#b45309', rows.length + ' commission request(s) sent back to you',
                           'flow-commissions.html');
    }).catch(() => {}));
  }
  // A156: one chain for both types — Admin → Management → Director → Approved → Paid.
  // The two legacy statuses are still matched so requests submitted before v92 keep surfacing.
  if (isMgmt || isDir || isAcct || isAdmin) {
    jobs.push(fetchFlow('getPaymentRequests').then(r => {
      const prs = (r && r.data) || [];
      // A158: counted per TYPE, because the two types live on different pages — a director sent to
      // flow-payment-requests.html for an Other-type request lands on a page that filters it out.
      const waiting = { PO: 0, Other: 0 }, toPay = { PO: 0, Other: 0 };
      prs.forEach(p => {
        const s = p.status, t = (String(p.type) === 'Other') ? 'Other' : 'PO';
        if (isAdmin && (s === 'Pending Admin' || s === 'Pending Accounting')) waiting[t]++;
        else if (isMgmt && (s === 'Pending Management' || (s === 'Pending Final' && !p.mgmtApprovedBy))) waiting[t]++;
        else if (isDir && (s === 'Pending Director' || (s === 'Pending Final' && !p.dirApprovedBy))) waiting[t]++;
        // Approved but not yet paid — owned by whoever executes that payment method.
        if (s === 'Approved') {
          // A224: one shared owner rule (flow-api.js) instead of a fourth copy of the method list.
          // Telegraphic transfers belong to accounting OR admin, everything else to the director —
          // so admin now sees the wires it is expected to execute, which it never did before.
          const owns = (typeof flowPayOwns === 'function')
            ? flowPayOwns(p.paymentMethod, role)
            : (String(p.paymentMethod || '').trim().toLowerCase() === 'telegraphic transfer'
                ? (isAcct || isAdmin) : isDir);
          if (owns) toPay[t]++;
        }
      });
      const page = t => t === 'Other' ? 'flow-other-payables.html' : 'flow-payment-requests.html';
      const label = t => t === 'Other' ? 'other payable' : 'payment request';
      ['PO', 'Other'].forEach(t => {
        if (waiting[t]) add('report', '#f97316', waiting[t] + ' ' + label(t) + '(s) awaiting your approval', page(t));
        if (toPay[t]) add('urgent', '#ef4444', toPay[t] + ' approved ' + label(t) + '(s) to pay + attach proof', page(t));
      });
    }).catch(() => {}));
  }
  // Accounting: payables past due + receivables past due.
  if (isAcct || isAdmin) {
    jobs.push(fetchFlow('getAPAging').then(r => {
      const n = ((r && r.data) || []).filter(a => String(a.status || '').toLowerCase() !== 'paid' && _pastDue(a.dueDate)).length;
      if (n) add('urgent', '#ef4444', n + ' payable(s) past due', 'flow-ap-aging.html');
    }).catch(() => {}));
    jobs.push(fetchFlow('getARAging').then(r => {
      const n = ((r && r.data) || []).filter(a => String(a.status || '').toLowerCase() !== 'paid' && _pastDue(a.dueDate)).length;
      if (n) add('urgent', '#ef4444', n + ' receivable(s) past due — collect', 'flow-ar-aging.html');
    }).catch(() => {}));
  }
  // Admin/Accounting procurement follow-ups: sales orders with no PO, POs not yet received.
  if (isAdmin || isAcct) {
    jobs.push(Promise.all([
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getReceiving').catch(() => ({ data: [] })),
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
    ]).then(([so, po, rc, iv]) => {
      const hasPO = {}; ((po && po.data) || []).forEach(p => { if (p.soNo) hasPO[String(p.soNo)] = true; });
      const received = {}; ((rc && rc.data) || []).forEach(m => { if (m.poNo) received[String(m.poNo)] = true; });
      const rcSO = {}; ((rc && rc.data) || []).forEach(m => { if (m.soNo) rcSO[String(m.soNo)] = true; });
      const invSO = {}; ((iv && iv.data) || []).forEach(v => { if (v.soNo) invSO[String(v.soNo)] = true; });
      /* A171 — this nudge filtered by nothing at all, so it counted every sales order ever closed.
         On live data it read "96 sales orders with no purchase order yet" of which 93 were already
         Delivered, 92% were over 60 days old and NONE were actionable — the single largest entry in
         her Action Center, and pure noise. An order that is delivered or closed will never need a
         PO, and one nobody has touched in two months is history, not a task. */
      const noPO = ((so && so.data) || []).filter(s =>
        !hasPO[String(s.soNo)] && _actionable(s.status) && !_stale(s.date, 60)).length;
      if (noPO) add('report', '#b45309', noPO + ' sales order(s) with no purchase order yet', 'flow-purchase-orders.html');
      // A171: same treatment — a PO raised a year ago and never received is not this week's work.
      const notRc = ((po && po.data) || []).filter(p =>
        (p.status === 'Approved' || p.status === 'Sent') && !received[String(p.poNo)] && !_stale(p.date, 120)).length;
      if (notRc) add('report', '#b45309', notRc + ' purchase order(s) not received yet', 'flow-receiving.html');
      // A151: received but not yet invoiced — the SO is sitting between delivery and billing.
      const delNotInv = ((so && so.data) || []).filter(s =>
        rcSO[String(s.soNo)] && !invSO[String(s.soNo)] && !_stale(s.date, 120)).length;
      if (delNotInv) add('report', '#b45309', delNotInv + ' received order(s) not yet invoiced', 'flow-lifecycle.html');
    }).catch(() => {}));
  }
  // Sales: my returned pricing requests, my approved/rejected quotations, my sent quotes with no SO.
  if (isSales) {
    jobs.push(fetchFlow('getPricingRequests', { requestedBy: session.name }).then(r => {
      const n = ((r && r.data) || []).filter(p => p.status === 'Returned to Sales').length;
      if (n) add('report', '#22c55e', n + ' pricing request(s) ready to quote (final prices set)', 'flow-pricing-request.html');
    }).catch(() => {}));
    jobs.push(Promise.all([
      fetchFlow('getQuotations', { createdBy: session.name }).catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getQuotationEmails').catch(() => ({ data: [] })),   // A208
      fetchFlow('getFlowSettings').catch(() => ({ data: null })),    // A208
    ]).then(([q, so, le, cf]) => {
      const mine = (q && q.data) || [];
      const rejected = mine.filter(x => x.status === 'Rejected');
      if (rejected.length) add('urgent', '#ef4444', rejected.length + ' quotation(s) rejected — fix & resubmit' + (rejected[0].approvalNote ? ' (' + rejected[0].approvalNote + ')' : ''), 'flow-quotations.html');
      const hasSO = {}; ((so && so.data) || []).forEach(s => { if (s.quotationNo) hasSO[String(s.quotationNo)] = true; });
      const cfg = (cf && cf.data) || null;
      const links = {};
      ((le && le.data) || []).forEach(l => { const k = String(l.quotationNo || ''); if (k) (links[k] = links[k] || []).push(l); });

      /* A208 — these two nudges used to fire the INSTANT a quotation was approved or sent, which
         made them noise: "12 sent quotations with no sales order" on the day you sent them tells
         nobody anything. They now wait for the configured age, so when one appears it is genuinely
         something that has been left. Same two nudges, given a threshold — not four nudges. */
      let notSent = 0, chase = 0, replied = 0, noOrder = 0;
      if (typeof flowFollowUp === 'function') {
        mine.forEach(x => {
          const fu = flowFollowUp(x, links[String(x.quotationNo)] || [], cfg, hasSO);
          if (fu.state === 'not-sent') notSent++;
          else if (fu.state === 'due' || fu.state === 'overdue') chase++;
          else if (fu.state === 'replied') replied++;
          if (typeof flowNoOrderYet === 'function' && flowNoOrderYet(x, cfg, hasSO)) noOrder++;
        });
      } else {
        notSent = mine.filter(x => x.status === 'Approved').length;
        noOrder = mine.filter(x => x.status === 'Sent' && !hasSO[String(x.quotationNo)]).length;
      }
      if (notSent) add('report', '#22c55e', notSent + ' approved quotation(s) still not sent to the client', 'flow-quotations.html');
      if (replied) add('report', '#1d4ed8', replied + ' client repl' + (replied === 1 ? 'y' : 'ies') + ' waiting on you', 'flow-quotations.html');
      if (chase) add('report', '#b45309', chase + ' quotation(s) with no client reply — due a follow-up', 'flow-quotations.html');
      if (noOrder) add('report', '#f97316', noOrder + ' sent quotation(s) still with no sales order', 'flow-sales-orders.html');
    }).catch(() => {}));
  }

  await Promise.all(jobs);
  return items;
}

function _flowActionIconSvg(icon) {
  return icon === 'urgent'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    : icon === 'inventory'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

// A146: the home-page "What needs you" strip. Include auth.js (already global) + call this after load.
async function flowActionsStrip(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const session = getSession();
  if (!session) { el.style.display = 'none'; return; }
  el.innerHTML = '<div style="color:var(--text-muted,#64748b);font-size:0.82rem;padding:0.4rem 0;">Loading your action items…</div>';
  let items = [];
  try { items = await flowComputeActions(session); } catch (e) { items = []; }
  if (!items.length) {
    el.innerHTML = '<div style="display:flex;align-items:center;gap:0.5rem;color:#16a34a;font-size:0.86rem;font-weight:600;"><span>✓</span> You\'re all caught up — nothing needs your action right now.</div>';
    return;
  }
  el.innerHTML = `<div style="display:grid;gap:0.5rem;">${items.map(n => `
    <a href="${n.link}" style="display:flex;align-items:center;gap:0.7rem;padding:0.6rem 0.8rem;text-decoration:none;color:var(--text-primary,#1e293b);border:1px solid var(--border,#e2e8f0);border-radius:10px;background:var(--bg-card,#fff);transition:box-shadow .15s;" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
      <div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${n.color}18;color:${n.color};flex-shrink:0;">${_flowActionIconSvg(n.icon)}</div>
      <span style="font-size:0.86rem;flex:1;">${n.text}</span>
      <span style="color:var(--text-muted,#94a3b8);font-size:0.9rem;">→</span>
    </a>`).join('')}</div>`;
}

async function loadNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;
  list.innerHTML = '<div style="padding:0.75rem 1rem;text-align:center;color:var(--text-muted);">Loading...</div>';

  const session = getSession();
  if (!session) return;
  // Rebuilt on FlowAPI (the old production Code.gs GET bell 404'd for every role). Pages without
  // flow-api.js show "No notifications" — no failing network calls. Shared with the home strip.
  let notifications = [];
  try { notifications = await flowComputeActions(session); } catch (e) { notifications = []; }

  // Update badge
  const badge = document.getElementById('notifBadge');
  if (badge) {
    if (notifications.length > 0) {
      badge.style.display = 'flex';
      badge.textContent = notifications.length;
    } else {
      badge.style.display = 'none';
    }
  }

  // Render
  if (notifications.length === 0) {
    list.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted);">No notifications</div>';
    return;
  }

  list.innerHTML = notifications.map(n => {
    const iconSvg = n.icon === 'urgent'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      : n.icon === 'inventory'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    return `<a href="${n.link}" style="display:flex;align-items:center;gap:0.6rem;padding:0.6rem 1rem;text-decoration:none;color:var(--text-secondary);border-bottom:1px solid #e2e8f0;transition:background 0.15s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='transparent'">
      <div style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${n.color}15;color:${n.color};flex-shrink:0;">${iconSvg}</div>
      <span>${n.text}</span>
    </a>`;
  }).join('');
}

// Auto-load notification badge count on page load
setTimeout(() => { loadNotifications(); }, 2000);

async function _showMemoModalsIfNeeded() {
  try {
    const session = getSession();
    if (!session || !session.name) return;
    const today = new Date().toISOString().slice(0, 10);
    const checkKey = 'lastMemoCheckDate_' + session.name;
    if (localStorage.getItem(checkKey) === today) return;
    if (typeof apiGetActiveMemosForUser !== 'function') return;
    const res = await apiGetActiveMemosForUser(session.name, session.role);
    if (!res || !res.success || !Array.isArray(res.data) || res.data.length === 0) {
      localStorage.setItem(checkKey, today);
      return;
    }
    const dismissedKey = 'dismissedMemos_' + session.name;
    let dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem(dismissedKey) || '[]'); } catch (e) { dismissed = []; }
    const queue = res.data.filter(m => dismissed.indexOf(m.rowIndex) === -1);
    if (queue.length === 0) { localStorage.setItem(checkKey, today); return; }
    _renderMemoQueue(queue, 0, dismissed, dismissedKey, checkKey, today);
  } catch (e) { /* ignore */ }
}

function _renderMemoQueue(queue, idx, dismissed, dismissedKey, checkKey, today) {
  if (idx >= queue.length) {
    localStorage.setItem(checkKey, today);
    localStorage.setItem(dismissedKey, JSON.stringify(dismissed));
    return;
  }
  const memo = queue[idx];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  const card = document.createElement('div');
  card.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:12px;max-width:560px;width:100%;padding:1.5rem;color:#f1f5f9;box-shadow:0 20px 40px rgba(0,0,0,0.5);';
  const priorityColor = (memo.priority || '').toLowerCase() === 'urgent' ? '#ef4444' :
                        (memo.priority || '').toLowerCase() === 'high' ? '#f97316' : '#3b82f6';
  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
      <span style="background:${priorityColor}20;color:${priorityColor};font-size:0.7rem;font-weight:600;padding:0.2rem 0.55rem;border-radius:4px;text-transform:uppercase;letter-spacing:0.04em;">${(memo.priority || 'Normal')}</span>
      <span style="color:#64748b;font-size:0.75rem;">${memo.type || 'Memo'} · ${memo.createdAt || ''}</span>
      <span style="margin-left:auto;color:#64748b;font-size:0.75rem;">${idx+1} / ${queue.length}</span>
    </div>
    <h3 style="margin:0 0 0.5rem 0;font-size:1.15rem;">${(memo.title || '').replace(/</g,'&lt;')}</h3>
    <div style="color:#cbd5e1;font-size:0.9rem;line-height:1.5;margin-bottom:0.5rem;white-space:pre-wrap;">${(memo.content || '').replace(/</g,'&lt;')}</div>
    <div style="font-size:0.75rem;color:#64748b;margin-bottom:1rem;">From: ${memo.createdBy || 'HR'} · For: ${memo.target || 'All'}</div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
      <button id="memoDismissBtn" style="background:#3b82f6;color:#fff;border:none;padding:0.5rem 1rem;border-radius:6px;font-weight:600;cursor:pointer;">Mark as Read</button>
    </div>
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  card.querySelector('#memoDismissBtn').addEventListener('click', () => {
    dismissed.push(memo.rowIndex);
    overlay.remove();
    _renderMemoQueue(queue, idx + 1, dismissed, dismissedKey, checkKey, today);
  });
}

setTimeout(() => { _showMemoModalsIfNeeded(); }, 2500);
