/* A403 — the Sales plan store (FlowAPI 202: getSalesPlan, getSalesActivity, saveSalesPlanTarget, saveSalesPlanAccount,
 * saveSalesOpp, archiveSalesOpp).
 *
 * Run:  node tests/flow/sales-plan-store.js
 *
 * Neil, 23 Nov 2026: his 2027 Individual Sales Strategy Workbook in the portal, filled in by itself wherever the portal
 * knows. A sale is a sales order on its date, its total as recorded (before VAT); cost and gross profit only for the
 * director and management (left out of a rep's reply); the director and management set the year targets; a rep keeps
 * their own accounts and pipeline. Runs the real FlowAPI.gs through its dispatcher (gasload), "today" 23 Nov 2026.
 */
const { load, call } = require('./gasload');
const fs = require('fs');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const SRC = fs.readFileSync(GS, 'utf8');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt'), ANA = who('admin', 'Ana Admin', 'admin1');
const GERALD = who('sales', 'Gerald Lucena', 'sales2'), KIM = who('sales', 'Kimberlyn Blones', 'sales1'), ACCT = who('accounting', 'Ann Acct', 'acct1');
const T = (m, d, h) => new Date(2026, m - 1, d, h || 10);
const contacts = (list) => JSON.stringify(list);

function world() {
  const store = {
    ClientBook: [
      { 'Client No': 'CB-1', 'Company': 'Therma South, Inc.', 'Owner': 'Gerald Lucena', 'Sector': 'Power', 'Status': '', 'Archived At': '',
        'Contacts JSON': contacts([{ name: 'Ana Reyes', emails: ['ana@therma.test'], phones: [] }, { name: 'Joe Cruz', position: 'Purchasing', emails: ['joe@therma.test'], phones: ['0917 000 1111'], primary: true }]) },
      { 'Client No': 'CB-2', 'Company': 'Philex Mining', 'Owner': 'Gerald Lucena', 'Sector': 'Mining', 'Archived At': '', 'Contacts JSON': '[]' },
      { 'Client No': 'CB-3', 'Company': 'Aboitiz Power Corporation - SNAPB BU', 'Owner': 'Gerald Lucena', 'Sector': 'Power', 'Archived At': '' },
      { 'Client No': 'CB-8', 'Company': 'Holcim Davao', 'Owner': 'Gerald Lucena', 'Sector': 'Cement', 'Status': 'On hold', 'Archived At': '' },
      { 'Client No': 'CB-9', 'Company': 'Unranked Shipyard', 'Owner': 'Gerald Lucena', 'Sector': 'Shipyard', 'Archived At': '' },
      { 'Client No': 'CB-7', 'Company': 'Old Archived Co', 'Owner': 'Gerald Lucena', 'Archived At': T(10, 1) },
      { 'Client No': 'CB-4', 'Company': 'Aboitiz Power Corporation - DLPC BU', 'Owner': 'Kimberlyn Blones', 'Sector': 'Power', 'Archived At': '' },
      { 'Client No': 'CB-6', 'Company': 'THERMA SOUTH INC', 'Owner': 'Kimberlyn Blones', 'Sector': 'Power', 'Archived At': '' }
    ],
    FollowUpPlan: [
      { 'Owner': 'Gerald Lucena', 'Rank': 1, 'Client No': 'CB-1', 'Company': 'Therma South, Inc.' },
      { 'Owner': 'Gerald Lucena', 'Rank': 11, 'Client No': 'CB-2', 'Company': 'Philex Mining' },
      { 'Owner': 'Gerald Lucena', 'Rank': 30, 'Client No': 'CB-3', 'Company': 'Aboitiz Power Corporation - SNAPB BU' },
      { 'Owner': 'Gerald Lucena', 'Rank': 31, 'Client No': 'CB-8', 'Company': 'Holcim Davao' },
      { 'Owner': 'Kimberlyn Blones', 'Rank': 5, 'Client No': 'CB-4', 'Company': 'Aboitiz Power Corporation - DLPC BU' }
    ],
    Quotations: [
      { 'Quotation No': 'Q-1', 'Date': '2026-11-10', 'Customer': 'Therma South, Inc.', 'Status': 'Sent', 'Total': 100000, 'Discount %': 10, 'Salesperson': 'Gerald Lucena',
        'Created By': 'Gerald Lucena', 'Sent At': T(11, 10), 'Subject': 'Hydraulic torque wrench', 'PR No': 'PR-4' },
      { 'Quotation No': 'Q-2', 'Date': '2026-09-01', 'Customer': 'Philex Mining', 'Status': 'Sent', 'Result': 'Won', 'Result At': T(10, 5), 'Total': 50000, 'Salesperson': 'Gerald Lucena', 'Subject': 'Bolt tensioner' },
      { 'Quotation No': 'Q-3', 'Date': '2026-08-01', 'Customer': 'Philex Mining', 'Status': 'Lost', 'Result At': T(8, 20), 'Result Reason': 'Price', 'Total': 80000, 'Salesperson': 'Gerald Lucena', 'Subject': 'Pump' },
      { 'Quotation No': 'Q-4', 'Date': '2026-11-02', 'Customer': 'Aboitiz Power Corporation - DLPC BU', 'Status': 'Sent', 'Total': 70000, 'Salesperson': 'Kimberlyn Blones', 'Sent At': T(11, 2) },
      { 'Quotation No': 'Q-5', 'Date': '2026-05-20', 'Customer': 'Philex Mining Corp.', 'Status': 'Sent', 'Total': 200000, 'Salesperson': 'Gerald Lucena', 'Subject': 'Spare parts' },
      { 'Quotation No': 'Q-7', 'Date': '2026-02-01', 'Customer': 'Therma South Inc', 'Status': 'Sent', 'Total': 500000, 'Salesperson': 'Kimberlyn Blones' },
      { 'Quotation No': 'Q-8', 'Date': '2026-11-20', 'Customer': 'Philex Mining', 'Status': 'Approved', 'Total': 30000, 'Salesperson': 'Gerald Lucena', 'Type': 'Service' },
      { 'Quotation No': 'Q-9', 'Date': '2025-03-01', 'Customer': 'Philex Mining', 'Status': 'Lost', 'Result At': '2025-04-01', 'Total': 10, 'Salesperson': 'Gerald Lucena' }
    ],
    SalesOrders: [
      { 'SO No': 'SO-1', 'Date': '2026-03-10', 'Customer': 'Therma South Inc.', 'Status': 'Delivered', 'Total': 500000 },
      { 'SO No': 'SO-2', 'Quotation No': 'Q-5', 'Date': '2026-06-01', 'Customer': 'Philex Mining Corp.', 'Status': 'Delivered', 'Total': 200000, 'Client PO No': 'PO-77', 'VAT Type': 'VAT-12' },
      { 'SO No': 'SO-3', 'Date': '2026-07-01', 'Customer': 'ABOITIZ POWER CORPORATION - SNAPB BU', 'Status': 'Open', 'Total': 300000 },
      { 'SO No': 'SO-4', 'Date': '2026-07-15', 'Customer': 'Petra Cement Inc.', 'Status': 'Delivered', 'Total': 999000 },
      { 'SO No': 'SO-5', 'Date': '2025-05-01', 'Customer': 'Philex Mining', 'Status': 'Delivered', 'Total': 40000 },
      { 'SO No': 'SO-6', 'Date': '2026-08-01', 'Customer': 'Philex Mining', 'Status': 'Cancelled', 'Total': 77000 },
      { 'SO No': 'SO-7', 'Date': '2024-01-05', 'Customer': 'Unranked Shipyard', 'Status': 'Delivered', 'Total': 15000 }
    ],
    SalesOrderItems: [
      { 'SO No': 'SO-2', 'Item No': 1, 'Item Name': 'Seal kit' }, { 'SO No': 'SO-2', 'Item No': 2, 'Item Name': 'Pump cartridge' }
    ],
    Invoices: [
      { 'INV No': 'INV-1', 'SO No': 'SO-2', 'Date': '2026-06-01', 'Total COGS': 120000, 'Voided': '' },
      { 'INV No': 'INV-9', 'SO No': 'SO-3', 'Date': '2026-07-01', 'Total COGS': 1, 'Voided': 'true' },
      { 'INV No': 'INV-2', 'SO No': 'SO-1', 'Date': '2026-03-10', 'Total COGS': 300000, 'Voided': '' }
    ],
    ARAging: [
      { 'AR No': 'AR-1', 'INV No': 'INV-1', 'SO No': 'SO-2', 'Amount (PHP)': 224000, 'Collected (PHP)': 100000, 'Status': 'Partial', 'Due Date': '2026-07-01' },
      { 'AR No': 'AR-2', 'INV No': 'INV-2', 'SO No': 'SO-1', 'Amount (PHP)': 560000, 'Collected (PHP)': 560000, 'Status': 'Paid', 'Due Date': '2026-04-10' }
    ],
    SOCostDetails: [{ 'SO No': 'SO-2', 'Total COGS': 130000 }],
    PricingRequests: [
      { 'PR No': 'PR-1', 'Date': '2026-11-20', 'Customer': 'Philex Mining', 'Status': 'Requested', 'Created At': T(11, 20), 'Updated At': T(11, 20), 'Salesperson': 'Gerald Lucena' },
      { 'PR No': 'PR-2', 'Date': '2026-11-18', 'Customer': 'Philex Mining', 'Status': 'Quoted', 'Created At': T(11, 18), 'Salesperson': 'Gerald Lucena' },
      { 'PR No': 'PR-3', 'Date': '2026-08-01', 'Customer': 'Philex Mining', 'Status': 'Requested', 'Created At': T(8, 1), 'Updated At': T(8, 1), 'Salesperson': 'Gerald Lucena' },
      { 'PR No': 'PR-4', 'Date': '2026-11-05', 'Customer': 'Therma South, Inc.', 'Status': 'Requested', 'Created At': T(11, 5), 'Salesperson': 'Gerald Lucena' },
      { 'PR No': 'PR-5', 'Date': '2026-11-21', 'Customer': 'Holcim Davao', 'Status': 'Returned to Sales', 'Created At': T(11, 21), 'Requested By': 'Gerald Lucena' }
    ],
    VisitPlans: [
      { 'Visit Plan No': 'VP-1', 'Date': '2026-11-03', 'User': 'Gerald Lucena', 'Client No': 'CB-1', 'Company': 'Therma South, Inc.', 'Status': 'Done', 'Done At': T(11, 3), 'Purpose': 'Demo', 'Result': 'RFQ promised' },
      { 'Visit Plan No': 'VP-2', 'Date': '2026-11-27', 'User': 'Gerald Lucena', 'Client No': 'CB-2', 'Company': 'Philex Mining', 'Status': 'Approved' },
      { 'Visit Plan No': 'VP-3', 'Date': '2026-12-02', 'User': 'Gerald Lucena', 'Client No': 'CB-2', 'Company': 'Philex Mining', 'Status': 'Draft' }
    ],
    ProofReports: [
      { 'Report No': 'PR26-1', 'Date': '2026-11-18', 'User': 'Gerald Lucena', 'Role': 'sales', 'Kind': '', 'Updated At': T(11, 18, 17),
        'Report JSON': JSON.stringify({ lines: [
          { id: 'a', loggedAt: '2026-11-18T02:00:00.000Z', type: 'Visit', company: 'Philex Mining', person: 'Engr. Dela Cruz', note: 'Plant walk', result: 'RFQ promised', nextAction: 'Send RFQ form', nextDate: '2026-11-20', linkType: 'none', linkId: '' },
          { id: 'b', loggedAt: '2026-11-18T03:00:00.000Z', type: 'Call', company: 'Therma South, Inc.', person: 'Joe Cruz', note: 'Asked about the wrench', result: 'Reached', linkType: 'quotation', linkId: 'Q-1', nextAction: 'Call back Friday' },
          { id: 'c', loggedAt: '2026-11-18T04:00:00.000Z', type: 'Call', company: 'Holcim Davao', result: 'No answer', voidedAt: '2026-11-18T05:00:00.000Z' },
          { id: 'd', loggedAt: '2026-11-18T06:00:00.000Z', type: 'Site survey', company: 'Aboitiz SNAPB', note: 'Measured the flanges', result: 'Done', linkType: 'client', linkId: 'CB-3' }
        ] }),
        'Snapshot JSON': JSON.stringify({ emailsSent: { text: '12', value: 12 } }) },
      { 'Report No': 'PR26-2', 'Date': '2026-11-19', 'User': 'Kimberlyn Blones', 'Role': 'sales', 'Kind': '', 'Updated At': T(11, 19, 17),
        'Report JSON': JSON.stringify({ lines: [{ id: 'k', loggedAt: '2026-11-19T02:00:00.000Z', type: 'Call', company: 'Aboitiz Power Corporation - DLPC BU', result: 'Reached', linkType: 'none' }] }) },
      { 'Report No': 'PR26-3', 'Date': '2026-11-19', 'User': 'Mikaella Chloe Rufino', 'Role': 'sales', 'Kind': '', 'Updated At': T(11, 19, 17), 'Report JSON': '{}' },
      { 'Report No': 'PR26-4', 'Date': '2026-11-19', 'User': 'Neil', 'Role': 'director', 'Kind': '', 'Updated At': T(11, 19, 17), 'Report JSON': '{}' }
    ],
    SalesCalls: [{ 'Call No': 'C-1', 'Date': '2026-11-05', 'User': 'Gerald Lucena', 'Contact': 'Mr. Tan', 'Company': 'Holcim Davao', 'Outcome': 'Reached', 'Notes': 'Intro call', 'Created At': T(11, 5) }],
    ClientBookLinks: [], FlowSettings: [{ Key: 'salesPlanTierFrom', Value: 'rank' }]   // A407: this suite is the A403 tiers (the switch back); the book's labels are in sales-cleanup-store.js
  };
  const c = load(GS, store);
  c._now = () => T(11, 23, 10);
  return { c, store };
}
const plan = (c, a, more) => call(c, 'getSalesPlan', Object.assign({}, a || GERALD, more || {}));
const acct = (r, no) => r.accounts.find(x => x.clientNo === no);
const sale = (r, no) => r.sales.find(x => x.soNo === no);
const opp = (r, no) => r.pipeline.find(x => x.recordNo === no);

sec('1 · the version, and who may open it');
{
  const { c } = world();
  ok('getVersion = 204', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 204);
  [GERALD, KIM, NEIL, LARRY].forEach(a => ok(a.actorRole + ' (' + a.actorName + ') opens it', plan(c, a).success));
  [ANA, ACCT, who('hr', 'H', 'hr1'), who('marketing', 'M', 'mk1')].forEach(a => ok(a.actorRole + ' is refused', !plan(c, a).success));
  ok('a call with no name is refused', !plan(c, who('sales', '', 'x')).success);
  ok('the read is secured', !call(c, 'getSalesPlan', Object.assign({ flowSecret: '' }, GERALD)).success);
  const { c: c2, store: s2 } = world(); s2.FlowSettings.push({ Key: 'salesPlan', Value: 'off' });
  ok('salesPlan off closes it', /switched off/.test(plan(c2, NEIL).message));
}

sec('2 · whose plan: a rep their own, oversight any rep');
{
  const { c } = world();
  const g = plan(c, GERALD), gk = plan(c, GERALD, { user: 'Kimberlyn Blones' });
  ok('a rep reads their own', g.user === 'Gerald Lucena' && !g.readOnly);
  ok('a rep naming another rep still gets their own', gk.user === 'Gerald Lucena');
  ok('a rep is not given the list of reps', g.people.length === 0 && !g.may.oversight && !g.may.target);
  const n = plan(c, NEIL, { user: 'Kimberlyn Blones' });
  ok('the director reads Kimberlyn\'s', n.user === 'Kimberlyn Blones' && n.accounts.length === 2 && n.may.oversight && n.may.target);
  ok('the reps: Client Book, follow-up plan and sales daily reports (not the director\'s own report)', JSON.stringify(n.people) === JSON.stringify(['Gerald Lucena', 'Kimberlyn Blones', 'Mikaella Chloe Rufino']), n.people);
  ok('the year defaults to this year; next year may be asked', n.year === 2026 && plan(c, NEIL, { year: 2027 }).year === 2027 && plan(c, NEIL, { year: 2031 }).year === 2026);
}

sec('3 · accounts fill themselves');
{
  const { c } = world();
  const r = plan(c, GERALD);
  ok('the live Client Book in follow-up rank order (archived left out, unranked last)', r.accounts.map(a => a.clientNo).join() === 'CB-1,CB-2,CB-3,CB-8,CB-9', r.accounts.map(a => a.clientNo));
  ok('rank 1 → A (₱1M), 11 → B (₱600k), 30 → C (₱240k)', acct(r, 'CB-1').tier === 'A' && acct(r, 'CB-1').target === 1000000 && acct(r, 'CB-2').tier === 'B' && acct(r, 'CB-2').target === 600000
     && acct(r, 'CB-3').tier === 'C' && acct(r, 'CB-3').target === 240000);
  ok('no rank → no tier, no target', acct(r, 'CB-9').tier === '' && acct(r, 'CB-9').target === 0);
  ok('the main contact (marked main, not first)', acct(r, 'CB-1').contact.name === 'Joe Cruz' && acct(r, 'CB-1').contact.phone === '0917 000 1111' && acct(r, 'CB-1').contact.count === 2, acct(r, 'CB-1').contact);
  ok('last visit: a visit plan done, or the daily report\'s visit (by company name) or site survey (linked)', acct(r, 'CB-1').lastVisit === '2026-11-03' && acct(r, 'CB-2').lastVisit === '2026-11-18' && acct(r, 'CB-3').lastVisit === '2026-11-18');
  ok('next visit: the nearest planned one', acct(r, 'CB-2').nextVisit === '2026-11-27');
  ok('the year\'s sales on the account', acct(r, 'CB-2').actual === 200000 && acct(r, 'CB-2').orders === 1 && acct(r, 'CB-3').actual === 300000 && acct(r, 'CB-1').actual === 0);
  ok('status: Active (an order this year) · On Hold (the book) · Dormant (older than a year) · Prospect (never)',
     acct(r, 'CB-2').status === 'Active' && acct(r, 'CB-8').status === 'On Hold' && acct(r, 'CB-9').status === 'Dormant' && acct(r, 'CB-1').status === 'Prospect',
     r.accounts.map(a => a.clientNo + ':' + a.status));
  ok('focus suggestions: the client\'s quotation subjects, newest first', JSON.stringify(acct(r, 'CB-2').focusHints) === JSON.stringify(['Bolt tensioner', 'Pump', 'Spare parts']), acct(r, 'CB-2').focusHints);
  ok('the sector comes from the book', acct(r, 'CB-8').sector === 'Cement');
}

sec('4 · sales: whose order, as recorded, with invoices and payment');
{
  const { c } = world();
  const g = plan(c, GERALD), k = plan(c, KIM);
  ok('Gerald: the order on his quotation and the one on his business unit (not the other rep\'s BU)', g.sales.map(s => s.soNo).join() === 'SO-3,SO-2', g.sales.map(s => s.soNo));
  ok('a customer in both books goes to whoever quoted it last before the order', k.sales.map(s => s.soNo).join() === 'SO-1' && sale(k, 'SO-1').shared === true && sale(k, 'SO-1').via === 'client book');
  ok('the order counts as recorded (its lines are before VAT), VAT-12 too', sale(g, 'SO-2').amount === 200000 && sale(g, 'SO-2').vatType === 'VAT-12');
  ok('credited through the quotation', sale(g, 'SO-2').via === 'quotation' && sale(g, 'SO-2').clientNo === 'CB-2' && sale(g, 'SO-2').quotationNo === 'Q-5');
  ok('invoices (voided left out), PO and products', sale(g, 'SO-2').invNos.join() === 'INV-1' && sale(g, 'SO-3').invNos.length === 0 && sale(g, 'SO-2').poNo === 'PO-77' && sale(g, 'SO-2').products === 'Seal kit; Pump cartridge');
  ok('payment: Overdue (part paid, past due) · Not invoiced · Paid', sale(g, 'SO-2').payment === 'Overdue' && sale(g, 'SO-2').outstanding === 124000 && sale(g, 'SO-3').payment === 'Not invoiced' && sale(k, 'SO-1').payment === 'Paid');
  ok('cancelled orders, last year\'s and nobody\'s are not his', !sale(g, 'SO-6') && !sale(g, 'SO-5') && !sale(g, 'SO-4'));
  ok('a rep\'s reply has no cost or gross profit at all', g.sales.every(s => !('cost' in s) && !('gp' in s)) && g.may.cost === false);
  const n = plan(c, NEIL, { user: 'Gerald Lucena' });
  ok('the director sees cost (the cost sheet first, else the invoice) and gross profit', sale(n, 'SO-2').cost === 130000 && sale(n, 'SO-2').gp === 70000 && sale(n, 'SO-2').costFrom === 'cost sheet'
     && sale(n, 'SO-3').cost === null && n.may.cost === true, n.sales);
  const l = plan(c, LARRY, { user: 'Kimberlyn Blones' });
  ok('management too (the invoice\'s cost when there is no cost sheet)', sale(l, 'SO-1').cost === 300000 && sale(l, 'SO-1').costFrom === 'invoice');
  ok('month by month: the even split of ₱25M and the orders', g.months.length === 12 && g.months[5].actual === 200000 && g.months[6].actual === 300000 && Math.abs(g.months.reduce((t, m) => t + m.target, 0) - 25000000) < 1, g.months[0]);
}

sec('5 · the pipeline fills itself');
{
  const { c } = world();
  const r = plan(c, GERALD);
  const q1 = opp(r, 'Q-1');
  ok('an open quotation: Quotation, net of discount, 40%, weighted', q1 && q1.stage === 'Quotation' && q1.value === 90000 && q1.probability === 40 && q1.weighted === 36000, q1);
  ok('  expected close = sent + 30 days; next follow-up from the day 3/5/7/14 rule', q1.expectedClose === '2026-12-10' && !q1.closeSet && q1.nextAction === 'Follow up (day 14)' && q1.nextActionDate === '2026-11-24', q1);
  ok('  its client from its PR link or name', q1.clientNo === 'CB-1');
  ok('an approved, unsent quotation: send it today', opp(r, 'Q-8').stage === 'Quotation' && opp(r, 'Q-8').nextAction === 'Send the quotation' && opp(r, 'Q-8').category === 'Service');
  ok('won (marked or with an order) and lost this year are closed rows', opp(r, 'Q-2').stage === 'Closed Won' && opp(r, 'Q-2').probability === 100 && opp(r, 'Q-5').stage === 'Closed Won' && opp(r, 'Q-5').soNo === 'SO-2'
     && opp(r, 'Q-3').stage === 'Closed Lost' && opp(r, 'Q-3').reason === 'Price');
  ok('a quotation closed last year is not shown', !opp(r, 'Q-9'));
  ok('a live purchase request not yet quoted: Technical Review, waiting for the price', opp(r, 'PR-1').stage === 'Technical Review' && opp(r, 'PR-1').value === null && opp(r, 'PR-1').nextAction === 'Waiting for the price');
  ok('  a priced one returned to sales: make the quotation', opp(r, 'PR-5').nextAction === 'Make the quotation');
  ok('quoted, archived (no update for 30 days) and quotation-linked requests are not shown', !opp(r, 'PR-2') && !opp(r, 'PR-3') && !opp(r, 'PR-4'));
  ok('another rep\'s quotation is not his', !opp(r, 'Q-4') && opp(plan(c, KIM), 'Q-4'));
  ok('open rows come before closed rows', r.pipeline.findIndex(o => o.stage.indexOf('Closed') === 0) > r.pipeline.findIndex(o => o.recordNo === 'Q-1'));
  ok('the year\'s quotations in the workbook\'s states', r.quotes.find(q => q.quotationNo === 'Q-1').state === 'Submitted' && r.quotes.find(q => q.quotationNo === 'Q-5').state === 'Won'
     && r.quotes.find(q => q.quotationNo === 'Q-3').state === 'Lost' && !r.quotes.find(q => q.quotationNo === 'Q-9'));
}

sec('6 · the rep\'s own figures on the pipeline, and typed leads');
{
  const { c, store } = world();
  const s1 = call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-1', stage: 'Negotiation', probability: 70, decisionMaker: 'Joe Cruz', expectedClose: '2026-12-05', nextAction: 'Meet the plant manager', nextActionDate: '2026-11-26' }, GERALD));
  const q1 = opp(plan(c, GERALD), 'Q-1');
  ok('the rep moves his quotation to Negotiation at 70%', s1.success && q1.stage === 'Negotiation' && q1.probability === 70 && q1.probSet && q1.weighted === 63000, [s1, q1]);
  ok('  with his close date, decision maker and next action', q1.expectedClose === '2026-12-05' && q1.closeSet && q1.decisionMaker === 'Joe Cruz' && q1.nextAction === 'Meet the plant manager' && q1.nextActionDate === '2026-11-26');
  const s2 = call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-1', probability: '', nextAction: '' }, GERALD));
  const q1b = opp(plan(c, GERALD), 'Q-1');
  ok('a blank field goes back to the automatic one', s2.success && q1b.probability === 60 && !q1b.probSet && q1b.nextAction === 'Follow up (day 14)' && q1b.stage === 'Negotiation', q1b);
  ok('won or lost is marked on Quotation status, not here', /Quotation status/.test(call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-1', stage: 'Closed Won' }, GERALD)).message));
  ok('a quotation\'s value comes from the quotation', !call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-1', value: 5 }, GERALD)).success);
  ok('a rep may not touch another rep\'s quotation', !call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-4', probability: 90 }, GERALD)).success);
  ok('a probability over 100 and a bad date are refused', !call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-1', probability: 120 }, GERALD)).success
     && !call(c, 'saveSalesOpp', Object.assign({ source: 'quotation', recordNo: 'Q-1', expectedClose: '5 Dec' }, GERALD)).success);
  ok('an estimated value on a purchase request', call(c, 'saveSalesOpp', Object.assign({ source: 'request', recordNo: 'PR-1', value: '150,000' }, GERALD)).success && opp(plan(c, GERALD), 'PR-1').value === 150000
     && opp(plan(c, GERALD), 'PR-1').weighted === 45000);
  ok('a lead needs a company and what it is', /company/.test(call(c, 'saveSalesOpp', Object.assign({ source: 'lead', project: 'Gearbox' }, GERALD)).message)
     && /what the opportunity is/.test(call(c, 'saveSalesOpp', Object.assign({ source: 'lead', company: 'New Co' }, GERALD)).message));
  const l1 = call(c, 'saveSalesOpp', Object.assign({ source: 'lead', clientNo: 'CB-2', project: 'Mill relining tools', value: 400000, stage: 'Qualified', clientRef: 'lead-1' }, GERALD));
  const lr = opp(plan(c, GERALD), l1.oppNo);
  ok('a lead on one of his clients: the company from the book, Qualified at 20%', l1.success && /^OPP-/.test(l1.oppNo) && lr.company === 'Philex Mining' && lr.stage === 'Qualified' && lr.probability === 20 && lr.weighted === 80000, lr);
  ok('the same submit twice is one lead', call(c, 'saveSalesOpp', Object.assign({ source: 'lead', company: 'X', project: 'Y', clientRef: 'lead-1' }, GERALD)).duplicate === true
     && store.SalesOpps.filter(r => r['Source'] === 'lead').length === 1);
  ok('a lead on another rep\'s client is refused', !call(c, 'saveSalesOpp', Object.assign({ source: 'lead', clientNo: 'CB-4', project: 'X' }, GERALD)).success);
  ok('a rep cannot change another rep\'s lead', !call(c, 'saveSalesOpp', Object.assign({ source: 'lead', oppNo: l1.oppNo, project: 'Mine now' }, KIM)).success);
  ok('the director can', call(c, 'saveSalesOpp', Object.assign({ source: 'lead', oppNo: l1.oppNo, user: 'Gerald Lucena', nextAction: 'Site survey' }, NEIL)).success);
  const won = call(c, 'saveSalesOpp', Object.assign({ source: 'lead', oppNo: l1.oppNo, stage: 'Closed Won' }, GERALD));
  ok('a lead closed won: 100%, dated today', won.success && opp(plan(c, GERALD), l1.oppNo).probability === 100 && store.SalesOpps.find(r => r['Opp No'] === l1.oppNo)['Closed At'] === '2026-11-23');
  const up = opp(plan(c, GERALD), l1.oppNo).updatedAt;
  ok('a stale save is refused', call(c, 'saveSalesOpp', Object.assign({ source: 'lead', oppNo: l1.oppNo, notes: 'x', ifUpdatedAt: '2020-01-01T00:00:00.000Z' }, GERALD)).stale === true && !!up);
  const a1 = call(c, 'archiveSalesOpp', Object.assign({ oppNo: l1.oppNo }, GERALD));
  ok('archived: off the pipeline, kept on the sheet', a1.success && !opp(plan(c, GERALD), l1.oppNo) && store.SalesOpps.length >= 1);
  ok('  Kim cannot archive it, archiving twice says so', !call(c, 'archiveSalesOpp', Object.assign({ oppNo: l1.oppNo }, KIM)).success && /already/.test(call(c, 'archiveSalesOpp', Object.assign({ oppNo: l1.oppNo }, GERALD)).message));
  ok('  the Undo puts it back', call(c, 'archiveSalesOpp', Object.assign({ oppNo: l1.oppNo, restore: true }, GERALD)).success && !!opp(plan(c, GERALD), l1.oppNo));
  ok('every row is the tab\'s full width', store.SalesOpps.every(r => r.__arity === undefined || r.__arity === 23));
}

sec('7 · the year target and its months: the director and management');
{
  const { c, store } = world();
  const months = [5, 5, 8, 8, 8, 8, 9, 9, 10, 10, 10, 10];
  ok('a rep cannot set targets', /Only director, management/.test(call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2026, annual: 1 }, GERALD)).message));
  ok('months that do not add up to 100% are refused', /add up to 100/.test(call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2026, annual: 12000000, months: [10, 10] }, NEIL)).message));
  ok('an unknown rep is refused', !call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Nobody Here', year: 2026, annual: 1 }, NEIL)).success);
  ok('a year far ahead is refused', !call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2029, annual: 1 }, NEIL)).success);
  const s = call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2026, annual: '12,000,000', months: months, tierTargets: { A: 800000, B: 500000, C: 200000 } }, NEIL));
  const r = plan(c, GERALD);
  ok('the director sets ₱12M with a seasonal split', s.success && r.plan.annual === 12000000 && r.plan.set && !r.plan.evenSplit && r.months[0].target === 600000 && r.months[11].target === 1200000, [s, r.plan]);
  ok('  the tier targets move the automatic account targets', acct(r, 'CB-1').target === 800000 && acct(r, 'CB-3').target === 200000);
  ok('  Kimberlyn keeps the default ₱25M, even', plan(c, KIM).plan.annual === 25000000 && plan(c, KIM).plan.evenSplit);
  ok('  next year\'s plan is its own row', call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2027, annual: 25000000 }, LARRY)).success && store.SalesPlan.length === 2
     && plan(c, GERALD, { year: 2027 }).plan.annual === 25000000 && plan(c, GERALD).plan.annual === 12000000);
  ok('  a stale save is refused', call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2026, annual: 1, ifUpdatedAt: 'old' }, NEIL)).stale === true);
  const { c: c2, store: s2 } = world(); s2.FlowSettings.push({ Key: 'salesPlanTierTargets', Value: 'A 2000000; B 900000; C 100000' }, { Key: 'salesPlanTierRanks', Value: '5,20,40' }, { Key: 'salesPlanDefaultTarget', Value: 30000000 });
  const r2 = plan(c2, GERALD);
  ok('FlowSettings move the defaults (tier targets, ranks, the year target)', r2.plan.annual === 30000000 && acct(r2, 'CB-1').target === 2000000 && acct(r2, 'CB-2').tier === 'B' && acct(r2, 'CB-2').target === 900000
     && acct(r2, 'CB-3').tier === 'C' && acct(r2, 'CB-8').tier === 'C');
}

sec('8 · a rep keeps their own accounts');
{
  const { c, store } = world();
  const s = call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', tier: 'B', focus: 'Torque tools; bolt tensioners', status: 'Active' }, GERALD));
  let a = acct(plan(c, GERALD), 'CB-1');
  ok('Gerald moves Therma to B: the target follows the tier', s.success && a.tier === 'B' && a.tierSet && a.target === 600000 && !a.targetSet && a.focus === 'Torque tools; bolt tensioners' && a.status === 'Active' && a.statusSet, a);
  call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', target: '750,000' }, GERALD));
  a = acct(plan(c, GERALD), 'CB-1');
  ok('  his own target for it', a.target === 750000 && a.targetSet && a.tier === 'B');
  call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', tier: '', target: '', status: '' }, GERALD));
  a = acct(plan(c, GERALD), 'CB-1');
  ok('  blanks go back to the automatic tier, target and status (the focus stays)', a.tier === 'A' && a.target === 1000000 && a.status === 'Prospect' && a.focus === 'Torque tools; bolt tensioners');
  call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-3', tier: '-' }, GERALD));
  ok('  "-" takes an account out of the tiers', acct(plan(c, GERALD), 'CB-3').tier === '' && acct(plan(c, GERALD), 'CB-3').target === 0);
  ok('another rep\'s client is refused', /not in Gerald Lucena's Client Book/.test(call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-4', tier: 'A' }, GERALD)).message));
  ok('a tier D and a bad target are refused', !call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', tier: 'D' }, GERALD)).success
     && !call(c, 'saveSalesPlanAccount', Object.assign({ year: 2026, clientNo: 'CB-1', target: 'lots' }, GERALD)).success);
  ok('the director changes Kimberlyn\'s', call(c, 'saveSalesPlanAccount', Object.assign({ user: 'Kimberlyn Blones', year: 2026, clientNo: 'CB-4', status: 'On Hold' }, NEIL)).success
     && acct(plan(c, KIM), 'CB-4').status === 'On Hold');
  ok('one row per rep, year and client, full width', store.SalesPlanAccounts.length === 3 && store.SalesPlanAccounts.every(r => r.__arity === undefined || r.__arity === 10));
  ok('next year\'s account plan is apart', acct(plan(c, GERALD, { year: 2027 }), 'CB-1').focus === '');
}

sec('9 · oversight: every rep side by side, and the orders credited to nobody');
{
  const { c } = world();
  const r = plan(c, NEIL, { all: true });
  const g = r.people.find(p => p.user === 'Gerald Lucena'), k = r.people.find(p => p.user === 'Kimberlyn Blones');
  ok('one line per rep', r.all && r.people.map(p => p.user).join() === 'Gerald Lucena,Kimberlyn Blones,Mikaella Chloe Rufino');
  ok('  the year so far, orders, accounts and this month', g.ytd === 500000 && g.orders === 2 && g.accounts === 5 && g.month.month === 11 && k.ytd === 500000);
  ok('  the open pipeline, weighted', g.open === 120000 && g.weighted === 48000 && g.openCount === 4, g);
  ok('  gross profit for the director', g.gp === 70000);
  ok('the orders in nobody\'s plan (cancelled left out)', r.unassigned.map(x => x.soNo).join() === 'SO-4');
  const { c: c3, store: s3 } = world();
  s3.Quotations.push({ 'Quotation No': 'Q-CG', 'Date': '2026-04-01', 'Customer': 'Petra Cement Inc.', 'Status': 'Sent', 'Total': 5000, 'Salesperson': 'Crystal Gayle' });
  s3.SalesOrders.push({ 'SO No': 'SO-CG', 'Quotation No': 'Q-CG', 'Date': '2026-04-10', 'Customer': 'Petra Cement Inc.', 'Status': 'Delivered', 'Total': 5000 });
  const r3 = plan(c3, NEIL, { all: true });
  ok('  and the orders on a quotation of someone with no plan, with that name', r3.unassigned.some(x => x.soNo === 'SO-CG' && x.owner === 'Crystal Gayle') && !r3.people.some(p => p.user === 'Crystal Gayle'), r3.unassigned);
  ok('a rep asking for all gets their own plan', !plan(c, GERALD, { all: true }).all);
  const s = plan(c, GERALD, { summary: true });
  ok('the home card\'s summary: the plan, the months and the year so far', s.summary && s.ytd === 500000 && s.months.length === 12 && !s.accounts && s.plan.annual === 25000000);
}

sec('10 · daily activity, from what the rep already records');
{
  const { c } = world();
  const r = call(c, 'getSalesActivity', Object.assign({ from: '2026-11-01', to: '2026-11-23' }, GERALD));
  const t = (type) => r.rows.filter(x => x.type === type);
  ok('read', r.success && r.from === '2026-11-01' && r.to === '2026-11-23', r);
  ok('a call about a quotation is a quotation follow-up, with its value and next action', t('Quotation follow-up').length === 1 && t('Quotation follow-up')[0].value === 90000 && t('Quotation follow-up')[0].nextAction === 'Call back Friday');
  ok('a visit with its next action and date', t('Customer visit').some(x => x.company === 'Philex Mining' && x.nextAction === 'Send RFQ form' && x.nextDate === '2026-11-20' && x.person === 'Engr. Dela Cruz'));
  ok('the new types (a site survey) come through', t('Site survey').length === 1 && t('Site survey')[0].outcome === 'Done');
  ok('voided lines are left out', !r.rows.some(x => x.company === 'Holcim Davao' && x.source === 'Daily report'));
  ok('the day\'s sent emails, counted at 4:30', t('Email').length === 1 && t('Email')[0].count === 12);
  ok('a visit plan marked done, and the old call log', r.rows.some(x => x.source === 'Visit plan' && x.company === 'Therma South, Inc.') && r.rows.some(x => x.source === 'Call log' && x.company === 'Holcim Davao'));
  ok('newest first', r.rows[0].date >= r.rows[r.rows.length - 1].date);
  ok('a rep reads their own only', call(c, 'getSalesActivity', Object.assign({ user: 'Gerald Lucena', from: '2026-11-01' }, KIM)).rows.every(x => !/Philex|Therma/.test(x.company)));
  ok('the director reads Gerald\'s', call(c, 'getSalesActivity', Object.assign({ user: 'Gerald Lucena', from: '2026-11-01', to: '2026-11-23' }, NEIL)).rows.length === r.rows.length);
  ok('more than three months at a time is refused', /three months/.test(call(c, 'getSalesActivity', Object.assign({ from: '2026-01-01', to: '2026-11-23' }, GERALD)).message));
  ok('admin is refused', !call(c, 'getSalesActivity', Object.assign({ from: '2026-11-01' }, ANA)).success);
}

sec('11 · no Script Property; every action registered');
{
  const { c } = world(), props0 = JSON.stringify(Object.keys(c.__props).sort());
  call(c, 'saveSalesOpp', Object.assign({ source: 'lead', company: 'A', project: 'B' }, GERALD));
  call(c, 'saveSalesPlanTarget', Object.assign({ user: 'Gerald Lucena', year: 2026, annual: 1 }, NEIL));
  ok('no Script Property was added', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
  const FL = fs.readFileSync(path.join(__dirname, '..', '..', 'blueprints', 'flow.py'), 'utf8');
  const FA = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'js', 'flow-api.js'), 'utf8');
  ['getSalesPlan', 'getSalesActivity', 'saveSalesPlanTarget', 'saveSalesPlanAccount', 'saveSalesOpp', 'archiveSalesOpp'].forEach(a => {
    ok(a + ' is secured in FlowAPI, Flask and the browser', new RegExp('\\b' + a + ': 1').test(SRC) && FL.indexOf('"' + a + '"') >= 0 && FA.indexOf("'" + a + "'") >= 0);
  });
  ok('the four writes are mutations and logged under Sales plan', /saveSalesPlanTarget: 1, saveSalesPlanAccount: 1, saveSalesOpp: 1, archiveSalesOpp: 1,/.test(SRC) && /saveSalesOpp: \['Sales plan', 'Pipeline updated'\]/.test(SRC));
  ok('FLOW_VERSION 204 with the A403 CHANGELOG line', /^var FLOW_VERSION = 204;/m.test(SRC) && /^A403 THE SALES PLAN \(202/m.test(SRC));
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
