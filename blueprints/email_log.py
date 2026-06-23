"""Email Log Blueprint — Fetch sent emails from each sales agent's GoDaddy
mailbox via IMAP and surface them to the daily report's Email Log section.

Trust model:
- Plaintext GoDaddy creds live only in process memory, transiently
- At rest: Fernet-encrypted blob stored in Users sheet via Apps Script
- Apps Script never sees plaintext
- INTERNAL_SHARED_SECRET gates the Apps Script credential-read endpoint so
  only Flask (not the browser) can fetch encrypted blobs
"""

import os
import time
import imaplib
import email as email_pkg
import logging
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime, getaddresses
from datetime import datetime, timezone, timedelta

# Philippines local time (UTC+8) — used to define "today" for the daily report
PH_TZ = timezone(timedelta(hours=8))
from typing import Optional

import requests as http_requests
from flask import Blueprint, request, jsonify
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

email_log_bp = Blueprint("email_log_bp", __name__)

DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")
EMAIL_CRED_KEY = os.environ.get("EMAIL_CRED_KEY", "")
INTERNAL_SHARED_SECRET = os.environ.get("INTERNAL_SHARED_SECRET", "")
GODADDY_IMAP_HOST = os.environ.get("GODADDY_IMAP_HOST", "imap.secureserver.net")
GODADDY_IMAP_PORT = int(os.environ.get("GODADDY_IMAP_PORT", "993"))

_SESSION_CACHE_TTL = 300       # validated sessions cached 5 min
_CREDS_CACHE_TTL = 1800        # encrypted creds cached 30 min
_session_cache: dict[str, dict] = {}   # token -> { username, role, _ts }
_creds_cache: dict[str, dict] = {}     # username -> { enc_blob, _ts }


def _fernet() -> Optional[Fernet]:
    if not EMAIL_CRED_KEY:
        return None
    try:
        return Fernet(EMAIL_CRED_KEY.encode() if isinstance(EMAIL_CRED_KEY, str) else EMAIL_CRED_KEY)
    except Exception as exc:
        logger.error("Invalid EMAIL_CRED_KEY: %s", exc)
        return None


def _gs_post(payload: dict) -> dict:
    if not DASHBOARD_APPS_SCRIPT_URL:
        return {"success": False, "message": "DASHBOARD_APPS_SCRIPT_URL not configured"}
    try:
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload,
                                  timeout=30, allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("Location")
            if loc:
                resp = http_requests.get(loc, timeout=30)
        return resp.json()
    except Exception as exc:
        logger.error("_gs_post error: %s", exc)
        return {"success": False, "message": str(exc)}


def _validate_session(token: str) -> Optional[dict]:
    """Return { username, role } if token is valid, else None. Caches 5 min."""
    if not token:
        return None
    now = time.time()
    cached = _session_cache.get(token)
    if cached and (now - cached["_ts"]) < _SESSION_CACHE_TTL:
        return {"username": cached["username"], "role": cached["role"]}
    result = _gs_post({"action": "validateSession", "token": token})
    if not result.get("success") or not result.get("valid"):
        return None
    username = result.get("username") or result.get("name") or ""
    role = result.get("role") or ""
    if not username:
        return None
    _session_cache[token] = {"username": username, "role": role, "_ts": now}
    return {"username": username, "role": role}


def _get_enc_creds(username: str) -> Optional[str]:
    now = time.time()
    cached = _creds_cache.get(username)
    if cached and (now - cached["_ts"]) < _CREDS_CACHE_TTL:
        return cached["enc_blob"]
    result = _gs_post({
        "action": "getEmailCredentialsForBackend",
        "username": username,
        "sharedSecret": INTERNAL_SHARED_SECRET,
    })
    if not result.get("success"):
        return None
    enc_blob = result.get("encBlob") or ""
    if not enc_blob:
        return None
    _creds_cache[username] = {"enc_blob": enc_blob, "_ts": now}
    return enc_blob


def _decrypt(enc_blob: str) -> Optional[tuple[str, str]]:
    fernet = _fernet()
    if not fernet:
        return None
    try:
        plain = fernet.decrypt(enc_blob.encode()).decode()
    except InvalidToken:
        logger.warning("Fernet decrypt failed (key mismatch?)")
        return None
    if "\n" not in plain:
        return None
    addr, pwd = plain.split("\n", 1)
    return addr.strip(), pwd


def _decode_mime(raw: str) -> str:
    """Decode RFC 2047 encoded header to a plain string."""
    if not raw:
        return ""
    parts = decode_header(raw)
    out = []
    for chunk, enc in parts:
        if isinstance(chunk, bytes):
            try:
                out.append(chunk.decode(enc or "utf-8", errors="replace"))
            except (LookupError, UnicodeDecodeError):
                out.append(chunk.decode("utf-8", errors="replace"))
        else:
            out.append(chunk)
    return "".join(out).strip()


def _company_from_email(addr: str) -> str:
    if "@" not in addr:
        return ""
    domain = addr.split("@", 1)[1].lower()
    # Strip common public-mail domains so we don't claim "gmail.com" is a company
    if domain in ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "live.com"):
        return ""
    base = domain.split(".")[0]
    return base


def _imap_login(addr: str, pwd: str) -> imaplib.IMAP4_SSL:
    conn = imaplib.IMAP4_SSL(GODADDY_IMAP_HOST, GODADDY_IMAP_PORT)
    conn.login(addr, pwd)
    return conn


def _select_sent(conn: imaplib.IMAP4_SSL) -> bool:
    for folder in ('"Sent"', '"Sent Items"', '"INBOX.Sent"', 'Sent', 'Sent Items'):
        try:
            typ, _ = conn.select(folder, readonly=True)
            if typ == "OK":
                return True
        except imaplib.IMAP4.error:
            continue
    return False


def fetch_sent_today(addr: str, pwd: str) -> list[dict]:
    """Connect to GoDaddy IMAP, return a list of headers for emails sent today (PH local time)."""
    conn = _imap_login(addr, pwd)
    try:
        if not _select_sent(conn):
            raise RuntimeError("Could not open Sent folder")
        # IMAP SINCE searches by server date; widen by 1 day to catch all of "today" in PH
        # (e.g. PH 8 AM = previous-day 00 UTC for some servers). We then filter client-side.
        now_ph = datetime.now(PH_TZ)
        today_ph = now_ph.date()
        since_dt = now_ph - timedelta(days=1)
        date_str = since_dt.strftime("%d-%b-%Y")
        typ, data = conn.search(None, f'SINCE {date_str}')
        if typ != "OK" or not data or not data[0]:
            return []
        ids = data[0].split()
        if not ids:
            return []
        # Batch fetch all headers in a single round-trip — sequential per-id fetches
        # over 50+ messages exceeds Render's gateway timeout (502).
        id_set = b",".join(ids)
        typ, msg_data = conn.fetch(id_set, "(BODY.PEEK[HEADER.FIELDS (TO CC BCC SUBJECT DATE MESSAGE-ID)])")
        if typ != "OK" or not msg_data:
            return []
        out = []
        for part in msg_data:
            if not isinstance(part, tuple) or len(part) < 2:
                continue
            hdr_bytes = part[1]
            msg = email_pkg.message_from_bytes(hdr_bytes)
            subject = _decode_mime(msg.get("Subject", ""))
            date_hdr = msg.get("Date", "")
            message_id = (msg.get("Message-ID", "") or "").strip("<>")
            # Only include emails actually sent today in PH local time
            try:
                sent_dt = parsedate_to_datetime(date_hdr) if date_hdr else None
            except (TypeError, ValueError):
                sent_dt = None
            if sent_dt and sent_dt.astimezone(PH_TZ).date() != today_ph:
                continue
            # Decode MIME-encoded headers BEFORE parsing addresses — otherwise
            # getaddresses can't extract the email from "=?UTF-8?B?...?= <a@b>"
            raw_recipients = (
                _decode_mime(msg.get("To", ""))
                or _decode_mime(msg.get("Cc", ""))
                or _decode_mime(msg.get("Bcc", ""))
            )
            name, recipient_addr = "", ""
            for n, a in getaddresses([raw_recipients]) if raw_recipients else []:
                if a:
                    name, recipient_addr = n, a
                    break
            out.append({
                "company": _company_from_email(recipient_addr) or (name.split()[-1] if name else ""),
                "name": name or recipient_addr,
                "recipient": recipient_addr,
                "subject": subject,
                "sentAt": sent_dt.astimezone(PH_TZ).isoformat() if sent_dt else date_hdr,
                "messageId": message_id,
            })
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            conn.logout()
        except Exception:
            pass


# ── Routes ────────────────────────────────────────────────────────


def _get_token() -> str:
    return (
        request.headers.get("X-Session-Token")
        or (request.json or {}).get("sessionToken", "")
        if request.is_json else
        request.headers.get("X-Session-Token", "")
    )


@email_log_bp.route("/api/email/setup", methods=["POST"])
def email_setup():
    if not EMAIL_CRED_KEY or not INTERNAL_SHARED_SECRET:
        return jsonify({"success": False, "message": "Server not configured (missing EMAIL_CRED_KEY / INTERNAL_SHARED_SECRET)"}), 500
    body = request.get_json(silent=True) or {}
    token = body.get("sessionToken", "")
    addr = (body.get("godaddyEmail") or "").strip()
    pwd = body.get("godaddyPassword") or ""
    if not addr or not pwd:
        return jsonify({"success": False, "message": "Email and password required"}), 400
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    # Verify creds work before storing
    try:
        conn = _imap_login(addr, pwd)
        conn.logout()
    except imaplib.IMAP4.error as exc:
        return jsonify({"success": False, "message": f"IMAP login failed: {exc}"}), 400
    except Exception as exc:
        return jsonify({"success": False, "message": f"Connection failed: {exc}"}), 400
    fernet = _fernet()
    if not fernet:
        return jsonify({"success": False, "message": "Encryption key not configured"}), 500
    enc_blob = fernet.encrypt(f"{addr}\n{pwd}".encode()).decode()
    result = _gs_post({
        "action": "setEmailCredentials",
        "token": token,
        "encBlob": enc_blob,
        "sharedSecret": INTERNAL_SHARED_SECRET,
    })
    if not result.get("success"):
        return jsonify({"success": False, "message": result.get("message", "Failed to save")}), 500
    _creds_cache[session["username"]] = {"enc_blob": enc_blob, "_ts": time.time()}
    return jsonify({"success": True, "message": "Email connected", "godaddyEmail": addr})


@email_log_bp.route("/api/email/test", methods=["POST"])
def email_test():
    body = request.get_json(silent=True) or {}
    token = body.get("sessionToken", "")
    addr = (body.get("godaddyEmail") or "").strip()
    pwd = body.get("godaddyPassword") or ""
    if not _validate_session(token):
        return jsonify({"success": False, "message": "Invalid session"}), 401
    if not addr or not pwd:
        return jsonify({"success": False, "message": "Email and password required"}), 400
    try:
        conn = _imap_login(addr, pwd)
        ok = _select_sent(conn)
        conn.logout()
        if not ok:
            return jsonify({"success": False, "message": "Login OK but Sent folder not found"})
        return jsonify({"success": True, "message": "Connection successful"})
    except imaplib.IMAP4.error as exc:
        return jsonify({"success": False, "message": f"IMAP login failed: {exc}"})
    except Exception as exc:
        return jsonify({"success": False, "message": f"Connection failed: {exc}"})


@email_log_bp.route("/api/email/today", methods=["GET", "POST"])
def email_today():
    token = ""
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        token = body.get("sessionToken", "")
    token = token or request.headers.get("X-Session-Token", "") or request.args.get("sessionToken", "")
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    enc_blob = _get_enc_creds(session["username"])
    if not enc_blob:
        return jsonify({"success": True, "needsSetup": True, "emails": []})
    decrypted = _decrypt(enc_blob)
    if not decrypted:
        return jsonify({"success": False, "message": "Stored credentials could not be decrypted (key rotated?)"}), 500
    addr, pwd = decrypted
    try:
        emails = fetch_sent_today(addr, pwd)
        return jsonify({"success": True, "emails": emails, "godaddyEmail": addr})
    except imaplib.IMAP4.error as exc:
        # Likely password changed — invalidate cache so next call re-fetches
        _creds_cache.pop(session["username"], None)
        return jsonify({"success": False, "message": f"IMAP error: {exc}", "needsSetup": True}), 400
    except Exception as exc:
        logger.error("fetch_sent_today error: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 500


@email_log_bp.route("/api/email/status", methods=["GET", "POST"])
def email_status():
    token = ""
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        token = body.get("sessionToken", "")
    token = token or request.headers.get("X-Session-Token", "") or request.args.get("sessionToken", "")
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    enc_blob = _get_enc_creds(session["username"])
    if not enc_blob:
        return jsonify({"success": True, "configured": False})
    decrypted = _decrypt(enc_blob)
    addr = decrypted[0] if decrypted else ""
    return jsonify({"success": True, "configured": True, "godaddyEmail": addr})


@email_log_bp.route("/api/email/disconnect", methods=["POST"])
def email_disconnect():
    body = request.get_json(silent=True) or {}
    token = body.get("sessionToken", "")
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    result = _gs_post({
        "action": "setEmailCredentials",
        "token": token,
        "encBlob": "",
        "sharedSecret": INTERNAL_SHARED_SECRET,
    })
    _creds_cache.pop(session["username"], None)
    if not result.get("success"):
        return jsonify({"success": False, "message": result.get("message", "Failed")}), 500
    return jsonify({"success": True, "message": "Disconnected"})
