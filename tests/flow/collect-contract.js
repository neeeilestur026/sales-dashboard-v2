/* A323 — Collect (collect.html), the alert on the homes, and the wiring around them.
 *
 * Run:  node tests/flow/collect-contract.js
 *
 * Pinned:
 *   1. The page follows the site rules and loads its scripts in order; it installs as its own
 *      home-screen app (manifest served by Flask).
 *   2. Its role, method and deposit choices are the ones FlowAPI enforces.
 *   3. Signing in returns the director to Collect; anyone else goes home; only the director's
 *      navbar links it.
 *   4. Accounting and admin get a bell / "Needs you" item; the live alert sits on both homes, sets a
 *      baseline on its first look and shows only what arrived after it.
 *   5. The Collections page has the "From the field" panel; AR Aging shows the follow-up chip.
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
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '../../app.py'), 'utf8');
const H = read('collect.html'), JS = read('js/collect.js'), AUTH = read('js/auth.js'), ALERT = read('js/collect-alert.js');

console.log('\n1 · the page');
const scripts = (h) => (h.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(',');
eq('scripts in order', scripts(H), 'theme.js,api.js,auth.js,flow-api.js,collect.js');
ok('theme.js first in body; no inline style or script', /<body class="cl">\s*<script src="js\/theme\.js"><\/script>/.test(H) && !/<style[\s>]/.test(H) && !/<script>/.test(H) && !/style="/.test(H));
ok('styles.css first, then collect.css', /href="css\/styles\.css">\s*<link rel="stylesheet" href="css\/collect\.css">/.test(H));
ok('every rule in collect.css is scoped to body.cl', read('css/collect.css').replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim()).filter(r => r && !/^@/.test(r) && !/^\s*(from|to)\b/.test(r))
  .every(r => r.split('{')[0].split(',').every(sel => /^\s*body\.cl\b/.test(sel) || /^@|^\s*$/.test(sel))));
ok('its own home-screen manifest', /<link rel="manifest" href="\/collect\.webmanifest">/.test(H) && /apple-mobile-web-app-title" content="Collect"/.test(H));
const MAN = JSON.parse(read('collect.webmanifest'));
ok('  which starts on Collect', MAN.start_url === '/collect.html' && MAN.short_name === 'Collect' && MAN.display === 'standalone');
ok('  and Flask serves it as a manifest', /@app\.route\("\/collect\.webmanifest"\)[\s\S]{0,200}collect\.webmanifest", mimetype="application\/manifest\+json"/.test(APP));
ok('no service worker or offline queue: a money action happens online or not at all', !/serviceWorker|indexedDB/.test(JS));
ok('a lost connection keeps the clientRef, so Record again cannot double-record', /clientRef: C\.clientRef/.test(JS) && /it will not be recorded twice/.test(JS));
ok('a fresh review asks every question again', /C\.confirm = \{\};\s+\/\/ a fresh review/.test(JS));

console.log('\n2 · the same rules as FlowAPI');
const gsObj = (name) => Object.keys(eval('(' + GS.match(new RegExp('var ' + name + ' = (\\{[^}]*\\});'))[1] + ')')).sort().join(',');
const authList = (name) => (AUTH.match(new RegExp('const ' + name + " = \\[([^\\]]*)\\]")) || [])[1].replace(/[\s']/g, '').split(',').sort().join(',');
eq('who may use Collect', authList('FLOW_COLLECT_ROLES'), gsObj('_FIELD_COLLECT_ROLES'));
eq('the three methods the page offers', (H.match(/data-method="([^"]+)"/g) || []).map(s => s.slice(13, -1)).sort().join(','), gsObj('_FIELD_METHODS'));
eq('the reasons come from the server', /C\.q\.reasons\.map/.test(JS), true);
ok('a transfer has no default account; cheque and cash default to "not yet deposited"', /C\.place = m === 'Cheque' \? C\.q\.undeposited\.code : m === 'Cash' \? C\.q\.cashOnHand\.code : '';/.test(JS));
ok('the banks come from the server (the chart), not a list in the page', /C\.q\.banks\.forEach/.test(JS) && !/METRO_ZAB/.test(JS));

console.log('\n3 · signing in, the navbar');
function authCtx(role, next, page) {
  const store = { session: role ? JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) : null };
  const ss = { hx_next: next === undefined ? null : next };
  let html = '';
  const c = { console, window: {},
    localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: (k) => ss[k] === undefined ? null : ss[k], setItem: (k, v) => { ss[k] = v; }, removeItem: (k) => { delete ss[k]; } },
    location: { href: '', pathname: '/' + (page || 'collect.html'), search: '' },
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
  let a = authCtx('director', 'collect.html');
  eq('the director sent from Collect goes back to it', a.c.flowAfterLogin('director'), 'collect.html');
  a = authCtx('accounting', 'collect.html');
  eq('accounting sent to Collect goes home instead', a.c.flowAfterLogin('accounting'), 'accounting-home.html');
  a = authCtx('director', 'scan.html');
  eq('the scanner deep link still works for the director', a.c.flowAfterLogin('director'), 'scan.html');
  a = authCtx('warehouse', 'collect.html');
  eq('a warehouse login cannot land on Collect', a.c.flowAfterLogin('warehouse'), 'scan.html');
  a = authCtx(null);
  a.c.location.search = '';
  ok('the guard remembers Collect before sending you to sign in', a.c.requireCollectAccess() === null && a.ss.hx_next === 'collect.html' && a.c.location.href === 'index.html');
  a = authCtx('sales');
  ok('a sales login is sent home', a.c.requireCollectAccess() === null && a.c.location.href === 'dashboard.html');
  [['director', true], ['accounting', false], ['admin', false], ['management', false], ['sales', false]].forEach(([role, want]) => {
    const x = authCtx(role); x.c.renderNavbar('x');
    eq(role + ' has a Collect link', /href="collect\.html"/.test(x.html()), want);
  });
}

console.log('\n4 · accounting and admin are told');
{
  const run = async (role, notices) => {
    const a = authCtx(role, undefined, 'accounting-home.html');
    a.c.fetchFlow = () => Promise.resolve({ success: true, data: [] });
    a.c.postFlow = (action) => Promise.resolve(action === 'getFieldCollectionNotices' ? { success: true, items: notices } : { success: true, data: [] });
    a.c.hxEsc = (v) => String(v);
    return a.c.flowComputeActions(JSON.parse(a.c.localStorage.getItem('session')));
  };
  const two = [{ by: 'Neil Estur' }, { by: 'Neil Estur' }];
  Promise.all([run('accounting', two), run('admin', two), run('management', two), run('accounting', [])]).then(([acc, adm, mgmt, none]) => {
    const has = (items) => items.some(i => /2 collections recorded by Neil — acknowledge/.test(i.text) && i.link === 'flow-collections.html#field');
    ok('accounting sees "2 collections recorded by Neil — acknowledge"', has(acc), acc.map(i => i.text));
    ok('admin too', has(adm));
    ok('management does not get the nudge', !has(mgmt));
    ok('nothing when nothing is waiting', !none.some(i => /recorded by/.test(i.text)));
    ok('flowRefreshActions recomputes the bell and the strip', /function flowRefreshActions\(stripId\) \{\s+_faOnce = null;\s+loadNotifications\(\);/.test(AUTH));
    return alertTests();
  }).then(() => finish());
}
async function alertTests() {
  for (const page of ['accounting-home.html', 'admin.html']) ok('the live alert is on ' + page, /<script src="js\/collect-alert\.js"><\/script>/.test(read(page)));
  const mk = (role, answers) => {
    const store = {}, calls = [], toasts = [];
    let refreshed = 0;
    const box = { children: [], appendChild(t) { this.children.push(t); toasts.push(t.innerHTML); }, removeChild(t) { this.children.splice(this.children.indexOf(t), 1); }, setAttribute() {}, get firstChild() { return this.children[0]; } };
    let made = false;
    const c = { console, Date, JSON, Promise,
      getSession: () => ({ username: 'ana', role }),
      localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem: (k, v) => { store[k] = v; } },
      document: { visibilityState: 'visible', addEventListener() {}, body: { appendChild() { made = true; } },
        getElementById: (id) => (id === 'fcToasts' && made ? box : null),
        createElement: () => ({ className: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, setAttribute() {}, querySelector: () => ({ addEventListener() {} }), remove() {} }) },
      postFlow: (action, p) => { calls.push(p); return Promise.resolve(answers.shift()); },
      flowMoney: (v) => 'PHP ' + v, hxEsc: (v) => String(v), flowRefreshActions: () => { refreshed++; },
      setTimeout: () => 0, setInterval: () => 0 };
    c.window = c;
    c.document.createElement = () => { const el = { className: '', id: '', _h: '', setAttribute() {}, querySelector: () => ({ addEventListener() {} }), remove() {} };
      Object.defineProperty(el, 'innerHTML', { set(v) { el._h = v; }, get() { return el._h; } }); if (!made) { made = true; Object.assign(box, { id: 'fcToasts' }); return box; } return el; };
    vm.createContext(c); vm.runInContext(ALERT, c);
    return { c, calls, toasts, store, refreshed: () => refreshed };
  };
  const item = { by: 'Neil Estur', received: 420000, method: 'Cheque', chequeNo: '001234', customer: 'ABOITIZ' };
  const a = mk('accounting', [{ success: true, serverNow: '2026-10-06T01:00:00.000Z', items: [item], count: 1 },
                              { success: true, serverNow: '2026-10-06T01:01:00.000Z', items: [item], count: 2 }]);
  await a.c.__collectAlert.check();
  ok('first look: a baseline, no pop-up for what was already there', a.calls[0].since === undefined && a.toasts.length === 0, a.calls);
  eq('  the mark is kept for this user', a.store['hx_fc_seen_ana'], '2026-10-06T01:00:00.000Z');
  await a.c.__collectAlert.check();
  eq('next look asks only for what came after', a.calls[1].since, '2026-10-06T01:00:00.000Z');
  ok('  and shows it: who, how much, how, from whom', a.toasts.length === 1 && /Neil Estur<\/b> recorded <b>PHP 420000<\/b> · cheque #001234 · ABOITIZ/.test(a.toasts[0]), a.toasts);
  eq('  then the bell and the strip are recomputed', a.refreshed(), 1);
  const s = mk('sales', []);
  ok('a sales login never asks', !s.c.__collectAlert);
  const old = mk('admin', [{ success: false, message: 'Unknown action: getFieldCollectionNotices' }]);
  await old.c.__collectAlert.check(); await old.c.__collectAlert.check();
  eq('an old FlowAPI: it stops asking after "Unknown action"', old.calls.length, 1);
}

function finish() {
  console.log('\n5 · the Collections page and AR Aging');
  const FCH = read('flow-collections.html'), FCJ = read('js/flow-collections.js'), ARJ = read('js/flow-ar-aging.js');
  ok('Collections has the "From the field" panel, hidden until FlowAPI answers', /<section class="chart-card fc-panel" id="field" hidden>/.test(FCH) && /box\.hidden = false;/.test(FCJ));
  ok('  only accounting and admin acknowledge', /const FC_ACK_ROLES = \['accounting', 'admin'\];/.test(FCJ) && /!colViewer/.test(FCJ));
  eq('  the same roles FlowAPI uses', ['accounting', 'admin'].sort().join(','), gsObj('_FIELD_ACK_ROLES'));
  ok('AR Aging shows the follow-up chip', /\$\{arFollowUpChip\(r\.followUp\)\}/.test(ARJ) && /promise missed/.test(ARJ));
  console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
  process.exit(FAIL ? 1 : 0);
}
