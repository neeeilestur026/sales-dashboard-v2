/* A314 — the team daily report lists EVERY login, not only the people who left a trace that day.
 *
 * Run:  node tests/flow/all-daily-reports-roster.js
 *
 * A user with a quiet day — or a role that never touches the flow (leadgen, a second accountant) —
 * used to be absent from all-daily-reports.html entirely, so "not submitted" could not even be said
 * of them. The roster now seeds the card list; the director stays out; data still attaches by the
 * display name the activity log uses. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/all-daily-reports.js'), 'utf8');
const els = {};
const el = (id) => els[id] || (els[id] = { innerHTML: '', textContent: '', value: id === 'userSearch' ? '' : '2026-10-01', addEventListener() {}, querySelectorAll: () => [] });
const ctx = { console, document: { addEventListener() {}, getElementById: el, visibilityState: 'visible' }, window: { addEventListener() {} },
  setInterval: () => 0, clearInterval() {},
  flowRenderInjectCss() {}, flowRollupActivity: (rows) => rows, flowActivityCounts: (t) => ({ tasks: t.length, docs: 0, pdfs: 0, byModule: {} }),
  flowTaskAmount: () => 0, flowRenderTaskCards: () => '', flowReportCountersHtml: () => '', flowToday: () => '2026-10-01',
  requireOversight: () => ({ name: 'Boss' }), renderNavbar() {}, fetchFlow: async () => ({ success: true, data: [] }),
  apiGetUsers: async () => ({ success: true, data: [
    { username: 'Neil', fullName: 'Neil', role: 'director' },
    { username: 'Acct2', fullName: 'Rojan Leo Francisco', role: 'accounting' },
    { username: 'leadgen1', fullName: 'Aira', role: 'leadgen' },
    { username: 'sales2', fullName: 'Gerald Lucena', role: 'sales' },
  ] }),
  apiFetchEmailUsers: async () => ({ success: true, users: [] }), apiFetchEmailLogToday: async () => ({ success: true, emails: [] }),
  flowPrimeRefNames: async () => {}, flowWeekDates: () => [] };
vm.createContext(ctx); require('./hxutil').load(ctx);
vm.runInContext(SRC + `\nthis.__t = { load, render, setEntries(e) { adrEntries = e; }, setSubs(s) { adrSubs = s; }, roster: () => adrRoster, setSession(x) { adrSession = x; } };`, ctx);
const T = ctx.__t;

(async () => {
  console.log('\n1 · the roster seeds the list');
  T.setSession({ name: 'Boss' });
  await T.load();
  await new Promise(r => setTimeout(r, 20));
  eq('three logins on the roster (the director stays out)', T.roster().length, 3);
  const names = (els.userReports.innerHTML.match(/data-user="([^"]+)"/g) || []).map(m => m.slice(11, -1));
  eq('every one of them has a card, even with nothing to show', names.join(' | '), 'Aira | Gerald Lucena | Rojan Leo Francisco');
  ok('a quiet user reads as not submitted, no movements', /Rojan Leo Francisco[\s\S]*?not submitted/.test(els.userReports.innerHTML));
  eq('the user count says 3', els.userCount.textContent, 3);

  console.log('\n2 · the day\'s data still attaches by display name');
  T.setEntries([{ user: 'Rojan Leo Francisco', module: 'Invoice' }]);
  T.setSubs({ 'Aira': { submittedAt: '2026-10-01T09:00:00', status: 'Submitted' } });
  T.render();
  ok('activity shows on the accountant\'s card', /data-user="Rojan Leo Francisco"[\s\S]*?1 task\(s\)/.test(els.userReports.innerHTML));
  ok('Aira\'s submission shows on hers', /data-user="Aira"[\s\S]*?submitted/.test(els.userReports.innerHTML) && !/data-user="Aira"[\s\S]*?not submitted/.test(els.userReports.innerHTML.split('data-user="Gerald')[0]));
  const names2 = (els.userReports.innerHTML.match(/data-user="([^"]+)"/g) || []).map(m => m.slice(11, -1));
  eq('nobody is listed twice', names2.length, new Set(names2).size);
  ok('the list is alphabetical', names2.join() === names2.slice().sort((a, b) => a.localeCompare(b)).join());

  console.log('\n3 · source pins');
  ok('the roster is read before the first paint', SRC.indexOf('adrRoster = (') < SRC.indexOf('adrEmailsLoading = true;'));
  ok('the email fan-out reuses it instead of a second roster call', /let list = adrRoster\.slice\(\);/.test(SRC));

  console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
  process.exit(FAIL ? 1 : 0);
})();
