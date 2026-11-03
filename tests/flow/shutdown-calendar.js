/* A391 — the shutdown calendar in the browser: the month grid (multi-day bars in lanes), the Upcoming list, the page per
 * role, the sales home card, the menus and the bell.
 *
 * Run:  node tests/flow/shutdown-calendar.js
 */
const fs = require('fs');
const path = require('path');
const { page } = require('./pageload');
const M = require('../../dashboard/js/shutdown-calendar-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');
const T = '2026-11-03';
const it = (no, s, e, o) => Object.assign({ shutdownNo: no, company: no + ' Co', start: s, end: e, status: 'Confirmed', offer: [] }, o || {});

sec('1 · the month grid');
{
  const aug = M.shdmMonthGrid('2026-08', [], { today: T }), feb = M.shdmMonthGrid('2027-02', [], { today: T });
  ok('August 2026 starts on a Saturday: 6 rows, from Monday 27 July', aug.weeks.length === 6 && aug.weeks[0].start === '2026-07-27' && aug.label === 'August 2026', aug.weeks.map(w => w.start));
  ok('February 2027 is exactly 4 rows (it starts on a Monday)', feb.weeks.length === 4 && feb.weeks[0].start === '2027-02-01');
  const nov = M.shdmMonthGrid('2026-11', [it('A', '2026-11-05', '2026-11-12'), it('B', '2026-11-06', '2026-11-06'), it('C', '2026-11-06', '2026-11-07'),
    it('D', '2026-11-06', '2026-11-06'), it('E', '2026-11-20', '2026-11-20'), it('F', '2026-10-28', '2026-11-03'), it('X', '2026-11-25', '2026-11-26', { archived: true })], { today: T });
  const w1 = nov.weeks.find(w => w.start === '2026-11-02'), w2 = nov.weeks.find(w => w.start === '2026-11-09'), w0 = nov.weeks[0];
  const bar = (w, no) => w.bars.find(b => b.no === no);
  ok('a shutdown crossing a week ends square on the right, and goes on square on the left in the next row', bar(w1, 'A').col === 3 && bar(w1, 'A').span === 4 && bar(w1, 'A').contR &&
     bar(w2, 'A').col === 0 && bar(w2, 'A').span === 4 && bar(w2, 'A').contL && !bar(w2, 'A').contR, [bar(w1, 'A'), bar(w2, 'A')]);
  ok('three on one day take lanes 0, 1, 2 (the longer first); a fourth counts as "+1 more" on its day only', ['A', 'C', 'B'].map(n => bar(w1, n).lane).join() === '0,1,2' &&
     !bar(w1, 'D') && w1.more.join('') === '0000100', [w1.bars.map(b => [b.no, b.lane]), w1.more]);
  ok('each day counts every shutdown on it (Friday 6 Nov: four)', w1.days[4].count === 4 && w1.days[4].date === '2026-11-06');
  ok('one from the month before is clipped to the grid (it shows from Monday 26 Oct)', bar(w0, 'F').col === 2 && bar(w0, 'F').span === 5 && bar(w0, 'F').contR, bar(w0, 'F'));
  ok('a free lane is reused: E (20 Nov) takes lane 0 again', bar(nov.weeks.find(w => w.start === '2026-11-16'), 'E').lane === 0);
  ok('archived ones are left out unless asked for', !nov.weeks.some(w => bar(w, 'X')) && M.shdmMonthGrid('2026-11', [it('X', '2026-11-25', '2026-11-26', { archived: true })], { archived: true }).weeks.some(w => bar(w, 'X')));
  ok('today and the days of other months are marked', w1.days[1].today && w1.days[1].date === T && !w0.days[0].inMonth && w0.days[6].inMonth);
  ok('an end before the start is one day; a missing start is dropped', M.shdmMonthGrid('2026-11', [it('Y', '2026-11-10', '2026-11-08'), it('Z', '', '')]).weeks.reduce((t, w) => t + w.bars.length, 0) === 1);
  const again = M.shdmMonthGrid('2026-11', [it('C', '2026-11-06', '2026-11-07'), it('B', '2026-11-06', '2026-11-06'), it('A', '2026-11-05', '2026-11-12')], { today: T });
  ok('the lanes do not depend on the order the entries came in', ['A', 'C', 'B'].map(n => again.weeks.find(w => w.start === '2026-11-02').bars.find(b => b.no === n).lane).join() === '0,1,2');
}

sec('2 · words, Upcoming, search');
{
  ok('ranges in words', M.shdmRangeLabel('2026-11-10', '2026-11-17', T) === '10–17 Nov' && M.shdmRangeLabel('2026-11-28', '2026-12-03', T) === '28 Nov – 3 Dec' &&
     M.shdmRangeLabel('2026-11-10', '2026-11-10', T) === '10 Nov' && M.shdmRangeLabel('2027-01-05', '2027-01-09', T) === '5–9 Jan 2027');
  ok('how far off: under way, tomorrow, in N days, ended', M.shdmSoon(it('a', '2026-11-01', '2026-11-05'), T) === 'under way' && M.shdmSoon(it('a', '2026-11-04', '2026-11-04'), T) === 'tomorrow' &&
     M.shdmSoon(it('a', '2026-11-10', '2026-11-12'), T) === 'in 7 days' && M.shdmSoon(it('a', '2026-10-01', '2026-10-02'), T) === 'ended');
  const up = M.shdmUpcoming([it('now', '2026-11-01', '2026-11-05'), it('week', '2026-11-07', '2026-11-08'), it('month', '2026-11-20', '2026-11-21'), it('later', '2027-01-10', '2027-01-12'),
                             it('gone', '2026-10-01', '2026-10-02'), it('arch', '2026-11-10', '2026-11-11', { archived: true })], T);
  ok('Upcoming: under way, this week (to Sunday), the next 30 days, later; ended and archived left out', up.map(g => g.key + ':' + g.items.map(x => x.shutdownNo).join()).join('|') === 'now:now|week:week|month:month|later:later', up);
  const all = [it('a', T, T, { company: 'Petra Cement', site: 'Palimbang plant', mine: true, status: 'Tentative' }), it('b', T, T, { company: 'Taganito HPAL', status: 'Confirmed' }), it('c', T, T, { archived: true })];
  ok('search by client or site; chips Mine, Tentative, Archived', M.shdmFilter(all, { q: 'palimbang' }).length === 1 && M.shdmFilter(all, { chip: 'mine' }).length === 1 &&
     M.shdmFilter(all, { chip: 'Tentative' }).length === 1 && M.shdmFilter(all, { chip: 'archived' }).length === 1 && M.shdmFilter(all, {}).length === 2);
  ok('the form\'s checks', M.shdmCheck({ company: '', start: T }) && M.shdmCheck({ company: 'x', start: '' }) && M.shdmCheck({ company: 'x', start: '2026-11-10', end: '2026-11-09' }) && !M.shdmCheck({ company: 'x', start: T }));
  ok('a Book client offers its plant, its head office, then Other', M.shdmPlaces({ siteAddress: 'Palimbang', headOfficeAddress: 'Makati' }).map(p => p.kind).join() === 'Plant,Head office,Other' &&
     M.shdmPlaces(null).map(p => p.kind).join() === 'Other');
  ok('suggestions: my Client Book first, then the client master, no repeats', M.shdmSuggest([{ company: 'Petra Cement Inc.', clientNo: 'CB-1' }], [{ customer: 'PETRA CEMENT INC.' }, { customer: 'Taganito HPAL' }])
     .map(x => x.name + (x.clientNo ? '#' + x.clientNo : '')).join('|') === 'Petra Cement Inc.#CB-1|Taganito HPAL');
}

sec('3 · the page, per role');
(async () => {
  const who = (role) => ({ name: 'Kimberlyn Blones', username: role + '1', role, token: 't' });
  const pg = (role, answers) => {
    const p = page(['js/shutdown-calendar-model.js', 'js/shutdown-calendar.js'], 'shutdown-calendar.html', who(role), { withAuth: true });
    p.ctx.__answers = answers || {};
    p.ctx.matchMedia = () => ({ matches: false });
    p.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); var x = __answers[a]; ' +
          'return Promise.resolve(typeof x === "function" ? x(q || {}) : (x || { success: false, message: "Unknown action: " + a })); };' +
          'apiGetUsers = function () { return Promise.resolve({ success: true, data: [] }); };');
    return p;
  };
  const DATA = { success: true, today: T, may: { add: true }, items: [it('SH-1', '2026-11-05', '2026-11-12', { company: 'Petra Cement Inc.', site: 'Palimbang plant', canEdit: false, createdBy: 'Gerald Lucena' })], log: [] };
  for (const role of ['sales', 'director', 'management']) {
    const p = pg(role, { getShutdowns: DATA, getClientBook: { success: true, clients: [] } });
    await p.boot();
    ok(role + ' opens the calendar: it reads every entry (archived too, for the chip) and draws the month', p.calls.indexOf('POST:getShutdowns') >= 0 &&
       JSON.stringify(p.paramsFor('getShutdowns')) === '{"archived":true,"log":true}' && /Petra Cement Inc\./.test(p.els.shdBody.innerHTML) && /shd-bar c4 s4 l0/.test(p.els.shdBody.innerHTML), p.calls);
  }
  for (const role of ['hr', 'admin', 'accounting', 'warehouse']) {
    const p = pg(role, {});
    await p.boot();
    ok(role + ' is sent home and asks for nothing', p.calls.length === 0);
  }
  const mg = pg('management', { getShutdowns: DATA });
  await mg.boot();
  await new Promise(r => setImmediate(r));
  ok('management does not ask for the Client Book (it is closed to them): the client master only', mg.calls.indexOf('POST:getClientBook') < 0 && mg.calls.indexOf('getClients') >= 0, mg.calls);
  const old = pg('sales', {});
  await old.boot();
  ok('an older backend: the page says to paste FlowAPI 195', /needs FlowAPI 195/.test(old.els.shdNotice.innerHTML));
  const js = read('js/shutdown-calendar.js');
  ok('archive has an Undo (restore), never a confirm', /hxSnackbar\(it\.company \+ ' archived\.', \{ action: 'Undo', onAction: \(\) => shdArchive\(it, true\) \}\)/.test(js) && !/confirm\(/.test(js));
  ok('only someone who may change an entry sees Edit and Archive (the server says canEdit)', /it\.canEdit \?/.test(js) && /Only ' \+ _shdE\(it\.createdBy\) \+ ', the director or management can change it\./.test(js));
  ok('a twin answer links to the entry already there', /r\.duplicate \?/.test(js) && /data-twin/.test(js));
  ok('?new=1 opens the add sheet; ?view=upcoming the list', /hxDeepLink\(\(\) => shdEdit\(null, null\)\)/.test(js) && /q\.get\('view'\) === 'upcoming'/.test(js));

  sec('4 · the sales home card');
  const card = (role, answers) => {
    const p = page(['js/shutdown-calendar-model.js', 'js/shutdowns-card.js'], 'dashboard.html', who(role));
    p.ctx.__answers = answers || {};
    p.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); var x = __answers[a]; return Promise.resolve(x || { success: false, message: "Unknown action: " + a }); };' +
          'getSession = function () { return __session; };');
    return p;
  };
  const c = card('sales', { getShutdowns: { success: true, today: T, cardDays: 30, items: [it('SH-1', '2026-11-05', '2026-11-12', { company: 'Petra Cement Inc.', site: 'Palimbang plant', mine: true })] } });
  await c.boot();
  ok('a rep\'s home: the next 30 days, with the range, the client and site, and "yours"', JSON.stringify(c.paramsFor('getShutdowns')) === '{"upcomingDays":30}' && c.els.comingShutdowns.style.display === '' &&
     /5–12 Nov/.test(c.els.comingShutdowns.innerHTML) && /Petra Cement Inc\.<\/b> · Palimbang plant/.test(c.els.comingShutdowns.innerHTML) && /yours/.test(c.els.comingShutdowns.innerHTML), c.els.comingShutdowns.innerHTML.slice(0, 300));
  const none = card('sales', {});
  await none.boot();
  ok('  hidden before FlowAPI 195', none.els.comingShutdowns.style.display === 'none');
  const dir = card('director', {});
  await dir.boot();
  ok('  only on a rep\'s home', dir.calls.length === 0);

  sec('5 · menus, the + button, the bell, the site rules');
  const auth = read('js/auth.js'), nav = read('js/ledger-nav.js'), phone = read('js/apple-phone.js');
  ok('the guard admits sales, the director and management', /const FLOW_SHUTDOWN_ROLES = \['sales', 'director', 'management'\];/.test(auth));
  ok('the classic navbar links it for sales (Clients), the director (Team) and management (Approvals)', (auth.match(/href="shutdown-calendar\.html"/g) || []).length === 3);
  ok('  and the rail for the same three', (nav.match(/'shutdown-calendar\.html', 'Shutdown calendar'/g) || []).length === 3);
  ok('the + button offers "New shutdown" to the same three', (phone.match(/'shutdown-calendar\.html\?new=1', 'New shutdown'/g) || []).length === 3);
  ok('the bell: a count only, the rep\'s own, the others all', /postFlow\('getShutdowns', \{ countOnly: true \}\)/.test(auth) && /const n = isSales \? \(\+r\.mine \|\| 0\) : \(\+r\.count \|\| 0\);/.test(auth));
  const css = read('css/shutdown-calendar.css');
  ok('the stylesheet: tokens only, bars placed by classes, reduced motion handled', !/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(css) && /\.shd-week > \.s4 \{ grid-column-end: span 4; \}/.test(css) && /prefers-reduced-motion: reduce/.test(css));
  ok('the month stepper really hides in Upcoming (its display rule would beat the attribute)', /\.shd-step\[hidden\] \{ display: none; \}/.test(css));
  ok('no inline style is written by the page (bars are classes)', !/style="/.test(js) && !/style="/.test(read('shutdown-calendar.html')));

  console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
