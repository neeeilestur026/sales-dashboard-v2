"""A321 — the books bridge: money recorded in Code.gs reaches the general ledger in FlowAPI.

Payroll, the Billing page, Director Payables and the bank page live in Code.gs; the general ledger
lives in FlowAPI.gs. Neither script calls the other, so this route carries the snapshot across:

    POST /books/sync   (accounting, admin, director)
        1. Code.gs getBooksFeed — a FULL snapshot of approved payroll cutoffs (with the employer
           shares from the contribution tables), paid Billing requests, paid Director Payables and
           the bank-page movements. Read as the signed-in user, so Code.gs applies its own role rule.
        2. FlowAPI ingestBookEvents — posts each item once by a key that never changes, re-posts a
           changed one by reversal, withdraws one that vanished, and parks anything uncertain in the
           books Inbox. Sent with the shared secret and the caller's REAL role, like /flow/secure.

It is idempotent: pressing it twice posts nothing the second time. It is deliberately a button and
not a timer — an unattended route would need to be open without a session.
"""

import json
import logging
import os

from flask import Blueprint, jsonify, g

from blueprints import _config
from blueprints._upstream import gs_json, gs_call
from blueprints.session_auth import require_session, display_name_for, INTERNAL_SHARED_SECRET

logger = logging.getLogger(__name__)
books_bp = Blueprint("books_bp", __name__)
FLOW_APPS_SCRIPT_URL = os.environ.get("FLOW_APPS_SCRIPT_URL", "")
SYNC_ROLES = ["accounting", "admin", "director"]


@books_bp.route("/books/sync", methods=["POST"])
@require_session(roles=SYNC_ROLES)
def books_sync():
    if not FLOW_APPS_SCRIPT_URL or not INTERNAL_SHARED_SECRET:
        return jsonify({"success": False, "message": "The books bridge is not configured on the server "
                        "(FLOW_APPS_SCRIPT_URL / INTERNAL_SHARED_SECRET)."}), 503

    feed = gs_json(_config.DASHBOARD_APPS_SCRIPT_URL, json={"action": "getBooksFeed"}, timeout=60)
    if not isinstance(feed, dict) or not feed.get("success"):
        msg = (feed or {}).get("message") if isinstance(feed, dict) else None
        return jsonify({"success": False, "message": "Could not read payroll and payments from the main backend: "
                        + (msg or "no answer") + ". Paste the latest Code.gs (v5) if this says Unknown action."}), 502

    session = g.session
    payload = {
        "action": "ingestBookEvents",
        "feed": json.dumps({k: feed.get(k) for k in ("complete", "payroll", "billing", "directorPayables", "bankTransactions")}),
        # identity is stamped from the validated session, never taken from the browser
        "actorRole": str(session.get("role") or "").strip().lower(),
        "actorName": display_name_for(session.get("username", "")),
        "actorUsername": session.get("username", ""),
        "flowSecret": INTERNAL_SHARED_SECRET,
    }
    try:
        resp = gs_call(FLOW_APPS_SCRIPT_URL, json=payload, timeout=60)
        text = resp.text or ""
        if text.lstrip().startswith("<"):
            logger.warning("books_sync: HTML response from FlowAPI")
            return jsonify({"success": False, "message": "The books backend returned an error page. "
                            "Sync again in a minute — anything already posted is not posted twice."}), 502
        return jsonify(json.loads(text))
    except Exception as exc:                                           # transport or JSON failure
        logger.exception("books_sync failed")
        return jsonify({"success": False, "message": str(exc)}), 502
