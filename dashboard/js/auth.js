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
 * Require inventory access — sales can add/edit (delete is hidden for sales in the UI);
 * admin & accounting retain full access including delete.
 */
function requireInventoryAccess() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  if (!['admin', 'accounting', 'sales'].includes(session.role)) {
    window.location.href = _homeForRole(session.role);
    return null;
  }
  return session;
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
      <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        Inventory
      </a>
      <a href="marketing-home.html" class="${activePage === 'marketing-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        Marketing
      </a>
      <div class="nav-dropdown">
        <button class="nav-dropdown-btn ${(activePage || '').indexOf('flow') === 0 ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
          Process Flow
          <svg class="dd-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-dropdown-menu">
          <a href="flow-home.html" class="${activePage === 'flow-home' ? 'active' : ''}">Overview</a>
          <a href="flow-accounting.html" class="${activePage === 'flow-accounting' ? 'active' : ''}">Accounting</a>
          <a href="flow-pricing-request.html" class="${activePage === 'flow-pricing-request' ? 'active' : ''}">Purchase Requests</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotations</a>
          <a href="flow-sales-orders.html" class="${activePage === 'flow-sales-orders' ? 'active' : ''}">Sales Orders</a>
          <a href="migrate-sales-orders.html" class="${activePage === 'migrate-sales-orders' ? 'active' : ''}">Migrate Sales Orders</a>
          <a href="migrate-collections.html" class="${activePage === 'migrate-collections' ? 'active' : ''}">Migrate Collections</a>
          <a href="flow-purchase-orders.html" class="${activePage === 'flow-purchase-orders' ? 'active' : ''}">Purchase Orders</a>
          <a href="flow-ap-aging.html" class="${activePage === 'flow-ap-aging' ? 'active' : ''}">AP Aging</a>
          <a href="flow-receiving.html" class="${activePage === 'flow-receiving' ? 'active' : ''}">Materials Receiving</a>
          <a href="flow-invoices.html" class="${activePage === 'flow-invoices' ? 'active' : ''}">Invoices</a>
          <a href="flow-ar-aging.html" class="${activePage === 'flow-ar-aging' ? 'active' : ''}">AR Aging</a>
          <a href="flow-collections.html" class="${activePage === 'flow-collections' ? 'active' : ''}">Collections</a>
          <a href="flow-expenses.html" class="${activePage === 'flow-expenses' ? 'active' : ''}">Expenses</a>
          <a href="migrate-expenses.html" class="${activePage === 'migrate-expenses' ? 'active' : ''}">Migrate Expenses</a>
          <a href="flow-ledger.html" class="${activePage === 'flow-ledger' ? 'active' : ''}">General Ledger</a>
          <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">Accounting Summary</a>
          <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">All Daily Reports</a>
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
    const flowActive = (activePage || '').indexOf('flow') === 0;
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
          <a href="flow-accounting.html" class="${activePage === 'flow-accounting' ? 'active' : ''}">Accounting</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotations</a>
          <a href="flow-sales-orders.html" class="${activePage === 'flow-sales-orders' ? 'active' : ''}">Sales Orders</a>
          <a href="migrate-sales-orders.html" class="${activePage === 'migrate-sales-orders' ? 'active' : ''}">Migrate Sales Orders</a>
          <a href="migrate-collections.html" class="${activePage === 'migrate-collections' ? 'active' : ''}">Migrate Collections</a>
          <a href="flow-purchase-orders.html" class="${activePage === 'flow-purchase-orders' ? 'active' : ''}">Purchase Orders</a>
          <a href="flow-ap-aging.html" class="${activePage === 'flow-ap-aging' ? 'active' : ''}">AP Aging</a>
          <a href="flow-receiving.html" class="${activePage === 'flow-receiving' ? 'active' : ''}">Receiving</a>
          <a href="flow-invoices.html" class="${activePage === 'flow-invoices' ? 'active' : ''}">Invoices</a>
          <a href="flow-ar-aging.html" class="${activePage === 'flow-ar-aging' ? 'active' : ''}">AR Aging</a>
          <a href="flow-collections.html" class="${activePage === 'flow-collections' ? 'active' : ''}">Collections</a>
          <a href="flow-expenses.html" class="${activePage === 'flow-expenses' ? 'active' : ''}">Expenses</a>
          <a href="migrate-expenses.html" class="${activePage === 'migrate-expenses' ? 'active' : ''}">Migrate Expenses</a>
          <a href="flow-ledger.html" class="${activePage === 'flow-ledger' ? 'active' : ''}">General Ledger</a>
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
    navLinks = `
      <a href="management-home.html" class="${activePage === 'management-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Home
      </a>
      <a href="quotation-approvals.html" class="${activePage === 'quotation-approvals' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Quotation Approvals
      </a>
      <a href="pricing.html" class="${activePage === 'pricing' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Pricing Engine
      </a>
      <a href="flow-pricing-request.html" class="${activePage === 'flow-pricing-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        Pricing Requests
      </a>
      <a href="po-approvals.html" class="${activePage === 'po-approvals' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        PO Approvals
      </a>
      <a href="management-sales-orders.html" class="${activePage === 'management-sales-orders' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        Sales Orders
      </a>
      <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Daily Reports
      </a>
      <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Accounting Summary
      </a>
      <a href="payment-requests.html" class="${activePage === 'payment-requests' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Payment Requests
      </a>
      <a href="management-leave.html" class="${activePage === 'management-leave' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Leave Approvals
      </a>
      <a href="marketing-home.html" class="${activePage === 'marketing-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        Marketing
      </a>
      <a href="leave-request.html" class="${activePage === 'leave-request' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Request Leave
      </a>
      <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Change Password
      </a>`;
  } else if (session.role === 'director') {
    navLinks = `
      <a href="director-home.html" class="${activePage === 'director-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Payroll Home
      </a>
      <a href="payment-requests.html" class="${activePage === 'payment-requests' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        Payment Requests
      </a>
      <a href="director-banks.html" class="${activePage === 'director-banks' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg>
        Bank Accounts
      </a>
      <a href="director-sales-orders.html" class="${activePage === 'director-sales-orders' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        Sales Orders
      </a>
      <a href="accounting-summary.html" class="${activePage === 'accounting-summary' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Accounting Summary
      </a>
      <a href="all-daily-reports.html" class="${activePage === 'all-daily-reports' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Daily Reports
      </a>
      <a href="director-duties.html" class="${activePage === 'director-duties' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        VAT &amp; Duties
      </a>
      <a href="director-expenses.html" class="${activePage === 'director-expenses' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Expenses
      </a>
      <a href="director-payables.html" class="${activePage === 'director-payables' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="1" y1="10" x2="23" y2="10"/><circle cx="7" cy="15" r="1"/></svg>
        My Payables
      </a>
      <a href="marketing-home.html" class="${activePage === 'marketing-home' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        Marketing
      </a>
      <a href="director-emails.html" class="${activePage === 'director-emails' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>
        Email
      </a>
      <a href="email-setup.html" class="${activePage === 'email-setup' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 8l8 5 8-5"/><circle cx="18" cy="6" r="3" fill="currentColor" stroke="none"/></svg>
        Connect Email
      </a>
      <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Change Password
      </a>`;
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
      <a href="hr-analytics.html" class="${activePage === 'hr-analytics' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Analytics
      </a>
      <a href="change-password.html" class="${activePage === 'change-password' ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Change Password
      </a>`;
  } else {
    const workActive = ['flow-pricing-request', 'flow-quotations', 'flow-inventory'].includes(activePage);
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
          <a href="flow-pricing-request.html" class="${activePage === 'flow-pricing-request' ? 'active' : ''}">Purchase Requests</a>
          <a href="flow-quotations.html" class="${activePage === 'flow-quotations' ? 'active' : ''}">Quotations</a>
          <a href="flow-inventory.html" class="${activePage === 'flow-inventory' ? 'active' : ''}">Inventory</a>
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

async function loadNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;
  list.innerHTML = '<div style="padding:0.75rem 1rem;text-align:center;color:var(--text-muted);">Loading...</div>';

  const session = getSession();
  if (!session) return;
  const notifications = [];

  try {
    if (session.role === 'admin') {
      // Check for agents who haven't submitted reports today
      const reportResult = await fetchFromAPI({ action: 'getDailyReports', date: new Date().toISOString().slice(0, 10) });
      if (reportResult.success && reportResult.data) {
        const notSubmitted = reportResult.data.filter(r => !r.submitted);
        if (notSubmitted.length > 0) {
          notifications.push({
            icon: 'report',
            color: '#f97316',
            text: notSubmitted.length + ' agent(s) haven\'t submitted daily reports',
            link: 'admin-reports.html'
          });
        }
        // Urgent issues
        const urgent = reportResult.data.filter(r => r.submitted && r.urgentIssues && r.urgentIssues.length > 0);
        urgent.forEach(r => {
          notifications.push({
            icon: 'urgent',
            color: '#ef4444',
            text: r.agentName + ' reported ' + r.urgentIssues.length + ' urgent issue(s)',
            link: 'admin-reports.html'
          });
        });
      }

      // Check inventory low stock
      try {
        const invResult = await fetchFromAPI({ action: 'getInventory' });
        if (invResult.success && invResult.data) {
          const lowStock = invResult.data.filter(i => i.qty < 10);
          if (lowStock.length > 0) {
            notifications.push({
              icon: 'inventory',
              color: '#ef4444',
              text: lowStock.length + ' item(s) with low stock',
              link: 'flow-inventory.html'
            });
          }
        }
      } catch (e) { /* inventory may not exist yet */ }
    }

    if (session.role === 'management') {
      try {
        const invResult = await fetchFromAPI({ action: 'getInventory' });
        if (invResult.success && invResult.data) {
          const lowStock = invResult.data.filter(i => i.qty < 10);
          if (lowStock.length > 0) {
            notifications.push({
              icon: 'inventory',
              color: '#ef4444',
              text: lowStock.length + ' item(s) with low stock',
              link: 'management-home.html'
            });
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (session.role === 'sales') {
      // Check overdue follow-ups
      const sheetIds = { quotationSheetId: session.quotationSheetId || '' };
      const tracker = await fetchFromAPI({ action: 'getClientTracker', agentName: session.name, ...sheetIds });
      if (tracker.success && tracker.data) {
        const today = new Date().toISOString().slice(0, 10);
        const overdue = tracker.data.filter(d => d.followUpDate && d.followUpDate < today && d.status === 'Pending');
        if (overdue.length > 0) {
          notifications.push({
            icon: 'urgent',
            color: '#ef4444',
            text: overdue.length + ' overdue follow-up(s) need attention',
            link: 'performance.html'
          });
        }
      }

      // Check if daily report submitted
      const counts = await fetchFromAPI({ action: 'getTodayCounts', agentName: session.name, quotationSheetId: session.quotationSheetId || '', prSheetId: session.prSheetId || '' });
      if (counts.success && !counts.alreadySubmitted) {
        notifications.push({
          icon: 'report',
          color: '#f97316',
          text: 'You haven\'t submitted today\'s daily report',
          link: 'report.html'
        });
      }

      // Check quotation approval status changes
      try {
        const qNotifs = await fetchFromAPI({ action: 'getMyQuotationNotifications', agentName: session.name, quotationSheetId: session.quotationSheetId || '' });
        if (qNotifs.success && qNotifs.data) {
          const lastSeen = localStorage.getItem('lastSeenQuotationNotif') || '';
          const approved = qNotifs.data.filter(q => q.status === 'Approved' && q.date > lastSeen);
          const rejected = qNotifs.data.filter(q => q.status === 'Rejected' && q.date > lastSeen);
          if (approved.length > 0) {
            notifications.push({
              icon: 'report',
              color: '#22c55e',
              text: approved.length + ' quotation(s) approved',
              link: 'performance.html'
            });
          }
          if (rejected.length > 0) {
            notifications.push({
              icon: 'urgent',
              color: '#ef4444',
              text: rejected.length + ' quotation(s) rejected' + (rejected[0].rejectionReason ? ' — ' + rejected[0].rejectionReason : ''),
              link: 'performance.html'
            });
          }
          // Update last seen to today
          if (qNotifs.data.length > 0) {
            localStorage.setItem('lastSeenQuotationNotif', new Date().toISOString().slice(0, 10));
          }
        }
      } catch (e) { /* ignore */ }
    }

    // Persistent notifications for all roles
    try {
      const persNotifs = await fetchFromAPI({ action: 'getMyNotifications', username: session.name, role: session.role });
      if (persNotifs.success && persNotifs.data) {
        persNotifs.data.forEach(n => {
          notifications.push({
            icon: n.type.includes('rejected') || n.type.includes('Rejected') ? 'urgent' : 'report',
            color: n.type.includes('rejected') || n.type.includes('Rejected') ? '#ef4444' : '#22c55e',
            text: n.title + ': ' + n.message,
            link: n.link || '#'
          });
        });
      }
      if (persNotifs.success && persNotifs.data && persNotifs.data.length > 0) {
        fetchFromAPI({ action: 'markNotificationsRead', username: session.name });
      }
    } catch (e) { /* ignore */ }
  } catch (e) {
    notifications.push({ icon: 'error', color: '#64748b', text: 'Could not load notifications', link: '#' });
  }

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
