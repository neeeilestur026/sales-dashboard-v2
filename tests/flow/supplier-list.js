/* A374 — the supplier list (js/supplier-list-model.js, js/supplier-list.js, supplier-list.html) and its hint in the
 * sourcing table (js/flow-pricing-request.js).
 *
 * Run:  node tests/flow/supplier-list.js
 *
 * A small list with the answers worked out by hand, today being Monday 26 Oct 2026:
 *   1 · the model: days, money, item keys, matching a typed name, last prices, items and their history, search, CSV
 *   2 · the page: rows, chips, a supplier's four tabs, before FlowAPI 189
 *   3 · the sourcing table: the names, "Last priced …", and what a forward filed
 *   4 · who sees the page, its own actions only, and the site rules (Apple look, no emoji, hex colour or inline style)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');

const PEOPLE = [{ id: 'P1', name: 'Ana Reyes', position: 'Sales', emails: ['ana@yale-hw.ph', 'ana.reyes@gmail.com'], phones: ['0917 111 2222', '(02) 8700 1234'], primary: true },
                { id: 'P2', name: 'Ben, Jr.', position: 'Warehouse', emails: ['ben@yale-hw.ph'], phones: [], primary: false }];
const BOOK = {
  success: true,
  suppliers: [
    { supplierNo: 'SB-1', supplier: 'Yale Hardware', aliases: ['Yale HW'], type: 'Local', distributor: false, brands: [], contacts: PEOPLE, address: '12 Rizal Ave, Sta. Cruz, Manila',
      delivery: 'Delivered to our warehouse', deliveryNote: '', terms: '30 days', usualItems: ['Hex bolts', 'Nuts'], notes: '', needsDetails: false, source: 'Manual', status: 'Active',
      updatedAt: '2026-10-20T02:00:00.000Z' },
    { supplierNo: 'SB-2', supplier: 'CEJN AB', aliases: [], type: 'International', distributor: true, brands: ['CEJN'], contacts: [], address: '', delivery: 'Other',
      deliveryNote: 'By sea freight', terms: 'Prepaid', usualItems: [], needsDetails: true, source: 'Import', status: 'Active', updatedAt: '2026-10-01T02:00:00.000Z' },
    { supplierNo: 'SB-3', supplier: 'Bolt King Trading', aliases: [], type: '', distributor: false, brands: [], contacts: [], address: '', delivery: '', terms: '', usualItems: [],
      needsDetails: true, source: 'Forwarded PR', status: 'Active', updatedAt: '2026-10-21T02:00:00.000Z' },
    { supplierNo: 'SB-4', supplier: 'Old Steel Co', aliases: [], type: 'Local', contacts: [], brands: [], usualItems: [], status: 'Archived', archivedAt: '2026-10-02T02:00:00.000Z',
      archivedBy: 'Admin One', archiveReason: 'Closed down', updatedAt: '2026-10-02T02:00:00.000Z' }
  ],
  prices: [
    { priceNo: 'SP-1', supplierNo: 'SB-1', itemKey: 'code:412', itemNo: '00412', itemName: 'Hex bolt M10 x 50', uom: 'pcs', currency: 'PHP', price: 12.4, vat: 'Inclusive', prNo: 'PR-202610-050', customer: 'Semirara Mining', at: '2026-10-21T02:00:00.000Z', source: 'Forwarded PR' },
    { priceNo: 'SP-2', supplierNo: 'SB-1', itemKey: 'code:412', itemNo: '00412', itemName: 'Hex bolt M10 x 50', uom: 'pcs', currency: 'PHP', price: 14, vat: 'Inclusive', prNo: 'PR-202609-010', customer: 'Petron', at: '2026-09-03T02:00:00.000Z', source: 'Import' },
    { priceNo: 'SP-3', supplierNo: 'SB-1', itemKey: 'name:hex nut m10', itemNo: 'N/A', itemName: 'Hex nut M10', uom: 'pcs', currency: 'PHP', price: 3.1, vat: 'Exclusive', prNo: 'PR-202610-050', customer: 'Semirara Mining', at: '2026-10-21T02:00:00.000Z', source: 'Forwarded PR' },
    { priceNo: 'SP-4', supplierNo: 'SB-2', itemKey: 'code:cejn-10', itemNo: 'CEJN-10', itemName: 'Quick coupling', uom: 'pc', currency: 'EUR', price: 125.5, vat: '', prNo: 'PR-202608-004', customer: 'Therma', at: '2026-08-01T02:00:00.000Z', source: 'Import' }
  ],
  log: [
    { logNo: 'SBL-1', supplierNo: 'SB-1', kind: 'created', to: 'Yale Hardware', note: 'Local, 2 contacts.', by: 'Admin One', at: '2026-10-01T02:00:00.000Z' },
    { logNo: 'SBL-2', supplierNo: 'SB-1', kind: 'priced', to: '2', note: '2 items priced on PR-202610-050 (Semirara Mining): Hex bolt M10 x 50, Hex nut M10.', ref: 'PR-202610-050', by: 'Admin One', at: '2026-10-21T02:00:00.000Z' },
    { logNo: 'SBL-3', supplierNo: 'SB-3', kind: 'created', to: 'Bolt King Trading', note: 'Added from PR-202610-050 when it was forwarded to management; needs details.', ref: 'PR-202610-050', by: 'Admin One', at: '2026-10-21T02:00:00.000Z' }
  ],
  lists: { types: ['Local', 'International'], delivery: ['Pickup at their warehouse', 'Delivered to our warehouse', 'Other'], terms: ['COD', 'Prepaid', '50% down', '7 days', '15 days', '30 days', '60 days'] }
};

/* the model, in one vm context with the real flow-api.js and client-rollup.js, as the page has them */
const C = (function () {
  const ctx = { console, Date, Math, JSON, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    navigator: {}, location: { search: '' } };
  ctx.window = ctx; vm.createContext(ctx);
  ['js/flow-api.js', 'js/client-rollup.js', 'js/supplier-list-model.js'].forEach(f => vm.runInContext(read(f), ctx));
  ctx.__book = BOOK;
  return ctx;
})();
const run = (code) => vm.runInContext(code, C);
const J = (code) => JSON.parse(JSON.stringify(run(code)));

sec('1 · the model');
eq('days read plainly, short this year', [run('slDay("2026-10-21T02:00:00.000Z")'), run('slShortDay("2026-10-21T02:00:00.000Z", "2026-10-26")'), run('slShortDay("2025-12-30", "2026-10-26")'), run('slDay("")')],
   ['21 Oct 2026', '21 Oct', '30 Dec 2025', '']);
eq('a buy price in its own currency', [run('slMoney("PHP", 12.4)'), run('slMoney("usd", 1250)'), run('slMoney("EUR", 0.125)'), run('slMoney("", 3)')], ['₱12.40', 'USD 1,250.00', 'EUR 0.125', '₱3.00']);
eq('an item is its code (zeros dropped, any case) or, with none, its name — as the server keys it', [run('slItemKey("00412", "x")'), run('slItemKey("N/A", "Hex  Nut M10")'), run('slItemKey("", "Washer")'), run('slItemKey("--", "Washer")')],
   ['code:412', 'name:hex nut m10', 'name:washer', 'name:washer']);
const S = 'JSON.parse(JSON.stringify(__book.suppliers.filter(function (s) { return s.status !== "Archived"; })))';
eq('a typed name is matched by its spelling, another spelling, or the comparison key', [run('slResolve(' + S + ', "yale hardware")'), run('slResolve(' + S + ', "Yale HW")'), run('slResolve(' + S + ', "YALE HARDWARE CORP.")'), run('slResolve(' + S + ', "Nobody Inc")'), run('slResolve(' + S + ', "")')],
   ['SB-1', 'SB-1', 'SB-1', '', '']);
const latest = 'JSON.parse(JSON.stringify(__book.prices))';
eq('the last price for a supplier and item (by code even with a new name), or none', [J('slLastPrice(' + latest + ', "SB-1", "412", "Hex bolt, zinc")').price, run('slLastPrice(' + latest + ', "SB-3", "00412", "x")'), run('slLastPrice(' + latest + ', "", "00412", "x")')], [12.4, null, null]);
const IT = J('slItems(__book.prices, "SB-1")');
eq('a supplier\'s items, newest first, each with its history newest first', [IT.length, IT.map(x => x.itemName), IT[0].count, IT[0].history.map(h => h.price), IT[0].last.prNo], [2, ['Hex bolt M10 x 50', 'Hex nut M10'], 2, [12.4, 14], 'PR-202610-050']);
eq('when each last priced anything', [run('slLastPriced(__book.prices, "SB-1")'), run('slLastPriced(__book.prices, "SB-3")')], ['2026-10-21T02:00:00.000Z', '']);
eq('a twin: a live supplier with the name, a spelling, or the key; never itself, never an archived one', [J('slTwin(__book.suppliers, "Yale Hardware Inc.", "")').supplierNo, J('slTwin(__book.suppliers, "yale hw", "")').supplierNo, run('slTwin(__book.suppliers, "Yale Hardware", "SB-1")'), run('slTwin(__book.suppliers, "Old Steel Co", "")')],
   ['SB-1', 'SB-1', null, null]);
const F = (f) => J('slFilter(__book.suppliers, __book.prices, ' + JSON.stringify(f) + ')').map(s => s.supplierNo);
eq('the live suppliers by name; archived ones apart', [F({}), F({ archived: true })], [['SB-3', 'SB-2', 'SB-1'], ['SB-4']]);
eq('search: an email, phone digits, a brand, a priced item, another spelling', [F({ q: 'ana.reyes' }), F({ q: '87001234' }), F({ q: 'cejn' }), F({ q: 'hex nut' }), F({ q: 'yale hw' })], [['SB-1'], ['SB-1'], ['SB-2'], ['SB-1'], ['SB-1']]);
eq('filters: local, we distribute, needs details, a delivery; sorted by last priced', [F({ type: 'Local' }), F({ distributor: true }), F({ needs: true }), F({ delivery: 'Other' }), F({ sort: 'priced' })],
   [['SB-1'], ['SB-2'], ['SB-3', 'SB-2'], ['SB-2'], ['SB-1', 'SB-2', 'SB-3']]);
eq('the chips count the live ones', J('slSummary(__book.suppliers)'), { total: 3, local: 1, international: 1, noType: 1, distributor: 1, needs: 2, archived: 1 });
{
  const csv = run('slCsv(slFilter(__book.suppliers, __book.prices, {}), __book.prices)').split('\n');
  ok('CSV: a header, then one row per contact person (a supplier with none still has its row)', csv.length === 1 + 2 + 1 + 1 && /^Supplier No,Supplier,Other spellings,Local or international/.test(csv[0]), csv);
  ok('  with the items priced and the last priced day; a cell with a comma is quoted', csv.some(l => /^SB-1,Yale Hardware,Yale HW,Local,No,,"12 Rizal Ave, Sta. Cruz, Manila",Delivered to our warehouse,,30 days,,Hex bolts; Nuts,"Ben, Jr\.",Warehouse,,ben@yale-hw\.ph,,2,2026-10-21,$/.test(l)), csv);
}
eq('a history line in words', [run('slLogText({kind:"priced", to:"2"})'), run('slLogText({kind:"priced", to:"1"})'), run('slLogText({kind:"imported"})'), run('slLogText({kind:"merged"})'), run('slLogText({kind:"file"})')], ['Priced 2 items', 'Priced 1 item', 'Filled from past requests', 'Merged', 'From the supplier file']);
eq('the emails that are not emails, as typed', J('slBadEmails("ana@x.ph\\nnope\\n bad@ ")'), ['nope', 'bad@']);

sec('2 · the page');
const stubEl = () => ({ id: '', value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, checked: false, dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, focus() {}, setAttribute() {}, getAttribute: () => null,
  querySelector: () => stubEl(), querySelectorAll: () => [], closest: () => null, insertAdjacentHTML() {}, remove() {}, elements: new Proxy({}, { get: () => stubEl() }) });
async function boot(o) {
  o = o || {};
  const p = page(['js/client-rollup.js', 'js/supplier-list-model.js', 'js/supplier-list.js'], 'supplier-list.html', o.session || { username: 'admin1', name: 'Admin One', role: 'admin' }, { data: {} });
  ['slQ', 'slDelivery', 'slSort'].forEach(id => { p.els[id] = Object.assign(stubEl(), { id }); });
  p.ctx.__book = JSON.parse(JSON.stringify(o.book || BOOK)); p.ctx.__stub = stubEl; p.ctx.__v = o.v || 189;
  p.ctx.__old = !!o.old;   // the server has no getSupplierBook (FlowAPI before 189)
  p.run(`requireSupplierListAccess = function () { return __session; };
    flowToday = function () { return "2026-10-26"; };
    flowVersionAtLeast = function (n) { return Promise.resolve(n <= __v); };
    var __posted = [], __shown = '';
    postFlow = function (a, p) { __posted.push({ a: a, p: p });
      if (a === 'getSupplierBook') return Promise.resolve(__old ? { success: false, message: 'Unknown action: getSupplierBook' } : JSON.parse(JSON.stringify(__book)));
      return Promise.resolve({ success: true, supplierNo: p.supplierNo || 'SB-9' }); };
    slShow = function (h, back) { __shown = h; SL.back = back || SL.back; return __stub(); };`);
  await p.boot();
  await new Promise(r => setImmediate(r));
  return p;
}
(async () => {
  const p = await boot();
  const T = p.els.slTable.innerHTML;
  eq('reads the list once, privately (a secured read), and nothing else', [p.run('__posted.map(function (x) { return x.a; })'), p.calls.filter(c => !/^POST:/.test(c))], [['getSupplierBook'], []]);
  ok('one row per live supplier, by name', (T.match(/data-open="/g) || []).length === 3 && T.indexOf('SB-3') < T.indexOf('SB-2') && T.indexOf('SB-2') < T.indexOf('SB-1'));
  ok('  a row: the name and when it last priced; local or international, the main contact, the town; then what stands out',
     /<span class="sl-name">Yale Hardware<\/span><span class="sl-when">Priced 21 Oct<\/span><\/span><span class="sl-r2">Local · Ana Reyes · Sta\. Cruz, Manila<\/span><span class="sl-r3"><span>2 items priced<\/span><\/span>/.test(T), T.slice(0, 900));
  ok('  we distribute (with the brand), needs details, and an unknown type asked for', /<span class="sl-badge dist">We distribute: CEJN<\/span> <span class="sl-badge warn">Needs details<\/span>/.test(T) && /<span class="sl-dim">Local or international\?<\/span>/.test(T));
  ok('the chips count, and All is on', /data-chip="all" aria-pressed="true">All suppliers <span class="n">3<\/span>/.test(p.els.slChips.innerHTML) && /Needs details <span class="n">2<\/span>/.test(p.els.slChips.innerHTML) && /Archived <span class="n">1<\/span>/.test(p.els.slChips.innerHTML));
  eq('the list says how many it holds', p.els.slFoot.textContent, '3 suppliers');
  p.run('slChip("d")');
  ok('a chip filters the list', (p.els.slTable.innerHTML.match(/data-open="/g) || []).length === 1 && /CEJN AB/.test(p.els.slTable.innerHTML) && p.els.slFoot.textContent === '1 of 3 suppliers');
  p.run('slChip("archived")');
  ok('  Archived shows only the archived', /Old Steel Co/.test(p.els.slTable.innerHTML) && /class="sl-open archived"/.test(p.els.slTable.innerHTML) && p.els.slFoot.textContent === '1 supplier, archived');
  p.run('slChip("all")');

  p.run('slDetail("SB-1", null)');
  const d1 = p.run('__shown');
  ok('a supplier: four tabs — Overview, Contacts (2), Items priced (2), History (2)', /data-tab="overview">Overview<\/button>/.test(d1) && /data-tab="contacts">Contacts <span class="n">2<\/span>/.test(d1) &&
     /data-tab="items">Items priced <span class="n">2<\/span>/.test(d1) && /data-tab="history">History <span class="n">2<\/span>/.test(d1), d1.slice(0, 1500));
  ok('  the overview: local, no distributorship, the address, delivery, terms, usual items, the main contact, items priced, other spellings',
     /Local or international<\/span><span class="sl-fv">Local/.test(d1) && /Distributorship<\/span><span class="sl-fv"><span class="sl-dim">No<\/span>/.test(d1) && /Usual delivery<\/span><span class="sl-fv">Delivered to our warehouse/.test(d1) &&
     /Payment terms<\/span><span class="sl-fv">30 days/.test(d1) && /<span class="sl-lines"><span>Hex bolts<\/span><span>Nuts<\/span><\/span>/.test(d1) && /<b>Ana Reyes<\/b>/.test(d1) &&
     /2 items<span class="sl-fsub">last priced 21 Oct 2026<\/span>/.test(d1) && /Other spellings/.test(d1));
  ok('  each item with its last price, when, the request and the client; a second price opens its history',
     /Hex bolt M10 x 50 <span class="sl-code">00412<\/span><\/span><span class="sl-iprice">₱12\.40<span class="sl-per"> \/ pcs<\/span>/.test(d1) && /Last priced 21 Oct 2026<\/span><span>VAT inclusive<\/span><span><a href="flow-pricing-request\.html\?pr=PR-202610-050">PR-202610-050<\/a> · Semirara Mining/.test(d1) &&
     /data-hist="0" aria-expanded="false" aria-controls="slHist0">2 prices<\/button>/.test(d1) && /<li><span class="tm">3 Sep 2026<\/span><span class="amt">₱14\.00<\/span><span><a[^>]*>PR-202609-010<\/a> · Petron · from past requests<\/span><\/li>/.test(d1));
  ok('  N/A is not shown as a code', /Hex nut M10<\/span><span class="sl-iprice">/.test(d1));
  ok('  the edit form is there, behind Edit, with both people and their emails and phones', /data-reveal="slEdit" aria-expanded="false"/.test(d1) && /<form class="sl-form" id="slEdit"/.test(d1) &&
     (d1.match(/<fieldset class="sl-person"/g) || []).length === 2 && /ana@yale-hw\.ph\nana\.reyes@gmail\.com/.test(d1) && /0917 111 2222\n\(02\) 8700 1234/.test(d1));
  ok('  history: merge into another live supplier (checked first), and archive with a reason', /Check what moves/.test(d1) && /<option value="SB-2">CEJN AB<\/option>/.test(d1) && !/<option value="SB-4">/.test(d1) && /Archive this supplier — why\?/.test(d1));
  p.run('slDetail("SB-3", null)');
  const d3 = p.run('__shown');
  ok('a supplier added from a forward says so, and invites the details', /Added from a forwarded purchase request; it has no contact person or address yet\. <button type="button" class="sl-link" data-reveal="slEdit">Add them<\/button>/.test(d3));
  ok('  with no prices yet, the Items tab says how they arrive', /Prices appear here when admin forwards a purchase request with this supplier\./.test(d3));
  p.run('slDetail("SB-4", null)');
  const d4 = p.run('__shown');
  ok('an archived supplier: no edit, no merge, Restore', /Archived 2 Oct 2026 by Admin One: Closed down/.test(d4) && !/id="slEdit"/.test(d4) && !/Check what moves/.test(d4) && /Restore this supplier/.test(d4));
  p.run('SL.flash = "Saved."; slDetail("SB-1", null)');
  ok('a save says so once, in the supplier\'s header', /<p class="sl-flash" role="status">Saved\.<\/p>/.test(p.run('__shown')) && p.run('SL.flash') === '');
  p.run('slDetail("SB-1", null)');
  ok('  and not again', !/sl-flash/.test(p.run('__shown')));

  const old = await boot({ old: true });
  ok('before FlowAPI 189 (the server has no such action): it says what to paste and adds nothing', /version 189/.test(old.els.slNotice.innerHTML) && !/ bad/.test(old.els.slNotice.innerHTML) &&
     old.run('__posted.map(function (x) { return x.a; })').join() === 'getSupplierBook' && old.els.slAdd.disabled === true);
  const stale = await boot({ v: 188 });
  ok('a stale or dropped version read never hides a list the server has (the list itself is the test)', !stale.els.slNotice.innerHTML && (stale.els.slTable.innerHTML.match(/data-open="/g) || []).length === 3 &&
     !/flowVersionAtLeast/.test(read('js/supplier-list.js')));
  const down = await boot({ book: { success: false, message: 'Request timed out.' } });
  ok('  any other failure says what went wrong, not "paste 189"', /Could not read the supplier list: Request timed out\./.test(down.els.slNotice.innerHTML) && !/version 189/.test(down.els.slNotice.innerHTML));
  const empty = await boot({ book: { success: true, suppliers: [], prices: [], log: [] } });
  ok('an empty list invites the first supplier and says forwards fill it too', /No suppliers yet\./.test(empty.els.slTable.innerHTML) && /its suppliers are added here by themselves/.test(empty.els.slTable.innerHTML) && /data-addfirst/.test(empty.els.slTable.innerHTML));
  ok('while it reads, rows shaped like the list (not a spinner)', /class="sl-skel" aria-hidden="true"/.test(p.run('slSkeleton()')) && /role="status">Reading the supplier list/.test(p.run('slSkeleton()')));
  {
    const fp = await boot();
    const form = (() => {
      const v = { supplier: ' Bolt King ', aliases: 'BK\n', brands: 'X', address: ' 1 Main St ', deliveryNote: 'ignored', terms: '__other', termsOther: ' 45 days ', tin: ' 010-737-706-000 ', usualItems: 'Anchors', notes: '' };
      const els = {}; Object.keys(v).forEach(k => { els[k] = { value: v[k] }; });
      const radios = { type: 'Local', dist: 'No', delivery: 'Pickup at their warehouse' };
      return { elements: els, querySelectorAll: (sel) => { const m = /name="(\w+)"/.exec(sel); return m ? [{ checked: true, value: radios[m[1]] }] : []; } };
    })();
    fp.ctx.__form = form;
    fp.run('slReadPeople = function () { return [{ id: "P1", name: "Carl", position: "", emails: ["carl@bk.ph"], phones: [], primary: true }]; }');
    const params = JSON.parse(JSON.stringify(fp.run('slFormParams(__form)')));
    eq('the form sends the whole supplier: brands only with the distributorship, the note only with Other, the typed terms', params,
       { supplier: 'Bolt King', aliases: 'BK\n', type: 'Local', distributor: false, brands: '', address: '1 Main St', delivery: 'Pickup at their warehouse', deliveryNote: '', terms: '45 days', tin: '010-737-706-000', usualItems: 'Anchors',
         contactsJson: '[{"id":"P1","name":"Carl","position":"","emails":["carl@bk.ph"],"phones":[],"primary":true}]', notes: '' });
  }

  sec('3 · the sourcing table');
  {
    const pr = page(['js/flow-pricing-engine.js', 'js/client-rollup.js', 'js/supplier-list-model.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html', { username: 'admin1', name: 'Admin One', role: 'admin' }, {});
    pr.ctx.__lite = { suppliers: BOOK.suppliers.filter(s => s.status !== 'Archived').map(s => ({ supplierNo: s.supplierNo, supplier: s.supplier, aliases: s.aliases })),
                      latest: [{ supplierNo: 'SB-1', itemKey: 'code:412', itemNo: '00412', itemName: 'Hex bolt M10 x 50', currency: 'PHP', price: 12.4, prNo: 'PR-202610-050', at: '2026-10-21T02:00:00.000Z' }] };
    const tr = (sup, no, name) => { const box = { innerHTML: '', textContent: '' }, v = { '.s-sup': { value: sup }, '.s-no': { value: no }, '.s-name': { value: name }, '[data-suplast]': box };
      return { box, row: { querySelector: (q) => v[q] || null } }; };
    pr.run('prSl = __lite; prRole = "admin";');
    const say = (sup, no, name, role) => { const t = tr(sup, no, name); pr.ctx.__tr = t.row; pr.run('prRole = ' + JSON.stringify(role || 'admin') + '; prSlHint(__tr)'); return t.box.innerHTML || t.box.textContent; };
    eq('under the supplier: its last price for this item, when, which request, and a link to the supplier',
       say('Yale Hardware Corp.', '412', 'Hex bolt'), 'Last priced ₱12.40 on 21 Oct 2026 · PR-202610-050 (<a href="supplier-list.html?supplier=SB-1" target="_blank" rel="noopener">Yale Hardware</a>)');
    eq('  accounting sees the name, not a link it cannot open', say('Yale HW', '00412', '', 'accounting'), 'Last priced ₱12.40 on 21 Oct 2026 · PR-202610-050 (Yale Hardware)');
    eq('  on the list but never priced this item', say('CEJN AB', 'X-1', 'Hose'), 'On the supplier list (<a href="supplier-list.html?supplier=SB-2" target="_blank" rel="noopener">CEJN AB</a>); no price for this item yet.');
    eq('  a name not on the list, and an empty box', [say('New Supplier Co', '', 'Bolt'), say('', '', '')], ['Not on the supplier list yet; it is added when you forward.', '']);
    eq('what a forward filed, in its own words', [pr.run('prSlForwardSay({ prices: 3, unchanged: 0, newSuppliers: [{ supplierNo: "SB-9", supplier: "Bolt King" }] })'), pr.run('prSlForwardSay({ prices: 1, newSuppliers: [] })'), pr.run('prSlForwardSay({ prices: 0, unchanged: 2, newSuppliers: [] })'), pr.run('prSlForwardSay(undefined)')],
       ['3 prices filed in the supplier list; 1 new supplier needs details (Bolt King).', '1 price filed in the supplier list.', '', '']);
    const PRJS = read('js/flow-pricing-request.js'), PRH = read('flow-pricing-request.html');
    ok('  the supplier box suggests the list\'s names (a datalist); the hint reads the list itself and stays quiet when refused', /class="s-sup" list="slSupNames"/.test(PRJS) && /<datalist id="slSupNames"><\/datalist>/.test(PRJS) && !/flowVersionAtLeast\(189\)/.test(PRJS) &&
       /const r = await postFlow\('getSupplierBook', \{ lite: true \}\)\.catch\(\(\) => null\);/.test(PRJS) && /prSl = r && r\.success \?/.test(PRJS));
    ok('  both sourcing views decorate it, and the forward says what it filed', (PRJS.match(/prSlDecorate\(\);/g) || []).length === 2 && /const filed = prSlForwardSay\(f\.recorded\);/.test(PRJS));
    ok('  the page loads the model before its own script', /client-rollup\.js"><\/script>\s*<script src="js\/supplier-list-model\.js"><\/script>\s*<script src="js\/flow-pricing-request\.js"><\/script>/.test(PRH));
  }

  sec('4 · who sees it, and the site rules');
  const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');
  const navFor = (role) => {
    const store = { session: JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) };
    let html = '';
    const c = { console, window: {}, localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { href: '', pathname: '/x.html', search: '' },
      document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
        getElementById: (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } };
          if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; } },
      fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
    c.window = c; vm.createContext(c); require('./hxutil').load(c); vm.runInContext(AUTH, c); vm.runInContext(NAV, c);
    c.renderNavbar('supplier-list');
    return { classic: /href="supplier-list\.html"/.test(html), rail: vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', c).indexOf('supplier-list.html') >= 0 };
  };
  const roles = ['director', 'admin', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing'];
  eq('admin\'s and the director\'s navbar and rail link it, nobody else\'s', roles.filter(r => { const n = navFor(r); return n.classic && n.rail; }), ['director', 'admin']);
  eq('  and no other role has it in either', roles.filter(r => { const n = navFor(r); return n.classic || n.rail; }), ['director', 'admin']);
  {
    const ctx = { window: {}, localStorage: { getItem: () => ctx.__s, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { href: '', pathname: '/x.html', search: '' }, navigator: { userAgent: 'node' }, fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
      document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} } },
      console, Date, JSON, Math, Object, Array, String, Number, Promise };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(AUTH, ctx);
    const admits = (role) => { ctx.__s = JSON.stringify({ username: 'u', name: 'U', role, token: 't', loginTime: Date.now() }); ctx.location.href = ''; return !!vm.runInContext('requireSupplierListAccess()', ctx); };
    eq('the guard admits admin and the director only', roles.filter(admits), ['director', 'admin']);
  }
  const H = read('supplier-list.html'), JS = read('js/supplier-list.js'), M = read('js/supplier-list-model.js'), CSS = read('css/supplier-list.css');
  ok('guarded by requireSupplierListAccess, its own navbar entry', /requireSupplierListAccess\(\)/.test(JS) && /renderNavbar\('supplier-list'\)/.test(JS));
  eq('scripts in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,client-rollup.js,supplier-list-model.js,supplier-list.js');
  ok('its own stylesheet, before ledger.css and apple.css (last)', /css\/supplier-list\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H));
  const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
  const named = (src) => { const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, ''); return HANDLERS.filter(h => new RegExp("'" + h + "'").test(code)).sort(); };
  eq('of ' + HANDLERS.length + ' FlowAPI actions the page names only its own four (the import is the director\'s, from the editor or a script)', named(JS + M),
     ['archiveSupplierBookSupplier', 'getSupplierBook', 'mergeSupplierBookSupplier', 'saveSupplierBookSupplier']);
  ok('  and never the old Suppliers tab', !/saveSupplier'|deleteSupplier|getSuppliers/.test(JS + M));
  const SRC = H + JS + M;
  ok('no emoji, no hex colour, no inline style, no inline script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{3,6}\b/.test(SRC.replace(/&#\d+;/g, '')) && !/style="/.test(SRC) && !/<script>/.test(H) && !/onclick=/.test(SRC));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
  ok('apple-design: press feedback (scale .97 over 100ms), translucent chrome with a soft edge, a cross-fade under reduced motion',
     /:active[^{]*\{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) && /backdrop-filter: blur\(20px\) saturate\(180%\)/.test(CSS) &&
     /\.sl-count::after, \.sl-dhead::after \{ content: ''/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.sl-sheet\.sl-enter \{ animation: sl-fade/.test(CSS));
  ok('  solid bars under reduced transparency, defined edges under more contrast, spacing in rem', /@media \(prefers-reduced-transparency: reduce\) \{ \.sl-dhead, \.sl-count \{ background: var\(--hx-card\); -webkit-backdrop-filter: none; backdrop-filter: none; \} \}/.test(CSS) &&
     /@media \(prefers-contrast: more\)/.test(CSS) && (CSS.match(/rem/g) || []).length > 100);
  ok('  Archive is undone with Restore (no confirm); only Merge is checked first', !/confirm\(/.test(JS) && /dryRun: true/.test(JS) && /Restore it below if that was a mistake/.test(JS));

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
