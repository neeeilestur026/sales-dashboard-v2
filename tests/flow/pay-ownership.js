/* A224 — WHO MAY RELEASE MONEY. Run this before anything else in A224.
 *
 * The rule the company actually runs on:
 *
 *     telegraphic transfer  →  ACCOUNTING or ADMIN     (the international wires)
 *     everything else       →  THE DIRECTOR            (bank transfer, online, cheque, cash)
 *
 * A158 had it inverted — director = bank transfer | online, everybody else = accounting — which put
 * cheque and cash with accounting and gave admin no release rights at all.
 *
 * What this file exists to hold down:
 *
 *   • THE TWO COPIES MUST AGREE, first and before anything else. The server decides whether a payment
 *     is ACCEPTED; the browser decides whether the button is DRAWN. They are separate code in separate
 *     languages, and a divergence is not cosmetic — it either shows a button that is refused (the user
 *     concludes the system is broken) or hides one from the person whose job it is (the payment gets
 *     made outside the system, which is the entire A221 story);
 *   • the matrix is asserted PER METHOD AND PER ROLE, not as "the lists match". Two lists can agree
 *     with each other and both be wrong;
 *   • sales and management are refused everywhere. Neither has ever released a payment and neither
 *     should start by accident;
 *   • an UNKNOWN or BLANK method is refused for everyone. markPaymentRequestPaid rejects it earlier
 *     with a clearer message, but the owner function must not be the thing that lets it through — a
 *     default of "accounting" is exactly what A158 did and how a blank method became releasable;
 *   • the four live methods on the live sheet still route to somebody. A rule nobody can satisfy is
 *     a different kind of broken.
 *
 * The server half lives in Apps Script, so it is lifted out of FlowAPI.gs and eval'd here — the same
 * technique tests/flow/ship-kind.js and ap-payable.js use.
 */
const fs = require('fs');
const path = require('path');

const GAS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const API = fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/flow-api.js'), 'utf8');
const ACT = fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/flow-pr-actions.js'), 'utf8');

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

// ── the server, verbatim ──────────────────────────────────────────────────────────────────────
const _PR_ACCOUNTING_PAY_METHODS = eval(liftVar(GAS, '_PR_ACCOUNTING_PAY_METHODS'));
const _PR_KNOWN_METHODS = eval(liftVar(GAS, '_PR_KNOWN_METHODS'));
eval(lift(GAS, '_prPayOwner'));
eval(lift(GAS, '_prPayOwnerLabel'));
const srvOwner = _prPayOwner, srvLabel = _prPayOwnerLabel;

// ── the browser, verbatim ─────────────────────────────────────────────────────────────────────
const FLOW_ACCOUNTING_PAY_METHODS = eval(liftVar(API, 'FLOW_ACCOUNTING_PAY_METHODS'));
eval(lift(API, 'flowPayOwner'));
eval(lift(API, 'flowPayOwns'));
eval(lift(API, 'flowPayOwnerLabel'));

// ── the button, verbatim (it delegates, but the FALLBACK branch is live code too) ─────────────
eval(lift(ACT, 'prPayOwns'));
eval(lift(ACT, 'prPayOwnerLabel'));

const ROLES = ['director', 'accounting', 'admin', 'management', 'sales'];

console.log('== THE TWO COPIES MUST AGREE — checked before anything else ==');
{
  eq('the accounting-owned method list is identical',
     FLOW_ACCOUNTING_PAY_METHODS.slice().sort(), _PR_ACCOUNTING_PAY_METHODS.slice().sort());
  /* Not the same assertion: both lists could name a method the form never offers, which would
     silently route nothing. Every accounting-owned method must be a real, selectable method. */
  _PR_ACCOUNTING_PAY_METHODS.forEach(m =>
    ok('  "' + m + '" is a method the form actually offers', _PR_KNOWN_METHODS.indexOf(m) !== -1, m));

  // And the answers must agree method by method, not merely the inputs.
  _PR_KNOWN_METHODS.concat(['', '   ', 'Telegraphic Transfer', 'BANK TRANSFER', 'wire', null])
    .forEach(m => eq('  same owner for ' + JSON.stringify(m),
                     flowPayOwner(m).slice().sort(), srvOwner(m).slice().sort()));
}

console.log('\n== the matrix, per method and per role ==');
{
  /* The whole rule in one table. Read it as: this role, this method, may they release it? */
  const WANT = {
    'telegraphic transfer': ['accounting', 'admin'],
    'bank transfer':        ['director'],
    'online':               ['director'],
    'cheque':               ['director'],
    'cash':                 ['director']
  };
  Object.keys(WANT).forEach(m => {
    ROLES.forEach(role => {
      const want = WANT[m].indexOf(role) !== -1;
      const server = srvOwner(m).indexOf(role) !== -1;
      const client = flowPayOwns(m, role);
      const button = prPayOwns(m, role);          // the fallback branch, which runs when flow-api.js
                                                  // has not loaded — it must not be more permissive
      ok(`${role.padEnd(11)} ${want ? 'MAY    ' : 'may NOT'} release a ${m}`,
         server === want && client === want && button === want,
         { server: server, client: client, button: button, want: want });
    });
  });
}

console.log('\n== sales and management release nothing, ever ==');
{
  _PR_KNOWN_METHODS.forEach(m => {
    ok('sales cannot release a ' + m, !flowPayOwns(m, 'sales') && srvOwner(m).indexOf('sales') === -1);
    ok('management cannot release a ' + m, !flowPayOwns(m, 'management') && srvOwner(m).indexOf('management') === -1);
  });
}

console.log('\n== a blank or unknown method belongs to nobody it should not ==');
{
  /* markPaymentRequestPaid refuses a blank/unknown method BEFORE it asks who owns it, with a clearer
     message. This asserts the owner function is not the thing that would have let it through: under
     A158 an unrecognised method silently defaulted to accounting-owned. Under A224 it falls to the
     director — the most restricted single role — so the worst case of a future typo'd method is a
     payment that only the director can release, never one that accounting can. */
  ['', '   ', null, undefined, 'wire', 'gcash', 'crypto'].forEach(m => {
    eq('unknown ' + JSON.stringify(m) + ' → director only', srvOwner(m), ['director']);
    ok('  and accounting cannot release it', !flowPayOwns(m, 'accounting'));
    ok('  and admin cannot release it', !flowPayOwns(m, 'admin'));
  });
}

console.log('\n== case and whitespace do not change who owns a payment ==');
{
  /* The method is stored as free text on the sheet, typed by whoever raised the request. */
  ['Telegraphic Transfer', 'TELEGRAPHIC TRANSFER', '  telegraphic transfer  ', 'Telegraphic transfer']
    .forEach(m => eq(JSON.stringify(m), srvOwner(m).slice().sort(), ['accounting', 'admin']));
  ['Bank Transfer', 'BANK TRANSFER', ' Cheque ', 'Cash', 'Online']
    .forEach(m => eq(JSON.stringify(m), srvOwner(m), ['director']));
}

console.log('\n== every method the form offers routes to somebody ==');
{
  /* A rule nobody can satisfy is a different kind of broken: the request would sit at Approved for
     ever and the payment would be made outside the system. */
  _PR_KNOWN_METHODS.forEach(m => {
    const owners = srvOwner(m);
    ok(m + ' has at least one owner', owners.length >= 1, owners);
    owners.forEach(o => ok('  ' + o + ' is a real role', ROLES.indexOf(o) !== -1, o));
  });
}

console.log('\n== the live book: every method in use is releasable ==');
{
  /* From tests/flow/baseline/A221-before.txt — the four methods actually on the live sheet. The rule
     was measured against these before it was written, so this is a regression check, not a hope. */
  const LIVE = ['telegraphic transfer', 'bank transfer', 'online', 'cash'];
  LIVE.forEach(m => ok('a live ' + m + ' is releasable by ' + srvLabel(m), srvOwner(m).length >= 1));
  eq('the international wires go to accounting or admin',
     srvOwner('telegraphic transfer').slice().sort(), ['accounting', 'admin']);
  eq('every local method goes to the director',
     ['bank transfer', 'online', 'cash', 'cheque'].map(m => srvOwner(m).join('|')),
     ['director', 'director', 'director', 'director']);
}

console.log('\n== the refusal message reads like English ==');
{
  /* This string is what someone sees when the system will not let them pay, so it is the whole
     explanation they get. "accounting, admin" would be a leaked array. */
  eq('telegraphic transfer', srvLabel('telegraphic transfer'), 'accounting or admin');
  eq('bank transfer', srvLabel('bank transfer'), 'the director');
  eq('the browser says the same thing', flowPayOwnerLabel('telegraphic transfer'), srvLabel('telegraphic transfer'));
  eq('  and for the director too', flowPayOwnerLabel('cheque'), srvLabel('cheque'));
  eq('the button fallback says it too', prPayOwnerLabel('telegraphic transfer'), 'accounting or admin');
}

console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall ok');
process.exit(fail ? 1 : 0);
