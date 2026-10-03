/* A316 — the warehouse scanner's backend, through the real FlowAPI.gs.
 *
 * Run:  node tests/flow/scan-backend.js
 *
 * The rules pinned here:
 *   1. Roles come from the stamped actorRole: warehouse may link, count and dispatch but never post a
 *      receiving; sales may do none of it; createReceiving itself refuses a role that does not post.
 *   2. A scanned receipt is checked against the PO: lines must exist and be the same item, quantity is
 *      capped at what is still open, prices come from the PO line (never the phone), a PO with the same
 *      item twice keeps two lines at their own prices, a legacy line with no Item ID still matches.
 *   3. It posts through createReceiving: the same MR, inventory and journal; a second partial delivery
 *      goes through without the "already received" stop and still cannot exceed the PO; the document /
 *      payment gates come back unchanged and the confirm flags reach createReceiving; a retry with the
 *      same clientRef returns the same MR and writes nothing again.
 *   4. One ActivityLog row per post (Ref No = MR No, amount = the PO-priced lines), ScanLog rows.
 *   5. A warehouse count is saved, shown to accounting, and cleared when the receipt is posted.
 *   6. Charges typed on a receiving are spread over that receiving: a partial books them in full, a full
 *      delivery comes out exactly as before, VAT is booked in full. Zero-quantity lines are skipped.
 *   7. A dispatch records only goods lines, never touches Inventory, is capped across dispatches, and is
 *      numbered DS-YYYYMM-NNN. 8. Barcodes: one barcode, one item; relink only by a posting role.
 *   9. The scanner reads expose no prices.
 * A318 (10–18): photo proof on every post, per-piece tracking, returns, opaque reprintable labels,
 *   secured look-ups, stock in.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), typeof got === 'number' ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n' + t);

const ACC  = { actorRole: 'accounting', actorName: 'Ana Acct' };
const WH   = { actorRole: 'warehouse', actorName: 'Wally Warehouse' };
const SALE = { actorRole: 'sales', actorName: 'Sam Sales' };
const W = (lines) => JSON.stringify(lines);

function inv(id, no, desc, bal, cost) {
  return { 'Item No': no, 'Description': desc, 'Available Balance': bal, 'Purchase Price/Unit': cost, 'Shipping Cost/Unit': 0,
           'Landed Cost/Unit': cost, 'Total Landed Cost': cost * bal, 'Currency': 'PHP', 'Last Updated': '', 'Type': 'Stock', 'Item ID': id };
}
function boot(opts) {
  opts = opts || {};
  const store = {
    Inventory: [inv('ITM-00001', 'WR-10', 'Torque wrench', 2, 1000), inv('ITM-00002', 'N/A', 'Hydraulic hose', 0, 0),
                inv('ITM-00003', 'PM-7', 'Pump', 0, 0)],
    PurchaseOrders: [{ 'PO No': 'PO-1', 'SO No': 'SO-1', 'Date': '2026-10-01', 'Supplier': 'Acme Tools', 'Currency': 'USD',
                       'Total Purchase (FC)': opts.poTotal || 1000, 'Status': 'Approved' },
                     { 'PO No': 'PO-D', 'SO No': '', 'Date': '2026-10-02', 'Supplier': 'Draft Co', 'Currency': 'USD', 'Total Purchase (FC)': 10, 'Status': 'Draft' }],
    PurchaseOrderItems: opts.poItems || [
      { 'PO No': 'PO-1', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 10, 'Purchase Price/Unit (FC)': 50, 'Total (FC)': 500, 'Item ID': 'ITM-00001' },
      { 'PO No': 'PO-1', 'Item No': '', 'Item Name': 'Hydraulic hose', 'Qty': 20, 'Purchase Price/Unit (FC)': 25, 'Total (FC)': 500, 'Item ID': '' },
      { 'PO No': 'PO-D', 'Item No': 'PM-7', 'Item Name': 'Pump', 'Qty': 1, 'Purchase Price/Unit (FC)': 10, 'Total (FC)': 10, 'Item ID': 'ITM-00003' }],
    APAging: [{ 'PO No': 'PO-1', 'Amount (PHP)': 56000, 'Paid (PHP)': opts.paid === undefined ? 56000 : opts.paid }],
    MaterialsReceiving: [], ReceivingItems: [], Journal: [], ChartOfAccounts: [], ActivityLog: [],
    SalesOrders: [{ 'SO No': 'SO-1', 'Date': '2026-10-01', 'Customer': 'Client One', 'Status': 'Open', 'Type': '' },
                  { 'SO No': 'SO-S', 'Date': '2026-10-02', 'Customer': 'Hire Co', 'Status': 'Open', 'Type': 'service' }],
    SalesOrderItems: [
      { 'SO No': 'SO-1', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 3, 'Price/Unit': 2000, 'Item ID': 'ITM-00001', 'Charge Kind': '' },
      { 'SO No': 'SO-1', 'Item No': 'DEP', 'Item Name': 'Security deposit', 'Qty': 1, 'Price/Unit': 5000, 'Item ID': '', 'Charge Kind': 'Deposit' },
      { 'SO No': 'SO-1', 'Item No': 'PM-7', 'Item Name': 'Pump', 'Qty': 2, 'Price/Unit': 9000, 'Item ID': 'ITM-00003', 'Charge Kind': '' },
      { 'SO No': 'SO-S', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 1, 'Price/Unit': 100, 'Item ID': 'ITM-00001', 'Charge Kind': '' }],
    Documents: [], Shipments: [],
    ItemBarcodes: [], Dispatches: [], DispatchItems: [], ScanLog: [],
  };
  return { ctx: load(undefined, store), store };
}
// A318 — every post carries a photo uploaded for that document first.
const IMG = Buffer.from('fake jpeg bytes').toString('base64');
const snap = (ctx, mode, docNo, who) => {
  const r = call(ctx, 'uploadScanPhoto', Object.assign({ mode, docNo, base64: 'data:image/jpeg;base64,' + IMG, mimeType: 'image/jpeg' }, who || ACC));
  if (!r.success) throw new Error('photo upload failed: ' + r.message);
  return r.docId;
};
const recv = (ctx, extra) => call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true,
  photoIds: W([snap(ctx, 'receive', (extra && extra.poNo) || 'PO-1')]) }, ACC, extra));
const scx = (ctx, p) => call(ctx, 'getScanContext', Object.assign({}, ACC, p));

sec('1 · roles');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, WH));
  ok('warehouse may not post a receiving', !r.success && /Save the count/.test(r.message), r);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', photoIds: W([snap(ctx, 'receive', 'PO-1', WH)]), lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, SALE));
  ok('sales may not count', !r.success, r);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', lines: W([{ line: 1, qty: 1 }]) }, SALE));
  ok('sales may not dispatch', !r.success, r);
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00001' }, SALE));
  ok('sales may not link a barcode', !r.success, r);
  r = call(ctx, 'createReceiving', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, items: W([{ itemNo: 'WR-10', itemName: 'Torque wrench', qty: 1, price: 50, itemId: 'ITM-00001' }]) }, SALE));
  ok('createReceiving itself refuses a role that does not post', !r.success && /accounting, admin or the director/.test(r.message), r);
  eq('  and nothing was written', store.MaterialsReceiving.length, 0);
  r = call(ctx, 'receiveByScan', { poNo: 'PO-1', lines: W([{ line: 1, qty: 1 }]) });
  ok('no stamped role → refused', !r.success, r);
}

sec('2 · the receipt is checked against the PO');
{
  const { ctx, store } = boot();
  let r = recv(ctx, { lines: W([{ line: 9, qty: 1 }]) });
  ok('a line that is not on the PO is refused', !r.success && /not on this document/.test(r.message), r);
  r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00003', qty: 1 }]) });
  ok('a line echoing a different item is refused (PO changed)', !r.success && /changed since it was loaded/.test(r.message), r);
  r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 11 }]) });
  ok('more than ordered is refused', !r.success && /only 10 still open/.test(r.message), r);
  r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 0 }]) });
  ok('nothing counted is refused', !r.success && /Nothing was counted/.test(r.message), r);
  r = recv(ctx, { poNo: 'PO-D', lines: W([{ line: 1, qty: 1 }]) });
  ok('a Draft PO cannot be received', !r.success && /Draft/.test(r.message), r);
  eq('nothing written by any refusal', store.MaterialsReceiving.length, 0);

  r = recv(ctx, { clientRef: 'CR-1', lines: W([{ line: 1, itemId: 'ITM-00001', itemNo: 'WR-10', qty: 4, codes: ['4800000000017'] },
                                               { line: 2, itemId: 'ITM-00002', qty: 5 }]) });
  ok('a valid scanned receipt posts an MR', r.success && /^MR-\d{6}-\d{3}$/.test(r.mrNo), r);
  eq('  one MaterialsReceiving row', store.MaterialsReceiving.length, 1);
  eq('  two receiving lines', store.ReceivingItems.length, 2);
  eq('  the wrench is priced from the PO line, not the phone', store.ReceivingItems[0]['Purchase Price/Unit (FC)'], 50);
  eq('  the legacy hose line (no Item ID on the PO) resolved to its inventory item', store.ReceivingItems[1]['Item ID'], 'ITM-00002');
  eq('  wrench stock 2 → 6', store.Inventory[0]['Available Balance'], 6);
  eq('  hose stock 0 → 5', store.Inventory[1]['Available Balance'], 5);
  eq('  received by the stamped name', store.MaterialsReceiving[0]['Received By'], 'Ana Acct');
  const act = store.ActivityLog.filter(a => a['Module'] === 'Receiving');
  eq('  exactly one ActivityLog row', act.length, 1);
  eq('  its Ref No is the MR No', act[0] && act[0]['Ref No'], r.mrNo);
  eq('  its amount is the PO-priced lines (4×50 + 5×25)', act[0] && act[0]['Amount'], 325);
  eq('  in the PO currency', act[0] && act[0]['Currency'], 'USD');
  const log = store.ScanLog.filter(x => x['Result Ref'] === r.mrNo);
  eq('  two ScanLog rows carry the MR No', log.length, 2);
  eq('  with the scanned code', log[0] && log[0]['Code'], '4800000000017');

  const again = recv(ctx, { clientRef: 'CR-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 4 }]) });
  ok('a retry with the same clientRef returns the same MR', again.success && again.mrNo === r.mrNo && again.duplicate, again);
  eq('  and writes nothing again', store.MaterialsReceiving.length, 1);

  const ctxR = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  eq('the context now shows 6 wrenches still open', ctxR.lines[0].remaining, 6);
  eq('  and 15 hoses', ctxR.lines[1].remaining, 15);
  ok('the context carries no prices', !JSON.stringify(ctxR).match(/price|Price/), ctxR.lines[0]);

  r = recv(ctx, { clientRef: 'CR-2', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 7 }]) });
  ok('a second partial cannot exceed what is still open', !r.success && /only 6 still open/.test(r.message), r);
  r = recv(ctx, { clientRef: 'CR-3', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 6 }]) });
  ok('a second partial for the rest posts without the "already received" stop', r.success && /^MR-/.test(r.mrNo), r);
  eq('  two MRs now', store.MaterialsReceiving.length, 2);
  const ctx2 = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  eq('  the wrench line is complete', ctx2.lines[0].remaining, 0);
}

sec('3 · duplicate item lines keep their own prices');
{
  const { ctx, store } = boot({ poItems: [
    { 'PO No': 'PO-1', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 2, 'Purchase Price/Unit (FC)': 50, 'Item ID': 'ITM-00001' },
    { 'PO No': 'PO-1', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 3, 'Purchase Price/Unit (FC)': 80, 'Item ID': 'ITM-00001' }] });
  const r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 2 }, { line: 2, itemId: 'ITM-00001', qty: 1 }]) });
  ok('posted', r.success, r);
  eq('  line 1 at 50', store.ReceivingItems[0]['Purchase Price/Unit (FC)'], 50);
  eq('  line 2 at 80', store.ReceivingItems[1]['Purchase Price/Unit (FC)'], 80);
  const c = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  eq('  oldest-first allocation leaves line 1 complete', c.lines[0].remaining, 0);
  eq('  and 2 open on line 2', c.lines[1].remaining, 2);
}

sec('4 · the gates come back unchanged and the flags reach createReceiving');
{
  const { ctx, store } = boot({ paid: 0 });
  const ph = W([snap(ctx, 'receive', 'PO-1')]);
  let r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, photoIds: ph, clientRef: 'G-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, ACC));
  ok('an unpaid PO stops with the same unpaid reply as the desktop page', !r.success && r.unpaid === true, r);
  eq('  nothing written', store.MaterialsReceiving.length, 0);
  r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, confirmUnpaid: true, photoIds: ph, clientRef: 'G-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, ACC));
  ok('confirming posts it', r.success, r);
}

sec('5 · a warehouse count, then accounting posts it');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', photoIds: W([snap(ctx, 'receive', 'PO-1', WH)]), lines: W([{ line: 1, itemId: 'ITM-00001', qty: 3, codes: ['4800000000017'] }]) }, WH));
  ok('warehouse saves a count', r.success, r);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', photoIds: W([snap(ctx, 'receive', 'PO-1', WH)]), lines: W([{ line: 1, itemId: 'ITM-00001', qty: 4 }, { line: 2, qty: 2 }]) }, WH));
  ok('  and replaces it', r.success, r);
  let c = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  ok('accounting sees the latest count', c.pendingCount && c.pendingCount.by === 'Wally Warehouse' &&
     JSON.stringify(c.pendingCount.lines) === JSON.stringify([{ line: 1, qty: 4 }, { line: 2, qty: 2 }]), c.pendingCount);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', photoIds: W([snap(ctx, 'receive', 'PO-1', WH)]), lines: W([{ line: 1, qty: 99 }]) }, WH));
  ok('a count above what is open is refused', !r.success, r);
  r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 4 }, { line: 2, qty: 2 }]) });
  ok('accounting posts it', r.success, r);
  c = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  ok('  and the count is cleared', c.pendingCount === null, c.pendingCount);
  eq('  no COUNT rows remain', store.ScanLog.filter(x => x['Result Ref'] === 'COUNT').length, 0);
}

sec('6 · charges are spread over the receiving');
{
  // Full delivery: identical to the old whole-PO spread.
  const full = boot();
  let r = recv(full.ctx, { duties: 1000, delivery: 400, other: 100, vat: 600,
    lines: W([{ line: 1, itemId: 'ITM-00001', qty: 10 }, { line: 2, qty: 20 }]) });
  ok('full delivery posts', r.success, r);
  const sh = full.store.ReceivingItems.map(x => x['Shipping/Unit (PHP)']);
  eq('  wrench shipping/unit = 1500 × 50 / 1000 (same as before)', sh[0], 75);
  eq('  hose shipping/unit = 1500 × 25 / 1000', sh[1], 37.5);
  // Partial delivery: the charges typed on it are booked in full on its goods.
  const part = boot();
  r = recv(part.ctx, { duties: 300, vat: 120, lines: W([{ line: 1, itemId: 'ITM-00001', qty: 2 }]) });
  ok('partial delivery posts', r.success, r);
  const ri = part.store.ReceivingItems[0];
  eq('  all 300 of duties land on these 2 wrenches (150 each)', ri['Shipping/Unit (PHP)'], 150);
  const vatLine = part.store.Journal.filter(x => /Input VAT/.test(String(x['Memo'] || '')));
  ok('  the VAT typed is booked in full', vatLine.length === 1 && Math.abs((Number(vatLine[0]['Debit']) || 0) - 120) < 0.005, vatLine);
  // Zero-quantity lines are skipped by createReceiving (they used to overwrite the unit cost).
  const z = boot();
  r = call(z.ctx, 'createReceiving', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, items: W([
    { itemNo: 'WR-10', itemName: 'Torque wrench', qty: 0, price: 50, itemId: 'ITM-00001' },
    { itemNo: '', itemName: 'Hydraulic hose', qty: 2, price: 25, itemId: 'ITM-00002' }]) }, ACC));
  ok('desktop receiving with a zero line posts', r.success, r);
  eq('  the zero line is not written', z.store.ReceivingItems.length, 1);
  eq('  and the wrench keeps its cost', z.store.Inventory[0]['Purchase Price/Unit'], 1000);
}

sec('7 · dispatch: record only, goods lines only, capped');
{
  const { ctx, store } = boot();
  const before = JSON.stringify(store.Inventory);
  const c = scx(ctx, { mode: 'dispatch', docNo: 'SO-1' });
  eq('the SO shows only its goods lines (the deposit is not one)', c.lines.map(l => l.line).join(','), '1,3');
  let r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', lines: W([{ line: 2, qty: 1 }]) }, WH));
  ok('a deposit line cannot be dispatched', !r.success && /not on this document/.test(r.message), r);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', clientRef: 'D-1', photoIds: W([snap(ctx, 'dispatch', 'SO-1', WH)]), lines: W([{ line: 1, itemId: 'ITM-00001', qty: 2 }]) }, WH));
  ok('warehouse dispatches', r.success && /^DS-\d{6}-\d{3}$/.test(r.dispatchNo), r);
  eq('  Inventory untouched (stock leaves at invoicing)', JSON.stringify(store.Inventory), before);
  eq('  one Dispatches row', store.Dispatches.length, 1);
  eq('  its line', store.DispatchItems[0]['Line'], 1);
  const act = store.ActivityLog.filter(a => a['Module'] === 'Dispatch');
  eq('  ActivityLog Ref No is the DS No', act[0] && act[0]['Ref No'], r.dispatchNo);
  const rr = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', clientRef: 'D-1', lines: W([{ line: 1, qty: 2 }]) }, WH));
  ok('a retry returns the same DS', rr.success && rr.dispatchNo === r.dispatchNo && rr.duplicate, rr);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', lines: W([{ line: 1, qty: 2 }]) }, WH));
  ok('over-dispatch across two dispatches is refused', !r.success && /only 1 still open/.test(r.message), r);
  const docs = call(ctx, 'getScanDocs', { mode: 'dispatch' });
  ok('the service SO is not offered for dispatch', !docs.data.some(d => d.docNo === 'SO-S'), docs.data);
  const sum = call(ctx, 'getDispatchSummary', {});
  ok('the SO summary says 2 of 5 goods units left', sum.data['SO-1'] && sum.data['SO-1'].dispatched === 2 && sum.data['SO-1'].goods === 5, sum.data);
}

sec('8 · barcodes');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00001' }, WH));
  ok('warehouse links a barcode', r.success && store.ItemBarcodes.length === 1, r);
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00001' }, WH));
  ok('linking it again is a no-op', r.success && r.already && store.ItemBarcodes.length === 1, r);
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00003' }, WH));
  ok('the same barcode for another item is refused', !r.success && r.conflict, r);
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00003', relink: true }, WH));
  ok('  warehouse cannot force a relink', !r.success && r.conflict, r);
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00003', relink: true }, ACC));
  ok('  accounting can', r.success && r.relinked && store.ItemBarcodes[0]['Item ID'] === 'ITM-00003', r);
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: 'HXI:ITM-00001', itemId: 'ITM-00001' }, ACC));
  ok('our own labels are never linked', !r.success, r);
  const c = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  ok('the context lists an item\'s barcodes', c.lines.length === 2 && JSON.stringify(c.lines[0].codes) === '[]', c.lines[0]);
}

sec('9 · the documents list');
{
  const { ctx } = boot();
  const d = call(ctx, 'getScanDocs', { mode: 'receive' });
  ok('open POs are listed, Drafts are not', d.success && d.data.length === 1 && d.data[0].docNo === 'PO-1' && d.data[0].open === 30, d.data);
  ok('no prices in the list', !/price/i.test(JSON.stringify(d)));
}

/* ═══ A318 · photo proof, pieces, returns, opaque labels, stock in ═══════════════════════════════ */
const CODE_RE = /^HX[0-9A-HJKMNP-TV-Z]{12}$/;

sec('10 · photos are the proof of every post');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'uploadScanPhoto', Object.assign({ mode: 'receive', docNo: 'PO-1', base64: IMG, mimeType: 'image/jpeg' }, SALE));
  ok('sales may not upload a scan photo', !r.success, r);
  r = call(ctx, 'uploadScanPhoto', Object.assign({ mode: 'receive', docNo: 'PO-404', base64: IMG }, WH));
  ok('a photo for a PO that does not exist is refused', !r.success && /not found/.test(r.message), r);
  r = call(ctx, 'uploadScanPhoto', Object.assign({ mode: 'receive', docNo: 'PO-1', base64: '' }, WH));
  ok('an empty photo is refused', !r.success, r);
  r = call(ctx, 'uploadScanPhoto', Object.assign({ mode: 'receive', docNo: 'PO-1', base64: 'A'.repeat(6000001) }, WH));
  ok('an oversized photo is refused', !r.success && /too large/.test(r.message), r);
  r = call(ctx, 'uploadScanPhoto', Object.assign({ mode: 'return', docNo: 'RT-1', base64: IMG }, WH));
  ok('a return photo needs the draft reference', !r.success, r);
  const id = snap(ctx, 'receive', 'PO-1', WH);
  ok('a receive photo is stored with a Doc ID', /^DOC-[0-9A-F]{8}$/.test(id), id);
  const d = store.Documents.filter(x => x['Doc ID'] === id)[0];
  ok('  in the Documents register under the PO', d && d['Module'] === 'Purchase Order' && d['Ref No'] === 'PO-1' && d['Doc Type'] === 'Receiving photo', d);
  ok('  with the Drive file id and the uploader', d && d['File ID'] === 'file-1' && d['Uploaded By'] === 'Wally Warehouse', d);
  eq('  no ActivityLog row for a photo', store.ActivityLog.length, 0);
  eq('a receiving photo files under 06 Receiving & Shipping', ctx._docSubfolder('Purchase Order', 'Receiving photo'), '06 Receiving & Shipping');
  eq('a dispatch photo too', ctx._docSubfolder('Sales Order', 'Dispatch photo'), '06 Receiving & Shipping');
  ['Receiving photo', 'Dispatch photo', 'Return photo', 'Piece photo'].forEach(t =>
    eq('"' + t + '" is never a gated document type', ctx._docTypeKey(t), t.toLowerCase()));

  const L = W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]);
  r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, lines: L }, ACC));
  ok('a receipt without a photo is refused', !r.success && /photo/.test(r.message), r);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', lines: L }, WH));
  ok('a count without a photo is refused', !r.success && /photo/.test(r.message), r);
  const soPhoto = snap(ctx, 'dispatch', 'SO-1', WH);
  r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, photoIds: W([soPhoto]), lines: L }, ACC));
  ok('a photo of another document is refused', !r.success && /does not belong/.test(r.message), r);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', photoIds: W([id]), lines: W([{ line: 1, qty: 1 }]) }, WH));
  ok('a receiving photo cannot prove a dispatch', !r.success && /does not belong/.test(r.message), r);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', lines: W([{ line: 1, qty: 1 }]) }, WH));
  ok('a dispatch without a photo is refused', !r.success && /photo/.test(r.message), r);
  eq('  nothing was written by the refusals', store.MaterialsReceiving.length + store.Dispatches.length, 0);

  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', photoIds: W([id]), lines: L }, WH));
  ok('a count with its photo saves', r.success, r);
  const c = scx(ctx, { mode: 'receive', docNo: 'PO-1' });
  ok('  accounting sees the count\'s photo ids', c.pendingCount && JSON.stringify(c.pendingCount.photoIds) === JSON.stringify([id]), c.pendingCount);
  r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, photoIds: W(c.pendingCount.photoIds), lines: L }, ACC));
  ok('  and posts it with the same photos, no re-shoot', r.success, r);
  const log = store.ScanLog.filter(x => x['Result Ref'] === r.mrNo);
  eq('ScanLog is 10 wide with the photo ids', log[0] && log[0]['Photos'], id);
  r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', photoIds: W([snap(ctx, 'receive', 'PO-1')]), lines: L }, ACC));
  ok('a receiving photo does not satisfy the receive document gate', !r.success && !!r.missingDocs, r);

  ctx.DriveApp.getFileById = (fid) => ({ getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => Buffer.from('jpeg:' + fid) }) });
  const many = [1, 2, 3, 4, 5, 6, 7].map(() => snap(ctx, 'receive', 'PO-1'));
  let ph = call(ctx, 'getScanPhotos', Object.assign({ docIds: W(many) }, ACC));
  eq('getScanPhotos returns at most 6', ph.data && ph.data.length, 6);
  ok('  as base64 for an <img>', ph.data && ph.data[0].base64 === Buffer.from('jpeg:file-1').toString('base64'), ph.data && ph.data[0]);
  ph = call(ctx, 'getScanPhotos', Object.assign({ docIds: W(many) }, SALE));
  ok('  and only to a scanner role', !ph.success, ph);
}

function bootTracked() {
  const b = boot();
  const r = call(b.ctx, 'setItemTracking', Object.assign({ itemId: 'ITM-00001', track: true }, ACC));
  if (!r.success) throw new Error(r.message);
  return b;
}

sec('11 · tracking each piece');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'setItemTracking', Object.assign({ itemId: 'ITM-00001', track: true }, WH));
  ok('warehouse cannot switch tracking', !r.success, r);
  r = call(ctx, 'setItemTracking', Object.assign({ itemId: 'ITM-404', track: true }, ACC));
  ok('an unknown item is refused', !r.success, r);
  r = call(ctx, 'setItemTracking', Object.assign({ itemId: 'ITM-00001', track: true }, ACC));
  ok('accounting switches the wrench to per-piece', r.success && store.TrackedItems.length === 1, r);
  r = call(ctx, 'setItemTracking', Object.assign({ itemId: 'ITM-00001', track: 'false' }, ACC));
  ok('  and back off, on the same row', r.success && store.TrackedItems.length === 1 && store.TrackedItems[0]['Track Pieces'] === false, store.TrackedItems);
  const act = store.ActivityLog.filter(a => a['Action'] === 'Tracking Set');
  eq('  each switch is logged', act.length, 2);
}

sec('12 · receiving a tracked item makes one piece and one label per unit');
{
  const { ctx, store } = bootTracked();
  let r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1.5 }]) });
  ok('a fraction of a tracked piece is refused', !r.success && /whole pieces/.test(r.message), r);
  r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 3 }, { line: 2, qty: 4 }]) });
  ok('posted', r.success, r);
  eq('  three pieces came back', r.assets && r.assets.length, 3);
  eq('  three Assets rows (the hose is not tracked)', store.Assets.length, 3);
  ok('  numbered AS-YYYYMM-NNN, distinct', store.Assets.every(a => /^AS-\d{6}-\d{3}$/.test(a['Asset No'])) && new Set(store.Assets.map(a => a['Asset No'])).size === 3, store.Assets.map(a => a['Asset No']));
  ok('  In warehouse, carrying the MR and the photo', store.Assets.every(a => a['Status'] === 'In warehouse' && a['MR No'] === r.mrNo && /^DOC-/.test(a['Photos'])), store.Assets[0]);
  const pieces = store.Labels.filter(l => l['Kind'] === 'PIECE');
  eq('  one PIECE label per piece', pieces.length, 3);
  ok('  every code is opaque: HX + 12 Crockford base32', pieces.every(l => CODE_RE.test(l['Code'])), pieces.map(l => l['Code']));
  ok('  and contains neither the Item ID nor the Asset No', pieces.every(l => !/ITM|AS-|\d{6}-/.test(l['Code'])), pieces.map(l => l['Code']));
  ok('  the reply pairs each piece with its code', r.assets.every(a => pieces.some(l => l['Code'] === a.code && l['Asset No'] === a.assetNo)), r.assets);
}

sec('13 · registering stock already on the shelf');
{
  const { ctx, store } = boot();
  const ph = () => W([snap(ctx, 'register', 'ITM-00001')]);
  let r = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '1', photoIds: ph() }, ACC));
  ok('an untracked item cannot register pieces', !r.success && /Track each piece/.test(r.message), r);
  call(ctx, 'setItemTracking', Object.assign({ itemId: 'ITM-00001', track: true }, ACC));
  r = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '1', photoIds: ph() }, WH));
  ok('warehouse cannot register pieces', !r.success, r);
  r = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '3', photoIds: ph() }, ACC));
  ok('more than the balance (2) is refused', !r.success && /Only 2/.test(r.message), r);
  r = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '2' }, ACC));
  ok('a registration needs a photo', !r.success && /photo/.test(r.message), r);
  r = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '2', photoIds: ph() }, ACC));
  ok('two pieces registered with labels', r.success && r.assets.length === 2 && r.assets.every(a => CODE_RE.test(a.code)), r);
  r = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '1', photoIds: ph() }, ACC));
  ok('  the balance is now fully labelled', !r.success && /Only 0/.test(r.message), r);
  const d = store.Documents.filter(x => x['Doc Type'] === 'Piece photo');
  ok('piece photos are filed under Warehouse Piece', d.length && d.every(x => x['Module'] === 'Warehouse Piece' && x['Ref No'] === 'ITM-00001'), d[0]);
}

sec('14 · a tracked line leaves piece by piece; untracked lines are unchanged');
{
  const { ctx, store } = bootTracked();
  call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '2', photoIds: W([snap(ctx, 'register', 'ITM-00001')]) }, ACC));
  const [a1, a2] = store.Assets.map(a => a['Asset No']);
  const before = JSON.stringify(store.Inventory);
  const c = scx(ctx, { mode: 'dispatch', docNo: 'SO-1' });
  ok('the dispatch context lists the wrench\'s pieces in the warehouse with their codes',
     c.lines[0].tracked && c.lines[0].pieces.length === 2 && c.lines[0].pieces.every(p => CODE_RE.test(p.code)), c.lines[0]);
  ok('  the pump line is not tracked', c.lines[1].tracked === false && !c.lines[1].pieces, c.lines[1]);
  const ph = () => W([snap(ctx, 'dispatch', 'SO-1', WH)]);
  let r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', photoIds: ph(), lines: W([{ line: 1, qty: 2 }]) }, WH));
  ok('a tracked line without its pieces is refused', !r.success && /each piece/.test(r.message), r);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', photoIds: ph(), lines: W([{ line: 1, qty: 1, assets: [a1] }, { line: 1, qty: 1, assets: [a1] }]) }, WH));
  ok('the same piece twice is refused', !r.success && /twice/.test(r.message), r);
  store.Assets.push({ 'Asset No': 'AS-X', 'Item ID': 'ITM-00003', 'Status': 'In warehouse' });
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', photoIds: ph(), lines: W([{ line: 1, qty: 1, assets: ['AS-X'] }]) }, WH));
  ok('a piece of another item is refused', !r.success && /is not Torque wrench/.test(r.message), r);
  store.Assets.pop();
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', clientRef: 'TD-1', photoIds: ph(), notes: 'Truck ABC 123',
    lines: W([{ line: 1, qty: 1, assets: [a1] }, { line: 1, qty: 1, assets: [a2] }, { line: 3, itemId: 'ITM-00003', qty: 1 }]) }, WH));
  ok('two pieces and an untracked pump dispatch together', r.success, r);
  ok('  both pieces are Out at the customer, Last Ref the DS', store.Assets.every(a => a['Status'] === 'Out' && a['Location'] === 'Client One (SO-1)' && a['Last Ref'] === r.dispatchNo), store.Assets);
  eq('  Inventory untouched (record only)', JSON.stringify(store.Inventory), before);
  const log = store.ScanLog.filter(x => x['Result Ref'] === r.dispatchNo && x['Line'] === 1)[0];
  ok('  the ScanLog line names the pieces\' codes', log && store.Labels.filter(l => l['Kind'] === 'PIECE').every(l => String(log['Code']).includes(l['Code'])), log);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', photoIds: ph(), lines: W([{ line: 1, qty: 1, assets: [a1] }]) }, WH));
  ok('a piece that is already out cannot leave again', !r.success && /not in the warehouse/.test(r.message), r);
}

sec('15 · returns');
{
  const { ctx, store } = bootTracked();
  call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '2', photoIds: W([snap(ctx, 'register', 'ITM-00001')]) }, ACC));
  const [a1, a2] = store.Assets.map(a => a['Asset No']);
  call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', photoIds: W([snap(ctx, 'dispatch', 'SO-1')]), lines: W([{ line: 1, qty: 1, assets: [a1] }]) }, WH));
  const before = JSON.stringify(store.Inventory);
  const rc = scx(ctx, { mode: 'return' });
  ok('the return context lists only pieces that are out, with where they went',
     rc.pieces.length === 1 && rc.pieces[0].assetNo === a1 && /SO-1/.test(rc.pieces[0].location) && CODE_RE.test(rc.pieces[0].code), rc.pieces);
  const ref = 'CR-ret-0001';
  let r = call(ctx, 'returnByScan', Object.assign({ clientRef: ref, assets: W([a2]), photoIds: W([snap(ctx, 'return', ref, WH)]) }, WH));
  ok('a piece that is in the warehouse cannot be returned', !r.success && /not out/.test(r.message), r);
  r = call(ctx, 'returnByScan', Object.assign({ clientRef: ref, assets: W([a1]) }, WH));
  ok('a return needs a photo', !r.success && /photo/.test(r.message), r);
  r = call(ctx, 'returnByScan', Object.assign({ clientRef: ref, assets: W([a1]) }, SALE));
  ok('sales cannot record a return', !r.success, r);
  const pid = snap(ctx, 'return', ref, WH);
  r = call(ctx, 'returnByScan', Object.assign({ clientRef: ref, assets: W([a1]), photoIds: W([pid]), condition: 'Needs repair', notes: 'bent handle' }, WH));
  ok('the piece comes back as RT-YYYYMM-NNN', r.success && /^RT-\d{6}-\d{3}$/.test(r.returnNo), r);
  const a = store.Assets.filter(x => x['Asset No'] === a1)[0];
  ok('  In warehouse again, Last Ref the RT', a['Status'] === 'In warehouse' && a['Location'] === 'Warehouse' && a['Last Ref'] === r.returnNo, a);
  ok('  the Returns row keeps condition, notes, photo', store.Returns[0]['Condition'] === 'Needs repair' && store.Returns[0]['Notes'] === 'bent handle' && store.Returns[0]['Photos'] === pid, store.Returns[0]);
  eq('  the photo is re-filed under the RT number', store.Documents.filter(x => x['Doc ID'] === pid)[0]['Ref No'], r.returnNo);
  eq('  Inventory untouched (record only)', JSON.stringify(store.Inventory), before);
  ok('  a RETURN ScanLog row', store.ScanLog.some(x => x['Mode'] === 'RETURN' && x['Doc No'] === a1 && x['Result Ref'] === r.returnNo), store.ScanLog.slice(-1));
  ok('  logged under Dispatch / Returned', store.ActivityLog.some(x => x['Module'] === 'Dispatch' && x['Action'] === 'Returned' && x['Ref No'] === r.returnNo));
  const again = call(ctx, 'returnByScan', Object.assign({ clientRef: ref, assets: W([a1]), photoIds: W([pid]) }, WH));
  ok('a retry returns the same RT', again.success && again.duplicate && again.returnNo === r.returnNo, again);
}

sec('16 · opaque item labels and the label library');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'ensureItemLabels', Object.assign({ itemIds: W(['ITM-00001', 'ITM-00002', 'ITM-404']) }, ACC));
  ok('item labels are made for known items only', r.success && r.labels.length === 2 && r.made === 2, r);
  ok('  opaque codes', r.labels.every(l => CODE_RE.test(l.code) && !l.code.includes('ITM')), r.labels);
  const first = r.labels[0].code;
  r = call(ctx, 'ensureItemLabels', Object.assign({ itemIds: W(['ITM-00001']) }, WH));
  ok('  asking again reuses the same code (one per item, forever)', r.success && r.made === 0 && r.labels[0].code === first, r);
  eq('  still two ITEM rows', store.Labels.length, 2);
  r = call(ctx, 'ensureItemLabels', Object.assign({ itemIds: W(['ITM-00001']) }, SALE));
  ok('  sales cannot make labels', !r.success, r);
  const codes = new Set();
  for (let i = 0; i < 2000; i++) codes.add(ctx._labelNewCode({}));
  eq('2,000 fresh codes are all distinct', codes.size, 2000);
  ok('  and all opaque', [...codes].every(c => CODE_RE.test(c)));

  let lib = call(ctx, 'getLabels', Object.assign({ filter: 'waiting' }, WH));
  eq('the library lists both as waiting to print', lib.data && lib.data.length, 2);
  r = call(ctx, 'logLabelPrint', Object.assign({ codes: W([{ code: first, count: 3 }]) }, WH));
  ok('printing is recorded', r.success && r.updated === 1, r);
  const row = store.Labels.filter(l => l['Code'] === first)[0];
  ok('  the count and date update', row['Printed Count'] === 3 && !isNaN(new Date(row['Last Printed At']).getTime()) && row['Last Printed At'] !== '', row);
  call(ctx, 'logLabelPrint', Object.assign({ codes: W([{ code: first, count: 2 }]) }, WH));
  eq('  a reprint adds to it', store.Labels.filter(l => l['Code'] === first)[0]['Printed Count'], 5);
  lib = call(ctx, 'getLabels', Object.assign({ filter: 'waiting' }, WH));
  eq('  one left waiting', lib.data.length, 1);
  lib = call(ctx, 'getLabels', Object.assign({ q: 'torque' }, WH));
  ok('search by name finds the wrench\'s label with its details', lib.data.length === 1 && lib.data[0].code === first && lib.data[0].itemNo === 'WR-10' && lib.data[0].printed === 5, lib.data);
  lib = call(ctx, 'getLabels', Object.assign({ codes: W([first]) }, WH));
  ok('  filtering by code works', lib.data.length === 1, lib.data);
  lib = call(ctx, 'getLabels', {});
  ok('the library is closed to a call with no scanner role', !lib.success, lib);
  ok('no prices in the library', !/price|cost/i.test(JSON.stringify(call(ctx, 'getLabels', Object.assign({}, WH)))));
}

sec('17 · look-up turns a code into details, only when signed in');
{
  const { ctx, store } = bootTracked();
  const reg = call(ctx, 'registerAssets', Object.assign({ itemId: 'ITM-00001', qty: '1', photoIds: W([snap(ctx, 'register', 'ITM-00001')]) }, ACC));
  const piece = reg.assets[0];
  const item = call(ctx, 'ensureItemLabels', Object.assign({ itemIds: W(['ITM-00001']) }, ACC)).labels[0].code;
  call(ctx, 'linkBarcode', Object.assign({ barcode: '4800000000017', itemId: 'ITM-00001' }, WH));
  let r = call(ctx, 'getScanLookup', { code: item });
  ok('no role → nothing', !r.success && !JSON.stringify(r).includes('Torque'), r);
  r = call(ctx, 'getScanLookup', Object.assign({ code: item }, SALE));
  ok('sales → nothing', !r.success, r);
  r = call(ctx, 'getScanLookup', Object.assign({ code: item }, WH));
  ok('an item label → the item', r.success && r.kind === 'item' && r.item.name === 'Torque wrench' && r.item.balance === 2 && r.item.tracked && r.item.piecesIn === 1, r);
  ok('  with its supplier barcode and label', r.item.barcodes.includes('4800000000017') && r.item.label === item, r.item);
  r = call(ctx, 'getScanLookup', Object.assign({ code: '4800000000017' }, WH));
  ok('a supplier barcode → the same item', r.success && r.kind === 'item' && r.item.itemId === 'ITM-00001', r);
  r = call(ctx, 'getScanLookup', Object.assign({ code: 'HXI:ITM-00001' }, WH));
  ok('an old HXI: label still resolves', r.success && r.kind === 'item' && r.item.itemId === 'ITM-00001', r);
  r = call(ctx, 'getScanLookup', Object.assign({ code: piece.code }, WH));
  ok('a piece label → the piece, where it is, its photos', r.success && r.kind === 'piece' && r.piece.assetNo === piece.assetNo && r.piece.status === 'In warehouse' && r.photoIds.length === 1, r);
  r = call(ctx, 'getScanLookup', Object.assign({ code: 'HX0000000000ZZ' }, WH));
  ok('an unknown code → unknown', r.success && r.kind === 'unknown', r);
  r = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
  ok('the scan context is closed without a scanner role', !r.success, r);
  r = call(ctx, 'getScanContext', Object.assign({ mode: 'stockin' }, WH));
  ok('the stock-in context maps every known code to its item', r.success && r.codes[item] === 'ITM-00001' && r.codes['4800000000017'] === 'ITM-00001' && r.tracked['ITM-00001'] === 1, r);
  ok('  and still no prices', !/price|cost/i.test(JSON.stringify(r)));
  r = call(ctx, 'linkBarcode', Object.assign({ barcode: item, itemId: 'ITM-00002' }, ACC));
  ok('one of our label codes can never be linked as a supplier barcode', !r.success, r);
}

sec('18 · stock in: pick the PO line an item came from');
{
  const { ctx, store } = boot({ poItems: [
    { 'PO No': 'PO-1', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 10, 'Purchase Price/Unit (FC)': 50, 'Item ID': 'ITM-00001' },
    { 'PO No': 'PO-1', 'Item No': '', 'Item Name': 'Hydraulic hose', 'Qty': 20, 'Purchase Price/Unit (FC)': 25, 'Item ID': '' },
    { 'PO No': 'PO-S', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 5, 'Purchase Price/Unit (FC)': 45, 'Item ID': 'ITM-00001' },
    { 'PO No': 'PO-D', 'Item No': 'WR-10', 'Item Name': 'Torque wrench', 'Qty': 1, 'Purchase Price/Unit (FC)': 10, 'Item ID': 'ITM-00001' }] });
  store.PurchaseOrders.push({ 'PO No': 'PO-S', 'SO No': '', 'Date': '2026-09-01', 'Supplier': 'Stock Co', 'Currency': 'PHP', 'Total Purchase (FC)': 225, 'Status': 'Approved' });
  store.APAging.push({ 'PO No': 'PO-S', 'Amount (PHP)': 225, 'Paid (PHP)': 225 });
  let o = call(ctx, 'getStockInOptions', Object.assign({ itemId: 'ITM-00001' }, WH));
  ok('both open PO lines holding the wrench are offered, never the Draft', o.success && o.options.map(x => x.poNo).join(',') === 'PO-S,PO-1', o.options);
  ok('  the stock PO (no SO) comes first even though it is older', o.options[0].soNo === '' && o.options[1].soNo === 'SO-1', o.options);
  ok('  no prices', !/price/i.test(JSON.stringify(o)));
  o = call(ctx, 'getStockInOptions', Object.assign({ itemId: 'ITM-00002' }, WH));
  ok('the legacy hose line (no Item ID) is found through its name', o.success && o.options.length === 1 && o.options[0].line === 2 && o.options[0].remaining === 20, o.options);
  o = call(ctx, 'getStockInOptions', Object.assign({ itemId: 'ITM-00001' }, SALE));
  ok('closed to sales', !o.success, o);

  // a basket across two POs posts as two receivings; one over its remaining is refused alone
  let a = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-S', confirmNoDocs: true, clientRef: 'SI-1', photoIds: W([snap(ctx, 'receive', 'PO-S')]),
    lines: W([{ line: 1, itemId: 'ITM-00001', qty: 6 }]) }, ACC));
  ok('a group over its line\'s remaining is refused', !a.success && /only 5 still open/.test(a.message), a);
  a = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-S', confirmNoDocs: true, clientRef: 'SI-2', photoIds: W([snap(ctx, 'receive', 'PO-S')]),
    lines: W([{ line: 1, itemId: 'ITM-00001', qty: 5 }]) }, ACC));
  const b = recv(ctx, { clientRef: 'SI-3', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 2 }]) });
  ok('two groups on two POs post as two MRs', a.success && b.success && a.mrNo !== b.mrNo && store.MaterialsReceiving.length === 2, [a, b]);
  o = call(ctx, 'getStockInOptions', Object.assign({ itemId: 'ITM-00001' }, WH));
  ok('  the stock PO is no longer offered; PO-1 shows 8 left', o.options.length === 1 && o.options[0].poNo === 'PO-1' && o.options[0].remaining === 8, o.options);
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
