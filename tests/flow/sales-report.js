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
eq('row B in the prompt\'s order', mine('REP').map(x => x.key), ['calls', 'followUps', 'booked', 'visits']);
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
const keepLink = run('_srLinkOptionsHtml("dr|DR-0207", "DR-0207")');
ok('editing a line keeps its own link on offer, chosen, even when it is not in today\'s lists (a DR number)', /<option value="dr\|DR-0207" selected>Keep: DR-0207<\/option>/.test(keepLink), keepLink.slice(0, 200));
const desk = run('_srVisitsHtml(srDayType(IX, ME, "2026-10-20", srBlank()))');
ok('a desk day: the slim card, no visit form', /none booked today/.test(desk) && /Log an unplanned visit/.test(desk) && !/srVisitForm/.test(desk));
const visit = run('SR_UI.day = "2026-10-22"; (function(){ var h = _srVisitsHtml(srDayType(IX, ME, "2026-10-22", srBlank())); SR_UI.day = "2026-10-20"; return h; })()');
ok('a visit day: the form, with the plan, recap email and result', /id="srVisitForm"/.test(visit) && /Plant A/.test(visit) && /Recap email/.test(visit) && /RFQ promised/.test(visit));
const am = run('_srAmHtml(SR_UI.nums)'), pm = run('_srPmHtml(SR_UI.nums, {})');
ok('the 8:00 card: due, its four numbers, one line of plan', /Due/.test(am) && /Follow-ups due/.test(am) && /RFQs waiting for specs/.test(am) && /id="srPlan"/.test(am) && /Give 8:00 report/.test(am));
ok('the 4:30 card: one line of blocker and Submit', /id="srBlocker"/.test(pm) && /Submit 4:30 report/.test(pm));
const pmDone = run('_srPmHtml(SR_UI.nums, { submittedAt: "2026-10-20T08:31:00.000Z", snapshot: __snap, report: { pm: { blocker: "no blocker" } } })');
ok('  once submitted: the submitted numbers, fixed, and no Submit', /Submitted 4:31 PM/.test(pmDone) && !/Submit 4:30 report/.test(pmDone) && /does not change them/.test(pmDone));
{
  const SRC = fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8') + fs.readFileSync(path.join(DASH, 'sales-report-model.js'), 'utf8');
  const posts = Array.from(new Set((SRC.match(/postFlow\('(\w+)'/g) || []).map(x => x.slice(10, -1)))).sort();
  eq('the only writes and private reads are the trial\'s own', posts, ['getProofReports', 'saveProofReport', 'submitProofReport']);
  ok('  nothing touches the real call log, visits or quotations', !/logSalesCall|logClientVisit|closeQuotation|deleteSalesCall/.test(SRC));
  ok('no emoji, no hex colour, no inline style', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{6}\b/.test(SRC) && !/style="/.test(SRC));
  ok('no location is asked for', !/geolocation|latitude|longitude/i.test(SRC));
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
