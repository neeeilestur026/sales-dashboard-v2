/* A369 — the commission rate table is the director's.
 *
 * Run:  node tests/flow/commission-rate-guard.js
 *
 * The rates page was director-only, but setCommissionRate and deleteCommissionRate had no role check of their own, and
 * the commission rollout (_COMM_ROLES) admits sales and management. So a signed-in rep could change or remove a rate
 * through /flow/secure. Both now refuse every role but the director, before anything is written.
 * Runs the real FlowAPI.gs through its dispatcher (gasload).
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const RATE = { rateKey: 'DEFAULT-1', scope: 'default', rate: '3', notes: 'base' };

const store = { CommissionRates: [] };
const c = load(GS, store);
const d = call(c, 'setCommissionRate', Object.assign({ actorRole: 'director', actorName: 'Neil Estur' }, RATE));
ok('the director adds a rate', d.success && store.CommissionRates.length === 1 && store.CommissionRates[0]['Rate %'] === 3, d);
['sales', 'management', 'accounting', 'admin', ''].forEach(role => {
  const before = JSON.stringify(store.CommissionRates);
  const s = call(c, 'setCommissionRate', Object.assign({ actorRole: role, actorName: 'Someone' }, RATE, { rate: '50' }));
  const x = call(c, 'deleteCommissionRate', { actorRole: role, actorName: 'Someone', rateKey: 'DEFAULT-1' });
  ok((role || 'no role') + ': refused to change or remove a rate, and nothing is written',
     !s.success && !x.success && JSON.stringify(store.CommissionRates) === before &&
     (role === '' || role === 'accounting' || role === 'admin' ? true : /Only the director/.test(s.message) && /Only the director/.test(x.message)), [s, x]);
});
const del = call(c, 'deleteCommissionRate', { actorRole: 'director', actorName: 'Neil Estur', rateKey: 'DEFAULT-1' });
ok('the director removes it', del.success && store.CommissionRates.length === 0, del);

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
