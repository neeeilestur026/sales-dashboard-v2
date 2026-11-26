/* A407 — the sales clean-up, the store (FlowAPI 204).
 *
 * Run:  node tests/flow/sales-cleanup-store.js
 *
 * Neil, 25 Nov 2026, on a review of the sales side. His answers, each pinned here against the REAL FlowAPI.gs (gasload):
 *  1. one ranking: the Client Book's Major / Minor / Developing. The follow-up plan is each rep's live labelled clients in that
 *     order (no dead account can stay), every open quotation is followed up, and the Sales plan's tier is the label;
 *  2. other spellings ("also written as") are kept per client and every name matcher reads them first;
 *  3. an order that names a quotation marks it Won ("2026-374" names 2026-374-KIM-…), and the director connects the rest;
 *  4. a rep's new purchase request, and a quotation typed without one, name the client from the rep's Client Book.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt'), AIRA = who('admin', 'Aira Limpoco', 'admin');
const GER = who('sales', 'Gerald Lucena', 'sales2'), KIM = who('sales', 'Kimberlyn Blones', 'sales1'), MIKA = who('sales', 'Mikaella Chloe Rufino', 'sales4');
const D = (m, d, h) => new Date(2026, m - 1, d, h === undefined ? 10 : h);
const NOW = D(11, 25, 10);   // Wednesday 25 Nov 2026
const ITEMS = JSON.stringify([{ itemNo: 'TW-1', itemName: 'Hydraulic torque wrench', qty: 1, uom: 'set', price: 100000 }]);

function world(settings) {
  const cb = (no, company, owner, tier, extra) => Object.assign({ 'Client No': no, 'Company': company, 'Key': company.toLowerCase(), 'Owner': owner, 'Tier': tier,
    'Sector': 'Mining', 'Archived At': '', 'Contacts JSON': '[]', 'Next Step': '' }, extra || {});
  const q = (no, customer, owner, sent, extra) => Object.assign({ 'Quotation No': no, 'Date': D(10, 1), 'Customer': customer, 'Status': 'Sent', 'Total': 112000,
    'Salesperson': owner, 'Created By': owner, 'Created At': D(10, 1), 'Sent At': sent, 'Result': '', 'Last Follow Up': '', 'Discount %': 0 }, extra || {});
  const store = {
    ClientBook: [
      cb('CB-1', 'Itogon Suyoc', 'Gerald Lucena', 'Minor'),
      cb('CB-2', 'SMC Global Power', 'Gerald Lucena', 'Major'),
      cb('CB-3', 'FCF Minerals', 'Gerald Lucena', 'Minor'),
      cb('CB-4', 'Bulacan Thermal Inc.', 'Gerald Lucena', 'Developing'),
      cb('CB-5', 'Unlabelled Works', 'Gerald Lucena', ''),
      cb('CB-6', 'Monark', 'Gerald Lucena', 'Major', { 'Archived At': D(11, 24), 'Archive Reason': 'Moved to Mikaella Chloe Rufino' }),
      cb('CB-7', 'Monark', 'Mikaella Chloe Rufino', 'Minor'),
      cb('CB-8', 'Aboitiz Power Corporation', 'Gerald Lucena', 'Major'),
      cb('CB-9', 'Therma Visayas', 'Kimberlyn Blones', 'Major')
    ],
    Quotations: [
      q('2026-374-KIM-THPAL-TORQUE', 'Therma Visayas', 'Kimberlyn Blones', D(9, 1)),
      q('2026-400-GL-ITOGON', 'ITOGON SOYUC RESOURCES INC', 'Gerald Lucena', D(11, 18)),           // the misspelt name: Itogon's once saved
      q('2026-401-GL-WORKS', 'Unlabelled Works', 'Gerald Lucena', D(11, 18)),                      // an unlabelled client's quotation
      q('2026-402-GL-LOST', 'SMC Global Power', 'Gerald Lucena', D(9, 1), { 'Status': 'Lost', 'Closed From': 'Sent', 'Result Reason': 'Price' }),
      q('2026-403-GL-SMC', 'SMC Global Power', 'Gerald Lucena', D(10, 5), { 'Total': 448000 }),
      q('2026-404-GL-SMC', 'SMC Global Power', 'Gerald Lucena', D(6, 5), { 'Total': 90000 }),
      q('2026-405-GL-ABO', 'Aboitiz Power Corporation', 'Gerald Lucena', D(10, 1)),
      q('2026-405-GL-ABO-REV1', 'Aboitiz Power Corporation', 'Gerald Lucena', D(10, 2))
    ],
    QuotationItems: [], SalesOrders: [], SalesOrderItems: [], Shipments: [], Clients: [], PricingRequests: [], PricingRequestItems: [],
    FollowUpPlan: [
      { 'Owner': 'Gerald Lucena', 'Rank': 1, 'Client No': 'CB-6', 'Company': 'Monark' },          // moved away: never shown again
      { 'Owner': 'Gerald Lucena', 'Rank': 2, 'Client No': 'CB-3', 'Company': 'FCF Minerals' },
      { 'Owner': 'Gerald Lucena', 'Rank': 3, 'Client No': 'CB-1', 'Company': 'Itogon Suyoc' }
    ],
    ClientBookLog: [], ClientBookLinks: [], ProofReports: [], QuotationEmails: [], VisitPlans: [], SalesCalls: [], ClientVisits: [],
    SalesPlan: [], SalesPlanAccounts: [], SalesOpps: [], Invoices: [], ActivityLog: []
  };
  const st = Object.assign({ followUpStart: 'off', safeguards: 'off' }, settings || {});
  store.FlowSettings = Object.keys(st).map(k => ({ 'Key': k, 'Value': st[k] }));
  const c = load(GS, store);
  c._now = () => new Date(NOW.getTime());
  return { c, store };
}
const quote = (store, no) => store.Quotations.find(x => x['Quotation No'] === no);

sec('0 · the version, the tab and the switches');
{
  const { c } = world();
  ok('getVersion = 204', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 204);
  ok('ClientBookNames is 5 wide', c.SCHEMA.ClientBookNames.join() === 'Name,Name Key,Client No,By,At');
  const d = c._FLOW_SETTING_DEFAULTS;
  ok('four switches, all on by default', d.followUpPlanFrom === 'book' && d.salesPlanTierFrom === 'book' && d.soMarksQuoteWon === 'on' && d.requireClientPick === 'on');
}

sec('1 · one ranking: Major, Minor, Developing');
{
  const { c, store } = world();
  ok('the labels are Major, Minor and Developing', c.CB_TIERS.join() === 'Major,Minor,Developing');
  const r = call(c, 'saveClientBookClient', Object.assign({ company: 'Batelec II', tier: 'developing', sector: 'Power' }, GER));
  ok('a new client may be Developing (any case)', r.success && store.ClientBook[store.ClientBook.length - 1]['Tier'] === 'Developing', r);
  ok('anything else is refused, naming the three', /Major, Minor or Developing/.test(call(c, 'saveClientBookClient', Object.assign({ company: 'X Co', tier: 'Tier A', sector: 'Power' }, GER)).message));
}

sec('2 · the follow-up plan is the live Client Book');
{
  const { c } = world();
  const g = call(c, 'getFollowUpGuide', GER);
  const order = g.clients.map(x => x.clientNo + ':' + x.label).join(' ');
  ok('Gerald: Major, then Minor (his saved order first: FCF before Itogon), then Developing; A to Z within a label', g.success && g.planFrom === 'book' &&
     order === 'CB-8:Major CB-2:Major CB-3:Minor CB-1:Minor CB-4:Developing', order);
  ok('  the moved client (Monark, archived) and the unlabelled one are not in it, and nothing is "not live"', !/CB-6|CB-5/.test(order) && g.notLive.length === 0 && g.planSize === 5 && g.live === 5);
  ok('  ranks run 1..5 in that order (the day each client falls on)', g.clients.map(x => x.rank).join() === '1,2,3,4,5');
  const all = [].concat(...g.days.map(d => d.quotes)).concat(...g.days.map(d => d.carryQuotes || [])).map(x => x.quotationNo);
  ok('every open quotation of his is followed up, an unlabelled client\'s too (2026-401)', all.indexOf('2026-401-GL-WORKS') >= 0, all);
  ok('  each quotation carries its client\'s label', [].concat(...g.days.map(d => d.quotes)).every(x => typeof x.label === 'string'));
  const m = call(c, 'getFollowUpGuide', MIKA);
  ok('Mika has a plan with no saved list: her one labelled client', m.success && m.clients.map(x => x.clientNo).join() === 'CB-7', m.clients);
  const a = call(c, 'getFollowUpGuide', Object.assign({ all: true }, NEIL));
  ok('the director\'s view lists every rep with a live client', a.success && a.people.map(p => p.user).join() === 'Gerald Lucena,Kimberlyn Blones,Mikaella Chloe Rufino', a.people.map(p => p.user));
  const back = world({ followUpPlanFrom: 'plan' }).c, gp = call(back, 'getFollowUpGuide', GER);
  ok('followUpPlanFrom plan: the A393 saved list again (Monark not live)', gp.planFrom === 'plan' && gp.notLive.length === 1 && gp.notLive[0].clientNo === 'CB-6', gp.notLive);
}

sec('3 · other spellings ("also written as")');
{
  const { c, store } = world();
  ok('before a spelling is saved, ITOGON SOYUC is nobody\'s', c._cbAliasClient('ITOGON SOYUC RESOURCES INC') === '');
  const r = call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-1', names: ['ITOGON SOYUC RESOURCES INC', 'Itogon Soyuc', 'itogon soyuc', 'Itogon Suyoc'] }, GER));
  ok('Gerald saves two spellings (a repeat and the client\'s own name left out)', r.success && r.names.length === 2 && store.ClientBookNames.length === 2 &&
     store.ClientBookNames.every(x => x.__arity === 5 && x['Client No'] === 'CB-1' && x['By'] === 'Gerald Lucena'), [r, store.ClientBookNames]);
  ok('  logged on the client', store.ClientBookLog.some(l => l['Client No'] === 'CB-1' && /Also written as: ITOGON SOYUC RESOURCES INC; Itogon Soyuc/.test(l['Note'])));
  ok('  any punctuation or case finds it', c._cbAliasClient('Itogon-Soyuc Resources, Inc') === 'CB-1' && c._cbAliasClient('itogon soyuc resources inc.') === 'CB-1' && c._cbAliasName('ITOGON SOYUC') === 'Itogon Suyoc' && c._cbAliasName('Itogon Gold') === 'Itogon Gold');
  ok('getClientBook returns them', call(c, 'getClientBook', GER).clients.find(x => x.clientNo === 'CB-1').names.join() === 'Itogon Soyuc,ITOGON SOYUC RESOURCES INC');
  ok('Kim may not add a spelling to Gerald\'s client', /not in your Client Book/.test(call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-1', names: ['X'] }, KIM)).message));
  ok('another client\'s name is refused', /name of another client/.test(call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-1', names: ['FCF Minerals'] }, GER)).message));
  ok('a spelling saved for another client is refused', /already saved as a spelling of Itogon Suyoc/.test(call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-3', names: ['itogon soyuc'] }, GER)).message));
  const g = call(c, 'getFollowUpGuide', GER);
  const iq = [].concat(...g.days.map(d => d.quotes)).concat(...g.days.map(d => d.carryQuotes || [])).find(x => x.quotationNo === '2026-400-GL-ITOGON');
  ok('the guide puts the misspelt quotation on Itogon Suyoc', iq && iq.clientNo === 'CB-1' && iq.label === 'Minor', iq);
  const x = call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-1', names: 'Itogon Soyuc' }, GER));
  ok('saving a shorter list takes one off (a blank row; nothing deleted)', x.success && x.removed === 1 && store.ClientBookNames.length === 3 && store.ClientBookNames[2]['Client No'] === '' &&
     c._cbAliasClient('ITOGON SOYUC RESOURCES INC') === '' && c._cbAliasClient('Itogon Soyuc') === 'CB-1');
  ok('the director may change any client\'s', call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-9', names: ['THERMA VISAYAS INC'] }, NEIL)).success);
  ok('admin (outside the Client Book) may not', !call(c, 'saveClientBookNames', Object.assign({ clientNo: 'CB-1', names: ['Y'] }, AIRA)).success);
}

sec('4 · an order and its quotation');
{
  const { c } = world(), res = c._soQuoteResolver(['2026-374-KIM-THPAL-TORQUE', '2026-405-GL-ABO', '2026-405-GL-ABO-REV1', 'QTN-202607-001']);
  ok('the full number is itself (any case)', res('2026-374-KIM-THPAL-TORQUE') === '2026-374-KIM-THPAL-TORQUE' && res('qtn-202607-001') === 'QTN-202607-001');
  ok('"2026-374" is the one number it starts', res('2026-374') === '2026-374-KIM-THPAL-TORQUE');
  ok('a start shared by two numbers names neither', res('2026-405') === '' && res('2026-405-GL-ABO') === '2026-405-GL-ABO');
  ok('a short or unknown reference names nothing', res('2026') === '' && res('2026-999') === '' && res('') === '');
}
{
  const { c, store } = world();
  const r = call(c, 'createSalesOrder', Object.assign({ soNo: 'PO-77', quotationNo: '2026-374', customer: 'Therma Visayas', date: '2026-11-20', items: ITEMS, vatType: 'VAT-12' }, KIM));
  const so = store.SalesOrders[0], q = quote(store, '2026-374-KIM-THPAL-TORQUE');
  ok('an order typed with "2026-374" keeps the full number', r.success && so['Quotation No'] === '2026-374-KIM-THPAL-TORQUE' && r.quotationNo === '2026-374-KIM-THPAL-TORQUE', [r, so['Quotation No']]);
  ok('  and the quotation is marked Won by it', r.quoteWon === true && q['Result'] === 'Won' && q['Result Note'] === 'Sales order PO-77' && q['Result By'] === 'Kimberlyn Blones', q);
  const r2 = call(c, 'createSalesOrder', Object.assign({ soNo: 'PO-78', quotationNo: '2026-402-GL-LOST', customer: 'SMC Global Power', date: '2026-11-20', items: ITEMS, vatType: 'VAT-12' }, GER));
  const lost = quote(store, '2026-402-GL-LOST');
  ok('an order for a quotation closed as lost reopens it as Sent and Won', r2.success && lost['Status'] === 'Sent' && lost['Result'] === 'Won' && lost['Closed From'] === '' && lost['Result Reason'] === '', lost);
  const r3 = call(c, 'updateSalesOrder', Object.assign({ soNo: 'PO-78', quotationNo: '2026-403-GL-SMC', customer: 'SMC Global Power', items: ITEMS }, GER));
  ok('an edit naming another quotation marks that one Won', r3.success && r3.quoteWon && quote(store, '2026-403-GL-SMC')['Result'] === 'Won', r3);
  const g = call(c, 'getFollowUpGuide', GER);
  ok('a won quotation leaves the follow-ups', ![].concat(...g.days.map(d => d.quotes)).some(x => x.quotationNo === '2026-403-GL-SMC'));
  const off = world({ soMarksQuoteWon: 'off' });
  call(off.c, 'createSalesOrder', Object.assign({ soNo: 'PO-79', quotationNo: '2026-374', customer: 'Therma Visayas', date: '2026-11-20', items: ITEMS, vatType: 'VAT-12' }, KIM));
  ok('soMarksQuoteWon off: the order is saved as typed, the quotation left alone', off.store.SalesOrders[0]['Quotation No'] === '2026-374' && quote(off.store, '2026-374-KIM-THPAL-TORQUE')['Result'] === '');
}
{
  const { c, store } = world();
  store.SalesOrders.push(
    { 'SO No': 'SO-A', 'Quotation No': '2026-374', 'Date': '2026-11-10', 'Customer': 'Therma Visayas', 'Status': 'Open', 'Total': 100000 },
    { 'SO No': 'SO-B', 'Quotation No': '', 'Date': '2026-10-20', 'Customer': 'SMC GLOBAL POWER CORP', 'Status': 'Open', 'Total': 400000 },
    { 'SO No': 'SO-C', 'Quotation No': '', 'Date': '2025-12-20', 'Customer': 'SMC Global Power', 'Status': 'Open', 'Total': 1 },
    { 'SO No': 'SO-D', 'Quotation No': '', 'Date': '2026-11-01', 'Customer': 'SMC Global Power', 'Status': 'Cancelled', 'Total': 1 });
  ok('only the director lists them', !call(c, 'getOrderQuotationLinks', LARRY).success && !call(c, 'getOrderQuotationLinks', GER).success);
  const L = call(c, 'getOrderQuotationLinks', NEIL);
  ok('the year\'s orders: SO-A names a quotation not marked won; SO-B names none (last year\'s and a cancelled one left out)', L.success && L.year === 2026 &&
     L.named.map(x => x.soNo).join() === 'SO-A' && L.named[0].quotationNo === '2026-374-KIM-THPAL-TORQUE' && L.named[0].fixNumber === true && L.unnamed.map(x => x.soNo).join() === 'SO-B', L);
  const cands = L.unnamed[0].candidates.map(x => x.quotationNo);
  ok('  SO-B\'s likeliest quotation: the same client, sent before it, nearest amount first (₱448k for a ₱400k order)', cands[0] === '2026-403-GL-SMC' && cands.indexOf('2026-401-GL-WORKS') < 0, L.unnamed[0].candidates);
  ok('a rep may not connect them', !call(c, 'linkOrderQuotations', Object.assign({ all: true }, GER)).success);
  const all = call(c, 'linkOrderQuotations', Object.assign({ all: true }, NEIL));
  ok('"all" connects every order whose quotation is known: SO-A gets the full number, the quotation is Won', all.success && all.done.length === 1 &&
     store.SalesOrders[0]['Quotation No'] === '2026-374-KIM-THPAL-TORQUE' && quote(store, '2026-374-KIM-THPAL-TORQUE')['Result'] === 'Won', all);
  ok('  logged in the ActivityLog', store.ActivityLog.some(l => l['Action'] === 'Quotation won'));
  const one = call(c, 'linkOrderQuotations', Object.assign({ links: JSON.stringify([{ soNo: 'SO-B', quotationNo: '2026-403-GL-SMC' }, { soNo: 'SO-A', quotationNo: '2026-403-GL-SMC' }]) }, NEIL));
  ok('the director picks SO-B\'s quotation; an order already naming another is refused', one.success && one.done.length === 1 && one.refused.length === 1 &&
     store.SalesOrders[1]['Quotation No'] === '2026-403-GL-SMC' && /already names/.test(one.refused[0].message), one);
  const after = call(c, 'getOrderQuotationLinks', NEIL);
  ok('nothing is left to connect', after.named.length === 0 && after.unnamed.length === 0, after);
  const sp = call(c, 'getSalesPlan', Object.assign({ user: 'Gerald Lucena' }, NEIL));
  ok('the Sales plan counts the quotation won', sp.quotes.find(x => x.quotationNo === '2026-403-GL-SMC').state === 'Won');
}

sec('5 · the Sales plan\'s tier is the label');
{
  const { c } = world();
  const sp = call(c, 'getSalesPlan', Object.assign({ user: 'Gerald Lucena' }, NEIL)), acct = (no) => sp.accounts.find(a => a.clientNo === no);
  ok('Major → A, Minor → B, Developing → C, no label → none', acct('CB-2').tier === 'A' && acct('CB-1').tier === 'B' && acct('CB-4').tier === 'C' && acct('CB-5').tier === '', sp.accounts.map(a => a.clientNo + a.tier));
  ok('  the targets follow (₱1M, ₱600k, ₱240k)', acct('CB-2').target === 1000000 && acct('CB-1').target === 600000 && acct('CB-4').target === 240000);
  ok('  listed Major first, then Minor, Developing, none', sp.accounts.map(a => a.tier || '-').join('') === 'AABBC-', sp.accounts.map(a => a.tier || '-').join(''));
  ok('  the page is told the names', sp.lists.tierFrom === 'book' && sp.lists.tierNames.A === 'Major' && sp.lists.tierNames.C === 'Developing');
  ok('a tier can no longer be set on the plan', /set in the Client Book/.test(call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', tier: 'A' }, GER)).message));
  ok('  but the target still can', call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', target: '750000' }, GER)).success);
  const back = world({ salesPlanTierFrom: 'rank' }).c, sp2 = call(back, 'getSalesPlan', Object.assign({ user: 'Gerald Lucena' }, NEIL));
  ok('salesPlanTierFrom rank: the A403 ranks again', sp2.lists.tierFrom === 'rank' && sp2.accounts.find(a => a.clientNo === 'CB-3').tier === 'A');
}

sec('6 · a new request or quotation names its client');
{
  const { c, store } = world();
  const pr = (who, extra) => call(c, 'createPricingRequest', Object.assign({ customer: 'Itogon Suyoc', items: ITEMS, requestedBy: who.actorName }, extra || {}, who));
  const none = pr(GER);
  ok('a rep\'s request with no client is refused, and nothing is written', !none.success && none.needClient === true && store.PricingRequests.length === 0, none);
  const mine = pr(GER, { clientNo: 'CB-1' });
  ok('with his own client it is made, on that client', mine.success && store.PricingRequests[0]['Client Book No'] === 'CB-1', mine);
  ok('another rep\'s client is refused', /not in your Client Book/.test(pr(KIM, { clientNo: 'CB-1' }).message));
  ok('an archived client is refused', /not a live client/.test(pr(GER, { clientNo: 'CB-6' }).message));
  ok('admin is never asked', pr(AIRA).success);
  ok('a website request turned into a request is never asked', pr(GER, { clientRef: 'web:WR-1' }).success);
  const q0 = call(c, 'createQuotation', Object.assign({ customer: 'FCF Minerals', items: ITEMS, createdBy: 'Gerald Lucena' }, GER));
  ok('a rep\'s quotation typed without a request must name its client', !q0.success && q0.needClient === true);
  const n0 = store.Quotations.length, q1 = call(c, 'createQuotation', Object.assign({ customer: 'FCF Minerals', items: ITEMS, createdBy: 'Gerald Lucena', clientNo: 'CB-3' }, GER));
  ok('  with it, the quotation is made and put on the client (a link row and a log line)', q1.success && store.Quotations.length === n0 + 1 && q1.clientNo === 'CB-3' &&
     store.ClientBookLinks.some(l => l['Kind'] === 'quotation' && l['Record No'] === q1.quotationNo && l['Client No'] === 'CB-3') &&
     store.ClientBookLog.some(l => l['Client No'] === 'CB-3' && l['Kind'] === 'linked'), q1);
  ok('  one made from a request is not asked (the request names it)', call(c, 'createQuotation', Object.assign({ customer: 'FCF Minerals', items: ITEMS, prNo: 'PR-1', createdBy: 'Gerald Lucena' }, GER)).success);
  const off = world({ requireClientPick: 'off' }).c;
  ok('requireClientPick off: optional again', call(off, 'createPricingRequest', Object.assign({ customer: 'X', items: ITEMS }, GER)).success);
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
process.exit(FAIL ? 1 : 0);
