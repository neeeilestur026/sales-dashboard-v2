# Working rules for this repo

- Flask serves only `dashboard/` (pages, `js/`, `css/`, `images/`, `data/`) and `static/`.
- Run: `./venv/bin/python -m flask --app app run --port 5066`. Test: `bash tests/run.sh`
  (must be green before every commit).
- No bundler, no build step, no minification. Pages are hand-edited; the contract tests under
  `tests/flow/*-contract.js` pin each home page's exact script list and order, and
  `tests/flow/site-contract.js` pins the brand rules on every page (tokens only, no hex, no
  emoji, `js/theme.js` first in `<body>`, inline `style` only as `display:none;`).
- `tests/audit/registration.js`: every `fetchFlow('X')` / `postFlow('X')` literal must exist in
  FlowAPI `HANDLERS`, and the secured list must match three ways (`blueprints/flow.py`,
  `FlowAPI.gs _SECURED`, `js/flow-api.js FLOW_SECURED_ACTIONS`).
- Never stage `apps-script/Code.gs` line 44 (the users sheet id). Check with
  `git diff --cached apps-script/Code.gs | grep -c USERS_SHEET_ID` → `0`. Never print a secret or an `/exec` URL.
- Apps Script files are pasted by hand: Flask/JS first, then the `.gs` file (see README).
- Throwaway preview harnesses are `dashboard/_c0-<page>.html`; delete them before committing.
- Commit messages: `A<nnn>: <what changed>` with a Co-Authored-By line.
