/* A323 — Collect: the director's phone records collections; accounting and admin acknowledge.
 *
 * Run:  node tests/flow/collect-backend.js
 *
 * Pinned:
 *   1. Only the director records or undoes; only accounting / admin acknowledge.
 *   2. The method decides where the money may be: cheque → not yet deposited (1100) or a bank,
 *      cash → cash on hand (1010) or a bank, transfer → a bank. A cheque needs its number; a
 *      post-dated cheque is accepted and flagged.
 *   3. One cheque can pay several invoices of ONE customer: one batch, one Collections row each,
 *      every line validated before the first write.
 *   4. Over-collection, missing proof of collection and a cheque number already used each come back
 *      as a question, never a silent write; a photo filed as Proof of collection answers the proof.
 *   5. The same clientRef twice records once — also after a failure part-way through a batch.
 *   6. Not collected keeps a reason and a promised date; AR Aging shows it, and "missed" once the
 *      promise has passed; a later collection clears it.
 *   7. Notices: what is New, what arrived since a moment; acknowledging clears it.
 *   8. Undo: recorder only, same day, before acknowledgement; it voids the collections and reopens AR.
 *   9. The activity log carries the amount; with the books in shadow each method posts to its account.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);

const NEIL = { actorRole: 'director', actorName: 'Neil Estur' };
const ANA = { actorRole: 'accounting', actorName: 'Ana Acct' };
const ADMIN = { actorRole: 'admin', actorName: 'Ada Admin' };

function boot(books) {
  const ar = (no, inv, so, cust, amt, due) => ({ 'AR No': no, 'INV No': inv, 'SO No': so, 'Customer': cust, 'Amount (PHP)': amt,
    'Collected (PHP)': 0, 'Status': 'Unpaid', 'Due Date': due, 'Notes': '', 'Created At': '2026-07-01', 'Updated At': '' });
  const so = (no, cust, created) => ({ 'SO No': no, 'Quotation No': '', 'Date': created, 'Customer': cust, 'Status': 'Delivered', 'Total': 0,
    'Created By': 'x', 'Created At': created, 'Supplier Type': 'Local', 'Client PO Date': '', 'PO Received Date': '', 'Client PO No': '', 'Type': '', 'Service Kind': '' });
  const inv = (no, so, cust, total) => ({ 'INV No': no, 'SO No': so, 'Date': '2026-07-01', 'Customer': cust, 'Total Sales': total, 'Total COGS': 0,
    'Created By': 'x', 'Created At': '2026-07-01', 'Voided': '', 'Void Reason': '', 'Total Deposit': 0, 'VAT Rate': 0, 'VAT': 0 });
  const store = {
    FlowSettings: books ? [{ Key: 'booksEngine', Value: books }] : [], ActivityLog: [],
    SalesOrders: [so('SO-OLD', 'ABOITIZ', '2026-05-01'), so('SO-NEW', 'ABOITIZ', '2026-09-01'), so('SO-D', 'DMCI', '2026-05-02')],
    Invoices: [inv('INV-1', 'SO-OLD', 'ABOITIZ', 420000), inv('INV-2', 'SO-OLD', 'ABOITIZ', 100000), inv('INV-3', 'SO-NEW', 'ABOITIZ', 50000), inv('INV-4', 'SO-D', 'DMCI', 30000)],
    ARAging: [ar('AR-1', 'INV-1', 'SO-OLD', 'ABOITIZ', 420000, '2026-08-01'), ar('AR-2', 'INV-2', 'SO-OLD', 'ABOITIZ', 100000, '2099-12-31'),
              ar('AR-3', 'INV-3', 'SO-NEW', 'ABOITIZ', 50000, '2026-09-30'), ar('AR-4', 'INV-4', 'SO-D', 'DMCI', 30000, '2026-09-15')]
  };
  const ctx = load(undefined, store);
  return { ctx, store, today: ctx._dateStr(ctx._now()) };
}
const pay = (o) => Object.assign({ method: 'Cheque', chequeNo: '001234', depositedTo: '1100', clientRef: 'CR-' + Math.random().toString(36).slice(2) }, o);
const lines = (arr) => JSON.stringify(arr.map(([arNo, amount, ewt]) => ({ arNo, amount, ewt: ewt || 0 })));
const arOf = (store, no) => store.ARAging.find(r => r['AR No'] === no);

sec('1 · who may do what');
{
  const { ctx } = boot();
  for (const role of ['sales', 'accounting', 'management', 'admin']) {
    const r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-2', 1000]]) }), { actorRole: role, actorName: 'X' }));
    ok(role + ' may not record', r.success === false && /director/.test(r.message), r);
  }
  ok('nor read the phone queue', call(ctx, 'getCollectorQueue', ANA).success === false);
  ok('the director reads it', call(ctx, 'getCollectorQueue', NEIL).success === true);
}

sec('2 · the method decides where the money may be');
{
  const { ctx, today } = boot();
  const t = (label, o, re) => { const r = call(ctx, 'recordFieldCollection', Object.assign(pay(Object.assign({ lines: lines([['AR-2', 1000]]) }, o)), NEIL));
    ok(label, re ? (r.success === false && re.test(r.message)) : r.success, r); return r; };
  t('a cheque without its number is refused', { chequeNo: '' }, /cheque number/);
  t('a cheque cannot sit in "cash on hand"', { depositedTo: '1010' }, /does not fit/);
  t('cash cannot be "an undeposited cheque"', { method: 'Cash', depositedTo: '1100' }, /does not fit/);
  t('a transfer must name a bank', { method: 'Bank Transfer', depositedTo: '' }, /which of our accounts/);
  t('  and cash on hand is not a bank', { method: 'Bank Transfer', depositedTo: '1010' }, /does not fit/);
  t('an unknown method is refused', { method: 'GCash' }, /cheque, cash or bank transfer/);
  t('a future date received is refused', { date: '2099-01-01' }, /future/);
  t('a cheque held, not yet deposited', {});
  t('cash on hand', { method: 'Cash', depositedTo: '1010', lines: lines([['AR-2', 2000]]) });
  t('cash already in a bank', { method: 'Cash', depositedTo: 'AUB', lines: lines([['AR-2', 3000]]) });
  t('a transfer into Metrobank Zabarte', { method: 'Bank Transfer', depositedTo: 'METRO_ZAB', ref: 'IB-778', lines: lines([['AR-2', 4000]]) });
  const pdc = t('a post-dated cheque is accepted', { chequeNo: '009999', chequeDate: '2099-01-15', lines: lines([['AR-2', 5000]]) });
  ok('  and flagged', pdc.postDated === true, pdc);
}

sec('3 · one cheque, several invoices of one customer');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 420000], ['AR-4', 30000]]) }), NEIL));
  ok('two customers in one payment are refused', r.success === false && /one customer/.test(r.message), r);
  r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 420000], ['AR-1', 1]]) }), NEIL));
  ok('the same invoice twice is refused', r.success === false && /twice/.test(r.message), r);
  r = call(ctx, 'recordFieldCollection', Object.assign(pay({ chequeNo: '555111', chequeBank: 'BDO', chequeDate: '2026-10-01',
    lines: lines([['AR-1', 411600, 8400], ['AR-2', 60000]]) }), NEIL));
  ok('recorded', r.success && r.collectionNos.length === 2, r);
  const cols = store.Collections.filter(c => c['Reference No'] === '555111');
  eq('two Collections rows, one per invoice', cols.length, 2);
  eq('  INV-1 applied = received + tax withheld', Number(cols.find(c => c['AR No'] === 'AR-1')['Amount (PHP)']), 420000);
  eq('  its EWT', Number(cols.find(c => c['AR No'] === 'AR-1')['EWT (PHP)']), 8400);
  eq('  method', cols[0]['Method'], 'Cheque');
  ok('  the note says cheque, bank, date and phone', /Cheque 555111 · BDO · dated 2026-10-01 · via phone/.test(cols[0]['Notes']), cols[0]['Notes']);
  eq('AR-1 is Paid', arOf(store, 'AR-1')['Status'], 'Paid');
  eq('AR-2 is Partial', arOf(store, 'AR-2')['Status'], 'Partial');
  const fc = store.FieldCollections.filter(x => x['Batch No'] === r.batchNo);
  ok('one batch, two lines, both New', fc.length === 2 && fc.every(x => x['Status'] === 'New'), fc.map(x => x['Status']));
  ok('  deposit place and cheque in DocMeta', store.DocMeta.some(d => d['Source No'] === cols[0]['Collection No'] && d['Deposited To'] === '1100' && d['Cheque No'] === '555111'));
}

sec('4 · questions, never silent writes');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-2', 120000]]) }), NEIL));
  ok('more than the balance asks first', r.needsConfirm === 'overCollect' && r.lines[0].balance === 100000, r);
  ok('  and wrote nothing', !(store.Collections || []).length);
  r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-2', 120000]]), confirmOver: true }), NEIL));
  ok('confirmed, it records', r.success, r);

  r = call(ctx, 'recordFieldCollection', Object.assign(pay({ chequeNo: '777', lines: lines([['AR-3', 50000]]) }), NEIL));
  ok('an order from Aug 2026 without proof asks for the photo', r.success === false && r.missingDocs && r.missingDocs[0].invNo === 'INV-3', r);
  const ph = call(ctx, 'uploadCollectionPhoto', Object.assign({ arNos: 'AR-3', base64: 'data:image/jpeg;base64,/9j/AAAA', mimeType: 'image/jpeg' }, NEIL));
  ok('the photo is filed', ph.success && /^DOC-/.test(ph.docId), ph);
  ok('  as Proof of collection on the receivable', store.Documents.some(d => d['Module'] === 'AR Aging' && d['Ref No'] === 'AR-3' && d['Doc Type'] === 'Proof of collection'));
  ok('  sales may not upload', !call(ctx, 'uploadCollectionPhoto', { arNos: 'AR-3', base64: 'x', actorRole: 'sales' }).success);
  r = call(ctx, 'recordFieldCollection', Object.assign(pay({ chequeNo: '777', lines: lines([['AR-3', 50000]]), photoIds: ph.docId }), NEIL));
  ok('with the photo it records', r.success && r.noProof === false, r);

  const { ctx: c2, store: s2 } = boot();
  r = call(c2, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-3', 1000]]), confirmNoDocs: true }), NEIL));
  ok('recorded without proof when he says so', r.success && r.noProof === true, r);
  ok('  and the notice says so', s2.FieldCollections[0]['No Proof'] === true);

  const { ctx: c3 } = boot();
  call(c3, 'recordFieldCollection', Object.assign(pay({ chequeNo: '8888', lines: lines([['AR-1', 1000]]) }), NEIL));
  r = call(c3, 'recordFieldCollection', Object.assign(pay({ chequeNo: '8888', lines: lines([['AR-2', 1000]]) }), NEIL));
  ok('a cheque number already used for this customer asks', r.needsConfirm === 'duplicateCheque' && r.usedOn[0] === 'INV-1', r);
  r = call(c3, 'recordFieldCollection', Object.assign(pay({ chequeNo: '8888', lines: lines([['AR-2', 1000]]), confirmDupCheque: true }), NEIL));
  ok('  the same cheque paying another invoice records once confirmed', r.success, r);
}

sec('5 · the same tap twice records once');
{
  const { ctx, store } = boot();
  const body = Object.assign(pay({ clientRef: 'CR-twice', lines: lines([['AR-1', 420000]]) }), NEIL);
  const a = call(ctx, 'recordFieldCollection', body), b = call(ctx, 'recordFieldCollection', body);
  ok('first records', a.success, a);
  ok('second is the same payment', b.success && b.duplicate && b.batchNo === a.batchNo, b);
  eq('one Collections row', store.Collections.length, 1);

  // a failure part-way: the first line was written, then the batch stopped
  const { ctx: c2, store: s2 } = boot();
  const one = call(c2, 'recordFieldCollection', Object.assign(pay({ clientRef: 'CR-part', lines: lines([['AR-1', 420000]]) }), NEIL));
  c2.PropertiesService.getScriptProperties().deleteProperty('cref_recordFieldCollection_CR-part');   // as if it stopped before the end
  const again = call(c2, 'recordFieldCollection', Object.assign(pay({ clientRef: 'CR-part', lines: lines([['AR-1', 420000], ['AR-2', 100000]]) }), NEIL));
  ok('the retry resumes the same batch', again.success && again.batchNo === one.batchNo, again);
  eq('  AR-1 was not recorded twice', s2.Collections.filter(c => c['AR No'] === 'AR-1').length, 1);
  eq('  AR-2 was added', s2.Collections.filter(c => c['AR No'] === 'AR-2').length, 1);
  eq('  two log lines, one per invoice', s2.FieldCollections.length, 2);
}

sec('6 · not collected');
{
  const { ctx, store, today } = boot();
  const r = (o) => call(ctx, 'recordNotCollected', Object.assign({ arNo: 'AR-1', clientRef: 'N-' + Math.random() }, o, NEIL));
  ok('a reason is needed', r({ reason: '' }).success === false);
  ok('"Other" needs a note', /note/.test(r({ reason: 'Other' }).message));
  ok('a promise in the past is refused', /passed/.test(r({ reason: 'Not ready', promiseDate: '2020-01-01' }).message));
  ok('sales may not', call(ctx, 'recordNotCollected', { arNo: 'AR-1', reason: 'Not ready', actorRole: 'sales' }).success === false);
  const s = r({ reason: 'Not ready', promiseDate: '2099-01-15', notes: 'cheque signed Friday' });
  ok('saved', s.success, s);
  let row = call(ctx, 'getARAging', {}).data.find(x => x.arNo === 'AR-1');
  ok('AR Aging shows it', row.followUp && row.followUp.reason === 'Not ready' && row.followUp.promiseDate === '2099-01-15' && !row.followUp.missed, row.followUp);
  // the promise passes
  store.FieldCollections[store.FieldCollections.length - 1]['Promise Date'] = '2026-01-02';
  row = call(ctx, 'getARAging', {}).data.find(x => x.arNo === 'AR-1');
  ok('a passed promise is "missed"', row.followUp && row.followUp.missed === true, row.followUp);
  call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 420000]]) }), NEIL));
  row = call(ctx, 'getARAging', {}).data.find(x => x.arNo === 'AR-1');
  eq('a paid receivable carries no follow-up', row.followUp, null);
  const q = call(ctx, 'getCollectorQueue', NEIL);
  ok('the phone queue leaves out paid receivables', !q.receivables.some(x => x.arNo === 'AR-1'), q.receivables.map(x => x.arNo));
  eq('  most overdue first (due 15 Sep, 30 Sep, then 2099)', q.receivables.map(x => x.arNo).join(','), 'AR-4,AR-3,AR-2');
  ok('  days overdue counted from today', q.receivables[0].daysOverdue - q.receivables[1].daysOverdue === 15, q.receivables.map(x => x.daysOverdue));
  ok('  with our banks from the chart', q.banks.map(b => b.code).join(',') === 'METRO_ZAB,METRO_SJDM,AUB', q.banks);
  ok('  and today', q.today === today);
}

sec('7 · notices and acknowledgement');
{
  const { ctx, store } = boot();
  const base = call(ctx, 'getFieldCollectionNotices', ANA);
  ok('nothing yet', base.success && base.count === 0, base);
  const r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 420000]]) }), NEIL));
  const n = call(ctx, 'getFieldCollectionNotices', Object.assign({ since: '2000-01-01T00:00:00.000Z' }, ADMIN));
  ok('admin sees one New payment', n.count === 1 && n.items[0].batchNo === r.batchNo && n.items[0].received === 420000, n);
  ok('  with the cheque and where it is', n.items[0].chequeNo === '001234' && n.items[0].depositedToName === 'Not yet deposited', n.items[0]);
  const later = call(ctx, 'getFieldCollectionNotices', Object.assign({ since: n.serverNow }, ADMIN));
  ok('nothing newer than the last look', later.items.length === 0, later);
  ok('sales may not read notices', call(ctx, 'getFieldCollectionNotices', { actorRole: 'sales' }).success === false);
  ok('the director cannot acknowledge his own', call(ctx, 'acknowledgeFieldCollection', Object.assign({ batchNo: r.batchNo }, NEIL)).success === false);
  const a = call(ctx, 'acknowledgeFieldCollection', Object.assign({ batchNo: r.batchNo, note: 'cheque in the office' }, ANA));
  ok('accounting acknowledges', a.success, a);
  ok('  stamped', store.FieldCollections[0]['Acknowledged By'] === 'Ana Acct' && store.FieldCollections[0]['Acknowledge Note'] === 'cheque in the office');
  eq('  no longer New', call(ctx, 'getFieldCollectionNotices', ANA).count, 0);
  ok('  shown in the recent list', call(ctx, 'getFieldCollectionNotices', Object.assign({ includeRecent: true }, ANA)).recent.length === 1);
  ok('  and not twice', /already/.test(call(ctx, 'acknowledgeFieldCollection', Object.assign({ batchNo: r.batchNo }, ADMIN)).message));
}

sec('8 · undo');
{
  const { ctx, store } = boot();
  const r = call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 400000], ['AR-2', 20000]]) }), NEIL));
  ok('someone else cannot undo it', /person who recorded/.test(call(ctx, 'undoFieldCollection', Object.assign({ batchNo: r.batchNo }, NEIL, { actorName: 'Daisy Estur' })).message));
  const u = call(ctx, 'undoFieldCollection', Object.assign({ batchNo: r.batchNo, reason: 'wrong customer' }, NEIL));
  ok('the recorder undoes it', u.success && u.voided.length === 2, u);
  ok('  both collections voided with the reason', store.Collections.every(c => c['Voided'] === 'true' && /Undone on the phone by Neil Estur: wrong customer/.test(c['Void Reason'])));
  eq('  AR-1 open again', arOf(store, 'AR-1')['Status'], 'Unpaid');
  ok('  the batch says Undone and is no longer a notice', store.FieldCollections.every(x => x['Status'] === 'Undone') && call(ctx, 'getFieldCollectionNotices', ANA).count === 0);
  const r2 = call(ctx, 'recordFieldCollection', Object.assign(pay({ chequeNo: 'X1', lines: lines([['AR-1', 1000]]) }), NEIL));
  call(ctx, 'acknowledgeFieldCollection', Object.assign({ batchNo: r2.batchNo }, ANA));
  ok('after acknowledgement it is accounting\'s to void', /acknowledged/.test(call(ctx, 'undoFieldCollection', Object.assign({ batchNo: r2.batchNo }, NEIL)).message));
  const r3 = call(ctx, 'recordFieldCollection', Object.assign(pay({ chequeNo: 'X2', lines: lines([['AR-1', 1000]]) }), NEIL));
  store.FieldCollections.filter(x => x['Batch No'] === r3.batchNo).forEach(x => { x['At'] = new Date('2026-01-05T03:00:00Z'); });
  ok('the next day it is accounting\'s too', /same day/.test(call(ctx, 'undoFieldCollection', Object.assign({ batchNo: r3.batchNo }, NEIL)).message));
}

sec('9 · the activity log and the books');
{
  const { ctx, store } = boot();
  call(ctx, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 411600, 8400]]) }), NEIL));
  const log = store.ActivityLog.find(l => l['Action'] === 'Recorded from the field');
  ok('the log shows the amount received', log && Number(log['Amount']) === 411600, log);
  eq('  under Collection', log && log['Module'], 'Collection');

  const { ctx: b, store: bs } = boot('shadow');
  call(b, 'recordFieldCollection', Object.assign(pay({ lines: lines([['AR-1', 1000]]) }), NEIL));
  call(b, 'recordFieldCollection', Object.assign(pay({ method: 'Cash', depositedTo: '1010', lines: lines([['AR-1', 2000]]) }), NEIL));
  call(b, 'recordFieldCollection', Object.assign(pay({ method: 'Bank Transfer', depositedTo: 'AUB', lines: lines([['AR-1', 3000]]) }), NEIL));
  const dr = (acct) => (bs.GL || []).filter(g => g.Account === acct).reduce((s, g) => s + (Number(g.Debit) || 0), 0);
  eq('books: the held cheque is in 1100', dr('1100'), 1000);
  eq('  the cash in 1010', dr('1010'), 2000);
  eq('  the transfer in AUB (1022)', dr('1022'), 3000);
  eq('  receivables down by all three', (bs.GL || []).filter(g => g.Account === '1200').reduce((s, g) => s + (Number(g.Credit) || 0), 0), 6000);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
