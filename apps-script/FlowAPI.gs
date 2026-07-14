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

var SHEET_ID = '1ND6d0OK1xJ3wM29L4EsD-Xia44FXfD7HOZx8tms9Msk'; // ← paste the new "v2 Process DB" spreadsheet ID here

// Optional: Drive folder ID for saved quotation/PO PDFs. Blank → auto find/create "Flow Documents".
var FLOW_DRIVE_FOLDER_ID = '';

// Deployed-code version, surfaced by getVersion. Front-end tools whose safety depends on NEW backend
// behavior (e.g. the year-scoped deleteMigratedRecords) check this before running destructive steps.
var FLOW_VERSION = 77;   // A104 quotation Subject column + manual quotation numbers (76: backdated-SO shipment skip · 75: rename · 74: pairing-on-edit)

function getVersion(p) { return { success: true, version: FLOW_VERSION }; }

// ── Tab schemas (tab name → header row) ──────────────────────────────────────
var SCHEMA = {
  Inventory: ['Item No', 'Description', 'Available Balance', 'Purchase Price/Unit',
              'Shipping Cost/Unit', 'Landed Cost/Unit', 'Total Landed Cost', 'Currency', 'Last Updated'],

  Quotations:     ['Quotation No', 'Date', 'Customer', 'Status', 'Total', 'Created By', 'Created At', 'PDF Link',
                   'Created By Role', 'Approval Note', 'Approved By', 'Approved At', 'Subject'],
  QuotationItems: ['Quotation No', 'Item No', 'Item Name', 'Quoted Qty', 'Quoted Price', 'Line Total',
                   'Orig Item No', 'Orig Item Name'],

  SalesOrders:     ['SO No', 'Quotation No', 'Date', 'Customer', 'Status', 'Total', 'Created By', 'Created At', 'Supplier Type'],
  SalesOrderItems: ['SO No', 'Item No', 'Item Name', 'Qty', 'Price/Unit', 'Total Price'],

  PurchaseOrders:     ['PO No', 'SO No', 'Date', 'Supplier', 'Currency', 'Total Purchase (FC)', 'Status', 'Created By', 'Created At', 'PDF Link',
                       'Created By Role', 'Approval Note', 'Approved By', 'Approved At'],
  PurchaseOrderItems: ['PO No', 'Item No', 'Item Name', 'Qty', 'Purchase Price/Unit (FC)', 'Total (FC)'],

  APAging: ['AP No', 'PO No', 'Supplier', 'Currency', 'Amount (FC)', 'Amount (PHP)', 'Status',
            'Due Date', 'Paid (PHP)', 'Notes', 'Created At', 'Updated At', 'PR No'],

  MaterialsReceiving: ['MR No', 'PO No', 'Date', 'Supplier', 'Currency', 'Customs Duties (PHP)',
                       'VAT (PHP)', 'Delivery Charges (PHP)', 'Other Charges (PHP)',
                       'Total Shipping Cost (PHP)', 'Received By', 'Created At', 'SO No'],
  ReceivingItems:     ['MR No', 'Item No', 'Item Name', 'Qty Received', 'Purchase Price/Unit (FC)',
                       'Purchase Price/Unit (PHP)', 'Shipping/Unit (PHP)', 'Landed Cost/Unit', 'Total Landed Cost'],

  Invoices:     ['INV No', 'SO No', 'Date', 'Customer', 'Total Sales', 'Total COGS', 'Created By', 'Created At'],
  InvoiceItems: ['INV No', 'Item No', 'Item Name', 'Qty', 'Selling Price', 'Line Sales', 'Landed Cost/Unit', 'Line COGS'],

  // ── Accounts Receivable (after Invoices: client pays the sales-order amount) + Collections ──
  ARAging:     ['AR No', 'INV No', 'SO No', 'Customer', 'Amount (PHP)', 'Collected (PHP)', 'Status',
                'Due Date', 'Notes', 'Created At', 'Updated At'],
  Collections: ['Collection No', 'AR No', 'INV No', 'SO No', 'Customer', 'Date', 'Amount (PHP)',
                'Method', 'Reference No', 'Notes', 'Created At', 'EWT (PHP)'],

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
                    'Status', 'PDF Link', 'Notes', 'Created At', 'Updated At', 'Legacy ID', 'Legacy Items JSON',
                    'Priced Items JSON', 'Client Location', 'Doc JSON', 'Client Ref'],
  PricingRequestItems: ['PR No', 'Line', 'Item No', 'Item Name', 'Qty', 'UOM', 'Remarks', 'Included',
                        'Supplier', 'Principal', 'Currency', 'Supplier Price (FC)', 'CBM', 'Final Price',
                        'Orig Item No', 'Orig Item Name'],

  // ── Generic per-record document attachments (any process step) ──
  Documents: ['Doc ID', 'Module', 'Ref No', 'Doc Type', 'File Name', 'Drive Link', 'File ID',
              'Uploaded By', 'Uploaded At'],

  // ── Marketing workspace (B2B industrial marketing) ──
  MktgLeads:      ['Lead No', 'Date', 'Company', 'Contact', 'Email', 'Phone', 'Industry', 'Source',
                   'Status', 'SO No', 'Notes', 'Created By', 'Created At', 'Updated At'],
  MktgCampaigns:  ['Campaign No', 'Name', 'Channel', 'Start Date', 'End Date', 'Status', 'Budget',
                   'Spend', 'Leads', 'MQLs', 'Notes', 'Created By', 'Created At', 'Updated At'],
  MktgContent:    ['Content No', 'Date', 'Title', 'Type', 'Vertical', 'Channel', 'Status', 'Link',
                   'Notes', 'Created By', 'Created At', 'Updated At'],
  MktgEnablement: ['Asset No', 'Name', 'Category', 'Vertical', 'Status', 'Link', 'Last Updated',
                   'Notes', 'Created By', 'Created At', 'Updated At'],
  MktgEvents:     ['Event No', 'Name', 'Type', 'Date', 'Location', 'Status', 'Budget', 'Leads Captured',
                   'Notes', 'Created By', 'Created At', 'Updated At'],
  MktgPrincipal:  ['Activity No', 'Principal', 'Activity', 'Date', 'Status', 'MDF Requested',
                   'MDF Approved', 'Notes', 'Created By', 'Created At', 'Updated At'],
  MktgMetrics:    ['Month', 'Website Visits', 'LinkedIn Followers', 'Notes', 'Updated By', 'Updated At'],

  // ── Sales call log (per rep, per day) ──
  SalesCalls: ['Call No', 'Date', 'User', 'Contact', 'Company', 'Outcome', 'Notes', 'Created At'],

  // ── Balance Sheet opening balances (Cash, Inventory) — editable config ──
  OpeningBalances: ['Key', 'Amount (PHP)', 'Updated By', 'Updated At'],

  // ── Shipment Monitoring (flow-native): auto-created at SO; 21-stage timeline ──
  Shipments: ['Shipment ID', 'SO No', 'PO No', 'Customer', 'Principal', 'Item', 'Mode', 'ETD', 'ETA',
              'AWB', 'Status', 'Stages (JSON)', 'Remarks', 'Created By', 'Created At', 'Updated At'],

  // ── Payment Requests (Type 'PO' = supplier PRF between PO and AP; 'Other' = other payables) ──
  PaymentRequests: ['PR No', 'Type', 'PO No', 'SO No', 'Supplier', 'Payee', 'Currency', 'Amount',
                    'Purpose', 'Department', 'Bank Name', 'Account Name', 'Account Number', 'Payment Method',
                    'Due Date', 'Remarks', 'Status', 'Created By', 'Created By Role',
                    'Acct Approved By', 'Acct Approved At', 'Dir Approved By', 'Dir Approved At',
                    'Mgmt Approved By', 'Mgmt Approved At', 'Approval Note', 'PDF Link', 'Created At', 'Updated At'],

  // ── Per-SO cost breakdown migrated from the old Profit Report (revenue + COGS components) ──
  SOCostDetails: ['SO No', 'Customer', 'Date', 'Sales', 'COGS Type', 'Purchase of Goods',
                  'Bank Charge (COGS)', 'Duties & Taxes', 'Bank Charge (Shipping)', 'Shipping Company',
                  'Shipping Cost', 'Local Charges', 'Delivery to Office', 'Delivery to Client',
                  'Total COGS', 'Gross Profit', 'Source', 'Created At']
};

// ── Chart of Accounts (seeded) ───────────────────────────────────────────────
var COA = [
  ['1010', 'Cash', 'Asset', 'Debit'],
  ['1200', 'Accounts Receivable', 'Asset', 'Debit'],
  ['1300', 'Inventory', 'Asset', 'Debit'],
  ['1400', 'Purchases Clearing', 'Asset', 'Debit'],
  ['1500', 'Input VAT Receivable', 'Asset', 'Debit'],
  ['1600', 'Creditable Withholding Tax', 'Asset', 'Debit'],
  ['2010', 'Accounts Payable', 'Liability', 'Credit'],
  ['4000', 'Sales', 'Revenue', 'Credit'],
  ['5000', 'Cost of Goods Sold', 'Expense', 'Debit']
];
var ACC = { CASH: '1010', AR: '1200', INV: '1300', CLEARING: '1400', INPUT_VAT: '1500', CWT: '1600', AP: '2010', SALES: '4000', COGS: '5000' };
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

/** Next document number: PREFIX-YYYYMM-NNN (NNN unique per month).
 *
 * COLLISION-PROOF: the sequence is a ScriptProperties counter per prefix+month, advanced under the
 * mutation lock. Sheet reads across executions can be STALE for a short window after a write, so the
 * old max(sheet)+1 approach could issue the SAME number to two back-to-back creates — their line items
 * then merged under one document (seen live: PR-202607-167 carried another request's 5 items).
 * The counter only moves forward; the sheet scan remains as a seed/floor so manually imported numbers
 * are still respected. */
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
  var n = max + 1;
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'seq_' + name + '_' + prefix + '_' + ym;
    var stored = parseInt(props.getProperty(key), 10) || 0;
    n = Math.max(stored, max) + 1;
    props.setProperty(key, String(n));
  } catch (e) { /* Properties unavailable → fall back to the sheet max (previous behavior) */ }
  return stem + ('00' + n).slice(-3);
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

/** Normalize an Item No: a blank, "n/a" (any case), or dash-only string becomes the literal 'N/A'
 *  (users also type "-" for no-code items — without this, the second "-" add is rejected as a
 *  duplicate and the admin-quotation auto-inventory loop silently skips the item). */
function _normItemNo(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'na' || /^[-–—]+$/.test(s)) return 'N/A';
  return s;
}

/** Idempotency guard for create-mutations (generalizes the A79 PR pattern): a retried request that
 *  carries the same clientRef returns the originally created doc number instead of writing again.
 *  ScriptProperties is strongly consistent (immune to the Sheets read-after-write staleness that
 *  caused the A78 merging), and all mutations already run under the script lock. */
function _refSeen(action, clientRef) {
  if (!clientRef) return null;
  try { return PropertiesService.getScriptProperties().getProperty('cref_' + action + '_' + clientRef); }
  catch (e) { return null; }
}
function _refStore(action, clientRef, no) {
  if (!clientRef) return;
  try { PropertiesService.getScriptProperties().setProperty('cref_' + action + '_' + clientRef, String(no)); }
  catch (e) { /* best-effort — worst case a retry re-runs, same as before */ }
}

function addInventoryItem(p) {
  if (!p.description) return { success: false, message: 'Description is required.' };
  var itemNo = _normItemNo(p.itemNo);
  // 'N/A' is a placeholder for miscellaneous / no-code items — allow multiple, skip the dedupe check.
  if (itemNo !== 'N/A' && _findInventory(itemNo)) return { success: false, message: 'Item No already exists.' };
  var c = _invComputed(p.balance, p.purchasePrice, p.shippingCost);
  _append('Inventory', [itemNo, String(p.description).trim(), _num(p.balance),
    _num(p.purchasePrice), _num(p.shippingCost), c.landed, c.total, p.currency || 'PHP', _now()]);
  return { success: true, message: 'Item added.' };
}

function updateInventoryItem(p) {
  var sh = _sheet('Inventory');
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var c = _invComputed(p.balance, p.purchasePrice, p.shippingCost);
  sh.getRange(ri, 1, 1, SCHEMA.Inventory.length).setValues([[_normItemNo(p.itemNo),
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
    // Self-heal the total from the line items when the stored Total is 0/blank (legacy rows, or a create
    // path that didn't persist it) so both approval strips and the review modal show the real amount.
    var itemsTotal = its.reduce(function (s, r) { return s + _num(r['Quoted Qty']) * _num(r['Quoted Price']); }, 0);
    return {
      quotationNo: q['Quotation No'], date: q['Date'], customer: q['Customer'], status: q['Status'] || 'Draft',
      total: _num(q['Total']) || itemsTotal, createdBy: q['Created By'], createdAt: q['Created At'],
      pdfLink: q['PDF Link'] || '', createdByRole: q['Created By Role'] || '',
      approvalNote: q['Approval Note'] || '', approvedBy: q['Approved By'] || '', approvedAt: q['Approved At'] || '',
      subject: q['Subject'] || '',
      rowIndex: q.rowIndex,
      items: its.map(function (r) { return {
        itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Quoted Qty']),
        price: _num(r['Quoted Price']), lineTotal: _num(r['Line Total']),
        origItemNo: r['Orig Item No'] || '', origItemName: r['Orig Item Name'] || '' }; })
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
  var dup = _refSeen('createQuotation', p.clientRef);
  if (dup) return { success: true, quotationNo: dup, duplicate: true, message: 'Quotation created.' };
  // Explicit numbers are the company's own quotation codes — reject a collision with an existing record.
  // (Placed AFTER the clientRef idempotency return so a safe retry of the same create still succeeds.)
  if (p.quotationNo) {
    var wanted = String(p.quotationNo).toLowerCase();
    var clash = _rows('Quotations').some(function (r) {
      return String(r['Quotation No']).toLowerCase() === wanted;
    });
    if (clash) return { success: false, message: 'Quotation No "' + p.quotationNo + '" already exists.' };
  }
  var no = p.quotationNo || _nextNumber('Quotations', 1, 'QTN');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  // Auto-send for approval on create (no separate Submit step). Route by the creator's role:
  //   management/director → Approved (top tier); admin → Pending Management; else (sales/accounting) → Pending Admin.
  var creatorRole = p.actorRole || p.createdByRole || '';
  var initialStatus = p.status ||
    (_isMgmtTier(creatorRole) ? 'Approved' : (_isAdminTier(creatorRole) ? 'Pending Management' : 'Pending Admin'));
  _append('Quotations', [no, p.date || _now(), p.customer, initialStatus, total, p.createdBy || '', _now(), '',
    creatorRole, '', '', '', p.subject || '']);
  _writeItems('QuotationItems', 'Quotation No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.origItemNo || '', it.origItemName || ''];
  });
  _refStore('createQuotation', p.clientRef, no);
  return { success: true, quotationNo: no, message: 'Quotation created.' };
}

function updateQuotation(p) {
  var no = p.quotationNo;
  if (!no) return { success: false, message: 'quotationNo required.' };
  var items = JSON.parse(p.items || '[]');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });

  // Optional RENAME: the user may replace the whole quotation number. Every reference
  // follows (header, items, the SO→quotation link, attached documents); the ActivityLog
  // keeps the old ref as history. Re-sending the same rename is a no-op (retry-safe).
  var newNo = String(p.newQuotationNo || '').trim();
  if (newNo && newNo !== String(no)) {
    var clash = _rows('Quotations').some(function (r) {
      return String(r['Quotation No']) === newNo;
    });
    if (clash) return { success: false, message: 'Quotation No "' + newNo + '" already exists.' };
  } else {
    newNo = String(no);
  }

  var sh = _sheet('Quotations');
  var rows = _rows('Quotations');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Quotation No']) === String(no)) {
      sh.getRange(rows[i].rowIndex, 1, 1, 7).setValues([[newNo, p.date || rows[i]['Date'],
        p.customer, p.status || rows[i]['Status'], total, rows[i]['Created By'], rows[i]['Created At']]]);
      break;
    }
  }
  // The subject shows on the PDF and is captured on the form — keep it in sync on edit.
  if (p.subject !== undefined) _setCellByKey('Quotations', 'Quotation No', newNo, 'Subject', p.subject);
  // Items: delete rows keyed on the OLD number, re-append keyed on the new one.
  _writeItems('QuotationItems', 'Quotation No', no, items, function (it) {
    // keep the requested-vs-offered pairing across edits (same 8 columns as createQuotation)
    return [newNo, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.origItemNo || '', it.origItemName || ''];
  });
  if (newNo !== String(no)) {
    // Sales orders built from this quotation keep their link.
    var soSh = _sheet('SalesOrders');
    _rows('SalesOrders').forEach(function (r) {
      if (String(r['Quotation No']) === String(no)) soSh.getRange(r.rowIndex, 2, 1, 1).setValues([[newNo]]);
    });
    // Attached documents stay linked.
    var docSh = _sheet('Documents');
    _rows('Documents').forEach(function (r) {
      if (String(r['Module']) === 'Quotation' && String(r['Ref No']) === String(no)) {
        docSh.getRange(r.rowIndex, 3, 1, 1).setValues([[newNo]]);
      }
    });
  }
  return { success: true, quotationNo: newNo, renamed: newNo !== String(no),
    message: newNo !== String(no) ? 'Quotation updated and renamed to ' + newNo + '.' : 'Quotation updated.' };
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
      soNo: String(s['SO No']), quotationNo: s['Quotation No'], date: s['Date'], customer: s['Customer'],
      status: s['Status'], total: _num(s['Total']), createdBy: s['Created By'], createdAt: s['Created At'],
      supplierType: s['Supplier Type'] || '', rowIndex: s.rowIndex,
      items: its.map(function (r) { return {
        itemNo: String(r['Item No']), itemName: r['Item Name'], qty: _num(r['Qty']),
        price: _num(r['Price/Unit']), total: _num(r['Total Price']) }; })
    };
  }) };
}

function createSalesOrder(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.customer) return { success: false, message: 'Customer is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var dup = _refSeen('createSalesOrder', p.clientRef);
  if (dup) return { success: true, soNo: dup, duplicate: true, message: 'Sales Order created.' };
  var no = p.soNo || _nextNumber('SalesOrders', 1, 'SO');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  _append('SalesOrders', [no, p.quotationNo || '', p.date || _now(), p.customer, p.status || 'Open',
    total, p.createdBy || '', _now(), p.supplierType || '']);
  _writeItems('SalesOrderItems', 'SO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price)];
  });
  // Auto-create the shipment-monitoring timeline for this order (flow-native).
  // Skipped for BACK-DATED orders (date in a prior year): historical SOs recorded by
  // accounting shouldn't spawn live shipment-tracking rows.
  var soYear = parseInt(_dateStr(p.date || _now()).slice(0, 4), 10) || 0;
  if (soYear >= new Date().getFullYear()) {
    _flowAutoCreateShipment(no, p.customer, (items[0] && items[0].itemName) || '', p.createdBy || p.actorName || '');
  }
  _refStore('createSalesOrder', p.clientRef, no);
  return { success: true, soNo: no, message: 'Sales Order created.' };
}

/** Create a Shipment row for a Sales Order if one doesn't already exist (keyed by SO No). */
function _flowAutoCreateShipment(soNo, customer, item, createdBy) {
  try {
    var exists = _rows('Shipments').some(function (r) { return String(r['SO No']) === String(soNo); });
    if (exists) return;
    var id = _nextNumber('Shipments', 1, 'SHM');
    _append('Shipments', [id, soNo, '', customer || '', '', item || '', '', '', '', '',
      'Pending', '{}', '', createdBy || '', _now(), _now()]);
  } catch (e) { /* never block the SO write */ }
}

// Set a Sales Order's Supplier Type label (International/Local) from a cost type. Best-effort.
function _setSoSupplierType(soNo, cogsType) {
  try {
    var label = String(cogsType) === 'international' ? 'International' : 'Local';
    var col = SCHEMA.SalesOrders.indexOf('Supplier Type') + 1;
    if (col < 1) return;
    var sh = _sheet('SalesOrders');
    _rows('SalesOrders').forEach(function (r) {
      if (String(r['SO No']) === String(soNo)) sh.getRange(r.rowIndex, col, 1, 1).setValues([[label]]);
    });
  } catch (e) { /* best-effort */ }
}

// Backfill the Supplier Type (International/Local) label on every SO from its SOCostDetails COGS Type.
function matchSupplierTypes(p) {
  var updated = 0;
  _rows('SOCostDetails').forEach(function (c) {
    var soNo = String(c['SO No'] || '');
    if (!soNo) return;
    _setSoSupplierType(soNo, c['COGS Type']);
    updated++;
  });
  return { success: true, updated: updated, message: 'Matched supplier type for ' + updated + ' sales order(s).' };
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
        so.status || 'Open', total, so.createdBy || 'Migrated (legacy)', _now(), so.supplierType || '']);
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
        p.date || r['Date'], p.customer, p.status || r['Status'], total, r['Created By'], r['Created At'],
        (p.supplierType != null ? p.supplierType : (r['Supplier Type'] || ''))]]);
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
  var dup = _refSeen('createPurchaseOrder', p.clientRef);
  if (dup) return { success: true, poNo: dup, duplicate: true, message: 'Purchase Order created, AP entry and journal posted.' };
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
  // Auto-create the Accounts Payable entry. FC amount flows in; the PHP estimate (Total × exchange
  // rate, entered on the PO form) pre-fills Amount (PHP) so AP aging + the balance sheet populate.
  var apNo = _nextNumber('APAging', 1, 'AP');
  var amountPHP = _num(p.totalPHP) > 0 ? _num(p.totalPHP) : '';
  _append('APAging', [apNo, no, p.supplier, currency, total, amountPHP, 'Unpaid', '', 0, '', _now(), _now(), '']);
  // GL: Dr Purchases Clearing / Cr Accounts Payable (Total Purchase Order).
  _postJournal('PO', no, p.date || _now(), currency, [
    { account: ACC.CLEARING, debit: total, memo: 'PO ' + no + ' — ' + p.supplier },
    { account: ACC.AP, credit: total, memo: 'AP ' + apNo + ' — ' + p.supplier }
  ]);
  _refStore('createPurchaseOrder', p.clientRef, no);
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
  // Keep the linked AP entry's FC amount + currency in sync. Refresh the PHP estimate too when a new
  // one is supplied and the AP is still untouched (Unpaid, nothing paid) — don't clobber manual edits.
  var apSh = _sheet('APAging');
  var newPHP = _num(p.totalPHP);
  _rows('APAging').forEach(function (r) {
    if (String(r['PO No']) === String(no)) {
      apSh.getRange(r.rowIndex, 4, 1, 2).setValues([[currency, total]]);
      if (newPHP > 0 && _num(r['Paid (PHP)']) === 0 && String(r['Status']).toLowerCase() !== 'paid') {
        apSh.getRange(r.rowIndex, 6, 1, 1).setValues([[newPHP]]);   // Amount (PHP)
      }
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
  var prByNo = {};
  _rows('PaymentRequests').forEach(function (pr) { prByNo[String(pr['PR No'])] = pr['Status'] || ''; });
  return { success: true, data: _rows('APAging').map(function (r) {
    return {
      apNo: r['AP No'], poNo: r['PO No'], supplier: r['Supplier'], currency: r['Currency'] || 'PHP',
      amountFC: _num(r['Amount (FC)']), amountPHP: _num(r['Amount (PHP)']), status: r['Status'],
      dueDate: r['Due Date'], paidPHP: _num(r['Paid (PHP)']), notes: r['Notes'],
      prNo: r['PR No'] || '', prStatus: (prByNo[String(r['PR No'] || '')] || ''),
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
  // Text fields must be CLEARABLE — write whenever supplied, including '' (matches updateARAging).
  function setText(col, val) { if (val !== undefined && val !== null) cur[col] = val; }
  set(5, p.amountPHP !== undefined ? _num(p.amountPHP) : undefined); // Amount (PHP)
  set(6, p.status);                                                  // Status
  setText(7, p.dueDate);                                             // Due Date (clearable)
  set(8, p.paidPHP !== undefined ? _num(p.paidPHP) : undefined);     // Paid (PHP)
  setText(9, p.notes);                                               // Notes (clearable)
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
      arNo: r['AR No'], invNo: String(r['INV No']), soNo: String(r['SO No']), customer: r['Customer'],
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
      collectionNo: r['Collection No'], arNo: r['AR No'], invNo: String(r['INV No']), soNo: String(r['SO No']),
      customer: r['Customer'], date: r['Date'], amount: _num(r['Amount (PHP)']), method: r['Method'],
      reference: r['Reference No'], notes: r['Notes'], createdAt: r['Created At'],
      ewt: _num(r['EWT (PHP)']), netCash: _num(r['Amount (PHP)']) - _num(r['EWT (PHP)']), rowIndex: r.rowIndex
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
  var ewt = _num(p.ewt);                                  // creditable withholding tax (2307) on this collection
  if (ewt < 0) ewt = 0;
  if (ewt > amount) ewt = amount;
  var dup = _refSeen('recordCollection', p.clientRef);
  if (dup) return { success: true, collectionNo: dup, arNo: p.arNo, duplicate: true,
    status: String(ar['Status'] || ''), message: 'Collection ' + dup + ' recorded.' };
  var colNo = _nextNumber('Collections', 1, 'COL');
  _append('Collections', [colNo, p.arNo, ar['INV No'], ar['SO No'], ar['Customer'], p.date || _dateStr(_now()),
    amount, p.method || '', p.ref || '', p.notes || '', _now(), ewt]);
  // Recompute collected total + EWT total + status on the AR row (collected settles the full receivable).
  var colRows = _rows('Collections').filter(function (r) { return String(r['AR No']) === String(p.arNo); });
  var collected = colRows.reduce(function (s, r) { return s + _num(r['Amount (PHP)']); }, 0);
  var ewtTotal = colRows.reduce(function (s, r) { return s + _num(r['EWT (PHP)']); }, 0);
  var amt = _num(ar['Amount (PHP)']);
  var status = collected <= 0 ? 'Unpaid' : (collected >= amt ? 'Paid' : 'Partial');
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Collected (PHP)', collected);
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Status', status);
  _setCellByKey('ARAging', 'AR No', p.arNo, 'Updated At', _now());
  // GL: receivable settled by cash + creditable tax — Dr Cash (net) / Dr Creditable Tax (EWT) / Cr A/R (gross).
  var lines = [{ account: ACC.CASH, debit: collected - ewtTotal, memo: 'Collection of ' + p.arNo }];
  if (ewtTotal > 0) lines.push({ account: ACC.CWT, debit: ewtTotal, memo: 'EWT 2307 — ' + p.arNo });
  lines.push({ account: ACC.AR, credit: collected, memo: 'Collection of ' + p.arNo });
  _postJournal('ARCOLL', p.arNo, _now(), 'PHP', lines);
  _refStore('recordCollection', p.clientRef, colNo);
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

// Single OpEx umbrella: every expense classifies as Operating; the category is the real breakdown.
// (The legacy _EXP_TYPE_MAP above is retained for reference but no longer splits buckets.)
function _expType(category) {
  return EXP_TYPE.OPEX;
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
  var category = String(p.category || '').trim();   // optional: match a single category
  var type = String(p.type || '').trim();           // target type
  if (!type) return { success: false, message: 'type is required.' };
  var sh = _sheet('Expenses');
  var typeCol = SCHEMA.Expenses.indexOf('Type') + 1;
  var updated = 0;
  _rows('Expenses').forEach(function (r) {
    var catMatch = !category || String(r['Category']).trim().toLowerCase() === category.toLowerCase();
    if (catMatch && String(r['Type']) !== type) {
      sh.getRange(r.rowIndex, typeCol, 1, 1).setValues([[type]]);
      updated++;
    }
  });
  var what = category ? ('"' + category + '"') : 'all';
  return { success: true, updated: updated, message: 'Reclassified ' + updated + ' ' + what + ' expense(s) to ' + type + '.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  MATERIALS RECEIVING  (loads from a PO; pro-rates shipping → landed cost → inventory)
// ════════════════════════════════════════════════════════════════════════════
function getReceiving() {
  var items = _rows('ReceivingItems');
  return { success: true, data: _rows('MaterialsReceiving').map(function (m) {
    var its = items.filter(function (r) { return String(r['MR No']) === String(m['MR No']); });
    return {
      mrNo: m['MR No'], poNo: m['PO No'], soNo: m['SO No'] || '', date: m['Date'], supplier: m['Supplier'],
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
  var dupRc = _refSeen('createReceiving', p.clientRef);
  if (dupRc) return { success: true, mrNo: dupRc, duplicate: true, message: 'Materials received; inventory, landed cost and journal updated.' };
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
  // SO No (13th col) comes from the PO so receiving joins back to its sales order.
  var rcSoNo = (function () {
    var rows = _rows('PurchaseOrders');
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i]['PO No']) === String(p.poNo)) return String(rows[i]['SO No'] || '');
    }
    return '';
  })();
  _append('MaterialsReceiving', [no, p.poNo || '', p.date || _now(), p.supplier || '', currency,
    duties, vat, delivery, other, totalShipping, p.receivedBy || '', _now(), rcSoNo]);

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
  _refStore('createReceiving', p.clientRef, no);
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
      invNo: String(v['INV No']), soNo: String(v['SO No']), date: v['Date'], customer: v['Customer'],
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
  var dup = _refSeen('createInvoice', p.clientRef);
  if (dup) return { success: true, invNo: dup, duplicate: true, message: 'Invoice issued; AR entry created, inventory deducted and journal posted.' };
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
  _refStore('createInvoice', p.clientRef, no);
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
//  SHIPMENT MONITORING (flow-native) — 21-stage timeline auto-linked to the flow
// ════════════════════════════════════════════════════════════════════════════
// Stage keys (must match dashboard/js/stage-meta.js _SM_LIFECYCLE_STAGES order).
var _SHIP_STAGES = ['so_received', 'po_created', 'po_approved', 'po_sent', 'proforma_received',
  'prf_created', 'prf_approved', 'tt_sent', 'tt_forwarded', 'shipping_docs_received', 'forwarder_quotes',
  'forwarder_approved', 'booked', 'pickup', 'in_transit', 'customs_clearance', 'fan_sad_tan',
  'debit_memo', 'forwarder_final_invoice', 'local_charges', 'delivered'];

function _shipParse(json) { try { return JSON.parse(json || '{}') || {}; } catch (e) { return {}; } }

/** Auto-derive which stages are "done" from the flow records joined by the shipment's SO/PO. */
function _shipAutoDerive(soNo) {
  var d = {};
  if (!soNo) return d;
  d.so_received = true;                                              // the SO exists by definition
  var pos = _rows('PurchaseOrders').filter(function (r) { return String(r['SO No']) === String(soNo); });
  if (pos.length) {
    d.po_created = true;
    var anyApproved = pos.some(function (p) { return String(p['Status']) === 'Approved'; });
    var anySent = pos.some(function (p) { return ['Approved', 'Sent'].indexOf(String(p['Status'])) !== -1; });
    if (anyApproved) d.po_approved = true;
    if (anySent) d.po_sent = true;
    var poNos = {}; pos.forEach(function (p) { poNos[String(p['PO No'])] = true; });
    var aps = _rows('APAging').filter(function (r) { return poNos[String(r['PO No'])]; });
    if (aps.length) d.prf_created = true;
    if (aps.some(function (a) { return _num(a['Paid (PHP)']) > 0; })) d.tt_sent = true;
    var mrs = _rows('MaterialsReceiving').filter(function (r) { return poNos[String(r['PO No'])]; });
    if (mrs.length) d.delivered = true;
  }
  return d;
}

function _shipMap(r) {
  return {
    shipmentId: r['Shipment ID'], soNo: r['SO No'], poNo: r['PO No'], customer: r['Customer'],
    principal: r['Principal'], item: r['Item'], mode: r['Mode'], etd: r['ETD'], eta: r['ETA'],
    awb: r['AWB'], status: r['Status'] || 'Pending', remarks: r['Remarks'],
    stages: _shipParse(r['Stages (JSON)']), createdBy: r['Created By'], createdAt: r['Created At'],
    updatedAt: r['Updated At'], rowIndex: r.rowIndex
  };
}

/** Merge stored manual stage states with the auto-derived "done" flags. */
function _shipTimeline(s) {
  var derived = _shipAutoDerive(s.soNo);
  return _SHIP_STAGES.map(function (key) {
    var stored = s.stages[key] || {};
    var auto = !!derived[key];
    var status = stored.status || (auto ? 'done' : 'pending');
    // Auto-derived stages always show done unless explicitly skipped.
    if (auto && status !== 'skipped') status = 'done';
    return {
      key: key, status: status, autoderived: auto,
      completedAt: stored.completedAt || '', completedBy: stored.completedBy || '',
      notes: stored.notes || '', skippedReason: stored.skippedReason || ''
    };
  });
}

function getShipments() {
  return { success: true, data: _rows('Shipments').map(function (r) {
    var s = _shipMap(r);
    var tl = _shipTimeline(s);
    var done = tl.filter(function (t) { return t.status === 'done'; }).length;
    var skipped = tl.filter(function (t) { return t.status === 'skipped'; }).length;
    s.progress = { done: done, skipped: skipped, total: _SHIP_STAGES.length };
    delete s.stages;
    return s;
  }) };
}

function getShipmentTimeline(p) {
  if (!p.shipmentId) return { success: false, message: 'shipmentId required.' };
  var r = _rows('Shipments').filter(function (x) { return String(x['Shipment ID']) === String(p.shipmentId); })[0];
  if (!r) return { success: false, message: 'Shipment not found.' };
  var s = _shipMap(r);
  return { success: true, shipment: { shipmentId: s.shipmentId, soNo: s.soNo, poNo: s.poNo,
    customer: s.customer, principal: s.principal, item: s.item, mode: s.mode, etd: s.etd, eta: s.eta,
    awb: s.awb, status: s.status, remarks: s.remarks }, timeline: _shipTimeline(s) };
}

function advanceShipmentStage(p) {
  if (!p.shipmentId || !p.stageKey) return { success: false, message: 'shipmentId and stageKey required.' };
  if (_SHIP_STAGES.indexOf(p.stageKey) === -1) return { success: false, message: 'Unknown stage.' };
  var st = ['done', 'skipped', 'pending'].indexOf(p.stageStatus) !== -1 ? p.stageStatus : 'done';
  var sh = _sheet('Shipments');
  var r = _rows('Shipments').filter(function (x) { return String(x['Shipment ID']) === String(p.shipmentId); })[0];
  if (!r) return { success: false, message: 'Shipment not found.' };
  var stages = _shipParse(r['Stages (JSON)']);
  if (st === 'pending') { delete stages[p.stageKey]; }
  else {
    stages[p.stageKey] = { status: st, completedAt: _dateStr(_now()), completedBy: p.actorName || '',
      notes: p.notes || '', skippedReason: st === 'skipped' ? String(p.skippedReason || '').slice(0, 200) : '' };
  }
  var jsonCol = SCHEMA.Shipments.indexOf('Stages (JSON)') + 1;
  var updCol = SCHEMA.Shipments.indexOf('Updated At') + 1;
  sh.getRange(r.rowIndex, jsonCol, 1, 1).setValues([[JSON.stringify(stages)]]);
  sh.getRange(r.rowIndex, updCol, 1, 1).setValues([[_now()]]);
  return { success: true, shipmentId: p.shipmentId, stageKey: p.stageKey, status: st, message: 'Stage updated.' };
}

function updateShipment(p) {
  if (!p.shipmentId) return { success: false, message: 'shipmentId required.' };
  var r = _rows('Shipments').filter(function (x) { return String(x['Shipment ID']) === String(p.shipmentId); })[0];
  if (!r) return { success: false, message: 'Shipment not found.' };
  var setIf = function (header, val) { if (val !== undefined) _setCellByKey('Shipments', 'Shipment ID', p.shipmentId, header, val); };
  setIf('PO No', p.poNo); setIf('Principal', p.principal); setIf('Item', p.item); setIf('Mode', p.mode);
  setIf('ETD', p.etd); setIf('ETA', p.eta); setIf('AWB', p.awb); setIf('Status', p.status); setIf('Remarks', p.remarks);
  _setCellByKey('Shipments', 'Shipment ID', p.shipmentId, 'Updated At', _now());
  return { success: true, shipmentId: p.shipmentId, message: 'Shipment updated.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  PAYMENT REQUESTS  (Type 'PO' supplier PRF: Director → Management;
//                     Type 'Other' payables: Accounting → then Management & Director)
// ════════════════════════════════════════════════════════════════════════════
function _prRow(no) {
  return _rows('PaymentRequests').filter(function (r) { return String(r['PR No']) === String(no); })[0];
}
function _prMap(r) {
  return {
    prNo: r['PR No'], type: r['Type'], poNo: r['PO No'], soNo: r['SO No'], supplier: r['Supplier'],
    payee: r['Payee'], currency: r['Currency'] || 'PHP', amount: _num(r['Amount']), purpose: r['Purpose'],
    department: r['Department'], bankName: r['Bank Name'], accountName: r['Account Name'],
    accountNumber: r['Account Number'], paymentMethod: r['Payment Method'], dueDate: r['Due Date'],
    remarks: r['Remarks'], status: r['Status'] || 'Draft', createdBy: r['Created By'],
    createdByRole: r['Created By Role'], acctApprovedBy: r['Acct Approved By'], acctApprovedAt: r['Acct Approved At'],
    dirApprovedBy: r['Dir Approved By'], dirApprovedAt: r['Dir Approved At'],
    mgmtApprovedBy: r['Mgmt Approved By'], mgmtApprovedAt: r['Mgmt Approved At'],
    approvalNote: r['Approval Note'], pdfLink: r['PDF Link'] || '', createdAt: r['Created At'],
    updatedAt: r['Updated At'], rowIndex: r.rowIndex
  };
}
function _prSet(no, obj) {
  Object.keys(obj).forEach(function (k) { _setCellByKey('PaymentRequests', 'PR No', no, k, obj[k]); });
  _setCellByKey('PaymentRequests', 'PR No', no, 'Updated At', _now());
}

function getPaymentRequests(p) {
  var rows = _rows('PaymentRequests').map(_prMap);
  if (p && p.type) rows = rows.filter(function (r) { return String(r.type) === String(p.type); });
  if (p && p.status) rows = rows.filter(function (r) { return String(r.status) === String(p.status); });
  if (p && p.createdBy) rows = rows.filter(function (r) { return String(r.createdBy) === String(p.createdBy); });
  rows.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  return { success: true, data: rows };
}

/** PHP payable for a PO = Σ APAging Amount (PHP) for that PO (fallback FC total). */
function _poPayablePHP(poNo) {
  var php = 0, fc = 0;
  _rows('APAging').forEach(function (r) {
    if (String(r['PO No']) === String(poNo)) { php += _num(r['Amount (PHP)']); fc += _num(r['Amount (FC)']); }
  });
  return php > 0 ? php : fc;
}

// Stamp the PR No onto every AP Aging row for a PO, so the payment request shows on its AP entry.
function _linkPrToAp(poNo, prNo) {
  if (!poNo) return;
  var col = SCHEMA.APAging.indexOf('PR No') + 1;
  if (col < 1) return;
  var sh = _sheet('APAging');
  _rows('APAging').forEach(function (r) {
    if (String(r['PO No']) === String(poNo)) sh.getRange(r.rowIndex, col, 1, 1).setValues([[prNo]]);
  });
}

function createPaymentRequest(p) {
  var type = (p.type === 'Other') ? 'Other' : 'PO';
  var no = p.prNo || _nextNumber('PaymentRequests', 1, 'PR');
  if (_prRow(no)) return { success: false, message: 'Payment Request ' + no + ' already exists.' };
  var supplier = p.supplier || '', currency = p.currency || 'PHP', amount = _num(p.amount),
      poNo = p.poNo || '', soNo = p.soNo || '';
  if (type === 'PO') {
    if (!poNo) return { success: false, message: 'A purchase order is required for a PO payment request.' };
    var po = _rows('PurchaseOrders').filter(function (r) { return String(r['PO No']) === String(poNo); })[0];
    if (po) { supplier = supplier || po['Supplier']; currency = 'PHP'; soNo = soNo || po['SO No']; }
    if (amount <= 0) amount = _poPayablePHP(poNo);
  } else {
    if (!p.payee) return { success: false, message: 'Payee is required.' };
    if (amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };
  }
  _append('PaymentRequests', [no, type, poNo, soNo, supplier, p.payee || supplier, currency, amount,
    p.purpose || '', p.department || '', p.bankName || '', p.accountName || '', p.accountNumber || '',
    p.paymentMethod || '', p.dueDate || '', p.remarks || '', 'Draft', p.createdBy || p.actorName || '',
    p.actorRole || p.createdByRole || '', '', '', '', '', '', '', '', '', _now(), _now()]);
  if (type === 'PO') _linkPrToAp(poNo, no);   // connect the PR to this PO's AP Aging entry
  return { success: true, prNo: no, type: type, amount: amount, message: 'Payment Request ' + no + ' created (Draft).' };
}

function updatePaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  // Editable at any status (accounting can update details/amount even after submit/approval).
  var fields = { 'Supplier': p.supplier, 'Payee': p.payee, 'Currency': p.currency, 'Purpose': p.purpose,
    'Department': p.department, 'Bank Name': p.bankName, 'Account Name': p.accountName,
    'Account Number': p.accountNumber, 'Payment Method': p.paymentMethod, 'Due Date': p.dueDate, 'Remarks': p.remarks };
  var set = {};
  Object.keys(fields).forEach(function (k) { if (fields[k] !== undefined) set[k] = fields[k]; });
  if (p.amount !== undefined) set['Amount'] = _num(p.amount);
  _prSet(p.prNo, set);
  return { success: true, prNo: p.prNo, message: 'Payment Request updated.' };
}

function deletePaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var poNo = r['PO No'];
  _sheet('PaymentRequests').deleteRow(r.rowIndex);
  // Clear the AP link if it pointed at this PR.
  if (poNo) {
    var col = SCHEMA.APAging.indexOf('PR No') + 1, sh = _sheet('APAging');
    _rows('APAging').forEach(function (a) {
      if (String(a['PO No']) === String(poNo) && String(a['PR No']) === String(p.prNo)) sh.getRange(a.rowIndex, col, 1, 1).setValues([['']]);
    });
  }
  return { success: true, prNo: p.prNo, message: 'Payment Request deleted.' };
}

function submitPaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status']);
  if (st !== 'Draft' && st !== 'Rejected') return { success: false, message: 'Already submitted.' };
  var next = String(r['Type']) === 'Other' ? 'Pending Accounting' : 'Pending Director';
  _prSet(p.prNo, { 'Status': next, 'Approval Note': '' });
  return { success: true, prNo: p.prNo, status: next, message: 'Submitted for approval (' + next + ').' };
}

function approvePaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status']), role = String(p.actorRole || ''), who = p.actorName || '', now = _now();
  if (String(r['Type']) === 'PO') {
    if (st === 'Pending Director') {
      if (role !== 'director') return { success: false, message: 'Only the director can approve at this stage.' };
      _prSet(p.prNo, { 'Dir Approved By': who, 'Dir Approved At': now, 'Status': 'Pending Management' });
      return { success: true, prNo: p.prNo, status: 'Pending Management', message: 'Director approved; forwarded to management.' };
    }
    if (st === 'Pending Management') {
      if (role !== 'management') return { success: false, message: 'Only management can give final approval.' };
      _prSet(p.prNo, { 'Mgmt Approved By': who, 'Mgmt Approved At': now, 'Status': 'Approved' });
      return { success: true, prNo: p.prNo, status: 'Approved', message: 'Payment Request approved.' };
    }
    return { success: false, message: 'Not awaiting approval at this stage.' };
  }
  // Type 'Other': Accounting → then both Management and Director
  if (st === 'Pending Accounting') {
    if (role !== 'accounting') return { success: false, message: 'Only accounting can approve at this stage.' };
    _prSet(p.prNo, { 'Acct Approved By': who, 'Acct Approved At': now, 'Status': 'Pending Final' });
    return { success: true, prNo: p.prNo, status: 'Pending Final', message: 'Accounting approved; awaiting management and director.' };
  }
  if (st === 'Pending Final') {
    if (role === 'management') {
      if (r['Mgmt Approved By']) return { success: false, message: 'Management already approved.' };
      _prSet(p.prNo, { 'Mgmt Approved By': who, 'Mgmt Approved At': now });
    } else if (role === 'director') {
      if (r['Dir Approved By']) return { success: false, message: 'Director already approved.' };
      _prSet(p.prNo, { 'Dir Approved By': who, 'Dir Approved At': now });
    } else {
      return { success: false, message: 'Only management or director can approve at this stage.' };
    }
    var fresh = _prRow(p.prNo);
    if (fresh['Mgmt Approved By'] && fresh['Dir Approved By']) {
      _prSet(p.prNo, { 'Status': 'Approved' });
      return { success: true, prNo: p.prNo, status: 'Approved', message: 'Payment Request fully approved.' };
    }
    return { success: true, prNo: p.prNo, status: 'Pending Final', message: 'Approval recorded; awaiting the other approver.' };
  }
  return { success: false, message: 'Not awaiting approval at this stage.' };
}

function rejectPaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status']), role = String(p.actorRole || '');
  if (st.indexOf('Pending') !== 0) return { success: false, message: 'Only a pending request can be rejected.' };
  var ok = (String(r['Type']) === 'PO') ? (role === 'director' || role === 'management')
    : (role === 'accounting' || role === 'management' || role === 'director');
  if (!ok) return { success: false, message: 'You are not an approver for this request.' };
  _prSet(p.prNo, { 'Status': 'Rejected', 'Approval Note': p.reason || '' });
  return { success: true, prNo: p.prNo, status: 'Rejected', message: 'Payment Request rejected.' };
}

function savePaymentRequestPDF(p) {
  if (!p.prNo || !p.pdfBase64) return { success: false, message: 'prNo and pdfBase64 required.' };
  var link = _savePdfToDrive(p.pdfBase64, p.fileName || (p.prNo + '.pdf'));
  _setCellByKey('PaymentRequests', 'PR No', p.prNo, 'PDF Link', link);
  return { success: true, prNo: p.prNo, link: link, message: 'Payment Request PDF saved.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  SO COST DETAILS — per-SO cost breakdown migrated from the old Profit Report
// ════════════════════════════════════════════════════════════════════════════
function getSOCostDetails(p) {
  var rows = _rows('SOCostDetails');
  if (p && p.soNo) rows = rows.filter(function (r) { return String(r['SO No']) === String(p.soNo); });
  return { success: true, data: rows.map(function (r) {
    return {
      soNo: String(r['SO No']), customer: r['Customer'], date: r['Date'], sales: _num(r['Sales']),
      cogsType: r['COGS Type'] || 'local', purchaseOfGoods: _num(r['Purchase of Goods']),
      bankChargeCOGS: _num(r['Bank Charge (COGS)']), dutiesAndTaxes: _num(r['Duties & Taxes']),
      bankChargeShipping: _num(r['Bank Charge (Shipping)']), shippingCompany: r['Shipping Company'],
      shippingCost: _num(r['Shipping Cost']), localCharges: _num(r['Local Charges']),
      deliveryToOffice: _num(r['Delivery to Office']), deliveryToClient: _num(r['Delivery to Client']),
      totalCOGS: _num(r['Total COGS']), grossProfit: _num(r['Gross Profit']),
      source: r['Source'], createdAt: r['Created At'], rowIndex: r.rowIndex
    };
  }) };
}

/** Computed COGS from the components (for the mismatch check). */
function _soCostComputed(c) {
  var t = _num(c.purchaseOfGoods) + _num(c.deliveryToOffice) + _num(c.deliveryToClient);
  if (String(c.cogsType) === 'international') {
    t += _num(c.bankServiceChargeCOGS) + _num(c.dutiesAndTaxes) + _num(c.bankServiceChargeShipping) +
         _num(c.shippingCost) + _num(c.localCharges);
  }
  return t;
}

function importSOCostDetails(p) {
  var incoming = JSON.parse(p.items || '[]');
  if (!incoming.length) return { success: false, message: 'No cost details to import.' };
  var existing = {};
  _rows('SOCostDetails').forEach(function (r) { existing[String(r['SO No'])] = true; });
  var soHeaders = {};
  _rows('SalesOrders').forEach(function (r) { soHeaders[String(r['SO No'])] = true; });
  var sh = _sheet('SOCostDetails'), soSh = _sheet('SalesOrders');
  var created = 0, skipped = 0, headersCreated = 0, mismatches = [], errors = [];
  incoming.forEach(function (c) {
    try {
      var soNo = c.soNo != null ? String(c.soNo) : '';
      if (!soNo) { errors.push({ soNo: '', message: 'missing SO No' }); return; }
      if (existing[soNo]) { skipped++; return; }
      var totalCOGS = _num(c.totalCOGS);
      var computed = _soCostComputed(c);
      if (Math.abs(computed - totalCOGS) > 0.01) mismatches.push({ soNo: soNo, stored: totalCOGS, computed: computed });
      // Write each old field to its exact column (no cross-mixing).
      sh.appendRow([soNo, c.customerName || c.customer || '', c.soDate || c.date || '', _num(c.sales),
        c.cogsType || 'local', _num(c.purchaseOfGoods), _num(c.bankServiceChargeCOGS), _num(c.dutiesAndTaxes),
        _num(c.bankServiceChargeShipping), c.shippingCompany || '', _num(c.shippingCost), _num(c.localCharges),
        _num(c.deliveryToOffice), _num(c.deliveryToClient), totalCOGS, _num(c.grossProfit),
        'Migrated (profit report)', _now()]);
      existing[soNo] = true;
      // Also create a header-only Sales Order if one doesn't exist yet (per decision).
      if (!soHeaders[soNo]) {
        soSh.appendRow([soNo, '', c.soDate || c.date || _now(), c.customerName || c.customer || '(unknown)',
          'Closed', _num(c.sales), 'Migrated (legacy)', _now(),
          (String(c.cogsType) === 'international' ? 'International' : 'Local')]);
        soHeaders[soNo] = true;
        headersCreated++;
      }
      created++;
    } catch (e) {
      errors.push({ soNo: c && c.soNo, message: String(e && e.message || e) });
    }
  });
  // Reconcile the newly-imported SOs into the invoice-/receiving-driven widgets (idempotent).
  var bf = {};
  try { bf = backfillMigratedRecords({}); } catch (e) { bf = { invoicesCreated: 0, receivingsCreated: 0 }; }
  return { success: true, created: created, skipped: skipped, headersCreated: headersCreated,
    mismatches: mismatches, errors: errors,
    invoicesCreated: bf.invoicesCreated || 0, receivingsCreated: bf.receivingsCreated || 0,
    message: 'Imported ' + created + ' SO cost detail(s); created ' + headersCreated + ' header(s); skipped ' + skipped +
      '; backfilled ' + (bf.invoicesCreated || 0) + ' invoice(s) + ' + (bf.receivingsCreated || 0) + ' receiving(s).' };
}

function _soHasRealInvoice(soNo) {
  return _rows('Invoices').some(function (v) {
    return String(v['SO No']) === String(soNo) && String(v['Created By']) !== 'Migrated (legacy)';
  });
}

/** Delete the SO's migrated Invoice(s) + their InvoiceItems (bottom-up preserves indices). */
function _deleteMigratedInvoiceForSO(soNo) {
  var invSh = _sheet('Invoices'), itemSh = _sheet('InvoiceItems'), invNos = {};
  _rows('Invoices').filter(function (v) { return String(v['SO No']) === String(soNo) && String(v['Created By']) === 'Migrated (legacy)'; })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; })
    .forEach(function (v) { invNos[String(v['INV No'])] = true; invSh.deleteRow(v.rowIndex); });
  _rows('InvoiceItems').filter(function (r) { return invNos[String(r['INV No'])]; })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { itemSh.deleteRow(r.rowIndex); });
}

/** Delete the SO's migrated Receiving(s) + their ReceivingItems. */
function _deleteMigratedReceivingForSO(soNo) {
  var mrSh = _sheet('MaterialsReceiving'), itemSh = _sheet('ReceivingItems'), mrNos = {};
  _rows('MaterialsReceiving').filter(function (m) { return String(m['SO No']) === String(soNo) && String(m['Received By']) === 'Migrated (legacy)'; })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; })
    .forEach(function (m) { mrNos[String(m['MR No'])] = true; mrSh.deleteRow(m.rowIndex); });
  _rows('ReceivingItems').filter(function (r) { return mrNos[String(r['MR No'])]; })
    .sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (r) { itemSh.deleteRow(r.rowIndex); });
}

/**
 * Write the migrated Invoice + Receiving for ONE SOCostDetails row (sheet-key object). Plain appends —
 * NO journals/inventory/AR/AP. `force` regenerates (deletes existing migrated rows first) — used when an
 * SO's cost is edited so the process detail stays in sync; without `force` it only fills gaps (backfill).
 * A real (non-migrated) invoice is never duplicated.
 */
function _writeMigratedRecordsForSO(cd, force) {
  var soNo = String(cd['SO No'] || '');
  if (!soNo) return { invoice: false, receiving: false };
  var sales = _num(cd['Sales']), cogs = _num(cd['Total COGS']);
  var customer = cd['Customer'] || '(unknown)', date = cd['Date'] || _now();
  var hasReal = _soHasRealInvoice(soNo);
  var hasMigInv = _rows('Invoices').some(function (v) { return String(v['SO No']) === soNo && String(v['Created By']) === 'Migrated (legacy)'; });
  var hasMigRcv = _rows('MaterialsReceiving').some(function (m) { return String(m['SO No']) === soNo && String(m['Received By']) === 'Migrated (legacy)'; });
  var wroteInv = false, wroteRcv = false;
  if (force || (!hasReal && !hasMigInv)) {
    if (force) _deleteMigratedInvoiceForSO(soNo);
    if (!hasReal) {
      var invNo = _nextNumber('Invoices', 1, 'INV');
      _sheet('Invoices').appendRow([invNo, soNo, date, customer, sales, cogs, 'Migrated (legacy)', _now()]);
      _sheet('InvoiceItems').appendRow([invNo, '(migrated)', 'Migrated legacy sales', 1, sales, sales, cogs, cogs]);
      wroteInv = true;
    }
  }
  if (force || !hasMigRcv) {
    if (force) _deleteMigratedReceivingForSO(soNo);
    var duties = _num(cd['Duties & Taxes']);
    var delivery = _num(cd['Delivery to Office']) + _num(cd['Delivery to Client']);
    var other = _num(cd['Local Charges']) + _num(cd['Bank Charge (COGS)']) + _num(cd['Bank Charge (Shipping)']) + _num(cd['Shipping Cost']);
    var totalShip = duties + delivery + other;
    var purchase = _num(cd['Purchase of Goods']);
    var mrNo = _nextNumber('MaterialsReceiving', 1, 'MR');
    _sheet('MaterialsReceiving').appendRow([mrNo, '', date, '(migrated)', 'PHP', duties, 0, delivery, other, totalShip, 'Migrated (legacy)', _now(), soNo]);
    _sheet('ReceivingItems').appendRow([mrNo, '(migrated)', 'Migrated legacy goods', 1, 0, purchase, 0, purchase, purchase]);
    wroteRcv = true;
  }
  return { invoice: wroteInv, receiving: wroteRcv };
}

/**
 * Reconcile migrated SOs into the invoice-/receiving-driven widgets: for every SOCostDetails row,
 * create a migrated Invoice (revenue + COGS) and a migrated Receiving (duties/delivery/other) — as
 * plain row appends only. NO journals, NO inventory apply, NO AR, NO AP (historical records). Marked
 * 'Migrated (legacy)' so the Balance Sheet can exclude them. Idempotent: skips SOs that already have
 * an invoice (any) or a migrated receiving. Safe to re-run.
 */
function backfillMigratedRecords(p) {
  var cds = _rows('SOCostDetails');
  if (!cds.length) return { success: true, invoicesCreated: 0, receivingsCreated: 0, skipped: 0, message: 'No migrated SO cost details to backfill.' };
  var invBySo = {};
  _rows('Invoices').forEach(function (v) { if (v['SO No'] != null) invBySo[String(v['SO No'])] = true; });
  var migRcv = {};
  _rows('MaterialsReceiving').forEach(function (m) {
    if (String(m['Received By']) === 'Migrated (legacy)' && m['SO No'] != null && String(m['SO No']) !== '') migRcv[String(m['SO No'])] = true;
  });
  var invSh = _sheet('Invoices'), invItemSh = _sheet('InvoiceItems');
  var mrSh = _sheet('MaterialsReceiving'), rcvItemSh = _sheet('ReceivingItems');
  var invoicesCreated = 0, receivingsCreated = 0, skipped = 0;
  cds.forEach(function (c) {
    var soNo = String(c['SO No'] || '');
    if (!soNo) { skipped++; return; }
    _setSoSupplierType(soNo, c['COGS Type']);   // auto-match the Intl/Local label from the cost type
    var sales = _num(c['Sales']), cogs = _num(c['Total COGS']);
    var customer = c['Customer'] || '(unknown)', date = c['Date'] || _now();
    // Invoice — only if the SO has no invoice at all (never duplicate a real new-flow invoice).
    if (!invBySo[soNo]) {
      var invNo = _nextNumber('Invoices', 1, 'INV');
      invSh.appendRow([invNo, soNo, date, customer, sales, cogs, 'Migrated (legacy)', _now()]);
      invItemSh.appendRow([invNo, '(migrated)', 'Migrated legacy sales', 1, sales, sales, cogs, cogs]);
      invBySo[soNo] = true;
      invoicesCreated++;
    }
    // Receiving — capture the cost breakdown; dedupe on a migrated MR for this SO.
    if (!migRcv[soNo]) {
      var duties = _num(c['Duties & Taxes']);
      var delivery = _num(c['Delivery to Office']) + _num(c['Delivery to Client']);
      var other = _num(c['Local Charges']) + _num(c['Bank Charge (COGS)']) + _num(c['Bank Charge (Shipping)']) + _num(c['Shipping Cost']);
      var totalShip = duties + delivery + other;
      var purchase = _num(c['Purchase of Goods']);
      var mrNo = _nextNumber('MaterialsReceiving', 1, 'MR');
      mrSh.appendRow([mrNo, '', date, '(migrated)', 'PHP', duties, 0, delivery, other, totalShip, 'Migrated (legacy)', _now(), soNo]);
      rcvItemSh.appendRow([mrNo, '(migrated)', 'Migrated legacy goods', 1, 0, purchase, 0, purchase, purchase]);
      migRcv[soNo] = true;
      receivingsCreated++;
    }
    if (invBySo[soNo] && migRcv[soNo] && invoicesCreated === 0 && receivingsCreated === 0) skipped++;
  });
  return { success: true, invoicesCreated: invoicesCreated, receivingsCreated: receivingsCreated, skipped: skipped,
    message: 'Backfilled ' + invoicesCreated + ' invoice(s) and ' + receivingsCreated + ' receiving record(s).' };
}

/**
 * Editable per-SO cost: upsert a SOCostDetails row by SO No. Overwrites every cost component,
 * recomputes Total COGS + Gross Profit, marks Source='Manual (edited)'. Creates the row (and a
 * header-only Sales Order) if none exists. Field names match getSOCostDetails' camelCase output so
 * the front-end editor round-trips cleanly.
 */
function saveSOCostDetails(p) {
  var c = (typeof p.record === 'string') ? JSON.parse(p.record || '{}') : (p.record || p);
  var soNo = c.soNo != null ? String(c.soNo) : '';
  if (!soNo) return { success: false, message: 'SO No is required.' };
  var cogsType = String(c.cogsType || 'local');
  // Recompute Total COGS from the components (international includes shipping/bank/duties/local).
  var totalCOGS = _num(c.purchaseOfGoods) + _num(c.deliveryToOffice) + _num(c.deliveryToClient);
  if (cogsType === 'international') {
    totalCOGS += _num(c.bankChargeCOGS) + _num(c.dutiesAndTaxes) + _num(c.bankChargeShipping) +
                 _num(c.shippingCost) + _num(c.localCharges);
  }
  var sales = _num(c.sales);
  var grossProfit = sales - totalCOGS;
  var rowArr = [soNo, c.customer || '', c.date || '', sales, cogsType, _num(c.purchaseOfGoods),
    _num(c.bankChargeCOGS), _num(c.dutiesAndTaxes), _num(c.bankChargeShipping), c.shippingCompany || '',
    _num(c.shippingCost), _num(c.localCharges), _num(c.deliveryToOffice), _num(c.deliveryToClient),
    totalCOGS, grossProfit,
    (c.source === 'import' ? 'Migrated (reconciliation)' : 'Manual (edited)'), _now()];
  var sh = _sheet('SOCostDetails');
  var existing = _rows('SOCostDetails').filter(function (r) { return String(r['SO No']) === soNo; })[0];
  if (existing) {
    sh.getRange(existing.rowIndex, 1, 1, rowArr.length).setValues([rowArr]);
  } else {
    sh.appendRow(rowArr);
  }
  // ALWAYS ensure a Sales Order header exists (not only on the first-ever cost save). The old
  // append-branch-only check left SOs headerless when the cost row already existed at import time
  // (upsert path) but the header had been wiped — SO lists then disagreed with the invoice-driven
  // totals across dashboards. Existing headers (incl. native ones) are never modified here.
  // Imports (c.source==='import') keep the file's real status and are tagged 'Migrated (legacy)'
  // so a future year-scoped wipe removes them.
  var hasHeader = _rows('SalesOrders').some(function (r) { return String(r['SO No']) === soNo; });
  if (!hasHeader) {
    _sheet('SalesOrders').appendRow([soNo, '', c.date || _now(), c.customer || '(unknown)',
      c.status || 'Closed', sales,
      (c.source === 'import' ? 'Migrated (legacy)' : 'Manual (edited)'), _now(),
      (cogsType === 'international' ? 'International' : 'Local')]);
  }
  _setSoSupplierType(soNo, cogsType);   // keep the SO's Intl/Local label in sync with the cost type
  // Regenerate this SO's migrated Invoice + Receiving from the new breakdown so the process detail
  // (receiving shipping/duties + invoice COGS) and the invoice-driven widgets reflect the edit.
  try {
    _writeMigratedRecordsForSO({
      'SO No': soNo, 'Customer': c.customer || '', 'Date': c.date || '', 'Sales': sales, 'Total COGS': totalCOGS,
      'Duties & Taxes': _num(c.dutiesAndTaxes), 'Delivery to Office': _num(c.deliveryToOffice),
      'Delivery to Client': _num(c.deliveryToClient), 'Local Charges': _num(c.localCharges),
      'Bank Charge (COGS)': _num(c.bankChargeCOGS), 'Bank Charge (Shipping)': _num(c.bankChargeShipping),
      'Shipping Cost': _num(c.shippingCost), 'Purchase of Goods': _num(c.purchaseOfGoods)
    }, true);
  } catch (e) { /* record regeneration is best-effort */ }
  return { success: true, soNo: soNo, totalCOGS: totalCOGS, grossProfit: grossProfit,
    message: 'Saved cost details for ' + soNo + '.' };
}

/**
 * Resync the document-number counters after a manual cleanup. The numbering counters live in
 * ScriptProperties (seq_<sheet>_<prefix>_<yyyymm>) and are monotonic (collision-safe), so deleting rows
 * leaves a gap. Clearing the counter(s) makes the next _nextNumber recompute from the current sheet max —
 * e.g. after deleting PR 168/169 (last = 166), the next PR becomes 167.
 * Optional p.prefix (e.g. 'PR') limits the reset to that document type.
 */
function resetSequenceCounters(p) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var pref = String((p && p.prefix) || '').trim();
  var cleared = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('seq_') !== 0) return;
    if (pref && k.indexOf('_' + pref + '_') === -1) return;   // e.g. seq_PricingRequests_PR_202607
    props.deleteProperty(k);
    cleared.push(k);
  });
  return { success: true, cleared: cleared.length, keys: cleared,
    message: 'Numbering resynced — ' + cleared.length + ' counter(s) cleared. Next number derives from the current sheet.' };
}

/**
 * Remove ALL migrated sales-order records so they can be re-migrated cleanly: the migrated SOCostDetails
 * rows, the header-only migrated SalesOrders, and the migrated Invoices/Receiving (+ their item rows).
 * Real new-flow records are untouched. Deletes bottom-up to preserve row indices.
 */
function deleteMigratedRecords(p) {
  var counts = { soCosts: 0, salesOrders: 0, invoices: 0, receivings: 0 };
  var byRowDesc = function (a, b) { return b.rowIndex - a.rowIndex; };
  // Optional year scope (e.g. '2026'): only delete rows whose Date falls in that year.
  var year = String((p && p.year) || '').trim();
  var inYear = function (v) { return !year || _dateStr(v).indexOf(year) === 0; };
  // SOCostDetails — anything migrated or manually edited (all originate from the migration).
  var scdSh = _sheet('SOCostDetails');
  _rows('SOCostDetails').filter(function (r) { var s = String(r['Source'] || ''); return (s.indexOf('Migrated') === 0 || s === 'Manual (edited)') && inYear(r['Date']); })
    .sort(byRowDesc).forEach(function (r) { scdSh.deleteRow(r.rowIndex); counts.soCosts++; });
  // Header-only migrated Sales Orders.
  var soSh = _sheet('SalesOrders');
  _rows('SalesOrders').filter(function (r) { var cb = String(r['Created By'] || ''); return (cb === 'Migrated (legacy)' || cb === 'Manual (edited)') && inYear(r['Date']); })
    .sort(byRowDesc).forEach(function (r) { soSh.deleteRow(r.rowIndex); counts.salesOrders++; });
  // Migrated Invoices + their items.
  var invSh = _sheet('Invoices'), invNos = {};
  _rows('Invoices').filter(function (v) { return String(v['Created By']) === 'Migrated (legacy)' && inYear(v['Date']); })
    .sort(byRowDesc).forEach(function (v) { invNos[String(v['INV No'])] = true; invSh.deleteRow(v.rowIndex); counts.invoices++; });
  var invItemSh = _sheet('InvoiceItems');
  _rows('InvoiceItems').filter(function (r) { return invNos[String(r['INV No'])]; }).sort(byRowDesc).forEach(function (r) { invItemSh.deleteRow(r.rowIndex); });
  // Migrated Receiving + their items.
  var mrSh = _sheet('MaterialsReceiving'), mrNos = {};
  _rows('MaterialsReceiving').filter(function (m) { return String(m['Received By']) === 'Migrated (legacy)' && inYear(m['Date']); })
    .sort(byRowDesc).forEach(function (m) { mrNos[String(m['MR No'])] = true; mrSh.deleteRow(m.rowIndex); counts.receivings++; });
  var rcvItemSh = _sheet('ReceivingItems');
  _rows('ReceivingItems').filter(function (r) { return mrNos[String(r['MR No'])]; }).sort(byRowDesc).forEach(function (r) { rcvItemSh.deleteRow(r.rowIndex); });
  return { success: true, soCosts: counts.soCosts, salesOrders: counts.salesOrders,
    invoices: counts.invoices, receivings: counts.receivings, year: year || 'all',
    message: 'Removed migrated' + (year ? ' (' + year + ')' : '') + ': ' + counts.soCosts + ' cost detail(s), ' + counts.salesOrders + ' SO(s), ' +
      counts.invoices + ' invoice(s), ' + counts.receivings + ' receiving(s).' };
}

/**
 * Migrate legacy pricing-engine history (old "Pricing Submissions" sheet) into PricingRequests /
 * PricingRequestItems. Idempotent: dedupes by Legacy ID (the old PRC-… id). Preserves the full engine
 * breakdown verbatim in the Legacy Items JSON column for the detail view.
 */
function importPricingSubmissions(p) {
  var incoming = JSON.parse(p.items || '[]');
  if (!incoming.length) return { success: false, message: 'No pricing submissions to import.' };
  var sh = _sheet('PricingRequests');
  // Label the two appended legacy columns on the header row (cosmetic; _rows maps by position).
  try { sh.getRange(1, 13, 1, 2).setValues([['Legacy ID', 'Legacy Items JSON']]); } catch (e) {}
  var existing = {};
  _rows('PricingRequests').forEach(function (h) {
    var lid = String(h['Legacy ID'] || '');
    if (lid) existing[lid] = true;
  });
  var itemSh = _sheet('PricingRequestItems');
  var created = 0, skipped = 0, errors = [];
  incoming.forEach(function (s) {
    try {
      var legacyId = String(s.id || s.legacyId || '');
      if (legacyId && existing[legacyId]) { skipped++; return; }
      var itemsJson = String(s.itemsJson || '[]');
      var items = [];
      try { items = JSON.parse(itemsJson); } catch (e2) { items = []; }
      var prNo = _nextNumber('PricingRequests', 1, 'PR');
      sh.appendRow([prNo, s.date || _now(), s.submittedBy || '', s.customer || s.client || '',
        s.destination || '', _num(s.commissionPct), _num(s.marginPct), 'Migrated', '',
        'Migrated from ' + (legacyId || 'legacy pricing') + (s.status ? ' (was ' + s.status + ')' : ''),
        _now(), _now(), legacyId, itemsJson, '', '', '', '']); // + Priced Items JSON (15) + Client Location (16) + Doc JSON (17) + Client Ref (18)
      items.forEach(function (it, i) {
        itemSh.appendRow([prNo, i + 1, it.modelNo || it.itemNo || '', it.name || it.itemName || '',
          _num(it.qty), it.uom || '', it.remarks || '', true, it.supplier || '',
          s.principal || it.principal || '', it.currency || 'PHP', _num(it.buyPrice != null ? it.buyPrice : it.supplierPrice),
          _num(it.cbm), _num(it.unitPriceVatEx != null ? it.unitPriceVatEx : it.finalPrice)]);
      });
      if (legacyId) existing[legacyId] = true;
      created++;
    } catch (e) {
      errors.push({ legacyId: s && (s.id || s.legacyId), message: String(e && e.message || e) });
    }
  });
  return { success: true, created: created, skipped: skipped, errors: errors,
    message: 'Imported ' + created + ' pricing submission(s); skipped ' + skipped + '.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  BALANCE SHEET — editable opening balances (Cash, Inventory)
// ════════════════════════════════════════════════════════════════════════════
function getOpeningBalances() {
  var out = { cash: 0, inventory: 0 };
  _rows('OpeningBalances').forEach(function (r) {
    var k = String(r['Key'] || '').toLowerCase();
    if (k === 'cash' || k === 'inventory') out[k] = _num(r['Amount (PHP)']);
  });
  return { success: true, data: out, cash: out.cash, inventory: out.inventory };
}

function setOpeningBalance(p) {
  var key = String(p.key || '').toLowerCase();
  if (key !== 'cash' && key !== 'inventory') return { success: false, message: 'key must be cash or inventory.' };
  var amount = _num(p.amount);
  var existing = _rows('OpeningBalances').filter(function (r) { return String(r['Key']).toLowerCase() === key; })[0];
  if (existing) {
    _setCellByKey('OpeningBalances', 'Key', existing['Key'], 'Amount (PHP)', amount);
    _setCellByKey('OpeningBalances', 'Key', existing['Key'], 'Updated By', p.actorName || '');
    _setCellByKey('OpeningBalances', 'Key', existing['Key'], 'Updated At', _now());
  } else {
    _append('OpeningBalances', [key, amount, p.actorName || '', _now()]);
  }
  return { success: true, key: key, amount: amount, message: 'Opening ' + key + ' balance saved.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  PDF → DRIVE  (store generated quotation / PO PDFs and link them on the record)
// ════════════════════════════════════════════════════════════════════════════
function _flowFolder() {
  if (FLOW_DRIVE_FOLDER_ID) return DriveApp.getFolderById(FLOW_DRIVE_FOLDER_ID);
  var it = DriveApp.getFoldersByName('Flow Documents');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Flow Documents');
}

/** Purchase-request PDFs live in "Purchase Request/<requester name>/" — one subfolder per user
 *  (sales or admin, whoever created the request). Find-or-create both levels. */
function _prUserFolder(userName) {
  var rootIt = DriveApp.getFoldersByName('Purchase Request');
  var root = rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder('Purchase Request');
  var name = String(userName || 'Unknown').trim() || 'Unknown';
  var subIt = root.getFoldersByName(name);
  return subIt.hasNext() ? subIt.next() : root.createFolder(name);
}

/** Save any base64 file to Drive (default: the Flow Documents folder); returns { url, id }. */
function _saveFileToDrive(base64, fileName, mimeType, folder) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName || 'document');
  var file = (folder || _flowFolder()).createFile(blob);
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
//  MARKETING WORKSPACE  (generic data-backed store: one config + 3 actions)
// ════════════════════════════════════════════════════════════════════════════
var MKTG = {
  leads:      { sheet: 'MktgLeads', prefix: 'LEAD' },
  campaigns:  { sheet: 'MktgCampaigns', prefix: 'CMP' },
  content:    { sheet: 'MktgContent', prefix: 'CNT' },
  enablement: { sheet: 'MktgEnablement', prefix: 'AST' },
  events:     { sheet: 'MktgEvents', prefix: 'EVT' },
  principal:  { sheet: 'MktgPrincipal', prefix: 'PRN' },
  metrics:    { sheet: 'MktgMetrics', key: 'Month' }   // upsert by Month, no generated id
};

// Camelize a header ('Lead No' → 'leadNo', 'MDF Requested' → 'mdfRequested', 'SO No' → 'soNo').
function _camel(h) {
  var parts = String(h).replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  return parts.map(function (w, i) {
    w = w.toLowerCase();
    return i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}
function _mktgMap(fields, row, rowIndex) {
  var o = { rowIndex: rowIndex };
  fields.forEach(function (h, i) { o[_camel(h)] = row[h]; });
  return o;
}

function getMarketing(p) {
  var out = {};
  var only = p && p.entity;
  Object.keys(MKTG).forEach(function (k) {
    if (only && k !== only) return;
    var cfg = MKTG[k], fields = SCHEMA[cfg.sheet];
    out[k] = _rows(cfg.sheet).map(function (r) { return _mktgMap(fields, r, r.rowIndex); });
  });
  return { success: true, data: out };
}

// Human-readable label for an activity-log summary, e.g. "Lead · Cemex".
var _MKTG_LABEL = { leads: ['Lead', 'company'], campaigns: ['Campaign', 'name'], content: ['Content', 'title'],
  enablement: ['Asset', 'name'], events: ['Event', 'name'], principal: ['Co-marketing', 'activity'], metrics: ['Metrics', 'month'] };
function _mktgMsg(entity, rec) {
  var m = _MKTG_LABEL[entity] || [entity, ''];
  var v = rec[m[1]];
  return m[0] + (v ? ' · ' + v : '');
}

function saveMarketingRecord(p) {
  var entity = p.entity, cfg = MKTG[entity];
  if (!cfg) return { success: false, message: 'Unknown marketing entity: ' + entity };
  var rec = {};
  try { rec = JSON.parse(p.record || '{}'); } catch (e) { return { success: false, message: 'Invalid record JSON.' }; }
  var sheet = cfg.sheet, fields = SCHEMA[sheet], sh = _sheet(sheet);
  var idHeader = fields[0];
  var now = _now();
  var msg = _mktgMsg(entity, rec);

  // Build a value array from the record's camelCase keys, header order.
  function valuesFrom(existing) {
    return fields.map(function (h) {
      var ck = _camel(h);
      if (h === 'Created At') return (existing && existing[h]) || now;
      if (h === 'Updated At' || h === 'Last Updated') return now;
      if (h === 'Created By' || h === 'Updated By') {
        if (rec[ck] != null && rec[ck] !== '') return rec[ck];
        if (existing && existing[h]) return existing[h];
        return p.actorName || '';
      }
      if (rec[ck] != null) return rec[ck];
      return existing ? (existing[h] || '') : '';
    });
  }

  var rows = _rows(sheet);

  // Update by rowIndex.
  if (rec.rowIndex) {
    var ri = parseInt(rec.rowIndex, 10);
    var ex = rows.filter(function (r) { return r.rowIndex === ri; })[0];
    if (!ex) return { success: false, message: 'Record not found.' };
    sh.getRange(ri, 1, 1, fields.length).setValues([valuesFrom(ex)]);
    return { success: true, entity: entity, id: ex[idHeader], rowIndex: ri, message: msg };
  }

  // Keyed entities (metrics) upsert by their key column.
  if (cfg.key) {
    var keyCamel = _camel(cfg.key), keyVal = String(rec[keyCamel] || '');
    var match = rows.filter(function (r) { return String(r[cfg.key]) === keyVal; })[0];
    if (match) {
      sh.getRange(match.rowIndex, 1, 1, fields.length).setValues([valuesFrom(match)]);
      return { success: true, entity: entity, id: keyVal, rowIndex: match.rowIndex, message: msg };
    }
    sh.appendRow(valuesFrom(null));
    return { success: true, entity: entity, id: keyVal, rowIndex: sh.getLastRow(), message: msg };
  }

  // New numbered record.
  var id = _nextNumber(sheet, 1, cfg.prefix);
  rec[_camel(idHeader)] = id;
  sh.appendRow(valuesFrom(null));
  return { success: true, entity: entity, id: id, rowIndex: sh.getLastRow(), message: msg };
}

function deleteMarketingRecord(p) {
  var cfg = MKTG[p.entity];
  if (!cfg) return { success: false, message: 'Unknown marketing entity: ' + p.entity };
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  _sheet(cfg.sheet).deleteRow(ri);
  return { success: true, entity: p.entity, message: 'Record deleted.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  SALES CALL LOG  (per rep, per day; also mirrored to the ActivityLog)
// ════════════════════════════════════════════════════════════════════════════
function getSalesCalls(p) {
  var rows = _rows('SalesCalls');
  if (p && p.date) rows = rows.filter(function (r) { return _dateStr(r['Date']) === String(p.date); });
  if (p && p.user) rows = rows.filter(function (r) { return String(r['User']) === String(p.user); });
  rows.sort(function (a, b) { return new Date(b['Created At']) - new Date(a['Created At']); });
  return { success: true, data: rows.map(function (r) {
    return {
      callNo: r['Call No'], date: _dateStr(r['Date']), user: r['User'], contact: r['Contact'],
      company: r['Company'], outcome: r['Outcome'], notes: r['Notes'], createdAt: r['Created At'],
      rowIndex: r.rowIndex
    };
  }) };
}

function logSalesCall(p) {
  var contact = String(p.contact || '').trim();
  if (!contact && !p.company) return { success: false, message: 'Contact or company is required.' };
  var no = _nextNumber('SalesCalls', 1, 'CALL');
  var date = p.date ? _dateStr(p.date) : _dateStr(_now());
  _append('SalesCalls', [no, date, p.actorName || '', contact, p.company || '', p.outcome || '',
    p.notes || '', _now()]);
  return { success: true, callNo: no, refNo: contact || p.company,
    message: 'Call · ' + (p.outcome || 'logged') + (contact ? ' — ' + contact : '') };
}

function deleteSalesCall(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  _sheet('SalesCalls').deleteRow(ri);
  return { success: true, message: 'Call removed.' };
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
  rejectPO: ['Purchase Order', 'Rejected'],
  saveMarketingRecord: ['Marketing', 'Saved'], deleteMarketingRecord: ['Marketing', 'Removed'],
  logSalesCall: ['Call', 'Logged'],
  setOpeningBalance: ['Balance Sheet', 'Updated'],
  advanceShipmentStage: ['Shipment', 'Stage Updated'], updateShipment: ['Shipment', 'Updated'],
  createPaymentRequest: ['Payment Request', 'Created'], submitPaymentRequest: ['Payment Request', 'Submitted'],
  approvePaymentRequest: ['Payment Request', 'Approved'], rejectPaymentRequest: ['Payment Request', 'Rejected'],
  savePaymentRequestPDF: ['Payment Request', 'PDF Saved'],
  importSOCostDetails: ['Sales Order', 'Cost Imported'], saveSOCostDetails: ['Sales Order', 'Cost Edited'],
  backfillMigratedRecords: ['Sales Order', 'Records Backfilled'],
  deleteMigratedRecords: ['Sales Order', 'Migrated Cleared'],
  matchSupplierTypes: ['Sales Order', 'Type Matched'],
  importPricingSubmissions: ['Pricing Request', 'Imported']
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
      clientLocation: h['Client Location'] || '', docJson: h['Doc JSON'] || '',
      legacyId: h['Legacy ID'] || '', legacyItemsJson: h['Legacy Items JSON'] || '',
      pricedItemsJson: h['Priced Items JSON'] || '',
      items: its.map(function (r) {
        return {
          line: _num(r['Line']), itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
          uom: r['UOM'], remarks: r['Remarks'], included: (r['Included'] === true || String(r['Included']) === 'true'),
          supplier: r['Supplier'], principal: r['Principal'], currency: r['Currency'] || 'PHP',
          supplierPrice: _num(r['Supplier Price (FC)']), cbm: _num(r['CBM']), finalPrice: _num(r['Final Price']),
          origItemNo: r['Orig Item No'] || '', origItemName: r['Orig Item Name'] || ''
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
  // Idempotency: a retried submission (transport bounce → the client re-POSTs) carries the same
  // clientRef — return the already-created PR instead of writing a duplicate. The ScriptProperties
  // check is authoritative (strongly consistent, immune to the Sheets read-after-write staleness that
  // caused the merging); the sheet scan is a secondary fallback.
  var crefKey = p.clientRef ? ('pr_cref_' + p.clientRef) : '';
  if (p.clientRef) {
    try {
      var prevNo = PropertiesService.getScriptProperties().getProperty(crefKey);
      if (prevNo) return { success: true, prNo: prevNo, duplicate: true,
        message: 'Purchase request submitted to admin.' };
    } catch (e) { /* fall through to the sheet scan */ }
    var dupe = _rows('PricingRequests').filter(function (h) {
      return String(h['Client Ref'] || '') === String(p.clientRef);
    })[0];
    if (dupe) return { success: true, prNo: dupe['PR No'], duplicate: true,
      message: 'Purchase request submitted to admin.' };
  }
  var no = p.prNo || _nextNumber('PricingRequests', 1, 'PR');
  _append('PricingRequests', [no, p.date || _now(), p.requestedBy || p.actorName || '', p.customer,
    '', '', '', 'Requested', '', p.notes || '', _now(), _now(), '', '', '', p.clientLocation || '',
    p.docJson || '', p.clientRef || '']);
    // trailing: Legacy ID / Legacy Items JSON / Priced Items JSON / Client Location / Doc JSON / Client Ref
  var sh = _sheet('PricingRequestItems');
  items.forEach(function (it, i) {
    sh.appendRow([no, i + 1, it.itemNo, it.itemName, _num(it.qty), it.uom || '', it.remarks || '',
      true, '', '', it.currency || 'PHP', 0, _num(it.cbm), 0, '', '']);   // trailing: Orig Item No/Name
  });
  // Record clientRef → PR No so a retried submission returns THIS number without re-writing, even if
  // the sheet write hasn't propagated to a subsequent read.
  if (crefKey) { try { PropertiesService.getScriptProperties().setProperty(crefKey, String(no)); } catch (e) {} }
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
    // col 3: Item No — admin can replace the code with the supplier's own (blank = keep original,
    // so an accidental clear never wipes it). Carries through pricing and into the quotation.
    // The client's ORIGINAL code/description is preserved once (cols 15/16, first change wins) so the
    // quotation can show "requested vs offered".
    if (u.itemNo !== undefined && String(u.itemNo).trim() !== '') {
      var newNo = String(u.itemNo).trim();
      if (String(row['Item No']) !== newNo && !String(row['Orig Item No'] || '').trim()) {
        sh.getRange(row.rowIndex, 15, 1, 1).setValues([[row['Item No']]]);
      }
      sh.getRange(row.rowIndex, 3, 1, 1).setValues([[newNo]]);
    }
    // col 4: Item Name — admin can correct the product description; it flows to the quotation.
    if (u.itemName !== undefined) {
      var newName = u.itemName || '';
      if (newName && String(row['Item Name']) !== newName && !String(row['Orig Item Name'] || '').trim()) {
        sh.getRange(row.rowIndex, 16, 1, 1).setValues([[row['Item Name']]]);
      }
      sh.getRange(row.rowIndex, 4, 1, 1).setValues([[newName]]);
    }
  });
  // Header-level Client Location (one per request) — set during sourcing when provided.
  if (p.clientLocation !== undefined) {
    var locCol = SCHEMA.PricingRequests.indexOf('Client Location') + 1;
    var hsh = _sheet('PricingRequests');
    _rows('PricingRequests').forEach(function (h) {
      if (String(h['PR No']) === String(p.prNo)) hsh.getRange(h.rowIndex, locCol, 1, 1).setValues([[p.clientLocation || '']]);
    });
  }
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
  // Ensure the appended history column has a header label (cosmetic; _rows maps by position).
  try { sh.getRange(1, 15, 1, 1).setValues([['Priced Items JSON']]); } catch (e) {}
  _rows('PricingRequests').forEach(function (h) {
    if (String(h['PR No']) === String(p.prNo)) {
      sh.getRange(h.rowIndex, 5, 1, 3).setValues([[p.destination || '', _num(p.commission), _num(p.margin)]]); // Destination, Commission %, Margin %
      if (p.pricedItemsJson) sh.getRange(h.rowIndex, 15, 1, 1).setValues([[String(p.pricedItemsJson)]]);        // full engine breakdown for history
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
    return { itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']), price: _num(r['Final Price']),
             origItemNo: r['Orig Item No'] || '', origItemName: r['Orig Item Name'] || '' };
  });
  if (!qItems.length) return { success: false, message: 'No included, priced items to quote.' };
  // New quotation starts as Draft (creator = the requesting sales user) → enters the approval workflow.
  // The sales rep types their own quotation code + subject on the form; both carry through here.
  var qres = createQuotation({ customer: hdr['Customer'], date: _now(), status: 'Draft',
    quotationNo: p.quotationNo || '', subject: p.subject || '',
    createdBy: p.actorName || hdr['Requested By'] || '', actorRole: 'sales', items: JSON.stringify(qItems) });
  if (!qres.success) return qres;
  _setPRStatus(p.prNo, 'Quoted', 'Quotation ' + qres.quotationNo);
  return { success: true, prNo: p.prNo, quotationNo: qres.quotationNo,
    message: 'Quotation ' + qres.quotationNo + ' created from ' + p.prNo + '.' };
}

function savePRPDF(p) {
  if (!p.pdfBase64) return { success: false, message: 'pdfBase64 required.' };
  // Save under "Purchase Request/<requester>/" — the requester comes from the PR record itself
  // (works for both the auto-save-on-create and the manual Generate button), falling back to
  // the acting user when the PR row isn't found.
  var requester = '';
  if (p.prNo) {
    var row = _rows('PricingRequests').filter(function (h) { return String(h['PR No']) === String(p.prNo); })[0];
    if (row) requester = String(row['Requested By'] || '');
  }
  var folder = _prUserFolder(requester || p.actorName || 'Unknown');
  var link = _saveFileToDrive(p.pdfBase64, p.fileName || ((p.prNo || 'PR') + '.pdf'), 'application/pdf', folder).url;
  if (p.prNo) _setCellByKey('PricingRequests', 'PR No', p.prNo, 'PDF Link', link);
  return { success: true, link: link, prNo: p.prNo, message: 'PR PDF saved to Drive.' };
}

// ── Action registry ──────────────────────────────────────────────────────────
var HANDLERS = {
  getVersion: getVersion,
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
  getMarketing: getMarketing, saveMarketingRecord: saveMarketingRecord, deleteMarketingRecord: deleteMarketingRecord,
  getSalesCalls: getSalesCalls, logSalesCall: logSalesCall, deleteSalesCall: deleteSalesCall,
  getReceiving: getReceiving, createReceiving: createReceiving,
  getInvoices: getInvoices, createInvoice: createInvoice,
  getChartOfAccounts: getChartOfAccounts, getJournal: getJournal, getTrialBalance: getTrialBalance,
  getOpeningBalances: getOpeningBalances, setOpeningBalance: setOpeningBalance,
  getShipments: getShipments, getShipmentTimeline: getShipmentTimeline,
  advanceShipmentStage: advanceShipmentStage, updateShipment: updateShipment,
  getPaymentRequests: getPaymentRequests, createPaymentRequest: createPaymentRequest,
  updatePaymentRequest: updatePaymentRequest, deletePaymentRequest: deletePaymentRequest,
  submitPaymentRequest: submitPaymentRequest, approvePaymentRequest: approvePaymentRequest,
  rejectPaymentRequest: rejectPaymentRequest, savePaymentRequestPDF: savePaymentRequestPDF,
  getSOCostDetails: getSOCostDetails, importSOCostDetails: importSOCostDetails, saveSOCostDetails: saveSOCostDetails,
  backfillMigratedRecords: backfillMigratedRecords, deleteMigratedRecords: deleteMigratedRecords,
  resetSequenceCounters: resetSequenceCounters,
  matchSupplierTypes: matchSupplierTypes,
  importPricingSubmissions: importPricingSubmissions,
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
  createSalesOrder: 1, updateSalesOrder: 1, deleteSalesOrder: 1, importSalesOrders: 1, matchSupplierTypes: 1,
  createPurchaseOrder: 1, updatePurchaseOrder: 1, deletePurchaseOrder: 1,
  updateAPAging: 1, recordCollection: 1, updateARAging: 1, importCollections: 1, createReceiving: 1, createInvoice: 1,
  addExpense: 1, updateExpense: 1, deleteExpense: 1, importExpenses: 1, reclassifyExpenses: 1,
  saveMarketingRecord: 1, deleteMarketingRecord: 1,
  logSalesCall: 1, deleteSalesCall: 1,
  saveQuotationPDF: 1, savePOPDF: 1, saveDailyNote: 1,
  createPricingRequest: 1, updatePRSourcing: 1, submitForPricing: 1, setMgmtPricing: 1,
  verifyReturnToSales: 1, createQuotationFromPR: 1, savePRPDF: 1,
  addDocument: 1, deleteDocument: 1,
  submitQuotationApproval: 1, approveQuotation: 1, rejectQuotation: 1, sendQuotation: 1,
  submitPOApproval: 1, approvePO: 1, rejectPO: 1,
  setOpeningBalance: 1,
  advanceShipmentStage: 1, updateShipment: 1,
  createPaymentRequest: 1, updatePaymentRequest: 1, deletePaymentRequest: 1, submitPaymentRequest: 1,
  approvePaymentRequest: 1, rejectPaymentRequest: 1, savePaymentRequestPDF: 1,
  importSOCostDetails: 1, saveSOCostDetails: 1, importPricingSubmissions: 1, backfillMigratedRecords: 1,
  deleteMigratedRecords: 1, resetSequenceCounters: 1
};
