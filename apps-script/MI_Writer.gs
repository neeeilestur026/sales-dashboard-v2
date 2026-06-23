/**
 * MI Writer Apps Script — Materials Issuance
 *
 * Writes issuance rows to the MI sheet AND updates the Inventory sheet (-qty).
 * Deploy as: Web App → Execute as Me → Anyone can access
 *
 * Expected payload from Flask:
 * {
 *   "rows": [
 *     {
 *       "recipient_name": "...",
 *       "issuance_date": "...",
 *       "issuance_no": "...",
 *       "requisition_no": "...",
 *       "model_no": "...",
 *       "item_description": "...",
 *       "quantity": 3,
 *       "remarks": "...",
 *       "issued_by": "..."
 *     }
 *   ],
 *   "inventory_sheet_id": "YOUR_INVENTORY_SHEET_ID"
 * }
 *
 * MI Sheet columns: Date | Recipient | Issuance No. | Requisition No. | Model No. | Item Description | Qty | Remarks | Issued By
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

    var ss = SpreadsheetApp.openById(inventorySheetId);

    // ── Write to Issuance tab ───────────────────────────────────
    var sheet = ss.getSheetByName('Issuance');
    if (!sheet) {
      sheet = ss.insertSheet('Issuance');
      sheet.appendRow([
        'Date', 'Recipient', 'Issuance No.', 'Requisition No.',
        'Model No.', 'Item Description', 'Qty', 'Remarks', 'Issued By', 'Drive Link'
      ]);
    }

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      sheet.appendRow([
        r.issuance_date || '',
        r.recipient_name || '',
        r.issuance_no || '',
        r.requisition_no || '',
        r.model_no || '',
        r.item_description || '',
        r.quantity || 0,
        r.remarks || '',
        r.issued_by || '',
        r.drive_link || ''
      ]);
    }

    // ── Update Inventory tab (-qty) ─────────────────────────────
    updateInventory(ss, rows, 'deduct');

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

  // Collect data-array indices of rows that reach zero (to delete after processing)
  var toDelete = [];

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
        var currentQty = parseInt(data[r][2]) || 0;
        var newQty = currentQty - qty;
        if (newQty < 0) newQty = 0;

        if (newQty <= 0) {
          // Queue for deletion — item fully consumed
          toDelete.push(r);
        } else {
          sheet.getRange(r + 1, 3).setValue(newQty);     // Col C: Current Qty
          sheet.getRange(r + 1, 4).setValue(now);         // Col D: Last Updated
          sheet.getRange(r + 1, 2).setValue(description); // Col B: Description
        }
        data[r][2] = newQty; // Keep local cache in sync for same-batch duplicate models
        found = true;
        break;
      }
    }

    if (!found) {
      Logger.log('MI_Writer: model "' + modelNo + '" not found in Inventory — qty ' + qty + ' was NOT deducted.');
    }
  }

  // Delete zero-qty rows in reverse order so earlier row indices stay valid
  toDelete.sort(function(a, b) { return b - a; });
  for (var d = 0; d < toDelete.length; d++) {
    sheet.deleteRow(toDelete[d] + 1); // data index → 1-based sheet row
  }
}
