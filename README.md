# Hi-ESCORP Portal (sales-dashboard-v2)

A Flask app on Render that serves the dashboard pages statically and proxies a few PDF and
email jobs; the data lives in Google Sheets behind two hand-deployed Apps Script backends.

- `dashboard/` — every page (`*.html`), `js/`, `css/`, `images/`, `data/`. Flask serves only this
  folder plus `static/`. Nothing else in the repo reaches the browser.
- `app.py`, `blueprints/` — nine blueprints (`po, pr, mro, mi, quotation, payment_request,
  billing, email_log, flow`) for PDFs, email and the secured Apps Script proxy.
- `apps-script/Code.gs` — login, users, the legacy dashboard API. `apps-script/FlowAPI.gs` — the
  accounting process flow. Both are pasted into the Apps Script editor by hand (see below).
- `tests/` — standalone node and Python suites; `bash tests/run.sh` runs them all in about 10 s.

## Run

```bash
./venv/bin/python -m flask --app app run --port 5066
```

Then open http://localhost:5066/. Secrets and the Apps Script URLs come from `.env`
(`.env.example` lists every key; `render.yaml` carries the same keys for Render).

## Test

```bash
bash tests/run.sh          # everything; exits 1 on any failure
bash tests/run.sh --js     # node suites only
bash tests/run.sh --py     # Python suites only
```

Every page has a brand contract (`tests/flow/site-contract.js`); the role homes have their own
contract tests that pin the exact script list and order. There is no bundler and no build step:
the pages are hand-edited and served as they are.

## Deploy

Pushing `main` deploys to https://hi-escorp-portal-wufz.onrender.com automatically. Confirm with
`gh api repos/neeeilestur026/sales-dashboard-v2/deployments?per_page=1` and the deployment's
`/statuses`.

## Apps Script rules

1. Never commit a sheet id or secret. Since AS-1, `Code.gs` reads `USERS_SHEET_ID` and
   `INTERNAL_SHARED_SECRET` from Script Properties (Project Settings → Script properties), so the
   file carries no id at all. Before every commit: `git diff --cached | grep -cE "'[A-Za-z0-9_-]{40,}'"`
   must print `0` (no long id literal in the staged diff).
2. Paste protocol: run the tests, paste the file into the editor, Save, then Deploy → Manage
   deployments → Edit → New version on the **existing** deployment (the `/exec` URLs in
   `js/api.js` and `js/flow-api.js` never change). Smoke: `getCodeVersion` / `getVersion`, a
   login, one read, one secured mutation. On any failure, Manage deployments → previous version.
3. Securing an existing FlowAPI action: ship `blueprints/flow.py` and `js/flow-api.js` to Render
   first, confirm, then paste `FlowAPI.gs`. Never the other way round.

## Deploying the hardened Code.gs (AS-1)

The repo's `apps-script/Code.gs` (CODE_VERSION 4) requires a session on every action, checks the
admin-page roles on the server, refuses mutations over GET, guards sheet ids, and stores passwords
hashed. Order matters — do it in this sequence and nobody is locked out:

1. Render is already on A299+ (Flask forwards `token` and `sharedSecret` on every Code.gs call).
2. In the Code.gs Apps Script project: Project Settings → Script properties → add
   `USERS_SHEET_ID` (the Users spreadsheet id) and confirm `INTERNAL_SHARED_SECRET` matches the
   server's value. **Without `USERS_SHEET_ID` every login fails** with a clear message.
3. Paste the file, Save, Deploy → Manage deployments → Edit → New version → Deploy (same deployment).
4. Smoke: `<exec>?action=getCodeVersion` → version 2; log in as a test user (the row is migrated:
   `pwHash`/`pwSalt` filled, the Base64 column emptied); log in again; change the password; as
   admin, reset that user's password and log in with the temporary one.
5. Triggers → add trigger → `cleanupExpiredSessions`, time-driven, day timer.
6. Then switch `linkPRToQuotation` in `blueprints/quotation.py` from `params=` to `json=` (POST),
   because the hardened file refuses mutations over GET; the comment at the call site marks it.

Rollback: Manage deployments → previous version. A user migrated in the meantime keeps working
after the sheet owner re-enters a Base64 value in column B for them (the old file reads it).

## Deploying the hardened FlowAPI.gs (AS-2)

The repo's `apps-script/FlowAPI.gs` (FLOW_VERSION 157) secures every mutation, fails closed when
its secret is missing, refuses mutations over GET, and reads each tab once per read call.

1. Render must already carry this commit: `blueprints/flow.py` and `js/flow-api.js` list every
   mutation as secured, so the browser routes each write through `/flow/secure` and Flask stamps
   the caller. The old Apps Script ignores the extra `flowSecret`, so nothing breaks in between.
2. In the FlowAPI Apps Script project: Project Settings → Script properties → set
   `FLOW_MUTATION_SECRET` to the same value as the server's `INTERNAL_SHARED_SECRET` (Flask sends
   that value as `flowSecret`). **If it is missing, every write is refused with a clear message.**
   Optionally add `FLOW_SHEET_ID` and `FLOW_DRIVE_FOLDER_ID`; the file falls back to its literals
   this release and drops them next release.
3. Paste the file, Save, Deploy → Manage deployments → Edit → New version → Deploy (same deployment).
4. Smoke: `<exec>?action=getVersion` → 157; `<exec>?action=getClients` → data; a save from any flow
   page (e.g. a daily note) succeeds; a direct POST of `approveQuotation` to the /exec URL without
   `flowSecret` is refused. Open Shipments and compare its load time with the 36.7 s recorded in
   the file's A270 note.
5. Then switch `linkPRToQuotation` in `blueprints/quotation.py` to `json=` (see the AS-1 notes).

Rollback: Manage deployments → previous version; the Flask/JS lists are a superset the old script
ignores.

## Deploying the hardened receiving writers (AS-3)

`apps-script/MRO_Writer.gs` and `apps-script/MI_Writer.gs` now require the server's shared secret,
take their sheet ids from Script Properties (never from the request) and write each batch in one
call per sheet. Flask already sends the secret on every call (A299).

1. In each writer project: Project Settings → Script properties → `INTERNAL_SHARED_SECRET`
   (same value as the server), `INVENTORY_SHEET_ID`, and for the MRO writer `MRO_SHEET_ID`.
2. Paste the file, Save, Deploy → Manage deployments → Edit → New version → Deploy.
3. Smoke: submit one receiving from `/mro/` and one issuance from `/mi/`; the rows appear and the
   Inventory tab moves by the quantities.

Rollback: Manage deployments → previous version.

## The warehouse scanner (A316 + A318 + A319, FlowAPI 160)

`/scan.html` is a phone web app: open it in Safari (iPhone) or Chrome (Android), then Share → Add to
Home Screen (iPhone) or the install prompt (Android). No app store, no fee. It receives goods against
an open purchase order and records goods leaving against a sales order, by camera, by a Bluetooth
keyboard-type scanner, or by typing.

- **Who:** accounting, admin and director scan and post. A login with the role `warehouse` (Users page
  → Warehouse) lands on the scanner, counts and dispatches, and its receiving counts are posted by
  accounting (the scanner and the desktop Receiving page both prefill them).
- **What it writes:** receiving goes through `createReceiving` (same landed cost, journal, document and
  payment checks), but every line is checked against what is still open on the PO and priced from the
  PO. Dispatch is a record only: stock still leaves at invoicing.
- **Barcodes:** a supplier barcode is linked to an item once (asked on the first scan; an unknown one
  can be matched by searching all inventory). Items with no barcode get our label.
- **Tabs (A318):** Receive (by purchase order), Stock in (scan an item, pick the open PO line it came
  from; the basket posts one receiving per PO), Dispatch (by sales order), Return (pieces back from
  site) and Look up (what a code is, where it is, its photos).
- **Photo proof (A318):** every receive, count, dispatch and return needs at least one photo. Each shot
  is downscaled on the phone and uploaded on its own into the PO's or SO's Drive folder and the
  Documents register (types Receiving photo / Dispatch photo), so it also shows in the office's Docs
  window. Returns and piece registrations file under `_Warehouse/` in the month's folder.
- **Track each piece (A318):** switch an item on from Inventory or the scanner's Look up. Every piece
  received after that gets its own Asset No (AS-YYYYMM-NNN) and label; pieces already on the shelf are
  registered from Look up. A tracked SO line is dispatched by scanning each piece's own label; a piece
  that is out cannot leave again until it is returned. At most 50 pieces per line per post.
- **Labels (A318):** `labels.html` is the label library: every code we have made, searchable, with how
  often each was printed; select and print (50 × 30 mm, one per page) or reprint any time. The QR holds
  only an opaque code (HX + 12 characters), never an item ID or a link, so another phone or scanner sees
  nothing useful. The reads that turn a code into details are secured (signed in, scanner roles only).
  Honest limit: a photocopied label scans as the same item or piece; a duplicated piece is caught
  because one piece cannot be dispatched twice. Labels printed before A318 (`HXI:` codes) still scan.
- **New item (A319):** in Stock in, **New item** (or "Not in inventory? Add it as a new item" after
  scanning an unknown barcode) adds goods inventory has never seen. Photo first, then name, brand
  (CEJN, Hydraulic Technologies Powerteam, RAD Torque Tools, Snap-on / Blue-point, Chicago Pneumatic,
  Others), model and type (hose, coupler, pump, cylinder, jack, torque wrench, others). The item is saved
  as Stock with the counted quantity on hand, Description "Brand Type Name", Item No = model, and gets
  its label to print later (one per piece when "Track each piece" is on, preset for pumps, cylinders,
  jacks and torque wrenches). A model or barcode already in inventory is refused and that item offered.
  **No cost and no journal entry:** accounting fills in the cost from Inventory, where these items show
  "From scanner · cost to fill". When they are invoiced, COGS is credited against 1300 at that cost, so
  the Balance Sheet's opening inventory figure is where stock that never came through a receiving is
  accounted for.
- **Still record only:** dispatch and return do not move stock; it leaves at invoicing. Moving the
  deduction to the outgoing scan later means: `dispatchByScan` deducts, `createInvoice` skips what was
  dispatched by scan, `voidInvoice` restores only what it deducted, and `returnByScan` adds back, all
  behind one setting so it can be switched on when testing ends.
- **Deploy order:** Render first (this repo), then paste `apps-script/FlowAPI.gs` as a new version and
  check `getVersion` returns 160. On 159 the scanner works but New item stays hidden; below 159 the scanner shows "backend not updated".
- **Also changed in `createReceiving`:** only accounting/admin/director may post, zero-quantity lines
  are skipped (they used to overwrite the unit cost), and the charges typed on a receiving are spread
  over that receiving's goods with its VAT booked in full (partial deliveries used to lose part of
  their charges; a full delivery is unchanged).

## The books (A320, FlowAPI 161)

`books.html` (accounting, admin, management, director) is the double-entry general ledger. It is built
behind one setting, **`booksEngine`**, which the director or management flips on that page:

- **Off** (the default): nothing is posted and nothing is refused; every page works exactly as before.
- **Shadow**: every money event posts to the `GL` tab alongside the old `Journal`, for checking.
- **On**: the books are the accounts (from A325, once the shadow months agree with the bank statements,
  the agings and the filed returns).

The books start on **1 Jan 2026** (`booksStartDate`); anything earlier is covered by the CPA's opening
balances (A322) and is never posted.

**How it posts.** One writer (`_glPost`), in centavos, balanced or refused, written as one block and
indexed by a permanent event key. The same event again does nothing; a changed one is reversed and
re-posted; nothing is deleted. What cannot post with certainty waits in the **Inbox** on the Books page
with the whole entry — pick the account (optionally "remember" it as a rule) or ignore it with a reason.
**Coverage** proves every invoice, collection, receiving, payment, expense, travel week and commission
is posted, waiting, or flagged as changed; "Post what is missing" fixes the rest.

**What switching to shadow asks of people** (the server refuses without it):
- a 0% invoice says **zero-rated** or **VAT-exempt** (the invoice form's VAT type);
- a collection says **where the money was deposited**;
- marking a payment paid says **which company account** and the bank's **value date** (foreign: the
  pesos actually debited); AP Aging can no longer record a payment by hand;
- a manual expense says **how it was paid** (a bank, cash on hand, not yet paid, a stockholder);
- receiving a foreign PO takes the **rate on the day received**; VAT on it needs the **import entry no.**
  (local VAT needs the supplier's **TIN and sales invoice no.**, or leave it at 0 to keep it in the cost);
- nothing is dated into a closed month.

**Purchases use the advances model.** A PO posts nothing. Paying before the goods arrive is an advance
(1460) at the pesos the bank took; receiving books stock at those pesos plus the unpaid part at the
receipt-date rate (a payable, 2010); paying after receipt realises the FX difference (4520/7010).
With the books on, the inventory sheet is costed the same way (no more partial-payment costing).

**Live fixes in A320** (regardless of the switch): an approved travel week is no longer expensed twice
when its payout is paid, and a travel float advance is no longer booked as an expense.

**Deploy:** Render first, then paste `apps-script/FlowAPI.gs` (161). Restart any local Flask server
after pulling (it keeps the old secured-action list in memory).
