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
 * A318:
 *   7. Five tabs; our opaque label codes count on their line; a tracked dispatch line takes only piece
 *      labels, each piece once, and the post names them; photo ids are kept with the count; posting
 *      waits for an uploaded photo.
 *   8. Stock in: the basket groups by purchase order and a second scan adds to the line it came from.
 *   9. Return: only pieces that are out, each once.
 *  10. The reads that turn a code into details are secured: called through postFlow, never fetchFlow.
 *  11. Labels: the QR is the bare opaque code; ?codes= is parsed strictly.
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
const sctx = { console, window: {}, document: { getElementById: el, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null },
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
ok('  and the bottom sheet opens to link it', els.scSheet && els.scSheet.hidden === false && els.scSheetTitle.textContent === 'New barcode');
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
const LJS = read('js/labels.js');
ok('the QR carries the bare label code, never an Item ID or a web address', lctx.__labels.qrPayload({ code: 'HX7K3P9QWD2M4X', itemId: 'ITM-00001' }) === 'HX7K3P9QWD2M4X' &&
   /svg\(qrPayload\(r\)\)/.test(LJS) && !/HXI:|https?:\/\/[^'"]*\$\{/.test(LJS.replace(/QR_CDN = '[^']+'/, '')));
eq('?codes= keeps only well-formed codes, once, upper-cased', JSON.stringify(lctx.__labels.parseCodes('?codes=hx7k3p9qwd2m4x,HX7K3P9QWD2M4X,ITM-00001,HXI:ITM-1,HX0000000000OO')),
   JSON.stringify(['HX7K3P9QWD2M4X']));
ok('the library is a secured read and items get their code first', /postFlow\('getLabels'/.test(LJS) && /postFlow\('ensureItemLabels'/.test(LJS) && /postFlow\('logLabelPrint'/.test(LJS) && !/fetchFlow\(/.test(LJS));

console.log('\n7 · A318 scanner: tabs, our codes, pieces, photos');
eq('five tabs, in order', (SCAN.match(/data-mode="(\w+)"/g) || []).map(m => m.slice(11, -1)).join(','), 'receive,stockin,dispatch,return,lookup');
ok('the proof photo opens the rear camera', /<input type="file" id="scPhotoIn" accept="image\/\*" capture="environment" hidden>/.test(SCAN));
eq('the scanner needs FlowAPI 159', (JS.match(/MIN_VERSION = (\d+)/) || [])[1], '159');
{
  const C = 'HX7K3P9QWD2M4X', P1 = 'HXA1B2C3D4E5F6', P2 = 'HXZZZZZZZZZZZZ';
  T.S.mode = 'receive'; T.S.counts = {}; T.S.codes = {}; T.S.assets = {}; T.S.last = { code: '', at: 0 };
  T.S.doc = { docNo: 'PO-2', party: 'Acme' };
  T.S.lines = [{ line: 1, itemId: 'ITM-00001', itemNo: 'WR-10', name: 'Torque wrench', ordered: 3, done: 0, remaining: 3, codes: [], labels: [C], tracked: true }];
  eq('our opaque item label counts on its line', T.scan(C, false), 'ok');
  ok('  and is not recorded as a supplier barcode', !(T.S.codes[1] || []).length);
  eq('a label for nothing on the document is refused', T.scan('HX0000000000ZZ', false), 'notOnDoc');
  T.S.mode = 'dispatch'; T.S.counts = {}; T.S.assets = {}; T.S.doc = { docNo: 'SO-2', party: 'Client' };
  T.S.lines = [{ line: 1, itemId: 'ITM-00001', itemNo: 'WR-10', name: 'Torque wrench', ordered: 2, done: 0, remaining: 2, codes: ['4800000000017'], labels: [C], tracked: true,
                 pieces: [{ assetNo: 'AS-1', code: P1 }, { assetNo: 'AS-2', code: P2 }] },
               { line: 2, itemId: 'ITM-00002', itemNo: 'N/A', name: 'Hose', ordered: 4, done: 0, remaining: 4, codes: ['111'], labels: [], tracked: false }];
  eq('a tracked line refuses the item label', T.scan(C, false), 'piecesOnly');
  eq('  and the supplier barcode', T.scan('4800000000017', false), 'piecesOnly');
  eq('a piece label counts', T.scan(P1, false), 'ok');
  eq('  the same piece twice is refused', T.scan(P1, false), 'again');
  eq('  a second piece counts', T.scan(P2, false), 'ok');
  eq('an untracked line still counts by barcode', T.scan('111', false), 'ok');
  const pl = T.payloadLines();
  ok('the dispatch names each piece and the qty is the piece count', pl[0].qty === 2 && JSON.stringify(pl[0].assets) === '["AS-1","AS-2"]' && !pl[1].assets, pl);
  T.add(T.S.lines[0], -1);
  ok('minus on a piece line drops the last piece', T.S.counts[1] === 1 && JSON.stringify(T.S.assets[1]) === '["AS-1"]', T.S.assets);
  T.S.photos = { doc: [{ docId: 'DOC-AAAA1111', state: 'ok', thumb: 'data:x' }, { docId: '', state: 'up', thumb: '' }] };
  ok('posting waits while a photo is still uploading', T.photosReady('doc') === false);
  T.S.photos.doc.pop();
  ok('  and opens once one is uploaded', T.photosReady('doc') === true);
  T.saveDraft();
  const dr = JSON.parse(store[T.draftKey()] || 'null');
  ok('the draft keeps the photo ids and the pieces, never the photo itself', dr && JSON.stringify(dr.photos) === '{"doc":["DOC-AAAA1111"]}' && dr.assets[1][0] === 'AS-1' && !/data:x/.test(store[T.draftKey()]), dr);
}
ok('a post sends the photo ids', /photoIds: photoIds/.test(JS) && /postFlow\('uploadScanPhoto'/.test(JS) && /flowDownscaleImage\(file, 1280, 0\.75\)/.test(JS));

console.log('\n8 · stock in');
{
  T.S.mode = 'stockin';
  T.S.basket = [{ poNo: 'PO-S', line: 1, itemId: 'ITM-00001', itemNo: 'WR-10', name: 'Torque wrench', remaining: 5, qty: 1, supplier: 'Stock Co', soNo: '' },
                { poNo: 'PO-1', line: 2, itemId: 'ITM-00002', itemNo: 'N/A', name: 'Hose', remaining: 1, qty: 1, supplier: 'Acme', soNo: 'SO-1' },
                { poNo: 'PO-S', line: 3, itemId: 'ITM-00003', itemNo: 'PM-7', name: 'Pump', remaining: 2, qty: 2, supplier: 'Stock Co', soNo: '' }];
  const g = T.groups();
  eq('the basket groups by purchase order', g.map(x => x.poNo + ':' + x.entries.length).join(','), 'PO-S:2,PO-1:1');
  eq('scanning an item again adds one to the line it came from', (T.addStockItem('ITM-00001'), T.S.basket[0].qty), 2);
  eq('a full line opens the purchase-order choice instead of overfilling', T.addStockItem('ITM-00002'), 'pick');
  eq('  the hose stays at its remaining 1', T.S.basket[1].qty, 1);
  ok('each group posts through receiveByScan with its own clientRef and photos', /receiveWithChecks\(\{ poNo: g\.poNo, lines: lines, photoIds: JSON\.stringify\(okIds\(key\)\), clientRef: gref/.test(JS));
  ok('a refused group stays in the basket with its reason', /S\.groupMsg\[g\.poNo\] = \{ kind: 'bad', text:/.test(JS) && /S\.basket = S\.basket\.filter\(e => e\.poNo !== g\.poNo\)/.test(JS));
}

console.log('\n9 · return');
{
  T.S.mode = 'return'; T.S.ret = []; T.S.last = { code: '', at: 0 };
  T.S.outPieces = [{ assetNo: 'AS-1', code: 'HXA1B2C3D4E5F6', name: 'Torque wrench', location: 'Client (SO-1)' }];
  eq('an out piece is counted by its label', T.scanReturn('HXA1B2C3D4E5F6'), 'ok');
  eq('  once', T.scanReturn('HXA1B2C3D4E5F6'), 'again');
  eq('a piece that is not out is refused', T.scanReturn('HXZZZZZZZZZZZZ'), 'missing');
  ok('the return posts with its photo ids and one clientRef', /postFlow\('returnByScan', \{ assets: JSON\.stringify\(S\.ret\), photoIds: JSON\.stringify\(okIds\('doc'\)\)/.test(JS) && /clientRef: ref\(\) \}\);/.test(JS));
}

console.log('\n10 · secured reads');
{
  const all = fs.readdirSync(D + 'js').filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n');
  ['getScanContext', 'getScanLookup', 'getLabels', 'getStockInOptions', 'getScanPhotos'].forEach(a =>
    ok(a + ' is never a plain GET', !new RegExp("fetchFlow\\('" + a + "'").test(all) && new RegExp("postFlow\\('" + a + "'").test(all)));
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
