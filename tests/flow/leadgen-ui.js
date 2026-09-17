/* A277 — what the lead-gen page actually renders, from a fixture day.
 *
 * Run:  node tests/flow/leadgen-ui.js
 *
 * The counts are pinned against the real FlowAPI.gs in leadgen.js. This pins the other half: that
 * the eight tiles draw the server's numbers and not their own, that "on pace" is time-aware against
 * the SERVER hour, that the week strip marks a non-working day, and that the follow-up list names
 * the stage and the lateness. The real leadgen-home.js runs in a vm with the smallest DOM that
 * lets it, so the assertions are against the shipped markup. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + String(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/leadgen-home.js'), 'utf8');

function boot() {
  const nodes = {};
  const el = (id) => (nodes[id] = nodes[id] || {
    id, innerHTML: '', textContent: '', value: '', style: {}, disabled: false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, setAttribute() {}, getAttribute: () => null, remove() {}
  });
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, parseInt, parseFloat, isNaN, RegExp, setTimeout, clearInterval, setInterval: () => 0, Promise,
    document: { addEventListener() {}, getElementById: (id) => el(id), querySelectorAll: () => [], querySelector: () => null, createElement: () => el('tmp'), body: el('body') },
    localStorage: { getItem: () => null, setItem() {} }, location: { hash: '' }, window: {}, alert() {}, prompt: () => null, confirm: () => false,
    flowEsc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    flowToday: () => '2026-09-14', fetchFlow: async () => ({ success: true, data: {} }), postFlow: async () => ({ success: true }),
    flowClientRef: () => 'CR-test', flowSetViewerOnly() {}, requireLeadgenAccess: () => null, renderNavbar() {}, apiGetUsers: async () => ({ users: [] }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + `
this.__t = {
  el: (id) => this.document.getElementById(id),
  setCounts: (k) => { lgCounts = k; }, setFollowups: (f) => { lgFollowups = f; }, setData: (d) => { lgData = Object.assign(lgData, d); },
  setCanEdit: (v) => { lgCanEdit = v; }, setMailbox: (m) => { lgMailbox = m; },
  getData: () => lgData,
  tileState, renderTiles, renderWeek, renderFollowups, renderHeader, badge, renderLeadCards
};`, ctx);
  return ctx;
}

const DAYS = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
const Q = { attempts: 40, conversations: 5, emails: 25, linkedin: 5, suppliers: 5, accounts: 10, crm: 1, eod: 1, scheduled: 1 };
const QX = { attempts: 50, conversations: 10, emails: 30, linkedin: 10, suppliers: 10, accounts: 15, crm: 1, eod: 1, scheduled: 3 };
const dayOf = (o) => Object.assign({ attempts: 0, conversations: 0, emails: 0, linkedin: 0, suppliers: 0, accounts: 0, crm: 0, eod: 0, scheduled: 0, leads: 0, meetings: 0, introEmails: 0, replies: 0, working: true }, o);
const MET = dayOf({ attempts: 45, conversations: 6, emails: 28, linkedin: 7, suppliers: 5, accounts: 12, crm: 30, eod: 1, scheduled: 2, leads: 3, meetings: 1 });
const counts = (over) => Object.assign({
  success: true, today: '2026-09-16', hour: '10:00', date: '2026-09-16',
  day: dayOf({ attempts: 12, conversations: 1, emails: 8, linkedin: 2, suppliers: 1, accounts: 4, crm: 9, eod: 0, scheduled: 1, leads: 0, meetings: 0 }),
  quotas: Q, quotasMax: QX,
  week: { start: DAYS[0], end: DAYS[6], days: DAYS, workingDays: DAYS.slice(0, 5),
    targets: Object.fromEntries(Object.keys(Q).map(k => [k, Q[k] * 5])), targetsMax: Object.fromEntries(Object.keys(QX).map(k => [k, QX[k] * 5])),
    totals: dayOf({ attempts: 100, conversations: 12, emails: 60, linkedin: 15, suppliers: 9, accounts: 26, crm: 60, eod: 2, scheduled: 4, leads: 5, meetings: 2 }),
    byDay: { '2026-09-14': MET,
             '2026-09-15': dayOf({ attempts: 43, conversations: 3, emails: 24, linkedin: 6, suppliers: 3, accounts: 10, crm: 20, eod: 1, scheduled: 1 }),
             '2026-09-16': dayOf({ attempts: 12, conversations: 1, emails: 8, linkedin: 2, suppliers: 1, accounts: 4, crm: 9, eod: 0, scheduled: 1 }),
             '2026-09-17': dayOf({}), '2026-09-18': dayOf({}),
             '2026-09-19': dayOf({ accounts: 2, working: false }), '2026-09-20': dayOf({ working: false }) },
    weekly: { activeAccounts: { value: 24, min: 20, max: 30 }, leads: { value: 5, min: 10, max: 20 }, suppliersHandedOff: { value: 3, min: 25, max: 50 }, intelUpdates: { value: 2, min: 0, max: 0 }, meetings: { value: 2, min: 0, max: 0 } },
    replies: 5, replyRate: 4.2, replyRateAim: 8 },
  sector: { name: 'Power', index: 3, of: 4 }, reps: { Luzon: 'gerald', VisMin: 'kim' },
  workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], holidays: [], maxBatch: 60
}, over || {});

{
  sec('1 · on pace is time-aware against the server hour');
  const c = boot(), t = c.__t.tileState;
  ok('10 of 40 at 10:00 is on pace', t(10, 40, '10:00', true) === 'pace');
  ok('10 of 40 at 16:00 is behind', t(10, 40, '16:00', true) === 'behind');
  ok('40 of 40 is met whatever the hour', t(40, 40, '16:59', true) === 'met' && t(40, 40, '08:00', true) === 'met');
  ok('0 of anything at 08:00 is on pace (the day has not started)', t(0, 40, '08:00', true) === 'pace');
  ok('a non-working day is off', t(0, 40, '10:00', false) === 'off');
  ok('a zero quota is off', t(5, 0, '10:00', true) === 'off');
  ok('an hour after 17:00 expects the whole quota', t(39, 40, '19:00', true) === 'behind');
}

{
  sec('2 · the eight tiles');
  const c = boot(); c.__t.setCanEdit(true); c.__t.setCounts(counts()); c.__t.setMailbox({ ok: true, seen: 37 });
  c.__t.renderTiles();
  const h = c.__t.el('tiles').innerHTML;
  ok('nine tiles', (h.match(/class="b-card lg-tile"/g) || []).length === 9, h.slice(0, 300));
  ok('attempts draws 12 / 40–50 — a range, met at the first', /Outbound attempts[\s\S]*?12<small>\/ 40–50<\/small>/.test(h));
  ok('attempts at 10:00 is on pace (12 of 40 with 2/9 of the day gone)', /st-pace">on pace<\/span>[\s\S]*?Outbound attempts/.test(h));
  ok('the mailbox reconciliation sits under prospecting emails', /Prospecting emails[\s\S]*?mailbox saw 37 to listed contacts/.test(h));
  ok('the end-of-day tile says it is not submitted', /End-of-day report[\s\S]*?—<small><\/small>[\s\S]*?not submitted yet/.test(h), h.match(/End-of-day report[\s\S]{0,300}/));
  ok('CRM updated shows records touched', h.indexOf('9 records touched today') !== -1);
  ok('tiles are buttons that open the dock when editable', /<button type="button" class="b-card lg-tile" data-dock="call"/.test(h));
  ok('the eod tile is a button too, routed to the report', /data-dock="eod"/.test(h));
  ok('nothing rendered from new Date(): the header hour is the server\'s', c.__t.el('tilesMeta').textContent.indexOf('server time 10:00') !== -1, c.__t.el('tilesMeta').textContent);
  c.__t.setCounts(counts({ hour: '16:30' })); c.__t.renderTiles();
  const h2 = c.__t.el('tiles').innerHTML;
  ok('same numbers at 16:30: attempts is behind', /st-behind">behind<\/span>[\s\S]*?Outbound attempts/.test(h2));
  c.__t.setCounts(counts({ day: MET })); c.__t.renderTiles();
  ok('a day that met everything: nine ticks, and the report reads Done', (c.__t.el('tiles').innerHTML.match(/✓ met/g) || []).length === 9 && /Done<small>/.test(c.__t.el('tiles').innerHTML));
  c.__t.setCanEdit(false); c.__t.renderTiles();
  ok('read-only: tiles are divs, not buttons', c.__t.el('tiles').innerHTML.indexOf('<button') === -1);
  c.__t.setCounts(counts({ day: Object.assign(counts().day, { working: false }) })); c.__t.renderTiles();
  ok('a non-working day says so', c.__t.el('tilesMeta').textContent.indexOf('Not a working day') === 0);
}

{
  sec('3 · the week');
  const c = boot(); c.__t.setCounts(counts()); c.__t.renderWeek();
  const h = c.__t.el('week').innerHTML;
  ok('seven daily rows (crm and eod are not summed) plus five weekly ones', (h.match(/class="wk-row"/g) || []).length === 12, (h.match(/class="wk-row"/g) || []).length);
  ok('attempts 100 / 200–250', h.indexOf('<span class="v">100 / 200–250</span>') !== -1, h.match(/Outbound attempts[\s\S]{0,200}/));
  ok('the weekly block: active accounts 24 / 20–30, suppliers 3 / 25–50', h.indexOf('<span class="v">24 / 20–30</span>') !== -1 && h.indexOf('<span class="v">3 / 25–50</span>') !== -1, h);
  ok('reply rate 4.2% with the aim and the definition', h.indexOf('<b>4.2%</b>') !== -1 && h.indexOf('(aim 8%)') !== -1 && h.indexOf('replies ÷ intro emails') !== -1);
  ok('seven boxes on the strip', (h.match(/class="d[^"]*"/g) || []).length === 7);
  ok('Monday met all nine', /class="d met" title="2026-09-14">Mon<b>9\/9<\/b>/.test(h), h.match(/class="d[^"]*" title="2026-09-14"[^<]*<b>[^<]*/));
  // Tue: attempts 43≥40 ✓ conversations 3<5 ✗ emails 24<25 ✗ linkedin 6≥5 ✓ suppliers 3<5 ✗ accounts 10≥10 ✓ crm ✓ eod ✓ scheduled ✓
  ok('Tuesday partly — 6 of 9 met, judged at each range\'s minimum', /class="d part" title="2026-09-15">Tue<b>6\/9<\/b>/.test(h), h.match(/title="2026-09-15"[^<]*<b>[^<]*/));
  ok('today is outlined', /class="d part today" title="2026-09-16"/.test(h));
  ok('Thursday is in the future — dashed, no number', /class="d future" title="2026-09-17">Thu<b>&nbsp;<\/b>/.test(h), h.match(/title="2026-09-17"[^<]*<b>[^<]*/));
  ok('Saturday is off, drawn but with a dot — its 2 plants count toward nothing', /class="d off" title="2026-09-19 — not a working day">Sat<b>·<\/b>/.test(h), h.match(/title="2026-09-19[^<]*<b>[^<]*/));
  ok('the meta line names the working days', c.__t.el('weekMeta').textContent === '2026-09-14 → 2026-09-20 · 5 working days');
  c.__t.setCounts(counts({ week: Object.assign(counts().week, { replyRate: null }) })); c.__t.renderWeek();
  ok('no intros → a dash, not NaN', c.__t.el('week').innerHTML.indexOf('<b>—</b>') !== -1);
}

{
  sec('4 · follow-ups due');
  const c = boot(); c.__t.setCanEdit(true);
  c.__t.setFollowups([
    { contactNo: 'C1', name: 'R. Santos', company: 'Holcim', plantSite: 'Bulacan', stage: 'Day 7', due: '2026-09-15', action: 'Follow-up call', overdue: 1 },
    { contactNo: 'C2', name: 'M. Cruz', company: 'Apex Mining', plantSite: '', stage: 'Day 3', due: '2026-09-16', action: 'Follow-up email', overdue: 0 },
    { contactNo: 'C3', name: 'J. Reyes', company: 'TMI', plantSite: '', stage: 'Replied', due: '2026-09-16', action: 'Call back', overdue: 0 },
  ]);
  c.__t.renderFollowups();
  const h = c.__t.el('followups').innerHTML;
  ok('count pill', String(c.__t.el('fuCount').textContent) === '3');
  ok('three rows, stage first', (h.match(/class="fu"/g) || []).length === 3 && /stg stg-d7">Day 7</.test(h) && /stg stg-rep">Replied</.test(h));
  ok('lateness is spelled out', h.indexOf('1 day late') !== -1 && h.indexOf('0 days late') === -1);
  ok('who and where', h.indexOf('R. Santos · Holcim — Bulacan') !== -1);
  ok('each row offers a call and an email, prefilled by contact', /data-fu-call="C1"/.test(h) && /data-fu-email="C1"/.test(h));
  ok('a reply asks for the call, not an email, as primary', /<button type="button" class="lg-mini" data-fu-email="C3"/.test(h) && /class="lg-mini pri" data-fu-email="C2"/.test(h));
  ok('the HTML is escaped', (() => { c.__t.setFollowups([{ contactNo: 'X', name: '<b>x</b>', company: 'A', stage: 'Day 3', due: 'd', action: 'a', overdue: 0 }]); c.__t.renderFollowups(); return c.__t.el('followups').innerHTML.indexOf('&lt;b&gt;x&lt;/b&gt;') !== -1; })());
  c.__t.setFollowups([]); c.__t.renderFollowups();
  ok('empty state', c.__t.el('followups').innerHTML.indexOf('Nothing due') !== -1);
}

{
  sec('5 · the lead sheet cards and badges');
  const c = boot(); c.__t.setCanEdit(true);
  c.__t.setData({ leads: [{ rowIndex: 2, leadNo: 'QLD-1', company: 'Holcim', plantSite: 'Bulacan', territory: 'Luzon', handedTo: 'gerald', handedOffOn: '2026-09-10', rehandedOn: '2026-09-15',
    contactName: 'R. Santos', contactRole: 'MRO / Purchasing', rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: false, pain: 'leaks', status: 'Handed Off' }] });
  c.__t.renderLeadCards(c.__t.getData().leads);
  const h = c.__t.el('pBody').innerHTML;
  ok('company — site, rep, both dates', h.indexOf('Holcim — Bulacan') !== -1 && h.indexOf('<b>gerald</b>') !== -1 && h.indexOf('re-handed 2026-09-15 (not counted)') !== -1);
  ok('the four flags, one crossed', (h.match(/✓ /g) || []).length === 3 && /class="no">✕ said yes/.test(h));
  ok('a lead-sheet PDF button per card', /data-pdf="QLD-1"/.test(h));
  ok('badges: Won is good, Returned is warm, Lost is bad', /b-good/.test(c.__t.badge('Won')) && /b-warm/.test(c.__t.badge('Returned')) && /b-bad/.test(c.__t.badge('Lost')));
}

{
  sec('6 · the header');
  const c = boot(); c.__t.setCounts(counts()); c.__t.renderHeader();
  ok('date chip from the server date', c.__t.el('dateDay').textContent === '16' && c.__t.el('dateDow').textContent === 'Wednesday');
  ok('sector week', c.__t.el('weekPillText').textContent === 'Week 3 of 4 · Power');
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
