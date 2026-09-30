/* A297 — the accounting Financial Reports page's CONTRACT: a read-only page, what it must keep, and
 * what it must never carry.
 *
 * Run:  node tests/flow/financial-reports-contract.js
 *
 * financial-reports.js writes every figure by id from four reads and touches nothing else; the
 * markup offers a year picker and a refresh button and no other control. Section 1 pins the shell,
 * 2 every id with its tag and the one block born hidden, 3 what the page must never carry (an
 * input, a second select, an inline style other than display:none, a literal colour, an emoji),
 * 4 the sheet's scope and the navbar link, 5 the script under a DOM with no observers and no
 * canvas, and 6 boots it against a small fixture and checks the arithmetic on the page. */
const fs = require('fs');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'financial-reports.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/financial-reports.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/financial-reports.js', 'utf8');
const AUTH = fs.readFileSync(D + 'js/auth.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{269F}\u{26A1}-\u{2708}\u{270A}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/u;
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','), 'styles.css,financial-reports.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="fr"> — the scope every rule hangs off', /<body class="fr">/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="fr">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,flow-api.js,financial-reports.js');
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab and the nav, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && /<nav class="hx-rail-nav"/.test(HTML) && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));
eq('the rail links the five sections', (HTML.match(/<nav class="hx-rail-nav"[\s\S]*?<\/nav>/) || [''])[0].match(/href="#(\w+)"/g).map(s => s.slice(7, -1)).join(','), 'expenses,sales,cogs,collections,receivables');

/* ── 2 · every id the script reaches for, with the tag it expects ─────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  b: ['hbDay', 'frExpDailyTotal', 'frExpWeeklyTotal', 'frExpMonthlyTotal', 'frAgeCur', 'frAge30', 'frAge60', 'frAge60p'],
  span: ['hbMon', 'frSlabYear', 'frUndated', 'frExpMeta', 'frSalesMeta', 'frCogsMeta', 'frCollMeta', 'frArMeta', 'frDueMeta', 'frOverdueMeta'],
  dd: ['frSlabSales', 'frSlabCogs', 'frSlabGp', 'frSlabExp', 'frSlabCollected', 'frSlabOverdue', 'frSlabOpenAr'],
  div: ['frSlabNet', 'frSlabSub', 'frExpDaily', 'frExpWeekly', 'frExpMonthly', 'frTopCats', 'frAging', 'frNoDueWrap'],
  canvas: ['frExpDailyChart', 'frExpWeeklyChart', 'frExpMonthlyChart', 'frSalesChart', 'frCogsChart', 'frCollChart'],
  table: ['frTopTable', 'frSalesTable', 'frYearlyTable', 'frCogsTable', 'frCollTable', 'frDueTable', 'frOverdueTable', 'frNoDueTable'],
  section: ['spot', 'expenses', 'sales', 'cogs', 'collections', 'receivables'],
  button: ['themeToggle', 'frRefresh', 'frExpTabDaily', 'frExpTabWeekly', 'frExpTabMonthly', 'frTopTabDay', 'frTopTabWeek', 'frTopTabMonth', 'frTopTabYear'],
  select: ['frYear'],
  header: ['navbar'],
  aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
const reached = Array.from(new Set((JS.match(/\$\('([^']+)'\)|setText\('([^']+)'|setTable\('([^']+)'|chart\('([^']+)'/g) || []).map(s => s.match(/'([^']+)'/)[1])));
reached.filter(id => /^(hb|fr)/.test(id)).forEach(id => ok('financial-reports.js reaches #' + id + ' and it exists', !!tagOf(id)));
ok('#frSlabNet is the slab\'s value and #frSlabYear its tag', /<div class="v" id="frSlabNet">/.test(HTML) && /<span class="tag" id="frSlabYear">/.test(HTML));
ok('the no-due-date block starts hidden; nothing else does', /style="display:none;"/.test(tagAttrs('frNoDueWrap')) && /style="display:none;"/.test(tagAttrs('frUndated')));
ok('the first expense tab and its panel start active', /class="hx-tab active" id="frExpTabDaily"/.test(HTML) && /class="hx-panel active" id="frExpDaily"/.test(HTML) && /class="hx-panel" id="frExpWeekly"/.test(HTML));
ok('the first top-expenses tab starts active', /class="hx-tab active" id="frTopTabDay"/.test(HTML));

/* ── 3 · a read-only page ─────────────────────────────────────────────────────────────────────── */
sec('3 · read-only, and no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no <input>, <textarea>, <form> or contenteditable', !/<input|<textarea|<form|contenteditable/i.test(HTML));
eq('exactly one <select>, the year picker', (HTML.match(/<select/g) || []).length, 1);
eq('the buttons are the theme toggle, refresh and the seven tabs', (HTML.match(/<button/g) || []).length, 9);
ok('no inline handlers', !/\son\w+="/.test(HTML));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the script defines no globals', !/window\.\w+\s*=/.test(JS) && /\(function \(\) \{\s*'use strict';/.test(JS));
ok('  no chrome emoji in the script', !EMOJI_JS.test(JS), (JS.match(EMOJI_JS) || [])[0]);
ok('  it never posts', !/postFlow\(/.test(JS));
ok('  it reads the four actions and nothing else', ["fetchFlow('getInvoices'", "fetchFlow('getExpenses'", "fetchFlow('getARAging'", "fetchFlow('getCollections'"].every(c => JS.includes(c)) && (JS.match(/fetchFlow\('/g) || []).length === 4);
ok('  refresh bypasses the cache', /\{ fresh: true \}/.test(JS));
ok('  charts are rebuilt on hx:theme and read tokens at draw time', /'hx:theme'/.test(JS) && /function hx\(name, fallback\) \{ return hxToken\(name, fallback\); \}/.test(JS));
ok('  the accounting guard runs at load', /requireAccounting\(\)/.test(JS) && /renderNavbar\('financial-reports'\)/.test(JS));

/* ── 4 · the sheet and the navbar ─────────────────────────────────────────────────────────────── */
sec('4 · financial-reports.css and the Reports menu');
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = []; let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') { const sel = buf.trim(); if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^body\.fr/.test(sel)) bad.push(sel.slice(0, 60)); depth++; buf = ''; }
    else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch;
  }
  ok('every selector is scoped body.fr', bad.length === 0, bad.slice(0, 5));
  ok('no literal colour and no dark-era fallback', !HEX.test(stripped) && !/var\(--[\w-]+,\s*#/.test(stripped), stripped.match(HEX));
  ok('no keyframes of its own', !/@keyframes/.test(CSS));
  ok('no hover-lift', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('a reduced-motion block', /prefers-reduced-motion: reduce/.test(CSS));
  ok('the chart hosts, the split, the aging tiles and the year picker are styled', ['.fr-chart {', '.fr-split {', '.fr-tile {', '.fr-year {', '.fr-total {'].every(c => CSS.includes('body.fr ' + c)));
  ok('auth.js links the page in the accounting Reports menu', /<a href="financial-reports\.html" class="\$\{activePage === 'financial-reports' \? 'active' : ''\}">Financial Reports<\/a>/.test(AUTH));
  ok('  and the menu lights up on it', /reportsActive = \[[^\]]*'financial-reports'[^\]]*\]/.test(AUTH));
}

/* ── 5 · the script under a DOM with no observers and no canvas ──────────────────────────────── */
sec('5 · financial-reports.js on the stub DOM');
const T = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const Y = T.slice(0, 4), PREV = String(Number(Y) - 1), M = T.slice(5, 7);
const shift = (n) => { const d = new Date(T + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const FIX = {
  getInvoices: [
    { invNo: 'INV-1', soNo: 'SO-1', date: T, customer: 'Holcim', totalSales: 1000, totalCOGS: 600 },
    { invNo: 'INV-2', soNo: 'SO-2', date: Y + '-01-15', customer: 'Eagle', totalSales: 500, totalCOGS: 200 },
    { invNo: 'INV-0', soNo: 'SO-0', date: PREV + '-' + M + '-10', customer: 'Holcim', totalSales: 800, totalCOGS: 500 },
  ],
  getExpenses: [
    { expNo: 'EXP-1', date: T, category: 'Fuel', description: 'Diesel', amount: 50 },
    { expNo: 'EXP-2', date: shift(-10), category: 'Meals', description: 'Site lunch', amount: 30 },
    { expNo: 'EXP-3', date: shift(-45), category: 'Fuel', description: 'Diesel', amount: 20 },
    { expNo: 'EXP-4', date: '', category: 'Toll', description: 'undated', amount: 999 },
  ],
  getARAging: [
    { arNo: 'AR-1', invNo: 'INV-A', customer: 'Holcim', amountPHP: 400, collectedPHP: 0, outstanding: 400, status: 'Unpaid', dueDate: shift(-45) },
    { arNo: 'AR-2', invNo: 'INV-B', customer: 'Eagle', amountPHP: 500, collectedPHP: 200, outstanding: 300, status: 'Partial', dueDate: shift(5) },
    { arNo: 'AR-3', invNo: 'INV-C', customer: 'Mincon', amountPHP: 100, collectedPHP: 0, outstanding: 100, status: 'Unpaid', dueDate: '' },
    { arNo: 'AR-4', invNo: 'INV-D', customer: 'Paid Co', amountPHP: 900, collectedPHP: 900, outstanding: 0, status: 'Paid', dueDate: shift(-90) },
  ],
  getCollections: [{ collectionNo: 'COL-1', invNo: 'INV-B', date: T, amount: 250 }],
};
const EXP_Y = FIX.getExpenses.filter(e => e.date && e.date.slice(0, 4) === Y).reduce((s, e) => s + e.amount, 0);
const peso = (v) => '₱' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const p = page([], 'financial-reports.html', { role: 'accounting', name: 'Neil Estur', username: 'neil' }, { data: FIX });
p.run('requireAccounting = function(){ return __session; }; loadLib = function(){ return Promise.resolve(); };');
let threw = null;
try { p.run(JS); } catch (e) { threw = e.stack; }
ok('the script registers without matchMedia / IntersectionObserver / canvas', threw === null, threw);
ok('  the date landed in the rail', /^\d{2}$/.test(p.els.hbDay.textContent) && /\w{3} \w+/.test(p.els.hbMon.textContent), [p.els.hbDay.textContent, p.els.hbMon.textContent]);
eq('  nothing was fetched before DOMContentLoaded', p.run('__calls.length'), 0);

/* ── 6 · boot against the fixture ─────────────────────────────────────────────────────────────── */
(async () => {
  sec('6 · the arithmetic on the page');
  try { await p.boot(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  eq('  exactly the four reads, once each', p.run('__calls.join(",")'), 'getInvoices,getExpenses,getARAging,getCollections');
  eq('  the slab tag is the current year', p.els.frSlabYear.textContent, Y);
  eq('  the year picker offers both years, newest first', p.els.frYear.innerHTML, `<option value="${Y}" selected>${Y}</option><option value="${PREV}">${PREV}</option>`);
  eq('  invoiced sales for the year', p.els.frSlabSales.textContent, peso(1500));
  eq('  cost of goods', p.els.frSlabCogs.textContent, peso(800));
  eq('  gross profit', p.els.frSlabGp.textContent, peso(700));
  eq('  expenses for the year (the undated one left out)', p.els.frSlabExp.textContent, peso(EXP_Y));
  eq('  net = gross profit less expenses', p.els.frSlabNet.textContent, peso(700 - EXP_Y));
  eq('  collected this year', p.els.frSlabCollected.textContent, peso(250));
  eq('  overdue outstanding', p.els.frSlabOverdue.textContent, peso(400));
  eq('  open receivables, the paid row excluded', p.els.frSlabOpenAr.textContent, peso(800));
  eq('  the undated note counts the one record', p.els.frUndated.textContent, '1 record without a date left out.');
  eq('  and is shown', p.els.frUndated.style.display, '');
  eq('  daily total = the last 30 days (today + 10 days ago)', p.els.frExpDailyTotal.textContent, peso(80));
  eq('  weekly total = the last 12 weeks (all three dated)', p.els.frExpWeeklyTotal.textContent, peso(100));
  ok('  top expenses today = the one record, with its category chip', /<td class="num">₱50\.00<\/td>/.test(p.els.frTopTable.innerHTML) && (p.els.frTopTable.innerHTML.match(/<tr>/g) || []).length === 3 && /Fuel <span class="n">₱50<\/span>/.test(p.els.frTopCats.innerHTML), [p.els.frTopTable.innerHTML, p.els.frTopCats.innerHTML]);
  ok('  the sales table compares this month to the same month last year: +25.0%', /<td class="num hx-pos">\+25\.0%<\/td>/.test(p.els.frSalesTable.innerHTML) && new RegExp('<th class="num">' + PREV + ' same month</th>').test(p.els.frSalesTable.innerHTML), p.els.frSalesTable.innerHTML.slice(0, 600));
  ok('  the sales meta carries the year-to-date change', /2 invoices in \d{4}, ₱1,500\.00, \+87\.5% against the same months of/.test(p.els.frSalesMeta.textContent), p.els.frSalesMeta.textContent);
  ok('  the yearly table lists both years, newest first', new RegExp('<tbody><tr><td>' + Y + '</td><td class="num">2</td>').test(p.els.frYearlyTable.innerHTML) && new RegExp('<tr><td>' + PREV + '</td><td class="num">1</td><td class="num">₱800\\.00</td>').test(p.els.frYearlyTable.innerHTML), p.els.frYearlyTable.innerHTML.slice(0, 400));
  ok('  cost of goods per sale: two invoices, newest first, with margins', (p.els.frCogsTable.innerHTML.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].indexOf('INV-1') < (p.els.frCogsTable.innerHTML.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].indexOf('INV-2') && /<td class="num">40\.0%<\/td>/.test(p.els.frCogsTable.innerHTML) && /<td class="num">60\.0%<\/td>/.test(p.els.frCogsTable.innerHTML), p.els.frCogsTable.innerHTML.slice(0, 500));
  eq('  the cost-of-goods meta', p.els.frCogsMeta.textContent, '2 invoices in ' + Y + ', 46.7% blended margin');
  eq('  collections meta: 250 against 1,500', p.els.frCollMeta.textContent, '₱250.00 collected against ₱1,500.00 invoiced in ' + Y + ', 16.7%');
  ok('  the collections table has twelve months and a year footer', (p.els.frCollTable.innerHTML.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].split('<tr>').length - 1 === 12 && new RegExp('<tfoot><tr><td>' + Y + '</td><td class="num">₱1,500\\.00</td><td class="num">₱250\\.00</td><td class="num">16\\.7%</td>').test(p.els.frCollTable.innerHTML), p.els.frCollTable.innerHTML.slice(-300));
  eq('  aging: not yet due (the 5-day row and the no-due row)', p.els.frAgeCur.textContent, peso(400));
  eq('  aging: 31 to 60 days late', p.els.frAge60.textContent, peso(400));
  eq('  aging: the other buckets are empty', p.els.frAge30.textContent + '|' + p.els.frAge60p.textContent, peso(0) + '|' + peso(0));
  ok('  due in the next 30 days: one row, in 5 days, flagged due soon', (p.els.frDueTable.innerHTML.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].split('<tr>').length - 1 === 1 && /badge badge-warning">Due soon/.test(p.els.frDueTable.innerHTML) && /<td class="num">5 d<\/td>/.test(p.els.frDueTable.innerHTML) && /INV-B/.test(p.els.frDueTable.innerHTML), p.els.frDueTable.innerHTML);
  ok('  overdue: one row, 45 days late, red badge', (p.els.frOverdueTable.innerHTML.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].split('<tr>').length - 1 === 1 && /badge badge-danger">45</.test(p.els.frOverdueTable.innerHTML) && /INV-A/.test(p.els.frOverdueTable.innerHTML), p.els.frOverdueTable.innerHTML);
  eq('  the overdue meta', p.els.frOverdueMeta.textContent, peso(400));
  ok('  no due date: the block is shown with the one row', p.els.frNoDueWrap.style.display === '' && /INV-C/.test(p.els.frNoDueTable.innerHTML) && !/INV-D/.test(p.els.frNoDueTable.innerHTML), [p.els.frNoDueWrap.style.display, p.els.frNoDueTable.innerHTML]);
  eq('  receivables meta', p.els.frArMeta.textContent, '3 open invoices, ₱800.00 outstanding');
  ok('  every table the script wrote is classed, with no inline style', ['frTopTable', 'frSalesTable', 'frYearlyTable', 'frCogsTable', 'frCollTable', 'frDueTable', 'frOverdueTable', 'frNoDueTable'].every(id => !/style="/.test(p.els[id].innerHTML)));

  /* an empty backend: every section says so instead of drawing nothing */
  const q = page([], 'financial-reports.html', { role: 'accounting', name: 'Neil Estur', username: 'neil' }, { data: {} });
  q.run('requireAccounting = function(){ return __session; }; loadLib = function(){ return Promise.resolve(); };');
  q.run(JS);
  try { await q.boot(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('an empty backend boots', threw === null, threw);
  eq('  the slab shows a dash', q.els.frSlabNet.textContent, '—');
  ok('  the year picker still offers the current year', q.els.frYear.innerHTML === `<option value="${Y}" selected>${Y}</option>`, q.els.frYear.innerHTML);
  ok('  every table carries its empty line', /hx-empty/.test(q.els.frTopTable.innerHTML) && /hx-empty/.test(q.els.frSalesTable.innerHTML) && /hx-empty/.test(q.els.frCogsTable.innerHTML) && /hx-empty/.test(q.els.frCollTable.innerHTML) && /hx-empty/.test(q.els.frDueTable.innerHTML) && /hx-empty/.test(q.els.frOverdueTable.innerHTML));
  eq('  the no-due block stays hidden', q.els.frNoDueWrap.style.display, 'none');

  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
})();
