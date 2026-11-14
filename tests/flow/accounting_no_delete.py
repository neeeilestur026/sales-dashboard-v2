"""A399 — Flask's /flow/secure refuses every FlowAPI delete for the accounting role.

Run:  ./venv/bin/python tests/flow/accounting_no_delete.py

Every FlowAPI delete is a secured action, so it can only reach FlowAPI through /flow/secure, which knows the
caller's real role. Pinned here, against a stand-in for Code.gs (sessions) and FlowAPI (the forward):

  1. accounting: every secured delete / remove / erase / clear action is refused with 403 and never forwarded
  2. accounting's other secured writes, and its voids, are still forwarded
  3. admin and the director still delete (forwarded)
  4. the rule matches api.js and Code.gs (same five verbs, accounting only)
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("FLASK_SECRET_KEY", "test")

from flask import Flask                                            # noqa: E402

import blueprints.session_auth as sa                               # noqa: E402
import blueprints.flow as fl                                       # noqa: E402

FAIL = 0
N = 0


def ok(label, cond, extra=None):
    global FAIL, N
    N += 1
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     " + repr(extra)[:300]))


ROLES = {"t-acct": "accounting", "t-admin": "admin", "t-dir": "director"}


def fake_gs_post(payload, timeout=30):
    role = ROLES.get(payload.get("token"))
    if payload.get("action") == "validateSession" and role:
        return {"success": True, "valid": True, "username": role + "-user", "role": role}
    return {"success": True, "valid": False}


forwarded = []


class _Resp:
    def __init__(self, text):
        self.text = text


def fake_gs_call(url, json=None, timeout=60):                       # noqa: A002 — the real signature
    forwarded.append(json.get("action"))
    return _Resp('{"success": true}')


sa.gs_post = fake_gs_post
sa.DASHBOARD_APPS_SCRIPT_URL = "https://example.invalid/codegs"
fl.gs_call = fake_gs_call
fl.FLOW_APPS_SCRIPT_URL = "https://example.invalid/flowapi"
fl.INTERNAL_SHARED_SECRET = "test-secret"

app = Flask(__name__)
app.register_blueprint(fl.flow_bp)
client = app.test_client()


def call(token, action):
    forwarded.clear()
    r = client.post("/flow/secure", headers={"X-Session-Token": token}, json={"action": action, "params": {}})
    return r.status_code, (r.get_json() or {}), list(forwarded)


DELETES = [a for a in fl.SECURED_ACTIONS if re.match(r"^(delete|remove|purge|erase|clear)[A-Z]", a)]

print("\n1 · accounting: every secured delete is refused and never forwarded")
ok("there are secured deletes to check (%d)" % len(DELETES), len(DELETES) >= 15, DELETES)
bad = []
for action in DELETES:
    code, body, fwd = call("t-acct", action)
    if not (code == 403 and body.get("refused") is True and "cannot delete" in body.get("message", "") and not fwd):
        bad.append((action, code, body, fwd))
ok("all %d refused with 403, nothing forwarded" % len(DELETES), not bad, bad[:3])
for action in ("deleteExpense", "deleteDocument", "deleteSalesOrder", "deletePaymentRequest", "removeReceivable", "eraseWebRequest"):
    ok("  includes " + action, action in DELETES)

print("\n2 · accounting's other writes and its voids still go through")
for action in ("voidInvoice", "voidCollection", "saveCollectionDetails", "markBillPaid"):
    if action not in fl.SECURED_ACTIONS:
        continue
    code, body, fwd = call("t-acct", action)
    ok("accounting " + action + " → forwarded", code == 200 and fwd == [action], (code, body, fwd))

print("\n3 · admin and the director still delete")
for token in ("t-admin", "t-dir"):
    code, body, fwd = call(token, "deleteExpense")
    ok(ROLES[token] + " deleteExpense → forwarded", code == 200 and fwd == ["deleteExpense"], (code, body, fwd))

print("\n4 · one rule in three places")
ok("delete_refused: accounting + deleteX", fl.delete_refused("Accounting", "deleteX") is True)
ok("  not admin", fl.delete_refused("admin", "deleteX") is False)
ok("  not a void", fl.delete_refused("accounting", "voidInvoice") is False)
ok("  not a word that only starts like it", fl.delete_refused("accounting", "deleted") is False)
root = os.path.join(os.path.dirname(__file__), "..", "..")
api = open(os.path.join(root, "dashboard", "js", "api.js"), encoding="utf-8").read()
gs = open(os.path.join(root, "apps-script", "Code.gs"), encoding="utf-8").read()
verbs = "(delete|remove|purge|erase|clear)[A-Z]"
ok("api.js uses the same verbs", verbs in api)
ok("Code.gs uses the same verbs", verbs in gs)
ok("flow.py uses the same verbs", verbs in open(fl.__file__, encoding="utf-8").read())
ok("accounting is the only role, everywhere",
   fl.NO_DELETE_ROLES == {"accounting"} and "const HX_NO_DELETE_ROLES = ['accounting'];" in api
   and "var _NO_DELETE_ROLES = { accounting: 1 };" in gs)

print("\n%d checks, %s" % (N, "%d FAILED" % FAIL if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
