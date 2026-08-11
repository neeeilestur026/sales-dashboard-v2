/* payment-register.js — A223. Where did the money actually go?
 *
 * Three records claim to know when a supplier was paid, and on the live book they disagree:
 *
 *     paid payment requests            ₱115,318.71
 *     AP rows paid, no paid request    ₱431,029.51
 *     APPAY journal (cash credited)  ₱1,491,714.05
 *
 * A register that read only PaymentRequests would report the first figure and look authoritative
 * while missing the rest. So this reconciles all three, and its whole value is in the disagreements.
 *
 * THE LEDGER IS THE AUTHORITY FOR "CASH LEFT". Every APPAY journal entry is one movement of cash, so
 * the buckets partition the JOURNAL — never the requests — and each entry lands in exactly one:
 *
 *   reconciled     the payable it names exists, and paid requests explain what it settled
 *   apOnly         the payable exists, but no paid request accounts for the money
 *                  (the A221 story: someone typed into AP Aging instead of marking the request paid)
 *   orphanJournal  no payable of that number exists at all — cash credited against nothing
 *
 * `noLedger` is deliberately OUTSIDE that partition: a Type 'Other' request marked Paid posts no
 * journal and no AP row, so the cash left with no ledger trace whatsoever. It is additional exposure,
 * not a slice of the ledger, and adding it to the other three would double-count nothing but would
 * imply the ledger already knows about it. It does not.
 *
 * Pure and DOM-free, like itinerary-week.js and client-rollup.js, because a join that quietly
 * mis-sorts a payment is exactly the kind of thing that has to be table-tested rather than eyeballed.
 */

/** Coerce to a number the way flowNum does, without depending on it (this file must stay pure). */
function _prgNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _prgKey(v) { return String(v == null ? '' : v).trim(); }

/* Two peso figures agree when they agree to the centavo. A tolerance wider than this would start
   absorbing real differences — a bank charge is often only a few hundred pesos. */
const PRG_EPS = 0.005;

/**
 * @param prs      getPaymentRequests().data
 * @param aps      getAPAging().data
 * @param journal  getJournal().data  (every row; APPAY entries are selected here)
 */
function paymentRegister(prs, aps, journal) {
  prs = prs || []; aps = aps || []; journal = journal || [];

  const apByNo = {};
  aps.forEach(a => { apByNo[_prgKey(a.apNo)] = a; });

  /* What each PO has been paid FOR by requests that are actually marked Paid. This is the evidence a
     journal entry is asked to match — not the request's mere existence, which is the whole point:
     five live requests sit at "Approved" while their payable says Paid. */
  const paidByPo = {};
  prs.forEach(p => {
    if (String(p.status) !== 'Paid') return;
    const po = _prgKey(p.poNo);
    if (!po) return;
    // A222: on a foreign request `amount` is the OBLIGATION, not pesos. What settled the payable is
    // the actual debit less the bank charge; fall back to the amount only for a PHP request.
    const settled = _prgNum(p.actualDebitedPHP) > 0
      ? _prgNum(p.actualDebitedPHP) - _prgNum(p.bankChargePHP)
      : (String(p.currency || 'PHP').toUpperCase() === 'PHP' ? _prgNum(p.amount) : _prgNum(p.amountPHPEst));
    paidByPo[po] = (paidByPo[po] || 0) + settled;
    (paidByPo[po + '::rows'] = paidByPo[po + '::rows'] || []).push(p);
  });

  const reconciled = [], apOnly = [], orphanJournal = [];

  /* One entry per journal ENTRY, not per journal line: a posting is Dr AP / Cr Cash, two rows sharing
     an entryNo, and counting both would double every figure on the page. */
  const seen = {};
  journal.forEach(j => {
    if (String(j.source) !== 'APPAY') return;
    const credit = _prgNum(j.credit);
    if (!(credit > 0)) return;                       // the Cr Cash line carries the amount
    const entryNo = _prgKey(j.entryNo);
    if (seen[entryNo]) return;
    seen[entryNo] = true;

    const apNo = _prgKey(j.sourceNo);
    const ap = apByNo[apNo];
    const row = { entryNo: entryNo, apNo: apNo, cashOut: credit, date: j.date || '', memo: j.memo || '' };

    if (!ap) {
      row.why = 'No payable numbered ' + apNo + ' exists — nothing explains this cash.';
      orphanJournal.push(row);
      return;
    }
    row.poNo = ap.poNo || '';
    row.supplier = ap.supplier || '';
    row.currency = ap.currency || 'PHP';
    row.amountFC = _prgNum(ap.amountFC);
    row.payablePHP = _prgNum(ap.amountPHP);
    row.apPaidPHP = _prgNum(ap.paidPHP);
    row.prNo = ap.prNo || '';
    row.prStatus = ap.prStatus || '';

    const explained = paidByPo[_prgKey(ap.poNo)] || 0;
    row.explainedByRequests = explained;
    row.requests = (paidByPo[_prgKey(ap.poNo) + '::rows'] || []).map(p => p.prNo);
    row.unexplained = Math.round((row.apPaidPHP - explained) * 100) / 100;

    if (Math.abs(row.unexplained) <= PRG_EPS) {
      reconciled.push(row);
    } else {
      row.why = explained > 0
        ? 'Only ' + explained.toFixed(2) + ' of ' + row.apPaidPHP.toFixed(2) + ' is covered by a paid request.'
        : 'Recorded on the AP page — its request is ' + (row.prStatus || 'not marked paid') + '.';
      apOnly.push(row);
    }
  });

  /* Cash that left with NO ledger entry at all: a Type 'Other' request marked Paid writes the request
     row and nothing else. Until A221-5 is deployed and run, that is 8 requests worth ₱16,112.47 that
     have never reached the P&L. */
  const noLedger = prs.filter(p => String(p.status) === 'Paid' && String(p.type) !== 'PO')
    .map(p => ({ prNo: p.prNo, payee: p.payee || '', amount: _prgNum(p.amount),
                 paidAt: p.paidAt || '', paidBy: p.paidBy || '', purpose: p.purpose || '',
                 why: 'A Type-Other payment posts no journal and no payable — this cash is in no ledger.' }));

  const sum = (rows, k) => Math.round(rows.reduce((t, r) => t + _prgNum(r[k]), 0) * 100) / 100;
  const totals = {
    reconciled: sum(reconciled, 'cashOut'),
    apOnly: sum(apOnly, 'cashOut'),
    orphanJournal: sum(orphanJournal, 'cashOut'),
    noLedger: sum(noLedger, 'amount')
  };
  const ledgerTotal = Math.round((totals.reconciled + totals.apOnly + totals.orphanJournal) * 100) / 100;

  /* The coherence identity worth watching: every journal entry that DOES name a live payable should
     add up to the sum of every Paid (PHP) on the sheet. When those two drift apart, the ledger and the
     payables have stopped describing the same events, and that is a different and worse problem than
     any single row being wrong. */
  const matchedJournalTotal = Math.round((totals.reconciled + totals.apOnly) * 100) / 100;
  const apPaidTotal = Math.round(aps.reduce((t, a) => t + _prgNum(a.paidPHP), 0) * 100) / 100;

  return {
    reconciled: reconciled, apOnly: apOnly, orphanJournal: orphanJournal, noLedger: noLedger,
    totals: totals,
    ledgerTotal: ledgerTotal,
    matchedJournalTotal: matchedJournalTotal,
    apPaidTotal: apPaidTotal,
    ledgerAgreesWithPayables: Math.abs(matchedJournalTotal - apPaidTotal) <= PRG_EPS,
    // Everything the ledger cannot account for, which is the number to act on.
    unaccounted: Math.round((totals.apOnly + totals.orphanJournal) * 100) / 100
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { paymentRegister };
