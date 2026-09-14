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
const counts = (over) => Object.assign({
  success: true, today: '2026-09-16', hour: '10:00', date: '2026-09-16',
  day: { plants: 9, contacts: 14, introEmails: 40, followupEmails: 12, coldCalls: 17, followupCalls: 4, leads: 2, meetings: 1, replies: 1, working: true },
  quotas: { plants: 15, contacts: 20, introEmails: 40, followupEmails: 30, coldCalls: 20, followupCalls: 10, leads: 3, meetings: 1 },
  week: { start: DAYS[0], end: DAYS[6], days: DAYS, workingDays: DAYS.slice(0, 5),
    targets: { plants: 75, contacts: 100, introEmails: 200, followupEmails: 150, coldCalls: 100, followupCalls: 50, leads: 15, meetings: 5 },
    totals: { plants: 41, contacts: 50, introEmails: 120, followupEmails: 60, coldCalls: 55, followupCalls: 20, leads: 9, meetings: 3 },
    byDay: { '2026-09-14': { plants: 15, contacts: 20, introEmails: 40, followupEmails: 30, coldCalls: 20, followupCalls: 10, leads: 3, meetings: 1, working: true },
             '2026-09-15': { plants: 17, contacts: 16, introEmails: 40, followupEmails: 18, coldCalls: 18, followupCalls: 6, leads: 4, meetings: 1, working: true },
             '2026-09-16': { plants: 9, contacts: 14, introEmails: 40, followupEmails: 12, coldCalls: 17, followupCalls: 4, leads: 2, meetings: 1, working: true },
             '2026-09-17': { plants: 0, contacts: 0, introEmails: 0, followupEmails: 0, coldCalls: 0, followupCalls: 0, leads: 0, meetings: 0, working: true },
             '2026-09-18': { plants: 0, contacts: 0, introEmails: 0, followupEmails: 0, coldCalls: 0, followupCalls: 0, leads: 0, meetings: 0, working: true },
             '2026-09-19': { plants: 2, contacts: 0, introEmails: 0, followupEmails: 0, coldCalls: 0, followupCalls: 0, leads: 0, meetings: 0, working: false },
             '2026-09-20': { plants: 0, contacts: 0, introEmails: 0, followupEmails: 0, coldCalls: 0, followupCalls: 0, leads: 0, meetings: 0, working: false } },
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
  ok('eight tiles', (h.match(/class="b-card lg-tile"/g) || []).length === 8, h.slice(0, 300));
  ok('plants draws 9 / 15', /Plants researched[\s\S]*?9<small>\/ 15<\/small>/.test(h));
  ok('intro emails is met with a tick', /st-met">✓ met<\/span>[\s\S]*?Intro emails/.test(h));
  ok('plants at 10:00 is behind (9 of 15 with 2/9 of the day gone → expected 3.3 → on pace)', /st-pace">on pace<\/span>[\s\S]*?Plants researched/.test(h));
  ok('follow-up emails 12 / 30 at 10:00 is on pace', /st-pace">on pace<\/span>[\s\S]*?Follow-up emails/.test(h));
  ok('the mailbox reconciliation sits under intro emails', h.indexOf('mailbox saw 37 to listed contacts') !== -1);
  ok('leads tile names the reps', h.indexOf('gerald / kim') !== -1);
  ok('tiles are buttons that open the dock when editable', /<button type="button" class="b-card lg-tile" data-dock="call"/.test(h));
  ok('every value is the server\'s, not recomputed: 17 / 20 cold calls', /17<small>\/ 20<\/small>/.test(h));
  ok('nothing rendered from new Date(): the header hour is the server\'s', c.__t.el('tilesMeta').textContent.indexOf('server time 10:00') !== -1, c.__t.el('tilesMeta').textContent);
  c.__t.setCounts(counts({ hour: '16:30' })); c.__t.renderTiles();
  const h2 = c.__t.el('tiles').innerHTML;
  ok('same numbers at 16:30: plants is behind', /st-behind">behind<\/span>[\s\S]*?Plants researched/.test(h2));
  c.__t.setCanEdit(false); c.__t.renderTiles();
  ok('read-only: tiles are divs, not buttons', c.__t.el('tiles').innerHTML.indexOf('<button') === -1);
  c.__t.setCounts(counts({ day: Object.assign(counts().day, { working: false }) })); c.__t.renderTiles();
  ok('a non-working day says so', c.__t.el('tilesMeta').textContent.indexOf('Not a working day') === 0);
}

{
  sec('3 · the week');
  const c = boot(); c.__t.setCounts(counts()); c.__t.renderWeek();
  const h = c.__t.el('week').innerHTML;
  ok('eight rows against weekly targets', (h.match(/class="wk-row"/g) || []).length === 8);
  ok('plants 41 / 75', h.indexOf('<span class="v">41 / 75</span>') !== -1);
  ok('reply rate 4.2% with the aim and the definition', h.indexOf('<b>4.2%</b>') !== -1 && h.indexOf('(aim 8%)') !== -1 && h.indexOf('replies ÷ intro emails') !== -1);
  ok('seven boxes on the strip', (h.match(/class="d[^"]*"/g) || []).length === 7);
  ok('Monday met all eight', /class="d met" title="2026-09-14">Mon<b>8\/8<\/b>/.test(h), h.match(/class="d[^"]*" title="2026-09-14"[^<]*<b>[^<]*/));
  ok('Tuesday partly — 4 of 8 quotas met', /class="d part" title="2026-09-15">Tue<b>4\/8<\/b>/.test(h), h.match(/title="2026-09-15"[^<]*<b>[^<]*/));
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
