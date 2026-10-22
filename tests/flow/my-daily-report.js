/* A363 — the new daily report on each person's own page, and the card on their home.
 *
 * Run:  node tests/flow/my-daily-report.js
 *
 * Neil, 22 Oct 2026: "put the daily report on each of the dashboard user, but put it as a new daily report … dont change
 * the old daily report yet, and dont remove this new daily report in the director dashboard yet". Pinned here:
 *   1 · the page: the director's report kit (director.css + daily-report.css), body.dh, both report sections hidden,
 *       the scripts the reports need, in order
 *   2 · who may open it: sales, accounting, lead gen, admin; the director and everyone else go home
 *   3 · it mounts the person's own report: the sales report for a rep, the role's report for the others, each { own: true };
 *       before FlowAPI 184 it says so and mounts nothing; the old daily report is linked, never replaced
 *   4 · the home card: hidden before 184; not started / saved / submitted; the person's own kind; nothing for other roles
 *   5 · the navbars: "New daily report" beside each role's old one, for the four roles only; the old links stay
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, a, b) => ok(l + ' = ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard');
const read = (f) => fs.readFileSync(path.join(D, f), 'utf8');
const H = read('my-daily-report.html');

sec('1 · the page');
eq('the director\'s report kit: styles, flow, director, daily-report, then ledger and apple',
   (H.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]), ['styles.css', 'flow.css', 'director.css', 'daily-report.css', 'ledger.css', 'apple.css']);
ok('body.dh (every report rule hangs off it), theme.js first', /<body class="dh dh-myreport">\s*<script src="js\/theme\.js"><\/script>/.test(H));
ok('both report sections are there and hidden until the role is known', /<section class="dh-glass dh-sr" id="proof" hidden>\s*<div class="dh-head sr-head" id="srHead"><\/div>\s*<div class="sr-body" id="srBody">/.test(H) &&
   /<section class="dh-glass dh-sr dh-tr" id="myReport" hidden>\s*<div class="dh-head sr-head" data-tr="head"><\/div>\s*<div class="sr-body" data-tr="body">/.test(H));
eq('the scripts the reports need, in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]),
   ['theme.js', 'api.js', 'auth.js', 'ledger-nav.js', 'flow-api.js', 'itinerary-week.js', 'sales-report-model.js', 'sales-report.js', 'team-report-model.js', 'team-report.js', 'my-daily-report.js']);
ok('no inline script or style', !/<script>/.test(H) && !/style="/.test(H) && !/<style/.test(H));
const DH = read('director-home.html'), DCSS = read('css/director-home.css'), RCSS = read('css/daily-report.css');
ok('the director\'s dashboard keeps its reports (now drawn from the shared daily-report.css)', /href="css\/director-home\.css">\s*<link rel="stylesheet" href="css\/daily-report\.css">/.test(DH) &&
   /id="proof"/.test(DH) && /id="acctReport"/.test(DH) && /body\.dh \.sr-tile/.test(RCSS) && /body\.dh \.tr-pick/.test(RCSS) && !/\.sr-tile|\.tr-pick/.test(DCSS));
{
  const noComments = RCSS.replace(/\/\*[\s\S]*?\*\//g, ''), bad = [];
  const re = /(?:^|[{}])\s*([^{}@]+?)\s*\{/g; let m;
  while ((m = re.exec(noComments))) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(sel => { if (!/^(from|to|\d+%)$/.test(sel) && !/^body\.dh\b/.test(sel)) bad.push(sel); });
  ok('daily-report.css: every selector starts with body.dh', bad.length === 0, bad.slice(0, 5));
}

/* the auth.js guard and the page's own script, on a stub page */
function world(role, version) {
  const els = {}, calls = [];
  const el = (id) => els[id] || (els[id] = { id, hidden: true, innerHTML: '', href: '', style: {} });
  ['mdrOld', 'mdrNotice', 'proof', 'myReport'].forEach(el);
  const c = { console, Promise, JSON, Date, Math, String, Object, Array,
    window: {}, location: { href: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: el, addEventListener: (e, f) => { if (e === 'DOMContentLoaded') c.__boot = f; } } };
  c.window = c; vm.createContext(c);
  vm.runInContext(`function getSession() { return __s; } function _homeForRole(r) { return r + '-home.html'; }`, c);
  vm.runInContext(read('js/auth.js').match(/function requireNewDailyReportAccess\(\) \{[\s\S]*?\n\}/)[0], c);
  c.__s = role ? { name: 'Gerald Lucena', username: 'gerald', role } : null;
  c.flowVersionAtLeast = (n) => Promise.resolve(n <= version);
  c.renderNavbar = (p) => calls.push('nav:' + p);
  c.salesReport = (id, o) => { calls.push('sales:' + id + ':' + JSON.stringify(o)); return Promise.resolve(); };
  c.teamReport = (id, k, o) => { calls.push('team:' + id + ':' + k + ':' + JSON.stringify(o)); return Promise.resolve(); };
  vm.runInContext(read('js/my-daily-report.js'), c);
  return { c, els, calls, boot: () => c.__boot && c.__boot() };
}

(async () => {
  sec('2 · who may open it');
  for (const r of ['sales', 'accounting', 'leadgen', 'admin']) {
    const w = world(r, 184);
    ok(r + ' opens it', !!vm.runInContext('requireNewDailyReportAccess()', w.c) && w.c.location.href === '');
  }
  for (const r of ['director', 'management', 'hr', 'marketing']) {
    const w = world(r, 184);
    ok(r + ' is sent home (the director has the reports on his dashboard)', vm.runInContext('requireNewDailyReportAccess()', w.c) === null && w.c.location.href === r + '-home.html');
  }
  const out = world(null, 184);
  ok('nobody signed in: to the sign-in page', vm.runInContext('requireNewDailyReportAccess()', out.c) === null && out.c.location.href === 'index.html');

  sec('3 · it mounts the person\'s own report');
  const s = world('sales', 184); await s.boot();
  ok('a rep: the Sales Daily Report, their own, in the shown #proof section', s.calls.indexOf('sales:proof:{"own":true}') >= 0 && s.els.proof.hidden === false && s.els.myReport.hidden === true && s.calls[0] === 'nav:my-daily-report', s.calls);
  ok('  with their old daily report one click away', s.els.mdrOld.hidden === false && s.els.mdrOld.href === 'report.html');
  for (const [r, old] of [['accounting', 'accounting-daily-report.html'], ['leadgen', 'leadgen-daily-report.html'], ['admin', 'admin-daily-report.html']]) {
    const w = world(r, 184); await w.boot();
    ok(r + ': its own role report in #myReport, and its old report linked', w.calls.indexOf('team:myReport:' + r + ':{"own":true}') >= 0 && w.els.myReport.hidden === false && w.els.proof.hidden === true && w.els.mdrOld.href === old, w.calls);
  }
  const early = world('sales', 183); await early.boot();
  ok('before FlowAPI 184: it says so, mounts nothing, and the old report still works', /version 184/.test(early.els.mdrNotice.innerHTML) && /old daily report works as before/.test(early.els.mdrNotice.innerHTML) &&
     !early.calls.some(x => /^(sales|team):/.test(x)) && early.els.proof.hidden && early.els.myReport.hidden);

  sec('4 · the card on the home');
  async function card(role, version, rows, hhmm) {
    const el = { innerHTML: '', style: { display: 'none' } }, posts = [];
    const c = { console, Promise, JSON, Math, String, Object, Array, document: { getElementById: (id) => (id === 'newDailyReport' ? el : null), addEventListener: (e, f) => { if (e === 'DOMContentLoaded') c.__boot = f; } } };
    const RealDate = Date, fixed = new RealDate('2026-10-22T' + (hhmm || '09:00') + ':00+08:00');
    c.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } };
    c.window = c; vm.createContext(c);
    c.getSession = () => ({ name: 'P', username: 'p', role });
    c.flowVersionAtLeast = (n) => Promise.resolve(n <= version);
    c.flowToday = () => '2026-10-22';
    c.postFlow = (a, p) => { posts.push({ a, p }); return Promise.resolve({ success: true, data: rows || [] }); };
    vm.runInContext(read('js/new-daily-report-card.js'), c);
    if (c.__boot) c.__boot();
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    return { el, posts };
  }
  const pre = await card('sales', 183);
  ok('before 184: hidden, and nothing read', pre.el.style.display === 'none' && !pre.posts.length);
  const none = await card('sales', 184, []);
  ok('nothing today: "Not started today", Start today', none.el.style.display === '' && /Not started today/.test(none.el.innerHTML) && /href="my-daily-report\.html">Start today</.test(none.el.innerHTML) &&
     JSON.stringify(none.posts[0]) === JSON.stringify({ a: 'getProofReports', p: { kind: 'sales', from: '2026-10-22', to: '2026-10-22' } }), none.posts);
  const saved = await card('accounting', 184, [{ date: '2026-10-22', user: 'P', kind: 'accounting', updatedAt: '2026-10-22T03:12:00.000Z' }], '10:00');
  ok('saved: the time, and the 4:30 report due later', /Saved 11:12 AM — 4:30 report due at 4:30/.test(saved.el.innerHTML) && saved.posts[0].p.kind === 'accounting', saved.el.innerHTML);
  const late = await card('admin', 184, [{ date: '2026-10-22', user: 'P', kind: 'admin', updatedAt: '2026-10-22T03:12:00.000Z' }], '16:45');
  ok('  after 4:30, "due now" in the warning colour', /class="due">Saved 11:12 AM — 4:30 report due now/.test(late.el.innerHTML), late.el.innerHTML);
  const done = await card('leadgen', 184, [{ date: '2026-10-22', user: 'P', kind: 'leadgen', updatedAt: '2026-10-22T08:31:00.000Z', submittedAt: '2026-10-22T08:31:00.000Z' }]);
  ok('submitted: the time, in green, and Open', /class="ok">4:30 report submitted 4:31 PM/.test(done.el.innerHTML) && />Open</.test(done.el.innerHTML) && done.posts[0].p.kind === 'leadgen', done.el.innerHTML);
  const mg = await card('management', 184, []);
  ok('a role with no report: no card, no read', mg.el.style.display === 'none' && !mg.posts.length);
  for (const [f, cls] of [['dashboard.html', 'hx-glass'], ['accounting-home.html', 'hx-glass'], ['admin.html', 'hx-glass'], ['leadgen-home.html', 'lg-panel']]) {
    const h = read(f);
    ok(f + ': the card (hidden until filled), its stylesheet after the payslip card\'s, its script after the payslip card\'s',
       new RegExp('<section class="' + cls + ' hx-ndr" id="newDailyReport" style="display:none;"></section>').test(h) && /href="css\/payslip-card\.css">\s*<link rel="stylesheet" href="css\/new-daily-report-card\.css">/.test(h) &&
       /src="js\/my-payslip-card\.js"><\/script>[^\n]*\n\s*<script src="js\/new-daily-report-card\.js">/.test(h));
  }
  ok('  and the old daily report links on the homes are untouched', /<a href="report\.html" class="sl-link">/.test(read('dashboard.html')));

  sec('5 · the navbars');
  const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');
  ok('the classic navbar: "New Daily Report" right after each role\'s old one', /Admin Daily Report<\/a>\s*<a href="my-daily-report\.html"/.test(AUTH) && /My Daily Report<\/a>\s*<a href="my-daily-report\.html"/.test(AUTH) &&
     />Daily Report<\/a>\s*<a href="my-daily-report\.html"/.test(AUTH) && /leadgen-daily-report\.html[\s\S]{0,600}<a href="my-daily-report\.html"/.test(AUTH));
  ok('  and the active-page lists know it', /'admin-daily-report', 'my-daily-report'\]/.test(AUTH) && /\['accounting-daily-report', 'my-daily-report',/.test(AUTH) && /\['report', 'my-reports', 'my-daily-report'\]/.test(AUTH));
  const navFor = (role) => { const c = {}; vm.createContext(c); vm.runInContext(NAV + ';this.__l = LEDGER_NAV;', c); return JSON.stringify(c.__l[role] || []); };
  eq('the Apple sidebar links it for the four roles, and nobody else', ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'].filter(r => /my-daily-report\.html/.test(navFor(r))),
     ['admin', 'accounting', 'sales', 'leadgen']);
  ok('  the old reports stay linked', ['report.html', 'accounting-daily-report.html', 'admin-daily-report.html', 'leadgen-daily-report.html'].every(f => NAV.includes("'" + f + "'")));

  console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})();
