/**
 * FlowAPI.gs — Standalone backend for the sales-dashboard-v2 Accounting Process Flow.
 *
 *   Inventory → Quotation → Sales Order → Purchase Order (+ AP Aging)
 *             → Materials Receiving (landed cost) → Invoice / Materials Issuance (COGS)
 *
 * This is a SELF-CONTAINED web app, independent of the production Code.gs. It owns its own
 * Google Spreadsheet and never touches production data.
 *
 * SETUP:
 *   1. Create a new Google Spreadsheet ("v2 Process DB"). Copy its ID from the URL.
 *   2. Paste that ID into SHEET_ID below.
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   4. Copy the /exec URL into dashboard/js/flow-api.js (FLOW_API_URL) and .env.
 *
 * All tabs are auto-created with headers on first use.
 */

var SHEET_ID = ''; // ← paste the new "v2 Process DB" spreadsheet ID here

// Optional: Drive folder ID for saved quotation/PO PDFs. Blank → auto find/create "Flow Documents".
var FLOW_DRIVE_FOLDER_ID = '';

// ── Tab schemas (tab name → header row) ──────────────────────────────────────
var SCHEMA = {
  Inventory: ['Item No', 'Description', 'Available Balance', 'Purchase Price/Unit',
              'Shipping Cost/Unit', 'Landed Cost/Unit', 'Total Landed Cost', 'Currency', 'Last Updated'],

  Quotations:     ['Quotation No', 'Date', 'Customer', 'Status', 'Total', 'Created By', 'Created At', 'PDF Link',
                   'Created By Role', 'Approval Note', 'Approved By', 'Approved At'],
  QuotationItems: ['Quotation No', 'Item No', 'Item Name', 'Quoted Qty', 'Quoted Price', 'Line Total'],

  SalesOrders:     ['SO No', 'Quotation No', 'Date', 'Customer', 'Status', 'Total', 'Created By', 'Created At'],
  SalesOrderItems: ['SO No', 'Item No', 'Item Name', 'Qty', 'Price/Unit', 'Total Price'],

  PurchaseOrders:     ['PO No', 'SO No', 'Date', 'Supplier', 'Currency', 'Total Purchase (FC)', 'Status', 'Created By', 'Created At', 'PDF Link',
                       'Created By Role', 'Approval Note', 'Approved By', 'Approved At'],
  PurchaseOrderItems: ['PO No', 'Item No', 'Item Name', 'Qty', 'Purchase Price/Unit (FC)', 'Total (FC)'],

  APAging: ['AP No', 'PO No', 'Supplier', 'Currency', 'Amount (FC)', 'Amount (PHP)', 'Status',
            'Due Date', 'Paid (PHP)', 'Notes', 'Created At', 'Updated At'],

  MaterialsReceiving: ['MR No', 'PO No', 'Date', 'Supplier', 'Currency', 'Customs Duties (PHP)',
                       'VAT (PHP)', 'Delivery Charges (PHP)', 'Other Charges (PHP)',
                       'Total Shipping Cost (PHP)', 'Received By', 'Created At'],
  ReceivingItems:     ['MR No', 'Item No', 'Item Name', 'Qty Received', 'Purchase Price/Unit (FC)',
                       'Purchase Price/Unit (PHP)', 'Shipping/Unit (PHP)', 'Landed Cost/Unit', 'Total Landed Cost'],

  Invoices:     ['INV No', 'SO No', 'Date', 'Customer', 'Total Sales', 'Total COGS', 'Created By', 'Created At'],
  InvoiceItems: ['INV No', 'Item No', 'Item Name', 'Qty', 'Selling Price', 'Line Sales', 'Landed Cost/Unit', 'Line COGS'],

  // ── Accounts Receivable (after Invoices: client pays the sales-order amount) + Collections ──
  ARAging:     ['AR No', 'INV No', 'SO No', 'Customer', 'Amount (PHP)', 'Collected (PHP)', 'Status',
                'Due Date', 'Notes', 'Created At', 'Updated At'],
  Collections: ['Collection No', 'AR No', 'INV No', 'SO No', 'Customer', 'Date', 'Amount (PHP)',
                'Method', 'Reference No', 'Notes', 'Created At'],

  // ── Expenses ledger (OpEx / G&A / Other) — pure record, no GL journals ──
  Expenses: ['Exp No', 'Date', 'Type', 'Category', 'Voucher No', 'Client', 'Description', 'Toll',
             'Fuel', 'Meals', 'Load Balance', 'Other', 'Amount', 'Notes', 'Created By', 'Legacy Key', 'Created At'],

  // ── Phase 2: General Ledger ──
  ChartOfAccounts: ['Code', 'Name', 'Type', 'Normal Balance'],
  Journal: ['Entry No', 'Date', 'Source', 'Source No', 'Account Code', 'Account Name', 'Debit', 'Credit', 'Currency', 'Memo', 'Created At'],

  // ── Daily report: auto-logged activity + per-day notes ──
  ActivityLog: ['Timestamp', 'Date', 'User', 'Module', 'Action', 'Ref No', 'Summary', 'Amount', 'Currency'],
  DailyNotes:  ['Date', 'Notes', 'Updated By', 'Updated At'],

  // ── Sales pricing-request flow (PR → sourcing → pricing → verify → sales → quotation) ──
  PricingRequests: ['PR No', 'Date', 'Requested By', 'Customer', 'Destination', 'Commission %', 'Margin %',
                    'Status', 'PDF Link', 'Notes', 'Created At', 'Updated At'],
  PricingRequestItems: ['PR No', 'Line', 'Item No', 'Item Name', 'Qty', 'UOM', 'Remarks', 'Included',
                        'Supplier', 'Principal', 'Currency', 'Supplier Price (FC)', 'CBM', 'Final Price'],

  // ── Generic per-record document attachments (any process step) ──
  Documents: ['Doc ID', 'Module', 'Ref No', 'Doc Type', 'File Name', 'Drive Link', 'File ID',
              'Uploaded By', 'Uploaded At']
};

// ── Chart of Accounts (seeded) ───────────────────────────────────────────────
var COA = [
  ['1010', 'Cash', 'Asset', 'Debit'],
  ['1200', 'Accounts Receivable', 'Asset', 'Debit'],
  ['1300', 'Inventory', 'Asset', 'Debit'],
  ['1400', 'Purchases Clearing', 'Asset', 'Debit'],
  ['1500', 'Input VAT Receivable', 'Asset', 'Debit'],
  ['2010', 'Accounts Payable', 'Liability', 'Credit'],
  ['4000', 'Sales', 'Revenue', 'Credit'],
  ['5000', 'Cost of Goods Sold', 'Expense', 'Debit']
];
var ACC = { CASH: '1010', AR: '1200', INV: '1300', CLEARING: '1400', INPUT_VAT: '1500', AP: '2010', SALES: '4000', COGS: '5000' };
function _accName(code) { for (var i = 0; i < COA.length; i++) if (COA[i][0] === code) return COA[i][1]; return code; }

// ── Spreadsheet / sheet helpers ──────────────────────────────────────────────
function _ss() {
  if (!SHEET_ID) throw new Error('SHEET_ID is not set in FlowAPI.gs');
  return SpreadsheetApp.openById(SHEET_ID);
}

function _sheet(name) {
  var ss = _ss();
  var sh = ss.getSheetByName(name);
  var headers = SCHEMA[name];
  if (!headers) throw new Error('Unknown sheet: ' + name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Drop the default blank "Sheet1" if it is still empty/untouched
    var blank = ss.getSheetByName('Sheet1');
    if (blank && blank.getName() !== name && blank.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(blank); } catch (e) {}
    }
  }
  return sh;
}

/** Read a tab as an array of {header:value} objects, adding a 1-based rowIndex. */
function _rows(name) {
  var sh = _sheet(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SCHEMA[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var obj = { rowIndex: i + 2 };
    headers.forEach(function (h, c) { obj[h] = row[c]; });
    return obj;
  });
}

/** Append a record given as an array matching the schema column order. */
function _append(name, arr) {
  _sheet(name).appendRow(arr);
}

/** Next document number: PREFIX-YYYYMM-NNN (NNN unique per month). */
function _nextNumber(name, col, prefix) {
  var sh = _sheet(name);
  var last = sh.getLastRow();
  var now = new Date();
  var ym = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMM');
  var stem = prefix + '-' + ym + '-';
  var max = 0;
  if (last >= 2) {
    var vals = sh.getRange(2, col, last - 1, 1).getValues();
    vals.forEach(function (r) {
      var s = String(r[0] || '');
      if (s.indexOf(stem) === 0) {
        var n = parseInt(s.substring(stem.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }
  return stem + ('00' + (max + 1)).slice(-3);
}

function _num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _now() { return new Date(); }

// ── HTTP entry points ────────────────────────────────────────────────────────
function doGet(e) {
  return _dispatch((e && e.parameter) || {});
}

function doPost(e) {
  var params = {};
  try {
    if (e && e.postData && e.postData.contents) params = JSON.parse(e.postData.contents);
  } catch (err) {
    if (e && e.parameter) params = e.parameter;
  }
  return _dispatch(params);
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _dispatch(params) {
  var action = params.action || '';
  try {
    var handler = HANDLERS[action];
    if (!handler) return _json({ success: false, message: 'Unknown action: ' + action });
    // Serialize mutations to keep numbering + inventory math consistent.
    if (MUTATIONS[action]) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var out = handler(params);
        if (out && out.success && action !== 'saveDailyNote') _logActivity(action, params, out);
        return _json(out);
      } finally { lock.releaseLock(); }
    }
    return _json(handler(params));
  } catch (err) {
    return _json({ success: false, message: String(err && err.message || err) });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  INVENTORY
// ════════════════════════════════════════════════════════════════════════════
function _invComputed(balance, purchase, shipping) {
  var landed = _num(purchase) + _num(shipping);
  return { landed: landed, total: _num(balance) * landed };
}

function getInventory() {
  return { success: true, data: _rows('Inventory').map(function (r) {
    return {
      itemNo: r['Item No'], description: r['Description'], balance: _num(r['Available Balance']),
      purchasePrice: _num(r['Purchase Price/Unit']), shippingCost: _num(r['Shipping Cost/Unit']),
      landedCost: _num(r['Landed Cost/Unit']), totalLanded: _num(r['Total Landed Cost']),
      currency: r['Currency'] || 'PHP', lastUpdated: r['Last Updated'], rowIndex: r.rowIndex
    };
  }) };
}

function _findInventory(itemNo) {
  var rows = _rows('Inventory');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Item No']).trim() === String(itemNo).trim()) return rows[i];
  }
  return null;
}

function addInventoryItem(p) {
  if (!p.itemNo || !p.description) return { success: false, message: 'Item No and Description are required.' };
  if (_findInventory(p.itemNo)) return { success: false, message: 'Item No already exists.' };
  var c = _invComputed(p.balance, p.purchasePrice, p.shippingCost);
  _append('Inventory', [String(p.itemNo).trim(), String(p.description).trim(), _num(p.balance),
    _num(p.purchasePrice), _num(p.shippingCost), c.landed, c.total, p.currency || 'PHP', _now()]);
  return { success: true, message: 'Item added.' };
}

function updateInventoryItem(p) {
  var sh = _sheet('Inventory');
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var c = _invComputed(p.balance, p.purchasePrice, p.shippingCost);
  sh.getRange(ri, 1, 1, SCHEMA.Inventory.length).setValues([[String(p.itemNo).trim(),
    String(p.description).trim(), _num(p.balance), _num(p.purchasePrice), _num(p.shippingCost),
    c.landed, c.total, p.currency || 'PHP', _now()]]);
  return { success: true, message: 'Item updated.' };
}

function deleteInventoryItem(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  _sheet('Inventory').deleteRow(ri);
  return { success: true, message: 'Item deleted.' };
}

/** Adjust an inventory item by delta qty and (optionally) set new cost basis. Creates if missing. */
function _applyInventory(itemNo, itemName, deltaQty, newPurchase, newShipping, currency) {
  var sh = _sheet('Inventory');
  var existing = _findInventory(itemNo);
  if (existing) {
    var balance = _num(existing['Available Balance']) + _num(deltaQty);
    if (balance < 0) balance = 0;
    var purchase = (newPurchase === null || newPurchase === undefined) ? _num(existing['Purchase Price/Unit']) : _num(newPurchase);
    var shipping = (newShipping === null || newShipping === undefined) ? _num(existing['Shipping Cost/Unit']) : _num(newShipping);
    var c = _invComputed(balance, purchase, shipping);
    sh.getRange(existing.rowIndex, 3, 1, 7).setValues([[balance, purchase, shipping, c.landed, c.total,
      currency || existing['Currency'] || 'PHP', _now()]]);
  } else {
    var bal = Math.max(0, _num(deltaQty));
    var c2 = _invComputed(bal, newPurchase, newShipping);
    _append('Inventory', [String(itemNo).trim(), String(itemName || itemNo).trim(), bal,
      _num(newPurchase), _num(newShipping), c2.landed, c2.total, currency || 'PHP', _now()]);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  QUOTATION
// ════════════════════════════════════════════════════════════════════════════
function _itemsFor(name, key, no) {
  return _rows(name).filter(function (r) { return String(r[key]) === String(no); });
}

function getQuotations(p) {
  var items = _rows('QuotationItems');
  var headers = _rows('Quotations');
  if (p && p.createdBy) headers = headers.filter(function (q) { return String(q['Created By']) === String(p.createdBy); });
  return { success: true, data: headers.map(function (q) {
    var its = items.filter(function (r) { return String(r['Quotation No']) === String(q['Quotation No']); });
    return {
      quotationNo: q['Quotation No'], date: q['Date'], customer: q['Customer'], status: q['Status'] || 'Draft',
      total: _num(q['Total']), createdBy: q['Created By'], createdAt: q['Created At'],
      pdfLink: q['PDF Link'] || '', createdByRole: q['Created By Role'] || '',
      approvalNote: q['Approval Note'] || '', approvedBy: q['Approved By'] || '', approvedAt: q['Approved At'] || '',
      rowIndex: q.rowIndex,
      items: its.map(function (r) { return {
        itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Quoted Qty']),
        price: _num(r['Quoted Price']), lineTotal: _num(r['Line Total']) }; })
    };
  }) };
}

function _writeItems(sheetName, key, no, items, mapRow) {
  // remove existing rows for `no`, then append fresh ones (bottom-up delete preserves indices)
  var sh = _sheet(sheetName);
  var rows = _rows(sheetName).filter(function (r) { return String(r[key]) === String(no); });
  rows.sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { sh.deleteRow(r.rowIndex); });
  (items || []).forEach(function (it) { sh.appendRow(mapRow(it)); });
}

function createQuotation(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.customer) return { success: false, message: 'Customer is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var no = p.quotationNo || _nextNumber('Quotations', 1, 'QTN');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  // Status starts at Draft; the approval workflow drives it from there. Capture the creator's role.
  _append('Quotations', [no, p.date || _now(), p.customer, p.status || 'Draft', total, p.createdBy || '', _now(), '',
    p.actorRole || p.createdByRole || '', '', '', '']);
  _writeItems('QuotationItems', 'Quotation No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  return { success: true, quotationNo: no, message: 'Quotation created.' };
}

function updateQuotation(p) {
  var no = p.quotationNo;
  if (!no) return { success: false, message: 'quotationNo required.' };
  var items = JSON.parse(p.items || '[]');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  var sh = _sheet('Quotations');
  var rows = _rows('Quotations');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Quotation No']) === String(no)) {
      sh.getRange(rows[i].rowIndex, 1, 1, 7).setValues([[no, p.date || rows[i]['Date'],
        p.customer, p.status || rows[i]['Status'], total, rows[i]['Created By'], rows[i]['Created At']]]);
      break;
    }
  }
  _writeItems('QuotationItems', 'Quotation No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  return { success: true, quotationNo: no, message: 'Quotation updated.' };
}

function deleteQuotation(p) {
  var no = p.quotationNo;
  var sh = _sheet('Quotations');
  _rows('Quotations').filter(function (r) { return String(r['Quotation No']) === String(no); })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { sh.deleteRow(r.rowIndex); });
  _writeItems('QuotationItems', 'Quotation No', no, [], function () { return []; });
  return { success: true, message: 'Quotation deleted.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  SALES ORDER  (loads from a Quotation)
// ════════════════════════════════════════════════════════════════════════════
function getSalesOrders() {
  var items = _rows('SalesOrderItems');
  return { success: true, data: _rows('SalesOrders').map(function (s) {
    var its = items.filter(function (r) { return String(r['SO No']) === String(s['SO No']); });
    return {
      soNo: s['SO No'], quotationNo: s['Quotation No'], date: s['Date'], customer: s['Customer'],
      status: s['Status'], total: _num(s['Total']), createdBy: s['Created By'], createdAt: s['Created At'],
      rowIndex: s.rowIndex,
      items: its.map(function (r) { return {
        itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
        price: _num(r['Price/Unit']), total: _num(r['Total Price']) }; })
    };
  }) };
}

function createSalesOrder(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.customer) return { success: false, message: 'Customer is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var no = p.soNo || _nextNumber('SalesOrders', 1, 'SO');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  _append('SalesOrders', [no, p.quotationNo || '', p.date || _now(), p.customer, p.status || 'Open',
    total, p.createdBy || '', _now()]);
  _writeItems('SalesOrderItems', 'SO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  return { success: true, soNo: no, message: 'Sales Order created.' };
}

// Bulk-import legacy Sales Orders (header + items). Preserves the original SO No, skips any that already
// exist (idempotent), tolerant of blank customer / zero-item records so no legacy record is lost.
function importSalesOrders(p) {
  var incoming = JSON.parse(p.items || '[]');
  if (!incoming.length) return { success: false, message: 'No sales orders to import.' };
  var existing = {};
  _rows('SalesOrders').forEach(function (r) { existing[String(r['SO No'])] = true; });
  var soSh = _sheet('SalesOrders'), itemSh = _sheet('SalesOrderItems');
  var created = 0, skipped = 0, errors = [];
  incoming.forEach(function (so) {
    try {
      var no = so.soNo || _nextNumber('SalesOrders', 1, 'SO');
      if (existing[String(no)]) { skipped++; return; }
      var items = Array.isArray(so.items) ? so.items : [];
      var total = 0;
      items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
      soSh.appendRow([no, so.quotationNo || '', so.date || _now(), so.customer || '(unknown)',
        so.status || 'Open', total, so.createdBy || 'Migrated (legacy)', _now()]);
      items.forEach(function (it) {
        itemSh.appendRow([no, it.itemNo || '', it.itemName || '', _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)]);
      });
      existing[String(no)] = true;
      created++;
    } catch (e) {
      errors.push({ soNo: so && so.soNo, message: String(e && e.message || e) });
    }
  });
  return { success: true, created: created, skipped: skipped, errors: errors,
    message: 'Imported ' + created + ' sales order(s); skipped ' + skipped + ' already present.' };
}

// Bulk-import legacy Collections (the old invoice-level receivables ledger) into the flow. Each old
// record becomes one ARAging row (Amount = totalAmountDue, Collected = amountReceived) and, when any
// amount was received, one Collections payment row. Preserves the original invoice number (dedupe key),
// skips invoices already present (idempotent), and posts NO journals (pure historical record write).
function importCollections(p) {
  var incoming = JSON.parse(p.items || '[]');
  if (!incoming.length) return { success: false, message: 'No collections to import.' };
  var existing = {};
  _rows('ARAging').forEach(function (r) { existing[String(r['INV No'])] = true; });
  var createdAR = 0, createdPayments = 0, skipped = 0, errors = [];
  incoming.forEach(function (c) {
    try {
      var invNo = c.invoiceNo != null ? String(c.invoiceNo) : '';
      if (invNo && existing[invNo]) { skipped++; return; }
      var due = _num(c.totalAmountDue), recv = _num(c.amountReceived);
      var status = recv <= 0 ? 'Unpaid' : (recv >= due && due > 0 ? 'Paid' : 'Partial');
      // Preserve the old breakdown in Notes (blanks omitted).
      var parts = ['Migrated (legacy)'];
      if (c.drNo) parts.push('DR ' + c.drNo);
      if (c.poNo) parts.push('PO ' + c.poNo);
      if (c.paymentTerms) parts.push('Terms ' + c.paymentTerms);
      if (c.netOfVat) parts.push('Net ' + c.netOfVat);
      if (c.vat) parts.push('VAT ' + c.vat);
      if (c.ewt) parts.push('EWT ' + c.ewt);
      if (c.dateReceived) parts.push('Rcvd ' + c.dateReceived);
      var notes = parts.join(' · ');
      var arNo = _nextNumber('ARAging', 1, 'AR');
      var customer = c.customer || '(unknown)';
      _append('ARAging', [arNo, invNo, c.soNo || '', customer, due, recv, status,
        c.dueDate || '', notes, _now(), _now()]);
      if (recv > 0) {
        var colNo = _nextNumber('Collections', 1, 'COL');
        _append('Collections', [colNo, arNo, invNo, c.soNo || '', customer,
          c.dateCollected || c.date || _dateStr(_now()), recv, '', '', 'Migrated (legacy)', _now()]);
        createdPayments++;
      }
      if (invNo) existing[invNo] = true;
      createdAR++;
    } catch (e) {
      errors.push({ invoiceNo: c && c.invoiceNo, message: String(e && e.message || e) });
    }
  });
  return { success: true, createdAR: createdAR, createdPayments: createdPayments, skipped: skipped,
    errors: errors, message: 'Imported ' + createdAR + ' receivable(s) and ' + createdPayments +
    ' payment(s); skipped ' + skipped + ' already present.' };
}

function updateSalesOrder(p) {
  var no = p.soNo;
  if (!no) return { success: false, message: 'soNo required.' };
  var items = JSON.parse(p.items || '[]');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  var sh = _sheet('SalesOrders');
  _rows('SalesOrders').forEach(function (r) {
    if (String(r['SO No']) === String(no)) {
      sh.getRange(r.rowIndex, 1, 1, SCHEMA.SalesOrders.length).setValues([[no, p.quotationNo || r['Quotation No'],
        p.date || r['Date'], p.customer, p.status || r['Status'], total, r['Created By'], r['Created At']]]);
    }
  });
  _writeItems('SalesOrderItems', 'SO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  return { success: true, soNo: no, message: 'Sales Order updated.' };
}

function deleteSalesOrder(p) {
  var no = p.soNo;
  var sh = _sheet('SalesOrders');
  _rows('SalesOrders').filter(function (r) { return String(r['SO No']) === String(no); })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { sh.deleteRow(r.rowIndex); });
  _writeItems('SalesOrderItems', 'SO No', no, [], function () { return []; });
  return { success: true, message: 'Sales Order deleted.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  PURCHASE ORDER  (loads from a Sales Order; auto-creates an AP Aging row)
// ════════════════════════════════════════════════════════════════════════════
function getPurchaseOrders() {
  var items = _rows('PurchaseOrderItems');
  return { success: true, data: _rows('PurchaseOrders').map(function (po) {
    var its = items.filter(function (r) { return String(r['PO No']) === String(po['PO No']); });
    return {
      poNo: po['PO No'], soNo: po['SO No'], date: po['Date'], supplier: po['Supplier'],
      currency: po['Currency'] || 'PHP', total: _num(po['Total Purchase (FC)']), status: po['Status'] || 'Draft',
      createdBy: po['Created By'], createdAt: po['Created At'], pdfLink: po['PDF Link'] || '',
      createdByRole: po['Created By Role'] || '', approvalNote: po['Approval Note'] || '',
      approvedBy: po['Approved By'] || '', approvedAt: po['Approved At'] || '', rowIndex: po.rowIndex,
      items: its.map(function (r) { return {
        itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
        price: _num(r['Purchase Price/Unit (FC)']), total: _num(r['Total (FC)']) }; })
    };
  }) };
}

function createPurchaseOrder(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.supplier) return { success: false, message: 'Supplier is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var no = p.poNo || _nextNumber('PurchaseOrders', 1, 'PO');
  var currency = p.currency || 'PHP';
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  _append('PurchaseOrders', [no, p.soNo || '', p.date || _now(), p.supplier, currency, total,
    p.status || 'Draft', p.createdBy || '', _now(), '',
    p.actorRole || p.createdByRole || '', '', '', '']);
  _writeItems('PurchaseOrderItems', 'PO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  // Auto-create the Accounts Payable entry (FC amount flows in; PHP filled later by user).
  var apNo = _nextNumber('APAging', 1, 'AP');
  _append('APAging', [apNo, no, p.supplier, currency, total, '', 'Unpaid', '', 0, '', _now(), _now()]);
  // GL: Dr Purchases Clearing / Cr Accounts Payable (Total Purchase Order).
  _postJournal('PO', no, p.date || _now(), currency, [
    { account: ACC.CLEARING, debit: total, memo: 'PO ' + no + ' — ' + p.supplier },
    { account: ACC.AP, credit: total, memo: 'AP ' + apNo + ' — ' + p.supplier }
  ]);
  return { success: true, poNo: no, apNo: apNo, message: 'Purchase Order created, AP entry and journal posted.' };
}

function updatePurchaseOrder(p) {
  var no = p.poNo;
  if (!no) return { success: false, message: 'poNo required.' };
  var items = JSON.parse(p.items || '[]');
  var currency = p.currency || 'PHP';
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  var sh = _sheet('PurchaseOrders');
  _rows('PurchaseOrders').forEach(function (r) {
    if (String(r['PO No']) === String(no)) {
      sh.getRange(r.rowIndex, 1, 1, 9).setValues([[no, p.soNo || r['SO No'],
        p.date || r['Date'], p.supplier, currency, total, p.status || r['Status'], r['Created By'], r['Created At']]]);
    }
  });
  _writeItems('PurchaseOrderItems', 'PO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  // Keep the linked AP entry's FC amount + currency in sync (don't clobber the user's PHP edits).
  var apSh = _sheet('APAging');
  _rows('APAging').forEach(function (r) {
    if (String(r['PO No']) === String(no)) {
      apSh.getRange(r.rowIndex, 4, 1, 2).setValues([[currency, total]]);
      apSh.getRange(r.rowIndex, 12, 1, 1).setValues([[_now()]]);
    }
  });
  // Re-post the PO journal with the updated total.
  _postJournal('PO', no, p.date || _now(), currency, [
    { account: ACC.CLEARING, debit: total, memo: 'PO ' + no + ' — ' + p.supplier },
    { account: ACC.AP, credit: total, memo: 'PO ' + no + ' — ' + p.supplier }
  ]);
  return { success: true, poNo: no, message: 'Purchase Order updated.' };
}

function deletePurchaseOrder(p) {
  var no = p.poNo;
  var sh = _sheet('PurchaseOrders');
  _rows('PurchaseOrders').filter(function (r) { return String(r['PO No']) === String(no); })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { sh.deleteRow(r.rowIndex); });
  _writeItems('PurchaseOrderItems', 'PO No', no, [], function () { return []; });
  var apSh = _sheet('APAging');
  _rows('APAging').filter(function (r) { return String(r['PO No']) === String(no); })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) {
      _removeJournal('APPAY', r['AP No']);   // drop any payment entry
      apSh.deleteRow(r.rowIndex);
    });
  _removeJournal('PO', no);
  return { success: true, message: 'Purchase Order, AP entry and journal entries deleted.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  AP AGING
// ════════════════════════════════════════════════════════════════════════════
function getAPAging() {
  return { success: true, data: _rows('APAging').map(function (r) {
    return {
      apNo: r['AP No'], poNo: r['PO No'], supplier: r['Supplier'], currency: r['Currency'] || 'PHP',
      amountFC: _num(r['Amount (FC)']), amountPHP: _num(r['Amount (PHP)']), status: r['Status'],
      dueDate: r['Due Date'], paidPHP: _num(r['Paid (PHP)']), notes: r['Notes'],
      createdAt: r['Created At'], updatedAt: r['Updated At'], rowIndex: r.rowIndex
    };
  }) };
}

function updateAPAging(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var sh = _sheet('APAging');
  var headers = SCHEMA.APAging;
  var cur = sh.getRange(ri, 1, 1, headers.length).getValues()[0];
  function set(col, val) { if (val !== undefined && val !== null && val !== '') cur[col] = val; }
  set(5, p.amountPHP !== undefined ? _num(p.amountPHP) : undefined); // Amount (PHP)
  set(6, p.status);                                                  // Status
  set(7, p.dueDate);                                                 // Due Date
  set(8, p.paidPHP !== undefined ? _num(p.paidPHP) : undefined);     // Paid (PHP)
  set(9, p.notes);                                                   // Notes
  cur[11] = _now();                                                  // Updated At
  sh.getRange(ri, 1, 1, headers.length).setValues([cur]);
  // GL: payment of A/P — Dr Accounts Payable / Cr Cash (PHP). Amount = paid, or full PHP if marked Paid.
  var apNo = cur[0], currency = cur[3] || 'PHP';
  var payment = _num(cur[8]);
  if (payment === 0 && String(cur[6]).toLowerCase() === 'paid') payment = _num(cur[5]);
  if (payment > 0) {
    _postJournal('APPAY', apNo, _now(), 'PHP', [
      { account: ACC.AP, debit: payment, memo: 'Payment of ' + apNo },
      { account: ACC.CASH, credit: payment, memo: 'Payment of ' + apNo }
    ]);
  } else {
    _removeJournal('APPAY', apNo);
  }
  return { success: true, message: 'AP entry updated.', apNo: apNo, poNo: cur[1] };
}

// ════════════════════════════════════════════════════════════════════════════
//  AR AGING + COLLECTIONS  (receivables after Invoices; client pays the SO amount)
// ════════════════════════════════════════════════════════════════════════════
function getARAging(p) {
  var rows = _rows('ARAging');
  if (p && p.customer) rows = rows.filter(function (r) { return String(r['Customer']) === String(p.customer); });
  if (p && p.soNo) rows = rows.filter(function (r) { return String(r['SO No']) === String(p.soNo); });
  return { success: true, data: rows.map(function (r) {
    var amt = _num(r['Amount (PHP)']), col = _num(r['Collected (PHP)']);
    return {
      arNo: r['AR No'], invNo: r['INV No'], soNo: r['SO No'], customer: r['Customer'],
      amountPHP: amt, collectedPHP: col, outstanding: amt - col, status: r['Status'],
      dueDate: r['Due Date'], notes: r['Notes'], createdAt: r['Created At'], updatedAt: r['Updated At'],
      rowIndex: r.rowIndex
    };
  }) };
}

function getCollections(p) {
  var rows = _rows('Collections');
  if (p && p.soNo) rows = rows.filter(function (r) { return String(r['SO No']) === String(p.soNo); });
  if (p && p.customer) rows = rows.filter(function (r) { return String(r['Customer']) === String(p.customer); });
  if (p && p.arNo) rows = rows.filter(function (r) { return String(r['AR No']) === String(p.arNo); });
  rows.sort(function (a, b) { return new Date(b['Created At']) - new Date(a['Created At']); });
  return { success: true, data: rows.map(function (r) {
    return {
      collectionNo: r['Collection No'], arNo: r['AR No'], invNo: r['INV No'], soNo: r['SO No'],
      customer: r['Customer'], date: r['Date'], amount: _num(r['Amount (PHP)']), method: r['Method'],
      reference: r['Reference No'], notes: r['Notes'], createdAt: r['Created At'], rowIndex: r.rowIndex
    };
  }) };
}

function _arRow(arNo) {
  return _rows('ARAging').filter(function (r) { return String(r['AR No']) === String(arNo); })[0];
}

function recordCollection(p) {
  if (!p.arNo) return { success: false, message: 'arNo required.' };
  var ar = _arRow(p.arNo);
  if (!ar) return { success: false, message: 'AR entry not found.' };
  var amount = _num(p.amount);
  if (amount <= 0) return { success: false, message: 'Collection amount must be greater than zero.' };
  var colNo = _nextNumber('Collections', 1, 'COL');
  _append('Collections', [colNo, p.arNo, ar['INV No'], ar['SO No'], ar['Customer'], p.date || _dateStr(_now()),
    amount, p.method || '', p.ref || '', p.notes || '', _now()]);
  // Recompute collected total + status on the AR row.
  var collected = _rows('Collections').filter(function (r) { return String(r['AR No']) === String(p.arNo); })
    .reduce(function (s, r) { return s + _num(r['Amount (PHP)']); }, 0);
  var amt = _num(ar['Amount (PHP)']);
  var status = collected <= 0 ? 'Unpaid' : (collected >= amt ? 'Paid' : 'Partial');
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Collected (PHP)', collected);
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Status', status);
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Updated At', _now());
  // GL: aggregate cash received against the receivable — Dr Cash / Cr Accounts Receivable.
  _postJournal('ARCOLL', p.arNo, _now(), 'PHP', [
    { account: ACC.CASH, debit: collected, memo: 'Collection of ' + p.arNo },
    { account: ACC.AR, credit: collected, memo: 'Collection of ' + p.arNo }
  ]);
  return { success: true, collectionNo: colNo, arNo: p.arNo, collected: collected, status: status,
    message: 'Collection ' + colNo + ' recorded.' };
}

function updateARAging(p) {
  if (!p.arNo) return { success: false, message: 'arNo required.' };
  if (!_arRow(p.arNo)) return { success: false, message: 'AR entry not found.' };
  if (p.dueDate !== undefined) _setCellByKey('ARAging', 'AR No', p.arNo, 'Due Date', p.dueDate);
  if (p.notes !== undefined) _setCellByKey('ARAging', 'AR No', p.arNo, 'Notes', p.notes);
  if (p.status !== undefined && p.status) _setCellByKey('ARAging', 'AR No', p.arNo, 'Status', p.status);
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Updated At', _now());
  return { success: true, arNo: p.arNo, message: 'AR entry updated.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  EXPENSES  (OpEx / G&A / Other — pure ledger, no GL journals)
// ════════════════════════════════════════════════════════════════════════════
var EXP_TYPE = { OPEX: 'Operating', GA: 'General & Administrative', OTHER: 'Other' };

// Default category → type mapping (lower-cased keys). Anything unmapped → Operating (overridable).
var _EXP_TYPE_MAP = {
  // Operating (selling / distribution / field)
  'advertising': EXP_TYPE.OPEX, 'commission': EXP_TYPE.OPEX, 'delivery expense': EXP_TYPE.OPEX,
  'representation': EXP_TYPE.OPEX, 'transportation and travel': EXP_TYPE.OPEX,
  'load allowances': EXP_TYPE.OPEX, 'postage and communication': EXP_TYPE.OPEX,
  'repairs and maintenance': EXP_TYPE.OPEX, 'supplies expense': EXP_TYPE.OPEX,
  'tools and equipment': EXP_TYPE.OPEX, 'fuel': EXP_TYPE.OPEX, 'toll': EXP_TYPE.OPEX,
  'meals': EXP_TYPE.OPEX, 'gas': EXP_TYPE.OPEX, 'transportation': EXP_TYPE.OPEX,
  // Salaries & wages are treated as an Operating Expense (per user directive).
  'salaries and wages': EXP_TYPE.OPEX, 'payroll': EXP_TYPE.OPEX,
  // General & Administrative
  'employee benefits': EXP_TYPE.GA, 'statutory benefits': EXP_TYPE.GA,
  'rent expense': EXP_TYPE.GA, 'utilities': EXP_TYPE.GA, 'depreciation expense': EXP_TYPE.GA,
  'legal fees': EXP_TYPE.GA, 'professional fees': EXP_TYPE.GA, 'permits and licenses': EXP_TYPE.GA,
  'bank service charge': EXP_TYPE.GA, 'janitorial': EXP_TYPE.GA, 'medical expenses': EXP_TYPE.GA,
  'miscellaneous': EXP_TYPE.GA, 'revolving fund': EXP_TYPE.GA, 'revolving funds': EXP_TYPE.GA,
  // Other / Non-Operating
  'cost of goods sold': EXP_TYPE.OTHER, 'inventory': EXP_TYPE.OTHER,
  'interest expense': EXP_TYPE.OTHER, 'interest income': EXP_TYPE.OTHER
};

function _expType(category) {
  var t = _EXP_TYPE_MAP[String(category || '').trim().toLowerCase()];
  return t || EXP_TYPE.OPEX;
}

// Idempotency signature for a migrated legacy expense. Includes the voucher number so that two
// distinct vouchers sharing the same date/category/amount/description are NOT collapsed. Computed
// from fields both an incoming record and an existing flow row have, so re-runs match by value.
function _expSig(date, voucher, category, amount, description) {
  return [_dateStr(date), String(voucher || '').trim(), String(category || '').trim(),
    _num(amount).toFixed(2), String(description || '').trim()].join('|');
}
function _expKey(rec) {
  var amount = (rec.amount != null && rec.amount !== '')
    ? _num(rec.amount)
    : (_num(rec.toll) + _num(rec.fuel) + _num(rec.meals) + _num(rec.loadBalance) + _num(rec.otherAmount));
  return _expSig(rec.date, rec.voucherNo != null ? rec.voucherNo : rec.orderRef, rec.category, amount, rec.description);
}

function getExpenses(p) {
  var rows = _rows('Expenses');
  if (p && p.type) rows = rows.filter(function (r) { return String(r['Type']) === String(p.type); });
  if (p && p.category) rows = rows.filter(function (r) { return String(r['Category']) === String(p.category); });
  if (p && p.year) rows = rows.filter(function (r) { return _dateStr(r['Date']).slice(0, 4) === String(p.year); });
  if (p && p.month) rows = rows.filter(function (r) { return _dateStr(r['Date']).slice(5, 7) === String(p.month); });
  rows.sort(function (a, b) { return new Date(b['Created At']) - new Date(a['Created At']); });
  return { success: true, data: rows.map(function (r) {
    return {
      expNo: r['Exp No'], date: r['Date'], type: r['Type'] || EXP_TYPE.OPEX, category: r['Category'],
      voucherNo: r['Voucher No'], client: r['Client'], description: r['Description'],
      toll: _num(r['Toll']), fuel: _num(r['Fuel']), meals: _num(r['Meals']),
      loadBalance: _num(r['Load Balance']), other: _num(r['Other']), amount: _num(r['Amount']),
      notes: r['Notes'], createdBy: r['Created By'], legacyKey: r['Legacy Key'] || '',
      createdAt: r['Created At'], rowIndex: r.rowIndex
    };
  }) };
}

function _expAmount(p) {
  if (p.amount != null && p.amount !== '') return _num(p.amount);
  return _num(p.toll) + _num(p.fuel) + _num(p.meals) + _num(p.loadBalance) + _num(p.other != null ? p.other : p.otherAmount);
}

function addExpense(p) {
  var category = String(p.category || '').trim() || 'Uncategorized';
  var type = p.type || _expType(category);
  var amount = _expAmount(p);
  var no = _nextNumber('Expenses', 1, 'EXP');
  _append('Expenses', [no, p.date || _dateStr(_now()), type, category, p.voucherNo || p.orderRef || '',
    p.client || '', p.description || '', _num(p.toll), _num(p.fuel), _num(p.meals), _num(p.loadBalance),
    _num(p.other != null ? p.other : p.otherAmount), amount, p.notes || '', p.createdBy || p.actorName || '',
    p.legacyKey || '', _now()]);
  return { success: true, expNo: no, message: 'Expense ' + no + ' recorded.' };
}

function updateExpense(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var sh = _sheet('Expenses');
  var existing = _rows('Expenses').filter(function (r) { return r.rowIndex === ri; })[0];
  if (!existing) return { success: false, message: 'Expense not found.' };
  var category = String(p.category != null ? p.category : existing['Category']).trim() || 'Uncategorized';
  var type = p.type || existing['Type'] || _expType(category);
  var amount = (p.amount != null && p.amount !== '') ? _num(p.amount)
    : (_num(p.toll) + _num(p.fuel) + _num(p.meals) + _num(p.loadBalance) + _num(p.other != null ? p.other : p.otherAmount));
  sh.getRange(ri, 1, 1, SCHEMA.Expenses.length).setValues([[existing['Exp No'],
    p.date || existing['Date'], type, category, p.voucherNo != null ? p.voucherNo : existing['Voucher No'],
    p.client != null ? p.client : existing['Client'], p.description != null ? p.description : existing['Description'],
    _num(p.toll), _num(p.fuel), _num(p.meals), _num(p.loadBalance),
    _num(p.other != null ? p.other : p.otherAmount), amount, p.notes != null ? p.notes : existing['Notes'],
    existing['Created By'], existing['Legacy Key'] || '', existing['Created At'] || _now()]]);
  return { success: true, expNo: existing['Exp No'], message: 'Expense updated.' };
}

function deleteExpense(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  _sheet('Expenses').deleteRow(ri);
  return { success: true, message: 'Expense deleted.' };
}

// Bulk-import legacy expenses into the flow ledger. Each old record becomes one Expenses row, typed
// via the default category→type map. Dedupes on a composite Legacy Key (idempotent), posts NO journals.
function importExpenses(p) {
  var incoming = JSON.parse(p.items || '[]');
  if (!incoming.length) return { success: false, message: 'No expenses to import.' };
  // Build the existing-set by recomputing the signature from each row's actual fields (date · voucher ·
  // category · amount · description). This matches already-migrated rows by value — regardless of what
  // is stored in their Legacy Key column — so a re-run never duplicates them and only the genuinely
  // missing records (distinct voucher but otherwise-identical) get imported.
  var existing = {};
  _rows('Expenses').forEach(function (r) {
    existing[_expSig(r['Date'], r['Voucher No'], r['Category'], r['Amount'], r['Description'])] = true;
  });
  var created = 0, skipped = 0, errors = [];
  incoming.forEach(function (rec) {
    try {
      var key = _expKey(rec);
      if (existing[key]) { skipped++; return; }
      var category = String(rec.category || '').trim() || 'Uncategorized';
      var type = rec.type || _expType(category);
      var amount = (rec.amount != null && rec.amount !== '') ? _num(rec.amount)
        : (_num(rec.toll) + _num(rec.fuel) + _num(rec.meals) + _num(rec.loadBalance) + _num(rec.otherAmount));
      var no = _nextNumber('Expenses', 1, 'EXP');
      _append('Expenses', [no, _dateStr(rec.date) || _dateStr(_now()), type, category,
        rec.voucherNo || rec.orderRef || '', rec.client || '', rec.description || '', _num(rec.toll),
        _num(rec.fuel), _num(rec.meals), _num(rec.loadBalance), _num(rec.otherAmount), amount,
        rec.notes || '', rec.createdBy || 'Migrated (legacy)', key, _now()]);
      existing[key] = true;
      created++;
    } catch (e) {
      errors.push({ voucherNo: rec && (rec.voucherNo || rec.orderRef), description: rec && rec.description,
        message: String(e && e.message || e) });
    }
  });
  return { success: true, created: created, skipped: skipped, errors: errors,
    message: 'Imported ' + created + ' expense(s); skipped ' + skipped + ' already present.' };
}

// Set the Type on every Expenses row whose Category matches (e.g. move all 'Salaries and wages' to
// Operating). One-time consistency helper; harmless if re-run.
function reclassifyExpenses(p) {
  var category = String(p.category || '').trim();
  var type = String(p.type || '').trim();
  if (!category || !type) return { success: false, message: 'category and type are required.' };
  var sh = _sheet('Expenses');
  var typeCol = SCHEMA.Expenses.indexOf('Type') + 1;
  var updated = 0;
  _rows('Expenses').forEach(function (r) {
    if (String(r['Category']).trim().toLowerCase() === category.toLowerCase() && String(r['Type']) !== type) {
      sh.getRange(r.rowIndex, typeCol, 1, 1).setValues([[type]]);
      updated++;
    }
  });
  return { success: true, updated: updated, message: 'Reclassified ' + updated + ' "' + category + '" expense(s) to ' + type + '.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  MATERIALS RECEIVING  (loads from a PO; pro-rates shipping → landed cost → inventory)
// ════════════════════════════════════════════════════════════════════════════
function getReceiving() {
  var items = _rows('ReceivingItems');
  return { success: true, data: _rows('MaterialsReceiving').map(function (m) {
    var its = items.filter(function (r) { return String(r['MR No']) === String(m['MR No']); });
    return {
      mrNo: m['MR No'], poNo: m['PO No'], date: m['Date'], supplier: m['Supplier'],
      currency: m['Currency'] || 'PHP',
      duties: _num(m['Customs Duties (PHP)']), vat: _num(m['VAT (PHP)']),
      delivery: _num(m['Delivery Charges (PHP)']), other: _num(m['Other Charges (PHP)']),
      totalShipping: _num(m['Total Shipping Cost (PHP)']),
      receivedBy: m['Received By'], createdAt: m['Created At'], rowIndex: m.rowIndex,
      items: its.map(function (r) { return {
        itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty Received']),
        purchasePrice: _num(r['Purchase Price/Unit (FC)']), purchasePHP: _num(r['Purchase Price/Unit (PHP)']),
        shippingPerUnit: _num(r['Shipping/Unit (PHP)']),
        landedCost: _num(r['Landed Cost/Unit']), totalLanded: _num(r['Total Landed Cost']) }; })
    };
  }) };
}

/** PO Total (FC) from the PurchaseOrders tab (authoritative denominator). */
function _poTotalFC(poNo) {
  var rows = _rows('PurchaseOrders');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['PO No']) === String(poNo)) return _num(rows[i]['Total Purchase (FC)']);
  }
  return 0;
}

/** Total Paid (PHP) across the AP Aging entries for a PO. */
function _apPaidPHP(poNo) {
  var paid = 0;
  _rows('APAging').forEach(function (r) {
    if (String(r['PO No']) === String(poNo)) paid += _num(r['Paid (PHP)']);
  });
  return paid;
}

function createReceiving(p) {
  var items = JSON.parse(p.items || '[]');
  if (!items.length) return { success: false, message: 'At least one received item is required.' };
  var currency = p.currency || 'PHP';
  var duties = _num(p.duties), vat = _num(p.vat), delivery = _num(p.delivery), other = _num(p.other);
  var totalShipping = duties + vat + delivery + other;
  var invShipping = duties + delivery + other;            // VAT excluded from inventory cost

  // Authoritative bases: PO total (FC) and AP paid (PHP) for this PO.
  var poTotalFC = _poTotalFC(p.poNo) || (function () {
    var t = 0; items.forEach(function (it) { t += _num(it.price) * _num(it.qty); }); return t;
  })();
  var paidPHP = _apPaidPHP(p.poNo);

  var no = p.mrNo || _nextNumber('MaterialsReceiving', 1, 'MR');
  _append('MaterialsReceiving', [no, p.poNo || '', p.date || _now(), p.supplier || '', currency,
    duties, vat, delivery, other, totalShipping, p.receivedBy || '', _now()]);

  var sh = _sheet('ReceivingItems');
  var purchaseTot = 0, shipTot = 0, receivedFC = 0;
  items.forEach(function (it) {
    var unitPriceFC = _num(it.price);
    var qty = _num(it.qty);
    // Purchase/Unit (PHP) = Paid (PHP) × Unit Price (FC) / PO Total (FC)
    var purchasePHP = (poTotalFC > 0) ? (paidPHP * unitPriceFC / poTotalFC) : 0;
    // Shipping/Unit (PHP) = inventoriable shipping (excl VAT) × Unit Price (FC) / PO Total (FC)
    var shipPerUnit = (poTotalFC > 0) ? (invShipping * unitPriceFC / poTotalFC) : 0;
    var landed = purchasePHP + shipPerUnit;
    sh.appendRow([no, it.itemNo, it.itemName, qty, unitPriceFC, purchasePHP, shipPerUnit, landed, landed * qty]);
    // Final inventory cost = landed (PHP); add the received quantity.
    _applyInventory(it.itemNo, it.itemName, qty, purchasePHP, shipPerUnit, 'PHP');
    purchaseTot += purchasePHP * qty;
    shipTot += shipPerUnit * qty;
    receivedFC += unitPriceFC * qty;
  });

  // GL (PHP, balanced): Dr Inventory (purchase + inventoriable shipping) / Dr Input VAT
  //   / Cr Purchases Clearing (purchase) / Cr Cash (inventoriable shipping + VAT).
  var ratio = (poTotalFC > 0) ? (receivedFC / poTotalFC) : 0;
  var vatAlloc = vat * ratio;
  _postJournal('MR', no, p.date || _now(), 'PHP', [
    { account: ACC.INV, debit: purchaseTot + shipTot, memo: 'Receiving ' + no },
    { account: ACC.INPUT_VAT, debit: vatAlloc, memo: 'Input VAT — ' + no },
    { account: ACC.CLEARING, credit: purchaseTot, memo: 'Clear PO ' + (p.poNo || '') },
    { account: ACC.CASH, credit: shipTot + vatAlloc, memo: 'Shipping + VAT for ' + no }
  ]);
  return { success: true, mrNo: no, message: 'Materials received; inventory, landed cost and journal updated.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  INVOICE / MATERIALS ISSUANCE  (loads from a SO; deducts inventory; records COGS)
// ════════════════════════════════════════════════════════════════════════════
function getInvoices() {
  var items = _rows('InvoiceItems');
  return { success: true, data: _rows('Invoices').map(function (v) {
    var its = items.filter(function (r) { return String(r['INV No']) === String(v['INV No']); });
    return {
      invNo: v['INV No'], soNo: v['SO No'], date: v['Date'], customer: v['Customer'],
      totalSales: _num(v['Total Sales']), totalCOGS: _num(v['Total COGS']), createdBy: v['Created By'],
      createdAt: v['Created At'], rowIndex: v.rowIndex,
      items: its.map(function (r) { return {
        itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
        sellingPrice: _num(r['Selling Price']), lineSales: _num(r['Line Sales']),
        landedCost: _num(r['Landed Cost/Unit']), lineCOGS: _num(r['Line COGS']) }; })
    };
  }) };
}

function createInvoice(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.customer) return { success: false, message: 'Customer is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var no = p.invNo || _nextNumber('Invoices', 1, 'INV');
  var totalSales = 0, totalCOGS = 0;
  var sh = _sheet('InvoiceItems');
  var lines = items.map(function (it) {
    var inv = _findInventory(it.itemNo);
    var landed = inv ? _num(inv['Landed Cost/Unit']) : 0;
    var qty = _num(it.qty), price = _num(it.price);
    var lineSales = qty * price, lineCOGS = qty * landed;
    totalSales += lineSales; totalCOGS += lineCOGS;
    return [no, it.itemNo, it.itemName, qty, price, lineSales, landed, lineCOGS];
  });
  _append('Invoices', [no, p.soNo || '', p.date || _now(), p.customer, totalSales, totalCOGS, p.createdBy || '', _now()]);
  items.forEach(function (it, i) {
    sh.appendRow(lines[i]);
    _applyInventory(it.itemNo, it.itemName, -_num(it.qty), null, null, null); // deduct stock
  });
  // GL entry 1: Dr Accounts Receivable / Cr Sales.  Entry 2: Dr COGS / Cr Inventory.
  _postJournal('INV', no, p.date || _now(), 'PHP', [
    { account: ACC.AR, debit: totalSales, memo: 'Invoice ' + no + ' — ' + p.customer },
    { account: ACC.SALES, credit: totalSales, memo: 'Sales ' + no },
    { account: ACC.COGS, debit: totalCOGS, memo: 'COGS ' + no },
    { account: ACC.INV, credit: totalCOGS, memo: 'Inventory issued ' + no }
  ]);
  // Auto-create the Accounts Receivable entry (client owes the invoiced sales amount, in PHP).
  var arNo = _nextNumber('ARAging', 1, 'AR');
  _append('ARAging', [arNo, no, p.soNo || '', p.customer, totalSales, 0, 'Unpaid', '', '', _now(), _now()]);
  return { success: true, invNo: no, arNo: arNo, message: 'Invoice issued; AR entry created, inventory deducted and journal posted.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  GENERAL LEDGER  (double-entry journal auto-posted from each step)
// ════════════════════════════════════════════════════════════════════════════
/** Remove any journal lines previously posted for a (source, sourceNo) pair. */
function _removeJournal(source, sourceNo) {
  var sh = _sheet('Journal');
  _rows('Journal').filter(function (r) {
    return String(r['Source']) === String(source) && String(r['Source No']) === String(sourceNo);
  }).sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { sh.deleteRow(r.rowIndex); });
}

/**
 * Post a balanced set of journal lines for a document. Idempotent per (source, sourceNo):
 * any prior lines for that document are replaced. `lines` = [{account, debit, credit, memo}].
 * Zero-value lines are skipped.
 */
function _postJournal(source, sourceNo, date, currency, lines) {
  _removeJournal(source, sourceNo);
  var sh = _sheet('Journal');
  var entryNo = 'JE-' + source + '-' + sourceNo;
  var when = date || _now();
  lines.forEach(function (l) {
    var dr = _num(l.debit), cr = _num(l.credit);
    if (dr === 0 && cr === 0) return;
    sh.appendRow([entryNo, when, source, sourceNo, l.account, _accName(l.account), dr, cr, currency || 'PHP', l.memo || '', _now()]);
  });
}

function getChartOfAccounts() {
  _sheet('ChartOfAccounts'); // ensure tab exists
  return { success: true, data: COA.map(function (a) { return { code: a[0], name: a[1], type: a[2], normalBalance: a[3] }; }) };
}

function getJournal(p) {
  var rows = _rows('Journal');
  if (p && p.source) rows = rows.filter(function (r) { return String(r['Source']) === String(p.source); });
  if (p && p.sourceNo) rows = rows.filter(function (r) { return String(r['Source No']) === String(p.sourceNo); });
  return { success: true, data: rows.map(function (r) {
    return {
      entryNo: r['Entry No'], date: r['Date'], source: r['Source'], sourceNo: r['Source No'],
      accountCode: r['Account Code'], accountName: r['Account Name'], debit: _num(r['Debit']),
      credit: _num(r['Credit']), currency: r['Currency'], memo: r['Memo'], rowIndex: r.rowIndex
    };
  }) };
}

function getTrialBalance() {
  getChartOfAccounts();
  var sums = {};
  _rows('Journal').forEach(function (r) {
    var code = String(r['Account Code']);
    if (!sums[code]) sums[code] = { debit: 0, credit: 0 };
    sums[code].debit += _num(r['Debit']);
    sums[code].credit += _num(r['Credit']);
  });
  var totalDr = 0, totalCr = 0;
  var rows = COA.map(function (a) {
    var s = sums[a[0]] || { debit: 0, credit: 0 };
    var bal = s.debit - s.credit;            // positive = net debit, negative = net credit
    var debitBal = bal > 0 ? bal : 0;        // a net balance shows in exactly one column
    var creditBal = bal < 0 ? -bal : 0;
    totalDr += debitBal; totalCr += creditBal;
    return { code: a[0], name: a[1], type: a[2], normalBalance: a[3],
      debit: s.debit, credit: s.credit, debitBalance: debitBal, creditBalance: creditBal };
  });
  return { success: true, data: rows, totals: { debit: totalDr, credit: totalCr, balanced: Math.abs(totalDr - totalCr) < 0.005 } };
}

// ════════════════════════════════════════════════════════════════════════════
//  PDF → DRIVE  (store generated quotation / PO PDFs and link them on the record)
// ════════════════════════════════════════════════════════════════════════════
function _flowFolder() {
  if (FLOW_DRIVE_FOLDER_ID) return DriveApp.getFolderById(FLOW_DRIVE_FOLDER_ID);
  var it = DriveApp.getFoldersByName('Flow Documents');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Flow Documents');
}

/** Save any base64 file to the Flow Documents folder; returns { url, id }. */
function _saveFileToDrive(base64, fileName, mimeType) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName || 'document');
  var file = _flowFolder().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { url: file.getUrl(), id: file.getId() };
}

function _savePdfToDrive(pdfBase64, fileName) {
  return _saveFileToDrive(pdfBase64, fileName || 'document.pdf', 'application/pdf').url;
}

/** Write `value` into `header` column of the row whose `keyCol` equals `keyVal`. */
function _setCellByKey(sheetName, keyCol, keyVal, header, value) {
  var sh = _sheet(sheetName);
  var col = SCHEMA[sheetName].indexOf(header) + 1;
  var rows = _rows(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyCol]) === String(keyVal)) {
      sh.getRange(rows[i].rowIndex, col, 1, 1).setValues([[value]]);
      return true;
    }
  }
  return false;
}

function saveQuotationPDF(p) {
  if (!p.pdfBase64) return { success: false, message: 'pdfBase64 required.' };
  var link = _savePdfToDrive(p.pdfBase64, p.fileName);
  if (p.quotationNo) _setCellByKey('Quotations', 'Quotation No', p.quotationNo, 'PDF Link', link);
  return { success: true, link: link, message: 'Quotation PDF saved to Drive.' };
}

function savePOPDF(p) {
  if (!p.pdfBase64) return { success: false, message: 'pdfBase64 required.' };
  var link = _savePdfToDrive(p.pdfBase64, p.fileName);
  if (p.poNo) _setCellByKey('PurchaseOrders', 'PO No', p.poNo, 'PDF Link', link);
  return { success: true, link: link, message: 'Purchase Order PDF saved to Drive.' };
}

// ── Generic per-record document attachments ──────────────────────────────────
function addDocument(p) {
  if (!p.module || !p.refNo) return { success: false, message: 'module and refNo are required.' };
  if (!p.fileBase64) return { success: false, message: 'fileBase64 is required.' };
  var saved = _saveFileToDrive(p.fileBase64, p.fileName || 'document', p.mimeType);
  var docId = _nextNumber('Documents', 1, 'DOC');
  var now = _now();
  _append('Documents', [docId, p.module, p.refNo, p.docType || '', p.fileName || '',
    saved.url, saved.id, p.actorName || p.uploadedBy || '', now]);
  return { success: true, docId: docId, link: saved.url, refNo: p.refNo,
    doc: { docId: docId, module: p.module, refNo: p.refNo, docType: p.docType || '',
      fileName: p.fileName || '', link: saved.url },
    message: 'Document attached.' };
}

function getDocuments(p) {
  var rows = _rows('Documents');
  if (p && p.module) rows = rows.filter(function (r) { return String(r['Module']) === String(p.module); });
  if (p && p.refNo) rows = rows.filter(function (r) { return String(r['Ref No']) === String(p.refNo); });
  rows.sort(function (a, b) { return new Date(b['Uploaded At']) - new Date(a['Uploaded At']); });
  return { success: true, data: rows.map(function (r) {
    return { docId: r['Doc ID'], module: r['Module'], refNo: r['Ref No'], docType: r['Doc Type'],
      fileName: r['File Name'], link: r['Drive Link'], uploadedBy: r['Uploaded By'], uploadedAt: r['Uploaded At'] };
  }) };
}

function deleteDocument(p) {
  if (!p.docId) return { success: false, message: 'docId is required.' };
  var sh = _sheet('Documents');
  var rows = _rows('Documents');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Doc ID']) === String(p.docId)) {
      var fid = rows[i]['File ID'];
      if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} }
      sh.deleteRow(rows[i].rowIndex);
      return { success: true, docId: p.docId, refNo: rows[i]['Ref No'], module: rows[i]['Module'],
        message: 'Document removed.' };
    }
  }
  return { success: false, message: 'Document not found.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  APPROVALS  (hierarchy: management/director > admin > sales; accounting never approves)
// ════════════════════════════════════════════════════════════════════════════
function _isMgmtTier(role) { return role === 'management' || role === 'director'; }
function _isAdminTier(role) { return role === 'admin'; }

function _quotationRow(no) {
  return _rows('Quotations').filter(function (q) { return String(q['Quotation No']) === String(no); })[0];
}
function _setQuotationCells(no, map) {  // map: {header: value}
  var sh = _sheet('Quotations'), q = _quotationRow(no);
  if (!q) return false;
  Object.keys(map).forEach(function (h) {
    var col = SCHEMA.Quotations.indexOf(h) + 1;
    if (col > 0) sh.getRange(q.rowIndex, col, 1, 1).setValues([[map[h]]]);
  });
  return true;
}

function submitQuotationApproval(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var st = String(q['Status'] || 'Draft');
  if (st !== 'Draft' && st !== 'Rejected' && st !== 'Open') {
    return { success: false, message: 'Only a Draft or Rejected quotation can be submitted (now: ' + st + ').' };
  }
  // Admin-created quotations skip straight to management; sales-created go to admin first.
  var role = String(q['Created By Role'] || p.actorRole || 'sales');
  var next = _isAdminTier(role) ? 'Pending Management' : 'Pending Admin';
  _setQuotationCells(p.quotationNo, { 'Status': next, 'Approval Note': '' });
  return { success: true, quotationNo: p.quotationNo, status: next, message: 'Submitted for approval (' + next + ').' };
}

function approveQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var st = String(q['Status'] || '');
  var role = p.actorRole || '';
  if (st === 'Pending Admin') {
    if (!_isAdminTier(role)) return { success: false, message: 'Only admin can approve at this stage.' };
    _setQuotationCells(p.quotationNo, { 'Status': 'Pending Management' });
    return { success: true, quotationNo: p.quotationNo, status: 'Pending Management', message: 'Admin approved; forwarded to management.' };
  }
  if (st === 'Pending Management') {
    if (!_isMgmtTier(role)) return { success: false, message: 'Only management/director can give final approval.' };
    _setQuotationCells(p.quotationNo, { 'Status': 'Approved', 'Approved By': p.actorName || '', 'Approved At': _now() });
    return { success: true, quotationNo: p.quotationNo, status: 'Approved', message: 'Quotation approved.' };
  }
  return { success: false, message: 'Quotation is not awaiting your approval (status: ' + st + ').' };
}

function rejectQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var st = String(q['Status'] || ''), role = p.actorRole || '';
  var canReject = (st === 'Pending Admin' && _isAdminTier(role)) || (st === 'Pending Management' && _isMgmtTier(role));
  if (!canReject) return { success: false, message: 'You cannot reject this quotation at its current stage.' };
  _setQuotationCells(p.quotationNo, { 'Status': 'Rejected', 'Approval Note': p.reason || '' });
  return { success: true, quotationNo: p.quotationNo, status: 'Rejected', message: 'Quotation rejected.' };
}

function sendQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  if (String(q['Status']) !== 'Approved') return { success: false, message: 'Only an Approved quotation can be sent.' };
  _setQuotationCells(p.quotationNo, { 'Status': 'Sent' });
  return { success: true, quotationNo: p.quotationNo, status: 'Sent', message: 'Quotation marked as sent to client.' };
}

// ── Purchase Order approval (admin creates → management/director approves) ──
function _poRow(no) {
  return _rows('PurchaseOrders').filter(function (po) { return String(po['PO No']) === String(no); })[0];
}
function _setPOCells(no, map) {
  var sh = _sheet('PurchaseOrders'), po = _poRow(no);
  if (!po) return false;
  Object.keys(map).forEach(function (h) {
    var col = SCHEMA.PurchaseOrders.indexOf(h) + 1;
    if (col > 0) sh.getRange(po.rowIndex, col, 1, 1).setValues([[map[h]]]);
  });
  return true;
}

function submitPOApproval(p) {
  if (!p.poNo) return { success: false, message: 'poNo required.' };
  var po = _poRow(p.poNo);
  if (!po) return { success: false, message: 'Purchase order not found.' };
  var st = String(po['Status'] || 'Draft');
  if (st !== 'Draft' && st !== 'Rejected' && st !== 'Open') {
    return { success: false, message: 'Only a Draft or Rejected PO can be submitted (now: ' + st + ').' };
  }
  _setPOCells(p.poNo, { 'Status': 'Pending Management', 'Approval Note': '' });
  return { success: true, poNo: p.poNo, status: 'Pending Management', message: 'PO submitted for management approval.' };
}

function approvePO(p) {
  if (!p.poNo) return { success: false, message: 'poNo required.' };
  var po = _poRow(p.poNo);
  if (!po) return { success: false, message: 'Purchase order not found.' };
  if (String(po['Status']) !== 'Pending Management') return { success: false, message: 'PO is not awaiting management approval.' };
  if (!_isMgmtTier(p.actorRole || '')) return { success: false, message: 'Only management/director can approve a PO.' };
  _setPOCells(p.poNo, { 'Status': 'Approved', 'Approved By': p.actorName || '', 'Approved At': _now() });
  return { success: true, poNo: p.poNo, status: 'Approved', message: 'Purchase order approved.' };
}

function rejectPO(p) {
  if (!p.poNo) return { success: false, message: 'poNo required.' };
  var po = _poRow(p.poNo);
  if (!po) return { success: false, message: 'Purchase order not found.' };
  if (String(po['Status']) !== 'Pending Management') return { success: false, message: 'PO is not awaiting management approval.' };
  if (!_isMgmtTier(p.actorRole || '')) return { success: false, message: 'Only management/director can reject a PO.' };
  _setPOCells(p.poNo, { 'Status': 'Rejected', 'Approval Note': p.reason || '' });
  return { success: true, poNo: p.poNo, status: 'Rejected', message: 'Purchase order rejected.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  ACTIVITY LOG  (auto-logs every mutation → Accounting Daily Report)
// ════════════════════════════════════════════════════════════════════════════
var _MODULE_MAP = {
  addInventoryItem: ['Inventory', 'Added'], updateInventoryItem: ['Inventory', 'Updated'], deleteInventoryItem: ['Inventory', 'Deleted'],
  createQuotation: ['Quotation', 'Created'], updateQuotation: ['Quotation', 'Updated'], deleteQuotation: ['Quotation', 'Deleted'],
  createSalesOrder: ['Sales Order', 'Created'], updateSalesOrder: ['Sales Order', 'Updated'], deleteSalesOrder: ['Sales Order', 'Deleted'],
  importSalesOrders: ['Sales Order', 'Imported'],
  createPurchaseOrder: ['Purchase Order', 'Created'], updatePurchaseOrder: ['Purchase Order', 'Updated'], deletePurchaseOrder: ['Purchase Order', 'Deleted'],
  updateAPAging: ['AP Aging', 'Updated'],
  updateARAging: ['AR Aging', 'Updated'], recordCollection: ['Collection', 'Recorded'],
  importCollections: ['Collection', 'Imported'],
  addExpense: ['Expense', 'Added'], updateExpense: ['Expense', 'Updated'],
  deleteExpense: ['Expense', 'Deleted'], importExpenses: ['Expense', 'Imported'],
  reclassifyExpenses: ['Expense', 'Reclassified'],
  createReceiving: ['Receiving', 'Received'],
  createInvoice: ['Invoice', 'Issued'],
  saveQuotationPDF: ['Quotation', 'PDF Saved'], savePOPDF: ['Purchase Order', 'PDF Saved'],
  createPricingRequest: ['Pricing Request', 'Created'], updatePRSourcing: ['Pricing Request', 'Sourced'],
  submitForPricing: ['Pricing Request', 'Forwarded'], setMgmtPricing: ['Pricing Request', 'Priced'],
  verifyReturnToSales: ['Pricing Request', 'Verified'], createQuotationFromPR: ['Pricing Request', 'Quoted'],
  savePRPDF: ['Pricing Request', 'PDF Saved'],
  addDocument: ['Document', 'Attached'], deleteDocument: ['Document', 'Removed'],
  submitQuotationApproval: ['Quotation', 'Submitted'], approveQuotation: ['Quotation', 'Approved'],
  rejectQuotation: ['Quotation', 'Rejected'], sendQuotation: ['Quotation', 'Sent'],
  submitPOApproval: ['Purchase Order', 'Submitted'], approvePO: ['Purchase Order', 'Approved'],
  rejectPO: ['Purchase Order', 'Rejected']
};

function _dateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '');
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function _logAmount(params) {
  try {
    if (params.items) {
      var its = JSON.parse(params.items), t = 0;
      its.forEach(function (it) { t += _num(it.qty) * _num(it.price); });
      if (t) return t;
    }
  } catch (e) {}
  if (params.paidPHP !== undefined && _num(params.paidPHP) > 0) return _num(params.paidPHP);
  if (params.amountPHP !== undefined) return _num(params.amountPHP);
  return 0;
}

/** Best-effort, never throws — append one row describing a successful mutation. */
function _logActivity(action, params, result) {
  try {
    var map = _MODULE_MAP[action];
    if (!map) return;
    var refNo = (action === 'updateAPAging')
      ? (result.apNo || params.apNo || result.poNo || '')
      : (action === 'recordCollection' || action === 'updateARAging')
      ? (result.arNo || params.arNo || result.collectionNo || '')
      : (result.quotationNo || result.soNo || result.poNo || result.mrNo || result.invNo
         || result.prNo || result.apNo || result.expNo || result.refNo || params.refNo || params.prNo || params.poNo
         || params.soNo || params.quotationNo || params.expNo || params.itemNo || '');
    var user = params.actorName || params.createdBy || params.receivedBy || '';
    var now = _now();
    _sheet('ActivityLog').appendRow([now, _dateStr(now), user, map[0], map[1], refNo,
      result.message || '', _logAmount(params), params.currency || 'PHP']);
  } catch (e) { /* logging is best-effort */ }
}

function getActivityLog(p) {
  var rows = _rows('ActivityLog');
  if (p && p.date) rows = rows.filter(function (r) { return _dateStr(r['Date']) === String(p.date); });
  if (p && p.user) rows = rows.filter(function (r) { return String(r['User']) === String(p.user); });
  rows.sort(function (a, b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });
  return { success: true, data: rows.map(function (r) {
    return {
      timestamp: r['Timestamp'], date: _dateStr(r['Date']), user: r['User'], module: r['Module'],
      action: r['Action'], refNo: r['Ref No'], summary: r['Summary'],
      amount: _num(r['Amount']), currency: r['Currency'] || 'PHP'
    };
  }) };
}

// Notes are scoped by `user`: the `Updated By` column doubles as the scope key, so each sales rep
// gets a personal note (user = their name) while the shared/accounting note uses an empty scope.
function getDailyNote(p) {
  var rows = _rows('DailyNotes');
  var scope = String((p && p.user) || '');
  for (var i = 0; i < rows.length; i++) {
    if (_dateStr(rows[i]['Date']) === String(p.date) && String(rows[i]['Updated By'] || '') === scope) {
      return { success: true, notes: rows[i]['Notes'] || '' };
    }
  }
  return { success: true, notes: '' };
}

function saveDailyNote(p) {
  var sh = _sheet('DailyNotes');
  var rows = _rows('DailyNotes');
  var scope = String((p && p.user) || '');
  for (var i = 0; i < rows.length; i++) {
    if (_dateStr(rows[i]['Date']) === String(p.date) && String(rows[i]['Updated By'] || '') === scope) {
      sh.getRange(rows[i].rowIndex, 1, 1, 4).setValues([[p.date, p.notes || '', scope, _now()]]);
      return { success: true, message: 'Notes saved.' };
    }
  }
  _append('DailyNotes', [p.date, p.notes || '', scope, _now()]);
  return { success: true, message: 'Notes saved.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  SALES PRICING-REQUEST FLOW
//  PR (sales) → Sourcing (admin) → Mgmt Pricing → Verify (admin) → Sales → Quotation
// ════════════════════════════════════════════════════════════════════════════
function getPricingRequests(p) {
  var items = _rows('PricingRequestItems');
  var headers = _rows('PricingRequests');
  if (p && p.status) headers = headers.filter(function (h) { return String(h['Status']) === String(p.status); });
  if (p && p.requestedBy) headers = headers.filter(function (h) { return String(h['Requested By']) === String(p.requestedBy); });
  return { success: true, data: headers.map(function (h) {
    var its = items.filter(function (r) { return String(r['PR No']) === String(h['PR No']); });
    return {
      prNo: h['PR No'], date: h['Date'], requestedBy: h['Requested By'], customer: h['Customer'],
      destination: h['Destination'], commission: _num(h['Commission %']), margin: _num(h['Margin %']),
      status: h['Status'], pdfLink: h['PDF Link'] || '', notes: h['Notes'], rowIndex: h.rowIndex,
      items: its.map(function (r) {
        return {
          line: _num(r['Line']), itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
          uom: r['UOM'], remarks: r['Remarks'], included: (r['Included'] === true || String(r['Included']) === 'true'),
          supplier: r['Supplier'], principal: r['Principal'], currency: r['Currency'] || 'PHP',
          supplierPrice: _num(r['Supplier Price (FC)']), cbm: _num(r['CBM']), finalPrice: _num(r['Final Price'])
        };
      })
    };
  }) };
}

function _setPRStatus(prNo, status, notes) {
  var sh = _sheet('PricingRequests');
  _rows('PricingRequests').forEach(function (h) {
    if (String(h['PR No']) === String(prNo)) {
      sh.getRange(h.rowIndex, 8, 1, 1).setValues([[status]]);     // Status (col 8)
      if (notes) sh.getRange(h.rowIndex, 10, 1, 1).setValues([[notes]]);  // Notes (col 10)
      sh.getRange(h.rowIndex, 12, 1, 1).setValues([[_now()]]);    // Updated At (col 12)
    }
  });
}

function _prItemRow(prNo, line) {
  return _rows('PricingRequestItems').filter(function (r) {
    return String(r['PR No']) === String(prNo) && _num(r['Line']) === _num(line);
  })[0];
}

function createPricingRequest(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.customer) return { success: false, message: 'Customer is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var no = p.prNo || _nextNumber('PricingRequests', 1, 'PR');
  _append('PricingRequests', [no, p.date || _now(), p.requestedBy || p.actorName || '', p.customer,
    '', '', '', 'Requested', '', p.notes || '', _now(), _now()]);
  var sh = _sheet('PricingRequestItems');
  items.forEach(function (it, i) {
    sh.appendRow([no, i + 1, it.itemNo, it.itemName, _num(it.qty), it.uom || '', it.remarks || '',
      true, '', '', it.currency || 'PHP', 0, _num(it.cbm), 0]);
  });
  return { success: true, prNo: no, message: 'Purchase request submitted to admin.' };
}

function updatePRSourcing(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var sh = _sheet('PricingRequestItems');
  JSON.parse(p.items || '[]').forEach(function (u) {
    var row = _prItemRow(p.prNo, u.line);
    if (!row) return;
    // cols 8-13: Included, Supplier, Principal, Currency, Supplier Price (FC), CBM
    sh.getRange(row.rowIndex, 8, 1, 6).setValues([[!!u.included, u.supplier || '', u.principal || '',
      u.currency || 'PHP', _num(u.supplierPrice), _num(u.cbm)]]);
  });
  _setPRStatus(p.prNo, 'Sourcing');
  return { success: true, prNo: p.prNo, message: 'Sourcing saved.' };
}

function submitForPricing(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  _setPRStatus(p.prNo, 'For Mgmt Pricing');
  return { success: true, prNo: p.prNo, message: 'Forwarded to management for pricing.' };
}

function setMgmtPricing(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var sh = _sheet('PricingRequests');
  _rows('PricingRequests').forEach(function (h) {
    if (String(h['PR No']) === String(p.prNo)) {
      sh.getRange(h.rowIndex, 5, 1, 3).setValues([[p.destination || '', _num(p.commission), _num(p.margin)]]); // Destination, Commission %, Margin %
    }
  });
  var ish = _sheet('PricingRequestItems');
  JSON.parse(p.items || '[]').forEach(function (u) {
    var row = _prItemRow(p.prNo, u.line);
    if (!row) return;
    ish.getRange(row.rowIndex, 14, 1, 1).setValues([[_num(u.finalPrice)]]);   // Final Price (col 14)
    if (u.included !== undefined) ish.getRange(row.rowIndex, 8, 1, 1).setValues([[!!u.included]]);
    // Persist management's edits to the priced inputs (backward compatible — only when provided).
    if (u.qty !== undefined) ish.getRange(row.rowIndex, 5, 1, 1).setValues([[_num(u.qty)]]);             // Qty (col 5)
    if (u.principal !== undefined) ish.getRange(row.rowIndex, 10, 1, 1).setValues([[u.principal || '']]); // Principal (col 10)
    if (u.currency !== undefined) ish.getRange(row.rowIndex, 11, 1, 1).setValues([[u.currency || 'PHP']]);// Currency (col 11)
    if (u.supplierPrice !== undefined) ish.getRange(row.rowIndex, 12, 1, 1).setValues([[_num(u.supplierPrice)]]); // Supplier Price (FC) (col 12)
    if (u.cbm !== undefined) ish.getRange(row.rowIndex, 13, 1, 1).setValues([[_num(u.cbm)]]);             // CBM (col 13)
  });
  _setPRStatus(p.prNo, 'Mgmt Priced');
  return { success: true, prNo: p.prNo, message: 'Final pricing saved; returned to admin.' };
}

function verifyReturnToSales(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  _setPRStatus(p.prNo, 'Returned to Sales', p.notes);
  return { success: true, prNo: p.prNo, message: 'Verified; returned to sales.' };
}

function createQuotationFromPR(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var hdr = _rows('PricingRequests').filter(function (h) { return String(h['PR No']) === String(p.prNo); })[0];
  if (!hdr) return { success: false, message: 'PR not found.' };
  var qItems = _rows('PricingRequestItems').filter(function (r) {
    return String(r['PR No']) === String(p.prNo)
      && (r['Included'] === true || String(r['Included']) === 'true') && _num(r['Final Price']) > 0;
  }).map(function (r) {
    return { itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']), price: _num(r['Final Price']) };
  });
  if (!qItems.length) return { success: false, message: 'No included, priced items to quote.' };
  // New quotation starts as Draft (creator = the requesting sales user) → enters the approval workflow.
  var qres = createQuotation({ customer: hdr['Customer'], date: _now(), status: 'Draft',
    createdBy: p.actorName || hdr['Requested By'] || '', actorRole: 'sales', items: JSON.stringify(qItems) });
  if (!qres.success) return qres;
  _setPRStatus(p.prNo, 'Quoted', 'Quotation ' + qres.quotationNo);
  return { success: true, prNo: p.prNo, quotationNo: qres.quotationNo,
    message: 'Quotation ' + qres.quotationNo + ' created from ' + p.prNo + '.' };
}

function savePRPDF(p) {
  if (!p.pdfBase64) return { success: false, message: 'pdfBase64 required.' };
  var link = _savePdfToDrive(p.pdfBase64, p.fileName);
  if (p.prNo) _setCellByKey('PricingRequests', 'PR No', p.prNo, 'PDF Link', link);
  return { success: true, link: link, prNo: p.prNo, message: 'PR PDF saved to Drive.' };
}

// ── Action registry ──────────────────────────────────────────────────────────
var HANDLERS = {
  getInventory: getInventory, addInventoryItem: addInventoryItem,
  updateInventoryItem: updateInventoryItem, deleteInventoryItem: deleteInventoryItem,
  getQuotations: getQuotations, createQuotation: createQuotation,
  updateQuotation: updateQuotation, deleteQuotation: deleteQuotation,
  getSalesOrders: getSalesOrders, createSalesOrder: createSalesOrder,
  updateSalesOrder: updateSalesOrder, deleteSalesOrder: deleteSalesOrder, importSalesOrders: importSalesOrders,
  getPurchaseOrders: getPurchaseOrders, createPurchaseOrder: createPurchaseOrder,
  updatePurchaseOrder: updatePurchaseOrder, deletePurchaseOrder: deletePurchaseOrder,
  getAPAging: getAPAging, updateAPAging: updateAPAging,
  getARAging: getARAging, getCollections: getCollections, recordCollection: recordCollection, updateARAging: updateARAging,
  importCollections: importCollections,
  getExpenses: getExpenses, addExpense: addExpense, updateExpense: updateExpense,
  deleteExpense: deleteExpense, importExpenses: importExpenses, reclassifyExpenses: reclassifyExpenses,
  getReceiving: getReceiving, createReceiving: createReceiving,
  getInvoices: getInvoices, createInvoice: createInvoice,
  getChartOfAccounts: getChartOfAccounts, getJournal: getJournal, getTrialBalance: getTrialBalance,
  saveQuotationPDF: saveQuotationPDF, savePOPDF: savePOPDF,
  getActivityLog: getActivityLog, getDailyNote: getDailyNote, saveDailyNote: saveDailyNote,
  getPricingRequests: getPricingRequests, createPricingRequest: createPricingRequest,
  updatePRSourcing: updatePRSourcing, submitForPricing: submitForPricing, setMgmtPricing: setMgmtPricing,
  verifyReturnToSales: verifyReturnToSales, createQuotationFromPR: createQuotationFromPR, savePRPDF: savePRPDF,
  addDocument: addDocument, getDocuments: getDocuments, deleteDocument: deleteDocument,
  submitQuotationApproval: submitQuotationApproval, approveQuotation: approveQuotation,
  rejectQuotation: rejectQuotation, sendQuotation: sendQuotation,
  submitPOApproval: submitPOApproval, approvePO: approvePO, rejectPO: rejectPO
};

// Actions that mutate the sheets (run under a script lock).
var MUTATIONS = {
  addInventoryItem: 1, updateInventoryItem: 1, deleteInventoryItem: 1,
  createQuotation: 1, updateQuotation: 1, deleteQuotation: 1,
  createSalesOrder: 1, updateSalesOrder: 1, deleteSalesOrder: 1, importSalesOrders: 1,
  createPurchaseOrder: 1, updatePurchaseOrder: 1, deletePurchaseOrder: 1,
  updateAPAging: 1, recordCollection: 1, updateARAging: 1, importCollections: 1, createReceiving: 1, createInvoice: 1,
  addExpense: 1, updateExpense: 1, deleteExpense: 1, importExpenses: 1, reclassifyExpenses: 1,
  saveQuotationPDF: 1, savePOPDF: 1, saveDailyNote: 1,
  createPricingRequest: 1, updatePRSourcing: 1, submitForPricing: 1, setMgmtPricing: 1,
  verifyReturnToSales: 1, createQuotationFromPR: 1, savePRPDF: 1,
  addDocument: 1, deleteDocument: 1,
  submitQuotationApproval: 1, approveQuotation: 1, rejectQuotation: 1, sendQuotation: 1,
  submitPOApproval: 1, approvePO: 1, rejectPO: 1
};
