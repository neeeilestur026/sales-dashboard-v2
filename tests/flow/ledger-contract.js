/* A336 — the LEDGER contract: the whole-portal "Ledger" look stays a switchable layer.
 *
 * Run:  node tests/flow/ledger-contract.js
 *
 * 1 · css/ledger.css cannot leak: every selector is scoped to html[data-skin="ledger"] and sits in
 *     @media screen (print and PDFs keep the classic look); colours are written once as --l-p-*
 *     primitives; no blur; motion is transform/opacity, short, and stops under data-motion="off".
 * 2 · contrast: the text and fill pairs meet WCAG AA in both themes.
 * 3 · the pages: exactly the in-scope pages link ledger.css (once, last in <head>) and ledger-nav.js
 *     (right after auth.js); the phone apps, the login page and the one-off tools never do.
 * 4 · the switch (js/theme.js): a truth table over role × FlowSettings × role list × the person's
 *     choice × preview × linked × host; the warehouse never gets it, and nothing is set while off.
 * 5 · the navbars, computed live from auth.js: with the look off, every role's navbar is byte-for-byte
 *     what auth.js renders without the A336 lines; with it on, every role keeps every page its
 *     classic navbar links, gains only its approved home-page links (each one its page's own guard
 *     admits), marks exactly one current page, and keeps the bell and theme ids once. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');

const CSS = read('css/ledger.css');
const ROLES = ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'];
const ALL_ROLES = ROLES.concat(['warehouse']);

/* ── a small CSS reader: comments out, then blocks as a tree ─────────────────────────────── */
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
const SRC = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const TOP = parse(SRC);
function rules(list, ctx, acc) {
  (list || []).forEach(n => {
    if (n.kids) rules(n.kids, ctx.concat([n.at]), acc);
    else if (n.sel !== undefined) acc.push({ sel: n.sel, body: n.body, ctx });
    else acc.push({ at: n.at, body: n.body, ctx });
  });
  return acc;
}
const ALL = rules(TOP, [], []);
const STYLE = ALL.filter(r => r.sel !== undefined && r.sel !== '@font-face');
const KEYF = ALL.filter(r => r.at && r.at.startsWith('@keyframes'));

sec('1 · ledger.css cannot leak');
{
  const faces = TOP.filter(n => n.sel === '@font-face');
  ok('exactly two @font-face rules (Geist, Geist Mono), their files on disk', faces.length === 2
    && faces.every(f => { const m = /url\('\/static\/fonts\/([^']+)'\)/.exec(f.body); return m && fs.existsSync(path.join(ROOT, 'static/fonts', m[1])); }), faces.map(f => f.body.slice(0, 80)));
  const others = TOP.filter(n => n.sel !== '@font-face');
  ok('everything else is one @media screen block', others.length === 1 && others[0].at === '@media screen', others.map(n => n.at || n.sel));
  ok('url() appears only in the @font-face rules', (SRC.match(/url\(/g) || []).length === 2);
  const bad = [];
  STYLE.forEach(r => r.sel.split(',').map(s => s.trim()).forEach(s => { if (!s.startsWith('html[data-skin="ledger"]')) bad.push(s); }));
  ok('every one of ' + STYLE.length + ' rules is scoped to html[data-skin="ledger"]', bad.length === 0 && STYLE.length > 100, bad.slice(0, 5));
  ok('no :root and no bare element rule', !/(^|,)\s*:root/.test(STYLE.map(r => r.sel).join(',')));
  const hexOutside = [];
  STYLE.forEach(r => r.body.split(';').forEach(d => { if (/#[0-9a-fA-F]{3,8}\b/.test(d) && !/^\s*--l-p-[a-z0-9-]+\s*:/.test(d)) hexOutside.push(r.sel.slice(0, 50) + ' → ' + d.trim().slice(0, 60)); }));
  ok('hex colours appear only in --l-p-* primitives', hexOutside.length === 0, hexOutside.slice(0, 5));
  const rgbaOutside = [];
  STYLE.forEach(r => r.body.split(/;(?![^(]*\))/).forEach(d => { if (/rgba?\(/.test(d) && !/^\s*--l-p-[a-z0-9-]+\s*:/.test(d)) rgbaOutside.push(d.trim().slice(0, 60)); }));
  ok('so do rgba() colours', rgbaOutside.length === 0, rgbaOutside.slice(0, 5));
  const blur = SRC.match(/backdrop-filter\s*:\s*[^;}]+/g) || [];
  ok('no blur: backdrop-filter only ever switched off', blur.length > 0 && blur.every(b => /:\s*none\s*$/.test(b)), blur);
  ok('the classic blur token is re-pointed to none', /--hx-blur:none/.test(SRC));
  const imp = STYLE.filter(r => /!important/.test(r.body));
  ok('!important only in the motion off-switch', imp.length === 1 && /data-motion="off"/.test(imp[0].sel), imp.map(r => r.sel.slice(0, 80)));
  ok('keyframes are named ledger-* and move only transform and opacity', KEYF.length >= 1 && KEYF.every(k => /^@keyframes ledger-/.test(k.at)
    && (k.body.match(/[a-z-]+(?=\s*:)/g) || []).every(p => p === 'opacity' || p === 'transform')), KEYF.map(k => k.at));
  const anims = STYLE.filter(r => /(^|;)\s*animation\s*:/.test(r.body));
  ok('one-shot animations last 400 ms or less; the only loop is the loading line under .l-busy',
    anims.every(r => { const m = /animation\s*:\s*([a-z-]+)\s+([\d.]+)(m?s)[^;]*/.exec(r.body); if (!m) return /animation\s*:\s*none/.test(r.body);
      const ms = parseFloat(m[2]) * (m[3] === 's' ? 1000 : 1), loop = /infinite/.test(m[0]);
      return loop ? (m[1] === 'ledger-busy' && /\.l-busy/.test(r.sel)) : ms <= 400; }), anims.map(r => r.body.match(/animation[^;]*/)[0]));
  const trans = STYLE.filter(r => /(^|;)\s*transition\s*:/.test(r.body));
  ok('transitions name their properties (never all) and last 200 ms or less', trans.every(r => { const v = /transition\s*:\s*([^;]+)/.exec(r.body)[1];
    return v.trim() === 'none !important' || (!/\ball\b/.test(v) && (v.match(/([\d.]+)(m?s)/g) || []).every(t => parseFloat(t) * (/ms$/.test(t) ? 1 : 1000) <= 200)); }), trans.map(r => r.body.match(/transition[^;]*/)[0]));
  const off = STYLE.find(r => /data-motion="off"/.test(r.sel));
  ok('data-motion="off" stops every animation and transition (theme.js sets it for reduced motion too)', !!off && /animation:\s*none !important/.test(off.body) && /transition:\s*none !important/.test(off.body));
  ok('the focus ring is the accent', STYLE.some(r => /:focus-visible/.test(r.sel) && /outline:\s*2px solid var\(--l-accent\)/.test(r.body)));
  ok('a dark set re-defines the primitives', STYLE.some(r => /^html\[data-skin="ledger"\]\[data-theme="dark"\]$/.test(r.sel.trim()) && /--l-p-page:/.test(r.body)));
  ok('the rail turns into a bottom bar under 900px', ALL.some(r => r.ctx.some(c => /max-width:\s*899px/.test(c)) && /\.l-rail/.test(r.sel || '') && /bottom:\s*0/.test(r.body || '')));
}

/* ── 2 · contrast ──────────────────────────────────────────────────────────────────────────── */
sec('2 · contrast meets WCAG AA in both themes');
{
  const block = (sel) => { const r = STYLE.find(x => x.sel.trim() === sel); const o = {}; (r ? r.body : '').replace(/--l-p-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g, (_, k, v) => { o[k] = v; }); return o; };
  const light = block('html[data-skin="ledger"]'), dark = Object.assign({}, light, block('html[data-skin="ledger"][data-theme="dark"]'));
  const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const PAIRS = [['ink', 'panel'], ['ink-2', 'panel'], ['ink-3', 'panel'], ['ink', 'page'], ['ink-2', 'page'], ['ink-3', 'page'], ['ink', 'inset'], ['ink-3', 'inset'],
    ['accent', 'panel'], ['accent', 'page'], ['accent', 'accent-soft'], ['accent-ink', 'accent'], ['accent-ink', 'accent-hover'], ['on-solid', 'solid'], ['on-solid', 'solid-hover'],
    ['late', 'panel'], ['late', 'late-soft'], ['soon', 'panel'], ['soon', 'soon-soft'], ['ok', 'panel'], ['ok', 'ok-soft'], ['ink', 'field'], ['ink-3', 'field'], ['on-solid', 'late']];
  [['light', light], ['dark', dark]].forEach(([name, t]) => {
    const fails = PAIRS.filter(([f, b]) => !(t[f] && t[b]) || (name === 'dark' && f === 'on-solid' && b === 'late' ? false : ratio(t[f], t[b]) < 4.5)).map(([f, b]) => f + ' on ' + b + ' ' + (t[f] && t[b] ? ratio(t[f], t[b]).toFixed(2) : 'missing'));
    ok(name + ': ' + PAIRS.length + ' pairs at 4.5:1 or better', fails.length === 0, fails);
  });
}

/* ── 3 · the pages ─────────────────────────────────────────────────────────────────────────── */
sec('3 · exactly the in-scope pages carry the look');
const EXCLUDED = ['scan.html', 'collect.html', 'labels.html', 'index.html', 'director-recommender.html',
  'reconcile-2026-costs.html', 'replace-2026-sos.html', 'update-2025-costs.html'];
const PAGES = fs.readdirSync(D).filter(f => f.endsWith('.html') && !f.startsWith('_')).sort();
const IN = PAGES.filter(f => !EXCLUDED.includes(f) && !f.startsWith('migrate-'));
{
  const bad = { count: [], last: [], nav: [], excluded: [], direct: [] };
  IN.forEach(f => {
    const h = read(f), head = h.split('</head>')[0];
    if ((h.match(/css\/ledger\.css/g) || []).length !== 1) bad.count.push(f);
    const links = head.match(/<link rel="stylesheet" href="[^"]+">/g) || [];
    if (links[links.length - 1] !== '<link rel="stylesheet" href="css/ledger.css">' || /<link rel="stylesheet"[^>]*>\s*(?=[\s\S]*<link rel="stylesheet")/.test(head.split('css/ledger.css')[1] || '')) bad.last.push(f);
    if (!/<script src="js\/auth\.js"><\/script>\s*<script src="js\/ledger-nav\.js"><\/script>/.test(h) || (h.match(/js\/ledger-nav\.js/g) || []).length !== 1) bad.nav.push(f);
  });
  PAGES.filter(f => !IN.includes(f)).forEach(f => { if (/ledger\.css|ledger-nav\.js/.test(read(f))) bad.excluded.push(f); });
  PAGES.forEach(f => { if (/js\/ledger\.js/.test(read(f))) bad.direct.push(f); });
  ok(IN.length + ' pages link ledger.css exactly once', bad.count.length === 0 && IN.length >= 100, bad.count);
  ok('  as the last stylesheet in <head>', bad.last.length === 0, bad.last);
  ok('  and load ledger-nav.js right after auth.js', bad.nav.length === 0, bad.nav);
  ok('the phone apps, the login page and the one-off tools link neither', bad.excluded.length === 0, bad.excluded);
  ok('no page links js/ledger.js (theme.js loads it only while the look is on)', bad.direct.length === 0, bad.direct);
}

/* ── 4 · the switch ────────────────────────────────────────────────────────────────────────── */
sec('4 · the switch: on only when the director, the role list and the person agree');
const THEME = read('js/theme.js');
function runTheme(o) {
  const store = Object.assign({}, o.store || {});
  if (o.role) store.session = JSON.stringify({ name: 'T', role: o.role, loginTime: Date.now() });
  const attrs = {}, appended = [];
  const el = (tag) => ({ tagName: tag, setAttribute(k, v) { this[k] = v; }, set textContent(v) { this._t = v; } });
  const ctx = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hostname: o.host || 'hi-escorp-portal-wufz.onrender.com', search: o.search || '', pathname: '/' + (o.page || 'flow-ar-aging.html') },
    URLSearchParams, JSON, Date, parseInt, Array, String,
    matchMedia: () => ({ matches: !!o.reduced }),
    CustomEvent: function () {},
    document: {
      documentElement: { setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k] || null; }, classList: { add() {}, remove() {} } },
      body: { setAttribute() {}, classList: { add() {}, remove() {} } },
      head: { appendChild(n) { appended.push(n); } },
      createElement: el,
      querySelector: (s) => (s === 'link[href="css/ledger.css"]' && o.linked !== false ? {} : null),
      querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, dispatchEvent() {}
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(THEME, ctx); } catch (e) { threw = e.message; }
  return { on: attrs['data-skin'] === 'ledger', attrs, js: appended.filter(n => n.src === 'js/ledger.js').length, hx: ctx.hxSkinOn === true, threw, store, item: ctx.hxSkinNavItem ? ctx.hxSkinNavItem() : null, looks: ctx.hxSkinLookItems ? ctx.hxSkinLookItems() : null };
}
{
  let cases = 0, wrong = [], threw = [], leaks = [];
  const SW = [null, 'off', 'optin', 'on', 'junk'], ME = [null, 'new', 'classic'], PV = [null, 'ledger', 'off'], HOSTS = ['localhost', 'hi-escorp-portal-wufz.onrender.com'];
  ALL_ROLES.concat([null]).forEach(role => SW.forEach(sw => ME.forEach(me => PV.forEach(pv => [true, false].forEach(linked => HOSTS.forEach(host => [null, 'accounting,hr', 'admin'].forEach(rl => {
    const store = {};
    if (sw) store.hx_lg_sw = sw; if (me) store.hx_lg_me = me; if (pv) store.hx_lg_pv = pv; if (rl) store.hx_lg_roles = rl;
    const r = runTheme({ role, store, linked, host });
    cases++;
    const okRole = !!role && ROLES.includes(role) && linked, local = host === 'localhost';
    const allowed = !rl || rl.split(',').includes(role);
    const swv = ['off', 'optin', 'on'].includes(sw) ? sw : null;
    const want = okRole && (pv === 'off' ? false : (pv === 'ledger' && local) || (allowed && (swv === 'on' ? me !== 'classic' : swv === 'optin' && me === 'new')));
    if (r.threw) threw.push(r.threw);
    if (r.on !== want) wrong.push({ role, sw, me, pv, linked, host, rl, got: r.on });
    if (!r.on && (r.js || r.hx || 'data-page' in r.attrs || 'data-motion' in r.attrs)) leaks.push({ role, sw, me, pv });
    if (r.on && (r.js !== 1 || !r.hx || !r.attrs['data-page'])) leaks.push({ role, sw, me, pv, on: true });
  })))))));
  ok(cases + ' cases: the look is on exactly when it should be', wrong.length === 0, wrong.slice(0, 3));
  ok('  theme.js never throws', threw.length === 0, threw.slice(0, 2));
  ok('  off sets nothing and loads nothing; on sets data-skin, data-page and loads js/ledger.js once', leaks.length === 0, leaks.slice(0, 3));
  ok('  the warehouse never gets it, whatever the switch says', ['on', 'optin'].every(sw => !runTheme({ role: 'warehouse', store: { hx_lg_sw: sw, hx_lg_me: 'new', hx_lg_pv: 'ledger' }, host: 'localhost' }).on));
  ok('  ?skin=ledger previews only on localhost; ?skin=off and ?skin=reset work anywhere',
    runTheme({ role: 'admin', search: '?skin=ledger', host: 'localhost' }).on && !runTheme({ role: 'admin', search: '?skin=ledger' }).on
    && !runTheme({ role: 'admin', search: '?skin=off', store: { hx_lg_sw: 'on' } }).on
    && runTheme({ role: 'admin', search: '?skin=reset', store: { hx_lg_sw: 'on', hx_lg_pv: 'off' } }).on);
  ok('  ?look=classic and ?look=new are remembered; ?motion=off sets data-motion="off"',
    !runTheme({ role: 'hr', search: '?look=classic', store: { hx_lg_sw: 'on' } }).on && runTheme({ role: 'hr', search: '?look=new', store: { hx_lg_sw: 'optin' } }).on
    && runTheme({ role: 'hr', search: '?motion=off', store: { hx_lg_sw: 'on' } }).attrs['data-motion'] === 'off');
  ok('  reduced motion turns motion off', runTheme({ role: 'sales', reduced: true, store: { hx_lg_sw: 'on' } }).attrs['data-motion'] === 'off');
  ok('  a junk role list or a junk switch value never turns it on', !runTheme({ role: 'admin', store: { hx_lg_sw: 'ON!' } }).on && runTheme({ role: 'admin', store: { hx_lg_sw: 'on', hx_lg_roles: '<script>' } }).on);
  ok('the classic navbar offers "Try the new look" only while the director offers it, and never while on',
    runTheme({ role: 'sales', store: { hx_lg_sw: 'optin' } }).item === '<a class="lg-try" href="?look=new">Try the new look</a>'
    && runTheme({ role: 'sales', store: { hx_lg_sw: 'off' } }).item === '' && runTheme({ role: 'sales' }).item === ''
    && runTheme({ role: 'sales', store: { hx_lg_sw: 'on' } }).item === '' && runTheme({ role: 'warehouse', store: { hx_lg_sw: 'on' } }).item === ''
    && runTheme({ role: 'sales', store: { hx_lg_sw: 'optin', hx_lg_roles: 'admin' } }).item === '');
  ok('  and the Ledger avatar menu offers the way back', /href="\?look=classic">Classic look/.test(runTheme({ role: 'sales', store: { hx_lg_sw: 'on' } }).looks));
}

/* ── 5 · the navbars ───────────────────────────────────────────────────────────────────────── */
sec('5 · the navbars, computed live from auth.js');
const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js'), FAPI = read('js/flow-api.js'), API = read('js/api.js');
const HOOK = "  if (window.hxSkinOn && typeof ledgerNavbar === 'function' && ledgerNavbar(nav, session, initials)) return;   // A336, the Ledger look\n";
const ITEM = "${typeof hxSkinNavItem === 'function' ? hxSkinNavItem() : ''}";
const AUTH_BEFORE = AUTH.replace(HOOK, '').replace(ITEM, '');
function navbar(src, role, o) {
  o = o || {};
  const stub = () => ({ addEventListener() {}, setAttribute() {}, focus() {}, style: { setProperty() {} }, hidden: true, dataset: {}, getBoundingClientRect: () => ({ top: 100 }), contains: () => false });
  const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => stub(), classList: { add() {}, remove() {} }, addEventListener() {} };
  const session = { name: 'Test User', role, loginTime: Date.now() };
  const ctx = {
    console, Date, JSON, Math, Object, Array, String, Number, Promise, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    localStorage: { getItem: (k) => (k === 'session' ? JSON.stringify(session) : null), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: '', pathname: '/' + (o.page || 'zz-none.html'), search: '' },
    document: { getElementById: () => el, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    navigator: { userAgent: 'node' }
  };
  ctx.window = ctx;
  if (o.on) ctx.hxSkinOn = true;
  if (o.item) ctx.hxSkinNavItem = o.item;
  vm.createContext(ctx);
  vm.runInContext(API, ctx);
  try { vm.runInContext(FAPI, ctx); } catch (e) {}
  vm.runInContext(src, ctx);
  if (o.nav !== false) vm.runInContext(NAV, ctx);
  vm.runInContext('renderNavbar("zz-none")', ctx);
  return { html: el.innerHTML, ctx };
}
const hrefs = (html) => [...new Set((html.match(/href="([a-z0-9-]+\.html)"/g) || []).map(x => x.slice(6, -1)))];
/* The pages a role reaches only from its own home page — the Ledger rail lists them. Each must be
   admitted by its page's own require* guard (checked below), so no role is offered a page it could
   not open before. */
const HOME_EXTRA = {
  admin: ['admin-reports.html', 'admin-summary.html', 'admin-team.html'],
  director: ['flow-purchase-orders.html'],
  accounting: ['accounting-billing.html'],
  management: ['management-sales-orders.html'],
  sales: [], marketing: [], leadgen: [],
  hr: ['hr-accreditations.html', 'hr-campaigns.html', 'hr-content-calendar.html', 'hr-grievances.html', 'hr-memos.html', 'hr-reviews.html', 'hr-training.html']
};
function guardAdmits(page, role) {
  const src = read(page), js = [...src.matchAll(/<script src="js\/([^"]+)"/g)].map(m => m[1]).filter(j => !['theme.js', 'api.js', 'auth.js', 'flow-api.js', 'ledger-nav.js'].includes(j));
  let text = src; js.forEach(j => { try { text += read('js/' + j); } catch (e) {} });
  const g = (text.match(/\b(require[A-Z][A-Za-z]*|requireAuth)\(\s*\)/) || [])[1];
  if (!g) return 'no guard';
  const session = { name: 'T', role, username: 'u', loginTime: Date.now() };
  const loc = { href: 'x', pathname: '/x.html', search: '' };
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, JSON, Math, Object, Array, String, Number, Promise, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    localStorage: { getItem: (k) => (k === 'session' ? JSON.stringify(session) : null), setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: loc, alert() {}, navigator: { userAgent: 'node' }, fetch: () => new Promise(() => {}),
    document: { getElementById: () => null, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(FAPI, ctx); } catch (e) {}
  vm.runInContext(AUTH, ctx);
  const r = vm.runInContext(g + '()', ctx);
  return loc.href === 'x' && r !== null && r !== false && r !== undefined;
}
{
  const notSame = [];
  ALL_ROLES.forEach(r => { if (navbar(AUTH, r).html !== navbar(AUTH_BEFORE, r, { nav: false }).html) notSame.push(r); });
  ok('the A336 lines in auth.js are the two expected, and nothing else changed there', AUTH.includes(HOOK) && AUTH.includes(ITEM) && AUTH_BEFORE.split('\n').length === AUTH.split('\n').length - 1);
  ok('with the look off, all 9 navbars are byte-identical to auth.js without the A336 lines', notSame.length === 0, notSame);
  const withTry = navbar(AUTH, 'sales', { item: () => '<a class="lg-try" href="?look=new">Try the new look</a>' }).html;
  ok('  the only difference the switch can make while off is the "Try the new look" link', withTry.replace('<a class="lg-try" href="?look=new">Try the new look</a>', '') === navbar(AUTH_BEFORE, 'sales', { nav: false }).html);

  const missing = [], extra = [], shut = [], current = [], ids = [];
  ROLES.forEach(role => {
    const classic = hrefs(navbar(AUTH_BEFORE, role, { nav: false }).html);
    const r = navbar(AUTH, role, { on: true });
    const pages = vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', r.ctx);
    classic.forEach(h => { if (!pages.includes(h)) missing.push(role + ': ' + h); });
    pages.forEach(h => { if (!classic.includes(h) && !HOME_EXTRA[role].includes(h)) extra.push(role + ': ' + h); });
    HOME_EXTRA[role].forEach(h => { if (!pages.includes(h)) missing.push(role + ' (home): ' + h); if (guardAdmits(h, role) !== true) shut.push(role + ': ' + h); });
    pages.forEach(h => {
      const html = navbar(AUTH, role, { on: true, page: h }).html, n = (html.match(/aria-current="page"/g) || []).length;
      if (n < 1 || n > 2) current.push(role + ': ' + h + ' marked ' + n);
    });
    ['notifBell', 'notifBadge', 'notifDropdown', 'notifList', 'navThemeToggle'].forEach(id => { if ((r.html.match(new RegExp('id="' + id + '"', 'g')) || []).length !== 1) ids.push(role + ': ' + id); });
    if (!/class="l-rail"/.test(r.html) || /id="navLinks"/.test(r.html)) ids.push(role + ': not the Ledger bar');
  });
  ok('with the look on, every role keeps every page of its classic navbar', missing.length === 0, missing);
  ok('  and gains only its approved home-page links', extra.length === 0, extra);
  ok('  each of which the page\'s own guard admits for that role', shut.length === 0, shut);
  ok('  every page marks itself current (its rail section, and its flyout link or avatar entry)', current.length === 0, current.slice(0, 5));
  ok('  the bell, its badge, dropdown and list, and the theme toggle keep their ids, once', ids.length === 0, ids);
  const wh = navbar(AUTH, 'warehouse', { on: true }).html;
  ok('the warehouse keeps the classic navbar even if asked for the look', /id="navLinks"/.test(wh) && !/l-rail/.test(wh));
  ok('ledger-nav.js escapes through api.js (no helper of its own) and holds no colour', /hxEsc\(s\)/.test(NAV) && !/#[0-9a-fA-F]{3,6}\b/.test(NAV));
}

console.log('\n' + (FAIL ? 'FAIL — ' + FAIL + ' of ' + N : 'all ' + N + ' passed'));
process.exit(FAIL ? 1 : 0);
