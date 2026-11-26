/* A407 — the sales clean-up in the browser: one follow-up list, one ranking, other spellings, orders and their quotations.
 *
 * Run:  node tests/flow/sales-cleanup-page.js
 *
 * The heart of it: the follow-up guide, the daily report's "Follow-ups due" and My quotations' "Follow-up due" name the SAME
 * quotations. The guide here is the REAL FlowAPI.gs reply (gasload), fed to the real page models, so the three cannot drift.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const DASH = path.resolve(__dirname, '../../dashboard');
const read = (f) => fs.readFileSync(path.join(DASH, f), 'utf8');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

/* the browser's files in one context (the daily report's, My quotations', the guide's and the Client Book's models) */
const W = (function () {
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, Promise,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    navigator: { userAgent: 'node' }, location: { href: '', pathname: '/', search: '' }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  require('./hxutil').load(ctx);
  ['flow-api.js', 'client-rollup.js', 'itinerary-week.js', 'sales-report-model.js', 'quotation-status-model.js', 'follow-up-guide-model.js', 'client-book-model.js', 'sales-plan-model.js', 'client-hub-model.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(DASH, 'js', f), 'utf8'), ctx, { filename: f }));
  return ctx;
})();
const run = (code) => vm.runInContext(code, W);

/* ── a week of Gerald's, the real guide ─────────────────────────────────────────────────────────── */
const D = (m, d, h) => new Date(2026, m - 1, d, h === undefined ? 10 : h);
const quote = (no, customer, sent, extra) => Object.assign({ 'Quotation No': no, 'Date': D(10, 1), 'Customer': customer, 'Status': 'Sent', 'Total': 100000, 'Discount %': 0,
  'Salesperson': 'Gerald Lucena', 'Created By': 'Gerald Lucena', 'Created At': D(10, 1), 'Sent At': sent, 'Result': '', 'Last Follow Up': '' }, extra || {});
const store = {
  FlowSettings: [{ Key: 'followUpStart', Value: 'off' }],
  ClientBook: [
    { 'Client No': 'CB-1', 'Company': 'Itogon Suyoc', 'Owner': 'Gerald Lucena', 'Tier': 'Minor', 'Archived At': '' },
    { 'Client No': 'CB-2', 'Company': 'SMC Global Power', 'Owner': 'Gerald Lucena', 'Tier': 'Major', 'Archived At': '' },
    { 'Client No': 'CB-3', 'Company': 'Bulacan Thermal', 'Owner': 'Gerald Lucena', 'Tier': 'Developing', 'Archived At': '' },
    { 'Client No': 'CB-4', 'Company': 'Plain Works', 'Owner': 'Gerald Lucena', 'Tier': '', 'Archived At': '' }
  ],
  ClientBookNames: [{ 'Name': 'ITOGON SOYUC RESOURCES INC', 'Name Key': 'itogon soyuc resources inc', 'Client No': 'CB-1', 'By': 'Gerald Lucena', 'At': D(11, 20) }],
  Quotations: [
    quote('Q-DAY7', 'SMC Global Power', D(11, 18)),                       // day 7 = Wed 25 Nov (today)
    quote('Q-CARRY', 'ITOGON SOYUC RESOURCES INC', D(11, 19)),            // day 5 = Tue 24 Nov, not done: still open today
    quote('Q-DONE', 'Plain Works', D(11, 20)),                            // day 5 = Wed 25, done by a call earlier today
    quote('Q-NOT', 'Bulacan Thermal', D(11, 23))                          // day 3 = Thu 26: not due today
  ],
  ProofReports: [{ 'Report No': 'R1', 'Date': '2026-11-25', 'User': 'Gerald Lucena', 'Role': 'sales', 'Kind': '', 'Updated At': D(11, 25, 9),
    'Report JSON': JSON.stringify({ v: 2, lines: [{ id: 'a', loggedAt: D(11, 25, 8).toISOString(), type: 'Call', company: 'Plain Works', linkType: 'quotation', linkId: 'Q-DONE' }], visits: [] }) }],
  SalesOrders: [], PricingRequests: [], ClientBookLinks: [], QuotationEmails: [], VisitPlans: [], SalesCalls: [], ClientVisits: [], ClientBookLog: [], FollowUpPlan: []
};
const C = load(GS, store);
C._now = () => D(11, 25, 10);
const G = call(C, 'getFollowUpGuide', { actorRole: 'sales', actorName: 'Gerald Lucena', actorUsername: 'sales2' });
const quotesForPage = store.Quotations.map(q => ({ quotationNo: q['Quotation No'], date: '2026-10-01', customer: q['Customer'], status: 'Sent', total: q['Total'], discountPct: 0,
  salesperson: 'Gerald Lucena', createdBy: 'Gerald Lucena', sentAt: q['Sent At'].toISOString(), result: '' }));

sec('1 · the guide (the real FlowAPI reply)');
const td = G.days.find(d => d.today), guideDue = td.quotes.concat(td.carryQuotes).map(x => x.quotationNo + ':' + x.status).sort();
ok('today: Q-DAY7 open, Q-CARRY carried open from Tuesday, Q-DONE done; Q-NOT not yet', G.success && G.planFrom === 'book' && guideDue.join() === 'Q-CARRY:open,Q-DAY7:open,Q-DONE:done', guideDue);
ok('  the misspelt quotation is Itogon Suyoc\'s (a saved spelling), labelled Minor', td.carryQuotes[0].clientNo === 'CB-1' && td.carryQuotes[0].label === 'Minor', td.carryQuotes[0]);
ok('  an unlabelled client\'s quotation is followed up too (Q-DONE)', td.quotes.some(x => x.quotationNo === 'Q-DONE'));

sec('2 · the daily report lists exactly the guide\'s');
W.__G = G; W.__Q = quotesForPage;
run('__ix = srIndex({ today: "2026-11-25", quotations: __Q, guide: __G })');
const fu = JSON.parse(run('JSON.stringify(srFollowUps(__ix, { name: "Gerald Lucena" }, "2026-11-25", null))'));
ok('the same three quotations, and the same one done', fu.map(x => x.ref + ':' + (x.done ? 'done' : 'open')).sort().join() === 'Q-CARRY:open,Q-DAY7:open,Q-DONE:done', fu);
ok('  the carried one says since when', fu.find(x => x.ref === 'Q-CARRY').since === '2026-11-24');
const fu2 = JSON.parse(run('JSON.stringify(srFollowUps(__ix, { name: "Gerald Lucena" }, "2026-11-25", { lines: [{ id: "z", type: "Call", linkType: "quotation", linkId: "Q-DAY7", loggedAt: "2026-11-25T03:00:00.000Z" }] }))'));
ok('a call logged in the report (not saved yet) marks it done at once', fu2.find(x => x.ref === 'Q-DAY7').done === true && fu2.find(x => x.ref === 'Q-DAY7').by.kind === 'Call');
run('__ix2 = srIndex({ today: "2026-11-25", quotations: __Q })');
const old = JSON.parse(run('JSON.stringify(srFollowUps(__ix2, { name: "Gerald Lucena" }, "2026-11-25", null).map(function (x) { return x.ref; }))'));
ok('without a guide (before FlowAPI 204) the report keeps its own day rule: no carry-over', old.indexOf('Q-CARRY') < 0, old);
ok('a day outside the guide\'s week falls back too', run('srGuideDay(__ix, "2026-11-02")') === null);

sec('3 · My quotations\' "Follow-up due" is the guide\'s');
run('__due = {}; __G.days.filter(function (d) { return d.today; })[0].quotes.concat(__G.days.filter(function (d) { return d.today; })[0].carryQuotes).forEach(function (x) { if (x.status === "open") __due[x.quotationNo] = x.step; })');
const qs = JSON.parse(run('JSON.stringify(qsBuild(__Q, { hasSO: {}, links: {}, cfg: null, salesOrders: [], today: "2026-11-25", guideDue: __due }).rows.filter(function (r) { return r.due; }).map(function (r) { return r.q.quotationNo; }).sort())'));
ok('due: the two the guide has open (the done one is not)', qs.join() === 'Q-CARRY,Q-DAY7', qs);

sec('4 · the guide card shows labels, not ranks');
const row = run('fugRowHtml(' + JSON.stringify(G.clients.find(c => c.clientNo === 'CB-2')) + ', "2026-11-25", {})');
ok('a Major client carries a "Major" chip', /class="fg-rank fg-tag t-major">Major</.test(row) && !/fg-rank">\d/.test(row), row);
ok('the plan is the three labelled clients, Major first (no rank list, nothing "not live")', G.clients.map(c => c.label).join() === 'Major,Minor,Developing' && G.notLive.length === 0);
const fakeWeek = '{ planFrom: "book", planSize: 5, days: [{ date: "2026-11-23", dow: "Mon", clients: [{}, {}] }, { date: "2026-11-24", dow: "Tue", today: true, clients: [] }] }';
ok('the day\'s head line counts clients, not ranks (and says nothing on a day with none)', run('fugSubtitle(' + fakeWeek + ', "2026-11-23", true)') === 'Mon 23 Nov · 2 of your 5 clients' &&
   run('fugSubtitle(' + fakeWeek + ', "2026-11-24", true)') === 'Tuesday', [run('fugSubtitle(' + fakeWeek + ', "2026-11-23", true)'), run('fugSubtitle(' + fakeWeek + ', "2026-11-24", true)')]);
const card = read('js/follow-up-guide-card.js');
ok('the week table says "All N clients this week" with a Label column from the book', /All ' \+ \(g\.planSize \|\| 0\) \+ ' clients this week/.test(card) && /'Label' : '#'/.test(card));

sec('5 · one ranking on every page');
ok('the Client Book offers Major, Minor and Developing', run('CB_TIERS.join()') === 'Major,Minor,Developing');
ok('  and counts Developing on its own chip', run('cbSummary([{ tier: "Developing" }, { tier: "Major" }], [], "2026-11-25").developing') === 1 && /chip\('t:Developing', 'Developing'/.test(read('js/client-book.js')));
ok('the Sales plan names the tiers as the book does', run('spTierName("A", { A: "Major", B: "Minor", C: "Developing" })') === 'Major' && run('spTierName("", { A: "Major" })') === 'No label' &&
   run('spTierName("B", null)') === 'Tier B' && run('JSON.stringify(spAccountSegs({ A: "Major", B: "Minor", C: "Developing" }).slice(1, 5).map(function (x) { return x[1]; }))') === '["Major","Minor","Developing","No label"]');
ok('  its accounts tab drops the rank and the tier picker when the tiers are the book\'s', /book \? '' : '<label>Tier<select/.test(read('js/sales-plan.js')) && /Change it in the Client Book/.test(read('js/sales-plan.js')));
ok('the client hub has a Developing filter and chip', run('JSON.stringify(CH_SALES_SEGS.map(function (s) { return s[0]; }))').indexOf('developing') > 0 && run('chTierText({ rows: [1], tier: "Developing" })') === 'Developing');

sec('6 · other spellings on the Client Book');
W.__IX = JSON.parse(JSON.stringify({}));
run('__cix = cbIndex({ today: "2026-11-25", quotations: __Q, prs: [], salesOrders: [], clients: [] })');
const recs = JSON.parse(run('JSON.stringify(cbRecords(__cix, { clientNo: "CB-1", company: "Itogon Suyoc", names: ["ITOGON SOYUC RESOURCES INC"] }).quotes.map(function (q) { return q.ref; }))'));
ok('a client\'s records include those under its other spellings', recs.join() === 'Q-CARRY', recs);
ok('  and none without them', run('cbRecords(__cix, { clientNo: "CB-1", company: "Itogon Suyoc" }).quotes.length') === 0);
ok('search finds a client by another spelling', run('cbFilter([{ clientNo: "CB-1", company: "Itogon Suyoc", names: ["ITOGON SOYUC RESOURCES INC"] }], [], __cix, { q: "soyuc" }).length') === 1);
ok('the CSV ends with the other spellings', /'Last update', 'Also written as'\];/.test(read('js/client-book-model.js')));
const cb = read('js/client-book.js');
ok('the edit form keeps them, one per line, and saves them after the details (FlowAPI 204)', /name="names"/.test(cb) && /postFlow\('saveClientBookNames'/.test(cb) && /CB\.v204 = /.test(cb));
ok('a rep\'s "follow-up due" flags come from the guide', /postFlow\('getFollowUpGuide', \{\}\)/.test(cb) && /fugDue: cbGuideDue\(guide\)/.test(cb));

sec('7 · orders and their quotations (the director)');
const sp = read('js/sales-plan.js');
ok('the team head offers "Connect orders to quotations" to the director only, from FlowAPI 204', /SP\.role === 'director' && t\.lists && t\.lists\.tierFrom \? '<button type="button" class="sp-link" data-orderlinks>Connect orders to quotations/.test(sp));
ok('  the sheet reads getOrderQuotationLinks and connects with linkOrderQuotations (all, or one suggestion at a time)', /postFlow\('getOrderQuotationLinks'/.test(sp) && /postFlow\('linkOrderQuotations', p\)/.test(sp) && /data-linkall/.test(sp) && /data-link="/.test(sp));
ok('  a suggestion button presses in, and reduced motion keeps it still', /\.sp-cand:active \{ transform: scale\(\.97\); \}/.test(read('css/sales-plan.css')) && /prefers-reduced-motion: reduce\) \{ \.sp-cand/.test(read('css/sales-plan.css')));

sec('8 · one daily report for a rep');
const mdr = read('js/my-daily-report.js');
ok('a rep gets no "Old daily report" button, and the page is called "Daily report"', !/sales: 'report\.html'/.test(mdr) && /h\.textContent = 'Daily report'/.test(mdr));
ok('the report no longer says the old one still works', !/old daily report still works/.test(read('js/sales-report.js')));
ok('the home\'s nudge counts the guide\'s follow-ups (its copy of today), not the 7-day rule', /hx_fug1:' \+ \(session\.username \|\| session\.name\) \+ ':me'/.test(read('js/auth.js')) && /quotation follow-up' \+ \(fuN === 1/.test(read('js/auth.js')));

sec('9 · a request just submitted is shown (PR-202611-046 / 047, 26 Nov)');
const pr = read('js/flow-pricing-request.js'), sub = pr.slice(pr.indexOf("flowMsg('formMsg', `${res.message} (${res.prNo})${extra}`, true);"), pr.indexOf('function resetForm()'));
ok('after a submit the list is re-read and the new request shown', /prJustMade = String\(res\.prNo\);\s*await loadRequests\(\);/.test(sub) && /prShowNew\(res\.prNo\);/.test(sub));
const show = pr.slice(pr.indexOf('function prShowNew('), pr.indexOf('// ─── List / queue'));
ok('  it shows All and clears the search, saving nothing (A408: no chip is remembered between visits)', /prOrg\.state\.chip = 'all'/.test(show) && /prOrg\.state\.q = ''/.test(show) && !/\.pick\(|_sl2Save/.test(show));
ok('  it opens the row\'s group, scrolls to it (no smooth scroll with reduced motion) and lets the mark fade after 6 s', /det\.open = true/.test(show) && /prefers-reduced-motion: reduce/.test(show) && /6000/.test(show));
ok('  both list layouts mark the row', (pr.match(/String\(r\.prNo\) === prJustMade \? ' class="pr-new"'/g) || []).length === 2);
ok('  the mark is a token colour that fades, and stays still with reduced motion', /#listContainer tr\.pr-new > td \{ background: var\(--hx-navy-soft\); \}/.test(read('css/sales-lists.css')) &&
   /prefers-reduced-motion: reduce\) \{ #listContainer tr > td \{ transition: none; \} \}/.test(read('css/sales-lists.css')));

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
process.exit(FAIL ? 1 : 0);
