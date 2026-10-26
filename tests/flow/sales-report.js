/* A348 — the Sales Daily Report, redesigned (js/sales-report-model.js + js/sales-report.js, first on director-home).
 *
 * Run:  node tests/flow/sales-report.js
 *
 * The checks Neil's build prompt asks for, on a small world with answers worked out by hand: Gerald on Tuesday
 * 20 Oct 2026, today being Wednesday 21 Oct. The model runs on the real flow-api.js and itinerary-week.js in one vm
 * context, as the page does.
 *
 *   1 · targets, time, the weekend rule
 *   2 · desk day / visit day
 *   3 · follow-ups due on day 3, 7 and 14 (weekends to Monday; won and closed never), and when they are done
 *   4 · the tiles: emails, RFQs vs PRs made, quotes, 48 h, open quotations; calls 14 red and 15 not; booked; visits
 *   5 · log lines: never deleted — edit and void keep a reason and what the line said; links; the 4:30 snapshot
 *   6 · the portal's feed and the other activity
 *   7 · the week: totals, colours, future days
 *   8 · the page: tiles, follow-up rows, the log, the visit card, the reports, and only the trial's own actions
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DASH = path.resolve(__dirname, '../../dashboard/js');
let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const C = (function load() {
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, Promise,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    navigator: { userAgent: 'node' }, location: { href: '', pathname: '/' }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  require('./hxutil').load(ctx);
  ['flow-api.js', 'itinerary-week.js', 'sales-report-model.js', 'sales-report.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DASH, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext('flowToday = function () { return "2026-10-21"; };', ctx);
  return ctx;
})();
const run = (code) => vm.runInContext(code, C);

/* ── the world ─────────────────────────────────────────────────────────────────────────────── */
const G = 'Gerald Lucena';
const q = (no, o) => Object.assign({ quotationNo: no, salesperson: G, createdBy: G, status: 'Sent', total: 100000, discountPct: 0, customer: 'Client ' + no, sentAt: '', sentAtBasis: '', items: [] }, o);
C.__raw = {
  today: '2026-10-21',
  settings: {},
  itineraries: [
    { itineraryNo: 'ITIN-9', weekStart: '2026-10-19', user: G, status: 'Pending Director', items: [{ seq: 1, date: '2026-10-22', plannedTime: '10:00', company: 'Plant A', personToMeet: 'R. Cruz' }] },
    { itineraryNo: 'ITIN-8', weekStart: '2026-10-19', user: G, status: 'Draft', items: [{ seq: 1, date: '2026-10-23', company: 'Draft Plant' }] }
  ],
  quotations: [
    q('Q-D3', { customer: 'Mine D', total: 400000, sentAt: '2026-10-17T02:00:00.000Z' }),                 // Sat + 3 = Tue 20th
    q('Q-D7', { customer: 'Plant B Inc', total: 300000, sentAt: '2026-10-13T02:00:00.000Z' }),            // + 7 = Tue 20th
    q('Q-D14', { customer: 'Power C', total: 200000, sentAt: '2026-10-06T02:00:00.000Z' }),              // + 14 = Tue 20th
    q('Q-SUN', { customer: 'Cement E', total: 50000, sentAt: '2026-10-15T02:00:00.000Z' }),              // + 3 = Sun 18th -> Mon 19th
    q('Q-SAT', { customer: 'Nickel F', total: 60000, sentAt: '2026-10-10T02:00:00.000Z' }),              // + 7 = Sat 17th -> Mon 19th
    q('Q-WON', { customer: 'Won Co', sentAt: '2026-10-13T02:00:00.000Z' }),                              // has a sales order
    q('Q-LOST', { customer: 'Lost Co', status: 'Lost', sentAt: '2026-10-13T02:00:00.000Z' }),
    q('Q-NOT', { customer: 'Later Co', sentAt: '2026-10-14T02:00:00.000Z' }),                            // + 7 = Wed 21st
    q('Q-NEW', { customer: 'Fresh Co', total: 250000, sentAt: '2026-10-20T03:00:00.000Z', prNo: 'PR-A' }), // sent on the 20th, 25 h after PR-A
    q('Q-KIM', { salesperson: 'Kimberlyn Blones', createdBy: 'Kimberlyn Blones', sentAt: '2026-10-13T02:00:00.000Z' }),
    q('DEMO-1', { sentAt: '2026-10-13T02:00:00.000Z', total: 9e6 })
  ],
  salesOrders: [{ soNo: 'SO-1', quotationNo: 'Q-WON', date: '2026-10-19', customer: 'Won Co', total: 100000 }],
  quotationEmails: [{ quotationNo: 'Q-D14', kind: 'Follow-up', status: 'Active', sentAt: '2026-10-20T09:30:00+08:00', subject: 'Following up on our quotation' }],
  prs: [
    { prNo: 'PR-A', customer: 'Fresh Co', salesperson: G, requestedBy: G, status: 'Quoted', date: '2026-10-19' },
    { prNo: 'PR-B', customer: 'Web Client', salesperson: G, requestedBy: 'Crystal Gayle', status: 'Requested', date: '2026-10-20' },
    { prNo: 'PR-C', customer: 'Admin Client', salesperson: 'Admin', requestedBy: G, status: 'Requested', date: '2026-10-20' }
  ],
  activity: [
    { timestamp: '2026-10-19T02:00:00.000Z', date: '2026-10-19', user: G, module: 'Pricing Request', action: 'Created', refNo: 'PR-A', summary: 'PR made' },
    { timestamp: '2026-10-20T01:00:00.000Z', date: '2026-10-20', user: 'Crystal Gayle', module: 'Pricing Request', action: 'Created', refNo: 'PR-B' },
    { timestamp: '2026-10-20T01:30:00.000Z', date: '2026-10-20', user: G, module: 'Pricing Request', action: 'Created', refNo: 'PR-C' },
    { timestamp: '2026-10-20T03:00:00.000Z', date: '2026-10-20', user: G, module: 'Quotation', action: 'Sent', refNo: 'Q-NEW', summary: 'sent' },
    { timestamp: '2026-10-20T02:00:00.000Z', date: '2026-10-20', user: G, module: 'Inventory', action: 'Added', refNo: 'INV-1' },
    { timestamp: '2026-10-20T02:10:00.000Z', date: '2026-10-20', user: G, module: 'Quotation', action: 'PDF Saved', refNo: 'Q-NEW' }
  ],
  calls: [{ callNo: 'CALL-1', date: '2026-10-20', user: G, contact: 'Buyer', company: 'Old Page Co', outcome: 'Connected', createdAt: '2026-10-20T06:00:00.000Z', kind: '' },
          { callNo: 'CALL-LG', date: '2026-10-20', user: G, contact: 'X', company: 'Lead gen', outcome: 'No answer', createdAt: '2026-10-20T06:10:00.000Z', kind: 'Cold' }],
  visits: []
};
run('var IX = srIndex(__raw), ME = { name: "Gerald Lucena", username: "gerald", first: "Gerald" }, NOW = "2026-10-20T03:30:00.000Z";');
run('var REP = srBlank();');
const callLine = (o) => run('srNewLine(' + JSON.stringify(Object.assign({ type: 'Call', company: 'X' }, o)) + ', "Gerald Lucena", "' + (o.at || '2026-10-20T05:00:00.000Z') + '")');

sec('1 · targets, time, the weekend rule');
eq('the prompt\'s targets', run('JSON.stringify([IX.cfg.srEmailsDay, IX.cfg.srEmailsDayRed, IX.cfg.srCallsDay, IX.cfg.srCallsDayRed, IX.cfg.srEmailsWeek, IX.cfg.srCallsWeek, IX.cfg.srQuotesWeek, IX.cfg.srQuotesWeekValue, IX.cfg.srWithin48, IX.cfg.srOpenQuotes, IX.cfg.srOpenQuotesRed])'),
   JSON.stringify([50, 40, 20, 15, 250, 100, 5, 1100000, 0.9, 4500000, 3000000]));
eq('  a FlowSettings row overrides one, junk is ignored', run('JSON.stringify([srCfg({ srCallsDay: "25" }).srCallsDay, srCfg({ srCallsDay: "x" }).srCallsDay])'), '[25,20]');
eq('a Saturday or Sunday due date moves to Monday', run('[srShiftWeekend("2026-10-17"), srShiftWeekend("2026-10-18"), srShiftWeekend("2026-10-20")].join()'), '2026-10-19,2026-10-19,2026-10-20');
eq('times read in Manila', run('[srClock("2026-10-20T03:30:00.000Z"), srClock("1899-12-30T06:00:00.000Z"), srClock("14:05")].join()'), '11:30 AM,2:00 PM,2:05 PM');
eq('the week runs Monday to Sunday', run('srWeekDays("2026-10-21").join()'), '2026-10-19,2026-10-20,2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-25');

sec('2 · desk day / visit day');
eq('no plan for the day: a desk day', run('srDayType(IX, ME, "2026-10-20", REP).type'), 'desk');
eq('a stop in a submitted plan: a visit day, with what is booked', run('JSON.stringify((d => [d.type, d.planned.map(p => p.company)])(srDayType(IX, ME, "2026-10-22", REP)))'), JSON.stringify(['visit', ['Plant A']]));
eq('a stop in a draft plan is not a booking', run('srDayType(IX, ME, "2026-10-23", REP).type'), 'desk');
eq('the person\'s own switch is kept', run('srDayType(IX, ME, "2026-10-20", Object.assign(srBlank(), { dayType: "visit", dayTypeOverridden: true })).type'), 'visit');
{
  /* A369 — client visits (FlowAPI 186), the new itinerary: the rep's own visits sent to the director, approved or done
     are the day's planned stops too; a draft, one sent back, one cancelled, or another rep's are not. */
  C.__plans = Object.assign({}, C.__raw, { visitPlans: [
    { visitPlanNo: 'VP-1', date: '2026-10-20', time: '14:00', user: G, company: 'Plant V', address: 'Brgy. Bigte, Norzagaray, Bulacan', contacts: [{ id: 'P1', name: 'R. Cruz', position: 'Planner' }], someoneElse: 'The plant manager', status: 'Approved' },
    { visitPlanNo: 'VP-2', date: '2026-10-20', time: '', user: G, company: 'Pending Co', contacts: [], someoneElse: 'Buyer', status: 'Pending Director' },
    { visitPlanNo: 'VP-3', date: '2026-10-20', user: G, company: 'Draft Co', status: 'Draft' },
    { visitPlanNo: 'VP-4', date: '2026-10-20', user: G, company: 'Back Co', status: 'Rejected' },
    { visitPlanNo: 'VP-5', date: '2026-10-20', user: G, company: 'Off Co', status: 'Cancelled' },
    { visitPlanNo: 'VP-6', date: '2026-10-20', user: 'Kim Reyes', company: 'Kim Co', status: 'Approved' },
    { visitPlanNo: 'VP-7', date: '2026-10-22', user: G, company: 'Plant A2', time: '08:00', status: 'Done' }] });
  run('var IXV = srIndex(__plans);');
  eq('A369: a day with client visits is a visit day; only the rep\'s own sent, approved or done visits count', run('JSON.stringify((d => [d.type, d.planned.map(p => p.ref)])(srDayType(IXV, ME, "2026-10-20", REP)))'), JSON.stringify(['visit', ['VP-2', 'VP-1']]));
  eq('  each with its time, people and town', run('JSON.stringify((p => [p.time, p.person, p.city])(srPlanned(IXV, ME, "2026-10-20").find(x => x.ref === "VP-1")))'), JSON.stringify(['2:00 PM', 'R. Cruz, The plant manager', 'Norzagaray, Bulacan']));
  eq('  beside the weekly plan\'s stops, in time order', run('JSON.stringify(srPlanned(IXV, ME, "2026-10-22").map(p => p.ref))'), JSON.stringify(['VP-7', 'ITIN-9#1']));
}

sec('3 · follow-ups due today');
const due = run('JSON.stringify(srFollowUps(IX, ME, "2026-10-20", REP).map(x => [x.ref, x.step]).sort())');
eq('day 3, 7 and 14 after sending fall on Tuesday the 20th', due, JSON.stringify([['Q-D14', 14], ['Q-D3', 3], ['Q-D7', 7]]));
ok('  won (a sales order), lost, another rep\'s, demo and not-yet-due quotations never appear', !/Q-WON|Q-LOST|Q-KIM|DEMO|Q-NOT|Q-NEW/.test(due));
eq('a weekend due date is on the Monday (Q-NOT: Wed + 3 = Sat; Q-SAT: + 7 = Sat; Q-SUN: + 3 = Sun)', run('JSON.stringify(srFollowUps(IX, ME, "2026-10-19", REP).map(x => [x.ref, x.step]).sort())'), JSON.stringify([['Q-NOT', 3], ['Q-SAT', 7], ['Q-SUN', 3]]));
run('REP.lines.push(srNewLine({ type: "Call", company: "Plant B Inc", result: "Reached", note: "Decision on 3 Nov", linkType: "quotation", linkId: "Q-D7", linkLabel: "Q-D7" }, "Gerald Lucena", "2026-10-20T05:00:00.000Z"));');
const fu = JSON.parse(run('JSON.stringify(srFollowUps(IX, ME, "2026-10-20", REP))'));
const by = (ref) => fu.find(x => x.ref === ref);
ok('a call linked to Q-D7 logged that day: "Called" with its result', by('Q-D7').done && by('Q-D7').by.kind === 'Call' && by('Q-D7').by.result === 'Reached');
ok('a follow-up email linked to Q-D14 that day also counts', by('Q-D14').done && by('Q-D14').by.kind === 'Email');
ok('Q-D3 is still to do', !by('Q-D3').done);
ok('a call with no link to the quotation does not count', run('(function(){ var r = srBlank(); r.lines.push(srNewLine({ type: "Call", company: "Mine D", result: "Reached" }, "G", "2026-10-20T05:00:00.000Z")); return !srFollowUps(IX, ME, "2026-10-20", r).find(x => x.ref === "Q-D3").done; })()'));

sec('3b · A367: follow-ups on older quotations');
const ch = JSON.parse(run('JSON.stringify(srFollowUpChoices(IX, ME, "2026-10-20"))'));
eq('the picker offers his other open quotations, oldest sent first', ch.map(x => [x.ref, x.age]), [['Q-SAT', 10], ['Q-NOT', 6], ['Q-SUN', 5], ['Q-NEW', 0]]);
ok('  never the ones due today, won, lost, another rep\'s or demo', !ch.some(x => /Q-D3|Q-D7|Q-D14|Q-WON|Q-LOST|Q-KIM|DEMO/.test(x.ref)));
eq('  each with its client, value and age', [ch[0].label, ch[3].label], ['Q-SAT — Nickel F, ' + run('srMoney(60000)') + ' · sent 10 days ago', 'Q-NEW — Fresh Co, ' + run('srMoney(250000)') + ' · sent today']);
run('var REP2 = JSON.parse(JSON.stringify(REP)); REP2.lines.push(srNewLine({ type: "Call", company: "Nickel F", result: "Reached", linkType: "quotation", linkId: "Q-SAT", linkLabel: "Q-SAT" }, "Gerald Lucena", "2026-10-20T06:00:00.000Z"));' +
    'REP2.lines.push(srNewLine({ type: "Call", company: "Cement E", result: "Reached", linkType: "quotation", linkId: "Q-SUN", linkLabel: "Q-SUN" }, "Gerald Lucena", "2026-10-19T06:00:00.000Z"));');
const other = JSON.parse(run('JSON.stringify(srOtherFollowUps(IX, ME, "2026-10-20", REP2))'));
eq('a call linked to an older quotation that day is a follow-up on top: Q-SAT, day 10, called', other.map(x => [x.ref, x.age, x.by.kind, x.done, x.extra]), [['Q-SAT', 10, 'Call', true, true]]);
ok('  one logged on another day is not (Q-SUN, called on the 19th)', !other.some(x => x.ref === 'Q-SUN'));
ok('  it leaves the picker once followed up that day', !JSON.parse(run('JSON.stringify(srFollowUpChoices(IX, ME, "2026-10-20", REP2))')).some(x => x.ref === 'Q-SAT') &&
   JSON.parse(run('JSON.stringify(srFollowUpChoices(IX, ME, "2026-10-20", REP2))')).some(x => x.ref === 'Q-SUN'));
ok('  and the day\'s due list is unchanged', run('srFollowUps(IX, ME, "2026-10-20", REP2).map(function (x) { return x.ref; }).sort().join()') === 'Q-D14,Q-D3,Q-D7');
{
  const ft = JSON.parse(run('JSON.stringify(srMineTiles(IX, ME, "2026-10-20", REP2, 17*60).find(function (t) { return t.key === "followUps"; }))'));
  eq('the tile: done of due, plus the ones on top; its colour still from the ones due', [ft.text, ft.status, ft.value, ft.items.length], ['2 of 3 +1', 'red', 3, 4]);
  ok('  and its target line says so', /\+1 on other quotations/.test(ft.target));
  const wk = JSON.parse(run('JSON.stringify(srWeek(IX, ME, "2026-10-20", { "2026-10-20": { report: REP2 } }, {}).rows.find(function (r) { return r.day === "2026-10-20"; }))'));
  eq('  the week row counts them too', [wk.fuDone, wk.fuDue, wk.fuOther], [2, 3, 1]);
}
{
  const SRC = fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8');
  const li = run('_srFuHtml(' + JSON.stringify(other[0]) + ')');
  ok('on the page: an older follow-up shows its own grey day tag and "Called"', /sr-daytag other">Day 10</.test(li) && /Called ✓ — Reached/.test(li), li);
  ok('  the picker sits under the due list, on the person\'s own report only, and fills the call form as Log call does',
     /<label class="sr-fupick">Follow up another quotation<select class="sr-in" id="srFuPick"><\/select><\/label>/.test(SRC) &&
     /t\.id === 'srFuPick' && t\.value && !SR_UI\.ro\) \{ const no = t\.value; t\.value = ''; t\.blur\(\); _srPrefillCall\(no\); \}/.test(SRC) &&
     !/\(ro \? '<section class="sr-block"><h3>Follow-ups due today[^\n]*srFuPick/.test(SRC));
  ok('  "Also followed up today" lists them, and the count says how many more', /Also followed up today/.test(SRC) && /' · \+' \+ n\.other\.length \+ ' more'/.test(SRC));
}

sec('4 · the tiles');
C.__emails45 = Array.from({ length: 45 }, (_, i) => ({ subject: 'Mail ' + i, sentAt: '2026-10-20T0' + (i % 9) + ':00:00+08:00', messageId: 'm' + i }));
C.__emails38 = C.__emails45.slice(0, 38);
const portal = (emails) => JSON.parse(run('JSON.stringify(srPortalTiles(IX, ME, "2026-10-20", ' + emails + ', 17 * 60))'));
const A = portal('__emails45'), t = (list, k) => list.find(x => x.key === k);
eq('row A in the prompt\'s order', A.map(x => x.key), ['emailsSent', 'rfqs', 'prsMade', 'quotesSent', 'within48', 'openQuotes']);
eq('emails sent: 45 on a finished day is "watch" (under 50, not under 40)', [t(A, 'emailsSent').value, t(A, 'emailsSent').status], [45, 'watch']);
eq('  38 is red', t(portal('__emails38'), 'emailsSent').status, 'red');
eq('  a mailbox that cannot be read is "not counted", never 0', [t(portal('null'), 'emailsSent').text, t(portal('null'), 'emailsSent').status], ['—', 'nr']);
eq('RFQs received: PRs created that day for his clients — PR-B (made by admin), not PR-C (Admin\'s)', t(A, 'rfqs').items.map(i => i.ref), ['PR-B']);
eq('PRs made: the ones he created that day — PR-C', t(A, 'prsMade').items.map(i => i.ref), ['PR-C']);
eq('quotes sent: Q-NEW, with the week so far in the target', [t(A, 'quotesSent').value, t(A, 'quotesSent').target], [1, '5 a week · 1 so far']);
eq('quotes within 48 h: Q-NEW, 25 h from PR-A', [t(A, 'within48').text, t(A, 'within48').status, t(A, 'within48').items[0].what], ['100%', 'ok', '25 h from PR-A']);
eq('open quotations: his Sent ones, not won, lost, Kim\'s or demo (400k+300k+200k+50k+60k+100k+250k)', [t(A, 'openQuotes').value, t(A, 'openQuotes').status], [1360000, 'red']);
const mine = (rep, now) => JSON.parse(run('JSON.stringify(srMineTiles(IX, ME, "2026-10-20", ' + rep + ', ' + (now || '17 * 60') + '))'));
const withCalls = (n) => 'Object.assign(srBlank(), { lines: Array.from({ length: ' + n + ' }, (_, i) => srNewLine({ type: "Call", company: "C" + i }, "G", "2026-10-20T0" + (i % 9) + ":00:00.000Z")) })';
eq('row B in the prompt\'s order, and A371 Other tasks last', mine('REP').map(x => x.key), ['calls', 'followUps', 'booked', 'visits', 'otherTasks']);
eq('calls: 13 lines + 1 on the old page = 14 on a finished day is red', [t(mine(withCalls(13)), 'calls').value, t(mine(withCalls(13)), 'calls').status], [14, 'red']);
eq('  15 is not red', t(mine(withCalls(14)), 'calls').status, 'watch');
eq('  20 is on pace', t(mine(withCalls(19)), 'calls').status, 'ok');
eq('  a lead-gen call on the old log is not his sales call', t(mine('srBlank()'), 'calls').value, 1);
eq('  at 9:00 today, 3 calls is on pace, not red', run('srMineTiles(IX, ME, IX.today, ' + withCalls(3).replace(/2026-10-20T0/g, '2026-10-21T0') + ', 9 * 60)[0].status'), 'ok');
eq('follow-ups done: 2 of 3, red once the day is over', [t(mine('REP'), 'followUps').text, t(mine('REP'), 'followUps').status], ['2 of 3', 'red']);
run('REP.lines.push(srNewLine({ type: "Call", company: "Plant Q", result: "Booked" }, "G", "2026-10-20T06:00:00.000Z")); REP.bookings = ["m1"];');
eq('presentations booked: a Booked call plus a marked invite email', t(mine('REP'), 'booked').value, 2);
eq('visits on a desk day: "—", "Desk day — no visit booked"', [t(mine('REP'), 'visits').text, t(mine('REP'), 'visits').target], ['—', 'Desk day — no visit booked']);

sec('5 · log lines: never deleted');
run('var L = srNewLine({ type: "Call", company: "Plant B Inc", result: "Reached" }, "Gerald Lucena", "2026-10-20T05:00:00.000Z");');
eq('a new line has no link until one is given', run('L.linkType'), 'none');
ok('an edit needs a reason', /reason|why/i.test(run('srEditLine(L, { result: "Booked" }, "", "2026-10-20T05:10:00.000Z").error')));
run('srEditLine(L, { result: "Booked" }, "Picked the wrong result", "2026-10-20T05:10:00.000Z");');
eq('  and keeps what the line said before', run('JSON.stringify([L.result, L.editReason, L.history[0].before.result])'), JSON.stringify(['Booked', 'Picked the wrong result', 'Reached']));
run('srAddLink(L, "quotation", "Q-D7", "Q-D7", "2026-10-20T05:20:00.000Z");');
eq('a link added later is remembered too', run('JSON.stringify([L.linkType, L.linkId, L.history[1].reason])'), JSON.stringify(['quotation', 'Q-D7', 'link added']));
ok('a void needs a reason', !!run('srVoidLine(L, "", "x").error'));
run('srVoidLine(L, "Logged twice", "2026-10-20T05:30:00.000Z");');
ok('  the line stays, voided, with its reason', run('L.voidedAt !== "" && L.voidReason === "Logged twice" && L.company === "Plant B Inc"'));
ok('  and no longer counts', run('(function(){ var r = srBlank(); r.lines.push(L); return srMineTiles(IX, ME, "2026-10-20", r, 17*60)[0].value === 1 && srLinked(r, "2026-10-20").total === 0; })()'));
eq('log lines with a link: X of Y', run('JSON.stringify(srLinked(REP, "2026-10-20"))'), JSON.stringify({ linked: 1, total: 2 }));
C.__snap = run('JSON.parse(JSON.stringify(srSnapshot(srPortalTiles(IX, ME, "2026-10-20", __emails45, 17*60), srMineTiles(IX, ME, "2026-10-20", REP, 17*60), "2026-10-20", REP)))');
ok('the 4:30 snapshot holds every number on the page', ['emailsSent', 'rfqs', 'prsMade', 'quotesSent', 'within48', 'openQuotes', 'calls', 'followUps', 'booked', 'visits'].every(k => C.__snap[k] && C.__snap[k].text !== undefined));
run('REP.lines.push(srNewLine({ type: "Call", company: "Late Co" }, "G", "2026-10-20T08:00:00.000Z"));');
ok('  and is a copy: a line logged after it does not move it', C.__snap.calls.text === '3' && t(mine('REP'), 'calls').text === '4', [C.__snap.calls.text, t(mine('REP'), 'calls').text]);
const legacy = run('JSON.stringify(srFill({ huddle: { plan: "the A347 form" } }))');
ok('a day saved by the A347 form opens blank, its content kept as legacy', /"v":2/.test(legacy) && /"legacy":\{"huddle":\{"plan":"the A347 form"\}\}/.test(legacy), legacy);

sec('6 · logged by the portal');
C.__in = [{ subject: 'RFQ for hose', from: 'buyer@mine.ph', name: 'Mine D buyer', date: '2026-10-20T10:00:00+08:00', messageId: 'in1', category: 'Sales Inquiry/RFQ' },
          { subject: 'Yesterday', date: '2026-10-19T10:00:00+08:00', messageId: 'in0' }];
const feed = JSON.parse(run('JSON.stringify(srPortalFeed(IX, ME, "2026-10-20", __emails45.slice(0, 2), __in))'));
ok('sent and received email, PRs and quotations, by time — not other days\' mail', feed.some(x => x.kind === 'email' && !x.sent && /RFQ for hose/.test(x.text)) && !feed.some(x => /Yesterday/.test(x.text)) &&
   feed.some(x => x.kind === 'pr' && x.ref === 'PR-C') && feed.some(x => x.kind === 'quotation' && x.ref === 'Q-NEW'));
ok('  in time order', feed.every((x, i) => !i || feed[i - 1].sort <= x.sort));
eq('the rest of the portal\'s day is one grey line', run('JSON.stringify(srOtherActivity(IX, ME, "2026-10-20"))'), JSON.stringify({ inventory: 1, pdfs: 1, tasks: 1 }));
const links = JSON.parse(run('JSON.stringify(srLinkOptions(IX, ME, "2026-10-20", __emails45.slice(0, 1), __in))'));
ok('link to: his open quotations, his recent PRs, today\'s emails', links.quotation.some(x => x.id === 'Q-D7') && !links.quotation.some(x => x.id === 'Q-KIM') &&
   links.pr.some(x => x.id === 'PR-B') && links.email.length === 2);
/* A350 — the Client Book trial: its clients to link to, and the person's own changes in the feed */
C.__book = { clients: [
    { clientNo: 'CB-0002', company: 'Zeta Mining', owner: 'Kim Reyes', accreditation: 'On process', status: '' },
    { clientNo: 'CB-0001', company: 'Philcement Corp.', owner: 'Gerald Lucena', accreditation: 'Accredited', status: 'Quotation sent' },
    { clientNo: 'CB-0003', company: 'Gone Co', owner: 'Gerald Lucena', accreditation: 'Not accredited', archivedAt: '2026-10-19T01:00:00.000Z' }],
  log: [
    { logNo: 'CBL-1', clientNo: 'CB-0001', kind: 'status', from: 'RFQ received', to: 'Quotation sent', ref: 'Q-NEW', by: 'Gerald Lucena', at: '2026-10-20T04:15:00.000Z' },
    { logNo: 'CBL-2', clientNo: 'CB-0002', kind: 'created', to: 'Zeta Mining', by: 'Kim Reyes', at: '2026-10-20T04:20:00.000Z' },
    { logNo: 'CBL-3', clientNo: 'CB-0001', kind: 'accreditation', from: 'On process', to: 'Accredited', by: 'Gerald Lucena', at: '2026-10-19T04:20:00.000Z' }] };
run('var IXB = srIndex(Object.assign({}, __raw, { book: __book }));');
const bl = JSON.parse(run('JSON.stringify(srLinkOptions(IXB, ME, "2026-10-20", [], []).client)'));
eq('A350: link to the Client Book\'s clients, his own first, archived ones left out', bl.map(x => x.id), ['CB-0001', 'CB-0002']);
ok('  each labelled with its stage, and with the owner when it is someone else\'s', bl[0].label === 'Philcement Corp. (Quotation sent)' && bl[1].label === 'Zeta Mining — Kim Reyes (On process)', bl);
const bf = JSON.parse(run('JSON.stringify(srPortalFeed(IXB, ME, "2026-10-20", [], []).filter(function (x) { return x.kind === "client"; }))'));
ok('  the feed shows his own Client Book changes that day, not someone else\'s or another day\'s', bf.length === 1 && bf[0].text === 'Status RFQ received → Quotation sent (Q-NEW) — Philcement Corp.' && bf[0].time === '12:15 PM', bf);
eq('  each kind of change reads plainly', ['created', 'accreditation', 'contacts', 'details', 'archived', 'restored'].map(k => run('srClientBookText(' + JSON.stringify({ kind: k, from: k === 'accreditation' ? 'On process' : '', to: k === 'accreditation' ? 'Accredited' : '' }) + ')')),
   ['Added to the Client Book', 'Accreditation On process → Accredited', 'Contacts updated', 'Client details updated', 'Archived from the Client Book', 'Restored to the Client Book']);
ok('  without FlowAPI 178 there are no clients to link and no client feed', links.client.length === 0 && !feed.some(x => x.kind === 'client'));

sec('6b · A356: the call form picks the company and the person from the Client Book');
{
  const J = (code) => JSON.parse(run('JSON.stringify(' + code + ')'));
  C.__book2 = JSON.parse(JSON.stringify(C.__book));
  C.__book2.clients[1].tier = 'Major'; C.__book2.clients[1].sector = 'Cement';
  C.__book2.clients[1].contacts = [{ id: 'P1', name: 'Ben Santos', position: 'Maintenance planner', emails: ['ben@philcement.ph'], phones: [], primary: false },
                                   { id: 'P2', name: 'Ana Cruz', position: 'Purchasing officer', emails: ['ana@philcement.ph'], phones: ['0917 123 4567'], primary: true }];
  run('var IXC = srIndex(Object.assign({}, __raw, { book: __book2 }));');
  eq('the companies to pick from: his own clients first, archived ones left out', J('srBookClients(IXC, ME).map(function (c) { return c.clientNo; })'), ['CB-0001', 'CB-0002']);
  const L = J('srCallLookup(IXC, ME, "philcement corp", "")');
  ok('a company typed in any case or punctuation is found, and the call is linked to it', L.client && L.client.clientNo === 'CB-0001' && JSON.stringify(L.link) === JSON.stringify({ linkType: 'client', linkId: 'CB-0001' }), L.link);
  eq('  its contact people, the main contact first', L.people.map(p => p.name), ['Ana Cruz', 'Ben Santos']);
  eq('a contact is found by name, or by name and position', [J('srCallLookup(IXC, ME, "Philcement Corp.", "ana cruz").contact.id'), J('srCallLookup(IXC, ME, "Philcement Corp.", "Ben Santos, Maintenance planner").contact.id')], ['P2', 'P1']);
  ok('a company not in the book is no client, and the call is not linked', J('srCallLookup(IXC, ME, "Some New Plant", "")').client === null && J('srCallLookup(IXC, ME, "Some New Plant", "")').link === null);
  ok('an archived client is not offered', J('srCallLookup(IXC, ME, "Gone Co", "")').client === null);
  eq('a contact reads "Name, Position"', run('srContactLabel({ name: "Ana Cruz", position: "Purchasing officer" })'), 'Ana Cruz, Purchasing officer');
  C.__rawL = Object.assign({}, C.__raw, { prs: C.__raw.prs.map(p => p.prNo === 'PR-C' ? Object.assign({}, p, { clientNo: 'CB-0001' }) : p), book: C.__book });
  const fl = J('srPortalFeed(srIndex(__rawL), ME, "2026-10-20", [], []).filter(function (x) { return x.kind === "pr"; })');
  ok('A358: a PR made for a Client Book client names that client in the portal feed', fl.some(x => x.ref === 'PR-C' && x.client && x.client.no === 'CB-0001' && x.client.company === 'Philcement Corp.'), fl);
  ok('  and the feed links it to the client\'s page', /director-client-book\.html\?client=' \+ encodeURIComponent\(x\.client\.no\)/.test(fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8')));
  const feedWith = (links, prClient) => {
    C.__rawM = Object.assign({}, C.__raw, { prs: C.__raw.prs.map(p => p.prNo === 'PR-C' ? Object.assign({}, p, { clientNo: prClient || '' }) : p), book: Object.assign({}, C.__book, { links }) });
    return J('srPortalFeed(srIndex(__rawM), ME, "2026-10-20", [], []).filter(function (x) { return x.kind === "pr"; })').find(x => x.ref === 'PR-C');
  };
  const viaLink = feedWith([{ kind: 'pr', no: 'PR-C', clientNo: 'CB-0002' }], '');
  ok('A360: an old PR connected by hand on the Client Book names that client', viaLink && viaLink.client && viaLink.client.no === 'CB-0002' && viaLink.client.company === 'Zeta Mining', viaLink);
  const off = feedWith([{ kind: 'pr', no: 'PR-C', clientNo: '' }], 'CB-0001');
  ok('  and one taken off names none, even when it was made for a client', off && off.client === null, off);
  eq('  the timeline lines read plainly', J('[srClientBookText({ kind: "linked", ref: "PR-C" }), srClientBookText({ kind: "unlinked", ref: "Q-9" })]'), ['Connected PR-C', 'Took Q-9 off']);
}

sec('7 · the week');
C.__reports = { '2026-10-19': { report: srBlankWith(14), submittedAt: '2026-10-19T08:31:00.000Z' }, '2026-10-20': { report: srBlankWith(20) } };
function srBlankWith(n) { return { v: 2, lines: Array.from({ length: n }, (_, i) => ({ id: 'w' + n + i, type: 'Call', company: 'C', result: i ? 'Reached' : 'Booked', loggedAt: (n === 14 ? '2026-10-19' : '2026-10-20') + 'T03:00:00.000Z', history: [] })) }; }
C.__wm = { '2026-10-19': C.__emails38, '2026-10-20': C.__emails45 };
const W = JSON.parse(run('JSON.stringify(srWeek(IX, ME, "2026-10-20", __reports, __wm))'));
eq('Mon: 38 emails amber, 14 calls red', [W.rows[0].emails, W.rows[0].emailTone, W.rows[0].calls, W.rows[0].callTone], [38, 'watch', 14, 'red']);
eq('Tue: 45 emails, 21 calls on pace', [W.rows[1].emails, W.rows[1].emailTone, W.rows[1].calls, W.rows[1].callTone], [45, '', 21, 'ok']);
eq('the report column: Mon submitted with its time, Tue due', [W.rows[0].report.state, W.rows[0].report.time, W.rows[1].report.state], ['done', '4:31 PM', 'due']);
ok('Thu to Sun are still to come', W.rows.slice(3).every(r => r.future));
eq('totals against the week\'s targets', [W.totals.emails, W.totals.emailsTarget, W.totals.calls, W.totals.callsTarget, W.totals.booked, W.totals.reports, W.totals.reportDays], [83, 250, 35, 100, 2, 1, 3]);

sec('8 · the page');
run('SR_UI.ix = IX; SR_UI.me = ME; SR_UI.day = "2026-10-20"; SR_UI.state = REP; SR_UI.sent = __emails45.slice(0, 3); SR_UI.received = __in; SR_UI.saved = {}; SR_UI.nums = _srNums();');
const tile = run('_srTileHtml(srPortalTiles(IX, ME, "2026-10-20", __emails45, 17*60)[0])');
ok('a tile: label, value, a bar to target, the target, its status; it opens its records', /data-rec="emailsSent"/.test(tile) && /<span class="v">45<\/span>/.test(tile) && /data-w="0.900"/.test(tile) && /50 a day/.test(tile) && /watch/.test(tile));
const rows = run('SR_UI.nums.fu.map(_srFuHtml).join("")');
ok('follow-up rows: Day 3 / 7 / 14, "Called ✓" with the result, or a Log call button', /Day 3/.test(rows) && /Day 7/.test(rows) && /Called ✓ — Reached/.test(rows) && /data-logcall="Q-D3"/.test(rows));
const log = run('_srLogRows()');
ok('my log: a line without a link says "No link — add one"', /No link — add one/.test(log) && /data-addlink=/.test(log));
ok('  the old page\'s call is grey, marked as in the portal\'s log', /CALL-1 · in the portal&#39;s log|CALL-1 · in the portal's log/.test(log));
ok('  edit and void on each live line, never delete', /data-edit=/.test(log) && /data-void=/.test(log) && !/data-del/.test(log));
const keepLink = run('_srPickerHtml("dr|DR-0207", "DR-0207")');
{
  const keep = run('SR_UI.ix');
  run('SR_UI.ix = IXC;');
  const form = run('_srCallForm()');
  ok('A356: the form\'s Company and Person pick from the Client Book (and can still be typed)', /name="company" list="srBookCos" required/.test(form) && /name="person" list="srBookPeople"/.test(form) &&
     /<datalist id="srBookCos"><option value="Philcement Corp\.">Major · Cement · Accredited · Quotation sent<\/option><option value="Zeta Mining">On process · Kim Reyes(&#39;|')s client<\/option>/.test(form), form.slice(0, 700));
  const hint = run('_srCallHintHtml(srCallLookup(IXC, ME, "Philcement Corp.", "Ana Cruz, Purchasing officer"), "Philcement Corp.")');
  ok('  what the book has on file: the client\'s labels, and the contact\'s phone and email', /Client Book<\/span> Major · Cement · Accredited · Quotation sent/.test(hint) && /Ana Cruz, Purchasing officer: 0917 123 4567 · ana@philcement\.ph/.test(hint), hint);
  ok('  before a contact is picked, how many there are', /2 contacts to pick from/.test(run('_srCallHintHtml(srCallLookup(IXC, ME, "Philcement Corp.", ""), "Philcement Corp.")')));
  ok('  and a new company says it is not in the book', run('_srCallHintHtml(srCallLookup(IXC, ME, "Some New Plant", ""), "Some New Plant")') === 'Not in the Client Book.');
  ok('  a company typed in another case is logged as the book spells it', /company: book\.client \? book\.client\.company : company/.test(fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8')));
  ok('  the other line dialogs\' company fields pick from the same list', (fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8').match(/name="company" list="srBookCos"/g) || []).length === 5);   // A371 — Other task too
  C.__keepIx = keep; run('SR_UI.ix = __keepIx;');
}
ok('editing a line keeps its own link, chosen, even when it is not in today\'s lists (a DR number)', /<input type="hidden" name="link" value="dr\|DR-0207">/.test(keepLink) && /<span class="sr-pickt">Keep: DR-0207<\/span>/.test(keepLink) && /data-keep="dr\|DR-0207"/.test(keepLink), keepLink.slice(0, 400));
{
  const h = JSON.parse(run('JSON.stringify(srLinkPick(srLinkItems(IXB, ME, "2026-10-20", [], []), {}).sections.filter(function (s) { return s.key === "client"; })[0])'));
  ok('A350: Link to has a Client Book section, the rep\'s own client first', h && h.label === 'Client Book' && h.items[0].value === 'client|CB-0001' && h.items[0].title === 'Philcement Corp.' && /Quotation sent/.test(h.items[0].sub), h);

  /* A373 — Neil, 26 Oct: "redesign it so that the open quotations, prs, client book, and emails are properly and cleanly
     organize in that dropdown, can be easily found". */
  C.__sentL = [{ messageId: 'mS', subject: 'Quotation Q-D7', sentAt: '2026-10-20T09:15:00+08:00', name: 'Plant B buyer', company: 'Plant B Inc' }];
  run('var LI = srLinkItems(IXB, ME, "2026-10-20", __sentL, __in);');
  const P = (o) => JSON.parse(run('JSON.stringify(srLinkPick(LI, ' + JSON.stringify(o || {}) + '))'));
  const all = P();
  eq('A373: four sections in order, each with its count', all.sections.map(x => [x.label, x.items.length]).map(x => x[0]), ['Open quotations', 'Purchase requests', 'Client Book', 'Emails today']);
  const q7 = JSON.parse(run('JSON.stringify(LI.quotation.filter(function (x) { return x.id === "Q-D7"; })[0])'));
  ok('  a quotation reads "Q-D7 · Plant B Inc" over its value and sent day', q7.title === 'Q-D7 · Plant B Inc' && /^₱300,000(\.00)? · sent 13 Oct$/.test(q7.sub) && q7.value === 'quotation|Q-D7', q7);
  const em = JSON.parse(run('JSON.stringify(LI.email)'));
  ok('  an email reads its subject over who and when', em[0].title === 'Quotation Q-D7' && em[0].sub === 'Sent 9:15 AM to Plant B buyer · Plant B Inc' && /^Received 10:00 AM from Mine D buyer/.test(em[1].sub), em);
  const s1 = P({ q: 'plant b' });
  ok('  the search finds a record by any word of it, in every kind, and the tabs count what it found', s1.sections.some(x => x.key === 'quotation' && x.items.some(i => i.id === 'Q-D7')) &&
     s1.sections.some(x => x.key === 'email') && s1.counts.email === 1 && !s1.sections.some(x => x.key === 'client'), s1);
  ok('  a tab shows one kind only', P({ tab: 'client' }).sections.map(x => x.key).join() === 'client');
  const f = P({ company: 'Plant B Inc' });
  ok('  for a call, the company\'s own records come first, under "For <company>"', f.sections[0].key === 'for' && f.sections[0].label === 'For Plant B Inc' && f.sections[0].items.map(i => i.type).join() === 'quotation,email', f.sections[0]);
  ok('  and a link value finds its record', JSON.parse(run('JSON.stringify(srLinkFind(LI, "client|CB-0001").title)')) === 'Philcement Corp.' && run('srLinkFind(LI, "dr|DR-1")') === null);
  run(`var __inp = { value: 'none|' }, __form = { elements: { company: { value: 'Plant B Inc' } } };
    var __root = { attrs: { 'data-q': '', 'data-tab': 'all', 'data-keep': '', 'data-keeplabel': '' }, getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      setAttribute: function (k, v) { this.attrs[k] = v; }, querySelector: function (s) { return s === 'input[name="link"]' ? __inp : null; }, closest: function () { return __form; } };
    var __keepIx2 = SR_UI.ix, __keepSent = SR_UI.sent; SR_UI.ix = IXB; SR_UI.sent = __sentL;`);
  const panel = run('_srPickPanelHtml(__root)');
  ok('the panel: a search, the tabs with their counts, then "No link", the company\'s own records, and each kind under its heading',
     /<input type="search" class="sr-in sr-pickq" placeholder="Search quotations, PRs, clients and emails"/.test(panel) && /data-picktab="all">All <span>\d+<\/span>/.test(panel) && /data-picktab="client">Clients <span>2<\/span>/.test(panel) &&
     /data-pickval="none\|"><span class="t">No link \(new contact\)<\/span>/.test(panel) && /<p class="sr-pickhead">For Plant B Inc <span>2<\/span><\/p>/.test(panel) &&
     /<p class="sr-pickhead">Open quotations <span>\d+<\/span><\/p>/.test(panel) && /<p class="sr-pickhead">Emails today <span>2<\/span><\/p>/.test(panel), panel.slice(0, 900));
  ok('  each record is a button on two lines, its kind tagged under "For …"', /<button type="button" class="sr-pickopt" role="option" aria-selected="false" data-pickval="quotation\|Q-D7"><span class="t">Q-D7 · Plant B Inc<\/span><span class="k">Quotation<\/span><span class="s">/.test(panel));
  run('__root.attrs["data-q"] = "zzz";');
  ok('  a search that finds nothing says so', /Nothing matches "zzz"\./.test(run('_srPickListHtml(__root)')));
  run('__inp.value = "client|CB-0001"; __root.attrs["data-q"] = "";');
  ok('  the chosen record is marked', /class="sr-pickopt on" role="option" aria-selected="true" data-pickval="client\|CB-0001"/.test(run('_srPickListHtml(__root)')));
  const btn = run('_srPickBtnInner(_srPickCurrent("client|CB-0001"))');
  ok('  and the button shows it with its kind', /<span class="sr-pickkind">Client<\/span><span class="sr-pickt">Philcement Corp\.<\/span>/.test(btn), btn);
  run('SR_UI.ix = __keepIx2; SR_UI.sent = __keepSent;');
  const SRC = fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8');
  ok('the call form, the line dialog and Add a link all use the picker (no long dropdown left)', (SRC.match(/_srPickerHtml\(/g) || []).length >= 4 && !/name="link" id="srCallLink"/.test(SRC) && !/_srLinkOptionsHtml/.test(SRC));
  const cl = run('(function () { var k = SR_UI.state; SR_UI.state = srBlank(); SR_UI.state.lines.push(srNewLine({ type: "Call", company: "Philcement Corp.", linkType: "client", linkId: "CB-0001", linkLabel: "Philcement Corp. (Quotation sent)" }, "Gerald Lucena", "2026-10-20T05:00:00.000Z")); var h = _srLogRows(); SR_UI.state = k; return h; })()');
  ok('  a line linked to a client opens that client in the Client Book', /<a href="director-client-book\.html\?client=CB-0001">Philcement Corp\. \(Quotation sent\)<\/a>/.test(cl), cl.slice(0, 600));
}
{
  /* A371 — Neil, 26 Oct: "add other tasks". */
  const ot = run(`(function () { var k = SR_UI.state; SR_UI.state = srBlank();
    SR_UI.state.lines.push(srNewLine({ type: "Other task", note: "Prepared the accreditation forms", company: "Philcement Corp.", result: "Done" }, "Gerald Lucena", "2026-10-20T05:00:00.000Z"));
    SR_UI.state.lines.push(srNewLine({ type: "Call", company: "Zeta Mining", result: "Reached" }, "Gerald Lucena", "2026-10-20T05:10:00.000Z"));
    var t = srMineTiles(IX, ME, "2026-10-20", SR_UI.state, 17 * 60).filter(function (x) { return x.key === "otherTasks"; })[0], h = _srLogRows(), lk = srLinked(SR_UI.state, "2026-10-20");
    SR_UI.state = k; return JSON.stringify({ t: t, h: h, lk: lk, type: SR_LINE_TYPES.indexOf("Other task") >= 0 }); })()`);
  const O = JSON.parse(ot);
  ok('A371: a rep can log an Other task; it is its own tile', O.type && O.t.label === 'Other tasks' && O.t.value === 1 && O.t.items[0].what === 'Prepared the accreditation forms', O.t);
  ok('  in the log, what was done comes first, the company under it, and it asks for no link', /<td>Other task<\/td><td><b>Prepared the accreditation forms<\/b><span class="sr-sub">Philcement Corp\.<\/span>/.test(O.h) && (O.h.match(/No link — add one/g) || []).length === 1, O.h.slice(0, 700));
  ok('  and it does not count against "lines with a link"', O.lk.total === 1);
  ok('  the log offers + Other task', /data-new="Other task">\+ Other task</.test(fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8')));
  const dlg = run(`(function () { var h = ''; var keep = _srDialog; _srDialog = function (t, s, inner) { h = t + '|' + inner; }; _srLineDialog("Other task", null, null); _srDialog = keep; return h; })()`);
  ok('  its form: what you did (required), and the company and result if any', /^Other task\|/.test(dlg) && /What you did \(one line\)<input type="text" class="sr-in" name="note" required/.test(dlg) && /Company \(if any\)<input type="text" class="sr-in" name="company" list="srBookCos" value="">/.test(dlg) && !/name="link"/.test(dlg), dlg.slice(0, 500));
}
const desk = run('_srVisitsHtml(srDayType(IX, ME, "2026-10-20", srBlank()))');
ok('a desk day: the slim card, no visit form', /none booked today/.test(desk) && /Log an unplanned visit/.test(desk) && !/srVisitForm/.test(desk));
const visit = run('SR_UI.day = "2026-10-22"; (function(){ var h = _srVisitsHtml(srDayType(IX, ME, "2026-10-22", srBlank())); SR_UI.day = "2026-10-20"; return h; })()');
ok('a visit day: the form, with the plan, recap email and result', /id="srVisitForm"/.test(visit) && /Plant A/.test(visit) && /Recap email/.test(visit) && /RFQ promised/.test(visit));
const pm = run('_srPmHtml(SR_UI.nums, {})');
ok('A349: no 8:00 huddle card, no plan line, no 8:00 chip', !/8:00|srAm|srPlan|giveam/.test(fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
ok('the 4:30 card: one line of blocker and Submit', /id="srBlocker"/.test(pm) && /Submit 4:30 report/.test(pm));
const pmDone = run('_srPmHtml(SR_UI.nums, { submittedAt: "2026-10-20T08:31:00.000Z", snapshot: __snap, report: { pm: { blocker: "no blocker" } } })');
ok('  once submitted: the submitted numbers, fixed, and no Submit', /Submitted 4:31 PM/.test(pmDone) && !/Submit 4:30 report/.test(pmDone) && /does not change them/.test(pmDone));
sec('8b · A363: the director reads a rep\'s own report; a rep keeps their own');
{
  const SRC = fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8');
  run('SR_UI.self = { name: "Neil Estur", username: "neil", first: "Neil" }; SR_UI.people = [{ name: "Gerald Lucena", username: "gerald" }, { name: "Kim Reyes", username: "kim" }];');
  run('_srPick("Kim Reyes", true)');
  ok('picking a rep reads their day (their name, their login), read only', run('SR_UI.me.name') === 'Kim Reyes' && run('SR_UI.me.username') === 'kim' && run('SR_UI.ro') === true);
  run('_srPick("", true)');
  ok('  "Me" goes back to the director\'s own trial day, which he can still type in', run('SR_UI.me.name') === 'Neil Estur' && run('SR_UI.ro') === false);
  run('SR_UI.me = ME; SR_UI.ro = true; SR_UI.nums = _srNums();');
  const roFu = run('SR_UI.nums.fu.map(_srFuHtml).join("")'), roLog = run('_srLogRows()');
  ok('read only: follow-ups show "Not yet" instead of Log call', /Called ✓ — Reached/.test(roFu) && /Not yet/.test(roFu) && !/data-logcall/.test(roFu));
  ok('  their lines show, with no add-link, edit or void', /No link/.test(roLog) && !/data-addlink|data-edit|data-void/.test(roLog));
  const roDesk = run('_srVisitsHtml(srDayType(IX, ME, "2026-10-20", srBlank()))');
  ok('  visits: the list only, no form and no "unplanned visit" button', /A desk day — no visit booked or logged/.test(roDesk) && !/data-unplanned|srVisitForm/.test(roDesk));
  const roPm = run('_srPmHtml(SR_UI.nums, {})');
  ok('  the 4:30 card says it is not in yet, with no blocker field and no Submit', /Not submitted yet/.test(roPm) && !/srBlocker|data-submitpm/.test(roPm));
  run('SR_UI.unsaved = false; _srSave();');
  ok('  and saving does nothing at all', run('SR_UI.unsaved') === false);
  run('SR_UI.ro = false;');
  ok('the head carries "Whose report" for the director (Me first), a Read only chip, and no picker on a rep\'s own page',
     /<option value="">Me \(my trial\)<\/option>/.test(SRC) && /id="srWho" aria-label="Whose report to read"/.test(SRC) && /SR_UI\.own \|\| !SR_UI\.people\.length \? ''/.test(SRC) && /<span class="sr-chip">Read only<\/span>/.test(SRC));
  ok('  the director reads their sent mail by their login; their received mail stays theirs', /apiFetchEmailLogToday\(SR_UI\.ro \? SR_UI\.me\.username : undefined, day\)/.test(SRC) && /if \(SR_UI\.ro\) receivedState = 'private';/.test(SRC) &&
     /received mail stays private to/.test(SRC));
  ok('  a click that would write is ignored while reading (only the records, the filters and the week answer)', /if \(SR_UI\.ro && !b\.hasAttribute\('data-rec'\) && !b\.hasAttribute\('data-feed'\) && !b\.hasAttribute\('data-week'\)\) return;/.test(SRC));
  ok('a rep\'s own page: "My daily report", in their own words, needing FlowAPI 184', /SR_UI\.own \? 'My daily report'/.test(SRC) && /Your new daily report\. Only you and the director see it, and your old daily report still works as before\./.test(SRC) &&
     /SR_UI\.own \? '184' : '177'/.test(SRC));
}
{
  const SRC = fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8') + fs.readFileSync(path.join(DASH, 'sales-report-model.js'), 'utf8');
  const posts = Array.from(new Set((SRC.match(/postFlow\('(\w+)'/g) || []).map(x => x.slice(10, -1)))).sort();
  eq('the only writes and private reads are the trial\'s own (A350: and the Client Book, A369: the client visits, read only)', posts, ['getClientBook', 'getProofReports', 'getVisitPlans', 'saveProofReport', 'submitProofReport']);
  ok('  nothing touches the real call log, visits or quotations', !/logSalesCall|logClientVisit|closeQuotation|deleteSalesCall/.test(SRC));
  ok('no emoji, no hex colour, no inline style', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{6}\b/.test(SRC) && !/style="/.test(SRC));
  ok('no location is asked for', !/geolocation|latitude|longitude/i.test(SRC));
}

(async () => {
  sec('8c · A366: one person\'s report on the team daily reports page (management reads it, read only)');
  run(`var __loads = [], __opens = [], __usersReads = 0, __posts = [], __reads = [], __mailUsers = [];
    var __realLoad = _srLoad, __realOpen = _srOpenDay;
    _srLoad = function () { __loads.push(SR_UI.me.name + '@' + SR_UI.day); return Promise.resolve(); };
    _srOpenDay = function (d) { __opens.push(SR_UI.me.name + '@' + d); SR_UI.day = d; };
    apiGetUsers = function () { __usersReads++; return Promise.resolve({ data: [{ fullName: 'Kim Reyes', username: 'kim', role: 'sales' }] }); };
    getSession = function () { return { name: 'Mara Manager', username: 'mara', role: 'management' }; };
    localStorage.setItem = function () { throw new Error('nothing is kept on this computer'); };
    localStorage.getItem = function (k) { return k === 'hx_sr_person' ? 'Kim Reyes' : null; };
    var __els = { proof: {} }, __gid = document.getElementById; document.getElementById = function (id) { return __els[id] || null; };`);
  await run('salesReport("proof", { view: { name: "Gerald Lucena", username: "gerald", day: "2026-10-20" } })');
  ok('fixed to the person and the page\'s day, read only: no roster read, no person kept or recalled, no picker', run('SR_UI.view') === true && run('SR_UI.ro') === true && run('SR_UI.own') === false &&
     run('SR_UI.me.name') === 'Gerald Lucena' && run('SR_UI.me.username') === 'gerald' && run('SR_UI.day') === '2026-10-20' && run('SR_UI.selfRole') === 'management' &&
     run('SR_UI.people.length') === 0 && run('__usersReads') === 0 && run('__loads.join()') === 'Gerald Lucena@2026-10-20');
  run('SR_UI.ix = IX; SR_UI.weekEmails = { "2026-10-19": [] }; SR_UI.weekOffset = -1;');
  await run('salesReportShow({ name: "Gerald Lucena", username: "gerald" }, "2026-10-19")');
  ok('the same person on another day: only the day moves, nothing read again', run('__opens.join()') === 'Gerald Lucena@2026-10-19' && run('__loads.length') === 1);
  await run('salesReportShow({ name: "Kim Reyes", username: "kim" }, "2026-10-21")');
  ok('another person: theirs, on that day, with the week\'s mail and the week cleared', run('SR_UI.me.name') === 'Kim Reyes' && run('SR_UI.me.username') === 'kim' && run('SR_UI.day') === '2026-10-21' &&
     run('Object.keys(SR_UI.weekEmails).length') === 0 && run('SR_UI.weekOffset') === 0 && run('SR_UI.ro') === true && run('__loads.join()') === 'Gerald Lucena@2026-10-20,Kim Reyes@2026-10-21');
  run(`_srLoad = __realLoad;
    fetchFlow = function (a, p) { __reads.push(a); return Promise.resolve({ success: true, data: [] }); };
    postFlow = function (a, p) { __posts.push({ a: a, p: p }); return Promise.resolve({ success: true, data: [{ date: '2026-10-21', user: 'Kim Reyes', report: { v: 2, lines: [] } }, { date: '2026-10-21', user: 'Gerald Lucena', report: { v: 2, lines: [] } }] }); };`);
  await run('_srLoad(false)');
  ok('its saved days are asked for by the person\'s name, and only theirs are kept', JSON.stringify(run('__posts.filter(function (x) { return x.a === "getProofReports"; }).map(function (x) { return x.p.user; })')) === JSON.stringify(['Kim Reyes']) &&
     run('Object.keys(SR_UI.saved).join()') === '2026-10-21' && run('SR_UI.saved["2026-10-21"].user') === 'Kim Reyes');
  ok('  management does not read the Client Book (it stays its owner\'s and the director\'s)', !run('__posts.some(function (x) { return x.a === "getClientBook"; })'));
  run('getSession = function () { return { name: "Neil Estur", username: "neil", role: "director" }; }; SR_UI.selfRole = "director"; __posts = [];');
  await run('_srLoad(false)');
  ok('  the director, reading the same page, still sees their Client Book items', run('__posts.some(function (x) { return x.a === "getClientBook"; })'));
  run('SR_UI.selfRole = "management"; __posts = []; __opens = [];');
  const l1 = run('_srLoad(false)');
  run('SR_UI.me = { name: "Gerald Lucena", username: "gerald", first: "Gerald" };');
  const l2 = run('_srLoad(false)');
  await Promise.all([l1, l2]);
  ok('  two quick clicks: the earlier load is dropped, only the later person\'s day opens', run('__opens.join()') === 'Gerald Lucena@2026-10-21');
  run('SR_UI.ix = IX; SR_UI.state = srBlank(); SR_UI.nums = _srNums(); SR_UI.sent = []; SR_UI.received = []; SR_UI.saved = {}; SR_UI.failed = []; SR_UI.backend = true;');
  const head = { innerHTML: '' }, body = { innerHTML: '' };
  C.__els.srHead = head; C.__els.srBody = body;
  try { run('_srRenderDay()'); } catch (e) { /* the parts after the head need a real page */ }
  ok('  the head: Read only, their name and the day, no "Whose report" and no day picker (the page owns the date)', /<span class="sr-chip">Read only<\/span>/.test(head.innerHTML) && /<span class="sr-who">Wednesday 21 Oct<\/span>/.test(head.innerHTML) &&
     !/srWho|id="srDate"|data-step/.test(head.innerHTML), head.innerHTML.slice(0, 600));
  ok('  the note: their received mail and their Client Book stay private', /received mail and Client Book stay private to them/.test(body.innerHTML), body.innerHTML.slice(0, 400));
  run('SR_UI.backend = false;');
  try { run('_srRenderDay()'); } catch (e) { /* as above */ }
  ok('  before FlowAPI 185 it says so', /version 185\) before they can be read here/.test(body.innerHTML));
  run('document.getElementById = __gid; _srOpenDay = __realOpen; SR_UI.unsaved = false; _srSave();');
  ok('  and saving does nothing at all', !run('__posts.some(function (x) { return x.a === "saveProofReport" || x.a === "submitProofReport"; })'));
  {
    const SRC = fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8');
    ok('  sent mail is read with the person\'s login, and a late answer for another person or day is dropped', /apiFetchEmailLogToday\(SR_UI\.ro \? SR_UI\.me\.username : undefined, day\)/.test(SRC) &&
       /same = \(\) => SR_UI\.day === day && SR_UI\.me\.name === who/.test(SRC) && /if \(SR_UI\.me\.name !== who\) break;/.test(SRC));
  }

  console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
