/* A382 — the quotation status store (FlowAPI 191: setQuotationResult, the nine result columns, and what closing,
 * reopening, revising and linking an email now record).
 *
 * Run:  node tests/flow/quotation-result-store.js
 *
 * Neil, 29 Oct 2026: for each rep their own list of every quotation, each one set to Won, Pending (the last follow-up
 * and where it stands) or Lost with a reason — "we just need to have the status of all the quotations". Runs the real
 * FlowAPI.gs through its dispatcher (gasload), so the secret, the lock list and the activity log are under test too.
 *   1 · the version, the width, both positional writers
 *   2 · won
 *   3 · pending: a date and how; a picked email (as a follow-up, or as the first email); validation
 *   4 · lost: the reason decides the outcome; it leaves the result alone, so Undo restores the row
 *   5 · closed quotations change back to exactly what they were
 *   6 · several at once
 *   7 · who may
 *   8 · close, reopen, revise, getQuotations, the activity log, the secret, the Undo guard
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

const KIM = { actorName: 'Kimberlyn Blones', actorRole: 'sales', actorUsername: 'sales1' };
const GERALD = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'sales2' };
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const ACCT = { actorName: 'Accounting One', actorRole: 'accounting', actorUsername: 'acct1' };

function q(no, owner, status, extra) {
  return Object.assign({ 'Quotation No': no, 'Date': '2026-08-01', 'Customer': 'Apex Mining Co., Inc.', 'Status': status, 'Total': 150000,
    'Created By': 'Crystal Gayle', 'Created At': new Date(2026, 7, 1), 'Subject': 'Hydraulic jack', 'Salesperson': owner,
    'Sent At': '', 'Approved At': '' }, extra || {});
}
function store() {
  return {
    ActivityLog: [], QuotationEmails: [], FlowSettings: [],
    Quotations: [
      q('2026-431-KPB-APEX', 'Kimberlyn Blones', 'Sent', { 'Sent At': '2026-08-03', 'Approved At': '2026-08-02' }),
      q('2026-432-KPB-TAIHEIYO', 'Kimberlyn Blones', 'Approved', { 'Approved At': '2026-08-05', 'Customer': 'Taiheiyo Cement Philippines Inc.' }),
      q('2026-433-KPB-DRAFT', 'Kimberlyn Blones', 'Draft'),
      q('2026-434-KPB-INAPPROVAL', 'Kimberlyn Blones', 'Pending Admin'),
      q('2026-435-KPB-OLDLOST', 'Kimberlyn Blones', 'Lost', { 'Sent At': '2026-07-20', 'Approval Note': 'Closed as Lost by Kimberlyn Blones' }),
      q('2026-436-KPB-NEVERSENT', 'Kimberlyn Blones', 'Not Pursued'),
      q('2026-437-KPB-ORDERED', 'Kimberlyn Blones', 'Sent', { 'Sent At': '2026-08-04' }),
      q('2026-438-GL-SLTEC', 'Gerald Lucena', 'Sent', { 'Sent At': '2026-09-01', 'Customer': 'South Luzon Thermal Energy' }),
      q('2026-439-KPB-TYPED', 'Kimberlyn Blones', 'Sent', { 'Sent At': '2026-08-06', 'Created By': 'Gerald Lucena' })
    ],
    QuotationItems: [],
    SalesOrders: [{ 'SO No': 'SO-2026-090', 'Quotation No': '2026-437-KPB-ORDERED', 'Customer': 'Apex Mining Co., Inc.' }]
  };
}
const row = (st, no) => st.Quotations.find(r => r['Quotation No'] === no);
const set = (c, who, params) => call(c, 'setQuotationResult', Object.assign({}, who, params));

sec('1 · the version, the width, both writers');
{
  const c = load(GS, store());
  eq('getVersion', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version, 191);
  eq('Quotations is 38 wide', c.SCHEMA.Quotations.length, 38);
  eq('the nine columns, in order, after Service Kind', c.SCHEMA.Quotations.slice(28),
     ['Service Kind', 'Result', 'Result At', 'Result By', 'Result Reason', 'Result Note', 'Last Follow Up', 'Follow Up Via', 'Follow Up Status', 'Closed From']);
  const st = { ActivityLog: [], Quotations: [], QuotationItems: [], Inventory: [], FlowSettings: [], SalesOrders: [], PricingRequests: [] };
  const c2 = load(GS, st);
  const r = call(c2, 'createQuotation', Object.assign({ customer: 'Acme', date: '2026-10-01', items: JSON.stringify([{ itemNo: 'X1', itemName: 'Pump', qty: 1, price: 100 }]), createdBy: 'Gerald Lucena' }, GERALD));
  ok('createQuotation appends a row exactly 38 values wide', r.success && st.Quotations.length === 1 && st.Quotations[0].__arity === 38, [r, st.Quotations[0] && st.Quotations[0].__arity]);
  ok('  with the result columns blank', st.Quotations[0] && st.Quotations[0]['Result'] === '' && st.Quotations[0]['Closed From'] === '');
  ok('the server owns the lists (8 lost reasons, 7 follow-up statuses, 4 ways)', c._QUOTE_LOST_REASONS.length === 8 && c._QUOTE_FOLLOWUP_STATUSES.length === 7 && c._QUOTE_FOLLOWUP_VIA.join() === 'Email,Call,Viber,Visit');
}

sec('2 · won');
{
  const st = store(), c = load(GS, st);
  const r = set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'won', note: 'PO 4500123' });
  ok('a sent quotation is marked won', r.success && r.results[0].result === 'Won' && r.results[0].status === 'Sent', r);
  ok('  Status is untouched, the note, who and when are kept', row(st, '2026-431-KPB-APEX')['Status'] === 'Sent' && row(st, '2026-431-KPB-APEX')['Result'] === 'Won' &&
     row(st, '2026-431-KPB-APEX')['Result Note'] === 'PO 4500123' && row(st, '2026-431-KPB-APEX')['Result By'] === 'Kimberlyn Blones' && !!row(st, '2026-431-KPB-APEX')['Result At']);
  ok('  the previous state comes back for Undo', r.results[0].previous.result === '' && r.results[0].previous.status === 'Sent');
  ok('an approved one can be won too', set(c, KIM, { quotationNo: '2026-432-KPB-TAIHEIYO', result: 'won' }).success);
  const so = set(c, KIM, { quotationNo: '2026-437-KPB-ORDERED', result: 'won' });
  ok('one with a sales order is won already: success, nothing written', so.success && so.results[0].alreadyWon && so.results[0].soNo === 'SO-2026-090' && !row(st, '2026-437-KPB-ORDERED')['Result'] && !row(st, '2026-437-KPB-ORDERED')['Result At'], so);
  const d = set(c, KIM, { quotationNo: '2026-433-KPB-DRAFT', result: 'won' }), a = set(c, KIM, { quotationNo: '2026-434-KPB-INAPPROVAL', result: 'won' });
  ok('a draft, or one in approval, cannot be won', !d.success && !a.success && /not approved yet/.test(d.message) && /Pending Admin/.test(a.message), [d, a]);
}

sec('3 · pending');
{
  const st = store(), c = load(GS, st);
  const r = set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Call', followUpDate: '2026-10-20', followUpStatus: 'Waiting for their PO', note: 'Buyer on leave' });
  const x = row(st, '2026-431-KPB-APEX');
  ok('a call on a date, and where it stands', r.success && x['Result'] === 'Pending' && x['Last Follow Up'] === '2026-10-20' && x['Follow Up Via'] === 'Call' &&
     x['Follow Up Status'] === 'Waiting for their PO' && x['Result Note'] === 'Buyer on leave', [r, x]);
  ok('  nothing linked when it was not an email', st.QuotationEmails.length === 0 && !r.linkId);
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const bad = [
    set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Call', followUpDate: tomorrow, followUpStatus: 'Waiting for reply' }),
    set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Call', followUpDate: '2026-07-01', followUpStatus: 'Waiting for reply' }),
    set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Fax', followUpDate: '2026-10-20', followUpStatus: 'Waiting for reply' }),
    set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Call', followUpDate: '2026-10-20', followUpStatus: 'Sleeping' }),
    set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Call', followUpDate: '2026-10-20', followUpStatus: 'Other' }),
    set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Call', followUpStatus: 'Waiting for reply' })
  ];
  ok('refused: a date in the future, before the quotation, an unknown way, an unknown status, Other with no note, no date',
     bad.every(b => !b.success) && /future/.test(bad[0].message) && /before the quotation/.test(bad[1].message) && /how you followed up/.test(bad[2].message) &&
     /where it stands/i.test(bad[3].message) && /needs a note/.test(bad[4].message) && /date/.test(bad[5].message), bad.map(b => b.message));
  ok('  and none of them changed the row', row(st, '2026-431-KPB-APEX')['Last Follow Up'] === '2026-10-20');

  const em = { messageId: '<ABC123@mail.hiescorp.com>', sentAt: '2026-10-22T09:14:00+08:00', subject: 'Re: Quotation 2026-431', to: 'buyer@apex.ph', threadRoot: '<root@x>', mailboxAddr: 'kim@hiescorp.com' };
  const e = set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', email: em, followUpStatus: 'Client is evaluating' });
  const y = row(st, '2026-431-KPB-APEX'), link = st.QuotationEmails[0];
  ok('a picked email: linked as a follow-up, its date is the last follow-up', e.success && e.linkId && link && link['Kind'] === 'Follow-up' && link['Mailbox User'] === 'sales1' &&
     y['Last Follow Up'] === '2026-10-22' && y['Follow Up Via'] === 'Email', [e, link, y['Last Follow Up']]);
  ok('  and the quotation keeps its own send date (a follow-up is a chase, not the send)', y['Sent At'] === '2026-08-03', y['Sent At']);

  const em2 = { messageId: 'first@mail', sentAt: '2026-08-07T08:00:00+08:00', subject: 'Quotation 2026-432', to: 'buyer@taiheiyo.ph' };
  const f = set(c, KIM, { quotationNo: '2026-432-KPB-TAIHEIYO', result: 'pending', email: em2, followUpStatus: 'Waiting for reply' });
  const z = row(st, '2026-432-KPB-TAIHEIYO'), link2 = st.QuotationEmails.find(l => l['Quotation No'] === '2026-432-KPB-TAIHEIYO');
  ok('on an approved quotation never sent, the email is its first one, and becomes its send date', f.success && link2['Kind'] === 'Initial' && !!z['Sent At'], [f, link2 && link2['Kind'], z['Sent At']]);
  const gl = c.linkQuotationEmail(Object.assign({ quotationNo: '2026-438-GL-SLTEC', messageId: 'late@x', sentAt: '2026-07-01', kind: 'Follow-up' }, GERALD));
  ok('linkQuotationEmail: an explicit follow-up never moves Sent At, even when it is older', gl.success && row(st, '2026-438-GL-SLTEC')['Sent At'] === '2026-09-01');
  ok('pending is one quotation at a time', !set(c, KIM, { quotationNos: ['2026-431-KPB-APEX'], result: 'pending', followUpVia: 'Call', followUpDate: '2026-10-20', followUpStatus: 'Waiting for reply' }).success);
}

sec('4 · lost');
{
  const st = store(), c = load(GS, st);
  set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'pending', followUpVia: 'Viber', followUpDate: '2026-10-01', followUpStatus: 'Will call back' });
  const r = set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'lost', reason: 'Price', note: 'Competitor 8% lower' });
  const x = row(st, '2026-431-KPB-APEX');
  ok('Price → Lost, the reason code and the status it was closed from', r.success && x['Status'] === 'Lost' && x['Result Reason'] === 'Price' && x['Closed From'] === 'Sent' &&
     /Closed as Lost by Kimberlyn Blones — Price: Competitor 8% lower/.test(x['Approval Note']), [r, x]);
  ok('  the result and follow-up fields are left as they were', x['Result'] === 'Pending' && x['Last Follow Up'] === '2026-10-01' && x['Follow Up Via'] === 'Viber');
  const u = set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'open', keep: true, approvalNote: r.results[0].previous.approvalNote, ifResultAt: r.results[0].resultAt });
  const y = row(st, '2026-431-KPB-APEX');
  ok('Undo (open, keep) puts it back exactly: Sent, still pending, the old note', u.success && y['Status'] === 'Sent' && y['Result'] === 'Pending' && y['Closed From'] === '' &&
     y['Result Reason'] === '' && y['Approval Note'] === '', [u, y['Status'], y['Result'], y['Approval Note']]);
  const map = [['No reply from the client', 'Not Pursued'], ['No budget', 'Not Pursued'], ['Duplicate quotation', 'Cancelled'], ['Went with a competitor', 'Lost'], ['Lead time', 'Lost'], ['Specs did not fit', 'Lost']];
  const got = map.map(([reason]) => { const s2 = store(), c2 = load(GS, s2); set(c2, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'lost', reason }); return row(s2, '2026-431-KPB-APEX')['Status']; });
  eq('the reason decides the outcome', got, map.map(m => m[1]));
  ok('Other needs a note; an unknown reason is refused', !set(c, KIM, { quotationNo: '2026-439-KPB-TYPED', result: 'lost', reason: 'Other' }).success &&
     !set(c, KIM, { quotationNo: '2026-439-KPB-TYPED', result: 'lost', reason: 'Bad luck' }).success);
  const so = set(c, KIM, { quotationNo: '2026-437-KPB-ORDERED', result: 'lost', reason: 'Price' });
  ok('one with a sales order cannot be lost', !so.success && /SO-2026-090/.test(so.message), so);
  const d = set(c, KIM, { quotationNo: '2026-433-KPB-DRAFT', result: 'lost', reason: 'Duplicate quotation' });
  ok('a draft can be closed (a duplicate retyped)', d.success && row(st, '2026-433-KPB-DRAFT')['Status'] === 'Cancelled' && row(st, '2026-433-KPB-DRAFT')['Closed From'] === 'Draft');
  const again = set(c, KIM, { quotationNo: '2026-433-KPB-DRAFT', result: 'lost', reason: 'No budget' });
  ok('closing a closed one again only changes its reason and outcome, and keeps where it came from', again.success && row(st, '2026-433-KPB-DRAFT')['Status'] === 'Not Pursued' &&
     row(st, '2026-433-KPB-DRAFT')['Closed From'] === 'Draft' && row(st, '2026-433-KPB-DRAFT')['Result Reason'] === 'No budget');
}

sec('5 · closed quotations change back to what they were');
{
  const st = store(), c = load(GS, st);
  const w = set(c, KIM, { quotationNo: '2026-435-KPB-OLDLOST', result: 'won', note: 'They came back' });
  ok('closed before 191 (no Closed From) but sent: restored to Sent, then won', w.success && row(st, '2026-435-KPB-OLDLOST')['Status'] === 'Sent' && row(st, '2026-435-KPB-OLDLOST')['Result'] === 'Won' &&
     /Reopened from Lost by Kimberlyn Blones/.test(row(st, '2026-435-KPB-OLDLOST')['Approval Note']), w);
  const n = set(c, KIM, { quotationNo: '2026-436-KPB-NEVERSENT', result: 'pending', followUpVia: 'Call', followUpDate: '2026-10-01', followUpStatus: 'Waiting for reply' });
  ok('closed and never sent or approved: refused, with the way out', !n.success && /reopen it to Draft/.test(n.message), n);
  set(c, KIM, { quotationNo: '2026-433-KPB-DRAFT', result: 'lost', reason: 'Duplicate quotation' });
  ok('closed from Draft: it cannot be won', !set(c, KIM, { quotationNo: '2026-433-KPB-DRAFT', result: 'won' }).success);
  const o = set(c, KIM, { quotationNo: '2026-433-KPB-DRAFT', result: 'open' });
  ok('  but open puts it back to Draft', o.success && row(st, '2026-433-KPB-DRAFT')['Status'] === 'Draft' && row(st, '2026-433-KPB-DRAFT')['Closed From'] === '');
  set(c, KIM, { quotationNo: '2026-439-KPB-TYPED', result: 'won' });
  const cl = set(c, KIM, { quotationNo: '2026-439-KPB-TYPED', result: 'open' });
  ok('open on a won one clears the result', cl.success && row(st, '2026-439-KPB-TYPED')['Result'] === '' && row(st, '2026-439-KPB-TYPED')['Status'] === 'Sent');
  const same = set(c, KIM, { quotationNo: '2026-439-KPB-TYPED', result: 'open' });
  ok('  and again is a success that changes nothing', same.success && same.results[0].unchanged);
}

sec('6 · several at once');
{
  const st = store(), c = load(GS, st);
  const r = set(c, KIM, { quotationNos: ['2026-431-KPB-APEX', '2026-432-KPB-TAIHEIYO', '2026-437-KPB-ORDERED', '2026-438-GL-SLTEC', '2026-431-KPB-APEX'], result: 'lost', reason: 'No reply from the client' });
  ok('closes what may be closed, says what was not (a sales order, another rep\'s), counts once each', r.success && r.results.length === 2 && r.refused.length === 2 &&
     row(st, '2026-431-KPB-APEX')['Status'] === 'Not Pursued' && row(st, '2026-432-KPB-TAIHEIYO')['Status'] === 'Not Pursued' && row(st, '2026-438-GL-SLTEC')['Status'] === 'Sent' &&
     /Closed 2 quotations; 2 could not be changed/.test(r.message), r);
  const notes = {}; r.results.forEach(x => { notes[x.quotationNo] = x.previous.approvalNote; });
  row(st, '2026-432-KPB-TAIHEIYO')['Approval Note'];   // (the fixture had none)
  const u = set(c, KIM, { quotationNos: ['2026-431-KPB-APEX', '2026-432-KPB-TAIHEIYO'], result: 'open', keep: true, approvalNotes: JSON.stringify(notes) });
  ok('Undo of a bulk close restores each to the status it was closed from, with its own note', u.success && row(st, '2026-431-KPB-APEX')['Status'] === 'Sent' &&
     row(st, '2026-432-KPB-TAIHEIYO')['Status'] === 'Approved' && row(st, '2026-431-KPB-APEX')['Approval Note'] === '' && row(st, '2026-431-KPB-APEX')['Closed From'] === '', u);
  const many = Array.from({ length: 26 }, (_, i) => 'Q' + i);
  ok('at most 25 at a time', !set(c, KIM, { quotationNos: many, result: 'lost', reason: 'Price' }).success);
  ok('won and pending are one at a time', !set(c, KIM, { quotationNos: ['2026-431-KPB-APEX'], result: 'won' }).success);
  ok('a JSON string list works too (what a form posts)', set(c, KIM, { quotationNos: JSON.stringify(['2026-439-KPB-TYPED']), result: 'lost', reason: 'Price' }).success);
}

sec('7 · who may');
{
  const st = store(), c = load(GS, st);
  const g = set(c, GERALD, { quotationNo: '2026-431-KPB-APEX', result: 'won' });
  ok('another rep is refused, by name', !g.success && /Kimberlyn Blones's — you can only update your own/.test(g.message), g);
  ok('the person who typed it may (Gerald typed 2026-439)', set(c, GERALD, { quotationNo: '2026-439-KPB-TYPED', result: 'won' }).success);
  ok('a name in other case still matches', set(c, { actorName: 'kimberlyn blones', actorRole: 'sales', actorUsername: 'sales1' }, { quotationNo: '2026-431-KPB-APEX', result: 'won' }).success);
  ok('accounting is refused', !set(c, ACCT, { quotationNo: '2026-438-GL-SLTEC', result: 'won' }).success);
  ok('the director may set any rep\'s', set(c, NEIL, { quotationNo: '2026-438-GL-SLTEC', result: 'won' }).success && row(st, '2026-438-GL-SLTEC')['Result By'] === 'Neil Estur');
  const blocked = call(c, 'setQuotationResult', Object.assign({ flowSecret: '', quotationNo: '2026-438-GL-SLTEC', result: 'open' }, NEIL));
  ok('no secret, no change', !blocked.success && row(st, '2026-438-GL-SLTEC')['Result'] === 'Won', blocked);
}

sec('8 · close, reopen, revise, the read, the log, the Undo guard');
{
  const st = store(), c = load(GS, st);
  call(c, 'closeQuotation', Object.assign({ quotationNo: '2026-431-KPB-APEX', outcome: 'Lost', reason: 'Price' }, KIM));
  ok('closeQuotation records the status it was closed from', row(st, '2026-431-KPB-APEX')['Closed From'] === 'Sent');
  set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'won' });
  call(c, 'closeQuotation', Object.assign({ quotationNo: '2026-439-KPB-TYPED', outcome: 'Lost' }, KIM));
  call(c, 'reopenQuotation', Object.assign({ quotationNo: '2026-439-KPB-TYPED' }, KIM));
  ok('reopenQuotation clears the result, the reason and Closed From', row(st, '2026-439-KPB-TYPED')['Status'] === 'Draft' && row(st, '2026-439-KPB-TYPED')['Closed From'] === '' && row(st, '2026-439-KPB-TYPED')['Result'] === '');
  set(c, KIM, { quotationNo: '2026-432-KPB-TAIHEIYO', result: 'won' });
  call(c, 'reviseQuotation', Object.assign({ quotationNo: '2026-432-KPB-TAIHEIYO', reason: 'New price' }, KIM));
  ok('reviseQuotation clears the result (a new offer)', row(st, '2026-432-KPB-TAIHEIYO')['Result'] === '' && row(st, '2026-432-KPB-TAIHEIYO')['Status'] === 'Draft');
  set(c, KIM, { quotationNo: '2026-437-KPB-ORDERED', result: 'won' });
  set(c, GERALD, { quotationNo: '2026-438-GL-SLTEC', result: 'pending', followUpVia: 'Visit', followUpDate: '2026-10-15', followUpStatus: 'Asked for a revised offer' });
  const g = c.getQuotations({}).data.find(x => x.quotationNo === '2026-438-GL-SLTEC');
  ok('getQuotations returns the result fields', g.result === 'Pending' && g.lastFollowUp === '2026-10-15' && g.followUpVia === 'Visit' && g.followUpStatus === 'Asked for a revised offer' &&
     /^\d{4}-\d{2}-\d{2}T/.test(g.resultAt) && g.resultBy === 'Gerald Lucena' && 'closedFrom' in g && 'resultReason' in g && 'resultNote' in g, g);
  const logs = st.ActivityLog.filter(l => l['Module'] === 'Quotation' && l['Action'] === 'Status Updated');
  ok('each change is in the activity log as Quotation / Status Updated, with its number and who', logs.length >= 3 &&
     logs.some(l => l['Ref No'] === '2026-438-GL-SLTEC' && l['User'] === 'Gerald Lucena' && /pending/.test(l['Summary'])), logs.slice(0, 2));
  const now = row(st, '2026-438-GL-SLTEC');
  const stale = set(c, GERALD, { quotationNo: '2026-438-GL-SLTEC', result: 'open', ifResultAt: '2026-01-01T00:00:00.000Z' });
  ok('Undo refuses when someone changed the row since', !stale.success && /changed since/.test(stale.message) && now['Result'] === 'Pending', stale);
  ok('an unknown result is refused', !set(c, KIM, { quotationNo: '2026-431-KPB-APEX', result: 'maybe' }).success);
  ok('setQuotationResult is secured and takes the lock', !!c._SECURED.setQuotationResult && !!c.MUTATIONS.setQuotationResult && c._MODULE_MAP.setQuotationResult.join() === 'Quotation,Status Updated');
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
