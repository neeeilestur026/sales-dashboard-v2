/* A209/A211/A212 — WHO can reach commissions, asserted on both halves at once.
 *
 * The roster is READ, never hard-coded: this file tests the MECHANISM (whoever is on the list reaches
 * their handlers, whoever is not gets the same refusal), so it survives the roster legitimately
 * changing. The roster VALUE is asserted once, on its own line, so a change is still deliberate.
 *
 * The invariant that actually matters is the last one: the backend list and the browser list AGREE.
 * Either alone leaves the feature closed, which is safe — but a MISMATCH is the state where the menu
 * says one thing and the server does another.
 */
const { load, call } = require('./gasload');
const { page, commissionRoster } = require('./pageload');
const vm = require('vm');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const store = () => ({ Quotations: [], QuotationItems: [], QuotationEmails: [], FlowSettings: [], MailIndex: [],
  SalesOrders: [], SalesOrderItems: [], Invoices: [], ARAging: [], Collections: [],
  CommissionRequests: [], CommissionRequestItems: [], CommissionRates: [],
  Documents: [], ActivityLog: [], Clients: [], Inventory: [], Journal: [] });

const ALL = ['director', 'management', 'sales', 'admin', 'accounting', 'hr', 'marketing'];
const ARGS = { quotationNo: 'X', commNo: 'X', salesperson: 'Y', rateKey: 'R', actorName: 'D' };

async function main() {
console.log('== the roster, and the two halves agreeing ==');
const c = load(null, store());
const ACTS = Object.keys(c._COMM_ACTIONS);
eq('_COMM_ROLES (A212: held closed again)', c._COMM_ROLES, []);
eq('and the browser half agrees', commissionRoster(), c._COMM_ROLES);
const OPEN = c._COMM_ROLES.slice();
const HELD = ALL.filter(r => OPEN.indexOf(r) < 0);

console.log('\n== the backend gate, for all seven roles ==');
const wrote = {};
ALL.forEach(role => {
  const before = c.__store.ActivityLog.length;
  let refused = 0, reached = 0, odd = [];
  ACTS.forEach(a => {
    const r = call(c, a, Object.assign({}, ARGS, { actorRole: role }));
    if (r.comingSoon === true && r.success === false && /not available yet/.test(r.message || '')) refused++;
    else if (!r.comingSoon) reached++;
    else odd.push([a, r]);
  });
  wrote[role] = c.__store.ActivityLog.length - before;
  eq(role + ': [refused, reached handler]', [refused, reached],
     OPEN.indexOf(role) !== -1 ? [0, ACTS.length] : [ACTS.length, 0]);
  if (odd.length) { fail++; console.log('   odd:', JSON.stringify(odd, null, 1)); }
});
console.log('     the refusal:', call(c, 'getCommissionRequests', { actorRole: 'sales' }).message);
eq('no actorRole at all is not open', call(c, 'getCommissionRequests', {}).comingSoon, true);
eq('nonsense role is not open', call(c, 'getCommissionRequests', { actorRole: 'ceo' }).comingSoon, true);

/* Measured by DELTA, not by reading a role column off the log — the harness leaves that blank, so a
   filter on it would pass without testing anything. */
console.log('\n== nothing was written by a role that was refused ==');
eq('audit rows per role', ALL.map(r => [r, wrote[r]]),
   ALL.map(r => [r, OPEN.indexOf(r) !== -1 ? wrote[r] : 0]));
eq('commission rows created', c.__store.CommissionRequests.length, 0);
eq('rate rows created', c.__store.CommissionRates.length, 0);

console.log('\n== everything else is untouched by the block ==');
['getQuotations', 'getSalesOrders', 'getQuotationEmails', 'getFlowSettings', 'getClients', 'getVersion',
 'getInvoices', 'getCollections', 'getARAging', 'getPaymentRequests', 'getWeeklyItineraries']
  .forEach(a => { const r = call(c, a, {}); ok(a + ' still works', r.success === true && !r.comingSoon, r); });
eq('an unknown action is still unknown, not coming-soon',
   /Unknown action/.test(call(c, 'notARealAction', {}).message || ''), true);
ok('setMgmtPricing (unrelated, similar name) is not caught', !call(c, 'setMgmtPricing', {}).comingSoon);

console.log('\n== the gate is reversible in BOTH directions ==');
{
  const w = load(null, store());
  w._COMM_ROLES = ['director', 'management', 'sales'];        // the launch edit
  const held = ACTS.filter(a => call(w, a, Object.assign({}, ARGS,
    { actorRole: 'sales', rate: '3', settings: '{}', collectionNos: '[]' })).comingSoon);
  eq('adding sales opens all ' + ACTS.length + ' for them', held, []);
  eq('and a getter returns real data, not a stub',
     [call(w, 'getCommissionRates', { actorRole: 'sales' }).success,
      Array.isArray(call(w, 'getCommissionRates', { actorRole: 'sales' }).data)], [true, true]);
}

console.log('\n== the browser half: every held role sees nothing run and nothing show ==');
const sess = role => ({ name: 'Test ' + role, role: role, username: role[0], token: 'x' });
for (const role of HELD) {
  const p = page(['js/flow-commissions.js'], 'flow-commissions.html', sess(role));
  await p.boot();
  eq(role + ': no backend call at all', p.calls, []);
  eq(role + ': every card hidden',
     ['cmKpis', 'claimCard', 'cmListCard', 'gateCard', 'cmDemoCard'].map(id => p.els[id].style.display),
     ['none', 'none', 'none', 'none', 'none']);
  ok(role + ': coming-soon panel shown',
     p.els.cmComingSoon.style.display === '' && /coming soon/i.test(p.els.cmComingSoon.innerHTML));
  ok(role + ': the misleading "backend still has to be updated" never renders',
     !/backend still has to be updated/i.test(p.els.cmComingSoon.innerHTML));
}
for (const role of OPEN) {
  const p = page(['js/flow-commissions.js'], 'flow-commissions.html', sess(role));
  await p.boot();
  ok(role + ': the page actually loads its data', p.calls.length > 0, p.calls);
  eq(role + ': and its reads go through the SECURED post path',
     p.calls.filter(a => /Commission/.test(a)).every(a => a.indexOf('POST:') === 0), true);
}

console.log('\n== the role-blind flow-nav pill still answers per role ==');
{
  /* A bare context loading ONLY flow-api.js. pageload stubs renderFlowNav away so the pages under
     test cannot paint a nav strip, and reusing that stub here would assert nothing at all. */
  const fs3 = require('fs'), path3 = require('path');
  const D3 = path3.join(__dirname, '..', '..', 'dashboard') + '/';
  const navFor = (s) => {
    const el = { innerHTML: '' };
    const nc = { console, window: null,
      document: { getElementById: (id) => (id === 'flowNav' ? el : null) },
      localStorage: { getItem: () => (s ? JSON.stringify(s) : null) },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      fetch: () => Promise.reject(new Error('no network')) };
    nc.window = nc; vm.createContext(nc);
    vm.runInContext(fs3.readFileSync(D3 + 'js/flow-api.js', 'utf8'), nc);
    vm.runInContext('renderFlowNav("flow-quotations.html")', nc);
    return el.innerHTML;
  };
  ALL.forEach(role => {
    const h = navFor(sess(role));
    eq(role + ': SOON tags on the pill', (h.match(/SOON/g) || []).length, OPEN.indexOf(role) !== -1 ? 0 : 1);
    ok(role + ': the Commissions pill is still present', h.indexOf('>Commissions') >= 0, h.slice(0,80));
  });
  eq('no session at all -> held, not opened', (navFor(null).match(/SOON/g) || []).length, 1);
}

console.log('\n== the role navbars: the entry stays, the SOON tag follows the role ==');
{
  const fs2 = require('fs'), path2 = require('path');
  const D2 = path2.join(__dirname, '..', '..', 'dashboard') + '/';
  const labels = { sales: 'Commission Requests', director: 'Commissions for Payroll', management: 'Sales Commissions' };
  const p = page([], 'flow-commissions.html', sess('sales'));
  /* renderNavbar walks the strip it just wrote to mark the active link, so the stub element needs a
     queryable shape as well as an innerHTML. */
  const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null,
               classList: { add() {}, remove() {} }, addEventListener: () => {} };
  p.ctx.document.getElementById = () => el;
  vm.runInContext(fs2.readFileSync(D2 + 'js/auth.js', 'utf8'), p.ctx);
  Object.keys(labels).forEach(role => {
    p.ctx.__session = Object.assign(sess(role), { loginTime: Date.now() });
    vm.runInContext('renderNavbar("dashboard")', p.ctx);
    const h = el.innerHTML, label = labels[role];
    ok(role + ': "' + label + '" is present', h.indexOf(label) >= 0);
    const seg = h.slice(h.indexOf(label), h.indexOf(label) + label.length + 120);
    eq(role + ': carries SOON', /SOON/.test(seg), OPEN.indexOf(role) < 0);
  });
}

process.exit(fail ? 1 : 0);
}
main();
