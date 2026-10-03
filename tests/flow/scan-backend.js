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
const recv = (ctx, extra) => call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true }, ACC, extra));

sec('1 · roles');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, WH));
  ok('warehouse may not post a receiving', !r.success && /Save the count/.test(r.message), r);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, SALE));
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

  const ctxR = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
  eq('the context now shows 6 wrenches still open', ctxR.lines[0].remaining, 6);
  eq('  and 15 hoses', ctxR.lines[1].remaining, 15);
  ok('the context carries no prices', !JSON.stringify(ctxR).match(/price|Price/), ctxR.lines[0]);

  r = recv(ctx, { clientRef: 'CR-2', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 7 }]) });
  ok('a second partial cannot exceed what is still open', !r.success && /only 6 still open/.test(r.message), r);
  r = recv(ctx, { clientRef: 'CR-3', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 6 }]) });
  ok('a second partial for the rest posts without the "already received" stop', r.success && /^MR-/.test(r.mrNo), r);
  eq('  two MRs now', store.MaterialsReceiving.length, 2);
  const ctx2 = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
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
  const c = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
  eq('  oldest-first allocation leaves line 1 complete', c.lines[0].remaining, 0);
  eq('  and 2 open on line 2', c.lines[1].remaining, 2);
}

sec('4 · the gates come back unchanged and the flags reach createReceiving');
{
  const { ctx, store } = boot({ paid: 0 });
  let r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, clientRef: 'G-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, ACC));
  ok('an unpaid PO stops with the same unpaid reply as the desktop page', !r.success && r.unpaid === true, r);
  eq('  nothing written', store.MaterialsReceiving.length, 0);
  r = call(ctx, 'receiveByScan', Object.assign({ poNo: 'PO-1', confirmNoDocs: true, confirmUnpaid: true, clientRef: 'G-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 1 }]) }, ACC));
  ok('confirming posts it', r.success, r);
}

sec('5 · a warehouse count, then accounting posts it');
{
  const { ctx, store } = boot();
  let r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 3, codes: ['4800000000017'] }]) }, WH));
  ok('warehouse saves a count', r.success, r);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 4 }, { line: 2, qty: 2 }]) }, WH));
  ok('  and replaces it', r.success, r);
  let c = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
  ok('accounting sees the latest count', c.pendingCount && c.pendingCount.by === 'Wally Warehouse' &&
     JSON.stringify(c.pendingCount.lines) === JSON.stringify([{ line: 1, qty: 4 }, { line: 2, qty: 2 }]), c.pendingCount);
  r = call(ctx, 'saveScanCount', Object.assign({ poNo: 'PO-1', lines: W([{ line: 1, qty: 99 }]) }, WH));
  ok('a count above what is open is refused', !r.success, r);
  r = recv(ctx, { lines: W([{ line: 1, itemId: 'ITM-00001', qty: 4 }, { line: 2, qty: 2 }]) });
  ok('accounting posts it', r.success, r);
  c = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
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
  const c = call(ctx, 'getScanContext', { mode: 'dispatch', docNo: 'SO-1' });
  eq('the SO shows only its goods lines (the deposit is not one)', c.lines.map(l => l.line).join(','), '1,3');
  let r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', lines: W([{ line: 2, qty: 1 }]) }, WH));
  ok('a deposit line cannot be dispatched', !r.success && /not on this document/.test(r.message), r);
  r = call(ctx, 'dispatchByScan', Object.assign({ soNo: 'SO-1', clientRef: 'D-1', lines: W([{ line: 1, itemId: 'ITM-00001', qty: 2 }]) }, WH));
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
  const c = call(ctx, 'getScanContext', { mode: 'receive', docNo: 'PO-1' });
  ok('the context lists an item\'s barcodes', c.lines.length === 2 && JSON.stringify(c.lines[0].codes) === '[]', c.lines[0]);
}

sec('9 · the documents list');
{
  const { ctx } = boot();
  const d = call(ctx, 'getScanDocs', { mode: 'receive' });
  ok('open POs are listed, Drafts are not', d.success && d.data.length === 1 && d.data[0].docNo === 'PO-1' && d.data[0].open === 30, d.data);
  ok('no prices in the list', !/price/i.test(JSON.stringify(d)));
}

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
