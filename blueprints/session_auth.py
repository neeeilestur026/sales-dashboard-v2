"""
Shared session validation for the Flask-side routes that need to know WHO is calling.

Both the email routes and the flow's secured-mutation route need the same thing: turn the
session token the browser holds into a trustworthy { username, role }. That logic used to live
only in email_log.py; A158 needs it for /flow/secure too, so it moved here rather than being
copied (a second copy of an auth check is a second place for it to drift).

The token is validated against the production Code.gs `validateSession` action — the same
deployment that issued it at login — and the answer is cached briefly, because a page can fire
several secured calls in a row and each one would otherwise pay for a round trip.

Nothing here trusts anything the browser says about itself beyond the token.
"""

import logging
import os
import time
from typing import Optional

import requests as http_requests

logger = logging.getLogger(__name__)

DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")
INTERNAL_SHARED_SECRET = os.environ.get("INTERNAL_SHARED_SECRET", "")

_session_cache: dict = {}          # { token: { username, role, _ts } }
_SESSION_CACHE_TTL = 300           # 5 min

_roster_cache: dict = {}           # { users: [...], _ts }
_ROSTER_CACHE_TTL = 600            # 10 min


def gs_post(payload: dict, timeout: int = 30) -> dict:
    """POST to the production Code.gs deployment, following its redirect chain.

    Apps Script answers a POST with a 302 to googleusercontent; requests won't carry the body
    through that hop, so the redirect is followed manually with a GET (the pattern the email
    routes have used since A32)."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return {"success": False, "message": "DASHBOARD_APPS_SCRIPT_URL not configured"}
    try:
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload,
                                  timeout=timeout, allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("Location")
            if loc:
                resp = http_requests.get(loc, timeout=timeout)
        return resp.json()
    except Exception as exc:
        logger.error("gs_post error: %s", exc)
        return {"success": False, "message": str(exc)}


def validate_session(token: str) -> Optional[dict]:
    """Return { username, role } for a valid token, else None.

    Retries once on a TRANSPORT failure so a burst of concurrent calls on a cold cache doesn't
    spuriously 401. An explicitly invalid token (Code.gs answered and said no) is never retried —
    the distinguishing signal is whether the reply carries a 'valid' key at all."""
    if not token:
        return None
    now = time.time()
    cached = _session_cache.get(token)
    if cached and (now - cached["_ts"]) < _SESSION_CACHE_TTL:
        return {"username": cached["username"], "role": cached["role"]}
    result = gs_post({"action": "validateSession", "token": token})
    if not result.get("success") and "valid" not in result:
        time.sleep(0.5)
        result = gs_post({"action": "validateSession", "token": token})
    if not result.get("success") or not result.get("valid"):
        return None
    username = result.get("username") or result.get("name") or ""
    role = result.get("role") or ""
    if not username:
        return None
    _session_cache[token] = {"username": username, "role": role, "_ts": now}
    return {"username": username, "role": role}


def get_roster() -> list:
    """The Users-sheet roster [{username, fullName, role}] — never passwords or credentials.

    Needed because the flow records people by DISPLAY name (`Created By`, `actorName`) while a
    session carries the login username; the secured route maps one to the other so a stamped
    approver name matches what every other row in the sheet already says. Cached ~10 min, with a
    stale-serve fallback: the roster changes rarely, and Apps Script cold starts are common."""
    now = time.time()
    if _roster_cache.get("users") and (now - _roster_cache.get("_ts", 0)) < _ROSTER_CACHE_TTL:
        return _roster_cache["users"]
    payload = {"action": "getUsersForBackend", "sharedSecret": INTERNAL_SHARED_SECRET}
    result = gs_post(payload, timeout=60)

    def _is_explicit(res):
        m = str(res.get("message", "")).strip().lower()
        return m == "forbidden" or "unknown action" in m

    if not result.get("success") and not _is_explicit(result):
        time.sleep(0.5)
        result = gs_post(payload, timeout=60)
    if not result.get("success"):
        if _roster_cache.get("users"):
            logger.warning("get_roster: Code.gs failed (%s) — serving stale roster",
                           result.get("message"))
            return _roster_cache["users"]
        logger.warning("get_roster failed: %s", result.get("message"))
        return []
    users = result.get("users") or []
    _roster_cache["users"] = users
    _roster_cache["_ts"] = now
    return users


def display_name_for(username: str) -> str:
    """The person's full name as the flow sheets record it, falling back to the username."""
    u = str(username or "").strip().lower()
    for row in get_roster():
        if str(row.get("username", "")).strip().lower() == u:
            return str(row.get("fullName") or row.get("username") or username)
    return str(username or "")
