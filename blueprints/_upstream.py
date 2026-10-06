"""One HTTP client for every Apps Script call the server makes — A299.

Every blueprint used to open a fresh connection per call and carry its own copy of the same
dance: POST to the /exec URL, get a 302 to googleusercontent, GET that location because Apps
Script only answers the redirect to a GET. Ten copies, ten sets of timeouts, no connection reuse.
This module is the one copy.

It also stamps the server's identity on every payload: the shared secret Code.gs checks, and the
caller's validated session token when the call happens inside a request. Today's scripts ignore
the extra keys; the hardened Code.gs (AS-1) requires them, which is why this lands first.

Retries: only the GET legs (the redirect read and explicit GETs) are retried, and only on
connection errors or a 502/503/504. A POST is never resent — a mutation that timed out may well
have committed, and the caller is the one who knows how to check.
"""

import logging
import re
import time
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from flask import g, has_request_context

from . import _config

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = (5, 60)          # (connect, read) seconds
_REDIRECTS = (301, 302, 303, 307, 308)

_session = requests.Session()
_adapter = HTTPAdapter(
    pool_connections=10, pool_maxsize=10,
    max_retries=Retry(total=2, connect=2, read=0, status=2, backoff_factor=0.5,
                      status_forcelist=(502, 503, 504),
                      allowed_methods=frozenset(["GET"]), raise_on_status=False),
)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)
http = _session                    # for the rare non-Apps-Script fetch (the CSV proxy)


def safe_error(exc) -> str:
    """An exception's text with no URL, deployment id or credential in it — safe to show a user."""
    s = re.sub(r"(url:\s*)\S+", r"\1<redacted>", str(exc))
    s = re.sub(r"(sharedSecret|flowSecret|token)=[^&\s'\"),]+", r"\1=<redacted>", s)
    return re.sub(r"https?://\S+", "<the backend>", s)


def redact(url) -> str:
    """An Apps Script URL safe for a log line: the deployment id is replaced."""
    return re.sub(r"/macros/s/[^/]+/", "/macros/s/<redacted>/", str(url or ""))


def _timeout(t):
    if t is None:
        return DEFAULT_TIMEOUT
    if isinstance(t, (int, float)):
        return (DEFAULT_TIMEOUT[0], t)
    return t


def _identity() -> dict:
    ident = {}
    if _config.INTERNAL_SHARED_SECRET:
        ident["sharedSecret"] = _config.INTERNAL_SHARED_SECRET
    if has_request_context():
        token = getattr(g, "session_token", "") or ""
        if token:
            ident["token"] = token
    return ident


def gs_call(url: str, json: Optional[dict] = None, params: Optional[dict] = None,
            timeout=None, identity: bool = True, allow_redirects=None) -> requests.Response:
    """POST `json` (or GET `params`) to an Apps Script web app and return the FINAL response,
    after following its one redirect with a GET. Raises requests.RequestException on transport
    failure, exactly like a bare requests call, so existing callers keep their own handling.

    With `identity` (the default) the shared secret and the caller's session token are added to
    the payload; keys the caller set explicitly win. `allow_redirects` is accepted and ignored:
    the redirect is always followed here, once, with a GET."""
    timeout = _timeout(timeout)
    if identity:
        if isinstance(json, dict):
            json = {**_identity(), **json}
        elif json is None and params is not None:
            # A325 — never the shared secret in a URL: a query string ends up in exception texts,
            # proxies and logs. A GET carries only the caller's own session token; anything that has
            # to act as the server itself must be a POST (json=).
            ident = _identity()
            ident.pop("sharedSecret", None)
            params = {**ident, **params}
    if json is not None:
        resp = _session.post(url, json=json, timeout=timeout, allow_redirects=False)
    else:
        resp = _session.get(url, params=params, timeout=timeout, allow_redirects=False)
    if resp.status_code in _REDIRECTS:
        loc = resp.headers.get("Location")
        if loc:
            resp = _session.get(loc, timeout=timeout)
    return resp


def gs_json(url: str, json: Optional[dict] = None, params: Optional[dict] = None,
            timeout=None, identity: bool = True) -> dict:
    """gs_call, parsed. Never raises: any failure is {success: False, message}."""
    if not url:
        return {"success": False, "message": "Apps Script URL not configured"}
    try:
        resp = gs_call(url, json=json, params=params, timeout=timeout, identity=identity)
    except requests.RequestException as exc:
        logger.error("gs_json %s: %s", redact(url), safe_error(exc))
        return {"success": False, "message": safe_error(exc)}
    try:
        return resp.json()
    except ValueError:
        logger.warning("gs_json %s: non-JSON reply (HTTP %s)", redact(url), resp.status_code)
        return {"success": False, "message": f"HTTP {resp.status_code}: the backend did not answer with JSON"}


def remember_user(namespace: dict, uk: str, ttl: int = 3600, max_users: int = 200) -> None:
    """Bound a blueprint's per-user in-memory state without a background thread (A299).

    `namespace` is the blueprint's globals(); every dict in it named `_user_*` is a per-user store.
    The key is stamped now, then keys idle for longer than `ttl` seconds (or beyond the newest
    `max_users`) are dropped from every store. Runs on each keyed request, so the stores shrink as
    they are used."""
    stamps = namespace.setdefault("_user_stamps", {})
    stamps[uk] = time.time()
    cutoff = time.time() - ttl
    stale = [k for k, t in list(stamps.items()) if t < cutoff]   # A325 — a snapshot: other threads insert meanwhile
    if len(stamps) - len(stale) > max_users:
        stale += sorted((k for k in list(stamps) if k not in stale), key=lambda k: stamps.get(k, 0))[: len(stamps) - len(stale) - max_users]
    if not stale:
        return
    stores = [v for n, v in list(namespace.items()) if n.startswith("_user_") and n != "_user_stamps" and isinstance(v, dict)]
    for k in stale:
        stamps.pop(k, None)
        for store in stores:
            store.pop(k, None)
