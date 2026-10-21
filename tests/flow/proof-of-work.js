/* A347 — the Sales proof of work (js/proof-of-work-model.js + js/proof-of-work.js, first on director-home).
 *
 * Run:  node tests/flow/proof-of-work.js
 *
 * One small world, built so every number has an answer worked out by hand: Gerald on Tuesday 20 Oct 2026 (a field
 * day), today being Wednesday 21 Oct. The model runs on the real flow-api.js and itinerary-week.js in one vm context,
 * as the page does, so the shared rules (owner, net value, follow-up clock, company match) are the real ones.
 *
 *   1 · times, money, targets
 *   2 · the 8:00 numbers        booked / follow-ups due (and the overdue kept apart) / not recorded / open quotes
 *   3 · the day                 what the rep logged, what the portal logged by itself, the sent mail folded in
 *   4 · the 4:30 numbers        visits / RFQs / quotes sent (estimated stamps never) / follow-ups done
 *   5 · the week                Mon–Fri cells, 48 h, sales orders matched (and the unmatched listed), slots
 *   6 · what the person would say at the huddle, from what they typed, and the week's reading
 *   7 · flowFollowUp's new asOf changes nothing when it is not passed
 *   8 · the form: a saved report laid over a blank one, the lines it draws, the Friday sums, the records behind a grey line
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DASH = path.resolve(__dirname, '../../dashboard/js');
let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

function load(today) {
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    navigator: { userAgent: 'node' }, location: { href: '', pathname: '/' }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  require('./hxutil').load(ctx);
  ['flow-api.js', 'itinerary-week.js', 'proof-of-work-model.js', 'proof-of-work.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(DASH, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext('flowToday = function () { return ' + JSON.stringify(today) + '; };', ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

/* ── the world ─────────────────────────────────────────────────────────────────────────────── */
const G = 'Gerald Lucena', K = 'Kimberlyn Blones';
const q = (no, owner, o) => Object.assign({ quotationNo: no, salesperson: owner, createdBy: owner, status: 'Sent', total: 0, discountPct: 0, customer: '', sentAt: '', sentAtBasis: '', items: [] }, o);
const RAW = {
  today: '2026-10-21',
  roster: [{ fullName: G, username: 'gerald', role: 'sales' }, { fullName: K, username: 'kim', role: 'sales' }, { fullName: 'Crystal Gayle', username: 'gayle', role: 'admin' }],
  settings: { quotationFollowUpDays: 7, powVisitsDay: '2', powJunk: 'x' },
  itineraries: [
    { itineraryNo: 'ITIN-1', weekStart: '2026-10-19', user: G, status: 'Pending Director', items: [
      { seq: 1, date: '2026-10-20', plannedTime: '10:00', company: 'Plant A Corp', personToMeet: 'R. Cruz', purpose: 'Client Visit' },
      { seq: 2, date: '2026-10-20', plannedTime: '14:00', company: 'Plant B', personToMeet: '', purpose: 'Client Visit' }] },
    { itineraryNo: 'ITIN-2', weekStart: '2026-10-19', user: K, status: 'Draft', items: [
      { seq: 1, date: '2026-10-20', plannedTime: '09:30', company: 'Draft Plant', purpose: 'Client Visit' }] },
    { itineraryNo: 'ITIN-3', weekStart: '2026-10-26', user: G, status: 'Pending Director', items: [1, 2, 3, 4, 5, 6].map(i =>
      ({ seq: i, date: '2026-10-2' + (6 + (i % 3)), plannedTime: '10:00', company: 'Next Plant ' + i, purpose: 'Client Visit' })) }
  ],
  leads: [{ leadNo: 'LEAD-1', handedTo: 'kim', presentationDate: '2026-10-20', company: 'Sample Power Plant H', contactName: 'M. Head', status: 'Presentation Booked' }],
  quotations: [
    q('Q-1', G, { customer: 'Plant A Corp', total: 1000000, sentAt: '2026-10-10T02:00:00.000Z' }),          // due 19th and 20th: carried
    q('Q-2', G, { customer: 'Plant B', total: 500000, discountPct: 10, sentAt: '2026-10-12T02:00:00.000Z' }), // due, called on the 20th
    q('Q-3', G, { customer: 'Old Mine', total: 2000000, sentAt: '2026-09-01T02:00:00.000Z' }),               // overdue, kept apart
    q('Q-4', G, { customer: 'Plant C', total: 300000, sentAt: '2026-10-20T03:00:00.000Z', prNo: 'PR-1' }),   // sent on the 20th, 25 h from its PR
    q('Q-5', G, { customer: 'Plant D', total: 100000, sentAt: '2026-10-20', sentAtBasis: 'Estimated from approval' }),
    q('Q-6', G, { customer: 'Lost Co', total: 900000, status: 'Lost', sentAt: '2026-10-01T02:00:00.000Z' }),
    q('Q-7', G, { customer: 'Won Co', total: 700000, sentAt: '2026-10-01T02:00:00.000Z' }),                  // has a sales order
    q('DEMO-Q-1', G, { customer: 'Demo', total: 9e6, sentAt: '2026-10-19T02:00:00.000Z' }),
    q('Q-9', K, { customer: 'Kim Client', total: 200000, sentAt: '2026-10-15T02:00:00.000Z' }),
    q('Q-10', 'Crystal Gayle', { customer: 'Admin Client', total: 5e6, sentAt: '2026-10-19T02:00:00.000Z' }),
    q('Q-11', G, { customer: 'Draft Co', total: 50000, status: 'Draft' })
  ],
  salesOrders: [
    { soNo: 'SO-1', quotationNo: 'Q-7', date: '2026-10-05', customer: 'Won Co', total: 700000 },
    { soNo: 'SO-2', quotationNo: '', date: '2026-10-15', customer: 'Plant A Corporation', total: 250000 },   // by client: Q-1 sent 10th
    { soNo: 'SO-3', quotationNo: '', date: '2026-10-16', customer: 'Unknown Ltd', total: 80000 },
    { soNo: 'DEMO-SO-1', quotationNo: '', date: '2026-10-16', customer: 'Plant A Corp', total: 5e6 },
    { soNo: 'SO-5', quotationNo: 'Q-7', date: '2026-09-30', customer: 'Won Co', total: 400000 }
  ],
  quotationEmails: [{ quotationNo: 'Q-4', kind: 'Initial', sentAt: '2026-10-20T03:00:00+08:00', status: 'Active', subject: 'Quotation Q-4' }],
  prs: [
    { prNo: 'PR-1', customer: 'Plant C', salesperson: G, requestedBy: G, status: 'Quoted', date: '2026-10-19' },
    { prNo: 'PR-2', customer: 'Plant E', salesperson: G, requestedBy: 'Crystal Gayle', status: 'Requested', date: '2026-10-20' },
    { prNo: 'PR-3', customer: 'Website Client', salesperson: 'Admin', requestedBy: 'Website (hiescorp.com)', status: 'Requested', date: '2026-10-20' }
  ],
  activity: [
    { timestamp: '2026-10-19T02:00:00.000Z', date: '2026-10-19', user: G, module: 'Pricing Request', action: 'Created', refNo: 'PR-1', summary: 'Purchase request submitted to admin.' },
    { timestamp: '2026-10-20T01:00:00.000Z', date: '2026-10-20', user: 'Crystal Gayle', module: 'Pricing Request', action: 'Created', refNo: 'PR-2', summary: 'Purchase request submitted to admin.' },
    { timestamp: '2026-10-20T05:00:00.000Z', date: '2026-10-20', user: 'Website', module: 'Pricing Request', action: 'Created', refNo: 'PR-3', summary: 'From the website.' },
    { timestamp: '2026-10-20T02:50:00.000Z', date: '2026-10-20', user: G, module: 'Quotation', action: 'Created', refNo: 'Q-4', summary: 'Quotation created.', amount: 300000 },
    { timestamp: '2026-10-20T03:00:00.000Z', date: '2026-10-20', user: G, module: 'Quotation', action: 'Sent', refNo: 'Q-4', summary: 'Quotation marked as sent to client.' },
    { timestamp: '2026-10-20T02:30:00.000Z', date: '2026-10-20', user: G, module: 'Call', action: 'Logged', refNo: 'Plant B Inc', summary: 'Call logged.' },
    { timestamp: '2026-10-21T01:00:00.000Z', date: '2026-10-21', user: G, module: 'Quotation', action: 'Follow-up Set', refNo: 'Q-1', summary: 'Follow-up set.' }
  ],
  calls: [
    { callNo: 'CALL-1', date: '2026-10-20', user: G, contact: 'R. Cruz', company: 'Plant B Inc', outcome: 'Connected', notes: 'Decision on 3 Nov', createdAt: '2026-10-20T02:30:00.000Z' },
    { callNo: 'CALL-2', date: '2026-10-20', user: G, contact: 'Buyer', company: 'Random Co', outcome: 'No answer', notes: '', createdAt: '2026-10-20T07:00:00.000Z' }
  ],
  visits: [
    { visitNo: 'VISIT-1', date: '2026-10-20', user: G, time: '1899-12-30T06:00:00.000Z', personVisited: 'R. Cruz', company: 'Plant A Corp', agenda: 'Torque tools',
      summaryOfAgenda: 'RFQ promised 29 Oct', photoDocId: 'DOC-1', itineraryItem: 'ITIN-1#1', createdAt: '2026-10-20T07:10:00.000Z' }
  ],
  reports: [{ reportNo: 'DR-202610-001', date: '2026-10-20', user: G, highlights: 'Two visits', blockers: 'NA', plan: 'Visit Plant C.', submittedAt: '2026-10-20T09:00:00.000Z' }]
};

const C = load('2026-10-21');
C.__raw = RAW;
run(C, 'var IX = powIndex(__raw), REPS = powReps(IX), GR = REPS.find(r => r.first === "Gerald"), KR = REPS.find(r => r.first === "Kimberlyn");');
const pick = (list, key) => list.find(n => n.key === key);

sec('1 · times, money, targets');
eq('a Sheets time cell reads in Manila', run(C, 'powClock("1899-12-30T06:00:00.000Z")'), '2:00 PM');
eq('an ISO timestamp reads in Manila', run(C, 'powClock("2026-10-20T02:30:00.000Z")'), '10:30 AM');
eq('a typed HH:mm', run(C, 'powClock("14:05")'), '2:05 PM');
eq('no time in it gives nothing', run(C, 'powClock("2026-10-20")'), '');
eq('money under a million', run(C, 'powMoney(186400)'), '₱186,400');
eq('money in millions', run(C, '[powMoney(3850000), powMoney(4500000), powMoney(1e6)]'), ['₱3.85M', '₱4.5M', '₱1M']);
eq('the pack\'s targets, a FlowSettings row laid over them, junk ignored', run(C, 'JSON.stringify([powCfg({ powVisitsDay: "3", powOpenQuotes: "x" }).powVisitsDay, powCfg({ powOpenQuotes: "x" }).powOpenQuotes])'), '[3,4500000]');
eq('field days are Mon to Wed', run(C, '["2026-10-19","2026-10-21","2026-10-22","2026-10-23"].map(d => powIsFieldDay(d, IX.cfg))'), [true, true, false, false]);
eq('the reps are the sales logins, not admin', run(C, 'REPS.map(r => r.name)'), [G, K]);

sec('2 · the 8:00 numbers (Gerald, Tue 20 Oct)');
C.__m = run(C, 'powMorning(IX, GR, "2026-10-20")');
const M = C.__m;
eq('four numbers in the sample\'s order', M.map(n => n.key), ['booked', 'followDue', 'rfqWaiting', 'openQuotes']);
const booked = pick(M, 'booked');
eq('booked: both stops of the submitted plan', [booked.value, booked.status, booked.items.map(i => i.client)], [2, 'ok', ['Plant A Corp', 'Plant B']]);
const due = pick(M, 'followDue');
eq('follow-ups due: Q-1 and Q-2 (7 to 13 days), not Q-3 (overdue), Q-4/Q-5 (just sent), Q-9 (Kim\'s)', [due.value, due.items.filter(i => !i.overdue).map(i => i.ref)], [2, ['Q-1', 'Q-2']]);
ok('  red: both were already due on Monday and still are', due.status === 'red' && due.items.filter(i => i.carried).length === 2);
ok('  the overdue one is listed after them, not counted, and named on the tile', due.items.some(i => i.ref === 'Q-3' && i.overdue) && /^1 more overdue/.test(due.extra) && /₱2M/.test(due.note));
const nr = pick(M, 'rfqWaiting');
ok('RFQs waiting for specs says "not recorded yet" and why, never a number', nr.status === 'nr' && nr.value === null && /waiting for specs/.test(nr.notRecorded));
const open = pick(M, 'openQuotes');
eq('open quotations: Q-1 + Q-2 net of 10% + Q-3 + Q-4 + Q-5, no lost, won, draft, demo or other rep', [open.value, open.status, open.items.length], [3850000, 'watch', 5]);
ok('  biggest first', open.items[0].ref === 'Q-3');
{
  const nonField = run(C, 'powMorning(IX, GR, "2026-10-22")');
  eq('Thursday has no visit target', [pick(nonField, 'booked').status, pick(nonField, 'booked').target], ['none', 'not a field day']);
  const kim = run(C, 'powMorning(IX, KR, "2026-10-20")');
  const kb = pick(kim, 'booked');
  eq('Kim: the Lead Gen presentation counts (by username), the stop in a draft plan is listed but not', [kb.value, kb.items.length, kb.items.filter(i => i.counted).map(i => i.client)], [1, 2, ['Sample Power Plant H']]);
}

sec('3 · the day: what Gerald logged, what the portal logged');
const LOG = run(C, 'powLog(IX, GR, "2026-10-20")');
eq('calls and visits, in time order', LOG.map(l => [l.time, l.type, l.ref]), [['10:30 AM', 'Call', 'CALL-1'], ['2:00 PM', 'Visit', 'VISIT-1'], ['3:00 PM', 'Call', 'CALL-2']]);
ok('  the visit carries its photo and its plan stop', LOG[1].photo === 'DOC-1' && LOG[1].plan === 'ITIN-1#1' && LOG[1].result === 'RFQ promised 29 Oct');
const AUTO = run(C, 'powAuto(IX, GR, "2026-10-20")');
eq('the portal\'s own lines: the quotation created and sent — not the typed call, not other days', AUTO.map(a => [a.time, a.kind, a.ref]), [['10:50 AM', 'Quotation created', 'Q-4'], ['11:00 AM', 'Quotation sent', 'Q-4']]);
C.__mail = [{ subject: 'Visit recap', name: 'R. Cruz', sentAt: '2026-10-20T10:58:00+08:00' }];
eq('sent mail folds in by time', run(C, 'powWithEmails(powAuto(IX, GR, "2026-10-20"), __mail).map(a => a.time + " " + a.kind)'), ['10:50 AM Quotation created', '10:58 AM Email out', '11:00 AM Quotation sent']);

sec('4 · the 4:30 numbers');
C.__e = run(C, 'powEvening(IX, GR, "2026-10-20", 17 * 60)');
const E = C.__e;
eq('four numbers in the sample\'s order', E.map(n => n.key), ['visitsDone', 'rfqs', 'quotesSent', 'followDone']);
eq('visits done: 1 of 2 on a field day', [pick(E, 'visitsDone').value, pick(E, 'visitsDone').status, pick(E, 'visitsDone').source], [1, 'watch', 'MY LOG']);
eq('RFQs received: PR-2 (made by admin, owned by Gerald); not PR-3 (website, Admin\'s)', pick(E, 'rfqs').items.map(i => i.ref), ['PR-2']);
eq('quotes sent: Q-4 only — Q-5\'s stamp is an estimate', [pick(E, 'quotesSent').items.map(i => i.ref), pick(E, 'quotesSent').text], [['Q-4'], '1 · ₱300,000']);
const fd = pick(E, 'followDone');
eq('follow-ups done: Q-2 by the call to "Plant B Inc"; Q-1 not', [fd.text, fd.status, fd.items.filter(i => i.done).map(i => i.ref)], ['1 of 2', 'red', ['Q-2']]);
{ const q2 = fd.items.find(i => i.ref === 'Q-2'); ok('  the proof is the call itself', !!q2 && q2.proof.length > 0 && q2.proof[0].ref === 'CALL-1'); }
ok('  today before 4:30 it is "watch", not red', run(C, 'powEvening(IX, GR, "2026-10-21", 15 * 60).find(n => n.key === "followDone").status') !== 'red');
ok('  a follow-up set the next day does not count for the 20th', !fd.items.find(i => i.ref === 'Q-1').done);

sec('5 · the week (Mon 19 to Fri 23 Oct, read on Tue 20)');
C.__w = run(C, 'powWeek(IX, GR, "2026-10-20", 17 * 60)');
const W = C.__w;
eq('ten lines in the pack\'s order', W.rows.map(r => r.key), ['visits', 'rfqs', 'prsReturned', 'quotes', 'within48', 'follow', 'perfCalls', 'soMonth', 'open', 'slots']);
eq('Mon to Fri', W.days, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
eq('visits: Mon 0, Tue 1, the rest not yet', pick(W.rows, 'visits').cells, ['0', '1', '', '', '']);
eq('RFQs: PR-1 on Monday (Gerald\'s), PR-2 on Tuesday', [pick(W.rows, 'rfqs').cells.slice(0, 2), pick(W.rows, 'rfqs').value], [['1', '1'], 2]);
const w48 = pick(W.rows, 'within48');
eq('quotes within 48 h: Q-4, 25 h from PR-1', [w48.text, w48.status, w48.items[0].what], ['1 of 1', 'ok', '25 h from PR-1']);
const so = pick(W.rows, 'soMonth');
eq('sales orders this month: SO-1 by its quotation, SO-2 by the client (Q-1 sent before it); not September, not demo', [so.items.map(i => i.ref), so.value], [['SO-1', 'SO-2'], 950000]);
ok('  under the pace (₱1.5M × 20/31) is "watch"', so.status === 'watch' && Math.abs(W.pace - 1500000 * 20 / 31) < 0.01);
eq('  the order no rep reaches is listed, not dropped', so.unmatched.map(i => i.ref), ['SO-3']);
eq('slots for next week: 6 of 6 from the submitted plan', [pick(W.rows, 'slots').text, pick(W.rows, 'slots').status], ['6 of 6', 'ok']);
ok('PRs returned and performance calls say "not recorded yet"', ['prsReturned', 'perfCalls'].every(k => pick(W.rows, k).status === 'nr'));
eq('follow-ups for the week add the days (the pack sums the daily lines)', [pick(W.rows, 'follow').cells.slice(0, 2), pick(W.rows, 'follow').text], [['0 of 2', '1 of 2'], '1 of 4']);

sec('6 · what Gerald would say at the huddle');
eq('the 8:00 script: what he typed, the portal\'s numbers, his blocker', run(C, 'powSaysMorning(__m, IX.cfg, { booked: "2", plan: "Plant A at 10:00, Plant B at 2:00.", blocker: "Plant B has not sent the gate pass" })'),
   'Booked today: 2. Follow-ups due: 2. RFQs waiting for specs: not recorded yet. Open quotes: ₱3.85M — below ₱4.5M. Today: Plant A at 10:00, Plant B at 2:00. Blocker: Plant B has not sent the gate pass.');
eq('  nothing typed yet: the plan\'s stops stand in, and no blocker reads as none', run(C, 'powSaysMorning(__m, IX.cfg, {})'),
   'Booked today: 2. Follow-ups due: 2. RFQs waiting for specs: not recorded yet. Open quotes: ₱3.85M — below ₱4.5M. Blocker: none.');
eq('the 4:30 script: his numbers where he typed them, the portal\'s where it fills them', run(C, 'powSaysEvening(__e, { visits: "2", follow: "3 of 3", carry: "Plant A\'s PR waits for the cylinder stroke" })'),
   'Visits: 2. RFQs: 1 — PR-2, Plant E. Quotes sent: 1, worth ₱300,000. Follow-ups: 3 of 3. Carries over: Plant A\'s PR waits for the cylinder stroke.');
const reading = run(C, 'powReading(GR, __w, IX)');
ok('the week\'s reading names what is off and where the focus goes', /Visits \/ presentations done 1 against 6 a week/.test(reading) && /under the ₱1.5M pace/.test(reading) && /focus next week/.test(reading), reading);

sec('7 · flowFollowUp: the new asOf changes nothing when it is not passed');
{
  const hasSO = { 'Q-7': true }, cfg = { quotationFollowUpDays: 7 };
  const same = RAW.quotations.every(x => {
    C.__x = x; C.__h = hasSO; C.__c = cfg;
    return run(C, 'JSON.stringify(flowFollowUp(__x, [], __c, __h))') === run(C, 'JSON.stringify(flowFollowUp(__x, [], __c, __h, undefined))') &&
           run(C, 'JSON.stringify(flowFollowUp(__x, [], __c, __h))') === run(C, 'JSON.stringify(flowFollowUp(__x, [], __c, __h, flowToday()))');
  });
  ok('every quotation: no asOf = asOf undefined = asOf today', same);
  eq('asOf moves the clock: Q-1 is 4 days old on the 14th, 11 on the 21st', [run(C, 'flowFollowUp(__raw.quotations[0], [], {}, {}, "2026-10-14").state'), run(C, 'flowFollowUp(__raw.quotations[0], [], {}, {}).days')], ['ok', 11]);
}

sec('8 · the form');
run(C, 'POW_UI.ix = IX; POW_UI.me = GR; POW_UI.day = "2026-10-20"; POW_UI.saved = {}; POW_UI.nums = _powNums();');
{
  const blank = run(C, 'JSON.stringify(_powFill(null))');
  ok('a new day starts blank, every field present', /"huddle":\{"booked":\{"n":"","proof":""\},"plan":"","blocker":""\}/.test(blank) && /"log":\[\]/.test(blank) && /"slots":\{"n":"","proof":""\}/.test(blank), blank);
  const old = run(C, 'JSON.stringify(_powFill({ huddle: { booked: { n: 2 } }, log: [{ time: "10:15", type: "Visit", what: "Plant A", junk: 1 }], extra: "x" }))');
  ok('  a saved report is laid over it: its values kept as text, unknown keys dropped, log lines cleaned', /"booked":\{"n":"2","proof":""\}/.test(old) && /"log":\[\{"time":"10:15","type":"Visit","what":"Plant A","result":"","ref":""\}\]/.test(old) && !/extra|junk/.test(old), old);
  run(C, 'POW_UI.state = _powFill({ huddle: { booked: { n: "2", proof: "Plant A <accepted>" } }, log: [{ time: "10:15", type: "Performance call", what: "Plant E", result: "OK", ref: "DR-0207" }], eod: { visits: { n: "1" }, follow: { n: "1 of 2" } } });');
  const sheet = run(C, '_powSheet([_powRowYou("Visits / presentations booked today", "huddle.booked", "proof", "hint", "booked"), _powRowPortal(POW_UI.nums.m[1], "Portal → Pipeline"), _powRowPortal(POW_UI.nums.m[2], "Portal → PR list")])');
  ok('the 8:00 sheet has the pack\'s columns', /<th scope="col">Number<\/th><th scope="col">Today<\/th><th scope="col">Proof — the reference<\/th><th scope="col">Who fills it<\/th>/.test(sheet));
  ok('  his line is inputs, filled from the report and escaped', /data-k="huddle\.booked\.n" value="2"/.test(sheet) && /value="Plant A &lt;accepted&gt;"/.test(sheet) && /<td class="who">You<\/td>/.test(sheet));
  ok('  a grey line is the portal\'s number, a button that opens its records', /<tr class="grey"><th scope="row">Follow-ups due today/.test(sheet) && /<button type="button" class="dh-pow-grey" data-rec="followDue">2<\/button>/.test(sheet) && /<td class="who">Portal<\/td>/.test(sheet));
  ok('  a number the portal cannot prove says so, with no button', /not recorded yet/.test(sheet) && !/data-rec="rfqWaiting"/.test(sheet));
  const log = run(C, '_powLogRows()');
  ok('the day\'s log: the calls and visit already in the portal, grey, then his typed lines as inputs', (log.match(/logged in the portal/g) || []).length === 3 && /data-li="0" data-f="ref" value="DR-0207"/.test(log) && /<option selected>Performance call<\/option>/.test(log));
  ok('  each typed line can be removed', /data-rmline="0"/.test(log));
  const sums = run(C, 'JSON.stringify(_powWeekSums())');
  eq('the Friday sums add his daily lines (today\'s from the form)', JSON.parse(sums), { visits: 1, followDone: 1, followDue: 2, perf: 1, days: 1 });
  run(C, 'POW_UI.saved["2026-10-19"] = { report: { eod: { visits: { n: "2" }, follow: { n: "3 of 3" } }, log: [] } };');
  eq('  and the saved days of the week', JSON.parse(run(C, 'JSON.stringify(_powWeekSums())')), { visits: 3, followDone: 4, followDue: 5, perf: 1, days: 2 });
  const week = run(C, '_powWeekRows()');
  ok('the Friday lines: ten, his sums and the portal\'s numbers, the slots typed', (week.match(/<tr/g) || []).length === 10 && /Sum of your daily lines/.test(week) &&
     /data-rec="w:quotes"/.test(week) && /Accounting matches/.test(week) && /data-k="week\.slots\.n"/.test(week));
  const rec = run(C, '_powRecords(POW_UI.nums.m[1])');
  ok('the records behind a grey line: each quotation linked to its page, the overdue ones marked', /href="flow-quotations\.html\?review=Q-1"/.test(rec) && /overdue, not counted/.test(rec));
  const snap = JSON.parse(run(C, 'JSON.stringify(_powSnapshot())'));
  ok('saving keeps the portal\'s numbers beside the report', snap.followDue === '2' && snap.openQuotes === '₱3.85M' && snap['week.quotes'] === '1 · ₱300,000', snap);
  ok('nothing typed is injected raw', run(C, '(function(){ POW_UI.state.log[0].what = "<img src=x>"; return _powLogRows().indexOf("<img src=x>") < 0; })()'));
}
{
  const SRC = fs.readFileSync(path.join(DASH, 'proof-of-work.js'), 'utf8') + fs.readFileSync(path.join(DASH, 'proof-of-work-model.js'), 'utf8');
  ok('no emoji and no hex colour in either script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{6}\b/.test(SRC));
  const posts = (SRC.match(/postFlow\('(\w+)'/g) || []).map(x => x.slice(10, -1)).sort();
  eq('the only writes and private reads are its own two actions', posts, ['getProofReports', 'saveProofReport']);
  ok('  and nothing else secured', !/flowSecure|\/flow\/secure/.test(SRC));
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
