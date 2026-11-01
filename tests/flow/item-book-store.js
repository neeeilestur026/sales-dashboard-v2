/* A387 — the Item Book store (FlowAPI 194: getItemBook, getItemCard, getItemHistory, getItemPhotos, saveItemDetails, the
 * 'item' photo kind) and the resolver it shares with every stock movement.
 *
 * Run:  node tests/flow/item-book-store.js
 *
 * Neil, 1 Nov 2026: one card per product, "so that information and details can be easily found and identified";
 * supplier prices and landed cost for management and the director only; admin and the director edit the card.
 * Runs the real FlowAPI.gs through its dispatcher (gasload), so the secret and the roles are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const ADMIN = { actorName: 'Jiezzel Barrios-Regente', actorRole: 'admin', actorUsername: 'admin1' };
const ACCT = { actorName: 'Maria Santos', actorRole: 'accounting', actorUsername: 'acct1' };
const MGMT = { actorName: 'Larry Estur', actorRole: 'management', actorUsername: 'mgmt' };
const SALES = { actorName: 'Kimberlyn Blones', actorRole: 'sales', actorUsername: 'sales1' };
const WH = { actorName: 'Rico Dela Cruz', actorRole: 'warehouse', actorUsername: 'wh1' };
const HR = { actorName: 'Ana Reyes', actorRole: 'hr', actorUsername: 'hr1' };
const COST_KEYS = ['purchasePrice', 'shippingCost', 'landedCost', 'totalLanded', 'unitCost', 'supplierPrice', 'supplier', 'supplierVat', 'costCurrency', 'lineCost'];

const inv = (id, no, d, bal, landed, type) => ({ 'Item No': no, 'Description': d, 'Available Balance': bal, 'Purchase Price/Unit': landed, 'Shipping Cost/Unit': 0,
  'Landed Cost/Unit': landed, 'Total Landed Cost': bal * landed, 'Currency': 'PHP', 'Last Updated': '2026-10-20', 'Type': type || 'Stock', 'Item ID': id });
function store(extra) {
  return Object.assign({
    FlowSettings: [], ActivityLog: [],
    Inventory: [
      inv('ITM-00001', 'N/A', 'PIECE INSULATED PIER AND SCREWD', 34, 6625.16),            // the old "row 99"
      inv('ITM-00002', 'N/A', '1-TORCH;  HAND; CUTTING', 0, 0),                          // the torch's own row
      inv('ITM-00003', 'N/A', 'TORCH TIP; CUTTING; SIZE 2', 4, 350),
      inv('ITM-00004', 'CP872', 'Impact wrench CP872 1/2in', 5, 12000),
      inv('ITM-00005', 'TBA', 'Hydraulic hose 2m', 0, 0, 'Catalog'),
      inv('ITM-00006', 'TBA', 'Hydraulic hose 2m', 0, 0, 'Catalog'),                     // a twin: same name, same placeholder
      inv('ITM-00007', '123', 'Torque multiplier 123', 1, 50000)],
    ItemDetails: [{ 'Item ID': 'ITM-00004', 'Brand': 'Chicago Pneumatic', 'Model': 'CP872', 'Category': 'Impact wrench', 'Name': 'CP872 impact wrench',
                    'Photos': '', 'Created By': 'Rico Dela Cruz', 'Created At': '2026-10-02', 'Source': 'scanner' }],
    ItemBarcodes: [{ 'Barcode': '4006825555551', 'Item ID': 'ITM-00004', 'Item No': 'CP872', 'Description': 'Impact wrench CP872 1/2in', 'Added By': 'Rico', 'Added At': '2026-10-02' }],
    Labels: [{ 'Code': 'HX0123456789AB', 'Kind': 'ITEM', 'Item ID': 'ITM-00004', 'Asset No': '', 'Created By': 'Rico', 'Created At': '2026-10-02', 'Printed Count': 2, 'Last Printed At': '2026-10-03' }],
    Assets: [{ 'Asset No': 'AS-202610-001', 'Item ID': 'ITM-00004', 'Item No': 'CP872', 'Description': 'Impact wrench CP872 1/2in', 'Status': 'In warehouse', 'MR No': 'MR-202610-002',
               'Received At': '2026-10-02', 'Location': 'Warehouse', 'Last Ref': 'MR-202610-002', 'Last Move At': '2026-10-02', 'Photos': '' }],
    Documents: [
      { 'Doc ID': 'DOC-AAAA1111', 'Module': 'Warehouse Item', 'Ref No': 'ITM-00004', 'Doc Type': 'New item photo', 'File Name': 'a.jpg', 'Drive Link': 'https://drive.test/a', 'File ID': 'f-a', 'Uploaded By': 'Rico', 'Uploaded At': '2026-10-02T01:00:00Z' },
      { 'Doc ID': 'DOC-BBBB2222', 'Module': 'Warehouse Piece', 'Ref No': 'ITM-00004', 'Doc Type': 'Piece photo', 'File Name': 'b.jpg', 'Drive Link': 'https://drive.test/b', 'File ID': 'f-b', 'Uploaded By': 'Rico', 'Uploaded At': '2026-10-03T01:00:00Z' },
      { 'Doc ID': 'DOC-CCCC3333', 'Module': 'Purchase Order', 'Ref No': 'PO-202610-001', 'Doc Type': 'Receiving photo', 'File Name': 'c.jpg', 'Drive Link': 'https://drive.test/c', 'File ID': 'f-c', 'Uploaded By': 'Rico', 'Uploaded At': '2026-10-03T01:00:00Z' }],
    Quotations: [
      { 'Quotation No': '2026-590-KPB-THERMA', 'Date': '2026-10-10', 'Customer': 'Therma South, Inc.', 'Status': 'Sent', 'Created By': 'Kimberlyn Blones' },
      { 'Quotation No': '2026-591-KPB-PETRA', 'Date': '2026-10-12', 'Customer': 'Petra Cement Inc.', 'Status': 'Approved', 'Created By': 'Kimberlyn Blones' }],
    QuotationItems: [
      // the quote builder stamped the FIRST N/A row's id on an N/A line: suspect, and the name says which item it is
      { 'Quotation No': '2026-590-KPB-THERMA', 'Item No': 'N/A', 'Item Name': '1-torch; hand; cutting', 'Quoted Qty': 1, 'Quoted Price': 120000, 'Item ID': 'ITM-00001', 'UOM': 'pc' },
      { 'Quotation No': '2026-591-KPB-PETRA', 'Item No': 'cp872', 'Item Name': 'Impact wrench', 'Quoted Qty': 2, 'Quoted Price': 18500, 'Item ID': '' },
      { 'Quotation No': '2026-591-KPB-PETRA', 'Item No': '00123', 'Item Name': 'Torque multiplier', 'Quoted Qty': 1, 'Quoted Price': 75000, 'Item ID': '' }],
    SalesOrders: [{ 'SO No': '150005851', 'Quotation No': '2026-590-KPB-THERMA', 'Date': '2026-10-15', 'Customer': 'Therma South, Inc.', 'Status': 'Open', 'Created By': 'Kimberlyn Blones' }],
    SalesOrderItems: [
      // the same bad id on a line whose name is nobody's: "marked as this item, may be another"
      { 'SO No': '150005851', 'Item No': 'N/A', 'Item Name': 'Mobile welding rig', 'Qty': 1, 'Price/Unit': 90000, 'Item ID': 'ITM-00001' }],
    Invoices: [{ 'INV No': '139', 'SO No': '150005851', 'Date': '2026-10-20', 'Customer': 'Therma South, Inc.', 'Voided': '' }],
    InvoiceItems: [
      // an invoice line carries the row it was COSTED from: trusted as it is, even with a different name
      { 'INV No': '139', 'Item No': 'N/A', 'Item Name': 'TORCH; HAND; CUTTING', 'Qty': 1, 'Selling Price': 120000, 'Line Sales': 120000, 'Landed Cost/Unit': 6625.16, 'Line COGS': 6625.16, 'Item ID': 'ITM-00001' }],
    PricingRequests: [{ 'PR No': 'PR-202610-050', 'Date': '2026-10-05', 'Customer': 'Petra Cement Inc.', 'Status': 'Returned to Sales', 'Salesperson': 'Kimberlyn Blones' }],
    PricingRequestItems: [
      { 'PR No': 'PR-202610-050', 'Line': 1, 'Item No': 'CP872', 'Item Name': 'Impact wrench CP872', 'Qty': 2, 'UOM': 'pc', 'Supplier': 'Atlas Copco PH', 'Supplier Price (FC)': 11000, 'Currency': 'PHP', 'Final Price': 18500, 'Item ID': '' },
      { 'PR No': 'PR-202610-050', 'Line': 2, 'Item No': 'TBA', 'Item Name': 'Hydraulic hose 2m', 'Qty': 4, 'UOM': 'pc', 'Final Price': 900, 'Item ID': '' }],
    PurchaseOrders: [{ 'PO No': 'PO-202610-001', 'SO No': '', 'Date': '2026-10-01', 'Supplier': 'Atlas Copco PH', 'Currency': 'PHP', 'Status': 'Approved' }],
    PurchaseOrderItems: [{ 'PO No': 'PO-202610-001', 'Item No': 'CP872', 'Item Name': 'Impact wrench CP872', 'Qty': 5, 'Purchase Price/Unit (FC)': 11000, 'Total (FC)': 55000, 'Item ID': 'ITM-00004' }],
    MaterialsReceiving: [{ 'MR No': 'MR-202610-002', 'PO No': 'PO-202610-001', 'Date': '2026-10-02', 'Supplier': 'Atlas Copco PH', 'Received By': 'Maria Santos', 'SO No': '' }],
    ReceivingItems: [{ 'MR No': 'MR-202610-002', 'Item No': 'CP872', 'Item Name': 'Impact wrench CP872', 'Qty Received': 5, 'Purchase Price/Unit (PHP)': 11000, 'Landed Cost/Unit': 12000, 'Item ID': 'ITM-00004' }],
    SupplierPrices: [{ 'Price No': 'SP-202610-001', 'Supplier No': 'SB-202610-001', 'Supplier': 'Atlas Copco PH', 'Item Key': 'code:cp872', 'Item No': 'CP872', 'Item Name': 'Impact wrench CP872',
                       'UOM': 'pc', 'Qty': 2, 'Currency': 'PHP', 'Supplier Price (FC)': 11000, 'VAT': 'Inclusive', 'PR No': 'PR-202610-050', 'Line': 1, 'Customer': 'Petra Cement Inc.',
                       'Priced By': 'Jiezzel', 'Priced At': '2026-10-06', 'Source': 'forward' }]
  }, extra || {});
}
const costKeysIn = (o, out) => { out = out || []; if (Array.isArray(o)) o.forEach(x => costKeysIn(x, out)); else if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (COST_KEYS.indexOf(k) >= 0) out.push(k); costKeysIn(o[k], out); }); return out; };

sec('1 · the version, and who may open the book');
{
  const c = load(GS, store());
  ok('getVersion = 194', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 194);
  [SALES, ADMIN, ACCT, MGMT, NEIL, WH].forEach(who => ok(who.actorRole + ' opens it', call(c, 'getItemBook', who).success));
  const h = call(c, 'getItemBook', HR);
  ok('hr is refused, and told who may', !h.success && /open to sales, admin, accounting, management, director, warehouse/.test(h.message), h);
  ok('the read is secured: no secret, no list', !call(c, 'getItemBook', Object.assign({ flowSecret: '' }, SALES)).success);
  const l = call(c, 'getItemBook', SALES);
  ok('every item comes back, with its details and counts', l.items.length === 7 && l.items.find(x => x.itemId === 'ITM-00004').brand === 'Chicago Pneumatic' &&
     l.items.find(x => x.itemId === 'ITM-00004').barcodes === 1 && l.items.find(x => x.itemId === 'ITM-00004').photos === 2, l.items.find(x => x.itemId === 'ITM-00004'));
  ok('  with the scanner\'s brand and type lists', l.lists.brands.length > 3 && l.lists.categories.length > 3);
  const st2 = store(); st2.Inventory.push(inv('', 'N/A', 'Old pipe wrench 24in', 3, 800));
  ok('  and how many rows have no id yet (they need backfillItemIds before they can have a card)', call(load(GS, st2), 'getItemBook', SALES).noId === 1 && l.noId === 0);
  const off = load(GS, store({ FlowSettings: [{ 'Key': 'itemBook', 'Value': 'off' }] }));
  ok('FlowSettings itemBook off closes it', /switched off/.test(call(off, 'getItemBook', NEIL).message));
  const narrow = load(GS, store({ FlowSettings: [{ 'Key': 'itemBookRoles', 'Value': 'director' }] }));
  ok('itemBookRoles narrows it', !call(narrow, 'getItemBook', SALES).success && call(narrow, 'getItemBook', NEIL).success);
}

sec('2 · costs reach management and the director only');
{
  const c = load(GS, store());
  [SALES, ADMIN, ACCT, WH].forEach(who => {
    const replies = [call(c, 'getItemBook', who), call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00004' }, who))]
      .concat(['sell', 'buy', 'move'].map(part => call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: part }, who))));
    const found = costKeysIn(replies);
    ok(who.actorRole + ': no cost key anywhere in the list, the card or the history', replies.every(r => r.success) && found.length === 0, found);
  });
  const d = call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00004' }, NEIL));
  ok('the director sees the landed cost on the card', d.item.landedCost === 12000 && d.item.costCurrency === 'PHP', d.item);
  const b = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: 'buy' }, MGMT));
  ok('management sees what we paid: the PO, the receiving and the supplier price', b.lines.length === 3 &&
     b.lines.some(x => x.kind === 'po' && x.unitCost === 11000 && x.supplier === 'Atlas Copco PH') &&
     b.lines.some(x => x.kind === 'supplier price' && x.supplierPrice === 11000), b.lines);
  const a = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: 'buy' }, ADMIN));
  ok('admin sees the same three lines without the money or the supplier', a.lines.length === 3 && a.lines.every(x => x.unitCost === undefined && x.supplier === undefined), a.lines);
  const s = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: 'sell' }, SALES));
  ok('a rep sees what we quoted and asked (prices to the client), not the supplier price', s.lines.some(x => x.kind === 'quotation' && x.price === 18500) &&
     s.lines.some(x => x.kind === 'request' && x.price === 18500 && x.supplierPrice === undefined), s.lines);
  const narrow = load(GS, store({ FlowSettings: [{ 'Key': 'itemBookCostRoles', 'Value': 'director' }] }));
  ok('itemBookCostRoles narrows it', costKeysIn(call(narrow, 'getItemCard', Object.assign({ itemId: 'ITM-00004' }, MGMT))).length === 0);
}

sec('3 · history: which lines are this item (the resolver, never the first match)');
{
  const c = load(GS, store());
  const torch = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00002', part: 'sell' }, NEIL));
  ok('a line stamped with the first N/A row\'s id is the torch, by its exact name, and says its id was suspect', torch.lines.length === 1 &&
     torch.lines[0].ref === '2026-590-KPB-THERMA' && torch.lines[0].how === 'name' && torch.lines[0].suspect === 'ITM-00001', torch.lines);
  const pier = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00001', part: 'sell' }, NEIL));
  ok('row 99 keeps only the line truly costed from it (the invoice, trusted as it is)', pier.lines.length === 1 && pier.lines[0].kind === 'invoice' && pier.lines[0].how === 'id', pier.lines);
  ok('  and lists the order line carrying its id under a name nobody has, apart', pier.unclearCount === 1 && pier.unclear[0].ref === '150005851', pier.unclear);
  ok('  the quotation that was really the torch is not counted as row 99', !pier.lines.concat(pier.unclear).some(x => x.ref === '2026-590-KPB-THERMA'));
  const cp = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: 'sell' }, NEIL));
  ok('a code typed in lower case still finds its item', cp.lines.some(x => x.ref === '2026-591-KPB-PETRA' && x.how === 'code'), cp.lines);
  const tm = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00007', part: 'sell' }, NEIL));
  ok('leading zeros on a code are ignored (00123 is 123)', tm.lines.length === 1 && tm.lines[0].price === 75000, tm.lines);
  const hose = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00005', part: 'sell' }, NEIL));
  const twin = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00006', part: 'sell' }, NEIL));
  ok('TBA is no code: a line two rows fit by name is neither\'s (no guess)', hose.lines.length === 0 && twin.lines.length === 0, [hose.lines, twin.lines]);
  const mv = call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: 'move' }, NEIL));
  ok('the moves part answers (no dispatches yet)', mv.success && mv.lines.length === 0 && typeof mv.ms === 'number', mv);
  ok('a part that does not exist is refused', !call(c, 'getItemHistory', Object.assign({ itemId: 'ITM-00004', part: 'all' }, NEIL)).success);
}

sec('4 · one card');
{
  const c = load(GS, store());
  const s = call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00004' }, SALES));
  ok('the card: name, code, details, stock, barcode, pieces, photos', s.item.description === 'Impact wrench CP872 1/2in' && s.item.displayName === 'CP872 impact wrench' &&
     s.item.balance === 5 && s.barcodes.length === 1 && s.pieces.length === 1 && s.pieces[0].status === 'In warehouse' && s.photos.length === 2, s);
  ok('  newest photo first, and only the item\'s own (not a PO\'s receiving photo)', s.photos[0].docId === 'DOC-BBBB2222' && !s.photos.some(x => x.docId === 'DOC-CCCC3333'));
  ok('  a rep sees that a label exists, not its code', s.labels.length === 1 && s.labels[0].code === '' && s.labels[0].printed === 2, s.labels);
  ok('  the warehouse sees the code', call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00004' }, WH)).labels[0].code === 'HX0123456789AB');
  const byLine = call(c, 'getItemCard', Object.assign({ itemNo: 'N/A', itemName: '1-torch;  hand; cutting' }, SALES));
  ok('from a document line (no id): found by the same rules', byLine.item && byLine.item.itemId === 'ITM-00002' && byLine.resolved.how === 'name', byLine);
  const amb = call(c, 'getItemCard', Object.assign({ itemNo: 'TBA', itemName: 'Hydraulic hose 2m' }, SALES));
  ok('  a line two rows fit opens no card, and lists both', amb.item === null && amb.resolved.how === 'ambiguous' && amb.resolved.candidates.length === 2, amb);
  const hose = call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00005' }, SALES));
  ok('a card names its twins (same name)', hose.twins.length === 1 && hose.twins[0].itemId === 'ITM-00006', hose.twins);
  ok('an unknown id answers with no item', call(c, 'getItemCard', Object.assign({ itemId: 'ITM-09999' }, SALES)).item === null);
}

sec('5 · changing a card: admin and the director');
{
  const st = store(), c = load(GS, st);
  const before = JSON.stringify(st.Inventory);
  const r = call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00002', name: 'Cutting torch, hand', brand: 'Others', brandOther: 'Harris', model: '62-5F',
    category: 'Others', categoryOther: 'Cutting torch', specsJson: JSON.stringify([['Gas', 'Oxy-acetylene'], ['Length', '21 in']]), notes: 'For Therma South.' }, ADMIN));
  const row = (st.ItemDetails || []).find(x => x['Item ID'] === 'ITM-00002');
  ok('admin saves a new card: a 14-wide ItemDetails row in SCHEMA order', r.success && row && row.__arity === 14 && row['Name'] === 'Cutting torch, hand' &&
     row['Brand'] === 'Harris' && row['Category'] === 'Cutting torch' && row['Source'] === 'item book' && JSON.parse(row['Specs JSON']).length === 2, [r, row]);
  ok('  Inventory is never written (documents keep printing the Description)', JSON.stringify(st.Inventory) === before);
  ok('  one log row per change', (st.ItemBookLog || []).filter(x => x['Item ID'] === 'ITM-00002').length === 6 && /^IBL-\d{14}-[0-9A-F]{4}$/.test(st.ItemBookLog[0]['Log No']), st.ItemBookLog);
  row['Updated At'] = new Date(Date.now() - 60000);   // the first save a minute ago, so the next one cannot share its millisecond
  const card = call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00002' }, SALES));
  ok('  and the card reads it back', card.item.displayName === 'Cutting torch, hand' && card.item.specs[1][1] === '21 in' && card.log.length === 6, card.item);
  const n2 = call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00002', notes: 'Kept in bay 3.', ifUpdatedAt: card.item.updatedAt }, NEIL));
  ok('a field not sent keeps its value (the director changes only the notes)', n2.success && n2.changed.join() === 'notes' &&
     st.ItemDetails.find(x => x['Item ID'] === 'ITM-00002')['Name'] === 'Cutting torch, hand', n2);
  const stale = call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00002', notes: 'x', ifUpdatedAt: card.item.updatedAt }, ADMIN));
  ok('a save over someone else\'s newer one is refused', !stale.success && stale.stale === true && /Neil Estur changed this card/.test(stale.message), stale);
  ok('saving the same again changes nothing and logs nothing', call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00002', notes: 'Kept in bay 3.' }, NEIL)).unchanged === true &&
     st.ItemBookLog.filter(x => x['Item ID'] === 'ITM-00002').length === 7);
  ok('a brand off the list without Others is refused', !call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', brand: 'Acme' }, ADMIN)).success);
  ok('  but the brand the scanner already stored is kept as it is', call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', brand: 'Chicago Pneumatic', model: 'CP872-2' }, ADMIN)).success);
  ok('a name over 120 characters is refused', !call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', name: 'x'.repeat(130) }, ADMIN)).success);
  [SALES, ACCT, MGMT, WH].forEach(who => ok(who.actorRole + ' cannot change a card', !call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', notes: 'x' }, who)).success));
  const wide = load(GS, store({ FlowSettings: [{ 'Key': 'itemBookEditRoles', 'Value': 'admin,director,accounting' }] }));
  ok('itemBookEditRoles can add accounting', call(wide, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', notes: 'x' }, ACCT)).success);
  ok('an id not in inventory is refused', !call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-09999', notes: 'x' }, ADMIN)).success);
  ok('it is secured: no secret, no change', !call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', notes: 'y', flowSecret: '' }, ADMIN)).success);
}

sec('6 · photos: hidden ones, only the item\'s own, and the card\'s own kind');
{
  const st = store(), c = load(GS, st);
  const h = call(c, 'saveItemDetails', Object.assign({ itemId: 'ITM-00004', hideJson: JSON.stringify(['DOC-AAAA1111', 'DOC-CCCC3333']) }, ADMIN));
  ok('hiding keeps only the item\'s own photo ids (a PO photo is dropped)', h.success && st.ItemDetails.find(x => x['Item ID'] === 'ITM-00004')['Hidden Photos'] === 'DOC-AAAA1111', st.ItemDetails);
  ok('  the list counts the photo no more', call(c, 'getItemBook', SALES).items.find(x => x.itemId === 'ITM-00004').photos === 1);
  ok('  the card still lists it, marked hidden (Undo can bring it back)', call(c, 'getItemCard', Object.assign({ itemId: 'ITM-00004' }, ADMIN)).photos.find(x => x.docId === 'DOC-AAAA1111').hidden === true);
  c.DriveApp.getFileById = (id) => ({ getThumbnail: () => ({ getContentType: () => 'image/png', getBytes: () => [1, 2, 3] }), getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => [9] }) });
  const ph = call(c, 'getItemPhotos', Object.assign({ itemId: 'ITM-00004', docIds: JSON.stringify(['DOC-AAAA1111', 'DOC-CCCC3333']) }, SALES));
  ok('getItemPhotos returns only photos filed under the item, as thumbnails', ph.success && ph.data.length === 1 && ph.data[0].docId === 'DOC-AAAA1111' && ph.data[0].mimeType === 'image/png', ph);
  ok('  size=full returns the image itself', call(c, 'getItemPhotos', Object.assign({ itemId: 'ITM-00004', docIds: JSON.stringify(['DOC-BBBB2222']), size: 'full' }, SALES)).data[0].mimeType === 'image/jpeg');
  const up = call(c, 'uploadScanPhoto', Object.assign({ mode: 'item', docNo: 'ITM-00002', base64: 'aGVsbG8=', mimeType: 'image/jpeg' }, ADMIN));
  const doc = st.Documents.find(x => x['Doc ID'] === up.docId);
  ok('admin adds a card photo: Warehouse Item, Item card photo, filed under the item', up.success && doc && doc['Module'] === 'Warehouse Item' && doc['Ref No'] === 'ITM-00002' && doc['Doc Type'] === 'Item card photo', [up, doc]);
  ok('  and the card logs it', st.ItemBookLog.some(x => x['Item ID'] === 'ITM-00002' && x['Kind'] === 'photo'));
  ok('the warehouse may add one too', call(c, 'uploadScanPhoto', Object.assign({ mode: 'item', docNo: 'ITM-00002', base64: 'aGVsbG8=' }, WH)).success);
  ok('a rep and accounting may not', !call(c, 'uploadScanPhoto', Object.assign({ mode: 'item', docNo: 'ITM-00002', base64: 'aGVsbG8=' }, SALES)).success &&
     !call(c, 'uploadScanPhoto', Object.assign({ mode: 'item', docNo: 'ITM-00002', base64: 'aGVsbG8=' }, ACCT)).success);
  ok('a card photo for an id not in inventory is refused', !call(c, 'uploadScanPhoto', Object.assign({ mode: 'item', docNo: 'ITM-09999', base64: 'aGVsbG8=' }, ADMIN)).success);
  ok('the scanner\'s own kinds keep the scanner\'s roles (a rep cannot upload a receiving photo)', !call(c, 'uploadScanPhoto', Object.assign({ mode: 'receive', docNo: 'PO-202610-001', base64: 'aGVsbG8=' }, SALES)).success);
  ok('"Item card photo" is never a gated document type', c._docTypeKey('Item card photo') === 'item card photo', c._docTypeKey('Item card photo'));
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
