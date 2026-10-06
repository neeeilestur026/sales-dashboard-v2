"""A325 — the server-side fixes from the system scan, pinned.

Run:  ./venv/bin/python tests/flow/flask_hardening.py

  1. No JSON reply carries the shared secret, a sharedSecret= / token= value or a deployment id.
  2. A GET to Apps Script never puts the shared secret in its URL (only the caller's own token).
  3. Marking a bill paid / generating a cash voucher: accounting, admin and the director only.
  4. A PDF named in Polish or Japanese downloads (the header stays Latin-1).
  5. The legacy Payment Request page opens (it was a 500 on every visit).
  6. The 413 "too large" answer is JSON on every route, not just /flow/*.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ["INTERNAL_SHARED_SECRET"] = "S3CRET-VALUE-123"

from flask import jsonify                                          # noqa: E402
from app import app, _scrub_json                                   # noqa: E402
import blueprints.session_auth as _sa                              # noqa: E402
import blueprints._upstream as up                                  # noqa: E402
from blueprints.flow import _pdf_response                          # noqa: E402

FAIL = 0


def ok(label, cond, extra=None):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     " + str(extra)[:500]))


print("\n1 · nothing secret leaves in a JSON reply")
with app.test_request_context():
    leak = ("HTTPSConnectionPool(host='script.google.com', port=443): Max retries exceeded with url: "
            "/macros/s/AKfycbxABCDEFGHIJKLMNOP_qrstu/exec?sharedSecret=S3CRET-VALUE-123&token=tok-999&action=x")
    r = jsonify({"success": False, "message": leak})
    _scrub_json(r)
    body = r.get_data(as_text=True)
    ok("the secret is gone", "S3CRET-VALUE-123" not in body, body)
    ok("  the token is gone", "tok-999" not in body, body)
    ok("  the deployment id is gone", "AKfycbxABCDEFGHIJKLMNOP" not in body, body)
    ok("  the message is still there", "Max retries exceeded" in body, body)
    clean = jsonify({"success": True, "data": [1, 2]})
    before = clean.get_data(as_text=True)
    _scrub_json(clean)
    ok("an ordinary reply is untouched", clean.get_data(as_text=True) == before)
    ok("safe_error scrubs an exception's text", "S3CRET" not in up.safe_error(Exception(leak)) and "tok-999" not in up.safe_error(Exception(leak)))

print("\n2 · a GET never carries the shared secret")
seen = {}


class _R:
    status_code = 200
    headers = {}
    text = "{}"


def fake_get(url, params=None, **kw):
    seen["params"] = params
    return _R()


real_get = up._session.get
up._session.get = fake_get
with app.test_request_context():
    from flask import g
    g.session_token = "user-tok"
    up.gs_call("https://example.test/exec", params={"action": "getMyRejectedQuotations"})
up._session.get = real_get
ok("no sharedSecret in the query", "sharedSecret" not in (seen.get("params") or {}), seen)
ok("  the user's own token is sent", (seen.get("params") or {}).get("token") == "user-tok", seen)

print("\n3 · who may mark bills paid")
ROLE = {"value": "sales"}
_sa.validate_session = lambda token: {"username": "u", "role": ROLE["value"]} if token else None
c = app.test_client()
for role, want in (("sales", 403), ("leadgen", 403), ("hr", 403)):
    ROLE["value"] = role
    r = c.post("/billing/mark-paid", headers={"X-Session-Token": "t"}, json={"rowIndex": 2, "prNumber": "x"})
    ok(role + " → " + str(want), r.status_code == want, r.status_code)
    r = c.post("/billing/generate-cash-voucher", headers={"X-Session-Token": "t"}, json={})
    ok("  and the cash voucher → " + str(want), r.status_code == want, r.status_code)

print("\n4 · a non-Latin file name downloads")
with app.test_request_context():
    h = _pdf_response(b"%PDF-1.4", "Purchase_Order_Łódź_日本.pdf").headers["Content-Disposition"]
    try:
        h.encode("latin-1")
        latin = True
    except UnicodeEncodeError:
        latin = False
    ok("the header is Latin-1", latin, h)
    ok("  with the real name as filename*", "filename*=UTF-8''" in h and "%E6%97%A5" in h, h)

print("\n5 · the legacy Payment Request page opens")
r = c.get("/payment-request/")
ok("200, not 500", r.status_code == 200, r.status_code)

print("\n6 · too large is JSON everywhere")
ROLE["value"] = "admin"
app.config["MAX_CONTENT_LENGTH"] = 10
r = c.post("/payment-request/upload_file", headers={"X-Session-Token": "t"}, data={"x": "y" * 100})
ok("413 with a JSON body", r.status_code == 413 and r.is_json, (r.status_code, r.get_data(as_text=True)[:120]))

print("\n" + ("all ok" if not FAIL else str(FAIL) + " FAILED"))
sys.exit(1 if FAIL else 0)
