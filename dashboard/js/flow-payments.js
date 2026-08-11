/* flow-payments.js — A223, the Payment Register.
 *
 * READ-ONLY BY CONSTRUCTION. There is no postFlow anywhere in this file and there must never be one.
 * A221's whole point was to give money a single door — marking the payment request paid — and a
 * second screen that could also write would quietly reopen the one this register exists to expose.
 * Every row links out instead, so you act in the record that owns the fact.
 *
 * It needs no backend change: getPaymentRequests, getAPAging and getJournal all already exist, so the
 * join happens here and the page works against the deployed v121 as well as v127.
 *
 * The reconciliation itself lives in payment-register.js — pure and table-tested — because a join
 * that quietly mis-sorts a payment is exactly what must not be eyeballed.
 */

let pgSession = null;
let pgData = null;

document.addEventListener('DOMContentLoaded', async () => {
  pgSession = requireOversight();
  if (!pgSession) return;
  renderNavbar('flow-payments');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-payments.html');
  const pb = document.getElementById('printBtn');
  if (pb) pb.addEventListener('click', () => window.print());
  await loadRegister();
});

async function loadRegister() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const [pr, ap, jr] = await Promise.all([
      fetchFlow('getPaymentRequests', {}, { fresh: true }),
      fetchFlow('getAPAging', {}, { fresh: true }),
      fetchFlow('getJournal', {}, { fresh: true })
    ]);
    pgData = paymentRegister((pr && pr.data) || [], (ap && ap.data) || [], (jr && jr.data) || []);
    render();
  } catch (e) {
    c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

const pgMoney = (v) => flowMoney(v, 'PHP');

/** One section: a coloured band, a count, its own total, and a table. */
function pgSection(tone, title, count, total, note, tableHtml) {
  return `<div class="pg-sec ${tone}">
    <div class="pg-sec-h"><h3>${flowEsc(title)}</h3><span class="n">${count} ${count === 1 ? 'entry' : 'entries'}</span><span class="t">${pgMoney(total)}</span></div>
    ${note ? `<div class="pg-note">${note}</div>` : ''}
    ${count ? tableHtml : '<p style="color:var(--text-muted,#64748b);font-size:0.82rem;">Nothing here — which is the good outcome.</p>'}
  </div>`;
}

/* A payment row. The links are the point: this page reports, and every fact is acted on where it
   lives — the request on Payment Requests, the payable on AP Aging. */
function pgPayRow(r, withWhy) {
  const fc = r.currency && String(r.currency).toUpperCase() !== 'PHP' && r.amountFC
    ? `${flowEsc(r.currency)} ${flowNum(r.amountFC).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
  return `<tr>
    <td>${flowEsc(r.entryNo || '')}</td>
    <td><a class="link-btn" href="flow-ap-aging.html" title="Open AP Aging">${flowEsc(r.apNo)}</a></td>
    <td>${flowEsc(String(r.supplier || '—').slice(0, 28))}</td>
    <td>${flowEsc(String(r.poNo || '—').slice(0, 26))}</td>
    <td class="num">${fc}</td>
    <td class="num">${pgMoney(r.cashOut)}</td>
    <td>${r.prNo ? `<a class="link-btn" href="flow-payment-requests.html" title="Open Payment Requests">${flowEsc(String(r.prNo).slice(0, 24))}</a>${r.prStatus ? ' ' + (typeof flowStatusBadge === 'function' ? flowStatusBadge(r.prStatus) : flowEsc(r.prStatus)) : ''}` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    ${withWhy ? `<td class="pg-why">${flowEsc(r.why || '')}</td>` : ''}
  </tr>`;
}

function pgPayTable(rows, withWhy) {
  return `<table class="flow-table"><thead><tr>
    <th>Journal</th><th>Payable</th><th>Supplier</th><th>PO</th>
    <th class="num">Owed (FC)</th><th class="num">Cash out</th><th>Request</th>
    ${withWhy ? '<th>Why it is here</th>' : ''}</tr></thead>
    <tbody>${rows.map(r => pgPayRow(r, withWhy)).join('')}</tbody></table>`;
}

function render() {
  const R = pgData, c = document.getElementById('container');
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('kpiLedger', pgMoney(R.ledgerTotal));
  set('kpiLedgerSub', `${R.reconciled.length + R.apOnly.length + R.orphanJournal.length} APPAY postings`);
  set('kpiOk', pgMoney(R.totals.reconciled));
  set('kpiUnexplained', pgMoney(R.totals.apOnly));
  set('kpiOrphan', pgMoney(R.totals.orphanJournal));

  let html = '';

  html += pgSection('ok', 'Reconciled', R.reconciled.length, R.totals.reconciled,
    'The request, the payable and the ledger all agree. Nothing to do.',
    pgPayTable(R.reconciled, false));

  html += pgSection('warn', 'Paid, but no paid request explains it', R.apOnly.length, R.totals.apOnly,
    'The money is recorded against the payable and it reached the ledger, but no payment request was '
    + 'ever marked paid — so there is no record of who released it, no payment method checked and no '
    + 'proof of payment demanded. Open each request and mark it paid properly.',
    pgPayTable(R.apOnly, true));

  html += pgSection('bad', 'Unmatched cash postings', R.orphanJournal.length, R.totals.orphanJournal,
    'These credit Cash against a payable number that no longer exists, so nothing in the system '
    + 'explains them. They may be genuine payments whose records were tidied away, or ledger residue '
    + 'from deleted purchase orders — the difference matters and only a bank statement can settle it. '
    + '<b>Nothing here has been changed.</b>',
    `<table class="flow-table"><thead><tr><th>Journal</th><th>Names payable</th><th class="num">Cash out</th><th>Why it is here</th></tr></thead>
      <tbody>${R.orphanJournal.map(o => `<tr><td>${flowEsc(o.entryNo)}</td><td>${flowEsc(o.apNo)}</td>
        <td class="num">${pgMoney(o.cashOut)}</td><td class="pg-why">${flowEsc(o.why)}</td></tr>`).join('')}</tbody></table>`);

  html += pgSection('bad', 'Paid, but in no ledger at all', R.noLedger.length, R.totals.noLedger,
    'A Type-Other payment request marked Paid writes the request row and nothing else — no payable, '
    + 'no journal entry, no expense. This cash left the company and has never appeared in the books. '
    + 'A221-5 books an expense at the moment of payment; these predate it and need booking once.',
    `<table class="flow-table"><thead><tr><th>Request</th><th>Payee</th><th class="num">Amount</th><th>Paid</th><th>Purpose</th></tr></thead>
      <tbody>${R.noLedger.map(o => `<tr>
        <td><a class="link-btn" href="flow-other-payables.html">${flowEsc(o.prNo)}</a></td>
        <td>${flowEsc(String(o.payee || '—').slice(0, 30))}</td>
        <td class="num">${pgMoney(o.amount)}</td>
        <td>${flowEsc(flowDate(o.paidAt) || '—')}${o.paidBy ? ' · ' + flowEsc(o.paidBy) : ''}</td>
        <td>${flowEsc(String(o.purpose || '').slice(0, 40))}</td></tr>`).join('')}</tbody></table>`);

  /* The identity the page must state rather than imply: every journal entry naming a live payable
     should equal the sum of every Paid (PHP). When those drift apart, the ledger and the payables
     have stopped describing the same events — a worse problem than any single row. */
  html += `<div class="pg-ident ${R.ledgerAgreesWithPayables ? 'ok' : 'bad'}">
    ${R.ledgerAgreesWithPayables ? '✓' : '✕'} Matched postings ${pgMoney(R.matchedJournalTotal)}
    ${R.ledgerAgreesWithPayables ? '=' : '≠'} sum of every recorded payment ${pgMoney(R.apPaidTotal)}.
    ${R.ledgerAgreesWithPayables
      ? 'The ledger and the payables describe the same events.'
      : '<b>They disagree — the ledger and the payables have diverged, which needs looking at before any single row does.</b>'}
    <br>Cash the ledger cannot fully account for: <b>${pgMoney(R.unaccounted)}</b> of ${pgMoney(R.ledgerTotal)}.
  </div>`;

  c.innerHTML = html;
}
