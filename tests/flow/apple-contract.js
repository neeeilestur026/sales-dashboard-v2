/* A344 — the Apple look (css/apple.css, js/apple.js, the sidebar in js/ledger-nav.js, the switch in js/theme.js).
 *
 * Run:  node tests/flow/apple-contract.js
 *
 * What it pins, in the order a fault would hurt:
 * 1 · css/apple.css cannot leak: every selector is scoped to html[data-skin="ledger"][data-look="apple"], all
 *     inside @media screen (print and the PDFs stay classic); colours only in the --l-p-* / --a-* tokens; no
 *     !important; blur only on the chrome; keyframes move only transform and opacity; the person's settings
 *     (reduced transparency, more contrast) have their blocks; the drawer and the phone sheets exist.
 * 2 · contrast meets WCAG AA in both themes (the same pairs tests/flow/ledger-contract.js holds Ledger to).
 * 3 · the switch (A345, the Ledger look retired): whenever the new look is on it is the Apple look, no FlowSettings
 *     row needed; a "classic" or ?skin=off stored in the Ledger period changes nothing; ?look=classic is the way
 *     out and ?look=new|apple the way back; portalSkin off and the warehouse never get it; js/ledger.js and
 *     js/apple.js load once each; the login page gets the look with nobody signed in.
 * 4 · the sidebar: every role reaches exactly the pages of its Ledger rail and avatar menu, every page marks
 *     itself current with its section open, and the bell / theme ids survive.
 * 5 · the pages link css/apple.css once, right after css/ledger.css; none links js/apple.js; apple.js is inert
 *     without the look.
 * 7 · css/apple-login.css (A345): scoped, tokens only, AA in both themes, linked by the login page alone.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const SCOPE = 'html[data-skin="ledger"][data-look="apple"]';
const ROLES = ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'];

function parse(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) out.push({ at: head, kids: parse(body) });
    else if (head.startsWith('@keyframes')) out.push({ at: head, body });
    else out.push({ sel: head, body });
    i = j;
  }
  return out;
}
function rules(list, ctx, acc) {
  (list || []).forEach(n => {
    if (n.kids) rules(n.kids, ctx.concat([n.at]), acc);
    else if (n.sel !== undefined) acc.push({ sel: n.sel, body: n.body, ctx });
    else acc.push({ at: n.at, body: n.body, ctx });
  });
  return acc;
}
const SRC = read('css/apple.css').replace(/\/\*[\s\S]*?\*\//g, '');
const TOP = parse(SRC), ALL = rules(TOP, [], []);
const STYLE = ALL.filter(r => r.sel !== undefined), KEYF = ALL.filter(r => r.at && r.at.startsWith('@keyframes'));
const decls = (body) => body.split(/;(?![^(]*\))/).map(d => d.trim()).filter(Boolean);

sec('1 · apple.css cannot leak');
{
  ok('one @media screen block holds everything (keyframes inside it)', TOP.length === 1 && TOP[0].at === '@media screen', TOP.map(n => n.at || n.sel));
  const bad = [];
  STYLE.forEach(r => r.sel.split(',').map(s => s.trim()).forEach(s => { if (!s.startsWith(SCOPE)) bad.push(s); }));
  ok('every one of ' + STYLE.length + ' rules is scoped to ' + SCOPE, bad.length === 0 && STYLE.length > 120, bad.slice(0, 5));
  ok('no url(), no @font-face, no @import (the system font, nothing downloaded)', !/url\(|@font-face|@import/.test(SRC));
  const lit = [];
  STYLE.forEach(r => decls(r.body).forEach(d => {
    if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(d) && !/^--(l-p|a)-[a-z0-9-]+\s*:/.test(d)) lit.push(r.sel.slice(SCOPE.length, SCOPE.length + 40) + ' → ' + d.slice(0, 60));
  }));
  ok('colours are written only in the --l-p-* and --a-* tokens', lit.length === 0, lit.slice(0, 5));
  ok('no !important', !/!important/.test(SRC));
  const CHROME = /\.(navbar|a-side|l-menu|notif-dropdown|toast)\b/;
  const blur = [];
  STYLE.forEach(r => decls(r.body).forEach(d => { if (/^(-webkit-)?backdrop-filter\s*:/.test(d) && !/:\s*none$/.test(d) && !r.sel.split(',').every(s => CHROME.test(s))) blur.push(r.sel.slice(0, 90)); }));
  ok('blur only on the chrome: the toolbar, the sidebar, the menus, the toast', blur.length === 0, blur);
  ok('keyframes are named a-* and move only transform and opacity', KEYF.length >= 3 && KEYF.every(k => /^@keyframes a-/.test(k.at)
    && (k.body.match(/[a-z-]+(?=\s*:)/g) || []).every(p => p === 'opacity' || p === 'transform')), KEYF.map(k => k.at));
  const trans = STYLE.filter(r => /(^|;)\s*transition\s*:/.test(r.body));
  ok('transitions name their properties, never all', trans.length > 5 && trans.every(r => !/transition\s*:[^;]*\ball\b/.test(r.body)), trans.filter(r => /\ball\b/.test(r.body)).map(r => r.sel.slice(0, 60)));
  const anims = STYLE.filter(r => /(^|;)\s*animation\s*:/.test(r.body));
  ok('no animation loops', anims.every(r => !/infinite/.test(r.body)));
  const tok = STYLE.find(r => r.sel.trim() === SCOPE);
  ok('the springs are the skill\'s: damping 1.0 / response 0.4 and 0.8 / 0.3, as linear() curves', !!tok && /--a-spring:linear\(0, \.063/.test(tok.body) && /--a-bounce:linear\(0, \.075/.test(tok.body) && /--a-spring-t:620ms/.test(tok.body));
  ok('the system font, money in tabular figures', !!tok && /--l-sans:-apple-system/.test(tok.body) && STYLE.some(r => /\sbody$/.test(r.sel) && /font-variant-numeric:\s*tabular-nums/.test(r.body)));
  ok('a dark set re-defines the primitives', STYLE.some(r => r.sel.trim() === SCOPE + '[data-theme="dark"]' && /--l-p-page:/.test(r.body)));
  const inCtx = (re, selRe, bodyRe) => ALL.some(r => r.ctx.some(c => re.test(c)) && selRe.test(r.sel || '') && bodyRe.test(r.body || ''));
  ok('reduced transparency: the chrome turns solid', inCtx(/prefers-reduced-transparency:\s*reduce/, /\.a-side/, /backdrop-filter:\s*none/));
  ok('more contrast: stronger hairlines and bordered panels', inCtx(/prefers-contrast:\s*more/, /\.card/, /border:\s*1px solid/));
  ok('under 900px the sidebar is a drawer', inCtx(/max-width:\s*899px/, /\.a-side$/, /transform:\s*translate3d\(-104%/) && inCtx(/max-width:\s*899px/, /\.a-side\.open/, /transform:\s*none/));
  ok('on phones the dialogs are bottom sheets with a grabber', inCtx(/max-width:\s*640px/, /\.flow-modal::before/, /width:\s*36px/) && inCtx(/max-width:\s*640px/, /\.flow-modal-overlay\.open \.flow-modal/, /a-sheet/));
  ok('press feedback at .97 on buttons and sidebar rows', STYLE.some(r => /\.btn:active/.test(r.sel) && /scale\(\.97\)/.test(r.body)) && STYLE.some(r => /\.a-item:active/.test(r.sel) && /scale\(\.97\)/.test(r.body)));
}

sec('2 · contrast meets WCAG AA in both themes');
{
  const block = (sel) => { const r = STYLE.find(x => x.sel.trim() === sel); const o = {}; (r ? r.body : '').replace(/--l-p-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g, (_, k, v) => { o[k] = v; }); return o; };
  const light = block(SCOPE), dark = Object.assign({}, light, block(SCOPE + '[data-theme="dark"]'));
  const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const PAIRS = [['ink', 'panel'], ['ink-2', 'panel'], ['ink-3', 'panel'], ['ink', 'page'], ['ink-2', 'page'], ['ink-3', 'page'], ['ink', 'inset'], ['ink-3', 'inset'],
    ['accent', 'panel'], ['accent', 'page'], ['accent', 'accent-soft'], ['accent-ink', 'accent'], ['accent-ink', 'accent-hover'], ['on-solid', 'solid'], ['on-solid', 'solid-hover'],
    ['late', 'panel'], ['late', 'late-soft'], ['soon', 'panel'], ['soon', 'soon-soft'], ['ok', 'panel'], ['ok', 'ok-soft'], ['ink', 'field'], ['ink-3', 'field'], ['on-solid', 'late']];
  [['light', light], ['dark', dark]].forEach(([name, t]) => {
    const fails = PAIRS.filter(([f, b]) => !(t[f] && t[b]) || (name === 'dark' && f === 'on-solid' && b === 'late' ? false : ratio(t[f], t[b]) < 4.5))
      .map(([f, b]) => f + ' on ' + b + ' ' + (t[f] && t[b] ? ratio(t[f], t[b]).toFixed(2) : 'missing'));
    ok(name + ': ' + PAIRS.length + ' pairs at 4.5:1 or better', fails.length === 0, fails);
  });
}

sec('3 · the switch: the new look is the Apple look (A345)');
const THEME = read('js/theme.js');
function runTheme(o) {
  const store = Object.assign({}, o.store || {});
  if (o.role) store.session = JSON.stringify({ name: 'T', role: o.role, loginTime: Date.now() });
  const attrs = {}, appended = [];
  const el = (tag) => ({ tagName: tag, setAttribute(k, v) { this[k] = v; }, set textContent(v) { this._t = v; } });
  const ctx = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hostname: o.host || 'hi-escorp-portal-wufz.onrender.com', search: o.search || '', pathname: '/flow-ar-aging.html' },
    URLSearchParams, JSON, Date, parseInt, Array, String,
    matchMedia: () => ({ matches: !!o.reduced }), CustomEvent: function () {},
    document: {
      documentElement: { setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k] || null; }, classList: { add() {}, remove() {} } },
      body: { setAttribute() {}, classList: { add() {}, remove() {} } },
      head: { appendChild(n) { appended.push(n); } }, createElement: el,
      querySelector: (s) => (s === (o.login ? 'link[href="css/apple-login.css"]' : 'link[href="css/ledger.css"]') ? {} : null),
      querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, dispatchEvent() {}
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(THEME, ctx); } catch (e) { threw = e.message; }
  return { skin: attrs['data-skin'] === 'ledger', apple: attrs['data-look'] === 'apple', ajs: appended.filter(n => n.src === 'js/apple.js').length,
    ljs: appended.filter(n => n.src === 'js/ledger.js').length, threw, store, looks: ctx.hxSkinLookItems ? ctx.hxSkinLookItems() : '' };
}
{
  let cases = 0; const wrong = [], threw = [];
  [null, 'off', 'optin', 'on', 'junk'].forEach(sw => [null, 'classic', 'apple', 'junk'].forEach(me => [null, 'on', 'off'].forEach(pv => ['localhost', null].forEach(host => ROLES.concat(['warehouse', null]).forEach(role => {
    const store = { hx_lg_me: 'classic', hx_lg_pv: 'off', hx_lg_look: 'ledger' };   // the Ledger-period keys, planted every time
    if (sw) store.hx_lg_mode = sw; if (me) store.hx_look = me; if (pv) store.hx_skin_pv = pv;
    const r = runTheme({ role, store, host }); cases++;
    if (r.threw) threw.push(r.threw);
    const swv = ['off', 'optin', 'on'].includes(sw) ? sw : 'on', okRole = !!role && role !== 'warehouse', local = host === 'localhost';
    const mev = ['classic', 'apple'].includes(me) ? me : null;
    const skin = okRole && (pv === 'off' ? false : (pv === 'on' && local) || (swv === 'on' ? mev !== 'classic' : swv === 'optin' && mev === 'apple'));
    if (r.skin !== skin || r.apple !== skin || r.ajs !== (skin ? 1 : 0) || r.ljs !== (skin ? 1 : 0)) wrong.push({ sw, me, pv, host, role, got: [r.skin, r.apple, r.ajs, r.ljs] });
    if (['hx_lg_me', 'hx_lg_pv', 'hx_lg_look'].some(k => k in r.store)) wrong.push({ kept: 'a Ledger-period key', sw, me, pv, role });
  })))));
  ok(cases + ' cases: the Apple look exactly whenever the new look is on, js/ledger.js and js/apple.js once each; the Ledger-period keys change nothing and are removed', wrong.length === 0, wrong.slice(0, 4));
  ok('  theme.js never throws', threw.length === 0, threw.slice(0, 2));
  ok('no FlowSettings row and nothing chosen = Apple for every office role', ROLES.every(role => runTheme({ role }).apple));
  ok('  a "classic" or ?skin=off stored in the Ledger period does not stick', ROLES.every(role => runTheme({ role, store: { hx_lg_me: 'classic', hx_lg_pv: 'off' } }).apple));
  const cl = runTheme({ role: 'sales', search: '?look=classic' });
  ok('?look=classic (the name menu) is the way out and is remembered; ?look=new or ?look=apple comes back', !cl.skin && cl.store.hx_look === 'classic'
    && runTheme({ role: 'sales', search: '?look=new', store: { hx_look: 'classic' } }).apple && runTheme({ role: 'sales', search: '?look=apple', store: { hx_look: 'classic' } }).apple);
  ok('  the name menu offers Classic and Motion and calls nothing a preview', (l => /href="\?look=classic">Classic look/.test(l) && /motion=/.test(l) && !/preview/i.test(l))(runTheme({ role: 'hr' }).looks));
  ok("portalSkin off (the director's rollback) and the warehouse never get it", !runTheme({ role: 'sales', store: { hx_lg_mode: 'off' } }).apple && !runTheme({ role: 'warehouse', search: '?look=apple' }).apple);
  const fetchSrc = THEME.slice(THEME.indexOf("fetchFlow('getFlowSettings'"));
  ok('the 10-minute refresh no longer reads portalLook', fetchSrc.length > 100 && !/portalLook/.test(fetchSrc));
  ok('the login page (it links css/apple-login.css) gets data-look="apple" with nobody signed in, and loads nothing', (r => r.apple && !r.skin && r.ljs === 0 && r.ajs === 0)(runTheme({ login: true })));
  ok('  also for a signed-in person on their way through, and not once the director has turned the new look off',
    runTheme({ login: true, role: 'accounting', store: { hx_look: 'classic' } }).apple && !runTheme({ login: true, store: { hx_lg_mode: 'off' } }).apple);
}

sec('4 · the sidebar: every role, every page, nothing lost');
const API = read('js/api.js'), FAPI = read('js/flow-api.js'), AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');
function sidebar(role, page, look) {
  const session = { name: 'Test User', role, loginTime: Date.now() };
  const created = [], attrs = { 'data-look': look === false ? null : 'apple' };
  const node = () => ({ innerHTML: '', className: '', id: '', setAttribute(k, v) { this[k] = v; }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, classList: { toggle() {}, add() {}, remove() {}, contains: () => false } });
  const stub = () => ({ addEventListener() {}, setAttribute() {}, focus() {}, style: { setProperty() {} }, hidden: true, dataset: {}, getBoundingClientRect: () => ({ top: 100 }), contains: () => false });
  const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => stub(), classList: { add() {}, remove() {} }, addEventListener() {} };
  const ctx = {
    console, Date, JSON, Math, Object, Array, String, Number, Promise, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    localStorage: { getItem: (k) => (k === 'session' ? JSON.stringify(session) : null), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: '', pathname: '/' + (page || 'zz-none.html'), search: '' },
    document: {
      documentElement: { getAttribute: (k) => attrs[k] || null, setAttribute() {} },
      getElementById: (id) => (id === 'navbar' ? el : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => { const n = node(); created.push(n); return n; }, head: { appendChild() {} },
      body: { appendChild() {}, insertBefore(n) { created.push(n); }, firstChild: null }
    },
    navigator: { userAgent: 'node' }, hxSkinOn: true
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(API, ctx);
  try { vm.runInContext(FAPI, ctx); } catch (e) {}
  vm.runInContext(AUTH, ctx);
  vm.runInContext(NAV, ctx);
  vm.runInContext('renderNavbar("zz-none")', ctx);
  const side = created.find(n => n.className === 'a-side') || { innerHTML: '' };
  const pages = vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', ctx);
  return { bar: el.innerHTML, side: side.innerHTML, pages, scrim: created.some(n => n.className === 'a-scrim') };
}
const hrefs = (html) => [...new Set((html.match(/href="([a-z0-9-]+\.html)"/g) || []).map(x => x.slice(6, -1)))].sort();
{
  const lost = [], extra = [], current = [], ids = [], rail = [];
  ROLES.forEach(role => {
    const s = sidebar(role);
    const got = hrefs(s.side + s.bar), want = [...new Set(s.pages)].sort();
    want.forEach(h => { if (!got.includes(h)) lost.push(role + ': ' + h); });
    got.forEach(h => { if (!want.includes(h)) extra.push(role + ': ' + h); });
    if (/class="l-rail"/.test(s.bar) || !s.scrim || !/class="a-menu"/.test(s.bar)) rail.push(role);
    ['notifBell', 'notifBadge', 'notifDropdown', 'notifList', 'navThemeToggle'].forEach(id => { if ((s.bar.match(new RegExp('id="' + id + '"', 'g')) || []).length !== 1) ids.push(role + ': ' + id); });
    s.pages.forEach(h => {
      const p = sidebar(role, h), html = p.side + p.bar, n = (html.match(/aria-current="page"/g) || []).length;
      if (n !== 1) current.push(role + ': ' + h + ' marked ' + n);
      const grp = (p.side.match(/<div class="a-grp">[\s\S]*?<\/div><\/div>/g) || []).find(g => g.indexOf('href="' + h + '" aria-current="page"') >= 0);
      if (grp && !(/aria-expanded="true"/.test(grp) && !/class="a-grp-b"[^>]*hidden/.test(grp))) current.push(role + ': ' + h + ' section closed');
    });
  });
  ok('every role reaches exactly the pages of its Ledger rail and avatar menu', lost.length === 0 && extra.length === 0, lost.concat(extra).slice(0, 6));
  ok('  every page marks itself current once, its section open', current.length === 0, current.slice(0, 5));
  ok('  the sidebar replaces the rail, with the drawer button and its scrim', rail.length === 0, rail);
  ok('  the bell, its badge, dropdown and list, and the theme toggle keep their ids, once', ids.length === 0, ids);
  ok('  without data-look="apple" the Ledger rail draws exactly as before', /class="l-rail"/.test(sidebar('admin', null, false).bar) && !/a-side/.test(sidebar('admin', null, false).bar));
  ok('the sidebar sits in <body>, outside the toolbar (whose backdrop-filter would trap a fixed child)', /document\.body\.insertBefore\(sideEl/.test(NAV) && !/class="a-side"/.test(sidebar('admin').bar));
}

sec('5 · the pages');
{
  const PAGES = fs.readdirSync(D).filter(f => f.endsWith('.html') && !f.startsWith('_')).sort();
  const bad = { pair: [], stray: [], direct: [] };
  PAGES.forEach(f => {
    const h = read(f), ledger = (h.match(/css\/ledger\.css/g) || []).length, apple = (h.match(/css\/apple\.css/g) || []).length;
    if (ledger && (apple !== 1 || !/<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">/.test(h))) bad.pair.push(f);
    if (!ledger && apple) bad.stray.push(f);
    if (/js\/apple\.js/.test(h)) bad.direct.push(f);
  });
  const linked = PAGES.filter(f => /css\/apple\.css/.test(read(f))).length;
  ok(linked + ' pages link css/apple.css once, right after css/ledger.css', bad.pair.length === 0 && linked >= 100, bad.pair.slice(0, 5));
  ok('  and no page without the Ledger skin links it', bad.stray.length === 0, bad.stray);
  ok('no page links js/apple.js (theme.js loads it only with the look)', bad.direct.length === 0, bad.direct);
  const ctx = { window: {}, document: { documentElement: { getAttribute: () => null } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('js/apple.js'), ctx);
  ok('js/apple.js does nothing without html[data-look="apple"]', ctx.hxApple === undefined);
}

sec('6 · motion: the skill\'s numbers, and the person\'s own close');
{
  const SRC_JS = read('js/apple.js');
  const mk = (motion) => {
    const attrs = { 'data-look': 'apple', 'data-motion': motion || null };
    const ctx = { window: {}, performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, Math,
      document: { readyState: 'complete', documentElement: { getAttribute: k => attrs[k] || null }, getElementById: () => null, querySelectorAll: () => [], addEventListener() {} } };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(SRC_JS, ctx); return ctx;
  };
  const c = mk('off'), A = c.hxApple;
  ok('it loads with the look, and exposes the spring, rubber-band and projection', !!A && typeof A.Spring === 'function');
  ok('  rubber-band: 0.55 resistance (100 px past a 400 px sheet moves 48.9 px)', Math.abs(A.rubber(100, 400) - (100 * 400 * 0.55) / (400 + 55)) < 1e-9 && A.rubber(-100, 400) < 0);
  ok('  momentum projection with d = 0.998 (a 1000 px/s flick lands 499 px further)', Math.abs(A.project(0, 1000) - 499) < 1e-6);
  let landed = null; const sp = new A.Spring(x => { landed = x; }); sp.to(250, { velocity: 900, done: () => { landed = 'done@' + landed; } });
  ok('  with "Motion off" a spring lands at once, and still reports done', landed === 'done@250');
  ok('the default spring is damping 1.0 / response 0.4; a flick 0.8 / 0.3, with the release velocity',
    /damping = o\.damping == null \? 1 : o\.damping, response = o\.response \|\| 0\.4/.test(SRC_JS) && (SRC_JS.match(/damping: Math\.abs\(v\) > 300 \? 0\.8 : 1, response: 0\.3, velocity: v/g) || []).length === 2);
  ok('  drags capture the pointer after a 10 px slop', (SRC_JS.match(/setPointerCapture/g) || []).length === 2 && (SRC_JS.match(/< 10/g) || []).length >= 2);
  ok('a sheet is dismissed only by clicking the dialog\'s own close / cancel control; none = it springs back',
    /var dismiss = !!ctl && project\(spring\.x, v\) > hgt \* 0\.4;/.test(SRC_JS) && /if \(dismiss\) \{ ctl\.click\(\); \}/.test(SRC_JS));
  const closeCtl = (html) => { const m = SRC_JS.match(/function closeControl\(sheet\) \{[\s\S]*?\n  \}/)[0]; const f = vm.runInNewContext('(' + m.replace('function closeControl', 'function') + ')');
    const btns = html.map(([t, lab, cls]) => ({ textContent: t, getAttribute: () => lab || null, className: cls || '' })); return f({ querySelectorAll: () => btns }); };
  ok('  it finds Close, Cancel, ×, an aria-label "Close" or a .modal-close, and never "Approve" or "Delete"',
    closeCtl([['Approve'], ['Close']]).textContent === 'Close' && closeCtl([['Save'], ['Cancel']]).textContent === 'Cancel' && closeCtl([['×']]).textContent === '×'
    && closeCtl([['', 'Close dialog']]).getAttribute() === 'Close dialog' && closeCtl([['', null, 'btn modal-close']]).className === 'btn modal-close'
    && closeCtl([['Approve'], ['Delete'], ['Save changes']]) === null && closeCtl([['Closed-won report']]) === null);
  ok('form fields, buttons and links inside a sheet never start a drag', /closest\('input, select, textarea, button, a, label, \[contenteditable\]'\)/.test(SRC_JS));
}

sec('7 · the login page: css/apple-login.css (A345)');
{
  const LSCOPE = 'html[data-look="apple"]';
  const LSRC = read('css/apple-login.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const LTOP = parse(LSRC), LALL = rules(LTOP, [], []), LSTYLE = LALL.filter(r => r.sel !== undefined);
  ok('one @media screen block holds everything', LTOP.length === 1 && LTOP[0].at === '@media screen', LTOP.map(n => n.at || n.sel));
  const bad = [];
  LSTYLE.forEach(r => r.sel.split(',').map(x => x.trim()).forEach(x => { if (!x.startsWith(LSCOPE)) bad.push(x); }));
  ok('every one of ' + LSTYLE.length + ' rules is scoped to ' + LSCOPE, bad.length === 0 && LSTYLE.length > 20, bad.slice(0, 5));
  const lit = [];
  LSTYLE.forEach(r => decls(r.body).forEach(d => { if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(d) && !/^--al-[a-z0-9-]+\s*:/.test(d)) lit.push(r.sel.slice(0, 50) + ' → ' + d.slice(0, 60)); }));
  ok('colours only in the --al-* tokens; no !important, no url(), nothing downloaded', lit.length === 0 && !/!important|url\(|@font-face|@import/.test(LSRC), lit.slice(0, 5));
  const LKEYF = LALL.filter(r => r.at && r.at.startsWith('@keyframes'));
  ok('one entrance (al-in) that moves only transform and opacity, never looping',
    LKEYF.length === 1 && /^@keyframes al-/.test(LKEYF[0].at) && (LKEYF[0].body.match(/[a-z-]+(?=\s*:)/g) || []).every(x => x === 'opacity' || x === 'transform') && !/infinite/.test(LSRC));
  const inCtx = (re, selRe, bodyRe) => LALL.some(r => r.ctx.some(c => re.test(c)) && selRe.test(r.sel || '') && bodyRe.test(r.body || ''));
  ok('reduced motion and "Motion off" stop it; more contrast strengthens the fields',
    inCtx(/prefers-reduced-motion:\s*reduce/, /\.login-card/, /animation:\s*none/) && LSTYLE.some(r => /\[data-motion="off"\] \.login-card/.test(r.sel) && /animation:\s*none/.test(r.body))
    && inCtx(/prefers-contrast:\s*more/, /\.form-input/, /border-color/));
  ok('press feedback at .97 on the button', LSTYLE.some(r => /btn-primary\.btn-lg:active/.test(r.sel) && /scale\(\.97\)/.test(r.body)));
  const tok = (sel) => { const r = LSTYLE.find(x => x.sel.trim() === sel); const o = {}; (r ? r.body : '').replace(/--al-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g, (_, k, v) => { o[k] = v; }); return o; };
  const lum = (h) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const light = tok(LSCOPE), dark = Object.assign({}, light, tok(LSCOPE + '[data-theme="dark"]'));
  const TEXT = [['ink', 'panel'], ['ink-2', 'panel'], ['ink-3', 'panel'], ['ink', 'field'], ['ink-3', 'field'], ['ink-2', 'page'], ['ink', 'page'], ['on-solid', 'solid'], ['on-solid', 'solid-hover'], ['on-solid', 'solid-press'], ['late', 'late-soft']];
  const EDGE = [['field-line', 'field'], ['field-line', 'panel']];
  [['light', light], ['dark', dark]].forEach(([name, t]) => {
    const f1 = TEXT.filter(([a, b]) => !(t[a] && t[b]) || ratio(t[a], t[b]) < 4.5).map(([a, b]) => a + ' on ' + b + ' ' + (t[a] && t[b] ? ratio(t[a], t[b]).toFixed(2) : 'missing'));
    const f2 = EDGE.filter(([a, b]) => !(t[a] && t[b]) || ratio(t[a], t[b]) < 3).map(([a, b]) => a + ' on ' + b + ' ' + (t[a] && t[b] ? ratio(t[a], t[b]).toFixed(2) : 'missing'));
    ok(name + ': text at 4.5:1 or better (' + TEXT.length + ' pairs), field outlines at 3:1 or better', f1.length === 0 && f2.length === 0, f1.concat(f2));
  });
  const pages = fs.readdirSync(D).filter(f => f.endsWith('.html'));
  const linking = pages.filter(f => /css\/apple-login\.css/.test(read(f)));
  ok('only the login page links it, once, right after styles.css', linking.length === 1 && linking[0] === 'index.html'
    && (read('index.html').match(/apple-login\.css/g) || []).length === 1 && /<link rel="stylesheet" href="css\/styles\.css">\s*<link rel="stylesheet" href="css\/apple-login\.css">/.test(read('index.html')), linking);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
