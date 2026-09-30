/* AS-3 — the two receiving writers (MRO_Writer.gs, MI_Writer.gs), proven in Node before they are pasted.
 *
 * Run:  node tests/flow/writers-guard.js
 *
 * Both refuse a call without the shared secret (and fail closed when the property is missing),
 * take their sheet ids from Script Properties only, write the receiving/issuance rows in ONE
 * setValues, and update the Inventory tab with one read and at most two writes. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { makeSheet } = require(path.join(__dirname, 'gasload-code.js'));

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

function boot(file, props, books) {
  // books: { sheetId: { tabName: grid } }
  const writes = { setValues: 0, appendRow: 0 };
  const opened = [];
  const ssOf = (id) => {
    const tabs = books[id]; if (!tabs) throw new Error('no such spreadsheet: ' + id);
    const sheets = {}; Object.keys(tabs).forEach(n => { sheets[n] = makeSheet(n, tabs[n]); });
    const wrap = (sh) => { const g = sh.getRange, a = sh.appendRow; sh.appendRow = (r) => { writes.appendRow++; return a(r); }; sh.getRange = function () { const rng = g.apply(sh, arguments); const sv = rng.setValues; rng.setValues = (v) => { writes.setValues++; return sv(v); }; return rng; }; return sh; };
    return { getSheetByName: (n) => (sheets[n] ? wrap(sheets[n]) : null), insertSheet: (n) => { tabs[n] = []; sheets[n] = makeSheet(n, tabs[n]); return wrap(sheets[n]); }, getSheets: () => Object.keys(sheets).map(n => wrap(sheets[n])) };
  };
  const ctx = {
    JSON, Math, Date, String, Number, Object, Array, parseInt, parseFloat, isNaN, Error,
    SpreadsheetApp: { openById: (id) => { opened.push(id); return ssOf(id); } },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    Utilities: { formatDate: () => '2026-09-30 12:00:00', getUuid: () => require('crypto').randomUUID(),
      computeHmacSha256Signature: (d, k) => { const b = (v) => Buffer.isBuffer(v) ? v : Array.isArray(v) ? Buffer.from(v) : Buffer.from(String(v)); return [...require('crypto').createHmac('sha256', b(k)).update(b(d)).digest()]; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props[k] === undefined ? null : props[k]) }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', file), 'utf8'), ctx, { filename: file });
  ctx.__writes = writes; ctx.__opened = opened;
  return ctx;
}
const post = (ctx, body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const inv = () => [['Model No.', 'Item Description', 'Current Qty', 'Last Updated'], ['M-1', 'Old desc', 5, ''], ['M-2', 'Two', 1, '']];

sec('1 · MRO_Writer: the secret and the properties');
{
  const books = { 'MRO-BOOK': { Sheet1: [['Vendor', 'Date', 'Sales Invoice', 'PO No.', 'Model No.', 'Item Description', 'Qty', 'Remarks', 'Received By', 'Drive Link']] }, 'INV-BOOK': { Inventory: inv() } };
  let c = boot('MRO_Writer.gs', {}, books);
  let r = post(c, { rows: [{ model_no: 'M-1', quantity: 2 }], sharedSecret: 'srv' });
  ok('with no INTERNAL_SHARED_SECRET property every call is refused (fail closed)', r.status === 'error' && /not set/.test(r.message), r);
  c = boot('MRO_Writer.gs', { INTERNAL_SHARED_SECRET: 'srv', MRO_SHEET_ID: 'MRO-BOOK', INVENTORY_SHEET_ID: 'INV-BOOK' }, books);
  r = post(c, { rows: [{ model_no: 'M-1', quantity: 2 }] });
  ok('no secret → Forbidden', r.status === 'error' && r.message === 'Forbidden', r);
  r = post(c, { rows: [{ model_no: 'M-1', quantity: 2 }], sharedSecret: 'wrong' });
  ok('wrong secret → Forbidden', r.status === 'error' && r.message === 'Forbidden', r);
  ok('  and nothing was opened or written', c.__opened.length === 0 && c.__writes.setValues === 0 && c.__writes.appendRow === 0);
  r = post(c, { rows: [], sharedSecret: 'srv' });
  ok('an empty batch is an error, as before', r.status === 'error' && /No rows/.test(r.message), r);
}

sec('2 · MRO_Writer: one write for the rows, one read and two writes for the inventory');
{
  const books = { 'MRO-BOOK': { Sheet1: [['Vendor', 'Date', 'Sales Invoice', 'PO No.', 'Model No.', 'Item Description', 'Qty', 'Remarks', 'Received By', 'Drive Link']] }, 'INV-BOOK': { Inventory: inv() }, 'EVIL': { Inventory: inv() } };
  const c = boot('MRO_Writer.gs', { INTERNAL_SHARED_SECRET: 'srv', MRO_SHEET_ID: 'MRO-BOOK', INVENTORY_SHEET_ID: 'INV-BOOK' }, books);
  const rows = [
    { vendor_name: 'Acme', receiving_date: '2026-09-30', sales_invoice: 'SI-1', purchase_order_no: 'PO-1', model_no: 'M-1', item_description: 'New desc', quantity: 3, remarks: '', received_by: 'Neil', drive_link: '' },
    { vendor_name: 'Acme', receiving_date: '2026-09-30', sales_invoice: 'SI-1', purchase_order_no: 'PO-1', model_no: 'm-1', item_description: 'New desc', quantity: 1, remarks: '', received_by: 'Neil', drive_link: '' },
    { vendor_name: 'Acme', receiving_date: '2026-09-30', sales_invoice: 'SI-1', purchase_order_no: 'PO-1', model_no: 'M-9', item_description: 'Brand new', quantity: 4, remarks: '', received_by: 'Neil', drive_link: '' },
  ];
  const r = post(c, { rows, sharedSecret: 'srv', inventory_sheet_id: 'EVIL', mro_sheet_id: 'EVIL' });
  eq('status', r.status, 'success'); eq('rows_added', r.rows_added, 3);
  ok('the ids named in the payload were ignored: only the property books were opened', !c.__opened.includes('EVIL') && c.__opened.includes('MRO-BOOK') && c.__opened.includes('INV-BOOK'), c.__opened);
  const mro = books['MRO-BOOK'].Sheet1;
  ok('three receiving rows landed, vendor first then date (the old column order)', mro.length === 4 && mro[1][0] === 'Acme' && mro[1][1] === '2026-09-30' && mro[3][4] === 'M-9', mro);
  const iv = books['INV-BOOK'].Inventory;
  const m1 = iv.find(x => x[0] === 'M-1'), m2 = iv.find(x => x[0] === 'M-2'), m9 = iv.find(x => x[0] === 'M-9');
  eq('M-1: 5 + 3 + 1 (case-insensitive) = 9', m1[2], 9);
  eq('  its description was updated', m1[1], 'New desc');
  eq('M-2 untouched', m2[2], 1);
  ok('M-9 appended with qty 4', m9 && m9[2] === 4 && m9[1] === 'Brand new', m9);
  ok('the book named in the payload was untouched', books.EVIL.Inventory.find(x => x[0] === 'M-1')[2] === 5);
  eq('writes: 1 for the receiving rows + 1 update block + 1 append = 3 setValues', c.__writes.setValues, 3);
  eq('  and no per-row appendRow', c.__writes.appendRow, 0);
}

sec('3 · MI_Writer: deduct never goes below zero; the Issuance tab is created if missing');
{
  const books = { 'INV-BOOK': { Inventory: inv() } };
  const c = boot('MI_Writer.gs', { INTERNAL_SHARED_SECRET: 'srv', INVENTORY_SHEET_ID: 'INV-BOOK' }, books);
  let r = post(c, { rows: [{ model_no: 'M-1', quantity: 2 }], sharedSecret: 'nope' });
  ok('wrong secret → Forbidden', r.status === 'error' && r.message === 'Forbidden', r);
  r = post(c, { rows: [
    { issuance_date: '2026-09-30', recipient_name: 'Site A', issuance_no: 'MI-1', requisition_no: 'RQ-1', model_no: 'M-1', item_description: 'Old desc', quantity: 2, issued_by: 'Neil' },
    { issuance_date: '2026-09-30', recipient_name: 'Site A', issuance_no: 'MI-1', requisition_no: 'RQ-1', model_no: 'M-2', item_description: 'Two', quantity: 5, issued_by: 'Neil' },
    { issuance_date: '2026-09-30', recipient_name: 'Site A', issuance_no: 'MI-1', requisition_no: 'RQ-1', model_no: 'M-7', item_description: 'Unknown', quantity: 1, issued_by: 'Neil' },
  ], sharedSecret: 'srv' });
  eq('status', r.status, 'success');
  const iss = books['INV-BOOK'].Issuance;
  ok('the Issuance tab was created with its header and three rows, date first', iss && iss.length === 4 && iss[0][0] === 'Date' && iss[1][0] === '2026-09-30' && iss[1][1] === 'Site A', iss && iss.slice(0, 2));
  const iv = books['INV-BOOK'].Inventory;
  eq('M-1: 5 - 2 = 3', iv.find(x => x[0] === 'M-1')[2], 3);
  eq('M-2: 1 - 5 floors at 0', iv.find(x => x[0] === 'M-2')[2], 0);
  eq('an unknown item issued is appended at 0', iv.find(x => x[0] === 'M-7')[2], 0);
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
