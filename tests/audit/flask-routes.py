"""A299 — every Flask route that reads data, writes or renders carries the session guard.

Run:  ./venv/bin/python tests/audit/flask-routes.py

The static pages, the six legacy tool shells (which gate themselves client-side and cannot carry a
header on a page navigation) and robots.txt are the only open endpoints. Everything else must be
wrapped in session_auth.require_session, which marks the view with `_requires_session`. The
second half drives the app with a test client: a request without a token is refused with 401 and a
JSON body, and the same request with a validated token reaches the view. The two dead routes the
maintenance pass removed must stay gone."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("DASHBOARD_APPS_SCRIPT_URL", "https://script.google.com/macros/s/test/exec")

from app import app                                   # noqa: E402
import blueprints.session_auth as session_auth        # noqa: E402

FAIL = 0
N = 0


def ok(label, cond, extra=None):
    global FAIL, N
    N += 1
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     " + str(extra)[:300]))


OPEN = {"static", "serve_index", "serve_dashboard", "robots_txt",
        "po_bp.index", "pr_bp.index", "mro_bp.index", "mi_bp.index",
        "quotation_bp.index", "payment_request_bp.index"}

print("== 1 · every non-static endpoint is guarded ==")
unguarded = []
guarded = 0
for rule in app.url_map.iter_rules():
    if rule.endpoint in OPEN:
        continue
    view = app.view_functions[rule.endpoint]
    if getattr(view, "_requires_session", False):
        guarded += 1
    else:
        unguarded.append(f"{rule.rule} [{rule.endpoint}]")
ok(f"{guarded} guarded endpoints, 0 unguarded", not unguarded, unguarded)
ok("the open set is exactly the static pages, robots and the six tool shells",
   {r.endpoint for r in app.url_map.iter_rules()} & OPEN == OPEN)
endpoints = {r.rule for r in app.url_map.iter_rules()}
ok("/flow/secured-actions is gone (no caller)", "/flow/secured-actions" not in endpoints)
ok("/billing/download-cash-voucher is gone (no caller)", "/billing/download-cash-voucher" not in endpoints)
ok("/api/session/logout exists", "/api/session/logout" in endpoints)

print("\n== 2 · the guard refuses without a token and admits with one ==")
calls = []
session_auth.validate_session = lambda token: (calls.append(token) or {"username": "tester", "role": "admin"}) if token == "good" else None
c = app.test_client()
r = c.post("/po/add_item", json={"item_code": "X", "quantity": 1, "unit_price": 1})
ok("no token → 401 JSON with authError", r.status_code == 401 and r.is_json and r.get_json().get("authError") is True, (r.status_code, r.data[:120]))
r = c.post("/po/add_item", json={"item_code": "X", "quantity": 1, "unit_price": 1}, headers={"X-Session-Token": "bad"})
ok("an invalid token → 401", r.status_code == 401, r.status_code)
r = c.post("/po/add_item", json={"item_code": "X", "quantity": 1, "unit_price": 1}, headers={"X-Session-Token": "good"})
ok("a valid token reaches the view (200)", r.status_code == 200, (r.status_code, r.data[:120]))
r = c.post("/po/add_item", json={"item_code": "Y", "quantity": 1, "unit_price": 1, "sessionToken": "good"})
ok("the token may also travel in the JSON body", r.status_code == 200, r.status_code)
r = c.get("/po/last_submission_info?sessionToken=good")
ok("a token in the query string is NOT accepted", r.status_code == 401, r.status_code)
r = c.get("/po/")
ok("the tool shell itself stays open (it gates client-side)", r.status_code == 200, r.status_code)
r = c.get("/index.html")
ok("the login page is open", r.status_code == 200, r.status_code)
ok("  and answers HEAD (uptime probes, curl -I)", c.head("/index.html").status_code == 200)
ok("  and carries HSTS and the report-only CSP",
   r.headers.get("Strict-Transport-Security", "").startswith("max-age=") and "default-src 'self'" in (r.headers.get("Content-Security-Policy") or r.headers.get("Content-Security-Policy-Report-Only") or ""),
   dict(r.headers))
r = c.post("/api/session/logout", headers={"X-Session-Token": "good"})
ok("logout answers 200", r.status_code == 200, r.status_code)

print("\n== 3 · the per-user tool state is keyed by the validated login ==")
import blueprints.po as po                            # noqa: E402
ok("po._user_items is keyed 'tester', never a browser-chosen key", "tester" in po._user_items and "anonymous" not in po._user_items, list(po._user_items))

print(f"\n{N} checks, " + (f"{FAIL} FAILURE(S)" if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
