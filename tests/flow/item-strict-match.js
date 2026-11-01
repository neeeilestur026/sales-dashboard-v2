/* A387 — stock never lands on a guessed row (FlowAPI 194, FlowSettings itemStrictMatch).
 *
 * Run:  node tests/flow/item-strict-match.js
 *
 * The bug (20 Oct 2026, Therma South): receiving MR-202610-017/018/019 put two torches into row 99 "PIECE INSULATED
 * PIER AND SCREWD", because a no-code line whose name differed by one character fell back to the FIRST 'N/A' row.
 * With the switch on, every caller decides each line before writing anything, and asks when it cannot be sure.
 * With it off, every caller runs exactly as before A387 — checked here against the pre-A387 FlowAPI from git.
 */
const { load, call } = require('./gasload');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const ACCT = { actorName: 'Maria Santos', actorRole: 'accounting', actorUsername: 'acct1' };

const inv = (id, no, d, bal, landed, type) => ({ 'Item No': no, 'Description': d, 'Available Balance': bal, 'Purchase Price/Unit': landed, 'Shipping Cost/Unit': 0,
  'Landed Cost/Unit': landed, 'Total Landed Cost': bal * landed, 'Currency': 'PHP', 'Last Updated': '2026-10-01', 'Type': type || 'Stock', 'Item ID': id });
function store(settings, extra) {
  return Object.assign({
    FlowSettings: settings || [], ActivityLog: [],
    Inventory: [
      inv('ITM-00099', 'N/A', 'PIECE INSULATED PIER AND SCREWD', 34, 6625.16),
      inv('ITM-00151', 'N/A', '1-TORCH;  HAND; CUTTING', 2, 54280),
      inv('ITM-00152', 'N/A', 'CLAMP; GROUND; 300A', 1, 16720),
      inv('ITM-00200', 'CP872', 'Impact wrench CP872', 5, 12000),
      inv('ITM-00300', 'TBA', 'Hydraulic hose 2m', 6, 900),
      inv('ITM-00301', 'TBA', 'Hydraulic hose 2m', 0, 0),
      inv('ITM-00400', 'DUP-1', 'Gauge, analogue', 1, 100),
      inv('ITM-00401', 'DUP-1', 'Gauge, digital', 1, 200)]
  }, extra || {});
}
const OFF = [{ 'Key': 'itemStrictMatch', 'Value': 'off' }];
const bal = (st, id) => (st.Inventory.find(r => r['Item ID'] === id) || {})['Available Balance'];
const rc = (items, more) => Object.assign({ items: JSON.stringify(items), currency: 'PHP', date: '2026-10-20', receivedBy: 'Maria Santos' }, ACCT, more || {});
const iv = (items, more) => Object.assign({ customer: 'Therma South, Inc.', items: JSON.stringify(items), date: '2026-10-21', createdBy: 'Maria Santos', vatType: 'VAT-12', vatRate: 12 }, ACCT, more || {});
const TORCH_PO = { itemNo: 'N/A', itemName: 'TORCH;  HAND; CUTTING', qty: 1, price: 54280 };   // the PO's spelling: no "1-"

sec('1 · receiving: one character off no longer lands on row 99');
{
  const st = store(), c = load(GS, st), before = JSON.stringify(st.Inventory);
  const r = call(c, 'createReceiving', rc([TORCH_PO]));
  ok('the torch the PO spells differently is asked about, with its own row as the candidate', !r.success && r.needsItem.length === 1 &&
     r.needsItem[0].candidates[0].itemId === 'ITM-00151' && r.needsItem[0].allow.join() === 'new', r);
  ok('  and NOTHING was written: no receiving, no lines, no stock, no journal', !(st.MaterialsReceiving || []).length && !(st.ReceivingItems || []).length &&
     JSON.stringify(st.Inventory) === before && !(st.Journal || []).length);
  const p = call(c, 'createReceiving', rc([Object.assign({ pick: 'ITM-00151' }, TORCH_PO)]));
  ok('with the pick it goes to the torch\'s own row', p.success && bal(st, 'ITM-00151') === 3 && bal(st, 'ITM-00099') === 34, [p, bal(st, 'ITM-00151')]);
  ok('  and the receiving line records the row it really went to', st.ReceivingItems[0]['Item ID'] === 'ITM-00151');
}
{
  const st = store(), c = load(GS, st);
  const r = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: '1-torch; hand; cutting', qty: 1, price: 54280, itemId: 'ITM-00099' }]));
  ok('a line carrying row 99\'s id (suspect) but the torch\'s exact name goes to the torch, unasked', r.success && bal(st, 'ITM-00151') === 3 && bal(st, 'ITM-00099') === 34 &&
     st.ReceivingItems[0]['Item ID'] === 'ITM-00151', [r, st.ReceivingItems]);
}
{
  const st = store(), c = load(GS, st), n0 = st.Inventory.length;
  const r = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'Zebra conveyor belt 40m', qty: 2, price: 1000 }, { itemNo: 'N/A', itemName: 'Zebra conveyor belt 40m', qty: 3, price: 1000 },
                                         { itemNo: 'ZX-1', itemName: 'Laser alignment kit', qty: 1, price: 50 }]));
  const zebra = st.Inventory.filter(x => x['Description'] === 'Zebra conveyor belt 40m');
  ok('a product nothing is near becomes ONE new row, even named twice on one receiving', r.success && zebra.length === 1 && zebra[0]['Available Balance'] === 5 &&
     st.ReceivingItems[0]['Item ID'] === zebra[0]['Item ID'] && st.ReceivingItems[1]['Item ID'] === zebra[0]['Item ID'], [r, zebra]);
  ok('  a real code no row has becomes a new row, as before', st.Inventory.length === n0 + 2 && st.Inventory.some(x => x['Item No'] === 'ZX-1'));
}
{
  const st = store(), c = load(GS, st);
  const r = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'TORCH; HAND; CUTTING', qty: 1, price: 54280, pick: 'new' }]));
  ok('"New item" on a no-code line adds its own row (not row 99, not the torch)', r.success && bal(st, 'ITM-00151') === 2 && bal(st, 'ITM-00099') === 34 &&
     st.Inventory.length === 9, [r, st.Inventory.length]);
  const dup = call(c, 'createReceiving', rc([{ itemNo: 'DUP-1', itemName: 'Gauge', qty: 1, price: 10, pick: 'new' }]));
  ok('  but not for a code two rows already share', !dup.success && dup.needsItem && dup.needsItem[0].how === 'ambiguous', dup);
  const bad = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'x', qty: 1, price: 10, pick: 'ITM-09999' }]));
  ok('  and a pick that is no item is asked again', !bad.success && bad.needsItem[0].how === 'badpick', bad);
  const hose = call(c, 'createReceiving', rc([{ itemNo: 'TBA', itemName: 'Hydraulic hose 2m', qty: 1, price: 900 }]));
  ok('TBA is no code: two rows with the exact name are both offered', !hose.success && hose.needsItem[0].how === 'ambiguous' &&
     hose.needsItem[0].candidates.map(x => x.itemId).join() === 'ITM-00300,ITM-00301', hose);
  const cp = call(c, 'createReceiving', rc([{ itemNo: 'cp872', itemName: 'Impact wrench', qty: 1, price: 11000 }]));
  ok('a real code only one row has needs nothing more (any case)', cp.success && bal(st, 'ITM-00200') === 6, cp);
}

{
  // live, 1 Nov 2026: the 361 oldest rows have no Item ID (backfillItemIds never ran) — a stock move gives the row it uses one
  const st = store(null, { Inventory: store().Inventory.concat([Object.assign(inv('', 'N/A', 'Old pipe wrench 24in', 3, 800), {}), Object.assign(inv('', 'N/A', 'Old pipe wrench 18in', 1, 700), {})]) });
  const c = load(GS, st);
  const r = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'Old pipe wrench 24in', qty: 2, price: 800 }]));
  const row = st.Inventory.find(x => x['Description'] === 'Old pipe wrench 24in');
  ok('a line matching a row with no id: the row gets one, the stock lands there, the line keeps it', r.success && /^ITM-\d{5}$/.test(row['Item ID']) &&
     row['Available Balance'] === 5 && st.ReceivingItems[0]['Item ID'] === row['Item ID'], [r, row]);
  const q = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'old pipe wrench', qty: 1, price: 700 }]));
  const k = q.needsItem && q.needsItem[0].candidates.find(x => x.itemId === '');
  ok('  a row still without an id is offered by its row key', !q.success && k && /^row:\d+:[0-9a-z]+$/.test(k.pick), q);
  const p = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'old pipe wrench', qty: 1, price: 700, pick: k.pick }]));
  const r18 = st.Inventory.find(x => x['Description'] === 'Old pipe wrench 18in');
  ok('  and picked by it: that row, now with its own id', p.success && r18['Available Balance'] === 2 && /^ITM-\d{5}$/.test(r18['Item ID']) && r18['Item ID'] !== row['Item ID'], [p, r18]);
  const bad = call(c, 'createReceiving', rc([{ itemNo: 'N/A', itemName: 'old pipe wrench', qty: 1, price: 700, pick: k.pick.replace(/:[0-9a-z]+$/, ':zzz') }]));
  ok('  a row key whose name no longer matches is refused (the row moved)', !bad.success && bad.needsItem && bad.needsItem[0].how === 'badpick', bad);
}

sec('2 · invoicing: resolved before the stock check, the cost and the deduction; never a new row');
{
  const st = store(), c = load(GS, st), n0 = st.Inventory.length;
  const r = call(c, 'createInvoice', iv([{ itemNo: 'N/A', itemName: 'TORCH;  HAND; CUTTING', qty: 1, price: 120000, itemId: 'ITM-00099' }]));
  ok('row 99\'s id on a torch line is suspect: asked, with row 99 offered first', !r.success && r.needsItem[0].suspectId === 'ITM-00099' &&
     r.needsItem[0].candidates[0].itemId === 'ITM-00099' && r.needsItem[0].candidates.some(x => x.itemId === 'ITM-00151') && r.needsItem[0].allow.join() === 'none', r);
  ok('  nothing written: no invoice, no receivable, no stock moved', !(st.Invoices || []).length && !(st.ARAging || []).length && bal(st, 'ITM-00099') === 34);
  const p = call(c, 'createInvoice', iv([{ itemNo: 'N/A', itemName: 'TORCH;  HAND; CUTTING', qty: 1, price: 120000, itemId: 'ITM-00099', pick: 'ITM-00151' },
                                         { itemNo: 'N/A', itemName: 'Freight and handling', qty: 1, price: 2500 }]));
  const lines = st.InvoiceItems || [];
  ok('with the pick: costed from the torch\'s own landed cost and deducted from it', p.success && bal(st, 'ITM-00151') === 1 && bal(st, 'ITM-00099') === 34 &&
     lines[0]['Item ID'] === 'ITM-00151' && lines[0]['Landed Cost/Unit'] === 54280, [p, lines]);
  ok('a line nothing is near is not a stock item: COGS 0, no id, and no junk row', lines[1]['Line COGS'] === 0 && lines[1]['Item ID'] === '' &&
     st.Inventory.length === n0 && p.notStockLines === 1 && p.zeroCogsLines === 0 && /not stock items/.test(p.message), [p, lines[1]]);
  const none = call(c, 'createInvoice', iv([{ itemNo: 'TBA', itemName: 'Hydraulic hose 2m', qty: 2, price: 1500, pick: 'none' }]));
  ok('"Not a stock item" on a line two rows fit moves no stock', none.success && bal(st, 'ITM-00300') === 6 && bal(st, 'ITM-00301') === 0, none);
  const short = call(c, 'createInvoice', iv([{ itemNo: 'TBA', itemName: 'Hydraulic hose 2m', qty: 2, price: 1500, pick: 'ITM-00301' }]));
  ok('the short-stock check reads the PICKED row (0 on hand)', !short.success && short.needsConfirm === 'shortStock', short);
}

sec('3 · voiding: back to the row each line was costed from');
{
  const st = store(null, {
    Invoices: [{ 'INV No': 'INV-OLD', 'SO No': '', 'Date': '2026-10-21', 'Customer': 'Therma South, Inc.', 'Created By': 'Maria Santos', 'Voided': '' }],
    InvoiceItems: [
      { 'INV No': 'INV-OLD', 'Item No': 'N/A', 'Item Name': 'TORCH; HAND; CUTTING', 'Qty': 1, 'Selling Price': 120000, 'Line Sales': 120000, 'Landed Cost/Unit': 6625.16, 'Line COGS': 6625.16, 'Item ID': 'ITM-00099' },
      { 'INV No': 'INV-OLD', 'Item No': 'TBA', 'Item Name': 'Hydraulic hose 2m', 'Qty': 2, 'Selling Price': 1500, 'Line Sales': 3000, 'Landed Cost/Unit': 900, 'Line COGS': 1800, 'Item ID': '' },
      { 'INV No': 'INV-OLD', 'Item No': 'N/A', 'Item Name': 'Freight and handling', 'Qty': 1, 'Selling Price': 2500, 'Line Sales': 2500, 'Landed Cost/Unit': 0, 'Line COGS': 0, 'Item ID': '' }],
    ARAging: [{ 'AR No': 'AR-OLD', 'INV No': 'INV-OLD', 'SO No': '', 'Customer': 'Therma South, Inc.', 'Amount (PHP)': 140000, 'Collected (PHP)': 0, 'Status': 'Unpaid' }]
  });
  const c = load(GS, st);
  const r = call(c, 'voidInvoice', Object.assign({ invNo: 'INV-OLD', reason: 'Billed the wrong order.' }, ACCT));
  ok('an old line with no id, two rows by name and a cost: asked, and "skip" is not offered', !r.success && r.needsItem.length === 1 && r.needsItem[0].line === 2 &&
     r.needsItem[0].allow.length === 0, r);
  ok('  nothing written: the receivable and the invoice are untouched', st.ARAging.length === 1 && st.Invoices[0]['Voided'] === '' && bal(st, 'ITM-00099') === 34);
  const skip = call(c, 'voidInvoice', Object.assign({ invNo: 'INV-OLD', reason: 'Billed the wrong order.', lineItems: JSON.stringify({ 2: 'skip' }) }, ACCT));
  ok('  "skip" on a line that cost something is refused', !skip.success && skip.needsItem[0].how === 'badpick', skip);
  const v = call(c, 'voidInvoice', Object.assign({ invNo: 'INV-OLD', reason: 'Billed the wrong order.', lineItems: JSON.stringify({ 2: 'ITM-00300' }) }, ACCT));
  ok('the line costed from row 99 goes back to row 99 (where it left), the hose to the pick, freight nowhere', v.success && bal(st, 'ITM-00099') === 35 &&
     bal(st, 'ITM-00300') === 8 && st.Inventory.length === 8, [v, st.Inventory.length]);
}

sec('4 · reversing a receiving, POs and the import');
{
  const st = store(null, {
    MaterialsReceiving: [{ 'MR No': 'MR-202610-018', 'PO No': '', 'Date': '2026-10-20', 'Supplier': 'Con Ban Kiat', 'Received By': 'Maria Santos', 'SO No': '' }],
    ReceivingItems: [{ 'MR No': 'MR-202610-018', 'Item No': 'N/A', 'Item Name': 'TORCH; HAND; CUTTING', 'Qty Received': 1, 'Purchase Price/Unit (FC)': 54280,
                       'Purchase Price/Unit (PHP)': 54280, 'Shipping/Unit (PHP)': 0, 'Landed Cost/Unit': 54280, 'Total Landed Cost': 54280, 'Item ID': '' }]
  });
  const c = load(GS, st);
  const pv = call(c, 'previewReceivingReversal', Object.assign({ mrNo: 'MR-202610-018' }, ACCT));
  ok('an old line with no id is not reversed by a guess: candidates, and the row the old rule used', pv.success && !pv.canReverse &&
     pv.lines[0].suggested === 'ITM-00099' && pv.lines[0].candidates.some(x => x.itemId === 'ITM-00151') && /old rule would have used ITM-00099/.test(pv.lines[0].reason), pv);
  const p2 = call(c, 'previewReceivingReversal', Object.assign({ mrNo: 'MR-202610-018', lineItems: JSON.stringify({ 1: 'ITM-00099' }) }, ACCT));
  ok('  with the pick it can be reversed exactly out of that row', p2.canReverse && p2.lines[0].rowIndex === 2, p2);
}
{
  const st = store(), c = load(GS, st);
  const r = call(c, 'createPurchaseOrder', Object.assign({ supplier: 'Con Ban Kiat', currency: 'PHP', date: '2026-10-21', createdBy: 'Maria Santos',
    items: JSON.stringify([{ itemNo: 'N/A', itemName: '1-torch; hand; cutting', qty: 1, price: 54280 }, { itemNo: 'TBA', itemName: 'Hydraulic hose 2m', qty: 1, price: 900 },
                           { itemNo: 'NEW-9', itemName: 'Brand new part', qty: 1, price: 10 }]) }, ACCT));
  const po = st.PurchaseOrderItems;
  ok('a PO line keeps the id its item resolved to (the receiving copies it from here)', r.success && po[0]['Item ID'] === 'ITM-00151', po);
  ok('  a line two rows fit stays without one (no guess), a new code gets its new row\'s id', po[1]['Item ID'] === '' && /^ITM-\d{5}$/.test(po[2]['Item ID']) &&
     st.Inventory.find(x => x['Item ID'] === po[2]['Item ID'])['Item No'] === 'NEW-9', po);
}
{
  const st = store(), c = load(GS, st);
  const r = call(c, 'importInventory', Object.assign({ items: JSON.stringify([{ itemNo: 'TBA', description: 'Hydraulic hose 2m', qty: 3 },
    { itemNo: 'N/A', description: 'Brand new pump', qty: 2 }, { itemNo: 'N/A', description: 'Brand new pump', qty: 2 }]) }, ACCT));
  ok('the import skips a line two rows fit, and adds a new item once even when the file names it twice', r.success && r.ambiguous.length === 1 && r.created === 1 && r.updated === 1 &&
     st.Inventory.filter(x => x['Description'] === 'Brand new pump').length === 1 && st.Inventory.filter(x => x['Description'] === 'Hydraulic hose 2m').length === 2, r);
}

sec('5 · the switch: itemStrictMatch off is exactly the code before A387');
{
  const st = store(OFF), c = load(GS, st);
  const r = call(c, 'createReceiving', rc([TORCH_PO]));
  ok('off: the torch lands on the first N/A row again (the old behaviour, on purpose)', r.success && bal(st, 'ITM-00099') === 35 && bal(st, 'ITM-00151') === 2, r);
}
{
  let old = null;
  try {
    old = path.join(os.tmpdir(), 'FlowAPI-pre-a387-' + process.pid + '.gs');
    fs.writeFileSync(old, execSync('git show 9b1ff09:apps-script/FlowAPI.gs', { cwd: path.join(__dirname, '..', '..'), maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) { old = null; }
  if (!old) console.log('  skip the byte-for-byte comparison: git history is not available here');
  else {
    const norm = (st) => JSON.stringify(st, (k, v) => (k === 'Last Updated' || k === 'Created At' || k === 'Timestamp' || k === 'Date' && v instanceof Date) ? 'T' : v)
      .replace(/"20\d\d-\d\d-\d\dT[0-9:.]+Z"/g, '"T"').replace(/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"U"');   // DocMeta ids are random
    const run = (gs, settings) => {
      const st = store(settings), c = load(gs, st);
      const out = [
        call(c, 'createReceiving', rc([TORCH_PO, { itemNo: 'N/A', itemName: 'Zebra belt', qty: 2, price: 10 }, { itemNo: 'cp872', itemName: 'Impact wrench', qty: 1, price: 11000 }])),
        call(c, 'createInvoice', iv([{ itemNo: 'N/A', itemName: 'TORCH;  HAND; CUTTING', qty: 1, price: 120000, itemId: 'ITM-00099' },
                                      { itemNo: 'N/A', itemName: 'Freight and handling', qty: 1, price: 2500 }], { confirmShort: true })),
        call(c, 'createPurchaseOrder', Object.assign({ supplier: 'Con Ban Kiat', currency: 'PHP', date: '2026-10-21', createdBy: 'Maria Santos',
          items: JSON.stringify([{ itemNo: 'N/A', itemName: '1-torch; hand; cutting', qty: 1, price: 54280 }]) }, ACCT)),
        call(c, 'importInventory', Object.assign({ items: JSON.stringify([{ itemNo: 'TBA', description: 'Hydraulic hose 2m', qty: 3 }]) }, ACCT))];
      delete st.FlowSettings;
      return { out: out.map(o => { const x = Object.assign({}, o); delete x.ambiguous; delete x.notStockLines; return x; }), st: st };
    };
    const a = run(old, []), b = run(GS, OFF);
    ok('the same receiving, invoice, PO and import with the switch off leave every sheet exactly as the pre-A387 code does',
       norm(a.st) === norm(b.st), [norm(a.st).slice(0, 300), norm(b.st).slice(0, 300)]);
    ok('  and answer the same', norm(a.out) === norm(b.out), [a.out, b.out]);
    try { fs.unlinkSync(old); } catch (e) {}
  }
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
