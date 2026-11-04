/* A393 — the follow-up guide store (FlowAPI 196: setFollowUpPlan, getFollowUpGuide).
 *
 * Run:  node tests/flow/follow-up-guide-store.js
 *
 * Neil, 4 Nov 2026: each rep's top-50 clients through the week, a GUIDE worked out from what the reps already record.
 * Quoted clients first (day 3, 5, 7, 14 after sending, then every 7, until won or lost), then the ranked clients with no
 * open quotation, one block of ranks per weekday, carried over until touched. Runs the real FlowAPI.gs through its
 * dispatcher (gasload) with "today" fixed at Wednesday 4 Nov 2026, and two clients a day so each rule is checked by hand.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt');
const GER = who('sales', 'Gerald Lucena', 'sales2'), KIM = who('sales', 'Kimberlyn Blones', 'sales1');
const D = (m, d, h, mi) => new Date(2026, m - 1, d, h === undefined ? 10 : h, mi || 0);
const iso = (m, d, h, mi) => D(m, d, h, mi).toISOString();
const NOW = D(11, 4, 10);   // Wednesday 4 Nov 2026

const COS = ['Alpha Power Corp.', 'Bravo Cement Inc.', 'Charlie Mining', 'Rank Four Corporation', 'Echo Shipyard', 'Foxtrot Steel',
             'Golf Energy', 'Hotel Hydro', 'India Nickel', 'Juliet Sugar'];
function world(settings) {
  const cb = COS.map((co, i) => ({ 'Client No': 'CB-' + (i + 1), 'Company': co, 'Key': co.toLowerCase(), 'Owner': 'Gerald Lucena', 'Archived At': '', 'Next Step': i === 0 ? 'Ask for the 2027 outage list' : '' }));
  cb.push({ 'Client No': 'CB-90', 'Company': 'Old Archived Co', 'Owner': 'Gerald Lucena', 'Archived At': D(10, 1) });
  cb.push({ 'Client No': 'CB-91', 'Company': 'Kilo Power', 'Owner': 'Kimberlyn Blones', 'Archived At': '' });
  const q = (no, cno, sent, extra) => Object.assign({ 'Quotation No': no, 'Customer': COS[+cno.slice(3) - 1], 'Status': 'Sent', 'Total': 100000, 'Salesperson': 'Gerald Lucena',
    'Created By': 'Crystal Gayle', 'Created At': D(9, 1), 'Date': D(9, 1), 'Sent At': sent, 'Result': '', 'Last Follow Up': '' }, extra || {});
  const store = {
    ClientBook: cb,
    Quotations: [
      q('Q1', 'CB-3', D(10, 28)),                                                   // day 5 = Mon 2 Nov (day 3 Sat moves there too), day 7 = today
      q('Q2', 'CB-7', D(10, 21), { 'Last Follow Up': '2026-11-04', 'Follow Up Via': 'Call', 'Result': 'Pending', 'Result At': D(11, 4, 9, 15) }),   // day 14 = today, done
      q('Q3', 'CB-9', D(10, 26)),                                                   // day 3 Thu 29 Oct missed, day 7 Mon 2 Nov still open
      q('Q4', 'CB-1', D(10, 20), { 'Result': 'Won' }),                               // marked won: out
      q('Q5', 'CB-2', D(10, 20)),                                                   // has a sales order: out
      q('Q6', 'CB-4', D(10, 20), { 'Status': 'Lost' }),                              // lost: out
      q('Q7', 'CB-5', D(10, 28), { 'Salesperson': 'Kimberlyn Blones' })              // another rep's quotation: not Gerald's
    ],
    SalesOrders: [{ 'SO No': 'SO-1', 'Quotation No': 'Q5' }],
    PricingRequests: [{ 'PR No': 'PR-8', 'Customer': 'Hotel Hydro', 'Salesperson': 'Gerald Lucena', 'Requested By': 'Gerald Lucena', 'Created At': D(11, 2, 14), 'Client Book No': 'CB-8' }],
    ClientBookLog: [
      { 'Log No': 'L1', 'Client No': 'CB-1', 'Kind': 'status', 'By': 'Gerald Lucena', 'At': D(11, 3, 11) },
      { 'Log No': 'L2', 'Client No': 'CB-6', 'Kind': 'contacts', 'By': 'Neil Estur', 'At': D(11, 3, 12) }      // an import by Neil: not Gerald's touch
    ],
    VisitPlans: [{ 'Visit Plan No': 'VP-5', 'Date': '2026-11-04', 'User': 'Gerald Lucena', 'Client No': 'CB-5', 'Status': 'Done', 'Done At': D(11, 4, 9) }],
    ProofReports: [
      { 'Report No': 'R1', 'Date': '2026-11-02', 'User': 'Gerald Lucena', 'Role': 'sales', 'Kind': '', 'Updated At': D(11, 3, 17), 'Report JSON': JSON.stringify({ v: 2, lines: [
        { id: 'a', loggedAt: iso(11, 2, 9, 30), type: 'Call', company: 'Charlie Mining', linkType: 'quotation', linkId: 'Q1' },
        { id: 'b', loggedAt: iso(11, 3, 15, 0), type: 'Other task', company: 'RANK FOUR CORPORATION', linkType: 'none', linkId: '' },
        { id: 'c', loggedAt: iso(11, 3, 16, 0), type: 'Call', company: 'Juliet Sugar', linkType: 'client', linkId: 'CB-10', voidedAt: iso(11, 3, 16, 5) },
        { id: 'd', loggedAt: iso(10, 30, 10, 0), type: 'Call', company: 'Bravo Cement Inc.', linkType: 'client', linkId: 'CB-2' }   // last week
      ], visits: [] }) }
    ],
    QuotationEmails: [], ClientBookLinks: [], SalesCalls: [], ClientVisits: []
  };
  const st = Object.assign({ followUpStart: 'off' }, settings || {});   // A395: these sections test the guide itself, not its start day
  store.FlowSettings = Object.keys(st).map(k => ({ 'Key': k, 'Value': st[k] }));
  const c = load(GS, store);
  c._now = () => new Date(NOW.getTime());
  return { c, store };
}
const plan = (n) => Array.from({ length: n || 10 }, (_, i) => ({ rank: i + 1, clientNo: 'CB-' + (i + 1), nextStep: 'Step ' + (i + 1) }));
const set = (c, owner, items, actor) => call(c, 'setFollowUpPlan', Object.assign({ owner, items, source: 'test.xlsx' }, actor || NEIL));

sec('1 · the version and who may open it');
{
  const { c, store } = world();
  ok('getVersion = 198', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 198);
  [GER, NEIL, LARRY].forEach(a => ok(a.actorRole + ' opens it', call(c, 'getFollowUpGuide', a).success));
  ['hr', 'admin', 'accounting', 'warehouse', 'marketing', 'leadgen'].forEach(r => ok(r + ' is refused', !call(c, 'getFollowUpGuide', who(r, 'X', r + '1')).success));
  ok('the read is secured', !call(c, 'getFollowUpGuide', Object.assign({ flowSecret: '' }, GER)).success);
  ok('a read creates no tab', !('FollowUpPlan' in store));
  const g = call(c, 'getFollowUpGuide', GER);
  ok('with no plan the guide is empty, not an error', g.success && g.planSize === 0 && g.live === 0 && g.days.length === 5, g);
  const off = world({ followUpGuide: 'off' }).c;
  ok('FlowSettings followUpGuide off closes it', /switched off/.test(call(off, 'getFollowUpGuide', GER).message));
}

sec('2 · setting a plan (the director only)');
{
  const { c, store } = world(), props0 = JSON.stringify(Object.keys(c.__props).sort());
  ok('a rep may not set one', /Only the director/.test(set(c, 'Gerald Lucena', plan(), GER).message));
  ok('management may not either', !set(c, 'Gerald Lucena', plan(), LARRY).success);
  const r = set(c, 'Gerald Lucena', plan());
  ok('the director sets Gerald\'s 10: 8-wide rows in rank order', r.success && r.count === 10 && store.FollowUpPlan.length === 10 && Object.keys(store.FollowUpPlan[0]).length === 8 &&
     store.FollowUpPlan.map(x => x['Rank']).join() === '1,2,3,4,5,6,7,8,9,10' && store.FollowUpPlan[2]['Company'] === 'Charlie Mining' && store.FollowUpPlan[0]['Set By'] === 'Neil Estur', [r, store.FollowUpPlan[0]]);
  ok('  logged in the ActivityLog', (store.ActivityLog || []).some(l => l['Module'] === 'Follow-up guide' && l['Action'] === 'Plan set' && l['Ref No'] === 'Gerald Lucena'));
  ok('an archived client is refused', /not a live client/.test(set(c, 'Gerald Lucena', [{ rank: 1, clientNo: 'CB-90' }]).message));
  ok('another rep\'s client is refused', /not a live client/.test(set(c, 'Gerald Lucena', [{ rank: 1, clientNo: 'CB-91' }]).message));
  ok('a rank twice is refused', /each once/.test(set(c, 'Gerald Lucena', [{ rank: 1, clientNo: 'CB-1' }, { rank: 1, clientNo: 'CB-2' }]).message));
  ok('a gap in the ranks is refused', !set(c, 'Gerald Lucena', [{ rank: 1, clientNo: 'CB-1' }, { rank: 3, clientNo: 'CB-2' }]).success);
  ok('a client twice is refused', /twice/.test(set(c, 'Gerald Lucena', [{ rank: 1, clientNo: 'CB-1' }, { rank: 2, clientNo: 'CB-1' }]).message));
  ok('A394: more than 150 is refused (Kimberlyn\'s 74 fit)', /at most 150/.test(set(c, 'Gerald Lucena', Array.from({ length: 151 }, (_, i) => ({ rank: i + 1, clientNo: 'CB-1' }))).message));
  ok('the refusals changed nothing', store.FollowUpPlan.length === 10);
  set(c, 'Kimberlyn Blones', [{ rank: 1, clientNo: 'CB-91' }]);
  const s = set(c, 'Gerald Lucena', plan(4));
  ok('setting it again replaces only that rep\'s plan (a shorter one drops the rows left over)', s.success && store.FollowUpPlan.length === 5 &&
     store.FollowUpPlan.filter(x => x['Owner'] === 'Gerald Lucena').length === 4 && store.FollowUpPlan.some(x => x['Owner'] === 'Kimberlyn Blones'), store.FollowUpPlan.map(x => x['Owner'] + x['Rank']));
  ok('no Script Property was added', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
}

sec('3 · the cadence: day 3, 5, 7, 14, then every 7; a weekend day moves to Monday');
{
  const { c } = world(), cfg = c._fugCfg();
  ok('the defaults: 3, 5, 7, 14 then every 7, 10 a day', cfg.cadence.join() === '3,5,7,14' && cfg.then === 7 && cfg.perDay === 10, cfg);
  const cp = c._fugCheckpoints('2026-10-21', '2026-11-30', cfg).map(x => x.date + '/' + x.step).join(' ');
  ok('sent Wed 21 Oct: day 3 (Sat) and day 5 meet on Mon 26 Oct, then 28 Oct, 4 Nov, 11, 18, 25 Nov', cp === '2026-10-26/5 2026-10-28/7 2026-11-04/14 2026-11-11/21 2026-11-18/28 2026-11-25/35', cp);
  const fri = c._fugCheckpoints('2026-10-30', '2026-11-20', cfg).map(x => x.date + '/' + x.step).join(' ');
  ok('sent Fri 30 Oct: Mon 2 Nov (day 3), Wed 4 Nov (5), Fri 6 (7), Fri 13 (14), Fri 20 (21)', fri === '2026-11-02/3 2026-11-04/5 2026-11-06/7 2026-11-13/14 2026-11-20/21', fri);
  const c2 = world({ followUpCadence: '3,7,14', followUpThen: 0, followUpPerDay: 2 }).c, cfg2 = c2._fugCfg();
  ok('FlowSettings change it: 3, 7, 14 and nothing after', c2._fugCheckpoints('2026-10-01', '2026-12-31', cfg2).length === 3 && cfg2.perDay === 2, cfg2);
}

sec('4 · Gerald\'s Wednesday: quoted clients first, then the ranked ones');
{
  const { c } = world({ followUpPerDay: 2 });
  set(c, 'Gerald Lucena', plan());
  const g = call(c, 'getFollowUpGuide', GER);
  ok('the week of Mon 2 Nov, today Wed 4 Nov', g.success && g.today === '2026-11-04' && g.monday === '2026-11-02' && !g.weekend && g.days.map(d => d.dow).join() === 'Mon,Tue,Wed,Thu,Fri', g);
  const wed = g.days[2], qn = (list) => list.map(x => x.quotationNo + '@' + x.date + ':' + x.status).sort().join(' ');
  ok('today\'s quotations: Q1 day 7 (open) and Q2 day 14 (done by its Pending update)', qn(wed.quotes) === 'Q1@2026-11-04:open Q2@2026-11-04:done', wed.quotes);
  ok('  Q2 says how it was done', wed.quotes.find(x => x.quotationNo === 'Q2').by.kind === 'Follow-up · call');
  ok('carried: Q3\'s Monday checkpoint, still open; its missed Thursday one is not carried', qn(wed.carryQuotes) === 'Q3@2026-11-02:open', wed.carryQuotes);
  ok('Monday listed Q1 (done) and Q3 (still open); Q3\'s Thursday 29 Oct checkpoint is missed, so it is listed nowhere', qn(g.days[0].quotes) === 'Q1@2026-11-02:done Q3@2026-11-02:open' &&
     ![].concat(...g.days.map(d => d.quotes.concat(d.carryQuotes))).some(x => x.date === '2026-10-29'), g.days[0].quotes);
  ok('Monday\'s Q1 checkpoint was done by the call linked to it', g.days[0].quotes.find(x => x.quotationNo === 'Q1').status === 'done' && g.days[0].quotes.find(x => x.quotationNo === 'Q1').by.time === '09:30');
  ok('won, sold, lost and another rep\'s quotations are not followed', ![].concat(...g.days.map(d => d.quotes.concat(d.carryQuotes))).some(x => /Q[4-7]/.test(x.quotationNo)));
  const rk = (list) => list.map(x => x.rank + ':' + x.status).join(' ');
  ok('the ranked clients by day, the quoted ones (3, 7, 9) left out', rk(g.days[0].clients) === '1:done 2:open' && rk(g.days[1].clients) === '4:done' &&
     rk(wed.clients) === '5:done 6:open' && rk(g.days[3].clients) === '8:done' && rk(g.days[4].clients) === '10:planned', g.days.map(d => rk(d.clients)));
  ok('carried to today: rank 2, untouched since Monday (last week\'s call does not count)', rk(wed.carryClients) === '2:open' && wed.carryClients[0].since === '2026-11-02', wed.carryClients);
  ok('the touches: a Client Book change (1), a line naming the company in another case (4), a visit done (5), a PR (8, ahead of its day)',
     g.days[0].clients[0].done.kind === 'Client updated' && g.days[1].clients[0].done.kind === 'Task' && wed.clients[0].done.kind === 'Visit done' && g.days[3].clients[0].done.kind === 'New PR');
  ok('a voided line and Neil\'s import are not touches (10 planned, 6 open)', g.days[4].clients[0].status === 'planned' && wed.clients[1].status === 'open');
  ok('a client\'s own next step wins over the plan\'s', g.days[0].clients[0].nextStep === 'Ask for the 2027 outage list' && wed.clients[1].nextStep === 'Step 6');
  ok('today: 2 of 6 done (2 quotations, 1 carried, 2 clients, 1 carried)', wed.total === 6 && wed.done === 2 && g.summary.todayTotal === 6 && g.summary.todayDone === 2, wed);
  ok('the week: 6 of 10 clients touched; 2 quotation follow-ups due; 3 clients quoted', g.summary.weekDone === 6 && g.summary.weekTotal === 10 && g.summary.quotesDue === 2 && g.summary.quoted === 3, g.summary);
  ok('Thursday ahead: its checkpoint list is planned', g.days[3].quotes.every(x => x.status === 'planned'));
}

sec('5 · who reads whose guide');
{
  const { c, store } = world({ followUpPerDay: 2 });
  set(c, 'Gerald Lucena', plan());
  set(c, 'Kimberlyn Blones', [{ rank: 1, clientNo: 'CB-91', nextStep: 'Call' }]);
  const k = call(c, 'getFollowUpGuide', Object.assign({ user: 'Gerald Lucena' }, KIM));
  ok('a rep naming another rep still gets their own', k.success && k.user === 'Kimberlyn Blones' && k.live === 1 && k.readOnly === false && k.people.length === 0, k);
  const d = call(c, 'getFollowUpGuide', Object.assign({ user: 'Gerald Lucena' }, NEIL));
  ok('the director reads Gerald\'s, read only, with the reps who have a plan', d.success && d.user === 'Gerald Lucena' && d.live === 10 && d.readOnly === true && d.people.join() === 'Gerald Lucena,Kimberlyn Blones', d.people);
  const a = call(c, 'getFollowUpGuide', Object.assign({ all: true }, LARRY));
  ok('management asks for all: one summary per rep', a.success && a.people.length === 2 && a.people[0].user === 'Gerald Lucena' && a.people[0].summary.weekDone === 6 && a.people[1].summary.weekTotal === 1, a);
  ok('a rep asking for all gets only their own guide', !call(c, 'getFollowUpGuide', Object.assign({ all: true }, GER)).people.length);
  store.ClientBook.find(x => x['Client No'] === 'CB-6')['Archived At'] = D(11, 4, 8);
  const g = call(c, 'getFollowUpGuide', GER);
  ok('a plan client archived since drops out and is listed', g.live === 9 && g.planSize === 10 && g.notLive.length === 1 && g.notLive[0].clientNo === 'CB-6', g.notLive);
}

sec('6 · links and names: which client a touch belongs to');
{
  const { c, store } = world({ followUpPerDay: 2 });
  set(c, 'Gerald Lucena', plan());
  store.ClientBookLinks.push({ 'Kind': 'quotation', 'Record No': 'Q3', 'Client No': '' });   // Q3 taken off its client
  let g = call(c, 'getFollowUpGuide', GER);
  ok('a quotation taken off its client is nobody\'s, not even by name (rank 9 is no longer quoted)', !g.days[4].clients.every(x => x.rank !== 9) && g.summary.quoted === 2, g.days[4].clients);
  store.ClientBookLinks[0]['Client No'] = 'CB-10';
  g = call(c, 'getFollowUpGuide', GER);
  ok('a link row moves it to another client (rank 10 now quoted)', g.summary.quoted === 3 && !g.days[4].clients.some(x => x.rank === 10) && g.days[4].clients.some(x => x.rank === 9));
  store.ClientBook.push({ 'Client No': 'CB-12', 'Company': 'India Nickel - Pier', 'Owner': 'Gerald Lucena', 'Archived At': '' });   // the same key as India Nickel (rank 9)
  store.SalesCalls.push({ 'Call No': 'C1', 'Date': '2026-11-04', 'User': 'Gerald Lucena', 'Company': 'India Nickel Corp', 'Created At': D(11, 4, 8) });
  store.SalesCalls.push({ 'Call No': 'C2', 'Date': '2026-11-04', 'User': 'Gerald Lucena', 'Company': 'Foxtrot Steel', 'Created At': D(11, 4, 8, 30) });
  g = call(c, 'getFollowUpGuide', GER);
  ok('an old-report call by exact name counts (rank 6 done)', g.days[2].clients.find(x => x.rank === 6).status === 'done', g.days[2].clients);
  ok('  a name two of the rep\'s clients share is not guessed (rank 9 still planned)', g.days[4].clients.find(x => x.rank === 9).status === 'planned', g.days[4].clients);
}

sec('7 · the weekend and Monday');
{
  const { c } = world({ followUpPerDay: 2 });
  set(c, 'Gerald Lucena', plan());
  c._now = () => D(11, 7, 10);   // Saturday
  const g = call(c, 'getFollowUpGuide', GER);
  ok('Saturday: every weekday is past, no today, next Monday previewed with ranks 1–2', g.weekend && g.days.every(d => d.past && !d.today) && g.summary.todayTotal === 0 &&
     g.next.date === '2026-11-09' && g.next.clients.map(x => x.rank).join() === '1,2' && g.next.clients.every(x => x.status === 'planned'), g.next);
  ok('  Q3 is due on Monday 9 Nov (its day 14); Q1 and Q2 are not', g.next.quotes.map(x => x.quotationNo + '/' + x.step).join() === 'Q3/14', g.next.quotes);
  c._now = () => D(11, 9, 10);   // Monday
  const m = call(c, 'getFollowUpGuide', GER);
  ok('Monday starts again: rank 1 open again, last week\'s touches do not count', m.days[0].today && m.days[0].clients.find(x => x.rank === 1).status === 'open' && m.summary.weekDone === 0, m.days[0].clients);
}

sec('8 · one rule everywhere: the guide, the daily report and the Client Book agree');
{
  const SR = require('../../dashboard/js/sales-report-model.js'), CBM = require('../../dashboard/js/client-book-model.js');
  const { c } = world(), cfg = c._fugCfg(), rule = SR.srFollowRule({});
  const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let bad = [], cbBad = [];
  for (let i = 0; i < 70; i++) {
    const sent = add('2026-09-01', i), server = {};
    c._fugCheckpoints(sent, '2027-03-31', cfg).forEach(x => { server[x.date] = x.step; });
    for (let j = 1; j < 90; j++) {
      const day = add(sent, j), step = SR.srFollowStep(sent, day, rule);
      if ((server[day] || 0) !== step) bad.push([sent, day, server[day] || 0, step]);
      if (CBM.cbFollowStep && CBM.cbFollowStep(sent, day) !== step) cbBad.push([sent, day]);
    }
  }
  ok('for 70 sent dates over 90 days each, the server checkpoints are the daily report\'s due days, step for step', bad.length === 0, bad.slice(0, 5));
  ok('  and the Client Book flag says the same', typeof CBM.cbFollowStep === 'function' && cbBad.length === 0, cbBad.slice(0, 5));
  const r2 = SR.srFollowRule({ followUpCadence: '3,7,14', followUpThen: 0 }), c2 = world({ followUpCadence: '3,7,14', followUpThen: 0 }).c, cfg2 = c2._fugCfg();
  ok('  with FlowSettings changed, both read it the same way', JSON.stringify([r2.days, r2.then]) === JSON.stringify([cfg2.cadence, cfg2.then]));
}

sec('9 · A394: faster, and a long list spread over the week');
{
  const { c, store } = world();
  const q = c._fugCols('Quotations', ['Quotation No', 'Total', 'Sent At']);
  ok('only the columns asked for are read (no PDF or layout JSON)', q.length === 7 && Object.keys(q[0]).sort().join() === 'Quotation No,Sent At,Total,rowIndex' && q[0]['Quotation No'] === 'Q1', Object.keys(q[0]));
  ok('  a missing tab is an empty list', c._fugCols('NoSuchTab', ['X']).length === 0 && c._fugCols('FollowUpPlan', ['Owner']).length === 0);
  const reps = c._fugReports(['Gerald Lucena'], '2026-10-12');
  ok('the daily reports: the rep\'s own, with their JSON', reps.length === 1 && /"type":"Call"/.test(reps[0]['Report JSON']));
  ok('  another rep\'s, or older than three weeks, are not read', c._fugReports(['Kimberlyn Blones'], '2026-10-12').length === 0 && c._fugReports(['Gerald Lucena'], '2026-11-20').length === 0);
  ok('touches count from three weeks before this Monday', c._fugSince('2026-11-04') === '2026-10-12');
  let read = 0;
  const real = c._fugData;
  c._fugData = function () { read++; return real.apply(this, arguments); };
  set(c, 'Gerald Lucena', plan());
  call(c, 'getFollowUpGuide', KIM);
  ok('a rep with no plan reads nothing but the plan', read === 0);
  call(c, 'getFollowUpGuide', GER);
  ok('  a rep with one reads the rest once', read === 1);
  const one = world({ followUpPerDay: 1 }).c;
  set(one, 'Gerald Lucena', plan());
  ok('ten clients at one a day still fill the week: two a day', call(one, 'getFollowUpGuide', GER).perDay === 2);
  const big = Array.from({ length: 74 }, (_, i) => ({ 'Client No': 'K-' + (i + 1), 'Company': 'Kim Client ' + (i + 1), 'Owner': 'Kimberlyn Blones', 'Archived At': '' }));
  const w = load(GS, { ClientBook: big, FlowSettings: [{ 'Key': 'followUpStart', 'Value': 'off' }] });
  w._now = () => new Date(NOW.getTime());
  const r = set(w, 'Kimberlyn Blones', big.map((b, i) => ({ rank: i + 1, clientNo: b['Client No'] })));
  const g = call(w, 'getFollowUpGuide', KIM);
  ok('Kimberlyn\'s 74: all in her plan, 15 a day, ranks 61–74 on Friday', r.success && g.planSize === 74 && g.live === 74 && g.perDay === 15 &&
     g.days.map(d => d.clients.length).join() === '15,15,15,15,14' && g.days[4].clients[0].rank === 61 && g.days[4].clients[13].rank === 74, g.days.map(d => d.clients.length));
  ok('  and her week counts all 74', g.summary.weekTotal === 74);
}

sec('10 · A395: the guide counts from its start day (Monday 9 Nov 2026)');
{
  const { c, store } = world();
  store.FlowSettings = [];   // the default start day
  ok('the default start day is Monday 9 Nov', c._fugCfg().start === '2026-11-09');
  set(c, 'Gerald Lucena', plan());
  let read = 0;
  const real = c._fugData;
  c._fugData = function () { read++; return real.apply(this, arguments); };
  const g = call(c, 'getFollowUpGuide', GER);
  ok('before it (Wed 4 Nov): not started, when it starts, the plan\'s size, nothing counted or read', g.success && g.notStarted === true && g.startsOn === '2026-11-09' && g.live === 10 &&
     g.planSize === 10 && g.days.length === 0 && g.summary.todayTotal === 0 && read === 0, g);
  const a = call(c, 'getFollowUpGuide', Object.assign({ all: true }, NEIL));
  ok('  the director\'s list says the same for each rep', a.success && a.startsOn === '2026-11-09' && a.people.length === 1 && a.people[0].notStarted && a.people[0].live === 10);
  c._fugData = real;
  c._now = () => D(11, 9, 10);   // the first Monday
  store.ProofReports[0]['Updated At'] = D(11, 6, 17);
  JSON.parse(store.ProofReports[0]['Report JSON']);
  store.ClientBookLog.push({ 'Log No': 'L9', 'Client No': 'CB-2', 'Kind': 'status', 'By': 'Gerald Lucena', 'At': D(11, 6, 15) });   // Friday before
  const m = call(c, 'getFollowUpGuide', GER);
  ok('on the start day it counts: Monday holds ranks 1–10 (the quoted ones followed by their quotations)', m.success && !m.notStarted && m.days[0].today && m.days[0].clients.length && m.days[0].clients.every(x => x.rank <= 10 && !x.quoted), m.days[0].clients.map(x => x.rank));
  ok('  a touch from the Friday before does not count', m.days[0].clients.find(x => x.rank === 2).status === 'open');
  ok('  no quotation follow-up from before is carried in', m.days[0].carryQuotes.length === 0 && ![].concat(...m.days.map(d => d.quotes)).some(x => x.date < '2026-11-09'), m.days[0].carryQuotes);
  ok('  the quotations still come up on their own days from Monday on (Q3 day 14 today)', m.days[0].quotes.some(x => x.quotationNo === 'Q3' && x.step === 14));
  const offc = world({ followUpStart: 'off' }).c;
  set(offc, 'Gerald Lucena', plan());
  ok('followUpStart off: no start day', !call(offc, 'getFollowUpGuide', GER).notStarted);
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
process.exit(FAIL ? 1 : 0);
