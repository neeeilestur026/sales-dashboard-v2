"""
Who is calling — the one place Flask turns a session token into a trusted { username, role }.

Every route that reads data, writes to a sheet or renders a document is wrapped in
`require_session`. The token comes from the `X-Session-Token` header or the JSON body's
`sessionToken`; it is validated against the production Code.gs `validateSession` action — the
same deployment that issued it at login — and the answer is cached briefly and bounded, because a
page fires several calls in a row and each one would otherwise pay for a round trip. Logout
invalidates the cached entry, so a token stops working the moment the user signs out.

Nothing here trusts anything the browser says about itself beyond the token.

A299: the decorator, the bounded cache and the logout route replaced a second copy of this logic
in email_log.py and ~60 routes that checked nothing at all.
"""

import logging
import threading
import time
from functools import wraps
from typing import Optional

from flask import Blueprint, g, jsonify, request

from . import _config
from ._upstream import gs_json

logger = logging.getLogger(__name__)

DASHBOARD_APPS_SCRIPT_URL = _config.DASHBOARD_APPS_SCRIPT_URL
INTERNAL_SHARED_SECRET = _config.INTERNAL_SHARED_SECRET

_SESSION_CACHE_TTL = 300           # 5 min
_ROSTER_CACHE_TTL = 600            # 10 min


class _TTLCache:
    """A small, locked, bounded map: entries expire after `ttl` seconds and the oldest go first
    when `maxsize` is reached. Safe under gunicorn threads."""

    def __init__(self, maxsize: int = 2000, ttl: int = 300):
        self.maxsize, self.ttl = maxsize, ttl
        self._d: dict = {}
        self._lock = threading.Lock()

    def get(self, key):
        now = time.time()
        with self._lock:
            hit = self._d.get(key)
            if not hit:
                return None
            if now - hit[0] > self.ttl:
                self._d.pop(key, None)
                return None
            return hit[1]

    def set(self, key, value):
        now = time.time()
        with self._lock:
            if len(self._d) >= self.maxsize:
                for k in sorted(self._d, key=lambda k: self._d[k][0])[: max(1, self.maxsize // 10)]:
                    self._d.pop(k, None)
            self._d[key] = (now, value)

    def pop(self, key):
        with self._lock:
            self._d.pop(key, None)


_session_cache = _TTLCache(maxsize=2000, ttl=_SESSION_CACHE_TTL)
_roster_cache: dict = {}           # { users: [...], _ts }


def gs_post(payload: dict, timeout: int = 30) -> dict:
    """POST to the production Code.gs deployment; the transport lives in _upstream."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return {"success": False, "message": "DASHBOARD_APPS_SCRIPT_URL not configured"}
    return gs_json(DASHBOARD_APPS_SCRIPT_URL, json=payload, timeout=timeout)


def validate_session(token: str) -> Optional[dict]:
    """Return { username, role } for a valid token, else None.

    Retries once on a TRANSPORT failure so a burst of concurrent calls on a cold cache doesn't
    spuriously 401. An explicitly invalid token (Code.gs answered and said no) is never retried —
    the distinguishing signal is whether the reply carries a 'valid' key at all."""
    if not token:
        return None
    cached = _session_cache.get(token)
    if cached:
        return dict(cached)
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
    session = {"username": username, "role": role}
    _session_cache.set(token, session)
    return dict(session)


def invalidate_session(token: str) -> None:
    """Forget a token the moment its owner signs out."""
    if token:
        _session_cache.pop(token)


def _token_from_request() -> str:
    token = request.headers.get("X-Session-Token", "") or ""
    if not token and request.is_json:
        body = request.get_json(silent=True) or {}
        token = str(body.get("sessionToken") or "")
    return token.strip()


def require_session(roles=None):
    """Refuse a route unless the caller holds a valid session; expose it as `g.session`.

    `roles`, when given, is the set of lower-case roles allowed through (403 otherwise). The
    wrapped view is marked `_requires_session` so tests/audit/flask-routes.py can prove every
    non-static route carries this guard."""
    allowed = {str(r).lower() for r in (roles or [])}

    def deco(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not DASHBOARD_APPS_SCRIPT_URL:
                return jsonify({"success": False, "message":
                                "Sign-in checks are not configured on the server: "
                                "DASHBOARD_APPS_SCRIPT_URL is not set."}), 503
            token = _token_from_request()
            session = validate_session(token)
            if not session:
                return jsonify({"success": False, "message":
                                "Your session has expired — sign in again.", "authError": True}), 401
            if allowed and str(session.get("role", "")).lower() not in allowed:
                return jsonify({"success": False, "message": "Forbidden"}), 403
            g.session = session
            g.session_token = token
            return view(*args, **kwargs)
        wrapped._requires_session = True
        return wrapped
    return deco


session_bp = Blueprint("session_bp", __name__)


@session_bp.route("/api/session/logout", methods=["POST"])
def session_logout():
    """Drop the server-side cache entry for this token. Code.gs is told separately by the
    browser's apiLogout; this only closes the five-minute window here."""
    invalidate_session(_token_from_request())
    return jsonify({"success": True})


session_logout._requires_session = True     # it validates nothing, but it also grants nothing


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
