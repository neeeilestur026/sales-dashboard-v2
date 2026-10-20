/* A340 — the pricing engine page (director-pricing-engine.html) and its place on the director dashboard.
 *
 * Run:  node tests/flow/pricing-engine-page.js
 *
 * Pinned: the page follows the site rules; only the director gets in and only the director's navbar,
 * rail and home link it; it talks to FlowAPI only through its own pe* actions (never a quotation,
 * pricing-request, inventory or order action, and never the older pricing engines); what the director
 * types is shown as text; and Save sends the inputs and the result together.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const H = read('director-pricing-engine.html'), JS = read('js/director-pricing-engine.js'), ENG = read('js/pe-engine.js');
const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');

console.log('\n1 · the page');
const scripts = (h) => (h.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(',');
eq('scripts in order', scripts(H), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,pe-engine.js,director-pricing-engine.js');
ok('its own stylesheet, before ledger.css and apple.css (last)', /css\/pricing-engine\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H));
ok('one one-line inline script, no <style>, no style="", no onclick', (H.match(/<script>/g) || []).length === 1 && !/<style[\s>]/.test(H) && !/style="/.test(H) && !/onclick=/.test(H + JS));
ok('director only: requireDirector, and its own navbar entry', /peSession = requireDirector\(\);/.test(JS) && /renderNavbar\('director-pricing-engine'\)/.test(JS));

console.log('\n2 · separate from quotations and pricing');
const actions = (src) => Array.from(new Set((src.match(/(?:postFlow|fetchFlow)\('([A-Za-z]+)'/g) || []).map(s => s.match(/'([A-Za-z]+)'/)[1]))).sort();
eq('the page calls only its own actions', actions(JS), ['peGetRecord', 'peGetTables', 'peListRecords', 'peSaveRecord', 'peSaveTables', 'peSetApprovalCode']);
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
const code = (JS + ENG).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, '');
const foreign = HANDLERS.filter(h => !/^pe[A-Z]/.test(h) && h !== 'getVersion' && new RegExp('\\b' + h + '\\b').test(code));
ok('no other FlowAPI action appears in its code (of ' + HANDLERS.length + ')', HANDLERS.length > 100 && foreign.length === 0, foreign);
ok('nor the older pricing engines', !/flowCalcItem|calculateItem|FLOW_PRINCIPALS|FLOW_DESTINATIONS|pricing\.js|flow-pricing-engine/.test(code));
ok('no other page loads the engine', fs.readdirSync(D).filter(f => f.endsWith('.html') && f !== 'director-pricing-engine.html').every(f => !/pe-engine\.js|director-pricing-engine\.js/.test(read(f))));

console.log('\n3 · who sees it');
function navFor(role) {
  const store = { session: JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) };
  let html = '';
  const c = { console, window: {}, localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { href: '', pathname: '/x.html', search: '' },
    document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
      getElementById: (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } };
        if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; } },
    fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
  c.window = c; vm.createContext(c); require('./hxutil').load(c); vm.runInContext(AUTH, c); vm.runInContext(NAV, c);
  c.renderNavbar('x');
  return { classic: /href="director-pricing-engine\.html"/.test(html), rail: vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', c).indexOf('director-pricing-engine.html') >= 0, c };
}
['director', 'admin', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing'].forEach(role => {
  const n = navFor(role), want = role === 'director';
  ok(role + (want ? ': navbar and rail link it' : ': no link'), n.classic === want && n.rail === want, n);
});
ok('the director\'s home has a Pricing engine button', /<a href="director-pricing-engine\.html" class="dh-btn">[\s\S]{0,400}Pricing engine/.test(read('director-home.html')));

console.log('\n4 · the page in use');
(async () => {
  const p = page(['js/pe-engine.js', 'js/director-pricing-engine.js'], 'director-pricing-engine.html', { username: 'n', name: 'Neil Estur', role: 'director' });
  p.run(`requireDirector = function(){ return __session; };
    var __posted = [];
    postFlow = function(a, params){ __posted.push({ a: a, p: params });
      if (a === 'peGetTables') return Promise.resolve({ success: true, tables: Object.assign(JSON.parse(JSON.stringify(PE.PE_DEFAULT_TABLES)), { version: 3, effectiveDate: '2026-10-17',
        forex: Object.assign(JSON.parse(JSON.stringify(PE.PE_DEFAULT_TABLES.forex)), { USD: { rate: 58.5, asOf: hxToday() }, SGD: { rate: 43.5, asOf: hxToday() } }) }), versions: [], codes: { director: true, president: false } });
      if (a === 'peSaveRecord') return Promise.resolve({ success: true, ref: 'PE-202610-001', revision: 1, message: 'PE-202610-001 saved as a draft.' });
      return Promise.resolve({ success: true, data: [] }); };`);
  await p.boot();
  ok('it loads its tables from FlowAPI', p.run('__posted.map(function(x){ return x.a; })').indexOf('peGetTables') >= 0 && p.run('peTables.version') === 3);
  ok('it prices the starting line straight away', p.run('peRes && peRes.lines.length') === 1 && /<table class="pe-table">/.test(p.els.peTable.innerHTML));
  p.run(`peQ.client = '<img src=x onerror=alert(1)>Acme'; peQ.lines[0].description = '"><script>alert(1)</script>'; peQ.lines[0].supplierPrice = 180; peRecalc(); peRenderOrder(); peRenderLines();`);
  const all = p.els.peTable.innerHTML + p.els.peExplain.innerHTML + p.els.peSummary.innerHTML + p.els.peLines.innerHTML + p.els.peOrder.innerHTML;
  ok('what the director types is shown as text, never markup', !/<script>alert|<img src=x/.test(all) && /&lt;script&gt;alert\(1\)/.test(p.els.peTable.innerHTML));
  ok('the summary shows the total, the band and the flags', /pe-total/.test(p.els.peSummary.innerHTML) && /Band/.test(p.els.peSummary.innerHTML));
  ok('the explanation is built from the numbers', /Supplier SGD 180 at 43\.5 \+ 3%/.test(p.els.peExplain.innerHTML));
  p.els.peStatusSel = { value: 'Draft' }; p.els.peCode = { value: '' }; p.els.peSave = { disabled: false };
  await p.run('peSave()');
  const sent = p.run("__posted.filter(function(x){ return x.a === 'peSaveRecord'; })[0]");
  ok('Save sends the inputs and the result, as a draft', sent && sent.p.status === 'Draft' && JSON.parse(sent.p.inputs).lines[0].supplierPrice === 180 && JSON.parse(sent.p.result).totals.netSale > 0, sent && sent.p);
  ok('and remembers the record it saved', p.run('peRef') === 'PE-202610-001');
  ok('nothing but its own actions went to FlowAPI', p.run('__posted.every(function(x){ return /^pe[A-Z]/.test(x.a); })') && p.calls.filter(c => !/^POST:pe|getVersion/.test(c)).length === 0, p.calls);

  const q = page(['js/pe-engine.js', 'js/director-pricing-engine.js'], 'director-pricing-engine.html', { username: 'n', name: 'Neil Estur', role: 'director' });
  q.run('requireDirector = function(){ return __session; }; flowVersionAtLeast = function(){ return Promise.resolve(false); };');
  await q.boot();
  ok('before FlowAPI 173 it still prices, with saving switched off', q.run('peRes.lines.length') === 1 && /Saving needs FlowAPI 173/.test(q.els.peStatus.innerHTML) && /id="peSave" disabled/.test(q.els.peSummary.innerHTML)
     && q.calls.filter(c => /^POST:/.test(c)).length === 0, q.calls);
  console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
