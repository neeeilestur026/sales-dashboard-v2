/* A378 — the phone app for the Apple look (js/apple-phone.js, css/apple-phone.css, loaded by js/theme.js).
 *
 * Run:  node tests/flow/apple-phone.js
 *
 * Neil, 27 Oct 2026: "redesign the organization in the mobile app in all user dashboards — use apple design skill to its
 * utmost", with a tab bar, a navigation bar, sheets, a + button, toasts as on the web and designed empty states.
 *   1 · the tabs: every role's four sections are real LEDGER_NAV sections, and every page the role has is reachable
 *       from Home, a tab or More (nothing the drawer reaches goes missing)
 *   2 · the + button: each action is offered only where the role has the page, and each ?new= target handles it
 *   3 · hxDeepLink: runs once, drops the parameter, answers the same-page event; flowEmpty and flowOpenNew
 *   4 · the shell stays out of the way: above 640 px, without the look, with ?phone=off, on scan and collect
 *   5 · the home screens: each folded section exists on its home, and the empty / loading / failed sort
 *   6 · css/apple-phone.css keeps css/apple.css's rules: scoped, tokens only, no !important, blur only on the chrome,
 *       press at .97, the person's settings
 *   7 · team-report.js never writes "them's"
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const ROLES = ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'];
const PHONE = read('js/apple-phone.js');

/* the nav, as the pages load it */
const navCtx = { hxEsc: (s) => String(s == null ? '' : s), location: { pathname: '/x.html' }, document: {}, window: {}, localStorage: { getItem: () => null } };
vm.createContext(navCtx);
vm.runInContext(read('js/ledger-nav.js') + '\n;this.LEDGER_NAV = LEDGER_NAV; this.LEDGER_ME = LEDGER_ME; this.LEDGER_ICONS = LEDGER_ICONS;', navCtx);

/* apple-phone.js in a small stand-in page: returns what it drew and what it exposed */
function runPhone(o) {
  o = o || {};
  const attrs = Object.assign({ 'data-look': 'apple', 'data-phone': 'on', 'data-page': 'admin' }, o.attrs || {});
  const drawn = [], classes = [], listeners = {};
  const body = { appendChild: (n) => { drawn.push(n); return n; }, insertBefore: (n) => { drawn.push(n); return n; } };
  const ctx = {
    window: null, console, Date, Math, JSON, String, Array, Object, setTimeout, clearTimeout,
    location: { pathname: '/' + (o.page || 'admin.html'), href: 'https://x/' + (o.page || 'admin.html'), origin: 'https://x' },
    localStorage: { getItem: (k) => (k === 'session' && o.role ? JSON.stringify({ role: o.role, name: 'Test Person' }) : null) },
    matchMedia: () => ({ matches: !!o.phone, addEventListener() {} }),
    history: { state: null, pushState() {}, replaceState() {}, back() {}, go() {} },
    document: {
      readyState: 'complete', body,
      documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; },
        classList: { add: (c) => classes.push(c), remove() {}, contains: () => false, toggle() {} }, style: { setProperty() {} } },
      addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
      createElement: (tag) => ({ tagName: String(tag).toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; }, addEventListener() {}, appendChild(c) { this.children.push(c); return c; },
        querySelector: () => null, querySelectorAll: () => [] }),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
    },
    addEventListener() {}, requestAnimationFrame: (f) => setTimeout(f, 0)
  };
  ctx.window = ctx;
  if (o.nav) { ctx.LEDGER_NAV = navCtx.LEDGER_NAV; ctx.LEDGER_ME = navCtx.LEDGER_ME; ctx.ledgerPages = navCtx.ledgerPages; ctx._lgIcon = navCtx._lgIcon; ctx.hxEsc = navCtx.hxEsc; }
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(PHONE, ctx); } catch (e) { threw = e.message; }
  return { ctx, drawn, classes, threw, api: ctx.hxPhone };
}
const P = runPhone({ nav: true }).api;   // the shell's own decisions, per role

sec('1 · the tabs reach every page');
{
  ok('the shell exposes its decisions (hxPhone)', !!P && typeof P.tabsFor === 'function' && typeof P.restFor === 'function' && typeof P.actionsFor === 'function');
  eq('roles with a tab bar', Object.keys(P.TABS).sort(), ROLES.slice().sort());
  const want = { sales: 'Home|Quotes|Clients|Report', admin: 'Home|Sell|Buy & pay|Stock', accounting: 'Home|Collect|Pay|Books', management: 'Home|Approvals|Sell|Money',
    director: 'Home|Quotes|Payables|Team', leadgen: 'Home|Report|Quotes', hr: 'Home|People|Work', marketing: 'Home|Report' };   // Neil's sets, 27 Oct (management: Money)
  ROLES.forEach(r => {
    const tabs = P.tabsFor(r);
    eq(r + ': the bar reads', tabs.map(t => t.label).join('|'), want[r]);
    ok(r + ': each tab is a real LEDGER_NAV section', P.TABS[r].every(p => navCtx.LEDGER_NAV[r].some(s => s[0] === p[0])) && tabs.length === P.TABS[r].length + 1);
    ok(r + ': at most four tabs before More', tabs.length <= 4);
    const reach = new Set();
    const add = (t) => (typeof t === 'string' ? [[t]] : t).forEach(p => reach.add(p[0]));
    tabs.forEach(t => add(t.t));
    P.restFor(r).forEach(s => add(s[2]));
    (navCtx.LEDGER_ME[r] || []).forEach(p => reach.add(p[0]));
    const missing = navCtx.ledgerPages(r).map(p => p.href).filter(h => !reach.has(h));
    ok(r + ': every one of its ' + navCtx.ledgerPages(r).length + ' pages is on a tab or in More', missing.length === 0, missing);
    const dup = P.restFor(r).filter(s => tabs.some(t => t.sec === s[0]));
    ok(r + ': More does not repeat a section on the bar', dup.length === 0, dup.map(s => s[0]));
  });
}

sec('2 · the + button');
{
  ROLES.forEach(r => {
    const acts = P.actionsFor(r, navCtx.ledgerPages(r));
    ok(r + ': ' + acts.length + ' create action(s), every one on a page the role has', acts.length >= 1 && acts.length === P.CREATE[r].length, P.CREATE[r].map(a => a[0]));
    ok(r + ': each action is labelled and has an icon the nav draws', acts.every(a => a[1] && !!navCtx.LEDGER_ICONS[a[2]]), acts.map(a => a[2]));
  });
  ok('an action the role has no page for is left out', P.actionsFor('sales', [{ href: 'dashboard.html' }]).length === 0 && P.actionsFor('admin', [{ href: 'flow-receiving.html' }]).length === 1);
  /* every ?new= target: its page loads a script that answers hxDeepLink */
  const targets = new Set();
  Object.values(P.CREATE).forEach(list => list.forEach(a => { if (/[?&]new=/.test(a[0])) targets.add(a[0].split('?')[0]); }));
  targets.forEach(pg => {
    const html = read(pg), srcs = (html.match(/<script src="js\/[^"]+"/g) || []).map(t => t.slice(13, -1));
    const handled = srcs.filter(f => fs.existsSync(D + f) && /hxDeepLink\(/.test(read(f)));
    ok(pg + ' answers ?new= (' + (handled[0] || 'nothing') + ')', handled.length >= 1, srcs);
  });
  const sameNew = (pg, v) => Object.values(P.CREATE).some(list => list.some(a => a[0] === pg + '?new=' + v));
  ok('the sales daily report answers "call", lead gen and marketing their own', sameNew('my-daily-report.html', 'call') && sameNew('leadgen-home.html', 'log') && sameNew('marketing-home.html', 'leads')
    && /v === 'call'/.test(read('js/my-daily-report.js')) && /openRecModal\('leads', null\)/.test(read('js/marketing-home.js')) && /hxDeepLink\(\(\) => openDock\(\)\)/.test(read('js/leadgen-home.js')));
  ok('a form opens only for a person who may use it (marketing edit, lead gen editor, the Client Book add button, visit planning)',
    /if \(mCanEdit\) openRecModal/.test(read('js/marketing-home.js')) && /if \(!lgCanEdit\) return;/.test(read('js/leadgen-home.js'))
    && /!b\.disabled\) cbAddDialog/.test(read('js/client-book.js')) && /cvActions \[data-plan\]/.test(read('js/client-visits.js')));
}

sec('3 · hxDeepLink, flowOpenNew, flowEmpty');
{
  const API = read('js/api.js'), FAPI = read('js/flow-api.js');
  const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } return ''; };
  function deep(search, run) {
    const seen = [], replaced = [], ev = {};
    const ctx = { URLSearchParams, URL, setTimeout, String, window: {}, location: { search, href: 'https://x/flow-purchase-orders.html' + search, pathname: '/flow-purchase-orders.html', hash: '' },
      history: { state: { a: 1 }, replaceState: (st, t, u) => replaced.push(u) }, document: { addEventListener: (t, f) => { ev[t] = f; } } };
    vm.createContext(ctx);
    vm.runInContext(fnSrc(API, 'hxDeepLink') + '\nhxDeepLink(function (v) { seen.push(v); });', Object.assign(ctx, { seen }));
    return new Promise(done => setTimeout(() => done({ seen, replaced, ev, ready: ctx.window.hxDeepLinkReady }), 5));
  }
  return Promise.all([deep('?new=1'), deep('?new=call&x=2'), deep(''), deep('?new=%3Cscript%3E')]).then(([a, b, c, d]) => {
    eq('?new=1 runs the form once', a.seen, ['1']);
    eq('  and the address loses the parameter', a.replaced, ['/flow-purchase-orders.html']);
    eq('?new=call keeps the other parameters', b.replaced, ['/flow-purchase-orders.html?x=2']);
    ok('no parameter: nothing runs, nothing is rewritten, the page still answers the + button', c.seen.length === 0 && c.replaced.length === 0 && c.ready === true && typeof c.ev['hx:new'] === 'function');
    ok('a value that is not a plain word is ignored', d.seen.length === 0);
    c.ev['hx:new']({ detail: 'call' });
    eq('the + button on the same page: hx:new runs it', c.seen, ['call']);
    ok('flowOpenNew opens the collapsible form, scrolls to it, focuses its field, and does nothing where the form is hidden',
      /flowFormToggle\(true\)/.test(fnSrc(FAPI, 'flowOpenNew')) && /offsetParent === null\) return/.test(fnSrc(FAPI, 'flowOpenNew')) && /focus\(\{ preventScroll: true \}\)/.test(fnSrc(FAPI, 'flowOpenNew')));
    const fe = (visible) => { const ctx = { flowEsc: (s) => String(s), document: { getElementById: (id) => (id === 'supplier' ? { closest: () => ({ offsetParent: visible ? {} : null }) } : null) } };
      vm.createContext(ctx); vm.runInContext(fnSrc(FAPI, 'flowEmpty'), ctx); return ctx.flowEmpty('No purchase orders yet.', ['New purchase order', 'supplier']); };
    ok('flowEmpty offers the first record where the form is on the page', /flow-empty-act/.test(fe(true)) && /btn-primary primary/.test(fe(true)) && /flowOpenNew\('supplier'\)/.test(fe(true)));
    ok('  and only says so where it is not', !/button/.test(fe(false)) && /class="flow-empty"><p>No purchase orders yet\.<\/p>/.test(fe(false)));
    const left = fs.readdirSync(D + 'js').filter(f => /^flow-.*\.js$/.test(f)).filter(f => /<p style="color:var\(--hx-ink-3\);">No /.test(read('js/' + f)));
    ok('no flow list says "No … yet" as bare grey text any more', left.length === 0, left);
    ok('the classic look keeps its grey (css/flow.css .flow-empty)', /\.flow-empty \{ color: var\(--hx-ink-3\); \}/.test(read('css/flow.css')));
  }).then(rest);
}

function rest() {
sec('4 · the shell stays out of the way');
{
  const wide = runPhone({ role: 'admin', nav: true, phone: false });
  ok('above 640 px: nothing is drawn, the page is untouched', !wide.threw && wide.drawn.length === 0 && wide.classes.indexOf('ap-shell') < 0, wide.threw);
  const narrow = runPhone({ role: 'admin', nav: true, phone: true });
  ok('at 640 px or less: the tab bar and the + button are drawn, html.ap-shell set', !narrow.threw && narrow.drawn.length >= 2 && narrow.classes.indexOf('ap-shell') >= 0, { threw: narrow.threw, n: narrow.drawn.length });
  const off = runPhone({ role: 'admin', nav: true, phone: true, attrs: { 'data-phone': null } });
  ok('?phone=off (no data-phone): empty states only, no shell', !off.threw && off.drawn.length === 0 && !!off.api && typeof off.api.kindOf === 'function' && !off.api.tabsFor);
  const classic = runPhone({ role: 'admin', nav: true, phone: true, attrs: { 'data-look': null } });
  ok('the classic look: nothing at all', !classic.threw && classic.drawn.length === 0 && !classic.api);
  const nobody = runPhone({ nav: true, phone: true });
  ok('nobody signed in: no shell', !nobody.threw && nobody.drawn.length === 0);
  const THEME = read('js/theme.js');
  ok('theme.js loads css/apple-phone.css and js/apple-phone.js once each, inside the look, the stylesheet holding first paint',
    (THEME.match(/'css\/apple-phone\.css'/g) || []).length === 1 && (THEME.match(/'js\/apple-phone\.js'/g) || []).length === 1
    && THEME.indexOf("'js/apple-phone.js'") > THEME.indexOf('if (skin) {') && THEME.indexOf("'js/apple-phone.js'") < THEME.indexOf('} else if (loginPage()') && /setAttribute\('blocking', 'render'\)/.test(THEME));
  ok('?phone=off / ?phone=on set and clear hx_phone; data-phone="on" unless it is off', /ph === 'off'\) put\('hx_phone', 'off'\); else if \(ph === 'on'\) put\('hx_phone', null\)/.test(THEME) && /get\('hx_phone', \['off'\]\) !== 'off'\) h\.setAttribute\('data-phone', 'on'\)/.test(THEME));
  const PAGES = fs.readdirSync(D).filter(f => f.endsWith('.html'));
  const direct = PAGES.filter(f => /apple-phone\.(js|css)/.test(read(f)));
  ok('no page links the phone files itself (theme.js does)', direct.length === 0, direct);
  ok('scan and collect never get the look (no ledger.css), so never the shell', !/css\/ledger\.css/.test(read('scan.html')) && !/css\/ledger\.css/.test(read('collect.html')));
  ok('the sidebar drawer stays (the tab bar is its own element in <body>, the drawer markup untouched)', /document\.body\.appendChild\(bar\)/.test(PHONE) && /\.ap-shell \.a-menu/.test(read('css/apple-phone.css')));
  ok('Android back closes the top layer first (pushState / popstate), entries from an earlier load count as none', /history\.pushState\(\{ apLayer: stack\.length, apDoc: doc \}/.test(PHONE) && /addEventListener\('popstate'/.test(PHONE) && /st\.apDoc === doc/.test(PHONE));
  ok('sheets are dialogs: aria-modal, Escape, focus kept inside and handed back', /setAttribute\('aria-modal', 'true'\)/.test(PHONE) && /e\.key === 'Escape'/.test(PHONE) && /e\.key !== 'Tab'/.test(PHONE) && /opener\.focus\(\{ preventScroll: true \}\)/.test(PHONE));
  ok('drags follow the finger and settle on hxApple\'s spring (rubber band, projection, 0.8 / 0.3 after a flick)', /setPointerCapture/.test(PHONE) && /rubber\(y, H\(\)\)/.test(PHONE) && /project\(spring\.x, v\)/.test(PHONE) && /damping: Math\.abs\(v\) > 300 \? 0\.8 : 1, response: 0\.3/.test(PHONE));
}

sec('5 · the home screens');
{
  const homes = { admin: 'admin.html', 'accounting-home': 'accounting-home.html', 'management-home': 'management-home.html', 'director-home': 'director-home.html',
    'hr-home': 'hr-home.html', 'marketing-home': 'marketing-home.html', 'leadgen-home': 'leadgen-home.html', dashboard: 'dashboard.html' };
  eq('a folded set for every home', Object.keys(P.FOLD).sort(), Object.keys(homes).sort());
  Object.keys(P.FOLD).forEach(k => {
    const html = read(homes[k]);
    const missing = P.FOLD[k].filter(f => f[0][0] === '#' ? html.indexOf('id="' + f[0].slice(1) + '"') < 0 : html.indexOf('class="' + f[0].slice(1) + '"') < 0);
    ok(homes[k] + ': its ' + P.FOLD[k].length + ' long sections exist, each with a title and an icon', missing.length === 0 && P.FOLD[k].every(f => f[1] && !!navCtx.LEDGER_ICONS[f[2]]), missing);
    ok(homes[k] + ': what needs the person (#inbox) stays on the home', P.FOLD[k].every(f => f[0] !== '#inbox'));
  });
  eq('"Loading quotations…" is still loading', P.kindOf('Loading quotations…'), 'ap-wait');
  eq('"Reading the ledger..." is still loading', P.kindOf('Reading the ledger...'), 'ap-wait');
  eq('"No purchase orders yet." is empty', P.kindOf('No purchase orders yet.'), 'ap-none');
  eq('"Nothing due today." is empty', P.kindOf('  Nothing due today. '), 'ap-none');
  eq('"Could not read the sheet." failed', P.kindOf('Could not read the sheet.'), 'ap-fail');
  eq('a box marked as an error failed', P.kindOf('Something', true), 'ap-fail');
  eq('an empty box is left alone', P.kindOf('   '), '');
  eq('a long paragraph is not an empty state', P.kindOf('x'.repeat(230)), '');
}

sec('6 · css/apple-phone.css keeps the Apple look\'s rules');
{
  const SCOPE = 'html[data-skin="ledger"][data-look="apple"]';
  function parse(text) {
    const out = []; let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i); if (open < 0) break;
      const head = text.slice(i, open).trim(); let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) out.push({ at: head, kids: parse(body) }); else if (head.startsWith('@keyframes')) out.push({ at: head, body }); else out.push({ sel: head, body });
      i = j;
    }
    return out;
  }
  const flat = (list, ctx, acc) => { (list || []).forEach(n => { if (n.kids) flat(n.kids, ctx.concat([n.at]), acc); else acc.push(Object.assign({ ctx }, n)); }); return acc; };
  const SRC = read('css/apple-phone.css').replace(/\/\*[\s\S]*?\*\//g, ''), TOP = parse(SRC), ALL = flat(TOP, [], []);
  const STYLE = ALL.filter(r => r.sel !== undefined), KEYF = ALL.filter(r => r.at && r.at.startsWith('@keyframes'));
  const decls = (b) => b.split(/;(?![^(]*\))/).map(d => d.trim()).filter(Boolean);
  ok('one @media screen block holds everything', TOP.length === 1 && TOP[0].at === '@media screen');
  const bad = []; STYLE.forEach(r => r.sel.split(',').map(s => s.trim()).forEach(s => { if (!s.startsWith(SCOPE)) bad.push(s); }));
  ok('every one of ' + STYLE.length + ' rules is scoped to the look', bad.length === 0 && STYLE.length > 60, bad.slice(0, 4));
  const lit = []; STYLE.forEach(r => decls(r.body).forEach(d => { if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(d.replace(/url\("data:[^"]*"\)/g, '')) && !/^--(ap|l-p|a)-[a-z0-9-]+\s*:/.test(d)) lit.push(d.slice(0, 60)); }));
  ok('colours are written only in tokens', lit.length === 0, lit.slice(0, 4));
  ok('no !important; nothing downloaded (the glyphs are inline data, no @import or font)', !/!important/.test(SRC) && !/@import|@font-face/.test(SRC) && (SRC.match(/url\(/g) || []).length === (SRC.match(/url\("data:image\/svg\+xml,/g) || []).length);
  const CHROME = /\.(a-tabbar|ap-push-bar)\b/, blur = [];
  STYLE.forEach(r => decls(r.body).forEach(d => { if (/^(-webkit-)?backdrop-filter\s*:/.test(d) && !/:\s*none$/.test(d) && !r.sel.split(',').every(s => CHROME.test(s))) blur.push(r.sel.slice(0, 80)); }));
  ok('blur only on the chrome: the tab bar and a screen\'s bar', blur.length === 0, blur);
  ok('keyframes are ap-* and move only opacity / transform', KEYF.length >= 1 && KEYF.every(k => /^@keyframes ap-/.test(k.at) && (k.body.match(/[a-z-]+(?=\s*:)/g) || []).every(p => p === 'opacity' || p === 'transform')));
  ok('transitions name their properties; no animation loops', STYLE.filter(r => /transition\s*:/.test(r.body)).every(r => !/transition\s*:[^;]*\ball\b/.test(r.body)) && !/infinite/.test(SRC));
  const inCtx = (re, selRe, bodyRe) => ALL.some(r => r.ctx.some(c => re.test(c)) && selRe.test(r.sel || '') && bodyRe.test(r.body || ''));
  ok('the bars and sheets are phones only (max-width: 640px), and only while data-phone="on"', inCtx(/max-width:\s*640px/, /\[data-phone="on"\]\.ap-shell \.a-tabbar$/, /position:\s*fixed/) && inCtx(/max-width:\s*640px/, /\.ap-sheet$/, /border-radius:\s*14px 14px 0 0/));
  ok('a computer never shows the tab bar or the + button', STYLE.some(r => r.ctx.length === 1 && /\.a-tabbar/.test(r.sel) && /\.ap-fab/.test(r.sel) && /display:\s*none/.test(r.body)));
  ok('press feedback at .97 (tabs, the + button, the close and back buttons)', ['.ap-tab.ap-down', '.ap-fab.ap-down', '.ap-x.ap-down', '.ap-back.ap-down'].every(s => STYLE.some(r => r.sel.indexOf(s) >= 0 && /scale\(\.97\)/.test(r.body))));
  ok('the toasts and the snackbar sit above the tab bar', inCtx(/max-width:\s*640px/, /\.hx-toasts$/, /bottom:\s*calc\(var\(--ap-tab-h\)/));
  ok('the keyboard moves the bar aside', inCtx(/max-width:\s*640px/, /\.ap-kb \.a-tabbar/, /translate3d\(0, 110%, 0\)/));
  ok('reduced motion: cross-fades; reduced transparency: solid bars; more contrast: edges', inCtx(/prefers-reduced-motion:\s*reduce/, /\.ap-sheet/, /ap-fade/)
    && inCtx(/prefers-reduced-transparency:\s*reduce/, /\.a-tabbar/, /backdrop-filter:\s*none/) && inCtx(/prefers-contrast:\s*more/, /\.ap-group/, /border:\s*1px solid/));
  ok('empty, loading and failed are drawn at every width (outside the phone query)', ['.ap-none', '.ap-wait', '.ap-fail'].every(c => STYLE.some(r => r.ctx.length === 1 && r.sel.indexOf(c) >= 0)));
  ok('the large title is the skill\'s: 2.125rem, 700, tracked in', STYLE.some(r => /\.hx-mast h1/.test(r.sel) && /700 2\.125rem/.test(r.body) && /letter-spacing:\s*-\.022em/.test(r.body)));
}

sec('7 · team-report.js never writes "them\'s"');
{
  const TR = read('js/team-report.js');
  const i = TR.indexOf('function _trFirst('), src = TR.slice(i, TR.indexOf('\n', i));
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
  eq('a person: their first name', ctx._trFirst('Rojan Leo R. Francisco Jr.', 'Accounting'), 'Rojan');
  eq('nobody in the roster: the report\'s own name', ctx._trFirst('', 'Accounting'), 'Accounting');
  ok('no "them" fallback left, and every caller passes the report\'s name', !/'them'/.test(TR) && !/_trFirst\((S\.person|name)\)/.test(TR));
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
}
