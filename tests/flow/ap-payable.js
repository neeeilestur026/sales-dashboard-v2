/* A219 — a payable marked Paid cannot exceed what was actually paid for it.
 *
 * THE POINT OF THIS RULE IS THAT IT NEEDS NO EXCHANGE RATE. There isn't one to have: the peso value
 * of a foreign payable is whatever the bank gives on the day of the transfer, which is why three of
 * the four foreign POs store `Exchange Rate: 0`. That is honest, not missing. What the company does
 * hold is the foreign amount owed and the pesos that actually left the account — and double entry
 * alone is enough from there.
 *
 * What this file exists to hold down:
 *   • the two real errors are caught — AP-202607-001 at 10x its payments, AP-202607-006 at 25x;
 *   • AP-202607-007 STILL PASSES. It is a ₱27,000 order with a ₱30,240 payable, and the 12% is VAT.
 *     The payment request carries the VAT too, so the rule needs no special case — and a rule that
 *     flags it has overreached. This is the assertion that keeps the fix honest;
 *   • a PART payment is legitimately less than the payable and must never be flagged;
 *   • a payable with no approved request has nothing to reconcile against and is left alone rather
 *     than refused, because payments do get made outside the system;
 *   • the ordering bug: the reconcile that overwrites the payable with the paid figure must run
 *     AFTER validation, or the paid-exceeds-payable branch can never fire on a Paid row.
 *
 * The functions live in Apps Script, so they are lifted out of FlowAPI.gs and run here against a fake
 * sheet — the same technique tests/flow/quotation-owner.js uses.
 */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

function lift(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = SRC.indexOf('{', i);
  let d = 0;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* The fake sheet. PaymentRequests is what _poRequestedPHP reads — the independent evidence. */
let PRS = [];
const _rows = (name) => (name === 'PaymentRequests' ? PRS : []);
const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const _FX_BAND = { min: 20, max: 200 };

eval(lift('_poRequestedPHP'));
eval(lift('_apAmountProblem'));

const PR = (poNo, amount, status) => ({ 'PO No': poNo, 'Amount': amount, 'Status': status || 'Approved' });
const check = (o) => _apAmountProblem(o.poNo, o.cur, o.fc, o.php, o.paid || 0, o.status);

console.log('== the ten live rows, exactly as the baseline recorded them ==');
{
  /* tests/flow/baseline/A219-ap-before.txt. Every figure here is real. */
  PRS = [
    PR('PO-001', 44323.20), PR('PO-002', 43500), PR('PO-005', 310429.94),
    PR('PO-006', 12447.24), PR('PO-007', 30240), PR('PO-009', 17073),
    PR('PO-011', 69686), PR('PO-012', 0, 'Draft'), PR('PO-014', 119083.73)
  ];
  const live = [
    // apNo,        poNo,     cur,  amountFC,   amountPHP,   paidPHP,    status,    shouldBlock
    ['AP-...-001', 'PO-001', 'USD', 720,        446393.8,    46393.8,   'Paid',    true ],
    ['AP-...-002', 'PO-002', 'PHP', 43500,      43500,       43500,     'Paid',    false],
    ['AP-...-005', 'PO-005', 'USD', 5035.36,    310429.944,  310429.94, 'Paid',    false],
    ['AP-...-006', 'PO-006', 'USD', 202,        310895.71,   310895.71, 'Paid',    true ],
    ['AP-...-007', 'PO-007', 'PHP', 27000,      30240,       30240,     'Paid',    false],
    ['AP-...-009', 'PO-009', 'PHP', 34146,      34146,       17073,     'Partial', false],
    ['AP-...-011', 'PO-011', 'PHP', 139372,     139372,      69686,     'Partial', false],
    ['AP-...-012', 'PO-012', 'PHP', 54400,      54400,       0,         'Unpaid',  false],
    ['AP-...-013', 'PO-013', 'PHP', 250560,     250560,      0,         'Unpaid',  false],
    ['AP-...-014', 'PO-014', 'SGD', 2493.9,     119083.725,  0,         'Unpaid',  false]
  ];
  live.forEach(([apNo, poNo, cur, fc, php, paid, status, shouldBlock]) => {
    const g = check({ poNo, cur, fc, php, paid, status });
    const blocked = !!(g && g.block);
    ok((shouldBlock ? 'BLOCKS  ' : 'passes  ') + apNo + '  ' + cur + ' ' + fc + ' → ₱' + php,
       blocked === shouldBlock, { blocked, why: g && g.message });
  });
}

console.log('\n== AP-007: the VAT row that must NOT be flagged ==');
{
  /* ₱27,000 order, ₱30,240 payable — exactly ×1.12. The payment request carries the VAT too, so the
     payments reconcile and the rule stays quiet. A version of this fix that blocks here has
     overreached, and that is the failure mode worth a dedicated test. */
  PRS = [PR('PO-007', 30240)];
  const g = check({ poNo: 'PO-007', cur: 'PHP', fc: 27000, php: 30240, paid: 30240, status: 'Paid' });
  ok('not blocked', !(g && g.block), g && g.message);
  ok('...and the VAT is still mentioned, because saying so is useful',
     !!g && /vat/i.test(g.message), g && g.message);
  eq('and it is a warning, never a refusal', g ? g.block : null, false);
}

console.log('\n== a part payment is not an error ==');
{
  PRS = [PR('PO-X', 50000)];
  ok('half paid, still open',
     !check({ poNo: 'PO-X', cur: 'PHP', fc: 100000, php: 100000, paid: 50000, status: 'Partial' }));
  ok('and the same row marked Paid IS refused, because then it should reconcile',
     !!check({ poNo: 'PO-X', cur: 'PHP', fc: 100000, php: 100000, paid: 50000, status: 'Paid' }).block);
}

console.log('\n== no payment request: nothing to reconcile against ==');
{
  PRS = [];
  ok('a payable settled outside the system is left alone, not refused',
     !check({ poNo: 'PO-NONE', cur: 'PHP', fc: 90000, php: 90000, paid: 90000, status: 'Paid' }));
  PRS = [PR('PO-D', 12447.24, 'Draft'), PR('PO-D', 99999, 'Rejected')];
  ok('a Draft or Rejected request is not evidence of anything',
     !check({ poNo: 'PO-D', cur: 'USD', fc: 202, php: 12447.24, paid: 12447.24, status: 'Paid' }));
}

console.log('\n== the tolerance ==');
{
  PRS = [PR('PO-T', 100000)];
  const at = (php) => !!(check({ poNo: 'PO-T', cur: 'PHP', fc: 100000, php, paid: php, status: 'Paid' }) || {}).block;
  ok('a rounding centavo over is fine', !at(100000.004));
  ok('₱400 over on ₱100k is within 0.5% and passes', !at(100400));
  ok('₱1,000 over is not', at(101000));
  ok('and UNDER is never an error — a payable can be less than what was requested', !at(90000));
}

console.log('\n== the FX band still catches a typo where there is no payment yet ==');
{
  PRS = [];
  const g = check({ poNo: 'PO-Z', cur: 'USD', fc: 202, php: 310895.71, paid: 0, status: 'Unpaid' });
  ok('₱1,539/USD is refused even with nothing to reconcile against', !!(g && g.block), g && g.message);
  ok('and the message names the implied rate', !!g && /1539/.test(g.message), g && g.message);
  ok('a real rate passes',
     !check({ poNo: 'PO-Z', cur: 'USD', fc: 202, php: 12447.24, paid: 0, status: 'Unpaid' }));
}

console.log('\n== paid exceeding the payable ==');
{
  PRS = [];
  const g = check({ poNo: 'PO-P', cur: 'PHP', fc: 310429.94, php: 310429.94, paid: 310895.71, status: 'Paid' });
  ok('refused', !!(g && g.block), g && g.message);
  ok('and it says so plainly', !!g && /more than the payable/i.test(g.message), g && g.message);
  /* THE ORDERING BUG. updateAPAging used to overwrite Amount with Paid whenever the row was Paid,
     BEFORE calling this — so by the time the guard looked, the two were equal by construction and
     this branch could never fire on the rows where it matters. The check below is what that
     collapsed state looks like; it must pass, which is exactly why the reconcile has to come after
     validation and not before. */
  /* Once reconciled the two are equal, so the paid-exceeds-payable branch has nothing to say — which
     is precisely why the reconcile must not run first. (It still emits a non-blocking note that the
     peso figure sits 0.15% above the order value; on the real AP-202607-005 that 0.15% IS the bank
     charge, which is the separate modelling gap.) */
  const collapsed = check({ poNo: 'PO-P', cur: 'PHP', fc: 310429.94, php: 310895.71, paid: 310895.71, status: 'Paid' });
  ok('...whereas once reconciled it no longer BLOCKS — which is why order matters',
     !(collapsed && collapsed.block), collapsed && collapsed.message);
}

console.log('\n== A221: THE RECONCILE IS GONE, and its absence is asserted on the source ==');
{
  /* A219 fixed the ORDER of these two statements. A221 deleted the second one outright, because a
     payable is what is owed and the paid figure is what was paid, and letting either become the other
     destroys the evidence that they ever differed. That is how AP-202607-006 came to hold TWO wrong
     numbers when only ONE was typed.

     An absence cannot be observed from behaviour — a function that never had the line and a function
     that just lost it behave identically — so it is asserted against the source. Comments are
     stripped first, or the explanatory comment that replaced the code would satisfy the search. */
  const fn = lift('updateAPAging');
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('the guard is still there', code.indexOf('_apAmountProblem(') > 0);
  ok('Amount (PHP) is never assigned from Paid (PHP)',
     !/cur\[5\]\s*=\s*_num\(cur\[8\]\)/.test(code), code.match(/cur\[5\][^\n]*/g));
  ok('...and no reconcile of any shape survives',
     !/if\s*\(String\(cur\[6\]\)\.toLowerCase\(\)\s*===\s*'paid'\s*&&/.test(code));
  /* The same removal had to happen in the journal, or the Status dropdown became a third way to move
     money: choose 'Paid', save, and the full payable was credited out of Cash with nothing entered. */
  ok('and the journal no longer falls back to the payable when Status is Paid',
     !/payment\s*=\s*_num\(cur\[5\]\)/.test(code), code.match(/payment\s*=[^\n]*/g));
  ok('the journal follows Paid (PHP) alone', /var payment = _num\(cur\[8\]\);/.test(code));
}

console.log('\n== A221: Paid (PHP) cannot be written from this page without saying so ==');
{
  /* Until A221 this was an ordinary editable cell, and therefore a second way to pay a supplier with
     no approved request, no payment method, no method-ownership check and no proof of payment — all
     of which markPaymentRequestPaid demands. On the live book only 2 of 9 supplier payments went
     through Mark Paid; five more show a payable marked Paid with the request still at Approved and
     'Paid By' blank. */
  const code = lift('updateAPAging').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('a change to Paid (PHP) is gated', /p\.paidPHP !== undefined && _num\(p\.paidPHP\) !== _num\(cur\[8\]\)/.test(code));
  ok('the gate needs BOTH an explicit flag and a reason',
     /!p\.externalPayment \|\| !_why/.test(code), code.match(/!p\.externalPayment[^\n]*/g));
  ok('it refuses with a named confirm rather than a bare error',
     /needsConfirm: 'externalPayment'/.test(code));
  ok('and the reason is stamped into Notes, where it stays visible afterwards',
     /Recorded outside the system by/.test(lift('updateAPAging')));
  ok('the stamp is not then overwritten by the same save',
     /p\.notes = undefined/.test(code));
  /* Paid (PHP) is no longer written by the plain set() list — that is the whole point. */
  ok('set(8, ...) is gone from the ordinary field list', !/set\(8,/.test(code), code.match(/set\(\d,[^\n]*/g));
}

console.log('\n== the guard ordering (A219) still holds where it matters ==');
{
  const fn = lift('updateAPAging');
  const guardAt = fn.indexOf('_apAmountProblem(');
  const writeAt = fn.indexOf('sh.getRange(ri, 1, 1, headers.length).setValues');
  ok('the guard runs BEFORE the row is written', guardAt > 0 && guardAt < writeAt, { guardAt, writeAt });
  // Read the argument list by brace-matching rather than a regex — the call contains nested _num(...)
  // parens, which a naive [^)]* can never span.
  const callAt = fn.indexOf('_apAmountProblem(');
  let depth = 0, endAt = -1;
  for (let k = fn.indexOf('(', callAt); k < fn.length; k++) {
    if (fn[k] === '(') depth++;
    else if (fn[k] === ')') { depth--; if (!depth) { endAt = k; break; } }
  }
  const args = fn.slice(fn.indexOf('(', callAt) + 1, endAt);
  ok('the guard is passed the status, without which the primary rule cannot apply',
     /cur\[6\]/.test(args), args);
}

console.log('\n== rubbish does not throw ==');
{
  PRS = [];
  ok('no currency', check({ poNo: 'P', cur: '', fc: 0, php: 0, paid: 0, status: '' }) === null);
  ok('no PO number', _poRequestedPHP('') === 0);
  ok('null PO number', _poRequestedPHP(null) === 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
