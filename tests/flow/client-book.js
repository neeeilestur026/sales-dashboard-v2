/* A350 — the Client Book (js/client-book-model.js, js/client-book.js, js/client-book-card.js, director-client-book.html).
 *
 * Run:  node tests/flow/client-book.js
 *
 * A small world with the answers worked out by hand, today being Wednesday 21 Oct 2026:
 *   1 · matching a client to the portal's records by the server's key; its PRs, quotations and orders; the day-7 follow-up
 *   2 · what the records say (the latest event wins) and when it is offered; the owner suggestion
 *   3 · flags (needs an update, next step overdue, expiring, a possible duplicate), the summary, search and filters, CSV
 *   4 · the Sales Daily Report lines about a client
 *   5 · the page: rows, chips, the detail, Add client, saving, the deep link, before FlowAPI 178, its own actions only
 *   6 · the dashboard card, who sees the page, and the site rules (no emoji, hex colour or inline style)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');

const G = 'Gerald Lucena', K = 'Kim Reyes';
const BOOK = {
  success: true,
  clients: [
    { clientNo: 'CB-0001', company: 'Philcement Corporation', key: 'philcement', owner: G, accreditation: 'Accredited', accreditationStep: '', accreditedUntil: '2026-11-10',
      accreditationUpdatedAt: '2026-10-05T02:00:00.000Z', status: 'RFQ received', statusUpdatedAt: '2026-10-10T02:00:00.000Z', statusRef: 'PR-1', nextStep: '', nextStepDate: '',
      contacts: [{ id: 'P1', name: 'Ana Cruz', position: 'Purchasing', emails: ['ana@philcement.ph', 'ana.cruz@gmail.com'], phones: ['0917 123 4567'], primary: true },
                 { id: 'P2', name: 'Ben', position: '', emails: [], phones: ['(02) 8555-1212'], primary: false }],
      notes: '', createdAt: '2026-10-01T01:00:00.000Z', updatedAt: '2026-10-10T02:00:00.000Z', archivedAt: '' },
    { clientNo: 'CB-0002', company: 'Zeta Mining', key: 'zeta mining', owner: K, accreditation: 'On process', accreditationStep: 'Documents submitted', accreditedUntil: '',
      status: '', nextStep: 'Call purchasing about the forms', nextStepDate: '2026-10-20', contacts: [], createdAt: '2026-10-01T01:00:00.000Z', updatedAt: '2026-10-01T01:00:00.000Z', archivedAt: '' },
    { clientNo: 'CB-0003', company: 'PHILCEMENT CORP.', key: 'philcement', owner: '', accreditation: 'Not accredited', status: '', contacts: [],
      createdAt: '2026-10-21T01:00:00.000Z', updatedAt: '2026-10-21T01:00:00.000Z', archivedAt: '' },
    { clientNo: 'CB-0004', company: 'Gone Co', key: 'gone', owner: G, accreditation: 'Not accredited', status: '', contacts: [],
      createdAt: '2026-10-01T01:00:00.000Z', archivedAt: '2026-10-02T01:00:00.000Z', archiveReason: 'Plant closed' }
  ],
  log: [
    { logNo: 'CBL-1', clientNo: 'CB-0001', kind: 'created', from: '', to: 'Philcement Corporation', note: 'Owner: Gerald Lucena. On process.', by: 'Neil Estur', at: '2026-10-01T01:00:00.000Z' },
    { logNo: 'CBL-2', clientNo: 'CB-0001', kind: 'accreditation', from: 'On process', to: 'Accredited until 2026-11-10', note: 'Vendor number issued', by: 'Neil Estur', at: '2026-10-05T02:00:00.000Z' },
    { logNo: 'CBL-3', clientNo: 'CB-0001', kind: 'status', from: '', to: 'RFQ received', ref: 'PR-1', by: 'Neil Estur', at: '2026-10-10T02:00:00.000Z' },
    { logNo: 'CBL-4', clientNo: 'CB-0002', kind: 'created', to: 'Zeta Mining', note: 'On process.', by: 'Neil Estur', at: '2026-10-01T01:00:00.000Z' },
    { logNo: 'CBL-5', clientNo: 'CB-0003', kind: 'created', to: 'PHILCEMENT CORP.', note: 'Not accredited.', by: 'Neil Estur', at: '2026-10-21T01:00:00.000Z' },
    { logNo: 'CBL-6', clientNo: 'CB-0004', kind: 'created', to: 'Gone Co', by: 'Neil Estur', at: '2026-10-01T01:00:00.000Z' },
    { logNo: 'CBL-7', clientNo: 'CB-0004', kind: 'archived', note: 'Plant closed', by: 'Neil Estur', at: '2026-10-02T01:00:00.000Z' }
  ],
  lists: { accreditation: ['Accredited', 'On process', 'Not accredited'], steps: ['Requirements received', 'Documents submitted', 'Under evaluation', 'Site audit'],
           status: ['Pending RFQ', 'RFQ received', 'Quotation sent', 'Following up', 'Negotiating', 'PO received', 'Lost', 'On hold', 'No requirement now'] }
};
const RAW = {
  today: '2026-10-21',
  quotations: [
    { quotationNo: 'Q-1', customer: 'PHILCEMENT CORP.', status: 'Sent', sentAt: '2026-10-14T02:00:00.000Z', date: '2026-10-13', total: 186400, salesperson: G },
    { quotationNo: 'Q-2', customer: 'Zeta Mining Corp', status: 'Lost', date: '2026-10-02', total: 50000, salesperson: K },
    { quotationNo: 'DEMO-1', customer: 'Demo Client', status: 'Sent', sentAt: '2026-10-20T02:00:00.000Z', total: 1 }
  ],
  prs: [
    { prNo: 'PR-1', customer: 'Philcement Corporation', status: 'Quoted', salesperson: G, date: '2026-10-09' },
    { prNo: 'PR-2', customer: 'Zeta Mining', status: 'Requested', requestedBy: K, date: '2026-10-18' },
    { prNo: 'PR-3', customer: 'New Plant Inc', status: 'Requested', salesperson: 'Admin', date: '2026-10-18' },
    { prNo: 'PR-4', customer: 'New Plant Inc.', status: 'Requested', salesperson: 'Crystal Gayle', date: '2026-10-16' }
  ],
  salesOrders: [{ soNo: 'SO-1', customer: 'Philcement Corp', quotationNo: 'Q-OLD', date: '2026-09-01', total: 90000 }],
  clients: [{ customer: 'Philcement Corporation' }],
  activity: []
};
const REPORTS = [{ date: '2026-10-20', user: G, report: { lines: [
  { type: 'Call', company: 'Philcement Corp', person: 'Ana', note: 'asked about the PO', result: 'Reached', loggedAt: '2026-10-20T03:00:00.000Z' },
  { type: 'Call', company: 'Someone else', linkType: 'client', linkId: 'CB-0001', note: 'linked by hand', loggedAt: '2026-10-20T05:00:00.000Z' },
  { type: 'Call', company: 'Philcement', note: 'voided', voidedAt: '2026-10-20T06:00:00.000Z', loggedAt: '2026-10-20T04:00:00.000Z' },
  { type: 'Call', company: 'Zeta Mining', note: 'not this client', loggedAt: '2026-10-20T02:00:00.000Z' }] } }];

/* the model, in one vm context with the real flow-api.js and client-rollup.js, as the page has them */
const C = (function () {
  const ctx = { console, Date, Math, JSON, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    navigator: { userAgent: 'node' }, location: { href: '', pathname: '/' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['js/flow-api.js', 'js/client-rollup.js', 'js/client-book-model.js'].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  vm.runInContext('flowToday = function () { return "2026-10-21"; };', ctx);
  return ctx;
})();
const run = (code) => vm.runInContext(code, C);
const J = (code) => JSON.parse(run('JSON.stringify(' + code + ')'));
C.__raw = RAW; C.__book = BOOK; C.__reports = REPORTS;
run('var IX = cbIndex(__raw), CL = __book.clients, LOG = __book.log, byNo = function (n) { return CL.filter(function (c) { return c.clientNo === n; })[0]; };');

sec('1 · the portal\'s records, matched by the server\'s key');
eq('"Philcement Corporation", "PHILCEMENT CORP." and "Philcement Corp" are one company', ['Philcement Corporation', 'PHILCEMENT CORP.', 'Philcement Corp'].map(n => run('crCanonKey(' + JSON.stringify(n) + ')')), ['philcement', 'philcement', 'philcement']);
const R1 = J('cbRecords(IX, byNo("CB-0001"))');
eq('its PRs, quotations and sales orders', [R1.prs.map(x => x.ref), R1.quotes.map(x => x.ref), R1.sos.map(x => x.ref)], [['PR-1'], ['Q-1'], ['SO-1']]);
eq('  open: no PR (PR-1 is quoted), one quotation worth ₱186,400', [R1.openPrs, R1.openQuotes, R1.openValue, R1.total], [0, 1, 186400, 3]);
eq('  Q-1 was sent 14 Oct, so its day-7 follow-up is due today', R1.quotes[0].followUpDue, 7);
ok('  demo quotations are never anyone\'s record', !J('Object.keys(IX.by)').some(k => /demo/.test(k)) && !J('IX.names').some(n => /Demo/.test(n.name)));
{
  C.__wk = { today: '2026-10-19', quotations: [{ quotationNo: 'Q-W', customer: 'Weekend Co', status: 'Sent', sentAt: '2026-10-15T02:00:00.000Z', total: 1 }] };
  eq('a day-3 follow-up that falls on Sunday is due on Monday', J('cbRecords(cbIndex(__wk), { company: "Weekend Co" }).quotes[0].followUpDue'), 3);
}
eq('the names the portal already uses, one spelling per company, the Clients sheet\'s first', J('IX.names.map(function (n) { return n.name; })'), ['New Plant Inc', 'Philcement Corporation', 'Zeta Mining Corp']);

sec('2 · what the records say, and the owner');
const S1 = J('cbRecordsSay(cbRecords(IX, byNo("CB-0001")), byNo("CB-0001"))');
eq('Philcement: the sent quotation is the latest event, with its follow-up due', [S1.status, S1.ref, S1.why], ['Following up', 'Q-1', 'Quotation Q-1 sent, day-7 follow-up due today']);
ok('  offered, because it is newer than the last status update and the client is accredited', S1.suggest === true);
const S2 = J('cbRecordsSay(cbRecords(IX, byNo("CB-0002")), byNo("CB-0002"))');
eq('Zeta: the open PR of 18 Oct is newer than the quotation lost on 2 Oct', [S2.status, S2.ref], ['RFQ received', 'PR-2']);
ok('  but it is not offered: the sales status waits for accreditation', S2.suggest === false);
ok('the records are not offered when the status already says so', J('cbRecordsSay(cbRecords(IX, byNo("CB-0001")), Object.assign({}, byNo("CB-0001"), { status: "Following up" }))').suggest === false);
ok('  nor when the status was set after the records\' latest event', J('cbRecordsSay(cbRecords(IX, byNo("CB-0001")), Object.assign({}, byNo("CB-0001"), { status: "Negotiating", statusUpdatedAt: "2026-10-16T02:00:00.000Z" }))').suggest === false);
eq('a sales order alone reads as PO received', J('cbRecordsSay(cbRecords(cbIndex({ today: "2026-10-21", salesOrders: [{ soNo: "SO-9", customer: "Solo", date: "2026-10-01", total: 5 }] }), { company: "Solo" }), { company: "Solo", accreditation: "Accredited" }).status'), 'PO received');
ok('no records, nothing to say', run('cbRecordsSay(cbRecords(IX, { company: "Nobody" }), { company: "Nobody" })') === null);
eq('a new client\'s owner: whoever has its latest PR or quotation, never Admin', run('cbOwnerSuggest(IX, "New Plant Inc")'), 'Crystal Gayle');

sec('3 · flags, the summary, search, CSV');
const F1 = J('cbFlags(byNo("CB-0001"), LOG, CL, "2026-10-21")'), F2 = J('cbFlags(byNo("CB-0002"), LOG, CL, "2026-10-21")'), F3 = J('cbFlags(byNo("CB-0003"), LOG, CL, "2026-10-21")');
eq('Philcement: last update 10 Oct, accreditation expiring 10 Nov, a possible duplicate', [F1.lastUpdate, F1.daysSince, F1.needsUpdate, F1.expiring, F1.expired, F1.twins], ['2026-10-10', 11, false, true, false, ['CB-0003']]);
eq('Zeta: nothing for 20 days needs an update; its next step (20 Oct) is overdue', [F2.daysSince, F2.needsUpdate, F2.nextOverdue], [20, true, true]);
eq('the duplicate points back', F3.twins, ['CB-0001']);
ok('an accreditation past its date is expired, not expiring', (f => f.expired && !f.expiring)(J('cbFlags(Object.assign({}, byNo("CB-0001"), { accreditedUntil: "2026-10-01" }), LOG, CL, "2026-10-21")')));
eq('each log row reads in words', ['created', 'accreditation', 'status', 'contacts', 'details', 'archived', 'restored'].map(k => run('cbLogText(' + JSON.stringify({ kind: k, from: k === 'contacts' ? '1' : '', to: k === 'contacts' ? '2' : k === 'status' ? 'Quotation sent' : 'X' }) + ')')),
   ['Added to the Client Book', 'Accreditation: X', 'Status: Quotation sent', 'Contact people: 1 → 2', 'Details changed', 'Archived', 'Restored']);
eq('an accreditation update shows its own last update', J('cbAccredLast(byNo("CB-0001"), LOG)'), { at: '2026-10-05T02:00:00.000Z', note: 'Vendor number issued' });
eq('the summary leaves archived clients out', J('cbSummary(CL, LOG, "2026-10-21")'), { total: 3, accredited: 1, onProcess: 1, notAccredited: 1, needsUpdate: 1, expiring: 1, nextOverdue: 1, archived: 1 });
const ids = (f) => J('cbFilter(CL, LOG, IX, ' + JSON.stringify(f) + ').map(function (c) { return c.clientNo; })');
eq('newest update first by default', ids({}), ['CB-0003', 'CB-0001', 'CB-0002']);
eq('search finds a contact\'s second email', ids({ q: 'ana.cruz@gmail' }), ['CB-0001']);
eq('  and a phone typed another way', ids({ q: '8555 1212' }), ['CB-0001']);
eq('  and a contact\'s name', ids({ q: 'ben' }), ['CB-0001']);
eq('accreditation, needs an update, expiring, next step', [ids({ accreditation: 'On process' }), ids({ flag: 'needsUpdate' }), ids({ flag: 'expiring' }), ids({ sort: 'next' })[0]], [['CB-0002'], ['CB-0002'], ['CB-0001'], 'CB-0002']);
eq('archived clients only when asked for', ids({ archived: true }), ['CB-0004']);
{
  const csv = run('cbCsv(cbFilter(CL, LOG, IX, {}), LOG, IX)').split('\n');
  ok('CSV: a header and one row per client', csv.length === 4 && /^Client No,Company,Owner,Accreditation/.test(csv[0]));
  const row = csv.find(l => /^CB-0001,/.test(l));
  ok('  every contact person kept; a cell with a comma is quoted', /Ana Cruz,Purchasing,ana@philcement\.ph; ana\.cruz@gmail\.com,0917 123 4567,"Ben, \(02\) 8555-1212"/.test(row), row);
  ok('  with its open quotations and their value', /,0,1,186400,/.test(row), row);
}
eq('money and days read plainly', [run('cbMoney(186400)'), run('cbMoney(3800000)'), run('cbMoney(1250000)'), run('cbDay("2026-10-21")'), run('cbDay("")')], ['₱186,400', '₱3.8M', '₱1.25M', '21 Oct 2026', '']);

sec('4 · the Sales Daily Report');
const DL = J('cbDayLines(__reports, byNo("CB-0001"))');
eq('the lines linked to the client or naming it, newest first, voided ones left out', DL.map(l => l.note), ['linked by hand', 'asked about the PO']);
eq('  each with its day and who logged it', [DL[1].day, DL[1].user, DL[1].result], ['2026-10-20', G, 'Reached']);

sec('5 · the page');
const stubEl = () => ({ id: '', value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, checked: false, dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, focus() {}, setAttribute() {}, getAttribute: () => null,
  querySelector: () => stubEl(), querySelectorAll: () => [], closest: () => null, insertAdjacentHTML() {}, remove() {},
  elements: new Proxy({}, { get: () => stubEl() }) });
async function boot(o) {
  o = o || {};
  const p = page(['js/client-rollup.js', 'js/client-book-model.js', 'js/client-book.js'], 'director-client-book.html', { username: 'neil', name: 'Neil Estur', role: 'director' },
    { data: { getQuotations: RAW.quotations, getPricingRequests: RAW.prs, getSalesOrders: RAW.salesOrders, getClients: RAW.clients, getActivityLog: [] } });
  ['cbQ', 'cbStatus', 'cbOwner', 'cbSort'].forEach(id => { p.els[id] = Object.assign(stubEl(), { id }); });
  p.ctx.__book = o.book || BOOK; p.ctx.__reports = REPORTS; p.ctx.__stub = stubEl;
  p.ctx.__ask = o.ask || null;
  p.run(`flowToday = function () { return "2026-10-21"; };
    URLSearchParams = function () { return { get: function (k) { return k === 'client' ? __ask : null; } }; };
    apiGetUsers = function () { return Promise.resolve({ data: [{ username: 'gerald', fullName: 'Gerald Lucena', role: 'sales' }, { username: 'kim', fullName: 'Kim Reyes', role: 'sales' }, { username: 'neil', fullName: 'Neil Estur', role: 'director' }] }); };
    var __posted = [], __shown = '';
    postFlow = function (a, p) { __posted.push({ a: a, p: p });
      if (a === 'getClientBook') return Promise.resolve(JSON.parse(JSON.stringify(__book)));
      if (a === 'getProofReports') return Promise.resolve({ success: true, data: __reports });
      return Promise.resolve({ success: true, clientNo: p.clientNo || 'CB-0005' }); };
    cbShow = function (h, back) { __shown = h; CB.back = back || CB.back; return __stub(); };`);
  await p.boot();
  await new Promise(r => setImmediate(r));
  return p;
}
(async () => {
  const p = await boot();
  const T = p.els.cbTable.innerHTML;
  eq('reads the book and the daily reports privately, and the records plainly', [p.run('__posted.map(function (x) { return x.a; }).sort()'), p.calls.filter(c => !/^POST:/.test(c)).sort()],
     [['getClientBook', 'getProofReports'], ['getActivityLog', 'getClients', 'getPricingRequests', 'getQuotations', 'getSalesOrders']]);
  ok('one row per live client, newest update first', (T.match(/data-open="/g) || []).length === 3 && T.indexOf('CB-0003') < T.indexOf('CB-0001') && T.indexOf('CB-0001') < T.indexOf('CB-0002'));
  ok('  a row: company with its main contact, owner, accreditation, status since, records, next step, last update',
     /Philcement Corporation<\/button><span class="cb-sub">Ana Cruz, Purchasing \+ 1 more<\/span>/.test(T) && /RFQ received<\/span><span class="cb-sub">since 10 Oct 2026/.test(T) &&
     /1 PR · 1 quotation<span class="cb-sub">₱186,400 open/.test(T) && /Until 10 Nov 2026/.test(T), T.slice(0, 1200));
  ok('  the records\' suggestion shows on the row', /Records say: Following up/.test(T));
  ok('  not accredited or on process: no sales status, and the accreditation\'s last update', /Documents submitted<\/span><span class="cb-sub">Last update 1 Oct 2026/.test(T));
  ok('  flags: a possible duplicate, a stale client, an overdue next step', /Possible duplicate/.test(T) && /20 days ago/.test(T) && /cb-sub warn">20 Oct 2026/.test(T));
  ok('the chips count, and All is on', /data-chip="all" aria-pressed="true">All clients <span class="n">3<\/span>/.test(p.els.cbChips.innerHTML) && /Needs an update <span class="n">1<\/span>/.test(p.els.cbChips.innerHTML) && /Archived <span class="n">1<\/span>/.test(p.els.cbChips.innerHTML));
  eq('the foot says how many are shown', p.els.cbFoot.textContent, '3 of 3 shown.');
  ok('the filters are drawn once, with the owners from the roster (sales only) and the book', /id="cbQ"/.test(p.els.cbFilters.innerHTML) && /Gerald Lucena/.test(p.els.cbOwner.innerHTML) && /Kim Reyes/.test(p.els.cbOwner.innerHTML) && !/Neil Estur/.test(p.els.cbOwner.innerHTML));
  p.run('cbChip("a:On process")');
  ok('a chip filters the list', (p.els.cbTable.innerHTML.match(/data-open="/g) || []).length === 1 && /Zeta Mining/.test(p.els.cbTable.innerHTML) && /data-chip="a:On process" aria-pressed="true"/.test(p.els.cbChips.innerHTML));
  p.run('cbChip("archived")');
  ok('  Archived shows only the archived', /Gone Co/.test(p.els.cbTable.innerHTML) && (p.els.cbTable.innerHTML.match(/data-open="/g) || []).length === 1 && /class="archived"/.test(p.els.cbTable.innerHTML));
  p.run('cbChip("all")');

  p.run('cbDetail("CB-0001", null)');
  const d1 = p.run('__shown');
  ok('the detail: accreditation, sales status, the portal\'s records, the daily report, contacts, timeline, archive', ['<h4>Accreditation</h4>', '<h4>Sales status</h4>', '<h4>From the portal', '<h4>From the Sales Daily Report</h4>', '<h4>Contacts and details</h4>', '<h4>Timeline</h4>', 'Archive this client'].every(s => d1.includes(s)));
  ok('  the records say, with Use it', /The records say: <b>Following up<\/b> — Quotation Q-1 sent, day-7 follow-up due today \(14 Oct 2026\)\./.test(d1) && /data-usesay/.test(d1));
  ok('  the records link to their pages, with the follow-up marked', /<a href="flow-quotations\.html\?review=Q-1">Q-1<\/a>/.test(d1) && /<a href="flow-pricing-request\.html\?pr=PR-1">PR-1<\/a>/.test(d1) && /day-7 follow-up due today/.test(d1) && /<b>SO-1<\/b>/.test(d1));
  ok('  the status can be linked to one of the client\'s own records', /<option value="Q-1">Quotation Q-1 — Sent<\/option>/.test(d1) && /<option value="PR-1" selected>PR PR-1 — Quoted<\/option>/.test(d1));
  ok('  the daily report lines about it', /asked about the PO/.test(d1) && /linked by hand/.test(d1) && !/voided/.test(d1));
  ok('  every contact person, each email and phone on its own line', /value="Ana Cruz"/.test(d1) && /ana@philcement\.ph\nana\.cruz@gmail\.com<\/textarea>/.test(d1) && /value="Ben"/.test(d1));
  ok('  the history under each part, in words, and the duplicate warned about', /Accreditation: On process → Accredited until 2026-11-10/.test(d1) && /Added to the Client Book/.test(d1) && /Possible duplicate of CB-0003/.test(d1));
  p.run('CB.clients[0].status = "Following up"; cbDetail("CB-0001", null); CB.clients[0].status = "RFQ received";');
  ok('  once the status says what the records say, the suggestion line goes', !/The records say/.test(p.run('__shown')));
  p.run('cbDetail("CB-0003", null)');
  const d3 = p.run('__shown');
  ok('a client not yet accredited: no status form, a plain line instead', /The sales status starts once the client is accredited/.test(d3) && !/data-kind="status"/.test(d3) && /data-kind="accreditation"/.test(d3));
  p.run('cbDetail("CB-0004", null)');
  const d4 = p.run('__shown');
  ok('an archived client: read only, with Restore', /Restore this client/.test(d4) && !/data-kind=/.test(d4) && !/id="cbEdit"/.test(d4) && /Archived 2 Oct 2026: Plant closed/.test(d4));

  p.run('cbAddDialog(null)');
  const add = p.run('__shown');
  ok('Add client: the portal\'s names to choose from, the owners, accreditation, contacts, next step', /<option value="Philcement Corporation"><\/option>/.test(add) && /<option value="Kim Reyes">Kim Reyes<\/option>/.test(add) &&
     /<option selected>Not accredited<\/option>/.test(add) && /data-addperson/.test(add) && /name="nextStepDate"/.test(add));
  eq('  a company already in the book is found by its key; an archived one is not', [p.run('(cbTwinOf("philcement corp") || {}).clientNo'), p.run('cbTwinOf("Gone Co.")'), p.run('cbTwinOf("")')], ['CB-0001', null, null]);

  await p.run('cbPost(null, "setClientBookStatus", { clientNo: "CB-0001", kind: "status", value: "Following up", ref: "Q-1" })');
  const after = p.run('__posted.map(function (x) { return x.a; })');
  ok('saving sends the change, then reads the book again', after.slice(-2).join() === 'setClientBookStatus,getClientBook', after);
  ok('the page sends only its own actions', p.run('__posted.every(function (x) { return /^(getClientBook|getProofReports|saveClientBookClient|setClientBookStatus|archiveClientBookClient)$/.test(x.a); })'));

  C.__x = '<img src=x onerror=alert(1)>';
  const bad = JSON.parse(JSON.stringify(BOOK));
  bad.clients[0].company = '<img src=x onerror=alert(1)>'; bad.clients[0].contacts[0].name = '"><script>alert(1)</script>';
  const px = await boot({ book: bad });
  px.run('cbDetail("CB-0001", null)');
  const all = px.els.cbTable.innerHTML + px.run('__shown');
  ok('what is typed is shown as text, never markup', !/<img src=x|<script>alert/.test(all) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(px.els.cbTable.innerHTML));

  const pd = await boot({ ask: 'CB-0002' });
  ok('a Sales Daily Report link (?client=CB-0002) opens that client', /<h3 id="cbTitle">Zeta Mining<\/h3>/.test(pd.run('__shown')));

  const po = await boot({ book: { success: false, message: 'Unknown action: getClientBook' } });
  ok('before FlowAPI 178: it says so, Add client is off, and nothing breaks', /needs the FlowAPI update \(version 178\)/.test(po.els.cbNotice.innerHTML) && po.els.cbAdd.disabled === true && /Nothing to show yet/.test(po.els.cbTable.innerHTML));
  const pe = await boot({ book: { success: true, clients: [], log: [] } });
  ok('an empty book says how to start', /No clients yet\. Press Add client to start the book\./.test(pe.els.cbTable.innerHTML) && pe.els.cbAdd.disabled === false);

  sec('6 · the card, who sees it, the site rules');
  const card = async (resp) => {
    const box = { innerHTML: '' };
    const c = { console, Date, Math, JSON, Promise, document: { getElementById: (id) => (id === 'cbcBody' ? box : null) }, localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null }, navigator: {}, location: {} };
    c.window = c; vm.createContext(c);
    ['js/flow-api.js', 'js/client-book-model.js', 'js/client-book-card.js'].forEach(f => vm.runInContext(read(f), c));
    c.__r = resp;
    vm.runInContext('flowToday = function () { return "2026-10-21"; }; postFlow = function () { return Promise.resolve(__r); };', c);
    await vm.runInContext('clientBookCard("cbcBody")', c);
    return box.innerHTML;
  };
  const cd = await card(BOOK);
  ok('the card: clients, accredited, on process, not accredited, needing an update (amber when any)', /<span class="v">3<\/span><span class="l">Clients<\/span>/.test(cd) && /<span class="v">1<\/span><span class="l">Accredited<\/span>/.test(cd) && /cbc-tile warn"><span class="v">1<\/span><span class="l">Needs an update/.test(cd), cd);
  ok('  an empty book invites the first client; without 178 it says so', /No clients yet/.test(await card({ success: true, clients: [], log: [] })) && /version 178/.test(await card({ success: false, message: 'Unknown action: getClientBook' })));

  const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');
  const navFor = (role) => {
    const store = { session: JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) };
    let html = '';
    const c = { console, window: {}, localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { href: '', pathname: '/x.html', search: '' },
      document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
        getElementById: (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } };
          if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; } },
      fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
    c.window = c; vm.createContext(c); require('./hxutil').load(c); vm.runInContext(AUTH, c); vm.runInContext(NAV, c);
    c.renderNavbar('x');
    return { classic: /href="director-client-book\.html"/.test(html), rail: vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', c).indexOf('director-client-book.html') >= 0 };
  };
  const seen = ['director', 'admin', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing'].filter(r => { const n = navFor(r); return n.classic || n.rail; });
  eq('only the director\'s navbar and rail link it', seen, ['director']);
  const H = read('director-client-book.html'), JS = read('js/client-book.js'), M = read('js/client-book-model.js'), CARD = read('js/client-book-card.js'), CSS = read('css/client-book.css');
  ok('director only: requireDirector, and its own navbar entry', /requireDirector\(\)/.test(JS) && /renderNavbar\('director-client-book'\)/.test(JS));
  eq('scripts in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,client-rollup.js,client-book-model.js,client-book.js');
  ok('its own stylesheet, before ledger.css and apple.css (last)', /css\/client-book\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H));
  const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
  const named = (src) => { const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, ''); return HANDLERS.filter(h => new RegExp("'" + h + "'").test(code)).sort(); };
  eq('of ' + HANDLERS.length + ' FlowAPI actions the page names only its own four, the daily reports and plain reads', named(JS + M), ['archiveClientBookClient', 'getActivityLog', 'getClientBook', 'getClients', 'getPricingRequests', 'getProofReports', 'getQuotations', 'getSalesOrders', 'saveClientBookClient', 'setClientBookStatus']);
  eq('  the card names only getClientBook', named(CARD), ['getClientBook']);
  ok('  nothing writes the real client list, PRs or quotations', !/addClient|updateClient|saveClient\b|savePricingRequest|updateQuotation|closeQuotation|setLgAccred|logSalesCall/.test(JS + M + CARD));
  const SRC = H + JS + M + CARD;
  ok('no emoji, no hex colour, no inline style, no inline script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{3,6}\b/.test(SRC.replace(/&#\d+;/g, '')) && !/style="/.test(SRC) && !/<script>/.test(H) && !/onclick=/.test(SRC));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
