/* A316 — the warehouse scanner's pages, roles and client logic.
 *
 * Run:  node tests/flow/scan-contract.js
 *
 * The rules pinned here:
 *   1. scan.html / labels.html follow the site rules and load their scripts in order; the app manifest
 *      and service worker exist; the worker only ever touches same-origin GETs of the scanner shell.
 *   2. The role lists in the browser equal the ones FlowAPI.gs enforces.
 *   3. A warehouse login lands on the scanner, gets its own two-link navbar, and no action-strip nudges;
 *      accounting / admin / director get a Scanner link, management and sales do not.
 *   4. After signing in, a user sent away from the scanner goes back to it — and only to an allowed page.
 *   5. The scanner: our HXI label and a known barcode count on the right line; an unknown code asks to
 *      be linked; an item not on the document and a complete line are refused; the oldest open line of a
 *      repeated item fills first; the count is saved on the phone and restored; the post sends `lines`
 *      (never `items`) and never a price.
 *   6. Labels: the item list in the URL is parsed strictly.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');

console.log('\n1 · pages and app files');
const SCAN = read('scan.html'), LAB = read('labels.html');
const scripts = (h) => (h.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(',');
const sheets = (h) => (h.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(',');
eq('scan.html scripts', scripts(SCAN), 'theme.js,api.js,auth.js,flow-api.js,scan.js');
eq('scan.html sheets', sheets(SCAN), 'styles.css,scan.css');
eq('labels.html scripts', scripts(LAB), 'theme.js,api.js,auth.js,flow-api.js,labels.js');
eq('labels.html sheets', sheets(LAB), 'styles.css,labels.css');
[['scan.html', SCAN], ['labels.html', LAB]].forEach(([n, h]) => {
  ok(n + ': theme.js first in body, no inline style or script', /<body[^>]*>\s*<script src="js\/theme\.js"><\/script>/.test(h) && !/<style[\s>]/.test(h) && !/<script>/.test(h) && !/style="/.test(h));
});
ok('scan.html links the manifest and the iPhone icon', /<link rel="manifest" href="\/manifest\.webmanifest">/.test(SCAN) && /apple-touch-icon" href="images\/scan-icon-180\.png"/.test(SCAN));
const MAN = JSON.parse(read('manifest.webmanifest'));
ok('the manifest starts on the scanner, standalone, with 192 and 512 icons', MAN.start_url === '/scan.html' && MAN.display === 'standalone' &&
   MAN.icons.some(i => i.sizes === '192x192') && MAN.icons.some(i => i.sizes === '512x512'));
['scan-icon-180.png', 'scan-icon-192.png', 'scan-icon-512.png'].forEach(f => ok('  ' + f + ' exists', fs.existsSync(D + 'images/' + f)));
const SW = read('sw.js');
ok('the service worker ignores anything but GET', /if \(req\.method !== 'GET'\) return;/.test(SW));
ok('  and anything off this origin or outside the shell', /url\.origin !== self\.location\.origin \|\| SHELL\.indexOf\(url\.pathname\) === -1/.test(SW));
ok('  and the shell holds no API or data path', !/flow\/|script\.google|\/api\//.test((SW.match(/const SHELL = \[[\s\S]*?\];/) || [''])[0]));
const JS = read('js/scan.js');
ok('scan.js registers the worker scoped to the scanner page', /serviceWorker\.register\('\/sw\.js', \{ scope: '\/scan\.html' \}\)/.test(JS));
ok('scan.js writes no inline style', !/style=/.test(JS));
ok('the html5-qrcode library is pinned to an exact version', /html5-qrcode@\d+\.\d+\.\d+\/html5-qrcode\.min\.js/.test(JS));

console.log('\n2 · the role lists match the backend');
const AUTH = read('js/auth.js');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const jsList = (name) => JSON.parse(AUTH.match(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);'))[1].replace(/'/g, '"')).sort().join(',');
const gsSet = (name) => Object.keys(eval('(' + GS.match(new RegExp('var ' + name + '\\s*= (\\{[^}]*\\});'))[1] + ')')).sort().join(',');
eq('who may scan', jsList('FLOW_SCAN_ROLES'), gsSet('_SCAN_COUNT_ROLES'));
eq('who may post a receiving', jsList('FLOW_SCAN_POST_ROLES'), gsSet('_SCAN_POST_ROLES'));

console.log('\n3 · warehouse home, navbars');
function authCtx(role, next) {
  const store = { session: role ? JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) : null };
  const ss = { hx_next: next === undefined ? null : next };
  let html = '';
  const c = { console, window: {},
    localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: (k) => ss[k] === undefined ? null : ss[k], setItem: (k, v) => { ss[k] = v; }, removeItem: (k) => { delete ss[k]; } },
    location: { href: '', pathname: '/scan.html', search: '' },
    document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
      getElementById: (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } };
        if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; } },
    fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
  c.window = c;
  vm.createContext(c); require('./hxutil').load(c);
  vm.runInContext(AUTH, c);
  return { c, ss, html: () => html };
}
{
  const a = authCtx('warehouse');
  eq('a warehouse login lands on the scanner', a.c._homeForRole('warehouse'), 'scan.html');
  a.c.renderNavbar('scan');
  const h = a.html();
  ok('its navbar has the Scanner and Change Password only', /href="scan\.html" class="active"/.test(h) && /change-password\.html/.test(h) &&
     !/flow-receiving\.html|leave-request\.html|dashboard\.html"/.test(h.replace(/<a[^>]*class="brand[\s\S]*?<\/a>/, '')), h.slice(0, 300));
  const links = ((h.match(/<nav class="navbar-nav" id="navLinks">([\s\S]*?)<\/nav>/) || [])[1] || '').match(/<a href="[^"]+"/g) || [];
  eq('  exactly two links, not the sales menus', links.join(' '), '<a href="scan.html" <a href="change-password.html"');
  ok('no quotation or pricing nudges for warehouse', /if \(role === 'warehouse'\) return items;/.test(AUTH));
  ok('warehouse is own-scope in the flow', a.c.flowOwnsRecordsOnly('warehouse') === true);
}
[['accounting', true], ['admin', true], ['director', true], ['management', false], ['sales', false]].forEach(([role, want]) => {
  const a = authCtx(role); a.c.renderNavbar('x');
  eq(role + ' has a Scanner link', /href="scan\.html"/.test(a.html()), want);
});

console.log('\n4 · back to the scanner after signing in');
{
  let a = authCtx('accounting', 'scan.html');
  eq('accounting sent from the scanner goes back to it', a.c.flowAfterLogin('accounting'), 'scan.html');
  eq('  and the note is used up', a.ss.hx_next, undefined);
  a = authCtx('accounting', 'labels.html?items=ITM-00001:3');
  eq('labels with its item list are allowed', a.c.flowAfterLogin('accounting'), 'labels.html?items=ITM-00001:3');
  a = authCtx('accounting', 'https://evil.example/scan.html');
  eq('another site is never a destination', a.c.flowAfterLogin('accounting'), 'accounting-home.html');
  a = authCtx('accounting', 'admin-users.html');
  eq('a page outside the allow-list falls back home', a.c.flowAfterLogin('accounting'), 'accounting-home.html');
  a = authCtx('sales', 'scan.html');
  eq('a role that cannot scan is sent home, not to the scanner', a.c.flowAfterLogin('sales'), 'dashboard.html');
  a = authCtx(null);
  a.c.location.search = '?x=1';
  ok('the guard stores where you were before sending you to sign in', a.c.requireScanAccess() === null && a.ss.hx_next === 'scan.html?x=1' && a.c.location.href === 'index.html');
  const IDX = read('index.html');
  ok('the login page uses the helper on both paths', (IDX.match(/flowAfterLogin\((session|result)\.role\)/g) || []).length === 2 && !/_homeForRole\(/.test(IDX));
}

console.log('\n5 · the scanner logic');
const els = {};
const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, href: '', className: '', dataset: {},
  classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, getAttribute: () => 'none', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, focus() {}, blur() {} });
const store = {};
const sctx = { console, window: {}, document: { getElementById: el, addEventListener() {}, querySelectorAll: () => [] },
  localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout: () => 0, confirm: () => true, Date };
sctx.window = sctx;
vm.createContext(sctx); require('./hxutil').load(sctx);
vm.runInContext(JS, sctx);
const T = sctx.__scan;
T.S.mode = 'receive';
T.S.doc = { docNo: 'PO-1', party: 'Acme' };
T.S.lines = [
  { line: 1, itemId: 'ITM-00001', itemNo: 'WR-10', name: 'Torque wrench', ordered: 10, done: 0, remaining: 2, codes: ['4800000000017'] },
  { line: 2, itemId: 'ITM-00002', itemNo: 'N/A', name: 'Hose', ordered: 5, done: 0, remaining: 5, codes: [] },
  { line: 3, itemId: 'ITM-00001', itemNo: 'WR-10', name: 'Torque wrench', ordered: 1, done: 0, remaining: 1, codes: ['4800000000017'] }];
eq('our label counts on its line', T.scan('HXI:ITM-00002', false), 'ok');
eq('  line 2 = 1', T.S.counts[2], 1);
eq('a known supplier barcode counts', T.scan('4800000000017', false), 'ok');
eq('  on the first wrench line', T.S.counts[1], 1);
T.scan('4800000000017', false);
eq('the repeated item fills line 1 first', T.S.counts[1], 2);
eq('  then moves to line 3', T.scan('4800000000017', false), 'ok');
eq('  line 3 = 1', T.S.counts[3], 1);
eq('a fourth wrench is refused: both lines are complete', T.scan('4800000000017', false), 'complete');
eq('an item that is not on the PO is refused', T.scan('HXI:ITM-09999', false), 'notOnDoc');
eq('an unknown barcode asks to be linked', T.scan('0000999988887', false), 'unknown');
ok('  and the link sheet opens', els.scLink && els.scLink.hidden === false);
eq('the camera reading one code twice in a second counts once', (T.S.last = { code: '', at: 0 }, T.scan('HXI:ITM-00002', true), T.scan('HXI:ITM-00002', true)), 'ignored');
eq('  (line 2 = 2)', T.S.counts[2], 2);
const saved = JSON.parse(store[T.draftKey()] || 'null');
ok('the count is saved on the phone after every scan', saved && saved.counts[1] === 2 && saved.counts[2] === 2 && saved.counts[3] === 1, saved);
T.S.counts = {};
ok('  and restores', JSON.stringify(T.loadDraft().counts) === JSON.stringify(saved.counts));
T.S.counts = saved.counts; T.S.codes = saved.codes;
const lines = T.payloadLines();
eq('the post sends every counted line', lines.map(l => l.line + ':' + l.qty).join(','), '1:2,2:2,3:1');
ok('  with the item echoed and the codes seen', lines[0].itemId === 'ITM-00001' && lines[0].itemNo === 'WR-10' && lines[0].codes[0] === '4800000000017');
ok('  and never a price', !/price/i.test(JSON.stringify(lines)));
ok('the scanner posts `lines`, never `items`', !/\bitems:/.test(JS.replace(/needLabels|labels\.html\?items=/g, '')));
ok('the post actions are literal (registration audits them)', /postFlow\('receiveByScan'/.test(JS) && /postFlow\('saveScanCount'/.test(JS) && /postFlow\('dispatchByScan'/.test(JS) && /postFlow\('linkBarcode'/.test(JS));
ok('it reuses one clientRef per count', /clientRef: ref\(\)/.test(JS) && /S\.ref = '';/.test(JS));

console.log('\n6 · labels');
const lctx = { console, window: {}, document: { getElementById: el, addEventListener() {} }, location: { search: '' }, URLSearchParams };
lctx.window = lctx;
vm.createContext(lctx); require('./hxutil').load(lctx);
vm.runInContext(read('js/labels.js'), lctx);
const P = lctx.__labels.parse;
eq('ids and quantities are read', JSON.stringify(P('?items=ITM-00001:3,ITM-00002')), JSON.stringify([{ id: 'ITM-00001', qty: 3 }, { id: 'ITM-00002', qty: 1 }]));
eq('junk is dropped, repeats ignored, quantity capped', JSON.stringify(P('?items=<x>,ITM-1:9999,ITM-1:2')), JSON.stringify([{ id: 'ITM-1', qty: 200 }]));
ok('the QR carries HXI:<Item ID>', /svg\('HXI:' \+ i\.id\)/.test(read('js/labels.js')));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
