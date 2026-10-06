"""A321 — the books bridge (/books/sync), through the real Flask route with both backends stubbed.

Run:  ./venv/bin/python tests/flow/books_bridge.py

Pinned:
  1. Only accounting, admin and the director may sync; no session is a 401.
  2. It reads Code.gs getBooksFeed as the signed-in user, then sends FlowAPI ingestBookEvents with the
     shared secret and the caller's REAL role and name — never what the browser said.
  3. Only the snapshot keys are forwarded (complete, payroll, billing, directorPayables, bankTransactions).
  4. A Code.gs failure, an HTML error page or a transport error is a clear 502, never a silent success.
  5. Not configured → 503.
"""
import json
import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("DASHBOARD_APPS_SCRIPT_URL", "https://example.test/code")

from app import app                                              # noqa: E402
import blueprints.session_auth as _sa                            # noqa: E402
import blueprints.books as bk                                    # noqa: E402

FAIL = 0


def ok(label, cond, extra=None):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     " + str(extra)[:500]))


ROLE = {"value": "accounting"}
_sa.validate_session = lambda token: {"username": "ana", "role": ROLE["value"]} if token else None
_sa.DASHBOARD_APPS_SCRIPT_URL = "https://example.test/code"
bk.display_name_for = lambda u: "Ana Acct"
bk.FLOW_APPS_SCRIPT_URL = "https://example.test/flow"
bk.INTERNAL_SHARED_SECRET = "s3cret"

calls = {"code": [], "flow": []}
FEED = {"success": True, "complete": True, "codeVersion": 5, "payroll": [{"period": "2026-05-A", "rows": []}],
        "billing": [], "directorPayables": [], "bankTransactions": [], "extra": "not forwarded"}


class Resp:
    def __init__(self, text):
        self.text = text


def fake_gs_json(url, json=None, **kw):
    calls["code"].append((url, json))
    return FEED_REPLY["value"]


def fake_gs_call(url, json=None, **kw):
    calls["flow"].append((url, json, kw.get("timeout")))
    if FLOW_REPLY["raise"] == "timeout":
        raise requests.exceptions.ReadTimeout("HTTPSConnectionPool(host='script.google.com', port=443): Read timed out. (read timeout=85)")
    if FLOW_REPLY["raise"]:
        raise RuntimeError("timeout")
    return Resp(FLOW_REPLY["text"])


FEED_REPLY = {"value": FEED}
FLOW_REPLY = {"text": '{"success": true, "message": "3 posted"}', "raise": False}
bk.gs_json = fake_gs_json
bk.gs_call = fake_gs_call
c = app.test_client()
H = {"X-Session-Token": "good"}

print("\n1 · who may sync")
r = c.post("/books/sync")
ok("no session → 401", r.status_code == 401, r.status_code)
for role, want in (("sales", 403), ("management", 403), ("warehouse", 403)):
    ROLE["value"] = role
    r = c.post("/books/sync", headers=H)
    ok(role + " → " + str(want), r.status_code == want, r.status_code)
ok("  and nothing was called", not calls["code"] and not calls["flow"])

print("\n2 · the two calls")
ROLE["value"] = "accounting"
r = c.post("/books/sync", headers=H)
ok("accounting syncs", r.status_code == 200 and r.get_json().get("message") == "3 posted", r.get_json())
ok("  Code.gs is asked for the feed", calls["code"] and calls["code"][-1][1] == {"action": "getBooksFeed"}, calls["code"])
url, body, wait = calls["flow"][-1]
ok("  FlowAPI gets ingestBookEvents", body["action"] == "ingestBookEvents" and url.endswith("/flow"))
ok("  stamped with the real role and name and the secret", body["actorRole"] == "accounting" and body["actorName"] == "Ana Acct" and body["flowSecret"] == "s3cret", body)
fed = json.loads(body["feed"])
ok("  only the snapshot keys travel", sorted(fed.keys()) == ["bankTransactions", "billing", "complete", "directorPayables", "payroll"], fed.keys())
ok("  FlowAPI is given 85 s and Code.gs 30 s — together under gunicorn's 120", wait == 85 and bk.FEED_TIMEOUT == 30, (wait, bk.FEED_TIMEOUT))
ROLE["value"] = "director"
ok("the director may sync", c.post("/books/sync", headers=H).status_code == 200)
ROLE["value"] = "admin"
ok("admin may sync", c.post("/books/sync", headers=H).status_code == 200)

print("\n3 · failures are loud")
ROLE["value"] = "accounting"
FEED_REPLY["value"] = {"success": False, "message": "Unknown action: getBooksFeed"}
r = c.post("/books/sync", headers=H)
ok("an old Code.gs → 502 naming the paste", r.status_code == 502 and "Code.gs (v5)" in r.get_json()["message"], r.get_json())
FEED_REPLY["value"] = FEED
FLOW_REPLY["text"] = "<html>Error</html>"
r = c.post("/books/sync", headers=H)
ok("an HTML error page from FlowAPI → 502", r.status_code == 502 and "error page" in r.get_json()["message"], r.get_json())
FLOW_REPLY["raise"] = True
r = c.post("/books/sync", headers=H)
ok("a transport error → 502", r.status_code == 502, r.status_code)
FLOW_REPLY["raise"] = "timeout"
r = c.post("/books/sync", headers=H)
ok("A324: Google too slow → 504 in plain words, never the raw HTTPSConnectionPool text",
   r.status_code == 504 and r.get_json().get("timedOut") is True and "press Sync again" in r.get_json()["message"]
   and "HTTPSConnectionPool" not in r.get_json()["message"], r.get_json())
FEED_REPLY["value"] = {"success": False, "message": "HTTPSConnectionPool(host='script.google.com', port=443): Read timed out. (read timeout=30)"}
FLOW_REPLY["raise"] = False
r = c.post("/books/sync", headers=H)
ok("  and Code.gs too slow → 504 that says nothing was posted", r.status_code == 504 and "nothing was posted" in r.get_json()["message"], r.get_json())
FEED_REPLY["value"] = FEED
FLOW_REPLY["raise"] = False
bk.FLOW_APPS_SCRIPT_URL = ""
r = c.post("/books/sync", headers=H)
ok("not configured → 503", r.status_code == 503, r.status_code)

print("\n" + ("all ok" if not FAIL else str(FAIL) + " FAILED"))
sys.exit(1 if FAIL else 0)
