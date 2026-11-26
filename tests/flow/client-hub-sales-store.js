/* A404 — the client hub's sales view (FlowAPI 203: getClientHubSales, saveClientHubTier).
 *
 * Run:  node tests/flow/client-hub-sales-store.js
 *
 * Neil, 23 Nov 2026: in the client hub, for the director and management, each client's update status from the latest
 * sales activity, who owns it, and Major / Minor (which the director and management set there, on the reps' Client Book
 * rows). Runs the real FlowAPI.gs through its dispatcher (gasload), "today" 24 Nov 2026.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt'), ANA = who('admin', 'Ana Admin', 'admin1');
const HR = who('hr', 'Jiezzel Barrios', 'hr1'), KIM = who('sales', 'Kimberlyn Blones', 'sales1');
const D = (m, d, h) => new Date(2026, m - 1, d, h || 10);
const rep = (no, user, date, lines, kind) => ({ 'Report No': no, 'Date': date, 'User': user, 'Role': 'sales', 'Kind': kind || '', 'Updated At': date + 'T17:00:00',
  'Report JSON': JSON.stringify({ lines: lines.map((l, i) => Object.assign({ id: no + '-' + i, type: 'Call', linkType: '', loggedAt: date + 'T10:00:00' }, l)) }) });

function world() {
  const busy = Array.from({ length: 12 }, (_, i) => ({ company: 'Busy Co', result: 'Reached', note: 'call ' + (i + 1) }));
  const store = {
    Clients: [{ 'Customer': 'Therma South, Inc.' }, { 'Customer': 'Aboitiz Power Corporation - TSI BU' }],
    ClientBook: [
      { 'Client No': 'CB-1', 'Company': 'THERMA SOUTH INC', 'Owner': 'Kimberlyn Blones', 'Tier': 'Major', 'Archived At': '', 'Accreditation': 'Accredited' },
      { 'Client No': 'CB-2', 'Company': 'Therma South, Inc.', 'Owner': 'Gerald Lucena', 'Tier': '', 'Archived At': '', 'Accreditation': 'On process' },
      { 'Client No': 'CB-3', 'Company': 'SMC-Malita', 'Owner': 'Kimberlyn Blones', 'Tier': '', 'Status': 'On hold', 'Status Updated At': D(11, 10), 'Archived At': '' },
      { 'Client No': 'CB-4', 'Company': 'Philex Mining', 'Owner': 'Gerald Lucena', 'Tier': 'Minor', 'Next Step': 'Send the catalogue', 'Next Step Date': '2026-11-28', 'Archived At': '' },
      { 'Client No': 'CB-5', 'Company': 'Old Archived Co', 'Owner': 'Gerald Lucena', 'Tier': 'Major', 'Archived At': D(11, 4) },
      { 'Client No': 'CB-6', 'Company': 'Petra Cement Inc.', 'Owner': 'Gerald Lucena', 'Tier': '', 'Archived At': '' },
      { 'Client No': 'CB-7', 'Company': 'Empty Co', 'Owner': 'Gerald Lucena', 'Tier': '', 'Archived At': '' },
      { 'Client No': 'CB-8', 'Company': 'Lafarge Republic', 'Owner': 'Gerald Lucena', 'Tier': '', 'Archived At': '' },
      { 'Client No': 'CB-9', 'Company': 'Busy Co', 'Owner': 'Kimberlyn Blones', 'Tier': '', 'Archived At': '' }
    ],
    ClientBookLog: [],
    ClientBookLinks: [{ 'Kind': 'quotation', 'Record No': '2026-6300', 'Client No': 'CB-6', 'By': 'Gerald Lucena', 'At': D(11, 23) }],
    Quotations: [
      { 'Quotation No': '2026-6100', 'Date': '2026-11-01', 'Customer': 'Therma South Inc.', 'Status': 'Sent', 'Sent At': D(11, 2), 'Total': 100000, 'Discount %': 10, 'Salesperson': 'Kimberlyn Blones', 'Subject': 'Torque wrench' },
      { 'Quotation No': '2026-6050', 'Date': '2026-09-28', 'Customer': 'Philex Mining Corp', 'Status': 'Lost', 'Result': 'Lost', 'Result At': D(10, 15), 'Result Reason': 'Price', 'Sent At': D(10, 1), 'Total': 50000, 'Salesperson': 'Gerald Lucena' },
      { 'Quotation No': '2026-6200', 'Date': '2026-11-21', 'Customer': 'Aboitiz Power Corporation - TSI BU', 'Status': 'Approved', 'Total': 70000, 'Salesperson': 'Gerald Lucena' },
      { 'Quotation No': '2026-6000', 'Date': '2026-08-30', 'Customer': 'SMC-Malita', 'Status': 'Sent', 'Sent At': D(9, 1), 'Total': 50000, 'Salesperson': 'Kimberlyn Blones' },
      { 'Quotation No': '2026-6300', 'Date': '2026-11-23', 'Customer': 'Petra Cmt Plant 2', 'Status': 'Sent', 'Sent At': D(11, 23), 'Total': 20000, 'Salesperson': 'Gerald Lucena' }
    ],
    SalesOrders: [
      { 'SO No': 'SO-1', 'Quotation No': '2026-6000', 'Date': '2026-09-20', 'Customer': 'SMC-Malita', 'Status': 'Open', 'Total': 50000, 'Client PO No': 'PO-77' },
      { 'SO No': 'SO-2', 'Quotation No': '', 'Date': '2026-11-22', 'Customer': 'Philex Mining', 'Status': 'Cancelled', 'Total': 1 }
    ],
    PricingRequests: [{ 'PR No': 'PR-1', 'Date': '2026-11-18', 'Customer': 'Philex Mining', 'Status': 'Pending', 'Salesperson': 'Gerald Lucena', 'Client Book No': 'CB-4' }],
    ProofReports: [
      rep('R-0', 'Gerald Lucena', '2026-04-01', [{ company: 'Empty Co', result: 'Reached', note: 'too old to count' }]),
      rep('R-1', 'Gerald Lucena', '2026-10-01', [{ company: 'Lafarge Republic Inc', result: 'Reached', note: 'no project yet', nextDate: '2026-10-08', nextAction: 'Call back' }]),
      rep('R-2', 'Gerald Lucena', '2026-11-12', [{ company: 'Philex Mining', result: 'RFQ promised', nextDate: '2026-11-14', nextAction: 'Get the RFQ', linkType: 'client', linkId: 'CB-4' }]),
      rep('R-3', 'Kimberlyn Blones', '2026-11-15', [{ company: 'SMC Malita', result: 'Reached', note: 'restart talks' }, { company: 'New Prospect Co', result: 'No answer' },
        { company: 'Empty Co', result: 'Reached', note: 'voided line', voidedAt: '2026-11-15T11:00:00' }]),
      rep('R-4', 'Kimberlyn Blones', '2026-11-20', [{ company: 'Therma South', person: 'Joe Cruz', result: 'Reached', note: 'reviewing the quote', nextDate: '2026-11-27',
        nextAction: 'Call for the decision', linkType: 'client', linkId: 'CB-1' }].concat(busy)),
      rep('R-5', 'Ana Admin', '2026-11-21', [{ company: 'Empty Co', result: 'Reached', note: 'admin report' }], 'admin')
    ],
    VisitPlans: [
      { 'Visit Plan No': 'VP-1', 'Date': '2026-11-26', 'User': 'Gerald Lucena', 'Client No': 'CB-4', 'Company': 'Philex Mining', 'Status': 'Approved' },
      { 'Visit Plan No': 'VP-2', 'Date': '2026-11-20', 'User': 'Kimberlyn Blones', 'Client No': 'CB-1', 'Company': 'Therma South', 'Status': 'Done', 'Done At': D(11, 20, 15) }
    ],
    FlowSettings: []
  };
  const c = load(GS, store);
  c._now = () => D(11, 24, 10);
  return { c, store };
}
const sales = (c, a) => call(c, 'getClientHubSales', a || NEIL);
const of = (r, key) => r.clients.find(x => x.key === key);

sec('1 · the version, and who may read it');
{
  const { c, store } = world();
  ok('getVersion = 204', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 204);
  [NEIL, LARRY].forEach(a => ok(a.actorRole + ' reads it', sales(c, a).success));
  [ANA, HR, KIM, who('accounting', 'X', 'acc1')].forEach(a => ok(a.actorRole + ' is refused', !sales(c, a).success && /director, management/.test(sales(c, a).message)));
  ok('the read is secured', !call(c, 'getClientHubSales', Object.assign({ flowSecret: '' }, NEIL)).success);
  const h = call(c, 'getClientHub', NEIL), ha = call(c, 'getClientHub', ANA), hh = call(c, 'getClientHub', HR);
  ok('getClientHub tells the director and management they have the sales view and the label', h.may.sales === true && h.may.tier === true && call(c, 'getClientHub', LARRY).may.tier === true);
  ok('  and admin and HR that they do not', ha.may.sales === false && ha.may.tier === false && hh.may.sales === false && hh.may.tier === false);
  const before = JSON.stringify(store.ClientBook), logs = store.ClientBookLog.length;
  sales(c);
  ok('a read writes nothing', JSON.stringify(store.ClientBook) === before && store.ClientBookLog.length === logs);
  const w2 = world(); w2.store.FlowSettings = [{ 'Key': 'clientHubSalesRoles', 'Value': 'director' }];
  ok('FlowSettings clientHubSalesRoles narrows it', sales(w2.c, NEIL).success && !sales(w2.c, LARRY).success && call(w2.c, 'getClientHub', LARRY).may.sales === false);
  const w3 = world(); w3.store.FlowSettings = [{ 'Key': 'clientHub', 'Value': 'off' }];
  ok('the hub switched off closes it too', /switched off/.test(sales(w3.c).message));
}

sec('2 · the status, worked out from the records');
{
  const { c } = world(), r = sales(c);
  ok('the reply carries the quiet days and the labels', r.quietDays === 30 && r.salesDays === 180 && r.tiers.join() === 'Major,Minor,Developing' && r.may.tier === true && r.today === '2026-11-24');
  const t = of(r, 'therma south');
  ok('Therma South: quotation sent 2 Nov, a call after it on 20 Nov → Following up', t && t.stage === 'Following up' && t.stageDay === '2026-11-20', t);
  ok('  both reps own it; their labels differ (Major / none) → mixed', t.owners.join() === 'Kimberlyn Blones,Gerald Lucena' && t.tier === 'mixed' && t.rows.length === 2, t.rows);
  ok('  the latest update is the 20 Nov visit or call, 4 days ago', t.latest.day === '2026-11-20' && t.quiet === 4 && /Visit|Call/.test(t.latest.kind), t.latest);
  ok('  the call reads person · result · note, by Kimberlyn', t.updates.some(u => u.kind === 'Call' && u.text === 'Joe Cruz · Reached · reviewing the quote' && u.by === 'Kimberlyn Blones'), t.updates);
  ok('  the visit plan done that day is listed once, as a visit', t.updates.filter(u => u.kind === 'Visit').length === 1);
  ok('  the quotation reads net of discount, with its subject', t.updates.some(u => u.ref === '2026-6100' && u.text === 'Sent quotation 2026-6100 (Torque wrench) · ₱90,000'), t.updates);
  ok('  next: the call promised for 27 Nov', t.next && t.next.day === '2026-11-27' && t.next.text === 'Call for the decision' && t.next.overdue === false, t.next);
  const s = of(r, 'smc malita');
  ok('SMC-Malita: order 20 Sep (PO received), the rep\'s On hold on 10 Nov, a call on 15 Nov → Contacted', s.stage === 'Contacted' && s.stageDay === '2026-11-15', s);
  ok('  the order is listed with its PO, and the rep\'s status too', s.updates.some(u => u.kind === 'Order' && u.text === 'Sales order SO-1 · ₱50,000 · their PO PO-77' && u.by === 'Kimberlyn Blones') &&
     s.updates.some(u => u.kind === 'Status' && /On hold/.test(u.text)), s.updates);
  const p = of(r, 'philex mining');
  ok('Philex: lost 15 Oct, RFQ promised 12 Nov, the request on 18 Nov → RFQ received', p.stage === 'RFQ received' && p.stageDay === '2026-11-18', p);
  ok('  the call is matched by its Client Book link; the cancelled order is not listed', p.updates.some(u => u.text === 'RFQ promised') && !p.updates.some(u => /SO-2/.test(u.text)), p.updates);
  ok('  the lost quotation keeps its reason', p.updates.some(u => u.kind === 'Lost' && /Price/.test(u.text)));
  ok('  next: the visit planned for 26 Nov comes before the Client Book\'s next step on 28 Nov', p.next.day === '2026-11-26' && p.next.text === 'Visit', p.next);
  ok('  Major / Minor from the book: Minor', p.tier === 'Minor');
  const a = of(r, 'aboitiz power tsi bu');
  ok('Aboitiz TSI (no rep): a quotation approved but not sent → RFQ received, no owner', a && a.stage === 'RFQ received' && a.owners.length === 0 && a.tier === '' && /Preparing/.test(a.latest.text), a);
  const pe = of(r, 'petra cement');
  ok('Petra: a quotation under another spelling, connected by hand → Quotation sent, yesterday', pe.stage === 'Quotation sent' && pe.quiet === 1 && pe.latest.ref === '2026-6300', pe);
  const l = of(r, 'lafarge republic');
  ok('Lafarge: one call on 1 Oct → Contacted, quiet for 54 days', l.stage === 'Contacted' && l.quiet === 54, l);
  ok('  its call-back on 8 Oct never happened: overdue', l.next && l.next.day === '2026-10-08' && l.next.overdue === true, l.next);
  ok('New Prospect Co (no answer only, not in any book) → Not reached', of(r, 'new prospect').stage === 'Not reached');
  const e = of(r, 'empty');   // _cdKey drops 'Co'
  ok('Empty Co: owned, nothing in the window (the April call is too old, the voided line and the admin report do not count)', e && e.stage === '' && e.latest === null && e.quiet === null && e.updates.length === 0, e);
  ok('Busy Co: twelve calls in a day, the last ten kept', of(r, 'busy').updates.length === 10);
  ok('an archived Client Book row is not a client here', !of(r, 'old archived'));
}

sec('3 · Major / Minor from the hub');
{
  const { c, store } = world();
  [ANA, HR, KIM].forEach(a => ok(a.actorRole + ' may not set it', !call(c, 'saveClientHubTier', Object.assign({ key: 'therma south', tier: 'Major' }, a)).success));
  ok('a label that is not Major, Minor or Developing is refused', /Major, Minor or Developing/.test(call(c, 'saveClientHubTier', Object.assign({ key: 'therma south', tier: 'Big' }, NEIL)).message));
  ok('a client no rep has is refused, saying why', /nowhere to keep/.test(call(c, 'saveClientHubTier', Object.assign({ key: 'aboitiz power tsi bu', tier: 'Major' }, NEIL)).message));
  ok('a change made meanwhile is refused (the page showed none; it is mixed)', call(c, 'saveClientHubTier', Object.assign({ key: 'therma south', tier: 'Major', ifTier: '' }, NEIL)).stale === true);
  const width = store.ClientBook[0] && Object.keys(store.ClientBook[1]).length;
  const s = call(c, 'saveClientHubTier', Object.assign({ key: 'therma south', tier: 'major', ifTier: 'mixed' }, NEIL));
  ok('the director makes Therma South Major: both reps\' rows say Major', s.success && s.tier === 'Major' && s.was === 'mixed' && s.changed === 1 &&
     store.ClientBook[0]['Tier'] === 'Major' && store.ClientBook[1]['Tier'] === 'Major', s);
  ok('  the changed row says who and when; whole rows are written', store.ClientBook[1]['Updated By'] === 'Neil Estur' && !!store.ClientBook[1]['Updated At'] && Object.keys(store.ClientBook[1]).length >= width);
  ok('  the Client Book\'s history has it, in words', store.ClientBookLog.length === 1 && store.ClientBookLog[0]['Client No'] === 'CB-2' && store.ClientBookLog[0]['Kind'] === 'details' &&
     /label not set to Major \(in the client hub\)/.test(store.ClientBookLog[0]['Note']), store.ClientBookLog);
  ok('  and the ActivityLog', (store.ActivityLog || []).some(l => l['Module'] === 'Client hub' && l['Action'] === 'Major / Minor set'));
  ok('  the read now says Major', of(sales(c), 'therma south').tier === 'Major');
  const u = call(c, 'saveClientHubTier', Object.assign({ key: 'therma south', ifTier: 'Major', rows: JSON.stringify([{ clientNo: 'CB-1', tier: 'Major' }, { clientNo: 'CB-2', tier: '' }]) }, NEIL));
  ok('Undo puts each rep\'s own label back (Major / none)', u.success && u.tier === 'mixed' && store.ClientBook[0]['Tier'] === 'Major' && store.ClientBook[1]['Tier'] === '' && store.ClientBookLog.length === 2, u);
  const m = call(c, 'saveClientHubTier', Object.assign({ company: 'Philex Mining Corp.', tier: 'Major' }, LARRY));
  ok('management sets one by its name too (Philex: Minor → Major)', m.success && store.ClientBook[3]['Tier'] === 'Major' && /Philex Mining Corp\. is Major now/.test(m.message), m);   // the name the page sent
  ok('the same label again changes nothing', call(c, 'saveClientHubTier', Object.assign({ key: 'philex mining', tier: 'Major' }, LARRY)).unchanged === true);
  ok('an empty label clears it', call(c, 'saveClientHubTier', Object.assign({ key: 'philex mining', tier: '' }, NEIL)).success && store.ClientBook[3]['Tier'] === '');
  ok('the archived row is never touched', store.ClientBook[4]['Tier'] === 'Major' && !store.ClientBookLog.some(l => l['Client No'] === 'CB-5'));
  ok('unreadable rows to put back are refused', !call(c, 'saveClientHubTier', Object.assign({ key: 'therma south', rows: 'nope' }, NEIL)).success);
  ok('FlowSettings clientHubTierRoles narrows who sets it', (() => { const w = world(); w.store.FlowSettings = [{ 'Key': 'clientHubTierRoles', 'Value': 'director' }];
    return !call(w.c, 'saveClientHubTier', Object.assign({ key: 'philex mining', tier: 'Major' }, LARRY)).success && call(w.c, 'saveClientHubTier', Object.assign({ key: 'philex mining', tier: 'Major' }, NEIL)).success; })());
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok'));
process.exit(FAIL ? 1 : 0);
