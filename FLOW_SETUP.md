# Accounting Process Flow — Setup & Deployment

This adds a connected accounting pipeline to v2, on its **own** Google Sheet + Apps Script
(independent of the production backend). Source doc: `ACCOUNTING SYSTEM PROCESS FLOW.docx`.

```
Inventory → Quotation → Sales Order → Purchase Order (+ AP Aging)
          → Materials Receiving (landed cost) → Invoice / Materials Issuance (COGS)
```

## What was built
- **Backend:** `apps-script/FlowAPI.gs` — a self-contained Apps Script web app. Auto-creates all
  tabs (Inventory, Quotations/QuotationItems, SalesOrders/…, PurchaseOrders/…, APAging,
  MaterialsReceiving/…, Invoices/…) with headers on first use.
- **Frontend:** `dashboard/flow-*.html` + `dashboard/js/flow-*.js`, sharing `dashboard/js/flow-api.js`
  and `dashboard/css/flow.css`. Reached from the navbar **"Process Flow"** link (admin & accounting)
  or directly at `flow-home.html`.
- **General Ledger (Phase 2):** the same `FlowAPI.gs` auto-posts double-entry journal entries at
  each step into a `Journal` tab against a seeded `ChartOfAccounts`. View them at `flow-ledger.html`
  (Trial Balance, Journal, Chart of Accounts).

## Deploy the backend (one-time)
1. Create a **new Google Spreadsheet** (e.g. "v2 Process DB"). Copy its ID from the URL
   (`https://docs.google.com/spreadsheets/d/<THIS_ID>/edit`).
2. In that sheet: **Extensions → Apps Script**. Delete the starter `Code.gs`, create a file,
   paste the contents of `apps-script/FlowAPI.gs`. Set `var SHEET_ID = '<THIS_ID>';` at the top.
3. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Deploy and
   copy the **/exec** URL.
4. Paste that URL into:
   - `dashboard/js/flow-api.js` → `const FLOW_API_URL = '…/exec';`
   - `.env` → `FLOW_APPS_SCRIPT_URL=…/exec` (documentation; the browser reads the JS constant).

That's it — open `flow-home.html`, and the first action auto-creates every tab.

> Re-deploy note: after editing `FlowAPI.gs`, use **Deploy → Manage deployments → Edit → New
> version** so the `/exec` URL keeps serving the latest code.

## Run locally
```bash
cd sales-dashboard-v2
./venv/bin/python -m flask --app app run --port 5000
# log in, then click "Process Flow" in the navbar
```

## How each step connects
| Step | Loads from | Key behavior |
|------|-----------|--------------|
| Inventory | — | Item master; qty may be 0. Landed/unit = purchase + shipping; total landed = balance × landed. |
| Quotation | Inventory | Pick items; missing items can be added to inventory inline (even at 0 stock). |
| Sales Order | Quotation | "Load Quotation" preloads items+qty; editable (remove / change qty). |
| Purchase Order | Sales Order | Currency selector; default qty = SO qty − inventory on hand. **Saving auto-creates an AP Aging row.** |
| AP Aging | Purchase Order | FC amount flows in; you enter the **PHP total**, status, due date, payment. |
| Receiving | Purchase Order | Enter total shipping → pro-rated per item `Total Shipping × unit price ÷ total order value` → landed cost; **inventory balance + cost updated**. |
| Invoice | Sales Order | Selling price from the order; COGS = inventory landed cost; **inventory deducted** on save. |

## General Ledger postings (Phase 2)
Each step auto-posts a balanced journal entry (idempotent — re-posts on edit, removed on delete):

| Step | Debit | Credit |
|------|-------|--------|
| Purchase Order | Purchases Clearing | Accounts Payable |
| AP Payment | Accounts Payable | Cash |
| Materials Receiving | Inventory (purchase+shipping) | Purchases Clearing (purchase) + Cash (shipping) |
| Invoice | Accounts Receivable; Cost of Goods Sold | Sales; Inventory |

Purchases Clearing and Inventory net to zero once a PO is received and the goods are invoiced.
**FX note:** the GL is kept in PHP; foreign-currency POs post at their document amount and the PHP
payment is recorded at AP Payment — a residual on Accounts Payable reflects the FX difference (no
automatic FX gain/loss account yet).

## PDF generators (Quotation & Purchase Order)
Both flow pages can generate a branded PDF whose layout is **identical to the legacy generators**:
- Rendering reuses the legacy ReportLab templates — `pdf_generators/flow_quotation_pdf.py` (which
  reuses `QuotationDocTemplate`) and `pdf_generators/po_pdf.py` (`PODocTemplate`). The legacy
  `/quotation/` and `/po/` generators are untouched.
- New Flask blueprint `blueprints/flow.py` exposes `POST /flow/quotation-pdf` and `POST /flow/po-pdf`
  (same-origin; no Apps Script needed to render). Registered in `app.py`.
- On each flow page, a **PDF** button opens a modal (prefilled from the record, remembered defaults in
  `localStorage`, inline validation). Quotation adds a VAT toggle + per-item image upload; PO adds
  short/long format + optional brochure attach. Generating opens the PDF and, if the Flow backend is
  configured, uploads it to Drive via `saveQuotationPDF` / `savePOPDF` and shows a **View** link.

### Extra deploy step for PDF→Drive
`FlowAPI.gs` now uses `DriveApp`, so after pasting the updated code, **re-deploy a new version** and
**authorize the Drive permission** when prompted. Optionally set `FLOW_DRIVE_FOLDER_ID` at the top of
`FlowAPI.gs`; if left blank it auto-creates/uses a folder named **"Flow Documents"**. A new
**`PDF Link`** column is auto-added to the `Quotations` and `PurchaseOrders` tabs. (PDF *rendering*
works without the Flow backend; only the Drive save/link needs it.)

## Scope
Phase 1 (connections + costing + AP aging), Phase 2 (chart of accounts, auto-posted journals,
trial balance), and the Quotation/PO **PDF generators** are all built. **Still deferred:** automated
FX-rate lookup / FX gain-loss, and income-statement / balance-sheet financial statements.

## Verified
`apps-script/FlowAPI.gs` logic was exercised end-to-end against an in-memory mock of the Sheets API
(24/24 assertions): zero-qty inventory, quotation→SO→PO chains, AP auto-creation + PHP edit,
pro-rata landed cost into inventory, and invoice COGS + inventory deduction, plus monthly numbering.
