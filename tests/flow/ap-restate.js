/* A372 — the director restates what was paid on a payable, from its paid payment requests (FlowAPI 188).
 *
 * Run:  node tests/flow/ap-restate.js
 *
 * The fixture is the live case of 26 Oct 2026 (read only): AP-202607-013, CON BAN KIAT, PO 2026-44, ₱250,560, said
 * ₱250,560 paid and Paid, while the only payment request on the order, PRF-2026-92 CBK, paid ₱125,280 (the books
 * follow the request). Neil: "we only paid the other half before … change it, and let the accounting create a new prf
 * paying for the other half". Pinned here:
 *   • the payable says it is fully paid, so a new request is refused; with the books on, the AP page cannot change it;
 *   • restateAPPaid (director, a reason, the figure on file) sets Paid (PHP) to what the paid requests settled, the
 *     status to Partial, stamps the Notes, re-posts JE-APPAY-AP-202607-013 at ₱125,280 and keeps a full copy in
 *     Overrides; a dry run writes nothing; every refusal writes nothing; it is secured and audited;
 *   • then accounting raises the request for the other half (₱125,280, and no more), and paying it makes the payable
 *     Paid at ₱250,560 with the journal at ₱250,560;
 *   • the other Co Ban Kiat order (PO 2026-43, PRF-2026-71) is untouched.
 */
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const section = (t) => console.log('\n== ' + t + ' ==');
const DIR = { actorRole: 'director', actorName: 'Neil Estur' };
const ACC = { actorRole: 'accounting', actorName: 'Rojan Leo R. Francisco Jr.' };
const WHY = 'Only half was paid on PRF-2026-92 CBK; the other half is paid this week.';

function store(books) {
  return {
    PurchaseOrders: [
      { 'PO No': '2026-44 CO BAN KIAT', 'Supplier': 'CON BAN KIAT', 'Status': 'Approved', 'Total': 250560, 'Currency': 'PHP', 'Created By': 'Crystal Gayle' },
      { 'PO No': '2026-43 CO BAN KIAT', 'Supplier': 'CO BAN KIAT HARDWARE INC.', 'Status': 'Approved', 'Total': 54400, 'Currency': 'PHP', 'Created By': 'Crystal Gayle' }],
    APAging: [
      { 'AP No': 'AP-202607-013', 'PO No': '2026-44 CO BAN KIAT', 'Supplier': 'CON BAN KIAT', 'Currency': 'PHP', 'Amount (FC)': 250560, 'Amount (PHP)': 250560,
        'Status': 'Paid', 'Due Date': '2026-09-04', 'Paid (PHP)': 250560, 'Notes': '', 'Created At': '2026-07-29', 'Updated At': '2026-09-07', 'PR No': 'PRF-2026-92 CBK' },
      { 'AP No': 'AP-202607-012', 'PO No': '2026-43 CO BAN KIAT', 'Supplier': 'CO BAN KIAT HARDWARE INC.', 'Currency': 'PHP', 'Amount (FC)': 54400, 'Amount (PHP)': 54400,
        'Status': 'Paid', 'Due Date': '2026-09-04', 'Paid (PHP)': 54400, 'Notes': '', 'Created At': '2026-07-29', 'Updated At': '2026-09-07', 'PR No': 'PRF-2026-71 CO BAN KIAT' }],
    PaymentRequests: [
      { 'PR No': 'PRF-2026-92 CBK', 'Type': 'PO', 'PO No': '2026-44 CO BAN KIAT', 'Supplier': 'CON BAN KIAT', 'Payee': 'CON BAN KIAT', 'Currency': 'PHP', 'Amount': 125280,
        'Status': 'Paid', 'Paid At': '2026-09-07', 'Paid By': 'Neil', 'Created By Role': 'accounting' },
      { 'PR No': 'PRF-2026-71 CO BAN KIAT', 'Type': 'PO', 'PO No': '2026-43 CO BAN KIAT', 'Supplier': 'CO BAN KIAT HARDWARE INC.', 'Payee': 'CO BAN KIAT HARDWARE INC.', 'Currency': 'PHP',
        'Amount': 54400, 'Status': 'Paid', 'Paid At': '2026-09-07', 'Paid By': 'Neil', 'Created By Role': 'accounting' }],
    Journal: [
      { 'Entry No': 'JE-APPAY-AP-202607-013', 'Date': '2026-09-07', 'Source': 'APPAY', 'Source No': 'AP-202607-013', 'Account Code': '2010', 'Account Name': 'Accounts Payable', 'Debit': 250560, 'Credit': 0, 'Currency': 'PHP', 'Memo': 'Payment of AP-202607-013' },
      { 'Entry No': 'JE-APPAY-AP-202607-013', 'Date': '2026-09-07', 'Source': 'APPAY', 'Source No': 'AP-202607-013', 'Account Code': '1010', 'Account Name': 'Cash', 'Debit': 0, 'Credit': 250560, 'Currency': 'PHP', 'Memo': 'Payment of AP-202607-013' },
      { 'Entry No': 'JE-APPAY-AP-202607-012', 'Date': '2026-09-07', 'Source': 'APPAY', 'Source No': 'AP-202607-012', 'Account Code': '2010', 'Account Name': 'Accounts Payable', 'Debit': 54400, 'Credit': 0, 'Currency': 'PHP', 'Memo': 'Payment of AP-202607-012' },
      { 'Entry No': 'JE-APPAY-AP-202607-012', 'Date': '2026-09-07', 'Source': 'APPAY', 'Source No': 'AP-202607-012', 'Account Code': '1010', 'Account Name': 'Cash', 'Debit': 0, 'Credit': 54400, 'Currency': 'PHP', 'Memo': 'Payment of AP-202607-012' }],
    Overrides: [], ActivityLog: [], Documents: [], DocMeta: [], Expenses: [],
    FlowSettings: books ? [{ 'Key': 'booksEngine', 'Value': 'on' }] : []
  };
}
const ap = (s, no) => s.APAging.find(r => r['AP No'] === (no || 'AP-202607-013'));
const je = (s, no) => s.Journal.filter(r => r['Source'] === 'APPAY' && r['Source No'] === (no || 'AP-202607-013'));
const dr = (s, no) => je(s, no).reduce((t, r) => t + Number(r['Debit'] || 0), 0);
const cr = (s, no) => je(s, no).reduce((t, r) => t + Number(r['Credit'] || 0), 0);
const NEW_PR = { type: 'PO', poNo: '2026-44 CO BAN KIAT', currency: 'PHP', payee: 'CON BAN KIAT', purpose: 'Second half of PO 2026-44' };

section('1 · before: the payable says fully paid, so the second half cannot be requested');
{
  const s = store(true), c = load(undefined, s);
  const r = call(c, 'createPaymentRequest', Object.assign({}, NEW_PR, { amount: 125280 }, ACC));
  ok('a request for the other half is refused (it reads as fully paid)', !r.success && /already fully paid|exceeds what is still owed/.test(r.message), r);
  const u = call(c, 'updateAPAging', Object.assign({ rowIndex: ap(s).rowIndex || 2, apNo: 'AP-202607-013', paidPHP: 125280, externalPayment: true, externalPaymentReason: WHY }, DIR));
  ok('  and with the books on, the AP page cannot change the paid figure', !u.success && /recorded through a payment request/.test(u.message), u);
}

section('2 · the refusals write nothing');
{
  const s = store(true), c = load(undefined, s), before = JSON.stringify([s.APAging, s.Journal, s.Overrides]);
  const cases = [
    [Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: WHY }, ACC), /Only the director/],
    [Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: 'half' }, DIR), /at least 10 characters/],
    [Object.assign({ apNo: 'AP-202607-013', expectPaid: 125280, reason: WHY }, DIR), /shows 250560\.00 paid on file, not 125280\.00/],
    [Object.assign({ apNo: 'AP-209912-999', expectPaid: 1, reason: WHY }, DIR), /was not found/],
    [Object.assign({ apNo: 'AP-202607-012', expectPaid: 54400, reason: WHY }, DIR), /already shows 54400\.00 paid, what its paid payment requests settled/],
  ];
  cases.forEach(([params, re]) => { const r = call(c, 'restateAPPaid', params); ok('refused: ' + re.source.slice(0, 50), !r.success && re.test(r.message), r); });
  ok('  and not one of them wrote anything', JSON.stringify([s.APAging, s.Journal, s.Overrides]) === before);
  const sec = call(c, 'restateAPPaid', Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: WHY, flowSecret: '' }, DIR));
  ok('  it is secured: no secret, no change', !sec.success && JSON.stringify([s.APAging, s.Journal, s.Overrides]) === before, sec);
  const s2 = store(true);
  s2.APAging[0]['Currency'] = 'USD';
  const fx = call(load(undefined, s2), 'restateAPPaid', Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: WHY }, DIR));
  ok('  a foreign-currency payable is left to a person', !fx.success && /USD payable/.test(fx.message), fx);
  const s3 = store(true);
  s3.APAging.push(Object.assign({}, s3.APAging[0], { 'AP No': 'AP-202607-099', 'Paid (PHP)': 0, 'Status': 'Unpaid' }));
  const two = call(load(undefined, s3), 'restateAPPaid', Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: WHY }, DIR));
  ok('  so is an order with two payables', !two.success && /has 2 payables/.test(two.message), two);
}

section('3 · the dry run, then the restatement');
{
  const s = store(true), c = load(undefined, s), before = JSON.stringify([s.APAging, s.Journal, s.Overrides]);
  const d = call(c, 'restateAPPaid', Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: WHY, dryRun: true }, DIR));
  ok('the dry run says what it would do, and writes nothing', d.success && d.dryRun && d.plan.paidBefore === 250560 && d.plan.paidAfter === 125280 && d.plan.statusAfter === 'Partial' &&
     d.plan.openAfter === 125280 && d.plan.requests.map(r => r.prNo).join() === 'PRF-2026-92 CBK' && JSON.stringify([s.APAging, s.Journal, s.Overrides]) === before, d);
  const r = call(c, 'restateAPPaid', Object.assign({ apNo: 'AP-202607-013', expectPaid: 250560, reason: WHY }, DIR));
  const row = ap(s);
  ok('restated: ₱125,280 paid of ₱250,560, Partial', r.success && row['Paid (PHP)'] === 125280 && row['Status'] === 'Partial' && row['Amount (PHP)'] === 250560, row);
  ok('  the Notes say from what to what, from which request, by whom and why', /^Paid restated from 250560\.00 to 125280\.00 \(the paid payment requests: PRF-2026-92 CBK\) by Neil Estur on \d{4}-\d{2}-\d{2}: Only half was paid/.test(row['Notes']), row['Notes']);
  ok('  JE-APPAY-AP-202607-013 is posted again at ₱125,280, still balanced', je(s).length === 2 && dr(s) === 125280 && cr(s) === 125280 && je(s).every(l => l['Entry No'] === 'JE-APPAY-AP-202607-013'), je(s));
  const o = s.Overrides[0];
  ok('  a full copy of the row before is in Overrides', s.Overrides.length === 1 && o['Action'] === 'restateAPPaid' && o['Rule'] === 'restated-ap-paid' && o['Ref No'] === 'AP-202607-013' &&
     JSON.parse(o['Entered'])['Paid (PHP)'] === 250560 && o['Reason'] === WHY, o);
  ok('  the director\'s change is in the activity log', s.ActivityLog.some(a => a['Module'] === 'AP Aging' && a['Action'] === 'Paid restated' && a['Ref No'] === 'AP-202607-013'), s.ActivityLog.slice(-2));
  ok('  the payment request itself is untouched, and so is the other Co Ban Kiat order', s.PaymentRequests[0]['Amount'] === 125280 && s.PaymentRequests[0]['Status'] === 'Paid' &&
     ap(s, 'AP-202607-012')['Paid (PHP)'] === 54400 && dr(s, 'AP-202607-012') === 54400);
  ok('  and a second run has nothing to change', /Nothing to change/.test(call(c, 'restateAPPaid', Object.assign({ apNo: 'AP-202607-013', expectPaid: 125280, reason: WHY }, DIR)).message));

  section('4 · then accounting raises the request for the other half, and paying it settles the payable');
  const tooMuch = call(c, 'createPaymentRequest', Object.assign({}, NEW_PR, { amount: 125281 }, ACC));
  ok('more than the other half is refused', !tooMuch.success && /exceeds what is still owed/.test(tooMuch.message), tooMuch);
  const pr = call(c, 'createPaymentRequest', Object.assign({}, NEW_PR, ACC));
  ok('with no amount typed, the request fills in the other half: ₱125,280', pr.success && s.PaymentRequests.find(x => x['PR No'] === pr.prNo)['Amount'] === 125280, pr);
  const row2 = s.PaymentRequests.find(x => x['PR No'] === pr.prNo);
  Object.assign(row2, { 'Status': 'Approved', 'Payment Method': 'Bank Transfer' });   // approval is its own chain, pinned elsewhere
  s.Documents.push({ 'Module': 'Payment Request', 'Ref No': pr.prNo, 'Doc Type': 'Proof of Payment', 'File Name': 'tt.pdf', 'File ID': 'f1' });
  const paid = call(c, 'markPaymentRequestPaid', Object.assign({ prNo: pr.prNo, paidFrom: 'METRO_ZAB', valueDate: '2026-10-28', paymentMethod: 'Bank transfer', reference: 'TT-1' }, DIR));   // a bank transfer is marked paid by the director
  ok('paying it makes the payable Paid at ₱250,560, and the journal follows', paid.success && ap(s)['Paid (PHP)'] === 250560 && ap(s)['Status'] === 'Paid' && dr(s) === 250560 && cr(s) === 250560,
     [paid, ap(s), dr(s)]);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
