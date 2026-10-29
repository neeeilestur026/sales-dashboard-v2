/* A374 — the supplier list's store (FlowAPI 189: getSupplierBook / saveSupplierBookSupplier / mergeSupplierBookSupplier /
 * archiveSupplierBookSupplier / importSupplierBookHistory, and submitForPricing filing what it forwards).
 *
 * Run:  node tests/flow/supplier-book-store.js
 *
 * Neil, 26 Oct 2026: a suppliers list for admin (several contacts, phones and emails, address, local or international,
 * distributorship, delivery, payment terms, usual items), and "after the admin dashboard priced, then this product will
 * go to under this supplier with the priced and last updated price date". A new list apart from the old Suppliers tab;
 * a supplier a forward names that is not in the list is added and flagged; past requests fill it once, after a preview.
 * Runs the real FlowAPI.gs through its dispatcher (gasload), so the secret and the lock are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';   // the vm's Date is not this realm's
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const ADMIN = { actorName: 'Jiezzel Barrios-Regente', actorRole: 'admin', actorUsername: 'admin1' };
const ACCT = { actorName: 'Accounting One', actorRole: 'accounting', actorUsername: 'acct1' };
const SALES = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'sales2' };
const PEOPLE = JSON.stringify([
  { id: 'P1', name: 'Ana Reyes', position: 'Sales', emails: ['ana@yale-hw.ph', 'Ana.Reyes@Gmail.com'], phones: ['0917 111 2222', '(02) 8700 1234'] },
  { id: 'P2', name: 'Ben Cruz', position: 'Warehouse', emails: ['ben@yale-hw.ph'], phones: ['0918 333 4444'] }]);
const YALE = { supplier: 'Yale Hardware', type: 'Local', distributor: false, contactsJson: PEOPLE, address: '12 Rizal Ave, Manila',
               delivery: 'Delivered to our warehouse', terms: '30 days', usualItems: 'Hex bolts\nNuts\nWashers' };

/** A store with one request ready to forward: plant site set, a supplier quotation attached, four lines. */
function prStore(extra) {
  return Object.assign({
    ActivityLog: [], FlowSettings: [], Quotations: [],
    PricingRequests: [{ 'PR No': 'PR-202610-050', 'Date': new Date(2026, 9, 20), 'Requested By': 'Gerald Lucena', 'Customer': 'Semirara Mining',
                        'Status': 'Sourcing', 'Plant Site': 'Semirara Island', 'Updated At': new Date(2026, 9, 21) }],
    PricingRequestItems: [
      { 'PR No': 'PR-202610-050', 'Line': 1, 'Item No': '00412', 'Item Name': 'Hex bolt M10 x 50', 'Qty': 200, 'UOM': 'pcs', 'Included': true,
        'Supplier': 'Yale Hardware Corp.', 'Principal': 'Local', 'Currency': 'PHP', 'Supplier Price (FC)': 12.4, 'Supplier Price VAT': 'Inclusive' },
      { 'PR No': 'PR-202610-050', 'Line': 2, 'Item No': 'N/A', 'Item Name': 'Hex nut M10', 'Qty': 200, 'UOM': 'pcs', 'Included': true,
        'Supplier': 'Bolt King Trading', 'Principal': 'Local', 'Currency': 'PHP', 'Supplier Price (FC)': 3.1, 'Supplier Price VAT': 'Exclusive' },
      { 'PR No': 'PR-202610-050', 'Line': 3, 'Item No': '', 'Item Name': 'Flat washer M10', 'Qty': 200, 'UOM': 'pcs', 'Included': true,
        'Supplier': 'Yale Hardware', 'Principal': '', 'Currency': '', 'Supplier Price (FC)': 0 },
      { 'PR No': 'PR-202610-050', 'Line': 4, 'Item No': '', 'Item Name': 'Spring washer', 'Qty': 50, 'UOM': 'pcs', 'Included': false,
        'Supplier': 'Yale Hardware', 'Principal': 'Local', 'Currency': 'PHP', 'Supplier Price (FC)': 1.5 }],
    Documents: [{ 'Doc ID': 'DOC-1', 'Module': 'Pricing Request', 'Ref No': 'PR-202610-050', 'Doc Type': 'Supplier Quotation', 'File Name': 'sq.pdf' }]
  }, extra || {});
}

sec('1 · the version, an empty list, and who may read it');
{
  const store = {};
  const c = load(GS, store);
  ok('getVersion = 191', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 191);
  const g = call(c, 'getSupplierBook', ADMIN);
  ok('a read of an empty list answers empty and creates no tab', g.success && g.suppliers.length === 0 && g.prices.length === 0 && g.log.length === 0 &&
     !('SupplierBook' in store) && !('SupplierPrices' in store) && !('SupplierBookLog' in store), g);
  ok('  with the server\'s lists for the page', g.lists.types.join() === 'Local,International' && g.lists.delivery.length === 3 && g.lists.terms.indexOf('30 days') >= 0);
  ok('the director reads it too', call(c, 'getSupplierBook', NEIL).success);
  const s = call(c, 'getSupplierBook', SALES), a = call(c, 'getSupplierBook', ACCT);
  ok('a rep is refused, and so is accounting (the whole list)', !s.success && !a.success && /supplier list is for admin and director/.test(s.message), [s, a]);
  const al = call(c, 'getSupplierBook', Object.assign({ lite: true }, ACCT)), sl = call(c, 'getSupplierBook', Object.assign({ lite: true }, SALES));
  ok('  but accounting prices requests too, so it gets the names and last prices (lite); a rep does not', al.success && al.lite === true && !sl.success, [al, sl]);
  const blocked = call(c, 'getSupplierBook', Object.assign({ flowSecret: '' }, ADMIN));
  ok('the read is secured: no secret, no list', !blocked.success, blocked);
}

sec('2 · adding a supplier');
{
  const store = {};
  const c = load(GS, store);
  const r = call(c, 'saveSupplierBookSupplier', Object.assign({}, YALE, ADMIN));
  const row = (store.SupplierBook || [])[0] || {};
  ok('added, numbered SB-, the full width', r.success && /^SB-\d{6}-\d{3}$/.test(r.supplierNo) && row.__arity === 25, r);
  ok('  its key is the server\'s (_canonKey), from Manual, active, not needing details', row['Key'] === 'yale hardware' && row['Source'] === 'Manual' && row['Status'] === 'Active' && row['Needs Details'] === '');
  const people = JSON.parse(row['Contacts JSON']);
  ok('  two people, each with two emails (lower-cased) and two phones, the first made primary', people.length === 2 && people[0].emails.join() === 'ana@yale-hw.ph,ana.reyes@gmail.com' &&
     people[0].phones.length === 2 && people[0].primary === true, people);
  ok('  the usual items one per line; brands dropped when the distributorship is not ours', row['Usual Items'] === 'Hex bolts\nNuts\nWashers' && row['Brands'] === '' && row['Distributorship'] === '');
  ok('  one log row, created, the full width', store.SupplierBookLog.length === 1 && store.SupplierBookLog[0]['Kind'] === 'created' && store.SupplierBookLog[0].__arity === 9);
  ok('  the old Suppliers tab and the activity log are untouched', !('Suppliers' in store) && !(store.ActivityLog || []).length);
  const d = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'CEJN AB', type: 'International', distributor: 'Yes', brands: 'CEJN\nCEJN\ncejn', delivery: 'Other', deliveryNote: 'By sea freight to Manila port' }, ADMIN));
  const cejn = store.SupplierBook[1];
  ok('a supplier we distribute for keeps its brands (no repeats, any case)', d.success && cejn['Distributorship'] === 'Yes' && cejn['Brands'] === 'CEJN' && cejn['Delivery Note'] === 'By sea freight to Manila port', cejn);
  ok('  with neither a contact nor an address it needs details', cejn['Needs Details'] === 'Yes');
  const dup = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'YALE HARDWARE INC.' }, ADMIN));
  ok('the same supplier under another spelling is refused, naming the one there', !dup.success && dup.duplicate === r.supplierNo && /already in the supplier list/.test(dup.message), dup);
  const alias = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'Bolt King', aliases: 'Yale Hardware' }, ADMIN));
  ok('  and so is a spelling another supplier already has', !alias.success && alias.duplicate === r.supplierNo, alias);
  const twin = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'YALE HARDWARE INC.', allowDuplicate: true }, ADMIN));
  ok('  unless it is confirmed', twin.success && store.SupplierBook.length === 3);
}

sec('3 · what it refuses, and an edit');
{
  const store = {};
  const c = load(GS, store);
  const no = (label, params, re) => { const r = call(c, 'saveSupplierBookSupplier', Object.assign({}, ADMIN, params)); ok(label, !r.success && re.test(r.message), r); };
  no('no name', { supplier: '  ' }, /needs its name/);
  no('a type that is neither', { supplier: 'X Co', type: 'Overseas' }, /Local or International/);
  no('a delivery not on the list', { supplier: 'X Co', delivery: 'Courier' }, /Delivery is one of/);
  no('Other delivery with no note', { supplier: 'X Co', delivery: 'Other' }, /how this supplier delivers/);
  no('an email that is not one', { supplier: 'X Co', contactsJson: JSON.stringify([{ name: 'X', emails: ['nope'] }]) }, /not an email/);
  no('more than 30 people', { supplier: 'X Co', contactsJson: JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ name: 'P' + i }))) }, /A supplier can have up to 30/);
  ok('nothing was written by any of them', !(store.SupplierBook || []).length);
  const sales = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'X Co' }, SALES));
  ok('a rep cannot add one', !sales.success && !(store.SupplierBook || []).length, sales);
  const f = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: '=HYPERLINK("x")' }, ADMIN));
  ok('a name typed as a formula is stored as text', f.success && /^'=/.test(store.SupplierBook[0]['Supplier']));
  const y = call(c, 'saveSupplierBookSupplier', Object.assign({}, YALE, ADMIN));
  const e = call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: y.supplierNo, supplier: 'Yale Hardware', terms: 'COD' }, ADMIN));
  const row = store.SupplierBook[1];
  ok('an edit that sends only the terms keeps everything else', e.success && row['Payment Terms'] === 'COD' && row['Address'] === '12 Rizal Ave, Manila' &&
     JSON.parse(row['Contacts JSON']).length === 2 && row['Usual Items'] === 'Hex bolts\nNuts\nWashers', row);
  const lg = store.SupplierBookLog.filter(l => l['Supplier No'] === y.supplierNo);
  ok('  and its log says what changed', lg[lg.length - 1]['Kind'] === 'details' && /payment terms/.test(lg[lg.length - 1]['Note']), lg);
  const ppl = call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: y.supplierNo, supplier: 'Yale Hardware', contactsJson: JSON.stringify([JSON.parse(PEOPLE)[0]]), address: '' }, ADMIN));
  const lg2 = store.SupplierBookLog.filter(l => l['Supplier No'] === y.supplierNo && l['Kind'] === 'contacts');
  ok('a person removed is a contacts log row naming them', ppl.success && lg2.length === 1 && /Removed Ben Cruz/.test(lg2[0]['Note']), lg2);
  call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: y.supplierNo, supplier: 'Yale Hardware', contactsJson: '[]' }, ADMIN));
  ok('with no people and no address left, it needs details again', store.SupplierBook[1]['Needs Details'] === 'Yes');
}

sec('4 · a forward files its prices under the suppliers');
{
  const store = prStore();
  const c = load(GS, store);
  const y = call(c, 'saveSupplierBookSupplier', Object.assign({}, YALE, ADMIN));
  const f = call(c, 'submitForPricing', Object.assign({ prNo: 'PR-202610-050' }, ADMIN));
  ok('the request goes to management as before', f.success && store.PricingRequests[0]['Status'] === 'For Mgmt Pricing' && f.ready === 1 + 1 && f.waiting === 1, f);
  const sp = store.SupplierPrices || [];
  ok('only the ready lines are filed (an unpriced line and a line left out are not)', sp.length === 2 && sp.map(r => r['Line']).join() === '1,2', sp);
  ok('  every price row is the full width and numbered SP-', sp.every(r => r.__arity === 18 && /^SP-\d{6}-\d{3}$/.test(r['Price No'])));
  ok('"Yale Hardware Corp." goes under Yale Hardware (one comparison key)', sp[0]['Supplier No'] === y.supplierNo && sp[0]['Supplier'] === 'Yale Hardware Corp.');
  ok('  with the price, its currency, the VAT, the date and who priced it', sp[0]['Supplier Price (FC)'] === 12.4 && sp[0]['Currency'] === 'PHP' && sp[0]['VAT'] === 'Inclusive' &&
     isDate(sp[0]['Priced At']) && sp[0]['Priced By'] === ADMIN.actorName && sp[0]['Customer'] === 'Semirara Mining', sp[0]);
  ok('  the item is known by its code (kept as written) or, with N/A, by its name', sp[0]['Item No'] === '00412' && sp[0]['Item Key'] === 'code:412' && sp[1]['Item Key'] === 'name:hex nut m10', [sp[0]['Item Key'], sp[1]['Item Key']]);
  const bk = store.SupplierBook.filter(r => r['Supplier'] === 'Bolt King Trading')[0];
  ok('a supplier not in the list is added, flagged as needing details, from the forward', !!bk && bk['Needs Details'] === 'Yes' && bk['Source'] === 'Forwarded PR' && bk.__arity === 25, bk);
  ok('  the response says so', f.recorded.prices === 2 && f.recorded.newSuppliers.length === 1 && f.recorded.newSuppliers[0].supplier === 'Bolt King Trading', f.recorded);
  const lg = store.SupplierBookLog.map(l => l['Kind'] + ':' + l['Supplier No']);
  ok('  log rows: Yale created, Bolt King created, then one "priced" per supplier', lg.join() === ['created:' + y.supplierNo, 'created:' + bk['Supplier No'], 'priced:' + y.supplierNo, 'priced:' + bk['Supplier No']].join(), lg);
  ok('  and the forward is still in the activity log', store.ActivityLog.some(a => a['Action'] === 'Forwarded' && a['Ref No'] === 'PR-202610-050'));
  /* management sends it back; admin changes one price and forwards again */
  store.PricingRequests[0]['Status'] = 'Sourcing';
  store.PricingRequestItems[0]['Supplier Price (FC)'] = 11.9;
  const firstNo = sp[0]['Price No'], firstAt = sp[0]['Priced At'];
  const again = call(c, 'submitForPricing', Object.assign({ prNo: 'PR-202610-050' }, NEIL));
  ok('forwarded again: the changed line is rewritten in place, the unchanged one left alone', again.success && store.SupplierPrices.length === 2 && store.SupplierPrices[0]['Price No'] === firstNo &&
     store.SupplierPrices[0]['Supplier Price (FC)'] === 11.9 && store.SupplierPrices[0]['Priced By'] === NEIL.actorName && again.recorded.prices === 1 && again.recorded.unchanged === 1, again.recorded);
  ok('  no second Bolt King', store.SupplierBook.filter(r => /bolt king/i.test(r['Supplier'])).length === 1 && isDate(firstAt));
}

sec('5 · a filing error never stops a forward');
{
  const store = prStore();
  const c = load(GS, store);
  c._sbRecordForward = () => { throw new Error('Sheets said no'); };
  const f = call(c, 'submitForPricing', Object.assign({ prNo: 'PR-202610-050' }, ADMIN));
  ok('the request still reaches management, and the error is reported', f.success && store.PricingRequests[0]['Status'] === 'For Mgmt Pricing' && /Sheets said no/.test(f.recorded.error), f);
}

sec('6 · the sourcing table\'s read (lite)');
{
  const store = prStore();
  const c = load(GS, store);
  call(c, 'saveSupplierBookSupplier', Object.assign({}, YALE, { aliases: 'Yale HW' }, ADMIN));
  call(c, 'submitForPricing', Object.assign({ prNo: 'PR-202610-050' }, ADMIN));
  store.SupplierPrices.push(Object.assign({}, store.SupplierPrices[0], { 'Price No': 'SP-202609-001', 'PR No': 'PR-202609-010', 'Line': 1, 'Supplier Price (FC)': 14, 'Priced At': new Date(2026, 8, 3) }));
  const g = call(c, 'getSupplierBook', Object.assign({ lite: true }, ACCT));
  ok('names and other spellings of the live suppliers', g.success && g.suppliers.length === 2 && g.suppliers[0].aliases.join() === 'Yale HW', g.suppliers);
  const yale = g.latest.filter(x => x.supplierNo === g.suppliers[0].supplierNo && x.itemKey === 'code:412');
  ok('  and one last price per supplier and item, the newest', yale.length === 1 && yale[0].price === 12.4 && yale[0].prNo === 'PR-202610-050', yale);
  ok('  no contact people in it', !('contacts' in g.suppliers[0]) && !('prices' in g));
}

sec('7 · merging one supplier entered twice');
{
  const store = prStore();
  const c = load(GS, store);
  const y = call(c, 'saveSupplierBookSupplier', Object.assign({}, YALE, ADMIN)).supplierNo;
  call(c, 'submitForPricing', Object.assign({ prNo: 'PR-202610-050' }, ADMIN));
  const bk = store.SupplierBook.filter(r => r['Supplier'] === 'Bolt King Trading')[0]['Supplier No'];
  call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: bk, supplier: 'Bolt King Trading', contactsJson: JSON.stringify([{ name: 'Carl Lim', emails: ['carl@boltking.ph'] }]), usualItems: 'Nuts\nAnchors' }, ADMIN));
  const before = JSON.stringify(store);
  const dry = call(c, 'mergeSupplierBookSupplier', Object.assign({ fromNo: bk, intoNo: y, dryRun: true }, ADMIN));
  ok('a dry run says exactly what would move and writes nothing', dry.success && dry.dryRun && dry.plan.prices === 1 && dry.plan.names.join() === 'Bolt King Trading' && dry.plan.contacts === 1 &&
     JSON.stringify(store) === before, dry);
  const m = call(c, 'mergeSupplierBookSupplier', Object.assign({ fromNo: bk, intoNo: y }, ADMIN));
  const into = store.SupplierBook.filter(r => r['Supplier No'] === y)[0], from = store.SupplierBook.filter(r => r['Supplier No'] === bk)[0];
  ok('the prices move to the other supplier', m.success && store.SupplierPrices.every(r => r['Supplier No'] === y), store.SupplierPrices.map(r => r['Supplier No']));
  ok('  the name becomes one of its spellings, the person and the items are added', into['Aliases'] === 'Bolt King Trading' && JSON.parse(into['Contacts JSON']).length === 3 &&
     into['Usual Items'] === 'Hex bolts\nNuts\nWashers\nAnchors', into);
  ok('  the first is archived, saying where it went', from['Status'] === 'Archived' && /Merged into SB-/.test(from['Archive Reason']) && from.__arity === 25, from);
  ok('  a log row on each', store.SupplierBookLog.filter(l => l['Kind'] === 'merged').length === 2);
  store.PricingRequests.push({ 'PR No': 'PR-202610-060', 'Customer': 'Petron', 'Status': 'Sourcing', 'Plant Site': 'Limay' });
  store.PricingRequestItems.push({ 'PR No': 'PR-202610-060', 'Line': 1, 'Item No': '', 'Item Name': 'Anchor bolt', 'Qty': 10, 'Included': true, 'Supplier': 'bolt king trading', 'Principal': 'Local', 'Currency': 'PHP', 'Supplier Price (FC)': 20 });
  store.Documents.push({ 'Module': 'Pricing Request', 'Ref No': 'PR-202610-060', 'Doc Type': 'Supplier Quotation' });
  const f = call(c, 'submitForPricing', Object.assign({ prNo: 'PR-202610-060' }, ADMIN));
  ok('a later forward with the old spelling files under the merged supplier, adding nothing', f.success && f.recorded.newSuppliers.length === 0 && store.SupplierPrices[store.SupplierPrices.length - 1]['Supplier No'] === y, f.recorded);
  ok('merging into itself, or from an archived one, is refused', !call(c, 'mergeSupplierBookSupplier', Object.assign({ fromNo: y, intoNo: y }, ADMIN)).success &&
     !call(c, 'mergeSupplierBookSupplier', Object.assign({ fromNo: bk, intoNo: y }, ADMIN)).success);
}

sec('8 · archive and restore');
{
  const store = {};
  const c = load(GS, store);
  const y = call(c, 'saveSupplierBookSupplier', Object.assign({}, YALE, ADMIN)).supplierNo;
  ok('archiving needs a reason', !call(c, 'archiveSupplierBookSupplier', Object.assign({ supplierNo: y }, ADMIN)).success);
  const a = call(c, 'archiveSupplierBookSupplier', Object.assign({ supplierNo: y, reason: 'Closed down' }, ADMIN));
  ok('archived with who, when and why', a.success && store.SupplierBook[0]['Status'] === 'Archived' && store.SupplierBook[0]['Archive Reason'] === 'Closed down' && store.SupplierBook[0]['Archived By'] === ADMIN.actorName);
  ok('  an archived supplier is not edited', !call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: y, supplier: 'Yale Hardware' }, ADMIN)).success);
  const r = call(c, 'archiveSupplierBookSupplier', Object.assign({ supplierNo: y, restore: true }, ADMIN));
  ok('restored, and nothing was ever deleted', r.success && store.SupplierBook.length === 1 && store.SupplierBook[0]['Status'] === 'Active' && store.SupplierBook[0]['Archived At'] === '' &&
     store.SupplierBookLog.map(l => l['Kind']).join() === 'created,archived,restored');
}

sec('9 · filling the list from past requests');
{
  const hdr = (no, status, cust) => ({ 'PR No': no, 'Date': new Date(2026, 6, 1), 'Customer': cust, 'Status': status, 'Updated At': new Date(2026, 6, 9) });
  const line = (no, ln, sup, price, extra) => Object.assign({ 'PR No': no, 'Line': ln, 'Item No': '', 'Item Name': 'Item ' + no + '/' + ln, 'Qty': 1, 'UOM': 'pc', 'Included': true,
    'Supplier': sup, 'Principal': 'Local', 'Currency': 'PHP', 'Supplier Price (FC)': price }, extra || {});
  const store = {
    FlowSettings: [], Quotations: [], Documents: [],
    SupplierBook: [], SupplierBookLog: [], SupplierPrices: [],
    PricingRequests: [hdr('PR-202607-001', 'Quoted', 'Semirara'), hdr('PR-202607-002', 'Mgmt Priced', 'Petron'), hdr('PR-202607-003', 'Requested', 'Aboitiz'),
                      hdr('PR-202608-004', 'For Mgmt Pricing', 'Therma')],
    PricingRequestItems: [line('PR-202607-001', 1, 'Yale Hardware', 10), line('PR-202607-001', 2, 'YALE HARDWARE INC.', 11), line('PR-202607-002', 1, 'Yale Hardwares', 12),
                          line('PR-202607-002', 2, 'Yale Hardware', 13, { 'Included': false }), line('PR-202607-003', 1, 'Yale Hardware', 14),
                          line('PR-202608-004', 1, 'Tool Masters', 15), line('PR-202608-004', 2, '', 16), line('PR-202608-004', 3, 'Tool Masters', 0)],
    ActivityLog: [{ 'Timestamp': new Date(2026, 6, 3, 10), 'User': 'Admin One', 'Module': 'Pricing Request', 'Action': 'Forwarded', 'Ref No': 'PR-202607-001' },
                  { 'Timestamp': new Date(2026, 6, 5, 9), 'User': 'Admin Two', 'Module': 'Pricing Request', 'Action': 'Forwarded', 'Ref No': 'PR-202607-001' }]
  };
  const c = load(GS, store);
  call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'Tool Masters Inc' }, ADMIN));
  ok('only the director runs it', !call(c, 'importSupplierBookHistory', ADMIN).success);
  const before = JSON.stringify(store);
  const dry = call(c, 'importSupplierBookHistory', NEIL);
  ok('a dry run is the default and writes nothing', dry.success && dry.dryRun === true && JSON.stringify(store) === before, dry);
  ok('  only included, priced lines on requests already forwarded (4 of 8)', dry.lines === 4, dry);
  const yale = dry.suppliers.filter(s => s.supplier === 'Yale Hardware')[0];
  ok('  "Yale Hardware" and "YALE HARDWARE INC." are one supplier, with both spellings', yale && yale.lines === 2 && yale.spellings.length === 2 && !yale.supplierNo, dry.suppliers);
  ok('  "Tool Masters" goes under the supplier already in the list', dry.suppliers.some(s => s.supplier === 'Tool Masters Inc' && /^SB-/.test(s.supplierNo) && s.lines === 1));
  ok('  "Yale Hardwares" is asked about, never merged by itself', dry.possibleSame.some(p => p.join('|') === 'Yale Hardware|Yale Hardwares') && dry.newSuppliers === 2, dry.possibleSame);
  ok('  it counts the lines whose price may be management\'s (priced or quoted already)', dry.maybeManagementPrice === 3, dry.maybeManagementPrice);
  const run = call(c, 'importSupplierBookHistory', Object.assign({ dryRun: false, merges: { 'Yale Hardwares': 'Yale Hardware' } }, NEIL));
  ok('the real run, with the merge a person confirmed', run.success && run.lines === 4 && run.newSuppliers === 1, run);
  const y = store.SupplierBook.filter(r => r['Supplier'] === 'Yale Hardware')[0];
  ok('  one Yale Hardware, from Import, needing details, with its other spellings', y && y['Source'] === 'Import' && y['Needs Details'] === 'Yes' && y['Aliases'].split('\n').sort().join() === 'YALE HARDWARE INC.,Yale Hardwares' && y.__arity === undefined, y);
  const yp = store.SupplierPrices.filter(r => r['Supplier No'] === y['Supplier No']);
  ok('  its three prices, dated by the latest "Forwarded", else the request\'s last update', yp.length === 3 && yp[0]['Priced At'].getDate() === 5 && yp[0]['Priced By'] === 'Admin Two' &&
     yp[2]['Priced At'].getDate() === 9 && yp.every(r => r['Source'] === 'Import'), yp.map(r => [r['PR No'], String(r['Priced At']), r['Priced By']]));
  ok('  numbers unique, rows full width', new Set(store.SupplierPrices.map(r => r['Price No'])).size === store.SupplierPrices.length &&
     store.SupplierPrices.every(r => Object.keys(r).filter(k => k !== 'rowIndex').length >= 18));
  ok('  one "imported" log row per supplier', store.SupplierBookLog.filter(l => l['Kind'] === 'imported').length === 2);
  const again = call(c, 'importSupplierBookHistory', Object.assign({ dryRun: false }, NEIL));
  ok('a second run changes nothing', again.success && again.lines === 0 && store.SupplierPrices.length === 4, again);
}

sec('10 · loading the company\'s supplier file');
{
  const store = { FlowSettings: [], Quotations: [], Documents: [], SupplierBook: [], SupplierBookLog: [], SupplierPrices: [] };
  const c = load(GS, store);
  const y = call(c, 'saveSupplierBookSupplier', Object.assign({ supplier: 'Yale Hardware', aliases: 'Yale HW', usualItems: 'Hex bolts', distributor: false, contactsJson: PEOPLE }, ADMIN)).supplierNo;
  store.SupplierPrices.push({ 'Price No': 'SP-1', 'Supplier No': y, 'Supplier': 'Yale Hardware', 'Item Key': 'code:412', 'Supplier Price (FC)': 12.4, 'PR No': 'PR-1', 'Line': 1 });
  const FILE = [
    { supplier: 'YALE HARDWARE CORP', type: 'Local', contacts: [{ name: 'Victor Cataros', emails: ['sales@yalehardwareph.com'], phones: ['0938 723 4119'] }],
      address: '1205-1217 C.M. Recto Ave, Sta. Cruz, Manila', terms: 'Bank transfer / COD' },
    { supplier: 'ARC Infinite Goods Trading OPC', type: 'Local', contacts: [{ name: 'Louie Tating', emails: ['arc@gmail.com'] }], address: 'Quirino Highway', terms: 'Bank transfer / COD', tin: '631-685-319-0001' },
    { supplier: 'CEJN Product Far East Pte Ltd', type: 'International', contacts: [{ name: 'Ramli Bin Haron', emails: ['ramli.haron@cejn.com'], phones: ['+65 9643 0027'] }],
      address: '158 Kallang Way, Singapore', terms: 'Ex works', delivery: 'Pickup at their warehouse', notes: 'Supplier ID in the supplier file: SUPP-001' }];
  ok('only the director loads it', !call(c, 'importSupplierBookList', Object.assign({ suppliers: FILE }, ADMIN)).success);
  const before = JSON.stringify(store);
  const dry = call(c, 'importSupplierBookList', Object.assign({ suppliers: JSON.stringify(FILE) }, NEIL));
  ok('a dry run is the default, writes nothing, and says what it would add and overwrite', dry.success && dry.dryRun && JSON.stringify(store) === before &&
     dry.add.join() === 'ARC Infinite Goods Trading OPC,CEJN Product Far East Pte Ltd' && dry.overwrite.length === 1 && dry.overwrite[0].supplierNo === y && dry.overwrite[0].was === 'Yale Hardware', dry);
  const bad = call(c, 'importSupplierBookList', Object.assign({ dryRun: false, suppliers: FILE.concat([{ supplier: 'Bad Mail Co', contacts: [{ name: 'X', emails: ['nope'] }] }, { supplier: 'yale hardware inc.' }]) }, NEIL));
  ok('one bad row refuses the whole file, naming every problem, and writes nothing', !bad.success && bad.problems.length === 2 && /Row 4 \(Bad Mail Co\): "nope" is not an email/.test(bad.problems[0]) &&
     /Row 5 \(yale hardware inc\.\): the same supplier as Row 1/.test(bad.problems[1]) && JSON.stringify(store) === before, bad);
  const run = call(c, 'importSupplierBookList', Object.assign({ dryRun: false, suppliers: FILE }, NEIL));
  const yr = store.SupplierBook.filter(r => r['Supplier No'] === y)[0];
  ok('the real run: 2 added, 1 overwritten', run.success && run.added === 2 && run.overwritten === 1 && store.SupplierBook.length === 3, run);
  ok('  the one on the list takes the file\'s name, people, address and terms; the old name becomes another spelling', yr['Supplier'] === 'YALE HARDWARE CORP' && yr['Aliases'].split('\n').sort().join() === 'Yale HW,Yale Hardware' &&
     JSON.parse(yr['Contacts JSON']).map(p => p.name).join() === 'Victor Cataros' && yr['Payment Terms'] === 'Bank transfer / COD' && /Recto/.test(yr['Address']), yr);
  ok('  its prices and usual items stay', store.SupplierPrices[0]['Supplier No'] === y && yr['Usual Items'] === 'Hex bolts');
  const arc = store.SupplierBook.filter(r => /^ARC/.test(r['Supplier']))[0], cejn = store.SupplierBook.filter(r => /^CEJN/.test(r['Supplier']))[0];
  ok('  new ones: from the supplier file, the TIN kept, the delivery and the note as given, full width', arc['Source'] === 'Supplier file' && arc['TIN'] === '631-685-319-0001' && arc['Type'] === 'Local' &&
     cejn['Delivery'] === 'Pickup at their warehouse' && /SUPP-001/.test(cejn['Notes']) && cejn['Needs Details'] === '' && Object.keys(arc).filter(k => k !== 'rowIndex').length === 25, [arc, cejn]);
  ok('  a log row each, "file"', store.SupplierBookLog.filter(l => l['Kind'] === 'file').length === 3 && /it was "Yale Hardware"/.test(store.SupplierBookLog.filter(l => l['Kind'] === 'file' && l['Supplier No'] === y)[0]['Note']));
  const again = call(c, 'importSupplierBookList', Object.assign({ dryRun: false, suppliers: FILE }, NEIL));
  ok('loading the same file again overwrites the three and adds none', again.success && again.added === 0 && again.overwritten === 3 && store.SupplierBook.length === 3, again);
  ok('  a past request\'s "Yale Hardware" still files under it, and "CEJN Product Far East Pte. Ltd." under the new CEJN', c._sbResolve(c._sbIndex(), 'Yale Hardware') === y && c._sbResolve(c._sbIndex(), 'CEJN Product Far East Pte. Ltd.') === cejn['Supplier No']);
}

sec('11 · FlowSettings can widen who uses it');
{
  const store = { FlowSettings: [{ Key: 'supplierBookRoles', Value: 'admin, director, management', 'Updated By': 'Neil', 'Updated At': '' }] };
  const c = load(GS, store);
  ok('management reads it once Neil adds it', call(c, 'getSupplierBook', { actorName: 'Mgmt One', actorRole: 'management' }).success);
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok'));
process.exit(FAIL ? 1 : 0);
