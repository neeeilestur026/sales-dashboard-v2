/* A331 — the Month check model (dashboard/js/month-check-model.js).
 *
 * Run:  node tests/flow/month-check-model.js
 *
 * Fixtures shaped like what getMonthCheck returns, built from the 14 Oct 2026 reconciliation's real
 * findings: a receivable imported in June and again in September, a portal entry imported again under
 * a prefixed number, an invoice that never reached AR Aging, invoices at 0% with no VAT type, the
 * Taganito order billed above its PO, EWT taken on the total with VAT, EWT with no 2307, and the real
 * payment saved as DEMO-COL-001. Each must be listed in its month, and nothing that is right may be.
 */
const path = require('path');
const M = require(path.join(__dirname, '..', '..', 'dashboard', 'js', 'month-check-model.js'));

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const section = (t) => console.log('\n== ' + t + ' ==');
const refs = (res, key) => (res.checks.find(c => c.key === key) || { items: [] }).items.map(i => i.ref);

const data = {
  safeguards: true,
  salesOrders: [
    { soNo: '150005836', customer: 'THERMA SOUTH INC', date: '2026-09-03', total: 308034, vatType: 'VAT-12' },
    { soNo: '4500118', customer: 'TAGANITO HPAL NICKEL CORPORATION', date: '2026-09-01', total: 1000000, vatType: 'VAT-0' },
    { soNo: 'SO-OLD', customer: 'MINCON', date: '2026-06-01', total: 50000, vatType: '' },        // an order with no VAT type
    { soNo: 'DEMO-SO-001', customer: 'DEMO — Mincon', date: '2026-08-01', total: 1000, vatType: '' }
  ],
  invoices: [
    { invNo: 'INV-202609-001', soNo: '150005836', date: '2026-09-05', customer: 'THERMA SOUTH INC', totalSales: 308034, vat: 36964.08, vatRate: 12, deposit: 0, voided: false, createdBy: 'Ana', vatType: 'VAT-12' },
    { invNo: 'INV-202609-002', soNo: '4500118', date: '2026-09-10', customer: 'TAGANITO HPAL NICKEL CORPORATION', totalSales: 704731.34, vat: 0, vatRate: 0, deposit: 0, voided: false, createdBy: 'Ana', vatType: 'VAT-0' },
    { invNo: 'INV-202609-003', soNo: '4500118', date: '2026-09-20', customer: 'TAGANITO HPAL NICKEL CORPORATION', totalSales: 700000, vat: 0, vatRate: 0, deposit: 0, voided: false, createdBy: 'Ana', vatType: 'VAT-0' },
    { invNo: '118', soNo: 'SO-118', date: '2026-09-25', customer: 'ATLAS', totalSales: 50000, vat: 0, vatRate: 0, deposit: 0, voided: false, createdBy: 'Ana', vatType: '' },   // no receivable, 0% and no type
    { invNo: 'INV-202609-009', soNo: 'SO-9', date: '2026-09-26', customer: 'ATLAS', totalSales: 1000, vat: 120, vatRate: 12, deposit: 0, voided: true, createdBy: 'Ana', vatType: '' },   // voided: not reported
    { invNo: 'INV-2025-200', soNo: 'SO-200', date: '2025-03-01', customer: 'OLDCO', totalSales: 9000, vat: 0, vatRate: null, deposit: 0, voided: false, createdBy: 'Migrated (legacy)', vatType: '' }   // migrated: never had AR
  ],
  receivables: [
    { arNo: 'AR-101', invNo: 'INV-202609-001', soNo: '150005836', customer: 'THERMA SOUTH INC', amount: 344998.08, collected: 344998.08, status: 'Paid', dueDate: '2026-10-05', createdAt: '2026-09-05' },
    { arNo: 'AR-102', invNo: 'INV-202609-002', soNo: '4500118', customer: 'TAGANITO HPAL NICKEL CORPORATION', amount: 704731.34, collected: 0, status: 'Unpaid', dueDate: '2026-10-10', createdAt: '2026-09-10' },
    { arNo: 'AR-103', invNo: 'INV-202609-003', soNo: '4500118', customer: 'TAGANITO HPAL NICKEL CORPORATION', amount: 700000, collected: 0, status: 'Unpaid', dueDate: '2026-10-20', createdAt: '2026-09-20' },
    // June and September imports of the same invoice
    { arNo: 'AR-020', invNo: '1077', soNo: 'SO-77', customer: 'FFHC', amount: 79404.76, collected: 0, status: 'Unpaid', dueDate: '2026-07-01', createdAt: '2026-06-02' },
    { arNo: 'AR-090', invNo: '1077', soNo: 'SO-77', customer: 'FFHC', amount: 79404.76, collected: 0, status: 'Unpaid', dueDate: '2026-07-01', createdAt: '2026-09-15' },
    // a portal receivable and the same invoice imported under its bare number
    { arNo: 'AR-050', invNo: 'INV-2026-014', soNo: 'SO-14', customer: 'Asian Aerospace Corp.', amount: 12000, collected: 0, status: 'Unpaid', dueDate: '', createdAt: '2026-07-01' },
    { arNo: 'AR-091', invNo: '14', soNo: 'SO-14', customer: 'ASIAN AEROSPACE CORP', amount: 12000, collected: 0, status: 'Unpaid', dueDate: '', createdAt: '2026-09-15' },
    // the same bare number in another series, for another customer, is not a duplicate
    { arNo: 'AR-092', invNo: 'SI-2025-014', soNo: 'SO-X', customer: 'DMCI', amount: 12000, collected: 0, status: 'Unpaid', dueDate: '', createdAt: '2026-09-15' },
    // partly paid long ago
    { arNo: 'AR-060', invNo: 'INV-2026-060', soNo: 'SO-60', customer: 'MINCON', amount: 100000, collected: 40000, status: 'Partial', dueDate: '2026-06-30', createdAt: '2026-06-01' },
    { arNo: 'AR-DEMO', invNo: 'DEMO-INV-001', soNo: 'DEMO-SO-001', customer: 'DEMO — Mincon', amount: 1000, collected: 1000, status: 'Paid', dueDate: '', createdAt: '2026-08-01' }
  ],
  collections: [
    // Therma: right (1% of before-VAT), with its 2307
    { collectionNo: 'COL-1', arNo: 'AR-101', invNo: 'INV-202609-001', customer: 'THERMA SOUTH INC', date: '2026-09-28', amount: 344998.08, ewt: 3080.34, ref: '000555', voided: false, expectedEwt: 3080.34, has2307: true },
    // EWT on the total with VAT, no 2307
    { collectionNo: 'COL-2', arNo: 'AR-060', invNo: 'INV-2026-060', customer: 'MINCON', date: '2026-09-02', amount: 40000, ewt: 400, ref: 'IB-1', voided: false, expectedEwt: 357.14, has2307: false },
    // the same cheque again for the same customer (leading zeros differ)
    { collectionNo: 'COL-3', arNo: 'AR-102', invNo: 'INV-202609-002', customer: 'THERMA SOUTH INC', date: '2026-09-29', amount: 1000, ewt: 0, ref: '555', voided: false, expectedEwt: null, has2307: false },
    // the real payment saved as demo data
    { collectionNo: 'DEMO-COL-001', arNo: 'AR-DEMO', invNo: 'DEMO-INV-001', customer: 'DEMO — Mincon', date: '2026-08-02', amount: 1000, ewt: 0, ref: '', voided: false, expectedEwt: null, has2307: false },
    // voided duplicates are not duplicates
    { collectionNo: 'COL-4', arNo: 'AR-101', invNo: 'INV-202609-001', customer: 'THERMA SOUTH INC', date: '2026-09-28', amount: 344998.08, ewt: 3080.34, ref: '', voided: true, expectedEwt: 3080.34, has2307: true }
  ],
  overrides: [
    { at: '2026-09-20', user: 'Ana Acct', role: 'accounting', action: 'createInvoice', refNo: '4500118', rule: 'overBilling', expected: 295268.66, entered: 700000, reason: 'Client PO amendment to follow' },
    { at: '2026-08-11', user: 'Ana Acct', role: 'accounting', action: 'recordCollection', refNo: 'AR-050', rule: 'ewtMissing', expected: 107.14, entered: 0, reason: '2307 to follow' }
  ]
};

section('1 · September 2026: each real mistake is listed');
const sep = M.monthCheck(data, '2026-09', '2026-10-14');
eq('the month', sep.month, '2026-09');
ok('the June/September re-import of invoice 1077', refs(sep, 'duplicateReceivables').some(r => /AR-020/.test(r) && /AR-090/.test(r)), refs(sep, 'duplicateReceivables'));
ok('the portal entry imported again as "14"', refs(sep, 'duplicateReceivables').some(r => /AR-050/.test(r) && /AR-091/.test(r)), refs(sep, 'duplicateReceivables'));
ok('  but not DMCI\'s own invoice 14', !refs(sep, 'duplicateReceivables').some(r => /AR-092/.test(r)), refs(sep, 'duplicateReceivables'));
eq('  two groups exactly', refs(sep, 'duplicateReceivables').length, 2);
ok('cheque 000555 / 555 used twice by Therma', refs(sep, 'duplicatePayments').some(r => /COL-1/.test(r) && /COL-3/.test(r)), refs(sep, 'duplicatePayments'));
ok('  and a voided copy is not a duplicate', !refs(sep, 'duplicatePayments').some(r => /COL-4/.test(r)));
ok('invoice 118 with no receivable', refs(sep, 'invoiceNoReceivable').indexOf('118') >= 0, refs(sep, 'invoiceNoReceivable'));
ok('  the voided and the migrated invoices are not', refs(sep, 'invoiceNoReceivable').length === 1, refs(sep, 'invoiceNoReceivable'));
ok('the Taganito order billed above its PO', refs(sep, 'overBilled').indexOf('4500118') >= 0, refs(sep, 'overBilled'));
const tag = sep.checks.find(c => c.key === 'overBilled').items[0];
eq('  by 404,731.34', tag && tag.amount, 404731.34);
ok('invoice 118: 0% and no VAT type', refs(sep, 'invoiceVatMissing').indexOf('118') >= 0, refs(sep, 'invoiceVatMissing'));
ok('  a 12% invoice without a stored type is not flagged', refs(sep, 'invoiceVatMissing').indexOf('INV-202609-001') < 0);
ok('EWT on the total with VAT (COL-2)', refs(sep, 'ewtOff').indexOf('COL-2') >= 0, refs(sep, 'ewtOff'));
ok('  the right one (COL-1) is not', refs(sep, 'ewtOff').indexOf('COL-1') < 0);
ok('EWT with no 2307 on file (COL-2)', refs(sep, 'no2307').indexOf('COL-2') >= 0 && refs(sep, 'no2307').indexOf('COL-1') < 0, refs(sep, 'no2307'));
ok('partly paid since June', refs(sep, 'partialOld').indexOf('AR-060') >= 0, refs(sep, 'partialOld'));
ok('the September override, with its reason', sep.checks.find(c => c.key === 'overrides').items.some(i => i.ref === '4500118' && /PO amendment/.test(i.detail)));
ok('  and not August\'s', refs(sep, 'overrides').indexOf('AR-050') < 0);
ok('DEMO records, whatever the month', ['DEMO-SO-001', 'AR-DEMO', 'DEMO-COL-001'].every(x => refs(sep, 'demo').indexOf(x) >= 0), refs(sep, 'demo'));
ok('demo data is not counted as a duplicate or a missing receivable', ![].concat(refs(sep, 'duplicatePayments'), refs(sep, 'invoiceNoReceivable')).some(r => /DEMO/.test(r)));

section('2 · other months, and the whole ledger');
const jun = M.monthCheck(data, '2026-06', '2026-10-14');
ok('June lists the June half of the re-import too', refs(jun, 'duplicateReceivables').some(r => /AR-020/.test(r)), refs(jun, 'duplicateReceivables'));
ok('June: the order with no VAT type', refs(jun, 'orderVatMissing').indexOf('SO-OLD') >= 0, refs(jun, 'orderVatMissing'));
eq('June: AR-060 was not yet 60 days late at the end of June', refs(jun, 'partialOld').indexOf('AR-060'), -1);
const all = M.monthCheck(data, '', '2026-10-14');
eq('the whole ledger: both overrides', refs(all, 'overrides').length, 2);
eq('  balances dated today', all.asOf, '2026-10-14');
ok('  the month list is newest first', JSON.stringify(M.mcMonths(data).slice(0, 3)) === JSON.stringify(['2026-09', '2026-08', '2026-07']), M.mcMonths(data));
const oct = M.monthCheck(data, '2026-10', '2026-10-14');
eq('a month not yet over: balances as of today', oct.asOf, '2026-10-14');

section('3 · a clean month is clean');
const clean = M.monthCheck({ salesOrders: [data.salesOrders[0]], invoices: [data.invoices[0]], receivables: [data.receivables[0]],
  collections: [data.collections[0]], overrides: [], safeguards: true }, '2026-09', '2026-10-14');
eq('nothing to look at', clean.total, 0);
const offRun = M.monthCheck(Object.assign({}, data, { safeguards: false }), '2026-09', '2026-10-14');
eq('the switch being off is reported', offRun.safeguards, false);

section('3b · the two patterns the live replay turned up');
const live = M.monthCheck({ safeguards: true, salesOrders: [], invoices: [], overrides: [],
  receivables: [
    // Philcement #100: entered in the portal, then imported on another basis
    { arNo: 'AR-202606-010', invNo: 'INV-2026-0100', soNo: '', customer: 'Philcement Corporation', amount: 63192.88, collected: 0, createdAt: '2026-06-24' },
    { arNo: 'AR-202606-050', invNo: '100', soNo: '', customer: 'PHILCEMENT CORPORATION', amount: 63762.19, collected: 0, createdAt: '2026-06-29' }],
  collections: [
    // imported payments all carrying a placeholder instead of a reference
    { collectionNo: 'COL-6', arNo: 'AR-A', customer: 'Petra Cement Inc.', date: '2026-07-14', amount: 1000, ewt: 0, ref: 'Per master AR ledger', expectedEwt: null },
    { collectionNo: 'COL-7', arNo: 'AR-B', customer: 'Petra Cement Inc.', date: '2026-07-14', amount: 2000, ewt: 0, ref: 'Per master AR ledger', expectedEwt: null }]
}, '', '2026-10-14');
ok('the same invoice entered and imported on a different basis is one invoice twice',
   refs(live, 'duplicateReceivables').some(r => /AR-202606-010/.test(r) && /AR-202606-050/.test(r)), refs(live, 'duplicateReceivables'));
ok('  and says the amounts differ', /different basis/.test(live.checks.find(c => c.key === 'duplicateReceivables').items[0].detail));
eq('a placeholder reference with no digit is not a cheque', refs(live, 'duplicatePayments').length, 0);

section('4 · helpers');
eq('a prefixed number read bare', M.mcInvTail('INV-2026-014'), '14');
eq('  leading zeros', M.mcInvTail('00123'), '123');
eq('a cheque as the server compares it', M.mcRefKey(' 000555 '), '555');
eq('  a reference with no digit is no reference', M.mcRefKey('Per master AR ledger'), '');
eq('February\'s last day', M.mcMonthEnd('2028-02'), '2028-02-29');

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
