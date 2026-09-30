/**
 * MI Writer Apps Script — Materials Issuance (AS-3)
 *
 * Writes issuance rows to the Issuance tab of the inventory spreadsheet AND updates the Inventory
 * sheet (-qty). Deploy as: Web App → Execute as Me → Anyone can access. Called only by the Flask server.
 *
 * Script Properties (Project Settings → Script properties):
 *   INTERNAL_SHARED_SECRET  — the same value the server holds; every request must carry it
 *   INVENTORY_SHEET_ID      — the spreadsheet holding the Issuance and Inventory tabs
 *
 * Payload from Flask: { "rows": [ { recipient_name, issuance_date, issuance_no, requisition_no,
 *   model_no, item_description, quantity, remarks, issued_by, drive_link } ], "sharedSecret": … }
 *
 * Issuance columns: Date | Recipient | Issuance No. | Requisition No. | Model No. | Item Description | Qty | Remarks | Issued By | Drive Link
 * Inventory Sheet columns: Model No. | Item Description | Current Qty | Last Updated
 */

// ─── AS-3 · who may call, and which sheets ───────────────────────────────────
/* Only the Flask server calls this web app, and it sends the shared secret on every request. The
   sheet ids come from this project's Script Properties, never from the request: a caller that could
   name a sheet id could write into any spreadsheet the script owner can reach. */
function _prop(name) {
  try { return PropertiesService.getScriptProperties().getProperty(name) || ''; } catch (e) { return ''; }
}
function _ctEq(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  var key = Utilities.getUuid();
  var x = Utilities.computeHmacSha256Signature(a, key), y = Utilities.computeHmacSha256Signature(b, key);
  var diff = a.length === b.length ? 0 : 1;
  for (var i = 0; i < x.length; i++) diff |= (x[i] ^ y[i]);
  return diff === 0;
}
function _reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function _refuse(message) { return _reply({ status: 'error', message: message }); }
function _authorised(payload) {
  var want = _prop('INTERNAL_SHARED_SECRET');
  if (!want) return 'The INTERNAL_SHARED_SECRET Script Property is not set.';
  if (!_ctEq(String(payload.sharedSecret || ''), want)) return 'Forbidden';
  return null;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var payload = JSON.parse(e.postData.contents);
    var denied = _authorised(payload);
    if (denied) return _refuse(denied);
    var rows = payload.rows;
    if (!rows || !rows.length) return _refuse('No rows provided');
    var inventorySheetId = _prop('INVENTORY_SHEET_ID');
    if (!inventorySheetId) return _refuse('The INVENTORY_SHEET_ID Script Property is not set.');

    lock.waitLock(20000);
    var ss = SpreadsheetApp.openById(inventorySheetId);
    var sheet = ss.getSheetByName('Issuance');
    if (!sheet) {
      sheet = ss.insertSheet('Issuance');
      sheet.appendRow(['Date', 'Recipient', 'Issuance No.', 'Requisition No.', 'Model No.', 'Item Description', 'Qty', 'Remarks', 'Issued By', 'Drive Link']);
    }
    var matrix = rows.map(function (r) {
      return [r.issuance_date || '', r.recipient_name || '', r.issuance_no || '', r.requisition_no || '',
              r.model_no || '', r.item_description || '', r.quantity || 0, r.remarks || '', r.issued_by || '', r.drive_link || ''];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, 10).setValues(matrix);   // one write, not one per row
    updateInventory(ss, rows, 'deduct');
    return _reply({ status: 'success', rows_added: rows.length });
  } catch (err) {
    return _refuse(err.message);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Apply a batch of item rows to the Inventory tab: one read, one write for the rows that exist,
 * one append for the rows that do not. `action` is 'add' (receiving) or 'deduct' (issuance);
 * stock never goes below zero. The caller holds the script lock.
 */
function updateInventory(ss, rows, action) {
  var sheet = ss.getSheetByName('Inventory');
  if (!sheet) {
    sheet = ss.insertSheet('Inventory');
    sheet.appendRow(['Model No.', 'Item Description', 'Current Qty', 'Last Updated']);
  }
  var data = sheet.getDataRange().getValues();
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var index = {};
  for (var r = 1; r < data.length; r++) index[String(data[r][0] || '').trim().toLowerCase()] = r;
  var touched = false, appended = [];
  for (var i = 0; i < rows.length; i++) {
    var modelNo = String(rows[i].model_no || '').trim();
    var description = String(rows[i].item_description || '').trim();
    var qty = parseInt(rows[i].quantity, 10) || 0;
    if (!modelNo || qty <= 0) continue;
    var key = modelNo.toLowerCase();
    if (index[key] !== undefined) {
      var row = data[index[key]];
      var current = parseInt(row[2], 10) || 0;
      var next = action === 'add' ? current + qty : Math.max(0, current - qty);
      row[1] = description; row[2] = next; row[3] = now; touched = true;
    } else {
      var fresh = [modelNo, description, action === 'add' ? qty : 0, now];
      data.push(fresh); index[key] = data.length - 1; appended.push(fresh);
    }
  }
  var existing = data.length - appended.length;
  if (touched && existing > 1) {
    sheet.getRange(2, 2, existing - 1, 3).setValues(data.slice(1, existing).map(function (r) { return [r[1], r[2], r[3]]; }));
  }
  if (appended.length) sheet.getRange(existing + 1, 1, appended.length, 4).setValues(appended);
}
