# sales-dashboard-v2 — Setup

A duplicate of `sales-dashboard`, configured as an **independent instance**.
All connections to the original Google Sheets / Apps Script backend have been
removed so this copy points at nothing until you wire up its own backend.

## What this app is
- **Flask** (`app.py`) serves the `dashboard/` folder as static pages and
  registers 8 blueprints (`po, pr, mro, mi, quotation, payment_request,
  billing, email_log`) for PDF generation, email, and Apps Script proxying.
- **Frontend** lives entirely in `dashboard/` (HTML + `js/` + `css/` + `images/`).
  The real database is **Google Sheets**, reached via **Google Apps Script**.

> Note: Flask only serves `dashboard/`. The root-level dead-duplicate `*.html`
> and `/js` from the original were dropped from this copy.

## Run locally
```bash
cd sales-dashboard-v2
python3 -m venv venv          # already created
./venv/bin/pip install Flask reportlab Pillow PyPDF2 pandas openpyxl requests python-dotenv python-dateutil gunicorn cryptography
./venv/bin/python -m flask --app app run --port 5000
# open http://127.0.0.1:5000/
```
The UI loads immediately, but **login and all data features stay dead until you
connect a backend** (below).

## Wire up the independent backend
1. **Create new Google Sheets** for this instance (users, orders, inventory,
   MRO, MI, collections, etc.) — clone the originals' tab/column layout.
2. **Deploy the Apps Script** in `apps-script/` (`Code.gs`, `MI_Writer.gs`,
   `MRO_Writer.gs`) as new web-app deployments, one `/exec` URL per tool.
   The sheet-ID constants at the top of `Code.gs` were blanked — fill them in.
3. **Fill `.env`** (see `.env.example`) with the new `/exec` URLs, sheet IDs,
   and freshly generated `EMAIL_CRED_KEY` and `INTERNAL_SHARED_SECRET`.
4. **Set the frontend URL**: in `dashboard/js/api.js`, replace
   `REPLACE_WITH_YOUR_DASHBOARD_APPS_SCRIPT_EXEC_URL` with the dashboard
   Apps Script `/exec` URL. Also patch `templates/pr/index.html` and
   `templates/quotation/index.html` (`REPLACE_WITH_YOUR_APPS_SCRIPT_EXEC_URL`).

## Production (Render)
`render.yaml` is included. It pins Python 3.11.9 (`runtime.txt`) and the exact
`requirements.txt` versions. Set the same env vars there as secrets.
