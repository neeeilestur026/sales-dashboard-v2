/* A225 — ONE PAYMENT REQUEST PER PURCHASE ORDER.
 *
 * The rule the director asked for, and two holes the same trace turned up that are bigger than it.
 *
 * There was no cardinality rule at all. `createPaymentRequest` had eight guards and every one
 * constrained VALUE, never COUNT. A158 allowed several requests per PO deliberately, for
 * deposit-then-balance — but the cap has a gap: a 50% DP sitting at Pending Director does NOT stop a
 * second request for the whole payable, because half the payable genuinely is still open.
 *
 * What this file exists to hold down:
 *
 *   • THE TWO COPIES MUST AGREE, and must agree with the MONEY. `_PR_DEAD_STATUSES` is deliberately
 *     the same pair `_poRemainingPayable` excludes from `openRequests`. If the cardinality rule and
 *     the money rule ever disagreed about what "still standing" means, a PO could be blocked by a
 *     request that reserves nothing, or reserved against by one that does not block — and neither
 *     message would name the other. Checked before anything else, twice: the lists, then the answers;
 *   • THE GUARD'S POSITION IS THE DESIGN, so it is asserted on the source. After the clientRef dedupe
 *     (above it, an honest network retry is refused as a duplicate of itself — the A145 bug), after
 *     the duplicate-AP stop, but BEFORE the money cap and the amount auto-fill;
 *   • THE LIVE BOOK: the two TOOLEC balances stay raisable, at exactly ₱17,073.00 and ₱69,686.00.
 *     That is the assertion the whole reading turns on. `'ever'` would strand ₱86,759, and this file
 *     records that rather than leaving it as folklore;
 *   • PAID AND REJECTED DO NOT BLOCK. Paid is the whole of the live reading. Rejected must not block
 *     in either mode, or one mistaken rejection bars a real order for ever;
 *   • the no-payable hole is closed on BOTH doors — create-only was the exact A219 mistake;
 *   • the role gate reaches Type 'PO' and NOT the travel chain, whose payables are Type 'Other' and
 *     are raised with the traveller's own role.
 *
 * The server half lives in Apps Script, so it is lifted out of FlowAPI.gs and eval'd here — the same
 * technique tests/flow/pay-ownership.js and fx-chain.js use.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const GAS = fs.readFileSync(path.join(ROOT, 'apps-script/FlowAPI.gs'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'dashboard/js/flow-api.js'), 'utf8');
const PRJ = fs.readFileSync(path.join(ROOT, 'dashboard/js/flow-payment-requests.js'), 'utf8');
const PY  = fs.readFileSync(path.join(ROOT, 'blueprints/flow.py'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** Pull one top-level `function name(...) { ... }` out of a source by brace matching. */
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = src.indexOf('{', i);
  let d = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
/** Pull one top-level `var|const NAME = <literal>;` by matching its opening bracket. */
function liftVar(src, name) {
  const m = new RegExp('(?:var|const)\\s+' + name + '\\s*=\\s*([\\[{])').exec(src);
  if (!m) throw new Error('not found: ' + name);
  const open = m[1], close = open === '[' ? ']' : '}';
  const s = src.indexOf(open, m.index);
  let d = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === open) d++;
    // Parenthesised so eval() reads `{...}` as an object literal and not as a block.
    else if (src[k] === close) { d--; if (!d) return '(' + src.slice(s, k + 1) + ')'; }
  }
  throw new Error('unbalanced: ' + name);
}
/** A scalar string constant: `var NAME = 'value';` */
function liftStr(src, name) {
  const m = new RegExp('(?:var|const)\\s+' + name + "\\s*=\\s*'([^']*)'").exec(src);
  if (!m) throw new Error('not found: ' + name);
  return m[1];
}
/* Count the top-level entries of the array literal passed to _append('<Sheet>', [ ... ]).
 *
 * Lifted verbatim from tests/flow/fx-chain.js rather than written afresh, and that matters: a naive
 * comma count reports 46 here, because the value list carries block comments and quoted strings whose
 * commas are not separators. An instrument that over-counts would have raised a false width-trap
 * alarm on a change that never touched the append — which is exactly what it did on first run. */
function countAppend(fnName, sheet) {
  const f = GAS.indexOf('function ' + fnName);
  const a = GAS.indexOf("_append('" + sheet + "', [", f);
  if (a < 0) throw new Error('no _append(' + sheet + ') in ' + fnName);
  const st = GAS.indexOf('[', a);
  let d = 0, en = -1;
  for (let k = st; k < GAS.length; k++) {
    if (GAS[k] === '[') d++;
    else if (GAS[k] === ']') { d--; if (!d) { en = k; break; } }
  }
  const body = GAS.slice(st + 1, en).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
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

// ── the fake sheet, so the real server functions run ──────────────────────────────────────────
let SHEETS = { PaymentRequests: [], APAging: [] };
function _rows(name) { return (SHEETS[name] || []).map((r, i) => Object.assign({ rowIndex: i + 2 }, r)); }
function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// ── the server, verbatim ──────────────────────────────────────────────────────────────────────
let FLOW_PR_PER_PO = liftStr(GAS, 'FLOW_PR_PER_PO');
const _PR_DEAD_STATUSES = eval(liftVar(GAS, '_PR_DEAD_STATUSES'));
const _PR_DEAD_EVER     = eval(liftVar(GAS, '_PR_DEAD_EVER'));
const _PR_PO_CREATE_ROLES = eval(liftVar(GAS, '_PR_PO_CREATE_ROLES'));
eval(lift(GAS, '_poStandingRequests'));
eval(lift(GAS, '_prPerPOProblem'));
eval(lift(GAS, '_prPORoleProblem'));
eval(lift(GAS, '_poRemainingPayable'));

// ── the browser, verbatim ─────────────────────────────────────────────────────────────────────
const FLOW_PR_DEAD_STATUSES = eval(liftVar(API, 'FLOW_PR_DEAD_STATUSES'));
const FLOW_PR_DEAD_EVER     = eval(liftVar(API, 'FLOW_PR_DEAD_EVER'));
const CLIENT_MODE           = liftStr(API, 'FLOW_PR_PER_PO');
eval(lift(API, 'flowPRPerPOProblem').replace(/FLOW_PR_PER_PO/g, 'FLOW_PR_PER_PO'));

const setPRs = (rows) => { SHEETS.PaymentRequests = rows; };
const R = (prNo, poNo, status, amount) => ({ 'PR No': prNo, 'PO No': poNo, 'Status': status, 'Amount': amount || 0 });

console.log('== THE TWO COPIES MUST AGREE, AND AGREE WITH THE MONEY — before anything else ==');
{
  eq('the mode is the same on both sides', CLIENT_MODE, FLOW_PR_PER_PO);
  eq('the live dead-status list is identical', FLOW_PR_DEAD_STATUSES.slice().sort(), _PR_DEAD_STATUSES.slice().sort());
  eq("the 'ever' dead-status list is identical", FLOW_PR_DEAD_EVER.slice().sort(), _PR_DEAD_EVER.slice().sort());

  /* Not the same assertion, and this is the one that matters most: both lists could agree with each
     other and disagree with the cap. _poRemainingPayable is what decides how much a PO still owes; if
     it counts a status the cardinality rule calls finished, a PO can be reserved against by a request
     that does not block it. */
  const remSrc = lift(GAS, '_poRemainingPayable');
  ok("_poRemainingPayable excludes 'Rejected'", /st !== 'Rejected'/.test(remSrc));
  ok("_poRemainingPayable excludes 'Paid'", /st !== 'Paid'/.test(remSrc));
  eq('and _PR_DEAD_STATUSES is exactly that pair', _PR_DEAD_STATUSES.slice().sort(), ['Paid', 'Rejected']);

  // The ANSWERS agree, not merely the inputs.
  const CASES = [
    [], [R('PR-1', 'PO-A', 'Draft', 10)], [R('PR-1', 'PO-A', 'Approved', 10)],
    [R('PR-1', 'PO-A', 'Paid', 10)], [R('PR-1', 'PO-A', 'Rejected', 10)],
    [R('PR-1', 'PO-A', 'Paid', 10), R('PR-2', 'PO-A', 'Pending Director', 5)]
  ];
  CASES.forEach((rows, i) => {
    setPRs(rows);
    const server = _prPerPOProblem('PO-A', '') !== '';
    const client = flowPRPerPOProblem('PO-A', rows.map(r => ({ prNo: r['PR No'], status: r['Status'] }))) !== '';
    ok('  case ' + i + ': both sides agree it is ' + (server ? 'BLOCKED' : 'allowed'), server === client,
       { server: server, client: client });
  });
}

console.log('\n== the guard\'s POSITION is the design — asserted on the source ==');
{
  const fn = lift(GAS, 'createPaymentRequest');
  const iRef  = fn.indexOf("_refSeen('createPaymentRequest'");
  const iDup  = fn.indexOf('apAmountRows > 1');
  const iPer  = fn.indexOf('_prPerPOProblem(');
  const iRole = fn.indexOf('_prPORoleProblem(');
  const iNoAp = fn.indexOf('if (!rem) {');
  const iCap  = fn.indexOf('if (cap && amount >');
  const iAuto = fn.indexOf('if (amount <= 0) amount =');
  ok('the clientRef dedupe runs BEFORE the guard — a retry must not be refused as a duplicate of itself',
     iRef > 0 && iRef < iPer, { iRef: iRef, iPer: iPer });
  ok('the duplicate-AP stop keeps priority', iDup > 0 && iDup < iPer);
  ok('the one-per-PO guard runs BEFORE the money cap', iPer > 0 && iPer < iCap);
  ok('  and before the amount is auto-filled', iPer > 0 && iPer < iAuto);
  ok('the role gate is in the Type PO branch, beside it', iRole > 0 && iRole > iPer && iRole < iCap);
  ok('the no-payable refusal runs before the cap it replaces', iNoAp > 0 && iNoAp < iCap);
  ok('  and it tests `rem`, not `cap`', /if \(!rem\) \{/.test(fn) && !/if \(!cap\) \{/.test(fn));
}

console.log('\n== the rule, mode "live" ==');
{
  setPRs([]);
  eq('no requests at all → allowed', _prPerPOProblem('PO-A', ''), '');

  ['Draft', 'Pending Admin', 'Pending Accounting', 'Pending Management', 'Pending Final',
   'Pending Director', 'Approved'].forEach(st => {
    setPRs([R('PR-1', 'PO-A', st, 100)]);
    const msg = _prPerPOProblem('PO-A', '');
    ok(st.padEnd(19) + ' BLOCKS, and names itself',
       msg !== '' && msg.indexOf('PR-1') !== -1 && msg.indexOf(st) !== -1, msg);
  });

  setPRs([R('PR-1', 'PO-A', 'Paid', 100)]);
  eq('Paid does NOT block — the whole of the live reading', _prPerPOProblem('PO-A', ''), '');
  setPRs([R('PR-1', 'PO-A', 'Rejected', 100)]);
  eq('Rejected does NOT block', _prPerPOProblem('PO-A', ''), '');
  setPRs([R('PR-1', 'PO-A', 'Paid', 100), R('PR-2', 'PO-A', 'Rejected', 50)]);
  eq('Paid + Rejected → still allowed', _prPerPOProblem('PO-A', ''), '');

  setPRs([R('PR-1', 'PO-A', 'Paid', 100), R('PR-2', 'PO-A', 'Draft', 50)]);
  {
    const msg = _prPerPOProblem('PO-A', '');
    ok('Paid + Draft blocks, and names the DRAFT not the Paid',
       msg.indexOf('PR-2') !== -1 && msg.indexOf('PR-1') === -1, msg);
  }

  setPRs([R('PR-1', 'PO-A', 'Draft', 10), R('PR-2', 'PO-A', 'Approved', 20)]);
  {
    const msg = _prPerPOProblem('PO-A', '');
    ok('two live requests → both are named', msg.indexOf('PR-1') !== -1 && msg.indexOf('PR-2') !== -1, msg);
  }

  setPRs([R('PR-1', 'PO-A', 'Draft', 10)]);
  eq('excludePrNo removes exactly one', _prPerPOProblem('PO-A', 'PR-1'), '');
  setPRs([R('PR-1', 'PO-B', 'Draft', 10)]);
  eq('a request on a DIFFERENT PO does not block', _prPerPOProblem('PO-A', ''), '');

  setPRs([R('PR-1', '  PO-A  ', 'Draft', 10)]);
  ok('PO matching is trimmed, mirroring _poRemainingPayable', _prPerPOProblem('PO-A', '') !== '');
  setPRs([R('PR-1', 'PO-A', '', 10)]);
  ok('a blank status is a Draft, and blocks', _prPerPOProblem('PO-A', '') !== '');

  setPRs([R('PR-1', 'PO-A', 'Approved', 10)]);
  ok('the refusal names all three remedies',
     /reject it/.test(_prPerPOProblem('PO-A', '')) && /Revise/.test(_prPerPOProblem('PO-A', '')) &&
     /delete it/.test(_prPerPOProblem('PO-A', '')));
}

console.log('\n== THE LIVE BOOK: the two TOOLEC balances stay raisable ==');
{
  /* From tests/flow/baseline/A221-before.txt — 2026-41 payable ₱34,146 with PRF-2026-69 Paid at
     ₱17,073, and 2026-42 payable ₱139,372 with PRF-2026-70 Paid at ₱69,686. This is the assertion
     the whole reading turns on: choose 'ever' and this money can never be raised again. */
  SHEETS.APAging = [
    { 'PO No': '2026-41 TOOLEC', 'Amount (PHP)': 34146, 'Paid (PHP)': 17073 },
    { 'PO No': '2026-42 TOOLEC', 'Amount (PHP)': 139372, 'Paid (PHP)': 69686 }
  ];
  setPRs([
    R('PRF-2026-69 TOOLEC', '2026-41 TOOLEC', 'Paid', 17073),
    R('PRF-2026-70 TOOLEC', '2026-42 TOOLEC', 'Paid', 69686)
  ]);
  eq('the 2026-41 balance can still be raised', _prPerPOProblem('2026-41 TOOLEC', ''), '');
  eq('the 2026-42 balance can still be raised', _prPerPOProblem('2026-42 TOOLEC', ''), '');

  /* And the guard must not have disturbed the money answer. */
  eq('  and it is still exactly 17,073.00', _poRemainingPayable('2026-41 TOOLEC', '').remaining, 17073);
  eq('  and exactly 69,686.00',             _poRemainingPayable('2026-42 TOOLEC', '').remaining, 69686);

  /* The other live requests, each the only one on its PO and none of them Paid. */
  const LIVE = [
    ['PRF-2026-73 CEJN', '2026-45 CEJN', 'Approved'],
    ['PRF-2026-71 CO BAN KIAT', '2026-43 CO BAN KIAT', 'Pending Director'],
    ['PRF-2026-66 RS Components', '2026-40 RS Components Corporation', 'Approved'],
    ['PRF-2026-62 AOLAI RESCUE', 'PO-202607-001', 'Draft']
  ];
  LIVE.forEach(([pr, po, st]) => {
    setPRs([R(pr, po, st, 1)]);
    const msg = _prPerPOProblem(po, '');
    ok(po + ' is refused, naming ' + pr + ' (' + st + ')',
       msg.indexOf(pr) !== -1 && msg.indexOf(st) !== -1, msg);
  });

  /* THE CASE THAT SLIPS THROUGH TODAY, and the point of the whole change: a 50% DP still awaiting the
     director does not trip the money cap, because half the payable genuinely is still open. */
  SHEETS.APAging = [{ 'PO No': 'PO-DP', 'Amount (PHP)': 100000, 'Paid (PHP)': 0 }];
  setPRs([R('PR-DP', 'PO-DP', 'Pending Director', 50000)]);
  eq('the money cap alone would still allow 50,000 more',
     _poRemainingPayable('PO-DP', '').remaining, 50000);
  ok('  but the cardinality guard refuses it, by name', _prPerPOProblem('PO-DP', '').indexOf('PR-DP') !== -1);
}

console.log('\n== mode "ever" — implemented, not shipped, and its cost on the record ==');
{
  const SHIPPED = FLOW_PR_PER_PO;
  FLOW_PR_PER_PO = 'ever';

  setPRs([R('PR-1', 'PO-A', 'Paid', 100)]);
  ok('Paid BLOCKS under ever — the only difference', _prPerPOProblem('PO-A', '') !== '');
  setPRs([R('PR-1', 'PO-A', 'Rejected', 100)]);
  eq('Rejected still does NOT block, in either mode', _prPerPOProblem('PO-A', ''), '');

  setPRs([
    R('PRF-2026-69 TOOLEC', '2026-41 TOOLEC', 'Paid', 17073),
    R('PRF-2026-70 TOOLEC', '2026-42 TOOLEC', 'Paid', 69686)
  ]);
  ok("'ever' would strand the 2026-41 balance", _prPerPOProblem('2026-41 TOOLEC', '') !== '');
  ok("'ever' would strand the 2026-42 balance", _prPerPOProblem('2026-42 TOOLEC', '') !== '');
  eq('  which is this much real money the system could no longer raise', 17073 + 69686, 86759);

  FLOW_PR_PER_PO = SHIPPED;
  eq('and the shipped mode is restored', FLOW_PR_PER_PO, 'live');
  /* If 'ever' is ever shipped, two of the three portion buttons become controls the server refuses. */
  const PORTIONS = eval(liftVar(GAS, '_PR_PORTIONS'));
  ok("while 'live' ships, the portion buttons still make sense",
     FLOW_PR_PER_PO === 'live' && PORTIONS.indexOf('50% DP') !== -1 && PORTIONS.indexOf('Balance') !== -1);
}

console.log('\n== the no-payable hole is closed on BOTH doors ==');
{
  SHEETS.APAging = [];
  eq('_poRemainingPayable returns null for a PO with no AP row', _poRemainingPayable('PO-NO-AP', ''), null);
  const cre = lift(GAS, 'createPaymentRequest'), upd = lift(GAS, 'updatePaymentRequest');
  ok('createPaymentRequest refuses on !rem', /if \(!rem\) \{/.test(cre));
  ok('  and names AP Aging', /no payable on AP Aging/.test(cre));
  ok('updatePaymentRequest refuses too — create-only was the A219 mistake', /if \(!rem\) \{/.test(upd));
  ok('  and names AP Aging as well', /no payable on AP Aging/.test(upd));
}

console.log('\n== the PO cannot be re-pointed by an edit ==');
{
  const upd = lift(GAS, 'updatePaymentRequest');
  ok("updatePaymentRequest still never writes 'PO No'", !/'PO No':/.test(upd));
  ok('and it refuses a payload that names a different one', /cannot be moved to a different purchase order/.test(upd));
  ok('revisePaymentRequest writes no PO No either', !/'PO No'/.test(lift(GAS, 'revisePaymentRequest')));
}

console.log('\n== the role gate, the travel chain, and the three secured lists ==');
{
  eq('only admin and accounting may raise a PO request', _PR_PO_CREATE_ROLES.slice().sort(), ['accounting', 'admin']);
  ['admin', 'accounting'].forEach(r => eq(r + ' is accepted', _prPORoleProblem(r), ''));
  ['director', 'management', 'sales', 'hr', '', null, undefined, 'ADMIN '].forEach(r => {
    const msg = _prPORoleProblem(r);
    if (String(r || '').trim().toLowerCase() === 'admin') { eq(JSON.stringify(r) + ' is accepted (trimmed/cased)', msg, ''); return; }
    ok(JSON.stringify(r) + ' is refused', msg !== '');
  });
  ok('a blank role says so rather than printing nothing', /no role/.test(_prPORoleProblem('')));

  // The travel chain must not be reached — its payables are Type 'Other'.
  ok("_travMintPayable raises Type 'Other'", /type: 'Other'/.test(lift(GAS, '_travMintPayable')));
  ok("requestTravelFloatCash raises Type 'Other'", /type: 'Other'/.test(lift(GAS, 'requestTravelFloatCash')));
  ok('the role gate sits inside the Type PO branch only',
     lift(GAS, 'createPaymentRequest').indexOf('_prPORoleProblem') >
     lift(GAS, 'createPaymentRequest').indexOf("if (type === 'PO')"));

  // All three secured lists move together, or the POST goes direct and is rejected.
  ['createPaymentRequest', 'updatePaymentRequest'].forEach(a => {
    ok(a + ' is secured in FlowAPI.gs', new RegExp(a + ': 1').test(GAS));
    ok('  and in blueprints/flow.py', new RegExp('"' + a + '"').test(PY));
    ok('  and in dashboard/js/flow-api.js', new RegExp("'" + a + "'").test(API));
  });
}

console.log('\n== the width trap did not move ==');
{
  /* No schema change here — but inserting a guard above an _append is exactly how one gets disturbed. */
  const SCHEMA = (function () {
    const i = GAS.indexOf('var SCHEMA');
    const s = GAS.indexOf('{', i);
    let d = 0;
    for (let k = s; k < GAS.length; k++) {
      if (GAS[k] === '{') d++;
      else if (GAS[k] === '}') { d--; if (!d) return eval('(' + GAS.slice(s, k + 1) + ')'); }
    }
  })();
  eq('PaymentRequests is still 41 wide', SCHEMA.PaymentRequests.length, 41);
  eq('and createPaymentRequest still appends exactly that many',
     countAppend('createPaymentRequest', 'PaymentRequests'), 41);
}

console.log('\n== the client re-enables the gate on the edit path ==');
{
  /* The dead-Save-button glitch: prEdit sets loadPO.value directly and deliberately never calls
     loadFromPO, so the gate has to run there too — and must return early for an edit. */
  ok('prSyncCreateGate exists', /function prSyncCreateGate\(\)/.test(PRJ));
  ok('  and returns early when a record is being edited', /!editing && poNo && prPerPOGateLive/.test(PRJ));
  const gateCalls = (PRJ.match(/prSyncCreateGate\(\)/g) || []).length;
  ok('  and is called from init, loadFromPO, resetForm AND prEdit (4 call sites + its definition)',
     gateCalls >= 5, gateCalls);
  ok('prEdit calls it', /prRefreshBreakdown\(r\.poNo, r\.prNo\);[\s\S]{0,600}prSyncCreateGate\(\)/.test(PRJ));
  ok('resetForm calls it', /prMethodTouched = false;[\s\S]{0,200}prSyncCreateGate\(\)/.test(PRJ));
  ok('the version gate is on v129', /flowVersionAtLeast\(129\)/.test(PRJ));
  ok('the dropdown ANNOTATES rather than disabling a blocked PO', !/<option[^>]*disabled/.test(PRJ));
  ok('savePR mirrors the refusal on the create path', /const perPO = prPerPOBlocked\(poNo, editing\)/.test(PRJ));
  ok('prOpenReqRows now carries status', /prOpenReqRows\.push\(\{ poNo: [^}]*status: st/.test(PRJ));
}

console.log('\n== rubbish does not throw ==');
{
  setPRs([R('PR-1', 'PO-A', 'Draft', 10)]);
  [['', ''], [null, ''], [undefined, ''], [0, ''], [123, '']].forEach(([po, ex]) => {
    let threw = false;
    try { _prPerPOProblem(po, ex); } catch (e) { threw = true; }
    ok('poNo ' + JSON.stringify(po) + ' does not throw', !threw);
  });
  setPRs([{ 'PO No': 'PO-A' }]);                       // no PR No, no Status, no Amount
  let threw = false;
  try { _prPerPOProblem('PO-A', ''); } catch (e) { threw = true; }
  ok('a row with no PR No and no Status does not throw', !threw);
  setPRs([]);
  eq('an empty sheet is simply allowed', _prPerPOProblem('PO-A', ''), '');
}

console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall ok');
process.exit(fail ? 1 : 0);
