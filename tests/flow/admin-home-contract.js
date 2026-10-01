/* A291 — the admin home's CONTRACT: what the rebuilt admin.html must keep, and what it must never
 * carry again.
 *
 * Run:  node tests/flow/admin-home-contract.js
 *
 * admin.js reaches into the page by id (sixty of them: the greeting, the four kpi figures, the
 * eight tab counts, the eight panels and their table hosts, the feed, the inventory host, the
 * shipment dialog's every field, the PDF viewer, the timeline); switchTaskTab toggles .active on
 * the tabs and display on the panels; accounting-profit.js renders the profit report into four
 * ids; so-cost-editor.js and so-note-editor.js build their own modals. Section 1 pins the shell,
 * 2 every id with its tag and the hidden ones, 3 what the redesign removed on purpose, 4 the two
 * sheets' scope and motion, 5 the page script under a DOM with no observers, 6 boots admin.js
 * against the real markup and switches every tab, and 7 the shared scripts' classed output. */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'admin.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/admin-home.css', 'utf8');
const SHIP = fs.readFileSync(D + 'css/shipments.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/admin.js', 'utf8');
const PJS  = fs.readFileSync(D + 'js/admin-home-page.js', 'utf8');
const PROFIT = fs.readFileSync(D + 'js/accounting-profit.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{269F}\u{26A1}-\u{2708}\u{270A}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/u;   // ✓ ✎ ⚠ stay
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };
const TABS = ['Qt', 'So', 'Po', 'Ap', 'Rc', 'Iv', 'Pr', 'Sm'];

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','),
   'styles.css,flow.css,pnl-report.css,shipments.css,payslip-card.css,admin-home.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="ad"> — the scope every rule hangs off; no flow-screen', /<body class="ad">/.test(HTML) && !/flow-screen/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="ad">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','),
   'theme.js,api.js,salary-deduction-card.js,payslip.js,my-payslip-card.js,auth.js,flow-api.js,flow-docs.js,stage-meta.js,admin.js,so-cost-editor.js,so-note-editor.js,accounting-profit.js,admin-home-page.js');
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab, the nav and the eight jumps, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && (HTML.match(/class="hx-jump" data-tab="(qt|so|po|ap|rc|iv|pr|sm)"/g) || []).length === 8 && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));
ok('the mast keeps the three admin pages as plain buttons', /href="admin-summary\.html" class="btn btn-primary"/.test(HTML) && /href="admin-team\.html" class="btn"/.test(HTML) && /href="admin-reports\.html" class="btn"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  h1: ['greeting'],
  p: ['todayLabel'],
  b: ['hbDay'],
  span: ['hbMon', 'inboxCount', 'smTlSubtitle', 'smTlStatusBadge', 'smHistPageInfo'].concat(TABS.map(t => 'tc' + t)),
  dd: ['kpiPr', 'kpiPo', 'kpiPoOpen', 'activityCount', 'queueTotal'],
  div: ['kpiQt', 'flowActionCenter', 'activityFeed', 'invSnapshotWrap', 'pnlTotals', 'pnlBody', 'pnlState',
        'smEditOverlay', 'smEditSubtitle', 'smEditTabs', 'smEditTabDetails', 'smShipmentBlock', 'smSoPickerWrap', 'smSoCheckList', 'smSoChips',
        'smPaymentBlock', 'smEditMsg', 'smEditTabHistory', 'smHistoryFilters', 'smHistoryList', 'smHistoryPager',
        'smPdfOverlay', 'smPdfTitle', 'smTlOverlay', 'smTlHeader', 'smTlRibbon', 'smTlContent']
       .concat(TABS.map(t => 'taskPanel' + t)).concat(['qt', 'so', 'po', 'ap', 'rc', 'iv', 'pr', 'sm'].map(t => t + 'TableWrap')),
  section: ['spot', 'inbox', 'myDeductionCard', 'myPayslipCard', 'queues', 'activity', 'inventory', 'profit'],
  button: ['themeToggle', 'smEditTabBtnDetails', 'smEditTabBtnPayment', 'smEditTabBtnHistory', 'smHistPrevBtn', 'smHistNextBtn'].concat(TABS.map(t => 'tabTask' + t)),
  select: ['smStatusFilter', 'pnlYear', 'smEditStatus', 'smEditMode', 'smEditPaymentStatus', 'smHistEventType'],
  input: ['smEditId', 'smEditPoNo', 'smEditClient', 'smEditForStocking', 'smSoSearch', 'smEditClientsPO', 'smEditHiPO', 'smEditPrincipal', 'smEditItem',
          'smEditShipmentDate', 'smEditETD', 'smEditETA', 'smEditAWB', 'smEditLogistics', 'smEditDateArrived', 'smEditTotalAmount', 'smEditAmountPaid',
          'smEditDatePayment', 'smEditPaymentMethod', 'smEditSalesInvoice', 'smEditDeliveryReceipt', 'smHistDateFrom', 'smHistDateTo', 'smHistActor', 'smHistHideSystem'],
  textarea: ['smEditRemarks'],
  a: ['smPdfOpenLink'],
  iframe: ['smPdfFrame'],
  header: ['navbar'],
  aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
// every id admin.js and accounting-profit.js reach exists in the page
const reached = (src) => Array.from(new Set((src.match(/getElementById\('([^']+)'\)/g) || []).map(s => s.match(/'([^']+)'/)[1])));
reached(JS).forEach(id => ok('admin.js reaches #' + id + ' and it exists', !!tagOf(id)));
['pnlBody', 'pnlState', 'pnlTotals', 'pnlYear'].forEach(id => ok('accounting-profit.js reaches #' + id + ' and it exists', reached(PROFIT).includes(id) && !!tagOf(id)));
ok('the tab buttons keep their inline switchTaskTab handlers (admin.js calls it by name)', TABS.every(t => new RegExp('onclick="switchTaskTab\\(\'' + t.toLowerCase() + '\'\\)" id="tabTask' + t + '"').test(HTML)));
ok('  the first tab is active and the others are not', /class="hx-tab active" onclick="switchTaskTab\('qt'\)"/.test(HTML) && TABS.slice(1).every(t => new RegExp('class="hx-tab" onclick="switchTaskTab\\(\'' + t.toLowerCase() + '\'\\)"').test(HTML)));
ok('  each tab carries its span.ct count', TABS.every(t => new RegExp('<span class="ct" id="tc' + t + '"></span>').test(HTML)));
ok('  the tabs sit inside .hx-seg next to the indicator', /<div class="hx-seg">\s*<span class="hx-seg-ind"><\/span>/.test(HTML));
ok('the eight panels: Qt born shown, the seven others hidden', !/display:none/.test(tagAttrs('taskPanelQt')) && TABS.slice(1).every(t => /style="display:none;"/.test(tagAttrs('taskPanel' + t))));
ok('  every table host is an .hx-scroll', ['qt', 'so', 'po', 'ap', 'rc', 'iv', 'pr', 'sm'].every(t => /class="hx-scroll"/.test(tagAttrs(t + 'TableWrap'))));
ok('#smStatusFilter keeps onchange="applySmFilter()" inside the shipments panel', /onchange="applySmFilter\(\)"/.test(tagAttrs('smStatusFilter')) && HTML.indexOf('id="smStatusFilter"') > HTML.indexOf('id="taskPanelSm"') && HTML.indexOf('id="smStatusFilter"') < HTML.indexOf('id="smTableWrap"'));
ok('the three overlays, the payment block, the history tab, the pager and the deduction card start hidden',
   ['smEditOverlay', 'smPdfOverlay', 'smTlOverlay', 'smPaymentBlock', 'smEditTabHistory', 'smHistoryPager', 'myDeductionCard', 'myPayslipCard'].every(id => /style="display:none;"/.test(tagAttrs(id))));
ok('  the overlays carry the shared shell classes (shipments.css shows them once display clears)', /class="sm-overlay" style="display:none;"/.test(tagAttrs('smEditOverlay')) && /class="sm-overlay sm-pdf"/.test(tagAttrs('smPdfOverlay')) && /class="sm-overlay sm-tl"/.test(tagAttrs('smTlOverlay')));
ok('the dialog keeps its inline handlers', ['closeSmModal()', "_smModalSwitchTab('details')", "_smModalSwitchTab('payment')", "_smModalSwitchTab('history')", 'smToggleStocking(this)', 'smFilterSOs()', 'openSmTimeline(_smTlShipmentIdx)', 'saveSmEdit()', 'smClosePdf()', 'closeSmTimeline()', '_smHistoryLoad(1)', '_smHistoryClearFilters()', '_smHistoryLoad(_smHistoryPage - 1)', '_smHistoryLoad(_smHistoryPage + 1)'].every(h => HTML.includes(h)));
ok('#kpiQt is the slab\'s value and the four kpi ids are in the rail', /<div class="v" id="kpiQt">/.test(HTML) && HTML.indexOf('id="kpiPoOpen"') < HTML.indexOf('<div class="hx-col">'));
ok('#smHistHideSystem starts checked (the loader reads it)', /checked/.test(tagAttrs('smHistHideSystem')));

/* ── 3 · what the redesign removed on purpose ─────────────────────────────────────────────────── */
sec('3 · no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the old kit is gone: hero, hband, kpi-row, admin-2col, side-panel, task-tab, .tab', !/class="(hero|hband|kpi-row|admin-2col|admin-side|side-panel-head|task-tab|tab|tab active)"/.test(HTML) && !/hero-pill|ctitle|density-compact/.test(HTML));
ok('admin.js writes no hex colour and no inline colour', !/#[0-9a-fA-F]{6}\b/.test(JS) && !/style="color:#/.test(JS) && !/msg\.style\.color = '#/.test(JS));
ok('  the feed, the empty states and the stage dots are classed', /class="feedrow"/.test(JS) && /class="ft"/.test(JS) && /class="fw"/.test(JS) && /class="ad-empty"/.test(JS) && /class="sm-dots"/.test(JS));
ok('  no chrome emoji left in admin.js (✓ and ⚠ stay)', !EMOJI_JS.test(JS), (JS.match(EMOJI_JS) || [])[0]);
ok('accounting-profit.js writes no hex colour', !/#[0-9a-fA-F]{6}\b/.test(PROFIT));
ok('admin-home-page.js writes no hex colour, wraps _smModalSwitchTab and defines nothing else global', !/#[0-9a-fA-F]{6}\b/.test(PJS) && /window\._smModalSwitchTab = function/.test(PJS) && (PJS.match(/window\.\w+\s*=/g) || []).length === 1);
ok('the page script never adds a postFlow/fetchFlow literal (registration.js scans it)', !/postFlow\(|fetchFlow\(/.test(PJS));

/* ── 4 · the two sheets ───────────────────────────────────────────────────────────────────────── */
sec('4 · admin-home.css and shipments.css');
{
  const scoped = (css, prefix) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = []; let depth = 0, buf = '';
    for (const ch of stripped) {
      if (ch === '{') { const sel = buf.trim(); if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !prefix.test(sel)) bad.push(sel.slice(0, 60)); depth++; buf = ''; }
      else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch;
    }
    return bad;
  };
  ok('every admin-home.css selector is scoped body.ad', scoped(CSS, /^body\.ad/).length === 0, scoped(CSS, /^body\.ad/).slice(0, 5));
  ok('every shipments.css selector is a shipment, queue or theme class', scoped(SHIP, /^(\.task-tbl|\.sbadge|\.sm-|\.auto-badge|\.doc-badge|\.blocked-icon|html\[data-theme)/).length === 0, scoped(SHIP, /^(\.task-tbl|\.sbadge|\.sm-|\.auto-badge|\.doc-badge|\.blocked-icon|html\[data-theme)/).slice(0, 5));
  const lits = (css) => (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []).filter(h => !/^#fff$/i.test(h));
  ok('no literal colour in either sheet (white on the PDF frame allowed)', lits(CSS).length === 0 && lits(SHIP).length === 0, lits(CSS).concat(lits(SHIP)));
  ok('no dark-era fallback in either sheet', !/var\(--[\w-]+,\s*#/.test(CSS) && !/var\(--[\w-]+,\s*#/.test(SHIP));
  ['adIn', 'adPop', 'adFade'].forEach(k => ok('@keyframes ' + k + ' exists', new RegExp('@keyframes ' + k + ' ').test(CSS)));
  const kf = (CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n');
  ok('keyframes animate transform and opacity only', !/(^|[^-])(width|height|top|left|margin|padding|background|box-shadow)\s*:/.test(kf), kf);
  ok('shipments.css has no keyframes at all (the old pulse ring is a static ring now)', !/@keyframes/.test(SHIP) && /\.sm-tl-card\.next \{[^}]*box-shadow: 0 0 0 3px var\(--hx-cyan-ring\)/.test(SHIP));
  ok('no hover-lift in either sheet', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS) && !/:hover[^{]*\{[^}]*translateY\(-/.test(SHIP));
  ok('the load moment is gated by body.ad.ad-load', /body\.ad\.ad-load \.hx-facts dd \{ animation: adIn/.test(CSS) && /body\.ad\.ad-load \.feedrow \{ animation: adIn/.test(CSS));
  ok('a reduced-motion block in each sheet', /prefers-reduced-motion: reduce[\s\S]*body\.ad \*[\s\S]*animation: none !important/.test(CSS) && /prefers-reduced-motion: reduce/.test(SHIP));
  ok('shipments.css styles every status class admin.js can emit', ['pending', 'awaiting', 'payment', 'goodsready', 'booked', 'intransit', 'customs', 'arrived', 'delivered', 'default', 'approved', 'sent', 'paid', 'rejected'].every(c => new RegExp('\\.sbadge-' + c + '\\b').test(SHIP)));
  ok('  and the timeline, history and owner classes', ['.sm-tl-ribbon-seg', '.sm-tl-next-up', '.sm-tl-phase-hdr', '.sm-tl-card', '.sm-dep-chip', '.sm-tl-fields', '.sm-tl-btn', '.sm-hist-event', '.sm-hist-icon', '.sm-owner-badge', '.sm-edit-tab', '.sm-history', '.sm-overlay', '.sm-dialog', '.sm-pdf-box'].every(c => SHIP.includes(c + ' {') || SHIP.includes(c + ',')));
}

/* ── 5 · the page script degrades under a DOM with no observers ──────────────────────────────── */
sec('5 · admin-home-page.js');
{
  const p = page([], 'admin.html', { role: 'admin', name: 'Neil Estur', username: 'neil' });
  let threw = null;
  try { p.run('_smModalSwitchTab = function (t) { __base = t; };'); p.run(PJS); } catch (e) { threw = e.message; }
  ok('the script registers without matchMedia / MutationObserver / IntersectionObserver', threw === null, threw);
  ok('  the date landed in the rail', /^\d{2}$/.test(p.els.hbDay.textContent) && /\w{3} \w+/.test(p.els.hbMon.textContent), [p.els.hbDay.textContent, p.els.hbMon.textContent]);
  ok('  the day line is the long date', /\w+day, \w+ \d{1,2}, \d{4}/.test(p.els.todayLabel.textContent), p.els.todayLabel.textContent);
  ok('  the queue total waits for a count (no NaN)', p.els.queueTotal.textContent === '');
  // the payment sub-tab wraps the base switcher
  threw = null;
  try { p.run("_smModalSwitchTab('payment')"); } catch (e) { threw = e.message; }
  ok('  _smModalSwitchTab("payment") runs, calls the base with "details" and swaps the blocks', threw === null && p.run('__base') === 'details' && p.els.smShipmentBlock.style.display === 'none' && p.els.smPaymentBlock.style.display === '', threw);
  p.run("_smModalSwitchTab('details')");
  ok('  _smModalSwitchTab("details") restores them and passes through', p.run('__base') === 'details' && p.els.smShipmentBlock.style.display === '' && p.els.smPaymentBlock.style.display === 'none');
  p.run("_smModalSwitchTab('history')");
  eq('  _smModalSwitchTab("history") passes through', p.run('__base'), 'history');
  threw = null;
  p.run('flowActionsStrip = function (id) { __strip = id; };');
  (async () => {
    try { await p.boot(); } catch (e) { threw = e.message; }
    ok('  its DOMContentLoaded body runs on the stub DOM', threw === null, threw);
    eq('  the strip is mounted on #flowActionCenter', p.run('typeof __strip === "string" ? __strip : null'), 'flowActionCenter');
    await boot6();
  })();
}

/* ── 6 · boot admin.js against the real markup and switch every tab ───────────────────────────── */
async function boot6() {
  sec('6 · admin.js on the new markup');
  const p = page(['js/stage-meta.js', 'js/admin.js'], 'admin.html', { role: 'admin', name: 'Neil Estur', username: 'neil' }, {
    data: {
      getQuotations: [{ quotationNo: 'Q-1', date: '2026-09-02', customer: 'Holcim', status: 'Pending Admin', total: 1000, items: [] }],
      getPurchaseOrders: [{ poNo: 'PO-1', soNo: 'SO-1', date: '2026-09-03', supplier: 'Enerpac', currency: 'USD', total: 500, status: 'Open', items: [] }],
      getPricingRequests: [{ prNo: 'PR-1', date: '2026-09-04', status: 'Requested' }],
      getActivityLog: [{ timestamp: '2026-09-28T02:00:00Z', user: 'ana', action: 'created', module: 'Quotation', refNo: 'Q-1' }],
      getInventory: [{ itemNo: 'A-1', description: 'Puller', balance: 3, landedCost: 10, currency: 'PHP', type: 'Stock' }],
    }
  });
  p.run(`requireAdmin = function(){ return __session; }; clearApiCache = function(){}; getGreeting = n => 'Hi ' + n; flowToday = () => '2026-09-28'; flowDate = d => String(d || '').slice(0, 10);
         apiGetShipments = async () => ({ success: true, data: [{ shipmentId: 'SH-1', poNo: 'PO-1', client: 'Holcim', mode: 'SEA', etd: '2026-10-01', eta: '2026-10-20', status: 'In Transit', stages: '{}', documents: '{}' }] });
         flowMoney = (v) => 'PHP ' + v; flowNum = v => Number(v) || 0; flowQuotationNet = q => q.total; flowQuotationDiscountTag = () => ''; flowStockItems = a => a;`);
  let threw = null;
  try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  eq('  the greeting', p.els.greeting.innerHTML, 'Hi Neil Estur');
  ok('  the slab: quotations, pricing requests and purchase orders this month, open purchase orders', String(p.els.kpiQt.textContent) === '1' && String(p.els.kpiPr.textContent) === '1' && String(p.els.kpiPo.textContent) === '1' && String(p.els.kpiPoOpen.textContent) === '1', [p.els.kpiQt.textContent, p.els.kpiPr.textContent, p.els.kpiPo.textContent, p.els.kpiPoOpen.textContent]);
  ok('  the tab counts landed', String(p.els.tcQt.textContent) === '1' && String(p.els.tcPo.textContent) === '1' && String(p.els.tcSm.textContent) === '1', [p.els.tcQt.textContent, p.els.tcPo.textContent, p.els.tcSm.textContent]);
  ok('  the quotations queue rendered a classed table', /<table class="task-tbl">/.test(p.els.qtTableWrap.innerHTML) && /class="sbadge sbadge-pending"/.test(p.els.qtTableWrap.innerHTML), p.els.qtTableWrap.innerHTML.slice(0, 200));
  ok('  the feed is classed rows', /class="feedrow"/.test(p.els.activityFeed.innerHTML) && /class="ft">/.test(p.els.activityFeed.innerHTML) && /class="fw">/.test(p.els.activityFeed.innerHTML), p.els.activityFeed.innerHTML.slice(0, 200));
  ok('  the inventory snapshot rendered with the classed meta line', /class="ad-inv-meta"/.test(p.els.invSnapshotWrap.innerHTML) && /<table class="task-tbl">/.test(p.els.invSnapshotWrap.innerHTML), p.els.invSnapshotWrap.innerHTML.slice(0, 200));
  const err = (fn) => { try { fn(); return null; } catch (e) { return String(e); } };
  for (const t of TABS) {
    const k = t.toLowerCase();
    const e = err(() => p.run(`switchTaskTab('${k}')`));
    ok("switchTaskTab('" + k + "') runs and shows only its panel", e === null && p.els['taskPanel' + t].style.display === '' && TABS.filter(x => x !== t).every(x => p.els['taskPanel' + x].style.display === 'none'), e);
  }
  await new Promise(r => setImmediate(r));
  ok('  the shipments queue rendered classed action buttons and stage dots', /class="sm-act"/.test(p.els.smTableWrap.innerHTML) && /class="sm-dots"/.test(p.els.smTableWrap.innerHTML) && /sbadge-intransit/.test(p.els.smTableWrap.innerHTML), p.els.smTableWrap.innerHTML.slice(0, 300));
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
