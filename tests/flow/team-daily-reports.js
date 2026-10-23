/* A366 — the team's new daily reports for management, read only (team-daily-reports.html), and the card on its home.
 *
 * Run:  node tests/flow/team-daily-reports.js
 *
 * Neil, 23 Oct 2026: "add a section or page in the management dashboard, to be view each user dashboard … he clicks it
 * and views the same format of crystal gayle dandan my daily report all of it … read only". Pinned here:
 *   1 · the page: the person's own report kit (director.css + daily-report.css), its own sheet, the four report sections
 *       hidden, the scripts in order, no inline script or style, every selector under body.dh
 *   2 · who may open it: management and the director; everyone else goes home
 *   3 · the list: people grouped by team with where their report stands (submitted / saved / not started), the lines
 *       they typed that day (voided left out), late after 4:30 or on a past day, a saved report not in the roster kept
 *   4 · the page script: before FlowAPI 185 it says so and reads nothing; one read of every report for the day; the roster
 *       falls back to the mail roster; a person opens in their own team's section only, each engine mounted once in its
 *       read-only view mode and moved after that; the date moves the list and the open report; nothing is ever saved
 *   5 · the card on the management home: hidden before 185; one line per team; the way in
 *   6 · the navbars: "New daily reports" for management and the director, beside the old daily reports
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, a, b) => ok(l + ' = ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard');
const read = (f) => fs.readFileSync(path.join(D, f), 'utf8');
const H = read('team-daily-reports.html');
const tick = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise(r => setImmediate(r)); };

sec('1 · the page');
eq('the report kit and its own sheet: styles, flow, director, daily-report, team-daily-reports, then ledger and apple',
   (H.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]), ['styles.css', 'flow.css', 'director.css', 'daily-report.css', 'team-daily-reports.css', 'ledger.css', 'apple.css']);
ok('body.dh (every report rule hangs off it), theme.js first', /<body class="dh tdr">\s*<script src="js\/theme\.js"><\/script>/.test(H));
ok('the sales section keeps the ids the sales report draws into, hidden', /<section class="dh-glass dh-sr" id="proof" hidden>\s*<div class="dh-head sr-head" id="srHead"><\/div>\s*<div class="sr-body" id="srBody">/.test(H));
ok('  and one hidden section per other team, each with the head and body the team report draws into', ['tdrAccounting', 'tdrLeadgen', 'tdrAdmin'].every(id =>
   new RegExp('<section class="dh-glass dh-sr dh-tr" id="' + id + '" hidden>\\s*<div class="dh-head sr-head" data-tr="head"></div>\\s*<div class="sr-body" data-tr="body">').test(H)));
ok('the list, the toolbar, the date stepper, the back button and the empty pane', ['tdrList', 'tdrChips', 'tdrQ', 'tdrPrev', 'tdrDate', 'tdrNext', 'tdrBack', 'tdrEmpty', 'tdrPane', 'tdrSplit', 'tdrNotice'].every(id => H.includes('id="' + id + '"')));
eq('the scripts the reports need, then the page\'s, in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]),
   ['theme.js', 'api.js', 'auth.js', 'ledger-nav.js', 'flow-api.js', 'itinerary-week.js', 'sales-report-model.js', 'sales-report.js', 'team-report-model.js', 'team-report.js', 'team-daily-reports-model.js', 'team-daily-reports.js']);
ok('no inline script or style', !/<script>/.test(H) && !/style="/.test(H) && !/<style/.test(H));
{
  const CSS = read('css/team-daily-reports.css').replace(/\/\*[\s\S]*?\*\//g, ''), bad = [];
  const re = /(?:^|[{}])\s*([^{}@]+?)\s*\{/g; let m;
  while ((m = re.exec(CSS))) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(sel => { if (!/^(from|to|\d+%)$/.test(sel) && !/^(html\[data-motion="off"\] )?body\.dh\b/.test(sel)) bad.push(sel); });
  ok('team-daily-reports.css: every selector starts with body.dh', bad.length === 0, bad.slice(0, 5));
  ok('  translucent chrome, solid under reduced transparency, the settle stopped under reduced motion, a firmer edge under more contrast',
     /backdrop-filter:blur\(20px\) saturate\(180%\)/.test(CSS) && /prefers-reduced-transparency: reduce/.test(CSS) && /prefers-reduced-motion: reduce/.test(CSS) && /prefers-contrast: more/.test(CSS) && /data-motion="off"/.test(CSS));
  ok('  side by side from 1180px, the list first below it, printing only the report', /@media \(min-width: 1180px\)/.test(CSS) && /@media \(max-width: 1179\.98px\)/.test(CSS) && /body\.dh\.tdr\.sr-print \.dh-col > #tdrSplit/.test(CSS));
  ok('  no colour literal (tokens only)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(CSS));
}

/* the auth.js guard, on a stub page */
function guard(role) {
  const c = { location: { href: '' } };
  c.window = c; vm.createContext(c);
  vm.runInContext(`function getSession() { return __s; } function _homeForRole(r) { return r + '-home.html'; }`, c);
  vm.runInContext(read('js/auth.js').match(/function requireTeamReportsAccess\(\) \{[\s\S]*?\n\}/)[0], c);
  c.__s = role ? { name: 'Mara Manager', username: 'mara', role } : null;
  return { got: vm.runInContext('requireTeamReportsAccess()', c), href: c.location.href };
}

/* the model */
const M = (() => { const c = { console }; vm.createContext(c); vm.runInContext(read('js/team-daily-reports-model.js') + ';this.M = { TDR_TEAMS, tdrLines, tdrGroups, tdrCounts, tdrFilter };', c); return c.M; })();
const DAY = '2026-10-23';
const USERS = [
  { username: 'gerald', fullName: 'Gerald Lucena', role: 'sales' }, { username: 'kim', fullName: 'Kimberlyn Blones', role: 'sales' }, { username: 'cg', fullName: 'Crystal Gayle Dandan', role: 'sales' },
  { username: 'acct2', fullName: 'Rojan Leo Francisco', role: 'accounting' }, { username: 'lea', fullName: 'Lea Gen', role: 'leadgen' },
  { username: 'neil', fullName: 'Neil Estur', role: 'director' }, { username: 'mara', fullName: 'Mara Manager', role: 'management' }, { username: 'hr1', fullName: 'Hana R', role: 'hr' }
];
const line = (at, o) => Object.assign({ id: 'L' + at, type: 'Call', loggedAt: at }, o || {});
const ROWS = [
  { date: DAY, user: 'Crystal Gayle Dandan', role: 'sales', kind: 'sales', updatedAt: '2026-10-23T08:31:00.000Z', submittedAt: '2026-10-23T08:31:00.000Z',
    report: { v: 2, lines: [line('2026-10-23T01:00:00.000Z'), line('2026-10-22T23:30:00.000Z'), line('2026-10-23T02:00:00.000Z', { voidedAt: '2026-10-23T03:00:00.000Z' }), line('2026-10-22T03:00:00.000Z')] } },
  { date: DAY, user: 'Gerald Lucena', role: 'sales', kind: 'sales', updatedAt: '2026-10-23T03:12:00.000Z', submittedAt: '', report: { v: 2, lines: [line('2026-10-23T03:00:00.000Z')] } },
  { date: DAY, user: 'Rojan Leo Francisco', role: 'accounting', kind: 'accounting', updatedAt: '2026-10-23T02:00:00.000Z', submittedAt: '', report: { v: 1, lines: [] } },
  { date: DAY, user: 'Neil Estur', role: 'director', kind: 'sales', updatedAt: '2026-10-23T02:00:00.000Z', report: { v: 2, lines: [] } },
  { date: DAY, user: 'Old Name Rep', role: 'sales', kind: 'sales', updatedAt: '2026-10-23T02:30:00.000Z', report: { v: 2, lines: [] } },
  { date: '2026-10-22', user: 'Kimberlyn Blones', role: 'sales', kind: 'sales', updatedAt: '2026-10-22T08:31:00.000Z', submittedAt: '2026-10-22T08:31:00.000Z', report: { v: 2, lines: [] } }
];

/* the page script, on a stub page */
function elem(id) {
  const cls = new Set(), on = {};
  return { id, hidden: false, innerHTML: '', value: '', disabled: false, min: '', max: '', scrollTop: 0, offsetWidth: 1, on,
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, f) => ((f === undefined ? !cls.has(c) : f) ? cls.add(c) : cls.delete(c)) },
    addEventListener(e, f) { (on[e] = on[e] || []).push(f); }, getBoundingClientRect: () => ({ top: 160 }), setAttribute() {}, removeAttribute() {}, getAttribute: () => null, focus() {}, querySelectorAll: () => [] };
}
const IDS = ['tdrNotice', 'tdrSplit', 'tdrList', 'tdrChips', 'tdrDate', 'tdrPrev', 'tdrNext', 'tdrQ', 'tdrBack', 'tdrPane', 'tdrEmpty', 'proof', 'tdrAccounting', 'tdrLeadgen', 'tdrAdmin'];
async function page(o) {
  o = o || {};
  const els = {}; IDS.forEach(id => { els[id] = elem(id); }); els.__day = elem('tdr-day');
  ['proof', 'tdrAccounting', 'tdrLeadgen', 'tdrAdmin'].forEach(id => { els[id].hidden = true; });
  const calls = [], posts = [], hist = { pushes: 0, backs: 0 };
  const c = { console, Promise, JSON, Math, String, Object, Array, Number, Set, isNaN, parseInt,
    location: { href: '' }, localStorage: { getItem: () => null, setItem() { throw new Error('nothing is kept on this computer'); }, removeItem() {} },
    history: { state: null, pushState(s) { this.state = s; hist.pushes++; }, back() { hist.backs++; this.state = null; } },
    document: { getElementById: (id) => els[id] || null, querySelectorAll: () => [], querySelector: (q) => (q === '.tdr-day' ? els.__day : null), body: elem('body'), documentElement: { scrollHeight: 900 },
                addEventListener: (e, f) => { if (e === 'DOMContentLoaded') c.__boot = f; } },
    innerHeight: 900, scrollY: 0, scrollTo() {}, matchMedia: () => ({ matches: o.wide !== false }), addEventListener() {} };
  c.window = c;
  const RealDate = Date, fixed = new RealDate('2026-10-23T' + (o.hhmm || '10:00') + ':00+08:00');
  c.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } };
  vm.createContext(c);
  vm.runInContext(read('js/sales-report-model.js'), c);
  vm.runInContext(`function getSession() { return __s; } function _homeForRole(r) { return r + '-home.html'; }`, c);
  vm.runInContext(read('js/auth.js').match(/function requireTeamReportsAccess\(\) \{[\s\S]*?\n\}/)[0], c);
  Object.assign(c, {
    __s: { name: 'Mara Manager', username: 'mara', role: o.role || 'management' },
    flowToday: () => DAY,
    flowEsc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    flowVersionAtLeast: (n) => Promise.resolve(n <= (o.version || 185)),
    renderNavbar: (p) => calls.push('nav:' + p),
    apiGetUsers: () => { calls.push('users'); return Promise.resolve(o.usersFail ? { success: false } : { success: true, data: USERS }); },
    apiFetchEmailUsers: () => { calls.push('mailusers'); return Promise.resolve({ success: true, users: USERS.map(u => ({ username: u.username, fullName: u.fullName, role: u.role })) }); },
    postFlow: (a, p) => { posts.push({ a, p }); return Promise.resolve({ success: true, data: ROWS.filter(r => r.date >= p.from && r.date <= p.to) }); },
    salesReport: (id, x) => { calls.push('sales:' + id + ':' + JSON.stringify(x)); return o.slowMount ? new Promise(r => setTimeout(r, 30)) : Promise.resolve(); },
    teamReport: (id, k, x) => { calls.push('team:' + id + ':' + k + ':' + JSON.stringify(x)); return Promise.resolve(); },
    salesReportShow: (p, d) => { calls.push('salesShow:' + p.name + '@' + d); return Promise.resolve(); },
    teamReportShow: (k, p, d) => { calls.push('teamShow:' + k + ':' + p.name + '@' + d); return Promise.resolve(); }
  });
  vm.runInContext(read('js/team-daily-reports-model.js'), c);
  vm.runInContext(read('js/team-daily-reports.js'), c);
  if (c.__boot) c.__boot();
  await tick();
  return { c, els, calls, posts, hist, run: (s) => vm.runInContext(s, c) };
}

/* the home card, on a stub page */
async function card(role, version, hhmm, failRead) {
  const el = { innerHTML: '', style: { display: 'none' } }, posts = [];
  const c = { console, Promise, JSON, Math, String, Object, Array, document: { getElementById: (id) => (id === 'teamDailyReports' ? el : null), addEventListener: (e, f) => { if (e === 'DOMContentLoaded') c.__boot = f; } } };
  const RealDate = Date, fixed = new RealDate('2026-10-23T' + (hhmm || '10:00') + ':00+08:00');
  c.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } };
  c.window = c; vm.createContext(c);
  Object.assign(c, { getSession: () => ({ name: 'M', username: 'm', role }), flowVersionAtLeast: (n) => Promise.resolve(n <= version), flowToday: () => DAY,
    apiGetUsers: () => Promise.resolve({ success: true, data: USERS }),
    postFlow: (a, p) => { posts.push({ a, p }); return Promise.resolve(failRead ? { success: false, message: 'no' } : { success: true, data: ROWS.filter(r => r.date === DAY) }); } });
  vm.runInContext(read('js/team-daily-reports-model.js'), c);
  vm.runInContext(read('js/team-daily-reports-card.js'), c);
  if (c.__boot) c.__boot();
  await tick();
  return { el, posts };
}

(async () => {
  sec('2 · who may open it');
  for (const r of ['management', 'director']) { const g = guard(r); ok(r + ' opens it', !!g.got && g.href === ''); }
  for (const r of ['sales', 'accounting', 'leadgen', 'admin', 'hr', 'marketing']) { const g = guard(r); ok(r + ' is sent home', g.got === null && g.href === r + '-home.html'); }
  const g0 = guard(null);
  ok('nobody signed in: to the sign-in page', g0.got === null && g0.href === 'index.html');

  sec('3 · the list');
  const G = M.tdrGroups(USERS, ROWS, DAY, DAY, 10 * 60);
  eq('the teams that have anyone, in order (the director, management and hr have no new daily report)', G.map(g => g.label), ['Sales', 'Accounting', 'Lead gen']);
  const sales = G[0].people, by = (n) => sales.find(p => p.name === n) || {};
  eq('Sales, by name — a saved report under a name not in the user list is still listed, marked', sales.map(p => [p.name, p.inRoster]),
     [['Crystal Gayle Dandan', true], ['Gerald Lucena', true], ['Kimberlyn Blones', true], ['Old Name Rep', false]]);
  eq('Crystal Gayle: submitted, at the submit time, two lines that Manila day (the voided one and yesterday\'s left out)', [by('Crystal Gayle Dandan').state, by('Crystal Gayle Dandan').at, by('Crystal Gayle Dandan').lines],
     ['submitted', '2026-10-23T08:31:00.000Z', 2]);
  eq('Gerald: saved, at the save time, one line; not late before 4:30', [by('Gerald Lucena').state, by('Gerald Lucena').at, by('Gerald Lucena').lines, by('Gerald Lucena').late], ['saved', '2026-10-23T03:12:00.000Z', 1, false]);
  eq('Kimberlyn: nothing today (yesterday\'s report is yesterday\'s)', [by('Kimberlyn Blones').state, by('Kimberlyn Blones').lines], ['none', 0]);
  ok('the director\'s own trial rows are nobody\'s report', !G.some(g => g.people.some(p => p.name === 'Neil Estur')));
  eq('the team counts', G.map(g => [g.key, g.submitted, g.saved, g.notStarted]), [['sales', 1, 2, 1], ['accounting', 0, 1, 0], ['leadgen', 0, 0, 1]]);
  const late = M.tdrGroups(USERS, ROWS, DAY, DAY, 16 * 60 + 31);
  ok('after 4:30 the ones not submitted are late, the submitted ones never', late[0].people.filter(p => p.late).map(p => p.name).join() === 'Gerald Lucena,Kimberlyn Blones,Old Name Rep' && !late[0].people[0].late);
  ok('  and on a past day, whatever the time', M.tdrGroups(USERS, ROWS, '2026-10-22', DAY, 9 * 60)[0].people.filter(p => p.late).map(p => p.name).join() === 'Crystal Gayle Dandan,Gerald Lucena');
  const cnt = M.tdrCounts(G);
  eq('the totals', [cnt.total, cnt.submitted, cnt.saved, cnt.notStarted], [6, 1, 3, 2]);
  eq('the filter: a state, and a search on the name; empty teams drop out', M.tdrFilter(G, { state: 'none', q: '' }).map(g => g.people.map(p => p.name)), [['Kimberlyn Blones'], ['Lea Gen']]);
  eq('  search', M.tdrFilter(G, { q: 'crystal' }).map(g => g.people.map(p => p.name)), [['Crystal Gayle Dandan']]);

  sec('4 · the page script');
  const pre = await page({ version: 184 });
  ok('before FlowAPI 185: it says so, reads nothing, mounts nothing and hides the date', /version 185/.test(pre.els.tdrNotice.innerHTML) && pre.els.tdrSplit.hidden === true && pre.els.__day.hidden === true && !pre.posts.length &&
     !pre.calls.some(x => /^(sales|team|users)/.test(x)));
  const p = await page();
  ok('the navbar is the page\'s own', p.calls[0] === 'nav:team-daily-reports');
  eq('one read of every report for the day', p.posts.map(x => [x.a, x.p]), [['getProofReports', { kind: 'all', from: DAY, to: DAY }]]);
  const list = p.els.tdrList.innerHTML;
  ok('the list: the teams with how many are in, each person with where their report stands', /Sales <span>1 of 4 submitted<\/span>/.test(list) && /Accounting <span>0 of 1 submitted<\/span>/.test(list) &&
     /Crystal Gayle Dandan<\/span><span class="tdr-lines">2 lines<\/span>/.test(list) && /class="tdr-st ok">Submitted 4:31 PM</.test(list) && /Saved 11:12 AM — 4:30 report due/.test(list) &&
     /class="tdr-st dim">Not started</.test(list) && /not in the user list/.test(list), list.slice(0, 900));
  ok('  the chips count them', /data-state="submitted" aria-pressed="false">Submitted <span class="n">1<\/span>/.test(p.els.tdrChips.innerHTML) && /Everyone <span class="n">6<\/span>/.test(p.els.tdrChips.innerHTML));
  ok('  the date: today, no later; four weeks back at most', p.els.tdrDate.value === DAY && p.els.tdrDate.max === DAY && p.els.tdrDate.min === '2026-09-25' && p.els.tdrNext.disabled === true && p.els.tdrPrev.disabled === false);
  ok('on a wide screen the first person opens by themselves, in the sales section, read only by the engine\'s view mode',
     p.calls.includes('sales:proof:' + JSON.stringify({ view: { name: 'Crystal Gayle Dandan', username: 'cg', day: DAY } })) && p.els.proof.hidden === false &&
     p.els.tdrAccounting.hidden && p.els.tdrLeadgen.hidden && p.els.tdrAdmin.hidden && p.els.tdrEmpty.hidden === true, p.calls);
  ok('  the split is fitted to the window', p.els.tdrSplit.style.props['--tdr-h'] === '720px', p.els.tdrSplit.style.props);
  await p.run('tdrOpen(_tdrPersonOf({ getAttribute: function () { return "accounting|Rojan Leo Francisco"; } }))');
  ok('an accountant: only the accounting section shows, mounted once in view mode', p.calls.includes('team:tdrAccounting:accounting:' + JSON.stringify({ view: { name: 'Rojan Leo Francisco', username: 'acct2', day: DAY } })) &&
     p.els.tdrAccounting.hidden === false && p.els.proof.hidden === true, p.calls);
  await p.run('tdrOpen(_tdrPersonOf({ getAttribute: function () { return "sales|Gerald Lucena"; } }))');
  ok('back to a rep: the sales report is moved to them, not mounted again', p.calls.filter(x => /^sales:/.test(x)).length === 1 && p.calls.includes('salesShow:Gerald Lucena@' + DAY) && p.els.proof.hidden === false && p.els.tdrAccounting.hidden === true);
  await p.run('tdrOpen({ name: "Lea Gen", username: "lea", role: "leadgen" })');
  await p.run('tdrOpen({ name: "Rojan Leo Francisco", username: "acct2", role: "accounting" })');
  ok('  each team\'s report is mounted once, then moved', p.calls.filter(x => /^team:tdrAccounting:/.test(x)).length === 1 && p.calls.includes('teamShow:accounting:Rojan Leo Francisco@' + DAY) &&
     p.calls.filter(x => /^team:tdrLeadgen:/.test(x)).length === 1);
  ok('  on a wide screen nothing is pushed to the browser history', p.hist.pushes === 0 && !p.c.document.body.classList.contains('tdr-reading'));
  await p.run('tdrSetDay("2026-10-22")');
  ok('another day: the list read again for it, and the open person moved to it', JSON.stringify(p.posts[p.posts.length - 1].p) === JSON.stringify({ kind: 'all', from: '2026-10-22', to: '2026-10-22' }) &&
     p.calls[p.calls.length - 1] === 'teamShow:accounting:Rojan Leo Francisco@2026-10-22' && p.els.tdrNext.disabled === false);
  const nPosts = p.posts.length;
  await p.run('tdrSetDay("2026-10-24")');
  await p.run('tdrSetDay("2026-09-01")');
  ok('  a day after today or more than four weeks back is refused', p.posts.length === nPosts && p.run('TDR.day') === '2026-10-22');
  p.run('TDR.f.state = "none"; tdrRender();');
  ok('the chips filter the list (on the 22nd Kimberlyn submitted; Gerald had not started)', /Gerald Lucena/.test(p.els.tdrList.innerHTML) && !/Kimberlyn Blones/.test(p.els.tdrList.innerHTML) &&
     /data-state="none" aria-pressed="true">/.test(p.els.tdrChips.innerHTML));
  ok('nothing is ever saved or submitted from the page', !p.posts.some(x => /save|submit/i.test(x.a)));

  const narrow = await page({ wide: false });
  ok('on a tablet or phone: the list first, nobody opened', !narrow.calls.some(x => /^(sales|team):/.test(x)) && narrow.els.tdrEmpty.hidden === false);
  await narrow.run('tdrOpen({ name: "Crystal Gayle Dandan", username: "cg", role: "sales" })');
  ok('  a person opens full height, with a history entry so Back returns to the list', narrow.c.document.body.classList.contains('tdr-reading') && narrow.hist.pushes === 1);
  narrow.run('tdrBack(false)');
  ok('  "‹ Team" goes back through the history', narrow.hist.backs === 1 && !narrow.c.document.body.classList.contains('tdr-reading'));

  const race = await page({ wide: false, slowMount: true });
  const r1 = race.run('tdrOpen({ name: "Crystal Gayle Dandan", username: "cg", role: "sales" })'), r2 = race.run('tdrOpen({ name: "Gerald Lucena", username: "gerald", role: "sales" })');
  await Promise.all([r1, r2]);
  eq('two quick clicks while a team\'s report first loads: it waits, then moves to the later person, never back to the first',
     race.calls.filter(x => /^sales/.test(x)), ['sales:proof:' + JSON.stringify({ view: { name: 'Crystal Gayle Dandan', username: 'cg', day: DAY } }), 'salesShow:Gerald Lucena@' + DAY]);

  const fb = await page({ usersFail: true });
  ok('the roster falls back to the mail roster when the user list cannot be read', fb.calls.includes('mailusers') && /Crystal Gayle Dandan/.test(fb.els.tdrList.innerHTML));

  sec('5 · the card on the management home');
  const c0 = await card('management', 184);
  ok('before 185: hidden, and nothing read', c0.el.style.display === 'none' && !c0.posts.length);
  const c1 = await card('management', 185);
  ok('one line per team and the way in', c1.el.style.display === '' && /<h2>New daily reports<\/h2><span class="hx-meta">Today · 1 of 6 submitted<\/span>/.test(c1.el.innerHTML) &&
     /<li><b>Sales<\/b><span>1 of 4 submitted · <span class="">2 saved · 1 not started<\/span><\/span><\/li>/.test(c1.el.innerHTML) && /href="team-daily-reports\.html">Open new daily reports</.test(c1.el.innerHTML) &&
     JSON.stringify(c1.posts[0]) === JSON.stringify({ a: 'getProofReports', p: { kind: 'all', from: DAY, to: DAY } }), c1.el.innerHTML);
  const c2 = await card('director', 185, '16:45');
  ok('  after 4:30 the ones not in are in the warning colour', /<span class="due">2 saved · 1 not started<\/span>/.test(c2.el.innerHTML), c2.el.innerHTML);
  const c3 = await card('management', 185, '10:00', true);
  ok('  a failed read leaves it hidden', c3.el.style.display === 'none');
  const c4 = await card('sales', 185);
  ok('  another role: no card, no read', c4.el.style.display === 'none' && !c4.posts.length);
  const MH = read('management-home.html');
  ok('the management home: the card (hidden until filled) just before the old daily reports, its two scripts after the page\'s own',
     /<section class="hx-glass hx-tdr" id="teamDailyReports" style="display:none;"><\/section>\s*\n\s*<!-- Team: the daily reports/.test(MH) &&
     /management-home-page\.js"><\/script>[^\n]*\n\s*<script src="js\/team-daily-reports-model\.js"><\/script>[^\n]*\n\s*<script src="js\/team-daily-reports-card\.js"><\/script>/.test(MH));
  ok('  and the old daily reports card stays', /<section class="hx-glass" id="team">\s*<div class="hx-head"><h2>Daily reports<\/h2>/.test(MH));

  sec('6 · the navbars');
  const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');
  ok('the classic navbar: management\'s "New Daily Reports" right after its Daily Reports', /Daily Reports\s*<\/a>\s*<a href="team-daily-reports\.html" class="\$\{activePage === 'team-daily-reports' \? 'active' : ''\}">/.test(AUTH));
  ok('  the director\'s in the Team menu, which lights up for it', />Daily Reports<\/a>\s*<a href="team-daily-reports\.html"[^>]*>New Daily Reports<\/a>/.test(AUTH) && /dirTeamActive = \['all-daily-reports', 'team-daily-reports',/.test(AUTH));
  const navFor = (role) => { const c = {}; vm.createContext(c); vm.runInContext(NAV + ';this.__l = LEDGER_NAV;', c); return JSON.stringify(c.__l[role] || []); };
  eq('the Apple sidebar links it for management and the director, and nobody else', ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'].filter(r => /team-daily-reports\.html/.test(navFor(r))),
     ['director', 'management']);
  ok('  beside the old daily reports', /\['all-daily-reports\.html', 'Daily reports'\], \['team-daily-reports\.html', 'New daily reports'\]/.test(NAV));

  sec('7 · the site rules');
  const SRC = read('js/team-daily-reports.js') + read('js/team-daily-reports-model.js') + read('js/team-daily-reports-card.js');
  eq('the only FlowAPI call is the read of the reports', Array.from(new Set((SRC.match(/postFlow\('(\w+)'/g) || []).map(x => x.slice(10, -1)))), ['getProofReports']);
  ok('no emoji, no hex colour, no inline style', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{6}\b/.test(SRC) && !/style="/.test(SRC));
  ok('what a person typed reaches the page escaped (names through flowEsc)', /_tdrE\(p\.name\)/.test(SRC) && /esc\(t\.label\)/.test(SRC));

  console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
