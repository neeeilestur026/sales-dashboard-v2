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
