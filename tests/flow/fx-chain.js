/* A222 — a foreign purchase has TWO numbers, and the system used to pretend it had one.
 *
 * The obligation is exact and foreign: USD 202, SGD 2,493.90, from the supplier. The peso cost is
 * unknowable until the bank executes the transfer. Until now the peso was invented at PO time (a
 * foreign PO is REFUSED without one), copied into the payable, inherited by the payment request, and
 * treated everywhere as fact — while the figure itself was never even stored on the order that
 * produced it.
 *
 * What this file exists to hold down:
 *   • THE WIDTH TRAP, first and before anything else. Two schemas widen here — PurchaseOrders 15→17
 *     and PaymentRequests 37→41 — and each has exactly one positional writer that must widen in step.
 *     This mistake has been made in A186, A193, A205, A215 and A218;
 *   • the cap is applied in the currency the obligation is IN. Comparing a USD amount against a peso
 *     payable is the bug that would let a request pass for 60× what is owed;
 *   • _poRemainingFC returns NULL rather than guessing. A foreign order carrying legacy PHP requests
 *     cannot be reconciled in foreign units without inventing a rate, and inventing one is the exact
 *     thing this change exists to stop. All 20 live requests are such rows, so the null path is the
 *     normal case today — not an edge case;
 *   • the peso estimate is PRO-RATED from the order's own estimate, so a request can never imply a
 *     different rate from the order it belongs to;
 *   • a PHP order behaves EXACTLY as it did before. Most of the book is PHP and none of it should
 *     feel this change at all.
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
function liftSchema() {
  const i = SRC.indexOf('var SCHEMA');
  const s = SRC.indexOf('{', i);
  let d = 0;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return eval('(' + SRC.slice(s, k + 1) + ')'); }
  }
}
/** Count the top-level entries of the array literal passed to _append('<Sheet>', [ ... ]). */
function countAppend(fnName, sheet) {
  const f = SRC.indexOf('function ' + fnName);
  const a = SRC.indexOf("_append('" + sheet + "', [", f);
  if (a < 0) throw new Error('no _append(' + sheet + ') in ' + fnName);
  const st = SRC.indexOf('[', a);
  let d = 0, en = -1;
  for (let k = st; k < SRC.length; k++) {
    if (SRC[k] === '[') d++;
    else if (SRC[k] === ']') { d--; if (!d) { en = k; break; } }
  }
  const body = SRC.slice(st + 1, en).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let depth = 0, n = 1, inStr = null;
  for (const c of body) {
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"') inStr = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return body.trim() ? n : 0;
}

const SCHEMA = liftSchema();

console.log('== THE WIDTH TRAP — both schemas, checked before anything else ==');
{
  eq('PurchaseOrders is 17 wide', SCHEMA.PurchaseOrders.length, 17);
  eq('...ending with the two new columns', SCHEMA.PurchaseOrders.slice(-2), ['Total (PHP) Est', 'FX Basis']);
  eq('createPurchaseOrder appends exactly that many',
     countAppend('createPurchaseOrder', 'PurchaseOrders'), SCHEMA.PurchaseOrders.length);

  eq('PaymentRequests is 41 wide', SCHEMA.PaymentRequests.length, 41);
  eq('...ending with the four new columns', SCHEMA.PaymentRequests.slice(-4),
     ['Amount (PHP) Est', 'Actual Debited (PHP)', 'Bank Charge (PHP)', 'Value Date']);
  eq('createPaymentRequest appends exactly that many',
     countAppend('createPaymentRequest', 'PaymentRequests'), SCHEMA.PaymentRequests.length);

  /* The neighbouring trap: APAging is written positionally by createPurchaseOrder too, and it did
     NOT widen. If a future change adds a column there without touching that line, every PO save
     breaks — so it is asserted here rather than discovered in production. */
  eq('APAging is still 13 wide', SCHEMA.APAging.length, 13);
  eq('and createPurchaseOrder still appends 13 to it',
     countAppend('createPurchaseOrder', 'APAging'), SCHEMA.APAging.length);
}

console.log('\n== the obligation is raised in the supplier\'s currency ==');
{
  const fn = lift('createPaymentRequest');
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /* The caller must DECLARE which currency it typed, and the three outcomes are deliberate:
     silence → PHP, mismatch → refused, agreement → the PO's currency.

     Adopting the PO's currency from a silent payload is the hazard: a browser still running the
     pre-A222 form sends only `amount`, typed in pesos, and the request would be stored as
     SGD 119,083 on an SGD order. A stale cached page must degrade to the OLD behaviour, not to a
     60× overstatement — so `currency = 'PHP'` still appears here, and it is the safe branch. */
  ok('the caller must declare its currency', /var said = String\(p\.currency \|\| ''\)\.toUpperCase\(\)/.test(code));
  ok('silence degrades to PHP — a stale browser cannot inflate an obligation',
     /if \(!said\) currency = 'PHP';/.test(code));
  ok('a mismatch is refused outright', /said !== poCur/.test(code) && /Reload the page/.test(code));
  ok('and agreement adopts the order\'s currency', /else currency = poCur;/.test(code));
  ok('the old unconditional force is gone',
     !/currency = 'PHP';\s*soNo/.test(code) && !/currency = po\['Currency'\] \|\| 'PHP';/.test(code));
  /* Type 'Other' must be untouched — a reimbursement really is a peso obligation. */
  ok('the Other branch still asks only for a payee and an amount',
     /if \(!p\.payee\) return[\s\S]{0,200}Amount must be greater than zero/.test(code));
}

console.log('\n== the cap is applied in the right units ==');
{
  // The fake sheet: a USD PO whose requests are all in USD.
  let PO = [], AP = [], PR = [];
  const _rows = (n) => n === 'PurchaseOrders' ? PO : n === 'APAging' ? AP : n === 'PaymentRequests' ? PR : [];
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  eval(lift('_poRemainingFC'));
  eval(lift('_poEstPHPFor'));

  PO = [{ 'PO No': 'PO-1', 'Currency': 'USD', 'Total Purchase (FC)': 202, 'Total (PHP) Est': 12447.24 }];
  AP = [{ 'PO No': 'PO-1', 'Amount (FC)': 202, 'Amount (PHP)': 12447.24, 'Paid (PHP)': 0 }];
  PR = [];
  eq('nothing requested yet — the whole obligation is open',
     _poRemainingFC('PO-1', '').remaining, 202);
  eq('and it is reported in the supplier\'s currency', _poRemainingFC('PO-1', '').currency, 'USD');

  PR = [{ 'PR No': 'PR-1', 'PO No': 'PO-1', 'Currency': 'USD', 'Amount': 100, 'Status': 'Approved' }];
  eq('an open request reserves its slice', _poRemainingFC('PO-1', '').remaining, 102);
  PR = [{ 'PR No': 'PR-1', 'PO No': 'PO-1', 'Currency': 'USD', 'Amount': 100, 'Status': 'Paid' }];
  eq('a PAID request settles it — no Paid (FC) column needed, and no rate',
     _poRemainingFC('PO-1', '').remaining, 102);
  PR = [{ 'PR No': 'PR-1', 'PO No': 'PO-1', 'Currency': 'USD', 'Amount': 100, 'Status': 'Rejected' }];
  eq('a rejected one reserves nothing', _poRemainingFC('PO-1', '').remaining, 202);
  PR = [{ 'PR No': 'PR-1', 'PO No': 'PO-1', 'Currency': 'USD', 'Amount': 100, 'Status': 'Approved' }];
  eq('excludePrNo lets a request be edited against itself',
     _poRemainingFC('PO-1', 'PR-1').remaining, 202);
}

console.log('\n== it refuses to guess, and says so by returning null ==');
{
  let PO = [], AP = [], PR = [];
  const _rows = (n) => n === 'PurchaseOrders' ? PO : n === 'APAging' ? AP : n === 'PaymentRequests' ? PR : [];
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  eval(lift('_poRemainingFC'));

  PO = [{ 'PO No': 'PO-P', 'Currency': 'PHP', 'Total Purchase (FC)': 43500 }];
  AP = [{ 'PO No': 'PO-P', 'Amount (FC)': 43500 }];
  eq('a PHP order returns null — the peso path is already correct', _poRemainingFC('PO-P', ''), null);

  /* THE LIVE CASE. Every one of the 20 existing requests is PHP-denominated, including those against
     USD orders. Reconciling those in foreign units would mean inventing a rate — the exact thing this
     change exists to stop — so it declines and the caller falls back to the peso cap. */
  PO = [{ 'PO No': 'PO-M', 'Currency': 'USD', 'Total Purchase (FC)': 202 }];
  AP = [{ 'PO No': 'PO-M', 'Amount (FC)': 202, 'Amount (PHP)': 12447.24 }];
  PR = [{ 'PR No': 'PR-OLD', 'PO No': 'PO-M', 'Currency': 'PHP', 'Amount': 12447.24, 'Status': 'Approved' }];
  eq('a foreign order with a legacy PHP request returns null rather than comparing USD to pesos',
     _poRemainingFC('PO-M', ''), null);

  PO = [{ 'PO No': 'PO-X', 'Currency': 'USD', 'Total Purchase (FC)': 202 }];
  AP = [];
  eq('no payable at all → null', _poRemainingFC('PO-X', ''), null);
  eq('unknown PO → null', _poRemainingFC('NOPE', ''), null);
  AP = [{ 'PO No': 'PO-X', 'Amount (FC)': 0 }];
  eq('a zero foreign amount → null, not a division by nothing', _poRemainingFC('PO-X', ''), null);
}

console.log('\n== the peso estimate is pro-rated, never invented ==');
{
  let PO = [];
  const _rows = () => PO;
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  eval(lift('_poEstPHPFor'));

  PO = [{ 'PO No': 'PO-1', 'Currency': 'USD', 'Total Purchase (FC)': 202, 'Total (PHP) Est': 12447.24, 'Exchange Rate': 0 }];
  eq('the whole order', _poEstPHPFor('PO-1', 202, 'USD'), 12447.24);
  eq('half of it', _poEstPHPFor('PO-1', 101, 'USD'), 6223.62);
  /* The point of pro-rating: the slice implies EXACTLY the rate the order implies. A separately
     computed estimate would drift, and two rates on one order is how this began. */
  eq('and the implied rate is identical to the order\'s',
     +(_poEstPHPFor('PO-1', 101, 'USD') / 101).toFixed(4),
     +(12447.24 / 202).toFixed(4));

  PO = [{ 'PO No': 'PO-2', 'Currency': 'SGD', 'Total Purchase (FC)': 2493.9, 'Total (PHP) Est': '', 'Exchange Rate': 47.75 }];
  eq('with no stored estimate it falls back to the stored rate', _poEstPHPFor('PO-2', 2493.9, 'SGD'), 119083.73);

  PO = [{ 'PO No': 'PO-3', 'Currency': 'USD', 'Total Purchase (FC)': 720, 'Total (PHP) Est': '', 'Exchange Rate': 0 }];
  eq('with neither, it returns nothing rather than a guess', _poEstPHPFor('PO-3', 720, 'USD'), '');
  //  ^ three of the four live foreign POs are exactly this shape.

  eq('a PHP request is its own estimate', _poEstPHPFor('PO-3', 43500, 'PHP'), 43500);
  eq('an unknown PO returns nothing', _poEstPHPFor('NOPE', 100, 'USD'), '');
}

console.log('\n== the three FX bugs the same trace turned up ==');
{
  /* 1. A JPY purchase order was impossible to save. The ₱20–₱200 band was a second UNCONDITIONAL
        `if`, so it fired even when the rate and the peso total reconciled perfectly — and since the
        PO screen computes the peso total AS rate × FC, they ALWAYS reconcile, leaving the band as
        the only check that ever ran. At ≈₱0.4/¥ every JPY order was refused, unappealably, because
        flow-purchase-orders.js has no needsConfirm:'poAmount' handler to reach the override. */
  const _FX_BAND = { min: 20, max: 200 };
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  eval(lift('_poFxProblem'));
  ok('a JPY order whose rate and peso total agree now SAVES',
     _poFxProblem('JPY', 1000000, 0.4, 400000) === null, _poFxProblem('JPY', 1000000, 0.4, 400000));
  ok('...and so does a high-rate currency', _poFxProblem('KWD', 100, 190, 19000) === null);
  ok('a supplied rate that does NOT reconcile is still refused',
     !!_poFxProblem('USD', 202, 61.62, 310895.71));
  ok('and with no rate at all the band still catches the mistyped digit',
     !!_poFxProblem('USD', 202, 0, 310895.71));
  ok('a plausible peso total with no rate passes', _poFxProblem('USD', 202, 0, 12447.24) === null);
  eq('PHP is never an FX problem', _poFxProblem('PHP', 43500, 1, 43500), null);

  /* 2. _poPayablePHP handed back a FOREIGN number when the peso payable was blank, and every caller
        treated it as pesos — understating a USD payable by a factor of ~60. */
  const src = lift('_poPayablePHP');
  ok('it no longer falls back to the foreign amount', !/php > 0 \? php : fc/.test(src), src);
  ok('and no longer even reads Amount (FC)', !/Amount \(FC\)/.test(src));

  /* 3. "PO Value (PHP)" excluded every foreign PO, because the handler never emitted the field the
        KPI reads — p.totalPHP was always undefined. */
  ok('getPurchaseOrders now emits totalPHP',
     /totalPHP: _num\(po\['Total \(PHP\) Est'\]\)/.test(lift('getPurchaseOrders')));
}

console.log('\n== Mark Paid records what the BANK did, and the cap moves ==');
{
  const fn = lift('markPaymentRequestPaid');
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  ok('the bank charge does NOT settle the payable',
     /var settles = debited > 0 \? \(debited - charge\) : _num\(r\['Amount'\]\)/.test(code));
  ok('a foreign payment must be told what the bank actually took',
     /needsConfirm: 'actualDebited'/.test(code));
  ok('the realised rate is DERIVED from what settled, never typed',
     /realisedRate = settles \/ _num\(r\['Amount'\]\)/.test(code));
  ok('a negative charge is refused', /A bank charge cannot be negative/.test(code));
  ok('and a charge larger than the debit is refused', /cannot exceed what was debited/.test(code));

  /* THE CAP. Capping the peso paid at the peso estimate caps reality at a forecast — which is why the
     only two real foreign payments on the live book were typed into the AP page instead. */
  ok('the peso cap no longer applies to a foreign payment',
     /if \(!isFC && payable > 0 && paidNow > payable \+ 0\.005\)/.test(code));
  ok('...but it still applies to a PHP one, where the payable IS the obligation',
     /payable > 0 && paidNow > payable \+ 0\.005/.test(code));

  ok('a foreign payable is closed on the OBLIGATION, not on the peso estimate',
     /_poRemainingFC\(String\(r\['PO No'\] \|\| ''\), String\(p\.prNo\)\)/.test(code));
  ok('with a fallback when the currencies are mixed', /leftFC === null/.test(code));

  ok('the bank fields are written only when supplied — blank means "not told", not zero',
     /if \(debited > 0\) prPatch\['Actual Debited \(PHP\)'\]/.test(code)
     && /if \(charge > 0\) prPatch\['Bank Charge \(PHP\)'\]/.test(code));
  ok('the FX difference is derived, not stored', !/prPatch\['FX/.test(code) && /var fxDiff =/.test(code));

  /* A PHP request must behave EXACTLY as before — most of the book is PHP. */
  ok('with nothing supplied, settles falls back to the request amount',
     /: _num\(r\['Amount'\]\)/.test(code));
  ok('and a PHP request is never asked for an actual debit',
     /if \(isFC && !\(debited > 0\)/.test(code));
}

console.log('\n== A222-U: reversing a receiving is the exact inverse of the weighted average ==');
{
  /* MR-202608-014 was received while AP-202607-006 still held a pasted ₱310,895.71, so CP872 and
     CP873 carry ₱184,690.52 and ₱126,205.19 against a USD 202 order. Correcting the payable did not
     touch inventory — receiving is a one-time stamp and there was no deleteReceiving at all. */
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const _normItemNo = (s) => String(s || '').trim();
  let INV = [];
  const _findInventory = (itemNo) => INV.filter(i => _normItemNo(i['Item No']) === _normItemNo(itemNo))[0] || null;
  eval(lift('_rcvReversalLine'));
  const line = (o) => ({ 'Item No': o.itemNo, 'Item Name': o.itemNo, 'Qty Received': o.q,
                         'Purchase Price/Unit (PHP)': o.c, 'Shipping/Unit (PHP)': o.s });

  /* THE LIVE CASE. Both items were CREATED by this receiving — balance exactly 1, nothing since — so
     the reversal is exact and lands them back at zero rather than at a blended remainder. */
  INV = [{ 'Item No': 'CP872', 'Available Balance': 1,
           'Purchase Price/Unit': 184690.52079207922, 'Shipping Cost/Unit': 1853.530693069307 }];
  const cp872 = _rcvReversalLine(line({ itemNo: 'CP872', q: 1, c: 184690.52079207922, s: 1853.530693069307 }));
  ok('CP872 reverses exactly', cp872.exact, cp872.reason);
  eq('  balance back to zero', cp872.balanceAfter, 0);
  eq('  and the cost with it', [cp872.purchaseAfter, cp872.shippingAfter], [0, 0]);
  eq('  value removed', cp872.valueRemoved, 186544.05);

  /* A partial holding: 3 on hand at a blended cost, 1 of them from this receiving. Backing that one
     out must restore the OTHER two to what they cost before — not wipe them, and not leave the
     blended figure standing. */
  INV = [{ 'Item No': 'X', 'Available Balance': 3, 'Purchase Price/Unit': 200, 'Shipping Cost/Unit': 20 }];
  const part = _rcvReversalLine(line({ itemNo: 'X', q: 1, c: 600, s: 60 }));
  ok('a partial holding reverses exactly', part.exact, part.reason);
  eq('  two units remain', part.balanceAfter, 2);
  eq('  at the cost they had before the receiving', [part.purchaseAfter, part.shippingAfter], [0, 0]);
  //  ^ 3 x 200 = 600 total, of which the incoming unit contributed 600 — so the prior two cost 0.
  //    Contrived, but it proves the arithmetic is the true inverse rather than a subtraction.

  INV = [{ 'Item No': 'Y', 'Available Balance': 4, 'Purchase Price/Unit': 150, 'Shipping Cost/Unit': 10 }];
  const y = _rcvReversalLine(line({ itemNo: 'Y', q: 2, c: 200, s: 20 }));
  eq('a realistic blend restores the prior average', [y.balanceAfter, y.purchaseAfter, y.shippingAfter], [2, 100, 0]);
  //  ^ (4x150 - 2x200)/2 = 100, and (4x10 - 2x20)/2 = 0.

  console.log('  -- and it refuses rather than guessing when the stock has moved --');
  INV = [{ 'Item No': 'Z', 'Available Balance': 0, 'Purchase Price/Unit': 100, 'Shipping Cost/Unit': 0 }];
  const sold = _rcvReversalLine(line({ itemNo: 'Z', q: 1, c: 100, s: 0 }));
  ok('already issued — refused', !sold.exact && /below the/.test(sold.reason), sold.reason);
  INV = [{ 'Item No': 'W', 'Available Balance': 2, 'Purchase Price/Unit': 10, 'Shipping Cost/Unit': 0 }];
  const neg = _rcvReversalLine(line({ itemNo: 'W', q: 1, c: 1000, s: 0 }));
  ok('backing the cost out would go negative — refused', !neg.exact && /negative/.test(neg.reason), neg.reason);
  INV = [];
  ok('no inventory row — refused', !_rcvReversalLine(line({ itemNo: 'Q', q: 1, c: 1, s: 0 })).exact);
  INV = [{ 'Item No': 'Q', 'Available Balance': 5, 'Purchase Price/Unit': 1, 'Shipping Cost/Unit': 0 }];
  ok('zero quantity — refused', !_rcvReversalLine(line({ itemNo: 'Q', q: 0, c: 1, s: 0 })).exact);

  /* The apply must never run without the preview agreeing, and never without a confirm. */
  const rev = lift('reverseReceiving').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('the apply re-runs the preview rather than trusting its caller', /var pre = previewReceivingReversal\(p\)/.test(rev));
  ok('and refuses when any line is inexact', /if \(!pre\.canReverse\)/.test(rev));
  ok('and demands a confirm', /if \(!p\.confirmReverse\)/.test(rev));
  ok('it drops the journal too', /_removeJournal\('MR', String\(p\.mrNo\)\)/.test(rev));
  ok('reverseReceiving is secured',
     /reverseReceiving: 1/.test(SRC.slice(SRC.indexOf('var _SECURED'), SRC.indexOf('var _SECURED') + 4000)));
}

console.log('\n== A221-5: a Type Other payment reaches the P&L ==');
{
  const code = lift('markPaymentRequestPaid').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('only a non-PO request books an expense', /if \(String\(r\['Type'\]\) !== 'PO'\)/.test(code));
  ok('idempotent on a Legacy Key', /_prExpenseKey\(p\.prNo\)/.test(code));
  ok('and a travel payable is recognised, not double-booked', /TRAV:/.test(code));
  ok('a refused expense does not undo a completed payment', /catch \(e\) \{ expNote/.test(code));
  eq('the key scheme cannot collide with the travel one',
     [lift('_prExpenseKey').indexOf("'PRF:'") > 0, lift('_travExpenseKey').indexOf("'TRAV:'") > 0], [true, true]);
  ok('the sweep for the already-paid ones is READ-ONLY',
     !/_append|setValues|deleteRow/.test(lift('previewOtherPaymentExpenses')));
}

console.log('\n== COGS is not touched by any of this ==');
{
  /* The single most important invariant in A222. Landed cost is built from _apPaidPHP — the ACTUAL
     pesos paid — pro-rated by foreign unit price over the PO's foreign total. It never reads a
     payment request, so moving the request to foreign currency cannot move it. Asserted on the
     source, because the formula's inputs are what must not change. */
  const rc = lift('createReceiving');
  ok('the cost basis is still the actual pesos paid', /var paidPHP = _apPaidPHP\(p\.poNo\);/.test(rc));
  ok('and the formula is unchanged',
     /purchasePHP = \(poTotalFC > 0\) \? \(paidPHP \* unitPriceFC \/ poTotalFC\) : 0/.test(rc));
  ok('createReceiving reads no payment request at all', !/PaymentRequests/.test(rc));
  /* And the guard that depends on the estimate still existing — remove the peso estimate entirely
     and this goes quiet, costing a 10%-paid PO's inventory at 10% with no warning. */
  ok('the partial-payment guard still compares against Amount (PHP)',
     /_num\(a\['Amount \(PHP\)'\]\)/.test(rc) && /partialPay/.test(rc));
}

console.log('\n== A224: the currency a PO may be raised in follows who the supplier is ==');
{
  /* The rule was measured against every live purchase order BEFORE it was written — 4 international
     (USD ×3, SGD ×1) and 6 local (PHP ×6), zero violations. So these assertions are a regression
     check on real data, not a hope about future data. */
  const _soSupplierKind = (so) => ({ 'SO-INTL': 'intl', 'SO-LOCAL': 'local' })[so] || '';
  eval(lift('_poCurrencyProblem'));

  const refuses = (so, cur) => _poCurrencyProblem(so, cur) !== '';

  console.log('  -- international --');
  ok('USD is fine on an international order',  !refuses('SO-INTL', 'USD'));
  ok('SGD is fine on an international order',  !refuses('SO-INTL', 'SGD'));
  ok('JPY is fine on an international order',  !refuses('SO-INTL', 'JPY'));
  ok('PHP is REFUSED on an international order', refuses('SO-INTL', 'PHP'));
  ok('  and the refusal names the order and both remedies',
     /SO-INTL/.test(_poCurrencyProblem('SO-INTL', 'PHP'))
     && /supplier type/.test(_poCurrencyProblem('SO-INTL', 'PHP')));

  console.log('  -- local --');
  ok('PHP is fine on a local order',   !refuses('SO-LOCAL', 'PHP'));
  ok('USD is REFUSED on a local order', refuses('SO-LOCAL', 'USD'));
  ok('SGD is REFUSED on a local order', refuses('SO-LOCAL', 'SGD'));
  ok('  and the refusal names the currency it turned down',
     /USD/.test(_poCurrencyProblem('SO-LOCAL', 'USD')));

  console.log('  -- unclassified and restock: NO rule, deliberately --');
  /* 13 live sales orders carry no supplier type. A220 refused to guess for them and so does this:
     forcing a guess would either push a local order into USD or refuse a real international one, and
     neither failure would name itself. */
  ['PHP', 'USD', 'SGD', 'JPY'].forEach(c => {
    ok(c + ' is allowed on an unclassified order', !refuses('SO-UNKNOWN', c));
    ok(c + ' is allowed on a restock PO (no SO at all)', !refuses('', c));
  });
  ok('a null SO is treated as a restock, not as a refusal', !refuses(null, 'USD'));
  ok('a blank currency says nothing (it defaults to PHP upstream)', !refuses('SO-INTL', ''));

  console.log('  -- case and whitespace --');
  ok('lower-case usd still passes on international', !refuses('SO-INTL', 'usd'));
  ok('lower-case php is still refused on international', refuses('SO-INTL', 'php'));
  ok('  php with spaces too', refuses('SO-INTL', '  php  '));
  ok('lower-case usd is still refused on local', refuses('SO-LOCAL', 'usd'));

  console.log('  -- every live PO still validates (measured before the rule was written) --');
  /* From getPurchaseOrders on the live book: 4 international, 6 local, zero violations. If this
     block ever fails, the rule has started refusing an order the company really placed. */
  const LIVE = [
    { so: 'SO-INTL',  cur: 'USD' }, { so: 'SO-INTL',  cur: 'USD' }, { so: 'SO-INTL', cur: 'USD' },
    { so: 'SO-INTL',  cur: 'SGD' },
    { so: 'SO-LOCAL', cur: 'PHP' }, { so: 'SO-LOCAL', cur: 'PHP' }, { so: 'SO-LOCAL', cur: 'PHP' },
    { so: 'SO-LOCAL', cur: 'PHP' }, { so: 'SO-LOCAL', cur: 'PHP' }, { so: 'SO-LOCAL', cur: 'PHP' }
  ];
  eq('all 10 live POs pass unchanged', LIVE.filter(x => refuses(x.so, x.cur)).length, 0);

  console.log('  -- BOTH writers enforce it, not just create --');
  /* A219 found _poFxProblem wired into create alone while update rewrote the very same fields. The
     same mistake here would leave the rule one edit away from being walked past. */
  ok('createPurchaseOrder calls it', /_poCurrencyProblem\(/.test(lift('createPurchaseOrder')));
  ok('updatePurchaseOrder calls it too', /_poCurrencyProblem\(/.test(lift('updatePurchaseOrder')));
  ok('update falls back to the order\'s stored SO No when the edit omits it',
     /_poCurrencyProblem\(p\.soNo \|\| \(poRow \? poRow\['SO No'\] : ''\)/.test(lift('updatePurchaseOrder')));
}

console.log('\n== A224: the bank charge is REPORTED, and the two COGS bugs are dead ==');
{
  /* The decision that matters most in A224, asserted on the source: getSOBankCharges must never
     write. Routing the charge into SOCostDetails automatically would move gross profit silently —
     two indistinguishable buckets, a local order that stores and never sums, a full-row overwrite,
     and several requests per PO that would have to accumulate. */
  const gb = lift('getSOBankCharges');
  ok('getSOBankCharges writes nothing at all',
     !/_append\(|appendRow\(|setValues\(|_setCellByKey\(|_writeItems\(/.test(gb));
  ok('  and it reads the charge A222 captured', /Bank Charge \(PHP\)/.test(gb));
  ok('  scoped to THIS order\'s purchase orders', /PurchaseOrders/.test(gb) && /SO No/.test(gb));
  ok('saveSOCostDetails is still the only writer of the cost record',
     /Bank Charge \(COGS\)/.test(lift('saveSOCostDetails')));

  /* Bug 1 — backfillMigratedRecords was missing the intl guard A220 gave _writeMigratedRecordsForSO.
     It is the BULK path over every SOCostDetails row, so one run wrote the disagreement across the
     whole legacy book. */
  const bf = lift('backfillMigratedRecords');
  ok('backfillMigratedRecords now reads COGS Type', /COGS Type/.test(bf));
  ok('  duties are excluded on a local order', /duties = bIntl \?/.test(bf));
  ok('  and so are the two bank charges and local charges', /other = bIntl \?/.test(bf));
  ok('its twin still has the guard it always had',
     /var intl = String\(cd\['COGS Type'\]/.test(lift('_writeMigratedRecordsForSO')));

  /* Bug 2 — _soCostComputed read the IMPORT field names only, so a stored record scored both bank
     charges as zero and would have reported a false mismatch on every international order. */
  eval(lift('_soCostBankCOGS')); eval(lift('_soCostBankShipping'));
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  eval(lift('_soCostComputed'));
  const IMPORT = { cogsType: 'international', purchaseOfGoods: 100, deliveryToOffice: 0,
    deliveryToClient: 0, bankServiceChargeCOGS: 7, bankServiceChargeShipping: 3,
    dutiesAndTaxes: 0, shippingCost: 0, localCharges: 0 };
  const STORED = { cogsType: 'international', purchaseOfGoods: 100, deliveryToOffice: 0,
    deliveryToClient: 0, bankChargeCOGS: 7, bankChargeShipping: 3,
    dutiesAndTaxes: 0, shippingCost: 0, localCharges: 0 };
  eq('the import shape still totals 110 (unchanged)', _soCostComputed(IMPORT), 110);
  eq('the STORED shape now totals 110 too (was 100 — both charges scored zero)',
     _soCostComputed(STORED), 110);
  eq('a local order still excludes both charges',
     _soCostComputed(Object.assign({}, STORED, { cogsType: 'local' })), 100);

  /* And the invariant this whole run has protected: nothing above touches how inventory is costed. */
  ok('createReceiving still costs from the actual pesos paid, not from any of this',
     /var paidPHP = _apPaidPHP\(p\.poNo\);/.test(lift('createReceiving')));
  ok('  and still reads no payment request', !/PaymentRequests/.test(lift('createReceiving')));
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
