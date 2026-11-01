/* A387 — the Item Book page (item-book.html, js/item-book.js, js/item-book-model.js) and the forms that ask "which stock
 * item is this?" (the receiving, the invoice, the void).
 *
 * Run:  node tests/flow/item-book-page.js
 *
 * The real page scripts in the stub DOM (pageload): who gets in, what is asked of the server, what is drawn (no cost
 * unless the server sent it, no Edit unless the server allows it), the 194 note against an older backend, and that a
 * needsItem answer is asked about and sent again with the picks — never dropped, never guessed.
 */
const { page } = require('./pageload');
const fs = require('fs');
const path = require('path');
global.slmShortItem = require('../../dashboard/js/sales-lists-model.js').slmShortItem;
global.slmItemSpecs = require('../../dashboard/js/sales-lists-model.js').slmItemSpecs;
const M = require('../../dashboard/js/item-book-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const JS = ['js/sales-lists-model.js', 'js/hx-split.js', 'js/item-book-model.js', 'js/item-book.js'];
const who = (role) => ({ name: role === 'director' ? 'Neil Estur' : 'Someone ' + role, username: role + '1', role: role, token: 't' });
const ITEMS = [
  { itemId: 'ITM-00001', itemNo: 'N/A', name: 'PIECE INSULATED PIER AND SCREWD', type: 'Stock', balance: 34, displayName: '', details: false, photos: 0, barcodes: 0, codes: [] },
  { itemId: 'ITM-00004', itemNo: 'CP872', name: 'Impact wrench CP872 1/2in', type: 'Stock', balance: 5, displayName: 'CP872 impact wrench', brand: 'Chicago Pneumatic', model: 'CP872',
    category: 'Impact wrench', details: true, photos: 2, barcodes: 1, codes: ['4006825555551'], tracked: true },
  { itemId: 'ITM-00009', itemNo: 'N/A', name: 'Portable AcetyleneandOxygen tank Kit Product Name: Portable Welding Kit Brand: Greenfield Type: Portable Oxy-Acetylene Welding Kit',
    type: 'Catalog', balance: 0, details: false, photos: 0, barcodes: 0, codes: [] }];
const CARD = (may) => ({ success: true, may: may, item: { itemId: 'ITM-00004', itemNo: 'CP872', description: 'Impact wrench CP872 1/2in', type: 'Stock', balance: 5,
  displayName: 'CP872 impact wrench', brand: 'Chicago Pneumatic', model: 'CP872', category: 'Impact wrench', specs: [], notes: '', updatedAt: '' },
  barcodes: [{ barcode: '4006825555551' }], labels: [{ code: '', printed: 2 }], pieces: [], photos: [], log: [], twins: [], lists: { brands: [], categories: [] } });

/** The page with a scripted server: `answers` maps an action to a reply (or a function of the params). */
function pg(role, answers, opts) {
  const p = page(JS, 'item-book.html', who(role), Object.assign({ withAuth: true }, opts || {}));
  p.ctx.matchMedia = () => ({ matches: true });     // wide: the card draws in the pane beside the list
  p.ctx.addEventListener = () => {};
  p.ctx.__answers = answers || {};
  p.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); var x = __answers[a]; ' +
        'return Promise.resolve(typeof x === "function" ? x(q || {}) : (x || { success: false, message: "Unknown action: " + a })); };');
  return p;
}

sec('1 · who gets in');
(async () => {
  for (const role of ['sales', 'admin', 'accounting', 'management', 'director', 'warehouse']) {
    const p = pg(role, { getItemBook: { success: true, items: ITEMS, may: {}, lists: {} } });
    await p.boot();
    ok(role + ' opens the page and asks for the list', p.calls.indexOf('POST:getItemBook') >= 0, p.calls);
  }
  for (const role of ['hr', 'marketing', 'leadgen']) {
    const p = pg(role, {});
    await p.boot();
    ok(role + ' is sent home and asks for nothing', p.calls.length === 0 && /home|index|dashboard/.test(String(p.ctx.location.href)), [p.calls, p.ctx.location.href]);
  }
  const p = pg('sales', {});
  await p.boot();
  ok('the page never reads getInventory (costs for every caller)', p.calls.indexOf('getInventory') < 0);

  sec('2 · against an older backend, and the list');
  const old = pg('director', {});
  await old.boot();
  ok('"Unknown action" says to paste FlowAPI 194', /needs FlowAPI 194/.test(old.els.ibNotice.innerHTML), old.els.ibNotice.innerHTML);
  const l = pg('sales', { getItemBook: { success: true, items: ITEMS, may: {}, lists: {} } });
  await l.boot();
  ok('the list is drawn: the card\'s display name, else the short name off a pasted spec sheet', /CP872 impact wrench/.test(l.els.ibList.innerHTML) &&
     /Portable AcetyleneandOxygen tank Kit/.test(l.els.ibList.innerHTML) && !/Greenfield/.test(l.els.ibList.innerHTML), l.els.ibList.innerHTML.slice(0, 400));
  ok('  with what is on hand, and the count', /5 on hand/.test(l.els.ibList.innerHTML) && /Catalog/.test(l.els.ibList.innerHTML) && l.els.ibCount.textContent === '3 items', l.els.ibCount.textContent);
  ok('  and no cost anywhere when the server sent none', !/₱|landed/i.test(l.els.ibList.innerHTML));

  sec('3 · one card');
  const a = pg('sales', { getItemBook: { success: true, items: ITEMS, may: { edit: false }, lists: {} }, getItemCard: CARD({ edit: false }) });
  await a.boot();
  await a.run('ibOpen("ITM-00004", null)');
  ok('opening asks for that card by its id', JSON.stringify(a.paramsFor('getItemCard')) === '{"itemId":"ITM-00004"}', a.paramsFor('getItemCard'));
  ok('  and draws it beside the list: title, code, stock, tabs', /CP872 impact wrench/.test(a.els.ibPane.innerHTML) && /5 on hand/.test(a.els.ibPane.innerHTML) &&
     /role="tablist"/.test(a.els.ibPane.innerHTML) && /data-tab="history"/.test(a.els.ibPane.innerHTML), a.els.ibPane.innerHTML.slice(0, 300));
  ok('  a rep gets no Edit button and no cost', !/data-act="edit"/.test(a.els.ibPane.innerHTML) && !/Landed cost/.test(a.els.ibPane.innerHTML));
  const e = pg('admin', { getItemBook: { success: true, items: ITEMS, may: { edit: true }, lists: {} }, getItemCard: CARD({ edit: true }) });
  await e.boot();
  await e.run('ibOpen("ITM-00004", null)');
  ok('admin (may.edit) gets Edit', /data-act="edit"/.test(e.els.ibPane.innerHTML));
  const d = pg('director', { getItemBook: { success: true, items: ITEMS, may: { edit: true, cost: true }, lists: {} },
    getItemCard: Object.assign(CARD({ edit: true, cost: true }), { item: Object.assign(CARD({}).item, { landedCost: 12000, totalLanded: 60000, costCurrency: 'PHP' }) }) });
  await d.boot();
  await d.run('ibOpen("ITM-00004", null)');
  ok('the director sees the landed cost the server sent', /Landed cost/.test(d.els.ibPane.innerHTML) && /₱12,000\.00 each/.test(d.els.ibPane.innerHTML));
  const hist = pg('sales', { getItemBook: { success: true, items: ITEMS, may: {}, lists: {} }, getItemCard: CARD({}),
    getItemHistory: (q) => ({ success: true, part: q.part, lines: q.part === 'sell' ? [{ kind: 'quotation', ref: '2026-591', date: '2026-10-12', party: 'Petra Cement Inc.', qty: 2, price: 18500 }] : [] }) });
  await hist.boot();
  await hist.run('ibOpen("ITM-00004", null)');
  await hist.run('IB.tab = "history"; ibLoadHistory()');
  const parts = hist.params.filter(x => x.action === 'getItemHistory').map(x => x.params.part).sort().join();
  ok('History reads its three parts side by side', parts === 'buy,move,sell', parts);
  ok('  and says what was quoted, to whom', /Quoted 1 time, to 1 client/.test(hist.run('ibPartHtml("sell")')) && /Last quoted ₱18,500\.00 to Petra Cement Inc\./.test(hist.run('ibPartHtml("sell")')),
     hist.run('ibPartHtml("sell")').slice(0, 300));

  sec('4 · the model');
  ok('the title: display name, else the short name, else the code', M.ibmTitle(ITEMS[1]) === 'CP872 impact wrench' && M.ibmTitle(ITEMS[2]) === 'Portable AcetyleneandOxygen tank Kit' &&
     M.ibmTitle({ itemNo: 'X1' }) === 'X1');
  ok('specs: the card\'s own, else read from the description', M.ibmSpecs({ specs: [['A', 'b']] }).fromCard === true && M.ibmSpecs({ description: ITEMS[2].name }).specs.length >= 2);
  ok('search by barcode, brand or code', M.ibmFilter(ITEMS, { q: '4006825555551' }).length === 1 && M.ibmFilter(ITEMS, { q: 'chicago' }).length === 1 && M.ibmFilter(ITEMS, { q: 'cp872' }).length === 1);
  ok('chips: Stock, Catalog, With photos, Tracked, No details', M.ibmFilter(ITEMS, { chip: 'stock' }).length === 2 && M.ibmFilter(ITEMS, { chip: 'catalog' }).length === 1 &&
     M.ibmFilter(ITEMS, { chip: 'photos' }).length === 1 && M.ibmFilter(ITEMS, { chip: 'tracked' }).length === 1 && M.ibmFilter(ITEMS, { chip: 'bare' }).length === 2);
  ok('sort by most on hand', M.ibmFilter(ITEMS, { sort: 'stock' })[0].itemId === 'ITM-00001');
  ok('no code reads as no code', !M.ibmHasCode('N/A') && !M.ibmHasCode('TBA') && !M.ibmHasCode('-') && M.ibmHasCode('CP872'));

  sec('5 · the forms ask, then send again with the picks');
  const NEED = [{ index: 0, line: 1, itemNo: 'N/A', itemName: 'TORCH; HAND; CUTTING', qty: 1, how: 'unmatched', suspectId: '', candidates: [{ itemId: 'ITM-00151' }], allow: ['new'] }];
  /* the form scripts call window.addEventListener at load, which the stub window lacks: give it one, then load them */
  const form = (files, html) => { const f = page([], html, who('accounting')); f.ctx.addEventListener = () => {}; files.forEach(x => f.run(fs.readFileSync(D + x, 'utf8'))); return f; };
  const rc = form(['js/item-match.js', 'js/item-picker.js', 'js/flow-receiving.js'], 'flow-receiving.html');
  rc.ctx.__n = 0;
  rc.run('postFlow = function (a, q) { __params.push({ action: a, params: q }); __n++; return Promise.resolve(__n === 1 ? { success: false, needsItem: ' + JSON.stringify(NEED) + ', message: "Which stock item" } : { success: true, mrNo: "MR-1", message: "ok" }); };' +
         'ipPick = function (needs, o) { __picked = { what: o.what, n: needs.length }; return Promise.resolve({ 0: "ITM-00151" }); };' +
         'collectItems = function () { return [{ itemId: "", itemNo: "N/A", itemName: "TORCH; HAND; CUTTING", qty: 1, price: 54280 }]; };' +
         'rcCurrent = { poNo: "PO-1", supplier: "Con Ban Kiat", currency: "PHP", items: [] }; rcSession = { name: "Maria" };' +
         'resetForm = function () {}; loadAP = function () { return Promise.resolve(); }; loadReceiving = function () { return Promise.resolve(); };');
  await rc.run('saveReceiving()');
  const posts = rc.params.filter(x => x.action === 'createReceiving');
  ok('receiving: a needsItem answer opens the picker', rc.run('__picked && __picked.what') === 'receiving', rc.run('JSON.stringify(typeof __picked === "undefined" ? null : __picked)'));
  ok('  and the same receiving goes again with the line\'s pick', posts.length === 2 && JSON.parse(posts[1].params.items)[0].pick === 'ITM-00151' &&
     posts[1].params.clientRef === posts[0].params.clientRef, posts.map(x => x.params.items));
  const iv = form(['js/item-match.js', 'js/item-picker.js', 'js/flow-reason.js', 'js/flow-invoices.js'], 'flow-invoices.html');
  iv.ctx.__n = 0;
  iv.els.customer.value = 'Therma South, Inc.';
  iv.run('postFlow = function (a, q) { __params.push({ action: a, params: Object.assign({}, q) }); __n++; return Promise.resolve(__n === 1 ? { success: false, needsItem: ' + JSON.stringify(NEED) + ', message: "Which stock item" } : { success: true, invNo: "INV-1", message: "ok" }); };' +
         'ipPick = function () { return Promise.resolve({ 0: "none" }); };' +
         'collectItems = function () { return [{ itemId: "", itemNo: "N/A", itemName: "Freight", qty: 1, price: 2500 }]; };' +
         'ivCurrent = { soNo: "SO-1", items: [] }; ivSession = { name: "Maria" };' +
         'resetForm = function () {}; loadInventory = function () { return Promise.resolve(); }; loadInvoices = function () { return Promise.resolve(); };');
  await iv.run('saveInvoice()');
  const ip = iv.params.filter(x => x.action === 'createInvoice');
  ok('invoice: asked, then sent again with "not a stock item"', ip.length === 2 && JSON.parse(ip[1].params.items)[0].pick === 'none', ip.map(x => x.params.items));
  iv.run('ivInventory = [{ itemId: "A", itemNo: "N/A", description: "x" }, { itemId: "B", itemNo: "N/A", description: "y" }]');
  ok('the invoice form no longer shows the first of several rows\' cost (ivFind gives none)', iv.run('ivFind({ itemNo: "N/A", itemName: "z" })') === null &&
     iv.run('ivFind({ itemNo: "N/A", itemName: "y" }).itemId') === 'B');
  const pick = fs.readFileSync(D + 'js/item-picker.js', 'utf8');
  ok('the picker waits for every line before its main button works, and Escape cancels', /okBtn\.disabled = n < needs\.length/.test(pick) && /e\.key === 'Escape'/.test(pick));

  const qc = fs.readFileSync(D + 'js/flow-quote-configurator.js', 'utf8');
  ok('the quote builder stamps an id only on a real code one row has', /const noCode = \/\^\(n\\\/\?a\|na\|none\|tba\|-\+\)\?\$\/i/.test(qc) && /hits\.length === 1 \? hits\[0\] : null/.test(qc));
  ok('the PO form keeps the order line\'s item id', /itemId: it\.itemId \|\| ''/.test(fs.readFileSync(D + 'js/flow-purchase-orders.js', 'utf8')));
  ['flow-receiving.html', 'flow-invoices.html', 'scan.html'].forEach(f => {
    const h = fs.readFileSync(D + f, 'utf8');
    ok(f + ' loads the picker (its sheet, the resolver, then the dialog) before its page script', /css\/item-picker\.css/.test(h) &&
       h.indexOf('js/item-match.js') > 0 && h.indexOf('js/item-match.js') < h.indexOf('js/item-picker.js'));
  });

  console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
