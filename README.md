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

1. Never commit a sheet id or secret. The local `apps-script/Code.gs` line 44 carries the users
   sheet id; the committed copy has an empty string. Before every commit:
   `git diff --cached apps-script/Code.gs | grep -c USERS_SHEET_ID` must print `0`.
2. Paste protocol: run the tests, paste the file into the editor, Save, then Deploy → Manage
   deployments → Edit → New version on the **existing** deployment (the `/exec` URLs in
   `js/api.js` and `js/flow-api.js` never change). Smoke: `getCodeVersion` / `getVersion`, a
   login, one read, one secured mutation. On any failure, Manage deployments → previous version.
3. Securing an existing FlowAPI action: ship `blueprints/flow.py` and `js/flow-api.js` to Render
   first, confirm, then paste `FlowAPI.gs`. Never the other way round.
