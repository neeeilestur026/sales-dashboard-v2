/* A322 — editing a sales order saves.
 *
 * Run:  node tests/flow/so-update.js
 *       FLOW_GS=/path/to/old/FlowAPI.gs node tests/flow/so-update.js   (prove it fails on the old file)
 *
 * WHY. Since A276 appended Type and Service Kind to SalesOrders (14 columns), updateSalesOrder kept
 * rewriting the row with 12 values. Sheets refuses that ("data has 12 columns but the range has 14"),
 * so EVERY sales-order edit failed, and the harness passed it because its setValues did not check
 * the shape (it does now).
 *
 * Pinned:
 *   1. An edit with the form's own payload (which never sends a type) saves, writes all 14 columns,
 *      and KEEPS Type, Service Kind, Created By/At and the client PO fields.
 *   2. Items and total are rewritten from the edit.
 *   3. Moving the order to another quotation re-derives Type / Service Kind from that quotation.
 *   4. An explicit serviceKind wins; the same quotation number again changes nothing.
 */
const path = require('path');
const { load, call } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });

const store = {
  Quotations: [{ 'Quotation No': 'Q-RENT', 'Customer': 'ABOITIZ POWER CORPORATION', 'Type': 'Rental', 'Service Kind': 'Tool hire', 'Status': 'Approved' },
               { 'Quotation No': 'Q-SUPPLY', 'Customer': 'ABOITIZ POWER CORPORATION', 'Type': 'Supply', 'Service Kind': '', 'Status': 'Approved' }],
  ActivityLog: []
};
const ctx = load(process.env.FLOW_GS || undefined, store);
const WHO = { actorRole: 'sales', actorName: 'Kim Sales' };
const line = (qty, price) => JSON.stringify([{ itemNo: 'IHV50330', itemName: 'OLAER PARKER BLADDER 50 L', qty, price }]);
const so = () => store.SalesOrders.find(r => r['SO No'] === '150001774');

console.log('\n1 · the edit the form sends');
let r = call(ctx, 'createSalesOrder', Object.assign({ soNo: '150001774', quotationNo: 'Q-RENT', customer: 'ABOITIZ POWER CORPORATION',
  date: '2026-08-11', status: 'Open', supplierType: 'International', clientPoDate: '2026-08-10', poReceivedDate: '2026-08-11',
  createdBy: 'Kim Sales', items: line(6, 70000), clientRef: 'c-1' }, WHO));
ok('created', r.success, r);
eq('  type from the quotation', so()['Type'], 'Rental');
eq('  service kind from the quotation', so()['Service Kind'], 'Tool hire');

// exactly the payload flow-sales-orders.js builds — no type fields
r = call(ctx, 'updateSalesOrder', Object.assign({ soNo: '150001774', quotationNo: 'Q-RENT', customer: 'ABOITIZ POWER CORPORATION',
  date: '2026-08-11', status: 'Delivered', supplierType: 'International', clientPoDate: '2026-08-10', poReceivedDate: '2026-08-11',
  clientPoNo: '', createdBy: 'Kim Sales', items: line(7, 70000) }, WHO));
ok('the edit saves (it threw "12 columns … 14" before A322)', r.success, r);
eq('  status changed', so()['Status'], 'Delivered');
eq('  Type kept', so()['Type'], 'Rental');
eq('  Service Kind kept', so()['Service Kind'], 'Tool hire');
eq('  Created By kept', so()['Created By'], 'Kim Sales');
eq('  client PO date kept', so()['Client PO Date'], '2026-08-10');
eq('  supplier type kept', so()['Supplier Type'], 'International');

console.log('\n2 · items and total');
eq('total rewritten', Number(so()['Total']), 490000);
eq('one line, qty 7', store.SalesOrderItems.filter(i => i['SO No'] === '150001774').map(i => i['Qty']).join(','), '7');

console.log('\n3 · moving to another quotation');
r = call(ctx, 'updateSalesOrder', Object.assign({ soNo: '150001774', quotationNo: 'Q-SUPPLY', customer: 'ABOITIZ POWER CORPORATION',
  status: 'Delivered', items: line(7, 70000) }, WHO));
ok('saved', r.success, r);
eq('  Type from the new quotation', so()['Type'], 'Supply');
eq('  Service Kind from the new quotation', so()['Service Kind'], '');

console.log('\n4 · explicit values, and the same quotation again');
r = call(ctx, 'updateSalesOrder', Object.assign({ soNo: '150001774', quotationNo: 'Q-SUPPLY', customer: 'ABOITIZ POWER CORPORATION',
  status: 'Delivered', serviceKind: 'Calibration', items: line(7, 70000) }, WHO));
eq('an explicit service kind wins', so()['Service Kind'], 'Calibration');
r = call(ctx, 'updateSalesOrder', Object.assign({ soNo: '150001774', quotationNo: 'Q-SUPPLY', customer: 'ABOITIZ POWER CORPORATION',
  status: 'Delivered', items: line(7, 70000) }, WHO));
eq('  and the same quotation again keeps it', so()['Service Kind'], 'Calibration');

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
