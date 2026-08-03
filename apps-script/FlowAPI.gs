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

// Drive folder ID every saved document is filed under. A193: pinned to the company folder, so no
// setup call is needed — _rootFolder() reads this constant BEFORE the ScriptProperty. Blank would
// fall back to auto find/create "Flow Documents".
var FLOW_DRIVE_FOLDER_ID = '1aE92m5g31bx9SoUIkLrBxlLVftCEXNTM';

// Deployed-code version, surfaced by getVersion. Front-end tools whose safety depends on NEW backend
// behavior (e.g. the year-scoped deleteMigratedRecords) check this before running destructive steps.
var FLOW_VERSION = 110;  // A201 management can reject a forwarded pricing (clears the whole sourcing, returns the PR to admin for re-sourcing) · 109: A195 one document contract for the lifecycle: _DOC_RULES with a local/international split (the old receiving rule demanded 7 international documents a local purchase can never produce, with no override), gates on the four money steps, a controlled Doc Type, and a per-order checklist · 108: A194 year/month above the client, and buildDriveSkeleton gives every sales order a folder even when it has no documents yet · 107: A193 every lifecycle document files itself into Drive under <client>/<sales order>/<doc type>; client-name canonicaliser + reviewable ClientAliases registry; pre-SO documents adopted when the order appears; resumable migration for the existing files · 106: A191 per-sales-order notes on the Revenue & Net Profit report (own sheet, upsert by SO No) · 105: A190 client visits gain agenda + summary of agenda + a REQUIRED photo, and link to a Weekly Itinerary (plan approved director-first then management) · 104: A189 client visits: a face-to-face task on the sales daily report (time, person, company, city, topic), rolled up on the team report and team performance · 103: A186 sales orders record the client's own PO date AND the date we actually received it (they routinely differ by days); updateSalesOrder's value list widened in step with the schema · 102: A181 setMgmtPricing MERGES the engine breakdown instead of replacing it (re-pricing one line silently erased every other line's cost breakdown) · 101: A180 payment requests record which slice of the PO they are (50% DP · Balance · Full) + the payable snapshot; updatePaymentRequest finally caps the amount at what is owed · 100: A174 updateQuotation no longer wipes a quotation on a partial update (a layout-only save deleted every line) · 99: A172 Quote Configurator: item photos persist to Drive (Line Key), Layout JSON, reorderQuotationItems · 98: A171 procurement guards: the payable can no longer imply an impossible exchange rate or exceed what was paid; a PO's rate and peso total must agree; receiving demands the shipment documents before it costs inventory · 97: A169 Product Finder → Purchase Request hand-off (PFInquiries += Items JSON/PR No, merge-on-update) · 96: A167 shared inquiry logbook · 95: A159 inventory identity (Item ID — fixes the phantom-item picker + shared cost basis) · A158 lifecycle integrity: secured mutations · partial payments · pricing/quotation gates · void collection+invoice (93: A157 correctCollection · 92: A156 PR chain + Paid w/ proof · 91: A152 close/reopen quotation · 90: A151 lifecycle spine)

function getVersion(p) { return { success: true, version: FLOW_VERSION }; }

// ── Tab schemas (tab name → header row) ──────────────────────────────────────
var SCHEMA = {
  // Type: 'Stock' = real inventory (migrated old-system stocks, received goods, or anything that
  // reached a Purchase Order — even at 0 qty) · 'Catalog' = quotation/PR working items not yet bought.
  // A159: 'Item ID' appended — a permanent, internal identity for each item. Item numbers are NOT
  // unique (items with no manufacturer part number all normalise to 'N/A', deliberately), so anything
  // that identified an item by its number resolved to whichever row came first. The id is never shown
  // to a customer; documents still print the item number exactly as before.
  Inventory: ['Item No', 'Description', 'Available Balance', 'Purchase Price/Unit',
              'Shipping Cost/Unit', 'Landed Cost/Unit', 'Total Landed Cost', 'Currency', 'Last Updated', 'Type',
              'Item ID'],

  //    A145: 'Plant Site' + 'Client Ref No' carry PR context onto the quotation (appended at END).
  //    A151: 'PR No' links a quotation back to the pricing request it came from (populated by
  //    createQuotationFromPR; blank for direct/legacy quotations). Appended at END.
  //    A172: 'Layout JSON' holds presentation only — template, photo toggle, which optional blocks are
  //    on and their text. Deliberately NOT folded into 'PDF Data JSON', which has one job (the A123
  //    stale-document stamp); overloading it would blur the freshness signal.
  Quotations:     ['Quotation No', 'Date', 'Customer', 'Status', 'Total', 'Created By', 'Created At', 'PDF Link',
                   'Created By Role', 'Approval Note', 'Approved By', 'Approved At', 'Subject', 'Discount %',
                   'PDF Data JSON', 'Plant Site', 'Client Ref No', 'PR No', 'Layout JSON'],
  //    A145: 'Supplier VAT' carries the per-item VAT-Incl/Excl note from the pricing request.
  //    A172: 'Line Key' is a per-line id that survives reordering. Row position can't identify a line
  //    once lines move, and Item ID isn't unique when a quote carries two lines of the same product —
  //    so item photos key on this.
  QuotationItems: ['Quotation No', 'Item No', 'Item Name', 'Quoted Qty', 'Quoted Price', 'Line Total',
                   'Orig Item No', 'Orig Item Name', 'Supplier VAT', 'UOM', 'Item ID', 'Line Key'],

  // A186: 'Client PO Date' is the date printed on the customer's own PO; 'PO Received Date' is when
  // it actually reached us. They routinely differ by days, and only the second one is ours to know.
  // Appended at the END (house convention) — but see updateSalesOrder, which hard-codes its value
  // list and MUST be extended in step with this array.
  //    A193: 'Client PO No' is an OPTIONAL override. For 102 of 105 live orders the SO No *is* the
  //    client's PO number (A145 — the rep types it in), so this stays blank and the Drive folder is
  //    named from SO No alone. Fill it only when the two genuinely differ, e.g. on a system-generated
  //    SO-YYYYMM-NNN whose client PO arrived later.
  SalesOrders:     ['SO No', 'Quotation No', 'Date', 'Customer', 'Status', 'Total', 'Created By', 'Created At', 'Supplier Type', 'Client PO Date', 'PO Received Date', 'Client PO No'],
  SalesOrderItems: ['SO No', 'Item No', 'Item Name', 'Qty', 'Price/Unit', 'Total Price', 'Item ID'],

  //    A145: 'Exchange Rate' persists the FX rate used for the PHP estimate (was sent then dropped).
  PurchaseOrders:     ['PO No', 'SO No', 'Date', 'Supplier', 'Currency', 'Total Purchase (FC)', 'Status', 'Created By', 'Created At', 'PDF Link',
                       'Created By Role', 'Approval Note', 'Approved By', 'Approved At', 'Exchange Rate'],
  PurchaseOrderItems: ['PO No', 'Item No', 'Item Name', 'Qty', 'Purchase Price/Unit (FC)', 'Total (FC)', 'Item ID'],

  APAging: ['AP No', 'PO No', 'Supplier', 'Currency', 'Amount (FC)', 'Amount (PHP)', 'Status',
            'Due Date', 'Paid (PHP)', 'Notes', 'Created At', 'Updated At', 'PR No'],

  MaterialsReceiving: ['MR No', 'PO No', 'Date', 'Supplier', 'Currency', 'Customs Duties (PHP)',
                       'VAT (PHP)', 'Delivery Charges (PHP)', 'Other Charges (PHP)',
                       'Total Shipping Cost (PHP)', 'Received By', 'Created At', 'SO No'],
  ReceivingItems:     ['MR No', 'Item No', 'Item Name', 'Qty Received', 'Purchase Price/Unit (FC)',
                       'Purchase Price/Unit (PHP)', 'Shipping/Unit (PHP)', 'Landed Cost/Unit', 'Total Landed Cost',
                       'Item ID'],

  // A158: 'Voided'/'Void Reason' appended at the END — a mis-issued invoice had no reversal at all,
  // so the only fix was editing the sheet by hand. Voided rows are excluded from getInvoices by default.
  Invoices:     ['INV No', 'SO No', 'Date', 'Customer', 'Total Sales', 'Total COGS', 'Created By', 'Created At',
                 'Voided', 'Void Reason'],
  InvoiceItems: ['INV No', 'Item No', 'Item Name', 'Qty', 'Selling Price', 'Line Sales', 'Landed Cost/Unit', 'Line COGS',
                 'Item ID'],

  // ── Accounts Receivable (after Invoices: client pays the sales-order amount) + Collections ──
  ARAging:     ['AR No', 'INV No', 'SO No', 'Customer', 'Amount (PHP)', 'Collected (PHP)', 'Status',
                'Due Date', 'Notes', 'Created At', 'Updated At'],
  // A158: 'Voided'/'Void Reason' appended — correctCollection can re-split a payment but nothing could
  // reverse one entered against the wrong receivable. Voided rows drop out of the AR recompute.
  Collections: ['Collection No', 'AR No', 'INV No', 'SO No', 'Customer', 'Date', 'Amount (PHP)',
                'Method', 'Reference No', 'Notes', 'Created At', 'EWT (PHP)', 'Voided', 'Void Reason'],

  // ── Expenses ledger (OpEx / G&A / Other) — pure record, no GL journals ──
  Expenses: ['Exp No', 'Date', 'Type', 'Category', 'Voucher No', 'Client', 'Description', 'Toll',
             'Fuel', 'Meals', 'Load Balance', 'Other', 'Amount', 'Notes', 'Created By', 'Legacy Key', 'Created At'],

  // ── Phase 2: General Ledger ──
  ChartOfAccounts: ['Code', 'Name', 'Type', 'Normal Balance'],
  Journal: ['Entry No', 'Date', 'Source', 'Source No', 'Account Code', 'Account Name', 'Debit', 'Credit', 'Currency', 'Memo', 'Created At'],

  // ── Daily report: auto-logged activity + per-day notes ──
  ActivityLog: ['Timestamp', 'Date', 'User', 'Module', 'Action', 'Ref No', 'Summary', 'Amount', 'Currency'],
  DailyNotes:  ['Date', 'Notes', 'Updated By', 'Updated At'],
  /* A191: a free-text note against one sales order, written from the Revenue & Net Profit report.
     Its own sheet rather than a column on SOCostDetails, because a cost row does not exist for every
     order, saveSOCostDetails rewrites a fixed-width array (so-cost-editor would post no note and
     erase it on the next cost edit), and that handler also regenerates the order's migrated invoice
     and receiving rows — none of which should happen when someone saves a note. */
  SONotes:     ['SO No', 'Notes', 'Updated By', 'Updated At'],

  // ── A167: Product Finder shared inquiry logbook (device localStorage syncs here; upsert by Inquiry ID)
  //    A169: += 'Items JSON' (which product the rep actually chose) and 'PR No' (what it became). ──
  PFInquiries: ['Inquiry ID', 'Date', 'User', 'Source', 'Client', 'Industry', 'Raw Text',
                'Recommendation', 'Status', 'Notes', 'Updated At', 'Items JSON', 'PR No'],

  // ── Daily report SUBMISSION (one row per user per day; the frozen snapshot the user stands behind
  //    plus their narrative). Column ORDER IS FROZEN — _sheet self-migrates appended columns, but a
  //    reorder would corrupt existing rows. ──
  DailyReports: ['Report No', 'Date', 'User', 'Role', 'Status',
                 'Movements', 'Calls', 'Emails', 'Docs', 'PDFs', 'Amount',
                 'Counts JSON', 'Metrics JSON',
                 'Highlights', 'Blockers', 'Plan', 'Notes',
                 'Submitted At', 'Updated At', 'Submit Count', 'Client Ref',
                 'Reviewed By', 'Reviewed At', 'Review Note'],

  // ── Sales pricing-request flow (PR → sourcing → pricing → verify → sales → quotation) ──
  //    A144: 'Plant Site' (required delivery/plant destination captured at sourcing, distinct from the
  //    freight 'Destination'). Appended at END — positional writes elsewhere must not shift.
  PricingRequests: ['PR No', 'Date', 'Requested By', 'Customer', 'Destination', 'Commission %', 'Margin %',
                    'Status', 'PDF Link', 'Notes', 'Created At', 'Updated At', 'Legacy ID', 'Legacy Items JSON',
                    'Priced Items JSON', 'Client Location', 'Doc JSON', 'Client Ref', 'Plant Site'],
  //    A144: 'Supplier Price VAT' (Inclusive|Exclusive note — display only, no costing-math effect).
  PricingRequestItems: ['PR No', 'Line', 'Item No', 'Item Name', 'Qty', 'UOM', 'Remarks', 'Included',
                        'Supplier', 'Principal', 'Currency', 'Supplier Price (FC)', 'CBM', 'Final Price',
                        'Orig Item No', 'Orig Item Name', 'Supplier Price VAT',
                        'Item ID'],   // A159: which catalogue item this line actually is

  // ── Generic per-record document attachments (any process step) ──
  Documents: ['Doc ID', 'Module', 'Ref No', 'Doc Type', 'File Name', 'Drive Link', 'File ID',
              'Uploaded By', 'Uploaded At'],

  // ── A145 masters: prefill the fields re-typed on every payment request / purchase request ──
  Suppliers: ['Supplier', 'Bank Name', 'Account Name', 'Account Number', 'Payment Method', 'Currency',
              'TIN', 'Address', 'Notes', 'Updated By', 'Updated At'],
  // A193: the reviewed client-name registry behind the Drive folder tree. 'Raw Name' is a spelling as
  // it appears on an order; 'Canonical' groups the spellings that are one client; 'Display Name' is
  // the folder. Edit a row to correct a merge — the matcher only proposes, this decides.
  ClientAliases: ['Raw Name', 'Canonical', 'Display Name', 'Updated At'],

  Clients:   ['Customer', 'Address', 'Contact Person', 'Designation', 'Email', 'Phone', 'RFQ Ref',
              'Payment Terms', 'Notes', 'Updated By', 'Updated At'],

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
  // A189/A190: client visits — the face-to-face counterpart of a sales call. 'Time' is the time of
  // the visit as the rep reports it, which is NOT 'Created At' (a visit is usually logged after).
  // 'Agenda' is what the visit was FOR; 'Summary of Agenda' is what came out of it — two different
  // questions that a single 'Topic' field was collapsing. 'Itinerary Item' is '<Itinerary No>#<Seq>'
  // when the visit fulfils a planned stop, blank when it was unplanned.
  ClientVisits: ['Visit No', 'Date', 'User', 'Time', 'Person Visited', 'Company', 'City Address',
                 'Agenda', 'Summary of Agenda', 'Photo Doc ID', 'Itinerary Item', 'Created At'],
  // A190: the week a rep plans ahead, approved DIRECTOR FIRST then management — note that is the
  // reverse of the payment-request chain, by decision. Header + rows, like Quotations/QuotationItems.
  WeeklyItineraries: ['Itinerary No', 'Week Start', 'Week End', 'User', 'Status', 'Objectives',
                      'Notes', 'Created By', 'Created By Role', 'Created At', 'Updated At',
                      'Dir Approved By', 'Dir Approved At', 'Mgmt Approved By', 'Mgmt Approved At',
                      'Approval Note'],
  ItineraryItems: ['Itinerary No', 'Seq', 'Day', 'Date', 'Planned Time', 'Company', 'Person To Meet',
                   'City Area', 'Purpose', 'Agenda', 'Expected Outcome'],

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
                    'Mgmt Approved By', 'Mgmt Approved At', 'Approval Note', 'PDF Link', 'Created At', 'Updated At',
                    // A156: Admin is now the FIRST approval stage (Admin → Management → Director), and an
                    // approved request is then marked Paid by whoever owns that payment method, with proof.
                    // Appended at the END — 'Acct Approved *' stays, holding history for legacy rows.
                    'Admin Approved By', 'Admin Approved At', 'Paid By', 'Paid At', 'Payment Ref',
                    // A180: which slice of the PO this request is ('50% DP' · 'Balance' · 'Full' ·
                    // 'Custom'), plus the payable SNAPSHOT it was computed from — so the PRF can print
                    // total and balance without re-reading an AP row that may since have moved, and so
                    // history stays true when the payable is later corrected. No stored balance and no
                    // stored percentage: both would be a second source of truth that drifts from Amount.
                    'Payment Portion', 'PO Total (PHP)', 'PO Paid Before (PHP)'],

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
  } else if (sh.getLastColumn() > 0 && sh.getLastColumn() < headers.length) {
    // The schema grew since this tab was created (e.g. Inventory 'Type') — label the new columns.
    sh.getRange(1, sh.getLastColumn() + 1, 1, headers.length - sh.getLastColumn())
      .setValues([headers.slice(sh.getLastColumn())]).setFontWeight('bold');
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

/* A158 — actions that decide or move money. Every role check inside these used to rest on an
   `actorRole` string the browser supplied, so anyone holding this /exec URL could approve or pay
   anything. They now have to arrive through the Flask server, which validates the user's real login
   session and attaches the shared secret below.

   Enforcement is OFF until the FLOW_MUTATION_SECRET Script Property is set, so this version can be
   pasted safely before the server side is confirmed live — set the property to switch it on. */
var _SECURED = {
  approveQuotation: 1, rejectQuotation: 1, approvePO: 1, rejectPO: 1,
  approvePaymentRequest: 1, rejectPaymentRequest: 1, markPaymentRequestPaid: 1,
  setMgmtPricing: 1, rejectMgmtPricing: 1, verifyReturnToSales: 1,
  deleteQuotation: 1, deleteSalesOrder: 1, deletePurchaseOrder: 1, deletePaymentRequest: 1,
  deleteAPEntry: 1, updateAPAging: 1, recordCollection: 1, correctCollection: 1,
  voidCollection: 1, voidInvoice: 1,
  // A190 — approving an itinerary decides whose week is sanctioned, so identity must come from
  // the server, not the browser. All three secured lists have to agree; missing one re-opens the
  // actorRole spoof the A188 review flagged on createQuotation.
  approveWeeklyItinerary: 1, rejectWeeklyItinerary: 1,
  // A193 — these move hundreds of real files and rewrite the client registry, so the web endpoint
  // demands the shared secret. Running them by hand from the Apps Script editor is unaffected: that
  // path calls the function directly and never reaches _dispatch. previewDriveMigration is
  // deliberately NOT here — it is read-only and creates nothing.
  seedClientAliases: 1, runDriveMigration: 1, buildDriveSkeleton: 1,
  buildDriveSkeletonAll: 1, runDriveMigrationAll: 1, setupFlowDrive: 1,
  cleanupLegacyFolders: 1, cleanupLegacyFoldersApply: 1
};

function _securedBlocked(action, params) {
  if (!_SECURED[action]) return null;
  var want;
  try { want = PropertiesService.getScriptProperties().getProperty('FLOW_MUTATION_SECRET'); }
  catch (e) { return null; }                       // property service unavailable → don't lock anyone out
  if (!want) return null;                          // not configured yet → enforcement off (safe rollout)
  if (String(params.flowSecret || '') === String(want)) return null;
  return { success: false, message: 'This action must be performed through the app (signed in).' };
}

function _dispatch(params) {
  var action = params.action || '';
  try {
    var handler = HANDLERS[action];
    if (!handler) return _json({ success: false, message: 'Unknown action: ' + action });
    var blocked = _securedBlocked(action, params);
    if (blocked) return _json(blocked);
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
      currency: r['Currency'] || 'PHP', lastUpdated: r['Last Updated'],
      type: r['Type'] || '', rowIndex: r.rowIndex,
      itemId: r['Item ID'] || ''            // A159: what the pickers key on — never the item number
    };
  }) };
}

/* A159 — resolve an inventory item without ever guessing.

   Item numbers are not unique: every item with no manufacturer part number normalises to 'N/A'
   (92 of them live today), so the old first-match scan returned the same row for all of them —
   the wrong product on screen, and one shared cost basis underneath.

   Resolution order:
     1. Item ID          — exact and permanent, the only truly unambiguous key
     2. item number      — when exactly one row carries it (the ordinary case)
     3. number + description — rescues documents saved before ids existed, since every line
                               already stores both
     4. first match      — as before, but the row is returned with `_ambiguous` set so callers
                           can report it rather than silently costing the wrong item

   `opts` accepts { itemId, description }; passing a bare string keeps the old call signature working. */
function _findInventory(itemNo, opts) {
  var rows = _rows('Inventory');
  var o = (typeof opts === 'string') ? { description: opts } : (opts || {});

  if (o.itemId) {
    var byId = rows.filter(function (r) { return String(r['Item ID'] || '') === String(o.itemId); })[0];
    if (byId) return byId;                      // exact — nothing else to consider
  }

  var want = _normItemNo(itemNo);
  // Normalise BOTH sides: a legacy row storing a bare '-' must match a query of 'N/A', or
  // _applyInventory would append a duplicate row instead of updating the existing one.
  var byNo = rows.filter(function (r) { return _normItemNo(r['Item No']) === want; });
  if (!byNo.length) return null;
  if (byNo.length === 1) return byNo[0];

  if (o.description) {
    var d = String(o.description).trim().toLowerCase();
    var byDesc = byNo.filter(function (r) { return String(r['Description'] || '').trim().toLowerCase() === d; });
    if (byDesc.length === 1) return byDesc[0];
  }

  var first = byNo[0];
  first._ambiguous = byNo.length;               // caller decides whether to warn or refuse
  return first;
}

/** The items sharing a given (normalised) item number — used by the pickers and the duplicate report. */
function _inventoryByNumber(itemNo) {
  var want = _normItemNo(itemNo);
  return _rows('Inventory').filter(function (r) { return _normItemNo(r['Item No']) === want; });
}

/* Item ids are plain running numbers — ITM-00001 — not month-scoped like document numbers, because an
   item isn't a monthly document. Deliberately NOT routed through _nextNumber: that writes a Script
   Property per call and rescans the sheet each time, which a 361-row backfill would turn into 361
   property writes on a project already at the properties limit. */
function _highestItemIdNum(rows) {
  var max = 0;
  (rows || _rows('Inventory')).forEach(function (r) {
    var m = String(r['Item ID'] || '').match(/^ITM-(\d+)$/);
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  return max;
}
function _fmtItemId(n) { return 'ITM-' + ('00000' + n).slice(-5); }

/** Issue the next item id. Monotonic and never reused, so an id always means exactly one product. */
function _nextItemId(rows) {
  return _fmtItemId(_highestItemIdNum(rows) + 1);
}

/* A159 — give every existing item an id. Idempotent (rows that already have one are untouched) and
   written as ONE range write, so it finishes well inside the execution limit and is safe to re-run
   while people are working. */
function backfillItemIds() {
  var sh = _sheet('Inventory');
  var col = SCHEMA.Inventory.indexOf('Item ID') + 1;
  var rows = _rows('Inventory');
  if (!rows.length) return { success: true, assigned: 0, already: 0, total: 0, message: 'Inventory is empty.' };

  var n = _highestItemIdNum(rows);
  var assigned = 0, already = 0;
  var first = rows[0].rowIndex, last = rows[rows.length - 1].rowIndex;
  var col_ = sh.getRange(first, col, last - first + 1, 1).getValues();
  rows.forEach(function (r) {
    var i = r.rowIndex - first;
    if (String(col_[i][0] || '').trim()) { already++; return; }
    col_[i][0] = _fmtItemId(++n);
    assigned++;
  });
  if (assigned) sh.getRange(first, col, col_.length, 1).setValues(col_);
  return { success: true, assigned: assigned, already: already, total: rows.length,
    message: 'Assigned ' + assigned + ' item id(s); ' + already + ' already had one.' };
}

/* A159 — likely duplicate catalogue entries, grouped by description. Report only: merging moves stock
   balances and cost history, so it stays a human decision. */
function findDuplicateInventory() {
  var groups = {};
  _rows('Inventory').forEach(function (r) {
    var key = String(r['Description'] || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return;
    (groups[key] = groups[key] || []).push({
      itemId: r['Item ID'] || '', itemNo: r['Item No'], description: r['Description'],
      balance: _num(r['Available Balance']), landedCost: _num(r['Landed Cost/Unit']),
      type: r['Type'] || '', rowIndex: r.rowIndex
    });
  });
  var dups = [];
  Object.keys(groups).forEach(function (k) { if (groups[k].length > 1) dups.push({ description: groups[k][0].description, count: groups[k].length, items: groups[k] }); });
  dups.sort(function (a, b) { return b.count - a.count; });
  return { success: true, groups: dups.length,
    items: dups.reduce(function (s, g) { return s + g.count; }, 0), data: dups };
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
  // Nothing becomes real stock unless deliberate: adds default to Catalog (quotation working items).
  var type = (p.type === 'Stock') ? 'Stock' : 'Catalog';
  var itemId = _nextItemId();                      // A159: identity that doesn't depend on the number
  _append('Inventory', [itemNo, String(p.description).trim(), _num(p.balance),
    _num(p.purchasePrice), _num(p.shippingCost), c.landed, c.total, p.currency || 'PHP', _now(), type,
    itemId]);
  // A159: 'N/A' items legitimately repeat, but a repeated REAL part number is worth surfacing so the
  // catalogue doesn't quietly accumulate near-duplicates.
  var dupe = itemNo === 'N/A' && _inventoryByNumber(itemNo).length > 1;
  return { success: true, itemId: itemId, itemNo: itemNo, duplicateNumber: dupe,
    message: 'Item added.' };
}

function updateInventoryItem(p) {
  var sh = _sheet('Inventory');
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var curRow = sh.getRange(ri, 1, 1, SCHEMA.Inventory.length).getValues()[0];
  var idCol = SCHEMA.Inventory.indexOf('Item ID');
  /* A158 stale-row protection — a deleted row above shifts everything up. A159: compare the Item ID,
     because comparing the NUMBER was vacuous for the 92 items all numbered 'N/A' (every one of them
     passed the check for every other), i.e. the guard didn't protect the rows that most needed it. */
  if (p.itemId && String(curRow[idCol] || '') && String(curRow[idCol]) !== String(p.itemId)) {
    return { success: false, staleRow: true,
      message: 'This list has changed since it was loaded — refresh before saving (row ' + ri +
        ' is no longer that item).' };
  }
  if (!p.itemId && p.itemNo && _normItemNo(curRow[0]) !== _normItemNo(p.itemNo)) {
    return { success: false, staleRow: true,
      message: 'This list has changed since it was loaded — refresh before saving (row ' + ri +
        ' is no longer ' + p.itemNo + ').' };
  }
  /* A158 — the balance is a LIVE figure that receiving and issuance move by deltas. Writing the form's
     value back absolutely meant that editing a description on a screen loaded before a receiving
     silently rolled the stock back to the old number, with no journal offset. So the stored balance
     wins unless the caller explicitly says it is adjusting stock. */
  var newBalance = p.adjustBalance ? _num(p.balance) : _num(curRow[2]);
  var c = _invComputed(newBalance, p.purchasePrice, p.shippingCost);
  sh.getRange(ri, 1, 1, 9).setValues([[_normItemNo(p.itemNo),
    String(p.description).trim(), newBalance, _num(p.purchasePrice), _num(p.shippingCost),
    c.landed, c.total, p.currency || 'PHP', _now()]]);
  // Type is written only when explicitly supplied, so a plain edit never reclassifies the item.
  if (p.type === 'Stock' || p.type === 'Catalog') sh.getRange(ri, 10, 1, 1).setValues([[p.type]]);
  return { success: true, message: 'Item updated.' };
}

function deleteInventoryItem(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var sh = _sheet('Inventory');
  // A158: verify the row is still the item the caller means — deleting by position alone removes
  // whatever has since shifted into that slot.
  // A159: verify by Item ID where we have one — the item-number compare can't tell two 'N/A' rows apart.
  var dRow = sh.getRange(ri, 1, 1, SCHEMA.Inventory.length).getValues()[0];
  var dIdCol = SCHEMA.Inventory.indexOf('Item ID');
  if (p.itemId && String(dRow[dIdCol] || '') && String(dRow[dIdCol]) !== String(p.itemId)) {
    return { success: false, staleRow: true,
      message: 'This list has changed since it was loaded — refresh before deleting (row ' + ri +
        ' is no longer that item).' };
  }
  if (!p.itemId && p.itemNo && _normItemNo(dRow[0]) !== _normItemNo(p.itemNo)) {
    return { success: false, staleRow: true,
      message: 'This list has changed since it was loaded — refresh before deleting (row ' + ri +
        ' is no longer ' + p.itemNo + ').' };
  }
  sh.deleteRow(ri);
  return { success: true, message: 'Item deleted.' };
}

/** Adjust an inventory item by delta qty and (optionally) set new cost basis. Creates if missing.
 *  Goods that move through Receiving/Issuance are by definition real inventory → Type 'Stock'. */
/* A159: `itemId` (and the description as a fallback) let this land on the RIGHT row. Without them a
   receipt of any no-code item blended its cost into whichever 'N/A' row happened to be first, while
   the other 91 could never receive stock at all. */
function _applyInventory(itemNo, itemName, deltaQty, newPurchase, newShipping, currency, itemId) {
  var sh = _sheet('Inventory');
  var existing = _findInventory(itemNo, { itemId: itemId, description: itemName });
  if (existing) {
    var oldQty = _num(existing['Available Balance']);
    var addQty = _num(deltaQty);
    var balance = oldQty + addQty;
    if (balance < 0) balance = 0;
    var oldPurchase = _num(existing['Purchase Price/Unit']);
    var oldShipping = _num(existing['Shipping Cost/Unit']);
    // A145: on a receiving (positive delta with a supplied unit cost) blend the incoming cost with the
    // existing on-hand value — WEIGHTED AVERAGE — instead of overwriting (which silently revalued all
    // prior stock to the newest price). Issuance (negative/no-cost delta) preserves the running average.
    var purchase, shipping;
    if (addQty > 0 && newPurchase !== null && newPurchase !== undefined) {
      var denomP = oldQty + addQty;
      purchase = denomP > 0 ? (oldQty * oldPurchase + addQty * _num(newPurchase)) / denomP : _num(newPurchase);
    } else {
      purchase = (newPurchase === null || newPurchase === undefined) ? oldPurchase : _num(newPurchase);
    }
    if (addQty > 0 && newShipping !== null && newShipping !== undefined) {
      var denomS = oldQty + addQty;
      shipping = denomS > 0 ? (oldQty * oldShipping + addQty * _num(newShipping)) / denomS : _num(newShipping);
    } else {
      shipping = (newShipping === null || newShipping === undefined) ? oldShipping : _num(newShipping);
    }
    var c = _invComputed(balance, purchase, shipping);
    sh.getRange(existing.rowIndex, 3, 1, 7).setValues([[balance, purchase, shipping, c.landed, c.total,
      currency || existing['Currency'] || 'PHP', _now()]]);
    if (existing['Type'] !== 'Stock') sh.getRange(existing.rowIndex, 10, 1, 1).setValues([['Stock']]);
  } else {
    var bal = Math.max(0, _num(deltaQty));
    var c2 = _invComputed(bal, newPurchase, newShipping);
    _append('Inventory', [_normItemNo(itemNo), String(itemName || itemNo).trim(), bal,
      _num(newPurchase), _num(newShipping), c2.landed, c2.total, currency || 'PHP', _now(), 'Stock',
      _nextItemId()]);
  }
}

/** An item processed into a Purchase Order becomes an inventory record (0 qty or not): existing
 *  Catalog rows are promoted to Stock; unknown item codes get a Stock row at balance 0. 'N/A'
 *  placeholder codes are skipped — misc PO charges (fuel, freight lines) aren't inventory and can't
 *  be identified among the many N/A rows. */
function _ensureInventoryStock(itemNo, itemName, itemId) {
  var no = _normItemNo(itemNo);
  // A159: no-code items can now be identified, so they no longer have to be skipped wholesale — but a
  // PO line with neither an id nor a description is still just a misc charge (freight, fuel), not stock.
  if (no === 'N/A' && !itemId && !String(itemName || '').trim()) return;
  var sh = _sheet('Inventory');
  var existing = _findInventory(no, { itemId: itemId, description: itemName });
  if (existing && !existing._ambiguous) {
    if (existing['Type'] !== 'Stock') sh.getRange(existing.rowIndex, 10, 1, 1).setValues([['Stock']]);
  } else if (!existing) {
    _append('Inventory', [no, String(itemName || no).trim(), 0, 0, 0, 0, 0, 'PHP', _now(), 'Stock',
      _nextItemId()]);
  }
  // An ambiguous match is left alone deliberately: promoting a guessed row to Stock would be worse
  // than doing nothing.
}

/** Bulk import of the OLD system's stock list (Model No · Description · Qty). Idempotent upsert by
 *  Item No: existing rows get their balance set from the old system ONLY while still 0 (a live
 *  received balance is never clobbered — flagged instead) and are promoted to Stock; unknown items
 *  are appended as Stock rows carrying the old quantity. Pure record write — no journals. */
function importInventory(p) {
  var items = JSON.parse(p.items || '[]');
  if (!items.length) return { success: false, message: 'No items supplied.' };
  var sh = _sheet('Inventory');
  var created = 0, updated = 0, skippedBalance = [];
  items.forEach(function (it) {
    var no = _normItemNo(it.itemNo);
    var desc = String(it.description || no).trim();
    var qty = _num(it.qty);
    // A159: this used to carry its own private description-matching workaround for 'N/A' rows.
    // _findInventory does that now — number first, description to disambiguate — so the workaround
    // is gone and one resolver serves every caller. An ambiguous hit is treated as "not found" here
    // rather than merged into a guessed row.
    var existing = _findInventory(no, { description: desc });
    if (existing && existing._ambiguous) existing = null;
    if (existing) {
      var bal = _num(existing['Available Balance']);
      if (bal === 0) {
        var c = _invComputed(qty, existing['Purchase Price/Unit'], existing['Shipping Cost/Unit']);
        sh.getRange(existing.rowIndex, 3, 1, 7).setValues([[qty, _num(existing['Purchase Price/Unit']),
          _num(existing['Shipping Cost/Unit']), c.landed, c.total, existing['Currency'] || 'PHP', _now()]]);
      } else if (bal !== qty) {
        skippedBalance.push(no + ' (system ' + bal + ' vs old ' + qty + ')');
      }
      sh.getRange(existing.rowIndex, 10, 1, 1).setValues([['Stock']]);
      updated++;
    } else {
      _append('Inventory', [no, desc, qty, 0, 0, 0, 0, 'PHP', _now(), 'Stock', _nextItemId()]);
      created++;
    }
  });
  return { success: true, created: created, updated: updated, skippedBalance: skippedBalance,
    message: 'Inventory imported: ' + created + ' added, ' + updated + ' merged' +
      (skippedBalance.length ? ' (' + skippedBalance.length + ' balance conflicts kept as-is)' : '') + '.' };
}

/** One-time backfill: classify every un-typed inventory row — Stock when it has a balance or its
 *  Item No appears on any Purchase Order / Receiving, else Catalog. Also normalizes legacy dash-only
 *  Item Nos to 'N/A' (pickers key on rowIndex, so the rename is safe). Safe to re-run. */
function classifyInventory() {
  var sh = _sheet('Inventory');
  var rows = _rows('Inventory');
  if (!rows.length) return { success: true, stock: 0, catalog: 0, message: 'Inventory is empty.' };
  var onRecord = {};
  _rows('PurchaseOrderItems').forEach(function (r) { onRecord[String(r['Item No']).trim().toLowerCase()] = 1; });
  _rows('ReceivingItems').forEach(function (r) { onRecord[String(r['Item No']).trim().toLowerCase()] = 1; });
  var stock = 0, catalog = 0, renamed = 0;
  var types = rows.map(function (r) {
    var t = r['Type'];
    if (t !== 'Stock' && t !== 'Catalog') {
      t = (_num(r['Available Balance']) > 0 || onRecord[String(r['Item No']).trim().toLowerCase()]) ? 'Stock' : 'Catalog';
    }
    if (t === 'Stock') stock++; else catalog++;
    if (/^[-–—]+$/.test(String(r['Item No']).trim())) {
      sh.getRange(r.rowIndex, 1, 1, 1).setValues([['N/A']]);
      renamed++;
    }
    return [t];
  });
  sh.getRange(2, 10, types.length, 1).setValues(types);
  return { success: true, stock: stock, catalog: catalog, renamed: renamed,
    message: 'Classified: ' + stock + ' stock · ' + catalog + ' catalog' + (renamed ? ' · ' + renamed + ' dash codes → N/A' : '') + '.' };
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
      subject: q['Subject'] || '', discountPct: _num(q['Discount %']) || 0,
      pdfData: q['PDF Data JSON'] || '',
      plantSite: q['Plant Site'] || '', clientRefNo: q['Client Ref No'] || '', prNo: q['PR No'] || '',
      layoutJson: q['Layout JSON'] || '',
      rowIndex: q.rowIndex,
      items: its.map(function (r) { return {
        itemId: r['Item ID'] || '', itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Quoted Qty']),
        price: _num(r['Quoted Price']), lineTotal: _num(r['Line Total']),
        origItemNo: r['Orig Item No'] || '', origItemName: r['Orig Item Name'] || '',
        vat: r['Supplier VAT'] || '', uom: r['UOM'] || '', lineKey: r['Line Key'] || '' }; })
    };
  }) };
}

/* A172 — a per-line id that survives reordering, so an item photo stays attached to its line even
   after the lines move. Short enough to read in a Drive filename. */
function _lineKey() {
  return 'LK' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

/* Photos are stored as ordinary Documents rows (module Quotation, docType 'Item Photo') with the line
   key carried in the filename — `photo-<lineKey>.jpg`. This reads it back out. */
function _photoLineKey(fileName) {
  var m = String(fileName || '').match(/^photo-([A-Za-z0-9]+)\./);
  return m ? m[1] : '';
}

/* A172 — every item photo for a quotation, in ONE round trip.
   Before this, photos lived only in a JS object that was wiped on every dialog open, so they vanished
   on reload and A123's auto-refresh had to refuse to run whenever a quotation had any. */
function getQuotationPhotos(p) {
  var no = String((p && p.quotationNo) || '');
  if (!no) return { success: false, message: 'quotationNo is required.' };
  var out = [];
  _rows('Documents').forEach(function (d) {
    if (String(d['Module']) !== 'Quotation') return;
    if (String(d['Ref No']) !== no) return;
    if (String(d['Doc Type']) !== 'Item Photo') return;
    var id = String(d['File ID'] || '');
    if (!id) return;
    try {
      var blob = DriveApp.getFileById(id).getBlob();
      out.push({ docId: d['Doc ID'], lineKey: _photoLineKey(d['File Name']),
                 fileName: d['File Name'] || '', mimeType: blob.getContentType(),
                 base64: Utilities.base64Encode(blob.getBytes()) });
    } catch (e) { /* a trashed or unreadable file must not break the whole load */ }
  });
  return { success: true, data: out };
}

/* A172 — reorder a quotation's lines.
   The hazard here is the A147/A159 class: rebuilding each row field-by-field is exactly how
   'Supplier VAT' got blanked on every edit, and how 'Item ID' would go missing. So this never
   hand-writes a row. It reads the stored rows, reorders them as whole objects, and rewrites them
   column-for-column from SCHEMA — which means a column appended in future is carried automatically. */
function reorderQuotationItems(p) {
  var no = String((p && p.quotationNo) || '');
  if (!no) return { success: false, message: 'quotationNo is required.' };
  var order = p.order;
  if (typeof order === 'string') { try { order = JSON.parse(order); } catch (e) { order = null; } }
  if (!order || !order.length) return { success: false, message: 'order is required.' };

  var sh = _sheet('QuotationItems');
  var headers = SCHEMA.QuotationItems;
  var keyCol = headers.indexOf('Line Key') + 1;
  var rows = _rows('QuotationItems').filter(function (r) { return String(r['Quotation No']) === no; });
  if (!rows.length) return { success: false, message: 'No items found on ' + no + '.' };

  // Legacy rows predate line keys — mint one each, in place. Idempotent, so a re-run is a no-op.
  rows.forEach(function (r) {
    if (!r['Line Key']) {
      r['Line Key'] = _lineKey();
      sh.getRange(r.rowIndex, keyCol, 1, 1).setValues([[r['Line Key']]]);
    }
  });

  var byKey = {};
  rows.forEach(function (r) { byKey[String(r['Line Key'])] = r; });
  var ordered = [];
  order.forEach(function (k) {
    var r = byKey[String(k)];
    if (r) { ordered.push(r); delete byKey[String(k)]; }
  });
  // A key the caller didn't mention keeps its existing relative position, at the end — so a partial
  // or stale order can never drop a line.
  rows.forEach(function (r) { if (byKey[String(r['Line Key'])]) ordered.push(r); });

  var values = ordered.map(function (r) {
    return headers.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; });
  });
  rows.slice().sort(function (a, b) { return b.rowIndex - a.rowIndex; })
      .forEach(function (r) { sh.deleteRow(r.rowIndex); });
  values.forEach(function (v) { sh.appendRow(v); });

  return { success: true, quotationNo: no, count: values.length, message: 'Item order updated.' };
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
    creatorRole, '', '', '', p.subject || '', _num(p.discountPct) || 0,
    '', p.plantSite || '', p.clientRefNo || '', p.prNo || '', p.layoutJson || '']);   // trailing: PDF Data JSON / A145 Plant Site / Client Ref No / A151 PR No / A172 Layout JSON
  _writeItems('QuotationItems', 'Quotation No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.origItemNo || '', it.origItemName || '', it.vat || '', it.uom || '',
            it.itemId || '', it.lineKey || _lineKey()];   // trailing: A145 Supplier VAT, A147 UOM, A159 Item ID, A172 Line Key
  });
  _refStore('createQuotation', p.clientRef, no);
  return { success: true, quotationNo: no, message: 'Quotation created.' };
}

/** A quotation is editable only while it is the creator's to change. Once it enters approval it is
 *  what an approver reviewed, and once Approved/Sent it is what a client was quoted — so edits there
 *  must go through reviseQuotation, which reopens it to Draft and leaves an audit trail. Enforced
 *  server-side because the front-end button rule alone left an unguarded admin path. */
function _quotationEditable(status) {
  var st = String(status || 'Draft');
  return st === 'Draft' || st === 'Rejected' || st === 'Open' || st === '';
}

/* A158 — compare a from-PR quotation's line prices against the Final Prices management set on the
   pricing request. Returns { prNo, lines:[{item, was, now}] } for anything that moved, or null when
   the quotation didn't come from a PR (nothing to compare against). Matching is by item number, then
   by name, so a description edit alone doesn't read as a price change. */
function _quotationPrDeviation(q) {
  var prNo = String(q['PR No'] || '');
  if (!prNo) return null;
  var prItems = _rows('PricingRequestItems').filter(function (r) {
    return String(r['PR No']) === prNo && (r['Included'] === true || String(r['Included']) === 'true');
  });
  if (!prItems.length) return null;
  var qItems = _rows('QuotationItems').filter(function (r) {
    return String(r['Quotation No']) === String(q['Quotation No']);
  });
  var lines = [];
  qItems.forEach(function (qi) {
    var key = String(qi['Item No'] || '').trim().toLowerCase();
    var name = String(qi['Item Name'] || '').trim().toLowerCase();
    var src = prItems.filter(function (r) { return String(r['Item No'] || '').trim().toLowerCase() === key; })[0]
           || prItems.filter(function (r) { return String(r['Item Name'] || '').trim().toLowerCase() === name; })[0];
    if (!src) return;
    var was = _num(src['Final Price']), now = _num(qi['Quoted Price']);
    if (Math.abs(was - now) > 0.005) {
      lines.push({ item: String(qi['Item No'] || qi['Item Name'] || ''), was: was, now: now });
    }
  });
  return { prNo: prNo, lines: lines };
}

function updateQuotation(p) {
  var no = p.quotationNo;
  if (!no) return { success: false, message: 'quotationNo required.' };
  var cur = _quotationRow(no);
  // A172: layout is PRESENTATION, not terms — restyling the document (photos off, compact template)
  // changes nothing an approver signed or a client was quoted, so it is handled BEFORE the status gate
  // and may be saved at any status. Amounts, items and dates stay gated below, unchanged.
  var layoutOnly = p.layoutJson !== undefined;
  if (layoutOnly) _setCellByKey('Quotations', 'Quotation No', no, 'Layout JSON', p.layoutJson || '');

  /* A174 — this return MUST sit above the status gate, and it did not.
     It was nested inside the not-editable branch, so a layout-only save on a DRAFT quotation — which
     IS editable — fell straight through to the full-record rewrite below: `p.items` undefined became
     an empty array and every line was deleted, `p.customer` undefined blanked the customer.
     That destroyed 2026-415-GL-LANCETENTERPRISED six seconds after it was created. */
  if (layoutOnly && p.items === undefined && p.customer === undefined && p.date === undefined
      && p.subject === undefined && p.discountPct === undefined && p.newQuotationNo === undefined) {
    return { success: true, quotationNo: String(no), layoutOnly: true, message: 'Layout saved.' };
  }

  if (cur && !_quotationEditable(cur['Status'])) {
    return { success: false, message: 'This quotation is ' + cur['Status'] +
      ' — use Revise to reopen it for editing.' };
  }
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
      // A158: the status is NOT editable here. It used to take `p.status`, so a Draft could be POSTed
      // straight to Approved — skipping both approver tiers and the stale-PDF guard. Status changes
      // belong to the workflow actions (submit / approve / reject / revise / send / close).
      /* A174 — a field the caller did not send must be LEFT ALONE, not blanked.
         `p.customer` used to be written straight through, so a partial update (e.g. saving only the
         layout) wrote undefined over a real customer name; and `total` was recomputed from an items
         array that was empty for the same reason. Between them they emptied
         2026-415-GL-LANCETENTERPRISED. Same rule updateAPAging has followed since A171. */
      sh.getRange(rows[i].rowIndex, 1, 1, 7).setValues([[newNo, p.date || rows[i]['Date'],
        (p.customer !== undefined ? p.customer : rows[i]['Customer']), rows[i]['Status'],
        (p.items !== undefined ? total : _num(rows[i]['Total'])),
        rows[i]['Created By'], rows[i]['Created At']]]);
      break;
    }
  }
  // The subject shows on the PDF and is captured on the form — keep it in sync on edit.
  if (p.subject !== undefined) _setCellByKey('Quotations', 'Quotation No', newNo, 'Subject', p.subject);
  // Discount % (off the pre-VAT total) — persist edits so the regenerated PDF uses it.
  if (p.discountPct !== undefined) _setCellByKey('Quotations', 'Quotation No', newNo, 'Discount %', _num(p.discountPct) || 0);
  // A172: layout was already written above (before the status gate). On a RENAME it must follow the
  // new number, since _setCellByKey keys on it.
  if (p.layoutJson !== undefined && newNo !== String(no)) {
    _setCellByKey('Quotations', 'Quotation No', newNo, 'Layout JSON', p.layoutJson || '');
  }
  // Items: delete rows keyed on the OLD number, re-append keyed on the new one.
  /* A174 — only rewrite the lines when the caller actually SENT lines. _writeItems deletes before it
     appends, so treating an absent `items` as an empty array wipes the whole quotation on a partial
     update. A rename still has to re-key the stored rows, so that case reads them back from the sheet
     rather than trusting the caller. */
  if (p.items === undefined && newNo !== String(no)) {
    items = _rows('QuotationItems')
      .filter(function (r) { return String(r['Quotation No']) === String(no); })
      .map(function (r) {
        return { itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Quoted Qty']),
                 price: _num(r['Quoted Price']), origItemNo: r['Orig Item No'] || '',
                 origItemName: r['Orig Item Name'] || '', vat: r['Supplier VAT'] || '',
                 uom: r['UOM'] || '', itemId: r['Item ID'] || '', lineKey: r['Line Key'] || '' };
      });
  }
  if (p.items !== undefined || newNo !== String(no)) _writeItems('QuotationItems', 'Quotation No', no, items, function (it) {
    // A147: write all columns like createQuotation — the old 8-col write silently blanked
    // Supplier VAT (and would blank UOM) on every edit, since _writeItems delete+re-appends.
    // A172: carry the line key through, or a photo loses the line it belongs to on every edit.
    return [newNo, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.origItemNo || '', it.origItemName || '', it.vat || '', it.uom || '', it.itemId || '',
            it.lineKey || _lineKey()];
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
  /* A158: deleting had no status check at all — only the button was hidden, so an Approved or Sent
     quotation could be removed outright, taking its line items with it. A quotation that has been
     issued is a record; Close (A152) retires it without destroying the history. */
  var qrow = _quotationRow(no);
  if (!qrow) return { success: false, message: 'Quotation not found.' };
  if (!_quotationEditable(String(qrow['Status'] || ''))) {
    return { success: false, message: 'Only a Draft or Rejected quotation can be deleted (this one is ' +
      String(qrow['Status']) + '). Use Close to retire it and keep the record.' };
  }
  var so = _rows('SalesOrders').filter(function (s) { return String(s['Quotation No'] || '') === String(no); })[0];
  if (so) return { success: false, message: 'Sales order ' + so['SO No'] + ' was raised from this quotation — it cannot be deleted.' };
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
      clientPoDate: s['Client PO Date'] || '', poReceivedDate: s['PO Received Date'] || '',   // A186
      clientPoNo: s['Client PO No'] || '',                                                    // A193
      items: its.map(function (r) { return {
        itemId: r['Item ID'] || '', itemNo: String(r['Item No']), itemName: r['Item Name'], qty: _num(r['Qty']),
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
  // A145: the SO number is the client's PO number, typed by the rep. Reject a duplicate (mirrors the
  // createQuotation/createPurchaseOrder checks) so a re-submit can't mint two SOs + two shipments.
  if (p.soNo && _rows('SalesOrders').some(function (r) { return String(r['SO No']) === String(p.soNo); })) {
    return { success: false, message: 'SO No already exists — open it with Edit instead.' };
  }
  var no = p.soNo || _nextNumber('SalesOrders', 1, 'SO');
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  _append('SalesOrders', [no, p.quotationNo || '', p.date || _now(), p.customer, p.status || 'Open',
    total, p.createdBy || '', _now(), p.supplierType || '',
    p.clientPoDate || '', p.poReceivedDate || '',     // A186
    p.clientPoNo || '']);                             // A193
  _writeItems('SalesOrderItems', 'SO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.itemId || ''];   // A159 Item ID
  });
  // A151: create the SO Lifecycle (shipment) timeline for EVERY order — including back-dated ones —
  // so every SO has a single end-to-end lifecycle record (track + nudge; the auto-derived stages are
  // recomputed live on read, so an old SO simply shows its true progress).
  _flowAutoCreateShipment(no, p.customer, (items[0] && items[0].itemName) || '', p.createdBy || p.actorName || '');
  _registerClient(p.customer);   // A193 — pin the spelling before it names a folder
  _adoptSoDocs(no);              // A193 — pull the quotation/PR documents out of _Pre-Sales Order
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

// A151: create a lifecycle (Shipments) row for every Sales Order that lacks one — incl. migrated /
// back-dated SOs, which never got one. Idempotent (keyed by SO No). Auto-derived stages compute live.
function backfillShipments(p) {
  var existing = {};
  _rows('Shipments').forEach(function (r) { existing[String(r['SO No'])] = true; });
  var created = 0, skipped = 0;
  _rows('SalesOrders').forEach(function (so) {
    var soNo = String(so['SO No'] || '');
    if (!soNo || existing[soNo]) { skipped++; return; }
    _flowAutoCreateShipment(soNo, so['Customer'], '', 'Backfill (lifecycle)');
    existing[soNo] = true; created++;
  });
  return { success: true, created: created, skipped: skipped,
    message: 'Created ' + created + ' lifecycle row(s); ' + skipped + ' already present.' };
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
      // A157: some legacy rows record Amount Received as the GROSS invoice value while the receivable is
      // booked net of the customer's withholding tax. Imported verbatim that leaves the receivable looking
      // over-collected (negative Outstanding, and the AR total stops matching its own column). When the
      // excess is exactly the withholding tax, split it here — BEFORE the AR row is written — so the
      // receivable, its Collected figure and the collection all agree. The tax goes to the EWT column,
      // where the balance sheet reads it as Creditable Tax (2307).
      var colEwt = _num(c.ewt);
      if (colEwt > 0 && due > 0 && recv > due + 0.005 && Math.abs((recv - due) - colEwt) < 0.02) recv = due;
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
        // A157: some legacy rows record Amount Received as the GROSS invoice value while the receivable
        // is booked net of the customer's withholding tax. Importing that verbatim makes the receivable
        // look over-collected (negative Outstanding, and the AR total stops matching its own column).
        // When the excess is exactly the withholding tax, split it: cash is what actually arrived and the
        // tax goes to the EWT column, where the Balance Sheet reads it as Creditable Tax (2307).
        _append('Collections', [colNo, arNo, invNo, c.soNo || '', customer,
          c.dateCollected || c.date || _dateStr(_now()), recv, '', '', 'Migrated (legacy)', _now(),
          colEwt || '', '', '']);   // A147: EWT (PHP) explicit · A158 trailing: Voided / Void Reason
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
      // This value list is written into a SCHEMA.SalesOrders.length-wide range, so it must carry
      // exactly as many entries as SCHEMA.SalesOrders has columns. Adding a column there without
      // adding a value here throws on EVERY sales-order save (create would only leave it blank,
      // so the breakage shows up on edit).
      sh.getRange(r.rowIndex, 1, 1, SCHEMA.SalesOrders.length).setValues([[no, p.quotationNo || r['Quotation No'],
        p.date || r['Date'], p.customer, p.status || r['Status'], total, r['Created By'], r['Created At'],
        (p.supplierType != null ? p.supplierType : (r['Supplier Type'] || '')),
        // A186 — null means "not sent", so an edit that omits the field keeps what is stored.
        (p.clientPoDate != null ? p.clientPoDate : (r['Client PO Date'] || '')),
        (p.poReceivedDate != null ? p.poReceivedDate : (r['PO Received Date'] || '')),
        // A193 — same null-means-not-sent rule, so an edit that omits it keeps what is stored.
        (p.clientPoNo != null ? p.clientPoNo : (r['Client PO No'] || ''))]]);
    }
  });
  _writeItems('SalesOrderItems', 'SO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.itemId || ''];   // A159 Item ID
  });
  // A193: an edit is where a quotation link (or a Client PO No, which renames the folder) usually
  // appears, so re-file here too. Idempotent — a file already in place is left alone.
  _registerClient(p.customer);
  _adoptSoDocs(no);
  return { success: true, soNo: no, message: 'Sales Order updated.' };
}

function deleteSalesOrder(p) {
  var no = p.soNo;
  /* A158 — this deleted the SO and its items and nothing else, leaving the PO, AP, invoice, AR,
     cost details, lifecycle row and documents all pointing at a sales order that no longer exists. */
  var deps = [];
  if (_rows('PurchaseOrders').some(function (r) { return String(r['SO No'] || '') === String(no); })) deps.push('a purchase order');
  if (_rows('Invoices').some(function (r) { return String(r['SO No'] || '') === String(no); })) deps.push('an invoice');
  if (_rows('ARAging').some(function (r) { return String(r['SO No'] || '') === String(no); })) deps.push('a receivable');
  if (_rows('MaterialsReceiving').some(function (r) { return String(r['SO No'] || '') === String(no); })) deps.push('a receiving record');
  if (deps.length) {
    return { success: false, message: 'Sales order ' + no + ' already has ' + deps.join(', ') +
      ' — it cannot be deleted. Cancel the downstream records first if this order really is void.' };
  }
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
      exchangeRate: _num(po['Exchange Rate']),
      items: its.map(function (r) { return {
        itemId: r['Item ID'] || '', itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
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
  // A same-number duplicate PO leaves a second AP entry behind and doubles the payment request
  // built from that PO (the PRF-2026-63 incident) — reject an explicit number that already exists.
  if (p.poNo && _rows('PurchaseOrders').some(function (r) { return String(r['PO No']) === String(p.poNo); })) {
    return { success: false, message: 'PO No already exists — open it with Edit instead.' };
  }
  var no = p.poNo || _nextNumber('PurchaseOrders', 1, 'PO');
  var currency = p.currency || 'PHP';
  // A144: a foreign-currency PO with no exchange rate produces a ₱0 payable (poFxRate → 0), which then
  // pays the FC number as if it were pesos downstream. Require a PHP total on non-PHP POs.
  if (currency !== 'PHP' && !(_num(p.totalPHP) > 0)) {
    return { success: false, message: 'A ' + currency + ' purchase order needs an exchange rate so the PHP payable is set (Amount (PHP) cannot be blank).' };
  }
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });

  /* A171 — the rate and the peso total arrive as two INDEPENDENT numbers and nothing has ever checked
     that they agree. That is how a 720-USD order came to carry a ₱446,393 payable. If both are given
     they must reconcile; if only the peso total is given, its implied rate must at least be real. */
  var _poFx = _poFxProblem(currency, total, _num(p.exchangeRate), _num(p.totalPHP));
  if (_poFx && !p.confirmAmount) {
    return { success: false, needsConfirm: 'poAmount', impliedFx: _poFx.impliedFx, message: _poFx.message };
  }
  _append('PurchaseOrders', [no, p.soNo || '', p.date || _now(), p.supplier, currency, total,
    p.status || 'Draft', p.createdBy || '', _now(), '',
    p.actorRole || p.createdByRole || '', '', '', '',
    _num(p.exchangeRate) > 0 ? _num(p.exchangeRate) : (currency === 'PHP' ? 1 : '')]);   // A145: Exchange Rate
  _writeItems('PurchaseOrderItems', 'PO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.itemId || ''];   // A159 Item ID
  });
  // An item processed into a PO is inventory (0 qty or not): promote Catalog rows / create missing ones.
  items.forEach(function (it) { _ensureInventoryStock(it.itemNo, it.itemName, it.itemId); });
  // Auto-create the Accounts Payable entry. FC amount flows in; the PHP estimate (Total × exchange
  // rate, entered on the PO form) pre-fills Amount (PHP) so AP aging + the balance sheet populate.
  var apNo = _nextNumber('APAging', 1, 'AP');
  var amountPHP = _num(p.totalPHP) > 0 ? _num(p.totalPHP) : '';
  _append('APAging', [apNo, no, p.supplier, currency, total, amountPHP, 'Unpaid', '', 0, '', _now(), _now(), '']);
  // GL: Dr Purchases Clearing / Cr Accounts Payable, in PESOS.
  // A158: this used to post the FOREIGN-currency total into a peso trial balance — a USD 20,000 PO
  // debited 20,000 as if pesos, while receiving later credited Purchases Clearing with the real peso
  // amount, leaving permanent residue and an AP control account that never matched AP Aging.
  var poPHP = _poJournalPHP(total, currency, p.exchangeRate, amountPHP);
  if (poPHP > 0) {
    _postJournal('PO', no, p.date || _now(), 'PHP', [
      { account: ACC.CLEARING, debit: poPHP, memo: 'PO ' + no + ' — ' + p.supplier },
      { account: ACC.AP, credit: poPHP, memo: 'AP ' + apNo + ' — ' + p.supplier }
    ]);
  }
  _refStore('createPurchaseOrder', p.clientRef, no);
  return { success: true, poNo: no, apNo: apNo, message: 'Purchase Order created, AP entry and journal posted.' };
}

function updatePurchaseOrder(p) {
  var no = p.poNo;
  if (!no) return { success: false, message: 'poNo required.' };
  /* A158 — this had no status check, so an APPROVED PO's items and total could be rewritten with the
     approval left standing, the AP re-synced even when already paid, and the journal re-posted at the
     new total. Because the PO total is the denominator for receiving's landed cost, editing after the
     AP was seeded also silently re-scaled every future cost. */
  var poRow = _poRow(no);
  if (poRow) {
    var poSt = String(poRow['Status'] || 'Draft');
    var editableSt = (poSt === 'Draft' || poSt === 'Rejected' || poSt === 'Open' || poSt === '');
    if (!editableSt && !p.revise) {
      return { success: false, message: 'This PO is ' + poSt +
        ' — reopen it with Revise before editing, so it goes back through approval.' };
    }
    if (!editableSt && p.revise) {
      var paid = _apPaidPHP(no);
      if (paid > 0) {
        return { success: false, message: 'PO ' + no + ' already has ' + paid.toFixed(2) +
          ' paid against it — it cannot be revised. Correct the payable on AP Aging instead.' };
      }
      var received = _rows('MaterialsReceiving').filter(function (m) { return String(m['PO No'] || '') === String(no); });
      if (received.length) {
        return { success: false, message: 'PO ' + no + ' was already received on ' +
          String(received[0]['MR No']) + ' — revising it now would re-scale the landed cost of stock already on hand.' };
      }
      _setPOCells(no, { 'Status': 'Draft', 'Approved By': '', 'Approved At': '',
                        'Approval Note': 'Reopened for revision by ' + (p.actorName || 'someone') });
    }
  }
  var items = JSON.parse(p.items || '[]');
  var currency = p.currency || 'PHP';
  var total = 0;
  items.forEach(function (it) { total += _num(it.qty) * _num(it.price); });
  var sh = _sheet('PurchaseOrders');
  var poRateCol = SCHEMA.PurchaseOrders.indexOf('Exchange Rate') + 1;
  _rows('PurchaseOrders').forEach(function (r) {
    if (String(r['PO No']) === String(no)) {
      sh.getRange(r.rowIndex, 1, 1, 9).setValues([[no, p.soNo || r['SO No'],
        p.date || r['Date'], p.supplier, currency, total, p.status || r['Status'], r['Created By'], r['Created At']]]);
      if (p.exchangeRate !== undefined && _num(p.exchangeRate) > 0) {   // A145: persist the FX rate (col appended at END)
        sh.getRange(r.rowIndex, poRateCol, 1, 1).setValues([[_num(p.exchangeRate)]]);
      }
    }
  });
  _writeItems('PurchaseOrderItems', 'PO No', no, items, function (it) {
    return [no, it.itemNo, it.itemName, _num(it.qty), _num(it.price), _num(it.qty) * _num(it.price),
            it.itemId || ''];   // A159 Item ID
  });
  items.forEach(function (it) { _ensureInventoryStock(it.itemNo, it.itemName, it.itemId); });
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
  // Re-post the PO journal with the updated total, in pesos (A158 — see createPurchaseOrder).
  var upPHP = _poJournalPHP(total, currency, p.exchangeRate, _num(p.totalPHP));
  if (upPHP > 0) {
    _postJournal('PO', no, p.date || _now(), 'PHP', [
      { account: ACC.CLEARING, debit: upPHP, memo: 'PO ' + no + ' — ' + p.supplier },
      { account: ACC.AP, credit: upPHP, memo: 'PO ' + no + ' — ' + p.supplier }
    ]);
  }
  return { success: true, poNo: no, message: 'Purchase Order updated.' };
}

function deletePurchaseOrder(p) {
  var no = p.poNo;
  /* A158 — deleting used to take the AP rows with it INCLUDING paid ones (which deleteAPEntry itself
     refuses to touch), orphaning the payment requests, receivings and the stock they added. */
  var paidOnPo = _apPaidPHP(no);
  if (paidOnPo > 0) {
    return { success: false, message: 'PO ' + no + ' has ' + paidOnPo.toFixed(2) +
      ' recorded as paid — it cannot be deleted. Reverse the payment first if it was an error.' };
  }
  var mrs = _rows('MaterialsReceiving').filter(function (m) { return String(m['PO No'] || '') === String(no); });
  if (mrs.length) {
    return { success: false, message: 'Goods were received against ' + no + ' on ' +
      mrs.map(function (m) { return m['MR No']; }).join(', ') + ' — delete would orphan that stock.' };
  }
  var prs = _rows('PaymentRequests').filter(function (r) {
    return String(r['PO No'] || '') === String(no) && String(r['Status']) !== 'Rejected';
  });
  if (prs.length) {
    return { success: false, message: 'Payment request ' + prs.map(function (r) { return r['PR No']; }).join(', ') +
      ' references ' + no + ' — cancel it before deleting the PO.' };
  }
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

/* A171 — plausible peso-per-unit band for a foreign-currency payable. Deliberately wide: it exists to
   catch a digit slip or a copy-paste from another supplier's row, NOT to police the day's rate. The
   two live errors implied ₱620 and ₱1,539 per USD; every real rate in the system sits near ₱60. */
var _FX_BAND = { min: 20, max: 200 };

/** Is this AP amount impossible? Returns null when fine, else {block, message, impliedFx}.
 *  `block` is false for things that are merely worth saying out loud (the VAT ratio) — per the
 *  standing decision, VAT is warned about, never enforced. */
function _apAmountProblem(poNo, currency, amountFC, amountPHP, paidPHP) {
  var cur = String(currency || 'PHP').toUpperCase();
  var msg = [];

  // Paid more than the payable — AP-202607-005 is ₱465.77 over. The payment-request path already
  // caps this; the AP row edit did not.
  if (paidPHP > amountPHP + 0.005 && amountPHP > 0) {
    return { block: true, impliedFx: 0,
      message: 'Paid (₱' + paidPHP.toFixed(2) + ') is more than the payable (₱' + amountPHP.toFixed(2) +
               '). Correct the payable first, or reduce the paid amount.' };
  }

  if (!(amountFC > 0) || !(amountPHP > 0)) return null;
  var implied = amountPHP / amountFC;

  if (cur === 'PHP') {
    // A PHP purchase order should have a peso payable equal to its own total. RS Components is
    // 27,000 → 30,240 (×1.12) because VAT was typed onto the payable. Say so; don't block.
    if (Math.abs(implied - 1) > 0.001) {
      var pct = ((implied - 1) * 100).toFixed(1);
      return { block: false, impliedFx: implied,
        message: 'This is a PHP purchase order, but the payable is ' + pct + '% ' +
                 (implied > 1 ? 'above' : 'below') + ' the order total' +
                 (Math.abs(implied - 1.12) < 0.005 ? ' — that looks like 12% VAT added by hand.' : '.') };
    }
    return null;
  }

  // Foreign currency: an implied rate outside the band is a typo, not a rate.
  if (implied < _FX_BAND.min || implied > _FX_BAND.max) {
    return { block: true, impliedFx: implied,
      message: '₱' + amountPHP.toFixed(2) + ' for ' + amountFC.toFixed(2) + ' ' + cur +
               ' implies ₱' + implied.toFixed(2) + ' per ' + cur + '. That is outside any real rate' +
               ' (₱' + _FX_BAND.min + '–₱' + _FX_BAND.max + ') — check for a mistyped digit or a' +
               ' figure copied from another payable.' };
  }
  return null;
}

/** A171 — a PO's peso total and its exchange rate must tell the same story. Returns null when fine. */
function _poFxProblem(currency, totalFC, rate, totalPHP) {
  var cur = String(currency || 'PHP').toUpperCase();
  if (cur === 'PHP' || !(totalFC > 0) || !(totalPHP > 0)) return null;
  var implied = totalPHP / totalFC;

  // Both supplied → they must reconcile. 2% tolerance absorbs rounding and bank spread.
  if (rate > 0 && Math.abs(implied - rate) / rate > 0.02) {
    return { impliedFx: implied,
      message: 'The PHP total (₱' + totalPHP.toFixed(2) + ') works out to ₱' + implied.toFixed(2) +
               ' per ' + cur + ', but the exchange rate entered is ₱' + rate.toFixed(2) +
               '. Correct whichever is wrong before saving.' };
  }
  // Only the peso total supplied → its implied rate must at least be plausible.
  if (implied < _FX_BAND.min || implied > _FX_BAND.max) {
    return { impliedFx: implied,
      message: '₱' + totalPHP.toFixed(2) + ' for ' + totalFC.toFixed(2) + ' ' + cur + ' implies ₱' +
               implied.toFixed(2) + ' per ' + cur + ' — outside any real rate (₱' + _FX_BAND.min +
               '–₱' + _FX_BAND.max + '). Check for a mistyped digit.' };
  }
  return null;
}

function updateAPAging(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var sh = _sheet('APAging');
  var headers = SCHEMA.APAging;
  var cur = sh.getRange(ri, 1, 1, headers.length).getValues()[0];
  /* A158 — a row number alone is not a safe key. Reads are cached for 60s, so if another user deletes
     an AP row (or a PO, which deletes its AP rows) every row below shifts up and a Save from a stale
     screen lands on a DIFFERENT supplier's payable — amount, status and the payment journal with it.
     The client now sends the AP No it thinks it is editing; if the row disagrees, refuse. */
  if (p.apNo && String(cur[headers.indexOf('AP No')] || '') !== String(p.apNo)) {
    return { success: false, staleRow: true,
      message: 'This list has changed since it was loaded — refresh before saving (row ' + ri +
        ' is no longer ' + p.apNo + ').' };
  }
  function set(col, val) { if (val !== undefined && val !== null && val !== '') cur[col] = val; }
  // Text fields must be CLEARABLE — write whenever supplied, including '' (matches updateARAging).
  function setText(col, val) { if (val !== undefined && val !== null) cur[col] = val; }
  set(5, p.amountPHP !== undefined ? _num(p.amountPHP) : undefined); // Amount (PHP)
  set(6, p.status);                                                  // Status
  setText(7, p.dueDate);                                             // Due Date (clearable)
  set(8, p.paidPHP !== undefined ? _num(p.paidPHP) : undefined);     // Paid (PHP)
  setText(9, p.notes);                                               // Notes (clearable)
  // A145: once the row is marked Paid with an actual Paid (PHP), the ACTUAL disbursed pesos become the
  // payable so downstream (payment request amount, receiving landed cost) use the real figure, not the
  // stale PO-time estimate. (The AP form always sends Amount (PHP), so this is the effective reconcile.)
  if (String(cur[6]).toLowerCase() === 'paid' && _num(cur[8]) > 0) {
    cur[5] = _num(cur[8]);
  }

  /* A171 — the payable is the number that becomes landed cost, COGS and gross profit, and until now
     this function accepted it as a bare number with no idea what the PO was. That is how a 202-USD
     order came to be recorded at ₱310,895 and a 720-USD order at ₱446,393. Check it against the PO. */
  var _apGuard = _apAmountProblem(cur[1], cur[3], _num(cur[4]), _num(cur[5]), _num(cur[8]));
  if (_apGuard && _apGuard.block && !p.confirmAmount) {
    return { success: false, needsConfirm: 'apAmount', impliedFx: _apGuard.impliedFx,
             message: _apGuard.message };
  }

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

/** Delete a single AP Aging entry outright — for stale duplicates left behind when a PO was
 *  re-created or its sheet row hand-deleted (the PRF-2026-63 incident). Refuses when any payment
 *  has been recorded (delete the payment history first) and cleans the entry's payment journal. */
function deleteAPEntry(p) {
  var r = _rows('APAging').filter(function (x) { return String(x['AP No']) === String(p.apNo); })[0];
  if (!r) return { success: false, message: 'AP entry not found.' };
  if (_num(r['Paid (PHP)']) > 0) return { success: false, message: 'This AP entry has recorded payments — it cannot be deleted.' };
  _removeJournal('APPAY', r['AP No']);
  _sheet('APAging').deleteRow(r.rowIndex);
  return { success: true, apNo: p.apNo, message: 'AP entry ' + p.apNo + ' deleted.' };
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
  // A158: voided collections drop out by default — they are reversed money, not received money.
  if (!(p && p.includeVoided)) rows = rows.filter(function (r) { return String(r['Voided'] || '') !== 'true'; });
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
  /* A158 — correctCollection has always refused to leave a receivable over-collected; recording a
     collection did not, so more than the amount due could be booked in the first place and only get
     flagged afterwards. Overridable, because a genuine overpayment does happen. */
  if (!p.confirmOver) {
    var already = _rows('Collections').filter(function (r) {
      return String(r['AR No']) === String(p.arNo) && String(r['Voided'] || '') !== 'true';
    }).reduce(function (s, r) { return s + _num(r['Amount (PHP)']); }, 0);
    var due = _num(ar['Amount (PHP)']);
    if (due > 0 && already + amount > due + 0.005) {
      return { success: false, needsConfirm: 'overCollect', due: due, already: already,
        message: 'That would collect ' + (already + amount).toFixed(2) + ' against ' + p.arNo +
          ', which is due ' + due.toFixed(2) + (already > 0 ? ' (already collected ' + already.toFixed(2) + ')' : '') +
          '. Record it anyway?' };
    }
  }
  /* A195 — money in without the official receipt on file is exactly the record that goes missing.
     Checked after the over-collection guard so a genuine overpayment is still reported first. */
  var _colGaps = _docGaps(String(ar['SO No'] || ''), 'collect');
  if (_colGaps.length && !p.confirmNoDocs) {
    return { success: false, missingDocs: _colGaps,
      message: 'Before recording this collection, attach: ' + _colGaps.join('; ') +
               '. (Docs → the matching type on the shipment.)' };
  }

  var dup = _refSeen('recordCollection', p.clientRef);
  if (dup) return { success: true, collectionNo: dup, arNo: p.arNo, duplicate: true,
    status: String(ar['Status'] || ''), message: 'Collection ' + dup + ' recorded.' };
  var colNo = _nextNumber('Collections', 1, 'COL');
  _append('Collections', [colNo, p.arNo, ar['INV No'], ar['SO No'], ar['Customer'], p.date || _dateStr(_now()),
    amount, p.method || '', p.ref || '', p.notes || '', _now(), ewt,
    '', '']);   // A158 trailing: Voided / Void Reason
  var rec = _arRecomputeFromCollections(p.arNo, ar);
  _refStore('recordCollection', p.clientRef, colNo);
  return { success: true, collectionNo: colNo, arNo: p.arNo, collected: rec.collected, status: rec.status,
    message: 'Collection ' + colNo + ' recorded.' };
}

/* A157: the single recompute for a receivable — collected, EWT and status all derive from the sum of its
   collections, and the settlement journal is re-posted (ARCOLL is idempotent per source, so it replaces
   the prior lines rather than stacking). Shared by recordCollection and correctCollection so a correction
   can never fall out of step with a fresh collection. */
function _arRecomputeFromCollections(arNo, arRow) {
  var ar = arRow || _arRow(arNo);
  if (!ar) return { collected: 0, ewt: 0, status: 'Unpaid' };
  // A158: a voided collection is history, not money — it must not count toward what was collected.
  var colRows = _rows('Collections').filter(function (r) {
    return String(r['AR No']) === String(arNo) && String(r['Voided'] || '') !== 'true';
  });
  var collected = colRows.reduce(function (s, r) { return s + _num(r['Amount (PHP)']); }, 0);
  var ewtTotal = colRows.reduce(function (s, r) { return s + _num(r['EWT (PHP)']); }, 0);
  var amt = _num(ar['Amount (PHP)']);
  var status = collected <= 0 ? 'Unpaid' : (collected >= amt ? 'Paid' : 'Partial');
  _setCellByKey('ARAging', 'AR No', arNo, 'Collected (PHP)', collected);
  _setCellByKey('ARAging', 'AR No', arNo, 'Status', status);
  _setCellByKey('ARAging', 'AR No', arNo, 'Updated At', _now());
  // GL: receivable settled by cash + creditable tax — Dr Cash (net) / Dr Creditable Tax (EWT) / Cr A/R (gross).
  var lines = [{ account: ACC.CASH, debit: collected - ewtTotal, memo: 'Collection of ' + arNo }];
  if (ewtTotal > 0) lines.push({ account: ACC.CWT, debit: ewtTotal, memo: 'EWT 2307 — ' + arNo });
  lines.push({ account: ACC.AR, credit: collected, memo: 'Collection of ' + arNo });
  _postJournal('ARCOLL', arNo, _now(), 'PHP', lines);
  return { collected: collected, ewt: ewtTotal, status: status };
}

/* A157: re-split an already-recorded collection between cash and creditable withholding tax.
   The migrated legacy collections were imported at the GROSS invoice value with EWT left at 0, so a
   receivable booked net of withholding looked over-collected (its Outstanding went negative and the
   headline total stopped matching the column). Nothing is written off here — the tax simply moves to the
   Creditable Withholding Tax (2307) asset, where it belonged. */
function correctCollection(p) {
  if (!p.collectionNo) return { success: false, message: 'collectionNo required.' };
  var rows = _rows('Collections');
  var col = rows.filter(function (r) { return String(r['Collection No']) === String(p.collectionNo); })[0];
  if (!col) return { success: false, message: 'Collection ' + p.collectionNo + ' not found.' };

  var amount = p.amount !== undefined ? _num(p.amount) : _num(col['Amount (PHP)']);
  var ewt = p.ewt !== undefined ? _num(p.ewt) : _num(col['EWT (PHP)']);
  if (amount <= 0) return { success: false, message: 'Collection amount must be greater than zero.' };
  if (ewt < 0) return { success: false, message: 'EWT cannot be negative.' };
  if (ewt > amount) return { success: false, message: 'EWT cannot exceed the collection amount.' };

  var arNo = String(col['AR No'] || '');
  var ar = _arRow(arNo);
  if (!ar) return { success: false, message: 'Parent AR entry not found for ' + p.collectionNo + '.' };

  // Guard: the corrected split must not leave the receivable over-collected again.
  var others = rows.filter(function (r) {
    return String(r['AR No']) === arNo && String(r['Collection No']) !== String(p.collectionNo);
  }).reduce(function (s, r) { return s + _num(r['Amount (PHP)']); }, 0);
  var amt = _num(ar['Amount (PHP)']);
  if (amt > 0 && others + amount > amt + 0.005) {
    return { success: false, message: 'That would collect ' + (others + amount).toFixed(2) +
      ' against an amount due of ' + amt.toFixed(2) + ' — check the split before applying.' };
  }

  _setCellByKey('Collections', 'Collection No', p.collectionNo, 'Amount (PHP)', amount);
  _setCellByKey('Collections', 'Collection No', p.collectionNo, 'EWT (PHP)', ewt);
  if (p.notes !== undefined) _setCellByKey('Collections', 'Collection No', p.collectionNo, 'Notes', p.notes);

  var rec = _arRecomputeFromCollections(arNo, ar);
  return { success: true, collectionNo: p.collectionNo, arNo: arNo, amount: amount, ewt: ewt,
    collected: rec.collected, outstanding: amt - rec.collected, status: rec.status,
    message: 'Collection ' + p.collectionNo + ' corrected — cash ' + amount.toFixed(2) +
             ', EWT ' + ewt.toFixed(2) + '; ' + arNo + ' is now ' + rec.status + '.' };
}

/* A158 — reverse a collection recorded in error (wrong receivable, wrong amount, duplicate entry).
   Nothing could do this before: correctCollection can re-split a payment between cash and withholding
   tax, but not un-record one, so the only remedy was editing the sheet by hand. The row is marked
   rather than deleted, so the correction is auditable, and the parent AR + its journal are recomputed. */
function voidCollection(p) {
  if (!p.collectionNo) return { success: false, message: 'collectionNo required.' };
  var col = _rows('Collections').filter(function (r) {
    return String(r['Collection No']) === String(p.collectionNo);
  })[0];
  if (!col) return { success: false, message: 'Collection ' + p.collectionNo + ' not found.' };
  if (String(col['Voided'] || '') === 'true') return { success: false, message: 'This collection is already voided.' };
  if (!p.reason) return { success: false, message: 'A reason is required to void a collection.' };

  _setCellByKey('Collections', 'Collection No', p.collectionNo, 'Voided', 'true');
  _setCellByKey('Collections', 'Collection No', p.collectionNo, 'Void Reason',
    String(p.reason) + ' — voided by ' + (p.actorName || 'unknown') + ' on ' + _dateStr(_now()));

  var arNo = String(col['AR No'] || '');
  var rec = arNo ? _arRecomputeFromCollections(arNo, null) : { collected: 0, status: '' };
  return { success: true, collectionNo: p.collectionNo, arNo: arNo, collected: rec.collected, status: rec.status,
    message: 'Collection ' + p.collectionNo + ' voided' + (arNo ? '; ' + arNo + ' is now ' + rec.status + '.' : '.') };
}

/* A158 — reverse an invoice issued in error. Refused once any money has been collected against it,
   because that payment has to be dealt with first. Restores the stock it deducted, removes the
   receivable it raised, and clears its journal so the GL doesn't keep the sale. */
function voidInvoice(p) {
  if (!p.invNo) return { success: false, message: 'invNo required.' };
  var inv = _rows('Invoices').filter(function (v) { return String(v['INV No']) === String(p.invNo); })[0];
  if (!inv) return { success: false, message: 'Invoice ' + p.invNo + ' not found.' };
  if (String(inv['Voided'] || '') === 'true') return { success: false, message: 'This invoice is already voided.' };
  if (!p.reason) return { success: false, message: 'A reason is required to void an invoice.' };

  var ars = _rows('ARAging').filter(function (a) { return String(a['INV No']) === String(p.invNo); });
  var collected = 0;
  ars.forEach(function (a) {
    collected += _rows('Collections').filter(function (c) {
      return String(c['AR No']) === String(a['AR No']) && String(c['Voided'] || '') !== 'true';
    }).reduce(function (s, c) { return s + _num(c['Amount (PHP)']); }, 0);
  });
  if (collected > 0) {
    return { success: false, message: 'This invoice already has ' + collected.toFixed(2) +
      ' collected against it — void or reassign those collections first.' };
  }

  // Put the stock back exactly as it was taken out.
  _rows('InvoiceItems').filter(function (it) { return String(it['INV No']) === String(p.invNo); })
    .forEach(function (it) {
      _applyInventory(_normItemNo(it['Item No']), it['Item Name'], _num(it['Qty']), null, null, null,
        it['Item ID']);
    });

  var arSh = _sheet('ARAging');
  ars.sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (a) {
    _removeJournal('ARCOLL', a['AR No']);
    arSh.deleteRow(a.rowIndex);
  });
  _removeJournal('INV', p.invNo);
  _setCellByKey('Invoices', 'INV No', p.invNo, 'Voided', 'true');
  _setCellByKey('Invoices', 'INV No', p.invNo, 'Void Reason',
    String(p.reason) + ' — voided by ' + (p.actorName || 'unknown') + ' on ' + _dateStr(_now()));

  return { success: true, invNo: p.invNo, arRemoved: ars.length,
    message: 'Invoice ' + p.invNo + ' voided — stock restored, receivable removed and the journal cleared.' };
}

function updateARAging(p) {
  if (!p.arNo) return { success: false, message: 'arNo required.' };
  if (!_arRow(p.arNo)) return { success: false, message: 'AR entry not found.' };
  if (p.dueDate !== undefined) _setCellByKey('ARAging', 'AR No', p.arNo, 'Due Date', p.dueDate);
  if (p.notes !== undefined) _setCellByKey('ARAging', 'AR No', p.arNo, 'Notes', p.notes);
  /* A158 — once a receivable has collections its status is DERIVED from them
     (_arRecomputeFromCollections). Letting it be hand-set meant an unpaid receivable could be marked
     "Paid" and disappear into the collapsed history with the money never received. A receivable with
     no collections yet can still be annotated by hand. */
  if (p.status !== undefined && p.status) {
    var hasCols = _rows('Collections').some(function (c) {
      return String(c['AR No']) === String(p.arNo) && String(c['Voided'] || '') !== 'true';
    });
    if (hasCols) {
      return { success: false, message: 'This receivable has recorded collections, so its status follows them. ' +
        'Record or void a collection to change it.' };
    }
    _setCellByKey('ARAging', 'AR No', p.arNo, 'Status', p.status);
  }
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
        itemId: r['Item ID'] || '', itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty Received']),
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

// ════════════════════════════════════════════════════════════════════════════
//  A195 · THE DOCUMENT CONTRACT — what each step of the lifecycle must produce
//
//  ONE table. Before this there were three overlapping vocabularies (shipment stage keys like
//  'tt_sent', titles like 'Supplier Quotation', and free text), five gates with their type strings
//  hardcoded inline, and a per-stage `docLabel` in stage-meta.js that declared the expected document
//  but was display-only. Everything now reads from here.
//
//  `applies` is the important column. The old _RECEIVING_REQUIRED_DOCS demanded seven documents that
//  are ALL international — bank debit memo, FAN/SAD/TAN, forwarder's final invoice, customs, local
//  charges. A local purchase can never produce them, and p.confirmNoDocs was never sent by any
//  client, so there was no way out. It had not fired only because _receivingDocGaps looked the
//  shipment up by Shipments['PO No'], which is blank on every live row — the rule could not bind.
//  Fixing that lookup without this split would have frozen every local receiving.
// ════════════════════════════════════════════════════════════════════════════

/* Rules bind records created from here on. Every one of the 105 sales orders that predates this is
   advisory: its gaps are reported, never enforced. Most carry no documents at all, so enforcing
   retroactively would refuse their next invoice or collection. */
var _DOC_RULES_FROM = '2026-08-01';

/* stage   — the shipment stage key this belongs to, or a pseudo-stage for non-shipment steps.
   module  — where the document attaches (Documents.Module).
   type    — the canonical Doc Type. Existing free-text values reach it through _docTypeKey().
   applies — 'both' | 'local' | 'intl'.
   gate    — the money step it blocks: 'pay' | 'receive' | 'invoice' | 'collect'. null = advisory. */
var _DOC_RULES = [
  // ── Before the sales order ────────────────────────────────────────────────
  { stage: 'sourcing',   module: 'Pricing Request', type: 'supplier quotation',
    label: 'Supplier Quotation',                 applies: 'both',  gate: null },

  // ── The sales order itself ────────────────────────────────────────────────
  { stage: 'so_received', module: 'Sales Order',   type: 'client po',
    label: "The client's Purchase Order",        applies: 'both',  gate: null },

  // ── Purchase order to the supplier ────────────────────────────────────────
  { stage: 'po_created',  module: 'Purchase Order', type: 'supplier quotation',
    label: 'Supplier Quotation',                 applies: 'both',  gate: null },
  { stage: 'proforma_received', module: 'Shipment', type: 'proforma_received',
    label: 'Proforma Invoice or Order Confirmation', applies: 'intl', gate: 'pay' },

  // ── Paying the supplier ───────────────────────────────────────────────────
  { stage: 'tt_sent',     module: 'Shipment',      type: 'tt_sent',
    label: 'TT form / bank remittance slip',     applies: 'intl',  gate: 'pay' },
  { stage: 'payment',     module: 'Payment Request', type: 'proof of payment',
    label: 'Proof of payment',                   applies: 'both',  gate: null },

  // ── International shipping ────────────────────────────────────────────────
  { stage: 'shipping_docs_received', module: 'Shipment', type: 'shipping_docs_received',
    label: 'Packing list and commercial invoice', applies: 'intl', gate: 'receive' },
  { stage: 'customs_clearance', module: 'Shipment', type: 'customs_clearance',
    label: 'Customs / duties assessment',        applies: 'intl',  gate: 'receive' },
  { stage: 'fan_sad_tan', module: 'Shipment',      type: 'fan_sad_tan',
    label: 'FAN, SAD or TAN document',           applies: 'intl',  gate: 'receive' },
  { stage: 'debit_memo',  module: 'Shipment',      type: 'debit_memo',
    label: 'Bank debit memo',                    applies: 'intl',  gate: 'receive' },
  { stage: 'forwarder_final_invoice', module: 'Shipment', type: 'forwarder_final_invoice',
    label: "Forwarder's final invoice",          applies: 'intl',  gate: 'receive' },
  { stage: 'local_charges', module: 'Shipment',   type: 'local_charges',
    label: 'Local-charges document',             applies: 'intl',  gate: 'receive' },

  // ── Goods reach our office ────────────────────────────────────────────────
  { stage: 'delivered',   module: 'Shipment',      type: 'delivered',
    label: 'Delivery receipt (goods received at our office)', applies: 'both', gate: 'receive' },
  /* The local counterpart of the whole international document set: for a local purchase the supplier
     invoice IS the shipping paperwork. Two real documents instead of seven impossible ones. */
  { stage: 'delivered',   module: 'Shipment',      type: 'supplier sales invoice',
    label: "Supplier's sales invoice",           applies: 'local', gate: 'receive' },

  // ── Out to the customer ───────────────────────────────────────────────────
  { stage: 'delivered_client', module: 'Shipment', type: 'delivered_client',
    label: 'Signed delivery receipt (customer copy)', applies: 'both', gate: 'invoice' },

  // ── Collection ────────────────────────────────────────────────────────────
  { stage: 'collected',   module: 'Shipment',      type: 'collected',
    label: 'Official receipt / proof of collection', applies: 'both', gate: 'collect' }
];

/* Doc Type is free text and 71 of 234 live rows are blank, so a rule that demanded an exact string
   would ignore documents that are already attached. Everything is compared through this. */
var _DOC_TYPE_ALIASES = {
  'client purchase order': 'client po', 'client so': 'client po',
  'client po (stamped)': 'client po', 'stamped client po': 'client po',
  'so_received': 'client po',
  'supplier invoice': 'supplier sales invoice', 'sales invoice': 'supplier sales invoice',
  'supplier sales invoice': 'supplier sales invoice',
  'official receipt': 'collected', 'collection receipt': 'collected',
  'or': 'collected', 'proof of collection': 'collected',
  'delivery receipt': 'delivered', 'dr': 'delivered',
  'packing list': 'shipping_docs_received', 'commercial invoice': 'shipping_docs_received',
  'proforma': 'proforma_received', 'proforma invoice': 'proforma_received',
  'tt': 'tt_sent', 'telegraphic transfer': 'tt_sent', 'bank remittance': 'tt_sent',
  'signed delivery receipt': 'delivered_client', 'customer delivery receipt': 'delivered_client'
};

function _docTypeKey(s) {
  var t = String(s || '').trim().toLowerCase();
  t = t.replace(/\s*\(superseded\)\s*$/, '');
  t = t.replace(/\s+/g, ' ');
  return _DOC_TYPE_ALIASES[t] || t;
}

/** International or local? From the SO's own label, falling back to the cost record's COGS Type —
 *  which is the value that actually drives the money (_setSoSupplierType syncs the label from it).
 *  '' when unclassified: 13 live orders are, and guessing would block them. */
function _soSupplierKind(soNo) {
  var so = _rows('SalesOrders').filter(function (r) { return String(r['SO No']) === String(soNo); })[0];
  var t = so ? String(so['Supplier Type'] || '').trim().toLowerCase() : '';
  if (t === 'international') return 'intl';
  if (t === 'local') return 'local';
  try {
    var cd = _rows('SOCostDetails').filter(function (r) { return String(r['SO No']) === String(soNo); })[0];
    var c = cd ? String(cd['COGS Type'] || '').trim().toLowerCase() : '';
    if (c === 'international') return 'intl';
    if (c === 'local') return 'local';
  } catch (e) {}
  return '';
}

/** Is this sales order old enough to be exempt? Rules bind new records only. */
function _soPredatesRules(soNo) {
  var so = _rows('SalesOrders').filter(function (r) { return String(r['SO No']) === String(soNo); })[0];
  if (!so) return true;                                    // unknown order → never block
  var created = _dateStr(so['Created At'] || so['Date'] || '');
  if (!created) return true;
  return created < _DOC_RULES_FROM;
}

/** The rules that apply to one order: the supplier kind filters them, and an unclassified order
 *  gets only the 'both' rules (never the local- or intl-specific ones). */
function _rulesFor(soNo, gate) {
  var kind = _soSupplierKind(soNo);
  return _DOC_RULES.filter(function (r) {
    if (gate && r.gate !== gate) return false;
    if (r.applies === 'both') return true;
    return kind ? r.applies === kind : false;
  });
}

/** Every canonical doc-type key present anywhere on this sales order's lifecycle chain. */
function _soDocTypesPresent(soNo) {
  var refs = {};
  try {
    _soDocChain(soNo).forEach(function (x) { refs[String(x[0]) + '|' + String(x[1])] = true; });
  } catch (e) {}
  var have = {};
  _rows('Documents').forEach(function (d) {
    if (_isGeneratedDoc(d)) return;                        // a record's own PDF is not evidence
    if (!refs[String(d['Module']) + '|' + String(d['Ref No'])]) return;
    have[_docTypeKey(d['Doc Type'])] = true;
  });
  return have;
}

/** Which required documents are missing on this sales order for a given money step?
 *  Returns [] when it may proceed. Reports EVERY gap at once — a round trip per missing file would
 *  be its own burden. Never throws: filing must not be able to break a save. */
function _docGaps(soNo, gate) {
  try {
    if (!soNo) return [];
    if (_soPredatesRules(soNo)) return [];                 // advisory only for the existing book
    var have = _soDocTypesPresent(soNo);
    return _rulesFor(soNo, gate)
      .filter(function (r) { return !have[_docTypeKey(r.type)]; })
      .map(function (r) { return r.label; });
  } catch (e) { return []; }
}

/** Read-only. The document contract for one sales order: what it needs, what it has, what is
 *  missing, and whether the gaps are binding or merely advisory. Drives the checklist. */
function getSODocCompliance(p) {
  if (!p || !p.soNo) return { success: false, message: 'soNo required.' };
  var soNo = String(p.soNo);
  var kind = _soSupplierKind(soNo);
  var advisory = _soPredatesRules(soNo);
  var have = _soDocTypesPresent(soNo);
  var rules = _rulesFor(soNo, null).map(function (r) {
    var present = !!have[_docTypeKey(r.type)];
    return { stage: r.stage, module: r.module, type: r.type, label: r.label,
      applies: r.applies, gate: r.gate || '', present: present,
      blocking: !present && !!r.gate && !advisory };
  });
  var missing = rules.filter(function (r) { return !r.present; });
  return { success: true, soNo: soNo,
    supplierKind: kind || 'unclassified', advisoryOnly: advisory, rulesFrom: _DOC_RULES_FROM,
    total: rules.length, present: rules.length - missing.length, missing: missing.length,
    blocking: rules.filter(function (r) { return r.blocking; }).length,
    complete: missing.length === 0, items: rules };
}

/** Read-only. Every sales order's completeness, for back-filling the existing book. */
function getDocComplianceReport(p) {
  p = p || {};
  var onlyGaps = !(p.all === true || String(p.all) === 'true');
  var out = [];
  _rows('SalesOrders').forEach(function (s) {
    var soNo = String(s['SO No'] || '');
    if (!soNo) return;
    var r = getSODocCompliance({ soNo: soNo });
    if (onlyGaps && r.complete) return;
    out.push({ soNo: soNo, customer: s['Customer'], date: _dateStr(s['Date']),
      supplierKind: r.supplierKind, advisoryOnly: r.advisoryOnly,
      present: r.present, total: r.total, missing: r.missing, blocking: r.blocking,
      missingLabels: r.items.filter(function (i) { return !i.present; }).map(function (i) { return i.label; }) });
  });
  out.sort(function (a, b) { return b.missing - a.missing; });
  return { success: true, count: out.length, rulesFrom: _DOC_RULES_FROM, orders: out };
}

/** Read-only. The rule table itself, so the client's Doc Type selector is built from the SAME list
 *  the server gates on and the two can never drift. */
function getDocRules(p) {
  return { success: true, rulesFrom: _DOC_RULES_FROM, rules: _DOC_RULES.map(function (r) {
    return { stage: r.stage, module: r.module, type: r.type, label: r.label,
      applies: r.applies, gate: r.gate || '' };
  }) };
}

/** Receiving still takes a PO number. Resolve its sales order, then apply the contract.
 *  A194/A195: this used to look the shipment up by Shipments['PO No'] — a column nothing ever
 *  writes, blank on all 12 live rows — so the rule silently never bound. It goes through the PO's
 *  SO No instead, which is populated. */
function _receivingDocGaps(poNo) {
  var po = _rows('PurchaseOrders').filter(function (r) { return String(r['PO No']) === String(poNo); })[0];
  var soNo = po ? String(po['SO No'] || '') : '';
  if (!soNo) return [];                                    // a rule can't bind a record with no order
  return _docGaps(soNo, 'receive');
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

  /* A171 — receiving is where free-typed pesos (duties, VAT, delivery, other) become inventory cost
     and then COGS, and until now it required NO supporting document at all — the only money step in
     the chain that didn't. Every other one (PR forward, PO submit, payment submit, mark-paid) has
     demanded evidence for a while. Blocking here, rather than at the stage tick, is deliberate: the
     shipment board stays free to show where the goods actually are. */
  var _rcGaps = p.poNo ? _receivingDocGaps(p.poNo) : [];
  if (_rcGaps.length && !p.confirmNoDocs) {
    return { success: false, missingDocs: _rcGaps,
      message: 'Before receiving ' + p.poNo + ' into inventory, attach: ' + _rcGaps.join('; ') +
               '. (Docs → the matching type on the shipment.)' };
  }

  // A145: receiving costs inventory from AP Paid (PHP). If nothing is paid yet, every unit lands at ₱0 —
  // a silent zero cost basis that then books COGS 0 on the invoice. Refuse unless explicitly confirmed.
  if (p.poNo && !(paidPHP > 0) && !p.confirmUnpaid) {
    return { success: false, unpaid: true,
      message: 'No AP payment recorded for ' + p.poNo + ' yet — receiving now would set a ₱0 landed cost. Record the payment in AP Aging first, or confirm to proceed with a ₱0 cost basis.' };
  }
  /* A158 — the same trap one step along: a PARTIAL payment costs every unit at that fraction. A 30%
     deposit books the goods at 30% of their true cost, the invoice then books COGS at 30%, and the
     gross margin reads ~70 points too high. Only the exactly-zero case warned before. */
  if (p.poNo && paidPHP > 0 && !p.confirmPartialPay) {
    var apAmt = _rows('APAging').filter(function (a) { return String(a['PO No'] || '') === String(p.poNo); })
      .reduce(function (s, a) { return s + _num(a['Amount (PHP)']); }, 0);
    if (apAmt > 0 && paidPHP < apAmt - 0.005) {
      var pct = (paidPHP / apAmt) * 100;
      return { success: false, partialPay: true, paidPHP: paidPHP, payablePHP: apAmt,
        message: 'Only ' + pct.toFixed(0) + '% of ' + p.poNo + ' is paid (' + paidPHP.toFixed(2) + ' of ' +
          apAmt.toFixed(2) + '), so the goods would be costed at ' + pct.toFixed(0) +
          '% of their true value and the margin would read high. Record the balance first, or confirm to proceed.' };
    }
  }
  /* A158 — receiving the same PO twice added the full quantity again at full cost: doubled stock, a
     second Dr Inventory against one PO credit, and no way to reverse it (there is no deleteReceiving). */
  if (p.poNo && !p.additional) {
    var prior = _rows('MaterialsReceiving').filter(function (m) { return String(m['PO No'] || '') === String(p.poNo); });
    if (prior.length) {
      return { success: false, alreadyReceived: true, priorMrNo: String(prior[0]['MR No'] || ''),
        message: p.poNo + ' was already received on ' + String(prior[0]['MR No'] || '') +
          '. Confirm only if this is a genuine additional/partial delivery — otherwise the stock and its cost are counted twice.' };
    }
  }

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
    sh.appendRow([no, it.itemNo, it.itemName, qty, unitPriceFC, purchasePHP, shipPerUnit, landed, landed * qty,
                  it.itemId || '']);   // A159 Item ID
    // Final inventory cost = landed (PHP); add the received quantity.
    // A145: normalize the key so N/A-ish codes hit the same row _ensureInventoryStock/_findInventory use.
    // A159: itemId (description as fallback) — without it every no-code receipt blended into one row.
    _applyInventory(_normItemNo(it.itemNo), it.itemName, qty, purchasePHP, shipPerUnit, 'PHP', it.itemId);
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
function getInvoices(p) {
  var items = _rows('InvoiceItems');
  // A158: a voided invoice is a reversed one — excluded unless explicitly asked for, so revenue,
  // COGS and every report built on them stop counting a sale that was undone.
  var invRows = _rows('Invoices').filter(function (v) {
    return (p && p.includeVoided) || String(v['Voided'] || '') !== 'true';
  });
  return { success: true, data: invRows.map(function (v) {
    var its = items.filter(function (r) { return String(r['INV No']) === String(v['INV No']); });
    return {
      invNo: String(v['INV No']), soNo: String(v['SO No']), date: v['Date'], customer: v['Customer'],
      totalSales: _num(v['Total Sales']), totalCOGS: _num(v['Total COGS']), createdBy: v['Created By'],
      createdAt: v['Created At'], rowIndex: v.rowIndex,
      voided: String(v['Voided'] || '') === 'true', voidReason: v['Void Reason'] || '',
      items: its.map(function (r) { return {
        itemId: r['Item ID'] || '', itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
        sellingPrice: _num(r['Selling Price']), lineSales: _num(r['Line Sales']),
        landedCost: _num(r['Landed Cost/Unit']), lineCOGS: _num(r['Line COGS']) }; })
    };
  }) };
}

// A146: the client's stored payment terms (for auto-setting the AR due date).
function _clientTerms(customer) {
  if (!customer) return '';
  var c = _rows('Clients').filter(function (r) {
    return String(r['Customer']).toLowerCase() === String(customer).toLowerCase(); })[0];
  return c ? String(c['Payment Terms'] || '') : '';
}
// A146: invoice date + N days, where N is the first integer in the terms ("30 days"/"Net 30" → 30).
// Blank / no number / "COD" / unparseable → '' (leaves the due date blank, exactly today's behaviour).
function _addTermDays(date, terms) {
  var m = String(terms || '').match(/\d+/);
  var n = m ? parseInt(m[0], 10) : 0;
  if (!(n > 0)) return '';
  var d = (date instanceof Date) ? new Date(date.getTime()) : new Date(date);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + n);
  return d;
}

function createInvoice(p) {
  var items = JSON.parse(p.items || '[]');
  if (!p.customer) return { success: false, message: 'Customer is required.' };
  if (!items.length) return { success: false, message: 'At least one item is required.' };
  var dup = _refSeen('createInvoice', p.clientRef);
  if (dup) return { success: true, invNo: dup, duplicate: true, message: 'Invoice issued; AR entry created, inventory deducted and journal posted.' };

  /* A195 — we cannot bill for goods with no signed proof the customer received them. Reports every
     gap at once and, like the other money gates, names where to attach. */
  var _invGaps = _docGaps(p.soNo, 'invoice');
  if (_invGaps.length && !p.confirmNoDocs) {
    return { success: false, missingDocs: _invGaps,
      message: 'Before invoicing ' + p.soNo + ', attach: ' + _invGaps.join('; ') +
               '. (Docs → the matching type on the shipment.)' };
  }

  /* A158 — issuing more than is on hand booked full COGS while _applyInventory clamped the balance at
     zero, so the shortfall simply disappeared and the Inventory ledger and sheet diverged for good. */
  if (!p.confirmShort) {
    var short = [];
    items.forEach(function (it) {
      var inv = _findInventory(_normItemNo(it.itemNo), { itemId: it.itemId, description: it.itemName });
      var have = inv ? _num(inv['Available Balance']) : 0;
      var want = _num(it.qty);
      if (want > have + 0.0001) short.push({ item: String(it.itemNo || it.itemName || ''), have: have, want: want });
    });
    if (short.length) {
      return { success: false, needsConfirm: 'shortStock', shortLines: short,
        message: short.map(function (s) { return s.item + ': issuing ' + s.want + ' with ' + s.have + ' on hand'; }).join('; ') +
          '. Stock will go to zero and the shortfall will not be tracked — confirm to issue anyway.' };
    }
  }

  /* A158 — an SO invoiced twice creates a second full AR row, so the customer appears to owe it twice. */
  if (p.soNo && !p.confirmReinvoice) {
    var prior = _rows('Invoices').filter(function (v) {
      return String(v['SO No'] || '') === String(p.soNo) && String(v['Voided'] || '') !== 'true';
    });
    if (prior.length) {
      var priorTotal = prior.reduce(function (s, v) { return s + _num(v['Total Sales']); }, 0);
      return { success: false, needsConfirm: 'alreadyInvoiced', priorInvoices: prior.length, priorTotal: priorTotal,
        message: p.soNo + ' already has ' + prior.length + ' invoice(s) totalling ' + priorTotal.toFixed(2) +
          ' (' + prior.map(function (v) { return v['INV No']; }).join(', ') + '). Issue another?' };
    }
  }

  var no = p.invNo || _nextNumber('Invoices', 1, 'INV');
  var totalSales = 0, totalCOGS = 0, zeroCogsLines = 0, ambiguousLines = 0;
  var sh = _sheet('InvoiceItems');
  var lines = items.map(function (it) {
    // A159: resolve by id (then description) so each product costs from ITS OWN landed cost.
    var inv = _findInventory(_normItemNo(it.itemNo), { itemId: it.itemId, description: it.itemName });
    if (inv && inv._ambiguous) ambiguousLines++;
    var landed = inv ? _num(inv['Landed Cost/Unit']) : 0;
    var qty = _num(it.qty), price = _num(it.price);
    var lineSales = qty * price, lineCOGS = qty * landed;
    if (qty > 0 && !(landed > 0)) zeroCogsLines++;   // A145: line issued with no cost basis → COGS 0
    totalSales += lineSales; totalCOGS += lineCOGS;
    return [no, it.itemNo, it.itemName, qty, price, lineSales, landed, lineCOGS,
            (inv && inv['Item ID']) || it.itemId || ''];   // A159: the id we actually costed from
  });
  _append('Invoices', [no, p.soNo || '', p.date || _now(), p.customer, totalSales, totalCOGS, p.createdBy || '', _now(),
    '', '']);   // A158 trailing: Voided / Void Reason
  items.forEach(function (it, i) {
    sh.appendRow(lines[i]);
    _applyInventory(_normItemNo(it.itemNo), it.itemName, -_num(it.qty), null, null, null, it.itemId); // deduct stock
  });
  // GL entry 1: Dr Accounts Receivable / Cr Sales.  Entry 2: Dr COGS / Cr Inventory.
  _postJournal('INV', no, p.date || _now(), 'PHP', [
    { account: ACC.AR, debit: totalSales, memo: 'Invoice ' + no + ' — ' + p.customer },
    { account: ACC.SALES, credit: totalSales, memo: 'Sales ' + no },
    { account: ACC.COGS, debit: totalCOGS, memo: 'COGS ' + no },
    { account: ACC.INV, credit: totalCOGS, memo: 'Inventory issued ' + no }
  ]);
  // Auto-create the Accounts Receivable entry (client owes the invoiced sales amount, in PHP).
  // A146: set the AR Due Date = invoice date + the client's payment terms (from the Client master),
  // so accounting doesn't hand-type it. Blank/unparseable terms → blank due date (today's behaviour).
  var arDue = _addTermDays(p.date || _now(), _clientTerms(p.customer));
  var arNo = _nextNumber('ARAging', 1, 'AR');
  _append('ARAging', [arNo, no, p.soNo || '', p.customer, totalSales, 0, 'Unpaid', arDue, '', _now(), _now()]);
  _refStore('createInvoice', p.clientRef, no);
  return { success: true, invNo: no, arNo: arNo, zeroCogsLines: zeroCogsLines,
    ambiguousLines: ambiguousLines,
    message: 'Invoice issued; AR entry created, inventory deducted and journal posted.' +
      (zeroCogsLines > 0 ? ' ⚠ ' + zeroCogsLines + ' line(s) had no landed cost (COGS 0).' : '') +
      // A159: say so rather than quietly costing from whichever row happened to match first.
      (ambiguousLines > 0 ? ' ⚠ ' + ambiguousLines + ' line(s) matched more than one catalogue item — ' +
        'their cost was taken from the first match. Re-pick the item to record it exactly.' : '') };
}

// A151: create an AR row for every Invoice that has none (migrated backfill invoices never got one).
// Reconciles any existing Collections already pointing at the INV/SO into the collected total + status.
// Idempotent (keyed on INV No). Feeds the new ar_open / collected lifecycle stages.
function backfillMissingAR(p) {
  var hasAR = {};
  _rows('ARAging').forEach(function (r) { if (r['INV No'] != null && r['INV No'] !== '') hasAR[String(r['INV No'])] = true; });
  var created = 0, skipped = 0;
  _rows('Invoices').forEach(function (v) {
    var invNo = String(v['INV No'] || '');
    if (!invNo || hasAR[invNo]) { skipped++; return; }
    var amt = _num(v['Total Sales']);
    var recv = 0;
    _rows('Collections').forEach(function (c) {
      // Credit a collection to THIS invoice only by its INV No. The SO-No fallback is used solely for
      // collections that carry no invoice ref, so a payment on invoice A on a multi-invoice SO is never
      // also credited to invoice B (every recordCollection row carries both INV No and SO No).
      var byInv = String(c['INV No']) === invNo;
      var bySo = !c['INV No'] && v['SO No'] && String(c['SO No']) === String(v['SO No']);
      if (byInv || bySo) recv += _num(c['Amount (PHP)']);
    });
    var status = recv <= 0 ? 'Unpaid' : (recv >= amt && amt > 0 ? 'Paid' : 'Partial');
    var due = _addTermDays(v['Date'], _clientTerms(v['Customer']));
    _append('ARAging', [_nextNumber('ARAging', 1, 'AR'), invNo, v['SO No'] || '', v['Customer'],
      amt, recv, status, due, 'Backfilled (missing AR)', _now(), _now()]);
    hasAR[invNo] = true; created++;
  });
  return { success: true, created: created, skipped: skipped,
    message: 'Created ' + created + ' AR row(s); ' + skipped + ' already present.' };
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
  'debit_memo', 'forwarder_final_invoice', 'local_charges', 'delivered',
  /* A195: 'delivered' is delivery to OUR office. The handover to the customer had no stage at all,
     so the signed delivery receipt — the proof we may invoice — had nowhere to live. Stage state is
     a JSON map keyed by name, so inserting here disturbs no existing record. */
  'delivered_client',
  // A151: downstream lifecycle spine — the sales/receivables close after inbound delivery.
  'invoiced', 'ar_open', 'collected'];

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
    /* A158 — the PRF stages used to be derived from the AP row, which createPurchaseOrder creates
       automatically: "payment request created" lit up the instant a PO existed, before anyone had
       raised one, and prf_approved was never derived at all. Read the actual requests instead. */
    var prsForPo = _rows('PaymentRequests').filter(function (r) {
      return poNos[String(r['PO No'])] && String(r['Status']) !== 'Rejected';
    });
    if (prsForPo.length) d.prf_created = true;
    if (prsForPo.some(function (r) { return ['Approved', 'Paid'].indexOf(String(r['Status'])) !== -1; })) d.prf_approved = true;
    if (prsForPo.some(function (r) { return String(r['Status']) === 'Paid'; }) ||
        aps.some(function (a) { return _num(a['Paid (PHP)']) > 0; })) d.tt_sent = true;
    var mrs = _rows('MaterialsReceiving').filter(function (r) { return poNos[String(r['PO No'])]; });
    if (mrs.length) d.delivered = true;
  }
  // A151: downstream stages join on soNo DIRECTLY (not nested under the PO block), so a migrated SO with
  // an invoice/AR but no PO still derives them. invoiced = any Invoice for the SO; ar_open = any AR row;
  // collected = AR rows exist AND every one is Paid.
  var invs = _rows('Invoices').filter(function (r) { return String(r['SO No']) === String(soNo); });
  if (invs.length) d.invoiced = true;
  var ars = _rows('ARAging').filter(function (r) { return String(r['SO No']) === String(soNo); });
  if (ars.length) {
    d.ar_open = true;
    if (ars.every(function (a) { return String(a['Status']) === 'Paid'; })) d.collected = true;
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
    updatedAt: r['Updated At'],
    // A156: admin is the first approval stage, and Paid closes the request out.
    adminApprovedBy: r['Admin Approved By'] || '', adminApprovedAt: r['Admin Approved At'] || '',
    paidBy: r['Paid By'] || '', paidAt: r['Paid At'] || '', paymentRef: r['Payment Ref'] || '',
    // A180: '' on every pre-A180 row and on every Type 'Other' payable, which is exactly what the
    // list cell and the PDF caption gate on — an old PRF can never grow a portion line.
    paymentPortion: r['Payment Portion'] || '',
    poTotal: _num(r['PO Total (PHP)']), poPaidBefore: _num(r['PO Paid Before (PHP)']),
    rowIndex: r.rowIndex
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
  // A145: idempotent create — a retried submission (network bounce) carrying the same clientRef returns
  // the already-created PR instead of minting a second one (the only leg-create that lacked this guard).
  var dupPr = _refSeen('createPaymentRequest', p.clientRef);
  if (dupPr) return { success: true, prNo: dupPr, type: type, duplicate: true, message: 'Payment Request ' + dupPr + ' created (Draft).' };
  var no = p.prNo || _nextNumber('PaymentRequests', 1, 'PR');
  if (_prRow(no)) return { success: false, message: 'Payment Request ' + no + ' already exists.' };
  var supplier = p.supplier || '', currency = p.currency || 'PHP', amount = _num(p.amount),
      poNo = p.poNo || '', soNo = p.soNo || '';
  // A180: blank for a Type 'Other' payable — it has no PO, so no denominator and no portion.
  var portion = '', poTotalSnap = '', poPaidSnap = '';
  if (type === 'PO') {
    if (!poNo) return { success: false, message: 'A purchase order is required for a PO payment request.' };
    var po = _rows('PurchaseOrders').filter(function (r) { return String(r['PO No']) === String(poNo); })[0];
    if (po) { supplier = supplier || po['Supplier']; currency = 'PHP'; soNo = soNo || po['SO No']; }
    // A144 duplicate-AP hard stop: _poPayablePHP SUMS Amount (PHP) across all AP rows for the PO, so a
    // stale second AP row doubles the amount (the PRF-2026-63 incident). Refuse until it is resolved.
    var apAmountRows = _rows('APAging').filter(function (r) {
      return String(r['PO No']) === String(poNo) && _num(r['Amount (PHP)']) > 0;
    }).length;
    if (apAmountRows > 1) {
      return { success: false, message: 'This PO has ' + apAmountRows + ' AP entries with an amount — the payable would be their sum. Remove the stale duplicate in AP Aging before creating the payment request.' };
    }
    // A158: a PO is usually paid in full, but deposits happen — so a second request is allowed while
    // what it may ask for is capped at what is genuinely still owed (payable − paid − other open
    // requests). Without this, the natural deposit/balance flow defaults to paying the PO twice.
    var rem = _poRemainingPayable(poNo, '');
    if (amount <= 0) amount = rem ? Math.max(0, rem.remaining) : _poPayablePHP(poNo);
    if (rem && amount > rem.remaining + 0.005) {
      return { success: false, message: 'That exceeds what is still owed on ' + poNo + ': payable ' +
        rem.amount.toFixed(2) + ' less paid ' + rem.paid.toFixed(2) +
        (rem.openRequests > 0 ? ' less open requests ' + rem.openRequests.toFixed(2) : '') +
        ' = ' + rem.remaining.toFixed(2) + ' remaining.' };
    }
    if (amount <= 0) return { success: false, message: 'Nothing is outstanding on ' + poNo + ' — it is already fully paid or requested.' };
    // A180: snapshot the payable this portion was computed against, and record which slice it is.
    // The amount is NOT recomputed from the portion — it stays hand-editable, so the portion is
    // validated against it and downgraded to 'Custom' on a mismatch instead of overwriting money.
    poTotalSnap = rem ? rem.amount : _poPayablePHP(poNo);
    poPaidSnap = rem ? rem.paid : 0;
    portion = _prCoherentPortion(p.paymentPortion, amount, rem);
  } else {
    if (!p.payee) return { success: false, message: 'Payee is required.' };
    if (amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };
  }
  _append('PaymentRequests', [no, type, poNo, soNo, supplier, p.payee || supplier, currency, amount,
    p.purpose || '', p.department || '', p.bankName || '', p.accountName || '', p.accountNumber || '',
    p.paymentMethod || '', p.dueDate || '', p.remarks || '', 'Draft', p.createdBy || p.actorName || '',
    p.actorRole || p.createdByRole || '', '', '', '', '', '', '', '', '', _now(), _now(),
    '', '', '', '', '',                          // A156 trailing: Admin Approved By/At · Paid By/At · Payment Ref
    portion, poTotalSnap, poPaidSnap]);          // A180 trailing: portion + payable snapshot (37 values)
  if (type === 'PO') _linkPrToAp(poNo, no);   // connect the PR to this PO's AP Aging entry
  _refStore('createPaymentRequest', p.clientRef, no);   // A145: remember for idempotent retry
  return { success: true, prNo: no, type: type, amount: amount, message: 'Payment Request ' + no + ' created (Draft).' };
}

/* A180: keep the stored portion label from ever contradicting the stored amount — the PDF prints that
   label, so a drift would make the document state something untrue. The amount is authoritative (it
   stays hand-editable by design), so a label that does not match what the amount actually is gets
   DOWNGRADED to 'Custom' rather than rejected: refusing the save would mean a support call every time
   AP Aging is a peso out, while 'Custom' is honest and still prints the total and balance. */
var _PR_PORTIONS = ['50% DP', 'Balance', 'Full', 'Custom'];

function _prPortionAmount(portion, rem) {
  if (!rem) return null;
  if (portion === '50% DP') return Math.round(rem.amount * 50) / 100;
  if (portion === 'Full') return Math.round(rem.amount * 100) / 100;
  // The residual, never amount/2 — else a DP + Balance pair on an odd payable oversubscribes by a
  // centavo and the second request is refused by the +0.005 cap above.
  if (portion === 'Balance') return Math.round(Math.max(0, rem.remaining) * 100) / 100;
  return null;
}

function _prCoherentPortion(raw, amount, rem) {
  var s = String(raw || '').trim();
  if (_PR_PORTIONS.indexOf(s) === -1) return '';   // absent or unknown → record nothing
  if (!rem) return 'Custom';                        // no payable to measure against
  var want = _prPortionAmount(s, rem);
  if (want === null) return s;                      // 'Custom' passes through unchanged
  return Math.abs(_num(amount) - want) > 0.01 ? 'Custom' : s;
}

/* A payment request is a money instrument: once it is submitted or approved, silently rewriting the
   amount / payee / bank account would let an approved payment be redirected with nobody re-checking
   it. So editing is confined to Draft/Rejected, and the only way back into an in-flight or approved
   request is revisePaymentRequest below, which clears every approval first. */
function _prEditable(status) {
  var s = String(status || 'Draft');
  return s === 'Draft' || s === 'Rejected' || s === '';
}

function updatePaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  if (!_prEditable(r['Status'])) {
    return { success: false, message: 'This payment request is ' + r['Status'] + ' — use Revise to reopen it for editing.' };
  }
  var fields = { 'Supplier': p.supplier, 'Payee': p.payee, 'Currency': p.currency, 'Purpose': p.purpose,
    'Department': p.department, 'Bank Name': p.bankName, 'Account Name': p.accountName,
    'Account Number': p.accountNumber, 'Payment Method': p.paymentMethod, 'Due Date': p.dueDate, 'Remarks': p.remarks,
    // A180: the portion is accepted from the client but normalised below. 'PO Total (PHP)' and
    // 'PO Paid Before (PHP)' deliberately are NOT here — they are computed server-side, never taken
    // from the browser, or a caller could make the printed balance say anything it liked.
    'Payment Portion': p.paymentPortion };
  var set = {};
  Object.keys(fields).forEach(function (k) { if (fields[k] !== undefined) set[k] = fields[k]; });
  /* A180: A158 put the remaining-payable cap on CREATE only, so this path has been accepting any
     amount at all — including 0 and including more than the PO owes. Close both holes.
     _poRemainingPayable must exclude THIS record: its own open amount is part of the claimed total,
     so without the exclusion every edit — even lowering the amount — is refused and a revised
     request can never be corrected. */
  if (String(r['Type']) === 'PO' && p.amount !== undefined) {
    var amt = _num(p.amount);
    if (amt <= 0) return { success: false, message: 'Amount must be greater than zero.' };
    var rem = _poRemainingPayable(r['PO No'], p.prNo);
    if (rem && amt > rem.remaining + 0.005) {
      return { success: false, message: 'That exceeds what is still owed on ' + r['PO No'] + ': payable ' +
        rem.amount.toFixed(2) + ' less paid ' + rem.paid.toFixed(2) +
        (rem.openRequests > 0 ? ' less other open requests ' + rem.openRequests.toFixed(2) : '') +
        ' = ' + rem.remaining.toFixed(2) + ' remaining.' };
    }
    set['Amount'] = amt;
    set['Payment Portion'] = _prCoherentPortion(p.paymentPortion, amt, rem);
    set['PO Total (PHP)'] = rem ? rem.amount : _poPayablePHP(r['PO No']);
    set['PO Paid Before (PHP)'] = rem ? rem.paid : 0;
  } else if (p.amount !== undefined) {
    set['Amount'] = _num(p.amount);
  }
  _prSet(p.prNo, set);
  return { success: true, prNo: p.prNo, message: 'Payment Request updated.' };
}

function deletePaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  /* A158 — this deleted at ANY status, including Paid: the AP row kept its Paid amount and Paid status
     with no request behind it, and the proof-of-payment document was orphaned. The UI only hid the
     button, which a stale render or a direct call walks straight past. */
  var prSt = String(r['Status'] || 'Draft');
  if (!_prEditable(prSt)) {
    return { success: false, message: 'Only a Draft or Rejected payment request can be deleted (this one is ' +
      prSt + '). Use Revise to reopen it, or Reject to stop it.' };
  }
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
  // A144: a payment request must carry a supporting document before it moves to approval.
  // A158: the record's OWN generated PDF doesn't count — clicking "PDF" then "Submit" used to satisfy
  // this gate with no supplier invoice or proforma ever attached.
  var hasDoc = _rows('Documents').some(function (d) {
    return String(d['Module']) === 'Payment Request' && String(d['Ref No']) === String(p.prNo)
      && !_isGeneratedDoc(d);
  });
  if (!hasDoc) return { success: false, message: 'Attach a supporting document (the supplier invoice / proforma) before submitting — the request\'s own generated PDF does not count.' };
  /* A195 — the untyped check above says "something is attached"; this says WHICH. For an
     international order that means the proforma and the TT slip; a local one is asked for neither. */
  var _paySo = String(r['SO No'] || '');
  if (!_paySo && r['PO No']) {
    var _payPo = _rows('PurchaseOrders').filter(function (x) {
      return String(x['PO No']) === String(r['PO No']);
    })[0];
    _paySo = _payPo ? String(_payPo['SO No'] || '') : '';
  }
  var _payGaps = _docGaps(_paySo, 'pay');
  if (_payGaps.length && !p.confirmNoDocs) {
    return { success: false, missingDocs: _payGaps,
      message: 'Before submitting this payment, attach: ' + _payGaps.join('; ') +
               '. (Docs → the matching type on the shipment.)' };
  }
  // A156: one chain for both types — Admin → Management → Director.
  // Admin also CREATES most requests, so requiring a second admin would deadlock whenever only one is
  // on duty. When an admin created it their creation IS the admin sign-off and it starts at management;
  // when accounting created it a real admin must still approve, which is where the check has meaning.
  var patch = { 'Approval Note': '' }, next;
  if (String(r['Created By Role']) === 'admin') {
    next = 'Pending Management';
    patch['Admin Approved By'] = String(r['Created By'] || '') + ' (creator)';
    patch['Admin Approved At'] = _now();
  } else {
    next = 'Pending Admin';
  }
  patch['Status'] = next;
  _prSet(p.prNo, patch);
  return { success: true, prNo: p.prNo, status: next, message: 'Submitted for approval (' + next + ').' };
}

/* Reopen a submitted/approved payment request for correction. Every approval tick is cleared, so the
   revised request must travel the whole approval chain again before anyone can pay it. */
function revisePaymentRequest(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status'] || 'Draft');
  if (_prEditable(st)) {
    return { success: false, message: 'This payment request is ' + st + ' — it is already editable.' };
  }
  // A156: money has already left on a Paid request and the payable is settled — silently reopening it
  // would drop the payment stamp while the AP row stays paid. Correcting a wrong payment is a
  // deliberate accounting entry, not a reopen.
  if (st === 'Paid') {
    return { success: false, message: 'This payment request is already Paid — record a correction on AP Aging instead of reopening it.' };
  }
  var note = 'Reopened for revision by ' + (p.actorName || 'a user') + (p.reason ? ' — ' + p.reason : '');
  _prSet(p.prNo, {
    'Status': 'Draft',
    'Acct Approved By': '', 'Acct Approved At': '',
    'Dir Approved By': '', 'Dir Approved At': '',
    'Mgmt Approved By': '', 'Mgmt Approved At': '',
    // A156: the admin tick and any payment stamp must clear too, or a reopened request would carry a
    // stale approval — and, worse, still look paid.
    'Admin Approved By': '', 'Admin Approved At': '',
    'Paid By': '', 'Paid At': '', 'Payment Ref': '',
    'Approval Note': note
  });
  return { success: true, prNo: p.prNo, status: 'Draft', previousStatus: st,
           message: 'Payment Request reopened for revision — all approvals cleared; it must be approved again.' };
}

/* A156: one sequential chain for BOTH types — Admin → Management → Director.
   Accounting no longer approves (they still create, and pay the non-bank methods).
   Legacy in-flight rows are mapped on, so nothing submitted under the old two-chain model dead-ends:
   'Pending Accounting' behaves as 'Pending Admin', 'Pending Final' as 'Pending Management'. */
var _PR_STAGES = [
  { status: 'Pending Admin', legacy: 'Pending Accounting', role: 'admin',
    by: 'Admin Approved By', at: 'Admin Approved At', next: 'Pending Management', who: 'admin' },
  { status: 'Pending Management', legacy: 'Pending Final', role: 'management',
    by: 'Mgmt Approved By', at: 'Mgmt Approved At', next: 'Pending Director', who: 'management' },
  { status: 'Pending Director', legacy: null, role: 'director',
    by: 'Dir Approved By', at: 'Dir Approved At', next: 'Approved', who: 'the director' }
];
function _prStage(status) {
  var st = String(status || '');
  for (var i = 0; i < _PR_STAGES.length; i++) {
    if (_PR_STAGES[i].status === st || (_PR_STAGES[i].legacy && _PR_STAGES[i].legacy === st)) return _PR_STAGES[i];
  }
  return null;
}

function approvePaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status']), role = String(p.actorRole || ''), who = p.actorName || '', now = _now();
  var stage = _prStage(st);
  if (!stage) return { success: false, message: 'Not awaiting approval at this stage (' + st + ').' };
  if (role !== stage.role) return { success: false, message: 'Only ' + stage.who + ' can approve at this stage.' };
  var patch = { 'Status': stage.next };
  patch[stage.by] = who;
  patch[stage.at] = now;
  _prSet(p.prNo, patch);
  return { success: true, prNo: p.prNo, status: stage.next,
           message: stage.next === 'Approved' ? 'Payment Request fully approved.'
                                              : 'Approved; forwarded to ' + stage.next.replace('Pending ', '').toLowerCase() + '.' };
}

/* A156: mark an APPROVED request as actually paid, with the proof of payment on file.
   Ownership follows the payment method: bank/online transfers are executed by the director, every
   other method (cheque, cash, telegraphic transfer) by accounting. */
var _PR_DIRECTOR_METHODS = ['bank transfer', 'online'];
var _PR_KNOWN_METHODS = ['bank transfer', 'online', 'cheque', 'cash', 'telegraphic transfer'];
function _prPayOwner(method) {
  return _PR_DIRECTOR_METHODS.indexOf(String(method || '').trim().toLowerCase()) !== -1 ? 'director' : 'accounting';
}

/* A158: find the AP row a PO-type request settles, and say clearly when that can't be done safely.
   Returns { ap } | { error }. A blank PO No must never fall through to "the first AP row that also
   has a blank PO No", and a PO carrying several amount-bearing AP rows is the A114 doubling shape —
   pay against it and one of the two payables is silently lost. */
function _prTargetAp(pr) {
  var poNo = String(pr['PO No'] || '').trim();
  var rows = _rows('APAging');
  var linked = rows.filter(function (a) { return String(a['PR No'] || '') === String(pr['PR No']); });
  if (linked.length === 1) return { ap: linked[0] };
  if (linked.length > 1) {
    return { error: 'This request is linked to ' + linked.length + ' AP entries (' +
      linked.map(function (a) { return a['AP No']; }).join(', ') + ') — resolve the duplicates on AP Aging first.' };
  }
  if (!poNo) return { error: 'This PO-type request has no PO number, so the payable it settles is unknown.' };
  var byPo = rows.filter(function (a) {
    return String(a['PO No'] || '').trim() === poNo && _num(a['Amount (PHP)']) > 0;
  });
  if (!byPo.length) return { error: 'No payable found for ' + poNo + '.' };
  if (byPo.length > 1) {
    return { error: 'PO ' + poNo + ' has ' + byPo.length + ' payable entries (' +
      byPo.map(function (a) { return a['AP No']; }).join(', ') +
      ') — resolve the duplicates on AP Aging before paying.' };
  }
  return { ap: byPo[0] };
}

/* A158: what is still owed on a PO — the payable, less what has been paid, less what other open
   requests have already claimed. This is what a new request may ask for, and what the second
   payment of a deposit/balance pair should default to. */
function _poRemainingPayable(poNo, excludePrNo) {
  var po = String(poNo || '').trim();
  if (!po) return null;
  var aps = _rows('APAging').filter(function (a) { return String(a['PO No'] || '').trim() === po; });
  if (!aps.length) return null;
  var amount = aps.reduce(function (s, a) { return s + _num(a['Amount (PHP)']); }, 0);
  var paid = aps.reduce(function (s, a) { return s + _num(a['Paid (PHP)']); }, 0);
  var openReq = _rows('PaymentRequests').filter(function (r) {
    var st = String(r['Status'] || '');
    return String(r['PO No'] || '').trim() === po
      && String(r['PR No']) !== String(excludePrNo || '')
      && st !== 'Rejected' && st !== 'Paid';
  }).reduce(function (s, r) { return s + _num(r['Amount']); }, 0);
  return { amount: amount, paid: paid, openRequests: openReq,
           remaining: amount - paid - openReq, count: aps.length };
}

function markPaymentRequestPaid(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status']);
  if (st === 'Paid') return { success: false, message: 'This payment request is already marked paid.' };
  if (st !== 'Approved') return { success: false, message: 'Only an approved payment request can be marked paid (it is ' + st + ').' };

  var method = String(r['Payment Method'] || '').trim();
  // A158: a blank or unrecognised method silently defaulted to accounting-owned. Ownership decides who
  // may release money, so it has to be explicit.
  if (!method) return { success: false, message: 'Set the payment method on this request before marking it paid.' };
  if (_PR_KNOWN_METHODS.indexOf(method.toLowerCase()) === -1) {
    return { success: false, message: 'Unrecognised payment method "' + method + '" — set a known method before marking this paid.' };
  }
  var owner = _prPayOwner(method);
  if (String(p.actorRole || '') !== owner) {
    return { success: false, message: method + ' payments are marked paid by ' +
      (owner === 'director' ? 'the director' : 'accounting') + '.' };
  }
  // Proof is the point of the step — no proof, no Paid. The record's own generated PDF doesn't count.
  var hasProof = _rows('Documents').some(function (d) {
    return String(d['Module']) === 'Payment Request' && String(d['Ref No']) === String(p.prNo)
      && String(d['Doc Type'] || '').trim().toLowerCase() === 'proof of payment';
  });
  if (!hasProof) return { success: false, message: 'Attach the proof of payment (Docs → Proof of Payment) before marking this paid.' };

  var amt = _num(r['Amount']);
  var apUpdated = '', apStatus = '';
  // A PO-backed payment settles a real payable. Recording it on AP Aging is what lets Receiving value
  // the stock in pesos (_apPaidPHP drives the landed cost) and closes the payable.
  if (String(r['Type']) === 'PO') {
    var found = _prTargetAp(r);
    if (found.error) return { success: false, message: found.error };
    var ap = found.ap;
    if (amt > 0) {
      var sh = _sheet('APAging'), headers = SCHEMA.APAging;
      var cur = sh.getRange(ap.rowIndex, 1, 1, headers.length).getValues()[0];
      var payable = _num(cur[headers.indexOf('Amount (PHP)')]);
      // A158: ACCUMULATE. Overwriting turned a ₱300k deposit on a ₱1M payable into "₱300k, fully
      // paid" — the remaining ₱700k vanished from the aging, the KPIs and the next request's prefill.
      var paidNow = _num(cur[headers.indexOf('Paid (PHP)')]) + amt;
      if (payable > 0 && paidNow > payable + 0.005) {
        return { success: false, message: 'Paying ' + amt.toFixed(2) + ' would take the total paid to ' +
          paidNow.toFixed(2) + ' against a payable of ' + payable.toFixed(2) + ' — check the amount first.' };
      }
      apStatus = (payable > 0 && paidNow >= payable - 0.005) ? 'Paid' : 'Partial';
      cur[headers.indexOf('Paid (PHP)')] = paidNow;
      cur[headers.indexOf('Status')] = apStatus;
      cur[headers.indexOf('Updated At')] = _now();
      sh.getRange(ap.rowIndex, 1, 1, headers.length).setValues([cur]);
      apUpdated = String(ap['AP No'] || '');
      // GL: the disbursement itself. Posted as the running total for this payable (ARCOLL-style
      // aggregate) so it stays idempotent with updateAPAging's own APPAY entry rather than stacking.
      _postJournal('APPAY', apUpdated, _now(), 'PHP', [
        { account: ACC.AP, debit: paidNow, memo: 'Payment of ' + apUpdated },
        { account: ACC.CASH, credit: paidNow, memo: 'Payment of ' + apUpdated }
      ]);
    }
  }

  _prSet(p.prNo, { 'Status': 'Paid', 'Paid By': p.actorName || '', 'Paid At': _now(),
                   'Payment Ref': p.paymentRef || '' });

  return { success: true, prNo: p.prNo, status: 'Paid', apNo: apUpdated, apStatus: apStatus,
           message: 'Payment Request marked paid' +
             (apUpdated ? ' and recorded on ' + apUpdated + (apStatus === 'Partial' ? ' (partially paid).' : '.') : '.') };
}

function rejectPaymentRequest(p) {
  var r = _prRow(p.prNo);
  if (!r) return { success: false, message: 'Payment Request not found.' };
  var st = String(r['Status']), role = String(p.actorRole || '');
  if (st.indexOf('Pending') !== 0) return { success: false, message: 'Only a pending request can be rejected.' };
  // A156: any approver in the chain may reject at any pending stage — a wrong request should be
  // stoppable by whoever spots it, not only by the stage that happens to hold it.
  var ok = ['admin', 'management', 'director'].indexOf(role) !== -1;
  if (!ok) return { success: false, message: 'You are not an approver for this request.' };
  _prSet(p.prNo, { 'Status': 'Rejected', 'Approval Note': p.reason || '' });
  return { success: true, prNo: p.prNo, status: 'Rejected', message: 'Payment Request rejected.' };
}

function savePaymentRequestPDF(p) {
  if (!p.prNo || !p.pdfBase64) return { success: false, message: 'prNo and pdfBase64 required.' };
  var saved = _saveFileToDrive(p.pdfBase64, p.fileName || (p.prNo + '.pdf'), 'application/pdf',
    _docFolder('Payment Request', p.prNo, _GENERATED_DOC_TYPE, _now()));   // A193 · A194 hint
  var link = saved.url;
  _setCellByKey('PaymentRequests', 'PR No', p.prNo, 'PDF Link', link);
  _registerDocument('Payment Request', p.prNo, p.fileName, link, saved.id, p.actorName);
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
      _sheet('Invoices').appendRow([invNo, soNo, date, customer, sales, cogs, 'Migrated (legacy)', _now(), '', '']);
      _sheet('InvoiceItems').appendRow([invNo, '(migrated)', 'Migrated legacy sales', 1, sales, sales, cogs, cogs, '']);
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
    _sheet('ReceivingItems').appendRow([mrNo, '(migrated)', 'Migrated legacy goods', 1, 0, purchase, 0, purchase, purchase, '']);
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
      invItemSh.appendRow([invNo, '(migrated)', 'Migrated legacy sales', 1, sales, sales, cogs, cogs, '']);
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
      rcvItemSh.appendRow([mrNo, '(migrated)', 'Migrated legacy goods', 1, 0, purchase, 0, purchase, purchase, '']);
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
/** A151: the ONE company-owned root folder every generated PDF / attachment lands in. Resolve the
 *  FLOW_DRIVE_FOLDER_ID constant, else a ScriptProperty the user sets once from the UI, else
 *  find/create "Flow Documents". Set the property so files never depend on the script account's My Drive. */
function _rootFolder() {
  var id = FLOW_DRIVE_FOLDER_ID ||
    (PropertiesService.getScriptProperties().getProperty('FLOW_DRIVE_FOLDER_ID') || '');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* fall through to default */ } }
  var it = DriveApp.getFoldersByName('Flow Documents');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Flow Documents');
}

function _flowFolder() { return _rootFolder(); }

/** Purchase-request PDFs live in "Purchase Request/<requester name>/" — one subfolder per user
 *  (sales or admin, whoever created the request). Nested UNDER the company root folder. */
function _prUserFolder(userName) {
  var root = _rootFolder();
  var prIt = root.getFoldersByName('Purchase Request');
  var pr = prIt.hasNext() ? prIt.next() : root.createFolder('Purchase Request');
  var name = String(userName || 'Unknown').trim() || 'Unknown';
  var subIt = pr.getFoldersByName(name);
  return subIt.hasNext() ? subIt.next() : pr.createFolder(name);
}

/** Let the user pin the company-owned Drive folder once from the UI (writes a ScriptProperty).
 *  A193: `p` is optional — pressing Run in the Apps Script editor calls this with no argument, which
 *  used to throw "Cannot read properties of undefined". With no id it falls back to the constant. */
function setFlowDriveFolder(p) {
  p = p || {};
  var id = String(p.folderId || FLOW_DRIVE_FOLDER_ID || '').trim();
  if (!id) return { success: false, message: 'folderId required.' };
  try { DriveApp.getFolderById(id).getName(); }
  catch (e) { return { success: false, message: 'Folder not found or not shared with this account.' }; }
  PropertiesService.getScriptProperties().setProperty('FLOW_DRIVE_FOLDER_ID', id);
  return { success: true, folderId: id, message: 'Flow documents folder set. New PDFs/attachments will save here.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  A193 · DRIVE FILING — <client> / <sales order> / <document type>
//
//  Everything below only decides WHICH FOLDER a file belongs in. It never decides whether a file is
//  saved: every entry point falls back to the root folder, because a client with an odd name must
//  not be able to block a purchase order from being filed.
// ════════════════════════════════════════════════════════════════════════════

var _FLOW_UNKNOWN_CLIENT = '_Unknown Client';
var _FLOW_PRESO_FOLDER   = '_Pre-Sales Order';

/** _rows() re-reads the whole sheet on every call, and resolving one file's folder touches several
 *  sheets. Memoise for the life of ONE execution only — never across, since mutations depend on
 *  _rows() being fresh. Cleared by _flowFilingReset(). */
var _FILING_MEMO = {};
function _memoRows(name) {
  if (!_FILING_MEMO[name]) { try { _FILING_MEMO[name] = _rows(name); } catch (e) { _FILING_MEMO[name] = []; } }
  return _FILING_MEMO[name];
}
function _flowFilingReset() {
  _FILING_MEMO = {}; _CLIENT_REG_CACHE = null; _DISPLAY_CACHE = null; _FOLDER_CACHE = null;
}

/** First row whose keyCol === keyVal, or null. */
function _memoFind(sheet, keyCol, keyVal) {
  var v = String(keyVal || ''); if (!v) return null;
  var rows = _memoRows(sheet);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][keyCol]) === v) return rows[i];
  return null;
}
function _memoField(sheet, keyCol, keyVal, field) {
  var r = _memoFind(sheet, keyCol, keyVal);
  return r ? String(r[field] || '') : '';
}

// ── Client naming ────────────────────────────────────────────────────────────
/* The live order book spells one client several ways — "Eagle Cement Corporation", "Eagle Cement
   Corp", "Eagle Cement" — and they must share ONE folder. _canonKey() reduces a name to a comparison
   key; it is deliberately conservative, because a matcher aggressive enough to merge those is one odd
   name away from merging two genuinely different companies. It therefore only PROPOSES: a row in the
   ClientAliases sheet always wins, which is how a wrong merge is corrected without touching code. */
var _CLIENT_SUFFIX_RE = /\b(corporation|corp|incorporated|inc|company|co|ltd|limited|enterprises|enterprise|ent|philippines|phils|phil|international|intl|group|holdings|resources)\b/g;

function _canonKey(name) {
  var s = String(name || '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' ');    // "(FFHC)" is the same firm abbreviating itself
  /* " - TSI BU" is a business unit of the same client. The live book writes it both ways —
     "Corporation - TSI BU" AND "Corporation- SNAPB BU" — so the rule keys on whitespace AFTER the
     dash, not before it; keying on a fully spaced dash filed the same company two different ways
     depending on a stray space. A dash with a word character on both sides is left alone, which is
     what keeps "Itogon-Suyoc" intact. */
  s = s.replace(/\s*[-–—]\s+.*$/, '');
  s = s.replace(/[.,]/g, ' ');
  s = s.replace(_CLIENT_SUFFIX_RE, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** The raw spelling, normalised only for lookup. Keyed on this (not the canon key) so an alias row
 *  can SPLIT what the matcher merged — e.g. filing "Aboitiz Power - TL" apart from "- TSI BU". */
function _rawKey(name) { return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

var _CLIENT_REG_CACHE = null;
function _clientRegistry() {
  if (_CLIENT_REG_CACHE) return _CLIENT_REG_CACHE;
  var byRaw = {}, byKey = {};
  _memoRows('ClientAliases').forEach(function (r) {
    var raw = _rawKey(r['Raw Name']);
    var key = _canonKey(r['Canonical'] || r['Raw Name']);
    var disp = String(r['Display Name'] || r['Canonical'] || r['Raw Name'] || '').trim();
    if (raw && key) byRaw[raw] = key;
    if (key && disp && !byKey[key]) byKey[key] = disp;
  });
  _CLIENT_REG_CACHE = { byRaw: byRaw, byKey: byKey };
  return _CLIENT_REG_CACHE;
}

/** Your own Clients sheet supplies the display spelling wherever it reaches — but it only names 7 of
 *  the 30 clients on the order book, so it cannot be the sole authority. */
function _clientSheetName(key) {
  var rows = _memoRows('Clients'), best = '';
  for (var i = 0; i < rows.length; i++) {
    var n = String(rows[i]['Customer'] || '');
    if (!n || _canonKey(n) !== key) continue;
    // Normalised the same way as any other spelling: the Clients sheet also carries business-unit
    // rows ("Aboitiz Power Corporation - TMI BU"), and that must not become the whole client's
    // folder name. It lists several spellings of one client too, so pick deterministically.
    var cand = _displayForm(n);
    if (cand && (!best || _displayBetter(cand, best))) best = cand;
  }
  return best;
}

/* The folder name has to depend on the CANONICAL KEY, never on whichever spelling happened to be on
   the record being filed — otherwise "Eagle Cement Corp" and "Eagle Cement" would each mint their own
   folder and the merge would achieve nothing. So one spelling is elected per key, deterministically,
   across every customer name the system knows. */
/** A spelling reduced to the company itself: the business-unit tail comes off, so the folder holding
 *  every Aboitiz BU is called "Aboitiz Power Corporation" and not whichever BU happened to sort
 *  first. Same dash rule as _canonKey, so "Itogon-Suyoc" is untouched. */
function _displayForm(name) {
  var s = String(name || '').replace(/\s*[-–—]\s+.*$/, '').trim();
  return s.replace(/[\s,;:]+$/, '').trim();
}

var _DISPLAY_CACHE = null;
function _electedDisplay(key) {
  if (!_DISPLAY_CACHE) {
    var reg = _clientRegistry(), best = {};
    _allCustomerSpellings().forEach(function (n) {
      var k = reg.byRaw[_rawKey(n)] || _canonKey(n);
      if (!k) return;
      var cand = _displayForm(n);
      if (!cand) return;
      var cur = best[k];
      // Most complete name first ("Eagle Cement Corporation" beats "Eagle Cement"); then prefer
      // ordinary case over SHOUTING; then lowercase and raw comparisons so the result is total.
      if (!cur || _displayBetter(cand, cur)) best[k] = cand;
    });
    _DISPLAY_CACHE = best;
  }
  return _DISPLAY_CACHE[key] || '';
}

/** Is `a` the better folder name than `b`? Compared field by field — an explicit comparator rather
 *  than `<` on two arrays, which JS would silently turn into a string comparison. */
function _displayBetter(a, b) {
  if (a.length !== b.length) return a.length > b.length;               // the most complete name
  var au = (a === a.toUpperCase()) ? 1 : 0, bu = (b === b.toUpperCase()) ? 1 : 0;
  if (au !== bu) return au < bu;                                       // ordinary case over SHOUTING
  var al = a.toLowerCase(), bl = b.toLowerCase();
  if (al !== bl) return al < bl;
  return a < b;                                                        // total, so the result is stable
}

/** name -> { key, display }. `display` is the folder name and MUST be stable for a given key, or
 *  a second spelling would mint a second folder for the same client. */
function _canonClient(name) {
  var raw = String(name || '').trim();
  if (!raw) return { key: '', display: _FLOW_UNKNOWN_CLIENT, raw: '' };
  var reg = _clientRegistry();
  var key = reg.byRaw[_rawKey(raw)] || _canonKey(raw);
  if (!key) return { key: '', display: _FLOW_UNKNOWN_CLIENT, raw: raw };
  // Pinned registry row wins, then your Clients sheet, then the elected spelling, then the raw name.
  return { key: key, display: reg.byKey[key] || _clientSheetName(key) || _electedDisplay(key) || raw, raw: raw };
}

/** Pin a spelling into ClientAliases the first time it is seen, so the chosen folder name can never
 *  drift afterwards. Best-effort: filing must survive a missing or unwritable sheet. */
function _registerClient(name) {
  try {
    var raw = String(name || '').trim();
    if (!raw) return;
    var reg = _clientRegistry();
    if (reg.byRaw[_rawKey(raw)]) return;
    var c = _canonClient(raw);
    if (!c.key) return;
    _append('ClientAliases', [raw, c.key, c.display, _now()]);
    reg.byRaw[_rawKey(raw)] = c.key;
    if (!reg.byKey[c.key]) reg.byKey[c.key] = c.display;
    if (_FILING_MEMO['ClientAliases']) delete _FILING_MEMO['ClientAliases'];
  } catch (e) { /* never block a save */ }
}

// ── Which subfolder ──────────────────────────────────────────────────────────
/* Numbered so Drive's alphabetical sort reads in lifecycle order. */
var _DOC_SUBFOLDER_BY_MODULE = {
  'Pricing Request': '01 Pricing Request', 'Quotation': '02 Quotation', 'Sales Order': '03 Client PO',
  'Purchase Order': '04 Purchase Orders', 'Payment Request': '05 Payments', 'AP Aging': '05 Payments',
  'Receiving': '06 Receiving & Shipping', 'Shipment': '06 Receiving & Shipping',
  'Invoice': '07 Invoices & Collections', 'AR Aging': '07 Invoices & Collections',
  'Collection': '07 Invoices & Collections'
};
/* Doc Type is free text — 71 of 234 live rows are blank and the rest range from 'Supplier Quotation'
   to 'tt_sent' to 'Original quotation (June 24, 2026)'. So it is consulted first where it is
   meaningful, and otherwise the Module decides. Anything unrecognised lands in 99 Other rather than
   being guessed at. */
var _DOC_SUBFOLDER_BY_TYPE = {
  'supplier quotation': '01 Pricing Request', 'item photo': '02 Quotation',
  'quotation for client': '02 Quotation', 'client po': '03 Client PO',
  'client po (stamped)': '03 Client PO', 'client purchase order': '03 Client PO',
  'client so': '03 Client PO', 'proof of payment': '05 Payments',
  // A195 canonical types
  'supplier sales invoice': '06 Receiving & Shipping', 'delivered': '06 Receiving & Shipping',
  'delivered_client': '06 Receiving & Shipping', 'collected': '07 Invoices & Collections'
};
function _docSubfolder(module, docType) {
  var t = String(docType || '').trim().toLowerCase().replace(/\s*\(superseded\)\s*$/, '');
  if (_DOC_SUBFOLDER_BY_TYPE[t]) return _DOC_SUBFOLDER_BY_TYPE[t];
  return _DOC_SUBFOLDER_BY_MODULE[String(module || '').trim()] || '99 Other';
}

// ── Which sales order, and therefore which client ────────────────────────────
/* _soDocChain() walks SO -> documents; this walks it back. Targeted lookups rather than a full index,
   because the save path resolves exactly one document. */
function _soForDoc(module, refNo) {
  var m = String(module || ''), ref = String(refNo || '');
  if (!m || !ref) return '';
  if (m === 'Sales Order')    return _memoFind('SalesOrders', 'SO No', ref) ? ref : '';
  if (m === 'Quotation')      { var s = _memoFind('SalesOrders', 'Quotation No', ref); return s ? String(s['SO No']) : ''; }
  if (m === 'Pricing Request') {
    var q = _memoFind('Quotations', 'PR No', ref);
    if (!q) return '';
    var s2 = _memoFind('SalesOrders', 'Quotation No', q['Quotation No']);
    return s2 ? String(s2['SO No']) : '';
  }
  if (m === 'Purchase Order') return _memoField('PurchaseOrders', 'PO No', ref, 'SO No');
  if (m === 'Payment Request') {
    var so = _memoField('PaymentRequests', 'PR No', ref, 'SO No');
    if (so) return so;
    var po = _memoField('PaymentRequests', 'PR No', ref, 'PO No');
    return po ? _memoField('PurchaseOrders', 'PO No', po, 'SO No') : '';
  }
  if (m === 'AP Aging') {
    var po2 = _memoField('APAging', 'AP No', ref, 'PO No');
    return po2 ? _memoField('PurchaseOrders', 'PO No', po2, 'SO No') : '';
  }
  if (m === 'Receiving') {
    var so3 = _memoField('MaterialsReceiving', 'MR No', ref, 'SO No');
    if (so3) return so3;
    var po3 = _memoField('MaterialsReceiving', 'MR No', ref, 'PO No');
    return po3 ? _memoField('PurchaseOrders', 'PO No', po3, 'SO No') : '';
  }
  if (m === 'Invoice')    return _memoField('Invoices', 'INV No', ref, 'SO No');
  if (m === 'AR Aging')   return _memoField('ARAging', 'AR No', ref, 'SO No');
  if (m === 'Shipment')   return _memoField('Shipments', 'Shipment ID', ref, 'SO No');
  if (m === 'Collection') return _memoField('Collections', 'Collection No', ref, 'SO No');
  return '';
}

/* Only 6 of 105 sales orders carry a Quotation No, so most documents cannot reach an SO at all. They
   can still reach a CLIENT — every quotation and pricing request names its customer — which is why
   the client is the top level of the tree rather than the sales order. */
function _customerForDoc(module, refNo) {
  var m = String(module || ''), ref = String(refNo || '');
  if (m === 'Quotation')       return _memoField('Quotations', 'Quotation No', ref, 'Customer');
  if (m === 'Pricing Request') return _memoField('PricingRequests', 'PR No', ref, 'Customer');
  if (m === 'Sales Order')     return _memoField('SalesOrders', 'SO No', ref, 'Customer');
  if (m === 'Invoice')         return _memoField('Invoices', 'INV No', ref, 'Customer');
  if (m === 'AR Aging')        return _memoField('ARAging', 'AR No', ref, 'Customer');
  if (m === 'Collection')      return _memoField('Collections', 'Collection No', ref, 'Customer');
  if (m === 'Shipment')        return _memoField('Shipments', 'Shipment ID', ref, 'Customer');
  return '';
}

/** "<SO No>" — which for 102 of 105 live orders already IS the client's PO number (A145: the rep
 *  types it in). The suffix appears only on the rare order whose client PO is a different string. */
function _soFolderName(soNo) {
  var name = String(soNo || '');
  var poNo = _memoField('SalesOrders', 'SO No', name, 'Client PO No');
  if (poNo && _rawKey(poNo) !== _rawKey(name)) name += ' - PO ' + poNo;
  return name;
}

// ── When: the year and month a document files under ──────────────────────────
/* A194: numeric prefixes so Drive's alphabetical sort reads chronologically. */
var _MONTH_FOLDERS = ['01 January', '02 February', '03 March', '04 April', '05 May', '06 June',
  '07 July', '08 August', '09 September', '10 October', '11 November', '12 December'];
var _FLOW_UNDATED = 'Undated';

/** Sheet dates arrive as Date objects, as ISO strings ("2024-12-20T16:00:00.000Z") and occasionally
 *  as "M/D/YYYY". Parse all three, and never throw — an unreadable date must not stop a save. */
function _ymSegments(v) {
  try {
    if (v instanceof Date && !isNaN(v.getTime())) return [String(v.getFullYear()), _MONTH_FOLDERS[v.getMonth()]];
    var s = String(v || '').trim();
    if (!s) return [_FLOW_UNDATED];
    var iso = s.match(/^(\d{4})-(\d{1,2})/);
    if (iso) {
      var mo = parseInt(iso[2], 10);
      if (mo >= 1 && mo <= 12) return [iso[1], _MONTH_FOLDERS[mo - 1]];
    }
    var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (us) {
      var mo2 = parseInt(us[1], 10);
      if (mo2 >= 1 && mo2 <= 12) return [us[3], _MONTH_FOLDERS[mo2 - 1]];
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return [String(d.getFullYear()), _MONTH_FOLDERS[d.getMonth()]];
  } catch (e) {}
  return [_FLOW_UNDATED];
}

/* THE anchoring decision. Every document takes its SALES ORDER's date, not its own — otherwise one
   order's quotation would file under June and its invoice under September, scattering a single order
   across month folders and defeating the point of having an order folder at all. Documents with no
   order yet fall back to their own record's date, and move when the order appears. */
function _docDateFor(module, refNo, soNo, hint) {
  var m = String(module || ''), ref = String(refNo || '');
  if (soNo) {
    var sod = _memoField('SalesOrders', 'SO No', soNo, 'Date');
    if (sod) return sod;
  }
  if (m === 'Quotation')       { var q = _memoField('Quotations', 'Quotation No', ref, 'Date'); if (q) return q; }
  if (m === 'Pricing Request') { var p = _memoField('PricingRequests', 'PR No', ref, 'Date');   if (p) return p; }
  if (m === 'Sales Order')     { var s = _memoField('SalesOrders', 'SO No', ref, 'Date');       if (s) return s; }
  if (m === 'Invoice')         { var i = _memoField('Invoices', 'INV No', ref, 'Date');         if (i) return i; }
  if (m === 'Collection')      { var c = _memoField('Collections', 'Collection No', ref, 'Date'); if (c) return c; }
  if (m === 'Purchase Order')  { var o = _memoField('PurchaseOrders', 'PO No', ref, 'Date');    if (o) return o; }
  if (m === 'Receiving')       { var r = _memoField('MaterialsReceiving', 'MR No', ref, 'Date'); if (r) return r; }
  return hint || '';   // last resort: when the file was uploaded
}

/** Where a document belongs, described rather than just concatenated. Callers that need to know
 *  WHICH segment is the client or the order read the named fields instead of guessing at indexes —
 *  A194 inserted year/month at the front, and index arithmetic silently broke everywhere that had
 *  assumed path[0] was the client. Never throws. */
function _docFolderInfo(module, refNo, docType, dateHint) {
  var sub = _docSubfolder(module, docType);
  var soNo = '';
  try { soNo = _soForDoc(module, refNo); } catch (e) {}
  var customer = '';
  try { customer = soNo ? _memoField('SalesOrders', 'SO No', soNo, 'Customer') : _customerForDoc(module, refNo); } catch (e) {}
  var when = [_FLOW_UNDATED];
  try { when = _ymSegments(_docDateFor(module, refNo, soNo, dateHint)); } catch (e) {}
  var c = _canonClient(customer);
  var info = { year: when[0], month: when.length > 1 ? when[1] : '', sub: sub,
    client: c.key ? c.display : _FLOW_UNKNOWN_CLIENT, order: '',
    unknownClient: !c.key, preSalesOrder: false };
  if (!c.key)      info.segments = when.concat([_FLOW_UNKNOWN_CLIENT, sub]);
  else if (!soNo) { info.preSalesOrder = true; info.order = _FLOW_PRESO_FOLDER;
                    info.segments = when.concat([c.display, _FLOW_PRESO_FOLDER, sub]); }
  else            { info.order = _soFolderName(soNo);
                    info.segments = when.concat([c.display, info.order, sub]); }
  return info;
}

/** The full path, as segments below the root.
 *  <year> / <month> / <client> / <sales order | _Pre-Sales Order> / <doc type> */
function _docFolderPath(module, refNo, docType, dateHint) {
  return _docFolderInfo(module, refNo, docType, dateHint).segments;
}

/** Drive tolerates most characters, but a slash reads as a path and the live SO numbers contain
 *  pipes ("3120001511 | T21"), so names are normalised and length-capped. */
function _safeName(s) {
  var n = String(s || '').replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').trim();
  return n ? n.substring(0, 120) : 'Unnamed';
}

/* A194: the tree is five levels deep now, so resolving 234 documents means ~1,170 getFoldersByName
   calls — and almost all of them repeat, because documents share paths. Memoise every level for the
   life of ONE execution; cleared by _flowFilingReset(). */
var _FOLDER_CACHE = null;

/** Walk the path from the root, creating each level that is missing. */
function _ensurePath(segments) {
  if (!_FOLDER_CACHE) _FOLDER_CACHE = {};
  var f = _rootFolder(), key = '';
  for (var i = 0; i < segments.length; i++) {
    var name = _safeName(segments[i]);
    key += '/' + name;
    if (_FOLDER_CACHE[key]) { f = _FOLDER_CACHE[key]; continue; }
    var it = f.getFoldersByName(name);
    f = it.hasNext() ? it.next() : f.createFolder(name);
    _FOLDER_CACHE[key] = f;
  }
  return f;
}

/** The folder a document belongs in, or null to let the caller fall back to the root.
 *  A194: path[0] is now the YEAR, so the old "is it the unknown-client bucket" check on path[0] is
 *  gone — _registerClient already no-ops on a blank name, so it can simply always be called. */
function _docFolder(module, refNo, docType, dateHint) {
  try {
    var cust = '';
    try {
      var so = _soForDoc(module, refNo);
      cust = so ? _memoField('SalesOrders', 'SO No', so, 'Customer') : _customerForDoc(module, refNo);
    } catch (e) {}
    _registerClient(cust);
    return _ensurePath(_docFolderPath(module, refNo, docType, dateHint));
  } catch (e) { return null; }
}

// ── Adopting documents once the sales order exists ───────────────────────────
/* A quotation, its pricing request and their PDFs are all created BEFORE the sales order does, so
   they are filed under <client>/_Pre-Sales Order/. When the SO finally appears they are moved in.

   A move preserves the file's ID and its URL, so every 'Drive Link' already stored in the Documents
   sheet — and every link already sitting in the UI — keeps working. Nothing needs rewriting. */
function _moveFileTo(fileId, folder) {
  if (!folder || !fileId) return false;
  try {
    var f = DriveApp.getFileById(fileId);
    var parents = f.getParents();
    if (parents.hasNext() && parents.next().getId() === folder.getId()) return false;  // already filed
    f.moveTo(folder);
    return true;
  } catch (e) { return false; }
}

/** Move every document in a sales order's lifecycle chain into that order's folder. Idempotent, and
 *  never throws — filing must not be able to fail a sales-order save. */
function _adoptSoDocs(soNo) {
  var moved = 0;
  try {
    SpreadsheetApp.flush();     // the SO row was just written; the resolver has to be able to see it
    _flowFilingReset();
    var want = {};
    _soDocChain(soNo).forEach(function (r) { want[String(r[0]) + '|' + String(r[1])] = true; });
    _memoRows('Documents').forEach(function (d) {
      if (!want[String(d['Module']) + '|' + String(d['Ref No'])]) return;
      var fileId = String(d['File ID'] || '') || _driveIdFromUrl(d['Drive Link']);
      if (_moveFileTo(fileId, _docFolder(d['Module'], d['Ref No'], d['Doc Type'], d['Uploaded At']))) moved++;
    });
  } catch (e) { /* never block the sales order */ }
  return moved;
}

// ── Migrating the documents that are already in Drive ────────────────────────
/* Modelled on Code.gs migrateShipmentDocs: preview first, then run in resumable batches. */

/** Every customer spelling the system knows, from the three sheets that name one. */
function _allCustomerSpellings() {
  var seen = {}, out = [];
  [['SalesOrders', 'Customer'], ['Quotations', 'Customer'], ['PricingRequests', 'Customer']]
    .forEach(function (src) {
      _memoRows(src[0]).forEach(function (r) {
        var n = String(r[src[1]] || '').trim();
        if (n && !seen[_rawKey(n)]) { seen[_rawKey(n)] = true; out.push(n); }
      });
    });
  return out;
}

function _editDistance(a, b) {
  var m = a.length, n = b.length, prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    for (j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/** The reviewed client list: which spellings group together, and which near-identical groups are
 *  probably a typo rather than two companies. A typo (ITOGON SOYUC vs ITOGON-SUYOC) can only be
 *  judged by a person — merging on near-match automatically would also merge real companies. */
function _clientProposals() {
  var groups = {}, reg = _clientRegistry();
  _allCustomerSpellings().forEach(function (n) {
    var key = reg.byRaw[_rawKey(n)] || _canonKey(n);
    if (!key) return;
    if (!groups[key]) groups[key] = { canonical: key, display: _canonClient(n).display, spellings: [], pinned: false };
    groups[key].spellings.push(n);
    if (reg.byRaw[_rawKey(n)]) groups[key].pinned = true;
  });
  var keys = Object.keys(groups).sort(), possibleTypos = [];
  for (var a = 0; a < keys.length; a++) {
    for (var b = a + 1; b < keys.length; b++) {
      if (Math.abs(keys[a].length - keys[b].length) > 2) continue;
      if (keys[a].length < 7) continue;
      if (_editDistance(keys[a], keys[b]) <= 2) {
        possibleTypos.push({ a: groups[keys[a]].display, b: groups[keys[b]].display,
          hint: 'These differ by 1-2 characters. If they are the same client, point both Raw Names ' +
                'at one Canonical in the ClientAliases sheet before migrating.' });
      }
    }
  }
  return { clients: keys.map(function (k) { return groups[k]; }), possibleTypos: possibleTypos };
}

/** Read-only. Resolves where all 234 documents WOULD go. Creates nothing and moves nothing. */
function previewDriveMigration(p) {
  _flowFilingReset();
  var docs = _memoRows('Documents');
  var rows = [], byFolder = {}, byClient = {}, byMonth = {}, unresolved = 0, preSo = 0, undated = 0;
  var notOwned = [], inaccessible = [];
  docs.forEach(function (d) {
    var info = _docFolderInfo(d['Module'], d['Ref No'], d['Doc Type'], d['Uploaded At']);
    var full = info.segments.join(' / ');
    byFolder[full] = (byFolder[full] || 0) + 1;
    byClient[info.client] = (byClient[info.client] || 0) + 1;
    var ym = info.year + (info.month ? ' / ' + info.month : '');
    byMonth[ym] = (byMonth[ym] || 0) + 1;
    if (info.unknownClient) unresolved++;
    if (info.preSalesOrder) preSo++;
    if (info.year === _FLOW_UNDATED) undated++;
    var fileId = String(d['File ID'] || '') || _driveIdFromUrl(d['Drive Link']);
    /* The only two ways a move can genuinely fail, reported BEFORE anything moves: a file this
       account does not own, and a file that can no longer be opened at all. */
    try {
      var f = DriveApp.getFileById(fileId);
      var owner = f.getOwner();   // null inside a Shared Drive — not an error, just not owned by a person
      if (owner && owner.getEmail() !== Session.getEffectiveUser().getEmail()) {
        notOwned.push({ docId: d['Doc ID'], fileName: String(d['File Name'] || ''), owner: owner.getEmail() });
      }
    } catch (e) { inaccessible.push({ docId: d['Doc ID'], fileName: String(d['File Name'] || ''), error: e.message }); }
    rows.push({ docId: d['Doc ID'], module: d['Module'], refNo: d['Ref No'],
      docType: String(d['Doc Type'] || ''), fileName: String(d['File Name'] || ''), fileId: fileId,
      path: full, client: info.client, year: info.year, month: info.month,
      unresolved: info.unknownClient, preSalesOrder: info.preSalesOrder });
  });
  var prop = _clientProposals();
  return { success: true, total: docs.length, resolved: docs.length - unresolved,
    unresolved: unresolved, preSalesOrder: preSo, undated: undated,
    byClient: byClient, byFolder: byFolder, byMonth: byMonth,
    notOwned: notOwned, inaccessible: inaccessible,
    clients: prop.clients, possibleTypos: prop.possibleTypos, documents: rows,
    message: 'Preview only — nothing was created or moved.' };
}

/** Write the proposed client registry into ClientAliases so it can be reviewed and edited in the
 *  sheet before anything moves. Idempotent: a Raw Name already present is left exactly as it is. */
function seedClientAliases(p) {
  _flowFilingReset();
  var reg = _clientRegistry(), added = 0, skipped = 0;
  _allCustomerSpellings().forEach(function (n) {
    if (reg.byRaw[_rawKey(n)]) { skipped++; return; }
    var c = _canonClient(n);
    if (!c.key) { skipped++; return; }
    _append('ClientAliases', [n, c.key, c.display, _now()]);
    reg.byRaw[_rawKey(n)] = c.key;
    if (!reg.byKey[c.key]) reg.byKey[c.key] = c.display;
    added++;
  });
  return { success: true, added: added, skipped: skipped,
    message: 'Seeded ' + added + ' client name(s); ' + skipped + ' already on file. Edit the ' +
             'ClientAliases sheet to correct any grouping, then run the migration.' };
}

/** A194: give EVERY sales order a folder, whether or not it has any documents yet.
 *
 *  Driven off SalesOrders rather than off Documents, which is the whole point: all 63 orders from
 *  2024-2025 have zero documents, so a documents-driven build would leave those years missing
 *  entirely. This creates the real, correctly-dated home each order's paperwork drops into as it is
 *  back-filed.
 *
 *  The per-doc-type subfolders are deliberately NOT pre-created — 105 orders x 8 would be 840 empty
 *  folders. They appear when a document actually arrives.
 *
 *  Idempotent (an existing folder is reused, never duplicated) and resumable via `offset`.
 *  Creates no files and moves nothing. */
function buildDriveSkeleton(p) {
  p = p || {};
  var dryRun = (p.dryRun === true || String(p.dryRun) === 'true');
  var offset = Math.max(0, Math.floor(_num(p.offset)));
  var limit = Math.max(1, Math.floor(_num(p.limit) || 60));
  _flowFilingReset();
  var sos = _memoRows('SalesOrders');
  var processed = 0, made = 0, undated = 0, errors = 0, seen = {}, log = [];
  var started = Date.now(), i = offset;
  for (; i < sos.length; i++) {
    if (processed >= limit || Date.now() - started > 240000) break;
    var so = sos[i], soNo = String(so['SO No'] || '');
    if (!soNo) continue;
    processed++;
    try {
      var when = _ymSegments(so['Date']);
      if (when[0] === _FLOW_UNDATED) undated++;
      var c = _canonClient(so['Customer']);
      var path = when.concat([c.key ? c.display : _FLOW_UNKNOWN_CLIENT, _soFolderName(soNo)]);
      var key = path.join('/');
      if (seen[key]) continue;
      seen[key] = true;
      if (c.key) _registerClient(so['Customer']);
      if (!dryRun) _ensurePath(path);
      made++;
      log.push({ soNo: soNo, path: key });
    } catch (e) { errors++; log.push({ soNo: soNo, error: e.message }); }
  }
  var next = i < sos.length ? i : null;
  return { success: true, dryRun: dryRun, totalSalesOrders: sos.length, processed: processed,
    folders: made, undated: undated, errors: errors, nextOffset: next, log: log,
    message: (dryRun ? 'Dry run: ' : '') + 'Ensured ' + made + ' sales-order folder(s)' +
      (next === null ? ' — finished.' : ' — call again with offset ' + next + ' to continue.') };
}

/** Move the existing files. Resumable: pass back `nextOffset` until it comes back null. Stops well
 *  short of the 6-minute execution ceiling. Set dryRun to walk it without touching Drive. */
function runDriveMigration(p) {
  p = p || {};
  var dryRun = (p.dryRun === true || String(p.dryRun) === 'true');
  var onlyClient = String(p.client || '').trim();
  var offset = Math.max(0, Math.floor(_num(p.offset)));
  // A194: 40, not 60 — the tree is two levels deeper, so each file costs more Drive calls and the
  // 6-minute execution ceiling is what binds.
  var limit = Math.max(1, Math.floor(_num(p.limit) || 40));
  _flowFilingReset();
  var docs = _memoRows('Documents');
  var processed = 0, moved = 0, already = 0, errors = 0, log = [];
  var started = Date.now(), i = offset;
  for (; i < docs.length; i++) {
    if (processed >= limit || Date.now() - started > 240000) break;
    var d = docs[i];
    var info = _docFolderInfo(d['Module'], d['Ref No'], d['Doc Type'], d['Uploaded At']);
    var path = info.segments;
    if (onlyClient && info.client !== onlyClient) continue;
    processed++;
    var fileId = String(d['File ID'] || '') || _driveIdFromUrl(d['Drive Link']);
    if (!fileId) { errors++; log.push({ docId: d['Doc ID'], error: 'no Drive file id on the record' }); continue; }
    if (dryRun) { log.push({ docId: d['Doc ID'], to: path.join(' / '), dryRun: true }); continue; }
    try {
      if (_moveFileTo(fileId, _ensurePath(path))) { moved++; log.push({ docId: d['Doc ID'], to: path.join(' / ') }); }
      else already++;
    } catch (e) { errors++; log.push({ docId: d['Doc ID'], error: e.message }); }
  }
  var next = i < docs.length ? i : null;
  return { success: true, dryRun: dryRun, total: docs.length, processed: processed, moved: moved,
    alreadyInPlace: already, errors: errors, nextOffset: next, log: log,
    message: (dryRun ? 'Dry run: ' : 'Moved ') + (dryRun ? processed + ' document(s) walked' : moved + ' file(s)') +
      (next === null ? ' — finished.' : ' — call again with offset ' + next + ' to continue.') };
}

/** A193 · SETUP — select this in the Apps Script editor and press Run. Takes no arguments.
 *
 *  Answers the one question that has to be settled before anything is filed: can this script account
 *  actually WRITE to the company folder? Read-only access is the dangerous case — _rootFolder()
 *  swallows the failure and silently falls back to a different folder called "Flow Documents", so
 *  files look saved and land in the wrong place. This creates a probe folder, deletes it again, and
 *  says plainly which it found. Safe to run as often as you like. */
function setupFlowDrive() {
  var out = [];
  function say(s) { out.push(s); Logger.log(s); }
  var id = FLOW_DRIVE_FOLDER_ID;
  say('Folder ID  : ' + id);
  var folder;
  try { folder = DriveApp.getFolderById(id); say('Folder name: ' + folder.getName()); }
  catch (e) {
    say('CANNOT OPEN THIS FOLDER.');
    say('Share it with the account running this script (' + Session.getEffectiveUser().getEmail() +
        ') as an EDITOR, then run this again.');
    return out.join('\n');
  }
  try {
    var probe = folder.createFolder('_access probe (safe to delete)');
    probe.setTrashed(true);
    say('Write access: YES — folders can be created here.');
  } catch (e) {
    say('Write access: NO (' + e.message + ')');
    say('The account can SEE the folder but not write to it. Change its access from Viewer to');
    say('Editor, or documents will silently go to a different folder named "Flow Documents".');
    return out.join('\n');
  }
  try { PropertiesService.getScriptProperties().setProperty('FLOW_DRIVE_FOLDER_ID', id); } catch (e) {}
  say('');
  say('Ready. Next: run buildDriveSkeletonAll() to create a folder for every sales order.');
  return out.join('\n');
}

/** A194 · Select this and press Run. Takes no arguments. Creates a folder for every sales order —
 *  including the 63 from 2024-2025 that have no documents yet — looping until it has done them all.
 *  Idempotent: running it twice creates nothing the second time. Moves no files. */
function buildDriveSkeletonAll() {
  var offset = 0, folders = 0, rounds = 0, undated = 0, errors = 0;
  while (rounds < 40) {
    var r = buildDriveSkeleton({ offset: offset, limit: 60 });
    folders += r.folders; undated += r.undated; errors += r.errors; rounds++;
    if (r.nextOffset === null) break;
    offset = r.nextOffset;
  }
  var msg = 'Sales-order folders ensured: ' + folders +
            (undated ? '  ·  undated orders: ' + undated + ' (filed under "' + _FLOW_UNDATED + '")' : '') +
            (errors ? '  ·  errors: ' + errors : '') +
            '\nNext: run previewDriveMigrationReport() — read-only.';
  Logger.log(msg);
  return msg;
}

/** A194 · Select this and press Run. Takes no arguments. READ-ONLY.
 *
 *  Answers "can every document in the system still be opened?" — the thing filing must never break.
 *  Run it BEFORE the migration to get a baseline, and again AFTER: the two must be identical.
 *
 *  A Drive move preserves a file's id and its URL, so every stored link should survive untouched.
 *  That is the claim; this checks it against every row rather than trusting it. It also covers the
 *  four sheets that keep a 'PDF Link' of their own, outside the Documents registry. */
function verifyDriveIntegrity() {
  _flowFilingReset();
  var out = [], problems = [];
  function say(s) { out.push(s); Logger.log(s); }

  var docs = _memoRows('Documents');
  var okDocs = 0, noId = 0, gone = 0, trashed = 0, urlDrift = 0, notShared = 0;
  docs.forEach(function (d) {
    var stored = String(d['Drive Link'] || '');
    var id = String(d['File ID'] || '') || _driveIdFromUrl(stored);
    if (!id) { noId++; problems.push('no file id: ' + d['Doc ID'] + ' ' + d['File Name']); return; }
    var f;
    try { f = DriveApp.getFileById(id); }
    catch (e) { gone++; problems.push('cannot open: ' + d['Doc ID'] + ' ' + d['File Name'] + ' (' + e.message + ')'); return; }
    if (f.isTrashed()) { trashed++; problems.push('in the trash: ' + d['Doc ID'] + ' ' + d['File Name']); return; }
    // The stored link must still point at this exact file — that is what every "open" in the UI uses.
    if (_driveIdFromUrl(stored) && _driveIdFromUrl(stored) !== f.getId()) {
      urlDrift++; problems.push('link points elsewhere: ' + d['Doc ID'] + ' ' + d['File Name']);
      return;
    }
    try {
      if (f.getSharingAccess() === DriveApp.Access.PRIVATE) {
        notShared++; problems.push('not link-shareable: ' + d['Doc ID'] + ' ' + d['File Name']);
      }
    } catch (e) { /* a Shared Drive can refuse to report this; not a failure */ }
    okDocs++;
  });

  say('Documents registry');
  say('  rows              : ' + docs.length);
  say('  open cleanly      : ' + okDocs);
  say('  no file id        : ' + noId);
  say('  cannot be opened  : ' + gone);
  say('  in the trash      : ' + trashed);
  say('  link drifted      : ' + urlDrift);
  say('  not link-shared   : ' + notShared);

  // The four records that store their own PDF Link, which the registry does not cover.
  var sheets = [['Quotations', 'Quotation No'], ['PricingRequests', 'PR No'],
                ['PurchaseOrders', 'PO No'], ['PaymentRequests', 'PR No']];
  say('');
  say('PDF Link columns held outside the registry');
  sheets.forEach(function (s) {
    var rows = _memoRows(s[0]), have = 0, ok = 0;
    rows.forEach(function (r) {
      var link = String(r['PDF Link'] || '');
      if (!link) return;
      have++;
      var id = _driveIdFromUrl(link);
      if (!id) { problems.push(s[0] + ' ' + r[s[1]] + ': unparseable PDF Link'); return; }
      try { var f = DriveApp.getFileById(id); if (!f.isTrashed()) ok++;
            else problems.push(s[0] + ' ' + r[s[1]] + ': PDF is in the trash'); }
      catch (e) { problems.push(s[0] + ' ' + r[s[1]] + ': PDF cannot be opened'); }
    });
    say('  ' + s[0] + ': ' + ok + ' of ' + have + ' open cleanly');
  });

  say('');
  if (problems.length) {
    say('PROBLEMS (' + problems.length + '):');
    problems.slice(0, 60).forEach(function (m) { say('  ' + m); });
    if (problems.length > 60) say('  ... and ' + (problems.length - 60) + ' more');
  } else {
    say('Every document in the system opens. Nothing is missing, trashed or relinked.');
  }
  return out.join('\n');
}

/** A194 · Select this and press Run. Takes no arguments.
 *
 *  A193 filed as <client>/<sales order>/..., so client folders were created at the ROOT. A194 files
 *  as <year>/<month>/<client>/..., and the migration moves FILES, not folders — so those original
 *  root-level client folders are left behind, empty, once everything has been re-filed.
 *
 *  This trashes them. It is deliberately timid: a folder is only removed when it contains NO files
 *  anywhere inside it, checked recursively. Anything still holding a file is reported and left
 *  exactly where it is — that means the migration has not finished, and deleting it would destroy
 *  documents. Year folders, Undated and _Unknown Client are never touched.
 *
 *  Trashed, not deleted: everything stays recoverable from the Drive bin. */
function cleanupLegacyFolders(p) {
  p = p || {};
  var dryRun = !(p.apply === true || String(p.apply) === 'true');   // SAFE BY DEFAULT: preview first
  var out = [], removed = 0, kept = 0, scanned = 0;
  function say(s) { out.push(s); Logger.log(s); }

  function countFiles(folder, depth) {
    var n = 0;
    try {
      var fi = folder.getFiles();
      while (fi.hasNext()) { fi.next(); n++; if (n > 0) return n; }
      if (depth > 8) return n;
      var sub = folder.getFolders();
      while (sub.hasNext()) { n += countFiles(sub.next(), depth + 1); if (n > 0) return n; }
    } catch (e) { return 1; }   // cannot inspect it -> assume occupied, never delete
    return n;
  }

  var root;
  try { root = _rootFolder(); } catch (e) { return 'Cannot open the Drive folder: ' + e.message; }
  say(dryRun ? 'DRY RUN — nothing will be trashed. Re-run as cleanupLegacyFoldersApply() to apply.'
             : 'APPLYING — empty leftover folders will be moved to the Drive bin.');
  say('');
  var it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next(), name = f.getName();
    // The A194 tree itself, and the two buckets that legitimately live at the root.
    if (/^\d{4}$/.test(name) || name === _FLOW_UNDATED || name === _FLOW_UNKNOWN_CLIENT) continue;
    scanned++;
    var n = countFiles(f, 0);
    if (n > 0) { kept++; say('  KEPT (still holds files) : ' + name); continue; }
    if (!dryRun) { try { f.setTrashed(true); } catch (e) { say('  could not trash: ' + name + ' (' + e.message + ')'); continue; } }
    removed++;
    say('  ' + (dryRun ? 'would trash (empty)      : ' : 'trashed (empty)          : ') + name);
  }
  say('');
  say('Scanned ' + scanned + ' root folder(s): ' + removed + (dryRun ? ' would be trashed' : ' trashed') + ', ' + kept + ' kept.');
  if (kept) say('Folders that still hold files were LEFT ALONE — run runDriveMigrationAll() first, then this again.');
  return out.join('\n');
}

/** A194 · The one that actually trashes. Run cleanupLegacyFolders() first and read what it says. */
function cleanupLegacyFoldersApply() { return cleanupLegacyFolders({ apply: true }); }

/** A194 · Select this and press Run. Moves the existing files, looping until finished. Safe to
 *  re-run: anything already in place is skipped. Run buildDriveSkeletonAll() and the preview first. */
function runDriveMigrationAll() {
  var offset = 0, moved = 0, already = 0, errors = 0, rounds = 0, log = [];
  while (rounds < 40) {
    var r = runDriveMigration({ offset: offset, limit: 40 });
    moved += r.moved; already += r.alreadyInPlace; errors += r.errors; rounds++;
    r.log.forEach(function (l) { if (l.error) log.push(l); });
    if (r.nextOffset === null) break;
    offset = r.nextOffset;
  }
  var msg = 'Moved ' + moved + ' file(s); ' + already + ' already in place; ' + errors + ' error(s).';
  if (log.length) msg += '\n' + log.map(function (l) { return '  ' + l.docId + ': ' + l.error; }).join('\n');
  Logger.log(msg);
  return msg;
}

/** A193 · A readable summary of previewDriveMigration, for pressing Run in the editor.
 *  Read-only: creates nothing, moves nothing. */
function previewDriveMigrationReport() {
  var r = previewDriveMigration({});
  var out = [];
  function say(s) { out.push(s); Logger.log(s); }
  say('Documents            : ' + r.total);
  say('Resolved to a client : ' + r.resolved);
  say('No client to file to : ' + r.unresolved + '  (they go to ' + _FLOW_UNKNOWN_CLIENT + ')');
  say('Waiting for their SO : ' + r.preSalesOrder + '  (in ' + _FLOW_PRESO_FOLDER + ')');
  say('Undatable            : ' + r.undated);
  if (r.inaccessible.length || r.notOwned.length) {
    say('');
    say('--- FILES THAT MAY NOT MOVE CLEANLY ---');
    r.inaccessible.forEach(function (f) { say('  cannot open : ' + f.docId + ' ' + f.fileName + ' (' + f.error + ')'); });
    r.notOwned.forEach(function (f) { say('  owned by ' + f.owner + ' : ' + f.docId + ' ' + f.fileName); });
  }
  say('');
  say('--- documents per month ---');
  Object.keys(r.byMonth).sort().forEach(function (m) { say('  ' + r.byMonth[m] + '\t' + m); });
  say('');
  say('--- documents per client folder ---');
  Object.keys(r.byClient).sort(function (a, b) { return r.byClient[b] - r.byClient[a]; })
    .forEach(function (c) { say('  ' + r.byClient[c] + '\t' + c); });
  if (r.possibleTypos.length) {
    say('');
    say('--- NEAR-IDENTICAL CLIENT NAMES — these will NOT be merged automatically ---');
    say('    If a pair is really one client, point both Raw Names at the same Canonical');
    say('    in the ClientAliases sheet, then run the migration.');
    r.possibleTypos.forEach(function (t) { say('  ' + t.a + '   <->   ' + t.b); });
  }
  say('');
  say('Nothing was created or moved.');
  return out.join('\n');
}

/** Parse a Drive file id from a share URL (…/d/<id>/… or ?id=<id>). '' if none. */
function _driveIdFromUrl(url) {
  var s = String(url || '');
  var m = s.match(/\/d\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

/** A151: register a generated PDF in the Documents registry so getDocuments / the lifecycle tracker
 *  can see it (auto-PDFs used to live only in the parent record's PDF Link column). Idempotent. */
/* A158: is this Documents row a PDF the system produced from the record itself, rather than a
   document someone attached as evidence? The A144 "attach a supporting document" gates ask for the
   latter, so they have to be able to tell them apart — otherwise clicking "PDF" satisfies the gate. */
var _GENERATED_DOC_TYPE = 'Generated PDF';
function _isGeneratedDoc(d) {
  return String(d['Doc Type'] || '').trim().toLowerCase().indexOf('generated pdf') === 0;
}

function _registerDocument(module, refNo, fileName, url, fileId, actorName) {
  try {
    if (!module || !refNo || !url) return;
    var rows = _rows('Documents');
    // Exact same file already registered → nothing to do.
    if (rows.some(function (r) { return String(r['Drive Link']) === String(url); })) return;
    // A regenerated PDF for the same record (revise → new file). A158: the previous row is marked
    // superseded rather than overwritten, so the registry still points at exactly one CURRENT file
    // while the earlier documents — the ones a client may already be holding — remain traceable.
    var sh = _sheet('Documents');
    rows.filter(function (r) {
      return String(r['Module']) === String(module) && String(r['Ref No']) === String(refNo) &&
        String(r['Doc Type']) === _GENERATED_DOC_TYPE;
    }).forEach(function (prev) {
      sh.getRange(prev.rowIndex, SCHEMA.Documents.indexOf('Doc Type') + 1, 1, 1)
        .setValues([[_GENERATED_DOC_TYPE + ' (superseded)']]);
    });
    _append('Documents', [_nextNumber('Documents', 1, 'DOC'), module, refNo, _GENERATED_DOC_TYPE,
      fileName || '', url, fileId || _driveIdFromUrl(url), actorName || 'System', _now()]);
  } catch (e) { /* never block the PDF save */ }
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
  var saved = _saveFileToDrive(p.pdfBase64, p.fileName || 'quotation.pdf', 'application/pdf',
    _docFolder('Quotation', p.quotationNo, _GENERATED_DOC_TYPE, _now()));   // A193 · A194 hint
  var link = saved.url;
  if (p.quotationNo) {
    _setCellByKey('Quotations', 'Quotation No', p.quotationNo, 'PDF Link', link);
    // What this PDF was rendered from (doc fields + a stamp of the figures it shows), so the UI can
    // tell later whether the saved document still matches the record.
    if (p.pdfData) _setCellByKey('Quotations', 'Quotation No', p.quotationNo, 'PDF Data JSON', p.pdfData);
    _registerDocument('Quotation', p.quotationNo, p.fileName, link, saved.id, p.actorName);
  }
  return { success: true, link: link, message: 'Quotation PDF saved to Drive.' };
}

function savePOPDF(p) {
  if (!p.pdfBase64) return { success: false, message: 'pdfBase64 required.' };
  var saved = _saveFileToDrive(p.pdfBase64, p.fileName || 'purchase-order.pdf', 'application/pdf',
    _docFolder('Purchase Order', p.poNo, _GENERATED_DOC_TYPE, _now()));   // A193 · A194 hint
  var link = saved.url;
  if (p.poNo) {
    _setCellByKey('PurchaseOrders', 'PO No', p.poNo, 'PDF Link', link);
    _registerDocument('Purchase Order', p.poNo, p.fileName, link, saved.id, p.actorName);
  }
  return { success: true, link: link, message: 'Purchase Order PDF saved to Drive.' };
}

// ── Generic per-record document attachments ──────────────────────────────────
function addDocument(p) {
  if (!p.module || !p.refNo) return { success: false, message: 'module and refNo are required.' };
  if (!p.fileBase64) return { success: false, message: 'fileBase64 is required.' };
  var saved = _saveFileToDrive(p.fileBase64, p.fileName || 'document', p.mimeType,
    _docFolder(p.module, p.refNo, p.docType, _now()));   // A193 — every hand-attached document
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

// A151: one-time — register every generated PDF that lives only in a parent record's "PDF Link" column
// into the Documents registry, so getDocuments / the lifecycle tracker can see it. Idempotent on Drive Link.
function backfillPdfDocuments(p) {
  var seen = {};
  _rows('Documents').forEach(function (r) { if (r['Drive Link']) seen[String(r['Drive Link'])] = true; });
  var created = 0;
  var scan = [
    ['Quotations', 'Quotation No', 'Quotation'],
    ['PurchaseOrders', 'PO No', 'Purchase Order'],
    ['PricingRequests', 'PR No', 'Pricing Request'],
    ['PaymentRequests', 'PR No', 'Payment Request']
  ];
  scan.forEach(function (s) {
    _rows(s[0]).forEach(function (r) {
      var link = String(r['PDF Link'] || '').trim();
      if (!link || seen[link]) return;
      _append('Documents', [_nextNumber('Documents', 1, 'DOC'), s[2], r[s[1]], 'Generated PDF',
        (r[s[1]] + '.pdf'), link, _driveIdFromUrl(link), 'Backfill', _now()]);
      seen[link] = true; created++;
    });
  });
  return { success: true, created: created, message: 'Registered ' + created + ' existing PDF(s).' };
}

// A151: build the set of (module, refNo) pairs across an SO's whole lifecycle chain, for the aggregate
// document view. Uses the new Quotations.PR No to reach the originating pricing request.
function _soDocChain(soNo) {
  var so = _rows('SalesOrders').filter(function (r) { return String(r['SO No']) === String(soNo); })[0];
  var refs = [['Sales Order', soNo]];
  var quoteNo = so && so['Quotation No'];
  if (quoteNo) {
    refs.push(['Quotation', quoteNo]);
    var q = _rows('Quotations').filter(function (r) { return String(r['Quotation No']) === String(quoteNo); })[0];
    if (q && q['PR No']) refs.push(['Pricing Request', q['PR No']]);
  }
  var poSet = {};
  _rows('PurchaseOrders').forEach(function (po) {
    if (String(po['SO No']) === String(soNo)) { refs.push(['Purchase Order', po['PO No']]); poSet[String(po['PO No'])] = true; }
  });
  _rows('PaymentRequests').forEach(function (r) {
    if (String(r['SO No']) === String(soNo) || poSet[String(r['PO No'])]) refs.push(['Payment Request', r['PR No']]);
  });
  _rows('APAging').forEach(function (r) { if (poSet[String(r['PO No'])]) refs.push(['AP Aging', r['AP No']]); });
  _rows('MaterialsReceiving').forEach(function (r) {
    if (String(r['SO No']) === String(soNo) || poSet[String(r['PO No'])]) refs.push(['Receiving', r['MR No']]);
  });
  _rows('Invoices').forEach(function (r) { if (String(r['SO No']) === String(soNo)) refs.push(['Invoice', r['INV No']]); });
  _rows('ARAging').forEach(function (r) { if (String(r['SO No']) === String(soNo)) refs.push(['AR Aging', r['AR No']]); });
  // A193: Collections was the one lifecycle sheet this chain never queried, so a proof of payment
  // attached to a collection was invisible to the SO's document view.
  _rows('Collections').forEach(function (r) { if (String(r['SO No']) === String(soNo)) refs.push(['Collection', r['Collection No']]); });
  _rows('Shipments').forEach(function (r) { if (String(r['SO No']) === String(soNo)) refs.push(['Shipment', r['Shipment ID']]); });
  return refs;
}

// A151: aggregate a whole SO's documents + its lifecycle timeline in ONE server round-trip.
function getSOLifecycle(p) {
  if (!p.soNo) return { success: false, message: 'soNo required.' };
  var refs = _soDocChain(p.soNo);
  var key = {}; refs.forEach(function (x) { key[String(x[0]) + '|' + String(x[1])] = true; });
  var docs = _rows('Documents').filter(function (r) {
    return key[String(r['Module']) + '|' + String(r['Ref No'])];
  }).map(function (r) {
    return { docId: r['Doc ID'], module: r['Module'], refNo: r['Ref No'], docType: r['Doc Type'],
      fileName: r['File Name'], link: r['Drive Link'], uploadedBy: r['Uploaded By'], uploadedAt: r['Uploaded At'] };
  });
  var ship = _rows('Shipments').filter(function (r) { return String(r['SO No']) === String(p.soNo); })[0];
  var timeline = ship ? _shipTimeline(_shipMap(ship)) : [];
  return { success: true, soNo: p.soNo, chain: refs, documents: docs, timeline: timeline,
    shipmentId: ship ? ship['Shipment ID'] : '' };
}

// Thin wrapper for callers that only want an SO's aggregated document list.
function getDocumentsForSO(p) {
  var r = getSOLifecycle(p);
  return { success: r.success, data: r.documents || [], message: r.message };
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

/* True ONLY when the saved PDF's stamp positively proves it shows different figures from the record.
   A missing/unparseable stamp returns false — legacy documents must never be blocked by a guess (the
   UI is the stricter gate). Compares pure numbers (line count, total qty, total amount, discount) so
   date/string formatting differences between client and server can't raise a false alarm. */
function _quotationPdfMismatch(q) {
  try {
    if (!q || !q['PDF Link'] || !q['PDF Data JSON']) return false;
    var stamp = (JSON.parse(q['PDF Data JSON']) || {}).stamp;
    if (!stamp || !stamp.items || !stamp.items.length) return false;
    var was = { n: stamp.items.length, qty: 0, amt: 0 };
    stamp.items.forEach(function (s) {
      var f = String(s).split('|');
      was.qty += _num(f[1]); was.amt += _num(f[1]) * _num(f[2]);
    });
    var its = _rows('QuotationItems').filter(function (r) {
      return String(r['Quotation No']) === String(q['Quotation No']);
    });
    var now = { n: its.length, qty: 0, amt: 0 };
    its.forEach(function (r) { now.qty += _num(r['Quoted Qty']); now.amt += _num(r['Quoted Qty']) * _num(r['Quoted Price']); });
    // A147: also compare the header fields the client stamp covers (customer/date/subject) so a changed
    // header can't be approved with a stale PDF. Only compare a stamp field when it was recorded (older
    // stamps predate these keys) so no false alarm on legacy stamps. Date is normalized both sides.
    if (stamp.customer !== undefined && String(stamp.customer) !== String(q['Customer'] || '')) return true;
    if (stamp.subject !== undefined && String(stamp.subject) !== String(q['Subject'] || '')) return true;
    if (stamp.date !== undefined && String(stamp.date) && String(stamp.date) !== _dateStr(q['Date'])) return true;
    return was.n !== now.n || Math.abs(was.qty - now.qty) > 0.001 || Math.abs(was.amt - now.amt) > 0.01
      || _num(stamp.discountPct) !== _num(q['Discount %']);
  } catch (e) { return false; }
}

function approveQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var st = String(q['Status'] || '');
  var role = p.actorRole || '';
  if (_quotationPdfMismatch(q)) {
    return { success: false, message: 'The saved PDF does not match this quotation — regenerate it before approving.' };
  }
  /* A158 — a from-PR quotation lands as a Draft the rep can edit, and approval only ever looked at the
     quotation itself. So management's final prices could be cut before the client saw them, with the
     approvers reviewing the reduced figures and no trace of the original. The deviation is surfaced and
     must be acknowledged; it is not silently blocked, because discounting IS sometimes the intent. */
  if (!p.acknowledgeDeviation) {
    var dev = _quotationPrDeviation(q);
    if (dev && dev.lines.length) {
      return { success: false, needsConfirm: 'prDeviation', prNo: dev.prNo, deviations: dev.lines,
        message: 'This quotation differs from the prices management set on ' + dev.prNo + ': ' +
          dev.lines.map(function (d) { return d.item + ' ' + d.was.toFixed(2) + ' → ' + d.now.toFixed(2); }).join('; ') +
          '. Approve anyway?' };
    }
  }
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

/** Reopen an Approved or Sent quotation for revision — the client asked for different pricing, or a
 *  figure was wrong. Returns it to Draft (same number, so the client keeps quoting one reference) and
 *  clears the approval, because a re-priced quotation must be approved again before it is re-sent.
 *  The previously sent PDF stays in Drive on the record's PDF Link, so the old version is not lost. */
function reviseQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var st = String(q['Status'] || '');
  if (st !== 'Sent' && st !== 'Approved') {
    return { success: false, message: 'Only an Approved or Sent quotation can be revised (now: ' + (st || 'Draft') + ').' };
  }
  var who = p.actorName || '';
  var note = 'Reopened for revision' + (who ? ' by ' + who : '') + (p.reason ? ' — ' + p.reason : '');
  _setQuotationCells(p.quotationNo, {
    'Status': 'Draft', 'Approved By': '', 'Approved At': '', 'Approval Note': note,
  });
  return { success: true, quotationNo: p.quotationNo, status: 'Draft', previousStatus: st,
    message: 'Quotation reopened for revision — it will need approval again before it can be sent.' };
}

// A152: the three terminal "the client didn't pursue this" outcomes. Soft-close only — the record stays
// for win/loss reporting and can be reopened. Setting one of these overwrites Sent/Approved/etc., so every
// status-based nudge/badge/queue that keyed on the old status goes quiet automatically.
var _QUOTE_CLOSED = ['Not Pursued', 'Lost', 'Cancelled'];

/** Close a quotation the client never pursued into a Sales Order (soft). Outcome is one of _QUOTE_CLOSED. */
function closeQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var outcome = _QUOTE_CLOSED.indexOf(String(p.outcome)) !== -1 ? String(p.outcome) : 'Not Pursued';
  var st = String(q['Status'] || '');
  if (_QUOTE_CLOSED.indexOf(st) !== -1) return { success: false, message: 'Quotation is already closed (' + st + ').' };
  var role = p.actorRole || '';
  var allowed = String(q['Created By']) === String(p.actorName) ||
    ['admin', 'management', 'director'].indexOf(role) !== -1;   // a sales rep can close only their OWN
  if (!allowed) return { success: false, message: 'You cannot close this quotation.' };
  // A quotation the client DID pursue (a Sales Order references it) is won, not lost — don't let it be closed.
  if (_rows('SalesOrders').some(function (s) { return String(s['Quotation No']) === String(p.quotationNo); }))
    return { success: false, message: 'This quotation already has a Sales Order — it can\'t be closed as not-pursued.' };
  var who = p.actorName || '';
  var note = 'Closed as ' + outcome + (who ? ' by ' + who : '') + (p.reason ? ' — ' + p.reason : '');
  _setQuotationCells(p.quotationNo, { 'Status': outcome, 'Approval Note': note });
  return { success: true, quotationNo: p.quotationNo, status: outcome, previousStatus: st,
    message: 'Quotation closed as ' + outcome + '.' };
}

/** Reopen a closed (Not Pursued/Lost/Cancelled) quotation back to Draft — the client came back. */
function reopenQuotation(p) {
  if (!p.quotationNo) return { success: false, message: 'quotationNo required.' };
  var q = _quotationRow(p.quotationNo);
  if (!q) return { success: false, message: 'Quotation not found.' };
  var st = String(q['Status'] || '');
  if (_QUOTE_CLOSED.indexOf(st) === -1) return { success: false, message: 'Only a closed quotation can be reopened (now: ' + (st || 'Draft') + ').' };
  var role = p.actorRole || '';
  var allowed = String(q['Created By']) === String(p.actorName) ||
    ['admin', 'management', 'director'].indexOf(role) !== -1;   // a sales rep can reopen only their OWN
  if (!allowed) return { success: false, message: 'You cannot reopen this quotation.' };
  _setQuotationCells(p.quotationNo, { 'Status': 'Draft', 'Approval Note': 'Reopened from ' + st + (p.actorName ? ' by ' + p.actorName : '') });
  return { success: true, quotationNo: p.quotationNo, status: 'Draft', previousStatus: st,
    message: 'Quotation reopened to Draft.' };
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
  // A144: a PO must carry a supporting document before it advances to approval.
  // A158: the PO's own generated PDF doesn't satisfy it — the point is the supplier's quotation.
  var hasDoc = _rows('Documents').some(function (d) {
    return String(d['Module']) === 'Purchase Order' && String(d['Ref No']) === String(p.poNo)
      && !_isGeneratedDoc(d);
  });
  if (!hasDoc) return { success: false, message: 'Attach a supporting document (the supplier quotation) before submitting — the PO\'s own generated PDF does not count.' };
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

/* ── A189: Client visits ──────────────────────────────────────────────────────────────────────
   The face-to-face counterpart of the call log, and read the same way: scoped by rep + date on the
   rep's own daily report, and rolled up for the whole team on the management view. Deliberately a
   sheet of its own rather than an Outcome value on SalesCalls — a visit carries where it happened
   and what was discussed, which a call row has nowhere to put. */

function getClientVisits(p) {
  var rows = _rows('ClientVisits');
  if (p && p.date) rows = rows.filter(function (r) { return _dateStr(r['Date']) === String(p.date); });
  if (p && p.user) rows = rows.filter(function (r) { return String(r['User']) === String(p.user); });
  // Newest first, but by the reported visit TIME where there is one — a rep logging the morning and
  // afternoon visits together in the evening should still read in the order the day happened.
  rows.sort(function (a, b) {
    var ta = String(a['Time'] || ''), tb = String(b['Time'] || '');
    if (ta && tb && ta !== tb) return tb.localeCompare(ta);
    return new Date(b['Created At']) - new Date(a['Created At']);
  });
  return { success: true, data: rows.map(function (r) {
    return {
      visitNo: r['Visit No'], date: _dateStr(r['Date']), user: r['User'], time: r['Time'],
      personVisited: r['Person Visited'], company: r['Company'], cityAddress: r['City Address'],
      agenda: r['Agenda'], summaryOfAgenda: r['Summary of Agenda'],
      photoDocId: r['Photo Doc ID'], itineraryItem: r['Itinerary Item'],
      createdAt: r['Created At'], rowIndex: r.rowIndex
    };
  }) };
}

function logClientVisit(p) {
  var person = String(p.personVisited || '').trim();
  var company = String(p.company || '').trim();
  // Same rule as logSalesCall: one of the two identifies the visit. Requiring both would push reps
  // into typing placeholders, which is worse than a blank field.
  if (!person && !company) return { success: false, message: 'Person visited or company is required.' };

  /* A190 — the photo is REQUIRED, and enforced HERE as well as on the form. A client-only gate is
     the pattern the A188 review found being bypassed elsewhere, and this one carries evidentiary
     weight: the photo is what says the rep was actually there. The message names the way out so a
     rep who genuinely cannot photograph the site talks to someone instead of logging nothing —
     a visit missing from the record entirely is worse than one missing its picture. */
  var photo = String(p.photoBase64 || '');
  if (!photo) {
    return { success: false, needsPhoto: true,
             message: 'A photo is required to log a client visit. If you could not take one — ' +
                      'site policy, no phone — ask your manager to record the visit for you.' };
  }

  var no = _nextNumber('ClientVisits', 1, 'VISIT');
  var date = p.date ? _dateStr(p.date) : _dateStr(_now());

  /* Row FIRST, photo second. The reverse leaves an orphaned Drive file every time the row write
     fails, and nothing in this system ever sweeps those up. */
  _append('ClientVisits', [no, date, p.actorName || '', String(p.time || '').trim(), person, company,
    String(p.cityAddress || '').trim(), String(p.agenda || '').trim(),
    String(p.summaryOfAgenda || '').trim(), '', String(p.itineraryItem || '').trim(), _now()]);

  var docId = '';
  try {
    /* A193: a visit has no sales order, but `company` IS the client — so the photo files under
       <client>/Client Visits/ rather than being dumped in the root. */
    var vFolder = null;
    try {
      _registerClient(company);
      var vc = _canonClient(company);
      // A194: dated by the visit itself — a visit has no sales order to inherit a date from.
      if (vc.key) vFolder = _ensurePath(_ymSegments(date).concat([vc.display, 'Client Visits']));
    } catch (e) { vFolder = null; }
    var saved = _saveFileToDrive(photo, 'visit-' + no + '.jpg', p.photoMimeType || 'image/jpeg', vFolder);
    docId = 'DOC-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    _append('Documents', [docId, 'Client Visit', no, 'Visit Photo', 'visit-' + no + '.jpg',
      saved.url, saved.id, p.actorName || '', _now()]);
    _cvSet(no, { 'Photo Doc ID': docId });
  } catch (e) {
    // The visit is already recorded, which is the part that matters. Say the photo failed rather
    // than pretending it saved — a silent success here would leave a visit that looks documented.
    return { success: true, visitNo: no, refNo: company || person, photoFailed: true,
             message: 'Visit logged, but the photo could not be saved (' + e.message +
                      '). Re-attach it from the visit list.' };
  }

  return { success: true, visitNo: no, refNo: company || person, photoDocId: docId,
    message: 'Visit logged' + (company ? ' — ' + company : (person ? ' — ' + person : '')) };
}

/** Patch one ClientVisits row by Visit No. Mirrors _prSet. */
function _cvSet(visitNo, patch) {
  var sh = _sheet('ClientVisits');
  var headers = SCHEMA.ClientVisits;
  var rows = _rows('ClientVisits');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Visit No']) !== String(visitNo)) continue;
    Object.keys(patch).forEach(function (k) {
      var c = headers.indexOf(k);
      if (c >= 0) sh.getRange(rows[i].rowIndex, c + 1).setValue(patch[k]);
    });
    return true;
  }
  return false;
}

/** A190 — visit photos as base64, the getQuotationPhotos shape.
 *  Returns bytes rather than a Drive link on purpose: a Drive /view or /preview URL serves an HTML
 *  page, so it renders as a broken image in an <img> — the exact dead end already sitting in
 *  management-home.js and accounting-home.js. The client builds a data: URI from what comes back.
 *  Fetched per expanded card rather than for a whole team at once; each photo is a Drive round trip. */
function getVisitPhotos(p) {
  var rows = _rows('ClientVisits');
  if (p && p.visitNo) rows = rows.filter(function (r) { return String(r['Visit No']) === String(p.visitNo); });
  if (p && p.date) rows = rows.filter(function (r) { return _dateStr(r['Date']) === String(p.date); });
  if (p && p.user) rows = rows.filter(function (r) { return String(r['User']) === String(p.user); });

  var docs = _rows('Documents').filter(function (d) { return String(d['Module']) === 'Client Visit'; });
  var byRef = {};
  docs.forEach(function (d) { byRef[String(d['Ref No'])] = d; });

  var out = [];
  rows.forEach(function (r) {
    var d = byRef[String(r['Visit No'])];
    if (!d || !d['File ID']) return;
    try {
      var blob = DriveApp.getFileById(d['File ID']).getBlob();
      out.push({ visitNo: r['Visit No'], docId: d['Doc ID'],
                 mimeType: blob.getContentType(),
                 base64: Utilities.base64Encode(blob.getBytes()) });
    } catch (e) { /* trashed file — skip it rather than break the whole card */ }
  });
  return { success: true, data: out };
}

function deleteClientVisit(p) {
  var ri = parseInt(p.rowIndex, 10);
  if (!ri) return { success: false, message: 'rowIndex required.' };
  var rows = _rows('ClientVisits');
  var row = rows.filter(function (r) { return r.rowIndex === ri; })[0];
  // Identity re-check before deleting by position: the list the rep is looking at may be stale, and
  // a bare rowIndex delete would remove whichever visit has since shifted into that slot.
  if (!row) return { success: false, message: 'Visit not found — refresh and try again.' };
  if (p.visitNo && String(row['Visit No']) !== String(p.visitNo)) {
    return { success: false, staleRow: true,
             message: 'That row has moved since the list was loaded. Refresh and try again.' };
  }
  _sheet('ClientVisits').deleteRow(ri);
  return { success: true, refNo: row['Visit No'], message: 'Visit removed.' };
}

/* ── A190: Weekly Itinerary ───────────────────────────────────────────────────────────────────
   A rep's planned client visits for a Mon–Sun week, approved before the week runs.

   THE CHAIN IS DIRECTOR FIRST, THEN MANAGEMENT — the reverse of _PR_STAGES. That is a deliberate
   decision, not a copy/paste slip: read the table below rather than assuming the payment-request
   order. Everything else follows the payment-request semantics, which are the strongest in this
   codebase: exact-role match per stage, any approver may reject with a reason, and revise returns
   the record to Draft clearing EVERY stamp so an approval can never survive an edit. */

var _ITIN_STAGES = [
  { status: 'Pending Director',   role: 'director',   by: 'Dir Approved By',  at: 'Dir Approved At',
    next: 'Pending Management', who: 'the director' },
  { status: 'Pending Management', role: 'management', by: 'Mgmt Approved By', at: 'Mgmt Approved At',
    next: 'Approved',           who: 'management' }
];

function _itinStage(status) {
  var s = String(status || '');
  for (var i = 0; i < _ITIN_STAGES.length; i++) if (_ITIN_STAGES[i].status === s) return _ITIN_STAGES[i];
  return null;
}

/** Draft/Rejected only — an itinerary under approval or already approved is not editable in place. */
function _itinEditable(status) {
  var s = String(status || 'Draft');
  return s === 'Draft' || s === 'Rejected' || s === '';
}

function _itinRow(no) {
  return _rows('WeeklyItineraries').filter(function (r) { return String(r['Itinerary No']) === String(no); })[0];
}

function _itinSet(no, patch) {
  var sh = _sheet('WeeklyItineraries');
  var headers = SCHEMA.WeeklyItineraries;
  var r = _itinRow(no);
  if (!r) return false;
  Object.keys(patch).forEach(function (k) {
    var c = headers.indexOf(k);
    if (c >= 0) sh.getRange(r.rowIndex, c + 1).setValue(patch[k]);
  });
  var u = headers.indexOf('Updated At');
  if (u >= 0) sh.getRange(r.rowIndex, u + 1).setValue(_now());
  return true;
}

function _itinMap(r, items) {
  return {
    itineraryNo: r['Itinerary No'], weekStart: _dateStr(r['Week Start']), weekEnd: _dateStr(r['Week End']),
    user: r['User'], status: r['Status'] || 'Draft', objectives: r['Objectives'], notes: r['Notes'],
    createdBy: r['Created By'], createdByRole: r['Created By Role'],
    createdAt: r['Created At'], updatedAt: r['Updated At'],
    dirApprovedBy: r['Dir Approved By'], dirApprovedAt: r['Dir Approved At'],
    mgmtApprovedBy: r['Mgmt Approved By'], mgmtApprovedAt: r['Mgmt Approved At'],
    approvalNote: r['Approval Note'], rowIndex: r.rowIndex,
    items: items || []
  };
}

function getWeeklyItineraries(p) {
  var rows = _rows('WeeklyItineraries');
  if (p && p.user) rows = rows.filter(function (r) { return String(r['User']) === String(p.user); });
  if (p && p.weekStart) rows = rows.filter(function (r) { return _dateStr(r['Week Start']) === String(p.weekStart); });
  if (p && p.status) rows = rows.filter(function (r) { return String(r['Status'] || 'Draft') === String(p.status); });
  if (p && p.itineraryNo) rows = rows.filter(function (r) { return String(r['Itinerary No']) === String(p.itineraryNo); });

  var allItems = _rows('ItineraryItems');
  rows.sort(function (a, b) { return String(b['Week Start']).localeCompare(String(a['Week Start'])); });
  return { success: true, data: rows.map(function (r) {
    var its = allItems.filter(function (i) { return String(i['Itinerary No']) === String(r['Itinerary No']); })
      .sort(function (a, b) { return _num(a['Seq']) - _num(b['Seq']); })
      .map(function (i) {
        return { seq: _num(i['Seq']), day: i['Day'], date: _dateStr(i['Date']), plannedTime: i['Planned Time'],
                 company: i['Company'], personToMeet: i['Person To Meet'], cityArea: i['City Area'],
                 purpose: i['Purpose'], agenda: i['Agenda'], expectedOutcome: i['Expected Outcome'] };
      });
    return _itinMap(r, its);
  }) };
}

/** Upsert a DRAFT. One itinerary per (user, week) — a second plan for the same week is an edit of
 *  the first, never a rival record, or approvals would race each other. */
function saveWeeklyItinerary(p) {
  var user = String(p.actorName || p.user || '').trim();
  var weekStart = _dateStr(p.weekStart || '');
  if (!user) return { success: false, message: 'User is required.' };
  if (!weekStart) return { success: false, message: 'Week start is required.' };
  var items = JSON.parse(p.items || '[]');

  var existing = _rows('WeeklyItineraries').filter(function (r) {
    return String(r['User']) === user && _dateStr(r['Week Start']) === weekStart;
  })[0];

  var no;
  if (existing) {
    if (!_itinEditable(existing['Status'])) {
      return { success: false, message: 'This week is ' + existing['Status'] +
               ' — use Revise to reopen it before editing.' };
    }
    no = existing['Itinerary No'];
    _itinSet(no, { 'Week End': _dateStr(p.weekEnd || ''), 'Objectives': p.objectives || '',
                   'Notes': p.notes || '' });
  } else {
    no = _nextNumber('WeeklyItineraries', 1, 'ITIN');
    _append('WeeklyItineraries', [no, weekStart, _dateStr(p.weekEnd || ''), user, 'Draft',
      p.objectives || '', p.notes || '', user, String(p.actorRole || 'sales'), _now(), _now(),
      '', '', '', '', '']);
  }

  _writeItems('ItineraryItems', 'Itinerary No', no, items, function (it, idx) {
    return [no, _num(it.seq) || 0, it.day || '', _dateStr(it.date || ''), it.plannedTime || '',
            it.company || '', it.personToMeet || '', it.cityArea || '', it.purpose || '',
            it.agenda || '', it.expectedOutcome || ''];
  });
  return { success: true, itineraryNo: no, refNo: no, message: 'Itinerary saved.' };
}

function submitWeeklyItinerary(p) {
  var r = _itinRow(p.itineraryNo);
  if (!r) return { success: false, message: 'Itinerary not found.' };
  var st = String(r['Status'] || 'Draft');
  if (st !== 'Draft' && st !== 'Rejected') return { success: false, message: 'Already submitted (' + st + ').' };
  var items = _rows('ItineraryItems').filter(function (i) {
    return String(i['Itinerary No']) === String(p.itineraryNo);
  });
  // An empty plan cannot be approved into anything meaningful.
  if (!items.length) return { success: false, message: 'Add at least one planned visit before submitting.' };
  _itinSet(p.itineraryNo, { 'Status': _ITIN_STAGES[0].status, 'Approval Note': '' });
  return { success: true, itineraryNo: p.itineraryNo, refNo: p.itineraryNo,
           status: _ITIN_STAGES[0].status, message: 'Submitted for approval.' };
}

function approveWeeklyItinerary(p) {
  var r = _itinRow(p.itineraryNo);
  if (!r) return { success: false, message: 'Itinerary not found.' };
  var st = String(r['Status'] || '');
  var stage = _itinStage(st);
  if (!stage) return { success: false, message: 'Not awaiting approval at this stage (' + st + ').' };
  var role = String(p.actorRole || '').toLowerCase();
  if (role !== stage.role) return { success: false, message: 'Only ' + stage.who + ' can approve at this stage.' };
  var patch = { 'Status': stage.next };
  patch[stage.by] = String(p.actorName || '');
  patch[stage.at] = _now();
  _itinSet(p.itineraryNo, patch);
  return { success: true, itineraryNo: p.itineraryNo, refNo: p.itineraryNo, status: stage.next,
           message: stage.next === 'Approved' ? 'Itinerary approved.' : 'Approved — now with management.' };
}

function rejectWeeklyItinerary(p) {
  var r = _itinRow(p.itineraryNo);
  if (!r) return { success: false, message: 'Itinerary not found.' };
  var st = String(r['Status'] || '');
  if (st.indexOf('Pending') !== 0) return { success: false, message: 'Only a pending itinerary can be rejected.' };
  var role = String(p.actorRole || '').toLowerCase();
  if (['management', 'director'].indexOf(role) < 0) {
    return { success: false, message: 'You are not an approver for this itinerary.' };
  }
  _itinSet(p.itineraryNo, { 'Status': 'Rejected', 'Approval Note': String(p.reason || '') });
  return { success: true, itineraryNo: p.itineraryNo, refNo: p.itineraryNo, message: 'Itinerary rejected.' };
}

/** Reopen for editing. Clears BOTH stamp pairs — an approval must never survive a change to the
 *  plan it was given for. */
function reviseWeeklyItinerary(p) {
  var r = _itinRow(p.itineraryNo);
  if (!r) return { success: false, message: 'Itinerary not found.' };
  if (_itinEditable(r['Status'])) return { success: false, message: 'Already editable.' };
  var note = 'Reopened for revision by ' + String(p.actorName || '') +
             (p.reason ? ' — ' + p.reason : '');
  _itinSet(p.itineraryNo, {
    'Status': 'Draft', 'Dir Approved By': '', 'Dir Approved At': '',
    'Mgmt Approved By': '', 'Mgmt Approved At': '', 'Approval Note': note
  });
  return { success: true, itineraryNo: p.itineraryNo, refNo: p.itineraryNo, message: 'Reopened as a draft.' };
}

function deleteWeeklyItinerary(p) {
  var r = _itinRow(p.itineraryNo);
  if (!r) return { success: false, message: 'Itinerary not found.' };
  if (!_itinEditable(r['Status'])) {
    return { success: false, message: 'Only a draft or rejected itinerary can be deleted (this one is ' +
             r['Status'] + ').' };
  }
  _writeItems('ItineraryItems', 'Itinerary No', p.itineraryNo, [], function (x) { return x; });
  _sheet('WeeklyItineraries').deleteRow(r.rowIndex);
  return { success: true, refNo: p.itineraryNo, message: 'Itinerary deleted.' };
}

// ════════════════════════════════════════════════════════════════════════════
//  ACTIVITY LOG  (auto-logs every mutation → Accounting Daily Report)
// ════════════════════════════════════════════════════════════════════════════
var _MODULE_MAP = {
  saveSupplier: ['Supplier', 'Saved'], deleteSupplier: ['Supplier', 'Removed'],
  saveClient: ['Client', 'Saved'], deleteClient: ['Client', 'Removed'],
  addInventoryItem: ['Inventory', 'Added'], updateInventoryItem: ['Inventory', 'Updated'], deleteInventoryItem: ['Inventory', 'Deleted'],
  importInventory: ['Inventory', 'Imported'], classifyInventory: ['Inventory', 'Classified'],
  createQuotation: ['Quotation', 'Created'], updateQuotation: ['Quotation', 'Updated'], deleteQuotation: ['Quotation', 'Deleted'],
  createSalesOrder: ['Sales Order', 'Created'], updateSalesOrder: ['Sales Order', 'Updated'], deleteSalesOrder: ['Sales Order', 'Deleted'],
  importSalesOrders: ['Sales Order', 'Imported'],
  createPurchaseOrder: ['Purchase Order', 'Created'], updatePurchaseOrder: ['Purchase Order', 'Updated'], deletePurchaseOrder: ['Purchase Order', 'Deleted'],
  updateAPAging: ['AP Aging', 'Updated'], deleteAPEntry: ['AP Aging', 'Deleted'],
  updateARAging: ['AR Aging', 'Updated'], recordCollection: ['Collection', 'Recorded'],
  correctCollection: ['Collection', 'Corrected'],
  backfillItemIds: ['Inventory', 'Item IDs Assigned'],
  voidCollection: ['Collection', 'Voided'],
  voidInvoice: ['Invoice', 'Voided'],
  importCollections: ['Collection', 'Imported'],
  addExpense: ['Expense', 'Added'], updateExpense: ['Expense', 'Updated'],
  deleteExpense: ['Expense', 'Deleted'], importExpenses: ['Expense', 'Imported'],
  reclassifyExpenses: ['Expense', 'Reclassified'],
  createReceiving: ['Receiving', 'Received'],
  createInvoice: ['Invoice', 'Issued'],
  saveQuotationPDF: ['Quotation', 'PDF Saved'], savePOPDF: ['Purchase Order', 'PDF Saved'],
  createPricingRequest: ['Pricing Request', 'Created'], updatePRSourcing: ['Pricing Request', 'Sourced'],
  submitForPricing: ['Pricing Request', 'Forwarded'], setMgmtPricing: ['Pricing Request', 'Priced'],
  rejectMgmtPricing: ['Pricing Request', 'Pricing Rejected'],
  verifyReturnToSales: ['Pricing Request', 'Verified'], createQuotationFromPR: ['Pricing Request', 'Quoted'],
  savePRPDF: ['Pricing Request', 'PDF Saved'],
  addDocument: ['Document', 'Attached'], deleteDocument: ['Document', 'Removed'],
  submitQuotationApproval: ['Quotation', 'Submitted'], approveQuotation: ['Quotation', 'Approved'],
  rejectQuotation: ['Quotation', 'Rejected'], sendQuotation: ['Quotation', 'Sent'],
  reviseQuotation: ['Quotation', 'Revised'],
  reorderQuotationItems: ['Quotation', 'Reordered'],
  closeQuotation: ['Quotation', 'Closed'], reopenQuotation: ['Quotation', 'Reopened'],
  submitPOApproval: ['Purchase Order', 'Submitted'], approvePO: ['Purchase Order', 'Approved'],
  rejectPO: ['Purchase Order', 'Rejected'],
  saveMarketingRecord: ['Marketing', 'Saved'], deleteMarketingRecord: ['Marketing', 'Removed'],
  logSalesCall: ['Call', 'Logged'],
  // A189 — all three are mapped, including the delete. deleteSalesCall above is absent from this map
  // and so leaves no audit row at all; the visit log should not repeat that.
  saveSONotes: ['Sales Order', 'Note Saved'],   // A191
  logClientVisit: ['Client Visit', 'Logged'],
  deleteClientVisit: ['Client Visit', 'Removed'],
  // A190 — all six, deletes included. deleteSalesCall is still absent from this map and leaves no
  // audit row at all; an approved plan disappearing without a trace would be worse.
  saveWeeklyItinerary: ['Weekly Itinerary', 'Saved'],
  submitWeeklyItinerary: ['Weekly Itinerary', 'Submitted'],
  approveWeeklyItinerary: ['Weekly Itinerary', 'Approved'],
  rejectWeeklyItinerary: ['Weekly Itinerary', 'Rejected'],
  reviseWeeklyItinerary: ['Weekly Itinerary', 'Reopened'],
  deleteWeeklyItinerary: ['Weekly Itinerary', 'Deleted'],
  setOpeningBalance: ['Balance Sheet', 'Updated'],
  advanceShipmentStage: ['Shipment', 'Stage Updated'], updateShipment: ['Shipment', 'Updated'],
  createPaymentRequest: ['Payment Request', 'Created'], submitPaymentRequest: ['Payment Request', 'Submitted'],
  approvePaymentRequest: ['Payment Request', 'Approved'], rejectPaymentRequest: ['Payment Request', 'Rejected'],
  markPaymentRequestPaid: ['Payment Request', 'Paid'],
  savePaymentRequestPDF: ['Payment Request', 'PDF Saved'],
  revisePaymentRequest: ['Payment Request', 'Revised'],
  importSOCostDetails: ['Sales Order', 'Cost Imported'], saveSOCostDetails: ['Sales Order', 'Cost Edited'],
  backfillMigratedRecords: ['Sales Order', 'Records Backfilled'],
  deleteMigratedRecords: ['Sales Order', 'Migrated Cleared'],
  matchSupplierTypes: ['Sales Order', 'Type Matched'],
  importPricingSubmissions: ['Pricing Request', 'Imported'],
  // A151
  backfillShipments: ['Sales Order', 'Lifecycle Backfilled'], backfillPdfDocuments: ['Document', 'PDFs Backfilled'],
  backfillMissingAR: ['AR Aging', 'Backfilled'], setFlowDriveFolder: ['Balance Sheet', 'Config Updated'],
  // A193
  seedClientAliases: ['Client', 'Names Seeded'], runDriveMigration: ['Document', 'Filed to Drive'],
  buildDriveSkeleton: ['Sales Order', 'Folders Created'],
  cleanupLegacyFolders: ['Document', 'Folders Cleaned'], cleanupLegacyFoldersApply: ['Document', 'Folders Cleaned']
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
         || params.soNo || params.quotationNo || params.expNo || params.itemNo
         // A149: name-keyed records (client/supplier) have no doc number — fall through to the name so the
         // activity card shows WHICH client/supplier, and repeat saves of the same one collapse into one task.
         || result.customer || result.supplier || params.customer || params.supplier || '');
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

/* ── A191: per-sales-order notes ──────────────────────────────────────────────────────────────
   Read by anyone with oversight of a sales order; written from the Revenue & Net Profit report by
   accounting and admin. An idempotent UPSERT keyed on SO No — never an append: postFlow retries any
   action whose name starts with 'save' up to four times, so an appending writer would leave four
   copies of one note behind a flaky connection. */

function getSONotes(p) {
  var rows = _rows('SONotes');
  if (p && p.soNo) rows = rows.filter(function (r) { return String(r['SO No']) === String(p.soNo); });
  return { success: true, data: rows.map(function (r) {
    return { soNo: String(r['SO No']), notes: r['Notes'] || '',
             updatedBy: r['Updated By'] || '', updatedAt: r['Updated At'] || '', rowIndex: r.rowIndex };
  }) };
}

function saveSONotes(p) {
  var no = String((p && p.soNo) || '').trim();
  if (!no) return { success: false, message: 'soNo required.' };
  var sh = _sheet('SONotes');
  var headers = SCHEMA.SONotes;
  var rows = _rows('SONotes');
  var text = String((p && p.notes) || '');
  var who = String((p && p.actorName) || '');

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['SO No']) !== no) continue;
    // Column positions resolved from the schema, not a hard-coded width — saveDailyNote's
    // getRange(..., 1, 1, 4) is exactly the shape that broke when a sheet later grew a column.
    var set = function (header, value) {
      var c = headers.indexOf(header);
      if (c >= 0) sh.getRange(rows[i].rowIndex, c + 1).setValue(value);
    };
    set('Notes', text); set('Updated By', who); set('Updated At', _now());
    return { success: true, soNo: no, refNo: no, message: text ? 'Note saved.' : 'Note cleared.' };
  }
  _append('SONotes', [no, text, who, _now()]);
  return { success: true, soNo: no, refNo: no, message: 'Note saved.' };
}

// ── A167: Product Finder shared inquiry logbook ──────────────────────────────
// Upsert by Inquiry ID (the device-generated 'INQ-…' key), like saveDailyNote's scan-and-rewrite.
// Deliberately ABSENT from _MODULE_MAP: a Product Finder inquiry is not a daily-report task, so it
// must not append ActivityLog rows (same reasoning as saveDailyNote/submitDailyReport).
function savePfInquiry(p) {
  var id = String((p && p.id) || '').trim();
  if (!id) return { success: false, message: 'Inquiry id is required.' };
  var sh = _sheet('PFInquiries');
  var rows = _rows('PFInquiries');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Inquiry ID']) === id) {
      // MERGE, never rebuild. A caller may send a PARTIAL patch — e.g. the purchase-request page
      // stamps only {id, prNo} — and blanking Client / Raw Text / Recommendation on that write would
      // silently destroy the inquiry. Every field the caller omits keeps the cell that is already there.
      var r = rows[i];
      var keep = function (v, cur) { return v === undefined || v === null ? cur : v; };
      var merged = [
        id,
        r['Date'] || _now(),                                  // original date + user always survive
        r['User'] || String(p.actorName || p.user || ''),
        keep(p.source, r['Source'] || ''),
        keep(p.client, r['Client'] || ''),
        keep(p.industry, r['Industry'] || ''),
        keep(p.rawText, r['Raw Text'] || ''),
        keep(p.recommendation, r['Recommendation'] || ''),
        keep(p.status, r['Status'] || 'new'),
        keep(p.notes, r['Notes'] || ''),
        _now(),
        keep(p.itemsJson, r['Items JSON'] || ''),
        keep(p.prNo, r['PR No'] || '')
      ];
      sh.getRange(r.rowIndex, 1, 1, merged.length).setValues([merged]);
      return { success: true, id: id, updated: true, message: 'Inquiry updated.' };
    }
  }
  _append('PFInquiries', [id, p.date || _now(), String(p.actorName || p.user || ''), p.source || '',
                          p.client || '', p.industry || '', p.rawText || '', p.recommendation || '',
                          p.status || 'new', p.notes || '', _now(), p.itemsJson || '', p.prNo || '']);
  return { success: true, id: id, created: true, message: 'Inquiry saved.' };
}

function getPfInquiries(p) {
  var rows = _rows('PFInquiries');
  var user = p && p.user ? String(p.user) : '';
  var out = rows
    .filter(function (r) { return !user || String(r['User'] || '') === user; })
    .map(function (r) {
      return { id: String(r['Inquiry ID'] || ''), date: r['Date'] instanceof Date ? r['Date'].toISOString() : String(r['Date'] || ''),
               user: String(r['User'] || ''), source: String(r['Source'] || ''), client: String(r['Client'] || ''),
               industry: String(r['Industry'] || ''), rawText: String(r['Raw Text'] || ''),
               recommendation: String(r['Recommendation'] || ''), status: String(r['Status'] || 'new'),
               notes: String(r['Notes'] || ''),
               itemsJson: String(r['Items JSON'] || ''), prNo: String(r['PR No'] || ''),
               updatedAt: r['Updated At'] instanceof Date ? r['Updated At'].toISOString() : String(r['Updated At'] || '') };
    });
  out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: out };
}

// ════════════════════════════════════════════════════════════════════════════
//  DAILY REPORT SUBMISSION  (role dashboards → management / HR)
//
//  The ActivityLog says what the system recorded; a DailyReports row says what the PERSON stands
//  behind — the frozen counters at submit time plus their own highlights/blockers/plan. One row per
//  (Date, User), updatable all day: the first 'Submitted At' is never overwritten, while
//  'Submit Count'/'Updated At' keep the revision history honest.
//
//  NOTE: submitDailyReport is deliberately ABSENT from _MODULE_MAP. _dispatch auto-logs every
//  successful mutation, so logging a submission would append an ActivityLog row and inflate the very
//  movement count the report just froze — corrupting every weekly aggregate downstream. This row IS
//  the audit trail.
// ════════════════════════════════════════════════════════════════════════════

/** Locate the (Date, User) row — _setCellByKey only matches one key column, so scan like saveDailyNote. */
function _dailyReportRow(date, user) {
  var rows = _rows('DailyReports');
  for (var i = 0; i < rows.length; i++) {
    if (_dateStr(rows[i]['Date']) === String(date) && String(rows[i]['User']).trim() === String(user).trim()) {
      return rows[i];
    }
  }
  return null;
}

function _dailyReportOut(r) {
  function parse(v) { try { return JSON.parse(v || '{}') || {}; } catch (e) { return {}; } }
  return {
    reportNo: r['Report No'], date: _dateStr(r['Date']), user: r['User'], role: r['Role'],
    status: r['Status'] || 'Submitted',
    movements: _num(r['Movements']), calls: _num(r['Calls']), emails: _num(r['Emails']),
    docs: _num(r['Docs']), pdfs: _num(r['PDFs']), amount: _num(r['Amount']),
    counts: parse(r['Counts JSON']), metrics: parse(r['Metrics JSON']),
    countsJson: r['Counts JSON'] || '', metricsJson: r['Metrics JSON'] || '',
    highlights: r['Highlights'] || '', blockers: r['Blockers'] || '', plan: r['Plan'] || '',
    notes: r['Notes'] || '',
    submittedAt: r['Submitted At'], updatedAt: r['Updated At'], submitCount: _num(r['Submit Count']),
    reviewedBy: r['Reviewed By'] || '', reviewedAt: r['Reviewed At'] || '', reviewNote: r['Review Note'] || '',
    rowIndex: r.rowIndex
  };
}

function submitDailyReport(p) {
  var user = String(p.user || p.actorName || '').trim();
  if (!user) return { success: false, message: 'User is required.' };
  var date = p.date ? _dateStr(p.date) : _dateStr(_now());
  // postFlow retries any action matching /^submit/ — without this a retry double-counts the revision.
  var dup = _refSeen('submitDailyReport', p.clientRef);
  if (dup) {
    var seen = _dailyReportRow(date, user);
    return { success: true, reportNo: dup, date: date, user: user, duplicate: true,
      submitCount: seen ? _num(seen['Submit Count']) : 1, message: 'Daily report already submitted.' };
  }
  var sh = _sheet('DailyReports');
  var existing = _dailyReportRow(date, user);
  var now = _now();
  var no = existing ? existing['Report No'] : _nextNumber('DailyReports', 1, 'DR');
  var count = existing ? _num(existing['Submit Count']) + 1 : 1;
  var submittedAt = existing ? existing['Submitted At'] : now;   // first submission time is permanent
  var status = (existing && String(existing['Status']) === 'Reviewed') ? 'Reviewed' : 'Submitted';
  var vals = [no, date, user, p.role || p.actorRole || '', status,
    _num(p.movements), _num(p.calls), _num(p.emails), _num(p.docs), _num(p.pdfs), _num(p.amount),
    p.countsJson || '{}', p.metricsJson || '{}',
    p.highlights || '', p.blockers || '', p.plan || '', p.notes || '',
    submittedAt, now, count, p.clientRef || '',
    existing ? (existing['Reviewed By'] || '') : '',
    existing ? (existing['Reviewed At'] || '') : '',
    existing ? (existing['Review Note'] || '') : ''];
  if (existing) sh.getRange(existing.rowIndex, 1, 1, SCHEMA.DailyReports.length).setValues([vals]);
  else _append('DailyReports', vals);
  _refStore('submitDailyReport', p.clientRef, no);
  return { success: true, reportNo: no, date: date, user: user, submitCount: count,
    submittedAt: submittedAt, updatedAt: now,
    message: count > 1 ? 'Daily report updated.' : 'Daily report submitted.' };
}

function getDailyReports(p) {
  var rows = _rows('DailyReports');
  p = p || {};
  if (p.date)  rows = rows.filter(function (r) { return _dateStr(r['Date']) === String(p.date); });
  if (p.start) rows = rows.filter(function (r) { return _dateStr(r['Date']) >= String(p.start); });
  if (p.end)   rows = rows.filter(function (r) { return _dateStr(r['Date']) <= String(p.end); });
  if (p.user)  rows = rows.filter(function (r) { return String(r['User']).trim() === String(p.user).trim(); });
  if (p.role)  rows = rows.filter(function (r) { return String(r['Role']).toLowerCase() === String(p.role).toLowerCase(); });
  if (p.status) rows = rows.filter(function (r) { return String(r['Status']) === String(p.status); });
  rows.sort(function (a, b) {
    var d = _dateStr(b['Date']).localeCompare(_dateStr(a['Date']));
    return d || String(a['User']).localeCompare(String(b['User']));
  });
  return { success: true, data: rows.map(_dailyReportOut) };
}

/** Management acknowledges a submitted report (optionally with a comment). */
function reviewDailyReport(p) {
  if (!p.reportNo) return { success: false, message: 'reportNo required.' };
  var ok = _setCellByKey('DailyReports', 'Report No', p.reportNo, 'Status', 'Reviewed');
  if (!ok) return { success: false, message: 'Daily report not found.' };
  _setCellByKey('DailyReports', 'Report No', p.reportNo, 'Reviewed By', p.actorName || '');
  _setCellByKey('DailyReports', 'Report No', p.reportNo, 'Reviewed At', _now());
  if (p.reviewNote !== undefined) {
    _setCellByKey('DailyReports', 'Report No', p.reportNo, 'Review Note', p.reviewNote || '');
  }
  return { success: true, reportNo: p.reportNo, message: 'Daily report marked reviewed.' };
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
      plantSite: h['Plant Site'] || '',
      legacyId: h['Legacy ID'] || '', legacyItemsJson: h['Legacy Items JSON'] || '',
      pricedItemsJson: h['Priced Items JSON'] || '',
      items: its.map(function (r) {
        return {
          line: _num(r['Line']), itemId: r['Item ID'] || '', itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']),
          uom: r['UOM'], remarks: r['Remarks'], included: (r['Included'] === true || String(r['Included']) === 'true'),
          supplier: r['Supplier'], principal: r['Principal'], currency: r['Currency'] || 'PHP',
          supplierPrice: _num(r['Supplier Price (FC)']), cbm: _num(r['CBM']), finalPrice: _num(r['Final Price']),
          origItemNo: r['Orig Item No'] || '', origItemName: r['Orig Item Name'] || '',
          vat: r['Supplier Price VAT'] || ''
        };
      })
    };
  }) };
}

// A147: current status of a PR (''; if not found), used by the stage gates below.
function _prStatus(prNo) {
  var h = _rows('PricingRequests').filter(function (r) { return String(r['PR No']) === String(prNo); })[0];
  return h ? String(h['Status'] || '') : '';
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

/* A158 — the peso value of a foreign-currency purchase order for the GL. The trial balance sums by
   account and ignores the currency column, so posting an FC total there is simply wrong. Preference:
   the PHP estimate entered on the form, else total × the persisted exchange rate; a non-PHP PO with
   neither returns 0 and the journal is skipped rather than posted in the wrong unit (the A145 FX guard
   should make that unreachable). */
function _poJournalPHP(total, currency, exchangeRate, totalPHP) {
  if (String(currency || 'PHP') === 'PHP') return _num(total);
  if (_num(totalPHP) > 0) return _num(totalPHP);
  var rate = _num(exchangeRate);
  return rate > 0 ? _num(total) * rate : 0;
}

function _prItemRow(prNo, line) {
  return _rows('PricingRequestItems').filter(function (r) {
    return String(r['PR No']) === String(prNo) && _num(r['Line']) === _num(line);
  })[0];
}

function _prHeaderRow(prNo) {
  return _rows('PricingRequests').filter(function (h) { return String(h['PR No']) === String(prNo); })[0];
}

/* A158 — the quotation raised from a pricing request. The link lives in Quotations.'PR No' (A151);
   before that it was fished out of the PR's free-text Notes with a regex, which broke the moment
   anything else wrote to that column. The prose note is still read as a fallback for the rows that
   predate the column. */
function _quotationNoForPR(prNo) {
  var byCol = _rows('Quotations').filter(function (q) { return String(q['PR No'] || '') === String(prNo); })[0];
  if (byCol) return String(byCol['Quotation No']);
  var hdr = _prHeaderRow(prNo);
  var m = hdr ? String(hdr['Notes'] || '').match(/Quotation\s+(\S+)/i) : null;
  return m ? m[1] : '';
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
    p.docJson || '', p.clientRef || '', p.plantSite || '']);
    // trailing: Legacy ID / Legacy Items JSON / Priced Items JSON / Client Location / Doc JSON / Client Ref / Plant Site
  var sh = _sheet('PricingRequestItems');
  items.forEach(function (it, i) {
    sh.appendRow([no, i + 1, it.itemNo, it.itemName, _num(it.qty), it.uom || '', it.remarks || '',
      true, '', '', it.currency || 'PHP', 0, _num(it.cbm), 0, '', '', '',
      it.itemId || '']);   // trailing: Orig Item No/Name / Supplier Price VAT / A159 Item ID
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
    // A147: blank = keep the original (guarded like Item No above), so an accidental clear can't wipe
    // the description and push a blank through pricing into the quotation.
    if (u.itemName !== undefined && String(u.itemName).trim() !== '') {
      var newName = String(u.itemName).trim();
      if (String(row['Item Name']) !== newName && !String(row['Orig Item Name'] || '').trim()) {
        sh.getRange(row.rowIndex, 16, 1, 1).setValues([[row['Item Name']]]);
      }
      sh.getRange(row.rowIndex, 4, 1, 1).setValues([[newName]]);
    }
    // col 17: Supplier Price VAT (Inclusive|Exclusive) — a DISPLAY note only (no costing effect).
    // Targeted write so the positional cols-8-13 range above is never widened.
    if (u.vat !== undefined) {
      var vatCol = SCHEMA.PricingRequestItems.indexOf('Supplier Price VAT') + 1;
      sh.getRange(row.rowIndex, vatCol, 1, 1).setValues([[u.vat || '']]);
    }
  });
  // Header-level Client Location + Plant Site (one each per request) — set during sourcing when provided.
  var hsh = _sheet('PricingRequests');
  var hdrRows = _rows('PricingRequests').filter(function (h) { return String(h['PR No']) === String(p.prNo); });
  if (p.clientLocation !== undefined) {
    var locCol = SCHEMA.PricingRequests.indexOf('Client Location') + 1;
    hdrRows.forEach(function (h) { hsh.getRange(h.rowIndex, locCol, 1, 1).setValues([[p.clientLocation || '']]); });
  }
  if (p.plantSite !== undefined) {
    var psCol = SCHEMA.PricingRequests.indexOf('Plant Site') + 1;
    hdrRows.forEach(function (h) { hsh.getRange(h.rowIndex, psCol, 1, 1).setValues([[p.plantSite || '']]); });
  }
  /* A158 — this used to stamp 'Sourcing' unconditionally, so correcting a typo on a Returned-to-Sales
     or Quoted request quietly demoted it: it vanished from the rep's quote list and createQuotationFromPR
     then refused it, with nothing on screen explaining why. Saving item/header details is a pure edit at
     any later stage — only a request still IN sourcing advances its status here. */
  var curStatus = String((_prHeaderRow(p.prNo) || {})['Status'] || '');
  if (curStatus === 'Requested' || curStatus === 'Sourcing' || curStatus === '') {
    _setPRStatus(p.prNo, 'Sourcing');
  }
  return { success: true, prNo: p.prNo, status: curStatus || 'Sourcing', message: 'Sourcing saved.' };
}

// A144 backstop: Forward-to-Management must not proceed unless the sourcing is complete —
// a Supplier Quotation attached, a Plant Site recorded, and every INCLUDED item priced (supplier
// price + principal + currency). Mirrors the client-side gates so the API can't be skipped.
function _sourcingGaps(prNo) {
  var gaps = [];
  var hdr = _rows('PricingRequests').filter(function (h) { return String(h['PR No']) === String(prNo); })[0];
  if (!hdr) return ['Pricing request not found.'];
  if (!String(hdr['Plant Site'] || '').trim()) gaps.push('a plant-site destination');
  var hasQuote = _rows('Documents').some(function (d) {
    return String(d['Module']) === 'Pricing Request' && String(d['Ref No']) === String(prNo) &&
           String(d['Doc Type'] || '').toLowerCase() === 'supplier quotation';
  });
  if (!hasQuote) gaps.push("the supplier's quotation attached (Doc Type “Supplier Quotation”)");
  var incomplete = _rows('PricingRequestItems').some(function (r) {
    return String(r['PR No']) === String(prNo) &&
      (r['Included'] === true || String(r['Included']) === 'true') &&   // A147: accept a stringified checkbox
      (!(_num(r['Supplier Price (FC)']) > 0) || !String(r['Principal'] || '').trim() || !String(r['Currency'] || '').trim());
  });
  if (incomplete) gaps.push('a supplier price, principal and currency on every included item');
  return gaps;
}

function submitForPricing(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  // A147 stage gate: only a request still being sourced can be forwarded.
  var st = _prStatus(p.prNo);
  if (st && st !== 'Requested' && st !== 'Sourcing') {
    return { success: false, message: 'This request is "' + st + '" — only a Requested/Sourcing request can be forwarded to management.' };
  }
  var gaps = _sourcingGaps(p.prNo);
  if (gaps.length) return { success: false, message: 'Cannot forward to management — still needs ' + gaps.join(', ') + '.' };
  _setPRStatus(p.prNo, 'For Mgmt Pricing');
  return { success: true, prNo: p.prNo, message: 'Forwarded to management for pricing.' };
}

function setMgmtPricing(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var hdr = _prHeaderRow(p.prNo);
  if (!hdr) return { success: false, message: 'Pricing request not found.' };
  var prStatus = String(hdr['Status'] || '');

  /* A158 — this was the one PR action with no stage gate, while the Pricing History table offered a
     "Re-price" button on Quoted requests. Re-pricing one silently moved it back to Mgmt Priced and
     left the quotation the client is already holding untouched and unflagged. */
  if (prStatus !== 'For Mgmt Pricing') {
    if (!p.reprice) {
      return { success: false, message: 'This request is ' + prStatus +
        ', not awaiting pricing. Use Re-price if you intend to change a price that has already been issued.' };
    }
    // Re-pricing something already quoted must not silently diverge from the client's document.
    if (prStatus === 'Quoted') {
      var qNo = _quotationNoForPR(p.prNo);
      var q = qNo ? _quotationRow(qNo) : null;
      var qSt = q ? String(q['Status'] || '') : '';
      if (q && (qSt === 'Approved' || qSt === 'Sent')) {
        return { success: false, message: 'Quotation ' + qNo + ' is ' + qSt +
          ' — revise it first, then re-price. Otherwise the client keeps a document this pricing no longer matches.' };
      }
    }
  }

  // A158: an impossible margin silently produced ₱0 (or a 100× price) on every line.
  var commTotal = _num(p.commission) + _num(p.margin) + 2;
  if (commTotal >= 100) {
    return { success: false, message: 'Commission + margin + 2% local tax comes to ' + commTotal.toFixed(1) +
      '% — at 100% or more the selling price cannot be computed. Lower the commission or margin.' };
  }

  var sh = _sheet('PricingRequests');
  // Ensure the appended history column has a header label (cosmetic; _rows maps by position).
  try { sh.getRange(1, 15, 1, 1).setValues([['Priced Items JSON']]); } catch (e) {}
  _rows('PricingRequests').forEach(function (h) {
    if (String(h['PR No']) === String(p.prNo)) {
      sh.getRange(h.rowIndex, 5, 1, 3).setValues([[p.destination || '', _num(p.commission), _num(p.margin)]]); // Destination, Commission %, Margin %
      // A181: MERGE the incoming breakdown into what is already stored. This used to overwrite the
      // whole column, so re-pricing a single line in the engine silently discarded the breakdown for
      // every other line — PR-202607-210 kept 1 row of 5 and its history could only show one item.
      if (p.pricedItemsJson) {
        sh.getRange(h.rowIndex, 15, 1, 1)
          .setValues([[_mergePricedItems(h['Priced Items JSON'], p.pricedItemsJson, p.excludedLines)]]);
      }
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
    // A147: do NOT overwrite per-item Principal (col 10) / Currency (col 11). The pricing engine is a
    // single GLOBAL principal, so writing it onto every line clobbered the per-item sourcing (a
    // multi-principal PR lost item B's real principal/currency). The engine's full per-item breakdown is
    // preserved in Priced Items JSON (col 15); the quotation is PHP-based, so output is unaffected.
    if (u.supplierPrice !== undefined) ish.getRange(row.rowIndex, 12, 1, 1).setValues([[_num(u.supplierPrice)]]); // Supplier Price (FC) (col 12)
    if (u.cbm !== undefined) ish.getRange(row.rowIndex, 13, 1, 1).setValues([[_num(u.cbm)]]);             // CBM (col 13)
  });

  /* A158 — lines management removed from the engine. Deleting a row used to leave the item still
     flagged Included with Final Price 0, so it printed on the client's quotation at ₱0.00 while the
     verify screens rendered a blank "—" that read as "no data" rather than "free". */
  JSON.parse(p.excludedLines || '[]').forEach(function (line) {
    var row = _prItemRow(p.prNo, line);
    if (row) ish.getRange(row.rowIndex, 8, 1, 1).setValues([[false]]);
  });

  _setPRStatus(p.prNo, 'Mgmt Priced');
  return { success: true, prNo: p.prNo, repriced: prStatus !== 'For Mgmt Pricing',
           message: 'Final pricing saved; returned to admin.' };
}

/* A181 — fold this save's engine breakdown into the stored one instead of replacing it.
   The engine is a calculator: management legitimately opens it with a subset of the request's lines to
   re-price one of them. Replacing the column wholesale meant every OTHER line lost its recorded cost
   breakdown while keeping its final price, leaving a request whose history could only show the lines
   from the last save (PR-202607-210: 1 of 5, and PR-202607-285 the same under current code).

   A stored row is superseded when the incoming set covers the same line, or — for the pre-A159 rows
   that carry no line at all — the same name. A line management explicitly excluded is dropped, since
   it is no longer part of the request. Order follows the incoming rows, then whatever survived. */
function _mergePricedItems(storedJson, incomingJson, excludedLinesJson) {
  var incoming = [], stored = [], excluded = [];
  try { incoming = JSON.parse(incomingJson || '[]') || []; } catch (e) { incoming = []; }
  try { stored = JSON.parse(storedJson || '[]') || []; } catch (e) { stored = []; }
  try { excluded = JSON.parse(excludedLinesJson || '[]') || []; } catch (e) { excluded = []; }
  if (!incoming.length) return String(incomingJson || '');   // nothing to merge into — keep old behaviour
  if (!stored.length) return JSON.stringify(incoming);

  var norm = function (s) { return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim(); };
  var key = function (r) {
    return (r && r.line != null && r.line !== '') ? 'L:' + String(r.line) : 'N:' + norm(r && r.name);
  };
  var seen = {}, out = [];
  incoming.forEach(function (r) { if (r) { seen[key(r)] = 1; out.push(r); } });
  var dropped = {};
  excluded.forEach(function (l) { dropped['L:' + String(_num(l))] = 1; });

  stored.forEach(function (r) {
    if (!r) return;
    var k = key(r);
    if (seen[k] || dropped[k]) return;                      // superseded, or the line was excluded
    // A row with no line and no name cannot be identified — keeping it would duplicate silently.
    if (k === 'N:') return;
    out.push(r);
  });
  return JSON.stringify(out);
}

/* A201 — management rejects a forwarded pricing. The request stays, but its whole sourcing is wiped
   so admin must re-source from scratch before it can be forwarded again. Only a request currently
   awaiting management pricing (For Mgmt Pricing) can be rejected. Secured, like setMgmtPricing. */
function rejectMgmtPricing(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var hdr = _prHeaderRow(p.prNo);
  if (!hdr) return { success: false, message: 'Pricing request not found.' };
  var st = String(hdr['Status'] || '');
  if (st !== 'For Mgmt Pricing') {
    return { success: false, message: 'This request is "' + st + '" — only a request forwarded for ' +
      'management pricing can be rejected.' };
  }

  // Clear the whole sourcing on every item: cols 9-14 (Supplier, Principal, Currency, Supplier Price
  // (FC), CBM, Final Price) and the display-only Supplier Price VAT (17). `Included` (col 8) and the
  // item No/Name are the client's request, not sourcing — left untouched.
  var ish = _sheet('PricingRequestItems');
  var vatCol = SCHEMA.PricingRequestItems.indexOf('Supplier Price VAT') + 1;
  _rows('PricingRequestItems').forEach(function (r) {
    if (String(r['PR No']) !== String(p.prNo)) return;
    ish.getRange(r.rowIndex, 9, 1, 6).setValues([['', '', '', 0, 0, 0]]);
    if (vatCol > 0) ish.getRange(r.rowIndex, vatCol, 1, 1).setValues([['']]);
  });

  // Drop management's stored breakdown (header col 15) so the engine's buy-price fallback can never
  // re-show a stale figure on the next load after the price has been cleared.
  var hsh = _sheet('PricingRequests');
  _rows('PricingRequests').forEach(function (h) {
    if (String(h['PR No']) === String(p.prNo)) hsh.getRange(h.rowIndex, 15, 1, 1).setValues([['']]);
  });

  var reason = String(p.reason || '').trim();
  var note = 'Pricing rejected by management (' + (p.actorName || 'someone') + ', ' + _dateStr(_now()) + ')' +
    (reason ? ': ' + reason : '') + ' — re-source and resubmit.';
  _setPRStatus(p.prNo, 'Sourcing', note);
  return { success: true, prNo: p.prNo, status: 'Sourcing',
    message: 'Pricing rejected — the sourced prices were cleared and the request returned to admin for re-sourcing.' };
}

function verifyReturnToSales(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  // A147 stage gate: only a management-priced request can be verified back to sales.
  var vst = _prStatus(p.prNo);
  if (vst && vst !== 'Mgmt Priced') {
    return { success: false, message: 'This request is "' + vst + '" — only a Mgmt Priced request can be verified and returned to sales.' };
  }
  _setPRStatus(p.prNo, 'Returned to Sales', p.notes);
  return { success: true, prNo: p.prNo, message: 'Verified; returned to sales.' };
}

function createQuotationFromPR(p) {
  if (!p.prNo) return { success: false, message: 'prNo required.' };
  var hdr = _rows('PricingRequests').filter(function (h) { return String(h['PR No']) === String(p.prNo); })[0];
  if (!hdr) return { success: false, message: 'PR not found.' };
  // A147: stage gate + one-quotation-per-PR. Already quoted → return the existing quotation (idempotent,
  // parsed from Notes). Otherwise the PR must be "Returned to Sales" before it can be quoted.
  var prStatus = String(hdr['Status'] || '');
  if (prStatus === 'Quoted') {
    // A158: read the link from the Quotations.'PR No' column rather than scraping the PR's free-text
    // Notes, which other actions also write to.
    var existingNo = _quotationNoForPR(p.prNo);
    return { success: true, prNo: p.prNo, quotationNo: existingNo, duplicate: true,
      message: existingNo ? ('Already quoted as ' + existingNo + ' — revise that quotation rather than creating another.')
                          : 'This request is already quoted.' };
  }
  if (prStatus !== 'Returned to Sales') {
    return { success: false, message: 'This request is "' + prStatus + '" — it must be Returned to Sales before it can be quoted.' };
  }
  // A147: carry EVERY included item — including ₱0 freebies/accessories. Every included line is priced by
  // the engine before the PR reaches "Returned to Sales", so a 0 is a legitimate quoted price. (Filtering
  // on Final Price > 0 silently dropped freebies the sales rep saw on screen.)
  var qItems = _rows('PricingRequestItems').filter(function (r) {
    return String(r['PR No']) === String(p.prNo)
      && (r['Included'] === true || String(r['Included']) === 'true');
  }).map(function (r) {
    return { itemId: r['Item ID'] || '', itemNo: r['Item No'], itemName: r['Item Name'], qty: _num(r['Qty']), price: _num(r['Final Price']),
             uom: r['UOM'] || '',
             origItemNo: r['Orig Item No'] || '', origItemName: r['Orig Item Name'] || '',
             vat: r['Supplier Price VAT'] || '' };   // A145: carry the VAT-Incl/Excl note to the quotation
  });
  if (!qItems.length) return { success: false, message: 'No included items to quote.' };
  /* A158 — a line that reaches here at 0 is either a deliberate freebie or a line management removed
     from the engine without un-including it. Both print on the client's quotation at ₱0.00, so the
     rep confirms which it is rather than finding out afterwards. */
  var zeroLines = qItems.filter(function (it) { return !(it.price > 0); });
  if (zeroLines.length && !p.confirmZero) {
    return { success: false, needsConfirm: 'zeroPrice', zeroLines: zeroLines.length,
      zeroItems: zeroLines.map(function (it) { return it.itemName || it.itemNo; }),
      message: zeroLines.length + ' item(s) are priced at ₱0.00 and will print on the quotation as free: ' +
        zeroLines.map(function (it) { return it.itemName || it.itemNo; }).join(', ') + '.' };
  }
  // A145: carry the PR context that used to die at the PR — plant site + the client's own RFQ/PR number
  // (from Doc JSON) — onto the quotation so it prints and isn't re-typed.
  var clientRefNo = '';
  try { var dj = JSON.parse(hdr['Doc JSON'] || '{}'); clientRefNo = dj.prNumberClient || dj.rfqNo || ''; } catch (e) {}
  // New quotation starts as Draft (creator = the requesting sales user) → enters the approval workflow.
  // The sales rep types their own quotation code + subject on the form; both carry through here.
  // A clientRef makes a retry-after-success return the SAME quotation instead of a false "already exists".
  var qres = createQuotation({ customer: hdr['Customer'], date: _now(), status: 'Draft',
    layoutJson: p.layoutJson || '',   // A174: set on the create, so no second write can wipe the lines
    quotationNo: p.quotationNo || '', subject: p.subject || '', discountPct: _num(p.discountPct) || 0,
    plantSite: hdr['Plant Site'] || '', clientRefNo: clientRefNo, prNo: p.prNo,   // A151: link quotation → its pricing request
    /* A158: the client's per-SUBMISSION token, not a permanent per-PR key. The old 'qfp_'+prNo key
       lived in ScriptProperties forever, so re-quoting a re-priced PR silently returned the ORIGINAL
       quotation with the ORIGINAL prices and reported it as newly created — the corrected price
       reached nobody. One-quotation-per-PR is enforced by the status guard above, which is the real
       invariant; this token only protects against a transport retry of THIS submission. */
    clientRef: p.clientRef || ('qfp1_' + p.prNo + '_' + _now().getTime()),
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
  // A193: file it under the client instead — <client>/<SO or _Pre-Sales Order>/01 Pricing Request.
  // Falls back to the old "Purchase Request/<requester>/" folder when the client cannot be resolved,
  // so a PR raised for a customer we have never seen still lands somewhere sensible.
  var folder = _docFolder('Pricing Request', p.prNo, _GENERATED_DOC_TYPE, _now()) ||
               _prUserFolder(requester || p.actorName || 'Unknown');
  var saved = _saveFileToDrive(p.pdfBase64, p.fileName || ((p.prNo || 'PR') + '.pdf'), 'application/pdf', folder);
  var link = saved.url;
  if (p.prNo) {
    _setCellByKey('PricingRequests', 'PR No', p.prNo, 'PDF Link', link);
    _registerDocument('Pricing Request', p.prNo, p.fileName, link, saved.id, p.actorName);
  }
  return { success: true, link: link, prNo: p.prNo, message: 'PR PDF saved to Drive.' };
}

// ── Action registry ──────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
//  A145 — Supplier & Client masters (prefill the fields re-typed on every PR / payment request)
// ════════════════════════════════════════════════════════════════════════════
function getSuppliers() {
  return { success: true, data: _rows('Suppliers').map(function (r) {
    return { supplier: r['Supplier'], bankName: r['Bank Name'] || '', accountName: r['Account Name'] || '',
      accountNumber: r['Account Number'] || '', paymentMethod: r['Payment Method'] || '',
      currency: r['Currency'] || '', tin: r['TIN'] || '', address: r['Address'] || '', notes: r['Notes'] || '',
      updatedBy: r['Updated By'] || '', updatedAt: r['Updated At'] || '', rowIndex: r.rowIndex };
  }) };
}
function saveSupplier(p) {
  var name = String(p.supplier || '').trim();
  if (!name) return { success: false, message: 'Supplier name is required.' };
  var sh = _sheet('Suppliers'), n = SCHEMA.Suppliers.length;
  var row = [name, p.bankName || '', p.accountName || '', p.accountNumber || '', p.paymentMethod || '',
    p.currency || '', p.tin || '', p.address || '', p.notes || '', p.actorName || '', _now()];
  var existing = _rows('Suppliers').filter(function (r) { return String(r['Supplier']).toLowerCase() === name.toLowerCase(); })[0];
  if (existing) sh.getRange(existing.rowIndex, 1, 1, n).setValues([row]);
  else _append('Suppliers', row);
  return { success: true, supplier: name, message: 'Supplier "' + name + '" ' + (existing ? 'updated.' : 'added.') };
}
function deleteSupplier(p) {
  var r = _rows('Suppliers').filter(function (x) { return String(x['Supplier']).toLowerCase() === String(p.supplier || '').toLowerCase(); })[0];
  if (!r) return { success: false, message: 'Supplier not found.' };
  _sheet('Suppliers').deleteRow(r.rowIndex);
  return { success: true, supplier: String(p.supplier || ''), message: 'Supplier "' + String(p.supplier || '') + '" removed.' };
}
function getClients() {
  return { success: true, data: _rows('Clients').map(function (r) {
    return { customer: r['Customer'], address: r['Address'] || '', contactPerson: r['Contact Person'] || '',
      designation: r['Designation'] || '', email: r['Email'] || '', phone: r['Phone'] || '',
      rfqRef: r['RFQ Ref'] || '', paymentTerms: r['Payment Terms'] || '', notes: r['Notes'] || '',
      updatedBy: r['Updated By'] || '', updatedAt: r['Updated At'] || '', rowIndex: r.rowIndex };
  }) };
}
function saveClient(p) {
  var name = String(p.customer || '').trim();
  if (!name) return { success: false, message: 'Customer name is required.' };
  var sh = _sheet('Clients'), n = SCHEMA.Clients.length;
  var row = [name, p.address || '', p.contactPerson || '', p.designation || '', p.email || '', p.phone || '',
    p.rfqRef || '', p.paymentTerms || '', p.notes || '', p.actorName || '', _now()];
  var existing = _rows('Clients').filter(function (r) { return String(r['Customer']).toLowerCase() === name.toLowerCase(); })[0];
  if (existing) sh.getRange(existing.rowIndex, 1, 1, n).setValues([row]);
  else _append('Clients', row);
  return { success: true, customer: name, message: 'Client "' + name + '" ' + (existing ? 'updated.' : 'added.') };
}
function deleteClient(p) {
  var r = _rows('Clients').filter(function (x) { return String(x['Customer']).toLowerCase() === String(p.customer || '').toLowerCase(); })[0];
  if (!r) return { success: false, message: 'Client not found.' };
  _sheet('Clients').deleteRow(r.rowIndex);
  return { success: true, customer: String(p.customer || ''), message: 'Client "' + String(p.customer || '') + '" removed.' };
}

var HANDLERS = {
  getVersion: getVersion,
  getSuppliers: getSuppliers, saveSupplier: saveSupplier, deleteSupplier: deleteSupplier,
  getClients: getClients, saveClient: saveClient, deleteClient: deleteClient,
  getInventory: getInventory, addInventoryItem: addInventoryItem,
  updateInventoryItem: updateInventoryItem, deleteInventoryItem: deleteInventoryItem,
  importInventory: importInventory, classifyInventory: classifyInventory,
  backfillItemIds: backfillItemIds, findDuplicateInventory: findDuplicateInventory,   // A159
  getQuotations: getQuotations, createQuotation: createQuotation,
  getQuotationPhotos: getQuotationPhotos, reorderQuotationItems: reorderQuotationItems,
  updateQuotation: updateQuotation, deleteQuotation: deleteQuotation,
  getSalesOrders: getSalesOrders, createSalesOrder: createSalesOrder,
  updateSalesOrder: updateSalesOrder, deleteSalesOrder: deleteSalesOrder, importSalesOrders: importSalesOrders,
  getPurchaseOrders: getPurchaseOrders, createPurchaseOrder: createPurchaseOrder,
  updatePurchaseOrder: updatePurchaseOrder, deletePurchaseOrder: deletePurchaseOrder,
  getAPAging: getAPAging, updateAPAging: updateAPAging, deleteAPEntry: deleteAPEntry,
  getARAging: getARAging, getCollections: getCollections, recordCollection: recordCollection, updateARAging: updateARAging,
  voidCollection: voidCollection, voidInvoice: voidInvoice,   // A158: the missing reversals
  correctCollection: correctCollection,
  importCollections: importCollections,
  getExpenses: getExpenses, addExpense: addExpense, updateExpense: updateExpense,
  deleteExpense: deleteExpense, importExpenses: importExpenses, reclassifyExpenses: reclassifyExpenses,
  getMarketing: getMarketing, saveMarketingRecord: saveMarketingRecord, deleteMarketingRecord: deleteMarketingRecord,
  getSalesCalls: getSalesCalls, logSalesCall: logSalesCall, deleteSalesCall: deleteSalesCall,
  getSONotes: getSONotes, saveSONotes: saveSONotes,                                                          // A191
  getClientVisits: getClientVisits, logClientVisit: logClientVisit, deleteClientVisit: deleteClientVisit,   // A189
  getVisitPhotos: getVisitPhotos,                                                                          // A190
  getWeeklyItineraries: getWeeklyItineraries, saveWeeklyItinerary: saveWeeklyItinerary,                    // A190
  submitWeeklyItinerary: submitWeeklyItinerary, approveWeeklyItinerary: approveWeeklyItinerary,
  rejectWeeklyItinerary: rejectWeeklyItinerary, reviseWeeklyItinerary: reviseWeeklyItinerary,
  deleteWeeklyItinerary: deleteWeeklyItinerary,
  getReceiving: getReceiving, createReceiving: createReceiving,
  getInvoices: getInvoices, createInvoice: createInvoice,
  getChartOfAccounts: getChartOfAccounts, getJournal: getJournal, getTrialBalance: getTrialBalance,
  getOpeningBalances: getOpeningBalances, setOpeningBalance: setOpeningBalance,
  getShipments: getShipments, getShipmentTimeline: getShipmentTimeline,
  advanceShipmentStage: advanceShipmentStage, updateShipment: updateShipment,
  getPaymentRequests: getPaymentRequests, createPaymentRequest: createPaymentRequest,
  updatePaymentRequest: updatePaymentRequest, deletePaymentRequest: deletePaymentRequest,
  submitPaymentRequest: submitPaymentRequest, approvePaymentRequest: approvePaymentRequest,
  markPaymentRequestPaid: markPaymentRequestPaid,
  rejectPaymentRequest: rejectPaymentRequest, savePaymentRequestPDF: savePaymentRequestPDF,
  revisePaymentRequest: revisePaymentRequest,
  getSOCostDetails: getSOCostDetails, importSOCostDetails: importSOCostDetails, saveSOCostDetails: saveSOCostDetails,
  backfillMigratedRecords: backfillMigratedRecords, deleteMigratedRecords: deleteMigratedRecords,
  resetSequenceCounters: resetSequenceCounters,
  matchSupplierTypes: matchSupplierTypes,
  importPricingSubmissions: importPricingSubmissions,
  saveQuotationPDF: saveQuotationPDF, savePOPDF: savePOPDF,
  getActivityLog: getActivityLog, getDailyNote: getDailyNote, saveDailyNote: saveDailyNote,
  submitDailyReport: submitDailyReport, getDailyReports: getDailyReports, reviewDailyReport: reviewDailyReport,
  savePfInquiry: savePfInquiry, getPfInquiries: getPfInquiries,
  getPricingRequests: getPricingRequests, createPricingRequest: createPricingRequest,
  updatePRSourcing: updatePRSourcing, submitForPricing: submitForPricing, setMgmtPricing: setMgmtPricing,
  rejectMgmtPricing: rejectMgmtPricing,
  verifyReturnToSales: verifyReturnToSales, createQuotationFromPR: createQuotationFromPR, savePRPDF: savePRPDF,
  addDocument: addDocument, getDocuments: getDocuments, deleteDocument: deleteDocument,
  submitQuotationApproval: submitQuotationApproval, approveQuotation: approveQuotation,
  rejectQuotation: rejectQuotation, sendQuotation: sendQuotation, reviseQuotation: reviseQuotation,
  closeQuotation: closeQuotation, reopenQuotation: reopenQuotation,
  submitPOApproval: submitPOApproval, approvePO: approvePO, rejectPO: rejectPO,
  // A151: lifecycle spine + document safety
  backfillShipments: backfillShipments, backfillPdfDocuments: backfillPdfDocuments,
  getSOLifecycle: getSOLifecycle, getDocumentsForSO: getDocumentsForSO,
  // A195 — the document contract. All read-only: HANDLERS only, no MUTATIONS, no _SECURED.
  getSODocCompliance: getSODocCompliance, getDocComplianceReport: getDocComplianceReport,
  getDocRules: getDocRules,
  backfillMissingAR: backfillMissingAR, setFlowDriveFolder: setFlowDriveFolder,
  // A193: Drive filing — client / sales order / document type
  previewDriveMigration: previewDriveMigration, seedClientAliases: seedClientAliases,
  runDriveMigration: runDriveMigration, buildDriveSkeleton: buildDriveSkeleton,
  previewDriveMigrationReport: previewDriveMigrationReport, setupFlowDrive: setupFlowDrive,
  buildDriveSkeletonAll: buildDriveSkeletonAll, runDriveMigrationAll: runDriveMigrationAll,
  verifyDriveIntegrity: verifyDriveIntegrity,
  cleanupLegacyFolders: cleanupLegacyFolders, cleanupLegacyFoldersApply: cleanupLegacyFoldersApply
};

// Actions that mutate the sheets (run under a script lock).
var MUTATIONS = {
  addInventoryItem: 1, updateInventoryItem: 1, deleteInventoryItem: 1,
  importInventory: 1, classifyInventory: 1,
  createQuotation: 1, updateQuotation: 1, deleteQuotation: 1, reorderQuotationItems: 1,
  createSalesOrder: 1, updateSalesOrder: 1, deleteSalesOrder: 1, importSalesOrders: 1, matchSupplierTypes: 1,
  createPurchaseOrder: 1, updatePurchaseOrder: 1, deletePurchaseOrder: 1,
  updateAPAging: 1, deleteAPEntry: 1, recordCollection: 1, correctCollection: 1, updateARAging: 1, importCollections: 1, createReceiving: 1, createInvoice: 1,
  voidCollection: 1, voidInvoice: 1,
  backfillItemIds: 1,                                   // A159 (findDuplicateInventory is read-only)
  addExpense: 1, updateExpense: 1, deleteExpense: 1, importExpenses: 1, reclassifyExpenses: 1,
  saveMarketingRecord: 1, deleteMarketingRecord: 1,
  logSalesCall: 1, deleteSalesCall: 1,
  saveSONotes: 1,   // A191
  logClientVisit: 1, deleteClientVisit: 1,   // A189
  saveWeeklyItinerary: 1, submitWeeklyItinerary: 1, approveWeeklyItinerary: 1,   // A190
  rejectWeeklyItinerary: 1, reviseWeeklyItinerary: 1, deleteWeeklyItinerary: 1,
  saveQuotationPDF: 1, savePOPDF: 1, saveDailyNote: 1, submitDailyReport: 1, reviewDailyReport: 1,
  savePfInquiry: 1,
  createPricingRequest: 1, updatePRSourcing: 1, submitForPricing: 1, setMgmtPricing: 1,
  rejectMgmtPricing: 1,
  verifyReturnToSales: 1, createQuotationFromPR: 1, savePRPDF: 1,
  addDocument: 1, deleteDocument: 1,
  submitQuotationApproval: 1, approveQuotation: 1, rejectQuotation: 1, sendQuotation: 1, reviseQuotation: 1,
  closeQuotation: 1, reopenQuotation: 1,
  submitPOApproval: 1, approvePO: 1, rejectPO: 1,
  setOpeningBalance: 1,
  advanceShipmentStage: 1, updateShipment: 1,
  createPaymentRequest: 1, updatePaymentRequest: 1, deletePaymentRequest: 1, submitPaymentRequest: 1,
  approvePaymentRequest: 1, rejectPaymentRequest: 1, savePaymentRequestPDF: 1, revisePaymentRequest: 1,
  markPaymentRequestPaid: 1,
  importSOCostDetails: 1, saveSOCostDetails: 1, importPricingSubmissions: 1, backfillMigratedRecords: 1,
  deleteMigratedRecords: 1, resetSequenceCounters: 1,
  saveSupplier: 1, deleteSupplier: 1, saveClient: 1, deleteClient: 1,
  // A151: lifecycle spine + document safety (getSOLifecycle/getDocumentsForSO are read-only → HANDLERS only)
  backfillShipments: 1, backfillPdfDocuments: 1, backfillMissingAR: 1, setFlowDriveFolder: 1,
  // A193 (previewDriveMigration is read-only → HANDLERS only). Neither name starts with
  // save/update/set, so _flowIdempotentAction will not auto-retry them — and both are idempotent
  // anyway: a file already in its folder is skipped, and a Raw Name already on file is left alone.
  seedClientAliases: 1, runDriveMigration: 1, buildDriveSkeleton: 1,
  buildDriveSkeletonAll: 1, runDriveMigrationAll: 1, setupFlowDrive: 1,
  cleanupLegacyFolders: 1, cleanupLegacyFoldersApply: 1
};
