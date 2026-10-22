/* A358 — a purchase request can name its Client Book client (optional), and only a client the person may use.
 *
 * Run:  node tests/flow/pr-client-link.js
 *
 * Neil, 22 Oct 2026: the PR a rep makes should be connected to the client list so the tracking from PR to quotation is
 * consistent — but for now only as an option. Runs the real FlowAPI.gs through its dispatcher (gasload):
 *   1 · no client: exactly as before, and the row is 21 wide with the new column blank
 *   2 · the rep's own client: stored, and returned by getPricingRequests as clientNo
 *   3 · another rep's client, an archived one, an unknown one, or a role outside the Client Book: refused, nothing written
 *   4 · the director may link any live client
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

const GERALD = { actorName: 'Gerald Lucena', actorRole: 'sales' }, KIM = { actorName: 'Kimberlyn Blones', actorRole: 'sales' };
const NEIL = { actorName: 'Neil Estur', actorRole: 'director' }, ADMIN = { actorName: 'Aira Limpoco', actorRole: 'admin' };
const ITEMS = JSON.stringify([{ itemNo: '1', itemName: 'Hydraulic torque wrench', qty: 1, uom: 'set' }]);
const pr = (who, extra) => call(C, 'createPricingRequest', Object.assign({ customer: 'Plant G One', items: ITEMS, requestedBy: who.actorName }, extra || {}, who));

const store = { FlowSettings: [] };
const C = load(GS, store);
const g1 = call(C, 'saveClientBookClient', Object.assign({ tier: 'Major', sector: 'Cement', company: 'Plant G One' }, GERALD)).clientNo;
const k1 = call(C, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Mining', company: 'Plant K One' }, KIM)).clientNo;
const gOld = call(C, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Power', company: 'Plant G Closed' }, GERALD)).clientNo;
call(C, 'archiveClientBookClient', Object.assign({ clientNo: gOld, reason: 'Plant closed' }, GERALD));
const rows = () => store.PricingRequests || [];

sec('1 · no client: as before');
{
  const r = pr(GERALD);
  const row = rows()[rows().length - 1];
  ok('a PR with no client is made as before', r.success && /^PR-/.test(r.prNo), r);
  ok('  21 wide, the new column blank', row.__arity === 21 && row['Client Book No'] === '' && row['Salesperson'] === 'Gerald Lucena', row);
}

sec('2 · the rep\'s own client');
{
  const r = pr(GERALD, { clientNo: g1 });
  const row = rows()[rows().length - 1];
  ok('stored on the PR', r.success && row['Client Book No'] === g1 && row.__arity === 21, row);
  const g = call(C, 'getPricingRequests', {});
  const mine = (g.data || []).find(x => x.prNo === r.prNo);
  ok('  and returned by getPricingRequests as clientNo', mine && mine.clientNo === g1, mine);
  ok('  a PR without one reads as blank', (g.data || []).filter(x => x.prNo !== r.prNo).every(x => x.clientNo === ''));
}

sec('3 · refused, and nothing written');
{
  const before = rows().length, items = (store.PricingRequestItems || []).length;
  const other = pr(GERALD, { clientNo: k1 });
  const closed = pr(GERALD, { clientNo: gOld });
  const unknown = pr(GERALD, { clientNo: 'CB-999999-999' });
  const admin = pr(ADMIN, { clientNo: g1 });
  ok('another rep\'s client', !other.success && /not in your Client Book/.test(other.message), other);
  ok('an archived client', !closed.success && /not a live client/.test(closed.message), closed);
  ok('an unknown client', !unknown.success && /not a live client/.test(unknown.message), unknown);
  ok('a role outside the Client Book (admin) cannot link one', !admin.success && /Only the Client Book/.test(admin.message), admin);
  ok('  no PR row and no item rows were written', rows().length === before && (store.PricingRequestItems || []).length === items);
  ok('  and admin still makes a PR without one', pr(ADMIN).success);
}

sec('4 · the director');
{
  const r = pr(NEIL, { clientNo: k1, customer: 'Plant K One' });
  ok('may link any live client', r.success && rows()[rows().length - 1]['Client Book No'] === k1, r);
}

sec('5 · the PR form');
{
  const fs = require('fs');
  const D = path.join(__dirname, '..', '..', 'dashboard');
  const H = fs.readFileSync(path.join(D, 'flow-pricing-request.html'), 'utf8'), JS = fs.readFileSync(path.join(D, 'js', 'flow-pricing-request.js'), 'utf8');
  ok('the Client Book picker sits above Customer, hidden until there is something to pick', /<div class="full" id="prClientBookRow" hidden><label for="prClientBook">Client \(Client Book\) — optional<\/label><select id="prClientBook"><\/select><\/div>\s*<div><label>Customer \*<\/label>/.test(H));
  ok('  it waits for FlowAPI 182 and reads only the book', /flowVersionAtLeast\(182\)/.test(JS) && /postFlow\('getClientBook', \{\}\)/.test(JS) && /if \(!prBook\.length\) return;/.test(JS));
  ok('  "— not linked —" comes first, so leaving it is the default', /'<option value="">— not linked —<\/option>'/.test(JS));
  ok('  the request carries clientNo only when a client was picked', /const bookNo = gv\('prClientBook'\);[\s\S]{0,120}if \(bookNo\) payload\.clientNo = bookNo;/.test(JS));
  ok('  picking one fills the customer as the book spells it, and the book\'s contact before the client master\'s, never over what the rep typed',
     /if \(cust\) cust\.value = c\.company;/.test(JS) && /if \(!el \|\| \(el\.value && el\.dataset\.cbfill !== '1'\)\) return;/.test(JS) && /fill\('prAddress', c\.siteAddress\);\s*prFillContacts\(\);/.test(JS));
  ok('  and a new form clears it', /'prClientNo', 'prClientBook'\]/.test(JS));
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
