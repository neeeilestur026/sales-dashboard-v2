/* ledger-nav.js — A336 · the "Ledger" bar and rail, for every office role.
 *
 * Only used while theme.js has switched the Ledger look on (window.hxSkinOn); auth.js's renderNavbar
 * hands over to ledgerNavbar() and the classic navbar code never runs, so the classic look stays
 * byte-identical. Each role keeps every page its classic navbar links, plus the pages it could only
 * reach from its own home page (tests/flow/ledger-contract.js computes both live from auth.js and
 * fails on a missing or an extra link). The flow tab strip stays on the flow pages, so nothing that
 * was reachable from it goes away.
 *
 * A section is [label, icon, target]: a target string goes straight to that page, a list opens a
 * flyout. Personal pages live in the avatar menu (LEDGER_ME). Icons are the portal's own
 * Feather-style strokes, so the two looks share one icon family. */
const LEDGER_ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',   // A340
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  check: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  clip: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  bag: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/>',   // A344 — the Apple look's drawer button
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
};

const LEDGER_NAV = {
  admin: [
    ['Home', 'home', 'admin.html'],
    ['Sell', 'cart', [['website-requests.html', 'Website requests'], ['product-finder.html', 'Product finder'], ['flow-pricing-request.html', 'Purchase requests'], ['purchase-request-tracker.html', 'PR tracker'], ['flow-quotations.html', 'Quotations'], ['quotation-board.html', 'Quotation board'], ['quotation-status.html', 'Quotation status'], ['admin-import-quotation.html', 'Import quotation'], ['flow-sales-orders.html', 'Sales orders'], ['flow-lifecycle.html', 'SO lifecycle']]],
    ['Clients', 'users', [['clients.html', 'Client list'], ['flow-clients.html', 'Client master'], ['client-tracker.html', 'Client tracker'], ['admin-targets.html', 'Sales targets'], ['marketing-home.html', 'Marketing'], ['leadgen-home.html', 'Lead gen']]],
    ['Buy & pay', 'card', [['supplier-list.html', 'Supplier list'], ['flow-purchase-orders.html', 'Purchase orders'], ['flow-payment-requests.html', 'Payment requests'], ['payment-requests.html', 'Sales payment requests'], ['flow-ap-aging.html', 'AP aging'], ['ap-aging-monthly.html', 'Monthly AP aging'], ['flow-payments.html', 'Payment register'], ['flow-other-payables.html', 'Other payables'], ['flow-suppliers.html', 'Suppliers']]],   // A374 — the supplier list first
    ['Stock', 'box', [['flow-receiving.html', 'Materials receiving'], ['flow-inventory.html', 'Inventory'], ['flow-shipments.html', 'Shipments'], ['scan.html', 'Scanner']]],
    ['Collect', 'inbox', [['flow-invoices.html', 'Invoices'], ['flow-ar-aging.html', 'AR aging'], ['flow-collections.html', 'Collections'], ['month-check.html', 'Month check']]],
    ['Books', 'book', [['flow-accounting.html', 'Accounting'], ['flow-expenses.html', 'Expenses'], ['flow-ledger.html', 'General ledger'], ['books.html', 'Books'], ['payroll-books.html', 'Payroll in the books'], ['accounting-summary.html', 'Accounting summary'], ['balance-sheet.html', 'Balance sheet']]],
    ['Team', 'chart', [['admin-summary.html', 'Summary'], ['admin-team.html', 'Team'], ['admin-reports.html', 'Reports'], ['all-daily-reports.html', 'All daily reports'], ['admin-daily-report.html', 'Admin daily report'], ['my-daily-report.html', 'New daily report'], ['team-performance.html', 'Team performance']]],
    ['Guide', 'compass', [['flow-home.html', 'Process overview'], ['flow-guide.html', 'Process guide']]],
    ['System', 'sliders', [['admin-users.html', 'User management'], ['admin-login-log.html', 'Login log']]]
  ],
  director: [
    ['Home', 'home', 'director-home.html'],
    ['Pricing', 'tag', 'director-pricing-engine.html'],   // A340 — the standalone pricing engine
    ['Client Book', 'book', 'director-client-book.html'],   // A350 — the Client Book trial
    ['Quotes', 'file', [['website-requests.html', 'Website requests'], ['flow-quotations.html', 'All quotations'], ['quotation-board.html', 'Quotation board'], ['quotation-status.html', 'Quotation status'], ['client-tracker.html', 'Client tracker'], ['flow-purchase-orders.html', 'Purchase orders'], ['product-finder.html', 'Product finder']]],
    ['Payables', 'card', [['supplier-list.html', 'Supplier list'], ['flow-payment-requests.html', 'Payment requests'], ['flow-other-payables.html', 'Other payables'], ['flow-payments.html', 'Payment register'], ['director-expenses.html', 'Expenses'], ['flow-travel.html', 'Travel allowance'], ['commission-payout-report.html', 'Commissions for payroll'], ['commission-rates.html', 'Commission rates']]],
    ['Reports', 'chart', [['director-sales-orders.html', 'Sales orders'], ['accounting-summary.html', 'Accounting summary'], ['balance-sheet.html', 'Balance sheet'], ['books.html', 'Books'], ['payroll-books.html', 'Payroll in the books'], ['ap-aging-monthly.html', 'Monthly AP aging'], ['month-check.html', 'Month check']]],
    ['Team', 'users', [['all-daily-reports.html', 'Daily reports'], ['team-daily-reports.html', 'New daily reports'], ['client-visits.html', 'Client visits'], ['management-itinerary.html', 'Weekly itineraries'], ['team-performance.html', 'Team performance']]],   // A366 · A369
    ['Tools', 'tool', [['director-emails.html', 'Email'], ['pf-admin.html', 'Product finder data'], ['scan.html', 'Scanner'], ['collect.html', 'Collect']]]
  ],
  accounting: [
    ['Home', 'home', 'accounting-home.html'],
    ['Collect', 'inbox', [['flow-invoices.html', 'Invoices'], ['accounting-billing.html', 'Billing'], ['flow-ar-aging.html', 'AR aging'], ['flow-collections.html', 'Collections'], ['month-check.html', 'Month check'], ['flow-clients.html', 'Client master']]],
    ['Pay', 'card', [['flow-payment-requests.html', 'Payment requests'], ['payment-requests.html', 'Sales payment requests'], ['flow-purchase-orders.html', 'Purchase orders'], ['flow-ap-aging.html', 'AP aging'], ['ap-aging-monthly.html', 'Monthly AP aging'], ['flow-payments.html', 'Payment register'], ['flow-other-payables.html', 'Other payables'], ['flow-travel.html', 'Travel allowance'], ['client-visits.html', 'Client visits'], ['flow-suppliers.html', 'Suppliers']]],   // A369
    ['Books', 'book', [['flow-accounting.html', 'Accounting'], ['flow-expenses.html', 'Expenses'], ['flow-ledger.html', 'General ledger'], ['books.html', 'Books'], ['payroll-books.html', 'Payroll in the books'], ['accounting-summary.html', 'Accounting summary'], ['financial-reports.html', 'Financial reports'], ['balance-sheet.html', 'Balance sheet']]],
    ['Orders', 'cart', [['flow-quotations.html', 'Quotations'], ['quotation-board.html', 'Quotation board'], ['client-tracker.html', 'Client tracker'], ['flow-sales-orders.html', 'Sales orders'], ['management-sales-orders.html', 'All sales orders'], ['flow-lifecycle.html', 'SO lifecycle']]],
    ['Stock', 'box', [['flow-receiving.html', 'Receiving'], ['flow-inventory.html', 'Inventory'], ['flow-shipments.html', 'Shipments'], ['scan.html', 'Scanner']]],
    ['Reports', 'clip', [['accounting-daily-report.html', 'My daily report'], ['my-daily-report.html', 'New daily report'], ['all-daily-reports.html', 'All daily reports'], ['flow-guide.html', 'Process guide']]]
  ],
  management: [
    ['Home', 'home', 'management-home.html'],
    ['Approvals', 'check', [['flow-quotations.html', 'Quotation approvals'], ['flow-purchase-orders.html', 'PO approvals'], ['flow-payment-requests.html', 'Payment requests'], ['flow-other-payables.html', 'Other payables'], ['flow-pricing-request.html', 'Pricing requests'], ['purchase-request-tracker.html', 'PR tracker'], ['management-leave.html', 'Leave approvals']]],
    ['Sell', 'cart', [['quotation-board.html', 'Quotation board'], ['quotation-status.html', 'Quotation status'], ['client-tracker.html', 'Client tracker'], ['flow-sales-orders.html', 'Sales orders, operations'], ['management-sales-orders.html', 'Sales orders, all'], ['flow-lifecycle.html', 'SO lifecycle'], ['flow-clients.html', 'Client master']]],
    ['Money', 'trend', [['flow-invoices.html', 'Invoices'], ['flow-collections.html', 'Collections'], ['flow-ar-aging.html', 'AR aging'], ['month-check.html', 'Month check'], ['flow-ap-aging.html', 'AP aging'], ['ap-aging-monthly.html', 'Monthly AP aging'], ['flow-payments.html', 'Payment register'], ['flow-travel.html', 'Travel allowance'], ['commission-payout-report.html', 'Sales commissions']]],
    ['Books', 'book', [['flow-accounting.html', 'Accounting'], ['flow-expenses.html', 'Expenses'], ['flow-ledger.html', 'General ledger'], ['books.html', 'Books'], ['payroll-books.html', 'Payroll in the books'], ['accounting-summary.html', 'Accounting summary'], ['balance-sheet.html', 'Balance sheet']]],
    ['Stock', 'box', [['flow-receiving.html', 'Materials receiving'], ['flow-inventory.html', 'Inventory'], ['flow-shipments.html', 'Shipments'], ['flow-suppliers.html', 'Suppliers']]],
    ['Team', 'users', [['all-daily-reports.html', 'Daily reports'], ['team-daily-reports.html', 'New daily reports'], ['team-performance.html', 'Team performance'], ['client-visits.html', 'Client visits'], ['management-itinerary.html', 'Weekly itineraries'], ['marketing-home.html', 'Marketing'], ['leadgen-home.html', 'Lead gen']]],   // A366 · A369
    ['Guide', 'compass', [['flow-home.html', 'Process overview'], ['flow-guide.html', 'Process guide']]]
  ],
  sales: [
    ['Home', 'home', 'dashboard.html'],
    ['Quote', 'file', [['product-finder.html', 'Product finder'], ['flow-pricing-request.html', 'Purchase requests'], ['purchase-request-tracker.html', 'PR tracker'], ['flow-quotations.html', 'Quotations'], ['quotation-board.html', 'Quotation board'], ['quotation-status.html', 'My quotations'], ['flow-inventory.html', 'Inventory']]],
    ['Clients', 'users', [['clients.html', 'Client list'], ['director-client-book.html', 'Client Book'], ['performance.html', 'My client tracker'], ['client-tracker.html', 'Client tracker'], ['pending-items.html', 'Pending items'], ['quotation-summary.html', 'Quotation summary']]],   // A358 — the Client Book
    ['Field', 'pin', [['client-visits.html', 'Client visits'], ['weekly-itinerary.html', 'Weekly itinerary'], ['flow-travel.html', 'Travel allowance'], ['flow-commissions.html', 'Commission requests'], ['sales-emails.html', 'My emails']]],   // A369 — client visits, the new itinerary
    ['Reports', 'clip', [['report.html', 'Daily report'], ['my-daily-report.html', 'New daily report'], ['my-reports.html', 'My reports']]],
    ['Guide', 'compass', 'flow-guide.html']
  ],
  marketing: [
    ['Home', 'home', 'marketing-home.html'],
    ['Report', 'clip', 'marketing-daily-report.html']
  ],
  leadgen: [
    ['Home', 'home', 'leadgen-home.html'],
    ['Report', 'clip', 'leadgen-daily-report.html'],
    ['New report', 'clip', 'my-daily-report.html'],   // A363 — the new daily report, beside the old one
    ['Quotes', 'file', [['flow-pricing-request.html', 'Purchase requests'], ['purchase-request-tracker.html', 'PR tracker'], ['flow-quotations.html', 'Quotations'], ['quotation-board.html', 'Quotation board']]]
  ],
  hr: [
    ['Home', 'home', 'hr-home.html'],
    ['People', 'users', [['hr-employees.html', 'Employees'], ['hr-recruitment.html', 'Recruitment'], ['hr-reviews.html', 'Reviews'], ['hr-accreditations.html', 'Accreditations'], ['hr-training.html', 'Training'], ['hr-grievances.html', 'Grievances']]],
    ['Leave', 'cal', 'hr-leave.html'],
    ['Work', 'bag', [['hr-tasks.html', 'Tasks'], ['hr-daily-report.html', 'Daily report'], ['hr-memos.html', 'Memos']]],
    ['Content', 'pen', [['hr-campaigns.html', 'Campaigns'], ['hr-content-calendar.html', 'Content calendar']]],
    ['Reports', 'chart', [['team-performance.html', 'Team performance'], ['hr-analytics.html', 'Analytics'], ['payroll-books.html', 'Contribution tables']]]
  ]
};

const LEDGER_ME = {
  admin: [['leave-request.html', 'Leave request'], ['my-payslips.html', 'My payslips'], ['email-setup.html', 'Email setup'], ['change-password.html', 'Change password']],
  director: [['email-setup.html', 'Connect email'], ['change-password.html', 'Change password']],
  accounting: [['leave-request.html', 'Leave request'], ['my-payslips.html', 'My payslips'], ['email-setup.html', 'Email setup'], ['change-password.html', 'Change password']],
  management: [['leave-request.html', 'Request leave'], ['change-password.html', 'Change password']],
  sales: [['leave-request.html', 'Leave request'], ['my-payslips.html', 'My payslips'], ['email-setup.html', 'Connect email'], ['change-password.html', 'Change password']],
  marketing: [['leave-request.html', 'Leave request'], ['my-payslips.html', 'My payslips'], ['email-setup.html', 'Email setup'], ['change-password.html', 'Change password']],
  leadgen: [['leave-request.html', 'Leave request'], ['my-payslips.html', 'My payslips'], ['email-setup.html', 'Email setup'], ['change-password.html', 'Change password']],
  hr: [['leave-request.html', 'Request leave'], ['my-payslips.html', 'My payslips'], ['change-password.html', 'Change password']]
};

const LEDGER_ROLE_NAMES = { admin: 'Admin', director: 'Director', accounting: 'Accounting', management: 'Management', sales: 'Sales', marketing: 'Marketing', leadgen: 'Lead generation', hr: 'HR' };

function _lgIcon(name) {
  return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (LEDGER_ICONS[name] || '') + '</svg>';
}
function _lgEsc(s) { return hxEsc(s); }   // api.js loads before auth.js and this file on every page
/* the commission pages still carry their SOON tag for the roles they are not open to (A209/A211) */
function _lgLabel(href, label, role) {
  const soon = href === 'flow-commissions.html' && typeof flowCommissionsLiveFor === 'function' && !flowCommissionsLiveFor(role) && typeof flowSoonTag === 'function';
  return _lgEsc(label) + (soon ? flowSoonTag() : '');
}

/* Every page of a role, in order, with its section: the rail's sections, then the avatar menu. */
function ledgerPages(role) {
  const out = [];
  (LEDGER_NAV[role] || []).forEach(([sec, , t]) => {
    if (typeof t === 'string') out.push({ href: t, label: sec, group: sec });
    else t.forEach(([href, label]) => out.push({ href, label, group: sec }));
  });
  (LEDGER_ME[role] || []).forEach(([href, label]) => out.push({ href, label, group: 'Me' }));
  return out;
}

/* Draws the Ledger bar and rail into the navbar; false (and nothing drawn) for a role without a rail,
   so auth.js falls back to the classic navbar. */
function ledgerNavbar(nav, session, initials) {
  if (!LEDGER_NAV[session.role]) return false;
  const _de = document.documentElement;
  if (_de && typeof _de.getAttribute === 'function' && _de.getAttribute('data-look') === 'apple') return appleNavbar(nav, session, initials);   // A344
  const role = session.role, secs = LEDGER_NAV[role], here = (location.pathname.split('/').pop() || '').toLowerCase();
  const pages = ledgerPages(role), cur = pages.find(p => p.href === here) || null;
  window.hxSkinPages = pages;
  const home = (secs[0] && typeof secs[0][2] === 'string') ? secs[0][2] : 'index.html';
  const isCur = (t) => typeof t === 'string' ? t === here : t.some(([h]) => h === here);
  const rail = secs.map(([label, icon, t], i) => {
    const on = isCur(t) ? ' aria-current="page"' : '';
    return typeof t === 'string'
      ? `<a class="l-sec" href="${t}"${on}>${_lgIcon(icon)}<span>${_lgEsc(label)}</span></a>`
      : `<button type="button" class="l-sec" data-l-sec="${i}" aria-haspopup="menu" aria-expanded="false"${on}>${_lgIcon(icon)}<span>${_lgEsc(label)}</span></button>`;
  }).join('');
  const crumbs = !cur ? '' : cur.group === cur.label || cur.href === home ? `<b>${_lgEsc(cur.label)}</b>` : `${_lgEsc(cur.group)}<span aria-hidden="true">›</span><b>${_lgEsc(cur.label)}</b>`;
  const me = (LEDGER_ME[role] || []).map(([h, l]) => `<a role="menuitem" href="${h}"${h === here ? ' aria-current="page"' : ''}>${_lgEsc(l)}</a>`).join('');
  const looks = typeof hxSkinLookItems === 'function' ? hxSkinLookItems() : '';

  nav.innerHTML = `
    <a class="l-brand" href="${home}"><img src="images/logo-nav-2x.png" alt="Hi-Escorp" width="224" height="56"></a>
    <nav class="l-crumbs" aria-label="You are here">${crumbs}</nav>
    <button type="button" class="l-search" data-l-search aria-label="Search pages">${_lgIcon('search')}<span>Search pages</span><kbd>Ctrl K</kbd></button>
    <div class="navbar-user l-tools">
      <button type="button" class="theme-toggle nav-theme" id="navThemeToggle" aria-pressed="false" aria-label="Dark theme"><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span>Dark</span></button>
      <div class="notif-bell" id="notifBell" onclick="toggleNotifDropdown()" title="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="notif-badge" id="notifBadge" style="display:none;"></span>
      </div>
      <div class="notif-dropdown" id="notifDropdown" style="display:none;">
        <div class="notif-head">Notifications</div>
        <div class="notif-list" id="notifList"><div class="notif-empty">Loading...</div></div>
      </div>
      <div class="l-me">
        <button type="button" class="l-me-btn" aria-haspopup="menu" aria-expanded="false"><span class="l-av">${_lgEsc(initials)}</span><span class="l-who">${_lgEsc(session.name)}<small>${LEDGER_ROLE_NAMES[role] || ''}</small></span></button>
        <div class="l-menu" role="menu" hidden>${me}${looks}<button type="button" role="menuitem" class="l-out" onclick="logout()">${_lgIcon('out')}Log out</button></div>
      </div>
    </div>
    <nav class="l-rail" aria-label="Main">${rail}<button type="button" class="l-sec l-more-btn" data-l-more aria-haspopup="menu" aria-expanded="false">${_lgIcon('more')}<span>More</span></button></nav>
    <div class="l-fly" role="menu" hidden></div>`;
  _lgWire(nav, secs, here, role);
  return true;
}

function _lgWire(nav, secs, here, role) {
  const fly = nav.querySelector('.l-fly'), menu = nav.querySelector('.l-menu'), meBtn = nav.querySelector('.l-me-btn');
  let opener = null;
  const links = (t) => t.map(([h, l]) => `<a role="menuitem" href="${h}"${h === here ? ' aria-current="page"' : ''}>${_lgLabel(h, l, role)}</a>`).join('');
  function close(back) {
    if (!fly.hidden) { fly.hidden = true; fly.innerHTML = ''; }
    nav.querySelectorAll('[data-l-sec][aria-expanded="true"],[data-l-more][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (back && opener) opener.focus();
    opener = null;
  }
  function open(btn, html, title) {
    close(false);
    opener = btn;
    btn.setAttribute('aria-expanded', 'true');
    fly.innerHTML = `<div class="l-fly-h">${_lgEsc(title)}</div>${html}`;
    fly.style.setProperty('--l-fly-top', Math.max(72, btn.getBoundingClientRect().top) + 'px');
    fly.hidden = false;
    const first = fly.querySelector('a');
    if (first) first.focus();
  }
  nav.querySelectorAll('[data-l-sec]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.getAttribute('aria-expanded') === 'true') return close(true);
    const [label, , t] = secs[+btn.dataset.lSec];
    open(btn, links(t), label);
  }));
  const more = nav.querySelector('[data-l-more]');
  if (more) more.addEventListener('click', (e) => {
    e.stopPropagation();
    if (more.getAttribute('aria-expanded') === 'true') return close(true);
    open(more, secs.map(([label, , t]) => `<div class="l-fly-g">${_lgEsc(label)}</div>` + (typeof t === 'string' ? links([[t, label]]) : links(t))).join(''), 'All pages');
  });
  fly.addEventListener('keydown', (e) => {
    const items = Array.from(fly.querySelectorAll('a')), i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
  });
  meBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const show = menu.hidden;
    menu.hidden = !show;
    meBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
  });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.hidden = true; meBtn.setAttribute('aria-expanded', 'false'); meBtn.focus(); } });
  document.addEventListener('click', (e) => {
    if (!fly.hidden && !fly.contains(e.target)) close(false);
    if (!menu.hidden && !menu.contains(e.target) && e.target !== meBtn) { menu.hidden = true; meBtn.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !fly.hidden) close(true); });
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   A344 — the APPLE look's sidebar (css/apple.css), drawn from the same LEDGER_NAV / LEDGER_ME, so a
   role reaches exactly the pages it reaches in the Ledger rail and the classic navbar
   (tests/flow/apple-contract.js checks that per role).
   A translucent source list: the logo, then each section as a disclosure group. The current page's
   section is open; what the person opens or closes is remembered (hx_ap_open_<role>). The sidebar is
   a sibling of the navbar in <body>, never inside it: the toolbar's backdrop-filter would make it the
   containing block of anything position:fixed within it. On narrow screens it is a drawer opened from
   the toolbar's sidebar button, closed by the scrim, Escape or a link.
   ════════════════════════════════════════════════════════════════════════════════════════════ */
const _AP_CHEV = '<svg class="a-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function _apIcon(name) { return _lgIcon(name).replace('<svg ', '<svg class="a-i" '); }

function appleNavbar(nav, session, initials) {
  const role = session.role, secs = LEDGER_NAV[role], here = (location.pathname.split('/').pop() || '').toLowerCase();
  const pages = ledgerPages(role), cur = pages.find(p => p.href === here) || null;
  window.hxSkinPages = pages;
  const home = (secs[0] && typeof secs[0][2] === 'string') ? secs[0][2] : 'index.html';
  const openKey = 'hx_ap_open_' + role;
  let saved = null;
  try { const v = JSON.parse(localStorage.getItem(openKey) || 'null'); saved = Array.isArray(v) ? v : null; } catch (e) { saved = null; }
  const side = secs.map(([label, icon, t], i) => {
    if (typeof t === 'string') {
      return `<a class="a-item" href="${t}"${t === here ? ' aria-current="page"' : ''}>${_apIcon(icon)}<span>${_lgEsc(label)}</span></a>`;
    }
    const inHere = t.some(([h]) => h === here);
    const open = inHere || (saved ? saved.indexOf(i) >= 0 : false);
    const items = t.map(([h, l]) => `<a class="a-item a-sub" href="${h}"${h === here ? ' aria-current="page"' : ''}>${_lgLabel(h, l, role)}</a>`).join('');
    return `<div class="a-grp"><button type="button" class="a-grp-h${inHere ? ' a-here' : ''}" data-a-grp="${i}" aria-expanded="${open}" aria-controls="aG${i}">${_apIcon(icon)}<span>${_lgEsc(label)}</span>${_AP_CHEV}</button>` +
      `<div class="a-grp-b" id="aG${i}"${open ? '' : ' hidden'}>${items}</div></div>`;
  }).join('');
  const crumbs = !cur ? '' : cur.group === cur.label || cur.href === home ? `<b>${_lgEsc(cur.label)}</b>` : `${_lgEsc(cur.group)}<span aria-hidden="true">›</span><b>${_lgEsc(cur.label)}</b>`;
  const me = (LEDGER_ME[role] || []).map(([h, l]) => `<a role="menuitem" href="${h}"${h === here ? ' aria-current="page"' : ''}>${_lgEsc(l)}</a>`).join('');
  const looks = typeof hxSkinLookItems === 'function' ? hxSkinLookItems() : '';

  nav.innerHTML = `
    <button type="button" class="a-menu" aria-controls="aSide" aria-expanded="false" aria-label="Show the pages">${_lgIcon('sidebar')}</button>
    <nav class="l-crumbs" aria-label="You are here">${crumbs}</nav>
    <button type="button" class="l-search" data-l-search aria-label="Search pages">${_lgIcon('search')}<span>Search pages</span><kbd>Ctrl K</kbd></button>
    <div class="navbar-user l-tools">
      <button type="button" class="theme-toggle nav-theme" id="navThemeToggle" aria-pressed="false" aria-label="Dark theme"><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span>Dark</span></button>
      <div class="notif-bell" id="notifBell" onclick="toggleNotifDropdown()" title="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="notif-badge" id="notifBadge" style="display:none;"></span>
      </div>
      <div class="notif-dropdown" id="notifDropdown" style="display:none;">
        <div class="notif-head">Notifications</div>
        <div class="notif-list" id="notifList"><div class="notif-empty">Loading...</div></div>
      </div>
      <div class="l-me">
        <button type="button" class="l-me-btn" aria-haspopup="menu" aria-expanded="false"><span class="l-av">${_lgEsc(initials)}</span><span class="l-who">${_lgEsc(session.name)}<small>${LEDGER_ROLE_NAMES[role] || ''}</small></span></button>
        <div class="l-menu" role="menu" hidden>${me}${looks}<button type="button" role="menuitem" class="l-out" onclick="logout()">${_lgIcon('out')}Log out</button></div>
      </div>
    </div>`;
  ['aSide', 'aScrim'].forEach(id => { const old = document.getElementById(id); if (old && old.parentNode) old.parentNode.removeChild(old); });
  const sideEl = document.createElement('nav');
  sideEl.className = 'a-side'; sideEl.id = 'aSide'; sideEl.setAttribute('aria-label', 'Pages');
  sideEl.innerHTML = `<a class="a-brand" href="${home}"><img src="images/logo-nav-2x.png" alt="Hi-Escorp" width="224" height="56"></a>${side}`;
  const scrim = document.createElement('div');
  scrim.className = 'a-scrim'; scrim.id = 'aScrim'; scrim.setAttribute('aria-hidden', 'true');
  if (document.body && typeof document.body.insertBefore === 'function') {
    document.body.insertBefore(scrim, document.body.firstChild);
    document.body.insertBefore(sideEl, document.body.firstChild);
  }
  _apWire(nav, sideEl, scrim, openKey);
  return true;
}

function _apWire(nav, side, scrim, openKey) {
  const menu = nav.querySelector('.l-menu'), meBtn = nav.querySelector('.l-me-btn'), drawerBtn = nav.querySelector('.a-menu');
  const remember = () => {
    try {
      const open = Array.from(side.querySelectorAll('[data-a-grp][aria-expanded="true"]')).map(b => +b.dataset.aGrp);
      localStorage.setItem(openKey, JSON.stringify(open));
    } catch (e) { /* a convenience only */ }
  };
  side.querySelectorAll('[data-a-grp]').forEach(btn => btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    const body = side.querySelector('#' + btn.getAttribute('aria-controls'));
    if (body) body.hidden = !open;
    remember();
  }));
  const setDrawer = (open, back) => {
    side.classList.toggle('open', open);
    scrim.classList.toggle('on', open);
    if (drawerBtn) drawerBtn.setAttribute('aria-expanded', String(open));
    if (open) { const first = side.querySelector('[aria-current="page"]') || side.querySelector('a, button'); if (first) first.focus({ preventScroll: true }); }
    else if (back && drawerBtn) drawerBtn.focus();
  };
  if (drawerBtn) drawerBtn.addEventListener('click', (e) => { e.stopPropagation(); setDrawer(!side.classList.contains('open'), false); });
  scrim.addEventListener('click', () => setDrawer(false, true));
  side.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a[href]')) setDrawer(false, false); });
  meBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const show = menu.hidden;
    menu.hidden = !show;
    meBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
  });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.hidden = true; meBtn.setAttribute('aria-expanded', 'false'); meBtn.focus(); } });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== meBtn) { menu.hidden = true; meBtn.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && side.classList.contains('open')) setDrawer(false, true); });
  window.hxAppleDrawer = setDrawer;   // js/apple.js drives the drawer with a finger
}

/* "Needs you" rows in the Ledger look (auth.js flowActionsStrip calls this only while it is on):
   the amount when the item carries one, and the one verb that says what the row is for. The row
   stays a single link; the verb is its label, not a second control. */
const LEDGER_VERBS = [
  [/website requests? to answer/i, 'Answer'], [/not reaching the portal/i, 'Check'],   // A338
  [/past due — collect|collect\b/i, 'Collect'], [/to pay\b/i, 'Pay'], [/past due/i, 'Settle'], [/acknowledge/i, 'Acknowledge'],
  [/sent back|rejected|returned/i, 'Fix'], [/awaiting your (approval|verification)|waiting for your (signature|final pricing)/i, 'Review'],
  [/waiting to be sourced/i, 'Source'], [/ready to quote|still waiting to be quoted/i, 'Quote'], [/not sent to the client/i, 'Send'],
  [/repl(y|ies) waiting|follow-up|follow up/i, 'Follow up'], [/not received yet/i, 'Receive'], [/not yet invoiced/i, 'Invoice'],
  [/no purchase order/i, 'Order'], [/running low/i, 'Restock'], [/handed to you|book the presentation/i, 'Book'],
  [/expiring/i, 'Renew'], [/cutoff/i, 'Include'], [/behind on/i, 'Catch up']
];
function ledgerTaskTail(n) {
  const v = (LEDGER_VERBS.find(([re]) => re.test(String(n.text || ''))) || [null, 'Open'])[1];
  const amt = typeof n.amt === 'number' && n.amt > 0 ? '<span class="fa-amt">₱' + n.amt.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>' : '';
  return amt + '<span class="fa-verb">' + v + '</span>';
}
