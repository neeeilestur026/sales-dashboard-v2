/* A399 — the accounting role may not delete any record.
 *
 * Run:  node tests/flow/accounting-no-delete.js
 *
 * Neil, 14 Nov 2026: "remove the ability of the accounting dashboard to delete any record in the system".
 *
 * A delete is any action whose name starts with delete, remove, purge, erase or clear. Voids, cancels
 * and archives keep the record (marked), so they stay. Pinned here:
 *   1. the rule itself, and who it covers (accounting only);
 *   2. the browser refuses before sending: Code.gs calls (fetchFromAPI and _postMutation) and FlowAPI
 *      calls (postFlow) come back { success:false, refused:true } with nothing sent; other roles and
 *      other actions go out as before;
 *   3. Code.gs 7 refuses an accounting delete on the server, on the caller's real role, including a
 *      session Flask forwards; admin still deletes; a void is not refused;
 *   4. every Delete button accounting could reach is drawn only when hxMayDelete() says so.
 * Flask's /flow/secure refusal is pinned in tests/flow/accounting_no_delete.py.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCtx, seedSession } = require('./gasload-code');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });

const D = path.join(__dirname, '../../dashboard/js/');
const API = fs.readFileSync(D + 'api.js', 'utf8');
const FLOW = fs.readFileSync(D + 'flow-api.js', 'utf8');

/* api.js and flow-api.js in one context, with a recording fetch and a session in localStorage. */
function browser(role) {
  const sent = [];
  const store = { session: JSON.stringify({ token: 't-1', role: role, name: 'Someone', username: 'someone' }) };
  const ctx = {
    console, URLSearchParams, AbortController, JSON, Promise, Date, Math,
    setTimeout: (f) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'http://localhost', href: 'http://localhost/x.html', pathname: '/x.html' },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
                createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {}, classList: { add() {}, remove() {}, contains: () => false } },
                visibilityState: 'visible' },
    navigator: { onLine: true },
    fetch: async (url, opts) => { sent.push({ url: String(url), body: opts && opts.body ? String(opts.body) : '' });
      return { ok: true, status: 200, json: async () => ({ success: true, sent: true }), text: async () => '{"success":true}' }; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(API, ctx);
  vm.runInContext(FLOW, ctx);
  ctx.__sent = sent;
  return ctx;
}

(async () => {
  console.log('\n1 · the rule');
  const a = browser('accounting');
  const isDel = (x) => vm.runInContext('hxIsDeleteAction(' + JSON.stringify(x) + ')', a);
  ['deleteExpense', 'deleteDocument', 'removeReceivable', 'purgeOld', 'eraseWebRequest', 'clearCommissionDemo', 'deleteMigratedRecords']
    .forEach(x => ok(x + ' is a delete', isDel(x) === true));
  ['voidInvoice', 'voidCollection', 'cancelSalaryDeduction', 'archiveClientBookClient', 'updateExpense', 'addExpense', 'getExpenses', 'deleted', 'removal', 'delete', '']
    .forEach(x => ok(JSON.stringify(x) + ' is not', isDel(x) === false));
  ok('accounting may not delete', vm.runInContext('hxMayDelete()', a) === false);
  ['admin', 'director', 'management', 'sales', 'hr'].forEach(r => ok(r + ' still may', vm.runInContext('hxMayDelete()', browser(r)) === true));
  ok('only accounting is on the list', /const HX_NO_DELETE_ROLES = \['accounting'\];/.test(API));

  console.log('\n2 · the browser refuses before anything is sent');
  let r = await vm.runInContext("fetchFromAPI({ action: 'deleteExpense', rowIndex: 5 })", a);
  ok('Code.gs delete through fetchFromAPI → refused', r && r.success === false && r.refused === true && /cannot delete/.test(r.message), r);
  eq('  nothing sent', a.__sent.length, 0);
  r = await vm.runInContext("_postMutation({ action: 'deleteCollection', rowIndex: 3 })", a);
  ok('Code.gs delete straight through _postMutation → refused', r && r.refused === true, r);
  eq('  nothing sent', a.__sent.length, 0);
  r = await vm.runInContext("postFlow('deleteSalesOrder', { soNo: 'SO-1' })", a);
  ok('FlowAPI delete through postFlow → refused', r && r.success === false && r.refused === true, r);
  eq('  nothing sent', a.__sent.length, 0);
  r = await vm.runInContext("postFlow('voidInvoice', { invNo: '12', reason: 'x' })", a);
  ok('a void still goes out for accounting', a.__sent.length === 1 && /voidInvoice/.test(a.__sent[0].body), a.__sent);
  const ad = browser('admin');
  r = await vm.runInContext("postFlow('deleteSalesOrder', { soNo: 'SO-1' })", ad);
  ok('admin\'s delete goes out (to Flask\'s secured door)', ad.__sent.length === 1 && /\/flow\/secure/.test(ad.__sent[0].url) && /deleteSalesOrder/.test(ad.__sent[0].body), ad.__sent);
  r = await vm.runInContext("fetchFromAPI({ action: 'deleteExpense', rowIndex: 5 })", ad);
  ok('admin\'s Code.gs delete goes out', ad.__sent.length === 2 && /deleteExpense/.test(ad.__sent[1].body), ad.__sent.map(s => s.body.slice(0, 80)));

  console.log('\n3 · Code.gs 7 refuses it on the server');
  const CG = fs.readFileSync(path.join(__dirname, '../../apps-script/Code.gs'), 'utf8');
  ok('CODE_VERSION is 7', /var CODE_VERSION = 7;/.test(CG));
  const store = {
    Users: [['Username', 'Password', 'Role', 'Full Name', 'Quotation Sheet ID', 'PR Sheet ID', 'PO Sheet ID', '', '', '', 'MRO Sheet ID', '', 'Training Mode'],
      ['acct', 'x', 'accounting', 'Acct Person', '', '', '', '', '', '', '', '', 'FALSE'],
      ['boss', 'x', 'admin', 'The Admin', '', '', '', '', '', '', '', '', 'FALSE']],
    Sessions: [['Token', 'Username', 'FullName', 'Role', 'CreatedAt', 'ExpiresAt']],
  };
  seedSession(store, 'T-acct', 'acct', 'Acct Person', 'accounting');
  seedSession(store, 'T-boss', 'boss', 'The Admin', 'admin');
  const c = makeCtx(store, { USERS_SHEET_ID: 'users-sheet', INTERNAL_SHARED_SECRET: 'server-secret' });
  const post = (body) => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const get = (params) => JSON.parse(c.doGet({ parameter: params }).getContent());
  eq('getCodeVersion answers 7', get({ action: 'getCodeVersion' }).version, 7);
  for (const action of ['deleteExpense', 'deleteOrder', 'deleteCollection', 'deleteSalesOrder', 'deleteClient', 'deleteInventoryItem', 'deleteShipmentDoc', 'deleteSupplierQuotation']) {
    r = post({ action, token: 'T-acct', rowIndex: 2 });
    ok('accounting ' + action + ' → refused', r.success === false && r.refused === true && /cannot delete/.test(r.message), r);
  }
  r = post({ action: 'deleteExpense', sharedSecret: 'server-secret', token: 'T-acct', rowIndex: 2 });
  ok('  also when Flask forwards the accounting session', r.refused === true, r);
  r = post({ action: 'deleteExpense', token: 'T-boss', rowIndex: 2 });
  ok('admin is not refused by this rule', r.refused !== true && !/cannot delete/.test(String(r.message || '')), r);
  r = post({ action: 'addExpense', token: 'T-acct', date: '2026-11-14', category: 'Other', description: 'x', amount: 1 });
  ok('accounting\'s other writes are not refused by it', r.refused !== true && !/cannot delete/.test(String(r.message || '')), r);

  console.log('\n4 · every Delete button accounting could reach asks hxMayDelete()');
  const SRC = (f) => fs.readFileSync(D + f, 'utf8');
  const pins = [
    ['accounting.js', /if \(hxMayDelete\(\)\) html \+= ' <button onclick="deleteOrder\(/],
    ['accounting.js', /\(hxMayDelete\(\) \? '<button onclick="deleteExpense\(/],
    ['accounting.js', /if \(hxMayDelete\(\)\) html \+= '<button onclick="deleteCollection\(/],
    ['flow-ap-aging.js', /apCanDelete = \(apSession\.role === 'admin' \|\| apSession\.role === 'accounting'\) && hxMayDelete\(\);/],
    ['flow-inventory.js', /invCanDelete = \(invSession\.role === 'admin' \|\| invSession\.role === 'accounting'\) && hxMayDelete\(\);/],
    ['flow-clients.js', /\$\{hxMayDelete\(\) \? `<button class="link-btn del-btn" onclick='deleteClientRec\(/],
    ['flow-suppliers.js', /\$\{hxMayDelete\(\) \? `<button class="link-btn del-btn" onclick='deleteSupplierRec\(/],
    ['flow-sales-orders.js', /\$\{hxMayDelete\(\) \? `<button class="link-btn del-btn" onclick='deleteSO\(/],
    ['flow-expenses.js', /\$\{expViewer \|\| !hxMayDelete\(\) \? '' : `<button class="ex-act" data-del=/],
    ['flow-commissions.js', /if \(hxMayDelete\(\)\) a \+= B\(`cmDelete\(/],
    ['flow-docs.js', /\$\{flowIsViewerOnly\(\) \|\| !hxMayDelete\(\) \? '' : `<button class="link-btn del-btn" onclick='flowDocsDelete\(/],
    ['flow-purchase-orders.js', /\(hxMayDelete\(\) \? B\(`deletePO\(/],
    ['flow-quotations.js', /editable && hxMayDelete\(\)\) a \+= B\(`deleteQuotation\(/],
    ['flow-shipments.js', /\$\{shViewer \|\| !hxMayDelete\(\) \? '' : `<button class="link-btn del-btn" onclick='shDelDoc\(/],
    ['flow-payment-requests.js', /if \(hxMayDelete\(\)\) a \+= B\(`prDelete\(/],
    ['flow-other-payables.js', /\(hxMayDelete\(\) \? B\(`prDelete\(/],
    ['migrate-so-costs.js', /if \(!hxMayDelete\(\)\) document\.getElementById\('removeMigBtn'\)\.style\.display = 'none';/],
    ['replace-2026-sos.js', /if \(!hxMayDelete\(\)\) document\.getElementById\('wipeBtn'\)\.style\.display = 'none';/],
  ];
  pins.forEach(([f, re]) => ok(f + ' ' + re.source.slice(0, 60).replace(/\\/g, ''), re.test(SRC(f))));
  /* No Delete button drawn without asking: every onclick that calls a delete function on these pages is behind the check. */
  const unguarded = [];
  [['accounting.js', /deleteOrder\(|deleteExpense\(|deleteCollection\(/], ['flow-clients.js', /deleteClientRec\(/], ['flow-suppliers.js', /deleteSupplierRec\(/],
   ['flow-sales-orders.js', /onclick='deleteSO\(/], ['flow-docs.js', /onclick='flowDocsDelete\(/], ['flow-shipments.js', /onclick='shDelDoc\(/],
   ['flow-quotations.js', /B\(`deleteQuotation\(/], ['flow-purchase-orders.js', /B\(`deletePO\(/], ['flow-commissions.js', /B\(`cmDelete\(/],
   ['flow-payment-requests.js', /B\(`prDelete\(/], ['flow-other-payables.js', /B\(`prDelete\(/]].forEach(([f, re]) => {
    SRC(f).split('\n').forEach((l, i) => { if (re.test(l) && /<button|B\(`/.test(l) && !/hxMayDelete\(\)/.test(l)) unguarded.push(f + ':' + (i + 1)); });
  });
  eq('no unguarded Delete button left on those pages', unguarded, []);

  console.log(FAIL ? `\n${FAIL} FAILED` : '\nall passed');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
