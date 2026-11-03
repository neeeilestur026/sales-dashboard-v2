/* A390 — the bulletin board in the browser: theme.js puts the card on each person's own home only; the card and the page
 * (bulletin.html) draw and act on the server's answers; HR Memos is a redirect; the CSS keeps the site rules.
 *
 * Run:  node tests/flow/bulletin-page.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { page } = require('./pageload');
const M = require('../../dashboard/js/bulletin-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');
const ROLES = ['sales', 'admin', 'accounting', 'management', 'director', 'hr', 'marketing', 'leadgen', 'warehouse'];

/* theme.js on a page: what it appends to <head> */
function themeOn(pageName, session) {
  const appended = [];
  const el = (tag) => ({ tagName: tag, style: {}, setAttribute() {}, appendChild() {} });
  const ctx = { console, JSON, Math, Date, window: {}, localStorage: { getItem: (k) => (k === 'session' && session ? JSON.stringify(session) : null), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { hostname: 'x', pathname: '/' + pageName, search: '' },
    URLSearchParams: function () { return { get: () => null }; }, matchMedia: () => ({ matches: false }), setTimeout: () => 0,
    document: { documentElement: { setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {} } }, body: { setAttribute() {}, classList: { add() {}, remove() {} } },
      head: { appendChild: (n) => appended.push(n) }, createElement: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('js/theme.js'), ctx);
  return { css: appended.filter(n => n.href === 'css/bulletin.css').length, js: appended.filter(n => n.src === 'js/bulletin.js').length };
}
const homeFor = (() => { const src = read('js/auth.js'), m = src.match(/function _homeForRole\(role\) \{[\s\S]*?\n\}/); const c = {}; vm.createContext(c); vm.runInContext(m[0], c); return c._homeForRole; })();

sec('1 · theme.js puts the board on each person\'s own home, and nowhere else');
{
  ROLES.forEach(role => {
    const home = homeFor(role), mine = themeOn(home, { name: 'X', role });
    ok(role + ': on ' + home + ' the card\'s script and sheet, once each', mine.css === 1 && mine.js === 1, mine);
    const other = ['bulletin.html', 'flow-quotations.html', role === 'sales' ? 'admin.html' : 'dashboard.html'].map(p => themeOn(p, { name: 'X', role }));
    ok('  and not on another page (another home, the board page, a work page)', other.every(x => x.css === 0 && x.js === 0), other);
  });
  ok('nothing without a session (the login page included)', themeOn('index.html', null).js === 0 && themeOn('dashboard.html', null).js === 0);
  const src = read('js/theme.js'), map = src.match(/var BB_HOMES = (\{[\s\S]*?\});/)[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
  const homes = JSON.parse(map), board = read('js/bulletin.js').match(/var HOMES = (\{[\s\S]*?\});/)[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
  ok('theme.js\'s homes are auth.js _homeForRole, and so are bulletin.js\'s', ROLES.every(r => (homes[r] || 'dashboard.html') === homeFor(r) && (JSON.parse(board)[r] || 'dashboard.html') === homeFor(r)), homes);
  ok('theme.js stays free of hex colours, inline styles and emoji', !/#[0-9a-fA-F]{3,6}\b/.test(src) && !/style="/.test(src) && !/[\u{1F300}-\u{1FAFF}]/u.test(src));
  ok('no page links the card itself', fs.readdirSync(D).filter(f => /\.html$/.test(f) && f !== 'bulletin.html').every(f => !/js\/bulletin\.js|css\/bulletin\.css/.test(read(f))));
}

sec('2 · every home keeps the place the card goes (right after its top bar)');
{
  const HOST = { 'dashboard.html': ['hx-col', 'hx-mast'], 'admin.html': ['hx-col', 'hx-mast'], 'accounting-home.html': ['hx-col', 'hx-mast'], 'management-home.html': ['hx-col', 'hx-mast'],
                 'hr-home.html': ['hx-col', 'hx-mast'], 'marketing-home.html': ['hx-col', 'hx-mast'], 'director-home.html': ['dh-col', 'dh-mast'], 'leadgen-home.html': ['lg-main', 'lg-top'], 'scan.html': ['sc-main', 'sc-top'] };
  Object.keys(HOST).forEach(f => {
    const h = read(f), [col, top] = HOST[f];
    ok(f + ': .' + col + ' holds .' + top, new RegExp('class="[^"]*\\b' + col + '\\b').test(h) && new RegExp('class="[^"]*\\b' + top + '\\b').test(h));
  });
  const js = read('js/bulletin.js');
  ok('bulletin.js maps the same homes to those places', /hx: \['\.hx-col', '\.hx-mast'/.test(js) && /dh: \['\.dh-col', '\.dh-mast'/.test(js) && /lg: \['\.lg-main', '\.lg-top'/.test(js) && /sc: \['\.sc-main', '\.sc-top'/.test(js));
}

sec('3 · the card: escaped, quiet before FlowAPI 195, "Got it" undone on failure');
{
  const c = { console, window: {}, document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null }, location: { pathname: '/x.html' },
              flowEsc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), localStorage: { getItem: () => null, setItem() {} } };
  c.window = c; vm.createContext(c); vm.runInContext(read('js/bulletin.js'), c);
  const html = c.hxBoard.itemHtml({ bulletinNo: 'BB-1', title: '<b>x</b>', body: 'line 1\n<script>', kind: 'Memo', pinned: true, status: 'Live', createdBy: 'Ana', createdAt: '2026-11-02T01:00:00Z',
                                    file: { name: '<a>.pdf', kind: 'pdf', size: 2048 } }, { ack: true });
  ok('the title, the message and the file name are escaped; a line break becomes <br>', /&lt;b&gt;x&lt;\/b&gt;/.test(html) && /line 1<br>&lt;script&gt;/.test(html) && /&lt;a&gt;\.pdf/.test(html) && !/<script>/.test(html), html);
  ok('  a pinned post says so in words; "Got it" names its post for a screen reader', /bb-pin">Pinned/.test(html) && /aria-label="Got it: &lt;b&gt;x&lt;\/b&gt;"/.test(html));
  const seen = c.hxBoard.itemHtml({ bulletinNo: 'BB-2', title: 'Seen one', status: 'Live', gotIt: '2026-11-02T02:00:00Z' }, { ack: true });
  ok('  one already marked shows "Seen", not the button', /bb-seen">Seen/.test(seen) && !/data-got/.test(seen));
  const one = c.hxBoard.itemHtml({ bulletinNo: 'BB 3', title: '<i>Short</i>', body: 'never on the scanner', status: 'Live', pinned: true, file: { name: 'a.png', kind: 'image' } }, { ack: true, compact: true });
  ok('  the scanner gets one line: the escaped title opens the post, no message, no file, "Got it" kept',
    /bb-compact pinned/.test(one) && /href="bulletin\.html\?id=BB%203">&lt;i&gt;Short&lt;\/i&gt;<\/a>/.test(one) && !/never on the scanner/.test(one) && !/data-file/.test(one) && /data-got="BB 3"/.test(one), one);
  ok('  only the scanner draws it compact', /compact: hostFor\(page\) === 'sc'/.test(read('js/bulletin.js')));
  const js = read('js/bulletin.js');
  ok('an unknown action, an unsecured one or the switch off makes it quiet for ten minutes', /unknown action\|not a secured action\|switched off/.test(js) && /OFF_MS = 600000/.test(js));
  ok('"Got it" collapses at once and comes back with a toast if the save fails', /classList\.add\('bb-out'\)/.test(js) && /classList\.remove\('bb-out'\)/.test(js) && /hxToast\(String\(e && e\.message \|\| e\), \{ tone: 'error' \}\)/.test(js));
  ok('no inline style is written (the hidden attribute and classes only)', !/style="/.test(js) && !/\.style\./.test(js));
}

sec('4 · the page');
(async () => {
  const roleS = (role) => ({ name: role === 'hr' ? 'Ana Reyes' : 'Someone ' + role, username: role + '1', role, token: 't' });
  const pg = (role, answers) => {
    const p = page(['js/bulletin.js', 'js/bulletin-model.js', 'js/bulletin-page.js'], 'bulletin.html', roleS(role), { withAuth: true });
    p.ctx.__answers = answers || {};
    p.ctx.CSS = { escape: (s) => s };
    p.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); var x = __answers[a]; ' +
          'return Promise.resolve(typeof x === "function" ? x(q || {}) : (x || { success: false, message: "Unknown action: " + a })); };' +
          'apiGetMemos = function () { return Promise.resolve({ success: true, data: [] }); }; apiGetUsers = function () { return Promise.resolve({ success: true, data: [] }); };');
    return p;
  };
  const BOARD = { success: true, items: [{ bulletinNo: 'BB-1', title: 'Office closed Friday', body: 'Holiday.', kind: 'Announcement', audience: ['all'], pinned: true, status: 'Live', createdBy: 'Ana Reyes', createdAt: '2026-11-02T01:00:00Z' }],
                  may: { write: false }, today: '2026-11-03' };
  for (const role of ROLES) {
    const p = pg(role, { getBulletin: BOARD });
    await p.boot();
    ok(role + ' opens the board and asks for it', p.calls.indexOf('POST:getBulletin') >= 0 && /Office closed Friday/.test(p.els.bbpList.innerHTML), p.calls);
  }
  const rep = pg('sales', { getBulletin: BOARD });
  await rep.boot();
  ok('a reader gets no New and no writer tools', rep.els.bbpNew.hidden === true && !/data-edit|data-arch/.test(rep.els.bbpList.innerHTML) && /data-got="BB-1"/.test(rep.els.bbpList.innerHTML));
  const W = Object.assign({}, BOARD, { may: { write: true } });
  const hr = pg('hr', { getBulletin: (q) => q.view === 'manage' ? Object.assign({}, W, { items: W.items.map(x => Object.assign({}, x, { acks: [] })), log: [] }) : W, previewBulletinMemos: { success: true, plan: [], toImport: 0 } });
  await hr.boot();
  ok('a writer gets New, and reads board, history and every post', hr.els.bbpNew.hidden === false &&
     ['board', 'history', 'manage'].every(v => hr.params.some(x => x.action === 'getBulletin' && x.params.view === v)), hr.params.map(x => x.params.view));
  ok('  with Edit, Pin and Archive on each post', /data-edit="BB-1"/.test(hr.els.bbpList.innerHTML) && /data-pin="BB-1"/.test(hr.els.bbpList.innerHTML) && /data-arch="BB-1"/.test(hr.els.bbpList.innerHTML));
  const old = pg('director', {});
  await old.boot();
  ok('an older backend: the page says to paste FlowAPI 195', /needs FlowAPI 195/.test(old.els.bbpNotice.innerHTML), old.els.bbpNotice.innerHTML);
  const pjs = read('js/bulletin-page.js');
  ok('archive has an Undo (restore), never a confirm', /hxSnackbar\('Taken off the board\.', \{ action: 'Undo', onAction: \(\) => bbpArchive\(no, true\) \}\)/.test(pjs) && !/confirm\(/.test(pjs));
  ok('the memo import is a preview first, then the import', pjs.indexOf("postFlow('previewBulletinMemos'") > 0 && pjs.indexOf("postFlow('importBulletinMemos'") > pjs.indexOf("postFlow('previewBulletinMemos'"));
  ok('a ?new=1 link opens the composer for writers', /hxDeepLink\(\(\) => \{ if \(BBP\.may\.write\) bbpCompose\(null, null\); \}\)/.test(pjs));

  sec('5 · the model');
  ok('audiences in words', M.bbmAudienceLabel(['all']) === 'Everyone' && M.bbmAudienceLabel(['sales']) === 'Sales' && M.bbmAudienceLabel(['sales', 'hr', 'admin']) === 'Sales, HR and Admin');
  const roster = [{ username: 'sales1', fullName: 'Kimberlyn Blones', role: 'sales' }, { username: 'sales2', fullName: 'Gerald Lucena', role: 'sales' }, { username: 'acct1', fullName: 'Maria Santos', role: 'accounting' },
                  { username: 'hr1', fullName: 'Ana Reyes', role: 'hr' }];
  const s = M.bbmSeen({ audience: ['sales'], createdBy: 'Ana Reyes', acks: [{ username: 'sales1', name: 'Kimberlyn Blones', role: 'sales', at: 'x' }] }, roster);
  ok('who has seen it, and who not yet — only the audience, never the writer', s.seen.length === 1 && s.notYet.map(x => x.name).join() === 'Gerald Lucena' && s.total === 2 && M.bbmSeenLine(s) === 'Seen by 1 of 2', s);
  const e = M.bbmSeen({ audience: ['all'], createdBy: 'Ana Reyes', acks: [] }, roster);
  ok('  to everyone: every role but the writer', e.total === 3 && Object.keys(e.byRole).sort().join() === 'accounting,sales');
  ok('  without the roster: the count only', M.bbmSeenLine(M.bbmSeen({ audience: ['all'], acks: [{ name: 'X' }] }, [])) === 'Seen by 1');
  ok('the composer\'s checks', M.bbmFormCheck({ title: '', body: 'x', everyone: true }, '2026-11-03') && M.bbmFormCheck({ title: 'x', body: '', everyone: true }, '2026-11-03') &&
     M.bbmFormCheck({ title: 'x', body: 'y', everyone: false, roles: [] }, '2026-11-03') && !M.bbmFormCheck({ title: 'x', body: '', hasFile: true, everyone: true }, '2026-11-03') &&
     M.bbmFormCheck({ title: 'x', body: 'y', everyone: true, showUntil: '2026-11-01' }, '2026-11-03'));
  ok('a file is refused before it is read: an SVG, or over 10 MB', !!M.bbmFileCheck({ type: 'image/svg+xml', size: 10 }) && !!M.bbmFileCheck({ type: 'application/pdf', size: 11 * 1048576 }) &&
     !M.bbmFileCheck({ type: 'application/pdf', size: 1024 }));
  ok('the params: everyone, or the roles', M.bbmParams({ title: ' T ', everyone: true }).audience === 'all' && M.bbmParams({ title: 'T', everyone: false, roles: ['sales', 'hr'] }).audience === 'sales,hr');

  sec('6 · HR Memos is a redirect; nothing links it; the site rules');
  const stub = read('hr-memos.html'), red = read('js/hr-memos.js');
  ok('hr-memos.html is a stub with no inline script, sending everyone to the board', !/<script>[^<]/.test(stub) && /js\/hr-memos\.js/.test(stub) && /location\.replace\(to\)/.test(red) && /bulletin\.html/.test(red));
  const r = (search) => { const c = { location: { search, replace(u) { c.to = u; } }, window: {} }; c.window = c; c.window.location = c.location; vm.createContext(c); vm.runInContext(red, c); return c.to; };
  ok('  and ?new=1 opens the composer there', r('?new=1') === 'bulletin.html?new=1' && r('') === 'bulletin.html', [r('?new=1'), r('')]);
  ok('no menu links hr-memos.html any more', !/hr-memos\.html/.test(read('js/ledger-nav.js')) && !/href="hr-memos\.html"/.test(read('js/auth.js')) && !/hr-memos\.html/.test(read('js/apple-phone.js')) &&
     !/href="hr-memos\.html"/.test(read('hr-home.html')));
  ok('the hidden attribute wins over a display rule: New for readers, the card while it loads',
    /#bbpNew\[hidden\] \{ display: none; \}/.test(read('css/bulletin-page.css')) && /#hxBoard\[hidden\] \{ display: none; \}/.test(read('css/bulletin.css')));
  ['css/bulletin.css', 'css/bulletin-page.css'].forEach(f => {
    const css = read(f);
    ok(f + ': tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black)\b\s*[;}]/.test(css));
    ok('  reduced motion handled', /prefers-reduced-motion: reduce/.test(css));
  });
  ok('the phone rule is scoped to the Apple shell at phone width only', /@media screen and \(max-width: 640px\) \{\s*html\[data-skin="ledger"\]\[data-look="apple"\]\[data-phone="on"\]\.ap-shell \.hx-deck > \.hx-col > #hxBoard/.test(read('css/bulletin.css')));
  ok('the card\'s quiet line is not named like an empty state (apple-phone would redraw it)', !/-empty/.test(read('js/bulletin.js')));

  console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
