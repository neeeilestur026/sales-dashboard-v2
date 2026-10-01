/* A292 — the accounting home's CONTRACT: what the rebuilt accounting-home.html must keep, and what
 * it must never carry again.
 *
 * Run:  node tests/flow/accounting-home-contract.js
 *
 * accounting-home.js reaches into the page by id (the greeting, the summary line, the recent list,
 * the monitoring list, the timeline dialog's five hosts) and calls acctOpenDocViewer by name from
 * the timeline it renders; accounting-profit.js renders the revenue table and the profit report
 * into six ids; the markup calls acctSmFilter, acctSmClose, acctSmToggleSection and
 * acctCloseDocViewer inline. Section 1 pins the shell, 2 every id with its tag and the hidden
 * ones, 3 what the redesign removed on purpose, 4 the sheet's scope and motion, 5 the page script
 * under a DOM with no observers (the KPI snapshot, the viewer, the collapse), 6 boots
 * accounting-home.js against the real markup and renders the list, and 7 the shared shipment
 * sheet's monitoring classes. */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'accounting-home.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/accounting-home.css', 'utf8');
const SHIP = fs.readFileSync(D + 'css/shipments.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/accounting-home.js', 'utf8');
const PJS  = fs.readFileSync(D + 'js/accounting-home-page.js', 'utf8');
const META = fs.readFileSync(D + 'js/stage-meta.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{269F}\u{26A1}-\u{2708}\u{270A}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/u;   // ✓ ⚠ stay
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','),
   'styles.css,flow.css,pnl-report.css,shipments.css,payslip-card.css,accounting-home.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="ac"> — the scope every rule hangs off; no flow-screen', /<body class="ac">/.test(HTML) && !/flow-screen/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="ac">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','),
   'theme.js,api.js,salary-deduction-card.js,payslip.js,my-payslip-card.js,auth.js,flow-api.js,stage-meta.js,accounting-home.js,so-cost-editor.js,so-note-editor.js,accounting-profit.js,accounting-home-page.js');
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab and the nav, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && /<nav class="hx-rail-nav"/.test(HTML) && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));
ok('the mast keeps the three accounting pages as plain buttons', /href="flow-accounting\.html" class="btn btn-primary"/.test(HTML) && /href="flow-ledger\.html" class="btn"/.test(HTML) && /href="accounting-billing\.html" class="btn"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  h1: ['greeting'],
  p: ['todayLabel'],
  b: ['hbDay'],
  span: ['hbMon', 'kpiState', 'inboxCount', 'acctRevYear', 'acctSmSummary', 'acctSmTlSubtitle', 'acctSmTlStatusBadge', 'acctDocViewerTitle'],
  dd: ['kpiSales', 'kpiCogs', 'kpiAp', 'kpiInv', 'kpiNet'],
  div: ['kpiGp', 'kpiGpMargin', 'flowActionCenter', 'appGrid', 'acctSmRecent', 'pnlState', 'pnlTotals', 'pnlBody', 'acctSmBody', 'acctSmContainer',
        'acctSmOverlay', 'acctSmTlHeader', 'acctSmTlRibbon', 'acctSmTlContent', 'acctDocViewerOverlay', 'acctDocViewerBody'],
  tbody: ['acctRevBody'],
  section: ['spot', 'inbox', 'myDeductionCard', 'myPayslipCard', 'modules', 'revenue', 'recent', 'profit', 'shipments'],
  button: ['themeToggle', 'acctSmToggle'],
  select: ['pnlYear'],
  a: ['acctDocViewerOpenBtn'],
  svg: ['acctSmChevron'],
  header: ['navbar'],
  aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
const reached = (src) => Array.from(new Set((src.match(/getElementById\('([^']+)'\)/g) || []).map(s => s.match(/'([^']+)'/)[1])));
reached(JS).forEach(id => ok('accounting-home.js reaches #' + id + ' and it exists', !!tagOf(id)));
reached(PJS).forEach(id => ok('accounting-home-page.js reaches #' + id + ' and it exists', !!tagOf(id)));
['acctRevBody', 'acctRevYear', 'pnlBody', 'pnlState', 'pnlTotals', 'pnlYear'].forEach(id => ok('accounting-profit.js reaches #' + id + ' and it exists', !!tagOf(id)));
ok('the ten module cards keep their classes', (HTML.match(/class="acard"/g) || []).length === 10 && (HTML.match(/class="acard-title"/g) || []).length === 10 && (HTML.match(/class="acard-stat"/g) || []).length === 10);
ok('the five filter buttons keep their inline handlers and the first is active', /class="sm-filter-btn active" onclick="acctSmFilter\('All',this\)"/.test(HTML) && ['Pending', 'In Transit', 'Arrived', 'Delivered'].every(s => HTML.includes("class=\"sm-filter-btn\" onclick=\"acctSmFilter('" + s + "',this)\"")));
ok('the dialogs keep their inline handlers', ['acctSmClose()', 'acctCloseDocViewer()', 'acctSmToggleSection(this)', 'if(event.target===this)acctSmClose()', 'if(event.target===this)acctCloseDocViewer()'].every(h => HTML.includes(h)));
ok('the two overlays and the deduction card start hidden', ['acctSmOverlay', 'acctDocViewerOverlay', 'myDeductionCard', 'myPayslipCard'].every(id => /style="display:none;"/.test(tagAttrs(id))));
ok('  and carry the shared shell classes', /class="sm-overlay sm-tl"/.test(tagAttrs('acctSmOverlay')) && /class="sm-overlay sm-pdf"/.test(tagAttrs('acctDocViewerOverlay')));
ok('#acctSmBody starts shown (the header button collapses it)', !/display:none/.test(tagAttrs('acctSmBody')) && /aria-expanded="true"/.test(tagAttrs('acctSmToggle')));
ok('#kpiGp is the slab\'s value and #kpiState its tag', /<div class="v" id="kpiGp">/.test(HTML) && /<span class="tag" id="kpiState">/.test(HTML));
ok('the revenue table keeps th.n / the tbody id for accounting-profit.js', /<th class="n">Revenue<\/th>/.test(HTML) && /<tbody id="acctRevBody">/.test(HTML));

/* ── 3 · what the redesign removed on purpose ─────────────────────────────────────────────────── */
sec('3 · no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the old kit is gone: hero, hband, kpi-row, acct-kpis, acct-2col, sect-head, app-grid-v2, sm-section', !/class="(hero|hband|acct-kpis|acct-2col|sect-head|app-grid-v2 stagger|sm-section|sm-section-hdr|ctitle)"/.test(HTML) && !/hero-pill|ptable/.test(HTML));
ok('accounting-home.js writes no hex colour', !/#[0-9a-fA-F]{6}\b/.test(JS));
ok('  the list, the recent rows and the badges are classed', /class="sm-row"/.test(JS) && /class="sm-mini"/.test(JS) && /class="po"/.test(JS) && /function _acctSmBadge\(status\) \{ return hxSmBadge\(status\); \}/.test(JS) && !/statusColor/.test(JS));
ok('  no chrome emoji left in accounting-home.js (✓ and ⚠ stay)', !EMOJI_JS.test(JS), (JS.match(EMOJI_JS) || [])[0]);
ok('stage-meta.js: the six phase icons are inline SVG', /const _SM_PHASE_ICONS = \(function/.test(META) && !EMOJI.test(META) && (META.match(/<svg width="14" height="14"/g) || []).length >= 1);
ok('accounting-home-page.js writes no hex colour and defines only the three named globals', !/#[0-9a-fA-F]{6}\b/.test(PJS) && ['acctOpenDocViewer', 'acctCloseDocViewer', 'acctSmToggleSection'].every(n => new RegExp('window\\.' + n + ' = function').test(PJS)) && (PJS.match(/window\.\w+\s*=/g) || []).length === 3);
ok('the page script keeps the four flow reads the inline snapshot made (registration.js pins them)', ["fetchFlow('getInvoices')", "fetchFlow('getAPAging')", "fetchFlow('getInventory')", "fetchFlow('getExpenses')"].every(c => PJS.includes(c)));

/* ── 4 · the sheet ────────────────────────────────────────────────────────────────────────────── */
sec('4 · accounting-home.css');
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = []; let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') { const sel = buf.trim(); if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^body\.ac/.test(sel)) bad.push(sel.slice(0, 60)); depth++; buf = ''; }
    else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch;
  }
  ok('every selector is scoped body.ac', bad.length === 0, bad.slice(0, 5));
  ok('no literal colour and no dark-era fallback', !HEX.test(stripped) && !/var\(--[\w-]+,\s*#/.test(stripped), stripped.match(HEX));
  ['acIn', 'acPop', 'acFade'].forEach(k => ok('@keyframes ' + k + ' exists', new RegExp('@keyframes ' + k + ' ').test(CSS)));
  const kf = (CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n');
  ok('keyframes animate transform and opacity only', !/(^|[^-])(width|height|top|left|margin|padding|background|box-shadow)\s*:/.test(kf), kf);
  ok('no hover-lift', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('the load moment is gated by body.ac.ac-load', /body\.ac\.ac-load \.hx-facts dd \{ animation: acIn/.test(CSS) && /body\.ac\.ac-load \.acard \{ animation: acIn/.test(CSS));
  ok('a reduced-motion block', /prefers-reduced-motion: reduce[\s\S]*body\.ac \*[\s\S]*animation: none !important/.test(CSS));
  ok('the module cards, the tag tones, the chevron and the viewer body are styled', /body\.ac \.acard \{/.test(CSS) && /\.tag\[data-tone="ok"\]/.test(CSS) && /#acctSmToggle\[aria-expanded="false"\] #acctSmChevron/.test(CSS) && /\.ac-docframe/.test(CSS));
  ok('shipments.css carries the monitoring list classes the script emits', ['.sm-row', '.sm-row-po', '.sm-row-sub', '.sm-mini', '.sm-filter-btn', '.sm-mgmt-doc-thumb', '.sm-mgmt-doc-btn'].every(c => SHIP.includes(c + ' {')));
}

/* ── 5 · the page script degrades under a DOM with no observers ──────────────────────────────── */
sec('5 · accounting-home-page.js');
{
  const p = page([], 'accounting-home.html', { role: 'accounting', name: 'Neil Estur', username: 'neil' }, {
    data: { getInvoices: [{ totalSales: 1000, totalCOGS: 600 }], getAPAging: [{ status: 'Open', amountPHP: 500, paidPHP: 100 }], getInventory: [{ totalLanded: 250 }], getExpenses: [{ amount: 50 }] }
  });
  p.run('flowNum = v => Number(v) || 0; flowMoney = (v) => "PHP " + v; flowStockItems = a => a; flowActionsStrip = function (id) { __strip = id; };');
  let threw = null;
  try { p.run(PJS); } catch (e) { threw = e.message; }
  ok('the script registers without matchMedia / MutationObserver / IntersectionObserver', threw === null, threw);
  ok('  the date landed in the rail', /^\d{2}$/.test(p.els.hbDay.textContent) && /\w{3} \w+/.test(p.els.hbMon.textContent), [p.els.hbDay.textContent, p.els.hbMon.textContent]);
  ok('  the day line is the long date', /\w+day, \w+ \d{1,2}, \d{4}/.test(p.els.todayLabel.textContent), p.els.todayLabel.textContent);
  eq('  the three named globals exist', ['acctOpenDocViewer', 'acctCloseDocViewer', 'acctSmToggleSection'].map(n => p.run('typeof ' + n)).join(','), 'function,function,function');
  p.run("acctOpenDocViewer('Packing list', 'https://drive.google.com/file/d/ABC123/view')");
  ok('  the viewer shows a preview iframe for a Drive file', p.els.acctDocViewerOverlay.style.display === 'flex' && /class="ac-docframe" src="https:\/\/drive\.google\.com\/file\/d\/ABC123\/preview"/.test(p.els.acctDocViewerBody.innerHTML) && p.els.acctDocViewerOpenBtn.href === 'https://drive.google.com/file/d/ABC123/view', p.els.acctDocViewerBody.innerHTML);
  p.run("acctOpenDocViewer('Folder', 'https://drive.google.com/drive/folders/XYZ')");
  ok('  and a fallback link for a folder', /class="ac-docfallback"/.test(p.els.acctDocViewerBody.innerHTML));
  p.run('acctCloseDocViewer()');
  ok('  close hides it and empties the body', p.els.acctDocViewerOverlay.style.display === 'none' && p.els.acctDocViewerBody.innerHTML === '');
  p.run('acctSmToggleSection(document.getElementById("acctSmToggle"))');
  ok('  the monitoring body collapses', p.els.acctSmBody.style.display === 'none');
  p.run('acctSmToggleSection(document.getElementById("acctSmToggle"))');
  ok('  and opens again', p.els.acctSmBody.style.display === '');
  (async () => {
    try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.message; }
    ok('  its DOMContentLoaded body runs on the stub DOM', threw === null, threw);
    eq('  the strip is mounted on #flowActionCenter', p.run('typeof __strip === "string" ? __strip : null'), 'flowActionCenter');
    ok('  the KPI snapshot filled the slab', p.els.kpiSales.textContent === 'PHP 1000' && p.els.kpiCogs.textContent === 'PHP 600' && p.els.kpiGp.textContent === 'PHP 400' && p.els.kpiAp.textContent === 'PHP 400' && p.els.kpiInv.textContent === 'PHP 250' && p.els.kpiNet.textContent === 'PHP 350', [p.els.kpiSales.textContent, p.els.kpiGp.textContent, p.els.kpiAp.textContent, p.els.kpiNet.textContent]);
    eq('  the margin line', p.els.kpiGpMargin.textContent, '40% margin on sales');
    eq('  the tag reads live', p.els.kpiState.textContent, 'Live from the process flow');
    await boot6();
  })();
}

/* ── 6 · boot accounting-home.js against the real markup ─────────────────────────────────────── */
async function boot6() {
  sec('6 · accounting-home.js on the new markup');
  const p = page(['js/stage-meta.js', 'js/accounting-home.js'], 'accounting-home.html', { role: 'accounting', name: 'Neil Estur', username: 'neil' });
  p.run(`requireAccounting = function(){ return __session; }; requireAcctOrAdmin = function(){ return __session; }; clearApiCache = function(){}; getGreeting = n => 'Hi ' + n;
         fetchFromAPI = async (q) => q && q.action === 'getShipments' ? { success: true, data: [
           { shipmentId: 'SH-1', poNo: 'PO-1', client: 'Holcim', principal: 'Enerpac', mode: 'SEA', eta: '2026-10-20', status: 'In Transit', documents: '{"po_issued":[{"name":"PO.pdf"}]}' },
           { shipmentId: 'SH-2', poNo: 'PO-2', client: 'Eagle', principal: 'Hilti', mode: 'AIR', eta: '2026-10-02', status: 'Arrived', documents: '{}' } ] } : { success: true, data: [] };`);
  let threw = null;
  try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  eq('  the summary line', p.els.acctSmSummary.textContent, '2 shipments · 1 in transit · 1 arrived');
  ok('  the list renders classed rows with classed badges and the doc count', (p.els.acctSmContainer.innerHTML.match(/class="sm-row"/g) || []).length === 2 && /class="sbadge sbadge-intransit"/.test(p.els.acctSmContainer.innerHTML) && /<span>1 doc<\/span>/.test(p.els.acctSmContainer.innerHTML), p.els.acctSmContainer.innerHTML.slice(0, 300));
  ok('  the recent list renders .sm-mini rows with .po / .sub and a badge', (p.els.acctSmRecent.innerHTML.match(/class="sm-mini"/g) || []).length === 2 && /class="po">PO-1</.test(p.els.acctSmRecent.innerHTML) && /class="sub">Enerpac, SEA, ETA 2026-10-20</.test(p.els.acctSmRecent.innerHTML) && /sbadge-arrived/.test(p.els.acctSmRecent.innerHTML), p.els.acctSmRecent.innerHTML.slice(0, 300));
  ok('  no inline style in what it rendered', !/style="/.test(p.els.acctSmContainer.innerHTML) && !/style="/.test(p.els.acctSmRecent.innerHTML));
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
