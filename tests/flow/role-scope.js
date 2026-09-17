/* A280 — WHO SEES EVERYONE'S RECORDS, AND WHO SEES ONLY THEIR OWN.
 *
 * Run:  node tests/flow/role-scope.js
 *
 * Quotations, purchase requests, the board, the tracker, the client tracker and the quote
 * configurator each used to carry their own copy of the test, spelled `role !== 'sales'`. Three of
 * them already carried a comment warning that the copies would drift and the most permissive one
 * would quietly become the policy.
 *
 * THE SPELLING WAS THE HAZARD, NOT THE DUPLICATION. `!== 'sales'` has a DEFAULT, and the default is
 * oversight: a role nobody considered gets handed every rep's book. Adding 'leadgen' to the two
 * guards would have done exactly that, silently, on six pages. So the list is now the OVERSIGHT
 * list, enumerated positively, and own-scope is its negation — the default flipped to the safe side.
 *
 * Section 1 pins that direction by name. Section 2 proves it on the page where a wrong branch did
 * not merely leak but broke: flow-pricing-request's bare `else` was the MANAGEMENT branch, so an
 * unclassified role got the pricing engine and no create form.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

/* ── 1 · the predicate ─────────────────────────────────────────────────────────────────────── */
sec('1 · who owns their records, who sees everyone\'s');
const AUTH = fs.readFileSync(path.join(D, 'js/auth.js'), 'utf8');
const ctx = { console, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: '' }, setTimeout: () => 0, setInterval: () => 0, fetch: () => Promise.reject(new Error('no network')) };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(AUTH, ctx);

['sales', 'leadgen'].forEach(r => ok(r.padEnd(12) + '→ own scope', ctx.flowOwnsRecordsOnly(r) === true && ctx.flowIsOversightRole(r) === false));
['admin', 'accounting', 'management', 'director'].forEach(r => ok(r.padEnd(12) + '→ oversight', ctx.flowIsOversightRole(r) === true && ctx.flowOwnsRecordsOnly(r) === false));

ok('a session object works as well as a role string', ctx.flowIsOversightRole({ role: 'admin' }) === true && ctx.flowOwnsRecordsOnly({ role: 'sales' }) === true);
ok('case and stray space do not change the answer',
   ctx.flowIsOversightRole('  ADMIN ') === true && ctx.flowOwnsRecordsOnly(' Sales ') === true && ctx.flowOwnsRecordsOnly('LEADGEN') === true);
ok('empty, null and undefined are own-scope', ['', null, undefined].every(x => ctx.flowOwnsRecordsOnly(x) === true));

/* THE BET. The whole change rests on this direction, so it is asserted by name rather than implied. */
ok('A ROLE NOBODY HAS CLASSIFIED IS OWN-SCOPE, NEVER OVERSIGHT — the safe default, and the reason ' +
   'FLOW_OVERSIGHT_ROLES is the positive list',
   ctx.flowOwnsRecordsOnly('some-role-invented-in-2027') === true);

sec('1b · the two lists, read from source');
const oversight = JSON.parse(AUTH.match(/const FLOW_OVERSIGHT_ROLES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
const ownScope = JSON.parse(AUTH.match(/const FLOW_OWN_SCOPE_ROLES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
ok('they are disjoint', !oversight.some(r => ownScope.indexOf(r) !== -1), { oversight, ownScope });
/* Every role _homeForRole knows must be classified, or somebody added a role and stopped halfway.
   hr and marketing are own-scope by default and have no page behind these guards — that is fine and
   is what the union test is checking: they are ACCOUNTED FOR, not that they are in a list. */
const homeRoles = (AUTH.match(/function _homeForRole[\s\S]*?\n}/)[0].match(/role === '([a-z]+)'/g) || [])
  .map(m => m.replace(/role === '|'/g, ''));
ok('_homeForRole knows at least the seven roles', homeRoles.length >= 7, homeRoles);
const unclassified = homeRoles.filter(r => oversight.indexOf(r) === -1 && ownScope.indexOf(r) === -1);
ok('every role _homeForRole knows is either oversight or own-scope by default — and the ones not ' +
   'named in either list (' + unclassified.join(', ') + ') fall to own-scope, which is the safe side',
   unclassified.every(r => ctx.flowOwnsRecordsOnly(r) === true), unclassified);

/* ── 2 · the pricing-request page, per role ───────────────────────────────────────────────── */
async function main() {
  sec('2 · a lead-gen user lands on the REQUESTER branch of flow-pricing-request');
  {
    const p = page(['js/flow-pricing-engine.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html',
                   { name: 'Ana Reyes', role: 'leadgen' }, { withAuth: true });
    await p.boot();
    eq('the create form is shown', p.els.salesFormCard.style.display, '');
    eq('the list is titled My Requests', p.els.listTitle.textContent, 'My Requests');
    ok('the MANAGEMENT pricing engine stays hidden', p.els.mgmtEngineCard.style.display === 'none', p.els.mgmtEngineCard.style.display);
    ok('  and its pricing history', p.els.pricingHistoryCard.style.display === 'none');
    ok('the saved supplier-quotation summary stays hidden', p.els.sqSummaryCard.style.display === 'none');
    ok('the admin numbering-maintenance button stays hidden', p.els.resyncBtn.style.display === 'none');
    /* The one that matters: the page asked for THIS person's requests, not everybody's. */
    const prm = p.paramsFor('getPricingRequests');
    ok('getPricingRequests was scoped to their own name', prm && prm.requestedBy === 'Ana Reyes', prm);
  }

  sec('2b · management still gets its own branch — the reorder broke nothing');
  {
    const p = page(['js/flow-pricing-engine.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html',
                   { name: 'Mgmt User', role: 'management' }, { withAuth: true });
    await p.boot();
    eq('the list is the Pricing Queue', p.els.listTitle.textContent, 'Pricing Queue');
    ok('the pricing engine IS revealed', p.els.mgmtEngineCard.style.display === '');
    ok('the create form stays hidden', p.els.salesFormCard.style.display === 'none');
    const prm = p.paramsFor('getPricingRequests');
    ok('and it reads every rep\'s requests, unscoped', prm && prm.requestedBy === undefined, prm);
  }

  sec('2c · a sales rep is unchanged');
  {
    const p = page(['js/flow-pricing-engine.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html',
                   { name: 'Gerald C.', role: 'sales' }, { withAuth: true });
    await p.boot();
    eq('the create form is shown', p.els.salesFormCard.style.display, '');
    eq('My Requests', p.els.listTitle.textContent, 'My Requests');
    const prm = p.paramsFor('getPricingRequests');
    ok('scoped to their own name', prm && prm.requestedBy === 'Gerald C.', prm);
  }

  sec('3 · the purchase-order book is not a lead-gen surface');
  {
    /* requireQuotationAccess now admits leadgen, and this page rides that guard. Its bounce used to
       be spelled `role === 'sales'`, so widening the guard alone would have put a lead-gen user on a
       page listing every PO with its supplier, currency and FC cost.
       "It redirected" is only true if NOTHING loaded — which is what the call list is for. */
    const p = page(['js/flow-purchase-orders.js'], 'flow-purchase-orders.html',
                   { name: 'Ana Reyes', role: 'leadgen' }, { withAuth: true });
    await p.boot();
    eq('it bounced to the lead-gen home', p.ctx.location.href, 'leadgen-home.html');
    ok('and fetched NOTHING on the way out', p.calls.length === 0, p.calls);
  }
  {
    const p = page(['js/flow-purchase-orders.js'], 'flow-purchase-orders.html',
                   { name: 'Gerald C.', role: 'sales' }, { withAuth: true });
    await p.boot();
    ok('a sales rep is still bounced too', p.calls.length === 0, p.calls);
  }
  {
    const p = page(['js/flow-purchase-orders.js'], 'flow-purchase-orders.html',
                   { name: 'Acct User', role: 'accounting' }, { withAuth: true });
    await p.boot();
    ok('accounting still gets the page', p.calls.indexOf('getPurchaseOrders') !== -1, p.calls);
  }

  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
main();
