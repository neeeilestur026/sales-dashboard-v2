/* A223 — the reconciliation that says where the money actually went.
 *
 * Three records claim to know when a supplier was paid, and on the live book they disagree by more
 * than a million pesos. A register that read only PaymentRequests would report ₱115,318.71 against a
 * ledger that says ₱1,491,714.05, and would look authoritative doing it.
 *
 * What this file exists to hold down:
 *   • THE LIVE FIGURES, as fixtures. Every number below was measured, not invented, so a change that
 *     quietly breaks the join fails here rather than on the screen;
 *   • the buckets PARTITION THE JOURNAL. Every APPAY entry lands in exactly one, and the three add
 *     back to the ledger total — no payment counted twice, none silently dropped;
 *   • ONE ENTRY PER JOURNAL ENTRY. A posting is Dr AP / Cr Cash — two rows sharing an entryNo — and
 *     counting both would double every figure on the page;
 *   • `noLedger` is deliberately OUTSIDE that partition. A Type 'Other' payment posts nothing at all,
 *     so it is additional exposure rather than a slice of the ledger;
 *   • the coherence identity: matched journal total == the sum of every APAging Paid (PHP). When those
 *     drift apart the ledger and the payables have stopped describing the same events.
 */
const path = require('path');
const { paymentRegister } = require(path.resolve(__dirname, '../../dashboard/js/payment-register.js'));

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/* ── The live book, 2026-08-10 ───────────────────────────────────────────────────────────────── */

const JE = (apNo, amt) => ([                       // a posting is TWO rows sharing one entryNo
  { entryNo: 'JE-APPAY-' + apNo, source: 'APPAY', sourceNo: apNo, debit: amt, credit: 0,
    accountName: 'Accounts Payable', memo: 'Payment of ' + apNo, date: '2026-07-30' },
  { entryNo: 'JE-APPAY-' + apNo, source: 'APPAY', sourceNo: apNo, debit: 0, credit: amt,
    accountName: 'Cash', memo: 'Payment of ' + apNo, date: '2026-07-30' }
]);

const JOURNAL = [].concat(
  // Four whose payable no longer exists — 65% of all recorded cash outflow.
  JE('AP-202606-002', 135000), JE('AP-202606-003', 3750),
  JE('AP-202606-004', 751249.80), JE('AP-202606-005', 71478.50),
  // Seven that name a live payable.
  JE('AP-202607-001', 46393.80), JE('AP-202607-002', 43500),
  JE('AP-202607-005', 310895.71), JE('AP-202607-006', 12447.24),
  JE('AP-202607-007', 30240), JE('AP-202607-009', 17073), JE('AP-202607-011', 69686),
  // Not a payment — proves the filter takes APPAY only.
  [{ entryNo: 'JE-PO-2026-39', source: 'PO', sourceNo: '2026-39', debit: 0, credit: 202,
     accountName: 'Accounts Payable', memo: 'PO', date: '2026-07-16' }]
);

const AP = [
  { apNo: 'AP-202607-001', poNo: 'PO-202607-001', supplier: 'Aolai', currency: 'USD', amountFC: 720,
    amountPHP: 446393.80, paidPHP: 46393.80, prNo: '', prStatus: '' },
  { apNo: 'AP-202607-002', poNo: 'PO-202607-002', supplier: 'Yale', currency: 'PHP', amountFC: 43500,
    amountPHP: 43500, paidPHP: 43500, prNo: '', prStatus: '' },
  { apNo: 'AP-202607-005', poNo: '2026-38 Power Team', supplier: 'Power Team', currency: 'USD',
    amountFC: 5035.36, amountPHP: 310429.94, paidPHP: 310895.71,
    prNo: 'PRF-2026-63', prStatus: 'Approved' },
  { apNo: 'AP-202607-006', poNo: '2026-39 Chicago', supplier: 'Chicago', currency: 'USD', amountFC: 202,
    amountPHP: 12447.24, paidPHP: 12447.24, prNo: 'PRF-2026-65', prStatus: 'Paid' },
  { apNo: 'AP-202607-007', poNo: '2026-40 RS', supplier: 'RS', currency: 'PHP', amountFC: 27000,
    amountPHP: 30240, paidPHP: 30240, prNo: 'PRF-2026-66', prStatus: 'Approved' },
  { apNo: 'AP-202607-009', poNo: '2026-41 TOOLEC', supplier: 'TOOLEC', currency: 'PHP', amountFC: 34146,
    amountPHP: 34146, paidPHP: 17073, prNo: 'PRF-2026-69', prStatus: 'Paid' },
  { apNo: 'AP-202607-011', poNo: '2026-42 TOOLEC', supplier: 'TOOLEC', currency: 'PHP', amountFC: 139372,
    amountPHP: 139372, paidPHP: 69686, prNo: 'PRF-2026-70', prStatus: 'Paid' },
  // Unpaid rows — no journal, and they must not appear anywhere in the register.
  { apNo: 'AP-202607-012', poNo: '2026-43 CO BAN KIAT', currency: 'PHP', amountPHP: 54400, paidPHP: 0 },
  { apNo: 'AP-202607-013', poNo: '2026-44 CO BAN KIAT', currency: 'PHP', amountPHP: 250560, paidPHP: 0 },
  { apNo: 'AP-202607-014', poNo: '2026-45 CEJN', currency: 'SGD', amountFC: 2493.9, amountPHP: 119083.73, paidPHP: 0 }
];

const PR = [
  // Paid through the button — these explain their payable.
  { prNo: 'PRF-2026-69 TOOLEC', type: 'PO', poNo: '2026-41 TOOLEC', currency: 'PHP', amount: 17073, status: 'Paid' },
  { prNo: 'PRF-2026-70 TOOLEC', type: 'PO', poNo: '2026-42 TOOLEC', currency: 'PHP', amount: 69686, status: 'Paid' },
  { prNo: 'PRF-2026-65 CHICAGO', type: 'PO', poNo: '2026-39 Chicago', currency: 'PHP', amount: 12447.24, status: 'Paid' },
  // Approved but never marked paid, while the payable says Paid — the A221 story.
  { prNo: 'PRF-2026-63 HYDRAULIC', type: 'PO', poNo: '2026-38 Power Team', currency: 'PHP', amount: 310429.94, status: 'Approved' },
  { prNo: 'PRF-2026-66 RS', type: 'PO', poNo: '2026-40 RS', currency: 'PHP', amount: 30240, status: 'Approved' },
  { prNo: 'PRF-2026-62 AOLAI', type: 'PO', poNo: 'PO-202607-001', currency: 'PHP', amount: 44323.20, status: 'Approved' },
  { prNo: 'PRF-2026-61 YALE', type: 'PO', poNo: 'PO-202607-002', currency: 'PHP', amount: 43500, status: 'Approved' },
  { prNo: 'PRF-2026-73 CEJN', type: 'PO', poNo: '2026-45 CEJN', currency: 'PHP', amount: 119083.73, status: 'Approved' },
  { prNo: 'PRF-2026-71 CO BAN KIAT', type: 'PO', poNo: '2026-43 CO BAN KIAT', currency: 'PHP', amount: 54400, status: 'Pending Director' },
  // Type 'Other', paid — eight rows, no journal, no payable, no expense.
  { prNo: 'PRF-2026-76 KIM BLONES', type: 'Other', payee: 'K. Blones', amount: 853, status: 'Paid' },
  { prNo: 'PRF-2026-75 GERALD LUCENA', type: 'Other', payee: 'G. Lucena', amount: 283, status: 'Paid' },
  { prNo: 'PR-202608-001', type: 'Other', payee: 'NETGLOBAL-PCAB', amount: 6354.36, status: 'Paid' },
  { prNo: 'PRF-2026-74 FEDEX', type: 'Other', payee: 'FedEx', amount: 3120.11, status: 'Paid' },
  { prNo: 'PRF-2026-73 GERALD LUCENA', type: 'Other', payee: 'G. Lucena', amount: 2000, status: 'Paid' },
  { prNo: 'PRF-2026-72 KIMBERLYN BLONES', type: 'Other', payee: 'K. Blones', amount: 2000, status: 'Paid' },
  { prNo: 'PRF-2026-68 ANGELICA SIMEON', type: 'Other', payee: 'A. Simeon', amount: 302, status: 'Paid' },
  { prNo: 'PRF-2026-62 AFAB', type: 'Other', payee: 'AFAB', amount: 1200, status: 'Paid' },
  // Type 'Other' NOT paid — must not appear.
  { prNo: 'PRF-2026-67 DHL', type: 'Other', payee: 'DHL', amount: 46325.43, status: 'Approved' },
  { prNo: 'PRF-2026-78 FOURELEVEN', type: 'Other', payee: 'Foureleven', amount: 62656.67, status: 'Pending Director' }
];

const R = paymentRegister(PR, AP, JOURNAL);

console.log('== the live figures, reproduced exactly ==');
{
  eq('cash out per the ledger',            R.ledgerTotal, 1491714.05);
  eq('unmatched cash postings',            R.totals.orphanJournal, 961478.30);
  eq('...across four entries',             R.orphanJournal.length, 4);
  eq('...and they are the 2026-06 ones',   R.orphanJournal.map(o => o.apNo),
     ['AP-202606-002', 'AP-202606-003', 'AP-202606-004', 'AP-202606-005']);
  eq('paid on the AP page, no paid request', R.totals.apOnly, 431029.51);
  eq('...across four payables',            R.apOnly.length, 4);
  eq('...which ones',                      R.apOnly.map(o => o.apNo).sort(),
     ['AP-202607-001', 'AP-202607-002', 'AP-202607-005', 'AP-202607-007']);
  eq('genuinely reconciled',               R.totals.reconciled, 99206.24);
  eq('...across three',                    R.reconciled.length, 3);
  eq('cash with no ledger entry at all',   R.totals.noLedger, 16112.47);
  eq('...across eight requests',           R.noLedger.length, 8);
  //  ^ 16,112.47, NOT the 56,459.62 an earlier draft of the A221 baseline claimed. That was an
  //    addition error; it ties here because 99,206.24 + 16,112.47 = 115,318.71, every paid request.
  eq('everything the ledger cannot account for', R.unaccounted, 1392507.81);
}

console.log('\n== the buckets partition the journal — nothing doubled, nothing dropped ==');
{
  eq('the three add back to the ledger total',
     Math.round((R.totals.reconciled + R.totals.apOnly + R.totals.orphanJournal) * 100) / 100,
     R.ledgerTotal);
  const all = [].concat(R.reconciled, R.apOnly, R.orphanJournal).map(r => r.entryNo);
  eq('one row per journal ENTRY, not per line', all.length, 11);
  eq('and no entry appears twice', all.length, new Set(all).size);
  /* The Dr and Cr rows share an entryNo. Counting both would double every figure on the page, so it
     is asserted rather than trusted: the fixture feeds 22 APPAY rows and 11 must come back. */
  eq('the fixture really does supply two rows per posting',
     JOURNAL.filter(j => j.source === 'APPAY').length, 22);
  ok('a non-APPAY entry is ignored', !all.some(e => e.indexOf('JE-PO-') === 0), all);
  ok('an unpaid payable appears nowhere',
     !all.length || !JSON.stringify(R).match(/AP-202607-01[234]/), 'AP-202607-012/013/014 leaked');
}

console.log('\n== the coherence identity ==');
{
  /* Every journal entry naming a live payable should equal the sum of every Paid (PHP). When those
     two drift apart, the ledger and the payables have stopped describing the same events. */
  eq('matched journal total',              R.matchedJournalTotal, 530235.75);
  eq('sum of every APAging Paid (PHP)',    R.apPaidTotal, 530235.75);
  ok('they agree — the coherent side is still coherent', R.ledgerAgreesWithPayables);

  // And it must NOTICE when they stop agreeing.
  const bent = JSON.parse(JSON.stringify(AP));
  bent[0].paidPHP = 999;
  ok('a payable moved out from under the ledger is caught',
     !paymentRegister(PR, bent, JOURNAL).ledgerAgreesWithPayables);
}

console.log('\n== why each unexplained row is unexplained ==');
{
  const byNo = {}; R.apOnly.forEach(r => byNo[r.apNo] = r);
  ok('Power Team names its Approved request',
     /request is Approved/.test(byNo['AP-202607-005'].why), byNo['AP-202607-005'].why);
  eq('  and reports the full amount as unexplained', byNo['AP-202607-005'].unexplained, 310895.71);
  eq('  carrying the request number for the link out', byNo['AP-202607-005'].prNo, 'PRF-2026-63');
  ok('AOLAI has no linked request at all — says "not marked paid"',
     /not marked paid/.test(byNo['AP-202607-001'].why), byNo['AP-202607-001'].why);
  ok('an orphan says no payable exists',
     /No payable numbered AP-202606-004 exists/.test(R.orphanJournal[2].why), R.orphanJournal[2].why);
}

console.log('\n== a PARTLY explained payable is not treated as reconciled ==');
{
  /* The dangerous middle case: a deposit paid through the button, the balance typed on the AP page.
     Counting it as reconciled would hide the untracked half. */
  const ap = [{ apNo: 'AP-X', poNo: 'PO-X', currency: 'PHP', amountPHP: 100000, paidPHP: 100000 }];
  const pr = [{ prNo: 'PR-X', type: 'PO', poNo: 'PO-X', currency: 'PHP', amount: 40000, status: 'Paid' }];
  const r = paymentRegister(pr, ap, JE('AP-X', 100000));
  eq('it lands in apOnly, not reconciled', [r.reconciled.length, r.apOnly.length], [0, 1]);
  eq('and only the unexplained part is named', r.apOnly[0].unexplained, 60000);
  ok('the message quantifies it', /Only 40000.00 of 100000.00/.test(r.apOnly[0].why), r.apOnly[0].why);
  eq('but the CASH figure stays whole — the ledger moved 100,000', r.apOnly[0].cashOut, 100000);
}

console.log('\n== a foreign payment settles debited MINUS the charge ==');
{
  /* A222: on a foreign request `amount` is the obligation in USD, not pesos. What settled the payable
     is the actual debit less the bank charge — reading `amount` here would compare USD to pesos. */
  const ap = [{ apNo: 'AP-F', poNo: 'PO-F', currency: 'USD', amountFC: 720, amountPHP: 44323.20, paidPHP: 44323.20 }];
  const pr = [{ prNo: 'PR-F', type: 'PO', poNo: 'PO-F', currency: 'USD', amount: 720, status: 'Paid',
                actualDebitedPHP: 46393.80, bankChargePHP: 2070.60, amountPHPEst: 44323.20 }];
  const r = paymentRegister(pr, ap, JE('AP-F', 44323.20));
  eq('it reconciles — 46,393.80 less the 2,070.60 charge', r.reconciled.length, 1);
  eq('and nothing is left unexplained', r.reconciled[0].unexplained, 0);

  // Without the bank figures it falls back to the peso ESTIMATE, never the foreign amount.
  const pr2 = [{ prNo: 'PR-F', type: 'PO', poNo: 'PO-F', currency: 'USD', amount: 720, status: 'Paid',
                 amountPHPEst: 44323.20 }];
  eq('the fallback is the estimate, not the 720', paymentRegister(pr2, ap, JE('AP-F', 44323.20)).reconciled.length, 1);
}

console.log('\n== rubbish does not throw ==');
{
  const empty = paymentRegister([], [], []);
  eq('nothing at all', [empty.ledgerTotal, empty.unaccounted], [0, 0]);
  eq('every bucket empty',
     [empty.reconciled.length, empty.apOnly.length, empty.orphanJournal.length, empty.noLedger.length],
     [0, 0, 0, 0]);
  ok('an empty book trivially agrees', empty.ledgerAgreesWithPayables);
  ok('nulls do not throw', !!paymentRegister(null, null, null));
  ok('a journal row with no credit is skipped',
     paymentRegister([], [], [{ entryNo: 'X', source: 'APPAY', sourceNo: 'A', debit: 5, credit: 0 }]).ledgerTotal === 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
