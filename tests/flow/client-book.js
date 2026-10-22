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
    { clientNo: 'CB-0001', company: 'Philcement Corporation', key: 'philcement', tier: 'Major', sector: 'Cement', siteAddress: 'Brgy. Bigte, Norzagaray, Bulacan', owner: G, accreditation: 'Accredited', accreditationStep: '', accreditedUntil: '2026-11-10',
      accreditationUpdatedAt: '2026-10-05T02:00:00.000Z', status: 'RFQ received', statusUpdatedAt: '2026-10-10T02:00:00.000Z', statusRef: 'PR-1', nextStep: '', nextStepDate: '',
      contacts: [{ id: 'P1', name: 'Ana Cruz', position: 'Purchasing', emails: ['ana@philcement.ph', 'ana.cruz@gmail.com'], phones: ['0917 123 4567'], primary: true },
                 { id: 'P2', name: 'Ben', position: '', emails: [], phones: ['(02) 8555-1212'], primary: false }],
      notes: '', createdAt: '2026-10-01T01:00:00.000Z', updatedAt: '2026-10-10T02:00:00.000Z', archivedAt: '' },
    { clientNo: 'CB-0002', company: 'Zeta Mining', key: 'zeta mining', tier: 'Minor', sector: 'Geothermal drilling', owner: K, accreditation: 'On process', accreditationStep: 'Documents submitted', accreditedUntil: '',
      status: '', nextStep: 'Call purchasing about the forms', nextStepDate: '2026-10-20', contacts: [], createdAt: '2026-10-01T01:00:00.000Z', updatedAt: '2026-10-01T01:00:00.000Z', archivedAt: '' },
    { clientNo: 'CB-0003', company: 'PHILCEMENT CORP.', key: 'philcement', owner: '', accreditation: 'Not accredited', status: '', contacts: [],
      createdAt: '2026-10-21T01:00:00.000Z', updatedAt: '2026-10-21T01:00:00.000Z', archivedAt: '' },
    { clientNo: 'CB-0004', company: 'Gone Co', key: 'gone', tier: 'Minor', owner: G, accreditation: 'Not accredited', status: '', contacts: [],
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
           status: ['RFQ pending', 'RFQ received', 'Quotation sent', 'Following up', 'Negotiating', 'PO received', 'Lost', 'On hold', 'No requirement now'] }
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
ok('  and, A354, it is offered though the client is still on process (the status is its own label)', S2.suggest === true);
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
eq('the summary leaves archived clients out', J('cbSummary(CL, LOG, "2026-10-21")'), { total: 3, major: 1, minor: 1, noLabel: 1, accredited: 1, onProcess: 1, notAccredited: 1, needsUpdate: 1, expiring: 1, nextOverdue: 1, archived: 1 });
const ids = (f) => J('cbFilter(CL, LOG, IX, ' + JSON.stringify(f) + ').map(function (c) { return c.clientNo; })');
eq('newest update first by default', ids({}), ['CB-0003', 'CB-0001', 'CB-0002']);
eq('search finds a contact\'s second email', ids({ q: 'ana.cruz@gmail' }), ['CB-0001']);
eq('  and a phone typed another way', ids({ q: '8555 1212' }), ['CB-0001']);
eq('  and a contact\'s name', ids({ q: 'ben' }), ['CB-0001']);
eq('accreditation, needs an update, expiring, next step', [ids({ accreditation: 'On process' }), ids({ flag: 'needsUpdate' }), ids({ flag: 'expiring' }), ids({ sort: 'next' })[0]], [['CB-0002'], ['CB-0002'], ['CB-0001'], 'CB-0002']);
eq('archived clients only when asked for', ids({ archived: true }), ['CB-0004']);
{
  const csv = run('cbCsv(cbFilter(CL, LOG, IX, {}), LOG, IX)').split('\n');
  ok('CSV: a header and one row per client', csv.length === 4 && /^Client No,Company,Major or minor,Sector,Site address,Owner,Accreditation/.test(csv[0]) && /^CB-0001,Philcement Corporation,Major,Cement,"Brgy\. Bigte, Norzagaray, Bulacan",/.test(csv.find(l => /^CB-0001,/.test(l))));
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
  const p = page(['js/client-rollup.js', 'js/client-book-model.js', 'js/client-book.js'], 'director-client-book.html', o.session || { username: 'neil', name: 'Neil Estur', role: 'director' },
    { data: { getQuotations: RAW.quotations, getPricingRequests: RAW.prs, getSalesOrders: RAW.salesOrders, getClients: RAW.clients, getActivityLog: [] } });
  ['cbQ', 'cbSector', 'cbStatus', 'cbOwner', 'cbSort'].forEach(id => { p.els[id] = Object.assign(stubEl(), { id }); });
  p.ctx.__book = o.book || BOOK; p.ctx.__reports = REPORTS; p.ctx.__stub = stubEl;
  p.ctx.__ask = o.ask || null;
  p.ctx.__v = o.v || 180;
  p.run(`requireClientBookAccess = function () { return __session; };
    flowToday = function () { return "2026-10-21"; };
    flowVersionAtLeast = function (n) { return Promise.resolve(n <= __v); };
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
  ok('  a row, three short lines: the company and its last update; label, sector, town, owner; accreditation (until), status, records',
     /<span class="cb-name">Philcement Corporation<\/span><span class="cb-when">10 Oct<\/span><\/span><span class="cb-r2">Major · Cement · Norzagaray, Bulacan · Gerald Lucena<\/span><span class="cb-r3"><span class="cb-badge ok">Accredited<\/span> <span class="cb-warnt">until 10 Nov 2026<\/span> <span class="cb-badge mid">RFQ received<\/span> <span>1 PR · 1 quotation · ₱186,400 open<\/span>/.test(T), T.slice(0, 1200));
  ok('  the records\' suggestion shows on the row', /Records say: Following up/.test(T));
  ok('  on process: the step beside the badge, and no sales status', /<span class="cb-badge mid">On process<\/span> Documents submitted <span>1 PR · 1 quotation<\/span><\/span>/.test(T));
  ok('  flags on a fourth line: a possible duplicate, a stale client, an overdue next step', /<span class="cb-flag">Possible duplicate<\/span>/.test(T) && /<span class="cb-flag">Not updated in 20 days<\/span>/.test(T) && /<span class="cb-flag">Next step overdue \(20 Oct 2026\)<\/span>/.test(T));
  ok('the chips count, and All is on', /data-chip="all" aria-pressed="true">All clients <span class="n">3<\/span>/.test(p.els.cbChips.innerHTML) && /Needs an update <span class="n">1<\/span>/.test(p.els.cbChips.innerHTML) && /Archived <span class="n">1<\/span>/.test(p.els.cbChips.innerHTML));
  eq('the list says how many clients it holds', p.els.cbFoot.textContent, '3 clients');
  ok('the filters are drawn once, with the owners from the roster (sales only) and the book', /id="cbQ"/.test(p.els.cbFilters.innerHTML) && /Gerald Lucena/.test(p.els.cbOwner.innerHTML) && /Kim Reyes/.test(p.els.cbOwner.innerHTML) && !/Neil Estur/.test(p.els.cbOwner.innerHTML));
  p.run('cbChip("a:On process")');
  ok('a chip filters the list', (p.els.cbTable.innerHTML.match(/data-open="/g) || []).length === 1 && /Zeta Mining/.test(p.els.cbTable.innerHTML) && /data-chip="a:On process" aria-pressed="true"/.test(p.els.cbChips.innerHTML) && p.els.cbFoot.textContent === '1 of 3 clients');
  p.run('cbChip("archived")');
  ok('  Archived shows only the archived', /Gone Co/.test(p.els.cbTable.innerHTML) && (p.els.cbTable.innerHTML.match(/data-open="/g) || []).length === 1 && /class="cb-open archived"/.test(p.els.cbTable.innerHTML) && p.els.cbFoot.textContent === '1 client, archived');
  p.run('cbChip("all")');

  p.run('cbDetail("CB-0001", null)');
  const d1 = p.run('__shown');
  ok('the detail: four tabs — the overview (accreditation, sales status, next step, records, main contact, the daily report), the records, contacts and details, the timeline with archive',
     ['role="tablist"', 'data-tab="overview"', 'data-tab="records"', 'data-tab="contacts"', 'data-tab="timeline"', '<span class="cb-fk">Accreditation</span>', '<span class="cb-fk">Sales status</span>', '<span class="cb-fk">Next step</span>',
      '<span class="cb-fk">Portal records</span>', '<span class="cb-fk">Main contact</span>', 'id="cbRecs"', '<h4>From the Sales Daily Report</h4>', '<h4>Contacts and details</h4>', '<h4>Timeline</h4>', 'Archive this client'].every(s => d1.includes(s)));
  ok('  only the Overview shows; the other tabs wait, and every form waits behind its own button',
     /id="cbPanel-overview" aria-labelledby="cbTab-overview">/.test(d1) && ['records', 'contacts', 'timeline'].every(t => new RegExp('id="cbPanel-' + t + '" aria-labelledby="cbTab-' + t + '" hidden>').test(d1)) &&
     /data-kind="accreditation" id="cbAccForm" hidden>/.test(d1) && /data-kind="status" id="cbStatusForm" hidden>/.test(d1) && /<form class="cb-form" id="cbEdit" autocomplete="off" hidden>/.test(d1) &&
     /data-reveal="cbAccForm" aria-expanded="false" aria-controls="cbAccForm">Update</.test(d1) && /data-reveal="cbEdit" aria-expanded="false" aria-controls="cbEdit">Edit details and contacts</.test(d1));
  ok('  the tabs are a tab list: one selected and in the tab order, each naming its panel, with counts',
     /id="cbTab-overview" aria-controls="cbPanel-overview" aria-selected="true" tabindex="0"/.test(d1) && /id="cbTab-timeline" aria-controls="cbPanel-timeline" aria-selected="false" tabindex="-1"/.test(d1) &&
     /data-tab="records">Records <span class="n">3<\/span>/.test(d1) && /data-tab="contacts">Contacts <span class="n">2<\/span>/.test(d1));
  ok('  the people read at a glance, their emails and phones ready to tap', /<a href="mailto:ana@philcement\.ph">ana@philcement\.ph<\/a>/.test(d1) && /<a href="tel:09171234567">0917 123 4567<\/a>/.test(d1) &&
     /<span class="cb-pname">Ana Cruz <span class="cb-badge mid">Main<\/span><\/span>/.test(d1) && /data-goto="contacts">All 2</.test(d1) && /data-goto="records">See them</.test(d1));
  p.run('CB.tab = "contacts"; cbDetail("CB-0002", null)');
  ok('  the tab you are on is kept when you open another client', /id="cbPanel-contacts" aria-labelledby="cbTab-contacts">/.test(p.run('__shown')) && /id="cbPanel-overview" aria-labelledby="cbTab-overview" hidden>/.test(p.run('__shown')));
  p.run('CB.tab = "overview"');
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
  ok('A354: a client not yet accredited has both forms — the accreditation and the sales status are separate labels', !/The sales status starts once/.test(d3) && /data-kind="status"/.test(d3) && /data-kind="accreditation"/.test(d3));
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

  sec('5b · A354: Major or Minor, the sector, the site; accreditation and status apart');
  const pt = await boot();
  const PT = pt.els.cbTable.innerHTML;
  ok('every row shows its label; a client without one says so (quietly)', /<span class="cb-r2">Major · /.test(PT) && /<span class="cb-r2">Minor · /.test(PT) && /<span class="cb-nolabel">No label<\/span>/.test(PT));
  ok('Major and Minor are chips with their counts', /data-chip="t:Major" aria-pressed="false">Major <span class="n">1<\/span>/.test(pt.els.cbChips.innerHTML) &&
     /data-chip="t:Minor" aria-pressed="false">Minor <span class="n">1<\/span>/.test(pt.els.cbChips.innerHTML));
  pt.run('cbChip("t:Major")');
  ok('  a chip shows only those clients', (pt.els.cbTable.innerHTML.match(/data-open="/g) || []).length === 1 && /Philcement Corporation/.test(pt.els.cbTable.innerHTML) &&
     /data-chip="t:Major" aria-pressed="true"/.test(pt.els.cbChips.innerHTML));
  eq('  and the model filters the same way', J('cbFilter(CL, LOG, IX, { tier: "Minor" }).map(function (c) { return c.clientNo; })'), ['CB-0002']);
  pt.run('cbAddDialog(null)');
  const ta = pt.run('__shown');
  ok('adding a client asks Major or Minor, and requires it', /<legend>Major or minor client<\/legend>/.test(ta) && /name="tier" value="Major" required>/.test(ta) && /name="tier" value="Minor" required>/.test(ta));
  pt.run('cbDetail("CB-0001", null)');
  const td = pt.run('__shown');
  ok('the detail shows the label, and the details form can change it', /<p class="cb-sub"><span class="cb-labels"><span class="cb-badge tier-major">Major<\/span><span class="cb-badge sector">Cement<\/span>/.test(td) && /Site: Brgy\. Bigte/.test(td) && /name="tier" value="Major" checked>/.test(td) && !/value="Major" checked required/.test(td));
  ok('every row shows its sector too ("No sector" when missing), and a typed industry as typed', /Major · Cement · /.test(PT) && /Minor · Geothermal drilling · /.test(PT) && /<span class="cb-nolabel">No sector<\/span>/.test(PT));
  eq('the Sector filter: a listed one, and Others for a typed industry', [J('cbFilter(CL, LOG, IX, { sector: "Cement" }).map(function (c) { return c.clientNo; })'), J('cbFilter(CL, LOG, IX, { sector: "Others" }).map(function (c) { return c.clientNo; })')], [['CB-0001'], ['CB-0002']]);
  ok('  the search finds a site address', J('cbFilter(CL, LOG, IX, { q: "norzagaray" }).map(function (c) { return c.clientNo; })').join() === 'CB-0001');
  ok('adding a client asks the industry (required) and the site address', /<select class="cb-in" name="sector" required><option value="">Choose…<\/option><option>Oil and gas<\/option>/.test(ta) && /<option>Others<\/option>/.test(ta) &&
     /name="sectorOther"/.test(ta) && /name="siteAddress"/.test(ta));
  pt.run('cbDetail("CB-0002", null)');
  const t2 = pt.run('__shown');
  ok('a typed industry opens as Others with its name filled in', /<option selected>Others<\/option>/.test(t2) && /name="sectorOther" maxlength="60" value="Geothermal drilling"/.test(t2) && !/class="cb-other" hidden/.test(t2));
  ok('the detail header carries the labels apart: Major/Minor, sector, accreditation, status', /<p class="cb-sub"><span class="cb-labels"><span class="cb-badge tier-minor">Minor<\/span><span class="cb-badge sector">Geothermal drilling<\/span><\/span> <span class="cb-badge mid">On process<\/span>/.test(t2), t2.slice(0, 500));
  const pv = await boot({ v: 179 });
  pv.run('cbAddDialog(null)');
  ok('before FlowAPI 180 the choices are shown but switched off, and say why', /name="tier" value="Major" disabled>/.test(pv.run('__shown')) && /saved once the FlowAPI update \(180\)/.test(pv.run('__shown')) &&
     /name="sector" disabled>/.test(pv.run('__shown')) && /name="siteAddress"[^>]*disabled>/.test(pv.run('__shown')));

  const pd = await boot({ ask: 'CB-0002' });
  ok('a Sales Daily Report link (?client=CB-0002) opens that client', /<h3 id="cbTitle">Zeta Mining<\/h3>/.test(pd.run('__shown')));

  const po = await boot({ book: { success: false, message: 'Unknown action: getClientBook' } });
  ok('before FlowAPI 178: it says so, Add client is off, and nothing breaks', /needs the FlowAPI update \(version 178\)/.test(po.els.cbNotice.innerHTML) && po.els.cbAdd.disabled === true && /Nothing to show yet/.test(po.els.cbTable.innerHTML));
  const pe = await boot({ book: { success: true, clients: [], log: [] } });
  ok('an empty book says how to start', /No clients yet\. Press Add client to start the book\./.test(pe.els.cbTable.innerHTML) && pe.els.cbAdd.disabled === false);

  sec('5c · A358: a rep\'s own Client Book, and records linked on the PR');
  {
    const rep = await boot({ session: { username: 'sales2', name: 'Gerald Lucena', role: 'sales' } });
    const posted = rep.run('__posted.map(function (x) { return x.a; })');
    ok('a rep reads only the book (the server scopes it) — no roster, no daily reports', posted.join() === 'getClientBook' && rep.run('CB.all') === false && rep.run('CB.roster.length') === 0, posted);
    ok('  no Owner filter', !/id="cbOwner"/.test(rep.els.cbFilters.innerHTML));
    rep.run('cbAddDialog(null)');
    const ra = rep.run('__shown');
    ok('  adding a client asks no owner (the rep owns it)', !/Owner \(sales rep\)/.test(ra) && !/cbOwnerBox/.test(ra) && /name="tier"/.test(ra));
    rep.run('cbDetail("CB-0001", null)');
    const rd = rep.run('__shown');
    ok('  the detail has no owner field and no Sales Daily Report section', !/Owner \(sales rep\)/.test(rd) && !/From the Sales Daily Report/.test(rd) && /Contacts and details/.test(rd));
    const before = await boot({ session: { username: 'sales2', name: 'Gerald Lucena', role: 'sales' }, book: { success: false, message: 'The Client Book is in a trial; only director can use it.' } });
    ok('  before FlowAPI 182 a rep is told it opens with the update', /opens with the next FlowAPI update \(version 182\)/.test(before.els.cbNotice.innerHTML), before.els.cbNotice.innerHTML);
  }
  {
    C.__lraw = { today: '2026-10-21', prs: [{ prNo: 'PR-L1', customer: 'Totally Different Spelling Ltd', status: 'Quoted', salesperson: 'Gerald Lucena', date: '2026-10-19', clientNo: 'CB-0002' },
                                            { prNo: 'PR-L2', customer: 'Zeta Mining', status: 'Requested', salesperson: 'Kim Reyes', date: '2026-10-20', clientNo: 'CB-0001' }],
                 quotations: [{ quotationNo: 'Q-L1', customer: 'Totally Different Spelling Ltd', status: 'Sent', sentAt: '2026-10-20T02:00:00.000Z', total: 1000, prNo: 'PR-L1' }],
                 salesOrders: [{ soNo: 'SO-L1', customer: 'Somebody Else', quotationNo: 'Q-L1', date: '2026-10-21', total: 900 }] };
    run('var IXL = cbIndex(__lraw);');
    const Z = J('cbRecords(IXL, byNo("CB-0002"))');
    ok('A358: a PR made for a client belongs to it whatever the customer is spelled', Z.prs.some(x => x.ref === 'PR-L1' && x.linked), Z.prs);
    ok('  and so do the quotation made from it (through its PR No) and that quotation\'s sales order', Z.quotes.some(x => x.ref === 'Q-L1' && x.linked) && Z.sos.some(x => x.ref === 'SO-L1' && x.linked), [Z.quotes, Z.sos]);
    ok('  a record linked to another client is not matched to this one by name', !Z.prs.some(x => x.ref === 'PR-L2'), Z.prs);
    const P = J('cbRecords(IXL, byNo("CB-0001"))');
    ok('  it shows under the client it was made for instead', P.prs.some(x => x.ref === 'PR-L2' && x.linked));
    ok('  a record matched only by name says so', J('cbRecords(IX, byNo("CB-0001"))').prs.every(x => x.linked === false));
  }

  sec('5d · A360: old purchase requests and quotations connected by hand');
  {
    const CBJS = read('js/client-book.js');
    C.__araw = { today: '2026-10-21',
      prs: [{ prNo: 'PR-A1', customer: 'Holcim Phils. Inc.', status: 'Quoted', salesperson: G, date: '2026-03-01' },
            { prNo: 'PR-A2', customer: 'Holcim Davao', status: 'Quoted', salesperson: G, date: '2026-03-02' },
            { prNo: 'PR-A3', customer: 'Holcim Davao Plant', status: 'Quoted', salesperson: K, date: '2026-03-03' },
            { prNo: 'PR-A4', customer: 'Holcim', status: 'Quoted', salesperson: G, date: '2026-03-04', clientNo: 'CB-H' },
            { prNo: 'PR-A5', customer: 'Holcim Davao', status: 'Requested', requestedBy: G, date: '2026-03-05' }],
      quotations: [{ quotationNo: 'Q-A1', customer: 'HOLCIM PHIL', status: 'Sent', date: '2026-03-06', total: 100, salesperson: G },
                   { quotationNo: 'Q-A2', customer: 'Holcim', status: 'Sent', date: '2026-03-07', total: 200, salesperson: G, prNo: 'PR-A4' },
                   { quotationNo: 'Q-A3', customer: 'Other Co', status: 'Sent', date: '2026-03-08', total: 300, salesperson: G }],
      salesOrders: [{ soNo: 'SO-A1', customer: 'Somebody', quotationNo: 'Q-A3', date: '2026-03-09', total: 290 }] };
    C.__hol = { clientNo: 'CB-H', company: 'Holcim Philippines', owner: G };
    const recs = (links) => { C.__alinks = links; return J('cbRecords(cbIndex(Object.assign({}, __araw, { links: __alinks })), __hol)'); };
    const refs = (x) => x.prs.concat(x.quotes, x.sos).map(y => y.ref + ':' + (y.linked ? y.how : 'name')).sort();
    eq('without links: the PR made for it, its quotation through the PR, and the name matches', refs(recs([])), ['PR-A1:name', 'PR-A4:made', 'Q-A1:name', 'Q-A2:pr']);
    eq('connected by hand: a PR under another spelling joins, and a quotation\'s sales order follows it', refs(recs([{ kind: 'pr', no: 'PR-A2', clientNo: 'CB-H' }, { kind: 'quotation', no: 'Q-A3', clientNo: 'CB-H' }])),
       ['PR-A1:name', 'PR-A2:linked', 'PR-A4:made', 'Q-A1:name', 'Q-A2:pr', 'Q-A3:linked', 'SO-A1:quotation']);
    eq('taken off: a record is no client\'s, not even by its name', refs(recs([{ kind: 'pr', no: 'PR-A1', clientNo: '' }, { kind: 'quotation', no: 'Q-A2', clientNo: '' }])), ['PR-A4:made', 'Q-A1:name']);
    eq('  a PR taken off takes its quotation with it', refs(recs([{ kind: 'pr', no: 'PR-A4', clientNo: '' }])), ['PR-A1:name', 'Q-A1:name']);
    eq('  a row beats the PR\'s own client, and a quotation\'s own row beats its PR\'s', refs(recs([{ kind: 'pr', no: 'PR-A4', clientNo: 'CB-X' }, { kind: 'quotation', no: 'Q-A2', clientNo: 'CB-H' }])), ['PR-A1:name', 'Q-A1:name', 'Q-A2:linked']);
    eq('similar names: words added, or nearly the same spelling — never sister firms or two plants that only share a word',
       J('[cbNear("Holcim Philippines", "Holcim Davao"), cbNear("Aboitiz", "Aboitiz Power Corp"), cbNear("SN", "SN Aboitiz"), cbNear("Itogon Soyuc", "ITOGON SUYOC"), cbNear("Holcim", "HOLCIM PHILS INC"), cbNear("Therma Luzon", "Therma Visayas, Inc."), cbNear("Therma Luzon", "THERMA MARINE"), cbNear("Davao Power", "Mindanao Power")]'),
       [true, true, true, true, false, false, false, false]);
    C.__alinks = [{ kind: 'pr', no: 'PR-A2', clientNo: 'CB-H' }];
    run('var IXA = cbIndex(Object.assign({}, __araw, { links: __alinks }));');
    const find = (o) => J('cbFindRecords(IXA, __hol, ' + JSON.stringify(o) + ').items').map(x => x.ref);
    eq('suggestions for Gerald: his own similar names not on a client (Kim\'s and the linked one left out)', find({ me: G }), ['PR-A5']);
    eq('  the director is offered Kim\'s too', find({ all: true }), ['PR-A5', 'PR-A3']);
    eq('search: every word in the number or the company', [find({ me: G, q: 'other' }), find({ me: G, q: 'q-a3' }), find({ me: G, q: 'holcim davao' })], [['Q-A3'], ['Q-A3'], ['PR-A5']]);
    eq('  a rep never finds another rep\'s record; the director does', [find({ me: G, q: 'PR-A3' }), find({ all: true, q: 'PR-A3' })], [[], ['PR-A3']]);
    C.__hol2 = { clientNo: 'CB-H2', company: 'Holcim Two', owner: G };
    eq('  a record on a client the rep cannot see is not offered to move; one on their own is', [J('cbFindRecords(IXA, __hol2, { me: ' + JSON.stringify(G) + ', q: "PR-A2" }).items').length,
       J('cbFindRecords(IXA, __hol2, { me: ' + JSON.stringify(G) + ', q: "PR-A2", clientNos: { "CB-H": 1 } }).items').length], [0, 1]);
    eq('the timeline names the change', J('[cbLogText({ kind: "linked" }), cbLogText({ kind: "unlinked" })]'), ['Connected', 'Taken off this client']);

    const v183 = await boot({ v: 183 });
    v183.run('cbDetail("CB-0001", null)');
    const d = v183.run('__shown');
    ok('the page from FlowAPI 183: Link on each record matched by name, none on a sales order', /data-link="pr\|PR-1">Link</.test(d) && /data-link="quotation\|Q-1">Link</.test(d) && !/data-link="so/.test(d) && !/read only/.test(d));
    ok('  "Link all 2 matched by name", and the finder', /data-linkall>Link all 2 matched by name</.test(d) && /Connect a past purchase request or quotation/.test(d) && /<input type="search" class="cb-in" data-find/.test(d) && /<div data-found><\/div>/.test(d));
    const linked = await boot({ v: 183, book: Object.assign({}, BOOK, { links: [{ kind: 'pr', no: 'PR-1', clientNo: 'CB-0001' }] }) });
    linked.run('cbDetail("CB-0001", null)');
    const dl = linked.run('__shown');
    ok('  a connected record says so and offers Take off', /PR-1<\/a> <span class="cb-badge ok">Linked<\/span>/.test(dl) && /data-unlink="pr\|PR-1">Take off</.test(dl) && !/data-linkall/.test(dl));
    const old = await boot({ v: 182 });
    old.run('cbDetail("CB-0001", null)');
    ok('  before 183: read only, no buttons', /<p class="cb-sub cb-ro">Read only\.<\/p>/.test(old.run('__shown')) && !/data-link|data-find/.test(old.run('__shown')));
    const kim = await boot({ v: 183, session: { username: 'kim', name: K, role: 'sales' } });
    kim.run('cbDetail("CB-0002", null)');
    const dk = kim.run('__shown');
    ok('  a rep gets Link only on her own records', /data-link="pr\|PR-2"/.test(dk) && /data-link="quotation\|Q-2"/.test(dk));
    kim.run('cbDetail("CB-0001", null)');
    ok('  and none on Gerald\'s', !/data-link=/.test(kim.run('__shown').split('Connect a past')[0]));
    ok('the buttons send one record, all of them, or take one off; the page reads the book again after',
       /send\(b, 'linkClientBookRecords', \{ clientNo: no, records: JSON\.stringify\(loose\.map\(x => \(\{ kind: x\.kind, no: x\.ref \}\)\)\) \}/.test(CBJS)
       && /send\(b, 'linkClientBookRecords', \{ clientNo: no, records: JSON\.stringify\(\[\{ kind, no: ref \}\]\) \}/.test(CBJS) && /send\(b, 'unlinkClientBookRecord', \{ kind, no: ref \}/.test(CBJS)
       && /const res = await cbPost\(recs, action, params\);/.test(CBJS));
    ok('  and the book\'s links are indexed every time it is read', /CB\.ix = cbIndex\(Object\.assign\(\{\}, CB\.raw \|\| \{\}, \{ links: CB\.ok \? book\.links \|\| \[\] : \[\] \}\)\);/.test(CBJS));
  }

  sec('5e · A361: clients imported without a label');
  {
    C.__nl = [{ clientNo: 'N1', company: 'A', tier: '' }, { clientNo: 'N2', company: 'B', tier: 'Major' }, { clientNo: 'N3', company: 'C' }, { clientNo: 'N4', company: 'D', archivedAt: '2026-10-01' }];
    eq('the summary counts the live clients with no Major / Minor label', J('cbSummary(__nl, [], "2026-10-21").noLabel'), 2);
    eq('  and the "No label" filter lists just those', J('cbFilter(__nl, [], cbIndex({ today: "2026-10-21" }), { tier: "none" }).map(function (c) { return c.clientNo; })').sort(), ['N1', 'N3']);
    const p5 = await boot({ v: 183, book: Object.assign({}, BOOK, { clients: BOOK.clients.concat([{ clientNo: 'CB-0009', company: 'Imported Co', owner: G, accreditation: 'Not accredited', contacts: [], createdAt: '2026-10-22T01:00:00.000Z', archivedAt: '' }]) }) });
    ok('  a "No label" chip appears while any client has none', /data-chip="t:none" aria-pressed="false">No label <span class="n">2<\/span>/.test(p5.els.cbChips.innerHTML), p5.els.cbChips.innerHTML.slice(0, 400));
    const p6 = await boot({ v: 183 });
    ok('  and goes once every client has one', /data-chip="t:none"/.test(p6.els.cbChips.innerHTML) === (J('cbSummary(' + JSON.stringify(BOOK.clients) + ', [], "2026-10-21").noLabel') > 0));
  }

  sec('5f · A362: the page fits the window — a list beside the client, the client in tabs');
  {
    const H = read('director-client-book.html'), CSS = read('css/client-book.css'), JS = read('js/client-book.js');
    ok('the page: a header, the one-line toolbar, the chips, then the list and the client side by side (no table)',
       /<header class="cb-head">[\s\S]*<h1 id="cbH1">Client Book<\/h1>[\s\S]*id="cbFilters" role="search"[\s\S]*id="cbChips"[\s\S]*<div class="cb-split" id="cbSplit">\s*<section class="cb-listcol" aria-label="Clients">\s*<p class="cb-count" id="cbFoot" aria-live="polite"><\/p>\s*<div class="cb-list" id="cbTable" role="list"><\/div>\s*<\/section>\s*<section class="cb-pane" id="cbPane"/.test(H) && !/<table/.test(H));
    ok('  the toolbar names its fields for screen readers without printing them', /<span class="cb-sr">Search<\/span>/.test(JS) && /<span class="cb-sr">Sector<\/span>/.test(JS) && /'Sort: last update'/.test(JS));
    ok('  side by side from 1180px, each side scrolling on its own, the height set to fit the window',
       /@media \(min-width: 1180px\) \{\s*\.cb-split \{ display: grid; grid-template-columns: minmax\(320px, 380px\) minmax\(0, 1fr\); gap: 16px; height: var\(--cb-h/.test(CSS) && /\.cb-listcol, \.cb-pane \{ display: block; min-height: 0; overflow-y: auto; overscroll-behavior: contain;/.test(CSS)
       && /const CB_SPLIT_MQ = '\(min-width: 1180px\)';/.test(JS) && /sp\.style\.setProperty\('--cb-h'/.test(JS));
    ok('  narrower, the client opens as a sheet over the list', /\.cb-pane \{ display: none; \}/.test(CSS) && /if \(o && o\.pane && cbSplit\(\)\)/.test(JS));
    ok('  the client\'s header stays put, translucent over what scrolls under it; solid when transparency is reduced',
       /\.cb-dhead \{ position: sticky; top: 0;[\s\S]{0,260}backdrop-filter: blur\(20px\) saturate\(180%\);/.test(CSS) && /@media \(prefers-reduced-transparency: reduce\) \{ \.cb-dhead, \.cb-count \{ background: var\(--hx-card\); -webkit-backdrop-filter: none; backdrop-filter: none; \} \}/.test(CSS));
    ok('  a short settle when another client opens; a fade under reduced motion; nothing with Motion off',
       /\.cb-sheet\.cb-enter \{ animation: cb-in \.24s/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{ \.cb-sheet\.cb-enter \{ animation: cb-fade/.test(CSS) && /html\[data-motion="off"\] \.cb-sheet\.cb-enter \{ animation: none; \}/.test(CSS));
    ok('  each showing is a fresh element, so listeners never pile up', /pane\.innerHTML = '<div class="cb-sheet cb-detail'/.test(JS) && /return pane\.firstChild;/.test(JS) && /return box\.firstChild;/.test(JS));
    ok('  the tabs answer the arrow keys, Home and End; the list answers up and down', /e\.key === 'ArrowRight' \? 1 : e\.key === 'ArrowLeft' \? -1 : 0/.test(JS) && /e\.key === 'Home' \? 0 : e\.key === 'End'/.test(JS) && /function cbListKeys\(e\)/.test(JS));
    const sp = await boot();
    eq('without a wide window the client is a sheet; with one, beside the list', [sp.run('cbSplit()'), sp.run('matchMedia = function (q) { return { matches: /min-width: 1180px/.test(q) }; }; cbSplit()')], [false, true]);
    eq('a day this year reads short; another year in full; a town is the last two parts of the address',
       [sp.run('cbShortDay("2026-10-05")'), sp.run('cbShortDay("2025-12-30")'), sp.run('cbPlace("Brgy. Bigte, Norzagaray, Bulacan")'), sp.run('cbPlace("")')], ['5 Oct', '30 Dec 2025', 'Norzagaray, Bulacan', '']);
    ok('a chip with nothing in it is left out (All stays)', !/data-chip="f:expiring"/.test(sp.els.cbChips.innerHTML) || /Accreditation expiring <span class="n">[1-9]/.test(sp.els.cbChips.innerHTML));
  }

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
  ok('the card: clients, Major, accredited, on process, not accredited, needing an update (amber when any)', /<span class="v">3<\/span><span class="l">Clients<\/span>/.test(cd) && /<span class="v">1<\/span><span class="l">Major<\/span>/.test(cd) && /<span class="v">1<\/span><span class="l">Accredited<\/span>/.test(cd) && /cbc-tile warn"><span class="v">1<\/span><span class="l">Needs an update/.test(cd), cd);
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
  eq('A358: the director\'s and the sales reps\' navbar and rail link it, nobody else\'s', seen, ['director', 'sales']);
  const H = read('director-client-book.html'), JS = read('js/client-book.js'), M = read('js/client-book-model.js'), CARD = read('js/client-book-card.js'), CSS = read('css/client-book.css');
  ok('A358: guarded by requireClientBookAccess (director and sales), its own navbar entry', /requireClientBookAccess\(\)/.test(JS) && /renderNavbar\('director-client-book'\)/.test(JS));
  {
    const AUTHJS = read('js/auth.js'), ctx = { window: {}, localStorage: { getItem: () => ctx.__s, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { href: '', pathname: '/x.html', search: '' }, navigator: { userAgent: 'node' }, fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
      document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} } },
      console, Date, JSON, Math, Object, Array, String, Number, Promise };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(AUTHJS, ctx);
    const admits = (role) => { ctx.__s = JSON.stringify({ username: 'u', name: 'U', role, token: 't', loginTime: Date.now() }); ctx.location.href = ''; return !!vm.runInContext('requireClientBookAccess()', ctx); };
    eq('  the guard admits the director and sales only', ['director', 'sales', 'admin', 'management', 'accounting', 'leadgen'].filter(admits), ['director', 'sales']);
  }
  eq('scripts in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,client-rollup.js,client-book-model.js,client-book.js');
  ok('its own stylesheet, before ledger.css and apple.css (last)', /css\/client-book\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H));
  const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
  const named = (src) => { const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, ''); return HANDLERS.filter(h => new RegExp("'" + h + "'").test(code)).sort(); };
  eq('of ' + HANDLERS.length + ' FlowAPI actions the page names only its own six (A360: link and take off), the daily reports and plain reads', named(JS + M), ['archiveClientBookClient', 'getActivityLog', 'getClientBook', 'getClients', 'getPricingRequests', 'getProofReports', 'getQuotations', 'getSalesOrders', 'linkClientBookRecords', 'saveClientBookClient', 'setClientBookStatus', 'unlinkClientBookRecord']);
  eq('  the card names only getClientBook', named(CARD), ['getClientBook']);
  ok('  nothing writes the real client list, PRs or quotations', !/addClient|updateClient|saveClient\b|savePricingRequest|updateQuotation|closeQuotation|setLgAccred|logSalesCall/.test(JS + M + CARD));
  const SRC = H + JS + M + CARD;
  ok('no emoji, no hex colour, no inline style, no inline script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{3,6}\b/.test(SRC.replace(/&#\d+;/g, '')) && !/style="/.test(SRC) && !/<script>/.test(H) && !/onclick=/.test(SRC));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
