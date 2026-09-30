/* A293 — the management home's CONTRACT: what the rebuilt management-home.html must keep, and what
 * it must never carry again.
 *
 * Run:  node tests/flow/management-home-contract.js
 *
 * Four scripts write into this page by id: management-flow.js (the slab's figures, guarded on
 * #mgmtKpiGrid; the approvals, the daily reports, the weekly report, lifecycle, inventory, pricing;
 * the quotation review dialog), management-income.js (the income statement), management-home.js
 * (the HR cards and modules, the payroll approvals and their dialog, the shipment list and its
 * timeline; it calls openDocViewer and setSectionSummary by name) and report-render.js. The page
 * script owns the palette, the KPI detail card, the viewer, the approval strip and the rail.
 * Section 1 pins the shell, 2 every id with its tag and the hidden ones, 3 what the rebuild
 * removed on purpose (the workspace sidebar, the density toggle, the accordion, the hero, the
 * inline scripts, colour and emoji in the scripts), 4 the sheet's scope and motion, 5 the page
 * script under a DOM with no observers (viewer, summary, palette, KPI detail, strip), 6 boots
 * management-flow.js against the real markup and checks the slab fills, and 7 the scoped
 * itinerary panel sheet. */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'management-home.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/management-home.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/management-home.js', 'utf8');
const FLOW = fs.readFileSync(D + 'js/management-flow.js', 'utf8');
const INC  = fs.readFileSync(D + 'js/management-income.js', 'utf8');
const PJS  = fs.readFileSync(D + 'js/management-home-page.js', 'utf8');
const IWP  = fs.readFileSync(D + 'js/itinerary-week-panel.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{269F}\u{26A1}-\u{2708}\u{270A}-\u{270D}\u{270F}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/u;   // ✓ ✉ ✎ ⚠ stay
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','), 'styles.css,flow.css,shipments.css,management-home.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="mg"> — the scope every rule hangs off', /<body class="mg">/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="mg">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order (A301: html2pdf is no longer eager — the payroll renderer injects it on demand)', (HTML.match(/<script src="([^"]+)"/g) || []).map(s => s.match(/src="([^"]+)"/)[1].replace(/^js\//, '')).join(','),
   'theme.js,api.js,salary-deduction-card.js,auth.js,flow-api.js,quotation-worklist.js,stage-meta.js,management-home.js,report-render.js,report-pdf.js,team-performance.js,itinerary-week.js,management-flow.js,so-cost-editor.js,management-income.js,management-home-page.js');
ok('  no CDN script tag on the page; html2pdf is loaded by the renderer itself', !/cdnjs\.cloudflare\.com/.test(HTML) && /var HTML2PDF_CDN = 'https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/html2pdf\.js/.test(fs.readFileSync(D + 'js/management-home.js', 'utf8')));
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab, the nav and five jumps, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && (HTML.match(/class="hx-jump" data-target="/g) || []).length === 5 && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));
ok('the mast keeps the palette button and two plain links', /onclick="_cmdkOpen\(\)"/.test(HTML) && /href="management-sales-orders\.html" class="btn"/.test(HTML) && /href="management-itinerary\.html" class="btn"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const HR_MODS = ['hrModRecruitment', 'hrModEmployees', 'hrModLeave', 'hrModReviews', 'hrModTraining', 'hrModTasks', 'hrModMemos', 'hrModGrievances', 'hrModCampaigns', 'hrModContent', 'hrModAccreditations', 'hrModBirthdays'];
const HR_COUNTS = ['hrModCountRecr', 'hrModCountEmp', 'hrModCountLeave', 'hrModCountReviews', 'hrModCountTraining', 'hrModCountTasks', 'hrModCountMemos', 'hrModCountGrv', 'hrModCountCamp', 'hrModCountContent', 'hrModCountAccred', 'hrModCountBday'];
const TAGS = {
  h1: ['greeting'],
  h3: ['kpiDetailLabel'],
  p: ['todayLabel'],
  b: ['hbDay'],
  span: ['hbMon', 'inboxCount', 'payrollCount', 'isState', 'mgmtDrMeta', 'mfTwRange', 'mgmtPrMeta', 'summary-shipments', 'summary-hr-insights', 'summary-hr-summary', 'summary-payroll-approvals',
         'mfrTitle', 'mgmtSmTlSubtitle', 'mgmtSmTlStatusBadge', 'docViewerTitle'].concat(HR_COUNTS),
  dd: ['mgmtKpiCogs', 'mgmtKpiGp', 'mgmtKpiAp', 'mgmtKpiInv', 'mgmtKpiSo', 'approvalsCount'],
  dl: ['mgmtKpiGrid'],
  div: ['mgmtKpiRevenue', 'flowActionCenter', 'mgmtApprovals', 'isTotals', 'miNotesPanel', 'isBody', 'mgmtDrUsers', 'mgmtDrMovements', 'mgmtDrDocs', 'mgmtDrSales', 'mgmtDrPdfs', 'mgmtDrBody', 'mfTwBody',
        'newsec-lifecycle', 'mgmtLifecycleHealth', 'newsec-inventory', 'mgmtInvBody', 'newsec-pricing', 'mgmtPrBody', 'section-shipments', 'mgmtSmContainer',
        'section-hr-insights', 'hrInsightsKPIs', 'hrPendingLeave', 'hrActiveGrievances', 'hrOverdueReviews', 'hrActiveMemos', 'hrTrainingPct', 'hrOpenRecruitment',
        'section-hr-summary', 'hrKpiGrid', 'hrOpenPositions', 'hrOnboarding', 'hrTasksDone', 'hrTasksPending', 'hrTotalEmp', 'section-payroll-approvals', 'payrollApprovalsContainer',
        'payapprModal', 'payapprModalTitle', 'payapprModalMeta', 'mfReviewModal', 'mfrSub', 'mfrBody', 'mfrFoot', 'cmdkOverlay', 'cmdkList', 'kpiDetailOverlay', 'kpiDetailValue', 'kpiDetailTrend', 'kpiDetailEmpty',
        'mgmtSmOverlay', 'mgmtSmTlHeader', 'mgmtSmTlRibbon', 'mgmtSmTlContent', 'docViewerOverlay', 'docViewerBody'].concat(HR_MODS),
  section: ['spot', 'inbox', 'flowApprovalStrip', 'myDeductionCard', 'pulse', 'team', 'operations', 'hr'],
  button: ['themeToggle', 'mfTwReset', 'mfTwNext', 'mfTwPdfBtn', 'payapprTabPending', 'payapprTabApproved', 'payapprTabRejected', 'payapprTabAll', 'payapprApproveBtn', 'payapprRejectBtn'],
  select: ['isYear', 'mgmtPrFilter'],
  input: ['mgmtDrDate', 'mgmtDrSearch', 'mgmtPrSearch', 'cmdkInput'],
  svg: ['kpiSpark'],
  iframe: ['payapprIframe'],
  a: ['docViewerOpenBtn'],
  header: ['navbar'],
  aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
// every id the live scripts reach exists — except the ones that belong to sections A154 deleted (management-home.js still carries their code)
const DEAD = new Set(['actPanePrs', 'actPaneQuotations', 'agentActivityModal', 'arAgingContainer', 'auditActor', 'auditClient', 'auditDateFrom', 'auditDateTo', 'auditEventType', 'auditLogBody', 'auditLogPager', 'auditNextBtn', 'auditPageInfo', 'auditPrevBtn', 'auditShipmentId', 'cogsDetailContent', 'cogsDetailModal', 'collectionsFinancials', 'drAcctCount', 'drAdminCount', 'drDateLabel', 'drHRCount', 'drReportDate', 'drReportsContainer', 'drSalesCount', 'expenseCatContainer', 'expenseSummaryKPIs', 'expensesTableContainer', 'finDrillBody', 'finDrillClose', 'finDrillTitle', 'financialAllTimeBtn', 'financialDrilldownOverlay', 'financialKPIs', 'financialMonthFilter', 'incomeStatementContainer', 'inventoryKPIs', 'isClientFilter', 'isDateFilter', 'isTableContainer', 'leaderboardContainer', 'loginLogContainer', 'lowStockList', 'mgmtExpAllTimeBtn', 'mgmtExpCatFilter', 'mgmtExpMonthFilter', 'miQueueContainer', 'monthlyPLContainer', 'mroQueueContainer', 'overdueModal', 'paymentKPIs', 'plChart', 'recentPayments', 'recentSalesOrders', 'salesReportPdfModal', 'soKPIs', 'soMonthFilter', 'soYearFilter', 'totalPO', 'totalPR', 'totalQ', 'unpaidInvClose', 'unpaidInvoicesOverlay', 'mgmtKpiNet',
  // built at runtime inside the review dialog (A183)
  'mfrApproveBtn', 'mfrTick']);
const reached = (src) => Array.from(new Set((src.match(/getElementById\('([^']+)'\)/g) || []).map(s => s.match(/'([^']+)'/)[1])));
[['management-home.js', JS], ['management-flow.js', FLOW], ['management-income.js', INC], ['management-home-page.js', PJS]].forEach(([n, src]) => {
  const missing = reached(src).filter(id => !DEAD.has(id) && !tagOf(id));
  ok(n + ' reaches only ids that exist (dead sections excepted)', missing.length === 0, missing);
});
ok('#mgmtKpiGrid exists (management-flow.js loads the slab only when it does) and wraps the five facts', tagOf('mgmtKpiGrid') === 'dl' && HTML.slice(HTML.indexOf('id="mgmtKpiGrid"'), HTML.indexOf('</dl>')).includes('id="mgmtKpiSo"'));
ok('#mgmtKpiRevenue is the slab\'s value and the composition bar has its two segments', /<div class="v" id="mgmtKpiRevenue">/.test(HTML) && /<div class="hx-comp" aria-hidden="true"><i class="b"><\/i><i><\/i><\/div>/.test(HTML));
ok('the income statement toggle keeps data-is-mode and the first is active', /data-is-mode="monthly" class="active"/.test(HTML) && /data-is-mode="yearly"/.test(HTML));
ok('the weekly report keeps its four inline handlers', ['mfTwNav(-1)', 'mfTwNav(0)', 'mfTwNav(1)', 'mfTwPdf()'].every(h => HTML.includes('onclick="' + h + '"')));
ok('the five shipment filters keep their handlers and the first is active', /class="sm-filter-btn active" onclick="mgmtSmFilter\('All',this\)"/.test(HTML) && ['Pending', 'In Transit', 'Arrived', 'Delivered'].every(s => HTML.includes("onclick=\"mgmtSmFilter('" + s + "',this)\"")));
ok('the four payroll tabs keep their handlers and the first is active', /class="payappr-tab active" id="payapprTabPending" onclick="renderPayrollApprovals\('For Approval', this\)"/.test(HTML) && ['Approved', 'Rejected', ''].every(s => HTML.includes("onclick=\"renderPayrollApprovals('" + s + "', this)\"")));
ok('the dialogs keep their inline handlers', ['closePayrollApprovalModal()', 'printPayrollApprovalSnapshot()', "decidePayrollApproval('Approved')", "decidePayrollApproval('Rejected')", 'mfCloseReview()', '_cmdkClose()', '_cmdkRender()', '_cmdkKey(event)', '_kpiDetailClose()', 'closeMgmtSm()', 'closeDocViewer()'].every(h => HTML.includes(h)));
ok('the eleven KPI cards keep .kpi-card > .kpi-label + .kpi-value (the detail card reads them)', (HTML.match(/<div class="kpi-card"><div class="kpi-label">[^<]+<\/div><div class="kpi-value" id="/g) || []).length === 11);
ok('the twelve HR module cards keep their classes', (HTML.match(/class="hr-mod-card"/g) || []).length === 12 && (HTML.match(/class="hr-mod-body" id="hrMod/g) || []).length === 12);
ok('#flowApprovalStrip, #myDeductionCard, #mfTwReset, #mfReviewModal, #kpiDetailEmpty, #mgmtSmOverlay, #docViewerOverlay start hidden',
   ['flowApprovalStrip', 'myDeductionCard', 'mfTwReset', 'mfReviewModal', 'kpiDetailEmpty', 'mgmtSmOverlay', 'docViewerOverlay'].every(id => /style="display:none;"/.test(tagAttrs(id))));
ok('the palette, the KPI detail and the payroll dialog open on a class', /class="cmdk-overlay" id="cmdkOverlay"/.test(HTML) && /class="kpi-detail-overlay" id="kpiDetailOverlay"/.test(HTML) && /class="payappr-modal-overlay" id="payapprModal"/.test(HTML));
ok('the timeline and the viewer carry the shared shells', /class="sm-overlay sm-tl"/.test(tagAttrs('mgmtSmOverlay')) && /class="sm-overlay sm-pdf"/.test(tagAttrs('docViewerOverlay')));

/* ── 3 · what the rebuild removed on purpose ──────────────────────────────────────────────────── */
sec('3 · no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the workspace sidebar, the density toggle, the accordion and the hero are gone', !/mgmt-shell|mgmt-nav|mgmt-ws-btn|_mgmtSwitchWs|mgmtDensityBtn|_mgmtToggleDensity|toggleSection\(|expandAll|collapseAll|mgmtToggleNewsec|section-header|class="hero|hero-pill|mgmt-newsec|ws-hidden/.test(HTML));
ok('  and their scripts are not in the page script either', !/_mgmtSwitchWs|_mgmtToggleDensity|_restoreDensity|_initSectionBadges|_initWorkspaces|_openSection|_closeSection/.test(PJS));
ok('management-home.js writes no hex colour but the chart helper\'s fallbacks and the payroll snapshot\'s own document', (() => {
  const fb = new Set((JS.match(/_hx\('--hx-[\w-]+', '(#[0-9a-fA-F]{3,6})'\)/g) || []).map(s => s.match(/'(#[0-9a-fA-F]{3,6})'/)[1]));
  const left = (JS.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []).filter(h => !fb.has(h) && !/^#(fff|ffffff|666|666666|999|999999|c00|cc0000)$/i.test(h));
  return left.length === 0;
})(), (JS.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []).slice(0, 8));
ok('  the shipment badges are classed', /function _mgmtSmBadge/.test(JS) && !/statusColor/.test(JS) && /class="sbadge \$\{cls\}"/.test(JS));
ok('  no chrome emoji left in management-home.js (✓ and ⚠ stay)', !EMOJI_JS.test(JS), (JS.match(EMOJI_JS) || [])[0]);
ok('management-flow.js and management-income.js write no hex colour and no emoji (✉ stays)', !/#[0-9a-fA-F]{6}\b/.test(FLOW) && !/#[0-9a-fA-F]{6}\b/.test(INC) && !EMOJI_JS.test(FLOW) && !EMOJI_JS.test(INC), [(FLOW.match(EMOJI_JS) || [])[0], (INC.match(EMOJI_JS) || [])[0]]);
ok('management-home-page.js writes no hex colour', !/#[0-9a-fA-F]{6}\b/.test(PJS));
ok('  and defines exactly the named globals the markup and management-home.js call', (() => {
  const names = (PJS.match(/window\.(\w+) = function/g) || []).map(s => s.match(/window\.(\w+)/)[1]).sort().join(',');
  return names === ['_cmdkClose', '_cmdkKey', '_cmdkOpen', '_cmdkRender', '_cmdkRun', '_cmdkSet', '_extractDriveFileId', '_kpiDetailClose', '_kpiDetailOpen', 'closeDocViewer', 'openDocViewer', 'setSectionSummary'].sort().join(',');
})(), (PJS.match(/window\.(\w+) = function/g) || []));
ok('  the approval strip keeps its two flow reads (registration.js pins them) and emits the base chips', /fetchFlow\('getQuotations'\)/.test(PJS) && /fetchFlow\('getPurchaseOrders'\)/.test(PJS) && /class="hx-po-chip"/.test(PJS) && /class="hx-po-chips"/.test(PJS));
ok('  the sparkline is classed, not painted', /class="area"/.test(PJS) && /class="line"/.test(PJS) && !/fill="#/.test(PJS) && !/stroke="#/.test(PJS));

/* ── 4 · the sheet ────────────────────────────────────────────────────────────────────────────── */
sec('4 · management-home.css');
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = []; let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') { const sel = buf.trim(); if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^body\.mg/.test(sel)) bad.push(sel.slice(0, 60)); depth++; buf = ''; }
    else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch;
  }
  ok('every selector is scoped body.mg', bad.length === 0, bad.slice(0, 5));
  const lits = (stripped.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []).filter(h => !/^#fff$/i.test(h));
  ok('no literal colour (white on navy and the snapshot iframe allowed) and no dark-era fallback', lits.length === 0 && !/var\(--[\w-]+,\s*#/.test(stripped), lits);
  ['mgIn', 'mgFill', 'mgPop', 'mgFade', 'mgPopIn'].forEach(k => ok('@keyframes ' + k + ' exists', new RegExp('@keyframes ' + k + ' ').test(CSS)));
  const kf = (CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n');
  ok('keyframes animate transform and opacity only', !/(^|[^-])(width|height|top|left|margin|padding|background|box-shadow|max-height)\s*:/.test(kf), kf);
  ok('no hover-lift', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('no max-height accordion transition survives', !/max-height[^;]*;\s*[^}]*transition:\s*max-height/.test(stripped) && !/transition:[^;]*max-height/.test(stripped));
  ok('the load moment is gated by body.mg.mg-load', /body\.mg\.mg-load \.hx-facts dd \{ animation: mgIn/.test(CSS) && /body\.mg\.mg-load \.hx-comp > i \{ animation: mgFill/.test(CSS));
  ok('a reduced-motion block', /prefers-reduced-motion: reduce[\s\S]*body\.mg \*[\s\S]*animation: none !important/.test(CSS));
  ok('the palette, the KPI detail, the payroll dialog and the review dialog are styled', /\.cmdk-overlay\.open \{ display: flex; \}/.test(CSS) && /\.kpi-detail-overlay\.open \{ display: flex; \}/.test(CSS) && /\.payappr-modal-overlay\.open \{ display: flex; \}/.test(CSS) && /\.mg-review-overlay \{/.test(CSS));
  ok('the sparkline classes are painted here', /\.kpi-spark \.area \{ fill: var\(--hx-cyan-soft\)/.test(CSS) && /\.kpi-spark \.line \{ fill: none; stroke: var\(--hx-cyan-ink\)/.test(CSS));
  ok('the classes the four scripts emit are styled', ['.is-tile', '.is-table', '.mf-lh-tile', '.mf-invkpi', '.dr-tile', '.hr-mod-card', '.hr-pill', '.payappr-row', '.payappr-status.pending', '.kpi-card', '.stat-item', '.trend-up', '.target-bar-fill', '.dr-details-btn', '.mod-badge', '.act-chip'].every(c => CSS.includes(c + ' {') || CSS.includes(c + ',')));
}

/* ── 5 · the page script degrades under a DOM with no observers ──────────────────────────────── */
sec('5 · management-home-page.js');
{
  const p = page([], 'management-home.html', { role: 'management', name: 'Neil Estur', username: 'neil' }, {
    data: { getQuotations: [{ status: 'Pending Management' }, { status: 'Sent' }], getPurchaseOrders: [{ status: 'Pending Management' }] }
  });
  p.run('flowActionsStrip = function (id) { __strip = id; }; __locals = { getItem: function(){ return null; }, setItem: function(){} };');
  let threw = null;
  try { p.run(PJS); } catch (e) { threw = e.message; }
  ok('the script registers without matchMedia / MutationObserver / IntersectionObserver', threw === null, threw);
  ok('  the date landed in the rail', /^\d{2}$/.test(p.els.hbDay.textContent) && /\w{3} \w+/.test(p.els.hbMon.textContent), [p.els.hbDay.textContent, p.els.hbMon.textContent]);
  eq('  the named globals exist', ['openDocViewer', 'closeDocViewer', '_extractDriveFileId', 'setSectionSummary', '_cmdkOpen', '_cmdkRender', '_cmdkRun', '_kpiDetailOpen', '_kpiDetailClose'].map(n => p.run('typeof ' + n)).join(','), 'function,function,function,function,function,function,function,function,function');
  p.run("openDocViewer('MRO – 0042', 'https://drive.google.com/file/d/ABC123/view')");
  ok('  the viewer shows a preview iframe for a Drive file', p.els.docViewerOverlay.style.display === 'flex' && /class="ac-docframe" src="https:\/\/drive\.google\.com\/file\/d\/ABC123\/preview"/.test(p.els.docViewerBody.innerHTML), p.els.docViewerBody.innerHTML);
  p.run('closeDocViewer()');
  ok('  close hides it and empties the body', p.els.docViewerOverlay.style.display === 'none' && p.els.docViewerBody.innerHTML === '');
  p.run("setSectionSummary('section-shipments', '12 shipments · 3 in transit')");
  eq('  setSectionSummary writes the section\'s meta line', p.els['summary-shipments'].textContent, '12 shipments · 3 in transit');
  p.run('_cmdkRender()');
  ok('  the palette lists sections, pages and the theme action', /cmdk-group-label">Section</.test(p.els.cmdkList.innerHTML) && /Payroll approvals/.test(p.els.cmdkList.innerHTML) && /cmdk-group-label">Page</.test(p.els.cmdkList.innerHTML) && /Switch the theme/.test(p.els.cmdkList.innerHTML) && !/workspace|density|Expand all/i.test(p.els.cmdkList.innerHTML), p.els.cmdkList.innerHTML.slice(0, 200));
  p.els.cmdkInput.value = 'payroll'; p.run('_cmdkRender()');
  ok('  and filters by the query', /Payroll approvals/.test(p.els.cmdkList.innerHTML) && !/Inventory/.test(p.els.cmdkList.innerHTML));
  p.run("_kpiDetailOpen({ querySelector: function (s) { return s === '.kpi-label' ? { textContent: 'Pending leave' } : { textContent: '4', id: 'hrPendingLeave' }; } })");
  ok('  the KPI detail opens on a card with no history yet', p.els.kpiDetailLabel.textContent === 'Pending leave' && p.els.kpiDetailValue.textContent === '4' && p.els.kpiDetailEmpty.style.display === '' && p.els.kpiSpark.style.display === 'none' && p.els.kpiDetailTrend.textContent === 'No history yet.', [p.els.kpiDetailLabel.textContent, p.els.kpiDetailTrend.textContent]);
  (async () => {
    try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.message; }
    ok('  its DOMContentLoaded body runs on the stub DOM', threw === null, threw);
    eq('  the strip is mounted on #flowActionCenter', p.run('typeof __strip === "string" ? __strip : null'), 'flowActionCenter');
    ok('  the approval strip shows the two chips on the base classes', p.els.flowApprovalStrip.style.display === '' && /class="hx-po-chip" href="flow-quotations\.html"><span class="n">1<\/span>Quotations awaiting your approval/.test(p.els.flowApprovalStrip.innerHTML) && /flow-purchase-orders\.html"><span class="n">1<\/span>/.test(p.els.flowApprovalStrip.innerHTML), p.els.flowApprovalStrip.innerHTML);
    await boot6();
  })();
}

/* ── 6 · boot management-flow.js against the real markup: the slab fills ──────────────────────── */
async function boot6() {
  sec('6 · management-flow.js on the new markup');
  const p = page(['js/management-flow.js'], 'management-home.html', { role: 'management', name: 'Neil Estur', username: 'neil' }, {
    data: { getInvoices: [{ totalSales: 1000, totalCOGS: 600 }], getAPAging: [{ status: 'Open', amountPHP: 500, paidPHP: 100 }], getInventory: [{ totalLanded: 250 }], getSalesOrders: [{ soNo: 'SO-1' }, { soNo: 'SO-2' }] }
  });
  p.run('requireManagement = function(){ return __session; }; requireMgmtAccess = function(){ return __session; }; flowNum = v => Number(v) || 0; flowMoney = (v) => "PHP " + v; flowStockItems = a => a; flowToday = () => "2026-09-28"; flowDate = d => String(d || "").slice(0, 10);');
  let threw = null;
  try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  ok('  the slab filled: revenue, cost of goods, gross profit, payables, inventory, sales orders', /1000/.test(p.els.mgmtKpiRevenue.textContent) && /600/.test(p.els.mgmtKpiCogs.textContent) && /400/.test(p.els.mgmtKpiGp.textContent) && /400/.test(p.els.mgmtKpiAp.textContent) && /250/.test(p.els.mgmtKpiInv.textContent) && String(p.els.mgmtKpiSo.textContent) === '2',
     [p.els.mgmtKpiRevenue.textContent, p.els.mgmtKpiCogs.textContent, p.els.mgmtKpiGp.textContent, p.els.mgmtKpiAp.textContent, p.els.mgmtKpiInv.textContent, p.els.mgmtKpiSo.textContent]);

  /* ── 7 · the itinerary panel's injected sheet is scoped ─────────────────────────────────────── */
  sec('7 · itinerary-week-panel.js');
  const css = (IWP.match(/s\.textContent = `([\s\S]*?)`;/) || [])[1] || '';
  ok('the injected sheet exists', css.length > 100);
  ok('  its status classes are scoped under .iwp-row (the flow pages define the same names)', /\.iwp-row \.b-pending\s+\{/.test(css) && /\.iwp-row \.d-pending\s+\{/.test(css) && !/\n\s*\.b-[a-z-]+\s+\{/.test(css) && !/\}\s*\.d-[a-z-]+\s+\{/.test(css));
  ok('  and it carries no literal colour', !/#[0-9a-fA-F]{6}\b/.test(css), css.match(/#[0-9a-fA-F]{6}\b/g));
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
