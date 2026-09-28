/* A294 — the marketing home's CONTRACT: what the rebuilt marketing-home.html must keep, and what
 * it must never carry again.
 *
 * Run:  node tests/flow/marketing-home-contract.js
 *
 * marketing-home.js reaches into the page by id with no null guards (the month picker, the
 * read-only tag, the metrics button, #kpis, #tabs, #panels, #msg, the two dialogs' every field),
 * management-flow.js drives the daily-reports block by the ids the management home uses. Section
 * 1 pins the shell, 2 every id with its tag and the hidden ones, 3 what the rebuild removed on
 * purpose (the hero, the inline script, colour and emoji in the script), 4 the sheet's scope and
 * motion, 5 the page script under a DOM with no observers, and 6 boots marketing-home.js against
 * the real markup and checks the scorecard, the tabs and a panel render classed and iconed. */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'marketing-home.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/marketing-home.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/marketing-home.js', 'utf8');
const PJS  = fs.readFileSync(D + 'js/marketing-home-page.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{269F}\u{26A1}-\u{2708}\u{270A}-\u{270D}\u{270F}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/u;   // ✓ ✕ ✉ ✎ ⚠ stay
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','), 'styles.css,flow.css,daily-reports.css,marketing-home.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="mk"> — the scope every rule hangs off', /<body class="mk">/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="mk">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','),
   'theme.js,api.js,salary-deduction-card.js,auth.js,flow-api.js,marketing-home.js,report-render.js,report-pdf.js,team-performance.js,management-flow.js,marketing-home-page.js');
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab and the nav, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && /<nav class="hx-rail-nav"/.test(HTML) && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  h1: [], h3: ['recModalTitle'],
  p: ['heroSub'],
  b: ['hbDay'],
  span: ['hbMon', 'roTag', 'mgmtDrMeta', 'mfTwRange', 'metMonthLabel'],
  div: ['kpis', 'tabs', 'tabsSeg', 'panels', 'msg', 'recModal', 'recForm', 'recFormMsg', 'metModal', 'metMsg', 'mgmtDrUsers', 'mgmtDrMovements', 'mgmtDrDocs', 'mgmtDrSales', 'mgmtDrPdfs', 'mgmtDrBody', 'mfTwBody'],
  section: ['spot', 'myDeductionCard', 'trackers', 'newsec-daily-reports'],
  button: ['themeToggle', 'metricsBtn', 'recSaveBtn', 'metSaveBtn', 'mfTwReset', 'mfTwNext', 'mfTwPdfBtn'],
  input: ['monthSel', 'recEntity', 'recRowIndex', 'metVisits', 'metFollowers', 'metNotes', 'mgmtDrDate', 'mgmtDrSearch'],
  header: ['navbar'], aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
const reached = (src) => Array.from(new Set((src.match(/getElementById\('([^']+)'\)/g) || []).map(s => s.match(/'([^']+)'/)[1])));
// pSearch / pStatus / pAdd / pBody are built by renderPanel at runtime
reached(JS).filter(id => !['pSearch', 'pStatus', 'pAdd', 'pBody'].includes(id)).forEach(id => ok('marketing-home.js reaches #' + id + ' and it exists', !!tagOf(id)));
ok('#kpis sits inside the slab and #monthSel in its cap', HTML.indexOf('id="kpis"') > HTML.indexOf('id="spot"') && HTML.indexOf('id="kpis"') < HTML.indexOf('</section>') && /<div class="cap"><span class="l">Scorecard<\/span><input type="month" id="monthSel"/.test(HTML));
ok('#tabs sits inside #tabsSeg next to the indicator (the page script slides it)', /id="tabsSeg"><span class="hx-seg-ind"><\/span><div class="hx-seg-track" id="tabs"><\/div>/.test(HTML));
ok('#roTag, #myDeductionCard, #msg, #recFormMsg, #metMsg, #mfTwReset start hidden', ['roTag', 'myDeductionCard', 'msg', 'recFormMsg', 'metMsg', 'mfTwReset'].every(id => /style="display:none;"/.test(tagAttrs(id))));
ok('the two dialogs keep flow-modal-overlay (the script toggles .open on them)', ['recModal', 'metModal'].every(id => /class="flow-modal-overlay"/.test(tagAttrs(id))));
ok('#recSaveBtn and #metSaveBtn read exactly "Save" (the script restores that text after saving)', /id="recSaveBtn" onclick="submitRecord\(\)">Save</.test(HTML) && /id="metSaveBtn" onclick="submitMetrics\(\)">Save</.test(HTML));
ok('the weekly report keeps its four inline handlers', ['mfTwNav(-1)', 'mfTwNav(0)', 'mfTwNav(1)', 'mfTwPdf()'].every(h => HTML.includes('onclick="' + h + '"')));
ok('the message hosts carry .flow-msg (flow.css paints .ok / .bad)', ['msg', 'recFormMsg', 'metMsg'].every(id => /class="flow-msg"/.test(tagAttrs(id))));

/* ── 3 · what the rebuild removed on purpose ──────────────────────────────────────────────────── */
sec('3 · no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the hero, the mgmt-newsec chrome and mgmtToggleNewsec are gone', !/mkt-hero|mgmt-newsec|mgmtToggleNewsec|newsec-chevron|mkt-kpis|mkt-tabs/.test(HTML));
ok('marketing-home.js writes no hex colour and no inline colour', !/#[0-9a-fA-F]{6}\b/.test(JS) && !/style\.color/.test(JS) && !/style="/.test(JS));
ok('  no emoji (the icon map is SVG)', !EMOJI_JS.test(JS), (JS.match(EMOJI_JS) || [])[0]);
ok('  the icon map exists and every entity and tile names a key in it', (() => {
  const m = JS.match(/const MK_ICON = \{([\s\S]*?)\n\};/); if (!m) return false;
  const keys = (m[1].match(/^\s*(\w+):/gm) || []).map(s => s.trim().replace(':', ''));
  const used = (JS.match(/icon: '(\w+)'/g) || []).map(s => s.match(/'(\w+)'/)[1])
    .concat((JS.match(/(?:true|false|'100%'), '(\w+)'\)/g) || []).map(s => s.match(/'(\w+)'\)$/)[1]))
    .concat((JS.match(/mkIcon\('(\w+)'\)/g) || []).map(s => s.match(/'(\w+)'/)[1]));
  return used.length >= 15 && used.every(k => keys.includes(k));
})());
ok('  every message writes a class, never a colour', /m\.className = 'flow-msg ' \+ \(ok \? 'ok' : 'bad'\)/.test(JS) && /className = 'flow-msg bad'/.test(JS));
ok('  the panel host scrolls: id="pBody" class="hx-scroll"', /id="pBody" class="hx-scroll"/.test(JS));
ok('marketing-home-page.js writes no hex colour and defines no global', !/#[0-9a-fA-F]{6}\b/.test(PJS) && !/window\.\w+\s*=/.test(PJS));

/* ── 4 · the sheet ────────────────────────────────────────────────────────────────────────────── */
sec('4 · marketing-home.css');
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = []; let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') { const sel = buf.trim(); if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^(body\.mk|html\[data-theme="dark"\] body\.mk)/.test(sel)) bad.push(sel.slice(0, 60)); depth++; buf = ''; }
    else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch;
  }
  ok('every selector is scoped body.mk', bad.length === 0, bad.slice(0, 5));
  const lits = (stripped.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []).filter(h => !/^#fff$/i.test(h));
  ok('no literal colour but white on navy, and no dark-era fallback', lits.length === 0 && !/var\(--[\w-]+,\s*#/.test(stripped), lits);
  ok('@keyframes mkIn exists and animates transform and opacity only', /@keyframes mkIn /.test(CSS) && !/(^|[^-])(width|height|top|left|margin|padding|background)\s*:/.test((CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n')));
  ok('no hover-lift', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('the load moment is gated by body.mk.mk-load', /body\.mk\.mk-load \.mk-kpis \.kpi \{ animation: mkIn/.test(CSS));
  ok('a reduced-motion block', /prefers-reduced-motion: reduce[\s\S]*body\.mk \*[\s\S]*animation: none !important/.test(CSS));
  ok('the scorecard tiles, the tabs, the badges, the form and the rhythm are styled', ['.mk-kpis .kpi.hero-kpi', '#tabs .mkt-tab.active', '.mkt-badge', '.b-good', '.mkt-form', '.rhythm-col label.done', '.dr-tiles .dr-tile', '.flow-modal.mk-wide'].every(c => CSS.includes(c + ' {') || CSS.includes(c + ',')));
}

/* ── 5 · the page script degrades under a DOM with no observers ──────────────────────────────── */
sec('5 · marketing-home-page.js');
{
  const p = page([], 'marketing-home.html', { role: 'marketing', name: 'Ana Reyes', username: 'ana' });
  let threw = null;
  try { p.run(PJS); } catch (e) { threw = e.message; }
  ok('the script registers without matchMedia / MutationObserver / IntersectionObserver', threw === null, threw);
  ok('  the date landed in the rail', /^\d{2}$/.test(p.els.hbDay.textContent) && /\w{3} \w+/.test(p.els.hbMon.textContent), [p.els.hbDay.textContent, p.els.hbMon.textContent]);
  (async () => {
    try { await p.boot(); } catch (e) { threw = e.message; }
    ok('  its DOMContentLoaded body runs on the stub DOM', threw === null, threw);
    await boot6();
  })();
}

/* ── 6 · boot marketing-home.js against the real markup ───────────────────────────────────────── */
async function boot6() {
  sec('6 · marketing-home.js on the new markup');
  const p = page(['js/marketing-home.js'], 'marketing-home.html', { role: 'marketing', name: 'Ana Reyes', username: 'ana' }, {
    data: { getMarketing: { leads: [{ rowIndex: 2, date: '2026-09-10', company: 'Holcim', contact: 'R. Santos', industry: 'Cement', source: 'LinkedIn', status: 'MQL' }], campaigns: [], content: [], enablement: [{ name: 'Deck', status: 'Current' }], events: [], principal: [], metrics: [] } }
  });
  p.run(`requireMarketingAccess = function(){ return __session; }; flowNum = v => Number(v) || 0; flowMoney = (v) => 'PHP ' + v; flowEsc = s => String(s == null ? '' : s); flowDate = d => String(d || '').slice(0, 10); flowToday = () => '2026-09-28';
         document.getElementById('monthSel').value = '2026-09';`);
  // renderPanel builds pSearch/pStatus/pAdd/pBody at runtime; the stub DOM needs them by id
  ['pSearch', 'pStatus', 'pAdd', 'pBody'].forEach(id => { p.els[id] = { id, value: '', innerHTML: '', textContent: '', style: {}, addEventListener() {}, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }; });
  let threw = null;
  try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  eq('  the scorecard draws eight tiles', (p.els.kpis.innerHTML.match(/class="kpi/g) || []).length, 8);
  ok('  the first is the headline with its pill, and every tile carries an SVG icon', /^<div class="kpi hero-kpi"><span class="pill pill-top">HIGHEST<\/span>/.test(p.els.kpis.innerHTML) && (p.els.kpis.innerHTML.match(/<span class="ico"><svg/g) || []).length === 8, p.els.kpis.innerHTML.slice(0, 200));
  ok('  MQLs this month = 1 (the September MQL)', /class="l"><span class="ico"><svg[^]*?<\/svg><\/span>MQLs generated<\/div><div class="v">1<\/div>/.test(p.els.kpis.innerHTML), p.els.kpis.innerHTML.slice(0, 400));
  ok('  the tabs carry icons and counts, the first active', /^<div class="mkt-tab active" data-tab="leads"><span class="ico"><svg/.test(p.els.tabs.innerHTML) && /<span class="cnt">1<\/span>/.test(p.els.tabs.innerHTML) && /data-tab="rhythm"><span class="ico"><svg[^]*?<\/svg><\/span>Task rhythm</.test(p.els.tabs.innerHTML), p.els.tabs.innerHTML.slice(0, 200));
  ok('  the panel renders a toolbar with an iconed title and a scrolling host', /<h3><span class="ico"><svg/.test(p.els.panels.innerHTML) && /id="pBody" class="hx-scroll"/.test(p.els.panels.innerHTML) && !/style="/.test(p.els.panels.innerHTML), p.els.panels.innerHTML.slice(0, 300));
  p.run("flash('Saved.', true)");
  // the stub's setTimeout runs at once, so the 4 s auto-hide has already fired; the class and the text are the point
  ok('  flash writes flow-msg ok', p.els.msg.className === 'flow-msg ok' && p.els.msg.textContent === 'Saved.');
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
