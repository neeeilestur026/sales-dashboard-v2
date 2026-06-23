/**
 * MRO Writer Apps Script — Materials Receiving
 *
 * Writes receiving rows to the MRO sheet AND updates the Inventory sheet (+qty).
 * Deploy as: Web App → Execute as Me → Anyone can access
 *
 * Expected payload from Flask:
 * {
 *   "rows": [
 *     {
 *       "vendor_name": "...",
 *       "receiving_date": "...",
 *       "sales_invoice": "...",
 *       "purchase_order_no": "...",
 *       "model_no": "...",
 *       "item_description": "...",
 *       "quantity": 5,
 *       "remarks": "...",
 *       "received_by": "..."
 *     }
 *   ],
 *   "inventory_sheet_id": "YOUR_INVENTORY_SHEET_ID"
 * }
 *
 * MRO Sheet columns: Date | Vendor | Sales Invoice | PO No. | Model No. | Item Description | Qty | Remarks | Received By
 * Inventory Sheet columns: Model No. | Item Description | Current Qty | Last Updated
 */

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var rows = payload.rows;
    var inventorySheetId = payload.inventory_sheet_id || '';

    if (!rows || rows.length === 0) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'No rows provided' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (!inventorySheetId) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'No inventory_sheet_id provided' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var mroSheetId = payload.mro_sheet_id || '';

    if (!mroSheetId) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'No mro_sheet_id provided' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // ── Write to existing MRO sheet ─────────────────────────────
    var mroSs = SpreadsheetApp.openById(mroSheetId);
    var sheet = mroSs.getSheets()[0]; // first sheet tab

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      sheet.appendRow([
        r.vendor_name || '',
        r.receiving_date || '',
        r.sales_invoice || '',
        r.purchase_order_no || '',
        r.model_no || '',
        r.item_description || '',
        r.quantity || 0,
        r.remarks || '',
        r.received_by || '',
        r.drive_link || ''
      ]);
    }

    // ── Update Inventory sheet (+qty) ───────────────────────────
    var invSs = SpreadsheetApp.openById(inventorySheetId);
    updateInventory(invSs, rows, 'add');

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'success', rows_added: rows.length })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Update the Inventory tab in the same spreadsheet.
 * @param {Spreadsheet} ss - Already-opened Spreadsheet object
 * @param {Array} rows - item rows with model_no, item_description, quantity
 * @param {string} action - 'add' (receiving) or 'deduct' (issuance)
 */
function updateInventory(ss, rows, action) {
  var sheet = ss.getSheetByName('Inventory');

  // Create Inventory sheet with headers if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Inventory');
    sheet.appendRow(['Model No.', 'Item Description', 'Current Qty', 'Last Updated']);
  }

  var data = sheet.getDataRange().getValues();
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  for (var i = 0; i < rows.length; i++) {
    var modelNo = String(rows[i].model_no || '').trim();
    var description = String(rows[i].item_description || '').trim();
    var qty = parseInt(rows[i].quantity) || 0;

    if (!modelNo || qty <= 0) continue;
    var modelKey = modelNo.toLowerCase();

    // Search for existing row by Model No. (col A, index 0) — case-insensitive, trimmed
    var found = false;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0] || '').trim().toLowerCase() === modelKey) {
        // Found — update qty
        var currentQty = parseInt(data[r][2]) || 0;
        var newQty;
        if (action === 'add') {
          newQty = currentQty + qty;
        } else {
          newQty = currentQty - qty;
          if (newQty < 0) newQty = 0; // prevent negative stock
        }
        sheet.getRange(r + 1, 3).setValue(newQty);           // Col C: Current Qty
        sheet.getRange(r + 1, 4).setValue(now);               // Col D: Last Updated
        sheet.getRange(r + 1, 2).setValue(description);       // Col B: Update description in case it changed
        data[r][2] = newQty; // Update local cache in case same model appears again in batch
        found = true;
        break;
      }
    }

    if (!found) {
      // New item — append row
      var newQty = (action === 'add') ? qty : 0; // If deducting an unknown item, set to 0
      sheet.appendRow([modelNo, description, newQty, now]);
      data.push([modelNo, description, newQty, now]); // Keep local cache in sync
    }
  }
}
